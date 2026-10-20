"""平台连通性探测、异步协议探测与上游模型列表适配。

HTTP客户端、CLI状态与凭据适配/错误清洗回调由应用注入；导入不探测服务。
"""
import os
import re

def upstream_models_url(base_url, protocol, *, runninghub_openapi_url):
    if protocol == "gemini":
        return f"{base_url}/models" if base_url.endswith("/v1beta") else f"{base_url}/v1beta/models"
    if protocol == "volcengine":
        return f"{base_url}/models" if base_url.endswith("/api/v3") else f"{base_url}/api/v3/models"
    if protocol == "runninghub":
        return runninghub_openapi_url({"base_url": base_url}, "models")
    return f"{base_url}/models" if base_url.endswith("/v1") else f"{base_url}/v1/models"


def upstream_model_headers(api_key, protocol, *, bearer_auth_value):
    if protocol == "gemini":
        return {"x-goog-api-key": api_key, "Accept": "application/json"}
    if protocol == "runninghub":
        return {"Authorization": bearer_auth_value(api_key), "Accept": "application/json"}
    return {"Authorization": bearer_auth_value(api_key), "Accept": "application/json"}


def public_probe_raw(value, *, _PUBLIC_PROBE_KEYS, _safe_upstream_text, public_probe_raw):
    """保留连接探测所需的状态摘要，拒绝透传供应商原始 JSON。"""
    if value is None:
        return None
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            name = str(key)
            if name not in _PUBLIC_PROBE_KEYS:
                continue
            if isinstance(item, (dict, list)):
                child = public_probe_raw(item)
                if child not in (None, {}, []):
                    result[name] = child
            elif name in {"status", "status_code", "code", "openapi_count", "llm_count", "model_count"}:
                if isinstance(item, (int, float)) and not isinstance(item, bool):
                    result[name] = item
                elif str(item or "").strip():
                    result[name] = str(item)[:80]
            else:
                text = _safe_upstream_text(item, 600)
                if text:
                    result[name] = text
        return result
    if isinstance(value, list):
        items = [public_probe_raw(item) for item in value[:8]]
        return [item for item in items if item not in (None, {}, [])]
    text = _safe_upstream_text(value, 600)
    return {"summary": text} if text else {}


def volcengine_default_model_payload(status=200, message='', raw=None, *, public_probe_raw):
    return {
        "ok": True,
        "protocol": "volcengine",
        "status": status,
        "message": message or "方舟任务接口可用，模型列表接口未返回模型。请按实际方舟控制台模型名称手动填写视频模型。",
        "model_count": 0,
        "image_models": [],
        "chat_models": [],
        "video_models": [],
        "all": [],
        "raw": public_probe_raw(raw),
    }


def volcengine_task_probe_url(base_url):
    base = str(base_url or "").strip().rstrip("/")
    if not base:
        return ""
    if base.endswith("/api/v3"):
        return f"{base}/contents/generations/tasks/healthcheck_probe_do_not_submit"
    return f"{base}/api/v3/contents/generations/tasks/healthcheck_probe_do_not_submit"


async def probe_volcengine_task_endpoint(client, base_url, api_key, *, looks_like_html_response, probe_error_payload, upstream_model_headers, volcengine_task_probe_url):
    probe_url = volcengine_task_probe_url(base_url)
    if not probe_url:
        return False, {"status": 0, "message": "Base URL 为空"}
    response = await client.get(probe_url, headers=upstream_model_headers(api_key, "volcengine"))
    raw = probe_error_payload(response, "方舟任务端点已响应")
    if response.status_code in (401, 403):
        return False, {"status": response.status_code, "message": "方舟 API Key 无效或无权限", "raw": raw}
    if looks_like_html_response(response.text):
        return False, {"status": response.status_code, "message": "任务接口返回 HTML，Base URL 可能不是 API 地址", "raw": raw}
    if response.status_code < 500:
        return True, {"status": response.status_code, "message": "方舟任务查询端点可达", "raw": raw}
    return False, {"status": response.status_code, "message": f"方舟任务接口服务端错误 {response.status_code}", "raw": raw}


def openai_compat_root_for_probe(base_url):
    base = str(base_url or "").strip().rstrip("/")
    if base.endswith("/api/v3"):
        base = base[: -len("/api/v3")]
    if base.endswith("/v1"):
        return base
    return f"{base}/v1" if base else ""


