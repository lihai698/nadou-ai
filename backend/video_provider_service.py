"""视频提交总入口、轮询与已有任务单次查询。

索引、文件、锁和供应商调用由应用显式注入，保留现有提交/清理顺序。
"""
import time
import re
import asyncio
import urllib.parse

def video_submit_url_candidates(provider, base_url, *, is_agnes_provider, is_apimart_provider, is_lingjing_provider, is_volcengine_provider, is_yuli_provider):
    if is_agnes_provider(provider):
        return [f"{base_url}/v1/videos"]
    if is_lingjing_provider(provider):
        return [f"{base_url}/v1/videos"]
    if is_apimart_provider(provider):
        return [f"{base_url}/videos/generations" if base_url.endswith("/v1") else f"{base_url}/v1/videos/generations"]
    if is_volcengine_provider(provider):
        parsed = urllib.parse.urlparse(base_url)
        if parsed.path and parsed.path.rstrip("/"):
            return [base_url]
        return [f"{base_url}/api/v3/contents/generations/tasks"]
    if is_yuli_provider(provider):
        return [f"{base_url}/v1/video/create"]
    return [f"{base_url}/v1/videos/generations", f"{base_url}/v2/videos/generations"]


def video_task_url_candidates(provider, base_url, task_id, submit_url='', *, is_agnes_provider, is_apimart_provider, is_lingjing_provider, is_tudou_provider, is_volcengine_provider, is_yuli_provider):
    if is_tudou_provider(provider):
        quoted_id = urllib.parse.quote(str(task_id), safe="")
        return [f"{base_url}/v1/videos/{quoted_id}"]
    if is_agnes_provider(provider):
        quoted_id = urllib.parse.quote(str(task_id), safe="")
        return [
            f"{base_url}/agnesapi?{urllib.parse.urlencode({'video_id': task_id})}",
            f"{base_url}/v1/videos/{quoted_id}",
        ]
    if is_lingjing_provider(provider):
        quoted_id = urllib.parse.quote(str(task_id), safe="")
        return [
            f"{base_url}/v1/videos/{quoted_id}",
            f"{base_url}/v1/video/query?{urllib.parse.urlencode({'id': task_id})}",
        ]
    if is_apimart_provider(provider):
        task_path = f"{base_url}/tasks/{task_id}" if base_url.endswith("/v1") else f"{base_url}/v1/tasks/{task_id}"
        return [f"{task_path}?language=zh"]
    if is_volcengine_provider(provider):
        parsed = urllib.parse.urlparse(base_url)
        if parsed.path and parsed.path.rstrip("/"):
            return [f"{base_url}/{task_id}"]
        return [f"{base_url}/api/v3/contents/generations/tasks/{task_id}"]
    if is_yuli_provider(provider):
        # 玉玉API 两种视频格式：OpenAI（/v1/videos/{id}）与原生（/v1/video/query?id=）。
        # 两个都试，谁返回成功就用谁，兼容 veo OpenAI 路径与 doubao 原生路径。
        return [f"{base_url}/v1/videos/{task_id}", f"{base_url}/v1/video/query?id={task_id}"]
    v1_task = f"{base_url}/v1/videos/generations/{task_id}"
    v1_generic_task = f"{base_url}/v1/tasks/{task_id}"
    v2_task = f"{base_url}/v2/videos/generations/{task_id}"
    if "/v2/videos/generations" in str(submit_url or ""):
        return [v2_task, v1_task, v1_generic_task]
    return [v1_task, v1_generic_task, v2_task]


