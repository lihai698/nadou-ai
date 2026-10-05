"""即梦 CLI 视频受理编号、续查和画布刷新入口的隔离回归。

测试只使用模拟 CLI/查询结果，不调用真实 dreamina、供应商或用户配置。
"""

import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx

import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main


class JimengVideoQueryTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="canvas-video-jimeng-")
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

    def task(self, task_id="canvas_video_jimeng_refresh_123456"):
        return {
            "id": task_id,
            "task_id": task_id,
            "type": "video",
            "status": "unknown",
            "created_at": 1.0,
            "updated_at": 2.0,
            "process_id": "old-process",
            "provider_id": "jimeng",
            "model": "seedance2.0",
            "result": None,
            "error": main.CANVAS_VIDEO_TASK_UNKNOWN,
            "remote": {
                "status": "unknown",
                "task_id": "jimeng-remote-123",
                "query_supported": True,
                "query_mode": "jimeng_cli",
            },
        }

    async def test_extracts_submit_id_and_query_result_uses_video_cli_arguments(self):
        raw = main.jimeng_extract_json(
            "warning: polling\n"
            '{"data":{"submitId":"jimeng-remote-1","gen_status":"pending"}}'
        )
        self.assertEqual(main.jimeng_submit_id(raw), "jimeng-remote-1")
        with patch.object(
            main,
            "run_jimeng_cli",
            new=AsyncMock(return_value={"gen_status": "pending"}),
        ) as run:
            result = await main.jimeng_query_result("jimeng-remote-1", "video")
        self.assertEqual(result["gen_status"], "pending")
        args = run.await_args.args[0]
        self.assertEqual(args[0], "query_result")
        self.assertIn("--submit_id=jimeng-remote-1", args)
        self.assertTrue(any(str(arg).startswith("--download_dir=") for arg in args))

    async def test_jimeng_video_persists_remote_acceptance_before_media_poll(self):
        accepted = []
        store_called = asyncio.Event()

        async def on_accept(remote_id, **meta):
            accepted.append((remote_id, meta))

        async def store_outputs(_raw, _kind):
            # The callback must run before jimeng_store_outputs starts its
            # potentially long query_result path.
            self.assertEqual(len(accepted), 1)
            self.assertEqual(accepted[0][0], "jimeng-remote-1")
            self.assertTrue(accepted[0][1]["query_supported"])
            self.assertEqual(accepted[0][1]["query_mode"], "jimeng_cli")
            store_called.set()
            return ["/output/jimeng.mp4"]

        payload = main.CanvasVideoRequest(
            prompt="synthetic video",
            provider_id="jimeng",
            model="seedance2.0",
            duration=5,
        )
        token = main.CANVAS_VIDEO_REMOTE_ACCEPT_CALLBACK.set(on_accept)
        try:
            with patch.object(
                main,
                "run_jimeng_cli",
                new=AsyncMock(
                    return_value={
                        "submit_id": "jimeng-remote-1",
                        "gen_status": "pending",
                    }
                ),
            ), patch.object(main, "jimeng_store_outputs", new=store_outputs):
                result = await main.generate_jimeng_video(payload, {"id": "jimeng"})
        finally:
            main.CANVAS_VIDEO_REMOTE_ACCEPT_CALLBACK.reset(token)
        self.assertTrue(store_called.is_set())
        self.assertEqual(result["task_id"], "jimeng-remote-1")
        self.assertEqual(result["videos"], ["/output/jimeng.mp4"])

    async def test_refresh_jimeng_cli_queries_once_without_resubmitting(self):
        task_id = "canvas_video_jimeng_done_123456"
        main.write_canvas_video_task(self.task(task_id))
        queried = {"gen_status": "success", "submit_id": "jimeng-remote-123"}
        with patch.object(
            main,
            "get_api_provider_exact",
            return_value={"id": "jimeng", "protocol": "jimeng"},
        ), patch.object(
            main,
            "jimeng_query_result",
            new=AsyncMock(return_value=queried),
        ) as query, patch.object(
            main,
            "jimeng_store_outputs",
            new=AsyncMock(return_value=["/output/jimeng-done.mp4"]),
        ) as store, patch.object(
            main,
            "canvas_video",
            new=AsyncMock(side_effect=AssertionError("refresh must not submit a new task")),
        ):
            response = await self.client.post(
                f"/api/canvas-video-tasks/{task_id}/refresh"
            )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "succeeded")
        self.assertEqual(
            body["result"],
            {"videos": ["/output/jimeng-done.mp4"], "task_id": "jimeng-remote-123"},
        )
        query.assert_awaited_once_with("jimeng-remote-123", "video")
        store.assert_awaited_once_with(queried, "video", allow_query=False)
        self.assertNotIn("raw", json.dumps(body).lower())

    async def test_refresh_jimeng_pending_keeps_remote_id_and_does_not_resubmit(self):
        task_id = "canvas_video_jimeng_pending_123456"
        main.write_canvas_video_task(self.task(task_id))
        pending = main.JimengPendingError(
            "jimeng-remote-123",
            kind="video",
            queue_info={"queue_idx": 2, "queue_length": 8},
        )
        with patch.object(
            main,
            "get_api_provider_exact",
            return_value={"id": "jimeng", "protocol": "jimeng"},
        ), patch.object(
            main,
            "jimeng_query_result",
            new=AsyncMock(return_value={"submit_id": "jimeng-remote-123", "gen_status": "pending"}),
        ), patch.object(
            main,
            "jimeng_store_outputs",
            new=AsyncMock(side_effect=pending),
        ), patch.object(
            main,
            "canvas_video",
            new=AsyncMock(side_effect=AssertionError("refresh must not submit a new task")),
        ):
            response = await self.client.post(
                f"/api/canvas-video-tasks/{task_id}/refresh"
            )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "unknown")
        self.assertEqual(body["remote"]["task_id"], "jimeng-remote-123")
        self.assertTrue(body["remote"]["query_supported"])
        self.assertEqual(body["remote"]["query_mode"], "jimeng_cli")

    async def test_explicit_failure_without_message_is_confirmed_failed(self):
        with patch.object(
            main,
            "jimeng_query_result",
            new=AsyncMock(
                return_value={"gen_status": "failed", "submit_id": "jimeng-remote-123"}
            ),
        ):
            observation, urls = await main.query_jimeng_video_task_once(
                "jimeng-remote-123"
            )
        self.assertEqual(observation.status, main.REMOTE_FAILED)
        self.assertEqual(observation.task_id, "jimeng-remote-123")
        self.assertEqual(urls, [])


if __name__ == "__main__":
    unittest.main()
