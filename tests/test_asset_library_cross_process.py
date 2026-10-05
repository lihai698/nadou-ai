"""用两个独立进程验证素材库索引的真实 HTTP 读改写。"""

import asyncio
import json
import multiprocessing
import sys
import tempfile
import traceback
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def _asset_route_worker(index_path, data_dir, library_dir, method, url, payload,
                        ready, go, loaded, both_loaded, result):
    try:
        import main

        main.ASSET_LIBRARY_PATH = index_path
        main.ASSET_LIBRARY_DIR = library_dir
        main.DATA_DIR = data_dir
        original_load = main.load_asset_library

        def delayed_load():
            library = original_load()
            with loaded.get_lock():
                loaded.value += 1
                if loaded.value == 2:
                    both_loaded.set()
            # 旧的进程内锁会让两个进程同时读到旧索引；文件锁下第二个
            # 进程只能等第一个完成提交后再读取。
            both_loaded.wait(0.35)
            return library

        def close_broadcast(coroutine):
            coroutine.close()

        main.load_asset_library = delayed_load
        ready.set()
        if not go.wait(10):
            raise RuntimeError("测试进程未收到开始信号")

        async def request():
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=main.app),
                base_url="http://asset-library-cross-process.test",
            ) as client:
                return await client.request(method, url, json=payload)

        with patch.object(main, "schedule_coroutine", side_effect=close_broadcast):
            response = asyncio.run(request())
        result.put((response.status_code, response.json()))
    except BaseException:
        result.put((0, traceback.format_exc()))


class AssetLibraryCrossProcessTests(unittest.TestCase):
    def _fixture(self, root):
        data_dir = Path(root) / "data"
        library_dir = Path(root) / "assets" / "library"
        data_dir.mkdir()
        library_dir.mkdir(parents=True)
        index = data_dir / "asset_library.json"
        categories = [
            {"id": "characters", "name": "角色", "type": "image", "items": []},
            {"id": "scenes", "name": "场景", "type": "image", "items": []},
            {"id": "workflows", "name": "工作流", "type": "workflow", "items": []},
        ]
        index.write_text(json.dumps({
            "active_library_id": "default",
            "libraries": [{"id": "default", "name": "默认资产库", "type": "asset", "categories": categories}],
            "categories": categories,
            "updated_at": 1,
        }, ensure_ascii=False), encoding="utf-8")
        return data_dir, library_dir, index

    def _run_pair(self, index, data_dir, library_dir, requests):
        context = multiprocessing.get_context("spawn")
        ready = [context.Event(), context.Event()]
        go = context.Event()
        loaded = context.Value("i", 0)
        both_loaded = context.Event()
        result = context.Queue()
        workers = [
            context.Process(
                target=_asset_route_worker,
                args=(str(index), str(data_dir), str(library_dir), method, url, payload,
                      ready[position], go, loaded, both_loaded, result),
            )
            for position, (method, url, payload) in enumerate(requests)
        ]
        for worker in workers:
            worker.start()
        try:
            for event in ready:
                self.assertTrue(event.wait(20), "素材库测试进程未准备好")
            go.set()
            for worker in workers:
                worker.join(20)
            self.assertTrue(all(not worker.is_alive() for worker in workers), "素材库请求未完成")
            responses = [result.get(timeout=2) for _ in workers]
            self.assertEqual([status for status, _body in responses], [200, 200], responses)
        finally:
            go.set()
            for worker in workers:
                if worker.is_alive():
                    worker.terminate()
                    worker.join(2)

    def test_two_process_http_creates_keep_both_libraries(self):
        with tempfile.TemporaryDirectory(prefix="asset-library-cross-process-") as root:
            data_dir, library_dir, index = self._fixture(root)
            self._run_pair(index, data_dir, library_dir, [
                ("POST", "/api/asset-library/libraries", {"name": "并发甲"}),
                ("POST", "/api/asset-library/libraries", {"name": "并发乙"}),
            ])

            saved = json.loads(index.read_text(encoding="utf-8"))
            self.assertEqual(
                {library["name"] for library in saved["libraries"] if library["id"] != "default"},
                {"并发甲", "并发乙"},
            )
            self.assertEqual(list(data_dir.glob(".asset_library.json.*.tmp")), [])

    def test_two_process_http_updates_keep_rename_and_category(self):
        with tempfile.TemporaryDirectory(prefix="asset-library-cross-process-") as root:
            data_dir, library_dir, index = self._fixture(root)
            self._run_pair(index, data_dir, library_dir, [
                ("PATCH", "/api/asset-library/libraries/default", {"name": "并发改名"}),
                ("POST", "/api/asset-library/categories", {
                    "library_id": "default", "name": "并发分组", "type": "image",
                }),
            ])

            saved = json.loads(index.read_text(encoding="utf-8"))
            library = next(item for item in saved["libraries"] if item["id"] == "default")
            self.assertEqual(library["name"], "并发改名")
            self.assertIn("并发分组", {category["name"] for category in library["categories"]})
            self.assertEqual(list(data_dir.glob(".asset_library.json.*.tmp")), [])

    def test_corrupt_index_is_not_overwritten_by_real_route(self):
        import main

        with tempfile.TemporaryDirectory(prefix="asset-library-corrupt-") as root:
            data_dir, library_dir, index = self._fixture(root)
            broken = b'{"libraries": [broken]}'
            index.write_bytes(broken)

            async def request():
                async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=main.app),
                    base_url="http://asset-library-cross-process.test",
                ) as client:
                    return await client.post("/api/asset-library/libraries", json={"name": "不能覆盖"})

            with patch.object(main, "ASSET_LIBRARY_PATH", str(index)), patch.object(
                main, "ASSET_LIBRARY_DIR", str(library_dir)
            ), patch.object(main, "DATA_DIR", str(data_dir)):
                response = asyncio.run(request())

            self.assertEqual(response.status_code, 500)
            self.assertEqual(index.read_bytes(), broken)

    def test_nested_index_lock_is_reused_and_cleared_after_error(self):
        import main

        with tempfile.TemporaryDirectory(prefix="asset-library-nested-lock-") as root:
            data_dir, library_dir, index = self._fixture(root)
            acquisitions = 0

            @contextmanager
            def count_file_lock(_path):
                nonlocal acquisitions
                acquisitions += 1
                yield

            def close_broadcast(coroutine):
                coroutine.close()

            with patch.object(main, "ASSET_LIBRARY_PATH", str(index)), patch.object(
                main, "ASSET_LIBRARY_DIR", str(library_dir)
            ), patch.object(main, "DATA_DIR", str(data_dir)), patch.object(
                main, "interprocess_file_lock", side_effect=count_file_lock
            ), patch.object(main, "schedule_coroutine", side_effect=close_broadcast):
                with main.asset_library_index_lock():
                    library = main.load_asset_library()
                    main.save_asset_library(library)
                self.assertEqual(acquisitions, 1)
                with self.assertRaisesRegex(RuntimeError, "synthetic failure"):
                    with main.asset_library_index_lock():
                        raise RuntimeError("synthetic failure")
                self.assertIsNone(getattr(main.ASSET_LIBRARY_LOCK_STATE, "path", None))
                main.load_asset_library()
                self.assertEqual(acquisitions, 3)


if __name__ == "__main__":
    unittest.main()
