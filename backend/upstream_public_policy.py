"""上游与CLI公开结果清洗、友好错误和受控诊断策略。

文本规则、公开字段约束和诊断回调由应用注入；导入不读取配置。
包含**extra的入口使用仅限位置的依赖参数，以保留任意元数据字段。
"""
import re
import json

def comfy_prompt_error_message(status_code, error_body, *, safe_cli_public_text):
    """Turn ComfyUI's validation payload into a useful canvas error."""
    raw_fallback = str(error_body or "").strip()
    try:
        payload = json.loads(raw_fallback)
    except (TypeError, ValueError):
        fallback = safe_cli_public_text(raw_fallback, 500)
        return f"ComfyUI 请求失败（HTTP {status_code}）：{fallback or '未知错误'}"

    parts = []
    error = payload.get("error") if isinstance(payload, dict) else None
    if isinstance(error, dict):
        message = safe_cli_public_text(error.get("message"), 300)
        details = safe_cli_public_text(error.get("details"), 300)
        if message:
            parts.append(message)
        if details and details not in parts:
            parts.append(details)

    node_errors = payload.get("node_errors") if isinstance(payload, dict) else None
    if isinstance(node_errors, dict):
        for node_id, node_error in list(node_errors.items())[:3]:
            if not isinstance(node_error, dict):
                continue
            class_type = safe_cli_public_text(node_error.get("class_type"), 120)
            messages = []
            for item in node_error.get("errors") or []:
                if not isinstance(item, dict):
                    continue
                text = safe_cli_public_text(item.get("message") or item.get("details"), 300)
                if text and text not in messages:
                    messages.append(text)
            if messages:
                label = f"节点 {node_id}" + (f"（{class_type}）" if class_type else "")
                parts.append(f"{label}：{'；'.join(messages[:2])}")

    detail = "；".join(part for part in parts if part).strip()
    fallback = safe_cli_public_text(raw_fallback, 500)
    return f"ComfyUI 拒绝了工作流（HTTP {status_code}）：{safe_cli_public_text(detail, 700) or fallback or '工作流校验失败'}"


def friendly_image_error_detail(text, size='', model='', *, gpt_image_2_size_error_message, gpt_image_2_size_exceeds_supported, is_gpt_image_2_model):
    text = str(text or "")
    lower_text = text.lower()
    if is_gpt_image_2_model(model) and gpt_image_2_size_exceeds_supported(size):
        return gpt_image_2_size_error_message(size)
    mentions_size = any(token in lower_text for token in ["size", "resolution", "dimension"])
    is_gpt_size_error = is_gpt_image_2_model(model) and mentions_size and (
        "invalid" in lower_text
        or "unsupported" in lower_text
        or "not supported" in lower_text
        or "exceed" in lower_text
        or "must be one of" in lower_text
    )
    m = re.search(r"longest edge must be less than or equal to (\d+)", text)
    if m and is_gpt_image_2_model(model):
        limit = m.group(1)
        return f"GPT-Image-2 不支持当前尺寸 {size or '未指定'}：最长边超过 {limit}px。如果需要更高分辨率，请切换到 nano-banana；继续使用 GPT 时请调低分辨率。"
    if m:
        limit = m.group(1)
        return f"该模型不支持当前分辨率：最长边超过 {limit}px。请把图片分辨率调低（例如换到 2K 或更小），或更换支持高分辨率的模型。"
    if "image size must be at least" in lower_text:
        pixel_match = re.search(r"at least (\d+) pixels", lower_text)
        pixels = pixel_match.group(1) if pixel_match else "3686400"
        return f"该模型要求更高分辨率，当前尺寸 {size or '过小'} 不满足最低像素要求（至少 {pixels} 像素）。火山 Seedream 5.0 建议从 2K 起步。"
    if is_gpt_size_error or (("invalid size" in lower_text or "invalid_value" in lower_text) and is_gpt_image_2_model(model)):
        return gpt_image_2_size_error_message(size)
    if "invalid size" in lower_text or "invalid_value" in lower_text:
        return f"该模型不支持当前尺寸：{size or '未指定'}。请尝试更换分辨率或模型。"
    if "inputtextsensitivecontentdetected" in lower_text or "policyviolation" in lower_text or "copyright restrictions" in lower_text:
        return "上游内容安全拦截了这段提示词，原因偏向版权/敏感内容限制。请改写提示词，避免直接出现具体 IP、角色名、品牌名、影视/动漫作品名，改成风格特征描述再试。"
    if "rejected by the safety system" in lower_text or "image_generation_user_error" in lower_text or "safety system" in lower_text or "content_policy_violation" in lower_text or "content policy" in lower_text:
        return "上游（Azure/OpenAI 系）内容安全系统拒绝了本次生图请求。可能是提示词或参考图触发了内容审核。请改写提示词、避免敏感/暴力/成人/名人/版权角色等描述；若使用了人物参考图，可换一张图再试。这是上游平台的审核策略，并非本系统报错。"
    if "rate limit" in lower_text or "429" in lower_text:
        return "请求过于频繁，已被上游限流，请稍后再试。"
    if "unauthorized" in lower_text or "401" in lower_text:
        return "API Key 无效或已过期，请到「API 设置」检查 Key。"
    if "model_not_found" in lower_text or "channel not found" in lower_text:
        return f"上游平台找不到模型「{model}」可用通道。可能该模型未在此账号开通，请换一个已开通的模型。"
    return ""


