"""视频请求载荷：APIMart 上传与原生多模态参数构造。"""

async def build_apimart_video_body(client, payload, provider, requested_model, is_veo31, *, HTTPException, apimart_veo31_aspect, apimart_veo31_duration, apimart_veo31_model, apimart_veo31_resolution, apimart_video_duration, apimart_video_reference_error, apimart_video_size, apply_trusted_asset_prompt_index, invalid_video_image_preview, looks_like_image_media_url, selected_model, upload_audio_for_apimart, upload_image_for_apimart, upload_video_for_apimart, valid_apimart_video_image_input):
    # APIMart 只接受 http/https 或 asset:// URL，先上传本地图片取回网络 URL
    image_with_roles = []
    invalid_images = []  # 每项为 (原始 URL, 失败原因)
    video_payload = []
    invalid_videos = []
    for ref_url in payload.videos[:3]:
        ref_url = str(ref_url or "").strip()
        if not ref_url:
            continue
        if looks_like_image_media_url(ref_url):
            invalid_videos.append((ref_url, "该地址是图片，不能作为参考视频。请将图片放入图片输入。"))
            continue
        normalized_video_url = await upload_video_for_apimart(client, provider, ref_url)
        if valid_apimart_video_image_input(normalized_video_url):
            video_payload.append(normalized_video_url)
        else:
            reason = normalized_video_url[4:] if isinstance(normalized_video_url, str) and normalized_video_url.startswith("ERR:") else apimart_video_reference_error(ref_url)
            invalid_videos.append((ref_url, reason))
    if invalid_videos:
        first_url, first_reason = invalid_videos[0]
        sample = invalid_video_image_preview(first_url)
        raise HTTPException(
            status_code=400,
            detail=f"输入视频无法转换为 APIMart 支持的格式：{sample}\n原因：{first_reason}"
        )
    apimart_model = apimart_veo31_model(requested_model) if is_veo31 else ""
    if apimart_model == "veo3.1-lite" and payload.images:
        raise HTTPException(status_code=400, detail="veo3.1-lite 不支持图片输入，请改用 veo3.1-fast 或 veo3.1-quality。")
    image_limit = 0 if apimart_model == "veo3.1-lite" else (3 if is_veo31 else 9)
    for ref in payload.images[:image_limit]:
        if not ref.url:
            continue
        role = str(ref.role or "").strip()
        if not is_veo31 and role in {"first_frame", "last_frame", "reference_image"}:
            up_url = await upload_image_for_apimart(client, provider, ref.url)
            if valid_apimart_video_image_input(up_url):
                image_with_roles.append({"url": up_url, "role": role})
            else:
                reason = up_url[4:] if isinstance(up_url, str) and up_url.startswith("ERR:") else "未知错误"
                invalid_images.append((ref.url, reason))
    image_payload = []
    if not image_with_roles:
        for ref in payload.images[:image_limit]:
            if not ref.url:
                continue
            up_url = await upload_image_for_apimart(client, provider, ref.url)
            if valid_apimart_video_image_input(up_url):
                image_payload.append(up_url)
            else:
                reason = up_url[4:] if isinstance(up_url, str) and up_url.startswith("ERR:") else "未知错误"
                invalid_images.append((ref.url, reason))
    if payload.images and not image_with_roles and not image_payload:
        first_url, first_reason = invalid_images[0] if invalid_images else ("", "未知错误")
        sample = invalid_video_image_preview(first_url)
        raise HTTPException(status_code=400, detail=f"输入图片无法转换为视频接口支持的格式：{sample}\n原因：{first_reason}\n请确认本地文件存在且不超过 10MB；VEO3.1 需要图片是 APIMart 可访问的 http/https / asset:// / data URL。")
    # --- APIMart 请求体 ---
    if is_veo31:
        model = apimart_model
        body = {
            "prompt": payload.prompt,
            "model": model,
            "duration": apimart_veo31_duration(payload.duration),
            "aspect_ratio": apimart_veo31_aspect(payload.aspect_ratio),
            "resolution": apimart_veo31_resolution(payload.resolution),
        }
        if image_payload and model != "veo3.1-lite":
            video_images = image_payload[:3]
            if model == "veo3.1-quality" and len(video_images) > 2:
                video_images = video_images[:2]
            body["image_urls"] = video_images
            if len(video_images) == 2:
                body["generation_type"] = "frame"
            elif len(video_images) >= 3 and model != "veo3.1-quality":
                body["generation_type"] = "reference"
        if model != "veo3.1-lite":
            body["official_fallback"] = False
    else:
        body = {
            "prompt": payload.prompt,
            "model": selected_model(payload.model, "doubao-seedance-2.0"),
            "duration": apimart_video_duration(payload.duration),
            "size": apimart_video_size(payload.aspect_ratio or payload.size),
            "resolution": payload.resolution or "480p",
        }
        if image_with_roles and video_payload:
            raise HTTPException(status_code=400, detail="APIMart Seedance 的 image_with_roles 不能和 video_urls 同时使用，请只保留图片首尾帧或参考视频其中一种。")
        if image_with_roles:
            body["image_with_roles"] = image_with_roles
        elif image_payload:
            body["image_urls"] = image_payload[:9]
        if video_payload:
            body["video_urls"] = video_payload
        audio_payload = []
        invalid_audios = []
        for ref_url in (payload.audios or [])[:3]:
            ref_url = str(ref_url or "").strip()
            if not ref_url:
                continue
            normalized_audio_url = await upload_audio_for_apimart(client, provider, ref_url)
            if valid_apimart_video_image_input(normalized_audio_url):
                audio_payload.append(normalized_audio_url)
            else:
                reason = normalized_audio_url[4:] if isinstance(normalized_audio_url, str) and normalized_audio_url.startswith("ERR:") else "未知错误"
                invalid_audios.append((ref_url, reason))
        if invalid_audios:
            first_url, first_reason = invalid_audios[0]
            raise HTTPException(status_code=400, detail=f"参考音频无法转换为 APIMart 支持的地址：{invalid_video_image_preview(first_url)}\n原因：{first_reason}")
        if audio_payload:
            body["audio_urls"] = audio_payload
        if payload.trusted_asset:
            img_count = len(body.get("image_urls") or []) or len(image_with_roles)
            body["prompt"] = apply_trusted_asset_prompt_index(
                body["prompt"], img_count, len(video_payload), len(audio_payload)
            )
        if payload.seed is not None:
            body["seed"] = payload.seed
        if payload.return_last_frame:
            body["return_last_frame"] = True
        if payload.generate_audio:
            body["generate_audio"] = True
    return body


