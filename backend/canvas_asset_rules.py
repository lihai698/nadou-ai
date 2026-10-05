"""画布内素材引用的无状态解析规则。

本模块只处理调用方传入的节点值、URL 和路径字符串：识别一个值中的
素材 URL、判断是否允许作为可下载引用、推断媒体类型、清理展示名称，
以及递归找出画布节点中的引用。它不读取画布文件、素材目录或配置，
也不负责删除、下载和写回任何数据。

允许的依赖方向为 ``main.py -> backend.canvas_asset_rules``。画布入口仍
负责加载画布、组织公开索引和把规则结果写入 HTTP 响应；本模块不反向
导入 ``main.py``。
"""

from __future__ import annotations

import os
import re
import urllib.parse
from collections.abc import Iterator
from typing import Any

from .asset_media_rules import asset_library_media_kind


__all__ = [
    "canvas_asset_url_value",
    "canvas_asset_downloadable_url",
    "canvas_asset_kind",
    "canvas_asset_name",
    "iter_canvas_asset_values",
    "filename_from_media_url",
    "sanitize_asset_name",
    "sanitize_export_filename",
]


_ASSET_URL_KEYS = (
    "url",
    "path",
    "src",
    "uri",
    "output",
    "output_url",
    "outputUrl",
    "video",
    "video_url",
    "videoUrl",
)
_SKIPPED_NODE_KEYS = frozenset(
    {"run", "runs", "settings", "params", "metadata", "meta", "prompt", "text", "caption", "logs"}
)
_INVALID_NAME_CHARS = re.compile(r'[\\/:*?"<>|]+')


def canvas_asset_url_value(value: Any) -> str:
    """从字符串或常见素材对象字段提取 URL/路径文本。"""

    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        for key in _ASSET_URL_KEYS:
            text = str(value.get(key) or "").strip()
            if text:
                return text
    return ""


def canvas_asset_downloadable_url(url: Any) -> str:
    """只接受旧画布索引支持的本地或 HTTP(S) 素材引用。"""

    text = str(url or "").strip()
    return text if text.startswith(("/output/", "/assets/", "http://", "https://")) else ""


def canvas_asset_kind(value: Any, url: str = "") -> str:
    """根据显式媒体字段优先推断类型，未知值回退到媒体 URL 规则。"""

    explicit = ""
    if isinstance(value, dict):
        explicit = str(value.get("kind") or value.get("mediaKind") or value.get("type") or "").lower()
    if "video" in explicit:
        return "video"
    if "audio" in explicit:
        return "audio"
    if "text" in explicit:
        return "text"
    if "workflow" in explicit:
        return "workflow"
    return asset_library_media_kind(url or canvas_asset_url_value(value))


def sanitize_export_filename(name: str, fallback: str) -> str:
    """按下载/归档入口的兼容规则生成单层安全文件名。"""

    base = os.path.basename(str(name or "").strip()) or fallback
    base = _INVALID_NAME_CHARS.sub("_", base)
    return base or fallback


def filename_from_media_url(url: str, fallback: str = "download.bin") -> str:
    """从媒体 URL 取文件名并应用下载文件名清理规则。"""

    path = urllib.parse.urlsplit(str(url or "")).path
    name = os.path.basename(urllib.parse.unquote(path))
    return sanitize_export_filename(name or fallback, fallback)


def sanitize_asset_name(name: Any, fallback: str = "asset") -> str:
    """清理素材、提示词和共享文件夹共用的展示名称。"""

    value = _INVALID_NAME_CHARS.sub("_", str(name or fallback)).strip()
    return value[:120] or fallback


def canvas_asset_name(value: Any, url: str = "", fallback: str = "asset") -> str:
    """优先采用素材对象中的名称，否则从 URL 文件名生成展示名称。"""

    if isinstance(value, dict):
        for key in ("name", "filename", "file", "title"):
            name = str(value.get(key) or "").strip()
            if name:
                return sanitize_asset_name(name, fallback)
    return sanitize_asset_name(filename_from_media_url(url, fallback), fallback)


def iter_canvas_asset_values(value: Any, path: str = "") -> Iterator[tuple[str, Any, str]]:
    """递归找出节点中的素材引用，跳过运行参数、提示词和日志字段。"""

    if isinstance(value, dict):
        url = canvas_asset_downloadable_url(canvas_asset_url_value(value))
        if url:
            yield path, value, url
        for key, child in value.items():
            if key in _SKIPPED_NODE_KEYS:
                continue
            child_path = f"{path}.{key}" if path else str(key)
            yield from iter_canvas_asset_values(child, child_path)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from iter_canvas_asset_values(child, f"{path}[{index}]")
    elif isinstance(value, str):
        url = canvas_asset_downloadable_url(value)
        if url:
            yield path, value, url
