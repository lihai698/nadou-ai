"""画布工作流归档、资源替换及素材库导入导出。

索引、文件、锁和供应商调用由应用显式注入，保留现有提交/清理顺序。
"""
import os
import uuid
import time
import zipfile
import json
import urllib.parse

def validate_workflow_zip_limits(archive, *, HTTPException, WORKFLOW_ZIP_MAX_FILES, WORKFLOW_ZIP_MAX_UNCOMPRESSED_BYTES):
    infos = archive.infolist()
    if len(infos) > WORKFLOW_ZIP_MAX_FILES:
        raise HTTPException(status_code=413, detail=f"工作流压缩包文件数超过 {WORKFLOW_ZIP_MAX_FILES} 个")
    total_uncompressed = 0
    for info in infos:
        size = int(getattr(info, "file_size", 0) or 0)
        if size < 0:
            raise HTTPException(status_code=400, detail="工作流压缩包包含无效文件")
        total_uncompressed += size
        if total_uncompressed > WORKFLOW_ZIP_MAX_UNCOMPRESSED_BYTES:
            raise HTTPException(status_code=413, detail="工作流压缩包解压后超过 500MB")
    return infos


def asset_library_workflow_category(lib, library_id='', category_id='', *, HTTPException, find_asset_library):
    library = find_asset_library(lib, library_id)
    if not library:
        raise HTTPException(status_code=404, detail="资产库不存在")
    categories = library.setdefault("categories", [])
    cat = None
    if category_id:
        cat = next((c for c in categories if c.get("id") == category_id), None)
        if not cat:
            raise HTTPException(status_code=404, detail="工作流分类不存在")
        if cat.get("type") != "workflow":
            raise HTTPException(status_code=400, detail="目标分组不是工作流分类")
    if not cat:
        cat = next((c for c in categories if c.get("type") == "workflow"), None)
    if not cat:
        cat = {"id": f"wf_{uuid.uuid4().hex[:12]}", "name": "工作流", "type": "workflow", "items": []}
        categories.append(cat)
    lib["active_library_id"] = library.get("id") or lib.get("active_library_id")
    return library, cat


def make_workflow_library_item_from_bytes(raw, filename, name='', *, ASSET_LIBRARY_DIR, BytesIO, HTTPException, now_ms, sanitize_asset_name, sanitize_export_filename, validate_workflow_zip_limits):
    if not raw:
        raise HTTPException(status_code=400, detail="工作流文件为空")
    safe_filename = sanitize_export_filename(filename or "canvas-workflow.zip", "canvas-workflow.zip")
    ext = os.path.splitext(safe_filename)[1].lower()
    if ext not in {".json", ".zip"}:
        safe_filename += ".zip"
        ext = ".zip"
    if ext == ".zip" or raw[:2] == b"PK":
        try:
            with zipfile.ZipFile(BytesIO(raw), "r") as archive:
                validate_workflow_zip_limits(archive)
        except zipfile.BadZipFile as exc:
            raise HTTPException(status_code=400, detail="无法读取工作流压缩包") from exc
    dest_name = f"workflow_{uuid.uuid4().hex[:12]}_{safe_filename}"
    dest_path = os.path.join(ASSET_LIBRARY_DIR, dest_name)
    os.makedirs(ASSET_LIBRARY_DIR, exist_ok=True)
    with open(dest_path, "wb") as f:
        f.write(raw)
    display_name = sanitize_asset_name(name or os.path.splitext(safe_filename)[0], "工作流")
    return {
        "id": f"wf_{uuid.uuid4().hex[:12]}",
        "name": display_name[:120],
        "url": f"/assets/library/{dest_name}",
        "kind": "workflow",
        "type": "workflow",
        "format": "zip" if ext == ".zip" else "json",
        "size": len(raw),
        "created_at": now_ms(),
    }


def canvas_workflow_collect_resource_refs(value, found=None, *, canvas_workflow_collect_resource_refs):
    if found is None:
        found = []
    if isinstance(value, dict):
        for item in value.values():
            canvas_workflow_collect_resource_refs(item, found)
    elif isinstance(value, list):
        for item in value:
            canvas_workflow_collect_resource_refs(item, found)
    elif isinstance(value, str):
        text = value.strip()
        if text.startswith(("/assets/", "/output/", "/api/storage-files/")):
            found.append(text)
    return found


def canvas_workflow_unique_archive_name(base, used, *, sanitize_export_filename):
    safe = sanitize_export_filename(base, "resource.bin")
    name, ext = os.path.splitext(safe)
    archive = safe
    idx = 2
    while archive in used:
        archive = f"{name}-{idx}{ext}"
        idx += 1
    used.add(archive)
    return archive


