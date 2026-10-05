"""The storage manager must preserve files used by saved content."""

import json
import os
import sys
import tempfile
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main


class StorageFileDeleteReferenceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.root = Path(self.stack.enter_context(tempfile.TemporaryDirectory()))
        paths = {
            "ASSETS_DIR": "assets",
            "OUTPUT_DIR": "legacy-output",
            "OUTPUT_INPUT_DIR": "assets/input",
            "OUTPUT_OUTPUT_DIR": "assets/output",
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
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app),
            base_url="http://isolated.test",
        )
        self.addAsyncCleanup(self.client.aclose)

    def media(self, kind, name):
        folder = {"upload": main.OUTPUT_INPUT_DIR, "generated": main.OUTPUT_OUTPUT_DIR,
                  "local": main.LOCAL_UPLOAD_DIR}[kind]
        path = Path(folder) / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"synthetic media")
        return path

    async def delete(self, kind, *items):
        return await self.client.post("/api/storage-files/delete", json={"kind": kind, "items": items})

    async def test_referenced_files_are_kept_and_free_files_are_deleted(self):
        for kind, reference in (
            ("upload", (Path(main.CANVAS_DIR) / "classic.json", "/assets/input/used.png")),
            ("generated", (Path(main.CONVERSATION_DIR) / "chat.json",
                           "/api/storage-files/generated/used.png?version=1")),
            ("local", (Path(main.ASSET_LIBRARY_PATH), "/assets/uploads/used.png")),
        ):
            used = self.media(kind, "used.png")
            free = self.media(kind, "free.png")
            document, url = reference
            document.write_text(json.dumps({"media": [{"url": url}]}), encoding="utf-8")

            response = await self.delete(kind, "used.png", "free.png", "missing.png")

            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["removed"], 1)
            self.assertEqual(response.json()["skipped_referenced"], ["used.png"])
            self.assertIn("已保留", response.json()["skipped_reason"])
            self.assertEqual(used.read_bytes(), b"synthetic media")
            self.assertFalse(free.exists())
            available = await self.client.get(f"/api/storage-files/{kind}/used.png")
            self.assertEqual(available.status_code, 200, available.text)
            document.unlink()

    async def test_history_reference_and_damaged_records_keep_file(self):
        used = self.media("generated", "history.png")
        Path(main.HISTORY_FILE).write_text(json.dumps([
            {"images": ["/api/storage-files/generated/history.png"]}
        ]), encoding="utf-8")
        response = await self.delete("generated", "history.png")
        self.assertEqual(response.json()["skipped_referenced"], ["history.png"])
        self.assertTrue(used.exists())

        Path(main.HISTORY_FILE).write_text("{broken", encoding="utf-8")
        free = self.media("generated", "uncertain.png")
        response = await self.delete("generated", "uncertain.png")
        self.assertEqual(response.json()["skipped_referenced"], ["uncertain.png"])
        self.assertTrue(free.exists())

        Path(main.HISTORY_FILE).write_text("[]", encoding="utf-8")
        (Path(main.CANVAS_DIR) / "damaged.json").write_text("{broken", encoding="utf-8")
        response = await self.delete("generated", "uncertain.png")
        self.assertEqual(response.json()["skipped_referenced"], ["uncertain.png"])
        self.assertTrue(free.exists())

    async def test_invalid_paths_cannot_delete_files(self):
        good = self.media("local", "good.png")
        outside = self.root / "outside.png"
        outside.write_bytes(b"outside")

        response = await self.delete("local", "good.png", "../outside.png")
        self.assertEqual(response.status_code, 400, response.text)
        self.assertEqual(response.json()["detail"], "非法文件路径")
        self.assertTrue(good.exists())
        self.assertEqual(outside.read_bytes(), b"outside")

        link = Path(main.LOCAL_UPLOAD_DIR) / "outside-link.png"
        try:
            os.symlink(outside, link)
        except (OSError, NotImplementedError):
            return
        response = await self.delete("local", "outside-link.png")
        self.assertEqual(response.status_code, 400, response.text)
        self.assertTrue(link.exists())
        self.assertEqual(outside.read_bytes(), b"outside")


if __name__ == "__main__":
    unittest.main()
