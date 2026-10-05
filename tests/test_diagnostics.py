"""验证诊断日志单条限制和按大小轮转。"""

import logging
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend import diagnostics


class DiagnosticsTests(unittest.TestCase):
    def tearDown(self):
        diagnostics.configure_diagnostics("")

    def test_empty_path_disables_file_logging(self):
        self.assertEqual(diagnostics.configure_diagnostics(""), "")
        self.assertFalse(diagnostics.diagnostics_configured())

    def test_file_logging_rotates_and_limits_each_record(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "logs" / "diagnostics.log"
            diagnostics.configure_diagnostics(str(path), max_bytes=4096, backup_count=2)
            try:
                diagnostics.write_diagnostic("x" * 5000, level=logging.WARNING)
                self.assertIn("x" * 2000, path.read_text(encoding="utf-8"))
                self.assertNotIn("x" * 2001, path.read_text(encoding="utf-8"))

                for _ in range(9):
                    diagnostics.write_diagnostic("y" * 1000)

                files = list(path.parent.glob("diagnostics.log*"))
                self.assertTrue(path.is_file())
                self.assertTrue(path.with_name(path.name + ".1").is_file())
                self.assertLessEqual(len(files), 3)
                self.assertTrue(all(item.stat().st_size <= 4096 for item in files))
            finally:
                diagnostics.configure_diagnostics("")

    def test_rotation_limits_are_bounded(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "diagnostics.log"
            diagnostics.configure_diagnostics(
                str(path), max_bytes=1, backup_count=999
            )
            try:
                self.assertIsNotNone(diagnostics._HANDLER)
                self.assertEqual(diagnostics._HANDLER.maxBytes, diagnostics.MIN_MAX_BYTES)
                self.assertEqual(diagnostics._HANDLER.backupCount, diagnostics.MAX_BACKUP_COUNT)
            finally:
                diagnostics.configure_diagnostics("")

            diagnostics.configure_diagnostics(
                str(path), max_bytes=10**30, backup_count=-5
            )
            try:
                self.assertEqual(diagnostics._HANDLER.maxBytes, diagnostics.MAX_MAX_BYTES)
                self.assertEqual(diagnostics._HANDLER.backupCount, diagnostics.MIN_BACKUP_COUNT)
            finally:
                diagnostics.configure_diagnostics("")


if __name__ == "__main__":
    unittest.main()