async def wait_for_video_task(client, provider, task_id, submit_url='', *, HTTPException, IMAGE_POLL_INTERVAL, VIDEO_POLL_TIMEOUT, VIDEO_TASK_FAILURE_STATUSES, VIDEO_TASK_SUCCESS_STATUSES, _notify_canvas_video_remote_accept, api_headers, humanize_video_task_failure, upstream_error_summary, video_api_root, video_output_urls, video_task_url_candidates):
    base_url = video_api_root(provider)
    if not base_url:
        raise HTTPException(status_code=400, detail=f"{provider.get('name') or provider['id']} 未配置 Base URL")
    task_urls = video_task_url_candidates(provider, base_url, task_id, submit_url)
    await _notify_canvas_video_remote_accept(task_id, query_mode="http_get")
    deadline = time.monotonic() + VIDEO_POLL_TIMEOUT
    delay = max(2.0, IMAGE_POLL_INTERVAL)
    last_payload = {}
    while time.monotonic() < deadline:
        await asyncio.sleep(delay)
        raw = None
        last_error = None
        for task_url in task_urls:
            try:
                response = await client.get(task_url, headers=api_headers(provider=provider))
                response.raise_for_status()
                raw = response.json()
                break
            except Exception as exc:
                last_error = exc
                continue
        if raw is None:
            if last_error:
                raise last_error
            raise HTTPException(status_code=502, detail="视频任务查询失败")
        last_payload = raw
        task_data = (
            raw.get("data") if isinstance(raw.get("data"), dict)
            else raw.get("detail") if isinstance(raw.get("detail"), dict)
            else raw
        )
        status = str(task_data.get("status") or task_data.get("task_status") or raw.get("status") or raw.get("task_status") or "").upper()
        if status in VIDEO_TASK_SUCCESS_STATUSES:
            return raw
        # 部分上游（如玉玉API）status 字段非标准或为空，但已经返回了视频 URL ——
        # 只要不是明确的失败状态，且拿到了真实视频地址，就直接当成功处理。
        if status not in VIDEO_TASK_FAILURE_STATUSES and video_output_urls(raw):
            return raw
        if status in VIDEO_TASK_FAILURE_STATUSES:
            reason = upstream_error_summary(raw, fallback="上游未提供失败原因")
            raise HTTPException(status_code=502, detail=humanize_video_task_failure(reason))
        delay = min(delay * 1.6, 12)
    raise HTTPException(status_code=504, detail="视频生成任务超时")


async def query_video_task_once(provider, remote_task_id, *, query_mode: str='http_get', model: str='', HTTPException, TUDOU_VIDEO_FAILED_STATUSES, TUDOU_VIDEO_SUCCESS_STATUSES, VIDEO_TASK_FAILURE_STATUSES, VIDEO_TASK_SUCCESS_STATUSES, api_headers, httpx, observe_remote_task, save_remote_video_to_output, tudou_video_result_urls, upstream_error_summary, video_api_root, video_output_urls, video_task_url_candidates, write_diagnostic):
    """对已有视频编号执行一次 GET 查询，不提交新任务，也不长轮询。"""

    remote_id = str(remote_task_id or "").strip()
    if (
        not remote_id
        or len(remote_id) > 240
        or any(ord(char) < 0x20 for char in remote_id)
        or any(char in remote_id for char in "?#")
    ):
        raise HTTPException(status_code=400, detail="远端视频任务编号无效")
    mode = str(query_mode or "").strip().lower()
    base_url = video_api_root(provider)
    if not base_url:
        return observe_remote_task(operation="query", transport_error=True), []
    if mode == "http_get":
        query_urls = video_task_url_candidates(provider, base_url, remote_id)
        output_values = video_output_urls
    elif mode == "tudou_http_get":
        query_urls = [
            f"{base_url}/v1/tasks/{urllib.parse.quote(remote_id, safe='')}"
        ]
        output_values = tudou_video_result_urls
    elif mode == "agnes_http_get":
        model_name = str(model or "").strip()[:160]
        query_params = {"video_id": remote_id}
        if model_name:
            query_params["model_name"] = model_name
        query_urls = [
            f"{base_url}/agnesapi?{urllib.parse.urlencode(query_params)}",
            f"{base_url}/v1/videos/{urllib.parse.quote(remote_id, safe='')}",
        ]
        output_values = video_output_urls
    else:
        return observe_remote_task(operation="query"), []
    if not query_urls:
        return observe_remote_task(operation="query"), []

    raw = None
    last_http_status = None
    had_transport_error = False
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(connect=15.0, read=45.0, write=30.0, pool=15.0)
        ) as client:
            for query_url in query_urls:
                try:
                    response = await client.get(
                        query_url,
                        headers=api_headers(provider=provider, model=model or None),
                    )
                    last_http_status = response.status_code
                    if response.status_code >= 400:
                        continue
                    raw = response.json()
                    break
                except httpx.HTTPError:
                    had_transport_error = True
                except (ValueError, TypeError):
                    had_transport_error = True
    except (httpx.HTTPError, ValueError, TypeError):
        had_transport_error = True

    if not isinstance(raw, dict):
        if last_http_status is not None and not had_transport_error:
            return observe_remote_task(operation="query", http_status=last_http_status), []
        return observe_remote_task(operation="query", transport_error=True), []

    outputs = []
    try:
        outputs = [
            str(value).strip()
            for value in (output_values(raw) or [])
            if str(value or "").strip()
        ][:16]
    except (TypeError, ValueError):
        outputs = []
    data = raw.get("data") if isinstance(raw.get("data"), dict) else raw
    status = str(
        (data or {}).get("status")
        or (data or {}).get("task_status")
        or (data or {}).get("state")
        or raw.get("status")
        or raw.get("task_status")
        or ""
    ).strip().upper()
    if mode == "tudou_http_get":
        failure_statuses = TUDOU_VIDEO_FAILED_STATUSES
        success_statuses = TUDOU_VIDEO_SUCCESS_STATUSES
    else:
        failure_statuses = VIDEO_TASK_FAILURE_STATUSES
        success_statuses = VIDEO_TASK_SUCCESS_STATUSES
    if status in failure_statuses:
        return (
            observe_remote_task(
                {
                    "status": "FAILED",
                    "task_id": remote_id,
                    "error": upstream_error_summary(raw, fallback="上游视频任务失败"),
                },
                operation="query",
                http_status=last_http_status,
            ),
            [],
        )
    if status in success_statuses or outputs:
        if not outputs:
            return observe_remote_task(
                {"status": "UNKNOWN", "task_id": remote_id},
                operation="query",
            ), []
        local_urls = []
        try:
            for value in outputs:
                local = await save_remote_video_to_output(value, prefix="canvas_video_refresh_")
                if not str(local or "").startswith(("/output/", "/assets/")):
                    return observe_remote_task(
                        {
                            "status": "UNKNOWN",
                            "task_id": remote_id,
                            "error": "视频输出下载失败",
                        },
                        operation="query",
                        transport_error=True,
                    ), []
                local_urls.append(str(local))
        except (HTTPException, OSError, httpx.HTTPError, ValueError, TypeError):
            write_diagnostic(
                f"video task output download failed mode={mode} error=download"
            )
            return observe_remote_task(
                {
                    "status": "UNKNOWN",
                    "task_id": remote_id,
                    "error": "视频输出下载失败",
                },
                operation="query",
                transport_error=True,
            ), []
        return (
            observe_remote_task(
                {"status": "COMPLETED", "task_id": remote_id, "videos": local_urls},
                operation="query",
                http_status=last_http_status,
            ),
            local_urls,
        )
    normalized = (
        "RUNNING"
        if status in {"RUNNING", "PROCESSING", "IN_PROGRESS", "GENERATING", "EXECUTING"}
        else "PENDING"
        if status in {"PENDING", "QUEUED", "WAITING", "ACCEPTED", "SUBMITTED", "IN_QUEUE"}
        else "UNKNOWN"
    )
    return (
        observe_remote_task(
            {"status": normalized, "task_id": remote_id},
            operation="query",
            http_status=last_http_status,
        ),
        [],
    )


