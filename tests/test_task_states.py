"""Check local task transitions independently of FastAPI and providers."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.task_states import task_state_update


class TaskStateRulesTests(unittest.TestCase):
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
