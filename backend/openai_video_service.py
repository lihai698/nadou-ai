"""灵境与玉玉的 OpenAI multipart 视频协议及执行。

保留各自模型、参考图数量和表单格式，复用已有查询与输出保存。
"""

def _yuli_model_norm(model):
    return str(model or "").strip().lower().replace("_", "").replace(".", "").replace("-", "")


def yuli_is_veo_openai_model(model):
    return _yuli_model_norm(model) in {"veo31", "veo31fast"}


def yuli_openai_model_name(model):
    return "veo_3_1-fast" if _yuli_model_norm(model) == "veo31fast" else "veo_3_1"


def yuli_openai_size(aspect_ratio):
    value = str(aspect_ratio or "").strip()
    if value == "9:16":
        return "9x16"
    return "16x9"


def lingjing_openai_video_model(model):
    value = str(model or "").strip() or "veo_3_1-fast"
    lower = value.lower()
    if lower.startswith("veo3.1"):
        value = "veo_3_1" + value[len("veo3.1"):]
    elif lower.startswith("veo3_1"):
        value = "veo_3_1" + value[len("veo3_1"):]
    if value.lower().endswith("-4k"):
        value = value[:-2] + "4K"
    return value


def yuli_video_seconds(duration):
    try:
        value = int(duration)
    except Exception:
        value = 8
    if value <= 0:
        value = 8
    return str(value)


async def generate_lingjing_openai_video(client, payload, provider, base_url, requested_model, *, HTTPException, api_headers, extract_task_id, lingjing_openai_video_model, save_remote_video_to_output, selected_model, video_output_urls, wait_for_video_task, yuli_fetch_reference_bytes, yuli_openai_size, yuli_video_seconds):
    """灵境 API OpenAI 视频格式：POST /v1/videos，参考图走 multipart input_reference。"""
    submit_url = f"{base_url}/v1/videos"
    data = {
        "model": lingjing_openai_video_model(selected_model(requested_model, "veo_3_1-fast")),
        "prompt": str(payload.prompt or ""),
        "seconds": yuli_video_seconds(payload.duration),
        "size": yuli_openai_size(payload.aspect_ratio or payload.size),
        "watermark": "true" if payload.watermark else "false",
    }
    files = []
    for ref in (payload.images or [])[:3]:
        ref_file = await yuli_fetch_reference_bytes(client, getattr(ref, "url", ""))
        if ref_file:
            files.append(("input_reference", ref_file))
    headers = api_headers(json_body=False, provider=provider)
    if files:
        response = await client.post(submit_url, headers=headers, data=data, files=files)
    else:
        multipart_fields = [(key, (None, value)) for key, value in data.items()]
        response = await client.post(submit_url, headers=headers, files=multipart_fields)
    response.raise_for_status()
    try:
        raw = response.json()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"灵境 API 视频接口返回非 JSON 响应（状态 {response.status_code}）") from exc
    task_id = str(raw.get("id") or extract_task_id(raw) or raw.get("task_id") or "").strip()
    result = raw
    if task_id and not video_output_urls(raw):
        result = await wait_for_video_task(client, provider, task_id, submit_url)
    urls = video_output_urls(result)
    if not urls:
        raise HTTPException(status_code=502, detail="灵境 API 视频生成成功但没有返回视频地址")
    local_urls = [await save_remote_video_to_output(url) for url in urls]
    return {"videos": local_urls, "task_id": task_id, "raw": result}


async def generate_yuli_openai_video(client, payload, provider, base_url, requested_model, *, HTTPException, api_headers, extract_task_id, save_remote_video_to_output, video_output_urls, wait_for_video_task, yuli_fetch_reference_bytes, yuli_openai_model_name, yuli_openai_size, yuli_video_seconds):
    """玉玉API veo3.1 走 OpenAI multipart 格式 /v1/videos，支持 seconds 时长控制。"""
    submit_url = f"{base_url}/v1/videos"
    data = {
        "model": yuli_openai_model_name(requested_model),
        "prompt": str(payload.prompt or ""),
        "seconds": yuli_video_seconds(payload.duration),
        "size": yuli_openai_size(payload.aspect_ratio),
        "watermark": "true" if payload.watermark else "false",
    }
    files = {}
    for ref in (payload.images or [])[:1]:
        ref_file = await yuli_fetch_reference_bytes(client, getattr(ref, "url", ""))
        if ref_file:
            files["input_reference"] = ref_file
            break
    headers = api_headers(json_body=False, provider=provider)
    if files:
        response = await client.post(submit_url, headers=headers, data=data, files=files)
    else:
        # 文生视频无垫图时，仍以 multipart/form-data 提交（把文本字段作为表单分块），
        # 避免 httpx 在只有 data 时退化成 application/x-www-form-urlencoded。
        multipart_fields = {key: (None, value) for key, value in data.items()}
        response = await client.post(submit_url, headers=headers, files=multipart_fields)
    response.raise_for_status()
    try:
        raw = response.json()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"玉玉API 视频接口返回非 JSON 响应（状态 {response.status_code}）") from exc
    task_id = raw.get("id") or extract_task_id(raw) or raw.get("task_id")
    result = raw
    if task_id and not video_output_urls(raw):
        result = await wait_for_video_task(client, provider, task_id, submit_url)
    urls = video_output_urls(result)
    if not urls:
        raise HTTPException(status_code=502, detail="视频生成成功但没有返回视频地址")
    local_urls = [await save_remote_video_to_output(url) for url in urls]
    return {"videos": local_urls, "task_id": task_id, "raw": result}


