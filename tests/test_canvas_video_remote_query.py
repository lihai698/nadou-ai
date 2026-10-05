"""RunningHub 视频远端编号落盘与单次查询的隔离回归。"""

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


class CanvasVideoRemoteQueryTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="canvas-video-rh-")
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

    def task(self, task_id="canvas_video_refresh_12345678", **extra):
        value = {
            "id": task_id,
            "task_id": task_id,
            "type": "video",
            "status": "unknown",
            "created_at": 1.0,
            "updated_at": 2.0,
            "process_id": "old-process",
            "provider_id": "runninghub",
            "model": "video-model",
            "result": None,
            "error": main.CANVAS_VIDEO_TASK_UNKNOWN,
            "remote": {
                "status": "unknown",
                "task_id": "rh-remote-123",
                "query_supported": True,
                "query_mode": "runninghub_openapi",
            },
        }
        value.update(extra)
        return value

    async def test_remote_accept_callback_persists_id_before_worker_finishes(self):
        task_id = "canvas_video_callback_12345678"
        started = asyncio.Event()
        release = asyncio.Event()

        async def fake_generate(_payload, _provider, on_remote_accept=None):
            await on_remote_accept("rh-accepted-42")
            started.set()
            await release.wait()
            raise main.HTTPException(status_code=504, detail="synthetic timeout")

        with patch.object(main, "get_api_provider", return_value={"id": "runninghub", "enabled": True}), patch.object(
            main, "is_runninghub_provider", return_value=True
        ), patch.object(main, "generate_runninghub_video", new=fake_generate):
            response = await self.client.post(
                "/api/canvas-video-tasks",
                json={
                    "client_task_id": task_id,
                    "provider_id": "runninghub",
                    "model": "video-model",
                    "prompt": "private prompt",
                },
            )
            self.assertEqual(response.status_code, 200)
            await asyncio.wait_for(started.wait(), timeout=1)
            record = json.loads(Path(main.canvas_video_task_path(task_id)).read_text(encoding="utf-8"))
            self.assertEqual(record["remote"]["task_id"], "rh-accepted-42")
            self.assertEqual(record["upstream_task_id"], "rh-accepted-42")
            self.assertNotIn("private prompt", json.dumps(record))
            release.set()

    async def test_refresh_completed_result_updates_local_record_without_raw(self):
        task_id = "canvas_video_refresh_done_12345678"
        main.write_canvas_video_task(self.task(task_id))
        observation = main.observe_remote_task(
            {"status": "COMPLETED", "task_id": "rh-remote-123", "videos": ["/output/safe.mp4"]},
            operation="query",
        )
        with patch.object(main, "get_api_provider_exact", return_value={"id": "runninghub"}), patch.object(
            main,
            "query_runninghub_video_task_once",
            new=AsyncMock(return_value=(observation, ["/output/safe.mp4"])),
        ):
            response = await self.client.post(f"/api/canvas-video-tasks/{task_id}/refresh")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "succeeded")
        self.assertEqual(body["result"], {"videos": ["/output/safe.mp4"], "task_id": "rh-remote-123"})
        self.assertNotIn("raw", json.dumps(body).lower())

    async def test_refresh_unknown_keeps_remote_id_and_never_resubmits(self):
        task_id = "canvas_video_refresh_unknown_123456"
        main.write_canvas_video_task(self.task(task_id))
        observation = main.observe_remote_task(operation="query", transport_error=True)
        with patch.object(main, "get_api_provider_exact", return_value={"id": "runninghub"}), patch.object(
            main,
            "query_runninghub_video_task_once",
            new=AsyncMock(return_value=(observation, [])),
        ), patch.object(main, "canvas_video", new=AsyncMock(side_effect=AssertionError("must not submit"))):
            response = await self.client.post(f"/api/canvas-video-tasks/{task_id}/refresh")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "unknown")
        self.assertEqual(body["remote"]["task_id"], "rh-remote-123")
        self.assertTrue(body["remote"]["query_supported"])

    async def test_refresh_without_remote_id_returns_conflict(self):
        task_id = "canvas_video_refresh_noid_1234567"
        record = self.task(task_id)
        record["remote"] = {"status": "unknown", "task_id": "", "query_supported": True}
        record.pop("upstream_task_id", None)
        main.write_canvas_video_task(record)
        response = await self.client.post(f"/api/canvas-video-tasks/{task_id}/refresh")
        self.assertEqual(response.status_code, 409)
        self.assertIn("远端任务编号", response.json()["detail"])

    def test_public_task_whitelist_drops_legacy_prompt_and_raw(self):
        public = main.public_canvas_video_task(
            {
                "id": "canvas_video_legacy_12345678",
                "task_id": "canvas_video_legacy_12345678",
                "status": "unknown",
                "prompt": "private prompt",
                "raw": {"token": "private-token"},
                "input_summary": {
                    "prompt_length": 13,
                    "provider_id": "runninghub",
                    "model": "video-model",
                    "prompt": "private prompt",
                    "reference_urls": ["https://signed.example/input.png"],
                    "raw": {"token": "private-token"},
                },
                "result": {"videos": ["https://signed.example/video.mp4"], "raw": {"debug": "x"}},
            }
        )
        self.assertNotIn("prompt", public)
        self.assertNotIn("raw", json.dumps(public).lower())
        self.assertEqual(public["result"], {"videos": []})
        self.assertEqual(
            public["input_summary"],
            {"prompt_length": 13, "provider_id": "runninghub", "model": "video-model"},
        )

    async def test_query_adapter_maps_runninghub_status_and_downloads_video(self):
        provider = {"id": "runninghub", "base_url": "https://rh.test", "api_key": "synthetic"}
        responses = [
            httpx.Response(
                200,
                json={"data": {"status": "3", "outputs": [{"fileUrl": "https://cdn.test/video.mp4"}]}},
                request=httpx.Request("POST", "https://rh.test/openapi/v2/query"),
            ),
        ]
        original_client = httpx.AsyncClient

        def factory(*_args, **_kwargs):
            transport = httpx.MockTransport(
                lambda request: responses.pop(0)
                if request.method == "POST"
                else httpx.Response(
                    200,
                    content=b"video",
                    headers={"content-type": "video/mp4"},
                    request=request,
                )
            )
            return original_client(transport=transport)

        with patch.object(main, "runninghub_json_headers", return_value={}), patch.object(
            main.httpx, "AsyncClient", side_effect=factory
        ), patch.object(main, "output_path_for", side_effect=lambda name, _category="output": str(Path(self.temp.name) / name)), patch.object(
            main, "output_url_for", side_effect=lambda name, _category="output": f"/output/{name}"
        ):
            observation, urls = await main.query_runninghub_video_task_once(provider, "rh-remote-123")
        self.assertEqual(observation.status, main.REMOTE_SUCCEEDED)
        self.assertEqual(observation.task_id, "rh-remote-123")
        self.assertEqual(len(urls), 1)
        self.assertTrue(urls[0].startswith("/output/"))

    async def test_refresh_dispatches_generic_get_query_without_resubmitting(self):
        task_id = "canvas_video_generic_refresh_123456"
        record = self.task(
            task_id,
            provider_id="comfly",
            model="veo3-fast",
            remote={
                "status": "unknown",
                "task_id": "generic-remote-1",
                "query_supported": True,
                "query_mode": "http_get",
            },
        )
        main.write_canvas_video_task(record)
        observation = main.observe_remote_task(
            {"status": "COMPLETED", "task_id": "generic-remote-1", "videos": ["/output/generic.mp4"]},
            operation="query",
        )
        with patch.object(
            main,
            "get_api_provider_exact",
            return_value={"id": "comfly", "protocol": "openai", "base_url": "https://api.test/v1"},
        ), patch.object(
            main,
            "query_video_task_once",
            new=AsyncMock(return_value=(observation, ["/output/generic.mp4"])),
        ), patch.object(main, "canvas_video", new=AsyncMock(side_effect=AssertionError("must not submit"))):
            response = await self.client.post(f"/api/canvas-video-tasks/{task_id}/refresh")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "succeeded")
        self.assertEqual(body["result"]["videos"], ["/output/generic.mp4"])

    async def test_generic_query_adapter_maps_completed_local_video(self):
        provider = {
            "id": "comfly",
            "protocol": "openai",
            "base_url": "https://api.test/v1",
            "api_key": "synthetic",
        }
        seen = []
        original_client = httpx.AsyncClient

        def factory(*_args, **_kwargs):
            transport = httpx.MockTransport(
                lambda request: (
                    seen.append(request)
                    or httpx.Response(
                        200,
                        json={"status": "COMPLETED", "id": "generic-remote-1", "videos": ["/output/generic.mp4"]},
                        request=request,
                    )
                )
            )
            return original_client(transport=transport)

        with patch.object(main, "api_headers", return_value={}), patch.object(
            main.httpx, "AsyncClient", side_effect=factory
        ):
            observation, urls = await main.query_video_task_once(
                provider,
                "generic-remote-1",
                query_mode="http_get",
            )
        self.assertEqual(observation.status, main.REMOTE_SUCCEEDED)
        self.assertEqual(urls, ["/output/generic.mp4"])
        self.assertEqual(len(seen), 1)
        self.assertIn("/v1/videos/generations/generic-remote-1", str(seen[0].url))

    async def test_generic_remote_accept_persists_query_metadata(self):
        task_id = "canvas_video_generic_accept_123456"
        record = self.task(task_id, process_id=main.CANVAS_VIDEO_TASK_PROCESS_ID, provider_id="comfly")
        main.write_canvas_video_task(record)
        await main.persist_canvas_video_remote_accept(
            task_id,
            "generic-remote-2",
            query_supported=True,
            query_mode="http_get",
        )
        saved = json.loads(Path(main.canvas_video_task_path(task_id)).read_text(encoding="utf-8"))
        self.assertEqual(saved["remote"]["task_id"], "generic-remote-2")
        self.assertEqual(saved["remote"]["query_mode"], "http_get")
        self.assertTrue(saved["remote"]["query_supported"])


if __name__ == "__main__":
    unittest.main()