async def canvas_video(payload, *, CANVAS_VIDEO_REMOTE_ACCEPT_CALLBACK, HTTPException, VIDEO_POLL_TIMEOUT, friendly_image_error_detail, generate_agnes_video, generate_jimeng_video, generate_lingjing_openai_video, generate_runninghub_video, generate_tudou_grok_video, generate_tudou_video, generate_yuli_openai_video, get_api_provider, httpx, is_agnes_provider, is_jimeng_provider, is_lingjing_provider, is_runninghub_provider, is_tudou_grok_video_model, is_tudou_provider, is_tudou_video_model, is_yuli_provider, log_net_error, model_list_from_values, provider_env_key_value, public_video_generation_result, safe_upstream_http_detail, safe_upstream_transport_detail, selected_model, video_api_root, video_submit_url_candidates, write_diagnostic, yuli_is_veo_openai_model, generate_http_video):
    provider = get_api_provider(payload.provider_id)
    if is_jimeng_provider(provider):
        return public_video_generation_result(await generate_jimeng_video(payload, provider))
    if is_runninghub_provider(provider):
        try:
            return public_video_generation_result(
                await generate_runninghub_video(
                    payload,
                    provider,
                    on_remote_accept=CANVAS_VIDEO_REMOTE_ACCEPT_CALLBACK.get(),
                )
            )
        except HTTPException as exc:
            write_diagnostic(f"RunningHub video generation failed status={exc.status_code}")
            raise
        except httpx.HTTPStatusError as exc:
            raise HTTPException(status_code=exc.response.status_code, detail=safe_upstream_http_detail(exc.response, "RunningHub 视频接口错误")) from exc
        except httpx.HTTPError as exc:
            log_net_error(f"视频(RunningHub) 网络/TLS错误 model={payload.model}", exc)
            raise HTTPException(status_code=502, detail=safe_upstream_transport_detail(exc, "请求 RunningHub 视频接口失败")) from exc
    base_url = video_api_root(provider)
    if not base_url:
        raise HTTPException(status_code=400, detail=f"{provider.get('name') or provider['id']} 未配置 Base URL")
    api_key = provider_env_key_value(provider["id"])
    if not api_key:
        raise HTTPException(status_code=400, detail=f"未配置 {provider.get('name') or provider['id']} 的 API Key，请在 API 设置中填写。")
    is_yuli = is_yuli_provider(provider)
    is_lingjing = is_lingjing_provider(provider)
    is_agnes = is_agnes_provider(provider, payload.model)
    video_submit_url_candidates(provider, base_url)[0]
    configured_video_models = model_list_from_values(provider.get("video_models") or [])
    if is_agnes and not payload.model and not configured_video_models:
        raise HTTPException(status_code=400, detail="Agnes AI 未配置视频模型，请在 API 设置中填写 video_models。")
    fallback_model = configured_video_models[0] if is_agnes and configured_video_models else "veo3-fast"
    requested_model = selected_model(payload.model, fallback_model)
    if is_tudou_provider(provider) and is_tudou_video_model(requested_model):
        try:
            async with httpx.AsyncClient(timeout=VIDEO_POLL_TIMEOUT) as tudou_client:
                if is_tudou_grok_video_model(requested_model):
                    return public_video_generation_result(await generate_tudou_grok_video(tudou_client, payload, provider, base_url, requested_model))
                return public_video_generation_result(await generate_tudou_video(tudou_client, payload, provider, base_url, requested_model))
        except httpx.HTTPStatusError as exc:
            text = exc.response.text
            friendly = friendly_image_error_detail(text, model=requested_model)
            raise HTTPException(status_code=exc.response.status_code, detail=safe_upstream_http_detail(exc.response, "土豆视频接口错误", friendly)) from exc
        except httpx.HTTPError as exc:
            log_net_error(f"视频(土豆) 网络/TLS错误 model={requested_model}", exc)
            raise HTTPException(status_code=502, detail=safe_upstream_transport_detail(exc, "请求土豆视频接口失败")) from exc
    if is_agnes:
        try:
            async with httpx.AsyncClient(timeout=VIDEO_POLL_TIMEOUT) as agnes_client:
                return public_video_generation_result(await generate_agnes_video(agnes_client, payload, provider, base_url, requested_model))
        except httpx.HTTPStatusError as exc:
            raise HTTPException(status_code=exc.response.status_code, detail=safe_upstream_http_detail(exc.response, "Agnes 视频接口错误")) from exc
        except httpx.HTTPError as exc:
            log_net_error(f"视频(Agnes) 网络/TLS错误 model={requested_model}", exc)
            raise HTTPException(status_code=502, detail=safe_upstream_transport_detail(exc, "请求 Agnes 视频接口失败")) from exc
    if is_lingjing:
        try:
            async with httpx.AsyncClient(timeout=VIDEO_POLL_TIMEOUT) as lingjing_client:
                return public_video_generation_result(await generate_lingjing_openai_video(lingjing_client, payload, provider, base_url, requested_model))
        except httpx.HTTPStatusError as exc:
            raise HTTPException(status_code=exc.response.status_code, detail=safe_upstream_http_detail(exc.response, "灵境 API 视频接口错误")) from exc
        except httpx.HTTPError as exc:
            log_net_error(f"视频(灵境) 网络/TLS错误 model={requested_model}", exc)
            raise HTTPException(status_code=502, detail=safe_upstream_transport_detail(exc, "请求灵境 API 视频接口失败")) from exc
    # 玉玉API veo3.1 走 OpenAI multipart 格式（支持 seconds 时长）；其余模型（doubao 等）
    # 沿用下方原生 /v1/video/create JSON 流程。
    if is_yuli and yuli_is_veo_openai_model(requested_model):
        try:
            async with httpx.AsyncClient(timeout=VIDEO_POLL_TIMEOUT) as yuli_client:
                return public_video_generation_result(await generate_yuli_openai_video(yuli_client, payload, provider, base_url, requested_model))
        except httpx.HTTPStatusError as exc:
            raise HTTPException(status_code=exc.response.status_code, detail=safe_upstream_http_detail(exc.response, "上游视频接口错误")) from exc
        except httpx.HTTPError as exc:
            log_net_error(f"视频(玉玉) 网络/TLS错误 model={requested_model}", exc)
            raise HTTPException(status_code=502, detail=safe_upstream_transport_detail(exc, "请求上游视频接口失败")) from exc
    return await generate_http_video(payload, provider, base_url, requested_model)



