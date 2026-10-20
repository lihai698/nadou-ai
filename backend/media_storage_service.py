"""媒体存储浏览、文件读取/清理和预览转换。

索引、文件、锁和供应商调用由应用显式注入，保留现有提交/清理顺序。
"""
import os
import tempfile
import asyncio
import hashlib
import json
import urllib.parse
from typing import Optional

def image_has_alpha(img):
    if img.mode in ("RGBA", "LA"):
        return True
    if img.mode == "P":
        return "transparency" in img.info
    return False


def storage_file_item(kind, root, path, *, Image):
    rel = os.path.relpath(path, root).replace("\\", "/")
    try:
        stat = os.stat(path)
    except OSError:
        return None
    item = {
        "id": f"{kind}:{rel}",
        "kind": kind,
        "rel": rel,
        "name": os.path.basename(path),
        "folder": os.path.dirname(rel).replace("\\", "/"),
        "url": f"/api/storage-files/{kind}/{urllib.parse.quote(rel, safe='/')}",
        "size": stat.st_size,
        "created_at": stat.st_mtime,
    }
    try:
        with Image.open(path) as img:
            item["width"], item["height"] = img.size
    except Exception:
        pass
    return item


async def list_storage_files(kind='generated', offset=0, limit=80, *, STORAGE_IMAGE_EXTS, storage_file_item, storage_kind_dir):
    root = storage_kind_dir(kind)
    os.makedirs(root, exist_ok=True)
    offset = max(0, int(offset or 0))
    limit = max(20, min(200, int(limit or 80)))
    items = []
    for current, dirs, files in os.walk(root):
        dirs[:] = sorted([d for d in dirs if not d.startswith(".") and not d.startswith("._")], key=str.lower)
        for name in sorted(files, key=str.lower):
            if name.startswith(".") or name.startswith("._"):
                continue
            if os.path.splitext(name)[1].lower() not in STORAGE_IMAGE_EXTS:
                continue
            item = storage_file_item(kind, root, os.path.join(current, name))
            if item:
                items.append(item)
    items.sort(key=lambda item: item.get("created_at") or 0, reverse=True)
    total = len(items)
    page_items = items[offset:offset + limit]
    return {
        "kind": kind,
        "root": root,
        "items": page_items,
        "total": total,
        "offset": offset,
        "limit": limit,
        "has_more": offset + len(page_items) < total,
    }


async def get_storage_file(kind, rel_path, *, FileResponse, HTTPException, content_type_for_path, storage_file_path):
    path = storage_file_path(kind, rel_path)
    if not path or not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="文件不存在")
    return FileResponse(path, media_type=content_type_for_path(path))


async def delete_storage_files(payload, *, ASSET_LIBRARY_LOCK, CANVAS_LOCK, CONVERSATION_LOCK, HISTORY_FILE, HISTORY_LOCK, HTTPException, json_references_media_path, persisted_json_references_media_path, storage_file_path, storage_kind_dir):
    kind = str((payload or {}).get("kind") or "").strip()
    rels = [str(item or "").strip() for item in ((payload or {}).get("items") or []) if str(item or "").strip()]
    if not rels:
        raise HTTPException(status_code=400, detail="请选择要删除的文件")
    root = os.path.realpath(storage_kind_dir(kind))
    candidates = []
    for rel in rels:
        path = storage_file_path(kind, rel)
        if path:
            try:
                if os.path.commonpath([root, os.path.realpath(path)]) != root:
                    raise HTTPException(status_code=400, detail="非法文件路径")
            except ValueError:
                raise HTTPException(status_code=400, detail="非法文件路径")
        candidates.append((rel, path))
    removed = 0
    skipped_referenced = []
    # Keep the same lock order as canvas/history cleanup while checking and deleting.
    with CANVAS_LOCK, HISTORY_LOCK, CONVERSATION_LOCK, ASSET_LIBRARY_LOCK:
        try:
            history = []
            if os.path.isfile(HISTORY_FILE):
                with open(HISTORY_FILE, "r", encoding="utf-8-sig") as handle:
                    history = json.load(handle)
                if not isinstance(history, list):
                    raise ValueError("历史记录格式异常")
            history_unreadable = False
        except (OSError, UnicodeError, json.JSONDecodeError, ValueError):
            history_unreadable = True
        for rel, path in candidates:
            if not path or not os.path.isfile(path):
                continue
            try:
                referenced = (
                    history_unreadable
                    or json_references_media_path(history, path)
                    or persisted_json_references_media_path(path)
                )
            except (OSError, UnicodeError, ValueError, TypeError):
                referenced = True
            if referenced:
                skipped_referenced.append(rel)
                continue
            try:
                os.remove(path)
                removed += 1
            except OSError:
                pass
    result = {"removed": removed, "skipped_referenced": skipped_referenced}
    if skipped_referenced:
        result["skipped_reason"] = "文件仍被保存内容引用，或相关记录无法读取，已保留"
    return result


