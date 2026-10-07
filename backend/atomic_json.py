"""可靠地替换 JSON 和文本文件的最小写入工具。

写入过程先在目标文件同目录创建临时文件，完成 JSON 编码、刷新和
    ``fsync`` 后再通过 ``os.replace`` 替换目标。这样异常退出发生在替换前
    时，原文件仍保持可读；Windows 两个进程恰好同时替换同一目标时，只对
    短暂的 sharing violation 做有限重试；所有失败路径都会尽力清理临时文件。
"""

from __future__ import annotations

import json
import os
import tempfile
import time
from os import PathLike
from typing import Any


_WINDOWS_REPLACE_RETRY_LIMIT = 40
_WINDOWS_REPLACE_RETRY_INTERVAL = 0.025


def _is_windows_replace_sharing_violation(exc: BaseException) -> bool:
    """只识别目标被另一个替换操作短暂占用的 Windows 错误。"""

    if os.name != "nt" or not isinstance(exc, PermissionError):
        return False
    # os.replace() 在 Windows 上通常把 ERROR_ACCESS_DENIED (5) 或
    # ERROR_SHARING_VIOLATION (32) 映射为 PermissionError。不要仅按
    # PermissionError 重试，以免吞掉目录权限、只读文件等永久错误。
    return getattr(exc, "winerror", None) in {5, 32}


def _replace_with_windows_retry(source: str, target: str) -> None:
    """原子替换；仅对 Windows 的瞬时 sharing violation 重试。"""

    for attempt in range(_WINDOWS_REPLACE_RETRY_LIMIT):
        try:
            os.replace(source, target)
            return
        except PermissionError as exc:
            if not _is_windows_replace_sharing_violation(exc) or attempt + 1 >= _WINDOWS_REPLACE_RETRY_LIMIT:
                raise
            time.sleep(_WINDOWS_REPLACE_RETRY_INTERVAL)


def write_json_atomic(
    path: str | PathLike[str],
    value: Any,
    *,
    ensure_ascii: bool = False,
    indent: int | str | None = 2,
) -> None:
    """以原子替换方式写入一个 JSON 文件。

    临时文件与目标文件位于同一目录，以确保 ``os.replace`` 在同一文件
    系统内完成。目标目录不存在时创建目录；目标文件的内容格式保持由
    ``json.dump`` 参数决定，调用方可以继续使用现有的中文和缩进格式。
    """

    target = os.fspath(path)
    target_dir = os.path.dirname(os.path.abspath(target)) or os.curdir
    os.makedirs(target_dir, exist_ok=True)
    target_name = os.path.basename(target) or "data.json"
    fd, temporary = tempfile.mkstemp(
        prefix=f".{target_name}.",
        suffix=".tmp",
        dir=target_dir,
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as handle:
            json.dump(value, handle, ensure_ascii=ensure_ascii, indent=indent)
            handle.flush()
            os.fsync(handle.fileno())
        _replace_with_windows_retry(temporary, target)
    except BaseException:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        except OSError:
            # 清理失败不能遮盖原始写入异常；下次启动仍可识别临时文件。
            pass
        raise


def write_text_atomic(
    path: str | PathLike[str],
    text: str,
    *,
    encoding: str = "utf-8",
    newline: str | None = "",
) -> None:
    """以原子替换方式写入普通文本文件。

    启动时同步静态页面版本也必须经过同一临时文件和替换流程，避免
    进程在直接写入目标文件时留下半个 HTML 文件。
    """

    target = os.fspath(path)
    target_dir = os.path.dirname(os.path.abspath(target)) or os.curdir
    os.makedirs(target_dir, exist_ok=True)
    target_name = os.path.basename(target) or "data.txt"
    fd, temporary = tempfile.mkstemp(
        prefix=f".{target_name}.",
        suffix=".tmp",
        dir=target_dir,
    )
    try:
        with os.fdopen(fd, "w", encoding=encoding, newline=newline) as handle:
            handle.write(str(text))
            handle.flush()
            os.fsync(handle.fileno())
        _replace_with_windows_retry(temporary, target)
    except BaseException:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        except OSError:
            pass
        raise

