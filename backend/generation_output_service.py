"""生成图片和视频的输出落盘与尺寸元数据。

复用应用的输出路径与URL映射；网络客户端与诊断由应用显式注入。
"""
import os
import re

async def save_ai_image_to_output(image_data, prefix='online_', category='output', *, base64, httpx, log_net_error, output_path_for, output_url_for, rewrite_runninghub_file_url, uuid):
    filename = f"{prefix}{uuid.uuid4().hex[:10]}.png"
    path = output_path_for(filename, category)
    if image_data["type"] == "b64":
        mime_type = str(image_data.get("mime_type") or "").lower()
        if "jpeg" in mime_type or "jpg" in mime_type:
            filename = filename[:-4] + ".jpg"
            path = output_path_for(filename, category)
        elif "webp" in mime_type:
            filename = filename[:-4] + ".webp"
            path = output_path_for(filename, category)
        with open(path, "wb") as f:
            f.write(base64.b64decode(image_data["value"]))
        return output_url_for(filename, category)
    value = image_data["value"]
    if value.startswith("/output/") or value.startswith("/assets/"):
        return value
    value = rewrite_runninghub_file_url(value)
    try:
        timeout = httpx.Timeout(connect=20.0, read=300.0, write=60.0, pool=20.0)
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            response = await client.get(value)
            response.raise_for_status()
            content_type = response.headers.get("Content-Type", "")
            if "jpeg" in content_type or "jpg" in content_type:
                filename = filename[:-4] + ".jpg"
                path = output_path_for(filename, category)
            elif "webp" in content_type:
                filename = filename[:-4] + ".webp"
                path = output_path_for(filename, category)
            with open(path, "wb") as f:
                f.write(response.content)
            return output_url_for(filename, category)
    except Exception as e:
        log_net_error("保存上游图片失败", e, value)
        return value


def image_output_meta(url, source_item=None, *, Image, output_file_from_url, urllib):
    meta = {"url": url, "kind": "image"}
    if not url:
        return meta
    parsed_name = os.path.basename(urllib.parse.urlparse(str(url)).path)
    if parsed_name:
        meta["name"] = parsed_name
    if isinstance(source_item, dict):
        for key in ("natural_w", "natural_h", "width", "height", "w", "h", "layout_w", "layout_h"):
            try:
                value = int(float(source_item.get(key) or 0))
            except (TypeError, ValueError):
                value = 0
            if value > 0:
                meta[key] = value
    path = output_file_from_url(url)
    if path and os.path.exists(path):
        try:
            with Image.open(path) as img:
                width, height = img.size
            if width > 0 and height > 0:
                meta.update({
                    "natural_w": width,
                    "natural_h": height,
                    "width": width,
                    "height": height,
                })
        except Exception:
            pass
    return meta


async def save_remote_video_to_output(url, prefix='video_', category='output', *, VIDEO_POLL_TIMEOUT, httpx, output_path_for, output_url_for, urllib, uuid, write_diagnostic):
    if not url:
        return ""
    if url.startswith("/output/") or url.startswith("/assets/"):
        return url
    video_exts = {".mp4", ".webm", ".mov", ".m4v", ".avi", ".mkv", ".flv"}
    parsed = urllib.parse.urlparse(str(url or "").strip())
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return url
    clean_ext = os.path.splitext(parsed.path)[1].lower()
    stem = f"{prefix}{uuid.uuid4().hex[:10]}"
    filename = f"{stem}{clean_ext if clean_ext in video_exts else '.mp4'}"
    path = output_path_for(filename, category)
    try:
        timeout = httpx.Timeout(connect=20.0, read=VIDEO_POLL_TIMEOUT, write=60.0, pool=20.0)
        headers = {
            "User-Agent": "ComfyUI-API-Modelscope/1.0",
            "Accept": "video/*,application/octet-stream,*/*;q=0.8",
        }
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True, headers=headers) as client:
            response = await client.get(url)
            response.raise_for_status()
            content_type = (response.headers.get("Content-Type") or "").lower()
            if "text/html" in content_type or "application/json" in content_type:
                raise RuntimeError(f"unexpected video content type: {content_type}")
            ext = clean_ext
            if ext in video_exts:
                filename = f"{stem}{ext}"
                path = output_path_for(filename, category)
            elif "webm" in content_type:
                filename = f"{stem}.webm"
                path = output_path_for(filename, category)
            elif "quicktime" in content_type or "mov" in content_type:
                filename = f"{stem}.mov"
                path = output_path_for(filename, category)
            elif "x-matroska" in content_type or "mkv" in content_type:
                filename = f"{stem}.mkv"
                path = output_path_for(filename, category)
            elif "x-flv" in content_type or "flv" in content_type:
                filename = f"{stem}.flv"
                path = output_path_for(filename, category)
            with open(path, "wb") as f:
                f.write(response.content)
            if os.path.getsize(path) <= 0:
                raise RuntimeError("empty video response")
            return output_url_for(filename, category)
    except Exception as e:
        write_diagnostic(f"upstream video save failed error={type(e).__name__}")
        try:
            if os.path.exists(path):
                os.remove(path)
        except Exception:
            pass
        return url



async def save_video_bytes_to_output(data, prefix='video_', ext='.mp4', *, HTTPException, output_path_for, output_url_for, uuid):
    if not data:
        raise HTTPException(status_code=502, detail="上游视频下载为空")
    extension = ext if ext in {".mp4", ".webm", ".mov", ".m4v", ".avi", ".mkv", ".flv"} else ".mp4"
    filename = f"{prefix}{uuid.uuid4().hex[:10]}{extension}"
    path = output_path_for(filename, "output")
    with open(path, "wb") as file:
        file.write(data)
    if os.path.getsize(path) <= 0:
        raise HTTPException(status_code=502, detail="上游视频下载为空")
    return output_url_for(filename, "output")


