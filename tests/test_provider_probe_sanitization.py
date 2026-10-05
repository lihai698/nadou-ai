"""隔离模拟上游失败，验证 APIMart 和模型探测不泄露原始回包。"""

import contextlib
import io
import json
import pathlib
import sys
import unittest
from unittest.mock import AsyncMock, patch

import httpx

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import main


PRIVATE = "private-debug-token-123"
PRIVATE_URL = f"https://example.test/login?api_key={PRIVATE}"
ERROR_BODY = {
    "error": {"message": "quota depleted", "code": "insufficient_quota"},
    "debug": {"api_key": PRIVATE, "redirect": PRIVATE_URL},
}


class ProviderProbeSanitizationTests(unittest.IsolatedAsyncioTestCase):
    async def run_with_transport(self, handler, operation):
        client_type = httpx.AsyncClient
        transport = httpx.MockTransport(handler)

        def client_factory(*_args, **kwargs):
            return client_type(transport=transport, timeout=kwargs.get("timeout"))

        with patch.object(main.httpx, "AsyncClient", side_effect=client_factory):
            return await operation()

    def assert_private_absent(self, value):
        rendered = json.dumps(value, ensure_ascii=False) if not isinstance(value, str) else value
        self.assertNotIn(PRIVATE, rendered)
        self.assertNotIn(PRIVATE_URL, rendered)
        self.assertNotIn('"debug"', rendered)

    async def test_apimart_model_probe_and_fetch_summarize_failure(self):
        def handler(request):
            self.assertEqual(request.url.path, "/v1/models")
            return httpx.Response(502, json=ERROR_BODY)

        payload = main.TestConnectionPayload(base_url="https://api.apimart.ai", api_key="fake-key", protocol="apimart")
        result = await self.run_with_transport(handler, lambda: main.test_provider_connection(payload))
        self.assertFalse(result["ok"])
        self.assertEqual(result["status"], 502)
        self.assertIn("quota depleted", result["message"])
        self.assert_private_absent(result)

        with self.assertRaises(main.HTTPException) as caught:
            await self.run_with_transport(handler, lambda: main.fetch_models_from_upstream(payload.base_url, payload.api_key, payload.protocol))
        self.assertEqual(caught.exception.status_code, 502)
        self.assertIn("quota depleted", caught.exception.detail)
        self.assert_private_absent(caught.exception.detail)

    async def test_probe_keeps_protocol_detection_without_raw_error_body(self):
        def handler(request):
            self.assertIn("/v1/tasks/", request.url.path)
            return httpx.Response(400, json={"error": {"message": "Invalid task ID", "debug": PRIVATE}, "raw": ERROR_BODY})

        payload = main.TestConnectionPayload(base_url="https://api.apimart.ai", api_key="fake-key", protocol="apimart")
        result = await self.run_with_transport(handler, lambda: main.probe_async_endpoint(payload))
        self.assertTrue(result["ok"])
        self.assertEqual(result["protocol"], "apimart")
        self.assertEqual(result["status_code"], 400)
        self.assertIn("Invalid task ID", result["raw"]["error_summary"])
        self.assert_private_absent(result)

    async def test_redirect_and_html_do_not_expose_location_or_page(self):
        payload = main.TestConnectionPayload(base_url="https://api.apimart.ai", api_key="fake-key", protocol="apimart")
        redirect = await self.run_with_transport(
            lambda _request: httpx.Response(302, headers={"Location": PRIVATE_URL}),
            lambda: main.test_provider_connection(payload),
        )
        self.assertFalse(redirect["ok"])
        self.assertIn("发生跳转", redirect["message"])
        self.assert_private_absent(redirect)

        page = f"<html><head></head><body>{PRIVATE}</body></html>"
        with self.assertRaises(main.HTTPException) as caught:
            await self.run_with_transport(
                lambda _request: httpx.Response(502, text=page),
                lambda: main.fetch_models_from_upstream(payload.base_url, payload.api_key, payload.protocol),
            )
        self.assertEqual(caught.exception.status_code, 400)
        self.assert_private_absent(caught.exception.detail)

        nested_page = httpx.Response(502, json={"error": {"message": page, "debug": PRIVATE}})
        self.assertEqual(main.upstream_response_error_summary(nested_page, "模型列表不可用"), "模型列表不可用")
        redacted = main.provider_error_summary({"error": {"message": "temporary token=fake-secret"}})
        self.assertEqual(redacted, "temporary token=<redacted>")

    async def test_apimart_upload_and_midjourney_missing_id_do_not_dump_json(self):
        upload_response = httpx.Response(403, json=ERROR_BODY)
        captured = io.StringIO()
        diagnostics = []
        with patch.object(main, "api_headers", return_value={}), patch.object(
            main, "apimart_upload_payload_from_bytes", return_value=("image.png", b"image", "image/png")
        ), patch.object(main, "apimart_upload_post", new=AsyncMock(return_value=upload_response)), patch.object(
            main, "write_diagnostic", side_effect=diagnostics.append
        ), contextlib.redirect_stdout(captured):
            result = await main.upload_image_for_apimart(object(), {"id": "apimart", "base_url": "https://api.apimart.ai"}, "data:image/png;base64,aW1hZ2U=")
        self.assertEqual(result, "ERR:APIMart 上传失败(403)")
        self.assertEqual(captured.getvalue(), "")
        self.assertTrue(diagnostics)
        self.assertNotIn("quota depleted", " ".join(diagnostics))
        self.assert_private_absent(" ".join(diagnostics))

        with patch.object(main, "api_headers", return_value={}):
            with self.assertRaises(main.HTTPException) as caught:
                await self.run_with_transport(
                    lambda _request: httpx.Response(200, json={"data": {"debug": PRIVATE}}),
                    lambda: main.apimart_midjourney_request({"id": "apimart"}, "/v1/midjourney/generations", {}),
                )
        self.assertEqual(caught.exception.status_code, 502)
        self.assert_private_absent(caught.exception.detail)

        with patch.object(main, "api_headers", return_value={}):
            for operation in (
                lambda: main.apimart_midjourney_request({"id": "apimart"}, "/v1/midjourney/generations", {}),
                lambda: main.submit_apimart_avatar_asset(
                    {"id": "apimart", "base_url": "https://api.apimart.ai"},
                    "https://example.test/image.png", "portrait", "image",
                ),
            ):
                with self.subTest(operation=operation):
                    with self.assertRaises(main.HTTPException) as caught:
                        await self.run_with_transport(lambda _request: httpx.Response(502, json=ERROR_BODY), operation)
                    self.assertIn("quota depleted", caught.exception.detail)
                    self.assert_private_absent(caught.exception.detail)

    async def test_successful_model_fetch_keeps_model_list(self):
        body = {"data": [{"id": "gpt-image-2"}, {"id": "gpt-5.5"}]}
        result = await self.run_with_transport(
            lambda _request: httpx.Response(200, json=body),
            lambda: main.fetch_models_from_upstream("https://api.apimart.ai", "fake-key", "apimart"),
        )
        self.assertEqual(result["total"], 2)
        self.assertEqual(result["image_models"], ["gpt-image-2"])
        self.assertEqual(result["chat_models"], ["gpt-5.5"])

    async def test_successful_async_probe_keeps_models_without_upstream_debug_body(self):
        def handler(request):
            if request.url.path.endswith("/models"):
                return httpx.Response(200, json={
                    "data": [{"id": "gpt-5.5"}], "debug": {"api_key": PRIVATE},
                })
            return httpx.Response(404, json={"error": {"message": "missing"}})

        payload = main.TestConnectionPayload(base_url="https://api.apimart.ai", api_key="fake-key", protocol="openai")
        result = await self.run_with_transport(handler, lambda: main.probe_async_endpoint(payload))
        self.assertTrue(result["ok"])
        self.assertEqual(result["all"], ["gpt-5.5"])
        self.assertEqual(result["raw"]["openai_probe"], {"status": 200, "model_count": 1})
        self.assert_private_absent(result)


if __name__ == "__main__":
    unittest.main()
