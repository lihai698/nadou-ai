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


async def create_canvas_comfy_task(payload, request, *, re, HTTPException, uuid, task_context, CANVAS_TASK_LOCK, CANVAS_TASKS, time, task_input_summary, CANVAS_TASK_PROCESS_ID, _write_canvas_task_record, TaskRecordError, asyncio, run_canvas_comfy_task):
    binding = {}
    if payload.assistant_action_id:
        for key in ("assistant_action_id", "canvas_id", "node_id", "input_hash"):
            value = getattr(payload, key)
            pattern = r"[0-9a-f]{64}" if key == "input_hash" else r"[A-Za-z0-9_-]{1,100}"
            if not re.fullmatch(pattern, value):
                raise HTTPException(422, "助手 ComfyUI 任务须有完整有效的画布、节点、动作和输入绑定")
            binding[key] = value
        if payload.segment_id and not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", payload.segment_id):
            raise HTTPException(422, "助手 ComfyUI 原片段编号无效")
        binding.update(segment_id=payload.segment_id, provider_id="comfyui", model=payload.workflow_json)
    task_id = f"canvas_comfy_{uuid.uuid4().hex}"
    trace_fields = task_context(
        task_id,
        trace_id=getattr(request.state, "trace_id", ""),
        request_id=getattr(request.state, "request_id", ""),
    )
    with CANVAS_TASK_LOCK:
        CANVAS_TASKS[task_id] = {
            **binding,
            "id": task_id,
            "type": "comfy",
            "status": "queued",
            "created_at": time.time(),
            "updated_at": time.time(),
            "result": None,
            "error": "",
            "workflow_json": payload.workflow_json,
            "input_summary": task_input_summary(
                prompt=payload.prompt,
                workflow_json=payload.workflow_json,
            ),
            "process_id": CANVAS_TASK_PROCESS_ID,
            "trace_id": trace_fields["trace_id"],
            "request_id": trace_fields["request_id"],
        }
        try:
            _write_canvas_task_record(CANVAS_TASKS[task_id], required=True)
        except (OSError, TaskRecordError):
            CANVAS_TASKS.pop(task_id, None)
            raise HTTPException(status_code=503, detail="本地 ComfyUI 任务记录无法保存，本次请求未提交")
    asyncio.create_task(run_canvas_comfy_task(task_id, payload))
    return {"task_id": task_id, "status": "queued", **trace_fields, **binding}


async def get_canvas_comfy_task(task_id, *, CANVAS_TASK_LOCK, CANVAS_TASKS, _read_canvas_task_record, HTTPException, _public_canvas_task, _interrupted_canvas_task):
    with CANVAS_TASK_LOCK:
        task = dict(CANVAS_TASKS.get(task_id) or {})
        if not task:
            task = dict(_read_canvas_task_record(task_id) or {})
    if not task:
        raise HTTPException(status_code=404, detail="ComfyUI 任务不存在，可能服务已重启或任务已过期")
    return _public_canvas_task(_interrupted_canvas_task(task))
