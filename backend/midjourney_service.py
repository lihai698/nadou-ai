"""Midjourney提交、动作、遮罩和任务结果协议。

索引、文件、锁和供应商调用由应用显式注入，保留现有提交/清理顺序。
"""
import re
import base64
import urllib.parse

def apimart_midjourney_provider(provider_id, *, HTTPException, api_headers, get_api_provider_exact, is_apimart_provider):
    provider = get_api_provider_exact(provider_id)
    if not is_apimart_provider(provider):
        raise HTTPException(status_code=400, detail="Midjourney 节点仅支持已配置为 APIMart 协议的平台。")
    # This also validates the configured key, while all MJ requests below keep
    # using APIMart's official host instead of inheriting a custom image URL.
    api_headers(provider=provider)
    return provider


def midjourney_response_data(raw):
    if not isinstance(raw, dict):
        return {}
    data = raw.get("data")
    if isinstance(data, dict):
        return data
    if isinstance(data, list):
        return next((item for item in data if isinstance(item, dict)), raw)
    return raw


def midjourney_task_id(raw, *, midjourney_response_data):
    data = midjourney_response_data(raw)
    for key in ("task_id", "taskId", "id"):
        value = str(data.get(key) or "").strip()
        if value:
            return value
    return ""


def midjourney_task_status(raw, *, midjourney_response_data):
    data = midjourney_response_data(raw)
    return str(data.get("status") or data.get("task_status") or "").strip().upper()


def midjourney_error_detail(raw, fallback='Midjourney 请求失败', *, provider_error_summary):
    return provider_error_summary(raw, fallback=fallback)


def midjourney_remote_images(raw, *, midjourney_response_data):
    data = midjourney_response_data(raw)
    values = data.get("image_urls") or data.get("imageUrls") or []
    if isinstance(values, str):
        values = [values]
    if not isinstance(values, list):
        values = []
    urls = [str(value or "").strip() for value in values if str(value or "").strip()]
    if not urls:
        result = data.get("result") if isinstance(data.get("result"), dict) else {}
        result_images = result.get("images") if isinstance(result.get("images"), list) else []
        for item in result_images:
            value = str((item or {}).get("url") if isinstance(item, dict) else item or "").strip()
            if value:
                urls.append(value)
    if not urls:
        for key in ("image_url", "imageUrl", "grid_image_url", "gridImageUrl"):
            value = str(data.get(key) or "").strip()
            if value:
                urls.append(value)
    return list(dict.fromkeys(urls))


async def midjourney_reference_urls(reference_images, *, reference_to_data_url):
    urls = []
    for ref in (reference_images or [])[:4]:
        value = str((ref or {}).get("url") or "").strip()
        if value.startswith(("http://", "https://", "data:image/")):
            urls.append(value)
            continue
        data_url = reference_to_data_url(ref, max_size=1536)
        if data_url.startswith("data:image/"):
            urls.append(data_url)
    return urls


async def midjourney_modal_mask_url(reference, *, AIReference, BytesIO, HTTPException, Image, ImageOps, model_dump_compat, reference_to_data_url, write_diagnostic):
    """Convert this canvas's white edit-mask convention to APIMart's alpha mask.
    Existing remote masks are treated as already compliant; locally generated
    `role=mask` images have white editable pixels and are inverted to transparent.
    """
    if not reference:
        return ""
    ref = model_dump_compat(reference) if isinstance(reference, AIReference) else dict(reference)
    value = str(ref.get("url") or "").strip()
    if value.startswith(("http://", "https://")):
        return value
    data_url = reference_to_data_url(ref, max_size=2048)
    if not data_url.startswith("data:image/"):
        return ""
    try:
        _header, encoded = data_url.split(",", 1)
        with Image.open(BytesIO(base64.b64decode(encoded))) as image:
            luminance = ImageOps.exif_transpose(image).convert("L")
            rgba = Image.new("RGBA", luminance.size, (255, 255, 255, 255))
            rgba.putalpha(ImageOps.invert(luminance))
            out = BytesIO()
            rgba.save(out, format="PNG")
        return f"data:image/png;base64,{base64.b64encode(out.getvalue()).decode('ascii')}"
    except Exception as exc:
        write_diagnostic(f"midjourney mask read failed error={type(exc).__name__}")
        raise HTTPException(status_code=400, detail="无法读取 Midjourney 遮罩图片，请重新选择图片。") from exc


