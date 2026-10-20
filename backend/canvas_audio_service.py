"""音频任务接入、执行、生成/识别结果处理及落盘恢复。

复用canvas_audio纯规则与共享任务记录，目录、认证、媒体访问和输出路径由应用注入。
不导入main或FastAPI，不读取私有配置，不改变原音频供应商协议。
"""
import asyncio
import hashlib
import json
import mimetypes
import os
import time
import httpx

from backend.canvas_audio import (AudioConfigError, AudioResultError, build_audio_request,
                                 build_audio_recognition_request, validate_recognition_references,
                                 validate_audio_bytes, audio_text_result)
from backend.task_records import (TaskRecordError, task_records_lock,
                                 _read_task_record_unlocked, _write_task_record_unlocked)
from backend.task_states import task_state_update


class AudioServiceError(Exception):
    """应用将其转换为原HTTP状态和detail。"""
    def __init__(self, status_code, detail):
        super().__init__(str(detail))
        self.status_code = status_code
        self.detail = detail


async def build_result(payload, *, get_provider, media_factory, headers_for,
                       upstream_http_detail, public_error, output_path, output_url):
    provider = get_provider(payload.provider_id)
    if payload.operation == 'recognition':
        endpoint, fields = build_audio_recognition_request(provider, payload.model, payload.settings)
        validate_recognition_references(payload.references)
        media = media_factory()
        # 沿用本项目本地目录边界及公网下载防护，不接收任意本机路径。
        path = await asyncio.to_thread(media.resolve, {'source_url': payload.references[0]['url']})
        if path.stat().st_size > 100 * 1024 * 1024:
            raise AudioConfigError('音频文件超过 100MB 上限')
        name = str(payload.references[0].get('name') or path.name)
        mime = mimetypes.guess_type(name)[0] or 'application/octet-stream'
        headers = headers_for(provider=provider, model=payload.model)
        headers.pop('Content-Type', None)
        headers.pop('Accept', None)
        async with httpx.AsyncClient(timeout=httpx.Timeout(1800, connect=20), follow_redirects=False) as client:
            with path.open('rb') as stream:
                response = await client.post(endpoint, headers=headers, data=fields, files={'file': (name, stream, mime)})
            if response.status_code >= 400:
                raise AudioServiceError(502, upstream_http_detail(response))
            try:
                result = audio_text_result(response.json())
            except ValueError as exc:
                raise AudioResultError('音频识别未返回有效文字，请检查模型和转写协议') from exc
        return {**result, 'model': payload.model, 'provider_id': payload.provider_id}
    endpoint, body = build_audio_request(provider, payload.model, payload.prompt, payload.settings, payload.references)
    headers = headers_for(provider=provider, model=payload.model)
    # 音频生成的协议独立于平台的图片/对话协议，认证使用同一平台 Key。
    headers.pop("Accept", None)
    async with httpx.AsyncClient(timeout=httpx.Timeout(180, connect=20), follow_redirects=False) as client:
        async with client.stream("POST", endpoint, json=body, headers=headers) as response:
            chunks, size = [], 0
            async for chunk in response.aiter_bytes():
                size += len(chunk)
                if size > 100 * 1024 * 1024:
                    raise AudioResultError("音频响应超过 100MB 上限")
                chunks.append(chunk)
            content = b"".join(chunks)
            if response.status_code >= 400:
                detail = public_error(content[:20000].decode("utf-8", "replace"), fallback="音频供应商请求失败")
                raise AudioServiceError(status_code=502, detail=f"音频平台返回 {response.status_code}：{detail}")
            if "json" in response.headers.get("content-type", ""):
                try:
                    raw = json.loads(content)
                    base_resp = raw.get("base_resp") or {}
                    if base_resp.get("status_code", 0) != 0:
                        raise AudioResultError("音频平台返回业务错误：" + public_error(base_resp.get("status_msg"), fallback="请检查模型配置"))
                    encoded = (raw.get("data") or {}).get("audio")
                    if not isinstance(encoded, str) or not encoded:
                        raise AudioResultError("音频任务完成但没有返回真实音频")
                    content = bytes.fromhex(encoded)
                except (ValueError, TypeError, AttributeError) as exc:
                    raise AudioResultError("音频平台响应格式与所选协议不匹配") from exc
    fmt = str(body.get("response_format") or (body.get("audio_setting") or {}).get("format") or "mp3")
    validate_audio_bytes(content, fmt)
    filename = f"audio_{payload.client_task_id.removeprefix('canvas_audio_')}.{fmt}"
    path = output_path(filename, "output")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    # 文件落盘后才暴露播放地址；崩溃时不会生成半个可播放结果。
    temp_path = path + ".part"
    try:
        with open(temp_path, "wb") as stream:
            stream.write(content)
        os.replace(temp_path, path)
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)
    item = {"url": output_url(filename, "output"), "name": filename, "kind": "audio",
            "mime": "audio/mpeg" if fmt == "mp3" else f"audio/{'ogg' if fmt == 'opus' else fmt}", "sizeBytes": len(content)}
    return {"audios": [item], "items": [item], "model": payload.model, "provider_id": payload.provider_id}


