"""素材库管理、入库与媒体操作协调。

索引、文件、锁和供应商调用由应用显式注入，保留现有提交/清理顺序。
"""
import os
import uuid
import tempfile

async def create_asset_library(payload, *, load_asset_library, sanitize_asset_name, save_asset_library):
    lib = load_asset_library()
    library = {"id": f"lib_{uuid.uuid4().hex[:12]}", "name": sanitize_asset_name(payload.name, "资产库"), "type": "asset", "categories": []}
    library["categories"].append({"id": f"cat_{uuid.uuid4().hex[:12]}", "name": "默认分组", "type": "image", "items": []})
    library["categories"].append({"id": f"wf_{uuid.uuid4().hex[:12]}", "name": "工作流", "type": "workflow", "items": []})
    lib.setdefault("libraries", []).append(library)
    lib["active_library_id"] = library["id"]
    save_asset_library(lib)
    return {"library": lib, "asset_library": library}


async def rename_asset_library(library_id, payload, *, HTTPException, find_asset_library, load_asset_library, sanitize_asset_name, save_asset_library):
    lib = load_asset_library()
    library = find_asset_library(lib, library_id)
    if not library or library.get("id") != library_id:
        raise HTTPException(status_code=404, detail="资产库不存在")
    library["name"] = sanitize_asset_name(payload.name, library.get("name") or "资产库")
    save_asset_library(lib)
    return {"library": lib, "asset_library": library}


async def delete_asset_library(library_id, *, ASSET_LIBRARY_DIR, HTTPException, asset_library_index_lock, load_asset_library, remove_asset_library_file, save_asset_library, write_diagnostic):
    with asset_library_index_lock():
        lib = load_asset_library()
        libraries = lib.get("libraries") or []
        if len(libraries) <= 1:
            raise HTTPException(status_code=400, detail="至少保留一个资产库")
        removed_library = next((item for item in libraries if item.get("id") == library_id), None)
        if not removed_library:
            raise HTTPException(status_code=404, detail="资产库不存在")
        removed_items = []
        category_dirs = []
        for category in removed_library.get("categories") or []:
            removed_items.extend(item for item in category.get("items") or [] if isinstance(item, dict))
            category_dir = str(category.get("dir") or "").strip("/\\").strip()
            if category_dir:
                category_dirs.append(category_dir)
        # 工作流分类没有 dir，条目文件仍由 remove_asset_library_file 统一处理。
        lib["libraries"] = [item for item in libraries if item.get("id") != library_id]
        if lib.get("active_library_id") == library_id:
            lib["active_library_id"] = lib["libraries"][0].get("id")
        save_asset_library(lib)

    for item in removed_items:
        remove_asset_library_file(item)
    for category_dir in category_dirs:
        try:
            target = os.path.join(ASSET_LIBRARY_DIR, category_dir)
            if os.path.isdir(target) and os.path.abspath(target).startswith(os.path.abspath(ASSET_LIBRARY_DIR) + os.sep):
                os.rmdir(target)  # 非空时保留仍被引用的文件和目录。
        except OSError:
            pass
        except Exception as exc:
            write_diagnostic(f"asset library category directory delete failed error={type(exc).__name__}")
    return {"library": lib}


async def create_asset_library_category(payload, *, ASSET_LIBRARY_DIR, HTTPException, find_asset_library, load_asset_library, sanitize_asset_name, save_asset_library, unique_asset_category_dir, write_diagnostic):
    lib = load_asset_library()
    library = find_asset_library(lib, payload.library_id)
    if not library:
        raise HTTPException(status_code=404, detail="资产库不存在")
    cat_type = "workflow" if str(payload.type or "").lower() == "workflow" else "image"
    category = {"id": f"cat_{uuid.uuid4().hex[:12]}", "name": sanitize_asset_name(payload.name, "新文件夹"), "type": cat_type, "items": []}
    if cat_type == "image":
        # 图片分组在 library/ 下建一个真实文件夹，之后该分组的资产都存进这个文件夹，便于在磁盘上管理。
        category["dir"] = unique_asset_category_dir(library, payload.name)
        try:
            os.makedirs(os.path.join(ASSET_LIBRARY_DIR, category["dir"]), exist_ok=True)
        except Exception as exc:
            write_diagnostic(f"asset category directory create failed error={type(exc).__name__}")
    library.setdefault("categories", []).append(category)
    lib["active_library_id"] = library.get("id") or lib.get("active_library_id")
    save_asset_library(lib)
    return {"library": lib, "category": category}