async def probe_openai_compat_bearer_endpoint(client, base_url, api_key, *, looks_like_html_response, openai_compat_root_for_probe, probe_error_payload, upstream_model_headers):
    root = openai_compat_root_for_probe(base_url)
    if not root:
        return False, {"status": 0, "message": "Base URL 为空"}
    url = f"{root}/chat/completions"
    response = await client.post(
        url,
        headers={**upstream_model_headers(api_key, "openai"), "Content-Type": "application/json"},
        json={"messages": []},
    )
    raw = probe_error_payload(response, "OpenAI 兼容入口已响应")
    if response.status_code in (401, 403):
        return False, {"status": response.status_code, "message": "API Key 无效或无权限", "raw": raw}
    if looks_like_html_response(response.text):
        return False, {"status": response.status_code, "message": "OpenAI 兼容入口返回 HTML，Base URL 可能不是 API 地址", "raw": raw}
    if response.status_code < 500:
        return True, {"status": response.status_code, "message": "OpenAI 兼容 Bearer 鉴权入口可达", "raw": raw}
    return False, {"status": response.status_code, "message": f"OpenAI 兼容入口服务端错误 {response.status_code}", "raw": raw}


async def probe_openai_models_endpoint(client, base_url, api_key, *, apply_locked_recommended_model_rules, looks_like_html_response, parse_upstream_models, probe_error_payload, upstream_model_headers, upstream_models_url):
    url = upstream_models_url(base_url, "openai")
    response = await client.get(url, headers=upstream_model_headers(api_key, "openai"))
    try:
        raw = response.json() if response.text else {}
    except ValueError:
        raw = {}
    diagnostic = probe_error_payload(response, "模型列表探测失败")
    if response.status_code in (301, 302, 303, 307, 308):
        return False, {"status": response.status_code, "message": "OpenAI /v1/models 发生跳转，请填写 API Base URL，不要填写网页登录地址", "raw": diagnostic}
    if response.status_code in (401, 403):
        return False, {"status": response.status_code, "message": "OpenAI API Key 无效或无权限", "raw": diagnostic}
    if looks_like_html_response(response.text):
        return False, {"status": response.status_code, "message": "OpenAI /v1/models 返回网页 HTML，请检查请求地址是否为 API Base URL", "raw": diagnostic}
    if response.status_code < 300:
        grouped, ids = parse_upstream_models(raw, "openai") if isinstance(raw, dict) else ({"image": [], "chat": [], "video": []}, [])
        grouped = apply_locked_recommended_model_rules(base_url, grouped)
        return True, {
            "status": response.status_code,
            "message": f"OpenAI 兼容模型列表端点可用{f'，找到 {len(ids)} 个模型' if ids else ''}",
            "raw": {"status": response.status_code, "model_count": len(ids)},
            "model_count": len(ids),
            "image_models": grouped["image"],
            "chat_models": grouped["chat"],
            "video_models": grouped["video"],
            "audio_models": grouped.get("audio", []),
            "audio_generation_models": grouped.get("audioGeneration", []),
            "all": ids,
        }
    if 400 <= response.status_code < 500:
        return False, {"status": response.status_code, "message": f"OpenAI /v1/models 不可用 (HTTP {response.status_code})", "raw": diagnostic}
    return False, {"status": response.status_code, "message": f"OpenAI /v1/models 服务端错误 {response.status_code}", "raw": diagnostic}


async def probe_volcengine_auto_detect(client, base_url, api_key, *, probe_openai_compat_bearer_endpoint, probe_volcengine_task_endpoint):
    task_ok, task_probe = await probe_volcengine_task_endpoint(client, base_url, api_key)
    if task_ok:
        return True, {
            "status": task_probe.get("status") or 200,
            "message": "检测到方舟/Ark 任务协议",
            "raw": {"task_probe": task_probe.get("raw")},
        }
    compat_ok, compat_probe = await probe_openai_compat_bearer_endpoint(client, base_url, api_key)
    if compat_ok:
        return True, {
            "status": compat_probe.get("status") or 200,
            "message": "检测到方舟/Ark Bearer 鉴权入口（OpenAI 兼容透传）",
            "raw": {"task_probe": task_probe, "openai_compat_probe": compat_probe.get("raw")},
        }
    return False, {
        "status": compat_probe.get("status") or task_probe.get("status") or 0,
        "message": compat_probe.get("message") or task_probe.get("message") or "未检测到方舟/Ark 兼容入口",
        "raw": {"task_probe": task_probe, "openai_compat_probe": compat_probe.get("raw")},
    }


