"""本地素材目录、上传、旁车标注及文件操作。

索引、文件、锁和供应商调用由应用显式注入，保留现有提交/清理顺序。
"""
import os
import uuid
import re
import base64
import json
import urllib.parse

from .asset_media_rules import normalize_asset_classification

def _local_upload_classification_path(filename, *, LOCAL_UPLOAD_DIR):
    return os.path.splitext(os.path.join(LOCAL_UPLOAD_DIR, filename))[0] + ".classification.json"


def _read_local_upload_classification(filename, *, _local_upload_classification_path, now_ms):
    path = _local_upload_classification_path(filename)
    if not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return normalize_asset_classification(json.load(f), now_ms=now_ms)
    except Exception:
        return None


def _write_local_upload_classification(filename, classification, *, _local_upload_classification_path, now_ms, write_json_atomic):
    path = _local_upload_classification_path(filename)
    # 分类结果是本地素材的旁车 JSON。原子替换避免分类过程中进程退出留下
    # 半截 JSON，列表读取遇到旧文件时仍可按现有规则安全回退。
    write_json_atomic(
        path,
        normalize_asset_classification(classification, now_ms=now_ms),
        ensure_ascii=False,
        indent=2,
    )


def _local_upload_rel_path(value, *, HTTPException):
    text = str(value or "").replace("\\", "/").strip().lstrip("/")
    if not text:
        return ""
    norm = os.path.normpath(text).replace("\\", "/")
    if norm in {".", ""}:
        return ""
    if norm.startswith("../") or norm == ".." or os.path.isabs(norm):
        raise HTTPException(status_code=400, detail="非法路径")
    return norm


def _local_upload_abs(rel, *, HTTPException, LOCAL_UPLOAD_DIR, _local_upload_rel_path):
    rel_path = _local_upload_rel_path(rel)
    path = os.path.abspath(os.path.join(LOCAL_UPLOAD_DIR, rel_path))
    root = os.path.abspath(LOCAL_UPLOAD_DIR)
    try:
        common = os.path.commonpath([root, path])
    except ValueError:
        raise HTTPException(status_code=400, detail="非法路径")
    if common != root:
        raise HTTPException(status_code=400, detail="非法路径")
    return rel_path, path


def _local_upload_safe_path(name, *, HTTPException, _local_upload_abs):
    filename, path = _local_upload_abs(name)
    if not filename:
        raise HTTPException(status_code=400, detail="文件名不能为空")
    return filename, path


def _local_upload_safe_folder(path_value, *, _local_upload_abs):
    rel, path = _local_upload_abs(path_value)
    return rel, path


def _local_upload_safe_folder_name(name, *, HTTPException, sanitize_asset_name):
    cleaned = sanitize_asset_name(os.path.basename(str(name or "").strip()), "")
    cleaned = re.sub(r"[\\/]+", "_", cleaned).strip(" ._")
    if not cleaned:
        raise HTTPException(status_code=400, detail="文件夹名称不能为空")
    return cleaned[:60]


def _local_upload_safe_file_stem(name, *, HTTPException, sanitize_asset_name):
    raw = os.path.splitext(os.path.basename(str(name or "").strip()))[0]
    cleaned = sanitize_asset_name(raw, "")
    cleaned = re.sub(r"[\\/]+", "_", cleaned).strip(" ._")
    if not cleaned:
        raise HTTPException(status_code=400, detail="文件名称不能为空")
    return cleaned[:120]


def _local_upload_caption_path(filename, *, LOCAL_UPLOAD_DIR):
    return os.path.splitext(os.path.join(LOCAL_UPLOAD_DIR, filename))[0] + ".txt"


def _read_local_upload_caption(filename, *, _local_upload_caption_path):
    caption_path = _local_upload_caption_path(filename)
    if not os.path.isfile(caption_path):
        return "", ""
    try:
        with open(caption_path, "r", encoding="utf-8-sig") as f:
            text = f.read()
    except UnicodeDecodeError:
        with open(caption_path, "r", encoding="gb18030", errors="replace") as f:
            text = f.read()
    except OSError:
        return "", ""
    return text, os.path.basename(caption_path)


