"""Media imports reuse stable category item IDs without deleting referenced copies."""

import asyncio
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main


class AssetLibraryIdentityTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="asset-identity-")
        self.root = Path(self.temp.name)
        self.assets = self.root / "assets"
        self.output = self.assets / "output"
        self.library_files = self.assets / "library"
        self.data = self.root / "data"
        for directory in (self.output, self.library_files, self.data / "canvases", self.data / "conversations"):
            directory.mkdir(parents=True, exist_ok=True)
        paths = {
            "ASSETS_DIR": self.assets,
            "ASSET_LIBRARY_DIR": self.library_files,
            "ASSET_LIBRARY_PATH": self.data / "asset_library.json",
            "DATA_DIR": self.data,
            "OUTPUT_OUTPUT_DIR": self.output,
            "OUTPUT_DIR": self.root / "output",
            "CANVAS_DIR": self.data / "canvases",
            "CONVERSATION_DIR": self.data / "conversations",
            "HISTORY_FILE": self.root / "history.json",
        }
        self.patches = [patch.object(main, name, str(path)) for name, path in paths.items()]
        self.patches.append(patch.object(main, "schedule_coroutine", side_effect=lambda task: task.close()))
        for active in self.patches:
            active.start()
        main.save_asset_library(main.default_asset_library())

    def tearDown(self):
        for active in reversed(self.patches):
            active.stop()
        self.temp.cleanup()

    def category_items(self, category_id="characters"):
        library = main.load_asset_library()["libraries"][0]
        return next(cat["items"] for cat in library["categories"] if cat["id"] == category_id)

    def copies(self):
        return [path for path in self.library_files.rglob("*") if path.is_file()]

    async def test_repeat_import_reuses_id_and_renamed_item(self):
        (self.output / "source.png").write_bytes(b"synthetic image content")
        classifier = AsyncMock(return_value={"summary": "本机测试"})
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app),
                                     base_url="http://asset-identity.test") as client:
            with patch.object(main, "classify_asset_image_best_effort", classifier):
                payload = {"category_id": "characters", "url": "/assets/output/source.png", "name": "初始.png"}
                first = await client.post("/api/asset-library/items", json=payload)
                self.assertEqual(first.status_code, 200, first.text)
                item_id = first.json()["item"]["id"]
                renamed = await client.patch(f"/api/asset-library/items/{item_id}", json={"name": "已重命名"})
                self.assertEqual(renamed.status_code, 200, renamed.text)
                repeated = await client.post("/api/asset-library/items", json={**payload, "name": "重复.png"})
        self.assertEqual(repeated.status_code, 200, repeated.text)
        self.assertTrue(repeated.json()["already_present"])
        self.assertEqual(repeated.json()["item"]["id"], item_id)
        self.assertEqual(repeated.json()["item"]["name"], "已重命名")
        self.assertEqual(len(self.category_items()), 1)
        self.assertEqual(len(self.copies()), 1)
        self.assertEqual(classifier.await_count, 1)

    async def test_legacy_item_without_hash_reuses_existing_id(self):
        source = self.output / "source.mp4"
        source.write_bytes(b"same video content")
        legacy_copy = self.library_files / "old.mp4"
        legacy_copy.write_bytes(source.read_bytes())
        lib = main.load_asset_library()
        lib["libraries"][0]["categories"][0]["items"].append({
            "id": "legacy_stable", "name": "旧素材", "kind": "video", "url": "/assets/library/old.mp4",
        })
        main.save_asset_library(lib)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app),
                                     base_url="http://asset-identity.test") as client:
            repeated = await client.post("/api/asset-library/items", json={
                "category_id": "characters", "url": "/assets/output/source.mp4",
            })
        self.assertEqual(repeated.status_code, 200, repeated.text)
        self.assertEqual(repeated.json()["item"]["id"], "legacy_stable")
        self.assertEqual(self.copies(), [legacy_copy])
        self.assertEqual(len(self.category_items()), 1)

    async def test_moved_item_keeps_id_and_new_category_can_import_separately(self):
        (self.output / "clip.mp4").write_bytes(b"moving clip")
        payload = {"category_id": "characters", "url": "/assets/output/clip.mp4"}
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app),
                                     base_url="http://asset-identity.test") as client:
            first = await client.post("/api/asset-library/items", json=payload)
            self.assertEqual(first.status_code, 200, first.text)
            item_id = first.json()["item"]["id"]
            moved = await client.post("/api/asset-library/items/move", json={
                "ids": [item_id], "target_category_id": "scenes",
            })
            self.assertEqual(moved.status_code, 200, moved.text)
            same_category = await client.post("/api/asset-library/items", json={
                **payload, "category_id": "scenes",
            })
            original_category = await client.post("/api/asset-library/items", json=payload)
        self.assertEqual(same_category.status_code, 200, same_category.text)
        self.assertEqual(original_category.status_code, 200, original_category.text)
        self.assertEqual(same_category.json()["item"]["id"], item_id)
        self.assertTrue(same_category.json()["already_present"])
        self.assertNotEqual(original_category.json()["item"]["id"], item_id)
        self.assertEqual(len(self.category_items("characters")), 1)
        self.assertEqual(len(self.category_items("scenes")), 1)
        self.assertEqual(len(self.copies()), 2)

    async def test_modified_copy_does_not_match_stale_saved_hash(self):
        (self.output / "source.mp4").write_bytes(b"video-one")
        payload = {"category_id": "characters", "url": "/assets/output/source.mp4"}
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app),
                                     base_url="http://asset-identity.test") as client:
            first = await client.post("/api/asset-library/items", json=payload)
            self.assertEqual(first.status_code, 200, first.text)
            copy_path = self.copies()[0]
            copy_path.write_bytes(b"video-two")  # Same length, different content.
            old_mtime = copy_path.stat().st_mtime_ns
            os.utime(copy_path, ns=(old_mtime + 2_000_000_000, old_mtime + 2_000_000_000))
            second = await client.post("/api/asset-library/items", json=payload)
        self.assertEqual(second.status_code, 200, second.text)
        self.assertFalse(second.json()["already_present"])
        self.assertNotEqual(second.json()["item"]["id"], first.json()["item"]["id"])
        self.assertEqual(len(self.category_items()), 2)
        self.assertEqual(len(self.copies()), 2)

    async def test_batch_deduplicates_within_request_and_against_index(self):
        for name in ("one.png", "two.png"):
            (self.output / name).write_bytes(b"same picture content")
        classifier = AsyncMock(return_value={"summary": "测试"})
        payload = {"category_id": "characters", "items": [
            {"url": "/assets/output/one.png", "name": "one.png"},
            {"url": "/assets/output/two.png", "name": "two.png"},
        ]}
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app),
                                     base_url="http://asset-identity.test") as client:
            with patch.object(main, "classify_asset_image_best_effort", classifier):
                first = await client.post("/api/asset-library/items/batch", json=payload)
                repeated = await client.post("/api/asset-library/items/batch", json=payload)
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(repeated.status_code, 200, repeated.text)
        self.assertEqual(first.json()["added_count"], 1)
        self.assertEqual(first.json()["duplicate_count"], 1)
        self.assertEqual(repeated.json()["added_count"], 0)
        self.assertEqual(repeated.json()["duplicate_count"], 2)
        self.assertEqual({item["id"] for item in first.json()["items"] + repeated.json()["items"]},
                         {self.category_items()[0]["id"]})
        self.assertEqual(len(self.copies()), 1)
        self.assertEqual(classifier.await_count, 1)

    async def test_concurrent_imports_commit_one_copy_and_id(self):
        (self.output / "same.png").write_bytes(b"concurrent picture content")
        entered = 0
        both_ready = asyncio.Event()
        release = asyncio.Event()

        async def delayed_classification(*_args):
            nonlocal entered
            entered += 1
            if entered == 2:
                both_ready.set()
            await release.wait()
            return {"summary": "并发测试"}

        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app),
                                     base_url="http://asset-identity.test") as client:
            with patch.object(main, "classify_asset_image_best_effort", side_effect=delayed_classification):
                payload = {"category_id": "characters", "url": "/assets/output/same.png"}
                first = asyncio.create_task(client.post("/api/asset-library/items", json=payload))
                second = asyncio.create_task(client.post("/api/asset-library/items", json=payload))
                try:
                    await asyncio.wait_for(both_ready.wait(), timeout=5)
                finally:
                    release.set()
                responses = await asyncio.gather(first, second)
        self.assertEqual([response.status_code for response in responses], [200, 200])
        self.assertEqual(len({response.json()["item"]["id"] for response in responses}), 1)
        self.assertEqual(len(self.category_items()), 1)
        self.assertEqual(len(self.copies()), 1)

    async def test_shared_folder_reimport_preserves_id_and_canvas_copy(self):
        shared = self.root / "shared"
        shared.mkdir()
        (shared / "clip.mp4").write_bytes(b"synthetic clip")
        payload = {"folder_id": "shared_test", "category_id": "characters", "paths": ["clip.mp4"]}
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app),
                                     base_url="http://asset-identity.test") as client:
            with patch.object(main, "shared_folder_by_id", return_value={"id": "shared_test"}), \
                 patch.object(main, "shared_folder_abs", return_value=str(shared)):
                first = await client.post("/api/shared-folders/import", json=payload)
                repeated = await client.post("/api/shared-folders/import", json=payload)
            self.assertEqual(first.status_code, 200, first.text)
            self.assertEqual(repeated.status_code, 200, repeated.text)
            item = first.json()["items"][0]
            self.assertEqual(repeated.json()["items"][0]["id"], item["id"])
            self.assertEqual(repeated.json()["duplicate_count"], 1)
            (self.data / "canvases" / "owner.json").write_text(
                json.dumps({"nodes": [{"images": [{"url": item["url"]}]}]}), encoding="utf-8"
            )
            removed = await client.delete(f"/api/asset-library/items/{item['id']}")
        self.assertEqual(removed.status_code, 200, removed.text)
        self.assertEqual(len(self.category_items()), 0)
        self.assertEqual(len(self.copies()), 1)
        self.assertEqual(self.copies()[0].read_bytes(), b"synthetic clip")


if __name__ == "__main__":
    unittest.main()
