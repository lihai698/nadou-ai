"""供应商媒体引用上传、公开地址适配和临时云端链接。

HTTP客户端、凭据头、媒体路径与公开地址配置均由应用显式提供；不在导入时读取配置或上传。
"""
import os
import re

def local_asset_public_url(value, *, output_file_from_url, public_base_url, public_media_url_suffix, urllib):
    text = str(value or "").strip()
    if not text.startswith(("/output/", "/assets/")):
        return ""
    if not output_file_from_url(text):
        return ""
    base = public_base_url()
    if not base:
        return ""
    return f"{base}{urllib.parse.quote(text, safe='/:?&=%#.-_~')}{public_media_url_suffix()}"


async def openai_video_proxy_public_reference_url(ref, *, HTTPException, local_asset_public_url, output_file_from_url, public_error_detail, safe_cli_public_text, upload_local_video_to_cloud, urllib):
    """异步生图（openai-video-proxy）的参考图公网化。
    不走公网隧道（暴露本机服务风险高）：本地文件上传图床（Litterbox/temp.sh，72h 短链），
    与 RS 模式同一通道；真正的公网 URL 原样透传；若手动配置了 PUBLIC_MEDIA_BASE_URL 则作为兜底。"""
    raw = ref.get("url", "") if isinstance(ref, dict) else ref
    text = str(raw or "").strip()
    if not text:
        return ""
    parsed = urllib.parse.urlsplit(text)
    local_path = ""
    if parsed.scheme in {"http", "https"}:
        host = (parsed.hostname or "").lower()
        if host in {"127.0.0.1", "localhost", "::1"} or re.match(r"^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)", host):
            local_path = urllib.parse.unquote(parsed.path or "")
        else:
            return text
    elif text.startswith(("/output/", "/assets/")):
        local_path = text
    if local_path and output_file_from_url(local_path):
        upload_error = ""
        try:
            uploaded = await upload_local_video_to_cloud(local_path)
            url = str((uploaded or {}).get("url") or "")
            if url.startswith(("http://", "https://")):
                return url
        except HTTPException as exc:
            upload_error = public_error_detail(exc.detail, fallback="未知错误", limit=200)
        public_url = local_asset_public_url(local_path)
        if public_url:
            return public_url
        raise HTTPException(
            status_code=400,
            detail=f"参考图上传图床失败，无法转成公网 URL：{safe_cli_public_text(upload_error, 200) or '未知错误'}。请检查网络后重试。"
        )
    raise HTTPException(status_code=400, detail="参考图不是公网 URL，无法传给上游，请改用公网图片地址。")


def openai_video_proxy_local_image_path(ref, *, content_type_for_path, output_file_from_url, urllib):
    raw = ref.get("url", "") if isinstance(ref, dict) else ref
    text = str(raw or "").strip()
    if not text:
        return ""
    local_path = ""
    if re.match(r"^https?://", text, re.I):
        parsed = urllib.parse.urlsplit(text)
        host = (parsed.hostname or "").lower()
        if host in {"127.0.0.1", "localhost", "::1"} or re.match(r"^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)", host):
            local_path = urllib.parse.unquote(parsed.path or "")
    elif text.startswith(("/output/", "/assets/")):
        local_path = text
    path = output_file_from_url(local_path) if local_path else None
    if not path:
        return ""
    return path if content_type_for_path(path).startswith("image/") else ""


def normalize_apimart_video_reference(value, *, local_asset_public_url, valid_apimart_video_image_input):
    text = str(value or "").strip()
    if valid_apimart_video_image_input(text):
        return text
    return local_asset_public_url(text)


def apimart_video_reference_error(value, *, output_file_from_url):
    text = str(value or "").strip()
    if not text:
        return "空的视频地址"
    if text.startswith(("/output/", "/assets/")):
        if not output_file_from_url(text):
            return "这是本地画布文件路径，但后端没有找到对应文件，请重新上传视频后再试。"
        return (
            "这是本地画布文件，APIMart 无法访问 127.0.0.1/局域网路径；"
            "请在 API/.env 配置 PUBLIC_MEDIA_BASE_URL 或 PUBLIC_BASE_URL 为可公网访问的媒体地址（例如内网穿透 HTTPS 地址），"
            "或改用公网 http/https 视频 URL、审核后的 asset:// 地址。"
        )
    if text.startswith("data:") or text.startswith("blob:") or text.startswith("file:"):
        return (
            "APIMart 的 video_urls 不支持 data/blob/file 地址；"
            "请改用公网 http/https 视频 URL，或审核后的 asset:// 地址。"
        )
    return "APIMart 的 video_urls 只支持公网 http/https URL 或 asset:// 私域素材 URL。"