async def rename_asset_library_category(category_id, payload, *, HTTPException, find_asset_category_with_library, load_asset_library, sanitize_asset_name, save_asset_library):
    lib = load_asset_library()
    _, cat = find_asset_category_with_library(lib, category_id, payload.library_id)
    if not cat:
        raise HTTPException(status_code=404, detail="分类不存在")
    cat["name"] = sanitize_asset_name(payload.name, cat.get("name") or "新文件夹")
    save_asset_library(lib)
    return {"library": lib, "category": cat}


async def delete_asset_library_category(category_id, library_id='', *, ASSET_LIBRARY_DIR, HTTPException, asset_library_index_lock, find_asset_category_with_library, load_asset_library, remove_asset_library_file, save_asset_library, write_diagnostic):
    with asset_library_index_lock():
        lib = load_asset_library()
        library, cat = find_asset_category_with_library(lib, category_id, library_id)
        if not cat:
            raise HTTPException(status_code=404, detail="分类不存在")
        if cat.get("type") == "workflow" and category_id == "workflows" and (library.get("id") or "") == "default":
            raise HTTPException(status_code=400, detail="默认工作流分类不能删除")
        removed_items = list(cat.get("items") or [])
        cat_dir = str(cat.get("dir") or "").strip("/").strip()
        library["categories"] = [c for c in library.get("categories", []) if c.get("id") != category_id]
        save_asset_library(lib)
    for item in removed_items:
        remove_asset_library_file(item)
    if cat_dir:
        try:
            target = os.path.join(ASSET_LIBRARY_DIR, cat_dir)
            if os.path.isdir(target) and os.path.abspath(target).startswith(os.path.abspath(ASSET_LIBRARY_DIR) + os.sep):
                os.rmdir(target)  # 保留仍被画布等引用的文件和非空目录
        except OSError:
            pass
        except Exception as exc:
            write_diagnostic(f"asset category directory delete failed error={type(exc).__name__}")
    return {"library": lib}


async def add_asset_library_item(payload, *, HTTPException, import_asset_library_media_sources, output_file_from_url):
    src = output_file_from_url(payload.url)
    if not src:
        raise HTTPException(status_code=400, detail="只支持保存本地 /assets 或 /output 媒体")
    lib, items, added_count = await import_asset_library_media_sources(
        [(src, payload.name or os.path.basename(src))], payload.library_id, payload.category_id
    )
    return {"library": lib, "item": items[0], "already_present": added_count == 0}


async def import_asset_library_media_sources(sources, library_id, category_id, *, HTTPException, asset_library_index_lock, classify_asset_image_best_effort, find_asset_category_in_library, find_duplicate_asset_library_item, load_asset_library, make_asset_library_item, output_file_from_url, remove_asset_library_file, save_asset_library):
    """导入媒体，按目标分类中的实际文件内容去重，最后提交时再检查并发导入。"""
    with asset_library_index_lock():
        lib = load_asset_library()
        cat = find_asset_category_in_library(lib, category_id, library_id)
        if not cat:
            raise HTTPException(status_code=404, detail="分类不存在")
        if cat.get("type") != "image":
            raise HTTPException(status_code=400, detail="该分类暂不支持添加媒体")
        subdir = cat.get("dir") or ""
    candidates = []
    seen_fingerprints = set()
    try:
        for src, name in sources:
            _, item = make_asset_library_item(src, name, subdir=subdir)
            candidates.append(item)
            signature = (item["kind"], item["content_size"], item["content_sha256"])
            if signature in seen_fingerprints:
                continue
            seen_fingerprints.add(signature)
            with asset_library_index_lock():
                current = load_asset_library()
                current_cat = find_asset_category_in_library(current, category_id, library_id)
                if not current_cat:
                    raise HTTPException(status_code=404, detail="分类不存在")
                if current_cat.get("type") != "image":
                    raise HTTPException(status_code=400, detail="该分类暂不支持添加媒体")
                existing = find_duplicate_asset_library_item(current_cat, item)
            if not existing and item["kind"] == "image":
                classification = await classify_asset_image_best_effort(
                    output_file_from_url(item["url"]) or src
                )
                if classification:
                    item["classification"] = classification
        with asset_library_index_lock():
            lib = load_asset_library()
            cat = find_asset_category_in_library(lib, category_id, library_id)
            if not cat:
                raise HTTPException(status_code=404, detail="分类不存在")
            if cat.get("type") != "image":
                raise HTTPException(status_code=400, detail="该分类暂不支持添加媒体")
            result_items = []
            discarded = []
            added_count = 0
            for item in candidates:
                existing = find_duplicate_asset_library_item(cat, item)
                if existing:
                    result_items.append(existing)
                    discarded.append(item)
                else:
                    cat.setdefault("items", []).append(item)
                    result_items.append(item)
                    added_count += 1
            if added_count:
                save_asset_library(lib)
    except BaseException:
        for item in candidates:
            remove_asset_library_file(item)
        raise
    for item in discarded:
        remove_asset_library_file(item)
    return lib, result_items, added_count


