"""RunningHub工作流索引、配置合并、字段和同步协调。

索引、文件、锁和供应商调用由应用显式注入，保留现有提交/清理顺序。
"""
import os
import re
import json

def runninghub_workflow_json_from_config(config):
    """旧配置可从 raw 中恢复工作流；新配置不再保存上游整包。"""
    if not isinstance(config, dict):
        return {}
    legacy = config.get("raw") if isinstance(config.get("raw"), dict) else {}
    legacy_data = legacy.get("data") if isinstance(legacy.get("data"), dict) else {}
    for value in (
        config.get("workflowJson"), config.get("workflow_json"),
        legacy.get("workflowJson"), legacy.get("prompt"), legacy_data.get("prompt"),
    ):
        if isinstance(value, dict) and value:
            return value
        if isinstance(value, str) and value.strip():
            try:
                parsed = json.loads(value)
            except ValueError:
                continue
            if isinstance(parsed, dict) and parsed:
                return parsed
    return {}


def runninghub_workflow_without_raw(config, *, runninghub_workflow_json_from_config):
    if not isinstance(config, dict):
        return {}
    cleaned = {key: value for key, value in config.items() if key != "raw"}
    workflow_json = runninghub_workflow_json_from_config(config)
    if workflow_json:
        cleaned["workflowJson"] = workflow_json
    return cleaned


def _load_runninghub_workflow_store_unlocked(*, RUNNINGHUB_WORKFLOW_STORE_FILE):
    if not os.path.exists(RUNNINGHUB_WORKFLOW_STORE_FILE):
        return {}
    try:
        with open(RUNNINGHUB_WORKFLOW_STORE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, UnicodeError, ValueError):
        return {}


def load_runninghub_workflow_store(*, RUNNINGHUB_WORKFLOW_LOCK, _load_runninghub_workflow_store_unlocked):
    with RUNNINGHUB_WORKFLOW_LOCK:
        return _load_runninghub_workflow_store_unlocked()


def save_runninghub_workflow_store(store, *, DATA_DIR, RUNNINGHUB_WORKFLOW_LOCK, RUNNINGHUB_WORKFLOW_STORE_FILE, runninghub_workflow_without_raw, write_json_atomic):
    """原子保存 RunningHub 工作流索引，并拒绝覆盖损坏的现有文件。"""
    if not isinstance(store, dict) or any(not isinstance(value, dict) for value in store.values()):
        raise ValueError("RunningHub 工作流记录必须是对象映射")
    with RUNNINGHUB_WORKFLOW_LOCK:
        if os.path.exists(RUNNINGHUB_WORKFLOW_STORE_FILE):
            try:
                with open(RUNNINGHUB_WORKFLOW_STORE_FILE, "r", encoding="utf-8") as f:
                    existing = json.load(f)
                if not isinstance(existing, dict) or any(not isinstance(value, dict) for value in existing.values()):
                    raise ValueError("RunningHub 工作流记录格式无效")
            except (OSError, UnicodeError, ValueError, json.JSONDecodeError) as exc:
                raise ValueError("RunningHub 工作流记录损坏或无法读取，已保留原文件；请从备份恢复。") from exc
        os.makedirs(DATA_DIR, exist_ok=True)
        cleaned_store = {
            workflow_id: runninghub_workflow_without_raw(config)
            for workflow_id, config in store.items()
        }
        write_json_atomic(RUNNINGHUB_WORKFLOW_STORE_FILE, cleaned_store, ensure_ascii=False, indent=2)


def _save_runninghub_workflow_store_or_raise(store, *, HTTPException, save_runninghub_workflow_store):
    try:
        save_runninghub_workflow_store(store)
    except (OSError, UnicodeError, ValueError) as exc:
        raise HTTPException(
            status_code=500,
            detail="RunningHub 工作流记录无法保存，已保留原文件；请排除磁盘故障或从备份恢复后重试。",
        ) from exc


