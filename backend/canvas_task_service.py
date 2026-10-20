"""共享画布任务记录策略和图片执行生命周期。

复用 task_records 的锁、校验和原子写，不拥有供应商配置、HTTP路由或应用全局状态。
内存缓存、进程编号、锁与生成/落盘回调由应用显式注入。
"""
import time
import uuid
import re
import json
from typing import Any, Dict, List, Mapping, Optional

from backend.task_records import TaskRecordError, write_task_record, mark_interrupted_task
from backend.task_states import task_state_update

_CANVAS_TASK_PERSISTED_FIELDS = frozenset({
    "id", "type", "status", "created_at", "updated_at", "result", "error",
    "status_code", "provider_id", "model", "input_summary", "process_id",
    "trace_id", "request_id", "upstream_task_id", "remote_query_mode",
    "upstream_task_ids", "remote_query_modes", "upstream_task_statuses", "upstream_task_errors", "upstream_task_results",
    "jimeng_pending", "submit_id",
    "kind", "queue_info", "message", "operation",
    "assistant_action_id", "canvas_id", "node_id", "input_hash", "assistant_slot_key", "assistant_request_hash",
})

_CANVAS_RESULT_PERSISTED_FIELDS = frozenset({
    "images", "image_items", "videos", "audios", "texts", "files", "items",
    "outputs", "urls", "timestamp", "type", "model", "provider_id",
    "provider_name", "task_id", "request_id", "raw_usage", "seed", "prompt_id",
    "backend", "text", "kind",
})


def durable_task(task, *, sanitize_usage):
    """只把任务状态和结果写入磁盘，不保存提示词或完整工作流正文。"""

    durable = {
        key: value
        for key, value in task.items()
        if key in _CANVAS_TASK_PERSISTED_FIELDS
    }
    result = durable.get("result")
    if isinstance(result, dict):
        durable["result"] = {
            key: value
            for key, value in result.items()
            if key in _CANVAS_RESULT_PERSISTED_FIELDS
        }
        sanitize_usage(durable["result"])
    return durable


def write_record(task, *, required=False, root, snapshot, diagnostic, writer=write_task_record):
    try:
        writer(root, snapshot(task))
        return True
    except (OSError, TypeError, ValueError) as exc:
        diagnostic(f"canvas task record write failed error={type(exc).__name__}")
        if required:
            raise TaskRecordError("任务记录无法保存") from exc
        return False


async def persist_remote_accept(task_id, remote_task_id, *, query_mode="http_get", batch=False,
                                tasks, task_lock, process_id, read_record, write_record):
    """在图片上游返回可查询编号后立即落盘。"""

    remote_id = str(remote_task_id or "").strip()
    if (
        not remote_id
        or len(remote_id) > 240
        or any(ord(char) < 0x20 for char in remote_id)
        or any(char in remote_id for char in "?#")
    ):
        raise ValueError("上游返回的图片任务编号无效")
    remote_id = remote_id[:240]
    with task_lock:
        task = tasks.get(task_id)
        if not isinstance(task, dict):
            task = read_record(task_id)
        if not task or task.get("process_id") != process_id:
            raise OSError("图片任务记录已失效")
        if task.get("status") in {"succeeded", "failed"}:
            raise OSError("图片任务已结束")
        safe_query_mode = str(query_mode or "http_get")[:40]
        if batch:
            remote_ids = [
                str(item).strip()[:240]
                for item in (task.get("upstream_task_ids") or [])
                if str(item).strip()
            ]
            if not remote_ids:
                first_id = str(task.get("upstream_task_id") or "").strip()
                if first_id:
                    remote_ids.append(first_id[:240])
            if remote_id not in remote_ids:
                if len(remote_ids) >= 8:
                    raise ValueError("批量图片任务的上游编号超过安全上限")
                remote_ids.append(remote_id)
            modes = [
                str(item or "http_get")[:40]
                for item in (task.get("remote_query_modes") or [])
            ]
            if len(modes) < len(remote_ids):
                modes.extend(["http_get"] * (len(remote_ids) - len(modes)))
            index = remote_ids.index(remote_id)
            modes[index] = safe_query_mode
            statuses = task.get("upstream_task_statuses")
            if not isinstance(statuses, dict):
                statuses = {}
            statuses[remote_id] = str(statuses.get(remote_id) or "running")[:32]
            errors = task.get("upstream_task_errors")
            if not isinstance(errors, dict):
                errors = {}
            errors.pop(remote_id, None)
            task["upstream_task_ids"] = remote_ids[:8]
            task["remote_query_modes"] = modes[:8]
            task["upstream_task_statuses"] = statuses
            task["upstream_task_errors"] = errors
            # 兼容现有前端，它仍通过第一个编号判断是否可以刷新。
            task["upstream_task_id"] = remote_ids[0]
            task["remote_query_mode"] = modes[0]
        else:
            task["upstream_task_id"] = remote_id
            task["remote_query_mode"] = safe_query_mode
        task["updated_at"] = time.time()
        try:
            write_record(task, required=True)
        except (OSError, TaskRecordError) as exc:
            # 上游已经受理，异常必须保留编号供 worker 记录 unknown，禁止调用方重提。
            setattr(exc, "upstream_task_id", remote_id)
            setattr(exc, "remote_accept_persist_failed", True)
            raise