def canvas_workflow_replace_strings(value, mapping, *, canvas_workflow_replace_strings):
    if isinstance(value, dict):
        return {k: canvas_workflow_replace_strings(v, mapping) for k, v in value.items()}
    if isinstance(value, list):
        return [canvas_workflow_replace_strings(item, mapping) for item in value]
    if isinstance(value, str):
        if value in mapping:
            return mapping[value]
        # 剪辑排除来源保存为 JSON 编码的 [sourceNodeId, sourceResultId]。
        # 多结果以 URL 作稳定身份时，导入资源须同步替换第二项，避免重新灌回已删片段。
        if value.lstrip().startswith("["):
            try:
                source_key = json.loads(value)
            except (ValueError, TypeError):
                source_key = None
            if (isinstance(source_key, list) and len(source_key) == 2
                    and all(isinstance(item, str) for item in source_key)
                    and source_key[1] in mapping):
                return json.dumps([source_key[0], mapping[source_key[1]]], ensure_ascii=False, separators=(",", ":"))
        return value
    return value


def canvas_workflow_payload(nodes, connections, resources=None, *, now_ms):
    return {
        "format": "infinite-canvas-workflow",
        "version": 1,
        "exported_at": now_ms(),
        "nodes": nodes or [],
        "connections": connections or [],
        "resources": resources or [],
    }


def build_canvas_workflow_archive(payload, *, BytesIO, HTTPException, canvas_workflow_collect_resource_refs, canvas_workflow_payload, canvas_workflow_unique_archive_name, output_file_from_url):
    nodes_payload = payload.nodes or []
    connections_payload = payload.connections or []
    if not nodes_payload:
        raise HTTPException(status_code=400, detail="没有可导出的节点")
    local_resources = {}
    if payload.include_resources:
        for url in canvas_workflow_collect_resource_refs(nodes_payload):
            if url not in local_resources:
                local_resources[url] = output_file_from_url(url)
        missing_count = sum(not path or not os.path.isfile(path) for path in local_resources.values())
        if missing_count:
            raise HTTPException(
                status_code=400,
                detail=f"有 {missing_count} 个本地素材文件缺失，无法完整导出。请补齐素材后重试，或导出不包含资源的 JSON。",
            )
    buffer = BytesIO()
    resources = []
    used = set()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        if payload.include_resources:
            for url, path in local_resources.items():
                archive_name = canvas_workflow_unique_archive_name(os.path.basename(path), used)
                archive_path = f"resources/{archive_name}"
                zf.write(path, archive_path)
                resources.append({
                    "url": url,
                    "archive": archive_path,
                    "name": os.path.basename(path),
                    "size": os.path.getsize(path),
                })
        workflow = canvas_workflow_payload(nodes_payload, connections_payload, resources)
        zf.writestr("workflow.json", json.dumps(workflow, ensure_ascii=False, indent=2))
    buffer.seek(0)
    return buffer.getvalue(), {"resources": resources, "node_count": len(nodes_payload), "connection_count": len(connections_payload)}


async def export_canvas_workflow(payload, *, Response, build_canvas_workflow_archive, sanitize_export_filename):
    archive, _ = build_canvas_workflow_archive(payload)
    filename = sanitize_export_filename(payload.filename or "canvas-workflow.zip", "canvas-workflow.zip")
    if not filename.lower().endswith(".zip"):
        filename += ".zip"
    encoded = urllib.parse.quote(filename)
    headers = {"Content-Disposition": f"attachment; filename*=UTF-8''{encoded}"}
    return Response(archive, media_type="application/zip", headers=headers)


async def export_canvas_workflow_to_library(payload, *, asset_library_workflow_category, build_canvas_workflow_archive, load_asset_library, make_workflow_library_item_from_bytes, sanitize_export_filename, save_asset_library):
    archive, meta = build_canvas_workflow_archive(payload)
    filename = sanitize_export_filename(payload.filename or "canvas-workflow.zip", "canvas-workflow.zip")
    if not filename.lower().endswith(".zip"):
        filename += ".zip"
    lib = load_asset_library()
    _, cat = asset_library_workflow_category(lib, payload.library_id, payload.category_id)
    item = make_workflow_library_item_from_bytes(archive, filename, payload.name or os.path.splitext(filename)[0])
    item["node_count"] = meta.get("node_count") or len(payload.nodes or [])
    item["connection_count"] = meta.get("connection_count") or len(payload.connections or [])
    item["resource_count"] = len(meta.get("resources") or [])
    cat.setdefault("items", []).append(item)
    save_asset_library(lib)
    return {"library": lib, "item": item}