def classify_upstream_model(mid):
    lc = str(mid or "").lower()
    video_keys = ["veo", "sora", "wan2", "wanx", "doubao-seedance", "doubao-1", "kling", "hailuo", "video", "t2v-", "i2v-", "s2v"]
    if any(k in lc for k in video_keys):
        return "video"
    image_keys = ["banana", "image", "dalle", "dall-e", "imagen", "flux", "stable", "sdxl", "midjourney", "nano-banana", "ideogram", "fal-ai", "z-image", "qwen-image", "klein", "seedream", "doubao-seedream", "text-to-image", "image-to-image"]
    if any(k in lc for k in image_keys):
        return "image"
    # 音频聊天模型仍走聊天接口；这里只建议专用转写/生成模型。
    if any(k in lc for k in ("whisper", "transcribe", "sensevoice", "speech-to-text")) or re.search(r"(?:^|[/_-])asr(?:$|[/_-])", lc):
        return "audio"
    if any(k in lc for k in ("text-to-speech", "speech-01", "speech-02", "speech-2", "music-")) or re.search(r"(?:^|[/_-])tts(?:$|[/_-])", lc):
        return "audioGeneration"
    return "chat"


def parse_upstream_models(raw, protocol='openai', *, classify_upstream_model):
    items = raw.get("data") if isinstance(raw, dict) else None
    if not items and isinstance(raw, dict):
        items = raw.get("models") or raw.get("list") or []
    if not isinstance(items, list):
        items = []
    ids = []
    for it in items:
        if isinstance(it, str):
            mid = it
        elif isinstance(it, dict):
            mid = it.get("id") or it.get("name") or it.get("model")
        else:
            mid = ""
        if mid:
            mid = str(mid)
            if protocol == "gemini" and mid.startswith("models/"):
                mid = mid[len("models/"):]
            ids.append(mid)
    ids = sorted(set(ids))
    grouped = {"image": [], "chat": [], "video": [], "audio": [], "audioGeneration": []}
    for mid in ids:
        grouped[classify_upstream_model(mid)].append(mid)
    return grouped, ids