def _local_upload_item(filename, *, Image, LOCAL_UPLOAD_DIR, _local_upload_display_name, _local_upload_kind_ext, _local_upload_rel_path, _read_local_upload_caption, _read_local_upload_classification):
    path = os.path.join(LOCAL_UPLOAD_DIR, filename)
    rel = _local_upload_rel_path(filename)
    try:
        stat = os.stat(path)
        size = stat.st_size
        created_at = stat.st_mtime
    except OSError:
        size = 0
        created_at = 0
    kind, _ = _local_upload_kind_ext(filename, "")
    item = {
        "id": rel,
        "file": rel,
        "name": _local_upload_display_name(rel),
        "url": f"/api/storage-files/local/{urllib.parse.quote(rel, safe='/')}",
        "kind": kind or "image",
        "size": size,
        "created_at": created_at,
        "folder": os.path.dirname(rel).replace("\\", "/"),
    }
    if kind == "image":
        try:
            with Image.open(path) as img:
                item["natural_w"], item["natural_h"] = img.size
                item["width"], item["height"] = img.size
        except Exception:
            pass
        caption, caption_file = _read_local_upload_caption(filename)
        item["caption"] = caption
        item["caption_file"] = caption_file
        classification = _read_local_upload_classification(filename)
        if classification:
            item["classification"] = classification
    return item


def _local_upload_folder_node(path='', name='全部上传', *, _local_upload_rel_path):
    rel = _local_upload_rel_path(path)
    return {
        "id": rel or "__root__",
        "path": rel,
        "name": name if not rel else os.path.basename(rel),
        "items": [],
        "children": [],
    }


def _local_upload_tree_and_items(*, LOCAL_UPLOAD_DIR, _local_upload_folder_node, _local_upload_item, _local_upload_kind_ext):
    root_node = _local_upload_folder_node("", "全部上传")
    folder_map = {"": root_node}
    items = []
    for current, dirs, files in os.walk(LOCAL_UPLOAD_DIR):
        dirs[:] = sorted([d for d in dirs if not d.startswith(".") and not d.startswith("._")], key=str.lower)
        rel_dir = os.path.relpath(current, LOCAL_UPLOAD_DIR).replace("\\", "/")
        if rel_dir == ".":
            rel_dir = ""
        node = folder_map.get(rel_dir)
        if node is None:
            node = _local_upload_folder_node(rel_dir)
            folder_map[rel_dir] = node
        for dirname in dirs:
            child_rel = f"{rel_dir}/{dirname}".lstrip("/")
            child = _local_upload_folder_node(child_rel)
            folder_map[child_rel] = child
            node["children"].append(child)
        for name in sorted(files, key=str.lower):
            if name.startswith(".") or name.startswith("._"):
                continue
            rel_file = f"{rel_dir}/{name}".lstrip("/")
            kind, _ = _local_upload_kind_ext(name, "")
            if kind is None:
                continue
            item = _local_upload_item(rel_file)
            node["items"].append(item)
            items.append(item)
    def fill_counts(node):
        total = len(node.get("items") or [])
        for child in node.get("children") or []:
            total += fill_counts(child)
        node["count"] = total
        return total
    fill_counts(root_node)
    items.sort(key=lambda it: it.get("created_at") or 0, reverse=True)
    return root_node, items


def migrate_double_extension_uploads(*, LOCAL_UPLOAD_DIR, _DOUBLE_EXT_MEDIA, _DOUBLE_EXT_RE, write_diagnostic):
    """修复历史遗留的双重扩展名（如 foo.png.png）：去掉重复的一层，并同步重命名 caption/classification 旁车文件。
    旧版 URL 导入会把自带扩展名的 entry.name 又拼一次 ext，导致文件名重复后缀、URL 对不上而无法显示。"""
    if not os.path.isdir(LOCAL_UPLOAD_DIR):
        return
    renamed = 0
    for current, _dirs, files in os.walk(LOCAL_UPLOAD_DIR):
        for name in files:
            m = _DOUBLE_EXT_RE.search(name)
            if not m or m.group(1).lower() not in _DOUBLE_EXT_MEDIA:
                continue
            old_path = os.path.join(current, name)
            new_path = os.path.join(current, name[:-len(m.group(1))])  # 去掉末尾重复的一层扩展名
            if os.path.exists(new_path):
                continue
            try:
                os.rename(old_path, new_path)
            except OSError:
                continue
            renamed += 1
            # caption/classification 旁车以「去掉一层扩展名」为基名，需同步改名以保留标注
            old_base = os.path.splitext(old_path)[0]
            new_base = os.path.splitext(new_path)[0]
            for suffix in (".classification.json", ".txt"):
                src_side, dst_side = old_base + suffix, new_base + suffix
                if os.path.exists(src_side) and not os.path.exists(dst_side):
                    try:
                        os.rename(src_side, dst_side)
                    except OSError:
                        pass
    if renamed:
        write_diagnostic(f"asset extension repair renamed={renamed}")


