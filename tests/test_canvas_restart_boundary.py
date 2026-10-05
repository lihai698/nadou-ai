"""Check the real canvas task route across separate Python processes.

The generator is held in memory and never calls a provider. Each probe imports
the app in a fresh process without running startup migrations or a live server.
"""

import asyncio
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import threading
import tempfile
import unittest
from unittest.mock import patch


HERE = Path(__file__).resolve().parent
PROJECT = HERE.parent
sys.path.insert(0, str(PROJECT))


async def probe_submit():
    import httpx
    import main

    started = asyncio.Event()

    async def held_generator(_payload):
        started.set()
        await asyncio.Event().wait()

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app), base_url="http://isolated"
    ) as client:
        with patch.object(main, "build_online_image_result", side_effect=held_generator):
            submitted = await client.post(
                "/api/canvas-image-tasks",
                json={"prompt": "重启边界隔离测试", "provider_id": "test-only"},
            )
            await asyncio.wait_for(started.wait(), 3)
            task_id = submitted.json()["task_id"]
            running = await client.get(f"/api/canvas-image-tasks/{task_id}")
            print(json.dumps({
                "pid": os.getpid(),
                "submit_status": submitted.status_code,
                "task_id": task_id,
                "task_status": running.json()["status"],
            }))


async def probe_query(task_id):
    import httpx
    import main

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app), base_url="http://isolated"
    ) as client:
        result = await client.get(f"/api/canvas-image-tasks/{task_id}")
        body = result.json()
        print(json.dumps({
            "pid": os.getpid(),
            "http_status": result.status_code,
            "detail": body.get("detail", ""),
            "task_status": body.get("status", ""),
        }))


async def probe_submit_comfy():
    import httpx
    import main

    started = threading.Event()

    def held_generator(_payload):
        started.set()
        threading.Event().wait()

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app), base_url="http://isolated"
    ) as client:
        with patch.object(main, "generate", side_effect=held_generator):
            submitted = await client.post(
                "/api/canvas-comfy-tasks",
                json={"prompt": "隔离 ComfyUI 重启测试", "workflow_json": "test-only.json"},
            )
            if not await asyncio.to_thread(started.wait, 3):
                raise RuntimeError("ComfyUI task did not enter running state")
            task_id = submitted.json()["task_id"]
            running = await client.get(f"/api/canvas-comfy-tasks/{task_id}")
            print(json.dumps({
                "pid": os.getpid(), "submit_status": submitted.status_code,
                "task_id": task_id, "task_status": running.json()["status"],
            }), flush=True)
            # End the process while the controlled worker is still running.
            os._exit(0)


async def probe_query_comfy(task_id):
    import httpx
    import main

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app), base_url="http://isolated"
    ) as client:
        result = await client.get(f"/api/canvas-comfy-tasks/{task_id}")
        body = result.json()
        print(json.dumps({
            "pid": os.getpid(), "http_status": result.status_code,
            "detail": body.get("detail", ""),
            "task_status": body.get("status", ""),
        }))


class CanvasRestartBoundaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.task_dir = tempfile.TemporaryDirectory()
        cls.previous_task_dir = os.environ.get("NADOU_CANVAS_TASK_DIR")
        os.environ["NADOU_CANVAS_TASK_DIR"] = cls.task_dir.name

    @classmethod
    def tearDownClass(cls):
        if cls.previous_task_dir is None:
            os.environ.pop("NADOU_CANVAS_TASK_DIR", None)
        else:
            os.environ["NADOU_CANVAS_TASK_DIR"] = cls.previous_task_dir
        cls.task_dir.cleanup()

    def run_probe(self, mode, task_id=None):
        command = [sys.executable, str(Path(__file__).resolve()), mode]
        if task_id:
            command.append(task_id)
        process = subprocess.run(
            command, cwd=PROJECT, capture_output=True, text=True,
            encoding="utf-8", errors="replace", timeout=20,
        )
        self.assertEqual(process.returncode, 0, process.stdout + process.stderr)
        return json.loads(process.stdout.strip().splitlines()[-1])

    def test_accepted_image_task_becomes_unknown_in_fresh_process(self):
        before = self.run_probe("probe-submit")
        self.assertEqual(before["submit_status"], 200)
        self.assertEqual(before["task_status"], "running")
        after = self.run_probe("probe-query", before["task_id"])
        self.assertNotEqual(before["pid"], after["pid"])
        self.assertEqual(after["http_status"], 200)
        self.assertEqual(after["task_status"], "unknown")

    def test_smart_canvas_handles_restart_response_without_resubmitting(self):
        node = os.environ.get("NODE_BINARY") or shutil.which("node")
        self.assertTrue(node, "智能画布重启测试需要 Node.js 18+ 或 NODE_BINARY。")
        result = subprocess.run(
            [node, str(HERE / "smart_canvas_restart_boundary.test.cjs")],
            cwd=PROJECT, capture_output=True, text=True,
            encoding="utf-8", errors="replace", timeout=20,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_accepted_comfy_task_becomes_unknown_in_fresh_process(self):
        before = self.run_probe("probe-submit-comfy")
        self.assertEqual(before["submit_status"], 200)
        self.assertEqual(before["task_status"], "running")
        after = self.run_probe("probe-query-comfy", before["task_id"])
        self.assertNotEqual(before["pid"], after["pid"])
        self.assertEqual(after["http_status"], 200)
        self.assertEqual(after["task_status"], "unknown")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "probe-submit":
        asyncio.run(probe_submit())
    elif len(sys.argv) > 2 and sys.argv[1] == "probe-query":
        asyncio.run(probe_query(sys.argv[2]))
    elif len(sys.argv) > 1 and sys.argv[1] == "probe-submit-comfy":
        asyncio.run(probe_submit_comfy())
    elif len(sys.argv) > 2 and sys.argv[1] == "probe-query-comfy":
        asyncio.run(probe_query_comfy(sys.argv[2]))
    else:
        unittest.main()