def load_for_worker(task_id, *, tasks, process_id, read_record, diagnostic,
                    read_error_types=(TaskRecordError,)):
    """在 worker 开始前恢复同进程可能丢失的持久任务记录。

    后台 worker 的协程对象仍可能存活，而 ``CANVAS_TASKS`` 只是易失缓存。
    如果缓存被清空，不能因为字典缺项就继续向上游提交，也不能让任务卡在
    ``queued``。只有记录明确属于当前进程时才允许恢复；重启遗留记录仍由
    查询入口按 ``unknown`` 边界处理。
    """

    task = tasks.get(task_id)
    if isinstance(task, dict):
        return task
    try:
        persisted = read_record(task_id)
    except read_error_types as exc:
        diagnostic(
            f"canvas task worker record read failed error={type(exc).__name__}"
        )
        return None
    if not isinstance(persisted, dict):
        return None
    if persisted.get("process_id") != process_id:
        return None
    tasks[task_id] = persisted
    return persisted


def mark_start_failed(task, task_id, *, tasks, write_record):
    """运行态无法落盘时停止 worker，避免在 queued 快照上重复提交。"""

    try:
        task.update(task_state_update(
            task,
            "failed",
            time.time(),
            error="本地任务运行状态无法保存，请稍后按原编号查询",
            status_code=503,
        ))
    except ValueError:
        # 仅在内部记录已经被其他逻辑推进时兜底；不向调用方回显内部异常。
        task.update({
            "status": "failed",
            "updated_at": time.time(),
            "error": "本地任务运行状态无法保存，请稍后按原编号查询",
            "status_code": 503,
        })
    tasks[task_id] = task
    write_record(task)


def interrupted_task(task, *, process_id, unknown_message, write_record):
    updated = mark_interrupted_task(
        task,
        process_id,
        unknown_message=unknown_message,
    )
    if updated != task:
        write_record(updated)
    return updated


def public_task(task: Dict[str, Any]) -> Dict[str, Any]:
    return {key: value for key, value in task.items() if key not in {"process_id", "assistant_request_hash"}}


def remote_records(task: Mapping[str, Any]) -> List[Dict[str, str]]:
    """读取新旧格式的图片上游编号，保持编号与查询方式一一对应。"""

    raw_ids = task.get("upstream_task_ids")
    if not isinstance(raw_ids, list):
        raw_ids = []
    remote_ids = []
    for value in raw_ids:
        remote_id = str(value or "").strip()
        if remote_id and remote_id not in remote_ids:
            remote_ids.append(remote_id[:240])
    legacy_id = str(task.get("upstream_task_id") or "").strip()
    if legacy_id and legacy_id not in remote_ids:
        remote_ids.insert(0, legacy_id[:240])
    remote_ids = remote_ids[:8]
    raw_modes = task.get("remote_query_modes")
    modes = raw_modes if isinstance(raw_modes, list) else []
    legacy_mode = str(task.get("remote_query_mode") or "http_get").strip().lower() or "http_get"
    records = []
    for index, remote_id in enumerate(remote_ids):
        mode = str(modes[index] if index < len(modes) else "").strip().lower() or (
            legacy_mode if index == 0 else "http_get"
        )
        records.append({"id": remote_id, "mode": mode[:40]})
    return records


