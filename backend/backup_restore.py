"""本地项目快照、校验与隔离恢复工具。

快照包含调用方指定目录中的普通文件和 SHA256 清单，不写入 Git 历史，也不
会自动覆盖已有目录。创建与恢复都先写同级临时目录，完整校验后再一次性改名；
这样中途中断不会留下一个看起来完整但内容不全的目标目录。模块不在导入时
扫描项目目录，真实备份必须由显式调用方发起。
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
from typing import Iterable, Optional

from .atomic_json import write_json_atomic


SNAPSHOT_FORMAT_VERSION = 1
SNAPSHOT_MANIFEST_NAME = "SNAPSHOT_MANIFEST.json"
_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_EXCLUDED_DIR_NAMES = frozenset({".git", "__pycache__"})


class BackupRestoreError(ValueError):
    """快照结构、路径或内容不符合安全边界。"""


@dataclass(frozen=True)
class SnapshotFile:
    relative_path: str
    size: int
    sha256: str


def _root(path: os.PathLike[str] | str, *, name: str) -> Path:
    try:
        raw = Path(path).expanduser()
        if raw.is_symlink():
            raise BackupRestoreError(f"{name}必须是普通目录")
        value = raw.resolve()
    except (OSError, RuntimeError, TypeError) as exc:
        raise BackupRestoreError(f"{name}路径无效") from exc
    if not value.is_dir() or value.is_symlink():
        raise BackupRestoreError(f"{name}必须是普通目录")
    return value


def _relative_path(path: Path, root: Path, *, allow_manifest: bool = False) -> str:
    try:
        relative = path.resolve().relative_to(root)
    except (OSError, RuntimeError, ValueError) as exc:
        raise BackupRestoreError("快照文件路径越界") from exc
    if path.is_symlink() or not path.is_file():
        raise BackupRestoreError("快照只允许普通文件")
    value = relative.as_posix()
    if not value or (value == SNAPSHOT_MANIFEST_NAME and not allow_manifest) or ".." in Path(value).parts:
        raise BackupRestoreError("快照相对路径无效")
    return value


def _iter_source_files(root: Path, *, allow_manifest: bool = False) -> Iterable[tuple[Path, str]]:
    for current, dir_names, file_names in os.walk(root, topdown=True, followlinks=False):
        current_path = Path(current)
        kept_dirs = []
        for name in sorted(dir_names):
            directory = current_path / name
            if directory.is_symlink():
                raise BackupRestoreError(f"快照目录不能是符号链接：{name}")
            if name in _EXCLUDED_DIR_NAMES:
                continue
            if not directory.is_dir():
                raise BackupRestoreError("快照目录必须是普通目录")
            kept_dirs.append(name)
        dir_names[:] = kept_dirs
        for name in sorted(file_names):
            path = current_path / name
            yield path, _relative_path(path, root, allow_manifest=allow_manifest)


def _sha256(path: Path) -> tuple[int, str]:
    digest = hashlib.sha256()
    size = 0
    try:
        with path.open("rb") as handle:
            for block in iter(lambda: handle.read(1024 * 1024), b""):
                size += len(block)
                digest.update(block)
    except OSError as exc:
        raise BackupRestoreError("快照文件无法读取") from exc
    return size, digest.hexdigest()


def _manifest_payload(files: list[SnapshotFile]) -> dict:
    return {
        "format_version": SNAPSHOT_FORMAT_VERSION,
        "files": [
            {"path": item.relative_path, "size": item.size, "sha256": item.sha256}
            for item in files
        ],
    }


def _read_manifest(snapshot: Path) -> tuple[SnapshotFile, ...]:
    path = snapshot / SNAPSHOT_MANIFEST_NAME
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise BackupRestoreError("快照清单无法读取") from exc
    if not isinstance(raw, dict) or raw.get("format_version") != SNAPSHOT_FORMAT_VERSION:
        raise BackupRestoreError("快照清单版本不支持")
    entries = raw.get("files")
    if not isinstance(entries, list):
        raise BackupRestoreError("快照清单缺少文件列表")
    result: list[SnapshotFile] = []
    seen: set[str] = set()
    seen_normalized: set[str] = set()
    for entry in entries:
        if not isinstance(entry, dict):
            raise BackupRestoreError("快照清单条目无效")
        raw_value = entry.get("path")
        if not isinstance(raw_value, str):
            raise BackupRestoreError("快照清单路径无效")
        value = raw_value.replace("\\", "/")
        candidate = Path(value)
        normalized_value = os.path.normcase(value)
        if (
            not value
            or candidate.is_absolute()
            or value != candidate.as_posix()
            or ".." in candidate.parts
            or value == SNAPSHOT_MANIFEST_NAME
            or value in seen
            or normalized_value in seen_normalized
        ):
            raise BackupRestoreError("快照清单包含不安全路径")
        size = entry.get("size")
        digest = str(entry.get("sha256") or "").lower()
        if isinstance(size, bool) or not isinstance(size, int) or size < 0 or not _SHA256_RE.fullmatch(digest):
            raise BackupRestoreError("快照清单摘要无效")
        seen.add(value)
        seen_normalized.add(normalized_value)
        result.append(SnapshotFile(value, size, digest))
    return tuple(result)


def _ensure_empty_destination(path: Path, *, name: str) -> None:
    if path.exists() or path.is_symlink():
        raise BackupRestoreError(f"{name}必须是不存在的新目录")
    parent = path.parent
    if not parent.is_dir() or parent.is_symlink():
        raise BackupRestoreError("快照目标父目录无效")


def _new_destination(path: os.PathLike[str] | str, *, name: str) -> Path:
    try:
        raw = Path(path).expanduser()
    except (TypeError, ValueError) as exc:
        raise BackupRestoreError(f"{name}路径无效") from exc
    if raw.exists() or raw.is_symlink():
        raise BackupRestoreError(f"{name}必须是不存在的新目录")
    if raw.parent.is_symlink():
        raise BackupRestoreError("快照目标父目录不能是符号链接")
    resolved = raw.resolve()
    _ensure_empty_destination(resolved, name=name)
    return resolved


def _copy_files(source: Path, destination: Path, files: Iterable[SnapshotFile]) -> None:
    for item in files:
        source_path = source / Path(item.relative_path)
        destination_path = destination / Path(item.relative_path)
        try:
            source_real = source_path.resolve()
            if source_path.is_symlink() or not source_path.is_file() or not source_real.is_relative_to(source):
                raise BackupRestoreError("快照文件路径无效")
            destination_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source_path, destination_path)
        except BackupRestoreError:
            raise
        except (OSError, shutil.Error) as exc:
            raise BackupRestoreError("快照文件复制失败") from exc


def create_snapshot(
    source_root: os.PathLike[str] | str,
    snapshot_dir: os.PathLike[str] | str,
) -> dict:
    """创建一个不覆盖已有目录的完整普通文件快照。"""

    source = _root(source_root, name="源")
    target = _new_destination(snapshot_dir, name="快照目录")
    if target == source or target.is_relative_to(source):
        raise BackupRestoreError("快照目标不能位于源目录内")
    _ensure_empty_destination(target, name="快照目录")
    target.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f".{target.name}.", dir=target.parent))
    try:
        files: list[SnapshotFile] = []
        for source_path, relative in _iter_source_files(source):
            destination_path = staging / Path(relative)
            destination_path.parent.mkdir(parents=True, exist_ok=True)
            try:
                shutil.copy2(source_path, destination_path)
            except (OSError, shutil.Error) as exc:
                raise BackupRestoreError("快照文件复制失败") from exc
            size, digest = _sha256(destination_path)
            files.append(SnapshotFile(relative, size, digest))
        files.sort(key=lambda item: item.relative_path)
        write_json_atomic(staging / SNAPSHOT_MANIFEST_NAME, _manifest_payload(files), ensure_ascii=False, indent=2)
        os.replace(staging, target)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    return verify_snapshot(target)


def verify_snapshot(snapshot_dir: os.PathLike[str] | str) -> dict:
    """校验快照清单、文件哈希和清单外文件。"""

    snapshot = _root(snapshot_dir, name="快照")
    files = _read_manifest(snapshot)
    listed = {item.relative_path for item in files}
    actual = set()
    for path, relative in _iter_source_files(snapshot, allow_manifest=True):
        if relative == SNAPSHOT_MANIFEST_NAME:
            continue
        actual.add(relative)
        if relative not in listed:
            raise BackupRestoreError("快照目录含清单外文件")
    if actual != listed:
        raise BackupRestoreError("快照清单与文件数量不一致")
    for item in files:
        path = snapshot / Path(item.relative_path)
        size, digest = _sha256(path)
        if size != item.size or digest != item.sha256:
            raise BackupRestoreError("快照文件校验失败")
    return {"format_version": SNAPSHOT_FORMAT_VERSION, "file_count": len(files), "bytes": sum(item.size for item in files)}


def restore_snapshot(
    snapshot_dir: os.PathLike[str] | str,
    destination_root: os.PathLike[str] | str,
) -> dict:
    """把已校验快照恢复到新的空目录，绝不覆盖既有目录。"""

    snapshot = _root(snapshot_dir, name="快照")
    verify_snapshot(snapshot)
    destination = _new_destination(destination_root, name="恢复目录")
    destination.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f".{destination.name}.", dir=destination.parent))
    try:
        files = _read_manifest(snapshot)
        _copy_files(snapshot, staging, files)
        write_json_atomic(staging / SNAPSHOT_MANIFEST_NAME, _manifest_payload(list(files)), ensure_ascii=False, indent=2)
        os.replace(staging, destination)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    return verify_snapshot(destination)


__all__ = [
    "BackupRestoreError",
    "SNAPSHOT_FORMAT_VERSION",
    "SNAPSHOT_MANIFEST_NAME",
    "SnapshotFile",
    "create_snapshot",
    "restore_snapshot",
    "verify_snapshot",
]
