"""视频任务同编号跨进程提交和状态写回的隔离回归。"""

import asyncio
import json
import multiprocessing
import os
import queue
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main


def _submit_probe(root, task_id, ready, start, release, calls, results):
    async def run():
        import main as child_main

        async def fake_generate(_payload):
            calls.put(os.getpid())
            if not await asyncio.to_thread(release.wait, 12):
                raise RuntimeError("隔离供应商未收到释放信号")
            return {"videos": ["/output/isolation.mp4"], "task_id": "remote-isolation-1"}

        with patch.object(child_main, "CANVAS_VIDEO_TASK_DIR", root), patch.object(
            child_main, "CANVAS_VIDEO_TASK_VOLATILE", {}
        ), patch.object(child_main, "canvas_video", new=fake_generate):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=child_main.app), base_url="http://isolated"
            ) as client:
                ready.put(os.getpid())
                if not await asyncio.to_thread(start.wait, 12):
                    raise RuntimeError("隔离提交未收到开始信号")
                response = await client.post(
                    "/api/canvas-video-tasks",
                    json={
                        "client_task_id": task_id,
                        "prompt": "自制隔离提示，不发送供应商",
                        "provider_id": "test-only",
                    },
                )
                results.put(("post", os.getpid(), response.status_code, response.json()))
                if not await asyncio.to_thread(release.wait, 12):
                    raise RuntimeError("隔离任务未收到释放信号")
                for _ in range(200):
                    found = await client.get(f"/api/canvas-video-tasks/{task_id}")
                    if found.status_code == 200 and found.json().get("status") == "succeeded":
                        results.put(("final", os.getpid(), found.status_code, found.json()))
                        return
                    await asyncio.sleep(0.02)
                raise RuntimeError("隔离任务未写入成功状态")

    try:
        asyncio.run(run())
    except BaseException as exc:
        results.put(("error", os.getpid(), type(exc).__name__, str(exc)[:200]))


def _get_probe(root, task_id, results):
    async def run():
        import main as child_main

        with patch.object(child_main, "CANVAS_VIDEO_TASK_DIR", root), patch.object(
            child_main, "CANVAS_VIDEO_TASK_VOLATILE", {}
        ):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=child_main.app), base_url="http://isolated"
            ) as client:
                response = await client.get(f"/api/canvas-video-tasks/{task_id}")
                results.put((response.status_code, response.json()))

    try:
        asyncio.run(run())
    except BaseException as exc:
        results.put((type(exc).__name__, str(exc)[:200]))


class CanvasVideoCrossProcessTests(unittest.TestCase):
    def test_same_id_submits_once_and_foreign_get_keeps_owner_running(self):
        context = multiprocessing.get_context("spawn")
        with tempfile.TemporaryDirectory(prefix="canvas-video-process-") as root:
            task_id = "canvas_video_cross_process_12345678"
            ready = context.Queue()
            start = context.Event()
            release = context.Event()
            calls = context.Queue()
            results = context.Queue()
            submitters = [
                context.Process(
                    target=_submit_probe,
                    args=(root, task_id, ready, start, release, calls, results),
                )
                for _ in range(2)
            ]
            getter = None
            try:
                for process in submitters:
                    process.start()
                self.assertNotEqual(ready.get(timeout=15), ready.get(timeout=15))
                start.set()
                posted = [results.get(timeout=12) for _ in range(2)]
                self.assertTrue(all(item[0] == "post" and item[2] == 200 for item in posted), posted)
                self.assertEqual({item[3]["id"] for item in posted}, {task_id})
                self.assertIsInstance(calls.get(timeout=12), int)
                with self.assertRaises(queue.Empty):
                    calls.get(timeout=0.3)
                record_path = Path(root) / f"{task_id}.json"
                self.assertEqual(json.loads(record_path.read_text(encoding="utf-8"))["status"], "running")

                observed = context.Queue()
                getter = context.Process(target=_get_probe, args=(root, task_id, observed))
                getter.start()
                status_code, body = observed.get(timeout=12)
                getter.join(5)
                self.assertEqual(getter.exitcode, 0)
                self.assertEqual(status_code, 200)
                self.assertEqual(body["status"], "unknown")
                self.assertEqual(json.loads(record_path.read_text(encoding="utf-8"))["status"], "running")

                release.set()
                finished = [results.get(timeout=12) for _ in range(2)]
                self.assertTrue(all(item[0] == "final" and item[3]["status"] == "succeeded" for item in finished), finished)
                self.assertEqual(json.loads(record_path.read_text(encoding="utf-8"))["status"], "succeeded")
                with self.assertRaises(queue.Empty):
                    calls.get(timeout=0.2)
            finally:
                start.set()
                release.set()
                for process in [*submitters, getter]:
                    if process is None:
                        continue
                    process.join(5)
                    if process.is_alive():
                        process.terminate()
                        process.join(2)
            self.assertTrue(all(process.exitcode == 0 for process in submitters))


class CanvasVideoRefreshCoordinationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="canvas-video-refresh-lock-")
        self.addCleanup(self.temp.cleanup)
        self.dir_patch = patch.object(main, "CANVAS_VIDEO_TASK_DIR", self.temp.name)
        self.dir_patch.start()
        self.addCleanup(self.dir_patch.stop)
        self.cache_patch = patch.object(main, "CANVAS_VIDEO_TASK_VOLATILE", {})
        self.cache_patch.start()
        self.addCleanup(self.cache_patch.stop)
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app), base_url="http://isolated"
        )
        self.addAsyncCleanup(self.client.aclose)
        self.task_id = "canvas_video_refresh_lock_12345678"

    def save_running(self):
        main.write_canvas_video_task({
            "id": self.task_id,
            "task_id": self.task_id,
            "type": "video",
            "status": "running",
            "created_at": 1.0,
            "updated_at": 2.0,
            "process_id": "other-live-process",
            "provider_id": "runninghub",
            "model": "test-video",
            "result": None,
            "error": "",
            "remote": {
                "status": "pending",
                "task_id": "remote-isolation-1",
                "query_supported": True,
                "query_mode": "runninghub_openapi",
            },
        })

    async def test_unknown_refresh_does_not_overwrite_foreign_running_record(self):
        self.save_running()
        unknown = main.observe_remote_task(operation="query", transport_error=True)
        with patch.object(main, "get_api_provider_exact", return_value={"id": "runninghub"}), patch.object(
            main, "query_runninghub_video_task_once", new=AsyncMock(return_value=(unknown, []))
        ):
            response = await self.client.post(f"/api/canvas-video-tasks/{self.task_id}/refresh")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "unknown")
        self.assertEqual(main.read_canvas_video_task(self.task_id)["status"], "running")

    async def test_refresh_reloads_terminal_record_after_remote_await(self):
        self.save_running()

        def finish_from_another_owner():
            with main.canvas_video_task_record_lock(self.task_id):
                latest = main.read_canvas_video_task(self.task_id)
                main.write_canvas_video_task({
                    **latest,
                    "status": "succeeded",
                    "result": {"videos": ["/output/owner.mp4"], "task_id": "remote-isolation-1"},
                    "updated_at": 3.0,
                })

        async def fake_query(_provider, _remote_id):
            await asyncio.to_thread(finish_from_another_owner)
            return main.observe_remote_task(operation="query", transport_error=True), []

        with patch.object(main, "get_api_provider_exact", return_value={"id": "runninghub"}), patch.object(
            main, "query_runninghub_video_task_once", new=fake_query
        ):
            response = await self.client.post(f"/api/canvas-video-tasks/{self.task_id}/refresh")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "succeeded")
        self.assertEqual(response.json()["result"]["videos"], ["/output/owner.mp4"])
        self.assertEqual(main.read_canvas_video_task(self.task_id)["status"], "succeeded")

    async def test_lock_failure_returns_503_without_supplier_submission(self):
        with patch.object(main, "task_records_lock", side_effect=TimeoutError("synthetic lock timeout")), patch.object(
            main, "canvas_video", new=AsyncMock()
        ) as generate:
            response = await self.client.post(
                "/api/canvas-video-tasks",
                json={
                    "client_task_id": self.task_id,
                    "provider_id": "test-only",
                    "prompt": "自制隔离提示",
                },
            )
        self.assertEqual(response.status_code, 503)
        self.assertIn("未提交", response.json()["detail"])
        self.assertFalse(Path(main.canvas_video_task_path(self.task_id)).exists())
        generate.assert_not_called()

    async def test_worker_lock_failure_stops_before_supplier_and_reports_local_failure(self):
        main.write_canvas_video_task({
            "id": self.task_id,
            "task_id": self.task_id,
            "type": "video",
            "status": "queued",
            "created_at": 1.0,
            "updated_at": 1.0,
            "process_id": main.CANVAS_VIDEO_TASK_PROCESS_ID,
            "result": None,
            "error": "",
        })
        payload = main.CanvasVideoTaskRequest(
            client_task_id=self.task_id,
            provider_id="test-only",
            prompt="自制隔离提示",
        )
        with patch.object(main, "task_records_lock", side_effect=TimeoutError("synthetic lock timeout")), patch.object(
            main, "canvas_video", new=AsyncMock()
        ) as generate:
            await main.run_canvas_video_task(self.task_id, payload)
        generate.assert_not_called()
        self.assertEqual(main.read_canvas_video_task(self.task_id)["status"], "queued")
        response = await self.client.get(f"/api/canvas-video-tasks/{self.task_id}")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "failed")
        self.assertIn("未提交", response.json()["error"])

    async def test_volatile_completion_blocks_resubmission_when_disk_result_is_missing(self):
        cached = {
            "id": self.task_id,
            "task_id": self.task_id,
            "type": "video",
            "status": "succeeded",
            "created_at": 1.0,
            "updated_at": 2.0,
            "process_id": main.CANVAS_VIDEO_TASK_PROCESS_ID,
            "provider_id": "test-only",
            "result": {"videos": ["/output/cached.mp4"], "task_id": "remote-cached"},
            "error": "",
        }
        main.CANVAS_VIDEO_TASK_VOLATILE[self.task_id] = cached
        path = Path(main.canvas_video_task_path(self.task_id))
        if path.exists():
            path.unlink()
        with patch.object(main, "canvas_video", new=AsyncMock(side_effect=AssertionError("must not resubmit"))):
            first = await self.client.get(f"/api/canvas-video-tasks/{self.task_id}")
            duplicate = await self.client.post(
                "/api/canvas-video-tasks",
                json={
                    "client_task_id": self.task_id,
                    "provider_id": "test-only",
                    "prompt": "自制隔离提示",
                },
            )
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json()["status"], "succeeded")
        self.assertEqual(duplicate.status_code, 200)
        self.assertEqual(duplicate.json()["status"], "succeeded")
        self.assertFalse(path.exists())


if __name__ == "__main__":
    unittest.main()
