"""API平台注册配置、模型规则与公开视图。

配置路径、写入锁、原子文件写入和凭据适配回调由应用注入；导入不读取配置。
"""
import os
import re
import json
import urllib.parse

def default_api_providers(*, MODELSCOPE_CHAT_BASE_URL, MODELSCOPE_CHAT_MODELS, MODELSCOPE_DEFAULTS_VERSION, MODELSCOPE_DEFAULT_IMAGE_MODELS, MODELSCOPE_DEFAULT_LORAS, RUNNINGHUB_DEFAULT_APPS, RUNNINGHUB_DEFAULT_BASE_URL, RUNNINGHUB_DEFAULT_WORKFLOWS, VOLCENGINE_DEFAULT_BASE_URL, VOLCENGINE_DEFAULT_PROJECT_NAME, VOLCENGINE_DEFAULT_REGION):
    return [
        {
            "id": "modelscope",
            "name": "ModelScope",
            "base_url": MODELSCOPE_CHAT_BASE_URL,
            "protocol": "openai",
            "image_request_mode": "openai",
            "image_generation_endpoint": "",
            "image_edit_endpoint": "",
            "enabled": True,
            "primary": False,
            "image_models": MODELSCOPE_DEFAULT_IMAGE_MODELS,
            "chat_models": MODELSCOPE_CHAT_MODELS,
            "video_models": [],
            "ms_loras": MODELSCOPE_DEFAULT_LORAS,
            "ms_defaults_version": MODELSCOPE_DEFAULTS_VERSION,
        },
        {
            "id": "runninghub",
            "name": "RunningHub",
            "base_url": RUNNINGHUB_DEFAULT_BASE_URL,
            "protocol": "runninghub",
            "image_request_mode": "openai",
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
            "rh_workflows": RUNNINGHUB_DEFAULT_WORKFLOWS,
        },
        {
            "id": "volcengine",
            "name": "火山引擎",
            "base_url": VOLCENGINE_DEFAULT_BASE_URL,
            "protocol": "volcengine",
            "image_request_mode": "openai",
            "image_generation_endpoint": "",
            "image_edit_endpoint": "",
            "enabled": True,
            "primary": False,
            "image_models": [],
            "chat_models": [],
            "video_models": [],
            "ms_loras": [],
            "ms_defaults_version": 0,
            "volcengine_project_name": VOLCENGINE_DEFAULT_PROJECT_NAME,
            "volcengine_region": VOLCENGINE_DEFAULT_REGION,
        },
    ]


