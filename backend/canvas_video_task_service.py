"""视频任务专用记录、幂等接入、状态视图与执行生命周期。

复用现有任务文件锁/原子写和远端协议规则，不依赖 FastAPI 或 main。
应用注入共享锁、进程编号、易失结果字典及供应商/校验回调。
"""
from contextlib import contextmanager
import re
import time
from typing import Any, Dict, Optional

from backend.task_records import (TaskRecordError, task_record_path, task_records_lock,
                                 _read_task_record_unlocked, _write_task_record_unlocked,
                                 task_input_summary)
from backend.task_states import task_state_update
from backend.remote_task_protocol import (REMOTE_PENDING, REMOTE_UNKNOWN, REMOTE_FAILED,
                                         REMOTE_SUCCEEDED, observe_remote_task, remote_task_decision)

VIDEO_TASK_ID_RE = re.compile(r"canvas_video_[A-Za-z0-9_-]{8,87}\Z")


class VideoTaskError(Exception):
    """供应用适配层转换为原 HTTP 状态和错误说明。"""
    def __init__(self, status_code, detail):
        super().__init__(str(detail))
        self.status_code = status_code
        self.detail = detail


def record_path(task_id, *, root):
    clean_id = str(task_id or "").strip()
    if not VIDEO_TASK_ID_RE.fullmatch(clean_id):
        raise VideoTaskError(status_code=400, detail="视频任务编号格式无效")
    try:
        return task_record_path(root, clean_id)
    except TaskRecordError as exc:
        raise VideoTaskError(status_code=400, detail="视频任务编号格式无效") from exc


@contextmanager
def record_lock(task_id, *, root, lock):
    """同编号视频任务的短读改写锁；供应商请求必须在锁外执行。"""

    # 统一使用任务记录模块的目录级维护锁；读改写仍由本地 RLock 保护，
    # 供应商请求继续在锁外执行，避免阻塞其他任务。
    with task_records_lock(root):
        with lock:
            yield


def read_record(task_id, *, root):
    try:
        record_path(task_id, root=root)
        return _read_task_record_unlocked(root, task_id)
    except (OSError, TaskRecordError, ValueError, TypeError) as exc:
        raise VideoTaskError(status_code=500, detail="视频任务记录损坏或无法读取；已停止重复提交，请先检查本地记录") from exc


def write_record(task, *, root):
    task_id = str(task.get("id") or "").strip() if isinstance(task, dict) else ""
    record_path(task_id, root=root)
    _write_task_record_unlocked(root, task)


def public_input_summary(value: Any) -> Optional[Dict[str, Any]]:
    """只公开视频输入摘要的固定字段，兼容旧记录时也不回显原文。"""

    if not isinstance(value, dict):
        return None
    public: Dict[str, Any] = {}
    integer_bounds = {
        "prompt_length": (0, 10_000_000),
        "workflow_length": (0, 10_000_000),
        "reference_count": (0, 64),
        "image_reference_count": (0, 64),
        "video_reference_count": (0, 64),
        "audio_reference_count": (0, 64),
        "duration": (0, 3600),
    }
    for key, (minimum, maximum) in integer_bounds.items():
        raw = value.get(key)
        if isinstance(raw, bool):
            continue
        try:
            number = int(raw)
        except (TypeError, ValueError, OverflowError):
            continue
        public[key] = max(minimum, min(maximum, number))
    for key, limit in (("provider_id", 128), ("model", 256), ("aspect_ratio", 32)):
        raw = value.get(key)
        if isinstance(raw, str) and raw.strip():
            public[key] = raw.strip()[:limit]
    return public or None