def apimart_upload_file_payload(path, *, BytesIO, Image, content_type_for_path):
    """Return (filename, bytes, content_type), keeping APIMart VEO images under the documented 10MB limit."""
    max_bytes = 9_500_000
    size = os.path.getsize(path)
    if size <= max_bytes:
        with open(path, "rb") as fh:
            return os.path.basename(path), fh.read(), content_type_for_path(path)
    with Image.open(path) as img:
        img = img.convert("RGBA")
        bg = Image.new("RGB", img.size, (255, 255, 255))
        bg.paste(img, mask=img.split()[-1])
        quality = 92
        while quality >= 62:
            buf = BytesIO()
            bg.save(buf, format="JPEG", quality=quality, optimize=True)
            data = buf.getvalue()
            if len(data) <= max_bytes:
                name = os.path.splitext(os.path.basename(path))[0] + ".jpg"
                return name, data, "image/jpeg"
            quality -= 8
    raise ValueError("图片超过 10MB，且压缩后仍无法满足 VEO3.1 图片限制")


def invalid_video_image_preview(value, *, safe_cli_public_text):
    text = str(value or "")
    if text.startswith("data:"):
        return text.split(";base64,", 1)[0] + ";base64,..."
    return safe_cli_public_text(text, 120)


def extract_apimart_asset_url(payload, *, extract_apimart_asset_url, valid_apimart_video_image_input):
    if isinstance(payload, list):
        for item in payload:
            found = extract_apimart_asset_url(item)
            if found:
                return found
        return ""
    if not isinstance(payload, dict):
        return ""
    url_keys = ("url", "asset_url", "assetUrl", "uri", "file_url", "fileUrl")
    for key in url_keys:
        value = str(payload.get(key) or "").strip()
        if valid_apimart_video_image_input(value):
            return value
    id_keys = ("asset_id", "assetId", "file_id", "fileId", "id")
    for key in id_keys:
        value = str(payload.get(key) or "").strip()
        if value:
            return value if value.startswith("asset://") else f"asset://{value}"
    for key in ("data", "file", "asset", "result"):
        found = extract_apimart_asset_url(payload.get(key))
        if found:
            return found
    return ""


def apimart_upload_payload_from_bytes(data, mime, name_hint='image', *, BytesIO, Image, mimetypes):
    """把内存中的图片字节按 APIMart 的 10MB 限制压缩为可上传 payload。"""
    max_bytes = 9_500_000
    ext = mimetypes.guess_extension(mime or "image/png") or ".png"
    if len(data) <= max_bytes and (mime or "").lower() in ("image/png", "image/jpeg", "image/webp"):
        return f"{name_hint}{ext}", data, (mime or "image/png")
    with Image.open(BytesIO(data)) as img:
        has_alpha = img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)
        if has_alpha:
            base = img.convert("RGBA")
            bg = Image.new("RGB", base.size, (255, 255, 255))
            bg.paste(base, mask=base.split()[-1])
            target = bg
        else:
            target = img.convert("RGB")
        quality = 92
        while quality >= 62:
            buf = BytesIO()
            target.save(buf, format="JPEG", quality=quality, optimize=True)
            payload = buf.getvalue()
            if len(payload) <= max_bytes:
                return f"{name_hint}.jpg", payload, "image/jpeg"
            quality -= 8
    raise ValueError("data URL 图片超过 10MB，且压缩后仍无法满足 APIMart 限制")


def apimart_upload_raw_file_payload(path, *, content_type_for_path):
    with open(path, "rb") as fh:
        return os.path.basename(path), fh.read(), content_type_for_path(path)


