"""固定版本模块的旧行为，避免更新检查拆分后出现比较差异。"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.versioning import version_gt, version_tuple


class VersioningTests(unittest.TestCase):
    def test_version_tuple_keeps_numeric_segments_and_tolerates_empty_values(self):
        self.assertEqual(version_tuple("release-2026.10.03"), [2026, 10, 3])
        self.assertEqual(version_tuple(""), [])
        self.assertEqual(version_tuple(None), [])

    def test_version_gt_pads_missing_segments(self):
        self.assertTrue(version_gt("2026.10.1", "2026.10"))
        self.assertFalse(version_gt("2026.10", "2026.10.0"))
        self.assertFalse(version_gt("2026.10", "2026.10.1"))

    def test_version_gt_handles_non_version_text_without_throwing(self):
        self.assertFalse(version_gt("unknown", ""))
        self.assertTrue(version_gt("v2", "v1"))


if __name__ == "__main__":
    unittest.main()
