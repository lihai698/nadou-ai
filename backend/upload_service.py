"""上传读取、素材落盘与ComfyUI分发执行。

应用注入大小限制、路径策略、HTTP客户端及错误工厂；不导入main，
不读取用户配置，保留原上传协议与批次处理语义。
"""
import base64
import mimetypes
import os
import uuid
import re
import shutil
import urllib.parse
import urllib.request

async def read_upload_file_limited(file, *, batch_state=None, file_limit, batch_limit, chunk_bytes, limit_error):
    """分块读取 UploadFile，并同时执行单文件与批次大小限制。"""
    filename = file.filename or "文件"
    chunks = []
    total = 0
    while True:
        chunk = await file.read(chunk_bytes)
        if not chunk:
            break
        total += len(chunk)
        if total > file_limit:
            raise limit_error(filename)
        if batch_state is not None:
            batch_total = int(batch_state.get("total", 0)) + len(chunk)
            if batch_total > batch_limit:
                raise limit_error(batch=True)
            batch_state["total"] = batch_total
        chunks.append(chunk)
    return b"".join(chunks)


async def upload_image(files, *, read_limited, get_instances, http, diagnostic, error_factory):
    uploaded_files = []
    batch_state = {"total": 0}
    for file in files:
        content = await read_limited(file, batch_state=batch_state)
        success_count = 0
        last_result = None
        for addr in get_instances():
            try:
                files_data = {'image': (file.filename, content, file.content_type)}
                response = http.post(f"http://{addr}/upload/image", files=files_data, timeout=5)
                if response.status_code == 200:
                    last_result = response.json()
                    success_count += 1
            except Exception as e:
                diagnostic(f"comfy upload failed error={type(e).__name__}")

        if success_count > 0 and last_result:
            uploaded_files.append({"comfy_name": last_result.get("name", file.filename)})
        else:
            raise error_factory(status_code=500, detail="Failed to upload to any backend")

    return {"files": uploaded_files}