async def apimart_upload_post(client, upload_url, headers, file_tuple, timeout=60, *, APIMART_UPLOAD_RETRY_ATTEMPTS, asyncio, httpx, is_transient_tls_error, log_net_error):
    """上传文件到 APIMart，对瞬时 TLS 错误自动重试；重试时改用全新连接，避免复用坏掉的 TLS 连接。
    file_tuple 形如 (filename, content_bytes, content_type)，content 为已读入内存的 bytes，可跨重试复用。"""
    last_exc = None
    for attempt in range(APIMART_UPLOAD_RETRY_ATTEMPTS):
        files = {"file": file_tuple}
        try:
            if attempt == 0:
                return await client.post(upload_url, headers=headers, files=files, timeout=timeout)
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(connect=20.0, read=max(120.0, float(timeout)), write=120.0, pool=20.0),
                follow_redirects=True,
            ) as fresh:
                return await fresh.post(upload_url, headers=headers, files=files, timeout=timeout)
        except Exception as e:
            if not is_transient_tls_error(e) or attempt == APIMART_UPLOAD_RETRY_ATTEMPTS - 1:
                raise
            last_exc = e
            log_net_error(f"APIMart 上传瞬时 TLS 错误，第 {attempt + 1} 次重试", e, upload_url)
            await asyncio.sleep(0.6 * (attempt + 1))
    if last_exc:
        raise last_exc


async def upload_image_for_apimart(client, provider, ref_url, *, _safe_upstream_text, api_headers, apimart_upload_file_payload, apimart_upload_payload_from_bytes, apimart_upload_post, base64, extract_apimart_asset_url, log_net_error, output_file_from_url, valid_apimart_video_image_input, video_api_root, write_diagnostic):
    """把本地图片转成上游可接受的输入。
    按 APIMart 文档上传到 /v1/uploads/images，拿到可用于生成接口的 http/https URL。
    绝不把 /output/* 或 /assets/* 这类本地路径直接传给上游。
    返回上游可用 URL；返回值以 "ERR:" 开头表示具体失败原因（供前端展示）。"""
    ref_url = str(ref_url or "").strip()
    if not ref_url:
        return "ERR:空地址"
    # 已经是网络 URL 或 asset:// → 直接可用，无需上传
    if ref_url.startswith("http://") or ref_url.startswith("https://") or ref_url.startswith("asset://"):
        return ref_url
    base_url = video_api_root(provider)
    upload_url = f"{base_url}/v1/uploads/images"
    # data URL: 解码后直接上传到 APIMart
    if ref_url.startswith("data:"):
        try:
            if ";base64," not in ref_url:
                return "ERR:不支持的 data URL（缺少 base64 段）"
            header, encoded = ref_url.split(";base64,", 1)
            mime = header.split(":", 1)[1].split(";", 1)[0] if ":" in header else "image/png"
            raw = base64.b64decode(encoded)
            filename, content, ct = apimart_upload_payload_from_bytes(raw, mime, name_hint="canvas_image")
            resp = await apimart_upload_post(client, upload_url, api_headers(json_body=False, provider=provider), (filename, content, ct), timeout=60)
            if resp.status_code in (200, 201):
                rj = resp.json()
                url = extract_apimart_asset_url(rj)
                if valid_apimart_video_image_input(url):
                    return url
                write_diagnostic("APIMart data URL upload response missing asset_url")
                return "ERR:APIMart 上传响应未包含可用 URL"
            write_diagnostic(f"APIMart data URL upload rejected status={resp.status_code}")
            return f"ERR:APIMart 上传失败({resp.status_code})"
        except ValueError as e:
            return f"ERR:{_safe_upstream_text(e, 160)}"
        except Exception as e:
            log_net_error("APIMart 上传 data URL 异常", e, upload_url)
            return "ERR:上传异常，请检查网络或图片文件"
    # 本地 /output/ 或 /assets/ 路径：先确认文件存在再上传
    if ref_url.startswith("/output/") or ref_url.startswith("/assets/"):
        path = output_file_from_url(ref_url)
        if not path:
            write_diagnostic("APIMart local image upload skipped reason=missing_file")
            return "ERR:本地文件不存在或已被删除"
        try:
            filename, content, ct = apimart_upload_file_payload(path)
            resp = await apimart_upload_post(client, upload_url, api_headers(json_body=False, provider=provider), (filename, content, ct), timeout=60)
            if resp.status_code in (200, 201):
                rj = resp.json()
                url = extract_apimart_asset_url(rj)
                if valid_apimart_video_image_input(url):
                    return url
                write_diagnostic("APIMart file upload response missing asset_url")
                return "ERR:APIMart 上传响应未包含可用 URL"
            write_diagnostic(f"APIMart file upload rejected status={resp.status_code}")
            return f"ERR:APIMart 上传失败({resp.status_code})"
        except ValueError as e:
            return f"ERR:{_safe_upstream_text(e, 160)}"
        except Exception as e:
            log_net_error("APIMart 文件上传异常", e, upload_url)
            return "ERR:上传异常，请检查网络或图片文件"
    return "ERR:不支持的图片来源（仅支持 http/https/asset/data 或本地 /output/ /assets/ 路径）"


