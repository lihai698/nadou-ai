"""隔离验证项目快照创建、校验和恢复边界。"""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.backup_restore import (
    BackupRestoreError,
    SNAPSHOT_MANIFEST_NAME,
    create_snapshot,
    restore_snapshot,
    verify_snapshot,
)


class BackupRestoreTests(unittest.TestCase):
    def _source(self, root: Path) -> Path:
        source = root / "source"
        (source / "data" / "canvases").mkdir(parents=True)
        (source / "data" / "canvases" / "c1.json").write_text(
            '{"id":"c1","format_version":1}', encoding="utf-8"
        )
        (source / "API").mkdir()
        (source / "API" / ".env").write_text("自制测试配置", encoding="utf-8")
        (source / "__pycache__").mkdir()
        (source / "__pycache__" / "ignored.pyc").write_bytes(b"ignored")
        return source

    def test_create_verify_restore_roundtrip_and_excludes_cache(self):
        with tempfile.TemporaryDirectory(prefix="backup-restore-") as directory:
            root = Path(directory)
            source = self._source(root)
            snapshot = root / "snapshot"
            restored = root / "restored"

            created = create_snapshot(source, snapshot)
            self.assertEqual(created["file_count"], 2)
            self.assertEqual(verify_snapshot(snapshot), created)
            restored_result = restore_snapshot(snapshot, restored)
            self.assertEqual(restored_result, created)
            self.assertEqual(
                (restored / "data" / "canvases" / "c1.json").read_text(encoding="utf-8"),
                (source / "data" / "canvases" / "c1.json").read_text(encoding="utf-8"),
            )
            self.assertEqual((restored / "API" / ".env").read_text(encoding="utf-8"), "自制测试配置")
            self.assertFalse((restored / "__pycache__").exists())

    def test_verify_rejects_hash_change_and_extra_file(self):
        with tempfile.TemporaryDirectory(prefix="backup-restore-") as directory:
            root = Path(directory)
            source = self._source(root)
            snapshot = root / "snapshot"
            create_snapshot(source, snapshot)
            target = snapshot / "data" / "canvases" / "c1.json"
            target.write_text('{"id":"c1","changed":true}', encoding="utf-8")
            with self.assertRaisesRegex(BackupRestoreError, "校验失败"):
                verify_snapshot(snapshot)
            target.write_text('{"id":"c1","format_version":1}', encoding="utf-8")
            (snapshot / "extra.txt").write_text("extra", encoding="utf-8")
            with self.assertRaisesRegex(BackupRestoreError, "清单外"):
                verify_snapshot(snapshot)

    def test_manifest_path_and_symlink_are_rejected(self):
        with tempfile.TemporaryDirectory(prefix="backup-restore-") as directory:
            root = Path(directory)
            source = self._source(root)
            (source / SNAPSHOT_MANIFEST_NAME).write_text("不能伪造清单", encoding="utf-8")
            with self.assertRaises(BackupRestoreError):
                create_snapshot(source, root / "snapshot")
            linked = source / "linked.txt"
            try:
                linked.symlink_to(source / "API" / ".env")
            except (OSError, NotImplementedError):
                self.skipTest("当前系统不支持创建符号链接")
            with self.assertRaises(BackupRestoreError):
                create_snapshot(source, root / "snapshot-2")
            linked.unlink()

            linked_dir = source / ".git"
            try:
                linked_dir.symlink_to(source / "API", target_is_directory=True)
            except (OSError, NotImplementedError):
                self.skipTest("当前系统不支持创建目录符号链接")
            with self.assertRaises(BackupRestoreError):
                create_snapshot(source, root / "snapshot-3")

    def test_manifest_rejects_non_string_and_case_colliding_paths(self):
        with tempfile.TemporaryDirectory(prefix="backup-restore-") as directory:
            root = Path(directory)
            source = self._source(root)
            snapshot = root / "snapshot"
            create_snapshot(source, snapshot)
            manifest_path = snapshot / SNAPSHOT_MANIFEST_NAME
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["files"][0]["path"] = 123
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            with self.assertRaisesRegex(BackupRestoreError, "路径无效"):
                verify_snapshot(snapshot)

            create_snapshot(source, root / "snapshot-2")
            manifest_path = root / "snapshot-2" / SNAPSHOT_MANIFEST_NAME
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            duplicate = dict(manifest["files"][0])
            duplicate["path"] = duplicate["path"].swapcase()
            manifest["files"].append(duplicate)
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            with self.assertRaisesRegex(BackupRestoreError, "不安全路径"):
                verify_snapshot(root / "snapshot-2")

    def test_cli_create_verify_restore_roundtrip(self):
        with tempfile.TemporaryDirectory(prefix="backup-restore-cli-") as directory:
            root = Path(directory)
            source = self._source(root)
            snapshot = root / "snapshot"
            restored = root / "restored"
            command = [sys.executable, str(Path(__file__).resolve().parents[1] / "tools" / "backup-restore.py")]

            created = subprocess.run(
                command + ["create", "--source", str(source), "--snapshot", str(snapshot)],
                capture_output=True, text=True, check=False,
            )
            self.assertEqual(created.returncode, 0, created.stderr)
            self.assertIn("format_version=1", created.stdout)
            self.assertNotIn("自制测试配置", created.stdout + created.stderr)

            verified = subprocess.run(
                command + ["verify", "--snapshot", str(snapshot)],
                capture_output=True, text=True, check=False,
            )
            self.assertEqual(verified.returncode, 0, verified.stderr)
            restored_result = subprocess.run(
                command + ["restore", "--snapshot", str(snapshot), "--destination", str(restored)],
                capture_output=True, text=True, check=False,
            )
            self.assertEqual(restored_result.returncode, 0, restored_result.stderr)
            self.assertEqual(
                (restored / "data" / "canvases" / "c1.json").read_text(encoding="utf-8"),
                (source / "data" / "canvases" / "c1.json").read_text(encoding="utf-8"),
            )

    def test_existing_destinations_and_copy_failure_leave_no_partial_dir(self):
        with tempfile.TemporaryDirectory(prefix="backup-restore-") as directory:
            root = Path(directory)
            source = self._source(root)
            existing = root / "existing"
            existing.mkdir()
            with self.assertRaisesRegex(BackupRestoreError, "不存在的新目录"):
                create_snapshot(source, existing)
            snapshot = root / "snapshot"
            with patch("backend.backup_restore.shutil.copy2", side_effect=OSError("synthetic copy failure")):
                with self.assertRaisesRegex(BackupRestoreError, "复制失败"):
                    create_snapshot(source, snapshot)
            self.assertFalse(snapshot.exists())
            self.assertEqual(list(root.glob(".snapshot.*")), [])

    def test_restore_refuses_existing_destination_after_source_verification(self):
        with tempfile.TemporaryDirectory(prefix="backup-restore-") as directory:
            root = Path(directory)
            snapshot = root / "snapshot"
            create_snapshot(self._source(root), snapshot)
            destination = root / "restored"
            destination.mkdir()
            (destination / "keep.txt").write_text("keep", encoding="utf-8")
            with self.assertRaisesRegex(BackupRestoreError, "不存在的新目录"):
                restore_snapshot(snapshot, destination)
            self.assertEqual((destination / "keep.txt").read_text(encoding="utf-8"), "keep")


if __name__ == "__main__":
    unittest.main()