def remote_statuses(task: Mapping[str, Any], records: List[Dict[str, str]]) -> Dict[str, str]:
    raw = task.get("upstream_task_statuses")
    statuses = raw if isinstance(raw, dict) else {}
    return {
        item["id"]: str(statuses.get(item["id"]) or "running").strip().lower()
        for item in records
    }


def remote_errors(task: Mapping[str, Any]) -> Dict[str, str]:
    raw = task.get("upstream_task_errors")
    return {
        str(key): str(value or "")[:600]
        for key, value in raw.items()
    } if isinstance(raw, dict) else {}


def remote_results(task: Mapping[str, Any]) -> Dict[str, Dict[str, Any]]:
    raw = task.get("upstream_task_results")
    if not isinstance(raw, dict):
        return {}
    results = {}
    for key, value in raw.items():
        if not isinstance(value, dict):
            continue
        results[str(key)] = {
            "images": [str(item) for item in (value.get("images") or []) if item],
            "image_items": [item for item in (value.get("image_items") or []) if isinstance(item, dict)],
        }
    return results


def update_remote_tracking(
    task: Dict[str, Any],
    statuses: Mapping[str, str],
    errors: Mapping[str, str],
) -> None:
    records = remote_records(task)
    task["upstream_task_ids"] = [item["id"] for item in records]
    task["remote_query_modes"] = [item["mode"] for item in records]
    task["upstream_task_statuses"] = {
        item["id"]: str(statuses.get(item["id"]) or "running")[:32]
        for item in records
    }
    task["upstream_task_errors"] = {
        item["id"]: str(errors.get(item["id"]) or "")[:600]
        for item in records
        if errors.get(item["id"])
    }
    if records:
        task["upstream_task_id"] = records[0]["id"]
        task["remote_query_mode"] = records[0]["mode"]


async def run_image_task(task_id, payload, *, gate, worker):
    async with gate:
        await worker(task_id, payload)


async def run_image_worker(task_id, payload, *, task_lock, load_task, mark_start_failed,
                           write_record, generate, accept_callback, persist_accept,
                           pending_error, pending_payload, public_queue_info,
                           public_error_detail, extract_task_id, unknown_message, diagnostic):
    task = None
    with task_lock:
        task = load_task(task_id)
        if not task or task.get("status") != "queued":
            return
        task.update(task_state_update(task, "running", time.time()))
        try:
            write_record(task, required=True)
        except (OSError, TaskRecordError):
            mark_start_failed(task, task_id)
            return
    try:
        try:
            requested_count = max(1, min(8, int(payload.n or 1)))
        except (TypeError, ValueError, OverflowError):
            requested_count = 1
        batch_mode = requested_count > 1
        remote_accept_callback = lambda remote_id, **meta: persist_accept(
            task_id, remote_id, batch=batch_mode, **meta
        )
        callback_token = accept_callback.set(
            remote_accept_callback
        )
        try:
            result = await generate(payload)
        finally:
            accept_callback.reset(callback_token)
    except pending_error as exc:
        # 即梦云端还在排队：标记为 jimeng_pending，前端据 submit_id 持久续查（任务未丢失）
        info = pending_payload(exc)
        with task_lock:
            task.update(task_state_update(task, "jimeng_pending", time.time(), pending={
                "submit_id": exc.submit_id,
                "kind": exc.kind,
                "queue_info": public_queue_info(exc.queue_info),
                "message": info["message"],
            }))
            write_record(task)
        return
    except Exception as exc:
        detail = public_error_detail(getattr(exc, "detail", None) or exc, fallback="图片生成失败")
        status_code = getattr(exc, "status_code", 500)
        upstream_task_id = getattr(exc, "upstream_task_id", "") or extract_task_id(detail)
        with task_lock:
            records = remote_records(task)
            # 批量请求可能已经有其他编号被上游受理；任何一个并发分支异常时，
            # 保留全部编号并进入 unknown，等待显式逐个查询，绝不重提整批。
            if batch_mode and records:
                statuses = remote_statuses(task, records)
                errors = remote_errors(task)
                if upstream_task_id and upstream_task_id in statuses:
                    errors[upstream_task_id] = detail
                update_remote_tracking(task, statuses, errors)
                task.update(task_state_update(
                    task,
                    "unknown",
                    time.time(),
                    error=unknown_message,
                    upstream_task_id=records[0]["id"],
                ))
            elif getattr(exc, "remote_accept_persist_failed", False) and upstream_task_id:
                task.update(task_state_update(
                    task,
                    "unknown",
                    time.time(),
                    error=unknown_message,
                    upstream_task_id=upstream_task_id,
                ))
            else:
                task.update(task_state_update(task, "failed", time.time(),
                    error=detail, status_code=status_code, upstream_task_id=upstream_task_id))
            write_record(task)
        return

    # 生成成功后，记录写回失败不能再把 succeeded 转成 failed；
    # 本进程继续保留结果，重启后按磁盘运行记录保守显示 unknown。
    with task_lock:
        records = remote_records(task)
        if records:
            statuses = remote_statuses(task, records)
            errors = remote_errors(task)
            for record in records:
                statuses[record["id"]] = "succeeded"
                errors.pop(record["id"], None)
            update_remote_tracking(task, statuses, errors)
        task.update(task_state_update(task, "succeeded", time.time(), result=result))
        try:
            write_record(task)
        except Exception as record_exc:
            diagnostic(
                "image succeeded task record write failed "
                f"error={type(record_exc).__name__}"
            )


