"""存储目录与本地媒体 URL 的无状态路径规则。

模块只根据调用方传入的目录映射和路径值计算结果；不读取默认配置、
不创建目录、不删除文件，也不依赖 FastAPI 或 ``main.py``。实际目录
设置的锁、JSON 读写及 HTTP 错误转换仍由入口层负责。
"""

from __future__ import annotations

import os
import urllib.parse
from collections.abc import Callable, Mapping
from typing import Any, Optional


class UnknownStorageKind(ValueError):
    """调用方传入了未登记的存储目录类型。"""


class UnsafeStoragePath(ValueError):
    """相对文件路径为空、越界或为 Windows 绝对路径。"""


def normalize_storage_path(value: Any, fallback: str, base_dir: str) -> str:
    """把配置中的目录值转换为绝对路径。

    空值回退到调用方传入的默认目录；相对值相对 ``base_dir`` 解析，
    并保持原有的环境变量和用户目录展开规则。
    """

    text = str(value or "").strip()
    if not text:
        return os.path.abspath(fallback)
    text = os.path.expanduser(os.path.expandvars(text))
    if not os.path.isabs(text):
        text = os.path.join(base_dir, text)
    return os.path.abspath(text)


def resolve_storage_dirs(
    raw: Mapping[str, Any] | None,
    defaults: Mapping[str, str],
    base_dir: str,
) -> dict[str, str]:
    """根据扁平设置对象得到三类存储目录的绝对路径。"""

    values = raw if isinstance(raw, Mapping) else {}
    return {
        key: normalize_storage_path(values.get(key), fallback, base_dir)
        for key, fallback in defaults.items()
    }


def output_storage(category: str, directories: Mapping[str, str]) -> tuple[str, str]:
    """返回上传/生成目录及其旧 URL 子目录名。"""

    if category == "input":
        return directories["upload"], "input"
    return directories["generated"], "output"


def output_path_for(
    filename: str,
    category: str,
    directories: Mapping[str, str],
) -> str:
    """按原兼容规则拼出输出文件路径。"""

    folder, _ = output_storage(category, directories)
    return os.path.join(folder, filename)


def output_url_for(
    filename: Any,
    category: str,
    directories: Mapping[str, str],
    assets_dir: str,
) -> str:
    """生成可供前端读取的本地媒体 URL。

    目录位于 ``assets_dir`` 内时保留旧的 ``/assets/`` URL；外部目录
    使用 ``/api/storage-files/``，以兼容可配置的外部存储路径。
    """

    folder, _ = output_storage(category, directories)
    rel = str(filename or "").replace("\\", "/").lstrip("/")
    try:
        asset_rel = os.path.relpath(
            os.path.join(folder, rel), assets_dir
        ).replace("\\", "/")
        if not asset_rel.startswith("../") and asset_rel != "..":
            return f"/assets/{urllib.parse.quote(asset_rel, safe='/')}"
    except Exception:
        pass
    kind = "upload" if category == "input" else "generated"
    return f"/api/storage-files/{kind}/{urllib.parse.quote(rel, safe='/')}"


def storage_kind_root(kind: Any, directories: Mapping[str, str]) -> str:
    """把 ``upload/generated/local`` 映射为绝对目录。"""

    normalized = str(kind or "").strip().lower()
    key = {"upload": "upload", "generated": "generated", "local": "local"}.get(normalized)
    if not key or key not in directories:
        raise UnknownStorageKind(normalized)
    return os.path.abspath(directories[key])


def normalize_storage_relative_path(rel: Any) -> str:
    """规范化存储文件相对路径，并拒绝越界或 Windows 绝对路径。

    URL 形式的开头斜杠沿用旧入口语义去掉；驱动器绝对路径和 ``..``
    越界仍会被拒绝。
    """

    rel_path = str(rel or "").replace("\\", "/").lstrip("/")
    rel_path = os.path.normpath(rel_path).replace("\\", "/")
    if (
        not rel_path
        or rel_path == "."
        or rel_path == ".."
        or rel_path.startswith("../")
        or os.path.isabs(rel_path)
    ):
        raise UnsafeStoragePath(rel_path)
    return rel_path


def storage_file_path(
    kind: Any,
    rel: Any,
    directories: Mapping[str, str],
    exists: Callable[[str], bool] | None = None,
) -> Optional[str]:
    """解析存储文件路径；文件不存在时返回 ``None``。"""

    if exists is None:
        exists = os.path.exists
    root = storage_kind_root(kind, directories)
    rel_path = normalize_storage_relative_path(rel)
    path = os.path.abspath(os.path.join(root, rel_path))
    try:
        if os.path.commonpath([root, path]) != root:
            raise UnsafeStoragePath(rel_path)
    except ValueError as exc:
        raise UnsafeStoragePath(rel_path) from exc
    return path if exists(path) else None


def _existing_under(root: str, rel: str, exists: Callable[[str], bool]) -> Optional[str]:
    """在指定根目录下解析一个安全相对路径。"""

    try:
        rel_path = normalize_storage_relative_path(rel)
        root = os.path.abspath(root)
        path = os.path.abspath(os.path.join(root, rel_path))
        if os.path.commonpath([root, path]) != root:
            return None
    except (OSError, ValueError, UnsafeStoragePath):
        return None
    return path if exists(path) else None


def output_file_from_url(
    url: Any,
    directories: Mapping[str, str],
    assets_dir: str,
    output_dir: str,
    exists: Callable[[str], bool] | None = None,
) -> Optional[str]:
    """把兼容的本地媒体 URL 解析为存在的文件路径。"""

    if exists is None:
        exists = os.path.exists
    if isinstance(url, dict):
        url = url.get("url", "")
    if not url:
        return None
    clean = urllib.parse.unquote(str(url).split("?", 1)[0]).replace("\\", "/")
    if clean.startswith("/api/storage-files/"):
        rest = clean[len("/api/storage-files/"):].lstrip("/")
        kind, _, rel = rest.partition("/")
        return storage_file_path(kind, rel, directories, exists) if kind and rel else None
    if not (clean.startswith("/output/") or clean.startswith("/assets/")):
        return None
    if clean.startswith("/assets/"):
        root = assets_dir
        rel = clean[len("/assets/"):]
        roots = (root,)
    else:
        rel = clean[len("/output/"):]
        roots = (directories["generated"], output_dir)
    rel = rel.lstrip("/")
    if not rel:
        return None
    for root in roots:
        path = _existing_under(root, rel, exists)
        if path:
            return path
    return None


__all__ = [
    "UnknownStorageKind",
    "UnsafeStoragePath",
    "normalize_storage_path",
    "resolve_storage_dirs",
    "output_storage",
    "output_path_for",
    "output_url_for",
    "storage_kind_root",
    "normalize_storage_relative_path",
    "storage_file_path",
    "output_file_from_url",
]