async def build_native_video_body(payload, is_volcengine, volc_is_proxy, is_yuli, *, HTTPException, apply_trusted_asset_prompt_index, looks_like_image_media_url, model_dump_compat, probe_local_audio_duration_seconds, reference_to_data_url, selected_model, volcengine_content_role, volcengine_media_reference_url, volcengine_video_duration, volcengine_video_reference_content_items, volcengine_video_resolution):
    # 非 APIMart：data URL 方式（OpenAI / ComflyAI 接口）
    if is_volcengine and not volc_is_proxy:
        text = str(payload.prompt or "").strip()
        volc_model = selected_model(payload.model, "doubao-seedance-2-0-fast-260128")
        body = {
            "model": volc_model,
            "content": [
                {
                    "type": "text",
                    "text": text,
                }
            ],
        }
        # 火山方舟视频接口（含 Seedance 2.0 图生视频）均通过 body 的 duration 字段控制时长；
        # 之前对 seedance-2.0 + 参考图的情况省略了 duration，导致接口回退到默认 5s。
        body["duration"] = volcengine_video_duration(payload.duration)
        if payload.aspect_ratio:
            body["ratio"] = payload.aspect_ratio
        resolution = volcengine_video_resolution(payload.resolution)
        if resolution:
            body["resolution"] = resolution
        if payload.watermark:
            body["watermark"] = True
        if payload.generate_audio:
            body["generate_audio"] = True
        if payload.camerafixed:
            body["camerafixed"] = True
        image_like_urls = set()
        frame_roles_used = {"first_frame": False, "last_frame": False}
        volc_video_count = 0

        def append_volcengine_image(url: str, role: str):
            if role in {"first_frame", "last_frame"}:
                if frame_roles_used.get(role):
                    return False
                frame_roles_used[role] = True
            elif role != "reference_image":
                return False
            body["content"].append({
                "type": "image_url",
                "image_url": {"url": url},
                "role": role,
            })
            image_like_urls.add(url)
            return True

        for ref in payload.images[:9]:
            url = volcengine_media_reference_url(ref.url, max_image_size=1536)
            if not url:
                continue
            role = volcengine_content_role(ref.role, "image")
            if role in {"first_frame", "last_frame"}:
                append_volcengine_image(url, role)
            elif payload.multimodal:
                # 智能多帧/多参模式：多张图作为参考图提交，不能全部伪装成首帧。
                append_volcengine_image(url, "reference_image")
            elif not frame_roles_used["first_frame"]:
                # 普通图生视频没有显式 role 时，只取第一张作为首帧。
                append_volcengine_image(url, "first_frame")
        for url in (payload.videos or [])[:3]:
            text_url = str(url or "").strip()
            if not text_url:
                continue
            media_url = volcengine_media_reference_url(text_url, max_image_size=1536 if looks_like_image_media_url(text_url) else None)
            if not media_url:
                continue
            if media_url in image_like_urls or looks_like_image_media_url(media_url):
                append_volcengine_image(media_url, "reference_image" if payload.multimodal else "first_frame")
                continue
            video_items = await volcengine_video_reference_content_items(media_url)
            body["content"].extend(video_items)
            volc_video_count += 1
        for url in (payload.audios or [])[:3]:
            duration = probe_local_audio_duration_seconds(url)
            if duration is not None and (duration < 1.8 or duration > 15.2):
                raise HTTPException(
                    status_code=400,
                    detail=f"参考音频时长 {duration:.2f} 秒超出范围：方舟 Seedance 参考音频要求在 1.8 ~ 15.2 秒之间，请裁剪后再插入。"
                )
            audio_url = volcengine_media_reference_url(url, max_image_size=None)
            if not audio_url:
                continue
            body["content"].append({
                "type": "audio_url",
                "audio_url": {"url": audio_url},
                "role": volcengine_content_role("", "audio"),
            })
        if payload.trusted_asset and body["content"] and body["content"][0].get("type") == "text":
            body["content"][0]["text"] = apply_trusted_asset_prompt_index(
                body["content"][0].get("text") or "", len(image_like_urls), volc_video_count, 0
            )
        if payload.seed is not None:
            body["seed"] = payload.seed
    elif is_yuli:
        # 玉玉API（yuli.host）视频走自有 veo 统一格式：POST /v1/video/create。
        # 字段：model / prompt / images[]（http(s) URL）/ enhance_prompt /
        # enable_upsample / aspect_ratio（仅 16:9、9:16）。无 duration 字段，
        # 时长由模型本身决定，所以这里不传 duration/seconds。
        yuli_images = []
        for ref in payload.images[:3]:
            ref_url = str(getattr(ref, "url", "") or "").strip()
            if not ref_url:
                continue
            if ref_url.startswith("http://") or ref_url.startswith("https://"):
                yuli_images.append(ref_url)
            else:
                # 本地/dataURL 图片转成 data URL 兜底传递
                data_url = reference_to_data_url(model_dump_compat(ref), max_size=1536)
                if data_url:
                    yuli_images.append(data_url)
        prompt_text = str(payload.prompt or "")
        # veo 只支持英文提示词：仅在含中文等非 ASCII 字符时才开启翻译增强，
        # 纯英文原样传递（避免增强改写时引入人物等触发安全过滤的描述）。
        needs_enhance = any(ord(ch) > 127 for ch in prompt_text)
        body = {
            "model": selected_model(payload.model, "veo3.1-fast"),
            "prompt": prompt_text,
            "enhance_prompt": needs_enhance,
        }
        if yuli_images:
            body["images"] = yuli_images
        ratio = str(payload.aspect_ratio or "").strip()
        if ratio in {"16:9", "9:16"}:
            body["aspect_ratio"] = ratio
        if payload.enable_upsample:
            body["enable_upsample"] = True
    else:
        image_payload = []
        for ref in payload.images[:4]:
            if ref.url:
                image_payload.append(reference_to_data_url(model_dump_compat(ref), max_size=1536))
        body = {
            "prompt": payload.prompt,
            "model": selected_model(payload.model, "veo3-fast"),
            "duration": payload.duration,
            "watermark": payload.watermark,
        }
        if payload.aspect_ratio:
            body["aspect_ratio"] = payload.aspect_ratio
            body["ratio"] = payload.aspect_ratio
        if payload.size:
            body["size"] = payload.size
        if payload.resolution:
            body["resolution"] = payload.resolution
        if image_payload:
            body["images"] = image_payload
        if payload.videos:
            body["videos"] = [v for v in payload.videos if v]
        if payload.enhance_prompt:
            body["enhance_prompt"] = True
        if payload.enable_upsample:
            body["enable_upsample"] = True
        if payload.seed is not None:
            body["seed"] = payload.seed
        if payload.camerafixed:
            body["camerafixed"] = True
        if payload.return_last_frame:
            body["return_last_frame"] = True
        if payload.generate_audio:
            body["generate_audio"] = True
    return body