async def query_runninghub_video_task_once(provider, remote_task_id, *, HTTPException, httpx, observe_remote_task, runninghub_extract_outputs, runninghub_fail_reason, runninghub_json_headers, runninghub_openapi_url, runninghub_query_status, runninghub_store_remote_output, video_output_urls, write_diagnostic):
    """单次查询 RunningHub 视频任务，不提交新任务，也不长时间等待。"""

    remote_id = str(remote_task_id or "").strip()
    if not remote_id or len(remote_id) > 240 or any(ord(char) < 0x20 for char in remote_id) or any(char in remote_id for char in "?#"):
        raise HTTPException(status_code=400, detail="远端视频任务编号无效")
    query_url = runninghub_openapi_url(provider, "query")
    try:
        headers = runninghub_json_headers(provider)
    except HTTPException:
        raise
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(connect=15.0, read=45.0, write=30.0, pool=15.0)) as client:
            response = await client.post(query_url, headers=headers, json={"taskId": remote_id})
            status_code = response.status_code
            response.raise_for_status()
            raw = response.json()
            status = runninghub_query_status(raw).strip().upper()
            outputs = video_output_urls(raw)
            if not outputs:
                outputs = [
                    value
                    for value in runninghub_extract_outputs(raw.get("data") if isinstance(raw, dict) else raw)
                    if str(value or "").startswith(("http://", "https://", "/output/", "/assets/"))
                ]
            if status in {"4", "FAILED", "FAIL", "FAILURE", "ERROR", "ERRORED", "CANCELED", "CANCELLED", "TIMEOUT", "REJECTED", "EXPIRED"}:
                return (
                    observe_remote_task(
                        {
                            "status": "FAILED",
                            "task_id": remote_id,
                            "error": runninghub_fail_reason(raw) or "RunningHub 任务失败",
                        },
                        operation="query",
                        http_status=status_code,
                    ),
                    [],
                )
            if status in {"3", "SUCCESS", "SUCCEEDED", "COMPLETED", "COMPLETE", "FINISHED", "DONE", "OK"} or outputs:
                if not outputs:
                    return (
                        observe_remote_task(
                            {"status": "UNKNOWN", "task_id": remote_id},
                            operation="query",
                        ),
                        [],
                    )
                local_urls = []
                try:
                    for remote in outputs[:16]:
                        local = await runninghub_store_remote_output(client, remote)
                        if not str(local or "").startswith(("/output/", "/assets/")):
                            return (
                                observe_remote_task(
                                    {
                                        "status": "UNKNOWN",
                                        "task_id": remote_id,
                                        "error": "RunningHub 视频输出下载失败",
                                    },
                                    operation="query",
                                    transport_error=True,
                                ),
                                [],
                            )
                        local_urls.append(str(local))
                except (HTTPException, OSError, httpx.HTTPError, ValueError, TypeError) as exc:
                    write_diagnostic(
                        f"runninghub video output download failed error={type(exc).__name__}"
                    )
                    return (
                        observe_remote_task(
                            {
                                "status": "UNKNOWN",
                                "task_id": remote_id,
                                "error": "RunningHub 视频输出下载失败",
                            },
                            operation="query",
                            transport_error=True,
                        ),
                        [],
                    )
                return (
                    observe_remote_task(
                        {"status": "COMPLETED", "task_id": remote_id, "videos": local_urls},
                        operation="query",
                        http_status=status_code,
                    ),
                    local_urls,
                )
            normalized = "RUNNING" if status in {"804", "RUNNING", "PROCESSING", "IN_PROGRESS", "EXECUTING"} else "PENDING" if status in {"813", "PENDING", "QUEUED", "WAITING", "ACCEPTED", "SUBMITTED"} else "UNKNOWN"
            return (
                observe_remote_task(
                    {"status": normalized, "task_id": remote_id},
                    operation="query",
                    http_status=status_code,
                ),
                [],
            )
    except httpx.HTTPStatusError as exc:
        return (
            observe_remote_task(
                operation="query", http_status=exc.response.status_code
            ),
            [],
        )
    except (httpx.HTTPError, ValueError, TypeError):
        return (
            observe_remote_task(operation="query", transport_error=True),
            [],
        )


def video_api_root(provider, *, AI_BASE_URL, is_volcengine_provider):
    base_url = (provider.get("base_url") or AI_BASE_URL).rstrip("/")
    if is_volcengine_provider(provider):
        if base_url.endswith("/api/v3"):
            base_url = base_url[: -len("/api/v3")]
        return base_url
    if base_url.endswith("/v1") or base_url.endswith("/v2"):
        base_url = base_url.rsplit("/", 1)[0]
    return base_url
