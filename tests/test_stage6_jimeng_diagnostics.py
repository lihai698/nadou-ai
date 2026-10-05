"""验证即梦 WSL 发行版回退只写受控诊断，不回显本机配置。"""

import contextlib
import io
import pathlib
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import main


SECRET_DISTRO = "private-distro-token-123"


class FakeCompletedProcess:
    stdout = b"Ubuntu\r\nDebian\r\n"


class Stage6JimengDiagnosticsTests(unittest.TestCase):
    def test_unavailable_configured_distro_uses_safe_diagnostic(self):
        output = io.StringIO()
        with patch.object(main, "jimeng_env_value", return_value=SECRET_DISTRO), patch.object(
            main.subprocess, "run", return_value=FakeCompletedProcess()
        ), patch.object(main, "write_diagnostic") as report, contextlib.redirect_stdout(output):
            result = main.jimeng_wsl_base_args("wsl.exe")

        self.assertEqual(result, ["-d", "Ubuntu"])
        self.assertEqual(output.getvalue(), "")
        report.assert_called_once()
        message = str(report.call_args.args[0])
        self.assertIn("jimeng wsl distro unavailable", message)
        self.assertIn("configured_present=True", message)
        self.assertIn("available_count=2", message)
        self.assertNotIn(SECRET_DISTRO, message)
        self.assertNotIn("Ubuntu", message)
        self.assertNotIn("Debian", message)


if __name__ == "__main__":
    unittest.main()
