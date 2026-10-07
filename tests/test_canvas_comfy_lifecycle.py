"""Exercise the separate ComfyUI task routes without starting ComfyUI."""

import asyncio
import json
import sys
import threading
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main


class CanvasComfyLifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        tasks_patch = patch.object(main, "CANVAS_TASKS", {})
        tasks_patch.start()
        self.addCleanup(tasks_patch.stop)
        self.task_dir = tempfile.TemporaryDirectory()
        task_dir_patch = patch.object(main, "CANVAS_TASK_DIR", self.task_dir.name)
        task_dir_patch.start()
        self.addCleanup(task_dir_patch.stop)
        self.addCleanup(self.task_dir.cleanup)
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app), base_url="http://test"
        )
        self.addAsyncCleanup(self.client.aclose)

    async def exercise(self, outcome):
        entered, release = threading.Event(), threading.Event()
        workers = []
        real_create_task = asyncio.create_task

        def generate(_payload):
            entered.set()
            if not release.wait(3):
                raise AssertionError("controlled ComfyUI worker was not released")
            if isinstance(outcome, BaseException):
                raise outcome
            return outcome

        def spawn(coroutine):
            worker = real_create_task(coroutine)
            workers.append(worker)
            return worker

        with patch.object(main, "generate", side_effect=generate) as upstream:
            with patch.object(main.asyncio, "create_task", side_effect=spawn):
                try:
                    submitted = await self.client.post(
                        "/api/canvas-comfy-tasks",
                        json={"prompt": "隔离 ComfyUI 任务", "workflow_json": "test-only.json"},
                    )
                    self.assertEqual(submitted.status_code, 200)
                    self.assertEqual(submitted.json()["status"], "queued")
                    task_id = submitted.json()["task_id"]
                    self.assertTrue(await asyncio.to_thread(entered.wait, 2))
                    running = await self.client.get(f"/api/canvas-comfy-tasks/{task_id}")
                    self.assertEqual(running.json()["status"], "running")
                    self.assertIsNone(running.json()["result"])
                    release.set()
                    await asyncio.wait_for(asyncio.gather(*workers), 3)
                    terminal = await self.client.get(f"/api/canvas-comfy-tasks/{task_id}")
                    repeated = await self.client.get(f"/api/canvas-comfy-tasks/{task_id}")
                    self.assertEqual(terminal.json(), repeated.json())
                    self.assertEqual(upstream.call_count, 1, "GET must not repeat generation")
                    return terminal.json()
                finally:
                    release.set()
                    for worker in workers:
                        if not worker.done():
                            worker.cancel()
                    await asyncio.gather(*workers, return_exceptions=True)

    async def test_success_has_real_result(self):
        task = await self.exercise({
            "images": ["/assets/output/test-only.png"],
            "prompt": "不应写入持久记录的提示词",
            "workflow_json": "private-workflow.json",
            "params": {"secret": "private-value"},
        })
        self.assertEqual(task["status"], "succeeded")
        self.assertEqual(task["result"]["images"], ["/assets/output/test-only.png"])
        persisted = json.loads(
            Path(self.task_dir.name, task["id"] + ".json").read_text(encoding="utf-8")
        )
        encoded = json.dumps(persisted, ensure_ascii=False)
        self.assertNotIn("workflow_json", persisted)
        self.assertNotIn("隔离 ComfyUI 任务", encoded)
        self.assertNotIn("test-only.json", encoded)
        self.assertNotIn("不应写入持久记录的提示词", encoded)
        self.assertNotIn("private-value", encoded)
        self.assertEqual(persisted["input_summary"]["workflow_length"], len("test-only.json"))

    async def test_timeout_connection_loss_and_provider_error_are_terminal(self):
        for outcome, expected in (
            (httpx.ReadTimeout("模拟 ComfyUI 读取超时"), "读取超时"),
            (httpx.ConnectError("模拟 ComfyUI 连接中断"), "连接中断"),
            ({"error": "模拟 ComfyUI 生成报错"}, "生成报错"),
        ):
            with self.subTest(expected=expected):
                task = await self.exercise(outcome)
                self.assertEqual(task["status"], "failed")
                self.assertIn(expected, task["error"])
                self.assertIsNone(task["result"])

    async def test_foreign_running_task_becomes_unknown_without_generation(self):
        task_id = "canvas_comfy_restart_unknown_123456789"
        main._write_canvas_task_record(
            {
                "id": task_id,
                "type": "comfy",
                "status": "running",
                "created_at": 1.0,
                "updated_at": 1.0,
                "result": None,
                "error": "",
                "workflow_json": "test-only.json",
                "input_summary": {"workflow_length": 14},
                "process_id": "previous-process",
            },
            required=True,
        )
        with patch.object(main, "generate", side_effect=AssertionError("restart must not submit")):
            response = await self.client.get(f"/api/canvas-comfy-tasks/{task_id}")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "unknown")
        self.assertIn("远端状态未知", response.json()["error"])
        saved = json.loads(Path(self.task_dir.name, f"{task_id}.json").read_text(encoding="utf-8"))
        self.assertEqual(saved["status"], "unknown")


if __name__ == "__main__":
    unittest.main()