def prune_runninghub_workflow_store_for_provider(provider, *, RUNNINGHUB_WORKFLOW_LOCK, _save_runninghub_workflow_store_or_raise, load_runninghub_workflow_store, runninghub_workflow_store_key):
    if not isinstance(provider, dict) or provider.get("id") != "runninghub":
        return
    with RUNNINGHUB_WORKFLOW_LOCK:
        store = load_runninghub_workflow_store()
        if not store:
            return
        keep_ids = {
            runninghub_workflow_store_key(entry.get("workflowId") or entry.get("id"))
            for entry in provider.get("rh_workflows") or []
            if isinstance(entry, dict) and entry.get("hidden") is not True
        }
        keep_ids.discard("")
        removed = False
        for workflow_id in list(store.keys()):
            if runninghub_workflow_store_key(workflow_id) not in keep_ids:
                store.pop(workflow_id, None)
                removed = True
        if removed:
            _save_runninghub_workflow_store_or_raise(store)


def runninghub_workflow_config_has_payload(cfg, *, runninghub_workflow_json_from_config):
    if not isinstance(cfg, dict):
        return False
    return bool(cfg.get("fields") or runninghub_workflow_json_from_config(cfg))


def runninghub_static_workflow_entry(workflow_id, *, load_static_runninghub_provider, runninghub_workflow_store_key):
    key = runninghub_workflow_store_key(workflow_id)
    if not key:
        return None
    static_provider = load_static_runninghub_provider()
    for entry in (static_provider or {}).get("rh_workflows", []) or []:
        if runninghub_workflow_store_key(entry.get("workflowId") or entry.get("id")) == key:
            return entry
    return None


def runninghub_static_workflow_config(workflow_id, *, runninghub_is_saved_link_field, runninghub_normalize_field, runninghub_static_workflow_entry, runninghub_workflow_config_has_payload, runninghub_workflow_json_from_config, runninghub_workflow_store_key):
    entry = runninghub_static_workflow_entry(workflow_id)
    if not isinstance(entry, dict):
        return None
    key = runninghub_workflow_store_key(entry.get("workflowId") or entry.get("id"))
    cfg = {
        "workflowId": key,
        "title": entry.get("title") or key,
        "description": entry.get("note") or entry.get("description") or "",
        "fields": [
            field for field in (runninghub_normalize_field(item) for item in (entry.get("fields") or []))
            if not runninghub_is_saved_link_field(field)
        ],
        "workflowJson": runninghub_workflow_json_from_config(entry),
        "optionalImageMode": entry.get("optionalImageMode") or "prune-workflow",
        "updatedAt": entry.get("updatedAt") or 0,
        "source": "static_template",
    }
    return cfg if runninghub_workflow_config_has_payload(cfg) else None


def runninghub_workflow_entry_from_config(cfg, fallback=None, *, normalize_runninghub_entry, runninghub_workflow_json_from_config, runninghub_workflow_store_key):
    fallback = fallback if isinstance(fallback, dict) else {}
    key = runninghub_workflow_store_key((cfg or {}).get("workflowId") or fallback.get("workflowId") or fallback.get("id"))
    if not key:
        return None
    return normalize_runninghub_entry({
        "id": key,
        "workflowId": key,
        "title": (cfg or {}).get("title") or fallback.get("title") or fallback.get("name") or f"工作流 {key[-6:]}",
        "note": (cfg or {}).get("description") or fallback.get("note") or fallback.get("description") or "",
        "thumbnail": fallback.get("thumbnail") or "",
        "enabled": fallback.get("enabled", True),
        "fields": (cfg or {}).get("fields") or fallback.get("fields") or [],
        "workflowJson": runninghub_workflow_json_from_config(cfg) or runninghub_workflow_json_from_config(fallback),
        "optionalImageMode": (cfg or {}).get("optionalImageMode") or fallback.get("optionalImageMode") or "prune-workflow",
        "updatedAt": (cfg or {}).get("updatedAt") or fallback.get("updatedAt") or 0,
    }, "workflow")


