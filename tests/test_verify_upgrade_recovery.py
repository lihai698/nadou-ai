"""隔离演练升级、保留私人文件和中断恢复。"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools" / "verify-upgrade-recovery.py"
SPEC = importlib.util.spec_from_file_location("nadou_verify_upgrade_recovery", SCRIPT)
assert SPEC and SPEC.loader
checker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(checker)


class VerifyUpgradeRecoveryTests(unittest.TestCase):
    def _write(self, root: Path, relative: str, content: bytes) -> None:
        target = root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)

    def _hashes(self, root: Path) -> dict[str, str]:
        result = {}
        for path in sorted(path for path in root.rglob("*") if path.is_file()):
            relative = path.relative_to(root).as_posix()
            if relative == ".git/ignored" or relative.startswith("__pycache__/"):
                continue
            result[relative] = hashlib.sha256(path.read_bytes()).hexdigest()
        return result

    def _fixtures(self, root: Path) -> tuple[Path, Path]:
        source = root / "source"
        candidate = root / "candidate"
        for relative, content in {
            "main.py": b'APP_VERSION = "before"\n',
            "VERSION": b"2026.08.28\n",
            "static/index.html": b"<title>before</title>\n",
            "API/.env": b"SAMPLE_SECRET=isolated\n",
            "data/asset_library.json": b'{"items":["private"]}\n',
            "data/canvases/sample.json": b'{"nodes":[{"id":"private"}]}\n',
            "assets/sample.png": b"private-image",
            "history.json": b'[{"id":"private"}]\n',
        }.items():
            self._write(source, relative, content)
        for relative, content in {
            "main.py": b'APP_VERSION = "after"\n',
            "VERSION": b"2026.10.03\n",
            "static/index.html": b"<title>after</title>\n",
            "static/update-notes.json": json.dumps(
                {"version": "2026.10.03", "update_mode": "in_app", "items": []}
            ).encode("utf-8"),
            # A staged server response may contain private paths; the updater
            # must leave them out of the allowed file list.
            "API/.env": b"SAMPLE_SECRET=must-not-install\n",
            "data/asset_library.json": b'{"items":[]}\n',
        }.items():
            self._write(candidate, relative, content)
        return source, candidate

    def test_isolated_upgrade_and_interrupted_recovery_preserve_private_data(self):
        with tempfile.TemporaryDirectory(prefix="verify-upgrade-recovery-") as directory:
            root = Path(directory)
            source, candidate = self._fixtures(root)
            before = self._hashes(source)
            result = checker.verify_upgrade_recovery(
                source,
                candidate,
                root / "workspace",
                expected_version="2026.10.03",
            )
            self.assertEqual(result["version"], "2026.10.03")
            self.assertTrue(result["rollback_verified"])
            self.assertTrue(result["interrupted_upgrade_recovered"])
            self.assertGreaterEqual(result["ignored_candidate_file_count"], 2)
            self.assertEqual(self._hashes(source), before)
            self.assertEqual((root / "workspace" / "upgraded" / "VERSION").read_text(), "2026.10.03\n")
            self.assertEqual(
                (root / "workspace" / "upgraded" / "API" / ".env").read_bytes(),
                b"SAMPLE_SECRET=isolated\n",
            )
            self.assertEqual(
                (root / "workspace" / "interrupted-recovered" / "data" / "asset_library.json").read_bytes(),
                b'{"items":["private"]}\n',
            )

    def test_candidate_requires_in_app_notes_and_cli_does_not_echo_private_values(self):
        with tempfile.TemporaryDirectory(prefix="verify-upgrade-recovery-") as directory:
            root = Path(directory)
            source, candidate = self._fixtures(root)
            notes = candidate / "static" / "update-notes.json"
            payload = json.loads(notes.read_text(encoding="utf-8"))
            payload["update_mode"] = "full_install"
            notes.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(checker.UpgradeRecoveryError, "in_app"):
                checker.verify_upgrade_recovery(source, candidate, root / "rejected")

            # Restore a valid candidate and exercise the public CLI as a subprocess.
            payload["update_mode"] = "in_app"
            notes.write_text(json.dumps(payload), encoding="utf-8")
            command = [
                sys.executable,
                str(SCRIPT),
                "--source",
                str(source),
                "--candidate",
                str(candidate),
                "--workspace",
                str(root / "cli-workspace"),
                "--expected-version",
                "2026.10.03",
            ]
            completed = subprocess.run(
                command,
                capture_output=True,
                text=True,
                encoding="utf-8",
                env={**os.environ, "PYTHONIOENCODING": "utf-8"},
                check=False,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertIn("升级恢复演练通过", completed.stdout)
            self.assertNotIn("SAMPLE_SECRET", completed.stdout + completed.stderr)

    def test_candidate_symlink_is_rejected(self):
        with tempfile.TemporaryDirectory(prefix="verify-upgrade-recovery-") as directory:
            root = Path(directory)
            source, candidate = self._fixtures(root)
            link = candidate / "static" / "linked.js"
            try:
                link.symlink_to(candidate / "main.py")
            except (OSError, NotImplementedError):
                self.skipTest("当前系统不支持创建符号链接")
            with self.assertRaisesRegex(checker.UpgradeRecoveryError, "普通文件"):
                checker.verify_upgrade_recovery(source, candidate, root / "symlink-rejected")

    def test_candidate_must_be_newer_and_have_valid_python(self):
        with tempfile.TemporaryDirectory(prefix="verify-upgrade-recovery-") as directory:
            root = Path(directory)
            source, candidate = self._fixtures(root)
            (candidate / "VERSION").write_text("2026.08.28\n", encoding="utf-8")
            (candidate / "static" / "update-notes.json").write_text(
                json.dumps({"version": "2026.08.28", "update_mode": "in_app", "items": []}),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(checker.UpgradeRecoveryError, "不高于"):
                checker.verify_upgrade_recovery(source, candidate, root / "same-version")

            (candidate / "VERSION").write_text("2026.10.03\n", encoding="utf-8")
            (candidate / "static" / "update-notes.json").write_text(
                json.dumps({"version": "2026.10.03", "update_mode": "in_app", "items": []}),
                encoding="utf-8",
            )
            (candidate / "main.py").write_text("def broken(:\n", encoding="utf-8")
            with self.assertRaisesRegex(checker.UpgradeRecoveryError, "语法检查"):
                checker.verify_upgrade_recovery(source, candidate, root / "syntax-error")

    def test_root_symlink_is_rejected(self):
        with tempfile.TemporaryDirectory(prefix="verify-upgrade-recovery-") as directory:
            root = Path(directory)
            source, candidate = self._fixtures(root)
            alias = root / "candidate-alias"
            try:
                alias.symlink_to(candidate, target_is_directory=True)
            except (OSError, NotImplementedError):
                self.skipTest("当前系统不支持创建符号链接")
            with self.assertRaisesRegex(checker.UpgradeRecoveryError, "普通目录"):
                checker.verify_upgrade_recovery(source, alias, root / "root-symlink")


if __name__ == "__main__":
    unittest.main()
