"""验证网络诊断日志不会输出 URL 查询凭据或代理认证信息。"""

import contextlib
import io
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main


class LogRedactionTests(unittest.TestCase):
    def test_url_keeps_host_and_path_without_query_or_userinfo(self):
        value = main.redact_url_for_log(
            "https://fake-user:fake-pass@example.test:8443/v1/jobs?api_key=fake-key&token=fake-token#fragment"
        )
        self.assertEqual(value, "https://example.test:8443/v1/jobs")
        self.assertNotIn("fake-", value)

    def test_network_error_masks_url_proxy_and_exception_credentials(self):
        output = io.StringIO()
        diagnostics = []
        error = httpx.ConnectError(
            "connect failed url=https://example.test/v1/jobs?token=fake-token "
            "Authorization: Bearer fake-auth"
        )
        with patch.object(
            main.urllib.request,
            "getproxies",
            return_value={"https": "https://proxy-user:proxy-pass@proxy.example:8443"},
        ), patch.object(main, "write_diagnostic", side_effect=diagnostics.append), contextlib.redirect_stdout(output):
            main.log_net_error(
                "生成请求 token=fake-context-token",
                error,
                "https://fake-user:fake-pass@example.test/v1/jobs?api_key=fake-key",
            )
        self.assertEqual(output.getvalue(), "")
        text = " ".join(diagnostics)
        self.assertIn("example.test/v1/jobs", text)
        self.assertIn("proxy.example:8443", text)
        for secret in ("fake-user", "fake-pass", "fake-key", "fake-token", "fake-auth", "proxy-user", "proxy-pass"):
            self.assertNotIn(secret, text)


class RetryLogRedactionTests(unittest.IsolatedAsyncioTestCase):
    async def test_retry_log_masks_url_and_exception(self):
        class Client:
            def __init__(self):
                self.calls = 0

            async def request(self, method, url, **kwargs):
                self.calls += 1
                if self.calls == 1:
                    raise httpx.ConnectError(
                        "temporary token=fake-token at https://example.test/retry?key=fake-key"
                    )
                return httpx.Response(200, request=httpx.Request(method, url))

        output = io.StringIO()
        diagnostics = []
        client = Client()
        with patch.object(main, "write_diagnostic", side_effect=diagnostics.append), contextlib.redirect_stdout(output):
            response = await main.httpx_request_with_transient_retries(
                client,
                "GET",
                "https://fake-user:fake-pass@example.test/retry?api_key=fake-key",
                attempts=2,
                retry_delay=0,
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(client.calls, 2)
        self.assertEqual(output.getvalue(), "")
        text = " ".join(diagnostics)
        self.assertIn("https://example.test/retry", text)
        for secret in ("fake-user", "fake-pass", "fake-key", "fake-token"):
            self.assertNotIn(secret, text)

    async def test_failed_image_download_does_not_log_signed_url(self):
        url = "https://fake-user:fake-pass@example.test/image.png?token=fake-token"

        class FailingClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return False

            async def get(self, value):
                raise httpx.ConnectError("download failed token=fake-key")

        output = io.StringIO()
        diagnostics = []
        with patch.object(main.httpx, "AsyncClient", return_value=FailingClient()), patch.object(
            main, "write_diagnostic", side_effect=diagnostics.append
        ), patch.object(main.urllib.request, "getproxies", return_value={}), contextlib.redirect_stdout(output):
            result = await main.save_ai_image_to_output({"type": "url", "value": url})
        self.assertEqual(result, url)
        recorded = output.getvalue() + " ".join(diagnostics)
        self.assertIn("https://example.test/image.png", recorded)
        for secret in ("fake-user", "fake-pass", "fake-token", "fake-key"):
            self.assertNotIn(secret, recorded)


if __name__ == "__main__":
    unittest.main()
