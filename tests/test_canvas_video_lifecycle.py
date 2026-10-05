"""Video task acceptance, durable lookup, and non-resubmission without paid providers."""
import asyncio
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main


class CanvasVideoLifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.dir_patch = patch.object(main, "CANVAS_VIDEO_TASK_DIR", self.temp.name)
        self.dir_patch.start()
        self.addCleanup(self.dir_patch.stop)
        self.cache_patch = patch.object(main, "CANVAS_VIDEO_TASK_VOLATILE", {})
        self.cache_patch.start()
        self.addCleanup(self.cache_patch.stop)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test")
        self.addAsyncCleanup(self.client.aclose)
        self.task_id = "canvas_video_test_only_1234567890"
        self.body = {"client_task_id": self.task_id, "prompt": "自制隔离提示，不向供应商提交", "provider_id": "test-only"}

    async def wait_status(self, expected):
        for _ in range(100):
            response = await self.client.get(f"/api/canvas-video-tasks/{self.task_id}")
            self.assertEqual(response.status_code, 200)
            if response.json()["status"] == expected:
                return response.json()
            await asyncio.sleep(0.01)
        self.fail(f"video task did not reach {expected}")

    async def test_one_submission_survives_duplicate_post_and_completed_restart(self):
        entered = asyncio.Event()
        release = asyncio.Event()

        async def generated(_payload):
            entered.set()
            await release.wait()
            return {"videos": ["/assets/output/test-only.mp4"], "task_id": "remote-test-1", "raw": {"private": "discard"}}

        with patch.object(main, "canvas_video", side_effect=generated) as generate:
            first = await self.client.post("/api/canvas-video-tasks", json=self.body)
            self.assertEqual(first.status_code, 200)
            await asyncio.wait_for(entered.wait(), 2)
            duplicate = await self.client.post("/api/canvas-video-tasks", json=self.body)
            self.assertEqual(duplicate.status_code, 200)
            self.assertEqual(duplicate.json()["status"], "running")
            release.set()
            finished = await self.wait_status("succeeded")
            self.assertEqual(finished["result"]["videos"], ["/assets/output/test-only.mp4"])
            self.assertEqual(finished["result"]["task_id"], "remote-test-1")
            with patch.object(main, "CANVAS_VIDEO_TASK_PROCESS_ID", "new-process"):
                again = await self.client.post("/api/canvas-video-tasks", json=self.body)
                self.assertEqual(again.json()["status"], "succeeded")
            self.assertEqual(generate.call_count, 1)
        record = json.loads(Path(main.canvas_video_task_path(self.task_id)).read_text(encoding="utf-8"))
        self.assertNotIn("prompt", record)
        self.assertNotIn("raw", record["result"])
        self.assertNotIn("process_id", finished)

    async def test_restart_of_accepted_task_reports_unknown_without_resubmission(self):
        task = {
            "id": self.task_id, "task_id": self.task_id, "status": "running",
            "process_id": "previous-process", "result": None, "error": "",
        }
        main.write_canvas_video_task(task)
        with patch.object(main, "canvas_video") as generate:
            response = await self.client.post("/api/canvas-video-tasks", json=self.body)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["status"], "unknown")
            self.assertIn("远端状态未知", response.json()["error"])
            self.assertEqual((await self.client.get(f"/api/canvas-video-tasks/{self.task_id}")).json()["status"], "unknown")
            generate.assert_not_called()

    async def test_persistence_failure_prevents_remote_submission(self):
        with patch.object(main, "write_canvas_video_task", side_effect=OSError("synthetic disk failure")):
            with patch.object(main, "canvas_video") as generate:
                response = await self.client.post("/api/canvas-video-tasks", json=self.body)
                self.assertEqual(response.status_code, 503)
                self.assertIn("未提交", response.json()["detail"])
                generate.assert_not_called()

    async def test_upstream_timeout_is_unknown_and_explicit_rejection_is_failed(self):
        for error, expected in [
            (main.HTTPException(status_code=504, detail="synthetic timeout"), "unknown"),
            (main.HTTPException(status_code=400, detail="模拟参数无效"), "failed"),
        ]:
            with self.subTest(expected=expected):
                with patch.object(main, "canvas_video", side_effect=error):
                    response = await self.client.post("/api/canvas-video-tasks", json=self.body)
                    self.assertEqual(response.status_code, 200)
                    task = await self.wait_status(expected)
                    self.assertIsNone(task["result"])
                    if expected == "unknown":
                        self.assertIn("远端状态未知", task["error"])
                    else:
                        self.assertEqual(task["error"], "模拟参数无效")
            Path(main.canvas_video_task_path(self.task_id)).unlink()

    async def test_corrupt_record_is_never_overwritten(self):
        path = Path(main.canvas_video_task_path(self.task_id))
        path.write_text("broken JSON", encoding="utf-8")
        with patch.object(main, "canvas_video") as generate:
            response = await self.client.post("/api/canvas-video-tasks", json=self.body)
            self.assertEqual(response.status_code, 500)
            self.assertEqual(path.read_text(encoding="utf-8"), "broken JSON")
            generate.assert_not_called()


if __name__ == "__main__":
    unittest.main()
