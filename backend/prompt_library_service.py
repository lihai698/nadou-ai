"""提示词模板、库记录、分类与条目管理。

索引、文件、锁和供应商调用由应用显式注入，保留现有提交/清理顺序。
"""
import os
import uuid
import re
import json

def prompt_template_markdown_path(*, PROMPT_TEMPLATE_PATHS):
    for path in PROMPT_TEMPLATE_PATHS:
        if os.path.exists(path):
            return path
    return ""


def builtin_prompt_templates(*, parse_prompt_template_markdown, prompt_template_markdown_path, write_diagnostic):
    try:
        template_path = prompt_template_markdown_path()
        if not template_path:
            return []
        with open(template_path, "r", encoding="utf-8") as f:
            return parse_prompt_template_markdown(f.read())
    except Exception as e:
        write_diagnostic(f"prompt template load failed error={type(e).__name__}")
        return []


def normalize_prompt_category_id(category='custom'):
    category_id = re.sub(r"[^A-Za-z0-9_-]+", "_", str(category or "custom"))[:40] or "custom"
    return "custom" if category_id in {"mine", "my", "personal"} else category_id


def normalize_prompt_library_item(item, *, normalize_prompt_category_id, now_ms, sanitize_asset_name):
    if not isinstance(item, dict):
        item = {}
    name = sanitize_asset_name(item.get("name") or "提示词", "提示词")
    positive = str(item.get("positive") or item.get("text") or "").strip()
    return {
        "id": re.sub(r"[^A-Za-z0-9_-]+", "_", str(item.get("id") or item.get("item_id") or f"tpl_{uuid.uuid4().hex[:12]}"))[:60],
        "name": name,
        "category": normalize_prompt_category_id(item.get("category") or "custom"),
        "scene": str(item.get("scene") or "").strip()[:500],
        "positive": positive,
        "negative": str(item.get("negative") or "").strip(),
        "params": item.get("params") if isinstance(item.get("params"), dict) else {},
        "created_at": int(item.get("created_at") or now_ms()),
        "updated_at": int(item.get("updated_at") or item.get("created_at") or now_ms()),
    }


def seed_system_prompt_library(*, builtin_prompt_templates, defaultPromptTemplateCategories):
    return {
        "id": "system",
        "name": "系统提示词库",
        "type": "prompt",
        "items": builtin_prompt_templates(),
        "categories": defaultPromptTemplateCategories(),
    }


def default_prompt_libraries(*, now_ms, seed_system_prompt_library):
    return {
        "active_library_id": "system",
        "libraries": [seed_system_prompt_library()],
        "updated_at": now_ms(),
    }


def defaultPromptTemplateCategories():
    return [
        {"id": "view", "name": "视角"},
        {"id": "storyboard", "name": "分镜"},
        {"id": "character", "name": "角色"},
        {"id": "product", "name": "产品"},
        {"id": "lighting", "name": "光影"},
        {"id": "custom", "name": "我的"},
    ]


def normalize_prompt_template_categories(*category_lists, include_defaults=True, defaultPromptTemplateCategories, normalize_prompt_category_id, sanitize_asset_name):
    normalized = []
    seen = set()

    def add_category(category):
        if not isinstance(category, dict):
            return
        cat_id = normalize_prompt_category_id(category.get("id") or category.get("name") or "custom")
        if cat_id in seen:
            return
        seen.add(cat_id)
        # 不再强制把 custom 显示为“我的”，分组名以存储为准，这样内置分组也能被重命名。
        name = sanitize_asset_name(category.get("name") or cat_id, cat_id)
        normalized.append({"id": cat_id, "name": name})

    # 先采用已存储的分组（保留用户对内置分组的重命名/删除），
    # 只有在系统库一个分组都没有时才补齐默认内置分组（首次初始化）。
    for categories in category_lists:
        if isinstance(categories, list):
            for category in categories:
                add_category(category)
    if include_defaults and not normalized:
        for category in defaultPromptTemplateCategories():
            add_category(category)
    return normalized


