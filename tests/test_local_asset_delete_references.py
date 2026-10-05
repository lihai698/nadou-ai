"""Local upload deletion must preserve media still used by saved documents."""

import json
import sys
import tempfile
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main


class LocalAssetDeleteReferenceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.root = Path(self.stack.enter_context(tempfile.TemporaryDirectory()))
        paths = {
            "ASSETS_DIR": "assets",
            "LOCAL_UPLOAD_DIR": "assets/uploads",
            "CANVAS_DIR": "data/canvases",
            "CONVERSATION_DIR": "data/conversations",
            "ASSET_LIBRARY_PATH": "data/asset_library.json",
            "HISTORY_FILE": "history.json",
        }
        for name, relative in paths.items():
            path = self.root / relative
            (path.parent if path.suffix else path).mkdir(parents=True, exist_ok=True)
            self.stack.enter_context(patch.object(main, name, str(path)))
        self.uploads = self.root / "assets" / "uploads"
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app),
            base_url="http://isolated.test",
            headers={"origin": "http://isolated.test"},
        )
        self.addAsyncCleanup(self.client.aclose)

    def upload(self, name):
        path = self.uploads / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"synthetic media")
        return path

    def canvas(self, name, node, kind=None):
        path = Path(main.CANVAS_DIR) / f"{name}.json"
        record = {"id": name, "title": name, "nodes": [node], "connections": []}
        if kind:
            record["kind"] = kind
        path.write_text(json.dumps(record), encoding="utf-8")

    async def delete(self, *names):
        response = await self.client.post("/api/local-assets/delete", json={"names": names})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    async def test_legacy_canvas_references_survive_batch_delete(self):
        classic = self.upload("classic.png")
        smart = self.upload("smart.png")
        free = self.upload("free.png")
        self.canvas("old-classic", {"type": "output", "images": [
            {"url": "/api/storage-files/local/classic.png?version=1"}]})
        self.canvas("old-smart", {"type": "smart-container", "inputImage": {
            "url": "/assets/uploads/smart.png"}}, kind="smart")

        before = await self.client.get("/api/canvases")
        self.assertEqual(before.status_code, 200, before.text)
        self.assertEqual({entry["kind"] for entry in before.json()["canvases"]}, {"classic", "smart"})

        result = await self.delete("classic.png", "smart.png", "free.png")

        self.assertEqual(result["deleted"], ["free.png"])
        self.assertEqual(set(result["skipped_referenced"]), {"classic.png", "smart.png"})
        self.assertEqual(classic.read_bytes(), b"synthetic media")
        self.assertEqual(smart.read_bytes(), b"synthetic media")
        self.assertFalse(free.exists())
        response = await self.client.get("/api/storage-files/local/classic.png")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.content, b"synthetic media")

    async def test_library_and_history_references_survive_delete(self):
        library_asset = self.upload("library.png")
        history_asset = self.upload("history.png")
        Path(main.ASSET_LIBRARY_PATH).write_text(json.dumps({
            "categories": [{"items": [{"url": "/api/storage-files/local/library.png"}]}]
        }), encoding="utf-8")
        Path(main.HISTORY_FILE).write_text(json.dumps([
            {"images": ["/assets/uploads/history.png"]}
        ]), encoding="utf-8")

        result = await self.delete("library.png", "history.png")

        self.assertEqual(result["deleted"], [])
        self.assertEqual(set(result["skipped_referenced"]), {"library.png", "history.png"})
        self.assertTrue(library_asset.exists())
        self.assertTrue(history_asset.exists())

    async def test_unreferenced_asset_and_sidecars_are_deleted(self):
        asset = self.upload("unused.png")
        caption = self.upload("unused.txt")
        classification = self.upload("unused.classification.json")

        result = await self.delete("unused.png")

        self.assertEqual(result, {"deleted": ["unused.png"], "skipped_referenced": []})
        self.assertFalse(asset.exists())
        self.assertFalse(caption.exists())
        self.assertFalse(classification.exists())

    async def test_unreadable_saved_documents_block_deletion(self):
        asset = self.upload("uncertain.png")
        canvas_path = Path(main.CANVAS_DIR) / "damaged.json"
        canvas_path.write_text("{broken", encoding="utf-8")

        result = await self.delete("uncertain.png")

        self.assertEqual(result["deleted"], [])
        self.assertEqual(result["skipped_referenced"], ["uncertain.png"])
        self.assertTrue(asset.exists())

        canvas_path.unlink()
        Path(main.HISTORY_FILE).write_text("{broken", encoding="utf-8")
        result = await self.delete("uncertain.png")
        self.assertEqual(result["deleted"], [])
        self.assertEqual(result["skipped_referenced"], ["uncertain.png"])
        self.assertTrue(asset.exists())

    async def test_referenced_caption_keeps_asset_and_sidecars(self):
        asset = self.upload("captioned.png")
        caption = self.upload("captioned.txt")
        classification = self.upload("captioned.classification.json")
        self.canvas("caption-owner", {"type": "text", "source": {
            "url": "/assets/uploads/captioned.txt"}})

        result = await self.delete("captioned.png")

        self.assertEqual(result["deleted"], [])
        self.assertEqual(result["skipped_referenced"], ["captioned.png"])
        self.assertTrue(asset.exists())
        self.assertTrue(caption.exists())
        self.assertTrue(classification.exists())


if __name__ == "__main__":
    unittest.main()
