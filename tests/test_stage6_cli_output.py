"""验证 CLI 管理接口的 stdout/stderr 与受控状态摘要边界。

测试只使用本机模拟进程和自制 JSON，不调用真实 CLI、供应商或用户配置。
"""

import asyncio
import json
import pathlib
import sys
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import main


SECRET = "stage6-cli-private-token-123"
PRIVATE_URL = f"https://cli.example.test/login?token={SECRET}"
PRIVATE_PATH = r"C:\Users\PrivateUser\AppData\Local\dreamina\dreamina.exe"


class FakeProcess:
    def __init__(self, stdout=b"", stderr=b"", returncode=0):
        self.stdout = stdout
        self.stderr = stderr
        self.returncode = returncode

    async def communicate(self):
        return self.stdout, self.stderr


class Stage6CliOutputTests(unittest.IsolatedAsyncioTestCase):
    def assert_private_absent(self, value):
        rendered = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
        self.assertNotIn(SECRET, rendered)
        self.assertNotIn(PRIVATE_URL, rendered)
        self.assertNotIn("PrivateUser", rendered)

    async def test_public_helpers_bound_and_redact_raw_values(self):
        text = main.safe_cli_public_text(
            f"token={SECRET} url={PRIVATE_URL} path={PRIVATE_PATH}\n" + "x" * 200,
            limit=120,
        )
        self.assertLessEqual(len(text), 120)
        self.assert_private_absent(text)
        self.assertIn("CLI 输出已截断", text)

        raw = main.safe_cli_public_raw(
            {
                "total_credit": 12.5,
                "token": SECRET,
                "_stdout": f"path={PRIVATE_PATH} token={SECRET}",
                "nested": {"balance": 8, "url": PRIVATE_URL},
            }
        )
        self.assertEqual(raw["total_credit"], 12.5)
        self.assertEqual(raw["nested"]["balance"], 8)
        self.assert_private_absent(raw)
        self.assertNotIn("token", raw)

    async def test_codex_status_and_help_keep_frontend_fields_without_raw_leaks(self):
        process = FakeProcess(
            stdout=f"codex 1.2.3 path={PRIVATE_PATH}".encode(),
            stderr=f"warning token={SECRET}".encode(),
        )
        with patch.object(main, "codex_cli_executable", return_value=PRIVATE_PATH), patch.object(
            main, "gpt_image_2_skill_executable", return_value=PRIVATE_PATH
        ), patch.object(main.asyncio, "create_subprocess_exec", new=AsyncMock(return_value=process)):
            status = await main.codex_status()
            help_payload = await main.codex_help(main.CodexHelpRequest(command=""))
        self.assertEqual(status["path"], "dreamina.exe")
        self.assertEqual(status["image2_helper_path"], "dreamina.exe")
        self.assert_private_absent(status)
        self.assert_private_absent(help_payload)
        self.assertIn("codex 1.2.3", help_payload["text"])

    async def test_gemini_status_and_help_keep_frontend_fields_without_raw_leaks(self):
        agy_path = r"C:\Users\PrivateUser\AppData\Local\antigravity\agy.exe"
        process = FakeProcess(
            stdout=f"agy 0.9.0 path={PRIVATE_PATH}".encode(),
            stderr=f"warning token={SECRET}".encode(),
        )
        with patch.object(main, "gemini_cli_executable", return_value=agy_path), patch.object(
            main.asyncio, "create_subprocess_exec", new=AsyncMock(return_value=process)
        ):
            status = await main.gemini_cli_status()
            help_payload = await main.gemini_cli_help(main.GeminiCliHelpRequest(command=""))
        self.assertEqual(status["path"], "agy.exe")
        self.assertEqual(status["provider"], "antigravity")
        self.assert_private_absent(status)
        self.assert_private_absent(help_payload)
        self.assertIn("agy 0.9.0", help_payload["text"])

    async def test_provider_probe_and_model_payload_redact_status_raw(self):
        malicious_status = {
            "installed": True,
            "logged_in": True,
            "version": f"cli path={PRIVATE_PATH} token={SECRET}",
            "path": PRIVATE_PATH,
            "message": f"ready token={SECRET}",
            "raw": {
                "stdout": f"path={PRIVATE_PATH} token={SECRET}",
                "nested": {"authorization": SECRET, "ok": True},
            },
        }
        for protocol, status_fn in (("codex", main.codex_status), ("gemini-cli", main.gemini_cli_status)):
            with self.subTest(protocol=protocol), patch.object(main, status_fn.__name__, new=AsyncMock(return_value=malicious_status)):
                payload = main.TestConnectionPayload(provider_id=protocol, protocol=protocol)
                connection = await main.test_provider_connection(payload)
                probe = await main.probe_async_endpoint(payload)
                self.assert_private_absent(connection)
                self.assert_private_absent(probe)
                self.assert_private_absent(main.codex_models_payload(raw=malicious_status))
                self.assert_private_absent(main.gemini_cli_models_payload(raw=malicious_status))

    async def test_jimeng_management_exposes_numeric_credit_without_raw(self):
        raw = {
            "total_credit": 99,
            "balance": 3.5,
            "token": SECRET,
            "_stdout": f"CLI help path={PRIVATE_PATH} url={PRIVATE_URL}",
        }
        with patch.object(main, "jimeng_cli_executable", return_value=PRIVATE_PATH), patch.object(
            main, "jimeng_cli_version", new=AsyncMock(return_value=((1, 4, 2), "1.4.2"))
        ), patch.object(main, "run_jimeng_cli", new=AsyncMock(return_value=raw)):
            status = await main.jimeng_status()
            credit = await main.jimeng_credit()
            logout = await main.jimeng_logout()
            help_payload = await main.jimeng_help(main.JimengHelpRequest(command=""))
        for value in (status, credit, logout, help_payload):
            self.assert_private_absent(value)
            self.assertNotIn("raw", value)
        self.assertEqual(status["credit"]["total_credit"], 99)
        self.assertEqual(credit["credit"]["balance"], 3.5)
        self.assertEqual(logout["success"], True)
        self.assertIn("CLI", help_payload["text"] or "")

    async def test_jimeng_login_status_redacts_text_but_keeps_qr_url_for_scan(self):
        old = dict(main.JIMENG_LOGIN_SESSION)
        try:
            main.JIMENG_LOGIN_SESSION.update(
                {
                    "proc": None,
                    "stdout": f"scan {PRIVATE_URL} path={PRIVATE_PATH}",
                    "stderr": f"token={SECRET}",
                }
            )
            with patch.object(main, "run_jimeng_cli", new=AsyncMock(return_value={"balance": 4, "token": SECRET})):
                payload = await main.jimeng_login_status()
            self.assert_private_absent(payload["text"])
            self.assertIn(SECRET, payload["qr_url"])
            self.assertEqual(payload["credit"]["balance"], 4)
            self.assertNotIn("raw", payload)
        finally:
            main.JIMENG_LOGIN_SESSION.clear()
            main.JIMENG_LOGIN_SESSION.update(old)


if __name__ == "__main__":
    unittest.main()