async def upload_video_for_apimart(client, provider, ref_url, *, api_headers, apimart_upload_raw_file_payload, apimart_video_reference_error, content_type_for_path, extract_apimart_asset_url, local_asset_public_url, log_net_error, output_file_from_url, upstream_response_error_summary, valid_apimart_video_image_input, video_api_root, write_diagnostic):
    """尽力把本地参考视频转换为 APIMart 可接受的 http/https 或 asset:// URL。
    文档只公开了图片上传；如果视频上传端点不可用，会回退到 PUBLIC_BASE_URL 方案。"""
    ref_url = str(ref_url or "").strip()
    if not ref_url:
        return "ERR:空地址"
    if valid_apimart_video_image_input(ref_url):
        return ref_url
    public_url = local_asset_public_url(ref_url)
    if public_url:
        return public_url
    if not (ref_url.startswith("/output/") or ref_url.startswith("/assets/")):
        return f"ERR:{apimart_video_reference_error(ref_url)}"
    path = output_file_from_url(ref_url)
    if not path:
        return "ERR:本地视频不存在或已被删除"
    ct = content_type_for_path(path)
    if not ct.startswith("video/"):
        return "ERR:参考视频不是可识别的视频文件"
    if str(os.getenv("APIMART_TRY_VIDEO_UPLOAD") or "").strip().lower() not in {"1", "true", "yes", "on"}:
        return f"ERR:{apimart_video_reference_error(ref_url)}"
    base_url = video_api_root(provider)
    filename, content, content_type = apimart_upload_raw_file_payload(path)
    upload_paths = ("/v1/uploads/videos", "/v1/uploads/files", "/v1/uploads/images")
    last_error = ""
    for upload_path in upload_paths:
        upload_url = f"{base_url}{upload_path}"
        try:
            files = {"file": (filename, content, content_type)}
            resp = await client.post(upload_url, headers=api_headers(json_body=False, provider=provider), files=files, timeout=180)
            if resp.status_code in (200, 201):
                rj = resp.json()
                url = extract_apimart_asset_url(rj)
                if valid_apimart_video_image_input(url):
                    return url
                last_error = "上传响应未包含可用 URL"
                write_diagnostic("APIMart video upload response missing asset_url")
                continue
            last_error = f"{upload_path} 返回 {resp.status_code}: {upstream_response_error_summary(resp, limit=200)}"
            write_diagnostic(f"APIMart video upload rejected status={resp.status_code}")
        except Exception as e:
            last_error = f"{upload_path} 上传异常，请检查网络或视频文件"
            log_net_error(f"APIMart 视频上传异常 endpoint={upload_path}", e, upload_url)
    return f"ERR:APIMart 未提供可用的视频文件上传入口（{last_error}）。请配置 PUBLIC_BASE_URL，或使用公网 http/https / asset:// 视频地址。"


