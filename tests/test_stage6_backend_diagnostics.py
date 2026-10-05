"""验证 ComfyUI 后端探测和输出下载失败不再把地址/异常写到 stdout。"""

import contextlib
import io
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main


class Stage6BackendDiagnosticsTests(unittest.TestCase):
    def test_backend_probe_failures_use_bounded_diagnostics(self):
        output = io.StringIO()
        with patch.object(main, "COMFYUI_INSTANCES", ["127.0.0.1:9999"]), \
                patch.object(main.urllib.request, "urlopen", side_effect=OSError("private-backend-token")), \
                patch.object(main, "write_diagnostic") as report, \
                contextlib.redirect_stdout(output):
            self.assertEqual(main.get_best_backend(), "127.0.0.1:9999")
            self.assertEqual(main.reserve_best_backend(), "127.0.0.1:9999")

        self.assertEqual(output.getvalue(), "")
        self.assertEqual(report.call_count, 2)
        messages = " ".join(str(call.args[0]) for call in report.call_args_list)
        self.assertIn("comfy backend", messages)
        self.assertIn("error=OSError", messages)
        self.assertNotIn("private-backend-token", messages)
        self.assertNotIn("127.0.0.1:9999", messages)

    def test_output_download_failure_uses_diagnostic_and_keeps_fallback(self):
        output = io.StringIO()
        with patch.object(main.urllib.request, "urlopen", side_effect=OSError("private-url-token")), \
                patch.object(main, "write_diagnostic") as report, \
                contextlib.redirect_stdout(output):
            fallback = main.download_image("127.0.0.1:9999", "/view?token=private-url-token")

        self.assertEqual(fallback, "/api/view?token=private-url-token")
        self.assertEqual(output.getvalue(), "")
        report.assert_called_once()
        message = str(report.call_args.args[0])
        self.assertEqual(message, "comfy output download failed error=OSError")
        self.assertNotIn("private-url-token", message)


if __name__ == "__main__":
    unittest.main()
