"""受控诊断日志落盘。

日志文件只接收调用方已经脱敏的摘要；本模块负责文件目录、单条长度和
按大小轮转，不读取配置或用户数据，也不依赖应用入口。
"""

from __future__ import annotations

import logging
from logging.handlers import RotatingFileHandler
import os
from threading import RLock
from typing import Optional


LOGGER_NAME = "nadou.diagnostics"
DEFAULT_MAX_BYTES = 2 * 1024 * 1024
DEFAULT_BACKUP_COUNT = 3
MAX_MESSAGE_LENGTH = 2000
# 日志大小由本地配置控制，但必须有明确上限，避免配置错误把磁盘写满。
MIN_MAX_BYTES = 1024
MAX_MAX_BYTES = 64 * 1024 * 1024
MIN_BACKUP_COUNT = 1
MAX_BACKUP_COUNT = 20

_LOGGER = logging.getLogger(LOGGER_NAME)
_LOGGER.propagate = False
_LOGGER.setLevel(logging.INFO)
_CONFIG_LOCK = RLock()
_HANDLER: Optional[RotatingFileHandler] = None


def configure_diagnostics(
    path: str = "",
    max_bytes: int = DEFAULT_MAX_BYTES,
    backup_count: int = DEFAULT_BACKUP_COUNT,
) -> str:
    """配置诊断日志文件并返回实际路径；空路径会关闭文件日志。"""

    global _HANDLER
    clean_path = os.path.abspath(str(path or "").strip()) if str(path or "").strip() else ""
    clean_max_bytes = _bounded_int(
        max_bytes, DEFAULT_MAX_BYTES, MIN_MAX_BYTES, MAX_MAX_BYTES
    )
    clean_backup_count = _bounded_int(
        backup_count, DEFAULT_BACKUP_COUNT, MIN_BACKUP_COUNT, MAX_BACKUP_COUNT
    )

    with _CONFIG_LOCK:
        if _HANDLER is not None:
            _LOGGER.removeHandler(_HANDLER)
            _HANDLER.close()
            _HANDLER = None
        if not clean_path:
            return ""
        os.makedirs(os.path.dirname(clean_path), exist_ok=True)
        handler = RotatingFileHandler(
            clean_path,
            maxBytes=clean_max_bytes,
            backupCount=clean_backup_count,
            encoding="utf-8",
            delay=True,
        )
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
        _LOGGER.addHandler(handler)
        _HANDLER = handler
        return clean_path


def write_diagnostic(message: str, level: int = logging.INFO) -> None:
    """写入一条已脱敏诊断摘要，并限制单条日志长度。"""

    text = str(message or "")[:MAX_MESSAGE_LENGTH]
    if not text:
        return
    with _CONFIG_LOCK:
        if _HANDLER is None:
            return
        _LOGGER.log(level, text)


def diagnostics_configured() -> bool:
    """返回当前进程是否已启用诊断文件日志。"""

    with _CONFIG_LOCK:
        return _HANDLER is not None


def _bounded_int(value: object, fallback: int, minimum: int, maximum: int) -> int:
    """将日志轮转参数限制在可用范围内；无效值使用安全默认值。"""

    try:
        # ``bool`` 是 int 的子类，配置中出现 True/False 时应视为无效。
        if isinstance(value, bool):
            raise ValueError
        parsed = int(str(value).strip())
    except (TypeError, ValueError, OverflowError):
        return fallback
    return min(max(parsed, minimum), maximum)
