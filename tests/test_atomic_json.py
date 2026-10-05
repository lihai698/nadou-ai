"""隔离验证 JSON 原子写入的替换、落盘和异常清理边界。"""

import json
import multiprocessing
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend import atomic_json


def _concurrent_atomic_writer(path, marker):
    for index in range(12):
        atomic_json.write_json_atomic(
            path,
            {"writer": marker, "index": index},
            ensure_ascii=False,
            indent=2,
        )


class AtomicJsonTests(unittest.TestCase):
    def test_windows_sharing_violation_retries_only_the_replace(self):
        class SharingViolation(PermissionError):
            winerror = 32

        with patch.object(
            atomic_json.os,
            "replace",
            side_effect=[SharingViolation(13, "sharing violation"), None],
        ) as replace_mock, patch.object(atomic_json.os, "name", "nt"), patch.object(
            atomic_json.time, "sleep"
        ) as sleep:
            atomic_json._replace_with_windows_retry("temporary", "target")

        self.assertEqual(replace_mock.call_count, 2)
        sleep.assert_called_once_with(atomic_json._WINDOWS_REPLACE_RETRY_INTERVAL)

    def test_persistent_windows_sharing_violation_is_still_reported(self):
        class SharingViolation(PermissionError):
            winerror = 5

        with tempfile.TemporaryDirectory() as root:
            target = Path(root) / "persistent.json"
            target.write_text('{"old": true}', encoding="utf-8")
            with patch.object(atomic_json.os, "name", "nt"), patch.object(
                atomic_json.os, "replace", side_effect=SharingViolation(13, "sharing violation")
            ), patch.object(atomic_json, "_WINDOWS_REPLACE_RETRY_LIMIT", 2), patch.object(
                atomic_json.time, "sleep"
            ):
                with self.assertRaises(SharingViolation):
                    atomic_json.write_json_atomic(target, {"new": True})
            self.assertEqual(target.read_text(encoding="utf-8"), '{"old": true}')
            self.assertEqual(list(target.parent.glob(f".{target.name}.*.tmp")), [])

    def test_success_writes_utf8_json_and_replaces_after_fsync(self):
        with tempfile.TemporaryDirectory() as root:
            target = Path(root) / "nested" / "canvas.json"
            target.parent.mkdir()
            target.write_text('{"old": true}', encoding="utf-8")
            fsync_calls = []
            replace_calls = []
            original_replace = atomic_json.os.replace

            def replace(source, destination):
                replace_calls.append((Path(source), Path(destination)))
                self.assertEqual(Path(source).parent, target.parent)
                self.assertEqual(Path(destination), target)
                self.assertEqual(json.loads(target.read_text(encoding="utf-8")), {"old": True})
                return original_replace(source, destination)

            with patch.object(atomic_json.os, "fsync", side_effect=lambda fd: fsync_calls.append(fd)), \
                    patch.object(atomic_json.os, "replace", side_effect=replace):
                atomic_json.write_json_atomic(target, {"标题": "中文", "nodes": [1, 2]})

            self.assertEqual(json.loads(target.read_text(encoding="utf-8")), {"标题": "中文", "nodes": [1, 2]})
            self.assertTrue(replace_calls)
            self.assertTrue(fsync_calls)
            self.assertEqual(list(target.parent.glob(f".{target.name}.*.tmp")), [])

    def test_replace_failure_keeps_previous_file_and_cleans_temporary(self):
        with tempfile.TemporaryDirectory() as root:
            target = Path(root) / "projects.json"
            target.write_text('{"projects": []}', encoding="utf-8")
            with patch.object(atomic_json.os, "replace", side_effect=OSError("replace failed")):
                with self.assertRaisesRegex(OSError, "replace failed"):
                    atomic_json.write_json_atomic(target, {"projects": [{"id": "p1"}]})
            self.assertEqual(target.read_text(encoding="utf-8"), '{"projects": []}')
            self.assertEqual(list(target.parent.glob(f".{target.name}.*.tmp")), [])

    def test_serialization_failure_keeps_previous_file_and_cleans_temporary(self):
        with tempfile.TemporaryDirectory() as root:
            target = Path(root) / "canvas.json"
            target.write_text('{"valid": true}', encoding="utf-8")
            with self.assertRaises(TypeError):
                atomic_json.write_json_atomic(target, {"invalid": object()})
            self.assertEqual(json.loads(target.read_text(encoding="utf-8")), {"valid": True})
            self.assertEqual(list(target.parent.glob(f".{target.name}.*.tmp")), [])

    def test_concurrent_process_writes_leave_a_complete_json_document(self):
        with tempfile.TemporaryDirectory() as root:
            target = Path(root) / "concurrent.json"
            context = multiprocessing.get_context("spawn")
            processes = [
                context.Process(target=_concurrent_atomic_writer, args=(str(target), marker))
                for marker in ("left", "right")
            ]
            for process in processes:
                process.start()
            for process in processes:
                process.join(30)
                self.assertFalse(process.is_alive())
                self.assertEqual(process.exitcode, 0)

            value = json.loads(target.read_text(encoding="utf-8"))
            self.assertIn(value.get("writer"), {"left", "right"})
            self.assertIn(value.get("index"), range(12))
            self.assertEqual(list(target.parent.glob(f".{target.name}.*.tmp")), [])


if __name__ == "__main__":
    unittest.main()
