"""土豆图片与视频协议、请求映射、轮询及结果处理。

索引、文件、锁和供应商调用由应用显式注入，保留现有提交/清理顺序。
"""
import time
import re
import asyncio
import base64
import urllib.parse

def tudou_image_model_for_request(model):
    """Keep older canvases working after Tudou retired the unsuffixed GPT Image 2 model."""
    value = str(model or "").strip()
    return "gpt-image-2-1k" if value.lower() == "gpt-image-2" else value


def tudou_async_resolution(model, resolution, size='', *, parse_size_pair):
    requested = str(resolution or "").strip().lower()
    if requested in {"1k", "2k", "4k"}:
        return requested
    model_name = str(model or "").strip().lower()
    for value in ("4k", "2k", "1k"):
        if model_name.endswith(f"-{value}"):
            return value
    width, height = parse_size_pair(size)
    edge = max(width or 0, height or 0)
    pixels = (width or 0) * (height or 0)
    if edge >= 2800 or pixels >= 7_000_000:
        return "4k"
    if edge >= 1600 or pixels >= 2_000_000:
        return "2k"
    return "1k"


def tudou_async_size(size, aspect_ratio=''):
    ratio = str(aspect_ratio or "").strip()
    if re.fullmatch(r"\d+\s*:\s*\d+", ratio):
        return ratio.replace(" ", "")
    value = str(size or "").strip().lower().replace("*", "x")
    if re.fullmatch(r"\d{2,5}x\d{2,5}", value):
        return value
    return "1:1"


def tudou_png_or_jpeg_data_url(value, *, BytesIO, Image, ImageOps):
    text = str(value or "").strip()
    if re.match(r"^data:image/(?:png|jpe?g);base64,", text, re.I):
        return text
    if not text.startswith("data:image/"):
        return text
    header, sep, encoded = text.partition(",")
    if not sep or not encoded:
        return text
    try:
        raw = base64.b64decode(encoded, validate=False)
        with Image.open(BytesIO(raw)) as img:
            img.load()
            img = ImageOps.exif_transpose(img)
            if img.mode in ("RGBA", "LA", "P"):
                fmt, mime = "PNG", "image/png"
                converted = img.convert("RGBA")
            else:
                fmt, mime = "JPEG", "image/jpeg"
                converted = img.convert("RGB")
            buf = BytesIO()
            converted.save(buf, format=fmt, quality=90 if fmt == "JPEG" else None)
        return f"data:{mime};base64,{base64.b64encode(buf.getvalue()).decode('ascii')}"
    except Exception:
        return text


async def tudou_async_reference_images(reference_images, *, ONLINE_IMAGE_REFERENCE_MAX, reference_to_data_url, tudou_png_or_jpeg_data_url):
    images = []
    for ref in (reference_images or [])[:ONLINE_IMAGE_REFERENCE_MAX]:
        value = str((ref or {}).get("url") or "").strip()
        if value.startswith(("http://", "https://")):
            images.append(value)
            continue
        if value.startswith("data:image/"):
            images.append(tudou_png_or_jpeg_data_url(value))
            continue
        data_url = reference_to_data_url(ref, max_size=1536)
        if data_url and data_url.startswith("data:image/"):
            images.append(tudou_png_or_jpeg_data_url(data_url))
    return images


async def generate_tudou_async_image(prompt, size, quality, model, reference_images, provider, aspect_ratio='', resolution='', on_remote_accept=None, *, HTTPException, api_headers, extract_image, extract_task_id, httpx, provider_endpoint_url, tudou_async_reference_images, tudou_async_resolution, tudou_async_size, upstream_error_summary, upstream_response_error_summary, wait_for_image_task):
    """Tudou's GPT-Image-2 async route, isolated from generic OpenAI image calls."""
    base_url = str((provider or {}).get("base_url") or "").strip().rstrip("/")
    if not base_url:
        raise HTTPException(status_code=400, detail=f"{provider.get('name') or provider.get('id') or '土豆'} 未配置 Base URL")
    body = {
        "model": "gpt-image-2-all",
        "prompt": str(prompt or "").strip(),
        "size": tudou_async_size(size, aspect_ratio),
        "resolution": tudou_async_resolution(model, resolution, size),
        "quality": str(quality or "").strip().lower() if str(quality or "").strip().lower() in {"low", "medium", "high"} else "medium",
    }
    images = await tudou_async_reference_images(reference_images)
    if images:
        body["images"] = images
    endpoint = provider_endpoint_url(provider, "image_generation_endpoint", "/v1/images/generations/async")
    async with httpx.AsyncClient(timeout=httpx.Timeout(connect=20.0, read=180.0, write=120.0, pool=20.0)) as client:
        response = await client.post(endpoint, headers=api_headers(provider=provider, model=body["model"]), json=body)
        if response.status_code >= 400:
            raise HTTPException(status_code=response.status_code, detail=f"土豆异步生图提交失败：{upstream_response_error_summary(response)}")
        raw = response.json()
        task_id = extract_task_id(raw) if isinstance(raw, dict) else None
        if not task_id:
            try:
                return extract_image(raw), raw
            except HTTPException as exc:
                raise HTTPException(status_code=502, detail=f"土豆异步生图未返回任务标识或图片：{upstream_error_summary(raw, fallback='响应内容不完整')}") from exc
        if on_remote_accept is not None:
            await on_remote_accept(task_id, query_mode="http_get")
        result = await wait_for_image_task(client, task_id, provider)
        return extract_image(result), result