def migrate_mislabeled_image_extensions(*, LOCAL_UPLOAD_DIR, _sniff_image_ext, write_diagnostic):
    """有些采集来的图片内容与扩展名不符（例如 WebP 内容却叫 .png），导致服务端按错误 content-type 返回、
    严格的客户端（PS UXP）解不出来。这里按真实魔数纠正扩展名，并同步重命名 caption/classification 旁车。"""
    if not os.path.isdir(LOCAL_UPLOAD_DIR):
        return
    img_exts = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}
    fixed = 0
    for current, _dirs, files in os.walk(LOCAL_UPLOAD_DIR):
        for name in files:
            ext = os.path.splitext(name)[1].lower()
            if ext not in img_exts:
                continue
            path = os.path.join(current, name)
            real = _sniff_image_ext(path)
            if not real:
                continue
            # .jpg/.jpeg 视为同一种，不互相纠正
            if real == ext or (real == ".jpg" and ext == ".jpeg"):
                continue
            new_name = os.path.splitext(name)[0] + real
            new_path = os.path.join(current, new_name)
            if os.path.exists(new_path):
                continue
            try:
                os.rename(path, new_path)
            except OSError:
                continue
            fixed += 1
            old_base = os.path.splitext(path)[0]
            new_base = os.path.splitext(new_path)[0]
            for suffix in (".classification.json", ".txt"):
                src_side, dst_side = old_base + suffix, new_base + suffix
                if os.path.isfile(src_side) and not os.path.exists(dst_side):
                    try:
                        os.rename(src_side, dst_side)
                    except OSError:
                        pass
    if fixed:
        write_diagnostic(f"asset extension repair content_mismatch={fixed}")


async def upload_local_assets(files, folder, *, _local_upload_item, _local_upload_kind_ext, _local_upload_safe_folder, _write_local_upload_classification, classify_asset_image_best_effort, read_upload_file_limited):
    uploaded = []
    batch_state = {"total": 0}
    folder_rel, folder_abs = _local_upload_safe_folder(folder)
    os.makedirs(folder_abs, exist_ok=True)
    for file in files:
        content = await read_upload_file_limited(file, batch_state=batch_state)
        if not content:
            continue
        kind, ext = _local_upload_kind_ext(file.filename, file.content_type)
        if kind is None:
            continue
        base = os.path.splitext(os.path.basename(file.filename or "file"))[0]
        base = re.sub(r"[^0-9A-Za-z一-鿿._-]+", "_", base).strip("_") or "file"
        base = base[:60]
        filename = f"up_{uuid.uuid4().hex[:12]}_{base}{ext}"
        rel_name = f"{folder_rel}/{filename}".lstrip("/")
        path = os.path.join(folder_abs, filename)
        with open(path, "wb") as f:
            f.write(content)
        if kind == "image":
            classification = await classify_asset_image_best_effort(path)
            if classification:
                _write_local_upload_classification(rel_name, classification)
        uploaded.append(_local_upload_item(rel_name))
    return {"files": uploaded}