def parse_error_payload_text(text):
    body = str(text or "").strip()
    if not body:
        return {}
    try:
        parsed = json.loads(body)
    except Exception:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def friendly_chat_error_detail(text, model='', provider=None, *, is_volcengine_provider, parse_error_payload_text):
    raw_text = str(text or "")
    lower_text = raw_text.lower()
    payload = parse_error_payload_text(raw_text)
    error = payload.get("error") if isinstance(payload.get("error"), dict) else {}
    code = str(error.get("code") or payload.get("code") or "").strip()
    message = str(error.get("message") or payload.get("message") or "").strip()
    code_lc = code.lower()
    message_lc = message.lower()
    model_name = str(model or "").strip()

    if is_volcengine_provider(provider):
        if code_lc in {"invalidendpointormodel.notfound", "invalidendpointormodel.modelidaccessdisabled"}:
            provider_name = provider.get("name") or provider.get("id") or "火山方舟"
            return (
                f"{provider_name} 当前不接受模型名「{model_name or '未指定'}」直接调用聊天接口，"
                f"请在火山方舟控制台创建并使用推理接入点 ID（形如 `ep-...`）作为聊天模型。\n\n"
                f"补充说明：`/api/v3/models` 能拉到公开模型列表，但你的账号未必能直接用这些模型名调用 `/chat/completions`；"
                f"很多账号只允许传自己已开通的 `ep-...` 接入点。"
            )
        if "does not exist or you do not have access to it" in message_lc:
            return (
                f"火山方舟找不到或无权访问聊天模型「{model_name or '未指定'}」。"
                f"如果你现在填的是模型名，请改成已开通的推理接入点 ID（`ep-...`）；"
                f"如果已经是 `ep-...`，请检查这个接入点是否绑定了聊天模型、区域是否正确、以及账号是否有调用权限。"
            )
    if "unauthorized" in lower_text or "401" in lower_text:
        return "API Key 无效或已过期，请到「API 设置」检查 Key。"
    if "rate limit" in lower_text or "429" in lower_text:
        return "请求过于频繁，已被上游限流，请稍后再试。"
    return ""


def safe_upstream_http_detail(response, label='上游接口错误', friendly='', *, _safe_upstream_text, upstream_response_error_summary):
    """失败响应只向页面返回脱敏摘要，不回显原始响应体。"""
    reason = _safe_upstream_text(friendly, 1000) if friendly else upstream_response_error_summary(response, fallback="", limit=300)
    heading = f"{label}（{response.status_code}）"
    return f"{heading}：{reason}" if reason else heading


