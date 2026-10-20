"""画布内素材引用的无状态解析规则。

本模块只处理调用方传入的节点值、URL 和路径字符串：识别一个值中的
素材 URL、判断是否允许作为可下载引用、推断媒体类型、清理展示名称，
以及递归找出画布节点中的引用、提取和汇总公开素材索引。它不读取画布文件、素材目录或配置，
也不负责删除、下载和写回任何数据。

允许的依赖方向为 ``main.py -> backend.canvas_asset_rules``。画布入口仍
负责通过画布存储加载文档和把汇总结果写入 HTTP 响应；本模块不反向
导入 ``main.py``。
"""

from __future__ import annotations

import hashlib
import os
import re
import urllib.parse
from collections.abc import Iterator
from typing import Any

from .asset_media_rules import asset_library_media_kind
from .canvas_records import canvas_record


__all__ = [
    "canvas_asset_url_value",
    "canvas_asset_downloadable_url",
    "canvas_asset_kind",
    "canvas_asset_name",
    "iter_canvas_asset_values",
    "filename_from_media_url",
    "sanitize_asset_name",
    "sanitize_export_filename",
    "extract_canvas_assets",
    "summarize_canvas_assets",
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


def canvas_node_title(node):
    if not isinstance(node, dict):
        return ""
    return str(node.get("title") or node.get("name") or node.get("label") or node.get("type") or "节点")[:120]


def extract_canvas_assets(canvas):
    record = canvas_record(canvas)
    canvas_id = str(record.get("id") or "")
    items = []
    seen = set()
    nodes = canvas.get("nodes") if isinstance(canvas.get("nodes"), list) else []
    for node_index, node in enumerate(nodes):
        if not isinstance(node, dict):
            continue
        node_id = str(node.get("id") or f"node_{node_index}")
        node_title = canvas_node_title(node)
        for field_path, raw, url in iter_canvas_asset_values(node):
            dedupe_key = url
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)
            kind = canvas_asset_kind(raw, url)
            if kind not in {"image", "video", "audio", "text"}:
                continue
            fallback = f"{record.get('title') or 'canvas'}-{len(items) + 1}"
            item = {
                "id": hashlib.sha1(f"{canvas_id}:{url}".encode("utf-8")).hexdigest()[:24],
                "url": url,
                "name": canvas_asset_name(raw, url, fallback),
                "kind": kind,
                "canvas_id": canvas_id,
                "canvas_title": record.get("title") or "未命名画布",
                "canvas_kind": record.get("kind") or "classic",
                "canvas_icon": record.get("icon") or "layers",
                "canvas_owner": record.get("owner") or "",
                "canvas_color": record.get("color") or "",
                "canvas_created_at": record.get("created_at") or 0,
                "canvas_updated_at": record.get("updated_at") or 0,
                "node_id": node_id,
                "node_title": node_title,
                "node_type": str(node.get("type") or ""),
                "source_path": field_path,
                "created_at": node.get("created_at") or record.get("updated_at") or record.get("created_at") or 0,
            }
            if isinstance(raw, dict):
                for key in ("natural_w", "natural_h", "width", "height", "size", "duration", "runMs"):
                    if raw.get(key) is not None:
                        item[key] = raw.get(key)
            items.append(item)
    return items


def summarize_canvas_assets(documents):
    canvases = []
    items = []
    canvas_counts = {"all": 0, "smart": 0, "classic": 0}
    item_counts = {"all": 0, "smart": 0, "classic": 0}
    for canvas in documents:
        record = canvas_record(canvas)
        canvas_items = extract_canvas_assets(canvas)
        record["asset_count"] = len(canvas_items)
        canvases.append(record)
        items.extend(canvas_items)
        kind = record.get("kind") or "classic"
        canvas_counts["all"] += 1
        canvas_counts[kind] = canvas_counts.get(kind, 0) + 1
        item_counts["all"] += len(canvas_items)
        item_counts[kind] = item_counts.get(kind, 0) + len(canvas_items)
    canvases.sort(key=lambda item: (0 if item.get("pinned") else 1, -int(item.get("updated_at") or item.get("created_at") or 0)))
    items.sort(key=lambda item: int(item.get("canvas_updated_at") or item.get("created_at") or 0), reverse=True)
    categories = [
        {"id": "all", "name": "全部画布", "count": item_counts.get("all", 0), "canvas_count": canvas_counts.get("all", 0)},
        {"id": "smart", "name": "智能画布", "count": item_counts.get("smart", 0), "canvas_count": canvas_counts.get("smart", 0)},
        {"id": "classic", "name": "普通画布", "count": item_counts.get("classic", 0), "canvas_count": canvas_counts.get("classic", 0)},
    ]
    return {"categories": categories, "canvases": canvases, "items": items}