def merge_default_api_providers(providers, inject_missing=True, *, CODEX_DEFAULT_CHAT_MODELS, CODEX_DEFAULT_IMAGE_MODELS, GEMINI_CLI_DEFAULT_CHAT_MODELS, GEMINI_CLI_DEFAULT_IMAGE_MODELS, JIMENG_DEFAULT_IMAGE_MODELS, JIMENG_DEFAULT_VIDEO_MODELS, JIMENG_LEGACY_IMAGE_MODELS, JIMENG_LEGACY_VIDEO_MODELS, MODELSCOPE_DEFAULTS_VERSION, MODELSCOPE_DEFAULT_CHAT_MODELS, MODELSCOPE_DEFAULT_IMAGE_MODELS, MODELSCOPE_DEFAULT_LORAS, VOLCENGINE_DEFAULT_PROJECT_NAME, VOLCENGINE_DEFAULT_REGION, default_api_providers, is_jimeng_provider, load_static_runninghub_provider, merge_runninghub_system_entries, model_list_from_values, normalize_ms_loras):
    merged = [dict(item) for item in providers]
    # 强制保留独立入口平台（不再强制 comfly）
    ms_default = next((d for d in default_api_providers() if d["id"] == "modelscope"), None)
    if ms_default:
        current = next((item for item in merged if item.get("id") == "modelscope"), None)
        if not current:
            if inject_missing:
                merged.append(ms_default)
        else:
            if not current.get("base_url"):
                current["base_url"] = ms_default["base_url"]
            seeded_version = int(current.get("ms_defaults_version") or 0)
            if seeded_version < MODELSCOPE_DEFAULTS_VERSION:
                image_models = model_list_from_values([*MODELSCOPE_DEFAULT_IMAGE_MODELS, *(current.get("image_models") or [])])
                chat_models = model_list_from_values([*MODELSCOPE_DEFAULT_CHAT_MODELS, *(current.get("chat_models") or [])])
                loras = normalize_ms_loras([*MODELSCOPE_DEFAULT_LORAS, *(current.get("ms_loras") or [])])
                current["image_models"] = image_models
                current["chat_models"] = chat_models
                current["ms_loras"] = loras
                current["ms_defaults_version"] = MODELSCOPE_DEFAULTS_VERSION
    rh_default = load_static_runninghub_provider() or next((d for d in default_api_providers() if d["id"] == "runninghub"), None)
    if rh_default:
        current = next((item for item in merged if item.get("id") == "runninghub"), None)
        if not current:
            if inject_missing:
                merged.append(rh_default)
        else:
            if not current.get("base_url"):
                current["base_url"] = rh_default["base_url"]
            if not current.get("protocol") or current.get("protocol") == "openai":
                current["protocol"] = "runninghub"
            current["image_models"] = model_list_from_values(current.get("image_models") or [])
            current["chat_models"] = model_list_from_values(current.get("chat_models") or [])
            current["video_models"] = model_list_from_values(current.get("video_models") or [])
            current["rh_apps"] = merge_runninghub_system_entries(rh_default.get("rh_apps") or [], current.get("rh_apps") or [], "app")
            current["rh_workflows"] = merge_runninghub_system_entries(rh_default.get("rh_workflows") or [], current.get("rh_workflows") or [], "workflow")
    volc_default = next((d for d in default_api_providers() if d["id"] == "volcengine"), None)
    if volc_default:
        current = next((item for item in merged if item.get("id") == "volcengine"), None)
        legacy = next((item for item in merged if item.get("id") != "volcengine" and str(item.get("protocol") or "").lower() == "volcengine"), None)
        if not current:
            if legacy:
                legacy_image_models = model_list_from_values(legacy.get("image_models") or [])
                legacy_video_models = model_list_from_values(legacy.get("video_models") or [])
                current = {
                    **volc_default,
                    "base_url": legacy.get("base_url") or volc_default["base_url"],
                    "image_models": legacy_image_models or model_list_from_values(volc_default.get("image_models") or []),
                    "chat_models": model_list_from_values(legacy.get("chat_models") or []),
                    "video_models": legacy_video_models,
                }
                merged.append(current)
            elif inject_missing:
                merged.append(volc_default)
        else:
            if not current.get("base_url"):
                current["base_url"] = volc_default["base_url"]
            current["protocol"] = "volcengine"
            current["volcengine_project_name"] = str(current.get("volcengine_project_name") or VOLCENGINE_DEFAULT_PROJECT_NAME).strip() or VOLCENGINE_DEFAULT_PROJECT_NAME
            current["volcengine_region"] = str(current.get("volcengine_region") or VOLCENGINE_DEFAULT_REGION).strip() or VOLCENGINE_DEFAULT_REGION
    # 即梦 CLI 不再是强制保留的默认平台：仅在用户已添加了即梦协议的平台时，规范化其默认模型/地址。
    for current in merged:
        if not is_jimeng_provider(current):
            continue
        current["protocol"] = "jimeng"
        current["base_url"] = ""
        current["image_models"] = model_list_from_values([
            *[item for item in (current.get("image_models") or []) if str(item or "").strip() not in JIMENG_LEGACY_IMAGE_MODELS],
            *JIMENG_DEFAULT_IMAGE_MODELS,
        ])
        current["video_models"] = model_list_from_values([
            *[item for item in (current.get("video_models") or []) if str(item or "").strip() not in JIMENG_LEGACY_VIDEO_MODELS],
            *JIMENG_DEFAULT_VIDEO_MODELS,
        ])
    # OpenAI/Antigravity CLI 和即梦一样作为协议使用：用户选中 CLI 协议时再规范化模型与地址，不强制额外注入平台。
    for current in merged:
        current_protocol = str((current or {}).get("protocol") or "").strip().lower()
        if current_protocol not in {"codex", "gemini-cli"}:
            continue
        current["protocol"] = current_protocol
        current["base_url"] = ""
        default_image_models = CODEX_DEFAULT_IMAGE_MODELS if current_protocol == "codex" else GEMINI_CLI_DEFAULT_IMAGE_MODELS
        default_chat_models = CODEX_DEFAULT_CHAT_MODELS if current_protocol == "codex" else GEMINI_CLI_DEFAULT_CHAT_MODELS
        image_models = current.get("image_models") or []
        if current_protocol == "codex":
            image_models = [item for item in image_models if str(item or "").strip().lower() != "$imagegen"]
        current["image_models"] = model_list_from_values([*image_models, *default_image_models])
        current["chat_models"] = model_list_from_values([*(current.get("chat_models") or []), *default_chat_models])
        current["video_models"] = []
    return merged


def normalize_ms_loras(values):
    normalized = []
    seen = set()
    for raw in values or []:
        if not isinstance(raw, dict):
            continue
        lora_id = str(raw.get("id") or "").strip()
        if not lora_id:
            continue
        target_model = str(raw.get("target_model") or raw.get("model") or "").strip()
        if not target_model:
            continue
        key = (target_model, lora_id)
        if key in seen:
            continue
        seen.add(key)
        try:
            strength = float(raw.get("strength", raw.get("default_strength", 0.8)))
        except Exception:
            strength = 0.8
        strength = max(0.0, min(2.0, strength))
        name = re.sub(r"\s+", " ", str(raw.get("name") or "").strip())[:80]
        normalized.append({
            "id": lora_id[:180],
            "name": name or lora_id,
            "target_model": target_model[:180],
            "strength": strength,
            "enabled": bool(raw.get("enabled", True)),
            "note": str(raw.get("note") or "").strip()[:300],
        })
    return normalized


