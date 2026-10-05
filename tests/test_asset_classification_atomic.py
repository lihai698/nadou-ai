"""验证本地素材分类旁车 JSON 的原子写入和损坏读取边界。"""

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main
from backend import atomic_json


class AssetClassificationAtomicTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="asset-classification-atomic-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.uploads = self.root / "assets" / "uploads"
        self.uploads.mkdir(parents=True)
        self.path_patch = patch.object(main, "LOCAL_UPLOAD_DIR", str(self.uploads))
        self.path_patch.start()
        self.addCleanup(self.path_patch.stop)

    def _classification_path(self, filename="folder/photo.png"):
        return Path(main._local_upload_classification_path(filename))

    def test_write_is_atomic_and_round_trips_normalized_shape(self):
        main._write_local_upload_classification(
            "folder/photo.png",
            {
                "summary": "  隔离测试图片  ",
                "categories": {"Style": ["电影感", "电影感", "", "写实"]},
                "tags": ["#产品", "产品", "电商"],
            },
        )

        path = self._classification_path()
        self.assertTrue(path.is_file())
        saved = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(saved["summary"], "隔离测试图片")
        self.assertEqual(saved["categories"], {"style": ["电影感", "写实"]})
        self.assertEqual(saved["tags"], ["产品", "电商"])
        self.assertEqual(main._read_local_upload_classification("folder/photo.png")["categories"], saved["categories"])
        self.assertEqual(list(path.parent.glob(f".{path.name}.*.tmp")), [])

    def test_replace_failure_preserves_previous_sidecar_and_cleans_temp(self):
        main._write_local_upload_classification("photo.png", {"summary": "旧分类"})
        path = self._classification_path("photo.png")
        before = path.read_bytes()

        with patch.object(atomic_json.os, "replace", side_effect=OSError("replace failed")):
            with self.assertRaises(OSError):
                main._write_local_upload_classification("photo.png", {"summary": "新分类"})

        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(list(path.parent.glob(f".{path.name}.*.tmp")), [])

    def test_corrupt_sidecar_is_ignored_without_overwriting_original_bytes(self):
        path = self._classification_path("broken.png")
        path.parent.mkdir(parents=True, exist_ok=True)
        before = b'{"categories": [broken]}'
        path.write_bytes(before)

        self.assertIsNone(main._read_local_upload_classification("broken.png"))
        self.assertEqual(path.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
