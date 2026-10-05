"""验证供应商失败回包只生成可读摘要，不把 raw JSON 或凭据带入日志/错误详情。"""

import contextlib
import io
import pathlib
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import main


class UpstreamErrorSanitizationTests(unittest.TestCase):
    def test_summary_extracts_message_and_redacts_credentials(self):
        payload = {
            "code": 401,
            "msg": "bad apiKey=top-secret at https://provider.test/v1/jobs?token=top-secret",
            "data": {
                "error": {"message": "Authorization: Bearer top-secret"},
                "apiKey": "top-secret",
            },
        }
        summary = main.upstream_error_summary(payload)
        self.assertIn("code=401", summary)
        self.assertIn("bad apiKey=<redacted>", summary)
        self.assertIn("provider.test/v1/jobs", summary)
        self.assertNotIn("top-secret", summary)
        self.assertNotIn("?token=", summary)

    def test_runninghub_error_detail_does_not_expose_raw_payload(self):
        payload = {
            "code": 500,
            "msg": "gateway failed",
            "debug": {"apiKey": "top-secret", "body": "private"},
        }
        detail = main.runninghub_error_detail(
            "RunningHub HTTP 500",
            payload,
            endpoint="https://provider.test/task?apiKey=top-secret",
            taskId="task-1",
        )
        self.assertNotIn("raw", detail)
        self.assertEqual(detail["endpoint"], "https://provider.test/task")
        self.assertEqual(detail["taskId"], "task-1")
        self.assertIn("gateway failed", detail["error_summary"])
        self.assertNotIn("top-secret", str(detail))
        self.assertNotIn("private", str(detail))

    def test_runninghub_error_log_uses_bounded_summary(self):
        output = io.StringIO()
        diagnostics = []
        payload = {
            "code": "E_BAD",
            "msg": "x" * 2000,
            "apiKey": "top-secret",
        }
        with patch.object(main, "write_diagnostic", side_effect=diagnostics.append), contextlib.redirect_stdout(output):
            main.log_runninghub_error(
                "submit-rejected",
                payload,
                endpoint="https://provider.test/task?apiKey=top-secret",
            )
        self.assertEqual(output.getvalue(), "")
        text = " ".join(diagnostics)
        self.assertIn("error_summary", text)
        self.assertNotIn('"raw"', text)
        self.assertNotIn("top-secret", text)
        self.assertLessEqual(len(text), 1250)

    def test_fail_reason_does_not_return_nested_raw_json(self):
        reason = main.runninghub_fail_reason(
            {
                "data": {
                    "failedReason": {
                        "message": "invalid token=top-secret",
                        "debug": "private raw body",
                    }
                }
            }
        )
        self.assertIn("invalid token=<redacted>", reason)
        self.assertNotIn("private raw body", reason)
        self.assertNotIn("top-secret", reason)


if __name__ == "__main__":
    unittest.main()