def normalize_runninghub_entry(raw, kind, *, runninghub_normalize_field, runninghub_workflow_json_from_config):
    if not isinstance(raw, dict):
        return None
    raw_id = raw.get("appId") if kind == "app" else raw.get("workflowId")
    entry_id = str(raw_id or raw.get("id") or "").strip()
    match = re.search(r"/run/(ai-app|workflow)/([0-9A-Za-z_-]+)", entry_id)
    if match:
        entry_id = match.group(2)
    if not entry_id:
        return None
    title = re.sub(r"\s+", " ", str(raw.get("title") or raw.get("name") or "").strip())[:80]
    note = str(raw.get("note") or raw.get("description") or "").strip()[:500]
    thumb = str(raw.get("thumbnail") or "").strip()
    if len(thumb) > 1500000:
        thumb = ""
    entry = {
        "id": entry_id[:80],
        "title": title or (f"AI 应用 {entry_id[-6:]}" if kind == "app" else f"工作流 {entry_id[-6:]}"),
        "note": note,
        "thumbnail": thumb,
        "enabled": bool(raw.get("enabled", True)),
    }
    if raw.get("hidden") is True:
        entry["hidden"] = True
    fields = raw.get("fields")
    if isinstance(fields, list):
        entry["fields"] = [runninghub_normalize_field(field) for field in fields if isinstance(field, dict)]
    if kind == "workflow":
        mode = str(raw.get("optionalImageMode") or raw.get("optional_image_mode") or "prune-workflow").strip()
        entry["optionalImageMode"] = mode or "prune-workflow"
        workflow_json = runninghub_workflow_json_from_config(raw)
        if workflow_json:
            entry["workflowJson"] = workflow_json
    try:
        updated_at = int(raw.get("updatedAt") or raw.get("updated_at") or 0)
        if updated_at > 0:
            entry["updatedAt"] = updated_at
    except Exception:
        pass
    if kind == "app":
        entry["appId"] = entry["id"]
    else:
        entry["workflowId"] = entry["id"]
    return entry


def normalize_runninghub_entries(values, kind, *, normalize_runninghub_entry):
    normalized = []
    seen = set()
    for raw in values or []:
        entry = normalize_runninghub_entry(raw, kind)
        if not entry or entry["id"] in seen:
            continue
        seen.add(entry["id"])
        normalized.append(entry)
    return normalized


def runninghub_entry_id(entry, kind):
    if not isinstance(entry, dict):
        return ""
    raw_id = entry.get("workflowId") if kind == "workflow" else entry.get("appId")
    return str(raw_id or entry.get("id") or "").strip()


def static_runninghub_thumbnail_url(entry_id, kind, *, RUNNINGHUB_THUMBNAIL_EXTS, STATIC_DIR, STATIC_RUNNINGHUB_DIR, STATIC_RUNNINGHUB_THUMBNAIL_DIR):
    entry_id = re.sub(r"[^0-9A-Za-z_-]", "", str(entry_id or "").strip())
    kind_prefix = "workflow" if kind == "workflow" else "app"
    if not entry_id:
        return ""
    candidates = []
    for name in (f"{kind_prefix}-{entry_id}", entry_id):
        for ext in RUNNINGHUB_THUMBNAIL_EXTS:
            candidates.append((STATIC_RUNNINGHUB_THUMBNAIL_DIR, f"{name}{ext}"))
            candidates.append((STATIC_RUNNINGHUB_DIR, f"{name}{ext}"))
    for root, filename in candidates:
        path = os.path.abspath(os.path.join(root, filename))
        if not path.startswith(os.path.abspath(STATIC_RUNNINGHUB_DIR) + os.sep):
            continue
        if os.path.exists(path) and os.path.isfile(path):
            rel = os.path.relpath(path, STATIC_DIR).replace(os.sep, "/")
            return f"/static/{urllib.parse.quote(rel, safe='/._-')}?v={int(os.path.getmtime(path))}"
    return ""


def apply_runninghub_system_thumbnails(entries, kind, *, normalize_runninghub_entries, runninghub_entry_id, static_runninghub_thumbnail_url):
    result = []
    for entry in normalize_runninghub_entries(entries or [], kind):
        if not entry.get("thumbnail"):
            thumb = static_runninghub_thumbnail_url(runninghub_entry_id(entry, kind), kind)
            if thumb:
                entry["thumbnail"] = thumb
        result.append(entry)
    return result


def merge_runninghub_entry_overlay(system_entry, user_entry):
    if not isinstance(system_entry, dict):
        return user_entry
    if not isinstance(user_entry, dict):
        return system_entry
    merged = {**system_entry, **user_entry}
    if not merged.get("thumbnail") and system_entry.get("thumbnail"):
        merged["thumbnail"] = system_entry.get("thumbnail")
    return merged


def merge_runninghub_system_entries(system_entries, user_entries, kind, *, apply_runninghub_system_thumbnails, merge_runninghub_entry_overlay, runninghub_entry_id):
    merged = []
    index = {}
    hidden_ids = set()
    for entry in apply_runninghub_system_thumbnails(system_entries or [], kind):
        entry_id = runninghub_entry_id(entry, kind)
        if not entry_id:
            continue
        index[entry_id] = len(merged)
        merged.append(entry)
    for entry in apply_runninghub_system_thumbnails(user_entries or [], kind):
        entry_id = runninghub_entry_id(entry, kind)
        if not entry_id:
            continue
        if entry.get("hidden") is True:
            hidden_ids.add(entry_id)
            if entry_id in index:
                merged.pop(index[entry_id])
                index = {runninghub_entry_id(item, kind): idx for idx, item in enumerate(merged)}
            index[entry_id] = len(merged)
            merged.append(entry)
            continue
        if entry_id in index:
            merged[index[entry_id]] = merge_runninghub_entry_overlay(merged[index[entry_id]], entry)
        else:
            index[entry_id] = len(merged)
            merged.append(entry)
    return merged


