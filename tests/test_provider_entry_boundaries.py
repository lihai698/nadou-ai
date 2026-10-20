"""Exercise actual application entrypoints using synthetic suppliers and HTTP only."""
from contextlib import ExitStack, contextmanager
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

import httpx
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main


@contextmanager
def supplier(provider_id="custom"):
    provider = {"id": provider_id, "name": provider_id, "base_url": "https://provider.test/v1"}
    with ExitStack() as stack:
        stack.enter_context(patch.object(main, "get_api_provider", return_value=provider))
        stack.enter_context(patch.object(main, "provider_env_key_value", return_value="synthetic"))
        stack.enter_context(patch.object(main, "api_headers", return_value={}))
        for name in ("is_codex_provider", "is_gemini_cli_provider", "is_jimeng_provider",
                     "is_runninghub_provider", "is_volcengine_provider", "is_tudou_provider",
                     "is_apimart_provider", "is_agnes_provider", "is_lingjing_provider",
                     "is_yuli_provider", "is_tudou_async_image_mode", "is_tudou_grok_image_model"):
            stack.enter_context(patch.object(main, name, return_value=False))
        stack.enter_context(patch.object(main, "effective_protocol", return_value="openai"))
        yield provider, stack


@contextmanager
def mock_http(responder):
    client_type = httpx.AsyncClient
    requests = []
    def respond(request):
        requests.append(request)
        return responder(request, len(requests))
    with patch.object(main.httpx, "AsyncClient",
                      side_effect=lambda **kw: client_type(transport=httpx.MockTransport(respond))):
        yield requests


