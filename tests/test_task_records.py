"""验证后台任务记录路径、原子保存和重启边界规则。"""

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.task_records import (
    TaskRecordError,
    mark_interrupted_task,
    read_task_record,
    task_input_summary,
    task_record_path,
    write_task_record,
)


class TaskRecordRuleTests(unittest.TestCase):
    def test_path_rejects_traversal_and_unrelated_ids(self):
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaises(TaskRecordError):
                task_record_path(root, "../../private")
            with self.assertRaises(TaskRecordError):
                task_record_path(root, "canvas_video_fake")

    def test_write_and_read_keep_json_shape(self):
        with tempfile.TemporaryDirectory() as root:
            task = {"id": "canvas_img_test_only_1234", "status": "queued", "process_id": "p1"}
            write_task_record(root, task)
            self.assertEqual(read_task_record(root, task["id"]), task)
            self.assertTrue(Path(root, task["id"] + ".json").is_file())

    def test_legacy_json_keeps_unknown_fields_and_utf8_bom(self):
        with tempfile.TemporaryDirectory() as root:
            task_id = "canvas_img_legacy_record_1234"
            legacy = {
                "id": task_id,
                "task_id": task_id,
                "status": "running",
                "created_at": 1.0,
                "updated_at": 2.0,
                "result": None,
                "error": "",
                "legacy_provider_name": "旧配置字段",
            }
            Path(root, task_id + ".json").write_bytes(
                b"\xef\xbb\xbf" + json.dumps(legacy, ensure_ascii=False).encode("utf-8")
            )
            self.assertEqual(read_task_record(root, task_id), legacy)

    def test_atomic_write_failure_preserves_existing_record(self):
        with tempfile.TemporaryDirectory() as root:
            task = {"id": "canvas_img_atomic_record_1234", "status": "queued"}
            write_task_record(root, task)
            path = Path(root, task["id"] + ".json")
            before = path.read_bytes()
            with patch("backend.task_records.write_json_atomic", side_effect=OSError("disk full")):
                with self.assertRaises(OSError):
                    write_task_record(root, {**task, "status": "running"})
            self.assertEqual(path.read_bytes(), before)

    def test_missing_record_returns_none(self):
        with tempfile.TemporaryDirectory() as root:
            self.assertIsNone(read_task_record(root, "canvas_img_missing_record_1234"))

    def test_video_records_use_the_same_persistence_contract(self):
        with tempfile.TemporaryDirectory() as root:
            task = {
                "id": "canvas_video_test_only_1234",
                "status": "running",
                "type": "video",
                "remote": {"task_id": "remote-1"},
            }
            write_task_record(root, task)
            self.assertEqual(read_task_record(root, task["id"]), task)

    def test_corrupt_record_is_rejected_without_returning_content(self):
        with tempfile.TemporaryDirectory() as root:
            task_id = "canvas_comfy_test_only_1234"
            path = Path(root, task_id + ".json")
            path.write_text("secret=incomplete", encoding="utf-8")
            with self.assertRaises(TaskRecordError):
                read_task_record(root, task_id)

    def test_unknown_status_is_rejected_without_exposing_record_content(self):
        with tempfile.TemporaryDirectory() as root:
            task_id = "canvas_img_test_only_1234"
            path = Path(root, task_id + ".json")
            path.write_text(
                json.dumps({
                    "id": task_id,
                    "status": "corrupted-status",
                    "error": "private diagnostic text",
                }),
                encoding="utf-8",
            )
            with self.assertRaises(TaskRecordError) as caught:
                read_task_record(root, task_id)
            self.assertNotIn("private diagnostic text", str(caught.exception))

    def test_non_finite_timestamp_is_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            task_id = "canvas_img_test_only_1234"
            path = Path(root, task_id + ".json")
            path.write_text(
                '{"id":"%s","status":"running","updated_at":NaN}' % task_id,
                encoding="utf-8",
            )
            with self.assertRaisesRegex(TaskRecordError, "时间无效"):
                read_task_record(root, task_id)

    def test_overflowing_timestamp_is_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            task_id = "canvas_img_test_only_1234"
            path = Path(root, task_id + ".json")
            path.write_text(
                '{"id":"%s","status":"running","updated_at":%s}'
                % (task_id, "9" * 5000),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(TaskRecordError, "时间无效"):
                read_task_record(root, task_id)

    def test_write_rejects_invalid_result_shape(self):
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaisesRegex(TaskRecordError, "字段类型无效"):
                write_task_record(root, {
                    "id": "canvas_comfy_test_only_1234",
                    "status": "succeeded",
                    "result": ["not-an-object"],
                })

    def test_interrupted_task_becomes_unknown_without_resubmission_hint(self):
        task = {"id": "canvas_img_test_only_1234", "status": "running", "process_id": "old"}
        result = mark_interrupted_task(task, "new", now=123.5, unknown_message="远端状态未知")
        self.assertEqual(result["status"], "unknown")
        self.assertEqual(result["updated_at"], 123.5)
        self.assertEqual(task["status"], "running")

    def test_current_process_task_is_unchanged(self):
        task = {"id": "canvas_img_test_only_1234", "status": "running", "process_id": "same"}
        self.assertEqual(mark_interrupted_task(task, "same", now=123.5, unknown_message="unknown"), task)

    def test_input_summary_omits_original_content(self):
        summary = task_input_summary(
            prompt="private prompt",
            provider_id="test-only",
            model="model-x",
            workflow_json='{"secret":"value"}',
            reference_count=2,
        )
        encoded = json.dumps(summary, ensure_ascii=False)
        self.assertEqual(summary["prompt_length"], len("private prompt"))
        self.assertEqual(summary["workflow_length"], len('{"secret":"value"}'))
        self.assertNotIn("private prompt", encoded)
        self.assertNotIn("secret", encoded)
        self.assertNotIn("value", encoded)


if __name__ == "__main__":
    unittest.main()