async def batch_add_asset_library_items(payload, *, import_asset_library_media_sources, output_file_from_url):
    sources = []
    for entry in (payload.items or [])[:200]:
        src = output_file_from_url(entry.url)
        if src:
            sources.append((src, entry.name or os.path.basename(src)))
    lib, items, added_count = await import_asset_library_media_sources(
        sources, payload.library_id, payload.category_id
    )
    return {"library": lib, "items": items, "added_count": added_count,
            "duplicate_count": len(items) - added_count}


async def rename_asset_library_item(item_id, payload, *, HTTPException, load_asset_library, sanitize_asset_name, save_asset_library):
    lib = load_asset_library()
    for library in lib.get("libraries", []):
        for cat in library.get("categories", []):
            for item in cat.get("items", []):
                if item.get("id") == item_id:
                    item["name"] = sanitize_asset_name(payload.name, item.get("name") or "asset")
                    save_asset_library(lib)
                    return {"library": lib, "item": item}
    raise HTTPException(status_code=404, detail="资产不存在")


async def classify_asset_library_items(payload, *, asset_library_index_lock, asset_library_media_kind, classify_image_with_provider, find_asset_item_in_library, load_asset_library, output_file_from_url, public_error_detail, save_asset_library):
    lib = load_asset_library()
    results = []
    classified = []
    for item_id in (payload.ids or [])[:80]:
        item = find_asset_item_in_library(lib, item_id, payload.library_id)
        result = {"id": item_id, "ok": False, "classification": None, "error": ""}
        if not item:
            result["error"] = "资产不存在"
            results.append(result)
            continue
        if asset_library_media_kind(item.get("url") or "") != "image" and item.get("kind") != "image":
            result["error"] = "仅支持图片素材智能分类"
            results.append(result)
            continue
        path = output_file_from_url(item.get("url") or "")
        if not path or not os.path.isfile(path):
            result["error"] = "文件不存在"
            results.append(result)
            continue
        try:
            classification = await classify_image_with_provider(path, payload.provider, payload.model, payload.ms_model, payload.prompt)
            classified.append((item_id, item.get("url"), classification, result))
        except Exception as exc:
            result["error"] = public_error_detail(getattr(exc, "detail", "") or exc, fallback="智能分类失败")
        results.append(result)
    if classified:
        with asset_library_index_lock():
            lib = load_asset_library()
            changed = False
            for item_id, url, classification, result in classified:
                item = find_asset_item_in_library(lib, item_id, payload.library_id)
                if not item or item.get("url") != url:
                    result["error"] = "资产已被删除或更改"
                    continue
                item["classification"] = classification
                result.update({"ok": True, "classification": classification})
                changed = True
            if changed:
                save_asset_library(lib)
    return {"library": lib, "count": sum(1 for item in results if item.get("ok")), "items": results}


async def delete_asset_library_item(item_id, *, HTTPException, asset_library_index_lock, load_asset_library, remove_asset_library_file, save_asset_library):
    with asset_library_index_lock():
        lib = load_asset_library()
        removed = None
        for library in lib.get("libraries", []):
            for cat in library.get("categories", []):
                keep = []
                for item in cat.get("items", []):
                    if item.get("id") == item_id:
                        removed = item
                    else:
                        keep.append(item)
                cat["items"] = keep
        if not removed:
            raise HTTPException(status_code=404, detail="资产不存在")
        save_asset_library(lib)
    remove_asset_library_file(removed)
    return {"library": lib}