async def enqueue_canvas_image_task(payload, request, task_id=None, *, AIReference, CANVAS_TASKS, CANVAS_TASK_LOCK, CANVAS_TASK_PROCESS_ID, HTTPException, TaskRecordError, _read_canvas_task_record, _write_canvas_task_record, asyncio, canvas_assistant_providers, hashlib, load_canvas, model_dump_compat, run_canvas_image_task, task_context, task_input_summary):
    binding = {}
    if payload.assistant_action_id:
        for key in ("assistant_action_id", "canvas_id", "node_id", "input_hash"):
            value = getattr(payload, key)
            pattern = r"[0-9a-f]{64}" if key == "input_hash" else r"[A-Za-z0-9_-]{1,100}"
            if not re.fullmatch(pattern, value):
                raise HTTPException(422, "助手图片任务须有完整有效的画布、节点、动作和输入绑定")
            binding[key] = value
    if payload.native_node_type:
        if not binding or payload.native_node_type not in {'msgen','midjourney'} or payload.n!=1:
            raise HTTPException(422,'原生目录图片任务须有完整助手归属和一次预算')
        from backend.canvas_assistant_native import catalog_image_inputs, native_run_input_hash
        from backend.canvas_assistant_msgen import prepare_msgen_run_config
        from backend.canvas_assistant_midjourney import prepare_midjourney_run_config
        document=load_canvas(payload.canvas_id)
        node=next((n for n in document['nodes'] if n['id']==payload.node_id),{})
        run=node.get('assistantNativeRun') or {}
        outputs=[n for n in document['nodes'] if n.get('type')=='output' and any(c.get('from')==node.get('id') and c.get('to')==n['id'] for c in document.get('connections',[]))]
        if (document.get('readOnly') or document.get('readonly') or node.get('type')!=payload.native_node_type
            or run.get('actionId')!=payload.assistant_action_id or run.get('taskIds') or node.get('submissionUnknown')
            or node.get('count')!=1 or node.get('outputEnabled') is not True or len(outputs)!=1
            or native_run_input_hash(document,payload.node_id)!=payload.input_hash):
            raise HTTPException(409,'原生图片画布、输入、输出或受理归属已变化，未提交')
        inputs=catalog_image_inputs(document,node)
        config=prepare_msgen_run_config(node,canvas_assistant_providers(),image_count=len(inputs['reference_images'])) if payload.native_node_type=='msgen' else prepare_midjourney_run_config(node,canvas_assistant_providers(),reference_count=len(inputs['reference_images']),has_prompt=bool(inputs['prompt']))
        if config['configurationHash']!=payload.native_configuration_hash or payload.provider_id!=config['provider'] or payload.model!=config['model']:
            raise HTTPException(409,'原魔搭或Midjourney平台/模型/LoRA配置已变化，未提交')
        # 仅服务器读取的已保存输入和配置进入供应商请求，不接受客户端改写。
        payload.prompt=inputs['prompt'] or 'Blend connected images.'
        payload.reference_images=[AIReference(**ref) for ref in inputs['reference_images']]
        payload.native_config=config
        if payload.native_node_type=='msgen':
            payload.size=config['size']
        identity={**binding,'native_node_type':payload.native_node_type}
        task_id='canvas_img_'+hashlib.sha256(json.dumps(identity,sort_keys=True).encode()).hexdigest()[:32]
        binding.update(native_node_type=payload.native_node_type,assistant_request_hash=hashlib.sha256(json.dumps(model_dump_compat(payload),ensure_ascii=False,sort_keys=True).encode()).hexdigest())
    if payload.assistant_slot_key:
        if not binding or not re.fullmatch(r"[0-9]{1,3}:[0-9]{1,3}",payload.assistant_slot_key):
            raise HTTPException(422,"循环轮槽必须有完整助手归属和有效步骤编号")
        identity={**binding,"assistant_slot_key":payload.assistant_slot_key}
        slot_id="canvas_img_"+hashlib.sha256(json.dumps(identity,sort_keys=True,separators=(",",":")).encode()).hexdigest()[:32]
        if task_id is not None and task_id!=slot_id:raise HTTPException(409,"循环原轮槽任务编号不一致，只查询原任务")
        task_id=slot_id
        binding.update(assistant_slot_key=payload.assistant_slot_key,assistant_request_hash=hashlib.sha256(json.dumps(model_dump_compat(payload),ensure_ascii=False,sort_keys=True,separators=(",",":")).encode()).hexdigest())
    task_id = task_id or f"canvas_img_{uuid.uuid4().hex}"
    trace_fields = task_context(
        task_id,
        trace_id=getattr(request.state, "trace_id", ""),
        request_id=getattr(request.state, "request_id", ""),
    )
    with CANVAS_TASK_LOCK:
        previous = CANVAS_TASKS.get(task_id) or _read_canvas_task_record(task_id)
        if previous:
            if (payload.assistant_slot_key or payload.native_node_type) and (previous.get("type")!="online-image" or any(previous.get(k)!=v for k,v in {**binding,"provider_id":payload.provider_id,"model":payload.model}.items())):
                raise HTTPException(409,"同一循环轮槽的原请求或归属不同，只查询原任务，不重新提交")
            return {"task_id": task_id, "status": previous.get("status", "unknown")}
        CANVAS_TASKS[task_id] = {
            "id": task_id,
            "type": "online-image",
            "status": "queued",
            "created_at": time.time(),
            "updated_at": time.time(),
            "result": None,
            "error": "",
            "provider_id": payload.provider_id,
            "model": payload.model,
            **binding,
            "input_summary": task_input_summary(
                prompt=payload.prompt,
                provider_id=payload.provider_id,
                model=payload.model,
                reference_count=len(payload.reference_images or []),
            ),
            "process_id": CANVAS_TASK_PROCESS_ID,
            "trace_id": trace_fields["trace_id"],
            "request_id": trace_fields["request_id"],
        }
        try:
            _write_canvas_task_record(CANVAS_TASKS[task_id], required=True)
        except (OSError, TaskRecordError):
            CANVAS_TASKS.pop(task_id, None)
            error = HTTPException(status_code=503, detail="本地图片任务记录无法保存，本次请求未提交")
            error.submission_known_rejected = True
            raise error
    asyncio.create_task(run_canvas_image_task(task_id, payload))
    return {"task_id": task_id, "status": "queued", **trace_fields}


