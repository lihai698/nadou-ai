"""阶段 6：成功业务回包只公开前端需要字段。"""

import json
import pathlib
import sys
import unittest
from unittest.mock import AsyncMock, patch

import httpx
import requests

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import main


SECRET = "fake-success-debug-token-789"
PRIVATE_URL = f"https://provider.test/result?token={SECRET}"


class Stage6SuccessRawBoundaryTests(unittest.IsolatedAsyncioTestCase):
    def assert_private_absent(self, value):
        rendered = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
        self.assertNotIn(SECRET, rendered)
        self.assertNotIn(PRIVATE_URL, rendered)
        self.assertNotIn("raw", rendered.lower())

    def test_public_video_result_keeps_local_outputs_only(self):
        result = main.public_video_generation_result({
            "videos": ["/output/video-safe.mp4", PRIVATE_URL, {"url": "/assets/clip.webm"}],
            "task_id": "remote-video-safe",
            "video_id": "video-safe",
            "raw": {"debug": SECRET, "prompt": "private prompt"},
            "queue_info": {"queue_idx": 2, "queue_length": 9, "debug": SECRET},
            "message": f"queued {PRIVATE_URL}",
        })
        self.assertEqual(result["videos"], ["/output/video-safe.mp4", "/assets/clip.webm"])
        self.assertEqual(result["task_id"], "remote-video-safe")
        self.assertEqual(result["queue_info"], {"queue_idx": 2, "queue_length": 9})
        self.assert_private_absent(result)

    def test_public_probe_raw_keeps_status_summary_only(self):
        result = main.public_probe_raw({
            "status": 200,
            "source": "fallback",
            "debug": SECRET,
            "data": [{"id": "private-model", "token": SECRET}],
            "nested": {"redirect": PRIVATE_URL},
            "models_error": f"temporary token={SECRET}",
        })
        self.assertEqual(result["status"], 200)
        self.assertEqual(result["source"], "fallback")
        self.assertIn("redacted", result["models_error"])
        self.assert_private_absent(result)

    async def test_canvas_video_response_omits_generator_raw(self):
        payload = main.CanvasVideoRequest(prompt="demo", provider_id="jimeng", model="video-model")
        generated = {
            "videos": ["/output/jimeng_video_safe.mp4"],
            "task_id": "jimeng-task-safe",
            "raw": {"debug": SECRET, "signed_url": PRIVATE_URL},
        }
        with patch.object(main, "get_api_provider", return_value={"id": "jimeng", "name": "即梦"}), patch.object(
            main, "is_jimeng_provider", return_value=True
        ), patch.object(main, "generate_jimeng_video", new=AsyncMock(return_value=generated)):
            result = await main.canvas_video(payload)
        self.assertEqual(result["videos"], ["/output/jimeng_video_safe.mp4"])
        self.assertEqual(result["task_id"], "jimeng-task-safe")
        self.assert_private_absent(result)

    async def test_online_image_response_and_history_omit_generator_raw(self):
        payload = main.OnlineImageRequest(
            prompt="demo",
            provider_id="apimart",
            model="image-model",
        )
        generated = {
            "images": ["/output/image-safe.png"],
            "id": "request-safe",
            "task_id": "image-task-safe",
            "usage": {"total_tokens": 12, "debug": SECRET},
            "debug": SECRET,
            "signed_url": PRIVATE_URL,
        }
        history = []

        def close_scheduled(coro):
            coro.close()

        with patch.object(main, "get_api_provider", return_value={
            "id": "apimart", "name": "APIMart", "image_models": ["image-model"],
        }), patch.object(main, "generate_ai_image", new=AsyncMock(return_value=(
            {"type": "url", "value": "/output/image-safe.png"}, generated,
        ))), patch.object(main, "extract_images", return_value=[
            {"type": "url", "value": "/output/image-safe.png"},
        ]), patch.object(main, "save_ai_image_to_output", new=AsyncMock(return_value="/output/image-safe.png")), patch.object(
            main, "save_to_history", side_effect=history.append
        ), patch.object(main, "schedule_coroutine", side_effect=close_scheduled):
            result = await main.build_online_image_result(payload)

        self.assertEqual(result["images"], ["/output/image-safe.png"])
        self.assertEqual(result["task_id"], "image-task-safe")
        self.assertEqual(result["request_id"], "request-safe")
        self.assertEqual(history, [result])
        rendered = json.dumps(result, ensure_ascii=False)
        self.assertNotIn(SECRET, rendered)
        self.assertNotIn(PRIVATE_URL, rendered)
        self.assertNotIn('"raw":', rendered)
        self.assertNotIn('"debug":', rendered)

    async def test_midjourney_submit_and_status_omit_success_raw(self):
        provider = {"id": "apimart", "name": "APIMart"}
        raw = {
            "data": {"task_id": "mj-task-safe", "status": "queued"},
            "prompt": "private prompt",
            "debug": SECRET,
            "signed_url": PRIVATE_URL,
        }
        payload = main.MidjourneySubmitRequest(provider_id="apimart", prompt="a cat")
        with patch.object(main, "apimart_midjourney_provider", return_value=provider), patch.object(
            main, "midjourney_reference_urls", new=AsyncMock(return_value=[])
        ), patch.object(main, "apimart_midjourney_request", new=AsyncMock(return_value=(raw, "mj-task-safe"))):
            result = await main.submit_midjourney(payload)
        self.assertEqual(result["task_id"], "mj-task-safe")
        self.assertEqual(result["mode"], "imagine")
        self.assert_private_absent(result)

        with patch.object(main, "save_ai_image_to_output", new=AsyncMock(return_value="/output/mj-safe.png")), patch.object(
            main, "api_headers", return_value={}
        ):
            response = type("Response", (), {
                "status_code": 200,
                "json": lambda self: {"data": {"task_id": "mj-task-safe", "status": "SUCCESS", "image_urls": ["https://img.test/safe.png"]}},
            })()
            client = type("Client", (), {"get": AsyncMock(return_value=response)})()
            class ClientContext:
                async def __aenter__(self):
                    return client

                async def __aexit__(self, *_args):
                    return False

            with patch.object(main.httpx, "AsyncClient", return_value=ClientContext()):
                status = await main.midjourney_result(provider, "mj-task-safe")
        self.assertEqual(status["status"], "succeeded")
        self.assertEqual(status["images"], ["/output/mj-safe.png"])
        self.assert_private_absent(status)

    async def test_runninghub_image_query_error_hides_upstream_body_and_url(self):
        provider = {"id": "runninghub", "name": "RunningHub"}
        client_type = httpx.AsyncClient
        transport = httpx.MockTransport(lambda _request: httpx.Response(
            502, json={"error": {"message": "temporarily unavailable", "debug": SECRET}, "url": PRIVATE_URL}
        ))

        def client_factory(*_args, **kwargs):
            return client_type(transport=transport, timeout=kwargs.get("timeout"))

        with patch.object(main, "get_api_provider", return_value=provider), patch.object(
            main, "is_runninghub_provider", return_value=True
        ), patch.object(main, "runninghub_api_key", return_value="test-key"), patch.object(
            main, "runninghub_endpoint_url", return_value="https://runninghub.test/task/openapi/outputs"
        ), patch.object(main, "runninghub_app_headers", return_value={}), patch.object(
            main.httpx, "AsyncClient", side_effect=client_factory
        ):
            with self.assertRaises(main.HTTPException) as caught:
                await main.query_image_task(main.ImageTaskQueryRequest(provider_id="runninghub", task_id="safe-task"))
        self.assertEqual(caught.exception.status_code, 502)
        self.assert_private_absent(caught.exception.detail)

    async def test_runninghub_success_without_media_is_failed_without_history(self):
        provider = {"id": "runninghub", "name": "RunningHub"}
        client_type = httpx.AsyncClient
        transport = httpx.MockTransport(lambda _request: httpx.Response(
            200,
            json={"code": 0, "data": {}, "debug": SECRET},
        ))

        def client_factory(*_args, **kwargs):
            return client_type(transport=transport, timeout=kwargs.get("timeout"))

        history = []
        scheduled = []
        with patch.object(main, "get_api_provider", return_value=provider), patch.object(
            main, "is_runninghub_provider", return_value=True
        ), patch.object(main, "runninghub_api_key", return_value="test-key"), patch.object(
            main, "runninghub_endpoint_url", return_value="https://runninghub.test/task/openapi/outputs"
        ), patch.object(main, "runninghub_app_headers", return_value={}), patch.object(
            main.httpx, "AsyncClient", side_effect=client_factory
        ), patch.object(main, "save_to_history", side_effect=history.append), patch.object(
            main, "schedule_coroutine", side_effect=scheduled.append
        ):
            result = await main.query_image_task(
                main.ImageTaskQueryRequest(provider_id="runninghub", task_id="safe-task")
            )

        self.assertEqual(result["status"], "failed")
        self.assertIn("没有返回可用图片", result["error"])
        self.assertEqual(history, [])
        self.assertEqual(scheduled, [])
        self.assert_private_absent(result)

    async def test_completed_image_without_local_save_is_failed_without_history(self):
        provider = {"id": "openai", "name": "隔离平台", "base_url": "https://provider.test"}
        history = []
        scheduled = []
        with patch.object(main, "get_api_provider", return_value=provider), patch.object(
            main, "is_runninghub_provider", return_value=False
        ), patch.object(
            main, "fetch_image_task_payload", new=AsyncMock(return_value={"status": "SUCCEEDED"})
        ), patch.object(
            main, "extract_images", return_value=[{"type": "url", "value": PRIVATE_URL}]
        ), patch.object(main, "save_ai_image_to_output", new=AsyncMock(return_value="")), patch.object(
            main, "save_to_history", side_effect=history.append
        ), patch.object(main, "schedule_coroutine", side_effect=scheduled.append):
            result = await main.query_image_task(
                main.ImageTaskQueryRequest(provider_id="openai", task_id="safe-task")
            )

        self.assertEqual(result["status"], "failed")
        self.assertIn("没有保存可用图片", result["error"])
        self.assertEqual(history, [])
        self.assertEqual(scheduled, [])
        self.assert_private_absent(result)

    def test_remote_download_error_hides_signed_url(self):
        with patch.object(main, "rewrite_runninghub_file_url", side_effect=lambda value: value), patch.object(
            main, "output_file_from_url", return_value=""
        ), patch.object(main, "local_media_file_by_basename", return_value=""), patch.object(
            main.requests, "get", side_effect=requests.RequestException(PRIVATE_URL)
        ):
            with self.assertRaises(main.HTTPException) as caught:
                main.download_output(type("Request", (), {"headers": {}})(), PRIVATE_URL)
        self.assertEqual(caught.exception.status_code, 502)
        self.assert_private_absent(caught.exception.detail)


if __name__ == "__main__":
    unittest.main()