async def upload_audio_for_apimart(client, provider, ref_url, *, _safe_upstream_text, api_headers, apimart_upload_raw_file_payload, apimart_video_reference_error, base64, content_type_for_path, extract_apimart_asset_url, local_asset_public_url, log_net_error, mimetypes, output_file_from_url, upstream_response_error_summary, valid_apimart_video_image_input, video_api_root):
    """把本地参考音频转换为 APIMart 可接受的 http/https 或 asset:// URL。
    优先用公网地址（PUBLIC_BASE_URL），否则尝试上传到 APIMart 文件端点。
    返回值以 "ERR:" 开头表示失败原因。"""
    ref_url = str(ref_url or "").strip()
    if not ref_url:
        return "ERR:空地址"
    if valid_apimart_video_image_input(ref_url):
        return ref_url
    public_url = local_asset_public_url(ref_url)
    if public_url:
        return public_url
    base_url = video_api_root(provider)
    upload_paths = ("/v1/uploads/audios", "/v1/uploads/files", "/v1/uploads/images")
    last_error = ""
    if ref_url.startswith("data:"):
        if ";base64," not in ref_url:
            return "ERR:不支持的 data URL（缺少 base64 段）"
        header, encoded = ref_url.split(";base64,", 1)
        mime = header.split(":", 1)[1].split(";", 1)[0] if ":" in header else "audio/mpeg"
        try:
            raw = base64.b64decode(encoded)
        except Exception as exc:
            return f"ERR:音频 data URL 解码失败：{_safe_upstream_text(exc, 160)}"
        ext = mimetypes.guess_extension(mime) or ".mp3"
        filename, content, content_type = (f"canvas_audio{ext}", raw, mime or "audio/mpeg")
    elif ref_url.startswith("/output/") or ref_url.startswith("/assets/"):
        path = output_file_from_url(ref_url)
        if not path:
            return "ERR:本地音频不存在或已被删除"
        ct = content_type_for_path(path)
        if not ct.startswith("audio/"):
            return "ERR:参考音频不是可识别的音频文件"
        filename, content, content_type = apimart_upload_raw_file_payload(path)
    else:
        return f"ERR:{apimart_video_reference_error(ref_url)}"
    for upload_path in upload_paths:
        upload_url = f"{base_url}{upload_path}"
        try:
            files = {"file": (filename, content, content_type)}
            resp = await client.post(upload_url, headers=api_headers(json_body=False, provider=provider), files=files, timeout=180)
            if resp.status_code in (200, 201):
                rj = resp.json()
                url = extract_apimart_asset_url(rj)
                if valid_apimart_video_image_input(url):
                    return url
                last_error = "上传响应未包含可用 URL"
                continue
            last_error = f"{upload_path} 返回 {resp.status_code}: {upstream_response_error_summary(resp, limit=200)}"
        except Exception as exc:
            last_error = f"{upload_path} 上传异常，请检查网络或音频文件"
            log_net_error(f"APIMart 音频上传异常 endpoint={upload_path}", exc, upload_url)
    return f"ERR:APIMart 未提供可用的音频文件上传入口（{last_error}）。请配置 PUBLIC_BASE_URL，或使用公网 http/https / asset:// 音频地址。"


async def upload_media_for_apimart(client, provider, ref_url, kind, *, upload_audio_for_apimart, upload_image_for_apimart, upload_video_for_apimart):
    """按 kind 分派到对应的 APIMart 上传器，拿回上游可用的 http/https/asset:// URL。"""
    if kind == "video":
        return await upload_video_for_apimart(client, provider, ref_url)
    if kind == "audio":
        return await upload_audio_for_apimart(client, provider, ref_url)
    return await upload_image_for_apimart(client, provider, ref_url)


def local_media_path_for_cloud_upload(ref_url, allowed_prefixes=('image/', 'video/'), *, HTTPException, content_type_for_path, output_file_from_url):
    ref_url = str(ref_url or "").strip()
    if not ref_url:
        raise HTTPException(status_code=400, detail="没有可上传的媒体文件")
    if ref_url.startswith("http://") or ref_url.startswith("https://"):
        return ""
    if not (ref_url.startswith("/output/") or ref_url.startswith("/assets/")):
        raise HTTPException(status_code=400, detail="云端上传只支持画布里的本地图片或视频文件")
    path = output_file_from_url(ref_url)
    if not path:
        raise HTTPException(status_code=404, detail="本地媒体文件不存在或已被删除")
    ct = content_type_for_path(path)
    if not any(ct.startswith(prefix) for prefix in allowed_prefixes):
        raise HTTPException(status_code=400, detail="请选择图片或视频文件再上传云端")
    max_bytes = int(os.getenv("TEMP_SH_MAX_BYTES", str(4 * 1024 * 1024 * 1024)))
    size = os.path.getsize(path)
    if size > max_bytes:
        raise HTTPException(status_code=400, detail=f"媒体文件超过云端上传大小限制：{size} bytes")
    return path