def load_static_runninghub_provider(*, STATIC_RUNNINGHUB_API_PROVIDERS_FILE, apply_runninghub_system_thumbnails, normalize_provider, write_diagnostic):
    if not os.path.exists(STATIC_RUNNINGHUB_API_PROVIDERS_FILE):
        return None
    try:
        with open(STATIC_RUNNINGHUB_API_PROVIDERS_FILE, "r", encoding="utf-8") as f:
            raw = json.load(f)
        candidates = raw if isinstance(raw, list) else raw.get("providers") if isinstance(raw, dict) else []
        if isinstance(raw, dict) and raw.get("id") == "runninghub":
            candidates = [raw]
        for item in candidates or []:
            if isinstance(item, dict) and str(item.get("id") or "").strip().lower() == "runninghub":
                provider = normalize_provider(item)
                provider["rh_apps"] = apply_runninghub_system_thumbnails(provider.get("rh_apps") or [], "app")
                provider["rh_workflows"] = apply_runninghub_system_thumbnails(provider.get("rh_workflows") or [], "workflow")
                return provider
    except Exception as e:
        write_diagnostic(
            f"static RunningHub config load failed error={type(e).__name__}"
        )
    return None


def merge_runninghub_provider_with_static(provider, *, load_static_runninghub_provider, merge_runninghub_system_entries, model_list_from_values, normalize_provider):
    static_provider = load_static_runninghub_provider()
    if not static_provider:
        return provider
    if not isinstance(provider, dict):
        return static_provider
    merged = {**static_provider, **provider}
    merged["protocol"] = "runninghub"
    merged["image_models"] = model_list_from_values(provider.get("image_models") or [])
    merged["chat_models"] = model_list_from_values(provider.get("chat_models") or [])
    merged["video_models"] = model_list_from_values(provider.get("video_models") or [])
    merged["rh_apps"] = merge_runninghub_system_entries(static_provider.get("rh_apps") or [], provider.get("rh_apps") or [], "app")
    merged["rh_workflows"] = merge_runninghub_system_entries(static_provider.get("rh_workflows") or [], provider.get("rh_workflows") or [], "workflow")
    return normalize_provider(merged)


def preserve_runninghub_hidden_overrides(provider, *, load_static_runninghub_provider, normalize_runninghub_entries, normalize_runninghub_entry, runninghub_entry_id):
    if not isinstance(provider, dict) or provider.get("id") != "runninghub":
        return provider
    static_provider = load_static_runninghub_provider()
    if not static_provider:
        return provider
    provider = dict(provider)
    for list_key, kind in (("rh_apps", "app"), ("rh_workflows", "workflow")):
        current = normalize_runninghub_entries(provider.get(list_key) or [], kind)
        current_ids = {runninghub_entry_id(item, kind) for item in current}
        for static_entry in static_provider.get(list_key) or []:
            entry_id = runninghub_entry_id(static_entry, kind)
            if entry_id and entry_id not in current_ids:
                tombstone = normalize_runninghub_entry({**static_entry, "enabled": False, "hidden": True}, kind)
                if tombstone:
                    current.append(tombstone)
        provider[list_key] = current
    return provider


def normalize_endpoint_override(value, label, *, HTTPException):
    endpoint = str(value or "").strip()
    if not endpoint:
        return ""
    if len(endpoint) > 300 or re.search(r"\s", endpoint):
        raise HTTPException(status_code=400, detail=f"{label} 不合法，请填写类似 /v1/images/edits 的路径")
    if re.match(r"^https?://", endpoint, re.I):
        return endpoint.rstrip("/")
    if not endpoint.startswith("/"):
        raise HTTPException(status_code=400, detail=f"{label} 需要以 /v1/... 开头，或填写完整 http(s) 地址")
    return endpoint


def normalize_image_request_mode(value, *, SUPPORTED_IMAGE_REQUEST_MODES):
    mode = str(value or "").strip().lower()
    return mode if mode in SUPPORTED_IMAGE_REQUEST_MODES else "openai"


def is_tudou_base_url(base_url=''):
    """Only recognize the official Tudou host, never a substring in another provider URL."""
    try:
        host = (urllib.parse.urlsplit(str(base_url or "").strip()).hostname or "").lower()
    except Exception:
        host = ""
    return host == "api.ai-tudou.net" or host.endswith(".ai-tudou.net")


def locked_recommended_provider_rule(provider_id='', name='', base_url='', *, LOCKED_RECOMMENDED_PROVIDER_RULES):
    pid = str(provider_id or "").strip().lower()
    pname = str(name or "").strip().lower()
    pbase = str(base_url or "").strip().rstrip("/").lower()
    try:
        phost = urllib.parse.urlsplit(pbase).netloc.lower()
    except Exception:
        phost = ""
    for key, rule in LOCKED_RECOMMENDED_PROVIDER_RULES.items():
        hosts = {urllib.parse.urlsplit(url).netloc.lower() for url in rule["base_urls"]}
        if pid == key or pname in rule["names"] or pbase in rule["base_urls"] or (phost and phost in hosts):
            return rule
    return None


def apply_locked_recommended_model_rules(base_url='', grouped=None, *, locked_recommended_provider_rule):
    rule = locked_recommended_provider_rule("", "", base_url)
    if not rule or "video_models" not in rule:
        return grouped
    grouped = {key: list(value or []) for key, value in (grouped or {}).items()}
    grouped.setdefault("image", [])
    grouped.setdefault("chat", [])
    grouped["video"] = list(rule.get("video_models") or [])
    return grouped


