"""通用生图 HTTP 错误仅向页面返回脱敏摘要。"""

import pathlib
import sys
import unittest
from unittest.mock import patch

import httpx
from fastapi import HTTPException

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import main


class FakeClient:
    def __init__(self, response):
        self.response = response

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def post(self, *args, **kwargs):
        return self.response


class GenericImageErrorSanitizationTests(unittest.IsolatedAsyncioTestCase):
    async def test_failed_generation_excludes_raw_debug_and_credentials(self):
        response = httpx.Response(502, json={
            "error": {"message": "bad token=top-secret"},
            "debug": {"request_body": "private-prompt", "apiKey": "top-secret"},
        })
        provider = {"id": "custom", "name": "自定义供应商", "base_url": "https://provider.test/v1"}
        with patch.object(main, "get_api_provider", return_value=provider), patch.object(
            main, "effective_image_request_mode", return_value="openai-json"
        ), patch.object(main, "api_headers", return_value={}), patch.object(
            main.httpx, "AsyncClient", return_value=FakeClient(response)
        ):
            with self.assertRaises(HTTPException) as caught:
                await main.generate_ai_image("a cat", "1024x1024", "", "image-model", provider_id="custom")
        detail = str(caught.exception.detail)
        self.assertEqual(caught.exception.status_code, 502)
        self.assertIn("token=<redacted>", detail)
        self.assertNotIn("top-secret", detail)
        self.assertNotIn("private-prompt", detail)

    async def test_success_still_returns_image_and_provider_result(self):
        payload = {"data": [{"url": "https://provider.test/image.png"}]}
        response = httpx.Response(200, json=payload)
        provider = {"id": "custom", "name": "自定义供应商", "base_url": "https://provider.test/v1"}
        with patch.object(main, "get_api_provider", return_value=provider), patch.object(
            main, "effective_image_request_mode", return_value="openai-json"
        ), patch.object(main, "api_headers", return_value={}), patch.object(
            main.httpx, "AsyncClient", return_value=FakeClient(response)
        ):
            image, raw = await main.generate_ai_image("a cat", "1024x1024", "", "image-model", provider_id="custom")
        self.assertEqual(image, {"type": "url", "value": "https://provider.test/image.png"})
        self.assertEqual(raw, payload)

    def test_responses_no_image_message_redacts_credentials(self):
        detail = main.responses_no_image_detail({"error": {"message": "bad token=top-secret"}})
        self.assertIn("token=<redacted>", detail)
        self.assertNotIn("top-secret", detail)

    async def test_tudou_image_errors_do_not_echo_raw_response(self):
        provider = {"id": "tudou", "name": "土豆", "base_url": "https://provider.test/v1"}
        payload = {"message": "bad token=top-secret", "debug": {"request_body": "private-prompt"}}
        response = httpx.Response(200, json=payload)
        with patch.object(main, "api_headers", return_value={}), patch.object(
            main.httpx, "AsyncClient", return_value=FakeClient(response)
        ):
            with self.assertRaises(HTTPException) as async_error:
                await main.generate_tudou_async_image("a cat", "1024x1024", "", "gpt-image-2", [], provider)
            with self.assertRaises(HTTPException) as grok_error:
                await main.generate_tudou_grok_image("a cat", "1024x1024", "grok-imagine-image", [], provider)
        for error in (async_error.exception, grok_error.exception):
            self.assertEqual(error.status_code, 502)
            self.assertIn("token=<redacted>", str(error.detail))
            self.assertNotIn("top-secret", str(error.detail))
            self.assertNotIn("private-prompt", str(error.detail))


if __name__ == "__main__":
    unittest.main()