async def import_local_assets_from_urls(payload, *, HTTPException, UPLOAD_MAX_BATCH_BYTES, UPLOAD_MAX_FILE_BYTES, _base64_payload_size_hint, _local_upload_item, _local_upload_kind_ext, _local_upload_safe_folder, _sniff_image_ext_bytes, _upload_limit_error, _write_local_upload_classification, classify_asset_image_best_effort, httpx, public_error_detail, read_httpx_response_limited, safe_cli_public_text):
    uploaded = []
    results = []
    folder_rel, folder_abs = _local_upload_safe_folder(payload.folder)
    os.makedirs(folder_abs, exist_ok=True)
    batch_state = {"total": 0}
    timeout = httpx.Timeout(connect=20.0, read=120.0, write=30.0, pool=20.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True, headers={"User-Agent": "Infinite-Canvas-Asset-Importer/1.0"}) as client:
        for entry in (payload.items or [])[:200]:
            src_url = str(entry.url or "").strip()
            inline_data = str(entry.data or "").strip()
            result = {"url": src_url, "ok": False, "file": "", "error": ""}
            if not inline_data and not src_url.startswith(("http://", "https://")):
                result["error"] = "仅支持 http(s) 素材地址"
                results.append(result)
                continue
            try:
                if inline_data:
                    # 插件已在网页上下文里把字节读成 base64（dataURL 形如 data:<ct>;base64,<payload>）
                    _base64_payload_size_hint(inline_data)
                    content_type = str(entry.content_type or "").split(";", 1)[0].strip().lower()
                    b64 = inline_data
                    if inline_data.startswith("data:"):
                        header, _, b64 = inline_data.partition(",")
                        if not content_type:
                            content_type = header[5:].split(";", 1)[0].strip().lower()
                    try:
                        if (len(b64.rstrip("=")) * 3) // 4 > UPLOAD_MAX_FILE_BYTES:
                            raise _upload_limit_error("Base64 素材")
                        content = base64.b64decode(b64, validate=False)
                    except HTTPException:
                        raise
                    except Exception:
                        raise HTTPException(status_code=400, detail="素材数据无法解码")
                    if len(content) > UPLOAD_MAX_FILE_BYTES:
                        raise _upload_limit_error("Base64 素材")
                    if batch_state["total"] + len(content) > UPLOAD_MAX_BATCH_BYTES:
                        raise _upload_limit_error(batch=True)
                    batch_state["total"] += len(content)
                    name_path = urllib.parse.urlparse(src_url).path
                else:
                    async with client.stream("GET", src_url) as response:
                        response.raise_for_status()
                        content_type = response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
                        content = await read_httpx_response_limited(
                            response,
                            batch_state=batch_state,
                            filename=urllib.parse.urlparse(src_url).path.rsplit("/", 1)[-1] or "远程素材",
                        )
                    name_path = urllib.parse.urlparse(src_url).path
                kind, ext = _local_upload_kind_ext(name_path, content_type)
                if kind == "image":
                    real = _sniff_image_ext_bytes(content[:16])   # 以真实内容为准，避免 webp 被叫成 .png 等
                    if real and not (real == ".jpg" and ext == ".jpeg"):
                        ext = real
                if kind not in ("image", "video"):
                    media_type = safe_cli_public_text(content_type, 120) or "未知类型"
                    raise HTTPException(status_code=400, detail=f"不是图片或视频资源：{media_type}，请确认地址指向图片或视频。")
                if not content:
                    raise HTTPException(status_code=400, detail="素材内容为空")
                # entry.name 可能自带扩展名（采集器常传完整文件名），先 splitext 去掉，否则会和下面拼接的 ext 叠成 .png.png
                if entry.name:
                    base = os.path.splitext(entry.name)[0]
                else:
                    base = os.path.splitext(os.path.basename(urllib.parse.unquote(name_path)))[0]
                base = base or ("web-video" if kind == "video" else "web-image")
                base = re.sub(r"[^0-9A-Za-z一-鿿._-]+", "_", base).strip("_") or ("web-video" if kind == "video" else "web-image")
                base = base[:60]
                # 兜底：若 base 末尾已是同一扩展名，去掉一层再拼，杜绝重复后缀
                if ext and base.lower().endswith(ext.lower()):
                    base = base[:-len(ext)].rstrip(".") or ("web-video" if kind == "video" else "web-image")
                filename = f"up_{uuid.uuid4().hex[:12]}_{base}{ext}"
                rel_name = f"{folder_rel}/{filename}".lstrip("/")
                path = os.path.join(folder_abs, filename)
                with open(path, "wb") as f:
                    f.write(content)
                if payload.classify and kind == "image":
                    classification = await classify_asset_image_best_effort(path, payload.provider, payload.model, payload.ms_model, payload.prompt)
                    if classification:
                        _write_local_upload_classification(rel_name, classification)
                item = _local_upload_item(rel_name)
                uploaded.append(item)
                result.update({"ok": True, "file": rel_name, "item": item})
            except HTTPException as exc:
                if exc.status_code == 413:
                    raise
                result["error"] = public_error_detail(exc.detail, fallback="导入失败")
            except Exception as exc:
                result["error"] = public_error_detail(exc, fallback="导入失败")
            results.append(result)
    return {"ok": True, "count": len(uploaded), "files": uploaded, "items": results}


