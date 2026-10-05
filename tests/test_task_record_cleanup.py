"""隔离验证后台任务记录的显式过期清理边界。"""

import json
import os
import sys
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.task_record_cleanup import (
    TaskCleanupCandidate,
    TaskCleanupConflict,
    TaskCleanupError,
    TaskCleanupPlan,
    TaskCleanupRecoveryRequired,
    apply_task_cleanup_plan,
    plan_expired_task_cleanup,
    public_task_cleanup_plan,
)
from backend import task_record_cleanup as cleanup
from backend.task_records import write_task_record


class TaskRecordCleanupTests(unittest.TestCase):
    def _write(self, root: str, task_id: str, status: str, **extra) -> None:
        record = {"id": task_id, "status": status}
        record.update(extra)
        write_task_record(root, record)

    def test_plan_only_selects_old_confirmed_terminal_records(self):
        with tempfile.TemporaryDirectory() as root:
            self._write(root, "canvas_img_old_success", "succeeded", updated_at=100)
            self._write(root, "canvas_comfy_old_failed", "failed", created_at=100)
            self._write(root, "canvas_img_recent_ok", "succeeded", updated_at=950)
            self._write(root, "canvas_img_queued_old", "queued", updated_at=100)
            self._write(root, "canvas_img_running_old", "running", updated_at=100)
            self._write(root, "canvas_img_unknown_old", "unknown", updated_at=100)
            self._write(root, "canvas_comfy_jimeng_old", "jimeng_pending", updated_at=100)
            # 旧格式没有时间字段时不能推断文件 mtime，必须保留。
            self._write(root, "canvas_img_no_timestamp", "failed")

            plan = plan_expired_task_cleanup(root, ttl_seconds=100, now=1000)

            self.assertEqual(
                {item.task_id for item in plan.candidates},
                {"canvas_img_old_success", "canvas_comfy_old_failed"},
            )
            self.assertEqual(
                set(plan.preserved_task_ids),
                {
                    "canvas_img_recent_ok",
                    "canvas_img_queued_old",
                    "canvas_img_running_old",
                    "canvas_img_unknown_old",
                    "canvas_comfy_jimeng_old",
                    "canvas_img_no_timestamp",
                },
            )
            self.assertTrue(Path(root, "canvas_img_old_success.json").is_file())

    def test_apply_requires_explicit_plan_and_deletes_only_candidates(self):
        with tempfile.TemporaryDirectory() as root:
            self._write(root, "canvas_img_old_success", "succeeded", updated_at=100)
            self._write(root, "canvas_img_running_old", "running", updated_at=100)

            plan = plan_expired_task_cleanup(root, ttl_seconds=100, now=1000)
            self.assertEqual(apply_task_cleanup_plan(plan), ("canvas_img_old_success",))
            self.assertFalse(Path(root, "canvas_img_old_success.json").exists())
            self.assertTrue(Path(root, "canvas_img_running_old.json").is_file())

    def test_corrupt_matching_record_fails_closed_without_deleting_other_candidates(self):
        with tempfile.TemporaryDirectory() as root:
            self._write(root, "canvas_img_old_success", "succeeded", updated_at=100)
            Path(root, "canvas_comfy_corrupt_record.json").write_text(
                json.dumps({
                    "id": "canvas_comfy_corrupt_record",
                    "status": "failed",
                    "error": "private diagnostic text",
                })[:-1],
                encoding="utf-8",
            )

            with self.assertRaisesRegex(TaskCleanupError, "任务记录损坏") as caught:
                plan_expired_task_cleanup(root, ttl_seconds=100, now=1000)
            self.assertNotIn("private diagnostic text", str(caught.exception))
            self.assertTrue(Path(root, "canvas_img_old_success.json").is_file())

    def test_changed_record_aborts_before_any_candidate_is_removed(self):
        with tempfile.TemporaryDirectory() as root:
            self._write(root, "canvas_img_old_first", "succeeded", updated_at=100)
            self._write(root, "canvas_img_old_second", "failed", updated_at=100)
            plan = plan_expired_task_cleanup(root, ttl_seconds=100, now=1000)

            # 改写第二条记录后，应用阶段的预检应在删除第一条之前失败。
            self._write(root, "canvas_img_old_second", "failed", updated_at=101)
            with self.assertRaises(TaskCleanupConflict):
                apply_task_cleanup_plan(plan)
            self.assertTrue(Path(root, "canvas_img_old_first.json").is_file())
            self.assertTrue(Path(root, "canvas_img_old_second.json").is_file())

    def test_second_delete_failure_restores_every_candidate(self):
        with tempfile.TemporaryDirectory() as root:
            first_id = "canvas_img_old_first"
            second_id = "canvas_img_old_second"
            self._write(root, first_id, "succeeded", updated_at=100)
            self._write(root, second_id, "failed", updated_at=100)
            plan = plan_expired_task_cleanup(root, ttl_seconds=100, now=1000)
            plan = replace(plan, candidates=tuple(sorted(plan.candidates, key=lambda item: item.task_id)))
            before = {item.task_id: Path(root, f"{item.task_id}.json").read_bytes() for item in plan.candidates}
            second_path = str(Path(root, f"{second_id}.json"))
            real_unlink = os.unlink
            failed = False

            def fail_second_once(path, *args, **kwargs):
                nonlocal failed
                if str(path) == second_path and not failed:
                    failed = True
                    raise OSError("simulated second delete failure")
                return real_unlink(path, *args, **kwargs)

            with patch.object(cleanup.os, "unlink", side_effect=fail_second_once):
                with self.assertRaisesRegex(TaskCleanupError, "原候选已恢复"):
                    apply_task_cleanup_plan(plan)

            self.assertTrue(failed)
            for task_id, content in before.items():
                self.assertEqual(Path(root, f"{task_id}.json").read_bytes(), content)
            self.assertEqual(list(Path(root).glob(".task_cleanup_recovery_*")), [])

    def test_backup_failure_stops_before_deleting_any_candidate(self):
        with tempfile.TemporaryDirectory() as root:
            self._write(root, "canvas_img_old_first", "succeeded", updated_at=100)
            self._write(root, "canvas_img_old_second", "failed", updated_at=100)
            plan = plan_expired_task_cleanup(root, ttl_seconds=100, now=1000)
            real_backup = cleanup._make_recovery_copy
            copied = 0

            def fail_on_second_copy(*args):
                nonlocal copied
                copied += 1
                if copied == 2:
                    raise OSError("simulated backup failure")
                return real_backup(*args)

            with patch.object(cleanup, "_make_recovery_copy", side_effect=fail_on_second_copy):
                with self.assertRaisesRegex(TaskCleanupError, "恢复备份创建失败"):
                    apply_task_cleanup_plan(plan)

            self.assertEqual(copied, 2)
            self.assertTrue(Path(root, "canvas_img_old_first.json").is_file())
            self.assertTrue(Path(root, "canvas_img_old_second.json").is_file())
            self.assertEqual(list(Path(root).glob(".task_cleanup_recovery_*")), [])

    def test_failed_rollback_keeps_recovery_copy_for_manual_repair(self):
        with tempfile.TemporaryDirectory() as root:
            first_id = "canvas_img_old_first"
            second_id = "canvas_img_old_second"
            self._write(root, first_id, "succeeded", updated_at=100)
            self._write(root, second_id, "failed", updated_at=100)
            plan = plan_expired_task_cleanup(root, ttl_seconds=100, now=1000)
            plan = replace(plan, candidates=tuple(sorted(plan.candidates, key=lambda item: item.task_id)))
            second_path = str(Path(root, f"{second_id}.json"))
            first_path = str(Path(root, f"{first_id}.json"))
            real_unlink = os.unlink
            real_replace = os.replace

            def fail_second(path, *args, **kwargs):
                if str(path) == second_path:
                    raise OSError("simulated delete failure")
                return real_unlink(path, *args, **kwargs)

            def fail_restore(source, target, *args, **kwargs):
                if str(target) == first_path:
                    raise OSError("simulated restore failure")
                return real_replace(source, target, *args, **kwargs)

            with patch.object(cleanup.os, "unlink", side_effect=fail_second), patch.object(
                cleanup.os, "replace", side_effect=fail_restore
            ):
                with self.assertRaises(TaskCleanupRecoveryRequired) as caught:
                    apply_task_cleanup_plan(plan)

            recovery = Path(caught.exception.recovery_dir)
            self.assertTrue(Path(recovery, ".ready").is_file())
            self.assertTrue(Path(recovery, f"{first_id}.json").is_file())
            self.assertFalse(Path(first_path).exists())
            # 隔离测试把副本恢复回来，证明保留的文件仍可使用。
            os.replace(recovery / f"{first_id}.json", first_path)
            self.assertTrue(Path(first_path).is_file())
            self.assertTrue(Path(second_path).is_file())

    def test_invalid_ttl_and_candidate_id_are_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaisesRegex(TaskCleanupError, "TTL"):
                plan_expired_task_cleanup(root, ttl_seconds=0, now=1000)
            plan = TaskCleanupPlan(
                root=str(Path(root).resolve()),
                now=1000,
                ttl_seconds=100,
                candidates=(
                    TaskCleanupCandidate(
                        task_id="../../outside",
                        status="succeeded",
                        age_seconds=1000,
                        timestamp_field="updated_at",
                        timestamp=0,
                        stat_token=(0, 0, 0, 0),
                        content_sha256="0" * 64,
                    ),
                ),
                preserved_task_ids=(),
            )
            with self.assertRaisesRegex(TaskCleanupError, "候选编号无效"):
                apply_task_cleanup_plan(plan)

    def test_non_task_files_are_ignored_without_widening_scan(self):
        with tempfile.TemporaryDirectory() as root:
            Path(root, "notes.json").write_text("private note", encoding="utf-8")
            nested = Path(root, "nested")
            nested.mkdir()
            Path(nested, "canvas_img_old_success.json").write_text("{}", encoding="utf-8")

            plan = plan_expired_task_cleanup(root, ttl_seconds=100, now=1000)
            self.assertEqual(plan.candidates, ())
            self.assertEqual(plan.preserved_task_ids, ())
            self.assertTrue(Path(root, "notes.json").is_file())
            self.assertTrue(Path(nested, "canvas_img_old_success.json").is_file())

    def test_duplicate_manual_candidates_are_rejected_before_delete(self):
        with tempfile.TemporaryDirectory() as root:
            self._write(root, "canvas_img_old_success", "succeeded", updated_at=100)
            plan = plan_expired_task_cleanup(root, ttl_seconds=100, now=1000)
            candidate = plan.candidates[0]
            duplicate_plan = TaskCleanupPlan(
                root=plan.root,
                now=plan.now,
                ttl_seconds=plan.ttl_seconds,
                candidates=(candidate, candidate),
                preserved_task_ids=plan.preserved_task_ids,
            )
            with self.assertRaisesRegex(TaskCleanupError, "候选编号重复"):
                apply_task_cleanup_plan(duplicate_plan)
            self.assertTrue(Path(root, "canvas_img_old_success.json").is_file())

    def test_public_plan_summary_excludes_paths_and_file_fingerprints(self):
        with tempfile.TemporaryDirectory() as root:
            self._write(root, "canvas_img_old_success", "succeeded", updated_at=100)
            plan = plan_expired_task_cleanup(root, ttl_seconds=100, now=1000)

            summary = public_task_cleanup_plan(plan)

            self.assertEqual(summary["mode"], "plan_only")
            self.assertFalse(summary["applied"])
            self.assertEqual(summary["candidate_count"], 1)
            self.assertEqual(summary["candidates"][0]["task_id"], "canvas_img_old_success")
            self.assertNotIn("root", summary)
            self.assertNotIn("stat_token", summary["candidates"][0])
            self.assertNotIn("content_sha256", summary["candidates"][0])


if __name__ == "__main__":
    unittest.main()