def runninghub_saved_hidden_workflow_ids(*, API_PROVIDERS_FILE, runninghub_workflow_store_key):
    if not os.path.exists(API_PROVIDERS_FILE):
        return set()
    try:
        with open(API_PROVIDERS_FILE, "r", encoding="utf-8") as f:
            raw = json.load(f)
    except Exception:
        return set()
    hidden = set()
    for provider in raw if isinstance(raw, list) else []:
        if not isinstance(provider, dict) or str(provider.get("id") or "").strip().lower() != "runninghub":
            continue
        for entry in provider.get("rh_workflows") or []:
            if not isinstance(entry, dict) or entry.get("hidden") is not True:
                continue
            key = runninghub_workflow_store_key(entry.get("workflowId") or entry.get("id"))
            if key:
                hidden.add(key)
    return hidden


def runninghub_provider_with_workflow_store(provider, *, load_runninghub_workflow_store, normalize_runninghub_entries, runninghub_saved_hidden_workflow_ids, runninghub_select_workflow_config, runninghub_workflow_config_has_payload, runninghub_workflow_entry_from_config, runninghub_workflow_store_key):
    if not isinstance(provider, dict) or provider.get("id") != "runninghub":
        return provider
    store = load_runninghub_workflow_store()
    if not store:
        return provider
    merged = dict(provider)
    workflows = [dict(item) for item in (merged.get("rh_workflows") or []) if isinstance(item, dict)]
    hidden_ids = {
        runninghub_workflow_store_key(item.get("workflowId") or item.get("id"))
        for item in workflows
        if item.get("hidden") is True and runninghub_workflow_store_key(item.get("workflowId") or item.get("id"))
    }
    hidden_ids.update(runninghub_saved_hidden_workflow_ids())
    by_id = {
        runninghub_workflow_store_key(item.get("workflowId") or item.get("id")): item
        for item in workflows
        if runninghub_workflow_store_key(item.get("workflowId") or item.get("id"))
    }
    for workflow_id, cfg in store.items():
        if workflow_id in hidden_ids:
            continue
        if not isinstance(cfg, dict) or not runninghub_workflow_config_has_payload(cfg):
            continue
        existing = by_id.get(workflow_id)
        selected = runninghub_select_workflow_config(existing, cfg, workflow_id)
        entry = runninghub_workflow_entry_from_config(selected, existing)
        if not entry:
            continue
        if existing is None:
            workflows.append(entry)
        else:
            existing.update(entry)
    merged["rh_workflows"] = normalize_runninghub_entries(workflows, "workflow")
    return merged


def runninghub_provider_workflow_config(workflow_id, *, load_api_providers, runninghub_is_saved_link_field, runninghub_normalize_field, runninghub_saved_hidden_workflow_ids, runninghub_workflow_config_has_payload, runninghub_workflow_json_from_config, runninghub_workflow_store_key):
    key = runninghub_workflow_store_key(workflow_id)
    if not key:
        return None
    if key in runninghub_saved_hidden_workflow_ids():
        return None
    providers = load_api_providers()
    provider = next((item for item in providers if item.get("id") == "runninghub"), None)
    if not provider:
        return None
    for entry in provider.get("rh_workflows") or []:
        entry_key = runninghub_workflow_store_key(entry.get("workflowId") or entry.get("id"))
        if entry_key != key:
            continue
        if entry.get("hidden") is True:
            return None
        cfg = {
            "workflowId": key,
            "title": entry.get("title") or key,
            "description": entry.get("note") or entry.get("description") or "",
            "fields": [
                field for field in (runninghub_normalize_field(item) for item in (entry.get("fields") or []))
                if not runninghub_is_saved_link_field(field)
            ],
            "workflowJson": runninghub_workflow_json_from_config(entry),
            "optionalImageMode": entry.get("optionalImageMode") or "prune-workflow",
            "updatedAt": entry.get("updatedAt") or 0,
            "source": "api_providers",
        }
        return cfg if runninghub_workflow_config_has_payload(cfg) else None
    return None


def runninghub_select_workflow_config(local_cfg, provider_cfg, workflow_id='', *, runninghub_static_workflow_config):
    static_cfg = runninghub_static_workflow_config(workflow_id)
    if isinstance(local_cfg, dict) and isinstance(provider_cfg, dict):
        try:
            local_updated = int(local_cfg.get("updatedAt") or 0)
        except Exception:
            local_updated = 0
        try:
            provider_updated = int(provider_cfg.get("updatedAt") or 0)
        except Exception:
            provider_updated = 0
        return provider_cfg if provider_updated > local_updated else local_cfg
    if isinstance(local_cfg, dict):
        return local_cfg
    if isinstance(provider_cfg, dict):
        return provider_cfg
    if static_cfg:
        return static_cfg
    return None