async def persist_remote_accept(task_id, remote_task_id, *, query_supported=True,
                                query_mode="runninghub_openapi", process_id,
                                record_lock, read_record, write_record):
    """在视频 worker 开始长轮询前，把上游受理编号写入本地记录。"""

    remote_id = str(remote_task_id or "").strip()
    if not remote_id or any(ord(char) < 0x20 for char in remote_id) or any(char in remote_id for char in "?#"):
        raise ValueError("上游返回的视频任务编号无效")
    remote_id = remote_id[:240]
    with record_lock(task_id):
        task = read_record(task_id)
        if not task or task.get("process_id") != process_id:
            raise OSError("视频任务记录已失效")
        if task.get("status") in {"succeeded", "failed"}:
            raise OSError("视频任务已结束")
        remote = dict(task.get("remote") or {})
        remote.update(
            {
                "status": REMOTE_PENDING,
                "task_id": remote_id,
                "retryable": True,
                "remote_confirmed": False,
                "operation": "submit",
                "query_supported": bool(query_supported),
                "query_mode": str(query_mode or "")[:40],
            }
        )
        updated = {
            **task,
            "remote": remote,
            "upstream_task_id": remote_id,
            "updated_at": time.time(),
        }
        write_record(updated)


def public_task(task, *, public_error):
    """只返回视频任务公开字段，兼容旧记录时也不泄露 prompt/raw。"""

    allowed = {
        "id",
        "task_id",
        "type",
        "status",
        "created_at",
        "updated_at",
        "provider_id",
        "model",
        "result",
        "error",
        "status_code",
        "input_summary",
        "remote",
        "upstream_task_id",
        "submit_id",
        "kind",
        "queue_info",
        "message",
        "assistant_action_id",
        "canvas_id",
        "node_id",
        "input_hash",
    }
    public = {key: task[key] for key in allowed if key in task}
    for key in ("assistant_action_id", "canvas_id", "node_id", "input_hash"):
        value = public.get(key)
        pattern = r"[0-9a-f]{64}" if key == "input_hash" else r"[A-Za-z0-9_-]{1,100}"
        if key in public and (not isinstance(value, str) or not re.fullmatch(pattern, value)):
            public.pop(key)
    result = public.get("result")
    if isinstance(result, dict):
        safe_result = {}
        videos = result.get("videos")
        if isinstance(videos, (list, tuple)):
            safe_result["videos"] = [
                str(item.get("url") if isinstance(item, dict) else item).strip()[:600]
                for item in videos[:32]
                if str(item.get("url") if isinstance(item, dict) else item).strip().startswith(("/output/", "/assets/"))
            ]
        for key in ("task_id", "video_id"):
            value = str(result.get(key) or "").strip()
            if value:
                safe_result[key] = value[:240]
        public["result"] = safe_result
    remote = public.get("remote")
    if isinstance(remote, dict):
        safe_remote = {
            "status": str(remote.get("status") or REMOTE_UNKNOWN)[:24],
            "task_id": str(remote.get("task_id") or "")[:240],
            "retryable": bool(remote.get("retryable", False)),
            "remote_confirmed": bool(remote.get("remote_confirmed", False)),
            "operation": str(remote.get("operation") or "query")[:20],
        }
        for key in ("query_supported", "query_mode"):
            if key in remote:
                safe_remote[key] = bool(remote[key]) if key == "query_supported" else str(remote[key])[:40]
        if remote.get("error"):
            safe_remote["error"] = public_error(remote.get("error"), fallback="远端状态未知", limit=600)
        public["remote"] = safe_remote
    if "input_summary" in public:
        input_summary = public_input_summary(public["input_summary"])
        if input_summary is None:
            public.pop("input_summary", None)
        else:
            public["input_summary"] = input_summary
    if "error" in public and public["error"]:
        public["error"] = public_error(public["error"], fallback="视频任务失败", limit=600)
    return public


def interrupted_task(task, *, process_id, unknown_message):
    if task.get("status") in {"queued", "running"} and task.get("process_id") != process_id:
        existing_remote = dict(task.get("remote") or {})
        existing_remote_id = str(
            existing_remote.get("task_id") or task.get("upstream_task_id") or ""
        )[:240]
        remote_observation = observe_remote_task(
            operation="query", transport_error=True
        )
        remote_public = remote_observation_public(
            remote_observation,
            fallback_task_id=existing_remote_id,
            fallback_error=unknown_message,
        )
        for key in ("query_supported", "query_mode"):
            if key in existing_remote:
                remote_public[key] = existing_remote[key]
        task = {
            **task,
            "status": "unknown",
            "error": unknown_message,
            "remote": remote_public,
        }
    return task


def visible_task(recorded, *, volatile):
    """磁盘终态优先；仅在运行态写盘失败时使用本进程的结果缓存。"""

    task_id = str(recorded.get("id") or "")
    if recorded.get("status") not in {"queued", "running"}:
        return recorded
    return volatile.get(task_id) or recorded