def volcengine_content_role(role: str, kind: str='image'):
    value = str(role or "").strip().lower()
    allowed = {
        "first_frame", "last_frame", "reference_image",
        "reference_video", "reference_audio", "video", "audio", "image"
    }
    if value in allowed:
        if value == "audio" and kind == "audio":
            return "reference_audio"
        return "reference_video" if value == "video" and kind == "video" else value
    if kind == "audio":
        return "reference_audio"
    if kind == "video":
        return "reference_video"
    # 修复：未显式指定 role 的纯生图请求不应兜底为 reference_image，
    # 否则火山后端会误判为 r2v(参考图生视频)，导致 seedance/seedream 等生图模型失败。
    return None


def volcengine_video_duration(duration):
    try:
        value = int(duration)
    except Exception:
        value = 5
    return max(1, min(60, value))


def volcengine_video_resolution(value: str):
    text = str(value or "").strip().lower()
    aliases = {"": "", "auto": "", "480": "480p", "720": "720p", "1080": "1080p"}
    text = aliases.get(text, text)
    return text if text in {"480p", "720p", "1080p"} else ""


def is_volcengine_seedance2_model(model: str):
    value = str(model or "").strip().lower().replace("_", "-").replace(".", "-")
    return "seedance-2-0" in value


def apply_trusted_asset_prompt_index(prompt: str, image_count: int, video_count: int, audio_count: int):
    """可信素材模式下，按平台规则在 prompt 里补「图片N/视频N/音频N」索引。
    若用户已手动引用了某类素材（如已写「图片1」），则不重复追加该类。"""
    text = str(prompt or "").strip()
    segments = []
    for label, count in (("图片", image_count), ("视频", video_count), ("音频", audio_count)):
        if count <= 0:
            continue
        if any(f"{label}{i}" in text for i in range(1, count + 1)):
            continue
        segments.append("、".join(f"{label}{i}" for i in range(1, count + 1)))
    if not segments:
        return text
    hint = "参考素材：" + "，".join(segments) + "。"
    return f"{text}\n{hint}" if text else hint