async def test_provider_connection(payload, *, HTTPException, JIMENG_DEFAULT_IMAGE_MODELS, JIMENG_DEFAULT_VIDEO_MODELS, RUNNINGHUB_DEFAULT_BASE_URL, _safe_upstream_text, api_key_from_payload, apply_locked_recommended_model_rules, detect_image_request_mode, fetch_codex_models_payload, gemini_cli_models_payload, gemini_cli_status, httpx, jimeng_status, log_net_error, looks_like_html_response, normalize_image_request_mode, parse_upstream_models, probe_volcengine_auto_detect, protocol_from_payload, runninghub_models_payload, safe_cli_public_raw, safe_cli_public_text, upstream_model_headers, upstream_models_url, upstream_response_error_summary, volcengine_default_model_payload):
    """测试请求地址是否可用：调上游 /v1/models。验证通过时同时把模型清单按类别返回，避免再调一次拉取接口。"""
    protocol = protocol_from_payload(payload)
    if protocol == "codex":
        return await fetch_codex_models_payload()
    if protocol == "gemini-cli":
        status = await gemini_cli_status()
        payload_models = gemini_cli_models_payload(raw={"status": status})
        payload_models.update({
            "ok": bool(status.get("installed")),
            "status": 200 if status.get("installed") else 0,
            "message": safe_cli_public_text(status.get("message") or ("Antigravity CLI 可用" if status.get("installed") else "未找到 Antigravity CLI")),
        })
        return payload_models
    if protocol == "jimeng":
        status = await jimeng_status()
        return {
            "ok": bool(status.get("installed") and status.get("logged_in")),
            "status": 200 if status.get("logged_in") else 0,
            "message": status.get("message") or "即梦 CLI 已登录",
            "model_count": len(JIMENG_DEFAULT_IMAGE_MODELS) + len(JIMENG_DEFAULT_VIDEO_MODELS),
            "image_models": JIMENG_DEFAULT_IMAGE_MODELS,
            "chat_models": [],
            "video_models": JIMENG_DEFAULT_VIDEO_MODELS,
            "all": [*JIMENG_DEFAULT_IMAGE_MODELS, *JIMENG_DEFAULT_VIDEO_MODELS],
            "raw": safe_cli_public_raw(status.get("raw")),
        }
    if protocol == "runninghub":
        provider = {"id": "runninghub", "name": "RunningHub", "base_url": (payload.base_url or RUNNINGHUB_DEFAULT_BASE_URL).strip().rstrip("/"), "protocol": "runninghub", "api_key": api_key_from_payload(payload, protocol)}
        payload_models = await runninghub_models_payload(provider)
        return {
            "ok": True,
            "status": 200,
            "message": "RunningHub OpenAPI 可用，已拉取官方直连模型注册表。",
            "model_count": payload_models["total"],
            "image_models": payload_models["image_models"],
            "chat_models": payload_models["chat_models"],
            "video_models": payload_models["video_models"],
            "all": payload_models["all"],
            "protocol": "runninghub",
            "raw": safe_cli_public_raw(payload_models.get("raw")),
        }
    base_url = (payload.base_url or "").strip().rstrip("/")
    if not base_url:
        raise HTTPException(status_code=400, detail="请先填写请求地址")
    if not re.match(r"^https?://", base_url):
        raise HTTPException(status_code=400, detail="请求地址必须以 http:// 或 https:// 开头")
    api_key = api_key_from_payload(payload, protocol)
    if not api_key:
        key_name = "方舟 API Key" if protocol == "volcengine" else "API Key"
        raise HTTPException(status_code=400, detail=f"请先填写或保存 {key_name}")
    url = upstream_models_url(base_url, protocol)
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(url, headers=upstream_model_headers(api_key, protocol))
            if resp.status_code in (301, 302, 303, 307, 308):
                endpoint_label = "/v1beta/models" if protocol == "gemini" else "/api/v3/models" if protocol == "volcengine" else "/openapi/v2/models" if protocol == "runninghub" else "/v1/models"
                return {"ok": False, "status": resp.status_code, "message": f"上游 {endpoint_label} 发生跳转，请填写 API Base URL，不要填写网页登录地址"}
            if looks_like_html_response(resp.text):
                endpoint_label = "/v1beta/models" if protocol == "gemini" else "/api/v3/models" if protocol == "volcengine" else "/openapi/v2/models" if protocol == "runninghub" else "/v1/models"
                return {"ok": False, "status": resp.status_code, "message": f"上游 {endpoint_label} 返回网页 HTML，请检查请求地址是否为 API Base URL"}
            if resp.status_code >= 400:
                if protocol == "volcengine":
                    detected, probe = await probe_volcengine_auto_detect(client, base_url, api_key)
                    if detected:
                        message = f"{probe.get('message') or '方舟任务接口可达'}；但 /api/v3/models 不可用。请按实际方舟控制台模型名称手动填写视频模型。"
                        return volcengine_default_model_payload(status=probe.get("status") or resp.status_code, message=message, raw={"models_error": upstream_response_error_summary(resp), **(probe.get("raw") or {})})
                elif protocol == "openai":
                    detected, probe = await probe_volcengine_auto_detect(client, base_url, api_key)
                    if detected:
                        message = f"{probe.get('message') or '检测到方舟/Ark 兼容入口'}；OpenAI /v1/models 不可用，已自动切换为方舟协议。请按实际方舟控制台模型名称手动填写视频模型。"
                        return volcengine_default_model_payload(status=probe.get("status") or resp.status_code, message=message, raw={"models_error": upstream_response_error_summary(resp), **(probe.get("raw") or {})})
                return {"ok": False, "status": resp.status_code, "message": upstream_response_error_summary(resp, "上游模型列表不可用")}
            try:
                data = resp.json() if resp.text else {}
            except ValueError:
                return {"ok": False, "status": resp.status_code, "message": "上游模型列表没有返回有效 JSON"}
            grouped, ids = parse_upstream_models(data, protocol)
            grouped = apply_locked_recommended_model_rules(base_url, grouped)
            if protocol == "volcengine" and not ids:
                detected, probe = await probe_volcengine_auto_detect(client, base_url, api_key)
                if detected:
                    return volcengine_default_model_payload(status=resp.status_code, raw=data)
            return {
                "ok": True,
                "status": resp.status_code,
                "model_count": len(ids),
                "image_models": grouped["image"],
                "chat_models": grouped["chat"],
                "video_models": grouped["video"],
                "audio_models": grouped.get("audio", []),
                "audio_generation_models": grouped.get("audioGeneration", []),
                "all": ids,
                "image_request_mode": detect_image_request_mode(base_url, ids) or normalize_image_request_mode(getattr(payload, "image_request_mode", "")),
            }
    except httpx.HTTPError as e:
        if protocol == "volcengine":
            try:
                async with httpx.AsyncClient(timeout=15) as client:
                    detected, probe = await probe_volcengine_auto_detect(client, base_url, api_key)
                    if detected:
                        message = f"{probe.get('message') or '方舟任务接口可达'}；但模型列表请求失败。请按实际方舟控制台模型名称手动填写视频模型。"
                        return volcengine_default_model_payload(status=probe.get("status") or 0, message=message, raw={"models_error": _safe_upstream_text(e, 300), **(probe.get("raw") or {})})
            except Exception:
                pass
        log_net_error("模型连接测试失败", e, url)
        return {"ok": False, "status": 0, "message": "请求上游模型列表失败，请检查地址和网络连接"}


