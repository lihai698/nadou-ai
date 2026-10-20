"""视频执行拆分的公开入口回归；仅使用模拟 HTTP 和临时输出目录。"""
import base64
import json
from pathlib import Path
import tempfile
import unittest
import sys
from unittest.mock import AsyncMock, patch

import httpx
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main


class VideoExecutionTests(unittest.IsolatedAsyncioTestCase):
    def payload(self, **values):
        return main.CanvasVideoRequest(prompt="demo", model="veo3.1-fast", **values)

    def test_nested_video_urls_preserve_order_and_deduplicate(self):
        raw = {"data": [{"result": {"outputs": [{"url": "https://cdn.test/a.mp4"}]}}],
               "detail": {"videos": ["/output/b.webm", "https://cdn.test/a.mp4"]},
               "content": [{"video_url": "/assets/c.mp4"}], "url": "file:///private.mp4"}
        self.assertEqual(main.video_output_urls(raw),
                         ["/assets/c.mp4", "/output/b.webm", "https://cdn.test/a.mp4"])
        self.assertEqual(main.video_output_urls([]), [])

    def test_public_result_bounds_and_whitelist(self):
        raw = {"videos": [f"/output/{i}.mp4" for i in range(40)], "task_id": "x" * 300,
               "raw": {"debug": "private"}, "status_code": 600, "jimeng_pending": 1}
        result = main.public_video_generation_result(raw)
        self.assertEqual(len(result["videos"]), 32)
        self.assertEqual(len(result["task_id"]), 240)
        self.assertTrue(result["jimeng_pending"])
        self.assertNotIn("raw", result)
        self.assertNotIn("status_code", result)

    def test_agnes_dimensions_and_frames(self):
        self.assertEqual(main.agnes_video_dimensions("9:16", "1080p"), (976, 1728))
        self.assertEqual(main.agnes_video_frame_count("bad"), (121, 24))
        count, fps = main.agnes_video_frame_count(99, 99)
        self.assertEqual((count, fps), (441, 60))

    async def test_agnes_keeps_video_id_and_fallback_query_without_resubmit(self):
        seen = []
        def respond(request):
            seen.append((request.method, request.url.path))
            if request.method == "POST":
                return httpx.Response(200, json={"video_id": "video/42"})
            if request.url.path == "/agnesapi":
                return httpx.Response(404)
            return httpx.Response(200, json={"status": "SUCCESS", "videos": ["https://cdn.test/v.mp4"]})
        accepted = AsyncMock()
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            with patch.object(main, "api_headers", return_value={}), patch.object(
                main, "_notify_canvas_video_remote_accept", accepted
            ), patch.object(main.asyncio, "sleep", new=AsyncMock()), patch.object(
                main, "save_remote_video_to_output", new=AsyncMock(return_value="/output/v.mp4")
            ):
                result = await main.generate_agnes_video(client, self.payload(),
                    {"id": "agnes", "base_url": "https://agnes.test"}, "https://agnes.test", "wan")
        self.assertEqual(result["task_id"], "video/42")
        self.assertEqual(result["video_id"], "video/42")
        self.assertEqual([method for method, _ in seen], ["POST", "GET", "GET"])
        accepted.assert_awaited_once_with("video/42", query_mode="agnes_http_get")

    async def test_agnes_failure_and_timeout_notify_original_id(self):
        async with httpx.AsyncClient(transport=httpx.MockTransport(
            lambda request: httpx.Response(200, json={"status": "FAILED", "error": "SAFETY"})
        )) as client:
            with patch.object(main, "api_headers", return_value={}), patch.object(
                main.asyncio, "sleep", new=AsyncMock()
            ), patch.object(main, "_notify_canvas_video_remote_accept", new=AsyncMock()) as notify:
                with self.assertRaises(main.HTTPException) as caught:
                    await main.wait_for_agnes_video_task(client, {"base_url": "https://agnes.test"}, "original", "wan")
                self.assertEqual(caught.exception.status_code, 502)
                self.assertIn("安全", caught.exception.detail)
                notify.assert_awaited_once_with("original", query_mode="agnes_http_get")
            with patch.object(main, "VIDEO_POLL_TIMEOUT", 0), patch.object(
                main, "_notify_canvas_video_remote_accept", new=AsyncMock()
            ) as notify:
                with self.assertRaises(main.HTTPException) as caught:
                    await main.wait_for_agnes_video_task(client, {"base_url": "https://agnes.test"}, "original", "wan")
                self.assertEqual(caught.exception.status_code, 504)
                notify.assert_awaited_once()

    async def multipart_result(self, generate, refs):
        seen = []
        def respond(request):
            seen.append(request)
            return httpx.Response(200, json={"id": "original-42", "status": "queued"})
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            with patch.object(main, "api_headers", return_value={}), patch.object(
                main, "yuli_fetch_reference_bytes", new=AsyncMock(return_value=("ref.png", b"image", "image/png"))
            ), patch.object(main, "wait_for_video_task", new=AsyncMock(return_value={
                "videos": ["https://cdn.test/video.mp4"]
            })) as wait, patch.object(main, "save_remote_video_to_output", new=AsyncMock(return_value="/output/video.mp4")):
                result = await generate(client, self.payload(images=refs, duration=8, aspect_ratio="9:16"),
                                        {"id": "provider"}, "https://api.test", "veo3.1-fast-4k")
                wait.assert_awaited_once_with(client, {"id": "provider"}, "original-42", "https://api.test/v1/videos")
        self.assertEqual(result["task_id"], "original-42")
        self.assertEqual(result["videos"], ["/output/video.mp4"])
        self.assertEqual(len(seen), 1)
        self.assertIn("multipart/form-data", seen[0].headers["content-type"])
        return seen[0].content

    async def test_lingjing_multipart_multiple_references(self):
        body = await self.multipart_result(main.generate_lingjing_openai_video,
                                          [{"url": f"/output/{i}.png"} for i in range(4)])
        self.assertEqual(body.count(b'name="input_reference"'), 3)
        self.assertIn(b"veo_3_1-fast-4K", body)
        self.assertIn(b"9x16", body)

    async def test_yuli_multipart_single_reference(self):
        body = await self.multipart_result(main.generate_yuli_openai_video,
                                          [{"url": f"/output/{i}.png"} for i in range(3)])
        self.assertEqual(body.count(b'name="input_reference"'), 1)

    async def test_text_only_still_uses_multipart(self):
        for generate in (main.generate_lingjing_openai_video, main.generate_yuli_openai_video):
            body = await self.multipart_result(generate, [])
            self.assertNotIn(b'name="input_reference"', body)
            self.assertIn(b'name="seconds"', body)

    async def test_non_json_response_remains_error(self):
        for generate in (main.generate_lingjing_openai_video, main.generate_yuli_openai_video):
            async with httpx.AsyncClient(transport=httpx.MockTransport(
                lambda request: httpx.Response(200, text="<html>not json</html>")
            )) as client:
                with patch.object(main, "api_headers", return_value={}), self.assertRaises(main.HTTPException) as caught:
                    await generate(client, self.payload(), {"id": "provider"}, "https://api.test", "veo31")
            self.assertEqual(caught.exception.status_code, 502)
            self.assertIn("非 JSON", caught.exception.detail)

    async def test_reference_bytes_data_local_and_http_failure(self):
        encoded = base64.b64encode(b"self-made").decode()
        self.assertEqual(await main.yuli_fetch_reference_bytes(None, f"data:image/png;base64,{encoded}"),
                         ("input_reference.png", b"self-made", "image/png"))
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "sample.webp"
            path.write_bytes(b"self-made")
            with patch.object(main, "output_file_from_url", return_value=str(path)):
                self.assertEqual(await main.yuli_fetch_reference_bytes(None, "/output/sample.webp"),
                                 ("sample.webp", b"self-made", "image/webp"))
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(404))) as client:
            with patch.object(main, "output_file_from_url", return_value=None):
                self.assertIsNone(await main.yuli_fetch_reference_bytes(client, "https://cdn.test/no.png"))

    async def test_video_bytes_empty_and_extension(self):
        with self.assertRaises(main.HTTPException):
            await main.save_video_bytes_to_output(b"")
        with tempfile.TemporaryDirectory() as tmp, patch.object(
            main, "output_path_for", side_effect=lambda name, category: str(Path(tmp) / name)
        ), patch.object(main, "output_url_for", side_effect=lambda name, category: "/output/" + name):
            url = await main.save_video_bytes_to_output(b"self-made-video", ext=".invalid")
            self.assertTrue(url.endswith(".mp4"))
            self.assertEqual((Path(tmp) / url.split("/")[-1]).read_bytes(), b"self-made-video")

    async def test_tudou_content_uses_original_id_and_mime(self):
        seen = []
        def respond(request):
            seen.append(request)
            return httpx.Response(200, content=b"video", headers={"content-type": "video/webm"})
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            with patch.object(main, "api_headers", return_value={}), patch.object(
                main, "save_video_bytes_to_output", new=AsyncMock(return_value="/output/v.webm")
            ) as save:
                self.assertEqual(await main.download_tudou_grok_video_content(
                    client, {"id": "tudou"}, "https://api.test", "original/42"), "/output/v.webm")
                save.assert_awaited_once_with(b"video", prefix="tudou_grok_video_", ext=".webm")
        self.assertEqual(seen[0].method, "GET")
        self.assertIn("original%2F42/content", str(seen[0].url))

    async def runninghub_query(self, raw, store):
        client_type = httpx.AsyncClient
        requests = []
        def respond(request):
            requests.append(request)
            return httpx.Response(200, json=raw)
        def factory(**kwargs):
            return client_type(transport=httpx.MockTransport(respond))
        with patch.object(main.httpx, "AsyncClient", side_effect=factory), patch.object(
            main, "runninghub_openapi_url", return_value="https://rh.test/query"
        ), patch.object(main, "runninghub_json_headers", return_value={}), patch.object(
            main, "runninghub_store_remote_output", store
        ):
            result = await main.query_runninghub_video_task_once({"id": "runninghub"}, "original-42")
        self.assertEqual(len(requests), 1)
        self.assertEqual(json.loads(requests[0].content), {"taskId": "original-42"})
        return result

    async def test_runninghub_failure_wins_over_outputs(self):
        store = AsyncMock()
        observation, urls = await self.runninghub_query(
            {"data": {"status": "4", "outputs": [{"fileUrl": "https://cdn.test/v.mp4"}]}}, store)
        self.assertEqual(observation.status, main.REMOTE_FAILED)
        self.assertEqual(observation.task_id, "original-42")
        self.assertEqual(urls, [])
        store.assert_not_awaited()

    async def test_runninghub_download_failure_is_unknown(self):
        for store in (AsyncMock(return_value="https://cdn.test/v.mp4"), AsyncMock(side_effect=OSError("disk failure"))):
            observation, urls = await self.runninghub_query(
                {"data": {"status": "3", "outputs": [{"fileUrl": "https://cdn.test/v.mp4"}]}}, store)
            self.assertEqual(observation.status, main.REMOTE_UNKNOWN)
            # 通信错误观察不携带任务编号；原编号由上层持久化记录继续保留。
            self.assertEqual(observation.task_id, "")
            self.assertEqual(urls, [])

    async def test_runninghub_success_without_output_stays_unknown(self):
        observation, urls = await self.runninghub_query({"data": {"status": "3"}}, AsyncMock())
        self.assertEqual(observation.status, main.REMOTE_UNKNOWN)
        self.assertEqual(observation.task_id, "original-42")
        self.assertEqual(urls, [])


if __name__ == "__main__":
    unittest.main()