async def apimart_midjourney_request(provider, path, body, *, APIMART_MIDJOURNEY_API_ROOT, HTTPException, api_headers, httpx, midjourney_task_id, upstream_response_error_summary):
    timeout = httpx.Timeout(connect=20.0, read=180.0, write=120.0, pool=20.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        response = await client.post(
            f"{APIMART_MIDJOURNEY_API_ROOT}{path}",
            headers=api_headers(provider=provider),
            json=body,
        )
    if response.status_code >= 400:
        raise HTTPException(status_code=response.status_code, detail=upstream_response_error_summary(response, f"Midjourney 接口错误（{response.status_code}）"))
    try:
        raw = response.json()
    except ValueError as exc:
        raise HTTPException(status_code=502, detail="Midjourney 接口没有返回有效 JSON") from exc
    task_id = midjourney_task_id(raw)
    if not task_id:
        raise HTTPException(status_code=502, detail="Midjourney 未返回任务 ID")
    return raw, task_id


async def midjourney_result(provider, task_id, *, APIMART_MIDJOURNEY_API_ROOT, HTTPException, IMAGE_TASK_FAILED_STATUSES, IMAGE_TASK_SUCCESS_STATUSES, api_headers, httpx, image_output_meta, midjourney_error_detail, midjourney_remote_images, midjourney_task_status, save_ai_image_to_output, upstream_response_error_summary):
    safe_task_id = str(task_id or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9_.:-]{1,240}", safe_task_id):
        raise HTTPException(status_code=400, detail="Midjourney 任务 ID 不合法。")
    timeout = httpx.Timeout(connect=20.0, read=180.0, write=60.0, pool=20.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        response = await client.get(
            f"{APIMART_MIDJOURNEY_API_ROOT}/v1/midjourney/{urllib.parse.quote(safe_task_id, safe='')}",
            headers=api_headers(provider=provider),
        )
    if response.status_code >= 400:
        raise HTTPException(status_code=response.status_code, detail=upstream_response_error_summary(response, f"查询 Midjourney 任务失败（{response.status_code}）"))
    try:
        raw = response.json()
    except ValueError as exc:
        raise HTTPException(status_code=502, detail="Midjourney 任务查询没有返回有效 JSON") from exc
    status = midjourney_task_status(raw)
    if status in IMAGE_TASK_FAILED_STATUSES:
        return {"status": "failed", "task_id": safe_task_id, "error": midjourney_error_detail(raw)}
    if status not in IMAGE_TASK_SUCCESS_STATUSES:
        return {"status": "running", "task_id": safe_task_id, "message": "Midjourney 任务仍在生成中"}
    remote_urls = midjourney_remote_images(raw)
    if not remote_urls:
        return {"status": "failed", "task_id": safe_task_id, "error": "Midjourney 任务成功但没有返回图片。"}
    local_urls, image_items = [], []
    for remote_url in remote_urls:
        local_url = await save_ai_image_to_output({"type": "url", "value": remote_url}, prefix="midjourney_")
        if local_url:
            local_urls.append(local_url)
            item = image_output_meta(local_url)
            item["mj_task_id"] = safe_task_id
            image_items.append(item)
    return {
        "status": "succeeded",
        "task_id": safe_task_id,
        "images": local_urls,
        "image_items": image_items,
        "provider_id": provider["id"],
        "provider_name": provider.get("name") or provider["id"],

    }


async def submit_midjourney(payload, *, HTTPException, MIDJOURNEY_SPEEDS, apimart_midjourney_provider, apimart_midjourney_request, midjourney_reference_urls, model_dump_compat, public_midjourney_submission):
    provider = apimart_midjourney_provider(payload.provider_id)
    speed = str(payload.speed or "relax").strip().lower()
    if speed not in MIDJOURNEY_SPEEDS:
        raise HTTPException(status_code=400, detail="Midjourney 速度仅支持 relax、fast 或 turbo。")
    size = str(payload.size or "1:1").strip()
    if not re.fullmatch(r"\d{1,2}:\d{1,2}", size):
        raise HTTPException(status_code=400, detail="Midjourney 画幅应为宽:高，例如 16:9。")
    mode = str(payload.mode or "imagine").strip().lower()
    if mode not in {"imagine", "blend", "edit"}:
        raise HTTPException(status_code=400, detail="不支持的 Midjourney 节点模式。")
    image_urls = await midjourney_reference_urls([model_dump_compat(ref) for ref in payload.reference_images if ref.url])
    prompt = str(payload.prompt or "").strip()
    if mode == "blend":
        if not 2 <= len(image_urls) <= 4:
            raise HTTPException(status_code=400, detail="Midjourney 多图融合需要连接 2 到 4 张图片。")
        body = {"image_urls": image_urls, "size": size, "speed": speed, "metadata": {"source": "infinite-canvas"}}
        path = "/v1/midjourney/generations/blend"
    elif mode == "edit":
        if not prompt:
            raise HTTPException(status_code=400, detail="Midjourney 图片编辑需要提示词。")
        if not image_urls:
            raise HTTPException(status_code=400, detail="Midjourney 图片编辑需要连接至少一张图片。")
        body = {"prompt": prompt, "image_urls": image_urls, "size": size, "speed": speed, "metadata": {"source": "infinite-canvas"}}
        path = "/v1/midjourney/generations/edits"
    else:
        if not prompt:
            raise HTTPException(status_code=400, detail="Midjourney 文生图需要提示词。")
        body = {"prompt": prompt, "size": size, "version": str(payload.version or "6.1").strip()[:24], "speed": speed, "metadata": {"source": "infinite-canvas"}}
        if image_urls:
            body["image_urls"] = image_urls
        path = "/v1/midjourney/generations"
    raw, task_id = await apimart_midjourney_request(provider, path, body)
    return public_midjourney_submission(raw, task_id, provider["id"], mode=mode)


async def submit_midjourney_action(payload, *, HTTPException, MIDJOURNEY_ACTION_PATHS, MIDJOURNEY_SPEEDS, apimart_midjourney_provider, apimart_midjourney_request, public_midjourney_submission):
    provider = apimart_midjourney_provider(payload.provider_id)
    action = str(payload.action or "").strip().lower()
    if action not in MIDJOURNEY_ACTION_PATHS:
        raise HTTPException(status_code=400, detail="不支持的 Midjourney 操作。")
    task_id = str(payload.task_id or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9_.:-]{1,240}", task_id):
        raise HTTPException(status_code=400, detail="Midjourney 任务 ID 不合法。")
    speed = str(payload.speed or "relax").strip().lower()
    if speed not in MIDJOURNEY_SPEEDS:
        raise HTTPException(status_code=400, detail="Midjourney 速度仅支持 relax、fast 或 turbo。")
    body = {"task_id": task_id, "speed": speed, "metadata": {"source": "infinite-canvas"}}
    custom_id = str(payload.custom_id or "").strip()
    if custom_id:
        body["custom_id"] = custom_id
    if action in {"upscale", "variation", "low_variation", "high_variation", "remix_subtle", "remix_strong"} and not custom_id:
        index = int(payload.index or 0)
        if index not in {1, 2, 3, 4}:
            raise HTTPException(status_code=400, detail="Midjourney 图片序号应为 1 到 4。")
        body["index"] = index
    elif action in {"zoom", "pan"} and int(payload.index or 0) in {1, 2, 3, 4}:
        body["index"] = int(payload.index)
    if action == "zoom" and payload.zoom_ratio is not None:
        zoom_ratio = float(payload.zoom_ratio)
        if zoom_ratio <= 1 or zoom_ratio > 4:
            raise HTTPException(status_code=400, detail="Midjourney 缩放比例应大于 1 且不超过 4。")
        body["zoom_ratio"] = zoom_ratio
    if action == "pan" and not custom_id:
        direction = str(payload.direction or "").strip().lower()
        if direction not in {"left", "right", "up", "down"}:
            raise HTTPException(status_code=400, detail="Midjourney 平移方向仅支持 left、right、up 或 down。")
        body["direction"] = direction
    if action in {"remix_subtle", "remix_strong"}:
        prompt = str(payload.prompt or "").strip()
        if prompt:
            body["prompt"] = prompt
    raw, new_task_id = await apimart_midjourney_request(provider, MIDJOURNEY_ACTION_PATHS[action], body)
    return public_midjourney_submission(raw, new_task_id, provider["id"], action=action)


async def submit_midjourney_modal(payload, *, HTTPException, MIDJOURNEY_SPEEDS, apimart_midjourney_provider, apimart_midjourney_request, midjourney_modal_mask_url, midjourney_task_status, public_midjourney_submission):
    provider = apimart_midjourney_provider(payload.provider_id)
    task_id = str(payload.task_id or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9_.:-]{1,240}", task_id):
        raise HTTPException(status_code=400, detail="Midjourney 任务 ID 不合法。")
    speed = str(payload.speed or "relax").strip().lower()
    if speed not in MIDJOURNEY_SPEEDS:
        raise HTTPException(status_code=400, detail="Midjourney 速度仅支持 relax、fast 或 turbo。")
    mask_url = await midjourney_modal_mask_url(payload.mask_image)
    if not mask_url:
        raise HTTPException(status_code=400, detail="Midjourney 局部重绘需要连接一个遮罩图片节点。")
    body = {
        "task_id": task_id,
        "prompt": str(payload.prompt or "").strip(),
        "mask_url": mask_url,
        "speed": speed,
        "metadata": {"source": "infinite-canvas"},
    }
    raw, submitted_task_id = await apimart_midjourney_request(provider, "/v1/midjourney/generations/modal", body)
    result = public_midjourney_submission(raw, submitted_task_id, provider["id"])
    result["status"] = midjourney_task_status(raw) or "submitted"
    return result


async def get_midjourney_task(task_id, provider_id, *, apimart_midjourney_provider, midjourney_result):
    provider = apimart_midjourney_provider(provider_id)
    return await midjourney_result(provider, task_id)


