"""媒体引用扫描、画布/日志清空和历史文件清理。

索引、文件、锁和供应商调用由应用显式注入，保留现有提交/清理顺序。
"""
import os
import asyncio
import hashlib
import json

def generated_media_path_from_url(url, *, HTTPException, OUTPUT_DIR, OUTPUT_OUTPUT_DIR, local_media_path_from_url):
    """Resolve a URL only when it points inside a generated-output directory."""
    try:
        path = local_media_path_from_url(url)
    except (HTTPException, OSError, ValueError):
        return None
    if not path or not os.path.isfile(path):
        return None
    path = os.path.realpath(path)
    for root in (OUTPUT_OUTPUT_DIR, OUTPUT_DIR):
        root = os.path.realpath(root)
        try:
            if os.path.commonpath([root, path]) == root:
                return path
        except ValueError:
            continue
    return None


def persisted_json_references_media_path(target_path, *, ASSET_LIBRARY_PATH, CANVAS_DIR, CONVERSATION_DIR, json_references_media_path):
    """Scan persisted user documents before deleting generated media."""
    candidates = [ASSET_LIBRARY_PATH]
    for root in (CANVAS_DIR, CONVERSATION_DIR):
        if os.path.isdir(root):
            for current, _, files in os.walk(root):
                candidates.extend(os.path.join(current, name) for name in files if name.lower().endswith(".json"))
    seen = set()
    for path in candidates:
        path = os.path.abspath(path)
        if path in seen or not os.path.isfile(path):
            continue
        seen.add(path)
        try:
            with open(path, "r", encoding="utf-8-sig") as handle:
                value = json.load(handle)
        except (OSError, UnicodeError, json.JSONDecodeError):
            return True
        if json_references_media_path(value, target_path):
            return True
    return False


def prune_generation_history_for_media(paths, *, HISTORY_FILE, HISTORY_LOCK, HistoryPruneError, json_references_media_path, write_json_atomic):
    """Remove history cards that would otherwise point at deleted media."""
    if not paths or not os.path.isfile(HISTORY_FILE):
        return 0
    try:
        with HISTORY_LOCK:
            with open(HISTORY_FILE, "r", encoding="utf-8-sig") as handle:
                history = json.load(handle)
            if not isinstance(history, list):
                raise HistoryPruneError("历史记录格式异常")
            kept = [
                record for record in history
                if not any(json_references_media_path(record, path) for path in paths)
            ]
            removed = len(history) - len(kept)
            if removed:
                write_json_atomic(HISTORY_FILE, kept, ensure_ascii=False, indent=4)
            return removed
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise HistoryPruneError("历史记录清理失败") from exc


def smart_owned_result_items(images, paths, *, json_references_media_path):
    """Return generated results, including legacy results without the marker."""
    return [
        item for item in images
        if isinstance(item, dict)
        and item.get("loopInputPreview") is not True
        and (
            item.get("generatedResult") is True
            or any(json_references_media_path(item, path) for path in paths)
        )
    ]


def expand_canvas_generated_media_paths(canvas, paths, *, collect_local_media_urls, generated_media_path_from_url, json_references_media_path, smart_owned_result_items):
    """Include every generated result owned by a result node touched by the log."""
    expanded = list(paths)
    for node in list(canvas.get("nodes") or []):
        node_type = str(node.get("type") or "").strip().lower()
        images = list(node.get("images") or [])
        if node_type == "output":
            owned_items = images
        elif node_type == "smart-image":
            owned_items = smart_owned_result_items(images, paths)
        else:
            owned_items = []
        if not any(json_references_media_path(item, path) for item in owned_items for path in paths):
            continue
        for item in owned_items:
            for url in collect_local_media_urls(item):
                candidate = generated_media_path_from_url(url)
                if candidate and candidate not in expanded:
                    expanded.append(candidate)
    return expanded


