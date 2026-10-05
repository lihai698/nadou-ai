"""启动前配置检查只暴露键名和位置，不暴露配置值。"""

import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools" / "check-environment.py"
SPEC = importlib.util.spec_from_file_location("nadou_check_environment", SCRIPT)
checker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(checker)


class EnvironmentConfigTests(unittest.TestCase):
    def test_env_validation_handles_equals_in_secret_without_echoing_value(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env"
            secret = "sk-isolated=part-without-printing"
            path.write_text(
                f'COMFLY_API_KEY="{secret}"\n'
                "REQUEST_TIMEOUT=not-a-number\n"
                "BROKEN_LINE\n",
                encoding="utf-8",
            )
            problems, notices = [], []
            checker.check_env_config(path, problems, notices)
        joined = "\n".join(problems + notices)
        self.assertIn("REQUEST_TIMEOUT", joined)
        self.assertIn("第 3 行", joined)
        self.assertNotIn(secret, joined)

    def test_env_validation_accepts_empty_optional_keys_and_rejects_bad_url(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env"
            path.write_text(
                "MODELSCOPE_API_KEY=\n"
                "COMFLY_API_KEY=\n"
                "COMFLY_BASE_URL=example.invalid\n",
                encoding="utf-8",
            )
            problems, notices = [], []
            checker.check_env_config(path, problems, notices)
        self.assertTrue(any("COMFLY_BASE_URL" in item for item in problems))

    def test_provider_validation_does_not_require_optional_keys(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "api_providers.json"
            path.write_text(
                '[{"id":"demo-provider","name":"隔离示例","enabled":true,"base_url":"https://example.invalid","protocol":"openai"}]',
                encoding="utf-8",
            )
            problems, notices = [], []
            checker.check_provider_config(path, problems, notices)
        self.assertEqual(problems, [])

    def test_private_file_and_user_directories_have_expected_types(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "API").mkdir()
            (root / "API" / ".env").mkdir()
            (root / "data").write_text("wrong", encoding="utf-8")
            (root / "assets").mkdir()
            problems = []
            checker.check_local_path_types(root, problems)
        self.assertIn("API/.env 应为文件", "\n".join(problems))
        self.assertIn("data 应为目录", "\n".join(problems))

    def test_diagnostic_log_limits_are_checked_without_echoing_values(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env"
            path.write_text(
                "DIAGNOSTIC_LOG_MAX_BYTES=999\n"
                "DIAGNOSTIC_LOG_BACKUP_COUNT=21\n",
                encoding="utf-8",
            )
            problems, notices = [], []
            checker.check_env_config(path, problems, notices)
        joined = "\n".join(problems + notices)
        self.assertIn("DIAGNOSTIC_LOG_MAX_BYTES", joined)
        self.assertIn("DIAGNOSTIC_LOG_BACKUP_COUNT", joined)

    def test_diagnostic_log_limits_accept_documented_range(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env"
            path.write_text(
                "DIAGNOSTIC_LOG_MAX_BYTES=1024\n"
                "DIAGNOSTIC_LOG_BACKUP_COUNT=20\n",
                encoding="utf-8",
            )
            problems, notices = [], []
            checker.check_env_config(path, problems, notices)
        self.assertEqual(problems, [])

    def test_disk_space_check_reports_low_space_without_reading_files(self):
        with tempfile.TemporaryDirectory() as directory:
            problems = []
            fake_usage = type("Usage", (), {"free": 99})()
            with patch.object(checker.shutil, "disk_usage", return_value=fake_usage) as disk_usage:
                result = checker.check_disk_space(
                    Path(directory) / "not-created-yet", 100, problems
                )
        self.assertEqual(result, 99)
        self.assertIn("磁盘可用空间不足", "\n".join(problems))
        disk_usage.assert_called_once()

    def test_disk_space_check_zero_is_disabled_and_negative_is_rejected(self):
        problems = []
        with patch.object(checker.shutil, "disk_usage") as disk_usage:
            self.assertIsNone(checker.check_disk_space("C:/isolated", 0, problems))
        disk_usage.assert_not_called()
        checker.check_disk_space("C:/isolated", -1, problems)
        self.assertIn("非负整数", "\n".join(problems))


if __name__ == "__main__":
    unittest.main()
