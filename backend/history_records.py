"""历史记录读取与公开列表规则。

本模块只接收调用方提供的历史文件路径或记录序列。它不拥有历史文件路径、
锁、媒体删除权限或 FastAPI 路由；调用方负责决定数据目录、并发边界和错误
响应。这样历史列表的筛选和排序规则可以独立测试，避免各个入口重复实现。
"""

from __future__ import annotations

import json
import os
from typing import Any, Iterable, List


def read_history_records(path: str) -> Any:
    """读取指定历史 JSON 文件；文件不存在时返回空列表。

    文件格式校验和异常转换仍交给入口层处理，以保留现有 API 的错误回退
    语义。路径必须由调用方传入，本模块不会读取默认项目目录或用户配置。
    """

    if not os.path.exists(path):
        return []
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def history_record_timestamp(record: dict) -> float:
    """返回历史记录的兼容排序时间；非数字时间按 0 处理。"""

    timestamp = record.get("timestamp", 0)
    if isinstance(timestamp, (int, float)):
        return float(timestamp)
    return 0


def history_records_for_api(
    records: Iterable[dict], record_type: str | None = None
) -> List[dict]:
    """按历史接口规则筛选有图片的记录并按时间倒序返回。"""

    data = list(records)
    if record_type:
        data = [item for item in data if item.get("type", "zimage") == record_type]
    data = [item for item in data if item.get("images") and len(item["images"]) > 0]
    data.sort(key=history_record_timestamp, reverse=True)
    return data


__all__ = [
    "history_record_timestamp",
    "history_records_for_api",
    "read_history_records",
]