async def probe_async_endpoint(payload, *, HTTPException, api_key_from_payload, bearer_auth_value, codex_status, detect_image_request_mode, gemini_cli_status, httpx, is_tudou_base_url, log_net_error, looks_like_html_response, normalize_image_request_mode, probe_error_payload, probe_openai_compat_bearer_endpoint, probe_openai_models_endpoint, probe_volcengine_auto_detect, probe_volcengine_task_endpoint, protocol_from_payload, safe_cli_public_raw, safe_cli_public_text):
    """验证异步协议：用假 task_id 请求 GET /v1/tasks/{fake_id}。
    收到 400 Invalid task ID = 端点存在且 Key 有效；401/403 = Key 无效；404/连接失败 = 不支持异步端点。"""
    base_url = (payload.base_url or "").strip().rstrip("/")
    protocol = protocol_from_payload(payload)
    if protocol == "codex":
        status = await codex_status()
        return {
            "ok": bool(status.get("installed")),
            "protocol": "codex",
            "status_code": 200 if status.get("installed") else 0,
            "message": safe_cli_public_text(status.get("message") or "OpenAI Codex CLI 本机检测完成"),
            "raw": safe_cli_public_raw(status),
        }
    if protocol == "gemini-cli":
        status = await gemini_cli_status()
        return {
            "ok": bool(status.get("installed")),
            "protocol": "gemini-cli",
            "status_code": 200 if status.get("installed") else 0,
            "message": safe_cli_public_text(status.get("message") or "Antigravity CLI 本机检测完成"),
            "raw": safe_cli_public_raw(status),
        }
    if not base_url:
        raise HTTPException(status_code=400, detail="请先填写请求地址")
    api_key = api_key_from_payload(payload, protocol)
    if not api_key:
        raise HTTPException(status_code=400, detail="请先填写或保存 API Key")
    is_tudou_async = is_tudou_base_url(base_url)
    if protocol == "volcengine":
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                task_ok, task_probe = await probe_volcengine_task_endpoint(client, base_url, api_key)
                if task_ok:
                    return {
                        "ok": True,
                        "protocol": "volcengine",
                        "status_code": task_probe.get("status") or 200,
                        "message": "方舟/Ark 任务协议可用",
                        "raw": task_probe.get("raw"),
                    }
                compat_ok, compat_probe = await probe_openai_compat_bearer_endpoint(client, base_url, api_key)
                if compat_ok:
                    return {
                        "ok": True,
                        "protocol": "volcengine",
                        "status_code": compat_probe.get("status") or 200,
                        "message": "方舟/Ark Bearer 鉴权入口可用（OpenAI 兼容透传）",
                        "raw": {"task_probe": task_probe, "openai_compat_probe": compat_probe.get("raw")},
                    }
                return {
                    "ok": False,
                    "protocol": "volcengine",
                    "status_code": compat_probe.get("status") or task_probe.get("status") or 0,
                    "message": compat_probe.get("message") or task_probe.get("message") or "方舟/Ark 任务协议不可用",
                    "raw": {"task_probe": task_probe, "openai_compat_probe": compat_probe.get("raw")},
                }
        except httpx.HTTPError as e:
            log_net_error("方舟任务协议探测失败", e, base_url)
            raise HTTPException(status_code=502, detail="方舟任务协议探测失败，请检查地址和网络连接") from e
    tasks_base = base_url if base_url.endswith("/v1") else f"{base_url}/v1"
    probe_url = f"{tasks_base}/tasks/healthcheck_probe_do_not_submit"
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(probe_url, headers={"Authorization": bearer_auth_value(api_key), "Accept": "application/json"})
            try:
                body = resp.json()
            except Exception:
                body = resp.text[:500]
            sc = resp.status_code
            # 判断结果
            err_msg = ""
            if isinstance(body, dict):
                err = body.get("error") or {}
                if isinstance(err, dict):
                    err_msg = str(err.get("message") or "").lower()
                else:
                    err_msg = str(err).lower()
            # 400 + "invalid task id" → 端点存在，Key 有效
            if is_tudou_async and sc == 400:
                # 土豆对不存在的 task_id 可能使用不同的 400 错误字段；只要不是
                # 401/403，400 已证明请求命中了异步任务端点且认证通过。
                return {
                    "ok": True,
                    "protocol": "openai",
                    "image_request_mode": "tudou-async",
                    "status_code": sc,
                    "message": "土豆 GPT-Image-2 异步任务端点可用，API Key 已通过认证",
                    "raw": probe_error_payload(resp, "异步任务端点已响应"),
                }
            if sc == 400 and "invalid task id" in err_msg:
                return {"ok": True, "protocol": "apimart", "status_code": sc, "message": "APIMart 异步任务端点可用，API Key 已通过认证", "raw": probe_error_payload(resp, "异步任务端点已响应")}

            async_probe = {"status": sc, "message": "", "raw": probe_error_payload(resp, "异步任务端点探测失败")}
            if sc in (301, 302, 303, 307, 308):
                async_probe["message"] = "/v1/tasks/ 发生跳转"
            elif looks_like_html_response(resp.text):
                async_probe["message"] = "/v1/tasks/ 返回网页 HTML"
            elif sc in (401, 403):
                async_probe["message"] = "/v1/tasks/ 返回鉴权失败"
            elif sc == 404:
                async_probe["message"] = "平台不支持 /v1/tasks/ 端点，可能不是 APIMart 异步协议"
            elif 400 <= sc < 500:
                async_probe["message"] = f"/v1/tasks/ 返回 {sc}"
            elif sc < 300:
                async_probe["message"] = f"/v1/tasks/ 返回 {sc}（意外成功）"
            else:
                async_probe["message"] = f"/v1/tasks/ 服务端错误 {sc}"

            if is_tudou_async:
                return {
                    "ok": sc < 400,
                    "protocol": "openai",
                    "image_request_mode": "tudou-async" if sc < 400 else "openai",
                    "status_code": sc,
                    "message": async_probe["message"] or "土豆 GPT-Image-2 异步任务端点验证完成",
                    "raw": async_probe["raw"],
                }

            if protocol == "apimart":
                return {"ok": False, "protocol": "apimart", "status_code": sc, "message": async_probe["message"], "raw": async_probe["raw"]}

            openai_ok, openai_probe = await probe_openai_models_endpoint(client, base_url, api_key)
            if not openai_ok and protocol == "openai":
                # /v1/models 不可用，先确认是不是“没实现 models 接口的 OpenAI 兼容站”：探一下 /v1/chat/completions。
                # 可达就判定为 OpenAI 兼容（很多网关不暴露 /v1/models），避免被下面的方舟探测（404 也算可达）误判成方舟。
                compat_ok, compat_probe = await probe_openai_compat_bearer_endpoint(client, base_url, api_key)
                # 仅当 /v1/chat/completions 确实存在（返回 2xx 或我们发空 messages 触发的 400 等，而非 404 路径不存在）
                # 才判为 OpenAI 兼容；404 说明该路径不存在，留给后面的方舟探测。
                if compat_ok and (compat_probe.get("status") or 0) != 404:
                    return {
                        "ok": True,
                        "protocol": "openai",
                        "status_code": compat_probe.get("status") or openai_probe.get("status") or sc,
                        "message": "OpenAI 兼容入口可达（该站未提供 /v1/models，模型请手动填写）",
                        "raw": {"async_probe": async_probe, "openai_probe": openai_probe.get("raw"), "openai_compat_probe": compat_probe.get("raw")},
                        "model_count": 0,
                        "image_models": [],
                        "chat_models": [],
                        "video_models": [],
                        "all": [],
                    }
                detected, volc_probe = await probe_volcengine_auto_detect(client, base_url, api_key)
                if detected:
                    return {
                        "ok": True,
                        "protocol": "volcengine",
                        "status_code": volc_probe.get("status") or openai_probe.get("status") or sc,
                        "message": f"{volc_probe.get('message') or '检测到方舟/Ark 兼容入口'}，已自动切换为方舟/Ark 任务协议",
                        "raw": {"async_probe": async_probe, "openai_probe": openai_probe.get("raw"), **(volc_probe.get("raw") or {})},
                    }
            return {
                "ok": openai_ok,
                "protocol": "openai",
                "status_code": openai_probe.get("status") or sc,
                "message": openai_probe.get("message") or "OpenAI 兼容验证完成",
                "raw": {"async_probe": async_probe, "openai_probe": openai_probe.get("raw")},
                "model_count": openai_probe.get("model_count") or 0,
                "image_models": openai_probe.get("image_models") or [],
                "chat_models": openai_probe.get("chat_models") or [],
                "video_models": openai_probe.get("video_models") or [],
                "all": openai_probe.get("all") or [],
                "image_request_mode": detect_image_request_mode(base_url, openai_probe.get("all") or []) or normalize_image_request_mode(getattr(payload, "image_request_mode", "")),
            }
    except httpx.HTTPError as e:
        log_net_error("异步任务协议探测失败", e, probe_url)
        raise HTTPException(status_code=502, detail="异步任务协议探测失败，请检查地址和网络连接") from e