def remote_observation_public(observation, *, fallback_task_id: str = "", fallback_error: str = "") -> Dict[str, Any]:
    """把统一远端协议的观察结果压缩成可持久化字段。

    任务记录只保存状态、编号和短错误摘要，不保存供应商原始回包；这样
    视频任务仍可追溯到一次受理，同时不会把提示词、URL 或密钥写入记录。
    """

    task_id = str(getattr(observation, "task_id", "") or fallback_task_id or "")[:240]
    error = str(getattr(observation, "error", "") or fallback_error or "")[:600]
    data = {
        "status": str(getattr(observation, "status", REMOTE_UNKNOWN) or REMOTE_UNKNOWN),
        "task_id": task_id,
        "retryable": bool(getattr(observation, "retryable", False)),
        "remote_confirmed": bool(getattr(observation, "remote_confirmed", False)),
        "operation": str(getattr(observation, "operation", "query") or "query")[:20],
    }
    if error:
        data["error"] = error
    return data


def result_observation(result, videos=None, *, output_urls):
    """将视频适配器结果转换成统一远端观察结果。

    适配器可能只返回本地保存后的视频地址或即梦排队信息；有明确输出时
    可安全视为成功，其他没有明确终态的结果一律保留 ``unknown``。
    """

    raw = result.get("raw") if isinstance(result, dict) else None
    task_id = ""
    if isinstance(result, dict):
        task_id = str(result.get("task_id") or result.get("video_id") or "")[:240]
    if videos:
        payload = raw if isinstance(raw, dict) else {}
        # 有些适配器会丢弃原始回包，只返回已落盘的视频地址；输出本身是
        # 成功证据，补入协议可识别的媒体字段，仍不把原始回包写入磁盘。
        if not output_urls(payload):
            payload = {"status": "SUCCESS", "task_id": task_id, "videos": list(videos)}
        observation = observe_remote_task(payload, operation="query")
        if observation.status == REMOTE_UNKNOWN:
            observation = observe_remote_task(
                {"status": "SUCCESS", "task_id": task_id, "videos": list(videos)},
                operation="query",
            )
        return observation
    if isinstance(result, dict) and result.get("jimeng_pending") and result.get("submit_id"):
        return observe_remote_task(
            {"status": "PENDING", "task_id": result.get("submit_id")},
            operation="query",
        )
    # 没有明确远端终态时不要把本地等待结束解释成失败。
    return observe_remote_task(operation="query", transport_error=True)


async def run_video_task(task_id, payload, *, gate, worker):
    async with gate:
        await worker(task_id, payload)