def normalize_prompt_libraries(data, *, default_prompt_libraries, normalize_prompt_category_id, normalize_prompt_library_item, normalize_prompt_template_categories, now_ms, sanitize_asset_name, seed_system_prompt_library):
    if not isinstance(data, dict):
        data = default_prompt_libraries()
    raw_libraries = data.get("libraries") if isinstance(data.get("libraries"), list) else []
    raw_libraries = [lib for lib in raw_libraries if isinstance(lib, dict)]
    if not any(lib.get("id") == "system" for lib in raw_libraries):
        raw_libraries = [seed_system_prompt_library()] + raw_libraries
    libraries = []
    seen_lib_ids = set()
    for raw in raw_libraries:
        is_system = raw.get("id") == "system"
        if is_system:
            lib_id = "system"
        else:
            lib_id = re.sub(r"[^A-Za-z0-9_-]+", "_", str(raw.get("id") or f"lib_{uuid.uuid4().hex[:12]}"))[:60] or f"lib_{uuid.uuid4().hex[:12]}"
        if lib_id in seen_lib_ids:
            continue
        seen_lib_ids.add(lib_id)
        items = []
        seen_items = set()
        for raw_item in (raw.get("items") if isinstance(raw.get("items"), list) else []):
            if not isinstance(raw_item, dict):
                continue
            item = normalize_prompt_library_item(raw_item)
            item_id = item.get("id") or f"tpl_{uuid.uuid4().hex[:12]}"
            if item_id in seen_items:
                continue
            seen_items.add(item_id)
            items.append(item)
        default_name = "系统提示词库" if is_system else "提示词库"
        raw_categories = raw.get("categories") if isinstance(raw.get("categories"), list) else []
        if not is_system:
            # 非系统库不保留任何内置分组（视角/分镜等），仅保留用户自建分组
            builtin_ids = {"view", "storyboard", "character", "product", "lighting", "custom"}
            raw_categories = [c for c in raw_categories if isinstance(c, dict) and normalize_prompt_category_id(c.get("id") or c.get("name") or "") not in builtin_ids]
        libraries.append({
            "id": lib_id,
            "name": sanitize_asset_name(raw.get("name") or default_name, default_name),
            "type": "prompt",
            "readonly": False,
            "system": is_system,
            "categories": normalize_prompt_template_categories(raw_categories, include_defaults=is_system),
            "items": items,
        })
    active = str(data.get("active_library_id") or "system")
    if not any(lib["id"] == active for lib in libraries):
        active = "system" if any(lib["id"] == "system" for lib in libraries) else (libraries[0]["id"] if libraries else "system")
    return {"active_library_id": active, "libraries": libraries, "updated_at": int(data.get("updated_at") or now_ms())}


def _save_prompt_libraries_unlocked(data, *, DATA_DIR, PROMPT_LIBRARY_PATH, normalize_prompt_libraries, now_ms, write_json_atomic):
    data = normalize_prompt_libraries(data)
    data["updated_at"] = now_ms()
    os.makedirs(DATA_DIR, exist_ok=True)
    write_json_atomic(PROMPT_LIBRARY_PATH, data, ensure_ascii=False, indent=2)
    return data


def _load_prompt_libraries_unlocked(*, strict=False, HTTPException, PROMPT_LIBRARY_PATH, _save_prompt_libraries_unlocked, default_prompt_libraries, normalize_prompt_libraries):
    if not os.path.exists(PROMPT_LIBRARY_PATH):
        return _save_prompt_libraries_unlocked(default_prompt_libraries())
    try:
        with open(PROMPT_LIBRARY_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, UnicodeError, json.JSONDecodeError):
        # 已有文件无法可靠读取时保留故障现场，不能用默认库覆盖用户数据。
        if strict:
            raise HTTPException(status_code=500, detail="提示词库记录损坏或无法读取，已保留原文件；请从备份恢复")
        return default_prompt_libraries()
    if not isinstance(data, dict):
        if strict:
            raise HTTPException(status_code=500, detail="提示词库记录格式无效，已保留原文件；请从备份恢复")
        return default_prompt_libraries()
    normalized = normalize_prompt_libraries(data)
    if normalized.get("active_library_id") != data.get("active_library_id") or normalized.get("libraries") != data.get("libraries"):
        return _save_prompt_libraries_unlocked(normalized)
    return normalized


def load_prompt_libraries(*, PROMPT_LIBRARY_LOCK, PROMPT_LIBRARY_PATH, _load_prompt_libraries_unlocked, interprocess_file_lock):
    with interprocess_file_lock(PROMPT_LIBRARY_PATH):
        with PROMPT_LIBRARY_LOCK:
            return _load_prompt_libraries_unlocked()


def save_prompt_libraries(data, *, PROMPT_LIBRARY_LOCK, PROMPT_LIBRARY_PATH, _save_prompt_libraries_unlocked, interprocess_file_lock):
    with interprocess_file_lock(PROMPT_LIBRARY_PATH):
        with PROMPT_LIBRARY_LOCK:
            return _save_prompt_libraries_unlocked(data)


def public_prompt_libraries(data=None, *, load_prompt_libraries, normalize_prompt_libraries, now_ms):
    data = normalize_prompt_libraries(data or load_prompt_libraries())
    return {
        "active_library_id": data.get("active_library_id") or (data.get("libraries") or [{}])[0].get("id") or "system",
        "libraries": data.get("libraries") or [],
        "updated_at": data.get("updated_at") or now_ms(),
    }