def sync_runninghub_workflow_to_provider(cfg, *, RUNNINGHUB_DEFAULT_APPS, RUNNINGHUB_DEFAULT_BASE_URL, load_api_providers, normalize_provider, now_ms, runninghub_is_saved_link_field, runninghub_normalize_field, runninghub_workflow_json_from_config, runninghub_workflow_store_key, save_api_providers, sync_runninghub_provider_workflows_to_static_template):
    if not isinstance(cfg, dict):
        return
    key = runninghub_workflow_store_key(cfg.get("workflowId"))
    if not key:
        return
    providers = load_api_providers()
    provider = next((item for item in providers if item.get("id") == "runninghub"), None)
    if not provider:
        provider = {
            "id": "runninghub",
            "name": "RunningHub",
            "base_url": RUNNINGHUB_DEFAULT_BASE_URL,
            "protocol": "runninghub",
            "image_generation_endpoint": "",
            "image_edit_endpoint": "",
            "enabled": True,
            "primary": False,
            "image_models": [],
            "chat_models": [],
            "video_models": [],
            "ms_loras": [],
            "ms_defaults_version": 0,
            "rh_apps": RUNNINGHUB_DEFAULT_APPS,
            "rh_workflows": [],
        }
        providers.append(provider)
    workflows = provider.setdefault("rh_workflows", [])
    entry = None
    for item in workflows:
        item_key = runninghub_workflow_store_key(item.get("workflowId") or item.get("id"))
        if item_key == key:
            entry = item
            break
    if entry is None:
        entry = {
            "id": key,
            "workflowId": key,
            "title": cfg.get("title") or f"工作流 {key[-6:]}",
            "note": cfg.get("description") or "",
            "thumbnail": "",
            "enabled": True,
        }
        workflows.append(entry)
    entry.update({
        "id": key,
        "workflowId": key,
        "title": cfg.get("title") or entry.get("title") or f"工作流 {key[-6:]}",
        "note": cfg.get("description") or "",
        "fields": [
            field for field in (runninghub_normalize_field(item) for item in (cfg.get("fields") or []))
            if not runninghub_is_saved_link_field(field)
        ],
        "workflowJson": runninghub_workflow_json_from_config(cfg),
        "optionalImageMode": cfg.get("optionalImageMode") or "prune-workflow",
        "updatedAt": cfg.get("updatedAt") or now_ms(),
    })
    if "enabled" not in entry:
        entry["enabled"] = True
    if "thumbnail" not in entry:
        entry["thumbnail"] = ""
    normalized_providers = [normalize_provider(item) for item in providers]
    save_api_providers(normalized_providers)
    runninghub_provider = next((item for item in normalized_providers if item.get("id") == "runninghub"), None)
    if runninghub_provider:
        sync_runninghub_provider_workflows_to_static_template(runninghub_provider)


def remove_runninghub_workflow_from_provider(workflow_id, *, load_api_providers, load_static_runninghub_provider, normalize_provider, normalize_runninghub_entry, runninghub_workflow_store_key, save_api_providers, sync_runninghub_provider_workflows_to_static_template):
    key = runninghub_workflow_store_key(workflow_id)
    if not key:
        return
    providers = load_api_providers()
    changed = False
    for provider in providers:
        if provider.get("id") != "runninghub":
            continue
        workflows = provider.get("rh_workflows") or []
        removed = next((
            item for item in workflows
            if runninghub_workflow_store_key(item.get("workflowId") or item.get("id")) == key
        ), None)
        kept = [
            item for item in workflows
            if runninghub_workflow_store_key(item.get("workflowId") or item.get("id")) != key
        ]
        static_provider = load_static_runninghub_provider()
        static_workflow = next((
            item for item in (static_provider or {}).get("rh_workflows", [])
            if runninghub_workflow_store_key(item.get("workflowId") or item.get("id")) == key
        ), None)
        if static_workflow:
            tombstone = normalize_runninghub_entry({**static_workflow, **(removed or {}), "enabled": False, "hidden": True}, "workflow")
            if tombstone:
                kept.append(tombstone)
        if static_workflow or len(kept) != len(workflows):
            provider["rh_workflows"] = kept
            changed = True
    if changed:
        normalized_providers = [normalize_provider(item) for item in providers]
        save_api_providers(normalized_providers)
        runninghub_provider = next((item for item in normalized_providers if item.get("id") == "runninghub"), None)
        if runninghub_provider:
            sync_runninghub_provider_workflows_to_static_template(runninghub_provider)