async def run_video_worker(task_id, payload, *, record_lock, read_record, write_record,
                           process_id, task_lock, volatile, validate, accept_callback,
                           persist_accept, generate, result_observation, pending_error,
                           pending_payload, public_queue_info, public_error, unknown_message,
                           diagnostic, record_error_types=(OSError, VideoTaskError)):
    task = None
    try:
        with record_lock(task_id):
            task = read_record(task_id)
            if not task or task.get("process_id") != process_id or task.get("status") != "queued":
                return
            running = {
                **task,
                **task_state_update(task, "running", time.time()),
            }
            write_record(running)
    except record_error_types:
        # 连 running 状态都无法可靠保存时，绝不能向供应商发起请求。
        with task_lock:
            volatile[task_id] = {
                **(task or {}),
                "id": task_id,
                "task_id": task_id,
                "process_id": process_id,
                "status": "failed",
                "error": "本地视频任务未能启动，请求未提交",
                "result": None,
                "updated_at": time.time(),
            }
        return
    try:
        validate(payload, task, check_provider=True)
        callback_token = accept_callback.set(
            lambda remote_id, **meta: persist_accept(
                task_id, remote_id, **meta
            )
        )
        try:
            result = await generate(payload)
        finally:
            accept_callback.reset(callback_token)
        videos = result.get("videos") if isinstance(result, dict) else None
        if videos:
            remote_observation = result_observation(result, videos)
            outcome = {
                "status": "succeeded", "error": "",
                "result": {
                    "videos": videos,
                    "task_id": result.get("task_id"),
                    **({"video_id": result["video_id"]} if result.get("video_id") else {}),
                },
                "upstream_task_id": str(result.get("task_id") or "")[:240],
                "remote": remote_observation_public(
                    remote_observation,
                    fallback_task_id=str(result.get("task_id") or ""),
                ),
            }
        elif isinstance(result, dict) and result.get("jimeng_pending") and result.get("submit_id"):
            remote_observation = result_observation(result)
            outcome = {
                "status": "jimeng_pending", "result": None, "error": "",
                "submit_id": str(result["submit_id"])[:240], "kind": result.get("kind") or "video",
                "queue_info": public_queue_info(result.get("queue_info")),
                "message": result.get("message") or "即梦任务仍在生成中",
                "remote": remote_observation_public(
                    remote_observation,
                    fallback_task_id=str(result.get("submit_id") or ""),
                ),
            }
        else:
            remote_observation = result_observation(result)
            outcome = {
                "status": "unknown", "result": None, "error": unknown_message,
                "remote": remote_observation_public(remote_observation),
            }
    except pending_error as exc:
        info = pending_payload(exc)
        remote_observation = observe_remote_task(
            {"status": "PENDING", "task_id": exc.submit_id},
            operation="query",
        )
        outcome = {
            "status": "jimeng_pending", "result": None, "error": "",
            "submit_id": exc.submit_id, "kind": exc.kind,
            "queue_info": public_queue_info(exc.queue_info), "message": info["message"],
            "remote": remote_observation_public(
                remote_observation,
                fallback_task_id=str(exc.submit_id or ""),
            ),
        }
    except Exception as exc:
        status_code = getattr(exc, "status_code", 500)
        definitely_rejected = isinstance(status_code, int) and 400 <= status_code < 500 and status_code != 408
        detail = public_error(getattr(exc, "detail", "") or exc, fallback="视频生成失败", limit=600)
        if definitely_rejected:
            remote_observation = observe_remote_task(
                {"status": "FAILED", "error": detail},
                operation="submit",
                http_status=status_code,
            )
            decision = remote_task_decision("running", remote_observation)
            local_status = "failed" if decision.status == REMOTE_FAILED else "unknown"
        else:
            remote_observation = observe_remote_task(
                operation="submit",
                http_status=status_code if isinstance(status_code, int) else None,
                transport_error=not isinstance(status_code, int),
            )
            decision = remote_task_decision("running", remote_observation)
            local_status = "unknown"
        outcome = {
            "status": local_status,
            "result": None,
            "error": detail if definitely_rejected else unknown_message,
            "status_code": status_code if isinstance(status_code, int) else 500,
            "remote": remote_observation_public(
                remote_observation,
                fallback_error=detail if definitely_rejected else unknown_message,
            ),
        }
        upstream_id = getattr(exc, "upstream_task_id", "")
        if upstream_id:
            outcome["upstream_task_id"] = str(upstream_id)[:240]
    try:
        with record_lock(task_id):
            task = read_record(task_id)
            if not task or task.get("process_id") != process_id or task.get("status") != "running":
                return
            existing_remote = task.get("remote") if isinstance(task.get("remote"), dict) else {}
            outcome_remote = outcome.get("remote") if isinstance(outcome.get("remote"), dict) else None
            if outcome_remote is not None and existing_remote:
                # 受理回调可能已经先把编号写入磁盘；超时/断线的最终观察不能
                # 用一个没有 task_id 的 unknown 覆盖它，否则刷新入口会丢失原编号。
                for key in ("task_id", "query_supported", "query_mode"):
                    value = outcome_remote.get(key)
                    if value in (None, "") and existing_remote.get(key) not in (None, ""):
                        outcome_remote[key] = existing_remote[key]
                if not outcome_remote.get("task_id"):
                    fallback_id = str(task.get("upstream_task_id") or "").strip()
                    if fallback_id:
                        outcome_remote["task_id"] = fallback_id[:240]
            next_status = str(outcome.get("status") or "").strip().lower()
            if next_status == "succeeded":
                state_update = task_state_update(
                    task,
                    "succeeded",
                    time.time(),
                    result=outcome.get("result"),
                )
            elif next_status == "failed":
                state_update = task_state_update(
                    task,
                    "failed",
                    time.time(),
                    error=outcome.get("error") or "视频任务失败",
                    status_code=outcome.get("status_code", 500),
                    upstream_task_id=outcome.get("upstream_task_id"),
                )
            elif next_status == "unknown":
                state_update = task_state_update(
                    task,
                    "unknown",
                    time.time(),
                    error=outcome.get("error") or unknown_message,
                    upstream_task_id=outcome.get("upstream_task_id"),
                )
            elif next_status == "jimeng_pending":
                state_update = task_state_update(
                    task,
                    "jimeng_pending",
                    time.time(),
                    pending={
                        "submit_id": outcome.get("submit_id"),
                        "kind": outcome.get("kind") or "video",
                        "queue_info": outcome.get("queue_info") or {},
                        "message": outcome.get("message") or "即梦任务仍在生成中",
                    },
                )
            else:
                diagnostic(f"canvas video invalid task outcome status={next_status or 'empty'}")
                return
            completed = {**task, **state_update}
            for key in ("remote", "status_code", "upstream_task_id"):
                if key in outcome and outcome[key] is not None:
                    completed[key] = outcome[key]
            try:
                write_record(completed)
            except OSError:
                # 本进程仍可查询结果；重启后磁盘中的 running 只返回未知视图。
                volatile[task_id] = completed
    except record_error_types as exc:
        diagnostic(f"canvas video final record unavailable error={type(exc).__name__}")