async def list_local_assets(*, _local_upload_tree_and_items):
    tree, items = _local_upload_tree_and_items()
    return {"items": items, "tree": tree}


async def create_local_asset_folder(payload, request, *, HTTPException, _local_upload_safe_folder, _local_upload_safe_folder_name, _local_upload_tree_and_items, ensure_same_origin_request):
    ensure_same_origin_request(request)
    parent_rel, parent_abs = _local_upload_safe_folder(payload.parent)
    if not os.path.isdir(parent_abs):
        raise HTTPException(status_code=404, detail="父文件夹不存在")
    name = _local_upload_safe_folder_name(payload.name)
    rel = f"{parent_rel}/{name}".lstrip("/")
    _, abs_path = _local_upload_safe_folder(rel)
    if os.path.exists(abs_path):
        raise HTTPException(status_code=400, detail="同名文件夹已存在")
    os.makedirs(abs_path, exist_ok=False)
    tree, items = _local_upload_tree_and_items()
    return {"ok": True, "folder": {"path": rel, "name": name}, "tree": tree, "items": items}


async def rename_local_asset_folder(payload, request, *, HTTPException, _local_upload_safe_folder, _local_upload_safe_folder_name, _local_upload_tree_and_items, ensure_same_origin_request):
    ensure_same_origin_request(request)
    rel, abs_path = _local_upload_safe_folder(payload.path)
    if not rel:
        raise HTTPException(status_code=400, detail="根目录不能重命名")
    if not os.path.isdir(abs_path):
        raise HTTPException(status_code=404, detail="文件夹不存在")
    name = _local_upload_safe_folder_name(payload.name)
    parent = os.path.dirname(rel).replace("\\", "/")
    new_rel = f"{parent}/{name}".lstrip("/")
    _, new_abs = _local_upload_safe_folder(new_rel)
    if os.path.exists(new_abs):
        raise HTTPException(status_code=400, detail="同名文件夹已存在")
    os.rename(abs_path, new_abs)
    tree, items = _local_upload_tree_and_items()
    return {"ok": True, "folder": {"path": new_rel, "name": name}, "tree": tree, "items": items}


async def rename_local_asset_item(payload, request, *, HTTPException, _local_upload_abs, _local_upload_caption_path, _local_upload_classification_path, _local_upload_item, _local_upload_kind_ext, _local_upload_safe_file_stem, _local_upload_safe_path, _local_upload_tree_and_items, ensure_same_origin_request):
    ensure_same_origin_request(request)
    rel, abs_path = _local_upload_safe_path(payload.path)
    if not os.path.isfile(abs_path):
        raise HTTPException(status_code=404, detail="本地素材不存在")
    kind, ext = _local_upload_kind_ext(rel, "")
    if kind is None:
        raise HTTPException(status_code=400, detail="不支持的素材类型")
    new_stem = _local_upload_safe_file_stem(payload.name)
    old_ext = os.path.splitext(rel)[1] or ext
    parent = os.path.dirname(rel).replace("\\", "/")
    new_rel = f"{parent}/{new_stem}{old_ext}".lstrip("/")
    if new_rel == rel:
        tree, items = _local_upload_tree_and_items()
        return {"ok": True, "item": _local_upload_item(rel), "tree": tree, "items": items}
    _, new_abs = _local_upload_abs(new_rel)
    if os.path.exists(new_abs):
        raise HTTPException(status_code=400, detail="同名素材已存在")
    os.rename(abs_path, new_abs)
    old_caption = _local_upload_caption_path(rel)
    new_caption = _local_upload_caption_path(new_rel)
    if os.path.isfile(old_caption) and not os.path.exists(new_caption):
        os.rename(old_caption, new_caption)
    old_classification = _local_upload_classification_path(rel)
    new_classification = _local_upload_classification_path(new_rel)
    if os.path.isfile(old_classification) and not os.path.exists(new_classification):
        os.rename(old_classification, new_classification)
    tree, items = _local_upload_tree_and_items()
    return {"ok": True, "item": _local_upload_item(new_rel), "old_path": rel, "tree": tree, "items": items}