async def run_task(task_id, payload, *, gate, task_lock, load_task, mark_start_failed,
                   write_record, generate, public_error):
    async with gate:
        with task_lock:
            task = load_task(task_id)
            if not task or task.get("status") != "queued":
                return
            task.update(task_state_update(task, "running", time.time()))
            try:
                write_record(task, required=True)
            except TaskRecordError:
                mark_start_failed(task, task_id)
                return
        try:
            result = await generate(payload)
        except Exception as exc:
            uncertain = isinstance(exc, (httpx.TransportError, httpx.TimeoutException))
            detail = "供应商响应中断，提交状态未知；请核对平台记录，勿重复生成" if uncertain else public_error(getattr(exc, "detail", None) or exc, fallback="音频生成失败")
            with task_lock:
                task.update(task_state_update(task, "unknown" if uncertain else "failed", time.time(), error=detail))
                try:
                    write_record(task, required=True)
                except TaskRecordError:
                    task['_audioResultSavePending'] = True
            return
        with task_lock:
            task.update(task_state_update(task, "succeeded", time.time(), result=result))
            try:
                write_record(task, required=True)
            except TaskRecordError:
                task['_audioResultSavePending'] = True


async def create_task(payload, *, tasks, task_lock, root, process_id, get_provider,
                      headers_for, snapshot, worker, spawn, trace_factory,
                      trace_id="", request_id=""):
    task_id = payload.client_task_id
    digest = hashlib.sha256(json.dumps(payload.model_dump(), ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    with task_lock, task_records_lock(root):
        try:
            previous = tasks.get(task_id) or _read_task_record_unlocked(root, task_id)
        except TaskRecordError as exc:
            raise AudioServiceError(500, "音频任务记录无法读取，已停止重复提交") from exc
        if previous:
            if previous.get("type") != "audio-generation" or (previous.get("input_summary") or {}).get("request_hash") != digest:
                raise AudioServiceError(409, "同一任务编号的音频参数不一致，请先查询原任务")
            return {"task_id": task_id, "status": previous.get("status", "unknown")}
        provider = get_provider(payload.provider_id)
        if provider.get("enabled") is False:
            raise AudioServiceError(400, "音频平台已禁用")
        try:
            if payload.operation == 'recognition':
                build_audio_recognition_request(provider, payload.model, payload.settings)
                validate_recognition_references(payload.references)
            else:
                build_audio_request(provider, payload.model, payload.prompt, payload.settings, payload.references)
        except AudioConfigError as exc:
            raise AudioServiceError(400, str(exc)) from exc
        headers_for(provider=provider, model=payload.model)
        trace = trace_factory(task_id, trace_id=trace_id, request_id=request_id)
        task = {"id": task_id, "type": "audio-generation", "status": "queued", "created_at": time.time(),
                "updated_at": time.time(), "result": None, "error": "", "provider_id": payload.provider_id,
                "model": payload.model, "operation": payload.operation, "process_id": process_id,
                "input_summary": {"prompt_length": len(payload.prompt), "request_hash": digest, "reference_audio_count": len(payload.references)}, **trace}
        try:
            _write_task_record_unlocked(root, snapshot(task))
        except (OSError, TaskRecordError) as exc:
            raise AudioServiceError(503, "音频任务记录无法保存，本次未提交") from exc
        tasks[task_id] = task
    spawn(worker(task_id, payload))
    return {"task_id": task_id, "status": "queued"}


def get_task(task_id, *, tasks, task_lock, read_record, write_record,
             public_record, interrupted_record):
    with task_lock:
        task = dict(tasks.get(task_id) or read_record(task_id) or {})
        if task.get('_audioResultSavePending'):
            try:
                write_record(task, required=True)
            except TaskRecordError as exc:
                raise AudioServiceError(503, '音频任务结果尚未保存，请勿重复提交；恢复磁盘后查询原任务') from exc
            task.pop('_audioResultSavePending', None)
            tasks[task_id].pop('_audioResultSavePending', None)
    if not task or task.get("type") != "audio-generation":
        raise AudioServiceError(404, "音频任务记录不存在；请勿直接重复提交")
    return public_record(interrupted_record(task))