async def create_task(payload, *, path_check, validate, record_lock, read_record,
                      write_record, volatile, process_id, visible_record, interrupted_record,
                      public_record, worker, spawn):
    task_id = payload.client_task_id
    path_check(task_id)
    binding = validate(payload)
    try:
        with record_lock(task_id):
            # 磁盘记录是跨进程的幂等依据；本进程的完成缓存只影响展示。
            existing = read_record(task_id)
            if not existing:
                existing = volatile.get(task_id)
            if existing:
                validate(payload, existing)
                visible = visible_record(existing)
                return public_record(interrupted_record(visible))
            validate(payload, check_provider=True)
            input_summary = task_input_summary(
                prompt=payload.prompt,
                provider_id=payload.provider_id,
                model=payload.model,
                reference_count=(len(payload.images or []) + len(payload.videos or []) + len(payload.audios or [])),
            )
            input_summary.update({
                "image_reference_count": len(payload.images or []),
                "video_reference_count": len(payload.videos or []),
                "audio_reference_count": len(payload.audios or []),
                "duration": max(0, min(3600, int(payload.duration or 0))),
                "aspect_ratio": str(payload.aspect_ratio or "")[:32],
            })
            task = {
                "id": task_id, "task_id": task_id, "type": "video", "status": "queued",
                "created_at": time.time(), "updated_at": time.time(),
                "process_id": process_id,
                "provider_id": payload.provider_id, "model": payload.model,
                **binding,
                "result": None, "error": "", "input_summary": input_summary,
                "remote": {
                    "status": REMOTE_PENDING,
                    "task_id": "",
                    "retryable": False,
                    "remote_confirmed": False,
                    "operation": "submit",
                },
            }
            write_record(task)
            worker = worker(task_id, payload)
            try:
                spawn(worker)
            except Exception as exc:
                worker.close()
                write_record({**task, "status": "failed", "error": "本地任务未能启动，视频请求未提交"})
                raise VideoTaskError(status_code=503, detail="本地视频任务未能启动，请查询原编号") from exc
    except OSError as exc:
        raise VideoTaskError(status_code=503, detail="视频任务记录暂时不可用，本进程未提交；请按原编号查询") from exc
    return public_record(task)


def get_task(task_id, *, record_lock, read_record, volatile, visible_record,
             interrupted_record, public_record):
    try:
        with record_lock(task_id):
            task = read_record(task_id)
            if not task:
                task = volatile.get(task_id)
            if not task:
                raise VideoTaskError(status_code=404, detail="本地视频任务记录不存在；提交状态未知，请勿直接重复提交")
            visible = visible_record(task)
            return public_record(interrupted_record(visible))
    except OSError as exc:
        raise VideoTaskError(status_code=503, detail="视频任务记录暂时无法读取，请稍后按原编号查询") from exc


