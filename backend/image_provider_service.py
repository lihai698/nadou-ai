"""图片供应商分发、原生协议和OpenAI兼容请求执行。

索引、文件、锁和供应商调用由应用显式注入，保留现有提交/清理顺序。
"""
import os
import time
import re
import asyncio
import urllib.parse

async def generate_modelscope_provider_image(prompt, size, model, reference_images=None, provider=None, *, AI_REQUEST_TIMEOUT, HTTPException, IMAGE_POLL_INTERVAL, ONLINE_IMAGE_REFERENCE_MAX, extract_image, httpx, log_net_error, modelscope_api_key, modelscope_image_api_root, modelscope_image_url, parse_size_pair, selected_model, upstream_error_summary, upstream_response_error_summary):
    clean_token = modelscope_api_key()
    if not clean_token:
        raise HTTPException(status_code=400, detail="未配置 ModelScope API Key，请在 API 设置中填写。")
    width, height = parse_size_pair(size)
    refs = []
    for ref in (reference_images or [])[:ONLINE_IMAGE_REFERENCE_MAX]:
        if not ref.get("url"):
            continue
        # 本地参考图转为 data URL；前端已生成的 data URL 保持原样，贴近旧版稳定链路。
        refs.append(modelscope_image_url(ref.get("url", ""), max_size=1536))
    headers = {
        "Authorization": f"Bearer {clean_token}",
        "Content-Type": "application/json",
        "X-ModelScope-Async-Mode": "true",
    }
    payload = {
        "model": selected_model(model, "Tongyi-MAI/Z-Image-Turbo"),
        "prompt": prompt.strip(),
    }
    if width and height:
        payload["width"] = width
        payload["height"] = height
        payload["size"] = f"{width}x{height}"
    if refs:
        payload["image_url"] = refs

    api_root = modelscope_image_api_root()
    async with httpx.AsyncClient(timeout=AI_REQUEST_TIMEOUT) as client:
        try:
            submit_res = await client.post(f"{api_root}/images/generations", headers=headers, json=payload)
        except httpx.HTTPError as exc:
            log_net_error("ModelScope 生图提交失败", exc)
            raise HTTPException(status_code=502, detail="ModelScope 提交失败，请检查网络后重试。") from exc
        if submit_res.status_code >= 400:
            raise HTTPException(
                status_code=submit_res.status_code,
                detail=f"ModelScope 提交失败：{upstream_response_error_summary(submit_res)}",
            )
        raw = submit_res.json()
        task_id = raw.get("task_id")
        if not task_id:
            try:
                return extract_image(raw), raw
            except HTTPException:
                raise HTTPException(
                    status_code=502,
                    detail=f"ModelScope 未返回任务标识或图片：{upstream_error_summary(raw, fallback='响应内容不完整')}",
                )

        deadline = time.monotonic() + AI_REQUEST_TIMEOUT
        while time.monotonic() < deadline:
            await asyncio.sleep(IMAGE_POLL_INTERVAL)
            try:
                result = await client.get(
                    f"{api_root}/tasks/{task_id}",
                    headers={**headers, "X-ModelScope-Task-Type": "image_generation"},
                )
            except httpx.HTTPError as exc:
                log_net_error("ModelScope 生图查询失败", exc)
                raise HTTPException(status_code=502, detail="ModelScope 查询失败，请检查网络后重试。") from exc
            if result.status_code >= 400:
                raise HTTPException(
                    status_code=result.status_code,
                    detail=f"ModelScope 查询失败：{upstream_response_error_summary(result)}",
                )
            data = result.json()
            status = str(data.get("task_status") or "").upper()
            if status == "SUCCEED":
                images = data.get("output_images") or []
                if not images:
                    raise HTTPException(status_code=502, detail="ModelScope 任务成功，但没有返回图片。")
                return {"type": "url", "value": images[0]}, data
            if status in {"FAILED", "FAIL", "ERROR", "CANCELED", "CANCELLED", "TIMEOUT", "REVOKED"}:
                raise HTTPException(
                    status_code=502,
                    detail=f"ModelScope 任务失败：{upstream_error_summary(data, fallback='请检查任务参数后重试')}",
                )
        raise HTTPException(status_code=504, detail="ModelScope 生图任务超时，请稍后重试。")