def find_prompt_library(data, library_id=''):
    if not isinstance(data, dict):
        return None
    libraries = data.get("libraries") if isinstance(data.get("libraries"), list) else []
    library_id = str(library_id or data.get("active_library_id") or "").strip()
    return next((item for item in libraries if item.get("id") == library_id), None) or (libraries[0] if libraries else None)


async def smart_canvas_prompt_templates(*, BASE_DIR, builtin_prompt_templates, prompt_template_markdown_path, write_diagnostic):
    try:
        template_path = prompt_template_markdown_path()
        source = os.path.relpath(template_path, BASE_DIR).replace("\\", "/") if template_path else ""
        return {"templates": builtin_prompt_templates(), "source": source}
    except Exception as e:
        write_diagnostic(f"prompt template api load failed error={type(e).__name__}")
        return {"templates": []}


async def get_prompt_libraries(*, public_prompt_libraries):
    return {"library": public_prompt_libraries()}


async def create_prompt_library(payload, *, _load_prompt_libraries_unlocked, _save_prompt_libraries_unlocked, public_prompt_libraries, sanitize_asset_name):
    data = _load_prompt_libraries_unlocked(strict=True)
    library = {
        "id": f"lib_{uuid.uuid4().hex[:12]}",
        "name": sanitize_asset_name(payload.name, "提示词库"),
        "type": "prompt",
        "categories": [],
        "items": [],
    }
    data.setdefault("libraries", []).append(library)
    data["active_library_id"] = library["id"]
    data = _save_prompt_libraries_unlocked(data)
    new_lib = next((lib for lib in data.get("libraries", []) if lib.get("id") == library["id"]), library)
    return {"library": public_prompt_libraries(data), "prompt_library": new_lib}


async def rename_prompt_library(library_id, payload, *, HTTPException, _load_prompt_libraries_unlocked, _save_prompt_libraries_unlocked, find_prompt_library, public_prompt_libraries, sanitize_asset_name):
    data = _load_prompt_libraries_unlocked(strict=True)
    library = find_prompt_library(data, library_id)
    if not library or library.get("id") != library_id:
        raise HTTPException(status_code=404, detail="提示词库不存在")
    library["name"] = sanitize_asset_name(payload.name, library.get("name") or "提示词库")
    data = _save_prompt_libraries_unlocked(data)
    return {"library": public_prompt_libraries(data), "prompt_library": library}


async def delete_prompt_library(library_id, *, HTTPException, _load_prompt_libraries_unlocked, _save_prompt_libraries_unlocked, public_prompt_libraries):
    if library_id == "system":
        raise HTTPException(status_code=400, detail="系统提示词库不能删除，可以删除其中的提示词")
    data = _load_prompt_libraries_unlocked(strict=True)
    libraries = data.get("libraries", []) or []
    kept = [lib for lib in libraries if lib.get("id") != library_id]
    if len(kept) == len(libraries):
        raise HTTPException(status_code=404, detail="提示词库不存在")
    data["libraries"] = kept
    if data.get("active_library_id") == library_id:
        data["active_library_id"] = "system"
    data = _save_prompt_libraries_unlocked(data)
    return {"library": public_prompt_libraries(data)}


async def add_prompt_library_item(payload, *, HTTPException, _load_prompt_libraries_unlocked, _save_prompt_libraries_unlocked, find_prompt_library, normalize_prompt_library_item, now_ms, public_prompt_libraries):
    data = _load_prompt_libraries_unlocked(strict=True)
    library = find_prompt_library(data, payload.library_id)
    if not library:
        raise HTTPException(status_code=404, detail="提示词库不存在")
    if not str(payload.positive or "").strip():
        raise HTTPException(status_code=400, detail="提示词内容不能为空")
    item = normalize_prompt_library_item({
        "id": f"tpl_{uuid.uuid4().hex[:12]}",
        "name": payload.name,
        "category": payload.category,
        "positive": payload.positive,
        "negative": payload.negative,
        "scene": payload.scene,
        "created_at": now_ms(),
        "updated_at": now_ms(),
    })
    library.setdefault("items", []).insert(0, item)
    data["active_library_id"] = library.get("id") or data.get("active_library_id")
    data = _save_prompt_libraries_unlocked(data)
    return {"library": public_prompt_libraries(data), "item": item}


async def update_prompt_library_item(item_id, payload, *, HTTPException, _load_prompt_libraries_unlocked, _save_prompt_libraries_unlocked, normalize_prompt_library_item, now_ms, public_prompt_libraries):
    data = _load_prompt_libraries_unlocked(strict=True)
    for library in data.get("libraries", []) or []:
        if payload.library_id and library.get("id") != payload.library_id:
            continue
        for index, item in enumerate(library.get("items", []) or []):
            if item.get("id") == item_id:
                next_item = normalize_prompt_library_item({
                    **item,
                    "name": payload.name or item.get("name"),
                    "category": payload.category or item.get("category"),
                    "positive": payload.positive or item.get("positive"),
                    "negative": payload.negative,
                    "scene": payload.scene,
                    "updated_at": now_ms(),
                })
                library["items"][index] = next_item
                data = _save_prompt_libraries_unlocked(data)
                return {"library": public_prompt_libraries(data), "item": next_item}
    raise HTTPException(status_code=404, detail="提示词不存在")


