"""后台任务记录的显式过期清理规则。

这个模块只处理 ``backend.task_records`` 约定的本地 JSON 记录。它把“找出
可以清理的记录”和“执行删除”分成两个步骤，默认的候选状态只有已经确认
结束的 ``succeeded`` 与 ``failed``。排队中、运行中、远端状态未知以及即梦
等待中的记录始终不会进入候选列表。

模块不会在导入或启动时扫描目录，也不会由 ``main.py`` 自动调用。调用方
必须显式创建计划，再显式应用计划；计划建立或应用前的任何格式、路径和
并发变化都会使操作失败并保持故障现场。
"""

from __future__ import annotations

import hashlib
import math
import os
import re
import shutil
import tempfile
import time
from dataclasses import dataclass
from typing import Iterable, Optional, Tuple

from .task_records import (
    TASK_ID_RE,
    TASK_STATUSES,
    TaskRecordError,
    _read_task_record_unlocked,
    task_records_lock,
)


# 这是维护工具的默认值，不代表应用启动时会自动删除记录。
DEFAULT_TASK_TTL_SECONDS = 30 * 24 * 60 * 60
TERMINAL_TASK_STATUSES = frozenset({"succeeded", "failed"})
PRESERVED_TASK_STATUSES = frozenset(TASK_STATUSES - TERMINAL_TASK_STATUSES)


class TaskCleanupError(ValueError):
    """清理计划或应用过程不符合安全边界。"""


class TaskCleanupConflict(TaskCleanupError):
    """计划建立后目标记录发生变化，拒绝按旧计划删除。"""


class TaskCleanupRecoveryRequired(TaskCleanupError):
    """需要人工检查；``recovery_dir`` 中保留了记录副本。"""

    def __init__(self, message: str, recovery_dir: str) -> None:
        super().__init__(message)
        self.recovery_dir = recovery_dir


@dataclass(frozen=True)
class TaskCleanupCandidate:
    """计划中一条候选记录的非敏感快照。"""

    task_id: str
    status: str
    age_seconds: float
    timestamp_field: str
    timestamp: float
    # 删除前用于识别替换过的文件；不保存任务正文。
    stat_token: Tuple[int, int, int, int]
    content_sha256: str


@dataclass(frozen=True)
class TaskCleanupPlan:
    """显式清理计划。

    ``candidates`` 只包含可安全判断为过期的终态记录。其余合法记录按
    ``preserved_task_ids`` 记录编号，损坏记录不会生成计划，而是直接抛出
    ``TaskCleanupError``。
    """

    root: str
    now: float
    ttl_seconds: float
    candidates: Tuple[TaskCleanupCandidate, ...]
    preserved_task_ids: Tuple[str, ...]


def public_task_cleanup_plan(plan: TaskCleanupPlan, *, max_candidates: int = 500) -> dict:
    """把清理计划转换为不含文件摘要和本地路径的只读摘要。

    维护入口只需要知道候选数量和任务编号，不能把计划中的文件摘要、设备号、
    inode 或本地目录暴露给页面。候选列表设置上限，避免异常数量的记录撑大
    HTTP 响应；完整计划仍由显式的 Python 调用方保留并交给
    :func:`apply_task_cleanup_plan`。
    """

    if not isinstance(plan, TaskCleanupPlan):
        raise TaskCleanupError("清理计划无效")
    try:
        limit = int(max_candidates)
    except (TypeError, ValueError, OverflowError) as exc:
        raise TaskCleanupError("清理计划摘要上限无效") from exc
    if limit < 0:
        raise TaskCleanupError("清理计划摘要上限无效")
    candidates = plan.candidates[:limit]
    return {
        "now": float(plan.now),
        "ttl_seconds": float(plan.ttl_seconds),
        "candidate_count": len(plan.candidates),
        "candidate_truncated": len(plan.candidates) > len(candidates),
        "candidates": [
            {
                "task_id": item.task_id,
                "status": item.status,
                "age_seconds": round(float(item.age_seconds), 3),
                "timestamp_field": item.timestamp_field,
            }
            for item in candidates
        ],
        "preserved_count": len(plan.preserved_task_ids),
        "applied": False,
        "mode": "plan_only",
    }


_TASK_FILE_RE = re.compile(r"(canvas_(?:img|comfy)_[A-Za-z0-9_-]{8,87})\.json\Z")