def runninghub_workflow_store_key(workflow_id):
    return str(workflow_id or "").strip()


def runninghub_normalize_field(raw, fallback=None, *, model_dump_compat):
    fallback = fallback or {}
    if hasattr(raw, "dict"):
        raw = model_dump_compat(raw)
    if not isinstance(raw, dict):
        raw = {}
    options = raw.get("options", fallback.get("options", []))
    if isinstance(options, str):
        options = [item.strip() for item in re.split(r"[\r\n,]+", options) if item.strip()]
    elif isinstance(options, list):
        options = [str(item).strip() for item in options if str(item).strip()]
    else:
        options = []
    field_id = str(raw.get("id") or raw.get("fieldId") or raw.get("key") or raw.get("nodeId") or fallback.get("id") or "").strip()
    node_id = str(raw.get("nodeId") or fallback.get("nodeId") or raw.get("node_id") or "").strip()
    field_name = str(raw.get("fieldName") or raw.get("inputName") or raw.get("name") or fallback.get("fieldName") or "").strip()
    field_value = raw.get("fieldValue")
    if field_value is None:
        field_value = raw.get("defaultValue")
    if field_value is None:
        field_value = raw.get("value")
    if field_value is None:
        field_value = fallback.get("fieldValue", "")
    if isinstance(field_value, (dict, list)):
        field_value = json.dumps(field_value, ensure_ascii=False)
    elif field_value is None:
        field_value = ""
    else:
        field_value = str(field_value)
    return {
        "id": field_id or f"{node_id}::{field_name}",
        "nodeId": node_id,
        "fieldName": field_name,
        "fieldValue": field_value,
        "fieldType": str(raw.get("fieldType") or fallback.get("fieldType") or "TEXT"),
        "label": str(raw.get("label") or raw.get("title") or field_name or fallback.get("label") or ""),
        "enabled": bool(raw.get("enabled", fallback.get("enabled", True))),
        "sourceFromUpstream": bool(raw.get("sourceFromUpstream", fallback.get("sourceFromUpstream", True))),
        "group": str(raw.get("group") or fallback.get("group") or ""),
        "note": str(raw.get("note") or fallback.get("note") or ""),
        "options": options,
        "random_enabled": bool(raw.get("random_enabled", fallback.get("random_enabled", False))),
        "min": raw.get("min", fallback.get("min", "")),
        "max": raw.get("max", fallback.get("max", "")),
        "step": raw.get("step", fallback.get("step", "")),
        "imageOrder": int(raw.get("imageOrder") or raw.get("image_order") or fallback.get("imageOrder") or 0),
        "required": bool(raw.get("required", fallback.get("required", False))),
    }


def runninghub_is_saved_link_field(field, *, runninghub_is_workflow_link_value):
    if not isinstance(field, dict):
        return False
    value = field.get("fieldValue")
    if not isinstance(value, str):
        return False
    text = value.strip()
    if not (text.startswith("[") and text.endswith("]")):
        return False
    try:
        parsed = json.loads(text)
    except Exception:
        return False
    return runninghub_is_workflow_link_value(parsed)


