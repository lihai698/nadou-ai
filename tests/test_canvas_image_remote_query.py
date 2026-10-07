"""图片任务上游编号落盘与显式刷新边界。"""

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main


class CanvasImageRemoteQueryTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="canvas-image-remote-")
        self.addCleanup(self.temp.cleanup)
        self.dir_patch = patch.object(main, "CANVAS_TASK_DIR", self.temp.name)
        self.dir_patch.start()
        self.addCleanup(self.dir_patch.stop)
        self.tasks_patch = patch.object(main, "CANVAS_TASKS", {})
        self.tasks_patch.start()
        self.addCleanup(self.tasks_patch.stop)
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app), base_url="http://test"
        )
        self.addAsyncCleanup(self.client.aclose)

    def _write_unknown(self, *, with_remote=True):
        task_id = "canvas_img_remote_refresh_123456789"
        task = {
            "id": task_id,
            "type": "online-image",
            "status": "unknown",
            "created_at": 1.0,
            "updated_at": 2.0,
            "result": None,
            "error": "本地任务记录已失效",
            "provider_id": "test-only",
            "model": "image-model",
            "input_summary": {"prompt_length": 3},
            "process_id": "old-process",
        }
        if with_remote:
            task.update({
                "upstream_task_id": "remote-image-42",
                "remote_query_mode": "http_get",
            })
        main._write_canvas_task_record(task, required=True)
        return task

    def _write_unknown_batch(self, statuses=None):
        task_id = "canvas_img_batch_refresh_123456789"
        task = {
            "id": task_id,
            "type": "online-image",
            "status": "unknown",
            "created_at": 1.0,
            "updated_at": 2.0,
            "result": None,
            "error": "本地任务记录已失效",
            "provider_id": "test-only",
            "model": "image-model",
            "input_summary": {"prompt_length": 3},
            "process_id": "old-process",
            "upstream_task_id": "remote-image-1",
            "remote_query_mode": "http_get",
            "upstream_task_ids": ["remote-image-1", "remote-image-2"],
            "remote_query_modes": ["http_get", "http_get"],
            "upstream_task_statuses": statuses or {},
        }
        main._write_canvas_task_record(task, required=True)
        return task

    async def test_acceptance_callback_persists_remote_id(self):
        task_id = "canvas_img_callback_123456789"
        task = {
            "id": task_id,
            "type": "online-image",
            "status": "running",
            "created_at": 1.0,
            "updated_at": 1.0,
            "result": None,
            "error": "",
            "provider_id": "test-only",
            "model": "image-model",
            "input_summary": {"prompt_length": 3},
            "process_id": main.CANVAS_TASK_PROCESS_ID,
        }
        main.CANVAS_TASKS[task_id] = task
        await main.persist_canvas_image_remote_accept(
            task_id, "remote-image-99", query_mode="http_get"
        )
        saved = json.loads(Path(self.temp.name, task_id + ".json").read_text(encoding="utf-8"))
        self.assertEqual(saved["upstream_task_id"], "remote-image-99")
        self.assertEqual(saved["remote_query_mode"], "http_get")

    async def test_refresh_queries_existing_id_and_never_submits(self):
        task = self._write_unknown()
        result = {
            "status": "succeeded",
            "task_id": "remote-image-42",
            "provider_id": "test-only",
            "images": ["/assets/output/recovered.png"],
            "image_items": [{"url": "/assets/output/recovered.png"}],
        }
        with patch.object(main, "get_api_provider_exact", return_value={
            "id": "test-only", "protocol": "openai", "base_url": "https://example.test"
        }), patch.object(main, "query_image_task", new=AsyncMock(return_value=result)) as query:
            response = await self.client.post(
                f"/api/canvas-image-tasks/{task['id']}/refresh"
            )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["status"], "succeeded")
        query.assert_awaited_once()
        saved = json.loads(Path(self.temp.name, task["id"] + ".json").read_text(encoding="utf-8"))
        self.assertEqual(saved["status"], "succeeded")

    async def test_refresh_without_remote_id_is_blocked(self):
        task = self._write_unknown(with_remote=False)
        response = await self.client.post(
            f"/api/canvas-image-tasks/{task['id']}/refresh"
        )
        self.assertEqual(response.status_code, 409)
        self.assertIn("上游任务编号", response.json()["detail"])

    async def test_remote_accept_persistence_failure_is_unknown_not_failed(self):
        task_id = "canvas_img_callback_fail_123456789"
        task = {
            "id": task_id, "type": "online-image", "status": "running",
            "created_at": 1.0, "updated_at": 1.0, "result": None, "error": "",
            "provider_id": "test-only", "model": "image-model",
            "input_summary": {"prompt_length": 3},
            "process_id": main.CANVAS_TASK_PROCESS_ID,
        }
        main.CANVAS_TASKS[task_id] = task
        callback_error = OSError("disk full")
        with patch.object(main, "_write_canvas_task_record", side_effect=callback_error):
            with self.assertRaises(OSError) as raised:
                await main.persist_canvas_image_remote_accept(task_id, "remote-image-100")
        self.assertEqual(getattr(raised.exception, "upstream_task_id"), "remote-image-100")
        self.assertTrue(getattr(raised.exception, "remote_accept_persist_failed"))

    async def test_batch_acceptance_persists_all_remote_ids(self):
        task_id = "canvas_img_batch_callback_123456789"
        task = {
            "id": task_id, "type": "online-image", "status": "running",
            "created_at": 1.0, "updated_at": 1.0, "result": None, "error": "",
            "provider_id": "test-only", "model": "image-model",
            "input_summary": {"prompt_length": 3},
            "process_id": main.CANVAS_TASK_PROCESS_ID,
        }
        main.CANVAS_TASKS[task_id] = task
        await main.persist_canvas_image_remote_accept(task_id, "remote-image-1", batch=True)
        await main.persist_canvas_image_remote_accept(task_id, "remote-image-2", batch=True)
        saved = json.loads(Path(self.temp.name, task_id + ".json").read_text(encoding="utf-8"))
        self.assertEqual(saved["upstream_task_ids"], ["remote-image-1", "remote-image-2"])
        self.assertEqual(saved["upstream_task_statuses"], {
            "remote-image-1": "running", "remote-image-2": "running"
        })

    async def test_batch_refresh_merges_all_successful_images(self):
        task = self._write_unknown_batch()
        responses = {
            "remote-image-1": {"status": "succeeded", "task_id": "remote-image-1", "images": ["/assets/one.png"], "image_items": [{"url": "/assets/one.png"}]},
            "remote-image-2": {"status": "succeeded", "task_id": "remote-image-2", "images": ["/assets/two.png"], "image_items": [{"url": "/assets/two.png"}]},
        }

        async def query(payload):
            return responses[payload.task_id]

        with patch.object(main, "get_api_provider_exact", return_value={
            "id": "test-only", "protocol": "openai", "base_url": "https://example.test"
        }), patch.object(main, "query_image_task", new=AsyncMock(side_effect=query)) as query_mock:
            response = await self.client.post(f"/api/canvas-image-tasks/{task['id']}/refresh")
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["status"], "succeeded")
        self.assertEqual(body["result"]["images"], ["/assets/one.png", "/assets/two.png"])
        self.assertEqual(query_mock.await_count, 2)

    async def test_batch_refresh_keeps_partial_result_for_next_refresh(self):
        task = self._write_unknown_batch()
        calls = []

        async def query(payload):
            calls.append(payload.task_id)
            if payload.task_id == "remote-image-1":
                return {"status": "succeeded", "task_id": payload.task_id, "images": ["/assets/one.png"], "image_items": [{"url": "/assets/one.png"}]}
            if len(calls) == 2:
                return {"status": "running", "task_id": payload.task_id, "message": "处理中"}
            return {"status": "succeeded", "task_id": payload.task_id, "images": ["/assets/two.png"], "image_items": [{"url": "/assets/two.png"}]}

        provider = {"id": "test-only", "protocol": "openai", "base_url": "https://example.test"}
        with patch.object(main, "get_api_provider_exact", return_value=provider), patch.object(main, "query_image_task", new=AsyncMock(side_effect=query)) as query_mock:
            first = await self.client.post(f"/api/canvas-image-tasks/{task['id']}/refresh")
            second = await self.client.post(f"/api/canvas-image-tasks/{task['id']}/refresh")
        self.assertEqual(first.json()["status"], "unknown")
        self.assertEqual(second.json()["status"], "succeeded")
        self.assertEqual(second.json()["result"]["images"], ["/assets/one.png", "/assets/two.png"])
        self.assertEqual(query_mock.await_count, 3)
        self.assertEqual(calls, ["remote-image-1", "remote-image-2", "remote-image-2"])

    async def test_batch_refresh_partial_failure_with_success_is_succeeded(self):
        task = self._write_unknown_batch()
        result_by_id = {
            "remote-image-1": {"status": "succeeded", "images": ["/assets/one.png"], "image_items": [{"url": "/assets/one.png"}]},
            "remote-image-2": {"status": "failed", "error": "上游失败"},
        }
        provider = {"id": "test-only", "protocol": "openai", "base_url": "https://example.test"}
        with patch.object(main, "get_api_provider_exact", return_value=provider), patch.object(main, "query_image_task", new=AsyncMock(side_effect=lambda payload: result_by_id[payload.task_id])):
            response = await self.client.post(f"/api/canvas-image-tasks/{task['id']}/refresh")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "succeeded")
        self.assertEqual(response.json()["result"]["images"], ["/assets/one.png"])
        self.assertIn("1 个上游编号失败", response.json()["error"])


if __name__ == "__main__":
    unittest.main()
