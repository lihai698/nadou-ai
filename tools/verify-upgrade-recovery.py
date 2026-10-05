"""在隔离目录演练程序升级、私人数据保留和中断恢复。

该工具不会修改 ``--source`` 或 ``--candidate``。它先把源目录做成经过
SHA256 校验的目录快照，再把源内容复制到新的工作目录，只把候选更新中
允许的 ``main.py``、``VERSION`` 和 ``static/`` 文件应用到副本。随后还会
故意在写入一项更新后中断，并从快照恢复到另一个新目录，确认私人文件和
程序文件都回到升级前的字节。

示例（建议使用全新的临时目录）：

  python tools/verify-upgrade-recovery.py \
    --source <隔离旧版本目录> \
    --candidate <隔离更新目录> \
    --workspace <不存在的验收工作目录> \
    --expected-version 2026.10.03

候选目录可以含 API/.env、data/ 等文件，用来证明更新入口会忽略这些
私人路径；工具只会拒绝符号链接、缺少必需更新文件或不匹配的更新说明。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
from typing import Iterable


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

# Windows 子进程的标准输出可能按系统代码页写入；调用方按 UTF-8 读取
# 验收摘要，启动时显式统一编码，避免中文摘要在管道中被截断或解码失败。
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from backend.backup_restore import (  # noqa: E402
    BackupRestoreError,
    SNAPSHOT_MANIFEST_NAME,
    create_snapshot,
    restore_snapshot,
    verify_snapshot,
)
from backend.versioning import version_gt  # noqa: E402


class UpgradeRecoveryError(ValueError):
    """候选更新或隔离恢复演练不满足安全边界。"""


_VERSION_RE = re.compile(r"^\d{4}\.\d{2}\.\d{2}$")
_EXCLUDED_DIRS = frozenset({".git", "__pycache__"})
_ALLOWED_ROOT_FILES = frozenset({"main.py", "VERSION"})
_REQUIRED_UPDATE_FILES = frozenset({"main.py", "VERSION", "static/update-notes.json"})


def _existing_root(value: os.PathLike[str] | str, *, name: str) -> Path:
    try:
        raw = Path(value).expanduser()
        if raw.is_symlink():
            raise UpgradeRecoveryError(f"{name}必须是普通目录")
        path = raw.resolve()
    except UpgradeRecoveryError:
        raise
    except (OSError, RuntimeError, TypeError, ValueError) as exc:
        raise UpgradeRecoveryError(f"{name}路径无效") from exc
    if path.is_symlink() or not path.is_dir():
        raise UpgradeRecoveryError(f"{name}必须是普通目录")
    return path


def _new_workspace(value: os.PathLike[str] | str) -> Path:
    try:
        raw = Path(value).expanduser()
        path = raw.resolve()
    except (OSError, RuntimeError, TypeError, ValueError) as exc:
        raise UpgradeRecoveryError("工作目录路径无效") from exc
    if raw.exists() or raw.is_symlink() or path.exists():
        raise UpgradeRecoveryError("工作目录必须是不存在的新目录")
    if not path.parent.is_dir() or path.parent.is_symlink():
        raise UpgradeRecoveryError("工作目录的父目录无效")
    path.mkdir(parents=False)
    return path


def _relative(path: Path, root: Path) -> str:
    try:
        relative = path.resolve().relative_to(root)
    except (OSError, RuntimeError, ValueError) as exc:
        raise UpgradeRecoveryError("目录文件路径越界") from exc
    value = relative.as_posix()
    if not value or value == SNAPSHOT_MANIFEST_NAME or ".." in Path(value).parts:
        raise UpgradeRecoveryError("目录文件相对路径无效")
    return value


def _iter_files(root: Path, *, ignore_snapshot_manifest: bool = False) -> Iterable[tuple[Path, str]]:
    """列出普通文件并拒绝任何符号链接，避免验收跨出目录。"""

    for current, dir_names, file_names in os.walk(root, topdown=True, followlinks=False):
        current_path = Path(current)
        kept_dirs: list[str] = []
        for name in sorted(dir_names):
            directory = current_path / name
            if directory.is_symlink():
                raise UpgradeRecoveryError(f"目录不能包含符号链接：{name}")
            if name in _EXCLUDED_DIRS:
                continue
            if not directory.is_dir():
                raise UpgradeRecoveryError("目录项必须是普通目录")
            kept_dirs.append(name)
        dir_names[:] = kept_dirs
        for name in sorted(file_names):
            path = current_path / name
            if ignore_snapshot_manifest and current_path == root and name == SNAPSHOT_MANIFEST_NAME:
                continue
            if path.is_symlink() or not path.is_file():
                raise UpgradeRecoveryError(f"目录文件必须是普通文件：{name}")
            yield path, _relative(path, root)


def _file_hashes(root: Path, *, ignore_snapshot_manifest: bool = False) -> dict[str, str]:
    result: dict[str, str] = {}
    for path, relative in _iter_files(root, ignore_snapshot_manifest=ignore_snapshot_manifest):
        digest = hashlib.sha256()
        try:
            with path.open("rb") as handle:
                for block in iter(lambda: handle.read(1024 * 1024), b""):
                    digest.update(block)
        except OSError as exc:
            raise UpgradeRecoveryError("验收文件无法读取") from exc
        result[relative] = digest.hexdigest()
    return result


def _copy_project(source: Path, destination: Path) -> dict[str, str]:
    """复制源目录的普通文件到不存在的新目录，不复制快照清单。"""

    if destination.exists() or destination.is_symlink():
        raise UpgradeRecoveryError("隔离副本必须是不存在的新目录")
    destination.mkdir(parents=True)
    hashes: dict[str, str] = {}
    for source_path, relative in _iter_files(source):
        target = destination / Path(relative)
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            shutil.copy2(source_path, target)
        except (OSError, shutil.Error) as exc:
            raise UpgradeRecoveryError("隔离副本复制失败") from exc
        hashes[relative] = hashlib.sha256(target.read_bytes()).hexdigest()
    return hashes


def _candidate_files(candidate: Path, expected_version: str | None = None) -> tuple[dict[str, Path], str, int]:
    files: dict[str, Path] = {}
    ignored = 0
    for path, relative in _iter_files(candidate):
        if relative in _ALLOWED_ROOT_FILES or relative.startswith("static/"):
            files[relative] = path
        else:
            ignored += 1
    missing = sorted(_REQUIRED_UPDATE_FILES - files.keys())
    if missing:
        raise UpgradeRecoveryError("候选更新缺少：" + ", ".join(missing))
    try:
        version = (files["VERSION"].read_text(encoding="utf-8-sig")).strip()
    except (OSError, UnicodeError) as exc:
        raise UpgradeRecoveryError("候选更新的 VERSION 无法读取") from exc
    if not _VERSION_RE.fullmatch(version):
        raise UpgradeRecoveryError("候选更新的 VERSION 格式异常")
    try:
        compile(files["main.py"].read_bytes(), str(files["main.py"]), "exec")
    except (OSError, SyntaxError, UnicodeError) as exc:
        raise UpgradeRecoveryError("候选更新的 main.py 无法通过语法检查") from exc
    if expected_version is not None and version != expected_version:
        raise UpgradeRecoveryError("候选更新版本与预期不一致")
    try:
        notes = json.loads(files["static/update-notes.json"].read_text(encoding="utf-8-sig"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise UpgradeRecoveryError("候选更新说明不是有效 JSON") from exc
    if not isinstance(notes, dict) or notes.get("version") != version:
        raise UpgradeRecoveryError("更新说明版本与 VERSION 不一致")
    if notes.get("update_mode") != "in_app":
        raise UpgradeRecoveryError("隔离升级只接受 update_mode=in_app")
    return files, version, ignored


def _apply_candidate(destination: Path, candidate_files: dict[str, Path], *, interrupt_after: int | None = None) -> list[str]:
    updated: list[str] = []
    for relative in sorted(candidate_files):
        source = candidate_files[relative]
        target = destination / Path(relative)
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            shutil.copy2(source, target)
        except (OSError, shutil.Error) as exc:
            raise UpgradeRecoveryError("候选更新文件复制失败") from exc
        updated.append(relative)
        if interrupt_after is not None and len(updated) >= interrupt_after:
            raise UpgradeRecoveryError("模拟升级中断")
    return updated


def _private_hashes(hashes: dict[str, str]) -> dict[str, str]:
    return {
        relative: digest
        for relative, digest in hashes.items()
        if relative == "API/.env"
        or relative == "history.json"
        or relative == "global_config.json"
        or relative.startswith(("data/", "assets/", "output/"))
    }


def verify_upgrade_recovery(
    source_root: os.PathLike[str] | str,
    candidate_root: os.PathLike[str] | str,
    workspace_root: os.PathLike[str] | str,
    *,
    expected_version: str | None = None,
) -> dict[str, object]:
    """完成一次不改源目录的升级和中断恢复演练。"""

    source = _existing_root(source_root, name="源目录")
    candidate = _existing_root(candidate_root, name="候选更新目录")
    if source == candidate:
        raise UpgradeRecoveryError("源目录和候选更新目录必须分开")
    workspace = _new_workspace(workspace_root)
    try:
        candidate_files, version, ignored = _candidate_files(candidate, expected_version)
        before_hashes = _file_hashes(source)
        source_version_path = source / "VERSION"
        try:
            source_version = source_version_path.read_text(encoding="utf-8-sig").strip()
        except (OSError, UnicodeError) as exc:
            raise UpgradeRecoveryError("源目录缺少可读取的 VERSION") from exc
        if not _VERSION_RE.fullmatch(source_version):
            raise UpgradeRecoveryError("源目录的 VERSION 格式异常")
        if not version_gt(version, source_version):
            raise UpgradeRecoveryError("候选更新版本不高于源版本")
        private_before = _private_hashes(before_hashes)
        snapshot = workspace / "pre-upgrade-snapshot"
        snapshot_result = create_snapshot(source, snapshot)
        verify_snapshot(snapshot)

        upgraded = workspace / "upgraded"
        _copy_project(source, upgraded)
        updated = _apply_candidate(upgraded, candidate_files)
        after_hashes = _file_hashes(upgraded)
        if _private_hashes(after_hashes) != private_before:
            raise UpgradeRecoveryError("升级副本中的私人文件发生变化")
        if (upgraded / "VERSION").read_text(encoding="utf-8-sig").strip() != version:
            raise UpgradeRecoveryError("升级副本没有使用候选版本")

        rollback = workspace / "rollback"
        restore_snapshot(snapshot, rollback)
        rollback_hashes = _file_hashes(rollback, ignore_snapshot_manifest=True)
        if rollback_hashes != before_hashes:
            raise UpgradeRecoveryError("从快照恢复后的文件哈希与升级前不一致")

        interrupted = workspace / "interrupted"
        _copy_project(source, interrupted)
        try:
            _apply_candidate(interrupted, candidate_files, interrupt_after=1)
        except UpgradeRecoveryError as exc:
            if str(exc) != "模拟升级中断":
                raise
        else:
            raise UpgradeRecoveryError("模拟中断未发生")
        recovered = workspace / "interrupted-recovered"
        restore_snapshot(snapshot, recovered)
        recovered_hashes = _file_hashes(recovered, ignore_snapshot_manifest=True)
        if recovered_hashes != before_hashes:
            raise UpgradeRecoveryError("中断恢复后的文件哈希与升级前不一致")
        return {
            "version": version,
            "source_file_count": len(before_hashes),
            "snapshot_file_count": int(snapshot_result["file_count"]),
            "updated_file_count": len(updated),
            "ignored_candidate_file_count": ignored,
            "private_file_count": len(private_before),
            "rollback_verified": True,
            "interrupted_upgrade_recovered": True,
        }
    except (BackupRestoreError, OSError, UpgradeRecoveryError):
        # 工作目录由调用方保留，便于失败后检查；绝不回写源目录。
        raise


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path, help="隔离的升级前目录（只读）")
    parser.add_argument("--candidate", required=True, type=Path, help="隔离的候选更新目录（只读）")
    parser.add_argument("--workspace", required=True, type=Path, help="不存在的新验收工作目录")
    parser.add_argument("--expected-version", help="要求候选 VERSION 等于该值")
    args = parser.parse_args()
    try:
        result = verify_upgrade_recovery(
            args.source,
            args.candidate,
            args.workspace,
            expected_version=args.expected_version,
        )
    except (BackupRestoreError, OSError, UpgradeRecoveryError) as exc:
        print(f"升级恢复演练失败：{exc}", file=sys.stderr)
        return 1
    print(
        "升级恢复演练通过："
        f"version={result['version']}，源文件 {result['source_file_count']} 个，"
        f"更新 {result['updated_file_count']} 个，忽略候选私人文件 {result['ignored_candidate_file_count']} 个，"
        f"回退={result['rollback_verified']}，中断恢复={result['interrupted_upgrade_recovered']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