def runninghub_collect_workflow_fields(workflow_json, *, runninghub_infer_workflow_field_type, runninghub_is_workflow_link_value):
    fields = []
    if not isinstance(workflow_json, dict):
        return fields
    for node_id, node_content in workflow_json.items():
        if not isinstance(node_content, dict):
            continue
        inputs = node_content.get("inputs")
        if not isinstance(inputs, dict):
            continue
        for field_name, raw_value in inputs.items():
            if runninghub_is_workflow_link_value(raw_value):
                continue
            if isinstance(raw_value, (dict, list)):
                field_value = json.dumps(raw_value, ensure_ascii=False)
            elif raw_value is None:
                field_value = ""
            else:
                field_value = str(raw_value)
            field_type = runninghub_infer_workflow_field_type(field_name, field_value)
            fields.append({
                "id": f"{node_id}::{field_name}",
                "nodeId": str(node_id),
                "fieldName": str(field_name),
                "fieldValue": field_value,
                "fieldType": field_type,
                "label": str(field_name),
                "enabled": False,
                "sourceFromUpstream": True,
                "group": str(
                    (node_content.get("_meta") or {}).get("title")
                    or node_content.get("class_type")
                    or node_content.get("_class")
                    or node_content.get("type")
                    or ""
                ),
                "note": "",
                "imageOrder": 0,
                "required": field_type == "IMAGE",
            })
    return fields


def list_runninghub_workflows(*, RUNNINGHUB_WORKFLOW_LOCK, load_api_providers, load_runninghub_workflow_store, runninghub_provider_workflow_config, runninghub_saved_hidden_workflow_ids, runninghub_select_workflow_config, runninghub_workflow_store_key):
    providers = load_api_providers()
    hidden_ids = runninghub_saved_hidden_workflow_ids()
    for provider in providers:
        if provider.get("id") != "runninghub":
            continue
        for entry in provider.get("rh_workflows") or []:
            workflow_id = runninghub_workflow_store_key(entry.get("workflowId") or entry.get("id"))
            if workflow_id and entry.get("hidden") is True:
                hidden_ids.add(workflow_id)
    with RUNNINGHUB_WORKFLOW_LOCK:
        store = load_runninghub_workflow_store()
    merged = {workflow_id: cfg for workflow_id, cfg in store.items() if isinstance(cfg, dict) and workflow_id not in hidden_ids}
    for provider in providers:
        if provider.get("id") != "runninghub":
            continue
        for entry in provider.get("rh_workflows") or []:
            workflow_id = runninghub_workflow_store_key(entry.get("workflowId") or entry.get("id"))
            if not workflow_id:
                continue
            if entry.get("hidden") is True:
                merged.pop(workflow_id, None)
                continue
            provider_cfg = runninghub_provider_workflow_config(workflow_id)
            if provider_cfg:
                merged[workflow_id] = runninghub_select_workflow_config(merged.get(workflow_id), provider_cfg, workflow_id)
    items = []
    for workflow_id, cfg in merged.items():
        if not isinstance(cfg, dict):
            continue
        items.append({
            "workflowId": workflow_id,
            "title": cfg.get("title") or workflow_id,
            "fieldCount": len(cfg.get("fields") or []),
            "updatedAt": cfg.get("updatedAt"),
            "description": cfg.get("description") or "",
        })
    items.sort(key=lambda item: item["title"])
    return {"workflows": items}


def get_runninghub_workflow(workflow_id, *, HTTPException, RUNNINGHUB_WORKFLOW_LOCK, load_runninghub_workflow_store, runninghub_provider_workflow_config, runninghub_select_workflow_config, runninghub_workflow_store_key, runninghub_workflow_without_raw):
    key = runninghub_workflow_store_key(workflow_id)
    if not key:
        raise HTTPException(status_code=400, detail="workflowId 必填")
    with RUNNINGHUB_WORKFLOW_LOCK:
        store = load_runninghub_workflow_store()
    cfg = store.get(key)
    provider_cfg = runninghub_provider_workflow_config(key)
    cfg = runninghub_select_workflow_config(cfg, provider_cfg, key)
    if not isinstance(cfg, dict):
        raise HTTPException(status_code=404, detail="RunningHub 工作流未找到")
    return {"workflow": runninghub_workflow_without_raw(cfg)}