def reset_canvas_result_nodes_for_media(canvas, paths, *, json_references_media_path, smart_owned_result_items):
    """Clear generated media while preserving prompts, references, settings and links."""
    reset_ids = []
    updated_nodes = []
    for node in list(canvas.get("nodes") or []):
        node = dict(node)
        node_type = str(node.get("type") or "").strip().lower()
        changed = False
        if isinstance(node.get("generatedOutputs"), list):
            outputs = list(node.get("generatedOutputs") or [])
            kept_outputs = [
                item for item in outputs
                if not any(json_references_media_path(item, path) for path in paths)
            ]
            if len(kept_outputs) != len(outputs):
                node["generatedOutputs"] = kept_outputs
                changed = True
        if node_type in {"smart-image", "output"} and isinstance(node.get("images"), list):
            images = list(node.get("images") or [])
            owned_items = smart_owned_result_items(images, paths) if node_type == "smart-image" else images
            owns_target = any(
                json_references_media_path(item, path) for item in owned_items for path in paths
            )
            kept_images = [
                item for item in images
                if not (
                    owns_target
                    and item in owned_items
                    and any(json_references_media_path(item, path) for path in paths)
                )
            ]
            if len(kept_images) != len(images):
                node["images"] = kept_images
                changed = True
                if node_type == "output":
                    node["_pending"] = []
                    node["imageComparisons"] = {}
                if node_type == "smart-image":
                    node["pending"] = 0
                    node["running"] = False
                    node["queued"] = False
                    for key in (
                        "jimengPending", "pendingTasks", "runStartedAt", "runFinishedAt",
                        "runElapsedMs", "runTimerHidden", "outputKind", "w", "h",
                    ):
                        node.pop(key, None)
        elif node_type == "image" and any(json_references_media_path(node.get("url"), path) for path in paths):
            node["url"] = ""
            node["mediaKind"] = "image"
            node["name"] = "空白图片"
            changed = True
        if changed and node.get("id"):
            reset_ids.append(str(node["id"]))
        updated_nodes.append(node)
    if reset_ids:
        canvas["nodes"] = updated_nodes
    return reset_ids


def delete_media_preview_cache(path, *, MEDIA_PREVIEW_DIR):
    """Delete derived previews for a source file before the source disappears."""
    try:
        stat = os.stat(path)
    except OSError:
        return 0
    source = os.path.realpath(path)
    removed = 0
    for width in range(0, 4097):
        keys = [hashlib.sha1(f"{source}|{stat.st_mtime_ns}|{stat.st_size}|{width}|jpg".encode("utf-8", "ignore")).hexdigest() + ".jpg"]
        if 64 <= width <= 2048:
            preview_key = hashlib.sha1(f"{source}|{stat.st_mtime_ns}|{stat.st_size}|{width}".encode("utf-8", "ignore")).hexdigest()
            keys.extend((preview_key + ".webp", preview_key + ".png"))
        for name in keys:
            cache_path = os.path.join(MEDIA_PREVIEW_DIR, name)
            try:
                if os.path.isfile(cache_path):
                    os.remove(cache_path)
                    removed += 1
            except OSError:
                pass
    return removed


