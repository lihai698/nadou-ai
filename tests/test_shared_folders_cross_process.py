"""验证共享文件夹索引的读改写不会跨进程丢更新。"""

import json
import multiprocessing
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def _append_shared_folder(index_path: str, data_dir: str, name: str, ready, go, result):
    try:
        import main

        main.SHARED_FOLDERS_FILE = index_path
        main.DATA_DIR = data_dir
        ready.set()
        if not go.wait(5):
            raise RuntimeError("测试进程未收到开始信号")

        def update(data):
            # 故意把读改写窗口拉长，确保两个进程会同时竞争同一份索引。
            time.sleep(0.15)
            data.setdefault("folders", []).append({
                "id": f"shared_{name}",
                "name": name,
                "rel": f"shared/{name}",
                "created_at": 1,
            })

        main._shared_folders_update(update)
        result.put("ok")
    except BaseException as exc:  # 交给父进程断言，避免静默子进程失败
        result.put(type(exc).__name__)


class SharedFoldersCrossProcessTests(unittest.TestCase):
    def test_two_process_read_modify_write_keeps_both_entries(self):
        context = multiprocessing.get_context("spawn")
        with tempfile.TemporaryDirectory(prefix="shared-folders-cross-process-") as root:
            data_dir = Path(root) / "data"
            data_dir.mkdir()
            index = data_dir / "shared_folders.json"
            ready_a = context.Event()
            ready_b = context.Event()
            go = context.Event()
            result = context.Queue()
            workers = [
                context.Process(
                    target=_append_shared_folder,
                    args=(str(index), str(data_dir), "a", ready_a, go, result),
                ),
                context.Process(
                    target=_append_shared_folder,
                    args=(str(index), str(data_dir), "b", ready_b, go, result),
                ),
            ]
            for worker in workers:
                worker.start()
            try:
                self.assertTrue(ready_a.wait(10), "进程 A 未准备好")
                self.assertTrue(ready_b.wait(10), "进程 B 未准备好")
                go.set()
                for worker in workers:
                    worker.join(10)
                self.assertTrue(all(not worker.is_alive() for worker in workers))
                self.assertEqual([result.get(timeout=2) for _ in workers], ["ok", "ok"])
            finally:
                go.set()
                for worker in workers:
                    if worker.is_alive():
                        worker.terminate()
                        worker.join(2)
            saved = json.loads(index.read_text(encoding="utf-8"))
            self.assertEqual({item["name"] for item in saved["folders"]}, {"a", "b"})
            self.assertEqual(list(data_dir.glob(".shared_folders.json.*.tmp")), [])


if __name__ == "__main__":
    unittest.main()