async def upload_video_to_litterbox(path, source_url, *, HTTPException, content_type_for_path, httpx, safe_upstream_http_detail):
    upload_url = os.getenv("LITTERBOX_UPLOAD_URL", "https://litterbox.catbox.moe/resources/internals/api.php").strip() or "https://litterbox.catbox.moe/resources/internals/api.php"
    time_value = os.getenv("LITTERBOX_TIME", "72h").strip() or "72h"
    ct = content_type_for_path(path)
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(connect=20.0, read=600.0, write=600.0, pool=20.0), follow_redirects=True) as client:
            with open(path, "rb") as fh:
                files = {"fileToUpload": (os.path.basename(path), fh, ct)}
                data = {"reqtype": "fileupload", "time": time_value}
                response = await client.post(upload_url, data=data, files=files)
        if not response.is_success:
            raise HTTPException(status_code=response.status_code, detail=safe_upstream_http_detail(response, "Litterbox 上传失败"))
        direct_url = response.text.strip().splitlines()[0].strip()
        if not re.match(r"^https?://", direct_url, re.I):
            raise HTTPException(status_code=502, detail="Litterbox 返回了无法识别的链接")
        return {"url": direct_url, "source": source_url, "name": os.path.basename(path), "expires": time_value, "service": "litterbox"}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Litterbox 上传异常（{type(exc).__name__}）") from exc


async def upload_video_to_temp_sh(path, source_url, *, HTTPException, content_type_for_path, httpx, safe_upstream_http_detail):
    upload_url = os.getenv("TEMP_SH_UPLOAD_URL", "https://temp.sh/upload").strip() or "https://temp.sh/upload"
    ct = content_type_for_path(path)
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(connect=20.0, read=600.0, write=600.0, pool=20.0), follow_redirects=True) as client:
            with open(path, "rb") as fh:
                files = {"file": (os.path.basename(path), fh, ct)}
                response = await client.post(upload_url, files=files)
        if not response.is_success:
            raise HTTPException(status_code=response.status_code, detail=safe_upstream_http_detail(response, "Temp.sh 上传失败"))
        direct_url = response.text.strip().splitlines()[0].strip()
        if not re.match(r"^https?://", direct_url, re.I):
            raise HTTPException(status_code=502, detail="Temp.sh 返回了无法识别的链接")
        return {"url": direct_url, "source": source_url, "name": os.path.basename(path), "expires": "3 days", "service": "temp.sh"}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Temp.sh 上传异常（{type(exc).__name__}）") from exc


async def upload_local_video_to_cloud(ref_url, service='auto', *, HTTPException, local_media_path_for_cloud_upload, upload_video_to_litterbox, upload_video_to_temp_sh):
    ref_url = str(ref_url or "").strip()
    if ref_url.startswith("http://") or ref_url.startswith("https://"):
        return {"url": ref_url, "source": ref_url, "service": "existing"}
    path = local_media_path_for_cloud_upload(ref_url)
    service = str(service or os.getenv("CLOUD_VIDEO_UPLOAD_SERVICE", "auto") or "auto").strip().lower()
    if service in {"litterbox", "catbox"}:
        return await upload_video_to_litterbox(path, ref_url)
    if service in {"temp", "temp.sh", "tempsh"}:
        return await upload_video_to_temp_sh(path, ref_url)
    errors = []
    for name, func in (("litterbox", upload_video_to_litterbox), ("temp.sh", upload_video_to_temp_sh)):
        try:
            return await func(path, ref_url)
        except HTTPException as exc:
            errors.append(f"{name}: {exc.detail}")
    raise HTTPException(status_code=502, detail="云端上传失败：" + "；".join(errors))


