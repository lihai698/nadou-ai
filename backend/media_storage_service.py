"""媒体存储浏览、文件读取/清理和预览转换。

索引、文件、锁和供应商调用由应用显式注入，保留现有提交/清理顺序。
"""
import os
import tempfile
import asyncio
import hashlib
import json
import urllib.parse

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


