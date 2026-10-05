"""隔离验证聊天与视频失败分支不会把上游原文返给页面。"""

import pathlib
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import httpx

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import main


class ChatVideoErrorSanitizationTests(unittest.IsolatedAsyncioTestCase):
    def test_http_error_keeps_reason_without_debug_payload(self):
        response = httpx.Response(
            503,
            json={
                "error": {"message": "temporary token=fake-secret"},
                "debug": {"request_body": "private-prompt"},
            },
            request=httpx.Request("POST", "https://provider.test/v1/chat?api_key=fake-secret"),
        )
        detail = main.safe_upstream_http_detail(response)
        self.assertIn("503", detail)
        self.assertIn("temporary", detail)
        self.assertNotIn("fake-secret", detail)
        self.assertNotIn("private-prompt", detail)

    def test_html_and_transport_errors_hide_original_text(self):
        response = httpx.Response(502, text="<html>private-prompt fake-secret</html>")
        detail = main.safe_upstream_http_detail(response)
        self.assertIn("502", detail)
        self.assertNotIn("private-prompt", detail)
        self.assertNotIn("fake-secret", detail)
        transport_detail = main.safe_upstream_transport_detail(
            httpx.ConnectError("https://provider.test/path?token=fake-secret")
        )
        self.assertIn("ConnectError", transport_detail)
        self.assertNotIn("fake-secret", transport_detail)

    async def test_canvas_video_tudou_http_error_uses_safe_detail(self):
        provider = {"id": "tudou", "name": "土豆", "base_url": "https://provider.test"}
        response = httpx.Response(
            503,
            json={"error": {"message": "busy token=fake-secret"}, "debug": "private-prompt"},
            request=httpx.Request("POST", "https://provider.test/v1/videos/generations"),
        )
        error = httpx.HTTPStatusError("upstream failed", request=response.request, response=response)
        payload = SimpleNamespace(provider_id="tudou", model="sora2")
        with patch.object(main, "get_api_provider", return_value=provider), \
                patch.object(main, "provider_env_key_value", return_value="fake-key"), \
                patch.object(main, "generate_tudou_video", side_effect=error):
            with self.assertRaises(main.HTTPException) as caught:
                await main.canvas_video(payload)
        detail = str(caught.exception.detail)
        self.assertEqual(caught.exception.status_code, 503)
        self.assertIn("busy", detail)
        self.assertNotIn("fake-secret", detail)
        self.assertNotIn("private-prompt", detail)

    async def test_canvas_chat_http_error_uses_safe_detail(self):
        real_client = httpx.AsyncClient
        response_body = {"error": {"message": "busy apiKey=fake-secret"}, "debug": "private-prompt"}

        def client_factory(*args, **kwargs):
            return real_client(
                transport=httpx.MockTransport(lambda request: httpx.Response(503, json=response_body)),
                base_url="https://provider.test",
            )

        payload = SimpleNamespace(
            provider="test", model="model", ms_model="", system_prompt="", messages=[],
            images=[], videos=[], message="hello",
        )
        with patch.object(main, "get_api_provider", return_value={"id": "test"}), \
                patch.object(main, "resolve_chat_provider", return_value=("https://provider.test/v1", {}, "model")), \
                patch.object(main.httpx, "AsyncClient", side_effect=client_factory):
            with self.assertRaises(main.HTTPException) as caught:
                await main.canvas_llm(payload)
        detail = str(caught.exception.detail)
        self.assertEqual(caught.exception.status_code, 503)
        self.assertIn("busy", detail)
        self.assertNotIn("fake-secret", detail)
        self.assertNotIn("private-prompt", detail)


if __name__ == "__main__":
    unittest.main()
