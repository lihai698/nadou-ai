"""持久化后台任务记录的低依赖规则。

这个模块只负责任务记录文件的路径校验、跨进程协调、原子读写和重启边界标记。
具体任务的提交、供应商查询和结果处理仍由应用入口负责。
"""

from __future__ import annotations

import json
import math
import os
import re
import time
from contextlib import contextmanager
from typing import Any, Dict, Optional

from .atomic_json import write_json_atomic
from .process_lock import interprocess_file_lock


TASK_ID_RE = re.compile(r"canvas_(?:img|comfy|video)_[A-Za-z0-9_-]{8,87}\Z")
TASK_STATUSES = frozenset({
    "queued",
    "running",
    "succeeded",
    "failed",
    "jimeng_pending",
    "unknown",
})


class TaskRecordError(ValueError):
    """任务记录不符合本地持久化契约。"""


@contextmanager
def task_records_lock(root: str, *, timeout: float = 30.0):
    """协调同一任务记录目录的跨进程读写和维护操作。

    锁文件是目录内的隐藏占位文件，不属于任务记录匹配范围。调用方仍应
    配合自己的进程内锁；需要把扫描、校验和删除作为一个区间时，应在外层
    持有此锁并使用本模块的内部无锁读写 helper。
    """

    root_path = os.path.abspath(os.fspath(root))
    with interprocess_file_lock(os.path.join(root_path, ".task_records"), timeout=timeout):
        yield


def _validate_task_record(
    task: Any,
    *,
    expected_id: Optional[str] = None,
) -> Dict[str, Any]:
    """校验磁盘记录的最小结构，不把损坏内容带入任务查询。"""

    if not isinstance(task, dict):
        raise TaskRecordError("任务记录格式无效")
    task_id = task.get("id")
    if not isinstance(task_id, str) or not TASK_ID_RE.fullmatch(task_id):
        raise TaskRecordError("任务记录编号无效")
    if expected_id is not None and task_id != str(expected_id):
        raise TaskRecordError("任务记录编号不匹配")
    if task.get("status") not in TASK_STATUSES:
        raise TaskRecordError("任务记录状态无效")

    for key in ("created_at", "updated_at"):
        if key not in task:
            continue
        value = task[key]
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise TaskRecordError("任务记录时间无效")
        try:
            finite = math.isfinite(float(value))
        except (OverflowError, TypeError, ValueError):
            finite = False
        if not finite:
            raise TaskRecordError("任务记录时间无效")

    for key in ("type", "error", "process_id", "provider_id", "model"):
        if key in task and task[key] is not None and not isinstance(task[key], str):
            raise TaskRecordError("任务记录字段类型无效")
    if "status_code" in task:
        value = task["status_code"]
        if value is not None and (isinstance(value, bool) or not isinstance(value, int)):
            raise TaskRecordError("任务记录状态码无效")
    for key in ("result", "input_summary", "queue_info"):
        if key in task and task[key] is not None and not isinstance(task[key], dict):
            raise TaskRecordError("任务记录字段类型无效")
    return task


def task_record_path(root: str, task_id: str) -> str:
    """返回受限任务编号对应的 JSON 路径。"""

    clean_id = str(task_id or "").strip()
    if not TASK_ID_RE.fullmatch(clean_id):
        raise TaskRecordError("任务编号格式无效")
    return os.path.join(os.path.abspath(root), f"{clean_id}.json")


def _read_task_record_unlocked(root: str, task_id: str) -> Optional[Dict[str, Any]]:
    """读取一条任务记录；不存在返回 ``None``，损坏记录抛出明确错误。"""

    path = task_record_path(root, task_id)
    try:
        with open(path, "r", encoding="utf-8-sig") as handle:
            value = json.load(handle)
    except FileNotFoundError:
        return None
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise TaskRecordError("任务记录无法读取") from exc
    except ValueError as exc:
        # Python 3.11 会在解析超长整数时直接抛 ValueError；这类值不能
        # 进入时间/状态校验，统一按损坏时间字段拒绝，且不回显解析器正文。
        raise TaskRecordError("任务记录时间无效") from exc
    return _validate_task_record(value, expected_id=task_id)


def read_task_record(root: str, task_id: str) -> Optional[Dict[str, Any]]:
    """在跨进程锁内读取一条任务记录。"""

    with task_records_lock(root):
        return _read_task_record_unlocked(root, task_id)


def _write_task_record_unlocked(root: str, task: Dict[str, Any]) -> None:
    """以原子方式写入任务记录，不覆盖无效任务编号。"""

    if not isinstance(task, dict):
        raise TaskRecordError("任务记录必须是对象")
    task_id = str(task.get("id") or "").strip()
    _validate_task_record(task, expected_id=task_id)
    path = task_record_path(root, task_id)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    write_json_atomic(path, task, ensure_ascii=False, indent=2)


def write_task_record(root: str, task: Dict[str, Any]) -> None:
    """在跨进程锁内以原子方式写入任务记录。"""

    with task_records_lock(root):
        _write_task_record_unlocked(root, task)


def mark_interrupted_task(
    task: Dict[str, Any],
    process_id: str,
    *,
    now: Optional[float] = None,
    unknown_message: str,
) -> Dict[str, Any]:
    """将其他进程遗留的未结束任务标记为 ``unknown``。"""

    _validate_task_record(task)
    result = dict(task)
    if result.get("status") in {"queued", "running"} and result.get("process_id") != process_id:
        result["status"] = "unknown"
        result["error"] = str(unknown_message or "远端状态未知")[:600]
        result["updated_at"] = float(time.time() if now is None else now)
    return result


def task_input_summary(
    *,
    prompt: str = "",
    provider_id: str = "",
    model: str = "",
    workflow_json: str = "",
    reference_count: int = 0,
) -> Dict[str, Any]:
    """生成不含原始提示词、密钥或工作流正文的追溯摘要。"""

    summary: Dict[str, Any] = {
        "prompt_length": len(str(prompt or "")),
        "provider_id": str(provider_id or "")[:80],
        "model": str(model or "")[:160],
        "reference_count": max(0, int(reference_count or 0)),
    }
    if workflow_json:
        summary["workflow_length"] = len(str(workflow_json))
    return summary