async def delete_prompt_library_item(item_id, *, HTTPException, _load_prompt_libraries_unlocked, _save_prompt_libraries_unlocked, public_prompt_libraries):
    data = _load_prompt_libraries_unlocked(strict=True)
    removed = None
    for library in data.get("libraries", []) or []:
        keep = []
        for item in library.get("items", []) or []:
            if item.get("id") == item_id:
                removed = item
            else:
                keep.append(item)
        library["items"] = keep
    if not removed:
        raise HTTPException(status_code=404, detail="提示词不存在")
    data = _save_prompt_libraries_unlocked(data)
    return {"library": public_prompt_libraries(data), "removed": 1}


async def batch_delete_prompt_library_items(payload, *, HTTPException, _load_prompt_libraries_unlocked, _save_prompt_libraries_unlocked, public_prompt_libraries):
    ids = {str(item) for item in (payload.ids or []) if str(item)}
    if not ids:
        raise HTTPException(status_code=400, detail="没有选择提示词")
    data = _load_prompt_libraries_unlocked(strict=True)
    removed = 0
    for library in data.get("libraries", []) or []:
        keep = []
        for item in library.get("items", []) or []:
            if item.get("id") in ids:
                removed += 1
            else:
                keep.append(item)
        library["items"] = keep
    data = _save_prompt_libraries_unlocked(data)
    return {"library": public_prompt_libraries(data), "removed": removed}


async def add_prompt_library_category(payload, *, HTTPException, PROMPT_BUILTIN_CATEGORY_IDS, _load_prompt_libraries_unlocked, _save_prompt_libraries_unlocked, find_prompt_library, public_prompt_libraries, sanitize_asset_name):
    data = _load_prompt_libraries_unlocked(strict=True)
    library = find_prompt_library(data, payload.library_id) or find_prompt_library(data, "system")
    if not library:
        raise HTTPException(status_code=404, detail="提示词库不存在")
    name = sanitize_asset_name(payload.name, "新分组")
    existing = {str(c.get("id")) for c in (library.get("categories") or []) if isinstance(c, dict)} | PROMPT_BUILTIN_CATEGORY_IDS
    cat_id = f"pcat_{uuid.uuid4().hex[:10]}"
    while cat_id in existing:
        cat_id = f"pcat_{uuid.uuid4().hex[:10]}"
    category = {"id": cat_id, "name": name}
    library.setdefault("categories", []).append(category)
    data = _save_prompt_libraries_unlocked(data)
    return {"library": public_prompt_libraries(data), "category": category}


async def rename_prompt_library_category(category_id, payload, *, HTTPException, _load_prompt_libraries_unlocked, _save_prompt_libraries_unlocked, public_prompt_libraries, sanitize_asset_name):
    name = sanitize_asset_name(payload.name, "")
    if not name:
        raise HTTPException(status_code=400, detail="分组名称不能为空")
    data = _load_prompt_libraries_unlocked(strict=True)
    updated = False
    for library in data.get("libraries", []) or []:
        for cat in library.get("categories") or []:
            if isinstance(cat, dict) and cat.get("id") == category_id:
                cat["name"] = name
                updated = True
    if not updated:
        raise HTTPException(status_code=404, detail="分组不存在")
    data = _save_prompt_libraries_unlocked(data)
    return {"library": public_prompt_libraries(data)}


async def delete_prompt_library_category(category_id, *, HTTPException, _load_prompt_libraries_unlocked, _save_prompt_libraries_unlocked, public_prompt_libraries):
    data = _load_prompt_libraries_unlocked(strict=True)
    found = False
    for library in data.get("libraries", []) or []:
        cats = library.get("categories") or []
        kept = [c for c in cats if not (isinstance(c, dict) and c.get("id") == category_id)]
        if len(kept) != len(cats):
            found = True
            library["categories"] = kept
            # 被删分组下的条目改挂到剩余的第一个分组；若已无分组则归到“未分类”。
            fallback = next((str(c.get("id")) for c in kept if isinstance(c, dict) and c.get("id")), "")
            for item in library.get("items", []) or []:
                if isinstance(item, dict) and item.get("category") == category_id:
                    item["category"] = fallback
    if not found:
        raise HTTPException(status_code=404, detail="分组不存在")
    data = _save_prompt_libraries_unlocked(data)
    return {"library": public_prompt_libraries(data)}