def _safe_upstream_text(value, limit=600, *, _UPSTREAM_SECRET_JSON_RE, redact_log_text):
    """把上游错误中的文本做 URL/凭据脱敏并限制长度。"""
    if value is None:
        return ""
    if isinstance(value, (dict, list, tuple)):
        try:
            text = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
        except Exception:
            text = str(value)
    else:
        text = str(value)
    text = _UPSTREAM_SECRET_JSON_RE.sub(r"\1<redacted>", text)
    text = redact_log_text(text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit]


def safe_cli_public_text(value, limit, *, CLI_PUBLIC_TEXT_LIMIT, _CLI_LOCAL_PATH_RE, _UPSTREAM_SECRET_JSON_RE, redact_log_text):
    """限制 CLI 管理输出，移除常见凭据、查询参数和本地绝对路径。"""
    try:
        text = str(value or "")
    except Exception:
        text = ""
    # JSON 形式的 token 先处理，再处理普通 key=value/Bearer 形式。
    text = _UPSTREAM_SECRET_JSON_RE.sub(r"\1<redacted>", text)
    text = redact_log_text(text)

    def replace_path(match):
        raw = match.group(0).rstrip(".,;:)]}")
        basename = re.split(r"[\\/]", raw)[-1] or "file"
        return f"<local-path>/{basename}"

    text = _CLI_LOCAL_PATH_RE.sub(replace_path, text)
    # 控制字符（换行、回车、Tab 除外）可能伪造终端输出或破坏页面文本。
    text = "".join(ch if ch in "\r\n\t" or ord(ch) >= 0x20 else "�" for ch in text)
    text = text.strip()
    try:
        max_length = max(0, int(limit))
    except Exception:
        max_length = CLI_PUBLIC_TEXT_LIMIT
    marker = "\n[CLI 输出已截断]"
    if len(text) > max_length:
        if max_length <= len(marker):
            return text[:max_length]
        return text[: max_length - len(marker)] + marker
    return text


def public_error_detail(value, fallback='操作失败', limit=800, *, safe_cli_public_text):
    """把内部异常收敛为可操作的短提示，避免回显路径和凭据。"""
    detail = getattr(value, "detail", value)
    if isinstance(detail, (dict, list, tuple)):
        try:
            detail = json.dumps(detail, ensure_ascii=False, separators=(",", ":"))
        except Exception:
            detail = ""
    # JSON 序列化会把 Windows 反斜杠加倍，先还原转义再识别绝对路径。
    normalized = str(detail or "").replace("\\\\", "\\")
    text = safe_cli_public_text(normalized, limit)
    return text or fallback


def runninghub_workflow_json_error(exc):
    """返回不包含 JSON 异常正文的工作流解析提示。"""
    line = getattr(exc, "lineno", None)
    column = getattr(exc, "colno", None)
    if isinstance(line, int) and isinstance(column, int) and line > 0 and column > 0:
        return f"RunningHub 工作流 JSON 格式错误（第 {line} 行，第 {column} 列），请检查工作流内容后重试。"
    return "RunningHub 工作流 JSON 格式错误，请检查工作流内容后重试。"


def safe_cli_executable_name(value, *, safe_cli_public_text):
    """状态接口保留可识别的可执行文件名，不回传用户目录。"""
    text = str(value or "").strip().strip('"').strip("'")
    if not text:
        return ""
    name = re.split(r"[\\/]", text.rstrip("\\/"))[-1]
    return safe_cli_public_text(name, 160)


