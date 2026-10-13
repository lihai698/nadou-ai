import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main


class CanvasClearTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.assets = root / "assets"
        self.generated = self.assets / "output"
        self.legacy = root / "output"
        self.data = root / "data"
        self.canvases = self.data / "canvases"
        self.conversations = self.data / "conversations"
        self.previews = self.data / "media_previews"
        for path in (self.generated, self.legacy, self.canvases, self.conversations, self.previews):
            path.mkdir(parents=True, exist_ok=True)
        self.history = root / "history.json"
        self.history.write_text("[]", encoding="utf-8")
        self.patches = [
            patch.object(main, "ASSETS_DIR", str(self.assets)),
            patch.object(main, "OUTPUT_OUTPUT_DIR", str(self.generated)),
            patch.object(main, "OUTPUT_DIR", str(self.legacy)),
            patch.object(main, "DATA_DIR", str(self.data)),
            patch.object(main, "CANVAS_DIR", str(self.canvases)),
            patch.object(main, "CONVERSATION_DIR", str(self.conversations)),
            patch.object(main, "MEDIA_PREVIEW_DIR", str(self.previews)),
            patch.object(main, "HISTORY_FILE", str(self.history)),
            patch.object(main, "ASSET_LIBRARY_PATH", str(self.data / "asset_library.json")),
        ]
        for item in self.patches:
            item.start()

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.temp.cleanup()

    def write_canvas(self, canvas_id, nodes, logs, updated_at=12):
        value = {
            "id": canvas_id,
            "title": canvas_id,
            "icon": "layers",
            "kind": "classic",
            "project": "project-a",
            "nodes": nodes,
            "connections": [{"from": "a", "to": "b"}],
            "viewport": {"x": 4, "y": 5, "scale": 0.8},
            "logs": logs,
            "settings": {"keep": True},
            "updated_at": updated_at,
        }
        (self.canvases / f"{canvas_id}.json").write_text(json.dumps(value), encoding="utf-8")

    def generated_file(self, name):
        path = self.generated / name
        path.write_bytes(b"generated")
        return path, f"/assets/output/{name}"

    async def test_clear_removes_current_content_media_and_history(self):
        owned, owned_url = self.generated_file("owned.png")
        self.history.write_text(json.dumps([{"images": [owned_url], "prompt": "old"}]), encoding="utf-8")
        self.write_canvas(
            "clear-me",
            [{"id": "image", "type": "image", "url": owned_url}],
            [{"id": "log-1", "outputs": [owned_url]}],
        )

        result = await main.clear_canvas("clear-me", main.ClearCanvasRequest(base_updated_at=12))

        self.assertEqual(result["canvas"]["nodes"], [])
        self.assertEqual(result["canvas"]["connections"], [])
        self.assertEqual(result["canvas"]["logs"], [])
        self.assertEqual(result["canvas"]["settings"], {})
        self.assertFalse(owned.exists())
        self.assertEqual(json.loads(self.history.read_text(encoding="utf-8")), [])
        self.assertEqual(result["removed_history"], 1)

    async def test_clear_keeps_media_referenced_by_another_canvas(self):
        shared, shared_url = self.generated_file("shared.png")
        self.write_canvas("clear-me", [{"type": "output", "images": [{"url": shared_url}]}], [{"id": "log-1", "outputs": [shared_url]}])
        self.write_canvas("keep-me", [{"type": "image", "url": shared_url}], [], updated_at=20)

        result = await main.clear_canvas("clear-me", main.ClearCanvasRequest(base_updated_at=12))

        self.assertTrue(shared.exists())
        self.assertEqual(result["removed_files"], [])
        self.assertEqual(result["skipped_referenced"], [shared.name])
        other = json.loads((self.canvases / "keep-me.json").read_text(encoding="utf-8"))
        self.assertEqual(other["nodes"][0]["url"], shared_url)

    async def test_clear_rejects_stale_canvas_version(self):
        self.write_canvas("stale", [], [], updated_at=30)

        with self.assertRaises(main.HTTPException) as raised:
            await main.clear_canvas("stale", main.ClearCanvasRequest(base_updated_at=12))

        self.assertEqual(raised.exception.status_code, 409)
        saved = json.loads((self.canvases / "stale.json").read_text(encoding="utf-8"))
        self.assertEqual(saved["updated_at"], 30)