def gemini_model_name(model, *, selected_model):
    value = selected_model(model, "gemini-3-pro-image-preview").strip()
    return value[len("models/"):] if value.startswith("models/") else value


def gemini_endpoint_url(provider, model, *, gemini_model_name, is_apimart_provider, provider_endpoint_url):
    model_name = urllib.parse.quote(gemini_model_name(model), safe="")
    if is_apimart_provider(provider) and not str((provider or {}).get("image_generation_endpoint") or "").strip():
        return f"https://api.apimart.ai/v1beta/models/{model_name}:generateContent"
    return provider_endpoint_url(provider, "image_generation_endpoint", f"/v1beta/models/{model_name}:generateContent")


def gemini_image_config(size, *, apimart_size_resolution, parse_size_pair):
    width, height = parse_size_pair(size)
    if not width or not height:
        raw = str(size or "").strip().upper()
        if raw in {"1K", "2K", "4K"}:
            return {"aspectRatio": "1:1", "imageSize": raw}
        if re.fullmatch(r"\d+\s*:\s*\d+", raw):
            return {"aspectRatio": raw.replace(" ", ""), "imageSize": "1K"}
        return {"aspectRatio": "1:1", "imageSize": "2K"}
    aspect_ratio, resolution = apimart_size_resolution(size)
    return {"aspectRatio": aspect_ratio, "imageSize": resolution.upper()}


def gemini_reference_part(ref, *, reference_to_data_url):
    value = reference_to_data_url(ref, max_size=1536)
    if not value:
        return None
    if isinstance(value, str) and value.startswith("data:image/") and ";base64," in value:
        header, encoded = value.split(";base64,", 1)
        mime_type = header.replace("data:", "", 1) or "image/png"
        return {"inlineData": {"mimeType": mime_type, "data": encoded}}
    if isinstance(value, str) and value.startswith(("http://", "https://")):
        return {"fileData": {"mimeType": "image/png", "fileUri": value}}
    return None


async def generate_gemini_provider_image(prompt, size, model, reference_images=None, provider=None, *, ONLINE_IMAGE_REFERENCE_MAX, api_headers, extract_image, gemini_endpoint_url, gemini_image_config, gemini_model_name, gemini_reference_part, httpx, is_apimart_provider, unwrap_apimart_response):
    model_name = gemini_model_name(model)
    endpoint = gemini_endpoint_url(provider, model_name)
    parts = [{"text": prompt.strip()}]
    for ref in (reference_images or [])[:ONLINE_IMAGE_REFERENCE_MAX]:
        part = gemini_reference_part(ref)
        if part:
            parts.append(part)
    body = {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            "responseModalities": ["TEXT", "IMAGE"],
            "imageConfig": gemini_image_config(size),
        },
    }
    async with httpx.AsyncClient(timeout=httpx.Timeout(connect=20.0, read=1800.0, write=120.0, pool=20.0)) as client:
        response = await client.post(endpoint, headers=api_headers(provider=provider), json=body)
        response.raise_for_status()
        # APIMart wraps the native Gemini body in {code, data}; unwrap it before
        # image extraction so candidates[].content.parts[].inlineData is visible.
        raw = unwrap_apimart_response(response.json()) if is_apimart_provider(provider) else response.json()
        return extract_image(raw), raw


def volcengine_endpoint_url(provider, *, provider_endpoint_url):
    return provider_endpoint_url(provider, "image_generation_endpoint", "/api/v3/images/generations")


def volcengine_image_payload(ref, *, reference_to_data_url):
    value = reference_to_data_url(ref, max_size=1536)
    if not value:
        return None
    return value