def safe_cli_public_raw(value, *, max_depth=5, max_items=64, max_chars, CLI_PUBLIC_RAW_LIMIT, _CLI_SECRET_KEY_RE, safe_cli_public_text):
    """保留管理界面需要的 JSON 形状，同时限制深度/数量并隐藏敏感字段。"""
    budget = [max(1000, int(max_chars or CLI_PUBLIC_RAW_LIMIT))]

    def visit(item, depth=0):
        if depth > max_depth or budget[0] <= 0:
            return "[已省略]"
        if isinstance(item, dict):
            result = {}
            for key, child in list(item.items())[:max_items]:
                key_text = safe_cli_public_text(key, 120)
                key_norm = re.sub(r"[^a-z0-9_-]+", "", key_text.lower())
                if _CLI_SECRET_KEY_RE.search(key_norm):
                    continue
                result[key_text] = visit(child, depth + 1)
                budget[0] -= len(key_text) + 8
                if budget[0] <= 0:
                    break
            if len(item) > max_items or budget[0] <= 0:
                result["_truncated"] = True
            return result
        if isinstance(item, (list, tuple)):
            values = [visit(child, depth + 1) for child in list(item)[:max_items]]
            if len(item) > max_items:
                values.append("[已省略]")
            return values
        if isinstance(item, str):
            text = safe_cli_public_text(item, min(2000, max(200, budget[0])))
            budget[0] -= len(text)
            return text
        if isinstance(item, (int, float, bool)) or item is None:
            budget[0] -= 16
            return item
        return safe_cli_public_text(item, 400)

    return visit(value)


def public_jimeng_credit(value, *, max_items=32, _CLI_SECRET_KEY_RE, _JIMENG_CREDIT_KEY_RE, _JIMENG_NUMBER_RE, math, safe_cli_public_text):
    """只公开即梦余额/额度相关的有限数值字段。

    即梦 CLI 的 ``user_credit`` 回包可能同时包含令牌、调试文本和本地
    路径。管理页只需要显示额度，因此这里递归提取常见额度键的数字值，
    不把原始对象、字符串或其它字段带回 API 响应。
    """

    result = {}
    seen = set()

    def number(value):
        if isinstance(value, bool):
            return None
        if isinstance(value, (int, float)):
            if isinstance(value, float) and not math.isfinite(value):
                return None
            return value if abs(float(value)) <= 1_000_000_000_000 else None
        if isinstance(value, str):
            text = value.strip()
            if not _JIMENG_NUMBER_RE.fullmatch(text):
                return None
            try:
                parsed = float(text)
            except ValueError:
                return None
            if not math.isfinite(parsed) or abs(parsed) > 1_000_000_000_000:
                return None
            return int(parsed) if parsed.is_integer() else parsed
        return None

    def visit(item, depth=0):
        if depth > 5 or len(result) >= max_items:
            return
        if isinstance(item, dict):
            for key, child in item.items():
                key_text = safe_cli_public_text(key, 80)
                key_norm = re.sub(r"[^a-z0-9_\u4e00-\u9fff]+", "", key_text.lower())
                if _CLI_SECRET_KEY_RE.search(key_norm):
                    continue
                if _JIMENG_CREDIT_KEY_RE.search(key_norm):
                    parsed = number(child)
                    if parsed is not None and key_text not in seen:
                        seen.add(key_text)
                        result[key_text] = parsed
                        if len(result) >= max_items:
                            return
                if isinstance(child, (dict, list)):
                    visit(child, depth + 1)
        elif isinstance(item, list):
            for child in item[:max_items]:
                visit(child, depth + 1)

    visit(value)
    return result


def upstream_error_summary(raw=None, fallback='', limit=600, *, _UPSTREAM_CODE_KEYS, _UPSTREAM_ERROR_KEYS, _safe_upstream_text, parse_error_payload_text):
    """从供应商回包提取安全的错误摘要，不返回完整 raw JSON。"""
    if raw is None:
        return _safe_upstream_text(fallback, limit)
    value = raw
    if isinstance(value, str):
        parsed = parse_error_payload_text(value)
        value = parsed if parsed else value
    messages = []
    metadata = []

    def add_message(item):
        text = _safe_upstream_text(item, limit)
        if text and text not in messages:
            messages.append(text)

    def visit(item, depth=0):
        if depth > 5:
            return
        if isinstance(item, dict):
            for key in _UPSTREAM_CODE_KEYS:
                if key in item and item.get(key) not in (None, ""):
                    text = _safe_upstream_text(item.get(key), 80)
                    if text and text not in metadata:
                        metadata.append(text)
            for key in _UPSTREAM_ERROR_KEYS:
                if key not in item or item.get(key) in (None, ""):
                    continue
                candidate = item.get(key)
                if isinstance(candidate, (str, int, float, bool)):
                    add_message(candidate)
                elif isinstance(candidate, (dict, list)):
                    visit(candidate, depth + 1)
            # 只继续检查常见包裹层，避免把 data/raw/调试字段整体序列化。
            for key in ("data", "result", "response", "payload", "body"):
                nested = item.get(key)
                if isinstance(nested, (dict, list)):
                    visit(nested, depth + 1)
            return
        if isinstance(item, list):
            for child in item[:5]:
                visit(child, depth + 1)
            return
        add_message(item)

    visit(value)
    parts = []
    if metadata:
        parts.append("code=" + "/".join(metadata[:2]))
    if messages:
        parts.append("；".join(messages[:3]))
    if not parts:
        parts.append(_safe_upstream_text(fallback, limit))
    return _safe_upstream_text("；".join(item for item in parts if item), limit)