async def get_canvas_image_task(task_id, *, CANVAS_TASKS, CANVAS_TASK_LOCK, HTTPException, _interrupted_canvas_task, _public_canvas_task, _read_canvas_task_record):
    with CANVAS_TASK_LOCK:
        task = dict(CANVAS_TASKS.get(task_id) or {})
        if not task:
            task = dict(_read_canvas_task_record(task_id) or {})
    if not task:
        raise HTTPException(status_code=404, detail="画布任务不存在，可能服务已重启或任务已过期")
    return _public_canvas_task(_interrupted_canvas_task(task))


async def refresh_canvas_image_task(task_id, *, CANVAS_TASKS, CANVAS_TASK_LOCK, CANVAS_TASK_PROCESS_ID, HTTPException, ImageTaskQueryRequest, _canvas_remote_errors, _canvas_remote_records, _canvas_remote_results, _canvas_remote_statuses, _public_canvas_task, _read_canvas_task_record, _update_canvas_remote_tracking, _write_canvas_task_record, get_api_provider_exact, image_batch_outcome, is_runninghub_provider, public_comfy_error_detail, query_image_task, query_native_catalog_image_task, task_state_update):
    """显式查询已有上游编号的图片任务，不重新提交。"""

    with CANVAS_TASK_LOCK:
        recorded = dict(CANVAS_TASKS.get(task_id) or {})
        if not recorded:
            recorded = dict(_read_canvas_task_record(task_id) or {})
    if not recorded:
        raise HTTPException(status_code=404, detail="图片任务记录不存在；请勿直接重复提交")
    current_status = str(recorded.get("status") or "").strip().lower()
    if current_status in {"succeeded", "failed"}:
        return _public_canvas_task(recorded)
    if current_status == "running" and recorded.get("process_id") == CANVAS_TASK_PROCESS_ID:
        raise HTTPException(status_code=409, detail="图片任务仍由当前进程查询中，请稍后再试")
    remote_records = _canvas_remote_records(recorded)
    if not remote_records:
        raise HTTPException(status_code=409, detail="本地记录没有上游任务编号，无法安全查询；请勿重新提交")
    provider_id = str(recorded.get("provider_id") or "").strip()
    if not provider_id:
        raise HTTPException(status_code=409, detail="本地记录没有图片供应商，无法安全查询")
    try:
        provider = get_api_provider_exact(provider_id)
    except HTTPException as exc:
        raise HTTPException(status_code=409, detail="原图片供应商配置不可用，无法安全查询；请恢复原配置后重试") from exc
    statuses = _canvas_remote_statuses(recorded, remote_records)
    errors = _canvas_remote_errors(recorded)
    remote_results = _canvas_remote_results(recorded)
    previous_result = recorded.get("result") if isinstance(recorded.get("result"), dict) else {}
    merged_images = []
    merged_items = []
    result_template = dict(previous_result)
    for saved in remote_results.values():
        for image in saved.get("images") or []:
            if image and image not in merged_images:
                merged_images.append(image)
        for item in saved.get("image_items") or []:
            item_url = str(item.get("url") or "").strip()
            if item_url and not any(str(existing.get("url") or "").strip() == item_url for existing in merged_items):
                merged_items.append(item)
    for image in previous_result.get("images") or []:
        if image and image not in merged_images:
            merged_images.append(image)
    for item in previous_result.get("image_items") or []:
        if isinstance(item, dict):
            item_url = str(item.get("url") or "").strip()
            if item_url and not any(str(existing.get("url") or "").strip() == item_url for existing in merged_items):
                merged_items.append(item)
    for remote_record in remote_records:
        remote_id = remote_record["id"]
        query_mode = remote_record["mode"]
        if statuses.get(remote_id) in {"succeeded", "failed"}:
            continue
        if query_mode == "runninghub_image" and not is_runninghub_provider(provider):
            errors[remote_id] = "原图片供应商配置已变化，无法查询 RunningHub 任务"
            statuses[remote_id] = "unknown"
            continue
        if query_mode == "http_get" and is_runninghub_provider(provider):
            errors[remote_id] = "原图片供应商配置已变化，无法查询图片任务"
            statuses[remote_id] = "unknown"
            continue
        try:
            result = await query_native_catalog_image_task(recorded['native_node_type'],provider_id,remote_id) if recorded.get('native_node_type') else await query_image_task(
                ImageTaskQueryRequest(provider_id=provider_id, task_id=remote_id)
            )
        except Exception as exc:
            statuses[remote_id] = "unknown"
            errors[remote_id] = public_comfy_error_detail(
                getattr(exc, "detail", None) or exc,
                fallback="查询图片任务失败",
            )[:600]
            continue
        result_status = str(result.get("status") or "running").strip().lower() if isinstance(result, dict) else "running"
        if result_status == "succeeded":
            statuses[remote_id] = "succeeded"
            errors.pop(remote_id, None)
            if isinstance(result, dict):
                result_template.update({
                    key: result[key]
                    for key in ("type", "model", "provider_id", "provider_name", "timestamp", "native_remote_task_id")
                    if result.get(key) is not None
                })
                for image in result.get("images") or []:
                    if image and image not in merged_images:
                        merged_images.append(image)
                for item in result.get("image_items") or []:
                    if not isinstance(item, dict):
                        continue
                    item_url = str(item.get("url") or "").strip()
                    if item_url and not any(str(existing.get("url") or "").strip() == item_url for existing in merged_items):
                        merged_items.append(item)
                remote_results[remote_id] = {
                    "images": [str(item) for item in (result.get("images") or []) if item],
                    "image_items": [item for item in (result.get("image_items") or []) if isinstance(item, dict)],
                }
        elif result_status == "failed":
            statuses[remote_id] = "failed"
            errors[remote_id] = str(result.get("error") or "图片任务失败")[:600] if isinstance(result, dict) else "图片任务失败"
        else:
            statuses[remote_id] = "running"
            errors[remote_id] = str(result.get("message") or "上游图片任务仍在生成中，请稍后再次查询")[:600] if isinstance(result, dict) else "上游图片任务仍在生成中，请稍后再次查询"

    with CANVAS_TASK_LOCK:
        latest = dict(CANVAS_TASKS.get(task_id) or {})
        if not latest:
            latest = dict(_read_canvas_task_record(task_id) or {})
        if not latest:
            raise HTTPException(status_code=404, detail="图片任务记录不存在；请勿直接重复提交")
        if latest.get("status") in {"succeeded", "failed"}:
            return _public_canvas_task(latest)
        latest_records = _canvas_remote_records(latest)
        if [item["id"] for item in latest_records] != [item["id"] for item in remote_records]:
            raise HTTPException(status_code=409, detail="图片任务编号已变化，请刷新画布后再查询")
        _update_canvas_remote_tracking(latest, statuses, errors)
        latest["upstream_task_results"] = {
            key: value
            for key, value in remote_results.items()
            if key in statuses
        }
        terminal_statuses = [statuses[item["id"]] for item in remote_records]
        outcome = image_batch_outcome(terminal_statuses, has_images=bool(merged_images))
        if outcome == "succeeded":
            result_template["images"] = merged_images
            result_template["image_items"] = merged_items
            result_template["task_id"] = remote_records[0]["id"]
            result_template.setdefault("provider_id", provider_id)
            result_template.setdefault("type", "online")
            latest.update(task_state_update(latest, "succeeded", time.time(), result=result_template))
        elif outcome == "partial":
            result_template["images"] = merged_images
            result_template["image_items"] = merged_items
            result_template["task_id"] = remote_records[0]["id"]
            result_template.setdefault("provider_id", provider_id)
            result_template.setdefault("type", "online")
            failed_count = sum(status == "failed" for status in terminal_statuses)
            latest.update(task_state_update(latest, "succeeded", time.time(), result=result_template))
            latest["error"] = f"批量任务有 {failed_count} 个上游编号失败，已保留成功图片"
        elif outcome == "failed":
            latest.update(task_state_update(
                latest,
                "failed",
                time.time(),
                error="；".join(errors.get(item["id"], "图片任务失败") for item in remote_records)[:600],
                status_code=502,
                upstream_task_id=remote_records[0]["id"],
            ))
        else:
            latest.update({
                "status": "unknown",
                "updated_at": time.time(),
                "error": "；".join(errors.get(item["id"], "上游图片任务仍在生成中") for item in remote_records if statuses.get(item["id"]) not in {"succeeded", "failed"})[:600],
                "upstream_task_id": remote_records[0]["id"],
            })
        CANVAS_TASKS[task_id] = latest
        _write_canvas_task_record(latest, required=True)
        return _public_canvas_task(latest)