def provider_endpoint_url(provider, key, default_path, *, AI_BASE_URL):
    base_url = str((provider or {}).get("base_url") or AI_BASE_URL).strip().rstrip("/")
    override = str((provider or {}).get(key) or "").strip()
    if override:
        if re.match(r"^https?://", override, re.I):
            return override.rstrip("/")
        parsed = urllib.parse.urlsplit(base_url)
        if parsed.scheme and parsed.netloc:
            return f"{parsed.scheme}://{parsed.netloc}{override}"
        return override
    for prefix in ("/api/v3", "/v1beta", "/v1", "/v2"):
        if base_url.endswith(prefix) and default_path.startswith(f"{prefix}/"):
            return f"{base_url}{default_path[len(prefix):]}"
    return f"{base_url}{default_path}"


def runninghub_endpoint_url(provider, path, *, RUNNINGHUB_DEFAULT_BASE_URL):
    base_url = str((provider or {}).get("base_url") or RUNNINGHUB_DEFAULT_BASE_URL).strip().rstrip("/")
    return f"{base_url}{path}"


def runninghub_openapi_base_url(provider=None, *, RUNNINGHUB_DEFAULT_BASE_URL):
    base_url = str((provider or {}).get("base_url") or RUNNINGHUB_DEFAULT_BASE_URL).strip().rstrip("/")
    if base_url.endswith("/openapi/v2"):
        return base_url
    return f"{base_url}/openapi/v2"


def runninghub_openapi_url(provider, path='', *, runninghub_openapi_base_url):
    path = str(path or "").strip()
    if path.startswith("http://") or path.startswith("https://"):
        return path
    path = path.lstrip("/")
    base = runninghub_openapi_base_url(provider)
    return f"{base}/{path}" if path else base


def normalize_provider(item, *, HTTPException, PROVIDER_ID_RE, RUNNINGHUB_DEFAULT_BASE_URL, SUPPORTED_PROVIDER_PROTOCOLS, VOLCENGINE_DEFAULT_BASE_URL, VOLCENGINE_DEFAULT_PROJECT_NAME, VOLCENGINE_DEFAULT_REGION, detect_image_request_mode, locked_recommended_provider_rule, model_list_from_values, normalize_endpoint_override, normalize_image_request_mode, normalize_model_name_map, normalize_model_protocols, normalize_ms_loras, normalize_runninghub_entries):
    provider_id = str(item.get("id") or "").strip().lower()
    if not PROVIDER_ID_RE.fullmatch(provider_id):
        raise HTTPException(status_code=400, detail=f"API 平台 ID 不合法：{provider_id or '(empty)'}")
    name = re.sub(r"\s+", " ", str(item.get("name") or provider_id).strip())[:60] or provider_id
    base_url = str(item.get("base_url") or "").strip().rstrip("/")
    if base_url and not re.match(r"^https?://", base_url):
        raise HTTPException(status_code=400, detail=f"{name} 的 Base URL 需要以 http:// 或 https:// 开头")
    protocol = str(item.get("protocol") or "openai").strip().lower()
    if protocol == "tudou":
        protocol = "openai"
    if protocol not in SUPPORTED_PROVIDER_PROTOCOLS:
        protocol = "openai"
    image_request_mode = detect_image_request_mode(base_url, item.get("image_models") or []) or normalize_image_request_mode(item.get("image_request_mode"))
    image_generation_endpoint = normalize_endpoint_override(item.get("image_generation_endpoint"), "文生图端口")
    image_edit_endpoint = normalize_endpoint_override(item.get("image_edit_endpoint"), "图生图/编辑端口")
    volc_project = re.sub(r"\s+", " ", str(item.get("volcengine_project_name") or "").strip())[:80]
    volc_region = re.sub(r"\s+", " ", str(item.get("volcengine_region") or "").strip())[:40]
    if provider_id == "volcengine":
        protocol = "volcengine"
        base_url = base_url or VOLCENGINE_DEFAULT_BASE_URL
        volc_project = volc_project or VOLCENGINE_DEFAULT_PROJECT_NAME
        volc_region = volc_region or VOLCENGINE_DEFAULT_REGION
    if provider_id == "jimeng" or protocol == "jimeng":
        protocol = "jimeng"
        base_url = ""
    if protocol in {"codex", "gemini-cli"}:
        base_url = ""
    if provider_id == "runninghub":
        protocol = "runninghub"
        base_url = base_url or RUNNINGHUB_DEFAULT_BASE_URL
    locked_rule = locked_recommended_provider_rule(provider_id, name, base_url)
    if locked_rule:
        protocol = locked_rule["protocol"]
        image_request_mode = locked_rule["image_request_mode"]
    video_models = model_list_from_values(item.get("video_models") or [])
    if locked_rule and "video_models" in locked_rule:
        video_models = model_list_from_values(locked_rule.get("video_models") or [])
    return {
        "id": provider_id,
        "name": name,
        "base_url": base_url,
        "protocol": protocol,
        "image_request_mode": image_request_mode,
        "image_generation_endpoint": image_generation_endpoint,
        "image_edit_endpoint": image_edit_endpoint,
        "enabled": bool(item.get("enabled", True)),
        "primary": bool(item.get("primary", False)),
        "image_models": model_list_from_values(item.get("image_models") or []),
        "chat_models": model_list_from_values(item.get("chat_models") or []),
        "audio_models": model_list_from_values(item.get("audio_models") or []),
        "audio_generation_models": model_list_from_values(item.get("audio_generation_models") or []),
        "audio_generation_protocol": item.get("audio_generation_protocol") if item.get("audio_generation_protocol") in {"openai-speech", "minimax-speech", "minimax-music"} else "openai-speech",
        "audio_generation_voices": model_list_from_values(item.get("audio_generation_voices") or []),
        "audio_generation_instructions": bool(item.get("audio_generation_instructions", False)),
        "audio_timestamp_models": [m for m in model_list_from_values(item.get("audio_timestamp_models") or []) if m in model_list_from_values(item.get("audio_models") or [])],
        "video_models": video_models,
        "model_names": normalize_model_name_map(item.get("model_names")),
        "model_protocols": normalize_model_protocols(item.get("model_protocols")),
        "ms_loras": normalize_ms_loras(item.get("ms_loras") or []),
        "ms_defaults_version": int(item.get("ms_defaults_version") or 0),
        "rh_apps": normalize_runninghub_entries(item.get("rh_apps") or [], "app"),
        "rh_workflows": normalize_runninghub_entries(item.get("rh_workflows") or [], "workflow"),
        "volcengine_project_name": volc_project,
        "volcengine_region": volc_region,
    }