async def delete_local_assets(payload, request, *, ASSET_LIBRARY_LOCK, CANVAS_LOCK, CONVERSATION_LOCK, HISTORY_FILE, HISTORY_LOCK, HTTPException, _local_upload_caption_path, _local_upload_classification_path, _local_upload_safe_path, ensure_same_origin_request, json_references_media_path, persisted_json_references_media_path):
    ensure_same_origin_request(request)
    names = payload.get("names") if isinstance(payload, dict) else None
    if not isinstance(names, list):
        names = []
    deleted = []
    skipped_referenced = []
    # Use the same lock order as history and canvas cleanup so references cannot
    # change between the check and unlinking the uploaded file.
    with CANVAS_LOCK, HISTORY_LOCK, CONVERSATION_LOCK, ASSET_LIBRARY_LOCK:
        history = []
        history_unreadable = False
        if os.path.isfile(HISTORY_FILE):
            try:
                with open(HISTORY_FILE, "r", encoding="utf-8-sig") as handle:
                    history = json.load(handle)
            except (OSError, UnicodeError, json.JSONDecodeError):
                history_unreadable = True
        for name in names:
            try:
                rel, path = _local_upload_safe_path(name)
            except HTTPException:
                continue
            if not os.path.isfile(path):
                continue
            sidecars = tuple(sidecar for sidecar in (
                _local_upload_caption_path(rel), _local_upload_classification_path(rel)
            ) if os.path.isfile(sidecar))
            if (history_unreadable or any(
                json_references_media_path(history, candidate)
                or persisted_json_references_media_path(candidate)
                for candidate in (path, *sidecars)
            )):
                skipped_referenced.append(rel)
                continue
            try:
                os.remove(path)
                deleted.append(rel)
                for sidecar in sidecars:
                    try:
                        os.remove(sidecar)
                    except OSError:
                        pass
            except OSError:
                pass
    return {"deleted": deleted, "skipped_referenced": skipped_referenced}


async def move_local_assets(payload, request, *, HTTPException, _local_upload_abs, _local_upload_caption_path, _local_upload_classification_path, _local_upload_safe_folder, _local_upload_safe_path, _local_upload_tree_and_items, ensure_same_origin_request):
    """把选中的本地素材移动到目标文件夹（folder 为空表示根目录）；连同 .txt / .classification.json 兄弟文件一起搬。"""
    ensure_same_origin_request(request)
    names = payload.get("names") if isinstance(payload, dict) else None
    if not isinstance(names, list) or not names:
        raise HTTPException(status_code=400, detail="没有选择素材")
    folder_value = str(payload.get("folder") or "").strip() if isinstance(payload, dict) else ""
    target_rel, target_abs = _local_upload_safe_folder(folder_value)
    if target_rel and not os.path.isdir(target_abs):
        raise HTTPException(status_code=404, detail="目标文件夹不存在")
    moved = 0
    for name in names:
        try:
            rel, abs_path = _local_upload_safe_path(name)
        except HTTPException:
            continue
        if not os.path.isfile(abs_path):
            continue
        base = os.path.basename(rel)
        new_rel = f"{target_rel}/{base}".lstrip("/") if target_rel else base
        if new_rel == rel:
            continue  # 已在目标文件夹，跳过
        _, new_abs = _local_upload_abs(new_rel)
        if os.path.exists(new_abs):
            # 同名冲突：加短随机后缀，避免覆盖已有文件
            stem, ext = os.path.splitext(base)
            base = f"{stem}_{uuid.uuid4().hex[:6]}{ext}"
            new_rel = f"{target_rel}/{base}".lstrip("/") if target_rel else base
            _, new_abs = _local_upload_abs(new_rel)
        try:
            os.makedirs(os.path.dirname(new_abs), exist_ok=True)
            os.rename(abs_path, new_abs)
            for src_sib, dst_sib in (
                (_local_upload_caption_path(rel), _local_upload_caption_path(new_rel)),
                (_local_upload_classification_path(rel), _local_upload_classification_path(new_rel)),
            ):
                if os.path.isfile(src_sib) and not os.path.exists(dst_sib):
                    os.rename(src_sib, dst_sib)
            moved += 1
        except OSError:
            continue
    tree, items = _local_upload_tree_and_items()
    return {"ok": True, "moved": moved, "items": items, "tree": tree}


