"""非回环监听时的访问令牌边界。"""

import base64
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main


class RemoteAccessTests(unittest.IsolatedAsyncioTestCase):
    async def test_loopback_does_not_require_a_token(self):
        with patch.dict(os.environ, {"NADOU_BIND_HOST": "127.0.0.1", "NADOU_ACCESS_TOKEN": ""}, clear=False):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=main.app), base_url="http://test.local"
            ) as client:
                response = await client.get("/api/app-info")
        self.assertEqual(response.status_code, 200, response.text)

    async def test_non_loopback_requires_bearer_or_basic_token(self):
        env = {"NADOU_BIND_HOST": "0.0.0.0", "NADOU_ACCESS_TOKEN": "test-token"}
        with patch.dict(os.environ, env, clear=False):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=main.app), base_url="http://test.local"
            ) as client:
                denied = await client.get("/api/app-info")
                bearer = await client.get("/api/app-info", headers={"Authorization": "Bearer test-token"})
                basic_value = base64.b64encode(b"nadou:test-token").decode("ascii")
                basic = await client.get("/api/app-info", headers={"Authorization": f"Basic {basic_value}"})
                wrong = await client.get("/api/app-info", headers={"X-Nadou-Access-Token": "wrong"})
        self.assertEqual(denied.status_code, 401)
        self.assertEqual(bearer.status_code, 200, bearer.text)
        self.assertEqual(basic.status_code, 200, basic.text)
        self.assertEqual(wrong.status_code, 401)
        self.assertIn("Basic", denied.headers.get("www-authenticate", ""))

    async def test_non_loopback_without_token_returns_configuration_error(self):
        with patch.dict(os.environ, {"NADOU_BIND_HOST": "192.0.2.10", "NADOU_ACCESS_TOKEN": ""}, clear=False):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=main.app), base_url="http://test.local"
            ) as client:
                response = await client.get("/api/app-info")
        self.assertEqual(response.status_code, 503)
        self.assertIn("NADOU_ACCESS_TOKEN", response.text)


class RemoteAccessStartupTests(unittest.TestCase):
    def test_non_loopback_without_token_stops_before_uvicorn(self):
        with patch.dict(os.environ, {"NADOU_BIND_HOST": "0.0.0.0", "NADOU_ACCESS_TOKEN": ""}, clear=False), \
                patch("uvicorn.run") as run:
            with self.assertRaises(SystemExit) as raised:
                main.run_application_server()
        self.assertEqual(raised.exception.code, 2)
        run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