async def generate_volcengine_provider_image(prompt, size, model, reference_images=None, provider=None, *, ONLINE_IMAGE_REFERENCE_MAX, api_headers, extract_image, httpx, normalize_volcengine_size, volcengine_endpoint_url, volcengine_image_payload):
    endpoint = volcengine_endpoint_url(provider)
    size = normalize_volcengine_size(size, model)
    body = {
        "model": model,
        "prompt": prompt,
        "size": size,
        "response_format": "url",
    }
    images = [volcengine_image_payload(ref) for ref in (reference_images or [])[:ONLINE_IMAGE_REFERENCE_MAX]]
    images = [value for value in images if value]
    if images:
        body["image"] = images
    async with httpx.AsyncClient(timeout=httpx.Timeout(connect=20.0, read=1800.0, write=120.0, pool=20.0)) as client:
        response = await client.post(endpoint, headers=api_headers(provider=provider), json=body)
        response.raise_for_status()
        raw = response.json()
        return extract_image(raw), raw


async def generate_ai_image(prompt, size, quality, model, reference_images=None, provider_id='comfly', aspect_ratio='', resolution='', on_remote_accept=None, *, ImageGenerationDispatchContext, effective_protocol, generate_codex_provider_image, generate_gemini_cli_provider_image, generate_gemini_provider_image, generate_jimeng_provider_image, generate_modelscope_provider_image, generate_runninghub_provider_image, generate_tudou_async_image, generate_tudou_grok_image, generate_volcengine_provider_image, get_api_provider, is_codex_provider, is_gemini_cli_provider, is_jimeng_provider, is_runninghub_provider, is_tudou_async_image_mode, is_tudou_grok_image_model, is_tudou_provider, is_volcengine_provider, resolve_image_generation_dispatch, tudou_image_model_for_request, generate_openai_image):
    provider = get_api_provider(provider_id)
    is_tudou = is_tudou_provider(provider)
    if is_tudou:
        model = tudou_image_model_for_request(model)
    dispatch = resolve_image_generation_dispatch(
        provider,
        model,
        ImageGenerationDispatchContext(
            is_codex=lambda: is_codex_provider(provider),
            is_gemini_cli=lambda: is_gemini_cli_provider(provider),
            is_jimeng=lambda: is_jimeng_provider(provider),
            is_runninghub=lambda: is_runninghub_provider(provider),
            is_gemini_protocol=lambda: effective_protocol(provider, model) == "gemini",
            is_volcengine=lambda: is_volcengine_provider(provider),
            is_tudou_async=lambda: is_tudou_async_image_mode(provider, model),
            is_tudou_grok=lambda: is_tudou and is_tudou_grok_image_model(model),
        ),
    )
    if dispatch.route == "modelscope":
        return await generate_modelscope_provider_image(prompt, size, model, reference_images, provider)
    if dispatch.route == "codex":
        return await generate_codex_provider_image(prompt, size, model, reference_images, provider)
    if dispatch.route == "gemini-cli":
        return await generate_gemini_cli_provider_image(prompt, size, model, reference_images, provider)
    if dispatch.route == "jimeng":
        return await generate_jimeng_provider_image(prompt, size, model, reference_images, provider)
    if dispatch.route == "runninghub":
        return await generate_runninghub_provider_image(prompt, size, model, reference_images, provider, on_remote_accept=on_remote_accept)
    if dispatch.route == "gemini":
        return await generate_gemini_provider_image(prompt, size, model, reference_images, provider)
    if dispatch.route == "volcengine":
        return await generate_volcengine_provider_image(prompt, size, model, reference_images, provider)
    if dispatch.route == "tudou-async":
        return await generate_tudou_async_image(prompt, size, quality, model, reference_images, provider, aspect_ratio, resolution, on_remote_accept=on_remote_accept)
    if dispatch.route == "tudou-grok":
        return await generate_tudou_grok_image(prompt, size, model, reference_images, provider, aspect_ratio)
    return await generate_openai_image(prompt, size, quality, model, reference_images, provider, on_remote_accept)


