"""验证配置/启动读取失败只写受控诊断，不把异常正文写到 stdout。"""

import contextlib
import io
import pathlib
import tempfile
import unittest
from unittest.mock import patch

import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import main


SECRET = "config-private-token-987"


class Stage6ConfigDiagnosticsTests(unittest.TestCase):
    def assert_diagnostic_only(self, operation, event):
        output = io.StringIO()
        with patch.object(main, "write_diagnostic") as report, contextlib.redirect_stdout(output):
            operation()
        self.assertEqual(output.getvalue(), "")
        report.assert_called_once()
        message = str(report.call_args.args[0])
        self.assertIn(event, message)
        self.assertNotIn(SECRET, message)

    def test_storage_settings_failure_uses_controlled_diagnostic(self):
        with patch.object(
            main, "_read_storage_settings_raw", side_effect=RuntimeError(SECRET)
        ):
            result = None

            def operation():
                nonlocal result
                result = main.load_storage_settings()

            self.assert_diagnostic_only(operation, "storage settings load failed")
            self.assertEqual(set(result["dirs"]), {"upload", "generated", "local"})

    def test_runtime_env_failures_do_not_echo_exception_text(self):
        with tempfile.TemporaryDirectory(prefix="stage6-config-") as directory:
            with patch.object(
                main.local_env,
                "ensure_runtime_files",
                side_effect=RuntimeError(SECRET),
            ), patch.object(main, "API_ENV_FILE", str(pathlib.Path(directory) / ".env")), patch.object(
                main, "DATA_DIR", directory
            ):
                self.assert_diagnostic_only(
                    main.ensure_runtime_config_files,
                    "runtime config initialization failed",
                )

            with patch.object(
                main.local_env,
                "load_env_file",
                side_effect=RuntimeError(SECRET),
            ):
                self.assert_diagnostic_only(main.load_env_file, "runtime env load failed")

    def test_provider_and_template_load_failures_do_not_echo_raw_exception(self):
        with tempfile.TemporaryDirectory(prefix="stage6-provider-") as directory:
            path = pathlib.Path(directory) / "api_providers.json"
            path.write_text("{}", encoding="utf-8")
            with patch.object(main, "STATIC_RUNNINGHUB_API_PROVIDERS_FILE", str(path)), patch.object(
                main.json, "load", side_effect=RuntimeError(SECRET)
            ):
                self.assert_diagnostic_only(
                    main.load_static_runninghub_provider,
                    "static RunningHub config load failed",
                )

            path.write_text("{}", encoding="utf-8")
            with patch.object(main, "API_PROVIDERS_FILE", str(path)), patch.object(
                main.json, "load", side_effect=RuntimeError(SECRET)
            ):
                self.assert_diagnostic_only(
                    main.load_api_providers,
                    "API provider config load failed",
                )

            path.write_text("{}", encoding="utf-8")
            with patch.object(main, "STATIC_RUNNINGHUB_DIR", directory), patch.object(
                main, "STATIC_RUNNINGHUB_API_PROVIDERS_FILE", str(path)
            ), patch.object(main.json, "load", side_effect=RuntimeError(SECRET)), patch.object(
                main, "write_json_atomic"
            ):
                self.assert_diagnostic_only(
                    lambda: main.mutate_static_runninghub_provider(lambda provider: False),
                    "static RunningHub template read failed",
                )

    def test_static_html_sync_failure_uses_fixed_event(self):
        with tempfile.TemporaryDirectory(prefix="stage6-html-") as directory:
            pathlib.Path(directory, "index.html").write_text("<html></html>", encoding="utf-8")
            with patch.object(main, "STATIC_DIR", directory), patch.object(
                main, "current_app_version", return_value="2026.10.04"
            ), patch.object(
                main, "versioned_static_html", side_effect=RuntimeError(SECRET)
            ):
                self.assert_diagnostic_only(
                    main.sync_static_html_versions,
                    "static html version sync failed scope=file",
                )

    def test_unwritable_custom_log_path_falls_back_without_startup_failure(self):
        calls = []
        expected_path = pathlib.Path("C:/isolated-data") / "logs" / "diagnostics.log"

        def configure(path, **kwargs):
            calls.append((path, kwargs))
            if len(calls) == 1:
                raise PermissionError("diagnostic-private-token")
            return str(path)

        with patch.dict(
            main.os.environ,
            {
                "DIAGNOSTIC_LOG_FILE": str(pathlib.Path("Z:/unwritable") / "diagnostics.log"),
                "DIAGNOSTIC_LOG_MAX_BYTES": "4096",
                "DIAGNOSTIC_LOG_BACKUP_COUNT": "2",
            },
            clear=False,
        ), patch.object(main, "DATA_DIR", str(pathlib.Path("C:/isolated-data"))), patch.object(
            main, "configure_diagnostics", side_effect=configure
        ), patch.object(main, "write_diagnostic") as report:
            result = main.configure_runtime_diagnostics()

        self.assertEqual(result, str(expected_path))
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[1][1]["max_bytes"], "4096")
        self.assertEqual(calls[1][1]["backup_count"], "2")
        report.assert_called_once()
        message = str(report.call_args.args[0])
        self.assertIn("diagnostic log path fallback", message)
        self.assertNotIn("diagnostic-private-token", message)


if __name__ == "__main__":
    unittest.main()