class ProviderEntryBoundaryTests(unittest.IsolatedAsyncioTestCase):
    async def test_image_supplier_dispatch_keeps_acceptance_callback(self):
        routes = [
            ("modelscope", None, "generate_modelscope_provider_image"),
            ("codex", "is_codex_provider", "generate_codex_provider_image"),
            ("gemini-cli", "is_gemini_cli_provider", "generate_gemini_cli_provider_image"),
            ("jimeng", "is_jimeng_provider", "generate_jimeng_provider_image"),
            ("runninghub", "is_runninghub_provider", "generate_runninghub_provider_image"),
            ("gemini", "effective_protocol", "generate_gemini_provider_image"),
            ("volcengine", "is_volcengine_provider", "generate_volcengine_provider_image"),
            ("tudou-async", "is_tudou_async_image_mode", "generate_tudou_async_image"),
            ("tudou-grok", "is_tudou_grok_image_model", "generate_tudou_grok_image"),
        ]
        accepted = AsyncMock()
        for route, predicate, execute in routes:
            with self.subTest(route=route), supplier(route) as (provider, stack):
                if predicate:
                    stack.enter_context(patch.object(main, predicate, return_value="gemini" if route == "gemini" else True))
                if route == "tudou-grok":
                    stack.enter_context(patch.object(main, "is_tudou_provider", return_value=True))
                runner = stack.enter_context(patch.object(main, execute, new=AsyncMock(return_value=("image", {}))))
                stack.enter_context(patch.object(main, "_generate_openai_image", new=AsyncMock(side_effect=AssertionError("wrong route"))))
                self.assertEqual(await main.generate_ai_image("demo", "1024x1024", "", "image", provider_id=route,
                                                              on_remote_accept=accepted), ("image", {}))
                runner.assert_awaited_once()
                if route in {"runninghub", "tudou-async"}:
                    self.assertIs(runner.call_args.kwargs["on_remote_accept"], accepted)

    async def test_openai_image_modes_use_actual_protocol_requests(self):
        for mode in ("openai-json", "openai-video-proxy", "openai-responses", "openai"):
            with self.subTest(mode=mode), supplier() as (_, stack):
                stack.enter_context(patch.object(main, "effective_image_request_mode", return_value=mode))
                stack.enter_context(patch.object(main, "responses_input_image_url", new=AsyncMock(return_value="https://cdn.test/ref.png")))
                stack.enter_context(patch.object(main, "reference_to_data_url", return_value="data:image/png;base64,AA=="))
                stack.enter_context(patch.object(main, "openai_video_proxy_local_image_path", return_value=None))
                stack.enter_context(patch.object(main, "openai_video_proxy_public_reference_url", new=AsyncMock(return_value="https://cdn.test/ref.png")))
                response = {"data": [{"url": "https://cdn.test/result.png"}]}
                with mock_http(lambda req, n: httpx.Response(200, json=response)) as requests:
                    image, raw = await main.generate_ai_image("demo", "1024x1024", "high", "image",
                        reference_images=[] if mode == "openai" else [{"url": "/output/ref.png"}])
                self.assertEqual(image["value"], "https://cdn.test/result.png")
                self.assertEqual(raw, response)
                self.assertEqual(len(requests), 1)
                body = json.loads(requests[0].content)
                self.assertEqual(body["model"], "image")
                if mode == "openai-json":
                    self.assertEqual(body["extra_body"]["image"], ["data:image/png;base64,AA=="])
                    self.assertNotIn("quality", body)
                elif mode == "openai-video-proxy":
                    self.assertEqual(requests[0].url.path, "/v1/videos")
                    self.assertEqual(body["images"], ["https://cdn.test/ref.png"])
                elif mode == "openai-responses":
                    self.assertEqual(requests[0].url.path, "/v1/responses")
                    self.assertEqual(body["tools"][0]["action"], "edit")
                    self.assertEqual(body["input"][0]["content"][-1]["type"], "input_image")
                else:
                    self.assertEqual(body["quality"], "high")

    async def test_image_async_acceptance_survives_poll_failure(self):
        accepted, wait = AsyncMock(), AsyncMock(side_effect=main.HTTPException(504, "synthetic timeout"))
        with supplier() as (_, stack):
            stack.enter_context(patch.object(main, "effective_image_request_mode", return_value="openai-json"))
            stack.enter_context(patch.object(main, "wait_for_image_task", wait))
            with mock_http(lambda req, n: httpx.Response(200, json={"task_id": "remote-image"})) as requests:
                with self.assertRaises(main.HTTPException) as caught:
                    await main.generate_ai_image("demo", "1024x1024", "", "image", on_remote_accept=accepted)
        self.assertEqual(len(requests), 1)
        accepted.assert_awaited_once_with("remote-image", query_mode="http_get")
        self.assertEqual(caught.exception.upstream_task_id, "remote-image")

    async def test_image_proxy_multipart_closes_files_on_failure(self):
        with tempfile.TemporaryDirectory() as tmp, supplier() as (_, stack):
            image_path = Path(tmp) / "reference.png"
            image_path.write_bytes(b"synthetic-image")
            stack.enter_context(patch.object(main, "effective_image_request_mode", return_value="openai-video-proxy"))
            stack.enter_context(patch.object(main, "openai_video_proxy_local_image_path", return_value=str(image_path)))
            opened = []
            real_open = open
            def track(*args, **kwargs):
                stream = real_open(*args, **kwargs)
                opened.append(stream)
                return stream
            with patch("backend.image_tool_request_service.open", side_effect=track), mock_http(
                lambda req, n: httpx.Response(400, json={"error": {"message": "synthetic rejection"}})
            ) as requests:
                with self.assertRaises(main.HTTPException):
                    await main.generate_ai_image("demo", "1024x1024", "", "image",
                                                 reference_images=[{"url": "/output/reference.png"}])
            self.assertEqual(len(requests), 1)
            self.assertTrue(opened and all(stream.closed for stream in opened))
            self.assertIn(b'name="model"', requests[0].content)
            self.assertIn(b'name="images"; filename="reference.png"', requests[0].content)

    async def test_gpt_image_edit_rejection_never_resubmits(self):
        with tempfile.TemporaryDirectory() as tmp, supplier() as (_, stack):
            image_path = Path(tmp) / "reference.png"
            image_path.write_bytes(b"synthetic-image")
            stack.enter_context(patch.object(main, "effective_image_request_mode", return_value="openai"))
            stack.enter_context(patch.object(main, "output_file_from_url", return_value=str(image_path)))
            with mock_http(lambda req, n: httpx.Response(400, json={"error": {"message": "rejected"}})) as requests:
                with self.assertRaises(main.HTTPException) as caught:
                    await main.generate_ai_image("demo", "1024x1024", "", "gpt-image-2",
                                                 reference_images=[{"url": "/output/reference.png"}])
            self.assertEqual(len(requests), 1)
            self.assertEqual(requests[0].url.path, "/v1/images/edits")
            self.assertIn("停止自动重试", caught.exception.detail)

    async def test_video_specialized_routes_keep_public_result_and_remote_accept(self):
        for route, predicate, execute in [
            ("jimeng", "is_jimeng_provider", "generate_jimeng_video"),
            ("runninghub", "is_runninghub_provider", "generate_runninghub_video"),
            ("agnes", "is_agnes_provider", "generate_agnes_video"),
            ("lingjing", "is_lingjing_provider", "generate_lingjing_openai_video"),
            ("yuli", "is_yuli_provider", "generate_yuli_openai_video"),
            ("tudou", "is_tudou_provider", "generate_tudou_video"),
            ("tudou-grok", "is_tudou_provider", "generate_tudou_grok_video"),
        ]:
            with self.subTest(route=route), supplier(route) as (_, stack):
                stack.enter_context(patch.object(main, predicate, return_value=True))
                stack.enter_context(patch.object(main, "is_tudou_video_model", return_value=True))
                stack.enter_context(patch.object(main, "is_tudou_grok_video_model", return_value=route == "tudou-grok"))
                stack.enter_context(patch.object(main, "yuli_is_veo_openai_model", return_value=True))
                runner = stack.enter_context(patch.object(main, execute, new=AsyncMock(return_value={
                    "videos": ["/output/video.mp4"], "task_id": "remote", "raw": {"debug": "hidden"}})))
                stack.enter_context(patch.object(main, "_generate_http_video", new=AsyncMock(side_effect=AssertionError("wrong route"))))
                accepted = AsyncMock()
                token = main.CANVAS_VIDEO_REMOTE_ACCEPT_CALLBACK.set(accepted)
                try:
                    result = await main.canvas_video(main.CanvasVideoRequest(prompt="demo", provider_id=route, model="video"))
                finally:
                    main.CANVAS_VIDEO_REMOTE_ACCEPT_CALLBACK.reset(token)
                self.assertEqual(result["videos"], ["/output/video.mp4"])
                self.assertNotIn("raw", result)
                runner.assert_awaited_once()
                if route == "runninghub":
                    self.assertIs(runner.call_args.kwargs["on_remote_accept"], accepted)

    async def test_native_video_payloads_keep_provider_parameters(self):
        for route in ("custom", "apimart", "volcengine", "yuli"):
            with self.subTest(route=route), supplier(route) as (provider, stack):
                if route != "custom":
                    stack.enter_context(patch.object(main, "is_" + route + "_provider", return_value=True))
                if route == "volcengine":
                    provider["base_url"] = "https://provider.test"
                stack.enter_context(patch.object(main, "yuli_is_veo_openai_model", return_value=False))
                stack.enter_context(patch.object(main, "upload_image_for_apimart", new=AsyncMock(return_value="https://cdn.test/ref.png")))
                stack.enter_context(patch.object(main, "volcengine_media_reference_url", return_value="https://cdn.test/ref.png"))
                stack.enter_context(patch.object(main, "reference_to_data_url", return_value="data:image/png;base64,AA=="))
                stack.enter_context(patch.object(main, "save_remote_video_to_output", new=AsyncMock(return_value="/output/local.mp4")))
                payload = main.CanvasVideoRequest(prompt="demo", provider_id=route, model="video",
                    duration=8, aspect_ratio="16:9", seed=42, images=[{"url": "https://cdn.test/ref.png"}])
                with mock_http(lambda req, n: httpx.Response(200, json={"videos": ["https://cdn.test/out.mp4"]})) as requests:
                    result = await main.canvas_video(payload)
                self.assertEqual(result["videos"], ["/output/local.mp4"])
                self.assertEqual(len(requests), 1)
                body = json.loads(requests[0].content)
                if route == "volcengine":
                    self.assertEqual(body["duration"], 8)
                    self.assertEqual(body["content"][1]["role"], "first_frame")
                    self.assertEqual(body["ratio"], "16:9")
                elif route == "yuli":
                    self.assertNotIn("duration", body)
                    self.assertEqual(body["images"], ["https://cdn.test/ref.png"])
                elif route == "apimart":
                    self.assertEqual(body["image_urls"], ["https://cdn.test/ref.png"])
                else:
                    self.assertEqual(body["duration"], 8)
                    self.assertEqual(body["images"], ["data:image/png;base64,AA=="])

    async def test_video_candidate_fallback_polls_and_downloads_once(self):
        accepted_output = {"videos": ["https://cdn.test/out.mp4"]}
        with supplier() as (_, stack):
            stack.enter_context(patch.object(main, "video_submit_url_candidates", return_value=[
                "https://provider.test/v1/videos", "https://provider.test/v2/videos"]))
            waiter = stack.enter_context(patch.object(main, "wait_for_video_task", new=AsyncMock(return_value=accepted_output)))
            saver = stack.enter_context(patch.object(main, "save_remote_video_to_output", new=AsyncMock(return_value="/output/local.mp4")))
            with mock_http(lambda req, n: httpx.Response(404 if n == 1 else 200,
                            json={"error": "missing"} if n == 1 else {"task_id": "remote"})) as requests:
                result = await main.canvas_video(main.CanvasVideoRequest(prompt="demo", provider_id="custom", model="video"))
            self.assertEqual([r.url.path for r in requests], ["/v1/videos", "/v2/videos"])
            self.assertEqual(waiter.call_args.args[-1], "https://provider.test/v2/videos")
            saver.assert_awaited_once_with("https://cdn.test/out.mp4")
            self.assertEqual(result["task_id"], "remote")
            self.assertNotIn("raw", result)

    async def test_video_rejection_does_not_try_another_endpoint(self):
        with supplier() as (_, stack):
            stack.enter_context(patch.object(main, "video_submit_url_candidates", return_value=[
                "https://provider.test/v1/videos", "https://provider.test/v2/videos"]))
            with mock_http(lambda req, n: httpx.Response(400, json={"error": "token=synthetic-secret"})) as requests:
                with self.assertRaises(main.HTTPException) as caught:
                    await main.canvas_video(main.CanvasVideoRequest(prompt="demo", model="video"))
            self.assertEqual(len(requests), 1)
            self.assertNotIn("synthetic-secret", caught.exception.detail)


if __name__ == "__main__":
    unittest.main()
