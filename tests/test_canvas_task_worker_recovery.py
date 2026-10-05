"""阶段 11：后台任务 worker 丢失内存缓存时仍按持久记录收敛状态。

测试只使用临时任务目录和模拟图片/ComfyUI 生成函数，不连接外部服务。
"""

import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main


class CanvasTaskWorkerRecoveryTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addAsyncCleanup(asyncio.sleep, 0)
        self.addCleanup(self.temp.cleanup)
        self.tasks_patch = patch.object(main, "CANVAS_TASKS", {})
        self.tasks_patch.start()
        self.addCleanup(self.tasks_patch.stop)
        self.dir_patch = patch.object(main, "CANVAS_TASK_DIR", self.temp.name)
        self.dir_patch.start()
        self.addCleanup(self.dir_patch.stop)

    def _record(self, task_id: str, task_type: str):
        task = {
            "id": task_id,
            "type": task_type,
            "status": "queued",
            "created_at": 1.0,
            "updated_at": 1.0,
            "result": None,
            "error": "",
            "provider_id": "test-only",
            "model": "test-model",
            "input_summary": {"prompt_length": 5},
            "process_id": main.CANVAS_TASK_PROCESS_ID,
        }
        main._write_canvas_task_record(task, required=True)
        return task

    async def test_image_worker_rehydrates_after_memory_cache_loss(self):
        task_id = "canvas_img_worker_rehydrate_123456789"
        self._record(task_id, "online-image")
        payload = main.OnlineImageRequest(prompt="测试", provider_id="test-only")
        called = 0

        async def fake_generate(_payload):
            nonlocal called
            called += 1
            return {"images": ["/assets/output/recovered.png"]}

        with patch.object(main, "build_online_image_result", side_effect=fake_generate):
            # worker 只拿到编号和 payload；模拟同进程缓存被清空后再启动。
            await main._run_canvas_image_task(task_id, payload)

        self.assertEqual(called, 1)
        saved = json.loads(Path(self.temp.name, f"{task_id}.json").read_text(encoding="utf-8"))
        self.assertEqual(saved["status"], "succeeded")
        self.assertEqual(saved["result"]["images"], ["/assets/output/recovered.png"])

    async def test_comfy_worker_rehydrates_after_memory_cache_loss(self):
        task_id = "canvas_comfy_worker_rehydrate_123456789"
        self._record(task_id, "comfy")
        payload = main.GenerateRequest(prompt="测试", workflow_json="test-only.json")

        with patch.object(main, "generate", return_value={"images": ["/assets/output/recovered.png"]}) as generate:
            await main._run_canvas_comfy_task(task_id, payload)

        generate.assert_called_once()
        saved = json.loads(Path(self.temp.name, f"{task_id}.json").read_text(encoding="utf-8"))
        self.assertEqual(saved["status"], "succeeded")

    async def test_worker_does_not_submit_when_running_state_cannot_be_persisted(self):
        task_id = "canvas_img_worker_write_fail_123456789"
        task = self._record(task_id, "online-image")
        main.CANVAS_TASKS[task_id] = task
        payload = main.OnlineImageRequest(prompt="测试", provider_id="test-only")
        writes = []

        def fail_running_write(value, *, required=False):
            writes.append(bool(required))
            if required and len(writes) == 1:
                raise OSError("模拟磁盘占用")
            return True

        with patch.object(main, "_write_canvas_task_record", side_effect=fail_running_write), patch.object(
            main, "build_online_image_result", side_effect=AssertionError("运行态未落盘时不得提交")
        ):
            await main._run_canvas_image_task(task_id, payload)

        self.assertEqual(writes, [True, False])
        self.assertEqual(main.CANVAS_TASKS[task_id]["status"], "failed")
        self.assertIn("运行状态无法保存", main.CANVAS_TASKS[task_id]["error"])


if __name__ == "__main__":
    unittest.main()