async def clear_canvas(canvas_id, payload, *, ASSET_LIBRARY_LOCK, CANVAS_LOCK, CONVERSATION_LOCK, HISTORY_FILE, HISTORY_LOCK, HTTPException, HistoryPruneError, collect_local_media_urls, delete_media_preview_cache, expand_canvas_generated_media_paths, generated_media_path_from_url, json_references_media_path, load_canvas, manager, now_ms, persisted_json_references_media_path, prune_generation_history_for_media, save_canvas):
    """清空当前画布内容，并安全清理该画布独占的生成媒体和历史引用。"""

    def clear_document():
        with CANVAS_LOCK:
            canvas = load_canvas(canvas_id)
            current_updated_at = int(canvas.get("updated_at") or 0)
            if payload.base_updated_at and current_updated_at and int(payload.base_updated_at) != current_updated_at:
                raise HTTPException(status_code=409, detail={
                    "message": "画布已被其他页面更新，请刷新后再清空。",
                    "reason": "canvas_conflict",
                    "canvas": canvas,
                    "updated_at": current_updated_at,
                })

            previous_content = {
                "nodes": list(canvas.get("nodes") or []),
                "logs": list(canvas.get("logs") or []),
            }
            candidate_paths = []
            for value in (previous_content["nodes"], previous_content["logs"]):
                for url in collect_local_media_urls(value):
                    path = generated_media_path_from_url(url)
                    if path and path not in candidate_paths:
                        candidate_paths.append(path)
            candidate_paths = expand_canvas_generated_media_paths(canvas, candidate_paths)

            canvas["nodes"] = []
            canvas["connections"] = []
            canvas["logs"] = []
            canvas["settings"] = {}
            save_canvas(canvas)
            return canvas, candidate_paths

    canvas, candidate_paths = await asyncio.to_thread(clear_document)
    removed_files = []
    skipped_referenced = []
    removed_previews = 0
    removed_history = 0
    if candidate_paths:
        deletable_paths = []
        with HISTORY_LOCK, CONVERSATION_LOCK, ASSET_LIBRARY_LOCK:
            for path in candidate_paths:
                if persisted_json_references_media_path(path):
                    skipped_referenced.append(os.path.basename(path))
                else:
                    deletable_paths.append(path)
        try:
            removed_history = prune_generation_history_for_media(deletable_paths)
        except HistoryPruneError as exc:
            await manager.broadcast_canvas_updated(canvas_id, int(canvas.get("updated_at") or now_ms()), payload.client_id)
            raise HTTPException(status_code=500, detail="画布已清空，但历史记录未能安全核对，媒体文件已保留。") from exc
        with HISTORY_LOCK, CONVERSATION_LOCK, ASSET_LIBRARY_LOCK:
            try:
                history = []
                if os.path.isfile(HISTORY_FILE):
                    with open(HISTORY_FILE, "r", encoding="utf-8-sig") as handle:
                        history = json.load(handle)
                    if not isinstance(history, list):
                        raise ValueError("历史记录格式异常")
            except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as exc:
                await manager.broadcast_canvas_updated(canvas_id, int(canvas.get("updated_at") or now_ms()), payload.client_id)
                raise HTTPException(status_code=500, detail="画布已清空，但历史记录无法核对，媒体文件已保留。") from exc
            for path in deletable_paths:
                if json_references_media_path(history, path) or persisted_json_references_media_path(path):
                    skipped_referenced.append(os.path.basename(path))
                    continue
                try:
                    removed_previews += delete_media_preview_cache(path)
                    os.remove(path)
                    removed_files.append(os.path.basename(path))
                except OSError:
                    skipped_referenced.append(os.path.basename(path))

    await manager.broadcast_canvas_updated(canvas_id, int(canvas.get("updated_at") or now_ms()), payload.client_id)
    return {
        "ok": True,
        "canvas": canvas,
        "removed_files": removed_files,
        "removed_previews": removed_previews,
        "removed_history": removed_history,
        "skipped_referenced": sorted(set(skipped_referenced)),
    }


