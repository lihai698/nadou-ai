"""History deletion must not break media still used elsewhere."""

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main


class HistoryCleanupTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.assets = self.root / "assets"
        self.generated = self.assets / "output"
        self.inputs = self.assets / "input"
        self.canvases = self.root / "data" / "canvases"
        self.conversations = self.root / "data" / "conversations"
        for path in (self.generated, self.inputs, self.canvases, self.conversations):
            path.mkdir(parents=True, exist_ok=True)
        self.history = self.root / "history.json"
        self.library = self.root / "data" / "asset_library.json"
        self.history.write_text("[]", encoding="utf-8")
        self.patches = [
            patch.object(main, "ASSETS_DIR", str(self.assets)),
            patch.object(main, "OUTPUT_OUTPUT_DIR", str(self.generated)),
            patch.object(main, "OUTPUT_DIR", str(self.root / "legacy-output")),
            patch.object(main, "CANVAS_DIR", str(self.canvases)),
            patch.object(main, "CONVERSATION_DIR", str(self.conversations)),
            patch.object(main, "ASSET_LIBRARY_PATH", str(self.library)),
            patch.object(main, "HISTORY_FILE", str(self.history)),
        ]
        for item in self.patches:
            item.start()

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.temp.cleanup()

    def write_history(self, *records):
        self.history.write_text(json.dumps(records), encoding="utf-8")

    async def test_canvas_reference_keeps_generated_file(self):
        path = self.generated / "shared.png"
        path.write_bytes(b"synthetic")
        url = "/assets/output/shared.png"
        self.write_history({"timestamp": 1, "images": [url]})
        (self.canvases / "owner.json").write_text(
            json.dumps({"nodes": [{"images": [{"url": url}]}]}), encoding="utf-8"
        )

        result = await main.delete_history(main.DeleteHistoryRequest(timestamp=1))

        self.assertTrue(result["success"])
        self.assertEqual(json.loads(self.history.read_text(encoding="utf-8")), [])
        self.assertEqual(path.read_bytes(), b"synthetic")

    async def test_other_history_reference_keeps_file_until_last_record(self):
        path = self.generated / "two-records.png"
        path.write_bytes(b"synthetic")
        url = "/assets/output/two-records.png"
        self.write_history(
            {"timestamp": 1, "images": [url]},
            {"timestamp": 2, "images": [url]},
        )

        self.assertTrue((await main.delete_history(main.DeleteHistoryRequest(timestamp=1)))["success"])
        self.assertTrue(path.exists())
        self.assertTrue((await main.delete_history(main.DeleteHistoryRequest(timestamp=2)))["success"])
        self.assertFalse(path.exists())

    async def test_input_media_is_never_deleted_with_history(self):
        path = self.inputs / "reference.png"
        path.write_bytes(b"input")
        self.write_history({"timestamp": 1, "images": ["/assets/input/reference.png"]})

        result = await main.delete_history(main.DeleteHistoryRequest(timestamp=1))

        self.assertTrue(result["success"])
        self.assertEqual(path.read_bytes(), b"input")


if __name__ == "__main__":
    unittest.main()