async def fetch_models_from_upstream(base_url, api_key, protocol='openai', image_request_mode='openai', *, HTTPException, JIMENG_DEFAULT_IMAGE_MODELS, JIMENG_DEFAULT_VIDEO_MODELS, RUNNINGHUB_DEFAULT_BASE_URL, SUPPORTED_PROVIDER_PROTOCOLS, _safe_upstream_text, apply_locked_recommended_model_rules, detect_image_request_mode, fetch_codex_models_payload, gemini_cli_models_payload, gemini_cli_status, httpx, log_net_error, looks_like_html_response, normalize_image_request_mode, parse_upstream_models, probe_volcengine_auto_detect, runninghub_models_payload, upstream_model_headers, upstream_models_url, upstream_response_error_summary, volcengine_default_model_payload, volcengine_provider_api_key):
    """从上游模型列表端点拉取模型，并按名称做轻量分类。"""
    protocol = protocol if protocol in SUPPORTED_PROVIDER_PROTOCOLS else "openai"
    if protocol == "codex":
        return await fetch_codex_models_payload()
    if protocol == "gemini-cli":
        status = await gemini_cli_status()
        payload = gemini_cli_models_payload(raw={"status": status})
        payload["message"] = status.get("message") or payload["message"]
        return payload
    if protocol == "jimeng":
        return {
            "total": len(JIMENG_DEFAULT_IMAGE_MODELS) + len(JIMENG_DEFAULT_VIDEO_MODELS),
            "image_models": JIMENG_DEFAULT_IMAGE_MODELS,
            "chat_models": [],
            "video_models": JIMENG_DEFAULT_VIDEO_MODELS,
            "all": [*JIMENG_DEFAULT_IMAGE_MODELS, *JIMENG_DEFAULT_VIDEO_MODELS],
        }
    if protocol == "runninghub":
        provider = {"id": "runninghub", "name": "RunningHub", "base_url": base_url or RUNNINGHUB_DEFAULT_BASE_URL, "protocol": "runninghub", "api_key": api_key}
        return await runninghub_models_payload(provider)
    base_url = (base_url or "").strip().rstrip("/")
    if not base_url:
        raise HTTPException(status_code=400, detail="请先填写请求地址")
    if not re.match(r"^https?://", base_url):
        raise HTTPException(status_code=400, detail="请求地址必须以 http:// 或 https:// 开头")
    api_key = volcengine_provider_api_key(api_key) if protocol == "volcengine" else (api_key or "").strip()
    if not api_key:
        key_name = "方舟 API Key" if protocol == "volcengine" else "API Key"
        raise HTTPException(status_code=400, detail=f"请先填写或保存 {key_name}")
    url = upstream_models_url(base_url, protocol)
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url, headers=upstream_model_headers(api_key, protocol))
            endpoint_label = "/v1beta/models" if protocol == "gemini" else "/api/v3/models" if protocol == "volcengine" else "/openapi/v2/models" if protocol == "runninghub" else "/v1/models"
            if resp.status_code in (301, 302, 303, 307, 308):
                raise HTTPException(status_code=400, detail=f"上游 {endpoint_label} 发生跳转，请填写 API Base URL，不要填写网页登录地址")
            if looks_like_html_response(resp.text):
                raise HTTPException(status_code=400, detail=f"上游 {endpoint_label} 返回网页 HTML，请检查请求地址是否为 API Base URL")
            if resp.status_code >= 400:
                if protocol == "volcengine":
                    detected, probe = await probe_volcengine_auto_detect(client, base_url, api_key)
                    if detected:
                        payload = volcengine_default_model_payload(
                            status=probe.get("status") or resp.status_code,
                            message=f"{probe.get('message') or '方舟任务接口可达'}；但 /api/v3/models 不可用。请按实际方舟控制台模型名称手动填写视频模型。",
                            raw={"models_error": upstream_response_error_summary(resp), **(probe.get("raw") or {})},
                        )
                        return {
                            "total": payload["model_count"],
                            "protocol": payload["protocol"],
                            "image_models": payload["image_models"],
                            "chat_models": payload["chat_models"],
                            "video_models": payload["video_models"],
                            "all": payload["all"],
                            "message": payload["message"],
                            "raw": payload["raw"],
                        }
                elif protocol == "openai":
                    detected, probe = await probe_volcengine_auto_detect(client, base_url, api_key)
                    if detected:
                        payload = volcengine_default_model_payload(
                            status=probe.get("status") or resp.status_code,
                            message=f"{probe.get('message') or '检测到方舟/Ark 兼容入口'}；OpenAI /v1/models 不可用，已自动切换为方舟协议。请按实际方舟控制台模型名称手动填写视频模型。",
                            raw={"models_error": upstream_response_error_summary(resp), **(probe.get("raw") or {})},
                        )
                        return {
                            "total": payload["model_count"],
                            "protocol": payload["protocol"],
                            "image_models": payload["image_models"],
                            "chat_models": payload["chat_models"],
                            "video_models": payload["video_models"],
                            "all": payload["all"],
                            "message": payload["message"],
                            "raw": payload["raw"],
                        }
                raise HTTPException(status_code=resp.status_code, detail=f"上游 {endpoint_label} 失败：{upstream_response_error_summary(resp)}")
            try:
                raw = resp.json()
            except ValueError as exc:
                raise HTTPException(status_code=502, detail=f"上游 {endpoint_label} 返回的模型列表不是有效 JSON") from exc
    except httpx.HTTPError as e:
        if protocol == "volcengine":
            try:
                async with httpx.AsyncClient(timeout=15) as client:
                    detected, probe = await probe_volcengine_auto_detect(client, base_url, api_key)
                    if detected:
                        payload = volcengine_default_model_payload(
                            status=probe.get("status") or 0,
                            message=f"{probe.get('message') or '方舟任务接口可达'}；但模型列表请求失败。请按实际方舟控制台模型名称手动填写视频模型。",
                            raw={"models_error": _safe_upstream_text(e, 300), **(probe.get("raw") or {})},
                        )
                        return {
                            "total": payload["model_count"],
                            "protocol": payload["protocol"],
                            "image_models": payload["image_models"],
                            "chat_models": payload["chat_models"],
                            "video_models": payload["video_models"],
                            "all": payload["all"],
                            "message": payload["message"],
                            "raw": payload["raw"],
                        }
            except Exception:
                pass
        log_net_error("拉取上游模型列表失败", e, url)
        raise HTTPException(status_code=502, detail="请求上游模型列表失败，请检查地址和网络连接") from e
    grouped, ids = parse_upstream_models(raw, protocol)
    grouped = apply_locked_recommended_model_rules(base_url, grouped)
    if protocol == "volcengine" and not ids:
        payload = volcengine_default_model_payload(raw=raw)
        return {
            "total": payload["model_count"],
            "image_models": payload["image_models"],
            "chat_models": payload["chat_models"],
            "video_models": payload["video_models"],
            "all": payload["all"],
            "message": payload["message"],
            "raw": payload["raw"],
        }
    return {
        "total": len(ids),
        "image_models": grouped["image"],
        "chat_models": grouped["chat"],
        "video_models": grouped["video"],
        "audio_models": grouped.get("audio", []),
        "audio_generation_models": grouped.get("audioGeneration", []),
        "all": ids,
        "image_request_mode": detect_image_request_mode(base_url, ids) or normalize_image_request_mode(image_request_mode),
    }