def image_task_url_for_provider(provider, task_id, *, AI_BASE_URL, is_tudou_async_image_mode, normalize_image_request_mode, is_apimart_provider):
    base_url = (provider.get("base_url") if provider else AI_BASE_URL).rstrip("/")
    if is_tudou_async_image_mode(provider):
        return f"{base_url}/tasks/{task_id}" if base_url.endswith("/v1") else f"{base_url}/v1/tasks/{task_id}"
    # 异步生图（openai-video-proxy）模式优先于 apimart 协议判断：
    # 提交走 /v1/videos，轮询必须走 /v1/videos/{id}；否则 protocol=apimart 的平台会错走 /v1/tasks/{id}
    if normalize_image_request_mode((provider or {}).get("image_request_mode")) == "openai-video-proxy":
        return f"{base_url}/videos/{task_id}" if base_url.endswith("/v1") else f"{base_url}/v1/videos/{task_id}"
    if is_apimart_provider(provider):
        return f"{base_url}/tasks/{task_id}" if base_url.endswith("/v1") else f"{base_url}/v1/tasks/{task_id}"
    return f"{base_url}/images/tasks/{task_id}" if base_url.endswith("/v1") else f"{base_url}/v1/images/tasks/{task_id}"


async def fetch_image_task_payload(client, task_id, provider=None, *, image_task_url_for_provider, httpx_request_with_transient_retries, api_headers):
    task_url = image_task_url_for_provider(provider, task_id)
    response = await httpx_request_with_transient_retries(
        client,
        "GET",
        task_url,
        attempts=3,
        headers=api_headers(provider=provider),
    )
    response.raise_for_status()
    return response.json()


async def wait_for_image_task(client, task_id, provider=None, *, is_apimart_provider, is_tudou_async_image_mode, TUDOU_ASYNC_IMAGE_TASK_TIMEOUT, APIMART_IMAGE_TASK_TIMEOUT, IMAGE_TASK_TIMEOUT, TUDOU_ASYNC_IMAGE_POLL_INTERVAL, APIMART_IMAGE_POLL_INTERVAL, IMAGE_POLL_INTERVAL, TUDOU_ASYNC_IMAGE_INITIAL_POLL_DELAY, APIMART_IMAGE_INITIAL_POLL_DELAY, time, asyncio, fetch_image_task_payload, image_task_status, extract_image, HTTPException, IMAGE_TASK_SUCCESS_STATUSES, IMAGE_TASK_FAILED_STATUSES, image_task_fail_reason, provider_error_summary, _safe_upstream_text):
    is_apimart = is_apimart_provider(provider)
    is_tudou_async = is_tudou_async_image_mode(provider)
    timeout = TUDOU_ASYNC_IMAGE_TASK_TIMEOUT if is_tudou_async else APIMART_IMAGE_TASK_TIMEOUT if is_apimart else IMAGE_TASK_TIMEOUT
    interval = TUDOU_ASYNC_IMAGE_POLL_INTERVAL if is_tudou_async else APIMART_IMAGE_POLL_INTERVAL if is_apimart else IMAGE_POLL_INTERVAL
    initial_delay = TUDOU_ASYNC_IMAGE_INITIAL_POLL_DELAY if is_tudou_async else APIMART_IMAGE_INITIAL_POLL_DELAY if is_apimart else 0
    deadline = time.monotonic() + timeout
    last_payload = {}
    while time.monotonic() < deadline:
        if initial_delay:
            await asyncio.sleep(min(initial_delay, max(0.0, deadline - time.monotonic())))
            initial_delay = 0
            if time.monotonic() >= deadline:
                break
        last_payload = await fetch_image_task_payload(client, task_id, provider)
        status = image_task_status(last_payload)
        if not status:
            try:
                if extract_image(last_payload):
                    return last_payload
            except HTTPException:
                pass
        if status in IMAGE_TASK_SUCCESS_STATUSES:
            return last_payload
        if status in IMAGE_TASK_FAILED_STATUSES:
            raise HTTPException(status_code=502, detail=f"生图任务失败：{image_task_fail_reason(last_payload)}")
        await asyncio.sleep(min(interval, max(0.0, deadline - time.monotonic())))
    summary = provider_error_summary(last_payload)
    extra = f"，最后状态：{summary}" if summary else ""
    raise HTTPException(status_code=504, detail=f"生图任务超时（已等待 {int(timeout)} 秒），task_id={_safe_upstream_text(task_id, 120)}{extra}")
