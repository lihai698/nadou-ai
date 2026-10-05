"""内置本地媒体识别扩展示例。

它只接收上传入口已经读取的文件名、Content-Type 和少量文件头字节，返回
媒体类型与安全扩展名。没有文件系统、网络或供应商依赖，停用后不影响素材库
和生成任务；真实导入仍由主入口负责保存和写入素材索引。
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from .asset_media_rules import (
    _local_upload_display_name,
    _local_upload_kind_ext,
    _sniff_image_ext_bytes,
)
from .extensions import ExtensionDescriptor, ExtensionError


def probe_local_media(payload: Mapping[str, Any]) -> dict[str, Any]:
    filename = payload.get("filename")
    content_type = payload.get("content_type", "")
    head = payload.get("head", b"")
    if not isinstance(filename, str) or not filename.strip() or len(filename) > 240:
        raise ExtensionError("文件名无效")
    if not isinstance(content_type, str) or len(content_type) > 128:
        raise ExtensionError("Content-Type 无效")
    if not isinstance(head, (bytes, bytearray)) or len(head) > 128:
        raise ExtensionError("文件头无效")
    kind, extension = _local_upload_kind_ext(filename, content_type)
    if not kind:
        raise ExtensionError("不支持的媒体类型")
    detected_extension = _sniff_image_ext_bytes(bytes(head)) if kind == "image" else None
    return {
        "kind": kind,
        "extension": extension,
        "detected_extension": detected_extension or extension,
        "display_name": _local_upload_display_name(filename)[:240],
    }


LOCAL_MEDIA_EXTENSION = ExtensionDescriptor(
    id="local-media-metadata",
    name="本地媒体类型识别",
    version="1.0.0",
    license="MIT",
    source="nadou-ai 内置扩展示例",
    input_schema={
        "filename": "string",
        "content_type": "string",
        "head": "bytes<=128",
    },
    output_schema={
        "kind": "image|video|audio",
        "extension": "safe extension",
        "detected_extension": "sniffed image extension or safe extension",
        "display_name": "string",
    },
    handler=probe_local_media,
)


__all__ = ["LOCAL_MEDIA_EXTENSION", "probe_local_media"]