async def upload_asset_library_workflows(files, library_id, category_id, *, HTTPException, asset_library_index_lock, asset_library_workflow_category, load_asset_library, make_workflow_library_item_from_bytes, read_upload_file_limited, save_asset_library):
    uploads = []
    batch_state = {"total": 0}
    for file in files[:100]:
        raw = await read_upload_file_limited(file, batch_state=batch_state)
        filename = file.filename or "canvas-workflow.zip"
        lower = filename.lower()
        if not (lower.endswith(".json") or lower.endswith(".zip") or raw[:2] == b"PK"):
            continue
        uploads.append((raw, filename))
    if not uploads:
        raise HTTPException(status_code=400, detail="没有可上传的工作流文件")
    with asset_library_index_lock():
        lib = load_asset_library()
        _, cat = asset_library_workflow_category(lib, library_id, category_id)
        added = []
        for raw, filename in uploads:
            item = make_workflow_library_item_from_bytes(raw, filename, os.path.splitext(filename)[0])
            cat.setdefault("items", []).append(item)
            added.append(item)
        save_asset_library(lib)
    return {"library": lib, "items": added}


async def import_canvas_workflow(file, *, ASSETS_DIR, BytesIO, HTTPException, OUTPUT_INPUT_DIR, canvas_workflow_payload, canvas_workflow_replace_strings, read_upload_file_limited, sanitize_export_filename, shutil, validate_workflow_zip_limits, write_diagnostic):
    raw = await read_upload_file_limited(file)
    if not raw:
        raise HTTPException(status_code=400, detail="文件为空")
    name = str(file.filename or "").lower()
    resource_mapping = {}
    workflow = None
    try:
        if name.endswith(".zip") or raw[:2] == b"PK":
            with zipfile.ZipFile(BytesIO(raw), "r") as zf:
                validate_workflow_zip_limits(zf)
                candidates = [n for n in zf.namelist() if n.lower().endswith("workflow.json")]
                workflow_name = "workflow.json" if "workflow.json" in zf.namelist() else (candidates[0] if candidates else "")
                if not workflow_name:
                    raise HTTPException(status_code=400, detail="压缩包中没有 workflow.json")
                workflow = json.loads(zf.read(workflow_name).decode("utf-8-sig"))
                stamp = time.strftime("%Y%m%d-%H%M%S")
                import_dir = os.path.join(OUTPUT_INPUT_DIR, f"workflow_import_{stamp}_{uuid.uuid4().hex[:6]}")
                os.makedirs(import_dir, exist_ok=True)
                for res in workflow.get("resources") or []:
                    archive = str(res.get("archive") or "").replace("\\", "/").lstrip("/")
                    if not archive or archive not in zf.namelist():
                        continue
                    base = sanitize_export_filename(res.get("name") or os.path.basename(archive), os.path.basename(archive) or "resource.bin")
                    target = os.path.join(import_dir, f"{uuid.uuid4().hex[:8]}_{base}")
                    with zf.open(archive) as src, open(target, "wb") as dst:
                        shutil.copyfileobj(src, dst)
                    rel = os.path.relpath(target, ASSETS_DIR).replace("\\", "/")
                    new_url = f"/assets/{rel}"
                    old_url = str(res.get("url") or "").strip()
                    if old_url:
                        resource_mapping[old_url] = new_url
                    resource_mapping[archive] = new_url
                    resource_mapping[f"./{archive}"] = new_url
                    resource_mapping[os.path.basename(archive)] = new_url
        else:
            workflow = json.loads(raw.decode("utf-8-sig"))
    except HTTPException:
        raise
    except zipfile.BadZipFile as exc:
        raise HTTPException(status_code=400, detail="无法读取压缩包") from exc
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"工作流 JSON 格式错误（第 {exc.lineno} 行，第 {exc.colno} 列），请检查文件内容后重试。",
        ) from exc
    except Exception as exc:
        write_diagnostic(f"workflow file parse failed error={type(exc).__name__}")
        raise HTTPException(status_code=400, detail="无法解析工作流文件，请检查文件格式。") from exc
    if isinstance(workflow, list):
        workflow = {"nodes": workflow, "connections": []}
    if not isinstance(workflow, dict):
        raise HTTPException(status_code=400, detail="工作流格式不正确")
    nodes_payload = workflow.get("nodes")
    connections_payload = workflow.get("connections")
    if nodes_payload is None and isinstance(workflow.get("workflow"), dict):
        nodes_payload = workflow["workflow"].get("nodes")
        connections_payload = workflow["workflow"].get("connections")
    if not isinstance(nodes_payload, list):
        raise HTTPException(status_code=400, detail="工作流 JSON 缺少 nodes")
    if not isinstance(connections_payload, list):
        connections_payload = []
    if resource_mapping:
        nodes_payload = canvas_workflow_replace_strings(nodes_payload, resource_mapping)
        connections_payload = canvas_workflow_replace_strings(connections_payload, resource_mapping)
    return {
        "workflow": canvas_workflow_payload(nodes_payload, connections_payload, workflow.get("resources") or []),
        "nodes": nodes_payload,
        "connections": connections_payload,
        "resource_map": resource_mapping,
    }


