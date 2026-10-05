"""验证本地 .env 读写边界，不读取工作区私人配置。"""

import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend import local_env


class LocalEnvTests(unittest.TestCase):
    def test_load_and_read_ignore_comments_and_keep_existing_environment(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "API" / ".env"
            path.parent.mkdir()
            path.write_text("# comment\nA=from-file\nB=\"quoted value\"\n", encoding="utf-8")
            environ = {"A": "from-process"}
            local_env.load_env_file(str(path), environ)
            self.assertEqual(environ, {"A": "from-process", "B": "quoted value"})
            self.assertEqual(local_env.read_env_value(str(path), "A"), "from-file")
            self.assertEqual(local_env.read_env_value(str(path), "missing"), "")

    def test_update_preserves_comments_and_quotes_values_with_spaces(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env"
            path.write_text("# keep\nA=old\nCUSTOM=value\n", encoding="utf-8")
            environ = {}
            local_env.update_env_values(str(path), {"A": "new value", "B": "x#y"}, environ)
            self.assertEqual(environ, {"A": "new value", "B": "x#y"})
            self.assertEqual(
                path.read_text(encoding="utf-8"),
                '# keep\nA="new value"\nCUSTOM=value\nB="x#y"\n',
            )

    def test_ensure_runtime_files_creates_only_requested_public_directories(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            env_path = root / "API" / ".env"
            data_dir = root / "data"
            local_env.ensure_runtime_files(str(env_path), str(data_dir))
            self.assertTrue(env_path.is_file())
            self.assertTrue(data_dir.is_dir())
            self.assertEqual(env_path.read_text(encoding="utf-8"), "")

    def test_failed_replace_keeps_old_config_and_process_environment(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env"
            path.write_text("# keep\nA=old\n", encoding="utf-8")
            environ = {"A": "old"}
            with patch.object(local_env.os, "replace", side_effect=OSError("replace failed")):
                with self.assertRaisesRegex(OSError, "replace failed"):
                    local_env.update_env_values(str(path), {"A": "new", "B": "secret"}, environ)
            self.assertEqual(path.read_text(encoding="utf-8"), "# keep\nA=old\n")
            self.assertEqual(environ, {"A": "old"})
            self.assertEqual(list(path.parent.glob(".env.*.tmp")), [])

    def test_concurrent_updates_in_one_process_keep_both_keys(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env"
            path.write_text("# keep\n", encoding="utf-8")
            environ = {}
            with ThreadPoolExecutor(max_workers=2) as pool:
                futures = [
                    pool.submit(local_env.update_env_values, str(path), {"A": "one"}, environ),
                    pool.submit(local_env.update_env_values, str(path), {"B": "two"}, environ),
                ]
                for future in futures:
                    future.result()
            self.assertEqual(local_env.read_env_value(str(path), "A"), "one")
            self.assertEqual(local_env.read_env_value(str(path), "B"), "two")
            self.assertEqual(environ, {"A": "one", "B": "two"})


if __name__ == "__main__":
    unittest.main()
