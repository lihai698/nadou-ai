"""共享目录索引、登记、扫描及媒体导入。

索引、文件、锁和供应商调用由应用显式注入，保留现有提交/清理顺序。
"""
import os
import uuid
import json
import urllib.parse

def _shared_folders_load_unlocked(*, SHARED_FOLDERS_FILE):
    try:
        with open(SHARED_FOLDERS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        data = {}
    if not isinstance(data, dict):
        data = {}
    folders = data.get("folders")
    if not isinstance(folders, list):
        folders = []
    return {"folders": [f for f in folders if isinstance(f, dict)]}


def shared_folders_load(*, SHARED_FOLDERS_FILE, SHARED_FOLDERS_LOCK, _shared_folders_load_unlocked, interprocess_file_lock):
    with interprocess_file_lock(SHARED_FOLDERS_FILE):
        with SHARED_FOLDERS_LOCK:
            return _shared_folders_load_unlocked()


def _shared_folders_save_unlocked(data, *, DATA_DIR, SHARED_FOLDERS_FILE, write_json_atomic):
    """在调用方已持有两级锁时原子保存共享文件夹索引。"""
    if not isinstance(data, dict) or not isinstance(data.get("folders"), list):
        raise ValueError("共享文件夹记录必须是包含 folders 列表的 JSON 对象")
    if os.path.exists(SHARED_FOLDERS_FILE):
        try:
            with open(SHARED_FOLDERS_FILE, "r", encoding="utf-8") as f:
                existing = json.load(f)
            if not isinstance(existing, dict) or not isinstance(existing.get("folders"), list):
                raise ValueError("共享文件夹记录格式无效")
        except (OSError, UnicodeError, ValueError, json.JSONDecodeError) as exc:
            raise ValueError("共享文件夹记录损坏或无法读取，已保留原文件；请从备份恢复。") from exc
    os.makedirs(DATA_DIR, exist_ok=True)
    write_json_atomic(SHARED_FOLDERS_FILE, data, ensure_ascii=False, indent=2)


def shared_folders_save(data, *, SHARED_FOLDERS_FILE, SHARED_FOLDERS_LOCK, _shared_folders_save_unlocked, interprocess_file_lock):
    """原子保存共享文件夹索引，并拒绝覆盖已损坏的现有文件。"""
    with interprocess_file_lock(SHARED_FOLDERS_FILE):
        with SHARED_FOLDERS_LOCK:
            _shared_folders_save_unlocked(data)


def _save_shared_folders_or_raise(data, *, locked=False, HTTPException, _shared_folders_save_unlocked, shared_folders_save):
    try:
        if locked:
            _shared_folders_save_unlocked(data)
        else:
            shared_folders_save(data)
    except (OSError, UnicodeError, ValueError) as exc:
        raise HTTPException(
            status_code=500,
            detail="共享文件夹记录无法保存，已保留原文件；请排除磁盘故障或从备份恢复后重试。",
        ) from exc


def _shared_folders_update(mutator, *, SHARED_FOLDERS_FILE, SHARED_FOLDERS_LOCK, _save_shared_folders_or_raise, _shared_folders_load_unlocked, interprocess_file_lock):
    """在目录级跨进程锁内完成一次共享文件夹读改写。"""
    with interprocess_file_lock(SHARED_FOLDERS_FILE):
        with SHARED_FOLDERS_LOCK:
            data = _shared_folders_load_unlocked()
            result = mutator(data)
            _save_shared_folders_or_raise(data, locked=True)
            return result


def shared_folder_by_id(folder_id, *, shared_folders_load):
    for entry in shared_folders_load().get("folders", []):
        if entry.get("id") == folder_id:
            return entry
    return None


def shared_folder_abs(entry, *, BASE_DIR):
    rel = (entry or {}).get("rel") or ""
    return os.path.normpath(os.path.join(BASE_DIR, rel))


def shared_resolve_register(path, *, BASE_DIR, HTTPException):
    """校验 path 必须位于项目目录内、是一个存在的子目录（非项目根）。返回 (abs, rel)。"""
    raw = (path or "").strip().strip('"').strip("'")
    if not raw:
        raise HTTPException(status_code=400, detail="请提供文件夹路径")
    candidate = raw if os.path.isabs(raw) else os.path.join(BASE_DIR, raw)
    abs_path = os.path.normpath(os.path.abspath(candidate))
    base = os.path.normpath(os.path.abspath(BASE_DIR))
    try:
        common = os.path.commonpath([abs_path, base])
    except ValueError:
        raise HTTPException(status_code=400, detail="只允许登记项目目录内的文件夹")
    if common != base:
        raise HTTPException(status_code=400, detail="只允许登记项目目录内的文件夹")
    if abs_path == base:
        raise HTTPException(status_code=400, detail="不能直接登记项目根目录，请选择子文件夹")
    if not os.path.isdir(abs_path):
        raise HTTPException(status_code=400, detail="文件夹不存在")
    rel = os.path.relpath(abs_path, base)
    return abs_path, rel


def shared_child_abs(folder_abs, rel, *, HTTPException):
    """把相对 folder_abs 的子路径解析为绝对路径，并防止越界访问。"""
    rel = (rel or "").replace("\\", "/").lstrip("/")
    abs_path = os.path.normpath(os.path.join(folder_abs, rel))
    base = os.path.normpath(os.path.abspath(folder_abs))
    try:
        common = os.path.commonpath([os.path.abspath(abs_path), base])
    except ValueError:
        raise HTTPException(status_code=400, detail="非法路径")
    if common != base:
        raise HTTPException(status_code=400, detail="非法路径")
    return abs_path


def scan_shared_tree(folder_id, folder_abs, rel_prefix='', display='', counter=None, *, SHARED_MEDIA_EXTS, SHARED_SCAN_MAX_ENTRIES, asset_library_media_kind, scan_shared_tree):
    """递归扫描共享文件夹，返回 {id,name,path,items,children}。"""
    if counter is None:
        counter = {"n": 0}
    node = {
        "id": f"{folder_id}:{rel_prefix or '__root__'}",
        "name": display or os.path.basename(folder_abs) or folder_abs,
        "path": rel_prefix,
        "items": [],
        "children": [],
    }
    try:
        entries = sorted(os.scandir(folder_abs), key=lambda e: (not e.is_dir(), e.name.lower()))
    except OSError:
        return node
    for ent in entries:
        if counter["n"] >= SHARED_SCAN_MAX_ENTRIES:
            break
        if ent.name.startswith(".") or ent.name.startswith("._"):
            continue
        child_rel = f"{rel_prefix}/{ent.name}".lstrip("/")
        if ent.is_dir():
            child = scan_shared_tree(folder_id, ent.path, child_rel, ent.name, counter)
            if child["items"] or child["children"]:
                node["children"].append(child)
        elif ent.is_file():
            ext = os.path.splitext(ent.name)[1].lower()
            if ext not in SHARED_MEDIA_EXTS:
                continue
            counter["n"] += 1
            try:
                st = ent.stat()
                size = st.st_size
                mtime = int(st.st_mtime * 1000)
            except OSError:
                size = 0
                mtime = 0
            node["items"].append({
                "id": f"{folder_id}:{child_rel}",
                "name": ent.name,
                "url": f"/api/shared-folders/{folder_id}/file?path={urllib.parse.quote(child_rel)}",
                "kind": asset_library_media_kind(ent.name),
                "size": size,
                "lastModified": mtime,
                "relativePath": child_rel,
                "folderId": folder_id,
            })
    return node


async def list_shared_folders(*, shared_folder_abs, shared_folders_load):
    data = shared_folders_load()
    folders = []
    for entry in data.get("folders", []):
        abs_path = shared_folder_abs(entry)
        folders.append({
            "id": entry.get("id"),
            "name": entry.get("name") or os.path.basename(abs_path) or abs_path,
            "rel": entry.get("rel") or "",
            "path": abs_path,
            "exists": os.path.isdir(abs_path),
            "created_at": entry.get("created_at"),
        })
    return {"folders": folders}


async def register_shared_folder(payload, *, _shared_folders_update, now_ms, sanitize_asset_name, shared_folder_abs, shared_resolve_register):
    abs_path, rel = shared_resolve_register(payload.path)
    name = sanitize_asset_name(payload.name or os.path.basename(abs_path), "共享文件夹")
    def update(data):
        for entry in data.get("folders", []):
            if os.path.normpath(shared_folder_abs(entry)) == os.path.normpath(abs_path):
                entry["name"] = name
                return entry
        entry = {
            "id": f"shared_{uuid.uuid4().hex[:12]}",
            "name": name,
            "rel": rel,
            "created_at": now_ms(),
        }
        data.setdefault("folders", []).append(entry)
        return entry

    entry = _shared_folders_update(update)
    return {"folder": {**entry, "path": abs_path, "exists": True}}


async def unregister_shared_folder(folder_id, *, HTTPException, _shared_folders_update):
    def update(data):
        before = len(data.get("folders", []))
        data["folders"] = [f for f in data.get("folders", []) if f.get("id") != folder_id]
        if len(data["folders"]) == before:
            raise HTTPException(status_code=404, detail="共享文件夹不存在")

    _shared_folders_update(update)
    return {"ok": True}


async def get_shared_folder_tree(folder_id, *, HTTPException, scan_shared_tree, shared_folder_abs, shared_folder_by_id):
    entry = shared_folder_by_id(folder_id)
    if not entry:
        raise HTTPException(status_code=404, detail="共享文件夹不存在")
    abs_path = shared_folder_abs(entry)
    if not os.path.isdir(abs_path):
        raise HTTPException(status_code=404, detail="文件夹已不存在")
    tree = scan_shared_tree(folder_id, abs_path, "", entry.get("name") or os.path.basename(abs_path))
    return {"folder": {"id": folder_id, "name": entry.get("name"), "path": abs_path}, "tree": tree}


async def get_shared_folder_file(folder_id, path='', *, FileResponse, HTTPException, SHARED_MEDIA_EXTS, content_type_for_path, shared_child_abs, shared_folder_abs, shared_folder_by_id):
    entry = shared_folder_by_id(folder_id)
    if not entry:
        raise HTTPException(status_code=404, detail="共享文件夹不存在")
    folder_abs = shared_folder_abs(entry)
    abs_path = shared_child_abs(folder_abs, path)
    if not os.path.isfile(abs_path):
        raise HTTPException(status_code=404, detail="文件不存在")
    ext = os.path.splitext(abs_path)[1].lower()
    if ext not in SHARED_MEDIA_EXTS:
        raise HTTPException(status_code=400, detail="不支持的文件类型")
    return FileResponse(abs_path, media_type=content_type_for_path(abs_path))


async def import_shared_folder_files(payload, *, HTTPException, SHARED_MEDIA_EXTS, import_asset_library_media_sources, shared_child_abs, shared_folder_abs, shared_folder_by_id):
    entry = shared_folder_by_id(payload.folder_id)
    if not entry:
        raise HTTPException(status_code=404, detail="共享文件夹不存在")
    folder_abs = shared_folder_abs(entry)
    sources = []
    for rel in (payload.paths or [])[:200]:
        abs_path = shared_child_abs(folder_abs, rel)
        if os.path.isfile(abs_path) and os.path.splitext(abs_path)[1].lower() in SHARED_MEDIA_EXTS:
            sources.append((abs_path, os.path.basename(abs_path)))
    lib, items, added_count = await import_asset_library_media_sources(
        sources, payload.library_id, payload.category_id
    )
    return {"library": lib, "items": items, "added_count": added_count,
            "duplicate_count": len(items) - added_count}


