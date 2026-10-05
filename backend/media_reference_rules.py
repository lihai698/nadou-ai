"""本地媒体引用的无状态递归规则。

删除媒体前需要在画布、对话、历史和素材索引中查找引用。文件扫描、锁、
URL 到真实文件路径的解析以及删除事务仍由应用入口负责；本模块只处理
调用方传入的 JSON 值，并通过一个显式解析器判断字符串是否指向目标文件。
这样可以独立测试引用边界，也避免规则模块取得任何持久化数据所有权。
"""

from __future__ import annotations

import os
from collections.abc import Callable
from typing import Any, Optional


LOCAL_MEDIA_URL_PREFIXES = ("/assets/", "/output/", "/api/storage-files/")


def collect_local_media_urls(value: Any) -> list[str]:
    """递归收集 JSON 值中的本地媒体 URL，保留出现顺序和重复项。"""

    urls: list[str] = []
    if isinstance(value, str):
        text = value.strip()
        if text.startswith(LOCAL_MEDIA_URL_PREFIXES):
            urls.append(text)
    elif isinstance(value, dict):
        for item in value.values():
            urls.extend(collect_local_media_urls(item))
    elif isinstance(value, (list, tuple)):
        for item in value:
            urls.extend(collect_local_media_urls(item))
    return urls


def json_value_references_media_path(
    value: Any,
    target_path: str,
    resolve_local_path: Callable[[str], Optional[str]],
) -> bool:
    """判断 JSON 值是否引用目标文件。

    ``resolve_local_path`` 由入口提供，负责 URL 映射和文件存在性检查；
    解析异常被视为“无法确认引用”，由调用方决定在不可读文件时是否保留。
    本函数本身不访问文件系统。
    """

    target = os.path.normcase(os.path.realpath(target_path))
    if isinstance(value, str):
        try:
            resolved = resolve_local_path(value.strip())
        except Exception:
            return False
        return bool(resolved and os.path.normcase(os.path.realpath(resolved)) == target)
    if isinstance(value, dict):
        return any(
            json_value_references_media_path(item, target_path, resolve_local_path)
            for item in value.values()
        )
    if isinstance(value, (list, tuple)):
        return any(
            json_value_references_media_path(item, target_path, resolve_local_path)
            for item in value
        )
    return False


__all__ = [
    "LOCAL_MEDIA_URL_PREFIXES",
    "collect_local_media_urls",
    "json_value_references_media_path",
]