def load_api_providers(*, API_PROVIDERS_FILE, default_api_providers, merge_default_api_providers, normalize_provider, write_diagnostic):
    defaults = default_api_providers()
    if not os.path.exists(API_PROVIDERS_FILE):
        return merge_default_api_providers(defaults)
    try:
        with open(API_PROVIDERS_FILE, "r", encoding="utf-8") as f:
            raw = json.load(f)
        providers = [normalize_provider(item) for item in raw if isinstance(item, dict)]
        return merge_default_api_providers(providers or defaults, inject_missing=not bool(providers))
    except Exception as e:
        write_diagnostic(f"API provider config load failed error={type(e).__name__}")
        return defaults


def save_api_providers(providers, *, API_PROVIDERS_FILE, DATA_DIR, GLOBAL_CONFIG_LOCK, HTTPException, write_json_atomic):
    os.makedirs(DATA_DIR, exist_ok=True)
    with GLOBAL_CONFIG_LOCK:
        if os.path.exists(API_PROVIDERS_FILE):
            try:
                with open(API_PROVIDERS_FILE, "r", encoding="utf-8") as f:
                    existing = json.load(f)
                if not isinstance(existing, list):
                    raise ValueError("API 平台配置不是列表")
            except (OSError, UnicodeError, ValueError) as exc:
                raise HTTPException(
                    status_code=500,
                    detail="API 平台配置损坏或无法读取，已保留原文件；请从备份恢复。",
                ) from exc
        write_json_atomic(API_PROVIDERS_FILE, providers, ensure_ascii=False, indent=2)


def default_runninghub_static_provider(*, RUNNINGHUB_DEFAULT_BASE_URL):
    return {
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
        "model_protocols": {},
        "ms_loras": [],
        "ms_defaults_version": 0,
        "rh_apps": [],
        "rh_workflows": [],
    }


def mutate_static_runninghub_provider(mutator, *, STATIC_RUNNINGHUB_API_PROVIDERS_FILE, STATIC_RUNNINGHUB_DIR, default_runninghub_static_provider, write_diagnostic, write_json_atomic):
    os.makedirs(STATIC_RUNNINGHUB_DIR, exist_ok=True)
    raw = []
    if os.path.exists(STATIC_RUNNINGHUB_API_PROVIDERS_FILE):
        try:
            with open(STATIC_RUNNINGHUB_API_PROVIDERS_FILE, "r", encoding="utf-8") as f:
                raw = json.load(f)
        except Exception as exc:
            write_diagnostic(
                f"static RunningHub template read failed error={type(exc).__name__}"
            )
            raw = []
    if isinstance(raw, dict) and str(raw.get("id") or "").strip().lower() == "runninghub":
        provider = raw
    else:
        if isinstance(raw, list):
            providers = raw
        elif isinstance(raw, dict):
            providers = raw.setdefault("providers", [])
            if not isinstance(providers, list):
                providers = []
                raw["providers"] = providers
        else:
            raw = []
            providers = raw
        provider = next((
            item for item in providers
            if isinstance(item, dict) and str(item.get("id") or "").strip().lower() == "runninghub"
        ), None)
        if provider is None:
            provider = default_runninghub_static_provider()
            providers.append(provider)
    changed = mutator(provider)
    if changed is False:
        return False
    write_json_atomic(STATIC_RUNNINGHUB_API_PROVIDERS_FILE, raw, ensure_ascii=False, indent=2)
    return True


def sync_runninghub_provider_workflows_to_static_template(provider, *, RUNNINGHUB_DEFAULT_BASE_URL, mutate_static_runninghub_provider, normalize_runninghub_entries, runninghub_workflow_store_key):
    if not isinstance(provider, dict) or str(provider.get("id") or "").strip().lower() != "runninghub":
        return False
    workflows = []
    seen = set()
    for entry in normalize_runninghub_entries(provider.get("rh_workflows") or [], "workflow"):
        key = runninghub_workflow_store_key(entry.get("workflowId") or entry.get("id"))
        if not key or entry.get("hidden") is True or key in seen:
            continue
        seen.add(key)
        workflows.append(entry)
    def apply_workflows(static_provider):
        static_provider["id"] = "runninghub"
        static_provider["name"] = static_provider.get("name") or "RunningHub"
        static_provider["base_url"] = static_provider.get("base_url") or RUNNINGHUB_DEFAULT_BASE_URL
        static_provider["protocol"] = "runninghub"
        static_provider["rh_workflows"] = workflows
        if "rh_apps" not in static_provider or not isinstance(static_provider.get("rh_apps"), list):
            static_provider["rh_apps"] = []
        return True
    return mutate_static_runninghub_provider(apply_workflows)