async def delete_canvas_log(canvas_id, payload, *, ASSET_LIBRARY_LOCK, CANVAS_LOCK, CONVERSATION_LOCK, HISTORY_FILE, HISTORY_LOCK, HTTPException, HistoryPruneError, collect_local_media_urls, delete_media_preview_cache, expand_canvas_generated_media_paths, generated_media_path_from_url, json_references_media_path, load_canvas, manager, now_ms, persisted_json_references_media_path, prune_generation_history_for_media, reset_canvas_result_nodes_for_media, save_canvas):
    log_id = str(payload.log_id or "").strip()
    if not log_id:
        raise HTTPException(status_code=400, detail="缺少日志 ID")

    def remove_log_record():
        with CANVAS_LOCK:
            canvas = load_canvas(canvas_id)
            current_updated_at = int(canvas.get("updated_at") or 0)
            if payload.base_updated_at and current_updated_at and int(payload.base_updated_at) < current_updated_at:
                raise HTTPException(status_code=409, detail={
                    "message": "画布已被其他页面更新，请刷新后重试。",
                    "canvas": canvas,
                    "updated_at": current_updated_at,
                })
            logs = list(canvas.get("logs") or [])
            target = next((item for item in logs if str(item.get("id") or "") == log_id), None)
            if not target:
                raise HTTPException(status_code=404, detail="生成日志不存在")

            candidate_paths = []
            if payload.delete_unreferenced_media:
                for url in collect_local_media_urls(target.get("outputs") or []):
                    path = generated_media_path_from_url(url)
                    if path and path not in candidate_paths:
                        candidate_paths.append(path)

            reset_node_ids = []
            if payload.reset_referencing_nodes and candidate_paths:
                candidate_paths = expand_canvas_generated_media_paths(canvas, candidate_paths)
                reset_node_ids = reset_canvas_result_nodes_for_media(canvas, candidate_paths)

            canvas["logs"] = [item for item in logs if str(item.get("id") or "") != log_id]
            save_canvas(canvas)
            return canvas, candidate_paths, reset_node_ids

    canvas, candidate_paths, reset_node_ids = await asyncio.to_thread(remove_log_record)

    def cleanup_unreferenced_media():
        removed_files = []
        skipped_referenced = []
        removed_previews = 0
        deletable_paths = []
        with HISTORY_LOCK, CONVERSATION_LOCK, ASSET_LIBRARY_LOCK:
            for path in candidate_paths:
                if persisted_json_references_media_path(path):
                    skipped_referenced.append(os.path.basename(path))
                    continue
                deletable_paths.append(path)
        prune_generation_history_for_media(deletable_paths)
        # Pruning takes HISTORY_LOCK itself, so reacquire in the shared order and
        # recheck references after it returns before unlinking any media.
        with HISTORY_LOCK, CONVERSATION_LOCK, ASSET_LIBRARY_LOCK:
            try:
                history = []
                if os.path.isfile(HISTORY_FILE):
                    with open(HISTORY_FILE, "r", encoding="utf-8-sig") as handle:
                        history = json.load(handle)
                    if not isinstance(history, list):
                        raise ValueError("历史记录格式异常")
            except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as exc:
                raise HistoryPruneError("历史记录清理后无法核对引用") from exc
            for path in deletable_paths:
                if json_references_media_path(history, path) or persisted_json_references_media_path(path):
                    skipped_referenced.append(os.path.basename(path))
                    continue
                try:
                    removed_previews += delete_media_preview_cache(path)
                    os.remove(path)
                    removed_files.append(os.path.basename(path))
                except OSError:
                    skipped_referenced.append(os.path.basename(path))
        return removed_files, skipped_referenced, removed_previews

    removed_files = []
    skipped_referenced = []
    removed_previews = 0
    if payload.delete_unreferenced_media:
        def locked_cleanup():
            with CANVAS_LOCK:
                return cleanup_unreferenced_media()
        try:
            removed_files, skipped_referenced, removed_previews = await asyncio.to_thread(locked_cleanup)
        except HistoryPruneError as exc:
            await manager.broadcast_canvas_updated(canvas_id, int(canvas.get("updated_at") or now_ms()))
            raise HTTPException(
                status_code=500,
                detail="生成日志已删除，但历史记录清理失败，媒体文件未删除。请刷新画布。",
            ) from exc

    await manager.broadcast_canvas_updated(canvas_id, int(canvas.get("updated_at") or now_ms()))
    return {
        "ok": True,
        "canvas": canvas,
        "removed_files": removed_files,
        "removed_previews": removed_previews,
        "reset_node_ids": reset_node_ids,
        "skipped_referenced": skipped_referenced,
    }


async def delete_history(req, *, ASSET_LIBRARY_LOCK, CANVAS_LOCK, CONVERSATION_LOCK, HISTORY_FILE, HISTORY_LOCK, generated_media_path_from_url, json_references_media_path, persisted_json_references_media_path, write_diagnostic, write_json_atomic):
    if not os.path.exists(HISTORY_FILE):
        return {"success": False, "message": "History file not found"}
    try:
        # Keep the same lock order as canvas log cleanup while checking references.
        with CANVAS_LOCK:
            with HISTORY_LOCK:
                with open(HISTORY_FILE, 'r', encoding='utf-8') as f:
                    history = json.load(f)
                deleted_records = []
                new_history = []
                for item in history:
                    item_ts = item.get("timestamp", 0)
                    if isinstance(req.timestamp, (int, float)) and isinstance(item_ts, (int, float)):
                        is_match = abs(float(item_ts) - float(req.timestamp)) < 0.001
                    else:
                        is_match = str(item_ts) == str(req.timestamp)
                    (deleted_records if is_match else new_history).append(item)
                if not deleted_records:
                    return {"success": False, "message": "Record not found"}
                write_json_atomic(HISTORY_FILE, new_history, ensure_ascii=False, indent=4)

                candidate_paths = set()
                for record in deleted_records:
                    for url in record.get("images", []):
                        path = generated_media_path_from_url(url)
                        if path:
                            candidate_paths.add(path)
                with CONVERSATION_LOCK, ASSET_LIBRARY_LOCK:
                    for path in candidate_paths:
                        if any(json_references_media_path(record, path) for record in new_history):
                            continue
                        if persisted_json_references_media_path(path):
                            continue
                        try:
                            os.remove(path)
                        except OSError as exc:
                            write_diagnostic(f"history media delete failed error={type(exc).__name__}")
        return {"success": True}
    except Exception as e:
        write_diagnostic(f"history delete failed error={type(e).__name__}")
        return {"success": False, "message": "删除历史记录失败，请稍后重试。"}


