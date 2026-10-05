"""公开发布包在干净目录启动前的清单与隔离检查。"""

import hashlib
import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools" / "verify-release-startup.py"
SPEC = importlib.util.spec_from_file_location("nadou_verify_release_startup", SCRIPT)
checker = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(checker)


def write_release(root: Path, files: dict[str, bytes], version: str = "2026.10.04") -> None:
    manifest = {}
    for relative, content in files.items():
        target = root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
        manifest[relative] = hashlib.sha256(content).hexdigest()
    (root / "RELEASE_FILES.json").write_text(
        json.dumps({"version": version, "files": manifest}, ensure_ascii=False), encoding="utf-8"
    )


class VerifyReleaseStartupTests(unittest.TestCase):
    def test_valid_manifest_and_version_are_accepted(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_release(
                root,
                {
                    "main.py": b"# isolated app\n",
                    "VERSION": b"2026.10.04\n",
                    "static/index.html": b"<html>isolated</html>\n",
                },
            )
            version, files = checker.validate_release_dir(root)
        self.assertEqual(version, "2026.10.04")
        self.assertEqual(set(files), {"main.py", "VERSION", "static/index.html"})

    def test_hash_mismatch_is_rejected_before_startup(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_release(
                root,
                {
                    "main.py": b"# isolated app\n",
                    "VERSION": b"2026.10.04\n",
                    "static/index.html": b"<html>isolated</html>\n",
                },
            )
            (root / "main.py").write_text("changed\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "哈希不一致"):
                checker.validate_release_dir(root)

    def test_private_data_and_unlisted_files_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_release(
                root,
                {
                    "main.py": b"# isolated app\n",
                    "VERSION": b"2026.10.04\n",
                    "static/index.html": b"<html>isolated</html>\n",
                },
            )
            (root / "data").mkdir()
            (root / "data" / "private.json").write_text("{}", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "清单外文件"):
                checker.validate_release_dir(root)

    def test_private_path_is_rejected_even_when_listed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_release(
                root,
                {
                    "main.py": b"# isolated app\n",
                    "VERSION": b"2026.10.04\n",
                    "static/index.html": b"<html>isolated</html>\n",
                    "API/.env": b"DEMO_KEY=redacted\n",
                },
            )
            with self.assertRaisesRegex(ValueError, "私人路径"):
                checker.validate_release_dir(root)

    def test_sandbox_copy_does_not_write_back_to_release(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            sandbox = root / "sandbox"
            source = root / "release"
            source.mkdir()
            write_release(
                source,
                {
                    "main.py": b"# isolated app\n",
                    "VERSION": b"2026.10.04\n",
                    "static/index.html": b"<html>isolated</html>\n",
                },
            )
            sandbox.mkdir()
            checker._copy_runtime(source, sandbox)
            (sandbox / "data").mkdir()
            (sandbox / "data" / "created-by-startup.json").write_text("{}", encoding="utf-8")
            self.assertFalse((source / "data").exists())
            self.assertTrue((sandbox / "data" / "created-by-startup.json").is_file())

    def test_sensitive_environment_names_are_not_inherited(self):
        with patch.dict(
            os.environ,
            {"ISOLATED_API_KEY": "secret", "ISOLATED_TOKEN": "secret", "SAFE_SETTING": "ok"},
            clear=False,
        ):
            environment = checker._safe_environment()
        self.assertNotIn("ISOLATED_API_KEY", environment)
        self.assertNotIn("ISOLATED_TOKEN", environment)
        self.assertEqual(environment.get("SAFE_SETTING"), "ok")
        self.assertEqual(environment["NADOU_BIND_HOST"], "127.0.0.1")

    def test_missing_runtime_dependencies_fail_before_server_start(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_release(
                root,
                {
                    "main.py": b"# isolated app\n",
                    "VERSION": b"2026.10.04\n",
                    "static/index.html": b"<html>isolated</html>\n",
                    "python/python.exe": b"placeholder",
                },
            )
            interpreter = root / "python" / "python.exe"
            with patch.object(checker.subprocess, "run", return_value=SimpleNamespace(returncode=1)) as probe:
                with self.assertRaisesRegex(RuntimeError, "运行依赖未安装"):
                    checker.verify_startup(root)
            probe.assert_called_once()


if __name__ == "__main__":
    unittest.main()
