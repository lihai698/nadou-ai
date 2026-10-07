"""Pure state transitions for local canvas generation tasks."""

from typing import Any, Dict, Mapping, Optional, Sequence


_ALLOWED_NEXT = {
    "queued": {"running"},
    "running": {"succeeded", "failed", "jimeng_pending", "unknown"},
    # 服务重启后只有显式远端查询才能收敛未知任务；绝不自动重提。
    "unknown": {"succeeded", "failed"},
}


def image_batch_outcome(statuses: Sequence[str], *, has_images: bool) -> str:
    """Classify recorded remote outcomes without querying or changing records.

    ``partial`` preserves existing images even if all remaining IDs failed.
    Any unresolved ID keeps the batch unknown; callers must query, not resubmit.
    """
    if statuses and all(status == "succeeded" for status in statuses):
        return "succeeded"
    if statuses and all(status in {"succeeded", "failed"} for status in statuses) and has_images:
        return "partial"
    if statuses and all(status == "failed" for status in statuses):
        return "failed"
    return "unknown"


def interrupted_task_update(
    current: Mapping[str, Any],
    process_id: str,
    updated_at: float,
    *,
    unknown_message: str,
) -> Dict[str, Any]:
    """Return a restart delta for a validated record; preserve remote results.

    This is separate from worker transitions: even queued tasks from another
    process are uncertain, and existing partial results must not be cleared.
    The caller owns validation, the clock and persistence; no task is submitted.
    """
    if current.get("status") not in {"queued", "running"} or current.get("process_id") == process_id:
        return {}
    return {
        "status": "unknown",
        "error": str(unknown_message or "远端状态未知")[:600],
        "updated_at": float(updated_at),
    }


def task_state_update(
    current: Mapping[str, Any],
    next_status: str,
    updated_at: float,
    *,
    result: Any = None,
    error: str = "",
    status_code: Any = 500,
    upstream_task_id: Optional[str] = None,
    pending: Optional[Mapping[str, Any]] = None,
) -> Dict[str, Any]:
    """Return only changed fields; never mutate a task or perform I/O.

    A local worker may finish only once. ``jimeng_pending`` means the remote
    task has its own query ID; it is not a local success or cancellation.
    """
    current_status = current.get("status")
    if next_status not in _ALLOWED_NEXT.get(current_status, set()):
        raise ValueError(f"invalid canvas task transition: {current_status!r} -> {next_status!r}")

    update: Dict[str, Any] = {"status": next_status, "updated_at": updated_at}
    if next_status == "succeeded":
        update.update(result=result, error="")
    elif next_status == "failed":
        update.update(error=error, status_code=status_code)
        if upstream_task_id is not None:
            update["upstream_task_id"] = upstream_task_id
    elif next_status == "unknown":
        update.update(result=None, error=error)
        if upstream_task_id is not None:
            update["upstream_task_id"] = upstream_task_id
    elif next_status == "jimeng_pending":
        if pending is None:
            raise ValueError("jimeng_pending requires remote query details")
        update.update(
            jimeng_pending=True,
            submit_id=pending["submit_id"],
            kind=pending["kind"],
            queue_info=pending["queue_info"],
            message=pending["message"],
            error="",
        )
    return update