def tudou_grok_image_size(size, aspect_ratio='', *, TUDOU_GROK_IMAGE_ASPECT_SIZES, TUDOU_GROK_IMAGE_SIZES):
    value = str(size or "").strip().lower().replace("*", "x").replace("×", "x")
    if value in TUDOU_GROK_IMAGE_SIZES:
        return value
    if str(aspect_ratio or "").strip() in TUDOU_GROK_IMAGE_ASPECT_SIZES:
        return TUDOU_GROK_IMAGE_ASPECT_SIZES[str(aspect_ratio).strip()]
    match = re.match(r"^(\d+)\s*x\s*(\d+)$", value)
    if match:
        width, height = int(match.group(1)), int(match.group(2))
        if width and height:
            ratio = width / height
            choices = {"1024x1024": 1.0, "1280x720": 16 / 9, "720x1280": 9 / 16, "1792x1024": 3 / 2, "1024x1792": 2 / 3}
            return min(choices, key=lambda candidate: abs(choices[candidate] - ratio))
    return "1024x1024"


def tudou_api_endpoint(base_url, path):
    base = str(base_url or "").rstrip("/")
    return f"{base}{path}" if base.endswith("/v1") else f"{base}/v1{path}"


def tudou_reference_urls(ref):
    source = ref if isinstance(ref, dict) else {}
    urls = []
    for key in ("url", "original_url", "originalLocalUrl", "source_url"):
        value = str(source.get(key) or "").strip()
        if value and value not in urls:
            urls.append(value)
    return urls