def upstream_response_error_summary(response, fallback='上游请求失败', limit=300, *, looks_like_html_response, provider_error_summary):
    """只从失败回包取可读原因；HTML 和调试字段不进入日志或页面。"""
    body = response.text or ""
    if looks_like_html_response(body):
        return fallback
    try:
        raw = response.json() if body else None
    except ValueError:
        raw = body
    return provider_error_summary(raw, fallback=fallback, limit=limit)


def provider_error_summary(raw=None, fallback='', limit=300, *, upstream_error_summary):
    """供应商错误可能把 HTML 塞在 JSON message 内，只返回可读短原因。"""
    summary = upstream_error_summary(raw, fallback=fallback, limit=limit)
    if re.search(r"<!doctype|</?(?!redacted\b)[a-z][^>]*>", summary, re.I):
        return fallback
    return summary or fallback


def probe_error_payload(response, fallback='上游探测失败', *, upstream_response_error_summary):
    """保留探测响应的 raw 字段形状，但失败时只返回安全诊断。"""
    return {"status": response.status_code, "error_summary": upstream_response_error_summary(response, fallback)}


def runninghub_error_detail(_callbacks, /, message, raw=None, **extra):
    _safe_upstream_text = _callbacks['_safe_upstream_text']
    redact_url_for_log = _callbacks['redact_url_for_log']
    upstream_error_summary = _callbacks['upstream_error_summary']
    detail = {"message": _safe_upstream_text(message) or "RunningHub 请求失败"}
    for key, value in extra.items():
        if value in (None, ""):
            continue
        if key in {"endpoint", "url"}:
            detail[key] = redact_url_for_log(value)
        else:
            detail[key] = _safe_upstream_text(value, 240)
    if raw is not None:
        summary = upstream_error_summary(raw)
        if summary:
            detail["error_summary"] = summary
    return detail


def log_runninghub_error(_callbacks, /, stage, raw=None, **extra):
    redact_log_text = _callbacks['redact_log_text']
    upstream_error_summary = _callbacks['upstream_error_summary']
    write_diagnostic = _callbacks['write_diagnostic']
    try:
        payload = {"stage": stage, **{k: v for k, v in extra.items() if v not in (None, "")}}
        if raw is not None:
            payload["error_summary"] = upstream_error_summary(raw)
        encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        message = f"RunningHub error: {redact_log_text(encoded)[:1200]}"
        write_diagnostic(message)
    except Exception:
        message = f"RunningHub error: {stage}"
        write_diagnostic(message)


def runninghub_fail_reason(raw, *, _safe_upstream_text, upstream_error_summary):
    data = raw.get("data") if isinstance(raw, dict) else None
    values = []
    if isinstance(data, dict):
        values.extend([data.get("failedReason"), data.get("failReason"), data.get("message"), data.get("error"), data.get("errorMessage")])
    if isinstance(raw, dict):
        values.extend([raw.get("msg"), raw.get("message"), raw.get("error"), raw.get("errorMessage")])
    for value in values:
        if not value:
            continue
        reason = upstream_error_summary(value)
        if reason:
            return reason
    if isinstance(raw, dict) and raw.get("errorCode"):
        return f"RunningHub errorCode={_safe_upstream_text(raw.get('errorCode'))}"
    return ""


