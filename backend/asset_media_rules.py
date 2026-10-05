"""素材库与本地上传共用的无状态媒体识别规则。

这里只处理调用方传入的文件名、Content-Type 或文件头字节；不访问文件和用户数据。
素材库与本地上传支持的扩展名不同，分别保持原有判断顺序。
"""

import os
import re


def asset_library_media_kind(path: str, content_type: str = "") -> str:
    ext = os.path.splitext(path or "")[1].lower()
    ct = (content_type or "").lower()
    if ext in {".json", ".zip"}:
        return "workflow"
    if ext in {".mp4", ".webm", ".mov", ".m4v", ".avi", ".mkv"} or ct.startswith("video/"):
        return "video"
    if ext in {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"} or ct.startswith("audio/"):
        return "audio"
    return "image"


def asset_library_safe_extension(path: str, kind: str) -> str:
    ext = os.path.splitext(path or "")[1].lower()
    allowed = {
        "image": {".png", ".jpg", ".jpeg", ".webp", ".gif"},
        "video": {".mp4", ".webm", ".mov", ".m4v", ".avi", ".mkv"},
        "audio": {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"},
        "workflow": {".json", ".zip"},
    }
    fallback = {"image": ".png", "video": ".mp4", "audio": ".mp3", "workflow": ".zip"}
    return ext if ext in allowed.get(kind, allowed["image"]) else fallback.get(kind, ".png")


def _local_upload_kind_ext(filename, content_type):
    image_exts = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
    video_exts = {".mp4", ".webm", ".mov", ".m4v", ".flv"}
    audio_exts = {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"}
    ext = os.path.splitext(filename or "")[1].lower()
    ct = (content_type or "").lower()
    if ext in video_exts or ct.startswith("video/"):
        if ext not in video_exts:
            ext = ".webm" if "webm" in ct else ".mov" if "quicktime" in ct else ".mp4"
        return "video", ext
    if ext in audio_exts or ct.startswith("audio/"):
        if ext not in audio_exts:
            ext = ".wav" if "wav" in ct else ".ogg" if "ogg" in ct else ".m4a" if "mp4" in ct else ".mp3"
        return "audio", ext
    if ext in image_exts or ct.startswith("image/"):
        if ext not in image_exts:
            ext = ".jpg" if "jpeg" in ct else ".webp" if "webp" in ct else ".gif" if "gif" in ct else ".png"
        return "image", ext
    return None, ext


def _local_upload_display_name(filename):
    # 文件名形如 up_<hex>_<原始名>；去掉前缀还原展示名
    base = os.path.basename(str(filename or ""))
    m = re.match(r"^up_[0-9a-f]{12}_(.+)$", base)
    return m.group(1) if m else base


def _sniff_image_ext_bytes(head):
    """按文件头魔数判断真实图片格式，无法识别返回 None。"""
    head = head or b""
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if head.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return ".webp"
    if head[:6] in (b"GIF87a", b"GIF89a"):
        return ".gif"
    if head[:2] == b"BM":
        return ".bmp"
    return None


__all__ = [
    "asset_library_media_kind",
    "asset_library_safe_extension",
    "_local_upload_kind_ext",
    "_local_upload_display_name",
    "_sniff_image_ext_bytes",
]
