"""跨进程文件锁的最小、无第三方依赖实现。

锁文件只用于协调同一份本地索引的读改写，不承载业务数据。Windows 使用
``msvcrt`` 锁定一个字节，POSIX 使用 ``fcntl.flock``；进程退出时操作系统
会自动释放锁。调用方仍应配合原有的进程内锁，保证读、改、写处于同一锁区间。
"""

from __future__ import annotations

from contextlib import contextmanager
import os
import time
from typing import Iterator


@contextmanager
def interprocess_file_lock(
    path: str,
    *,
    timeout: float = 30.0,
    poll_interval: float = 0.05,
) -> Iterator[None]:
    """独占锁定 ``path + '.lock'``，超时则抛出 ``TimeoutError``。

    锁文件不会被删除，避免删除后被另一个进程重新创建导致锁对象分裂；
    它不包含业务 JSON。``timeout`` 必须为非负数。
    """

    clean_path = os.path.abspath(os.fspath(path))
    try:
        wait_seconds = max(0.0, float(timeout))
    except (TypeError, ValueError):
        raise ValueError("timeout 必须是非负数")
    try:
        interval = max(0.001, float(poll_interval))
    except (TypeError, ValueError):
        interval = 0.05
    lock_path = clean_path + ".lock"
    os.makedirs(os.path.dirname(lock_path), exist_ok=True)
    deadline = time.monotonic() + wait_seconds

    with open(lock_path, "a+b") as handle:
        if os.name == "nt":
            import msvcrt

            # Windows 可直接锁定空文件的第一个字节。避免多个进程同时
            # 初始化占位字节时，一个进程已加锁导致另一个进程 flush 失败。
            acquired = False
            while True:
                try:
                    handle.seek(0)
                    msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                    acquired = True
                    break
                except OSError:
                    if time.monotonic() >= deadline:
                        raise TimeoutError("跨进程文件锁等待超时")
                    time.sleep(interval)
            try:
                yield
            finally:
                if acquired:
                    try:
                        handle.seek(0)
                        msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
                    except OSError:
                        pass
            return

        try:
            import fcntl
        except ImportError as exc:  # pragma: no cover - 支持的系统均有实现
            raise OSError("当前系统不支持跨进程文件锁") from exc

        while True:
            try:
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except (BlockingIOError, OSError) as exc:
                if not isinstance(exc, BlockingIOError) and getattr(exc, "errno", None) not in {11, 13}:
                    raise
                if time.monotonic() >= deadline:
                    raise TimeoutError("跨进程文件锁等待超时")
                time.sleep(interval)
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


__all__ = ["interprocess_file_lock"]