def public_provider(provider, *, VOLCENGINE_DEFAULT_PROJECT_NAME, VOLCENGINE_DEFAULT_REGION, mask_secret, normalize_runninghub_entries, provider_env_key_value, provider_key_env, runninghub_provider_with_workflow_store, runninghub_wallet_key_env, runninghub_wallet_key_value, volcengine_access_key_env, volcengine_access_key_value, volcengine_secret_key_env, volcengine_secret_key_value, volcengine_voice_api_key_env, volcengine_voice_api_key_value):
    if provider.get("id") == "runninghub":
        try:
            provider = runninghub_provider_with_workflow_store(provider)
        except Exception:
            pass
    key = provider_env_key_value(provider["id"])
    item = {
        **provider,
        "has_key": bool(key),
        "key_preview": mask_secret(key),
        "key_env": provider_key_env(provider["id"]),
    }
    if provider.get("id") == "runninghub":
        item["rh_apps"] = normalize_runninghub_entries(item.get("rh_apps") or [], "app")
        item["rh_workflows"] = normalize_runninghub_entries(item.get("rh_workflows") or [], "workflow")
        wallet_key = runninghub_wallet_key_value()
        item.update({
            "has_wallet_key": bool(wallet_key),
            "wallet_key_preview": mask_secret(wallet_key),
            "wallet_key_env": runninghub_wallet_key_env(),
        })
    if provider.get("id") == "volcengine":
        ak = volcengine_access_key_value()
        sk = volcengine_secret_key_value()
        voice_key = volcengine_voice_api_key_value()
        item.update({
            "has_volcengine_access_key": bool(ak),
            "volcengine_access_key_preview": mask_secret(ak),
            "volcengine_access_key_env": volcengine_access_key_env(),
            "has_volcengine_secret_key": bool(sk),
            "volcengine_secret_key_preview": mask_secret(sk),
            "volcengine_secret_key_env": volcengine_secret_key_env(),
            "has_volcengine_voice_api_key": bool(voice_key),
            "volcengine_voice_api_key_preview": mask_secret(voice_key),
            "volcengine_voice_api_key_env": volcengine_voice_api_key_env(),
            "volcengine_project_name": provider.get("volcengine_project_name") or VOLCENGINE_DEFAULT_PROJECT_NAME,
            "volcengine_region": provider.get("volcengine_region") or VOLCENGINE_DEFAULT_REGION,
        })
    return item


def public_api_providers(*, load_api_providers, public_provider):
    return [public_provider(p) for p in load_api_providers()]


def get_primary_provider_id(providers=None, *, load_api_providers):
    """返回当前首选 provider 的 id；优先 primary=True 的，否则取第一个非 modelscope 的，再次取第一个。"""
    providers = providers if providers is not None else load_api_providers()
    primary = next((p for p in providers if p.get("primary") and p.get("enabled", True)), None)
    if primary:
        return primary["id"]
    non_ms = next((p for p in providers if p["id"] != "modelscope" and p.get("enabled", True)), None)
    if non_ms:
        return non_ms["id"]
    return providers[0]["id"] if providers else "modelscope"


def get_api_provider(provider_id='comfly', *, HTTPException, get_primary_provider_id, load_api_providers):
    providers = load_api_providers()
    target = (provider_id or "").strip().lower()
    # 兼容旧的 "comfly" 硬编码：若 comfly 不存在或未指定，回退到首选 provider
    if not target or not any(p["id"] == target for p in providers):
        target = get_primary_provider_id(providers)
    provider = next((p for p in providers if p["id"] == target), None)
    if not provider:
        raise HTTPException(status_code=400, detail=f"未找到 API 平台：{target}")
    if not provider.get("enabled", True):
        raise HTTPException(status_code=400, detail=f"API 平台已禁用：{provider.get('name') or target}")
    return provider


def get_api_provider_exact(provider_id, *, HTTPException, load_api_providers):
    providers = load_api_providers()
    target = (provider_id or "").strip().lower()
    provider = next((p for p in providers if p["id"] == target), None)
    if not provider:
        raise HTTPException(status_code=400, detail=f"未找到 API 平台：{target or '(empty)'}。新增平台未保存时请使用当前表单拉取模型。")
    if not provider.get("enabled", True):
        raise HTTPException(status_code=400, detail=f"API 平台已禁用：{provider.get('name') or target}")
    return provider


def modelscope_provider_config(*, get_api_provider_exact):
    return get_api_provider_exact("modelscope")


def modelscope_api_root(provider=None, *, MODELSCOPE_CHAT_BASE_URL, modelscope_provider_config):
    provider = provider or modelscope_provider_config()
    base_root = str((provider or {}).get("base_url") or MODELSCOPE_CHAT_BASE_URL).strip().rstrip("/")
    if not base_root:
        base_root = MODELSCOPE_CHAT_BASE_URL
    return base_root if base_root.endswith("/v1") else f"{base_root}/v1"