async def refresh_task(task_id, *, record_lock, read_record, write_record, volatile,
                       visible_record, interrupted_record, public_record, query_remote,
                       public_error, unknown_message):
    """显式查询已受理的视频任务一次，不重新提交任务。"""

    try:
        with record_lock(task_id):
            recorded = read_record(task_id)
            if not recorded:
                recorded = volatile.get(task_id)
            if not recorded:
                raise VideoTaskError(status_code=404, detail="本地视频任务记录不存在；提交状态未知，请勿直接重复提交")
            task = interrupted_record(visible_record(recorded))
            remote = task.get("remote") if isinstance(task.get("remote"), dict) else {}
            remote_id = str(remote.get("task_id") or task.get("upstream_task_id") or "").strip()
            provider_id = str(task.get("provider_id") or "").strip().lower()
            query_supported = remote.get("query_supported") is True
            current_status = str(task.get("status") or "").strip().lower()
            if current_status in {"succeeded", "failed"}:
                return public_record(task)
    except OSError as exc:
        raise VideoTaskError(status_code=503, detail="视频任务记录暂时无法读取，请稍后按原编号查询") from exc
    if not remote_id:
        raise VideoTaskError(status_code=409, detail="本地记录没有远端任务编号，无法安全查询；请勿重新提交")
    query_mode = str(remote.get("query_mode") or "").strip().lower()
    if not query_supported:
        raise VideoTaskError(status_code=409, detail="当前视频供应商暂不支持远端刷新；请保留原任务编号并稍后查询")
    provider, observation, local_urls = await query_remote(task, remote_id, provider_id, query_mode)
    try:
        with record_lock(task_id):
            # 远端查询期间没有持锁；写回前必须重新读取磁盘，避免覆盖 owner
            # 刚保存的结果或新受理编号。
            latest = read_record(task_id)
            if not latest:
                latest = volatile.get(task_id)
            if not latest:
                raise VideoTaskError(status_code=404, detail="本地视频任务记录不存在；提交状态未知，请勿直接重复提交")
            latest_remote = latest.get("remote") if isinstance(latest.get("remote"), dict) else {}
            latest_remote_id = str(latest_remote.get("task_id") or latest.get("upstream_task_id") or "").strip()
            if latest_remote_id != remote_id:
                raise VideoTaskError(status_code=409, detail="视频任务编号已变化，请刷新画布后再查询")
            latest_status = str(latest.get("status") or "").strip().lower()
            if latest_status in {"succeeded", "failed"}:
                return public_record(latest)
            # 外进程可能仍在提交或轮询；一次不确定的远端查询不能终止它。
            if latest_status in {"queued", "running"} and not (
                (observation.status == REMOTE_SUCCEEDED and local_urls)
                or observation.status == REMOTE_FAILED
            ):
                return public_record(interrupted_record(latest))
            remote_public = remote_observation_public(
                observation, fallback_task_id=remote_id
            )
            for key in ("query_supported", "query_mode"):
                if key in latest_remote:
                    remote_public[key] = latest_remote[key]
            if observation.status == REMOTE_SUCCEEDED and local_urls:
                updated = {
                    **latest,
                    "status": "succeeded",
                    "error": "",
                    "result": {"videos": local_urls, "task_id": remote_id},
                    "upstream_task_id": remote_id,
                    "remote": remote_public,
                    "updated_at": time.time(),
                }
            elif observation.status == REMOTE_FAILED:
                failed_message = (
                    f"{provider.get('name') or provider_id} 视频任务失败"
                    if provider_id != "runninghub"
                    else "RunningHub 视频任务失败"
                )
                updated = {
                    **latest,
                    "status": "failed",
                    "error": public_error(
                        getattr(observation, "error", "") or failed_message,
                        fallback=failed_message,
                    ),
                    "result": None,
                    "upstream_task_id": remote_id,
                    "remote": remote_public,
                    "updated_at": time.time(),
                }
            else:
                updated = {
                    **latest,
                    "status": "unknown",
                    "error": unknown_message,
                    "result": None,
                    "upstream_task_id": remote_id,
                    "remote": remote_public,
                    "updated_at": time.time(),
                }
            write_record(updated)
            volatile.pop(task_id, None)
            return public_record(updated)
    except OSError as exc:
        raise VideoTaskError(status_code=503, detail="视频任务记录暂时无法保存，请稍后按原编号查询") from exc