async def batch_delete_asset_library_items(payload, *, HTTPException, asset_library_index_lock, load_asset_library, remove_asset_library_file, save_asset_library):
    ids = {str(item) for item in (payload.ids or []) if str(item)}
    if not ids:
        raise HTTPException(status_code=400, detail="没有选择资产")
    with asset_library_index_lock():
        lib = load_asset_library()
        removed = 0
        removed_items = []
        for library in lib.get("libraries", []):
            if payload.library_id and library.get("id") != payload.library_id:
                continue
            for cat in library.get("categories", []):
                keep = []
                for item in cat.get("items", []):
                    if item.get("id") in ids:
                        removed += 1
                        removed_items.append(item)
                    else:
                        keep.append(item)
                cat["items"] = keep
        save_asset_library(lib)
    for item in removed_items:
        remove_asset_library_file(item)
    return {"library": lib, "removed": removed}


async def batch_move_asset_library_items(payload, *, HTTPException, find_asset_category_in_library, load_asset_library, save_asset_library):
    ids = {str(item) for item in (payload.ids or []) if str(item)}
    if not ids:
        raise HTTPException(status_code=400, detail="没有选择资产")
    lib = load_asset_library()
    target_cat = find_asset_category_in_library(lib, payload.target_category_id, payload.target_library_id)
    if not target_cat:
        raise HTTPException(status_code=404, detail="目标分组不存在")
    target_type = target_cat.get("type") or "image"
    moved = []
    for library in lib.get("libraries", []):
        if payload.library_id and library.get("id") != payload.library_id:
            continue
        for cat in library.get("categories", []):
            if (cat.get("type") or "image") != target_type:
                continue
            keep = []
            for item in cat.get("items", []):
                if item.get("id") in ids:
                    moved.append(item)
                else:
                    keep.append(item)
            cat["items"] = keep
    existing_ids = {item.get("id") for item in target_cat.get("items", [])}
    for item in moved:
        if item.get("id") not in existing_ids:
            target_cat.setdefault("items", []).append(item)
            existing_ids.add(item.get("id"))
    save_asset_library(lib)
    return {"library": lib, "moved": len(moved)}


async def batch_crop_asset_library_items(payload, *, HTTPException, Image, find_asset_category_in_library, load_asset_library, make_asset_library_item, output_file_from_url, save_asset_library):
    ids = {str(item) for item in (payload.ids or []) if str(item)}
    if not ids:
        raise HTTPException(status_code=400, detail="没有选择资产")
    lib = load_asset_library()
    target_cat = None
    if payload.target_category_id:
        target_cat = find_asset_category_in_library(lib, payload.target_category_id, payload.target_library_id)
        if not target_cat:
            raise HTTPException(status_code=404, detail="目标分组不存在")
        if target_cat.get("type") != "image":
            raise HTTPException(status_code=400, detail="目标分组不支持媒体")
    added = []
    for library in lib.get("libraries", []):
        if payload.library_id and library.get("id") != payload.library_id:
            continue
        for cat in library.get("categories", []):
            if cat.get("type") != "image":
                continue
            source_items = [item for item in (cat.get("items", []) or []) if item.get("id") in ids]
            for item in source_items:
                src = output_file_from_url(item.get("url") or "")
                if not src or not os.path.isfile(src):
                    continue
                try:
                    with Image.open(src) as img:
                        img = img.convert("RGBA")
                        w, h = img.size
                        side = min(w, h)
                        if side <= 0:
                            continue
                        left = max(0, (w - side) // 2)
                        top = max(0, (h - side) // 2)
                        cropped = img.crop((left, top, left + side, top + side))
                        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".png")
                        tmp_path = tmp.name
                        tmp.close()
                        try:
                            cropped.save(tmp_path, "PNG")
                            base_name = os.path.splitext(item.get("name") or "asset")[0] + "_crop.png"
                            dest_cat = target_cat or cat
                            _, next_item = make_asset_library_item(tmp_path, base_name, subdir=dest_cat.get("dir") or "")
                            dest_cat.setdefault("items", []).append(next_item)
                            added.append(next_item)
                        finally:
                            try:
                                os.remove(tmp_path)
                            except Exception:
                                pass
                except Exception:
                    continue
    save_asset_library(lib)
    return {"library": lib, "added": len(added), "items": added}