def modelscope_image_api_root(*, MODELSCOPE_CHAT_BASE_URL):
    return MODELSCOPE_CHAT_BASE_URL.rstrip("/")




async def ai_config(*, AI_API_KEY, AI_BASE_URL, CHAT_MODEL, CHAT_MODELS, COMFYUI_INSTANCES, IMAGE_MODEL, IMAGE_MODELS, MODELSCOPE_CHAT_MODELS, VIDEO_MODELS, modelscope_api_key, public_api_providers):
    preferred_chat_model = next((m for m in CHAT_MODELS if m == "gpt-5.5"), CHAT_MODELS[0] if CHAT_MODELS else CHAT_MODEL)
    providers = public_api_providers()
    return {
        "base_url": AI_BASE_URL,
        "chat_model": preferred_chat_model,
        "image_model": IMAGE_MODEL,
        "chat_models": CHAT_MODELS,
        "image_models": IMAGE_MODELS,
        "video_models": VIDEO_MODELS,
        "comfy_instances": COMFYUI_INSTANCES,
        "api_providers": providers,
        "has_api_key": bool(AI_API_KEY),
        "ms_chat_models": MODELSCOPE_CHAT_MODELS,
        "has_ms_key": bool(modelscope_api_key()),
    }


async def save_providers(payload, *, HTTPException, model_dump_compat, normalize_provider, preserve_runninghub_hidden_overrides, provider_key_env, prune_runninghub_workflow_store_for_provider, public_provider, reload_env_globals, runninghub_wallet_key_env, save_api_providers, sync_runninghub_provider_workflows_to_static_template, update_env_values, volcengine_access_key_env, volcengine_secret_key_env, volcengine_voice_api_key_env):
    providers = []
    env_updates = {}
    # 收集每个 item 的 primary 字段
    raw_primary_flags = [bool(getattr(item, "primary", False)) for item in payload]
    for item in payload:
        provider = normalize_provider(model_dump_compat(item, exclude={"api_key"}))
        if provider["id"] == "runninghub":
            provider = preserve_runninghub_hidden_overrides(provider)
            prune_runninghub_workflow_store_for_provider(provider)
        if any(existing["id"] == provider["id"] for existing in providers):
            raise HTTPException(status_code=400, detail=f"API 平台 ID 重复：{provider['id']}")
        providers.append(provider)
        key_env = provider_key_env(provider["id"])
        if item.clear_key:
            env_updates[key_env] = ""
        elif item.api_key is not None and item.api_key.strip():
            env_updates[key_env] = item.api_key.strip()
        if provider["id"] == "runninghub":
            wallet_env = runninghub_wallet_key_env()
            if item.clear_wallet_key:
                env_updates[wallet_env] = ""
            elif item.wallet_api_key is not None and item.wallet_api_key.strip():
                env_updates[wallet_env] = item.wallet_api_key.strip()
        if provider["id"] == "volcengine":
            ak_env = volcengine_access_key_env()
            sk_env = volcengine_secret_key_env()
            voice_env = volcengine_voice_api_key_env()
            if item.clear_volcengine_access_key_id:
                env_updates[ak_env] = ""
            elif item.volcengine_access_key_id is not None and item.volcengine_access_key_id.strip():
                env_updates[ak_env] = item.volcengine_access_key_id.strip()
            if item.clear_volcengine_secret_access_key:
                env_updates[sk_env] = ""
            elif item.volcengine_secret_access_key is not None and item.volcengine_secret_access_key.strip():
                env_updates[sk_env] = item.volcengine_secret_access_key.strip()
            if item.clear_volcengine_voice_api_key:
                env_updates[voice_env] = ""
            elif item.volcengine_voice_api_key is not None and item.volcengine_voice_api_key.strip():
                env_updates[voice_env] = item.volcengine_voice_api_key.strip()
        if provider["id"] == "comfly":
            env_updates["COMFLY_BASE_URL"] = provider["base_url"]
            env_updates["IMAGE_MODELS"] = ",".join(provider["image_models"])
            env_updates["CHAT_MODELS"] = ",".join(provider["chat_models"])
            env_updates["VIDEO_MODELS"] = ",".join(provider.get("video_models") or [])
        if provider["id"] == "modelscope":
            env_updates["MODELSCOPE_CHAT_MODELS"] = ",".join(provider["chat_models"])
        if provider["id"] == "runninghub":
            provider["protocol"] = "runninghub"
        if provider["id"] == "volcengine":
            provider["protocol"] = "volcengine"
    if not providers:
        raise HTTPException(status_code=400, detail="至少保留一个 API 平台")
    # 强制最多一个 primary（取最后被标记的；都没标记则保持原样不强制）
    primary_indices = [i for i, flag in enumerate(raw_primary_flags) if flag]
    if primary_indices:
        winner = primary_indices[-1]
        for i, p in enumerate(providers):
            p["primary"] = (i == winner)
    save_api_providers(providers)
    runninghub_provider = next((item for item in providers if item.get("id") == "runninghub"), None)
    if runninghub_provider:
        sync_runninghub_provider_workflows_to_static_template(runninghub_provider)
    if env_updates:
        update_env_values(env_updates)
        reload_env_globals()   # 立即将最新 env 值同步回模块全局变量，无需重启
    return {"providers": [public_provider(p) for p in providers]}