def apimart_video_duration(duration):
    try:
        value = int(duration)
    except Exception:
        value = 5
    return max(4, min(15, value))


def apimart_veo31_duration(duration):
    try:
        value = int(duration)
    except Exception:
        value = 8
    # APIMart VEO 3.1 currently accepts a narrower duration window than
    # the generic UI. Clamp instead of silently forcing every request to 8s.
    return max(4, min(8, value))


def is_apimart_veo31_model(model: str):
    return str(model or "").strip().lower().startswith("veo3.1")


def apimart_veo31_model(model: str):
    value = str(model or "").strip().lower()
    aliases = {
        "veo3.1": "veo3.1-fast",
        "veo3.1-pro": "veo3.1-quality",
        "veo3.1-preview": "veo3.1-fast",
    }
    value = aliases.get(value, value or "veo3.1-fast")
    allowed = {"veo3.1-fast", "veo3.1-quality", "veo3.1-lite"}
    return value if value in allowed else "veo3.1-fast"


def apimart_veo31_aspect(aspect: str):
    value = str(aspect or "16:9").strip()
    return value if value in {"16:9", "9:16"} else "16:9"


def apimart_veo31_resolution(resolution: str):
    value = str(resolution or "").strip().lower()
    aliases = {"": "720p", "auto": "720p", "480p": "720p", "780p": "720p", "1080": "1080p", "4k": "4k"}
    value = aliases.get(value, value)
    return value if value in {"720p", "1080p", "4k"} else "720p"


def apimart_video_size(size):
    value = str(size or "16:9").strip()
    if value == "keep_ratio":
        return "adaptive"
    allowed = {"16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"}
    return value if value in allowed else "16:9"


def volcengine_video_prompt_text(prompt, aspect_ratio='', duration=None):
    text = str(prompt or "").strip()
    suffixes = []
    ratio = str(aspect_ratio or "").strip()
    if ratio:
        suffixes.append(f"--ratio {ratio}")
    if not suffixes:
        return text
    suffix_text = " ".join(suffixes)
    return f"{text} {suffix_text}".strip() if text else suffix_text