def media_preview_cache_paths(path, width, *, MEDIA_PREVIEW_DIR):
    stat = os.stat(path)
    # 与删除入口一致：同一文件的 Windows 长/短路径必须生成相同缓存键。
    key = hashlib.sha1(
        f"{os.path.realpath(path)}|{stat.st_mtime_ns}|{stat.st_size}|{width}".encode("utf-8", "ignore")
    ).hexdigest()
    return (
        os.path.join(MEDIA_PREVIEW_DIR, f"{key}.webp"),
        os.path.join(MEDIA_PREVIEW_DIR, f"{key}.png"),
    )


def is_video_preview_file(path):
    return os.path.splitext(str(path or "").split("?", 1)[0])[1].lower() in {".mp4", ".webm", ".mov", ".m4v", ".avi", ".mkv"}


def generate_video_preview_image(path, width, *, Image, ImageOps, shutil, subprocess):
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("未找到 ffmpeg，无法生成视频预览图")
    fd, frame_path = tempfile.mkstemp(prefix="media_preview_frame_", suffix=".jpg")
    os.close(fd)
    try:
        cmd = [
            ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
            "-ss", "0.5",
            "-i", path,
            "-frames:v", "1",
            "-vf", f"scale='min({width},iw)':-2",
            frame_path,
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if proc.returncode != 0 or not os.path.exists(frame_path) or os.path.getsize(frame_path) <= 0:
            raise RuntimeError((proc.stderr or "ffmpeg 未能抽取视频首帧").strip()[:300])
        with Image.open(frame_path) as frame:
            img = ImageOps.exif_transpose(frame).copy()
            img.thumbnail((width, width), Image.LANCZOS)
            return img.convert("RGB")
    finally:
        try:
            os.remove(frame_path)
        except OSError:
            pass


async def media_preview(url, w=512, *, FileResponse, HTTPException, Image, ImageOps, MEDIA_PREVIEW_DIR, generate_video_preview_image, image_has_alpha, is_video_preview_file, media_preview_cache_paths, output_file_from_url, write_diagnostic):
    path = output_file_from_url(url)
    if not path or not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="媒体文件不存在")

    width = max(64, min(2048, int(w or 512)))
    webp_path, png_path = media_preview_cache_paths(path, width)

    if os.path.exists(webp_path):
        return FileResponse(webp_path, media_type="image/webp")
    if os.path.exists(png_path):
        return FileResponse(png_path, media_type="image/png")

    def _build_preview():
        # 同步 PIL 处理 + 落盘，放到线程里执行，避免阻塞事件循环（几十张首次生成会卡死整个 loop → 缩略图全空白）
        os.makedirs(MEDIA_PREVIEW_DIR, exist_ok=True)
        if is_video_preview_file(path):
            img = generate_video_preview_image(path, width)
        else:
            with Image.open(path) as source:
                img = ImageOps.exif_transpose(source)
                img.thumbnail((width, width), Image.LANCZOS)
                img = img.convert("RGBA" if image_has_alpha(img) else "RGB")
        try:
            img.save(webp_path, format="WEBP", quality=80, method=1)   # method=1 生成更快（缩略图不追求极致压缩）
            return webp_path, "image/webp"
        except Exception:
            img.save(png_path, format="PNG")
            return png_path, "image/png"

    try:
        out_path, media_type = await asyncio.to_thread(_build_preview)
        return FileResponse(out_path, media_type=media_type)
    except Exception as exc:
        write_diagnostic(f"media preview failed error={type(exc).__name__}")
        raise HTTPException(status_code=415, detail="无法生成预览图，请检查素材文件。") from exc


async def image_jpeg(url, w=0, *, FileResponse, HTTPException, Image, ImageOps, MEDIA_PREVIEW_DIR, output_file_from_url, write_diagnostic):
    """把任意图片转成 JPEG 返回（带缓存）。给不支持 WebP 等格式显示的客户端（PS UXP）用。
    w>0 时同时缩放到该宽度（缩略图）；w=0 输出原尺寸。"""
    path = output_file_from_url(url)
    if not path or not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="媒体文件不存在")
    width = max(0, min(4096, int(w or 0)))
    stat = os.stat(path)
    key = hashlib.sha1(f"{os.path.realpath(path)}|{stat.st_mtime_ns}|{stat.st_size}|{width}|jpg".encode("utf-8", "ignore")).hexdigest()
    cache_path = os.path.join(MEDIA_PREVIEW_DIR, f"{key}.jpg")
    if os.path.exists(cache_path):
        return FileResponse(cache_path, media_type="image/jpeg")

    def _build():
        os.makedirs(MEDIA_PREVIEW_DIR, exist_ok=True)
        with Image.open(path) as src:
            img = ImageOps.exif_transpose(src)
            if width:
                img.thumbnail((width, width), Image.LANCZOS)
            if img.mode in ("RGBA", "LA", "P"):
                bg = Image.new("RGB", img.size, (255, 255, 255))
                rgba = img.convert("RGBA")
                bg.paste(rgba, mask=rgba.split()[-1])
                img = bg
            else:
                img = img.convert("RGB")
            img.save(cache_path, format="JPEG", quality=86)
        return cache_path

    try:
        out_path = await asyncio.to_thread(_build)
        return FileResponse(out_path, media_type="image/jpeg")
    except Exception as exc:
        write_diagnostic(f"image jpeg conversion failed error={type(exc).__name__}")
        raise HTTPException(status_code=415, detail="无法转换图片，请检查素材文件。") from exc


