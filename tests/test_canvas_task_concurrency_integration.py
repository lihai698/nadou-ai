"""阶段 11：真实画布图片任务入口遵守本进程并发闸门。"""

import asyncio
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main
from backend.task_concurrency import TaskConcurrencyGate


class CanvasTaskConcurrencyIntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="canvas-concurrency-")
        self.addCleanup(self.temp.cleanup)
        self.dir_patch = patch.object(main, "CANVAS_TASK_DIR", self.temp.name)
        self.dir_patch.start()
        self.addCleanup(self.dir_patch.stop)
        self.tasks_patch = patch.object(main, "CANVAS_TASKS", {})
        self.tasks_patch.start()
        self.addCleanup(self.tasks_patch.stop)
        self.gate_patch = patch.object(main, "CANVAS_IMAGE_TASK_GATE", TaskConcurrencyGate(1, name="image"))
        self.gate_patch.start()
        self.addCleanup(self.gate_patch.stop)
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app), base_url="http://test"
        )
        self.addAsyncCleanup(self.client.aclose)

    async def _wait_status(self, task_id, status):
        for _ in range(100):
            response = await self.client.get(f"/api/canvas-image-tasks/{task_id}")
            self.assertEqual(response.status_code, 200, response.text)
            payload = response.json()
            if payload.get("status") == status:
                return payload
            await asyncio.sleep(0.01)
        self.fail(f"任务 {task_id} 未进入 {status}")

    async def test_second_task_stays_queued_until_first_worker_finishes(self):
        started = [asyncio.Event(), asyncio.Event()]
        release = [asyncio.Event(), asyncio.Event()]
        calls = 0

        async def generator(payload):
            nonlocal calls
            index = calls
            calls += 1
            started[index].set()
            await release[index].wait()
            return {"images": [f"/assets/output/test-{index}.png"], "prompt": payload.prompt}

        with patch.object(main, "build_online_image_result", side_effect=generator):
            first = await self.client.post(
                "/api/canvas-image-tasks",
                json={"prompt": "第一个隔离任务", "provider_id": "test-only"},
            )
            second = await self.client.post(
                "/api/canvas-image-tasks",
                json={"prompt": "第二个隔离任务", "provider_id": "test-only"},
            )
            self.assertEqual(first.status_code, 200, first.text)
            self.assertEqual(second.status_code, 200, second.text)
            first_id, second_id = first.json()["task_id"], second.json()["task_id"]
            await asyncio.wait_for(started[0].wait(), 1)
            await asyncio.sleep(0.02)
            queued = await self.client.get(f"/api/canvas-image-tasks/{second_id}")
            self.assertEqual(queued.json()["status"], "queued")
            release[0].set()
            await self._wait_status(first_id, "succeeded")
            await asyncio.wait_for(started[1].wait(), 1)
            running = await self.client.get(f"/api/canvas-image-tasks/{second_id}")
            self.assertEqual(running.json()["status"], "running")
            release[1].set()
            finished = await self._wait_status(second_id, "succeeded")

        self.assertEqual(calls, 2)
        self.assertEqual(finished["result"]["images"], ["/assets/output/test-1.png"])

    async def test_maintenance_route_reports_process_scope_only(self):
        response = await self.client.get("/api/maintenance/task-concurrency")
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["scope"], "process")
        self.assertEqual(payload["limits"]["image"], 2)
        self.assertEqual({item["name"] for item in payload["tasks"]}, {"image", "comfy", "video"})
        self.assertNotIn("prompt", response.text)


if __name__ == "__main__":
    unittest.main()