def save_runninghub_workflow(workflow_id, payload, *, HTTPException, RUNNINGHUB_WORKFLOW_LOCK, _save_runninghub_workflow_store_or_raise, load_runninghub_workflow_store, now_ms, runninghub_is_saved_link_field, runninghub_normalize_field, runninghub_workflow_json_from_config, runninghub_workflow_store_key, sync_runninghub_workflow_to_provider):
    key = runninghub_workflow_store_key(workflow_id)
    if not key:
        raise HTTPException(status_code=400, detail="workflowId 必填")
    fields = [
        field for field in (runninghub_normalize_field(item) for item in (payload.fields or []))
        if not runninghub_is_saved_link_field(field)
    ]
    cfg = {
        "workflowId": key,
        "title": (payload.title or key).strip() or key,
        "description": payload.description or "",
        "fields": fields,
        "workflowJson": runninghub_workflow_json_from_config({"workflowJson": payload.workflowJson, "raw": payload.raw}),
        "optionalImageMode": payload.optionalImageMode or "prune-workflow",
        "updatedAt": now_ms(),
    }
    with RUNNINGHUB_WORKFLOW_LOCK:
        store = load_runninghub_workflow_store()
        store[key] = cfg
        _save_runninghub_workflow_store_or_raise(store)
    sync_runninghub_workflow_to_provider(cfg)
    return {"success": True, "workflow": cfg}


def delete_runninghub_workflow(workflow_id, *, HTTPException, RUNNINGHUB_WORKFLOW_LOCK, _save_runninghub_workflow_store_or_raise, load_runninghub_workflow_store, remove_runninghub_workflow_from_provider, runninghub_provider_workflow_config, runninghub_workflow_store_key):
    key = runninghub_workflow_store_key(workflow_id)
    if not key:
        raise HTTPException(status_code=400, detail="workflowId 必填")
    with RUNNINGHUB_WORKFLOW_LOCK:
        store = load_runninghub_workflow_store()
        provider_cfg = runninghub_provider_workflow_config(key)
        if key not in store and not provider_cfg:
            raise HTTPException(status_code=404, detail="RunningHub 工作流未找到")
        store.pop(key, None)
        _save_runninghub_workflow_store_or_raise(store)
    remove_runninghub_workflow_from_provider(key)
    return {"success": True}




def runninghub_entry_config_from_model(provider, model, *, RUNNINGHUB_ENTRY_MODEL_RE, RUNNINGHUB_WORKFLOW_LOCK, load_runninghub_workflow_store, runninghub_entry_id, runninghub_provider_workflow_config, runninghub_select_workflow_config, runninghub_workflow_store_key):
    """解析 model=app:ID / workflow:ID，返回 {kind,id,fields,optionalImageMode,workflowJson} 或 None。"""
    text = str(model or "").strip()
    match = RUNNINGHUB_ENTRY_MODEL_RE.match(text)
    if not match:
        return None
    kind = match.group(1)
    entry_id = match.group(2).strip()
    if not entry_id:
        return None
    if kind == "workflow":
        key = runninghub_workflow_store_key(entry_id)
        with RUNNINGHUB_WORKFLOW_LOCK:
            store = load_runninghub_workflow_store()
        cfg = runninghub_select_workflow_config(store.get(key), runninghub_provider_workflow_config(key), key)
        if not isinstance(cfg, dict):
            # 退回到 provider 列表中的内联条目
            entry = next(
                (e for e in (provider.get("rh_workflows") or []) if runninghub_entry_id(e, "workflow") == entry_id),
                None,
            )
            if not entry:
                return None
            cfg = {
                "fields": entry.get("fields") or [],
                "optionalImageMode": entry.get("optionalImageMode") or "prune-workflow",
                "workflowJson": entry.get("workflowJson") if isinstance(entry.get("workflowJson"), dict) else {},
            }
        return {
            "kind": "workflow",
            "id": entry_id,
            "fields": cfg.get("fields") or [],
            "optionalImageMode": cfg.get("optionalImageMode") or "prune-workflow",
            "workflowJson": cfg.get("workflowJson") if isinstance(cfg.get("workflowJson"), dict) else {},
        }
    entry = next(
        (e for e in (provider.get("rh_apps") or []) if runninghub_entry_id(e, "app") == entry_id),
        None,
    )
    if not entry:
        return None
    return {
        "kind": "app",
        "id": entry_id,
        "fields": entry.get("fields") or [],
        "optionalImageMode": "",
        "workflowJson": {},
    }

