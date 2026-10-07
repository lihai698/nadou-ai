"""Check local task transitions independently of FastAPI and providers."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.task_states import task_state_update
from backend import task_states


class InterruptedTaskStateTests(unittest.TestCase):
    def update(self, task, process_id="current", message="远端状态未知"):
        rule = getattr(task_states, "interrupted_task_update", None)
        self.assertTrue(callable(rule), "重启转换应由独立的纯状态规则提供")
        return rule(task, process_id, 123.5, unknown_message=message)

    def test_previous_process_active_tasks_preserve_remote_ids_and_old_fields(self):
        from copy import deepcopy
        for status in ("queued", "running"):
            for owner in ("previous", None):
                with self.subTest(status=status, owner=owner):
                    task = {"status": status, "updated_at": 1,
                            "upstream_task_id": "remote-1",
                            "upstream_task_ids": ["remote-1", "remote-2"],
                            "result": {"images": ["existing.png"]},
                            "legacy_extra": {"keep": True}}
                    if owner is not None:
                        task["process_id"] = owner
                    before = deepcopy(task)
                    update = self.update(task)
                    self.assertEqual(update, {"status": "unknown", "error": "远端状态未知", "updated_at": 123.5})
                    self.assertEqual(task, before)
                    self.assertEqual({**task, **update}, {**before, "status": "unknown", "error": "远端状态未知", "updated_at": 123.5})

    def test_current_process_active_tasks_do_not_change(self):
        for status in ("queued", "running"):
            self.assertEqual(self.update({"status": status, "process_id": "current"}), {})

    def test_terminal_pending_and_unknown_tasks_do_not_change(self):
        for status in ("succeeded", "failed", "jimeng_pending", "unknown"):
            self.assertEqual(self.update({"status": status, "process_id": "previous"}), {})

    def test_error_fallback_and_length_keep_existing_contract(self):
        task = {"status": "running"}
        self.assertEqual(self.update(task, message="")["error"], "远端状态未知")
        self.assertEqual(self.update(task, message="字" * 601)["error"], "字" * 600)


class TaskStateRulesTests(unittest.TestCase):
    def test_batch_remote_outcome_preserves_partial_and_unconfirmed_semantics(self):
        rule = getattr(task_states, "image_batch_outcome", None)
        self.assertTrue(callable(rule), "批量查询应使用独立状态汇总规则")
        cases = [
            ([], False, "unknown"),
            ([], True, "unknown"),
            (["succeeded", "succeeded"], False, "succeeded"),
            (["succeeded", "failed"], True, "partial"),
            (["succeeded", "failed"], False, "unknown"),
            (["failed", "failed"], False, "failed"),
            (["failed", "failed"], True, "partial"),
            (["succeeded", "running"], True, "unknown"),
            (["succeeded", "unknown"], True, "unknown"),
            (["failed", "queued"], False, "unknown"),
        ]
        for statuses, has_images, expected in cases:
            with self.subTest(statuses=statuses, has_images=has_images):
                original = list(statuses)
                self.assertEqual(rule(statuses, has_images=has_images), expected)
                self.assertEqual(statuses, original)

    def test_normal_lifecycle_preserves_record_and_terminal_payload(self):
        queued = {"id": "local-only", "status": "queued", "result": None, "provider_id": "test"}
        running = task_state_update(queued, "running", 2.0)
        self.assertEqual(running, {"status": "running", "updated_at": 2.0})
        self.assertEqual(queued["status"], "queued")

        result = {"images": ["/assets/output/mock.png"]}
        succeeded = task_state_update({**queued, **running}, "succeeded", 3.0, result=result)
        self.assertEqual(succeeded, {
            "status": "succeeded", "updated_at": 3.0, "result": result, "error": "",
        })
        failed = task_state_update({**queued, **running}, "failed", 3.0,
            error="上游不可用", status_code=503, upstream_task_id="remote-1")
        self.assertEqual(failed, {
            "status": "failed", "updated_at": 3.0, "error": "上游不可用",
            "status_code": 503, "upstream_task_id": "remote-1",
        })
        self.assertIsNone(queued["result"])

    def test_terminal_and_unconfirmed_cancel_transitions_are_rejected(self):
        for current, target in (
            ("queued", "succeeded"),
            ("running", "cancelled"),
            ("succeeded", "failed"),
            ("failed", "succeeded"),
            ("jimeng_pending", "failed"),
        ):
            with self.subTest(current=current, target=target):
                with self.assertRaises(ValueError):
                    task_state_update({"status": current}, target, 4.0)

    def test_jimeng_pending_requires_remote_query_details(self):
        with self.assertRaises(ValueError):
            task_state_update({"status": "running"}, "jimeng_pending", 5.0)
        update = task_state_update({"status": "running"}, "jimeng_pending", 5.0,
            pending={"submit_id": "remote-2", "kind": "image", "queue_info": {"queue_idx": 1}, "message": "排队中"})
        self.assertEqual(update["status"], "jimeng_pending")
        self.assertEqual(update["submit_id"], "remote-2")
        self.assertEqual(update["error"], "")

    def test_video_running_task_can_become_unknown_without_mutating_record(self):
        running = {"id": "canvas_video_test_only_1234", "status": "running"}
        update = task_state_update(
            running, "unknown", 6.0,
            error="视频请求可能已被上游受理，远端状态未知",
            upstream_task_id="remote-video-1",
        )
        self.assertEqual(update, {
            "status": "unknown",
            "updated_at": 6.0,
            "result": None,
            "error": "视频请求可能已被上游受理，远端状态未知",
            "upstream_task_id": "remote-video-1",
        })
        self.assertEqual(running["status"], "running")


if __name__ == "__main__":
    unittest.main()