async def upload_ai_reference(files, *, read_limited, output_path, output_url):
    uploaded = []
    image_exts = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
    video_exts = {".mp4", ".webm", ".mov", ".m4v", ".flv"}
    audio_exts = {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"}
    doc_exts = {".pdf", ".txt", ".md", ".markdown", ".doc", ".docx", ".xls", ".xlsx", ".csv", ".json", ".zip", ".yaml", ".yml", ".log"}
    batch_state = {"total": 0}
    for file in files:
        content = await read_limited(file, batch_state=batch_state)
        if not content:
            continue
        ext = os.path.splitext(file.filename or "")[1].lower()
        content_type = (file.content_type or "").lower()
        kind = "image"
        if ext in video_exts or content_type.startswith("video/"):
            kind = "video"
            if ext not in video_exts:
                ext = ".webm" if "webm" in content_type else ".mov" if "quicktime" in content_type else ".mp4"
        elif ext in audio_exts or content_type.startswith("audio/"):
            kind = "audio"
            if ext not in audio_exts:
                ext = ".wav" if "wav" in content_type else ".ogg" if "ogg" in content_type else ".m4a" if "mp4" in content_type else ".mp3"
        elif ext in image_exts or content_type.startswith("image/"):
            kind = "image"
            if ext not in image_exts:
                ext = ".jpg" if "jpeg" in content_type else ".webp" if "webp" in content_type else ".gif" if "gif" in content_type else ".png"
        elif ext in doc_exts or content_type.startswith(("text/", "application/")):
            kind = "file"
            if not ext:
                ext = mimetypes.guess_extension(content_type) or ".bin"
        else:
            kind = "file"
            if not ext:
                ext = ".bin"
        filename = f"ai_ref_{uuid.uuid4().hex[:12]}{ext}"
        path = output_path(filename, "input")
        with open(path, "wb") as f:
            f.write(content)
        uploaded.append({"url": output_url(filename, "input"), "name": file.filename or filename, "kind": kind, "mime": content_type})
    return {"files": uploaded}


async def upload_ai_base64(payload, *, size_hint, max_bytes, limit_error, kind_ext, output_path, output_url, error_factory):
    """以 base64 JSON 方式上传字节到 assets/input，返回 /assets 地址。
    给不便用 multipart/FormData 的客户端（如 PS UXP 面板）用——UXP 的 fetch+FormData 经常发不出有效 multipart。"""
    raw = size_hint((payload.data or "").strip())
    ct = (payload.content_type or "").split(";", 1)[0].strip().lower()
    if raw.startswith("data:"):
        header, _, raw = raw.partition(",")
        if not ct:
            ct = header[5:].split(";", 1)[0].strip().lower()
    try:
        content = base64.b64decode(raw, validate=False)
    except Exception:
        raise error_factory(status_code=400, detail="数据无法解码")
    if not content:
        raise error_factory(status_code=400, detail="内容为空")
    if len(content) > max_bytes:
        raise limit_error("Base64 数据")
    kind, ext = kind_ext(payload.name or "", ct or "image/png")
    if kind is None:
        kind, ext = "image", ".png"
    filename = f"ai_ref_{uuid.uuid4().hex[:12]}{ext}"
    path = output_path(filename, "input")
    with open(path, "wb") as f:
        f.write(content)
    return {"files": [{"url": output_url(filename, "input"), "name": payload.name or filename, "kind": kind}]}


async def upload_comfyui_base64(payload, *, size_hint, max_bytes, limit_error, kind_ext, get_instances, http, diagnostic, error_factory):
    """base64 方式把图片传到 ComfyUI 各后端的 input 目录，返回 comfy 用文件名（供 UXP 做 ComfyUI 图生图）。"""
    raw = size_hint((payload.data or "").strip())
    ct = (payload.content_type or "").split(";", 1)[0].strip().lower()
    if raw.startswith("data:"):
        header, _, raw = raw.partition(",")
        if not ct:
            ct = header[5:].split(";", 1)[0].strip().lower()
    try:
        content = base64.b64decode(raw, validate=False)
    except Exception:
        raise error_factory(status_code=400, detail="数据无法解码")
    if not content:
        raise error_factory(status_code=400, detail="内容为空")
    if len(content) > max_bytes:
        raise limit_error("Base64 数据")
    _, ext = kind_ext(payload.name or "", ct or "image/png")
    filename = f"dx_{uuid.uuid4().hex[:12]}{ext or '.png'}"
    comfy_name = None
    for addr in get_instances():
        try:
            resp = http.post(f"http://{addr}/upload/image",
                                 files={'image': (filename, content, ct or 'image/png')}, timeout=10)
            if resp.status_code == 200:
                comfy_name = resp.json().get("name", filename)
        except Exception as exc:
            diagnostic(f"comfy base64 upload failed error={type(exc).__name__}")
    if not comfy_name:
        raise error_factory(status_code=502, detail="上传到 ComfyUI 失败")
    return {"name": comfy_name}


def normalize_local_image_path(value, *, HTTPException):
    text = str(value or "").strip().strip('"').strip("'")
    if not text:
        raise HTTPException(status_code=400, detail="本地图片路径为空")
    if text.lower().startswith("file:"):
        parsed = urllib.parse.urlparse(text)
        if parsed.scheme.lower() != "file":
            raise HTTPException(status_code=400, detail="只支持本地图片路径")
        if parsed.netloc and re.match(r"^[a-zA-Z]:$", parsed.netloc) and os.name == "nt":
            path = f"{parsed.netloc}{urllib.request.url2pathname(parsed.path or '')}"
        elif parsed.netloc and parsed.netloc.lower() not in ("localhost",):
            raise HTTPException(status_code=400, detail="只支持本机图片路径")
        else:
            path = urllib.request.url2pathname(parsed.path or "")
    else:
        path = text
    path = path.strip().strip('"').strip("'")
    if re.match(r"^/[a-zA-Z]:[\\/]", path):
        path = path[1:]
    if re.match(r"^[a-zA-Z]:[\\/]", path):
        return os.path.abspath(path)
    if path.startswith("/") and os.name != "nt":
        return os.path.abspath(path)
    raise HTTPException(status_code=400, detail="只支持本机绝对图片路径")


def import_local_image_file(path, *, HTTPException, LOCAL_IMAGE_IMPORT_EXTS, LOCAL_IMAGE_IMPORT_MAX_BYTES, Image, output_path_for, output_url_for):
    ext = os.path.splitext(path)[1].lower()
    if ext not in LOCAL_IMAGE_IMPORT_EXTS:
        raise HTTPException(status_code=400, detail="仅支持 PNG、JPG、JPEG、WEBP、GIF 图片")
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="本地图片不存在或无法读取")
    try:
        size = os.path.getsize(path)
    except OSError:
        raise HTTPException(status_code=404, detail="本地图片不存在或无法读取")
    if size <= 0:
        raise HTTPException(status_code=400, detail="本地图片为空")
    if size > LOCAL_IMAGE_IMPORT_MAX_BYTES:
        raise HTTPException(status_code=413, detail="本地图片过大，请使用 50MB 以内的图片")
    try:
        with Image.open(path) as img:
            img.verify()
    except Exception:
        raise HTTPException(status_code=400, detail="文件不是可识别的图片")
    filename = f"ai_ref_{uuid.uuid4().hex[:12]}{ext}"
    dest = output_path_for(filename, "input")
    try:
        shutil.copyfile(path, dest)
    except OSError:
        raise HTTPException(status_code=500, detail="导入本地图片失败")
    return {"url": output_url_for(filename, "input"), "name": os.path.basename(path) or filename, "kind": "image"}