def validate_canvas_video_assistant_task(payload, existing=None, *, check_provider=False, re, HTTPException, hashlib, json, model_dump_compat, get_api_provider_exact, model_list_from_values):
    """助手任务固定归属与完整请求；旧手动任务保留原有兼容行为。"""
    binding = {}
    if payload.assistant_action_id:
        for key in ("assistant_action_id", "canvas_id", "node_id", "input_hash"):
            value = getattr(payload, key)
            pattern = r"[0-9a-f]{64}" if key == "input_hash" else r"[A-Za-z0-9_-]{1,100}"
            if not re.fullmatch(pattern, value):
                raise HTTPException(422, "助手视频任务须有完整有效的画布、节点、动作和输入绑定")
            binding[key] = value
        binding["request_hash"] = hashlib.sha256(
            json.dumps(model_dump_compat(payload), ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
    if existing and (binding or existing.get("assistant_action_id")):
        expected = {**binding, "provider_id":payload.provider_id, "model":payload.model}
        if not binding or existing.get("type") != "video" or any(existing.get(key) != value for key, value in expected.items()):
            raise HTTPException(409, "同一视频任务编号的归属或参数不一致，请只查询原任务")
    if binding and check_provider:
        if not payload.provider_id or not payload.model:
            raise HTTPException(409, "请先在原视频节点手动选择平台和模型，助手不使用默认配置")
        try:
            provider = get_api_provider_exact(payload.provider_id)
        except HTTPException as exc:
            raise HTTPException(409, "原视频平台不存在或已停用，本次视频请求未提交") from exc
        if provider.get("id") != payload.provider_id or provider.get("enabled") is False or payload.model not in model_list_from_values(provider.get("video_models") or []):
            raise HTTPException(409, "原视频平台或所属模型已变化，本次视频请求未提交")
    return binding


async def _query_canvas_video_remote(task, remote_id, provider_id, query_mode, *, get_api_provider_exact, HTTPException, is_runninghub_provider, query_runninghub_video_task_once, is_jimeng_provider, query_jimeng_video_task_once, is_tudou_provider, is_agnes_provider, query_video_task_once):
    try:
        provider = get_api_provider_exact(provider_id)
    except HTTPException as exc:
        raise HTTPException(status_code=409, detail="原视频供应商配置不可用，无法安全查询远端任务；请恢复配置后重试") from exc
    if provider_id == "runninghub":
        if query_mode != "runninghub_openapi" or not is_runninghub_provider(provider):
            raise HTTPException(status_code=409, detail="原视频供应商配置已变化，无法安全查询远端任务；请恢复 RunningHub 配置后重试")
        observation, local_urls = await query_runninghub_video_task_once(provider, remote_id)
    elif query_mode == "jimeng_cli":
        if not is_jimeng_provider(provider):
            raise HTTPException(status_code=409, detail="原视频供应商配置已变化，无法安全查询即梦 CLI 任务；请恢复原供应商配置后重试")
        observation, local_urls = await query_jimeng_video_task_once(remote_id, "video")
    elif query_mode in {"http_get", "tudou_http_get", "agnes_http_get"}:
        if is_runninghub_provider(provider) or is_jimeng_provider(provider):
            raise HTTPException(status_code=409, detail="原视频供应商配置已变化，无法安全查询远端任务；请恢复原供应商配置后重试")
        if query_mode == "tudou_http_get" and not is_tudou_provider(provider):
            raise HTTPException(status_code=409, detail="原视频供应商配置已变化，无法安全查询土豆视频任务")
        if query_mode == "agnes_http_get" and not is_agnes_provider(provider, task.get("model")):
            raise HTTPException(status_code=409, detail="原视频供应商配置已变化，无法安全查询 Agnes 视频任务")
        observation, local_urls = await query_video_task_once(
            provider,
            remote_id,
            query_mode=query_mode,
            model=str(task.get("model") or ""),
        )
    else:
        raise HTTPException(status_code=409, detail="当前视频供应商暂不支持远端刷新；请保留原任务编号并稍后查询")
    return provider, observation, local_urls
