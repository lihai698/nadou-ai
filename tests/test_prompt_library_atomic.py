"""验证提示词库保存入口的原子替换和损坏文件保护。"""

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main
from backend import atomic_json


class PromptLibraryAtomicTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory(prefix="prompt-library-atomic-")
        self.addCleanup(self.temp_dir.cleanup)
        self.root = Path(self.temp_dir.name)
        self.path = self.root / "data" / "prompt_libraries.json"
        self.path.parent.mkdir(parents=True)
        self.path_patch = patch.object(main, "PROMPT_LIBRARY_PATH", str(self.path))
        self.data_patch = patch.object(main, "DATA_DIR", str(self.path.parent))
        self.path_patch.start()
        self.data_patch.start()
        self.addCleanup(self.path_patch.stop)
        self.addCleanup(self.data_patch.stop)

    def _payload(self, name="自制提示词"):
        return {
            "active_library_id": "system",
            "libraries": [
                {
                    "id": "system",
                    "name": name,
                    "items": [],
                    "categories": [],
                }
            ],
        }

    def test_save_and_load_keep_json_shape(self):
        saved = main.save_prompt_libraries(self._payload())
        self.assertTrue(self.path.is_file())
        self.assertEqual(json.loads(self.path.read_text(encoding="utf-8"))["libraries"][0]["name"], "自制提示词")
        loaded = main.load_prompt_libraries()
        self.assertEqual(loaded["libraries"][0]["name"], saved["libraries"][0]["name"])
        self.assertEqual(set(json.loads(self.path.read_text(encoding="utf-8"))), {"active_library_id", "libraries", "updated_at"})

    def test_replace_failure_keeps_previous_bytes_and_cleans_temp(self):
        main.save_prompt_libraries(self._payload("旧提示词"))
        before = self.path.read_bytes()
        with patch.object(atomic_json.os, "replace", side_effect=OSError("replace failed")):
            with self.assertRaises(OSError):
                main.save_prompt_libraries(self._payload("新提示词"))
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(list(self.path.parent.glob(".prompt_libraries.json.*.tmp")), [])

    def test_corrupt_existing_file_is_preserved_and_not_overwritten(self):
        before = b'{"libraries": [broken]}'
        self.path.write_bytes(before)
        loaded = main.load_prompt_libraries()
        self.assertEqual(loaded["libraries"][0]["id"], "system")
        self.assertEqual(self.path.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
