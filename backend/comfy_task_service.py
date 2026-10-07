"""ComfyUI 画布任务的生命周期协调。

这里只负责本地任务的排队、运行、成功/失败收敛和记录写回。
ComfyUI 工作流构造与实际请求仍由调用方传入的 ``generate`` 负责，
因此本模块不依赖 ``main.py``，也不读取应用全局配置。
"""

from __future__ import annotations

import asyncio
import time
from typing import Any, Awaitable, Callable, Mapping, Optional, Tuple, Type


async def run_comfy_task(
    task_id: str,
    payload: Any,
    *,
    gate: Any,
    worker: Callable[[str, Any], Awaitable[None]],
) -> None:
    """在并发闸门内运行一个 ComfyUI 画布任务。"""

    async with gate:
        await worker(task_id, payload)


async def run_comfy_task_worker(
    task_id: str,
    payload: Any,
    *,
    task_lock: Any,
    load_task: Callable[[str], Optional[dict]],
    mark_start_failed: Callable[[dict, str], None],
    write_record: Callable[..., bool],
    generate: Callable[[Any], Any],
    task_state_update: Callable[..., Mapping[str, Any]],
    public_error_detail: Callable[..., str],
    write_diagnostic: Callable[[str], None],
    record_error_types: Tuple[Type[BaseException], ...] = (OSError, ValueError),
) -> None:
    """运行一个已持久化的 ComfyUI 任务，不负责路由和请求解析。"""

    task: Optional[dict] = None
    with task_lock:
        task = load_task(task_id)
        if not task or task.get("status") != "queued":
            return
        task.update(task_state_update(task, "running", time.time()))
        try:
            write_record(task, required=True)
        except record_error_types:
            mark_start_failed(task, task_id)
            return

    try:
        result = await asyncio.to_thread(generate, payload)
        if isinstance(result, dict) and result.get("error"):
            raise RuntimeError(public_error_detail(result.get("error")))
    except Exception as exc:
        detail = public_error_detail(getattr(exc, "detail", None) or exc)
        status_code = getattr(exc, "status_code", 500)
        write_diagnostic(f"comfy generation failed error={type(exc).__name__}")
        with task_lock:
            task.update(
                task_state_update(
                    task,
                    "failed",
                    time.time(),
                    error=detail,
                    status_code=status_code,
                )
            )
            try:
                write_record(task)
            except Exception as record_exc:
                write_diagnostic(
                    "comfy failed task record write failed "
                    f"error={type(record_exc).__name__}"
                )
        return

    # 生成成功后，记录写回失败不能再把 succeeded 转成 failed；
    # 调用方仍可从本进程任务缓存读取结果，重启后再按 unknown 保守处理。
    with task_lock:
        task.update(task_state_update(task, "succeeded", time.time(), result=result))
        try:
            write_record(task)
        except Exception as record_exc:
            write_diagnostic(
                "comfy succeeded task record write failed "
                f"error={type(record_exc).__name__}"
            )
