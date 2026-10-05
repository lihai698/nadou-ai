"""视频本地任务接入统一远端状态协议的隔离专项。"""

import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main


class CanvasVideoRemoteProtocolIntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.dir_patch = patch.object(main, "CANVAS_VIDEO_TASK_DIR", self.temp.name)
        self.dir_patch.start()
        self.addCleanup(self.dir_patch.stop)
        self.cache_patch = patch.object(main, "CANVAS_VIDEO_TASK_VOLATILE", {})
        self.cache_patch.start()
        self.addCleanup(self.cache_patch.stop)
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app), base_url="http://test"
        )
        self.addAsyncCleanup(self.client.aclose)

    async def _wait(self, task_id, status):
        for _ in range(100):
            response = await self.client.get(f"/api/canvas-video-tasks/{task_id}")
            self.assertEqual(response.status_code, 200)
            task = response.json()
            if task.get("status") == status:
                return task
            await asyncio.sleep(0.01)
        self.fail(f"视频任务没有进入 {status} 状态")

    async def _post(self, task_id):
        return await self.client.post(
            "/api/canvas-video-tasks",
            json={
                "client_task_id": task_id,
                "prompt": "仅用于隔离测试的提示词，不发送给供应商",
                "provider_id": "test-only",
                "model": "test-video",
                "images": [{"url": "asset://test-image"}],
                "videos": ["asset://test-video"],
                "audios": ["asset://test-audio"],
                "duration": 8,
                "aspect_ratio": "9:16",
            },
        )

    async def test_success_persists_remote_status_and_input_trace_without_raw_payload(self):
        task_id = "canvas_video_protocol_success_1234567890"
        result = {
            "videos": ["/assets/output/isolation.mp4"],
            "task_id": "remote-test-42",
            "raw": {"status": "COMPLETED", "id": "remote-test-42", "videos": ["https://example.invalid/video.mp4"]},
        }
        with patch.object(main, "canvas_video", return_value=result):
            response = await self._post(task_id)
            self.assertEqual(response.status_code, 200)
            task = await self._wait(task_id, "succeeded")
        self.assertEqual(task["remote"]["status"], "succeeded")
        self.assertEqual(task["remote"]["task_id"], "remote-test-42")
        self.assertTrue(task["remote"]["remote_confirmed"])
        self.assertEqual(task["input_summary"]["prompt_length"], len("仅用于隔离测试的提示词，不发送给供应商"))
        self.assertEqual(task["input_summary"]["image_reference_count"], 1)
        self.assertEqual(task["input_summary"]["video_reference_count"], 1)
        self.assertEqual(task["input_summary"]["audio_reference_count"], 1)
        record = Path(main.canvas_video_task_path(task_id)).read_text(encoding="utf-8")
        self.assertNotIn("仅用于隔离测试的提示词", record)
        self.assertNotIn('"raw"', record)

    async def test_timeout_is_unknown_and_explicit_rejection_is_failed(self):
        timeout_id = "canvas_video_protocol_timeout_1234567890"
        with patch.object(main, "canvas_video", side_effect=main.HTTPException(status_code=504, detail="模拟超时")):
            response = await self._post(timeout_id)
            self.assertEqual(response.status_code, 200)
            task = await self._wait(timeout_id, "unknown")
        self.assertEqual(task["remote"]["status"], "unknown")
        self.assertTrue(task["remote"]["retryable"])
        self.assertIn("远端状态未知", task["error"])

        rejected_id = "canvas_video_protocol_reject_1234567890"
        with patch.object(main, "canvas_video", side_effect=main.HTTPException(status_code=400, detail="模拟参数被拒绝")):
            response = await self._post(rejected_id)
            self.assertEqual(response.status_code, 200)
            task = await self._wait(rejected_id, "failed")
        self.assertEqual(task["remote"]["status"], "failed")
        self.assertTrue(task["remote"]["remote_confirmed"])
        self.assertEqual(task["error"], "模拟参数被拒绝")

    async def test_timeout_keeps_remote_id_written_before_long_poll(self):
        task_id = "canvas_video_protocol_accept_timeout_123456"

        async def accepted_then_timeout(_payload):
            callback = main.CANVAS_VIDEO_REMOTE_ACCEPT_CALLBACK.get()
            self.assertIsNotNone(callback)
            await callback(
                "generic-remote-accepted",
                query_supported=True,
                query_mode="http_get",
            )
            raise main.HTTPException(status_code=504, detail="模拟查询超时")

        with patch.object(main, "canvas_video", new=accepted_then_timeout):
            response = await self._post(task_id)
            self.assertEqual(response.status_code, 200)
            task = await self._wait(task_id, "unknown")
        self.assertEqual(task["remote"]["status"], "unknown")
        self.assertEqual(task["remote"]["task_id"], "generic-remote-accepted")
        self.assertEqual(task["remote"]["query_mode"], "http_get")
        self.assertTrue(task["remote"]["query_supported"])

    async def test_restart_marks_remote_unknown_without_resubmission(self):
        task_id = "canvas_video_protocol_restart_1234567890"
        main.write_canvas_video_task(
            {
                "id": task_id,
                "task_id": task_id,
                "status": "running",
                "process_id": "previous-process",
                "result": None,
                "error": "",
            }
        )
        with patch.object(main, "canvas_video") as generate:
            response = await self.client.get(f"/api/canvas-video-tasks/{task_id}")
        self.assertEqual(response.status_code, 200)
        task = response.json()
        self.assertEqual(task["status"], "unknown")
        self.assertEqual(task["remote"]["status"], "unknown")
        self.assertIn("远端状态未知", task["error"])
        generate.assert_not_called()


if __name__ == "__main__":
    unittest.main()