async def fetch_upstream_models_from_payload(payload, *, api_key_from_payload, fetch_models_from_upstream, protocol_from_payload):
    """按页面当前表单值拉取模型，支持新增平台未保存时直接使用临时 Base URL / Key。"""
    protocol = protocol_from_payload(payload)
    api_key = api_key_from_payload(payload, protocol)
    return await fetch_models_from_upstream(payload.base_url, api_key, protocol, payload.image_request_mode)


async def fetch_upstream_models(provider_id, *, HTTPException, fetch_models_from_upstream, get_api_provider_exact, is_codex_provider, is_gemini_cli_provider, provider_env_key_value, provider_protocol, runninghub_wallet_key_env):
    """从已保存的上游 OpenAI 兼容接口拉取 /v1/models 列表，按名称智能分类为 image/chat/video。"""
    provider = get_api_provider_exact(provider_id)
    if is_codex_provider(provider):
        return await fetch_models_from_upstream("", "", "codex", provider.get("image_request_mode") or "openai")
    if is_gemini_cli_provider(provider):
        return await fetch_models_from_upstream("", "", "gemini-cli", provider.get("image_request_mode") or "openai")
    api_key = os.getenv(runninghub_wallet_key_env(), "") if provider["id"] == "runninghub" else ""
    if not api_key:
        api_key = provider_env_key_value(provider["id"])
    if not api_key:
        raise HTTPException(status_code=400, detail=f"{provider.get('name') or provider_id} 未配置 API Key")
    return await fetch_models_from_upstream(provider.get("base_url") or "", api_key, provider_protocol(provider), provider.get("image_request_mode") or "openai")


