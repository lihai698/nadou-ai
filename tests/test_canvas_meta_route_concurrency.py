"""隔离并发回归：画布相邻入口不能写回过期元数据或复活已清除文件。"""

import asyncio
import json
import sys
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main


class CanvasMetaRouteConcurrencyTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.canvas_dir = Path(self.temporary.name)
        canvas_dir_patch = patch.object(main, "CANVAS_DIR", str(self.canvas_dir))
        canvas_dir_patch.start()
        self.addCleanup(canvas_dir_patch.stop)
        self.canvas_id = "isolated-route-lock"
        self.target = self.canvas_dir / f"{self.canvas_id}.json"
        self.endpoint = f"/api/canvases/{self.canvas_id}"

    def seed(self, deleted=False):
        canvas = {
            "id": self.canvas_id, "title": "旧标题", "icon": "layers",
            "kind": "classic", "updated_at": 2000,
            "nodes": [{"id": "original", "type": "text"}], "connections": [],
        }
        if deleted:
            canvas["deleted_at"] = 1999
        self.target.write_text(json.dumps(canvas, ensure_ascii=False), encoding="utf-8")

    def request(self, method, path, payload=None):
        async def send():
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=main.app),
                base_url="http://canvas-route-lock.test",
            ) as client:
                return await client.request(method, path, json=payload)
        return asyncio.run(send())

    def run_stale_read_race(self, first_method, first_path, *, deleted=False, restore_before_meta=False):
        self.seed(deleted=deleted)
        entered = threading.Event()
        second_done = threading.Event()
        real_load = main.load_canvas_any if deleted or first_method == "DELETE" else main.load_canvas
        first_call = True
        call_lock = threading.Lock()

        def pause_after_first_load(canvas_id):
            nonlocal first_call
            canvas = real_load(canvas_id)
            with call_lock:
                pause = first_call
                first_call = False
            if pause:
                entered.set()
                second_done.wait(timeout=0.35)
            return canvas

        async def second_action():
            if restore_before_meta:
                restored = await asyncio.to_thread(self.request, "POST", self.endpoint + "/restore")
                if restored.status_code != 200:
                    return restored
            return await asyncio.to_thread(self.request, "POST", self.endpoint + "/meta", {"title": "新标题"})

        load_name = "load_canvas_any" if deleted or first_method == "DELETE" else "load_canvas"
        with patch.object(main, load_name, side_effect=pause_after_first_load):
            with ThreadPoolExecutor(max_workers=2) as executor:
                first = executor.submit(self.request, first_method, first_path)
                self.assertTrue(entered.wait(timeout=3), "第一个请求未读到画布")

                def second():
                    try:
                        return asyncio.run(second_action())
                    finally:
                        second_done.set()

                second_future = executor.submit(second)
                first_response = first.result(timeout=5)
                second_response = second_future.result(timeout=5)

        self.assertEqual(first_response.status_code, 200, first_response.text)
        if first_method == "DELETE":
            self.assertEqual(second_response.status_code, 404, second_response.text)
        else:
            self.assertEqual(second_response.status_code, 200, second_response.text)
        persisted = json.loads(self.target.read_text(encoding="utf-8"))
        if first_method == "DELETE":
            self.assertEqual(persisted["title"], "旧标题")
            self.assertEqual(persisted.get("meta_revision", 0), 0)
        else:
            self.assertEqual(persisted["title"], "新标题")
            self.assertEqual(persisted["meta_revision"], 1)
        return persisted

    def test_touch_cannot_write_back_title_loaded_before_meta(self):
        persisted = self.run_stale_read_race("POST", self.endpoint + "/touch")
        self.assertNotIn("deleted_at", persisted)

    def test_soft_delete_cannot_write_back_title_loaded_before_meta(self):
        persisted = self.run_stale_read_race("DELETE", self.endpoint)
        self.assertIn("deleted_at", persisted)

    def test_restore_cannot_write_back_title_loaded_before_second_restore_and_meta(self):
        persisted = self.run_stale_read_race(
            "POST", self.endpoint + "/restore", deleted=True, restore_before_meta=True,
        )
        self.assertNotIn("deleted_at", persisted)

    def test_meta_before_delete_keeps_new_title_in_trash(self):
        self.seed()
        entered = threading.Event()
        delete_done = threading.Event()
        real_load = main.load_canvas
        first_call = True

        def pause_meta_load(canvas_id):
            nonlocal first_call
            canvas = real_load(canvas_id)
            if first_call:
                first_call = False
                entered.set()
                delete_done.wait(timeout=0.35)
            return canvas

        with patch.object(main, "load_canvas", side_effect=pause_meta_load):
            with ThreadPoolExecutor(max_workers=2) as executor:
                meta = executor.submit(self.request, "POST", self.endpoint + "/meta", {"title": "新标题"})
                self.assertTrue(entered.wait(timeout=3))

                def delete():
                    try:
                        return self.request("DELETE", self.endpoint)
                    finally:
                        delete_done.set()

                deleted = executor.submit(delete)
                self.assertEqual(meta.result(timeout=5).status_code, 200)
                self.assertEqual(deleted.result(timeout=5).status_code, 200)

        persisted = json.loads(self.target.read_text(encoding="utf-8"))
        self.assertEqual(persisted["title"], "新标题")
        self.assertEqual(persisted["meta_revision"], 1)
        self.assertIn("deleted_at", persisted)

    def test_purge_waits_for_meta_write_and_does_not_resurrect_canvas(self):
        self.seed()
        writer_entered = threading.Event()
        purge_done = threading.Event()
        real_write = main.write_json_atomic

        def paused_write(*args, **kwargs):
            writer_entered.set()
            purge_done.wait(timeout=0.35)
            return real_write(*args, **kwargs)

        with patch.object(main, "write_json_atomic", side_effect=paused_write):
            with ThreadPoolExecutor(max_workers=2) as executor:
                meta = executor.submit(self.request, "POST", self.endpoint + "/meta", {"title": "新标题"})
                self.assertTrue(writer_entered.wait(timeout=3), "元数据请求未进入写入")

                def purge():
                    try:
                        return self.request("DELETE", self.endpoint + "/purge")
                    finally:
                        purge_done.set()

                purge_future = executor.submit(purge)
                self.assertEqual(meta.result(timeout=5).status_code, 200)
                self.assertEqual(purge_future.result(timeout=5).status_code, 200)

        self.assertFalse(self.target.exists())


if __name__ == "__main__":
    unittest.main()