def local_media_path_from_url(url: str, *, ASSETS_DIR, OUTPUT_DIR, storage_file_path) -> Optional[str]:
    """Resolve a local media URL using the same mapping as the app mounts."""
    if not url:
        return None
    clean = urllib.parse.unquote(str(url).split("?", 1)[0]).replace("\\", "/")
    if clean.startswith("/api/storage-files/"):
        rest = clean[len("/api/storage-files/"):].lstrip("/")
        kind, _, rel = rest.partition("/")
        return storage_file_path(kind, rel) if kind and rel else None
    if clean.startswith("/assets/"):
        root = ASSETS_DIR
        rel = clean[len("/assets/"):]
    elif clean.startswith("/output/"):
        root = OUTPUT_DIR
        rel = clean[len("/output/"):]
    else:
        return None
    rel = rel.lstrip("/")
    if not rel:
        return None
    root = os.path.abspath(root)
    path = os.path.abspath(os.path.join(root, rel))
    try:
        return path if os.path.commonpath([root, path]) == root and os.path.exists(path) else None
    except ValueError:
        return None


def view_image(filename: str, type: str = "input", subfolder: str = "", *, COMFYUI_INSTANCES, requests, Response, FileResponse, HTTPException, output_path_for, content_type_for_path):
    # 先按原逻辑去各 ComfyUI 后端找
    for addr in COMFYUI_INSTANCES:
        try:
            url = f"http://{addr}/view"
            params = {"filename": filename, "type": type, "subfolder": subfolder}
            r = requests.get(url, params=params, timeout=1)
            if r.status_code == 200:
                return Response(content=r.content, media_type=r.headers.get('Content-Type'))
        except Exception:
            continue
    # 后端都拿不到时回退本地 assets/<input|output>/
    # 适用场景：画布通过 /api/ai/upload 把参考图直接落到本地 assets/input/，
    # 但 ComfyUI 的 input 可能因为重启/清理而丢失，导致 enhance/klein 等页面预览对比图 404
    if not subfolder and type in ("input", "output"):
        safe_name = os.path.basename(filename or "")
        if safe_name:
            local_path = output_path_for(safe_name, "input" if type == "input" else "output")
            if os.path.isfile(local_path):
                return FileResponse(local_path, media_type=content_type_for_path(local_path))
    raise HTTPException(status_code=404, detail="Image not found on any available backend")


def download_output(request, url: str, name: str = "", inline: bool = False, *, rewrite_runninghub_file_url, output_file_from_url, local_media_file_by_basename, filename_from_media_url, sanitize_export_filename, FileResponse, content_type_for_path, HTTPException, requests, StreamingResponse):
    url = rewrite_runninghub_file_url(url)
    path = output_file_from_url(url)
    if not path:
        path = local_media_file_by_basename(filename_from_media_url(url, ""))
    if path:
        filename = sanitize_export_filename(os.path.basename(name) if name else os.path.basename(path), os.path.basename(path))
        return FileResponse(path, media_type=content_type_for_path(path), filename=None if inline else filename)
    # 远程文件：流式代理，绝不把整段视频/大文件读进内存（否则多个视频同时代理会撑爆内存、拖垮单进程服务）。
    parsed = urllib.parse.urlparse(str(url or "").strip())
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise HTTPException(status_code=400, detail="无效的下载地址")
    try:
        upstream_headers = {"User-Agent": "ComfyUI-API-Modelscope/1.0"}
        range_header = request.headers.get("range")
        if range_header:
            upstream_headers["Range"] = range_header
        upstream = requests.get(
            url, stream=True, timeout=(10, 60),
            headers=upstream_headers,
        )
        upstream.raise_for_status()
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail="远程文件下载失败，请检查地址或网络连接。") from exc
    content_type = upstream.headers.get("content-type") or "application/octet-stream"
    fallback = filename_from_media_url(url, "download.bin")
    filename = sanitize_export_filename(os.path.basename(name) if name else fallback, fallback)
    disposition = "inline" if inline else "attachment"
    headers = {"Content-Disposition": f"{disposition}; filename*=UTF-8''{urllib.parse.quote(filename)}"}
    for key in ("content-range", "accept-ranges"):
        value = upstream.headers.get(key)
        if value:
            headers["-".join(part.capitalize() for part in key.split("-"))] = value

    def stream_remote():
        try:
            for chunk in upstream.iter_content(chunk_size=256 * 1024):
                if chunk:
                    yield chunk
        finally:
            upstream.close()

    return StreamingResponse(stream_remote(), media_type=content_type, headers=headers, status_code=upstream.status_code)