async def caption_local_assets(payload, *, HTTPException, _local_upload_caption_path, _local_upload_kind_ext, _local_upload_safe_path, caption_image_with_provider, public_error_detail, write_text_atomic):
    prompt = (payload.prompt or "描述图片").strip() or "描述图片"
    items = []
    ok_count = 0
    for name in (payload.names or [])[:100]:
        item = {"name": name, "ok": False, "caption": "", "caption_file": "", "error": ""}
        try:
            filename, path = _local_upload_safe_path(name)
            if not os.path.isfile(path):
                raise HTTPException(status_code=404, detail="文件不存在")
            kind, _ = _local_upload_kind_ext(filename, "")
            if kind != "image":
                raise HTTPException(status_code=400, detail="仅支持图片素材反推提示词")
            caption, resolved_model = await caption_image_with_provider(
                path,
                prompt,
                payload.provider,
                payload.model,
                payload.ms_model,
            )
            txt_path = _local_upload_caption_path(filename)
            write_text_atomic(txt_path, caption, encoding="utf-8", newline="")
            item.update({
                "ok": True,
                "name": filename,
                "caption": caption,
                "caption_file": os.path.basename(txt_path),
                "model": resolved_model,
            })
            ok_count += 1
        except HTTPException as exc:
            item["error"] = public_error_detail(exc.detail, fallback="反推失败")
        except Exception as exc:
            item["error"] = public_error_detail(exc, fallback="反推失败")
        items.append(item)
    return {"ok": True, "count": ok_count, "items": items}


async def classify_local_assets(payload, *, HTTPException, _local_upload_classification_path, _local_upload_kind_ext, _local_upload_safe_path, _write_local_upload_classification, classify_image_with_provider, public_error_detail):
    items = []
    ok_count = 0
    for name in (payload.names or [])[:80]:
        item = {"name": name, "ok": False, "classification": None, "classification_file": "", "error": ""}
        try:
            filename, path = _local_upload_safe_path(name)
            if not os.path.isfile(path):
                raise HTTPException(status_code=404, detail="文件不存在")
            kind, _ = _local_upload_kind_ext(filename, "")
            if kind != "image":
                raise HTTPException(status_code=400, detail="仅支持图片素材智能分类")
            classification = await classify_image_with_provider(
                path,
                payload.provider,
                payload.model,
                payload.ms_model,
                payload.prompt,
            )
            _write_local_upload_classification(filename, classification)
            item.update({
                "ok": True,
                "name": filename,
                "classification": classification,
                "classification_file": os.path.basename(_local_upload_classification_path(filename)),
                "model": classification.get("model") or "",
            })
            ok_count += 1
        except HTTPException as exc:
            item["error"] = public_error_detail(exc.detail, fallback="智能分类失败")
        except Exception as exc:
            item["error"] = public_error_detail(exc, fallback="智能分类失败")
        items.append(item)
    return {"ok": True, "count": ok_count, "items": items}


async def save_local_asset_caption(payload, *, HTTPException, _local_upload_caption_path, _local_upload_kind_ext, _local_upload_safe_path, write_text_atomic):
    filename, path = _local_upload_safe_path(payload.name)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="文件不存在")
    kind, _ = _local_upload_kind_ext(filename, "")
    if kind != "image":
        raise HTTPException(status_code=400, detail="仅支持图片素材保存提示词")
    caption = str(payload.caption or "")[:100000]
    txt_path = _local_upload_caption_path(filename)
    write_text_atomic(txt_path, caption, encoding="utf-8", newline="")
    return {"ok": True, "caption": caption, "caption_file": os.path.basename(txt_path)}


