"""ModelScope 生图失败时不把上游原始回包返回给页面。"""

import contextlib
import io
import pathlib
import sys
import unittest
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import HTTPException

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import main


class FakeClient:
    def __init__(self, submit, poll=None):
        self.submit = submit
        self.poll = poll

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def post(self, *args, **kwargs):
        if isinstance(self.submit, Exception):
            raise self.submit
        return self.submit

    async def get(self, *args, **kwargs):
        if isinstance(self.poll, Exception):
            raise self.poll
        return self.poll


class ModelScopeErrorSanitizationTests(unittest.IsolatedAsyncioTestCase):
    async def test_submit_failures_return_bounded_summary_at_all_image_entries(self):
        response = httpx.Response(401, json={
            "code": 401,
            "message": "invalid token=top-secret",
            "debug": {"request_body": "private-prompt", "apiKey": "top-secret"},
        })
        entries = (
            lambda: main.generate_modelscope_provider_image("a cat", "1024x1024", "model"),
            lambda: main.generate_angle_cloud(main.CloudGenRequest(prompt="a cat")),
            lambda: main.generate_cloud(main.CloudGenRequest(prompt="a cat")),
            lambda: main.ms_generate(main.MsGenerateRequest(prompt="a cat")),
        )
        with patch.object(main, "modelscope_api_key", return_value="fake-token"), patch.object(
            main, "modelscope_image_api_root", return_value="https://provider.test/v1"
        ):
            for entry in entries:
                with self.subTest(entry=entry):
                    with patch.object(main.httpx, "AsyncClient", return_value=FakeClient(response)):
                        with self.assertRaises(HTTPException) as caught:
                            await entry()
                    detail = str(caught.exception.detail)
                    self.assertEqual(caught.exception.status_code, 401)
                    self.assertIn("token=<redacted>", detail)
                    self.assertNotIn("top-secret", detail)
                    self.assertNotIn("private-prompt", detail)
                    self.assertLessEqual(len(detail), 350)

    async def test_poll_failure_uses_error_info_without_debug_payload(self):
        submitted = httpx.Response(200, json={"task_id": "task-1"})
        failed = httpx.Response(200, json={
            "task_status": "FAILED",
            "error_info": "bad apiKey=top-secret",
            "debug": {"request_body": "private-prompt"},
        })
        with patch.object(main, "modelscope_api_key", return_value="fake-token"), patch.object(
            main, "modelscope_image_api_root", return_value="https://provider.test/v1"
        ), patch.object(main.httpx, "AsyncClient", return_value=FakeClient(submitted, failed)), patch.object(
            main.asyncio, "sleep", new=AsyncMock()
        ):
            with self.assertRaises(HTTPException) as caught:
                await main.generate_modelscope_provider_image("a cat", "1024x1024", "model")
        detail = str(caught.exception.detail)
        self.assertEqual(caught.exception.status_code, 502)
        self.assertIn("apiKey=<redacted>", detail)
        self.assertNotIn("top-secret", detail)
        self.assertNotIn("private-prompt", detail)

    async def test_success_still_returns_image_and_provider_result(self):
        submitted = httpx.Response(200, json={"task_id": "task-1"})
        completed_payload = {
            "task_status": "SUCCEED",
            "output_images": ["https://provider.test/image.png"],
        }
        completed = httpx.Response(200, json=completed_payload)
        with patch.object(main, "modelscope_api_key", return_value="fake-token"), patch.object(
            main, "modelscope_image_api_root", return_value="https://provider.test/v1"
        ), patch.object(main.httpx, "AsyncClient", return_value=FakeClient(submitted, completed)), patch.object(
            main.asyncio, "sleep", new=AsyncMock()
        ):
            image, raw = await main.generate_modelscope_provider_image("a cat", "1024x1024", "model")
        self.assertEqual(image, {"type": "url", "value": "https://provider.test/image.png"})
        self.assertEqual(raw, completed_payload)

    async def test_network_failure_does_not_return_or_log_credentials(self):
        output = io.StringIO()
        failure = httpx.ConnectError("failed https://provider.test/v1?token=top-secret")
        with patch.object(main, "modelscope_api_key", return_value="fake-token"), patch.object(
            main, "modelscope_image_api_root", return_value="https://provider.test/v1"
        ), patch.object(main.httpx, "AsyncClient", return_value=FakeClient(failure)), contextlib.redirect_stdout(output):
            with self.assertRaises(HTTPException) as caught:
                await main.generate_modelscope_provider_image("a cat", "1024x1024", "model")
        self.assertEqual(caught.exception.status_code, 502)
        self.assertNotIn("top-secret", str(caught.exception.detail))
        self.assertNotIn("top-secret", output.getvalue())


if __name__ == "__main__":
    unittest.main()