def _finite_number(value: object, *, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TaskCleanupError(f"{field}必须是有限数字")
    try:
        result = float(value)
    except (TypeError, ValueError, OverflowError) as exc:
        raise TaskCleanupError(f"{field}必须是有限数字") from exc
    if not math.isfinite(result):
        raise TaskCleanupError(f"{field}必须是有限数字")
    return result


def _normalise_root(root: str) -> str:
    try:
        raw_root = os.fspath(root)
    except TypeError as exc:
        raise TaskCleanupError("任务记录目录无效") from exc
    if not isinstance(raw_root, str) or not raw_root.strip():
        raise TaskCleanupError("任务记录目录无效")
    absolute = os.path.abspath(raw_root)
    if os.path.islink(absolute):
        raise TaskCleanupError("任务记录目录不能是符号链接")
    if not os.path.isdir(absolute):
        raise TaskCleanupError("任务记录目录不存在")
    return os.path.realpath(absolute)


def _ensure_direct_child(root: str, path: str) -> None:
    """拒绝路径越界、目录链接和非直接子项。"""

    root_real = os.path.realpath(root)
    path_absolute = os.path.abspath(path)
    path_real = os.path.realpath(path_absolute)
    if os.path.dirname(path_absolute) != root_real:
        raise TaskCleanupError("任务记录路径越界")
    try:
        within = os.path.commonpath((root_real, path_real)) == root_real
    except ValueError as exc:
        raise TaskCleanupError("任务记录路径越界") from exc
    if not within:
        raise TaskCleanupError("任务记录路径越界")
    try:
        info = os.lstat(path_absolute)
    except FileNotFoundError as exc:
        raise TaskCleanupConflict("任务记录在检查时消失") from exc
    except OSError as exc:
        raise TaskCleanupError("任务记录无法检查") from exc
    if not os.path.isfile(path_absolute) or os.path.islink(path_absolute) or not _is_regular_mode(info.st_mode):
        raise TaskCleanupError("任务记录必须是普通文件")


def _is_regular_mode(mode: int) -> bool:
    # 用 stat.S_ISREG 会额外导入模块；这里保持判断集中且跨平台。
    return (mode & 0o170000) == 0o100000


def _stat_token(path: str) -> Tuple[int, int, int, int]:
    try:
        info = os.lstat(path)
    except FileNotFoundError as exc:
        raise TaskCleanupConflict("任务记录在检查时消失") from exc
    except OSError as exc:
        raise TaskCleanupError("任务记录无法检查") from exc
    if os.path.islink(path) or not _is_regular_mode(info.st_mode):
        raise TaskCleanupError("任务记录必须是普通文件")
    return (
        int(getattr(info, "st_dev", 0)),
        int(getattr(info, "st_ino", 0)),
        int(info.st_size),
        int(info.st_mtime_ns),
    )


def _content_sha256(path: str) -> str:
    digest = hashlib.sha256()
    try:
        with open(path, "rb") as handle:
            for block in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(block)
    except (OSError, UnicodeError) as exc:
        raise TaskCleanupError("任务记录无法读取") from exc
    return digest.hexdigest()


def _make_recovery_copy(path: str, backup_path: str, candidate: TaskCleanupCandidate) -> None:
    """在删除前保存并校验一份独立副本，避免中途失败造成部分丢失。"""

    _ensure_direct_child(os.path.dirname(path), path)
    if _stat_token(path) != candidate.stat_token:
        raise TaskCleanupConflict("任务记录已变化，拒绝按旧计划删除")
    digest = hashlib.sha256()
    try:
        with open(path, "rb") as source, open(backup_path, "xb") as backup:
            for block in iter(lambda: source.read(1024 * 1024), b""):
                backup.write(block)
                digest.update(block)
            backup.flush()
            os.fsync(backup.fileno())
    except OSError as exc:
        raise TaskCleanupError("任务记录恢复备份创建失败") from exc
    if digest.hexdigest() != candidate.content_sha256:
        raise TaskCleanupConflict("任务记录已变化，拒绝按旧计划删除")
    if _stat_token(path) != candidate.stat_token or _content_sha256(path) != candidate.content_sha256:
        raise TaskCleanupConflict("任务记录已变化，拒绝按旧计划删除")


def _remove_recovery_dir(path: str) -> None:
    try:
        shutil.rmtree(path)
    except OSError as exc:
        raise TaskCleanupError("恢复备份目录清理失败") from exc


def _restore_candidates(
    checked: list[tuple[TaskCleanupCandidate, str]],
    recovery_dir: str,
) -> bool:
    """恢复删除时缺失的候选；绝不覆盖其他进程新建或改写的文件。"""

    restored_all = True
    for candidate, path in checked:
        backup_path = os.path.join(recovery_dir, f"{candidate.task_id}.json")
        try:
            if os.path.lexists(path):
                _ensure_direct_child(os.path.dirname(path), path)
                if _content_sha256(path) != candidate.content_sha256:
                    restored_all = False
                continue
            if _content_sha256(backup_path) != candidate.content_sha256:
                restored_all = False
                continue
            os.replace(backup_path, path)
        except (OSError, TaskCleanupError):
            restored_all = False
    return restored_all


def _record_timestamp(record: dict) -> tuple[str, float] | None:
    # 更新时刻优先；兼容没有 updated_at 的旧记录。没有任何可信时间时
    # 拒绝猜测文件 mtime，避免误删旧格式或手工恢复的记录。
    for field in ("updated_at", "created_at"):
        if field not in record or record[field] is None:
            continue
        value = record[field]
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise TaskCleanupError("任务记录时间无效")
        try:
            timestamp = float(value)
        except (TypeError, ValueError, OverflowError) as exc:
            raise TaskCleanupError("任务记录时间无效") from exc
        if not math.isfinite(timestamp):
            raise TaskCleanupError("任务记录时间无效")
        return field, timestamp
    return None


def _iter_task_files(root: str) -> Iterable[tuple[str, str]]:
    try:
        entries = list(os.scandir(root))
    except OSError as exc:
        raise TaskCleanupError("任务记录目录无法读取") from exc
    for entry in entries:
        match = _TASK_FILE_RE.fullmatch(entry.name)
        if not match:
            continue
        path = os.path.abspath(os.path.join(root, entry.name))
        _ensure_direct_child(root, path)
        yield match.group(1), path


def _plan_expired_task_cleanup_unlocked(
    root_real: str,
    *,
    ttl: float,
    current: float,
) -> TaskCleanupPlan:
    candidates: list[TaskCleanupCandidate] = []
    preserved: list[str] = []

    for task_id, path in _iter_task_files(root_real):
        try:
            record = _read_task_record_unlocked(root_real, task_id)
        except TaskRecordError as exc:
            # 不把损坏记录归为可清理项，且不把原始正文放进异常消息。
            raise TaskCleanupError("任务记录损坏，已停止清理") from exc
        if record is None:
            raise TaskCleanupConflict("任务记录在检查时消失")
        timestamp_info = _record_timestamp(record)
        if record.get("status") not in TERMINAL_TASK_STATUSES or timestamp_info is None:
            preserved.append(task_id)
            continue
        timestamp_field, timestamp = timestamp_info
        age = current - timestamp
        if age <= ttl:
            preserved.append(task_id)
            continue
        candidates.append(
            TaskCleanupCandidate(
                task_id=task_id,
                status=str(record["status"]),
                age_seconds=float(age),
                timestamp_field=timestamp_field,
                timestamp=timestamp,
                stat_token=_stat_token(path),
                content_sha256=_content_sha256(path),
            )
        )

    return TaskCleanupPlan(
        root=root_real,
        now=current,
        ttl_seconds=ttl,
        candidates=tuple(candidates),
        preserved_task_ids=tuple(sorted(preserved)),
    )


def plan_expired_task_cleanup(
    root: str,
    *,
    ttl_seconds: float = DEFAULT_TASK_TTL_SECONDS,
    now: Optional[float] = None,
) -> TaskCleanupPlan:
    """扫描隔离目录并生成过期清理计划，不删除任何文件。

    只接受 ``succeeded``/``failed`` 且记录时间早于 ``now - ttl`` 的文件。
    所有合法但未达条件的状态都会被保留；文件名匹配任务编号但 JSON 损坏、
    时间缺失或路径不安全时直接失败，调用方可保留现场后人工处理。扫描期间
    持有任务记录目录的跨进程锁，避免写入过程与计划快照交错。
    """

    root_real = _normalise_root(root)
    ttl = _finite_number(ttl_seconds, field="TTL")
    if ttl <= 0:
        raise TaskCleanupError("TTL必须大于零")
    current = _finite_number(time.time() if now is None else now, field="当前时间")
    with task_records_lock(root_real):
        return _plan_expired_task_cleanup_unlocked(root_real, ttl=ttl, current=current)


def _apply_task_cleanup_plan_unlocked(plan: TaskCleanupPlan) -> Tuple[str, ...]:
    """应用显式计划并删除候选记录，返回实际删除的任务编号。

    应用前会重新检查每个候选文件的路径、内容摘要、记录状态和时间戳。
    任一候选发生变化就整体停止删除，避免按过期快照误删。公开包装函数会
    持有任务记录目录的跨进程锁；这个内部 helper 只应在锁已持有时调用，且
    不会被启动流程自动调用。
    """

    if not isinstance(plan, TaskCleanupPlan):
        raise TaskCleanupError("清理计划无效")
    root = _normalise_root(plan.root)
    if root != plan.root:
        raise TaskCleanupError("清理计划目录已变化")
    _finite_number(plan.now, field="计划时间")
    ttl = _finite_number(plan.ttl_seconds, field="TTL")
    if ttl <= 0:
        raise TaskCleanupError("TTL必须大于零")

    checked: list[tuple[TaskCleanupCandidate, str]] = []
    seen_ids: set[str] = set()
    for candidate in plan.candidates:
        if not isinstance(candidate, TaskCleanupCandidate) or not TASK_ID_RE.fullmatch(candidate.task_id):
            raise TaskCleanupError("清理候选编号无效")
        if candidate.task_id in seen_ids:
            raise TaskCleanupError("清理候选编号重复")
        seen_ids.add(candidate.task_id)
        path = os.path.join(root, f"{candidate.task_id}.json")
        _ensure_direct_child(root, path)
        if _stat_token(path) != candidate.stat_token:
            raise TaskCleanupConflict("任务记录已变化，拒绝按旧计划删除")
        if _content_sha256(path) != candidate.content_sha256:
            raise TaskCleanupConflict("任务记录已变化，拒绝按旧计划删除")
        try:
            record = _read_task_record_unlocked(root, candidate.task_id)
        except TaskRecordError as exc:
            raise TaskCleanupConflict("任务记录已损坏，拒绝删除") from exc
        if record is None or record.get("status") not in TERMINAL_TASK_STATUSES:
            raise TaskCleanupConflict("任务记录状态已变化，拒绝删除")
        timestamp_info = _record_timestamp(record)
        if timestamp_info is None or timestamp_info[0] != candidate.timestamp_field or timestamp_info[1] != candidate.timestamp:
            raise TaskCleanupConflict("任务记录时间已变化，拒绝删除")
        if plan.now - timestamp_info[1] <= ttl:
            raise TaskCleanupConflict("任务记录已不再过期，拒绝删除")
        checked.append((candidate, path))

    if not checked:
        return ()

    try:
        recovery_dir = tempfile.mkdtemp(prefix=".task_cleanup_recovery_", dir=root)
    except OSError as exc:
        raise TaskCleanupError("任务记录恢复备份目录创建失败") from exc
    try:
        for candidate, path in checked:
            _make_recovery_copy(
                path,
                os.path.join(recovery_dir, f"{candidate.task_id}.json"),
                candidate,
            )
        # 标记完整备份：没有这个标记时，任何候选文件都尚未开始删除。
        with open(os.path.join(recovery_dir, ".ready"), "xb") as marker:
            marker.flush()
            os.fsync(marker.fileno())
    except (OSError, TaskCleanupError) as exc:
        _remove_recovery_dir(recovery_dir)
        if isinstance(exc, TaskCleanupError):
            raise
        raise TaskCleanupError("任务记录恢复备份创建失败") from exc

    try:
        for candidate, path in checked:
            _ensure_direct_child(root, path)
            if _stat_token(path) != candidate.stat_token or _content_sha256(path) != candidate.content_sha256:
                raise TaskCleanupConflict("任务记录已变化，拒绝按旧计划删除")
            os.unlink(path)
    except (OSError, TaskCleanupError) as exc:
        if not _restore_candidates(checked, recovery_dir):
            raise TaskCleanupRecoveryRequired(
                "任务记录删除失败，自动恢复未完成；恢复备份已保留",
                recovery_dir,
            ) from exc
        _remove_recovery_dir(recovery_dir)
        if isinstance(exc, TaskCleanupConflict):
            raise
        if isinstance(exc, FileNotFoundError):
            raise TaskCleanupConflict("任务记录在删除时消失，原候选已恢复") from exc
        raise TaskCleanupError("任务记录删除失败，原候选已恢复") from exc

    try:
        _remove_recovery_dir(recovery_dir)
    except TaskCleanupError as exc:
        raise TaskCleanupRecoveryRequired(
            "候选记录已删除，但恢复备份目录清理失败",
            recovery_dir,
        ) from exc
    return tuple(candidate.task_id for candidate, _path in checked)


def apply_task_cleanup_plan(plan: TaskCleanupPlan) -> Tuple[str, ...]:
    """在任务记录目录的跨进程锁内应用显式清理计划。"""

    if not isinstance(plan, TaskCleanupPlan):
        raise TaskCleanupError("清理计划无效")
    root = _normalise_root(plan.root)
    if root != plan.root:
        raise TaskCleanupError("清理计划目录已变化")
    with task_records_lock(root):
        return _apply_task_cleanup_plan_unlocked(plan)


__all__ = [
    "DEFAULT_TASK_TTL_SECONDS",
    "PRESERVED_TASK_STATUSES",
    "TERMINAL_TASK_STATUSES",
    "TaskCleanupCandidate",
    "TaskCleanupConflict",
    "TaskCleanupError",
    "TaskCleanupPlan",
    "TaskCleanupRecoveryRequired",
    "apply_task_cleanup_plan",
    "plan_expired_task_cleanup",
    "public_task_cleanup_plan",
]
