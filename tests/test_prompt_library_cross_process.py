"""验证提示词库真实新增入口的跨进程读改写。"""

import asyncio
import json
import multiprocessing
import sys
import tempfile
import time
import traceback
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def _create_prompt_library(index_path: str, data_dir: str, name: str, ready, go, result):
    try:
        import main

        main.PROMPT_LIBRARY_PATH = index_path
        main.DATA_DIR = data_dir
        original_load = main._load_prompt_libraries_unlocked

        def delayed_load(*, strict=False):
            data = original_load(strict=strict)
            time.sleep(0.15)
            return data

        main._load_prompt_libraries_unlocked = delayed_load
        ready.set()
        if not go.wait(5):
            raise RuntimeError("测试进程未收到开始信号")
        response = asyncio.run(main.create_prompt_library(main.PromptLibraryRequest(name=name)))
        result.put(response["prompt_library"]["name"])
    except BaseException as exc:  # 交给父进程断言，避免静默子进程失败
        result.put(traceback.format_exc())


class PromptLibraryCrossProcessTests(unittest.TestCase):
    def test_two_process_creates_keep_both_libraries(self):
        context = multiprocessing.get_context("spawn")
        with tempfile.TemporaryDirectory(prefix="prompt-library-cross-process-") as root:
            data_dir = Path(root) / "data"
            data_dir.mkdir()
            index = data_dir / "prompt_libraries.json"
            ready_a = context.Event()
            ready_b = context.Event()
            go = context.Event()
            result = context.Queue()
            workers = [
                context.Process(
                    target=_create_prompt_library,
                    args=(str(index), str(data_dir), "并发甲", ready_a, go, result),
                ),
                context.Process(
                    target=_create_prompt_library,
                    args=(str(index), str(data_dir), "并发乙", ready_b, go, result),
                ),
            ]
            for worker in workers:
                worker.start()
            try:
                self.assertTrue(ready_a.wait(10), "进程甲未准备好")
                self.assertTrue(ready_b.wait(10), "进程乙未准备好")
                go.set()
                for worker in workers:
                    worker.join(10)
                self.assertTrue(all(not worker.is_alive() for worker in workers))
                self.assertEqual({result.get(timeout=2) for _ in workers}, {"并发甲", "并发乙"})
            finally:
                go.set()
                for worker in workers:
                    if worker.is_alive():
                        worker.terminate()
                        worker.join(2)
            saved = json.loads(index.read_text(encoding="utf-8"))
            self.assertEqual(
                {library["name"] for library in saved["libraries"] if library["id"] != "system"},
                {"并发甲", "并发乙"},
            )
            self.assertEqual(list(data_dir.glob(".prompt_libraries.json.*.tmp")), [])

    def test_corrupt_file_refuses_mutating_route_without_overwrite(self):
        import main

        with tempfile.TemporaryDirectory(prefix="prompt-library-corrupt-") as root:
            data_dir = Path(root) / "data"
            data_dir.mkdir()
            index = data_dir / "prompt_libraries.json"
            before = b'{"libraries": [broken]}'
            index.write_bytes(before)
            with patch.object(main, "PROMPT_LIBRARY_PATH", str(index)), patch.object(main, "DATA_DIR", str(data_dir)):
                with self.assertRaises(main.HTTPException) as caught:
                    asyncio.run(main.create_prompt_library(main.PromptLibraryRequest(name="不应覆盖")))
            self.assertEqual(caught.exception.status_code, 500)
            self.assertEqual(index.read_bytes(), before)

    def test_registered_routes_preserve_library_item_category_flow(self):
        import main

        async def exercise():
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=main.app),
                base_url="http://prompt-library.test",
            ) as client:
                created = await client.post("/api/prompt-libraries", json={"name": "流程库"})
                self.assertEqual(created.status_code, 200, created.text)
                library_id = created.json()["prompt_library"]["id"]
                category = await client.post(
                    "/api/prompt-libraries/categories",
                    json={"library_id": library_id, "name": "流程分组"},
                )
                self.assertEqual(category.status_code, 200, category.text)
                category_id = category.json()["category"]["id"]
                item = await client.post(
                    "/api/prompt-libraries/items",
                    json={"library_id": library_id, "category": category_id, "name": "流程提示词", "positive": "测试内容"},
                )
                self.assertEqual(item.status_code, 200, item.text)
                item_id = item.json()["item"]["id"]
                renamed = await client.patch(
                    f"/api/prompt-libraries/{library_id}", json={"name": "改名流程库"},
                )
                self.assertEqual(renamed.status_code, 200, renamed.text)
                removed_item = await client.delete(f"/api/prompt-libraries/items/{item_id}")
                self.assertEqual(removed_item.status_code, 200, removed_item.text)
                removed_category = await client.delete(f"/api/prompt-libraries/categories/{category_id}")
                self.assertEqual(removed_category.status_code, 200, removed_category.text)
                removed_library = await client.delete(f"/api/prompt-libraries/{library_id}")
                self.assertEqual(removed_library.status_code, 200, removed_library.text)
                listed = await client.get("/api/prompt-libraries")
                self.assertEqual(listed.status_code, 200, listed.text)
                self.assertFalse(any(lib["id"] == library_id for lib in listed.json()["library"]["libraries"]))

        with tempfile.TemporaryDirectory(prefix="prompt-library-routes-") as root:
            data_dir = Path(root) / "data"
            data_dir.mkdir()
            index = data_dir / "prompt_libraries.json"
            with patch.object(main, "PROMPT_LIBRARY_PATH", str(index)), patch.object(main, "DATA_DIR", str(data_dir)):
                asyncio.run(exercise())


if __name__ == "__main__":
    unittest.main()
