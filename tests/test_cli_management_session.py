"""即梦登录管理仅操作注入的会话与模拟进程，不执行真实登录。"""
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main


class CliManagementSessionTests(unittest.IsolatedAsyncioTestCase):
    async def test_reader_stops_at_eof_and_updates_current_session_streams(self):
        session = {"stdout": "prefix:", "stderr": ""}
        process = SimpleNamespace(stdout=SimpleNamespace(readline=AsyncMock(side_effect=[b"out", b""])),
                                  stderr=SimpleNamespace(readline=AsyncMock(side_effect=[b"err", b""])))
        with patch.object(main, "JIMENG_LOGIN_SESSION", session), patch.object(main, "jimeng_use_wsl", return_value=False), patch.object(
            main, "jimeng_clean_wsl_stderr", side_effect=lambda text: "clean:" + text
        ):
            await main.jimeng_login_reader(process)
        self.assertEqual(session, {"stdout": "prefix:out", "stderr": "clean:err"})
        self.assertEqual(process.stdout.readline.await_count, 2)
        self.assertEqual(process.stderr.readline.await_count, 2)

    async def test_login_replaces_old_process_without_leaking_raw_text(self):
        previous = SimpleNamespace(returncode=None, terminate=Mock())
        current = SimpleNamespace(returncode=None)
        session = {"proc": previous, "stdout": "old", "stderr": "old"}
        started = []
        def record_task(coro):
            started.append(coro)
            coro.close()
        with patch.object(main, "JIMENG_LOGIN_SESSION", session), patch.object(main, "jimeng_cli_executable", return_value="dreamina"), patch.object(
            main, "jimeng_command", return_value=["dreamina", "login", "--headless"]
        ), patch.object(main.asyncio, "create_subprocess_exec", new=AsyncMock(return_value=current)), patch.object(
            main.asyncio, "create_task", side_effect=record_task
        ), patch.object(main.asyncio, "sleep", new=AsyncMock()), patch.object(main, "jimeng_login_reader", new=AsyncMock()), patch.object(
            main, "jimeng_login_text", return_value="scan https://example.test/login?token=synthetic-private"
        ):
            result = await main.jimeng_login_start()
        previous.terminate.assert_called_once()
        self.assertIs(session["proc"], current)
        self.assertEqual(session["stdout"], "")
        self.assertEqual(len(started), 1)
        self.assertTrue(result["running"])
        self.assertNotIn("synthetic-private", result["text"])
        self.assertEqual(result["qr_url"], "https://example.test/login?token=synthetic-private")


if __name__ == "__main__":
    unittest.main()