async def generate_tudou_grok_image(prompt, size, model, reference_images, provider, aspect_ratio='', *, HTTPException, api_headers, extract_images, httpx, selected_model, tudou_api_endpoint, tudou_grok_image_size, tudou_reference_urls, upstream_error_summary, upstream_response_error_summary, yuli_fetch_reference_bytes):
    """Use Tudou's Grok multipart edit route without changing generic OpenAI image behavior."""
    model = selected_model(model, "grok-imagine-image")
    base_url = str(provider.get("base_url") or "").rstrip("/")
    if not base_url:
        raise HTTPException(status_code=400, detail=f"{provider.get('name') or provider['id']} 未配置 Base URL")
    refs = [item for item in (reference_images or []) if isinstance(item, dict) and item.get("url")]
    is_edit = "edit" in model.lower() or bool(refs)
    timeout = httpx.Timeout(connect=20.0, read=600.0, write=120.0, pool=20.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        if is_edit:
            edit_model = model if "edit" in model.lower() else "grok-imagine-image-edit"
            parts = [(key, (None, str(value))) for key, value in {
                "model": edit_model,
                "prompt": str(prompt or ""),
                "n": "1",
                "size": "1024x1024",
                "response_format": "url",
            }.items()]
            attached = 0
            for ref in refs[:7]:
                for value in tudou_reference_urls(ref):
                    if value.lower().startswith("asset://"):
                        continue
                    ref_file = await yuli_fetch_reference_bytes(client, value)
                    if ref_file:
                        parts.append(("image[]", ref_file))
                        attached += 1
                        break
            if attached <= 0:
                raise HTTPException(status_code=400, detail="土豆 Grok 图像编辑没有成功读取参考图。请使用本地图片、公网图片 URL 或 data:image;base64。")
            response = await client.post(
                tudou_api_endpoint(base_url, "/images/edits"),
                headers=api_headers(json_body=False, provider=provider, model=edit_model),
                files=parts,
            )
        else:
            response = await client.post(
                tudou_api_endpoint(base_url, "/images/generations"),
                headers=api_headers(json_body=True, provider=provider, model=model),
                json={"model": model, "prompt": str(prompt or ""), "n": 1, "size": tudou_grok_image_size(size, aspect_ratio), "response_format": "url"},
            )
        if response.status_code >= 400:
            raise HTTPException(status_code=response.status_code, detail=f"土豆 Grok 图像接口错误：{upstream_response_error_summary(response)}")
        try:
            raw = response.json()
        except Exception as exc:
            raise HTTPException(status_code=502, detail="土豆 Grok 图像接口返回了无法解析的响应，请检查接口配置。") from exc
    try:
        images = extract_images(raw)
    except HTTPException:
        images = []
    if not images:
        raise HTTPException(status_code=502, detail=f"土豆 Grok 图像接口没有返回图片：{upstream_error_summary(raw, fallback='上游没有返回图片数据')}")
    return images[0], raw


def tudou_video_family(model):
    value = str(model or "").strip().lower()
    if value.startswith("sora2"):
        return "sora2"
    if value.startswith("veo3.1"):
        return "veo31"
    if value.startswith("kling-v3"):
        return "kling"
    if value.startswith("pixverse-v6"):
        return "pixverse"
    if "seedance-2.0" in value:
        return "seedance"
    return ""


def tudou_snap_choice(value, choices, default):
    try:
        parsed = int(round(float(value)))
    except Exception:
        return default
    return parsed if parsed in choices else min(choices, key=lambda choice: abs(choice - parsed))


def tudou_video_aspect(value, allowed=('16:9', '9:16'), default='16:9'):
    value = str(value or "").strip()
    return value if value in allowed else default


def tudou_task_data(raw):
    return raw.get("data") if isinstance(raw, dict) and isinstance(raw.get("data"), dict) else raw if isinstance(raw, dict) else {}


def tudou_extract_task_id(raw, *, tudou_task_data):
    data = tudou_task_data(raw)
    return str(data.get("id") or data.get("task_id") or (raw or {}).get("id") or (raw or {}).get("task_id") or "").strip()


def tudou_video_result_urls(raw, *, tudou_task_data):
    result = tudou_task_data(raw).get("result")
    result = result if isinstance(result, dict) else {}
    urls = []
    def add(value):
        if isinstance(value, list):
            for item in value:
                add(item)
        elif isinstance(value, dict):
            add(value.get("url") or value.get("video_url"))
        elif isinstance(value, str) and value.strip() and value.strip() not in urls:
            urls.append(value.strip())
    add(result.get("video_url"))
    for key in ("videos", "images", "outputs", "result"):
        add(result.get(key))
    return urls


async def tudou_public_image_urls(images, limit, *, openai_video_proxy_public_reference_url):
    urls = []
    for ref in list(images or [])[:limit]:
        value = str(getattr(ref, "url", "") or "").strip()
        if value:
            urls.append(await openai_video_proxy_public_reference_url({"url": value}))
    return urls


async def tudou_public_media_urls(items, limit, *, openai_video_proxy_public_reference_url):
    urls = []
    for item in list(items or [])[:limit]:
        value = str(item or "").strip()
        if value:
            urls.append(await openai_video_proxy_public_reference_url(value))
    return urls


async def tudou_wait_video_task(client, provider, base_url, task_id, *, HTTPException, TUDOU_VIDEO_FAILED_STATUSES, TUDOU_VIDEO_SUCCESS_STATUSES, VIDEO_POLL_TIMEOUT, _notify_canvas_video_remote_accept, api_headers, tudou_task_data, tudou_video_result_urls, upstream_error_summary):
    await _notify_canvas_video_remote_accept(task_id, query_mode="tudou_http_get")
    deadline = time.monotonic() + VIDEO_POLL_TIMEOUT
    await asyncio.sleep(min(12.0, VIDEO_POLL_TIMEOUT))
    delay = 5.0
    last_payload = {}
    task_url = f"{base_url}/v1/tasks/{urllib.parse.quote(str(task_id), safe='')}"
    while time.monotonic() < deadline:
        response = await client.get(task_url, headers=api_headers(provider=provider))
        response.raise_for_status()
        last_payload = response.json()
        data = tudou_task_data(last_payload)
        status = str(data.get("status") or data.get("task_status") or "").upper()
        if status in TUDOU_VIDEO_SUCCESS_STATUSES or tudou_video_result_urls(last_payload):
            return last_payload
        if status in TUDOU_VIDEO_FAILED_STATUSES:
            reason = upstream_error_summary(last_payload, fallback="上游未提供失败原因")
            raise HTTPException(status_code=502, detail=f"土豆视频生成失败：{reason}")
        await asyncio.sleep(delay)
        delay = min(delay * 1.4, 10.0)
    raise HTTPException(status_code=504, detail="土豆视频任务超时")


async def generate_tudou_video(client, payload, provider, base_url, requested_model, *, HTTPException, api_headers, openai_video_proxy_public_reference_url, save_remote_video_to_output, selected_model, tudou_extract_task_id, tudou_public_image_urls, tudou_public_media_urls, tudou_snap_choice, tudou_video_aspect, tudou_video_family, tudou_video_result_urls, tudou_wait_video_task, upstream_error_summary):
    family = tudou_video_family(requested_model)
    model = selected_model(requested_model, requested_model)
    aspect = tudou_video_aspect(payload.aspect_ratio or payload.size)
    body = {"model": model, "prompt": str(payload.prompt or "")}
    if family == "sora2":
        body.update(duration=tudou_snap_choice(payload.duration, (4, 8, 12), 8), aspect_ratio=aspect, generate_audio=bool(payload.generate_audio))
        images = await tudou_public_image_urls(payload.images, 1)
        if images: body["images"] = images
    elif family == "veo31":
        body.update(resolution="1080p" if model.lower().endswith("1080p") else "720p", duration=tudou_snap_choice(payload.duration, (4, 6, 8), 8), aspect_ratio=aspect, generate_audio=bool(payload.generate_audio))
        images = await tudou_public_image_urls(payload.images, 3)
        if images:
            body["reference_mode"] = "image" if len(images) > 2 else "frame"
            body["images"] = images
    elif family == "kling":
        images = await tudou_public_image_urls(payload.images, 2)
        if not images:
            raise HTTPException(status_code=400, detail="土豆 Kling v3 系列只支持图生视频，请至少提供 1 张参考图。")
        durations = (5, 10, 15) if model.lower() == "kling-v3" else (5, 15)
        body.update(duration=tudou_snap_choice(payload.duration, durations, 10 if model.lower() == "kling-v3" else 15), aspect_ratio=aspect, generate_audio=bool(payload.generate_audio), images=images)
    elif family == "pixverse":
        lower = model.lower()
        body.update(resolution="1080p" if "1080p" in lower else "720p", audio=lower.endswith("-audio"), size=tudou_video_aspect(payload.aspect_ratio or payload.size, allowed=("16:9", "4:3", "1:1", "3:4", "9:16", "2:3", "3:2", "21:9")))
        first = next((ref for ref in payload.images if str(ref.role or "").lower() == "first_frame"), None)
        last = next((ref for ref in payload.images if str(ref.role or "").lower() == "last_frame"), None)
        if first and last:
            body.update(first_frame_image=await openai_video_proxy_public_reference_url({"url": first.url}), last_frame_image=await openai_video_proxy_public_reference_url({"url": last.url}), duration=tudou_snap_choice(payload.duration, (5, 8), 5))
        else:
            images = await tudou_public_image_urls(payload.images, 7)
            if images: body["img_references"] = images
            body["duration"] = max(1, min(15, tudou_snap_choice(payload.duration, tuple(range(1, 16)), 5)))
    elif family == "seedance":
        body.update(model="seedance-2.0-fast" if "fast" in model.lower() else "seedance-2.0", duration=tudou_snap_choice(payload.duration, tuple(range(4, 16)), 4), aspect_ratio=aspect, resolution="1080p" if str(payload.resolution or "").lower().startswith("1080") else "720p", generate_audio=bool(payload.generate_audio))
        images, videos = await tudou_public_image_urls(payload.images, 9), await tudou_public_media_urls(payload.videos, 3)
        if images: body["images"] = images
        if videos: body["videos"] = videos
        if images or videos:
            audios = await tudou_public_media_urls(payload.audios, 3)
            if audios: body["audios"] = audios
    else:
        raise HTTPException(status_code=400, detail=f"未知的土豆视频模型：{model}")
    response = await client.post(f"{base_url}/v1/videos/generations", headers=api_headers(provider=provider, model=model), json=body)
    response.raise_for_status()
    try:
        raw = response.json()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"土豆视频接口返回非 JSON 响应（状态 {response.status_code}）") from exc
    task_id = tudou_extract_task_id(raw)
    if not task_id:
        raise HTTPException(status_code=502, detail=f"土豆视频提交未返回任务 ID：{upstream_error_summary(raw, fallback='上游响应缺少任务 ID')}")
    result = raw if tudou_video_result_urls(raw) else await tudou_wait_video_task(client, provider, base_url, task_id)
    urls = tudou_video_result_urls(result)
    if not urls:
        raise HTTPException(status_code=502, detail="土豆视频任务完成但未返回视频地址")
    return {"videos": [await save_remote_video_to_output(url, prefix="tudou_video_") for url in urls], "task_id": task_id, "raw": result}


