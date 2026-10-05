"""验证任务记录写入会等待目录级跨进程维护锁。"""

import multiprocessing
import queue
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.task_records import read_task_record, task_records_lock, write_task_record


def _write_task_after_start(root: str, started, result) -> None:
    try:
        started.set()
        write_task_record(root, {
            "id": "canvas_img_cross_process_1234",
            "status": "succeeded",
            "updated_at": 100.0,
        })
        result.put("ok")
    except BaseException as exc:  # 交给父进程断言，避免静默子进程失败
        result.put(type(exc).__name__)


class TaskRecordCrossProcessTests(unittest.TestCase):
    def test_write_waits_for_directory_maintenance_lock(self):
        context = multiprocessing.get_context("spawn")
        with tempfile.TemporaryDirectory(prefix="task-record-lock-") as root:
            started = context.Event()
            result = context.Queue()
            writer = context.Process(
                target=_write_task_after_start,
                args=(root, started, result),
            )
            with task_records_lock(root):
                writer.start()
                self.assertTrue(started.wait(5), "写入进程未开始")
                with self.assertRaises(queue.Empty):
                    result.get(timeout=0.2)
            writer.join(5)
            self.assertFalse(writer.is_alive())
            self.assertEqual(writer.exitcode, 0)
            self.assertEqual(result.get(timeout=2), "ok")
            self.assertEqual(
                read_task_record(root, "canvas_img_cross_process_1234")["status"],
                "succeeded",
            )


if __name__ == "__main__":
    unittest.main()
