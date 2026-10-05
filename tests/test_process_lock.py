"""验证本地索引跨进程锁的等待和释放边界。"""

import multiprocessing
import queue
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.process_lock import interprocess_file_lock


def _hold_lock(path, ready, release, errors):
    try:
        with interprocess_file_lock(path, timeout=5):
            ready.set()
            if not release.wait(5):
                raise RuntimeError("测试锁未收到释放信号")
    except BaseException as exc:  # 交给父进程断言，避免静默子进程失败
        errors.put(type(exc).__name__)


def _wait_for_lock(path, started_event, acquired):
    try:
        lock_started = time.monotonic()
        # 进程已经进入等待前的时刻，避免把 spawn 启动耗时混入锁等待断言。
        started_event.set()
        with interprocess_file_lock(path, timeout=5):
            acquired.put(time.monotonic() - lock_started)
    except BaseException as exc:
        acquired.put(type(exc).__name__)


class ProcessLockTests(unittest.TestCase):
    def test_second_process_waits_until_first_process_releases(self):
        context = multiprocessing.get_context("spawn")
        with tempfile.TemporaryDirectory(prefix="process-lock-") as root:
            target = str(Path(root) / "storage_settings.json")
            ready = context.Event()
            release = context.Event()
            errors = context.Queue()
            acquired = context.Queue()
            waiter_started = context.Event()
            holder = context.Process(target=_hold_lock, args=(target, ready, release, errors))
            waiter = None
            holder.start()
            try:
                self.assertTrue(ready.wait(5), "第一个进程未取得锁")
                waiter = context.Process(target=_wait_for_lock, args=(target, waiter_started, acquired))
                waiter.start()
                self.assertTrue(waiter_started.wait(5), "第二个进程未进入锁等待")
                with self.assertRaises(queue.Empty):
                    acquired.get(timeout=0.2)
                release.set()
                waiter.join(5)
                self.assertFalse(waiter.is_alive())
                elapsed = acquired.get(timeout=2)
                self.assertIsInstance(elapsed, float)
                self.assertGreaterEqual(elapsed, 0.15)
                self.assertTrue(errors.empty(), errors.get_nowait() if not errors.empty() else "")
            finally:
                release.set()
                if waiter is not None:
                    waiter.join(5)
                    if waiter.is_alive():
                        waiter.terminate()
                        waiter.join(2)
                holder.join(5)
                if holder.is_alive():
                    holder.terminate()
                    holder.join(2)
            self.assertEqual(holder.exitcode, 0)
            self.assertTrue(errors.empty(), errors.get_nowait() if not errors.empty() else "")


if __name__ == "__main__":
    unittest.main()