def tudou_grok_video_seconds(duration):
    allowed = (6, 10, 12, 16, 20)
    try:
        value = int(duration)
    except Exception:
        value = 6
    return str(value if value in allowed else next((item for item in allowed if item >= value), allowed[-1]))


def tudou_grok_video_size(aspect_ratio='', resolution=''):
    ratio = str(aspect_ratio or "").strip()
    high = str(resolution or "").strip().lower() in {"1080p", "4k", "high", "hd"}
    if ratio == "9:16": return "1024x1792" if high else "720x1280"
    if ratio == "1:1": return "1024x1024"
    return "1792x1024" if high else "1280x720"


async def tudou_grok_video_part(client, ref, *, yuli_fetch_reference_bytes):
    for value in (str(getattr(ref, key, "") or "").strip() for key in ("url", "original_url", "originalLocalUrl", "source_url")):
        if not value or value.lower().startswith("asset://"):
            continue
        ref_file = await yuli_fetch_reference_bytes(client, value)
        if ref_file:
            return ("input_reference[]", ref_file)
    return None


async def generate_tudou_grok_video(client, payload, provider, base_url, requested_model, *, HTTPException, api_headers, download_tudou_grok_video_content, extract_task_id, save_remote_video_to_output, selected_model, tudou_grok_video_part, tudou_grok_video_seconds, tudou_grok_video_size, upstream_error_summary, video_output_urls, wait_for_video_task):
    model = selected_model(requested_model, "grok-imagine-video")
    parts = [(key, (None, str(value))) for key, value in {
        "model": model, "prompt": str(payload.prompt or ""), "seconds": tudou_grok_video_seconds(payload.duration),
        "size": tudou_grok_video_size(payload.aspect_ratio or payload.size, payload.resolution),
        "resolution_name": "480p" if str(payload.resolution or "").lower() == "480p" else "720p", "preset": "custom",
    }.items()]
    attached = 0
    for ref in (payload.images or [])[:7]:
        part = await tudou_grok_video_part(client, ref)
        if part:
            parts.append(part)
            attached += 1
    if payload.images and not attached:
        raise HTTPException(status_code=400, detail="土豆 Grok 图生视频没有成功读取参考图。请使用本地图片、公网图片 URL 或 data:image;base64。")
    response = await client.post(f"{base_url}/v1/videos", headers=api_headers(json_body=False, provider=provider, model=model), files=parts)
    response.raise_for_status()
    try:
        raw = response.json()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"土豆 Grok 视频接口返回非 JSON 响应（状态 {response.status_code}）") from exc
    task_id = str(raw.get("id") or extract_task_id(raw) or raw.get("task_id") or "").strip()
    result = raw if video_output_urls(raw) else await wait_for_video_task(client, provider, task_id, f"{base_url}/v1/videos") if task_id else raw
    urls = video_output_urls(result)
    if urls:
        videos = [await save_remote_video_to_output(url, prefix="tudou_grok_video_") for url in urls]
    elif task_id:
        videos = [await download_tudou_grok_video_content(client, provider, base_url, task_id)]
    else:
        raise HTTPException(status_code=502, detail=f"土豆 Grok 视频没有返回视频地址：{upstream_error_summary(result, fallback='上游响应缺少视频地址')}")
    return {"videos": videos, "task_id": task_id, "raw": result}



async def download_tudou_grok_video_content(client, provider, base_url, task_id, *, api_headers, save_video_bytes_to_output):
    response = await client.get(
        f"{base_url}/v1/videos/{urllib.parse.quote(str(task_id), safe='')}/content",
        headers=api_headers(provider=provider),
    )
    response.raise_for_status()
    content_type = (response.headers.get("content-type") or "").lower()
    extension = ".webm" if "webm" in content_type else ".mov" if "quicktime" in content_type or "mov" in content_type else ".mp4"
    return await save_video_bytes_to_output(response.content, prefix="tudou_grok_video_", ext=extension)


