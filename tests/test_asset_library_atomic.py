"""The asset index keeps prior bytes on write failure and merges overlapping requests."""

import asyncio
import json
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main
from backend import atomic_json


class AssetLibraryAtomicTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="asset-index-atomic-")
        self.root = Path(self.temp.name)
        self.assets = self.root / "assets"
        self.output = self.assets / "output"
        self.library_files = self.assets / "library"
        self.data = self.root / "data"
        for directory in (self.output, self.library_files, self.data):
            directory.mkdir(parents=True, exist_ok=True)
        self.index = self.data / "asset_library.json"
        paths = {
            "ASSETS_DIR": self.assets,
            "ASSET_LIBRARY_DIR": self.library_files,
            "ASSET_LIBRARY_PATH": self.index,
            "DATA_DIR": self.data,
            "OUTPUT_OUTPUT_DIR": self.output,
            "OUTPUT_DIR": self.root / "output",
            "LOCAL_UPLOAD_DIR": self.assets / "uploads",
            "CANVAS_DIR": self.data / "canvases",
            "CONVERSATION_DIR": self.data / "conversations",
            "HISTORY_FILE": self.root / "history.json",
        }
        self.patches = [patch.object(main, key, str(value)) for key, value in paths.items()]
        self.scheduled = []

        def close_broadcast(coroutine):
            self.scheduled.append(coroutine)
            coroutine.close()

        self.patches.append(patch.object(main, "schedule_coroutine", side_effect=close_broadcast))
        for active_patch in self.patches:
            active_patch.start()
        main.save_asset_library(main.default_asset_library())

    def tearDown(self):
        for active_patch in reversed(self.patches):
            active_patch.stop()
        self.temp.cleanup()

    async def test_failed_replace_preserves_index_and_sends_no_update(self):
        before = self.index.read_bytes()
        notices = len(self.scheduled)
        updated = main.load_asset_library()
        updated["libraries"][0]["name"] = "新名称"

        with patch.object(atomic_json.os, "replace", side_effect=OSError("replace failed")):
            with self.assertRaises(OSError):
                main.save_asset_library(updated)

        self.assertEqual(self.index.read_bytes(), before)
        self.assertEqual(len(self.scheduled), notices)
        self.assertEqual(list(self.data.glob(".asset_library.json.*.tmp")), [])
        self.assertEqual(main.load_asset_library()["libraries"][0]["name"], "默认资产库")

    async def test_unreadable_existing_index_is_not_reset_by_mutation(self):
        broken = b'{"libraries": [broken]}'
        self.index.write_bytes(broken)
        notices = len(self.scheduled)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app),
            base_url="http://asset-index-atomic.test",
        ) as client:
            response = await client.post("/api/asset-library/libraries", json={"name": "新库"})

        self.assertEqual(response.status_code, 500)
        self.assertEqual(self.index.read_bytes(), broken)
        self.assertEqual(len(self.scheduled), notices)

    async def test_failed_http_add_removes_unindexed_copy(self):
        (self.output / "source.mp4").write_bytes(b"synthetic video")
        before = self.index.read_bytes()
        notices = len(self.scheduled)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app, raise_app_exceptions=False),
            base_url="http://asset-index-atomic.test",
        ) as client:
            with patch.object(atomic_json.os, "replace", side_effect=OSError("replace failed")):
                response = await client.post("/api/asset-library/items", json={
                    "category_id": "characters", "url": "/assets/output/source.mp4", "name": "source.mp4",
                })

        self.assertEqual(response.status_code, 500)
        self.assertEqual(self.index.read_bytes(), before)
        self.assertEqual(list(self.library_files.rglob("*")), [])
        self.assertEqual(len(self.scheduled), notices)

    async def test_overlapping_http_adds_keep_both_items(self):
        (self.output / "甲.png").write_bytes(b"first synthetic image")
        (self.output / "乙.png").write_bytes(b"second synthetic image")
        entered = 0
        both_waiting = asyncio.Event()
        release = asyncio.Event()

        async def delayed_classification(_path, *args, **kwargs):
            nonlocal entered
            entered += 1
            if entered == 2:
                both_waiting.set()
            await release.wait()
            return {"summary": "隔离分类"}

        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app),
            base_url="http://asset-index-atomic.test",
        ) as client:
            with patch.object(main, "classify_asset_image_best_effort", side_effect=delayed_classification):
                first = asyncio.create_task(client.post("/api/asset-library/items", json={
                    "category_id": "characters", "url": "/assets/output/甲.png", "name": "甲.png",
                }))
                second = asyncio.create_task(client.post("/api/asset-library/items", json={
                    "category_id": "characters", "url": "/assets/output/乙.png", "name": "乙.png",
                }))
                try:
                    await asyncio.wait_for(both_waiting.wait(), timeout=5)
                finally:
                    release.set()
                responses = await asyncio.gather(first, second)

        self.assertEqual([response.status_code for response in responses], [200, 200])
        index = json.loads(self.index.read_text(encoding="utf-8"))
        items = index["libraries"][0]["categories"][0]["items"]
        self.assertEqual({item["name"] for item in items}, {"甲", "乙"})
        self.assertEqual(len(items), 2)
        self.assertEqual(len(self.scheduled), 3)  # Initial creation and two commits.

    async def test_serialized_library_route_keeps_http_parameters(self):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app),
            base_url="http://asset-index-atomic.test",
        ) as client:
            created = await client.post("/api/asset-library/libraries", json={"name": "测试库"})
            self.assertEqual(created.status_code, 200, created.text)
            library_id = created.json()["asset_library"]["id"]
            renamed = await client.patch(
                f"/api/asset-library/libraries/{library_id}", json={"name": "重命名测试库"}
            )
            self.assertEqual(renamed.status_code, 200, renamed.text)

        self.assertEqual(renamed.json()["asset_library"]["name"], "重命名测试库")
        self.assertEqual(main.load_asset_library()["active_library_id"], library_id)

    async def test_classification_result_merges_with_concurrent_rename(self):
        (self.output / "image.png").write_bytes(b"synthetic image")
        lib = main.load_asset_library()
        lib["libraries"][0]["categories"][0]["items"].append({
            "id": "asset_test", "name": "旧名称", "url": "/assets/output/image.png", "kind": "image",
        })
        main.save_asset_library(lib)
        entered = asyncio.Event()
        release = asyncio.Event()

        async def delayed_classification(*args, **kwargs):
            entered.set()
            await release.wait()
            return {"summary": "分类已完成"}

        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app),
            base_url="http://asset-index-atomic.test",
        ) as client:
            with patch.object(main, "classify_image_with_provider", side_effect=delayed_classification):
                classifying = asyncio.create_task(client.post(
                    "/api/asset-library/items/classify", json={"ids": ["asset_test"]}
                ))
                try:
                    await asyncio.wait_for(entered.wait(), timeout=5)
                    renamed = await client.patch(
                        "/api/asset-library/items/asset_test", json={"name": "新名称"}
                    )
                    self.assertEqual(renamed.status_code, 200, renamed.text)
                finally:
                    release.set()
                response = await classifying

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["count"], 1)
        item = main.load_asset_library()["libraries"][0]["categories"][0]["items"][0]
        self.assertEqual(item["name"], "新名称")
        self.assertEqual(item["classification"], {"summary": "分类已完成"})

    async def test_category_deleted_during_classification_leaves_no_copy(self):
        (self.output / "image.png").write_bytes(b"synthetic image")
        entered = asyncio.Event()
        release = asyncio.Event()

        async def delayed_classification(*args, **kwargs):
            entered.set()
            await release.wait()
            return {"summary": "隔离分类"}

        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app),
            base_url="http://asset-index-atomic.test",
        ) as client:
            with patch.object(main, "classify_asset_image_best_effort", side_effect=delayed_classification):
                adding = asyncio.create_task(client.post("/api/asset-library/items", json={
                    "category_id": "characters", "url": "/assets/output/image.png", "name": "image.png",
                }))
                try:
                    await asyncio.wait_for(entered.wait(), timeout=5)
                    deleted = await client.delete("/api/asset-library/categories/characters")
                    self.assertEqual(deleted.status_code, 200, deleted.text)
                finally:
                    release.set()
                response = await adding

        self.assertEqual(response.status_code, 404)
        self.assertEqual(list(self.library_files.rglob("*")), [])
        categories = main.load_asset_library()["libraries"][0]["categories"]
        self.assertNotIn("characters", {category["id"] for category in categories})

    async def test_storage_delete_paths_wait_for_index_commit(self):
        async def request_delete(endpoint, payload):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=main.app),
                base_url="http://asset-index-atomic.test",
                headers={"origin": "http://asset-index-atomic.test"},
            ) as client:
                return await client.post(endpoint, json=payload)

        for endpoint, payload, path, early_name, url in (
            ("/api/storage-files/delete", {"kind": "generated", "items": ["generated.png"]},
             self.output / "generated.png", "storage_file_path", "/assets/output/generated.png"),
            ("/api/local-assets/delete", {"names": ["local.png"]},
             self.assets / "uploads" / "local.png", "ensure_same_origin_request", "/assets/uploads/local.png"),
        ):
            with self.subTest(endpoint=endpoint):
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"synthetic media")
                started = threading.Event()
                scanned = threading.Event()
                original_early = getattr(main, early_name)
                original_scan = main.persisted_json_references_media_path

                def early(*args, **kwargs):
                    started.set()
                    return original_early(*args, **kwargs)

                def scan(*args, **kwargs):
                    scanned.set()
                    return original_scan(*args, **kwargs)

                with patch.object(main, early_name, side_effect=early), patch.object(
                    main, "persisted_json_references_media_path", side_effect=scan
                ):
                    with main.ASSET_LIBRARY_LOCK:
                        pending = asyncio.create_task(asyncio.to_thread(
                            lambda: asyncio.run(request_delete(endpoint, payload))
                        ))
                        await asyncio.sleep(0)
                        self.assertTrue(started.wait(5), "删除请求未到达锁入口")
                        self.assertFalse(
                            await asyncio.to_thread(scanned.wait, 0.2),
                            "删除请求绕过索引锁读取引用",
                        )
                        lib = main.load_asset_library()
                        lib["libraries"][0]["categories"][0]["items"].append({
                            "id": f"asset_{path.stem}", "name": path.stem, "url": url, "kind": "image",
                        })
                        main.save_asset_library(lib)
                    response = await asyncio.wait_for(pending, timeout=5)

                self.assertEqual(response.status_code, 200, response.text)
                self.assertTrue(path.exists())
                self.assertTrue(scanned.is_set())
                self.assertEqual(response.json()["skipped_referenced"], [path.name])

    async def test_history_and_canvas_log_cleanup_wait_for_index_commit(self):
        canvas_dir = self.data / "canvases"
        canvas_dir.mkdir(parents=True, exist_ok=True)

        async def request_delete(endpoint, payload):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=main.app),
                base_url="http://asset-index-atomic.test",
            ) as client:
                return await client.post(endpoint, json=payload)

        for kind in ("history", "canvas-log"):
            with self.subTest(kind=kind):
                source = self.output / f"{kind}.png"
                source.write_bytes(b"synthetic generated image")
                url = f"/assets/output/{source.name}"
                if kind == "history":
                    history_path = self.root / "history.json"
                    history_path.write_text(json.dumps([
                        {"timestamp": 123, "images": [url]}
                    ]), encoding="utf-8")
                    endpoint = "/api/history/delete"
                    payload = {"timestamp": 123}
                    early_name = "write_json_atomic"
                else:
                    canvas = {"id": "cleanup-test", "title": "test", "logs": [
                        {"id": "log-test", "outputs": [url]}
                    ], "nodes": [], "connections": [], "viewport": {"x": 0, "y": 0, "scale": 1}}
                    (canvas_dir / "cleanup-test.json").write_text(
                        json.dumps(canvas), encoding="utf-8"
                    )
                    endpoint = "/api/canvases/cleanup-test/logs/delete"
                    payload = {"log_id": "log-test", "delete_unreferenced_media": True}
                    early_name = "save_canvas"
                started = threading.Event()
                scanned = threading.Event()
                original_early = getattr(main, early_name)
                original_scan = main.persisted_json_references_media_path

                def early(*args, **kwargs):
                    result = original_early(*args, **kwargs)
                    if early_name == "save_canvas" or str(args[0]) == str(history_path):
                        started.set()
                    return result

                def scan(*args, **kwargs):
                    scanned.set()
                    return original_scan(*args, **kwargs)

                with patch.object(main, early_name, side_effect=early), patch.object(
                    main, "persisted_json_references_media_path", side_effect=scan
                ):
                    with main.ASSET_LIBRARY_LOCK:
                        pending = asyncio.create_task(asyncio.to_thread(
                            lambda: asyncio.run(request_delete(endpoint, payload))
                        ))
                        await asyncio.sleep(0)
                        self.assertTrue(started.wait(5), "清理请求未到达索引锁入口")
                        self.assertFalse(
                            await asyncio.to_thread(scanned.wait, 0.2),
                            "清理请求绕过索引锁读取引用",
                        )
                        lib = main.load_asset_library()
                        lib["libraries"][0]["categories"][0]["items"].append({
                            "id": f"asset_{kind}", "name": kind, "url": url, "kind": "image",
                        })
                        main.save_asset_library(lib)
                    response = await asyncio.wait_for(pending, timeout=5)

                self.assertEqual(response.status_code, 200, response.text)
                self.assertTrue(source.exists())
                self.assertTrue(scanned.is_set())
                if kind == "history":
                    self.assertTrue(response.json()["success"])
                else:
                    self.assertEqual(response.json()["skipped_referenced"], [source.name])

    async def test_canvas_log_rechecks_index_after_history_prune(self):
        canvas_dir = self.data / "canvases"
        canvas_dir.mkdir(parents=True, exist_ok=True)
        source = self.output / "late-reference.png"
        source.write_bytes(b"synthetic generated image")
        url = f"/assets/output/{source.name}"
        canvas = {"id": "late-reference", "title": "test", "logs": [
            {"id": "log-test", "outputs": [url]}
        ], "nodes": [], "connections": [], "viewport": {"x": 0, "y": 0, "scale": 1}}
        (canvas_dir / "late-reference.json").write_text(json.dumps(canvas), encoding="utf-8")
        original_prune = main.prune_generation_history_for_media

        def register_after_prune(paths):
            result = original_prune(paths)
            lib = main.load_asset_library()
            lib["libraries"][0]["categories"][0]["items"].append({
                "id": "asset_late", "name": "late", "url": url, "kind": "image",
            })
            main.save_asset_library(lib)
            return result

        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app),
            base_url="http://asset-index-atomic.test",
        ) as client:
            with patch.object(main, "prune_generation_history_for_media", side_effect=register_after_prune):
                response = await client.post("/api/canvases/late-reference/logs/delete", json={
                    "log_id": "log-test", "delete_unreferenced_media": True,
                })

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["skipped_referenced"], [source.name])
        self.assertEqual(source.read_bytes(), b"synthetic generated image")


if __name__ == "__main__":
    unittest.main()
