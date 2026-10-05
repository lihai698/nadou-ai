"""Deleting an asset index entry must not break other references or source files."""

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main


class AssetLibraryCleanupTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.assets = self.root / "assets"
        self.library_dir = self.assets / "library"
        self.canvases = self.root / "data" / "canvases"
        self.conversations = self.root / "data" / "conversations"
        for directory in (self.library_dir, self.assets / "output", self.canvases, self.conversations):
            directory.mkdir(parents=True, exist_ok=True)
        self.patches = [
            patch.object(main, "ASSETS_DIR", str(self.assets)),
            patch.object(main, "ASSET_LIBRARY_DIR", str(self.library_dir)),
            patch.object(main, "OUTPUT_OUTPUT_DIR", str(self.assets / "output")),
            patch.object(main, "OUTPUT_DIR", str(self.root / "output")),
            patch.object(main, "DATA_DIR", str(self.root / "data")),
            patch.object(main, "CANVAS_DIR", str(self.canvases)),
            patch.object(main, "CONVERSATION_DIR", str(self.conversations)),
            patch.object(main, "ASSET_LIBRARY_PATH", str(self.root / "data" / "asset_library.json")),
            patch.object(main, "HISTORY_FILE", str(self.root / "history.json")),
        ]
        for item in self.patches:
            item.start()
        self.lib = main.default_asset_library()

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.temp.cleanup()

    def add_item(self, category, item_id, url):
        category.setdefault("items", []).append({"id": item_id, "name": item_id, "url": url, "kind": "image"})
        main.save_asset_library(self.lib)

    def add_canvas_reference(self, url):
        (self.canvases / "owner.json").write_text(
            json.dumps({"nodes": [{"images": [{"url": url}]}]}), encoding="utf-8"
        )

    async def test_item_deletion_keeps_library_file_referenced_by_canvas(self):
        path = self.library_dir / "shared.png"
        path.write_bytes(b"synthetic")
        url = "/assets/library/shared.png"
        self.add_item(self.lib["categories"][0], "shared", url)
        self.add_canvas_reference(url)

        await main.delete_asset_library_item("shared")

        self.assertEqual(path.read_bytes(), b"synthetic")
        self.assertEqual(main.load_asset_library()["categories"][0]["items"], [])

    async def test_item_deletion_cannot_remove_generated_source(self):
        path = self.assets / "output" / "source.png"
        path.write_bytes(b"synthetic")
        self.add_item(self.lib["categories"][0], "source", "/assets/output/source.png")

        await main.delete_asset_library_item("source")

        self.assertEqual(path.read_bytes(), b"synthetic")

    async def test_category_deletion_preserves_referenced_copy_and_folder(self):
        directory = self.library_dir / "example"
        directory.mkdir()
        path = directory / "shared.png"
        path.write_bytes(b"synthetic")
        category = {"id": "example", "name": "example", "type": "image", "dir": "example", "items": []}
        self.lib["categories"].append(category)
        url = "/assets/library/example/shared.png"
        self.add_item(category, "shared", url)
        self.add_canvas_reference(url)

        await main.delete_asset_library_category("example")

        self.assertEqual(path.read_bytes(), b"synthetic")
        self.assertNotIn("example", [cat["id"] for cat in main.load_asset_library()["categories"]])

    async def test_unreferenced_category_copy_and_empty_folder_are_removed(self):
        directory = self.library_dir / "unused"
        directory.mkdir()
        path = directory / "unused.png"
        path.write_bytes(b"synthetic")
        category = {"id": "unused", "name": "unused", "type": "image", "dir": "unused", "items": []}
        self.lib["categories"].append(category)
        self.add_item(category, "unused", "/assets/library/unused/unused.png")

        await main.delete_asset_library_category("unused")

        self.assertFalse(path.exists())
        self.assertFalse(directory.exists())

    async def test_batch_delete_keeps_referenced_copy_and_removes_free_copy(self):
        shared = self.library_dir / "batch-shared.png"
        free = self.library_dir / "batch-free.png"
        shared.write_bytes(b"shared")
        free.write_bytes(b"free")
        category = self.lib["categories"][0]
        category["items"] = [
            {"id": "shared", "url": "/assets/library/batch-shared.png", "kind": "image"},
            {"id": "free", "url": "/assets/library/batch-free.png", "kind": "image"},
        ]
        main.save_asset_library(self.lib)
        self.add_canvas_reference("/assets/library/batch-shared.png")

        result = await main.batch_delete_asset_library_items(main.AssetLibraryBatchDeleteRequest(ids=["shared", "free"]))

        self.assertEqual(result["removed"], 2)
        self.assertEqual(shared.read_bytes(), b"shared")
        self.assertFalse(free.exists())


if __name__ == "__main__":
    unittest.main()
