"""聊天回复、图片工具路由及流式响应执行。

索引、文件、锁和供应商调用由应用显式注入，保留现有提交/清理顺序。
"""
import uuid
import re
import json

def latest_chat_image_refs(conversation, limit=1):
    refs = []
    for item in reversed(conversation.get("messages") or []):
        url = item.get("image_url") if isinstance(item, dict) else ""
        if url:
            refs.append({"url": url, "name": item.get("content") or "上一张图片", "role": "source"})
        if len(refs) >= limit:
            break
    return refs


def image_size_from_reference(ref, *, Image, output_file_from_url, write_diagnostic):
    path = output_file_from_url(ref)
    if not path:
        return ""
    try:
        with Image.open(path) as img:
            width, height = img.size
        if width > 0 and height > 0:
            return f"{width}x{height}"
    except Exception as exc:
        write_diagnostic(f"chat agent reference image size failed error={type(exc).__name__}")
    return ""


def chat_requested_image_count(message, *, CN_NUMERAL_MAP):
    text = str(message or "")
    match = re.search(r"(?<!\d)([1-4])\s*(?:张|幅|个|组|套)(?!\d)", text)
    if match:
        return max(1, min(4, int(match.group(1))))
    match = re.search(r"([一二两俩三四])\s*(?:张|幅|个|组|套)", text)
    if match:
        return max(1, min(4, CN_NUMERAL_MAP.get(match.group(1), 1)))
    return 1


def chat_split_parallel_prompts(prompt, count):
    text = str(prompt or "").strip()
    if count <= 1:
        return [text]
    noun_match = re.search(r"(.+?)(?:的)?(海报|头像|壁纸|插画|照片|图片|图像)\s*$", text)
    if not noun_match:
        return [text] * count
    prefix = noun_match.group(1).strip()
    suffix = noun_match.group(2)
    prefix = re.sub(r"(?:再)?(?:生成|画|绘制|制作|创建)\s*[1-4一二两俩三四]?\s*(?:张|幅|个|组|套)?", "", prefix).strip()
    prefix = re.sub(r"[,，、\s]+$", "", prefix).strip()
    if not prefix:
        return [text] * count
    candidates = [
        item.strip(" ，,、")
        for item in re.split(r"\s*(?:和|与|、|，|,|\+|＋)\s*", prefix)
        if item.strip(" ，,、")
    ]
    if len(candidates) < count:
        return [text] * count
    return [f"{item}的{suffix}" for item in candidates[:count]]


def pick_chat_image_provider(provider_id='', fallback_id='', *, get_api_provider, load_api_providers):
    providers = [p for p in load_api_providers() if p.get("enabled", True) and (p.get("image_models") or [])]
    for target in (provider_id, fallback_id):
        clean = str(target or "").strip().lower()
        if clean:
            matched = next((p for p in providers if p.get("id") == clean), None)
            if matched:
                return matched
    if providers:
        primary = next((p for p in providers if p.get("primary")), None)
        return primary or providers[0]
    return get_api_provider(provider_id or fallback_id or "comfly")


def heuristic_agent_decision(message, refs, has_previous_image, *, AGENT_EDIT_KEYWORDS, AGENT_IMAGE_KEYWORDS):
    text = str(message or "").strip().lower()
    has_image_word = any(key.lower() in text for key in AGENT_IMAGE_KEYWORDS)
    has_edit_word = any(key.lower() in text for key in AGENT_EDIT_KEYWORDS)
    if refs and (has_edit_word or has_image_word):
        return {"action": "edit_image", "prompt": message, "reply": ""}
    if has_previous_image and has_edit_word:
        return {"action": "edit_image", "prompt": message, "reply": ""}
    if has_image_word and not has_edit_word:
        return {"action": "generate_image", "prompt": message, "reply": ""}
    return {"action": "chat", "prompt": message, "reply": ""}


def parse_agent_decision(raw_text, message, refs, has_previous_image, *, AGENT_ACTIONS, AGENT_IMAGE_KEYWORDS, heuristic_agent_decision):
    text = str(raw_text or "").strip()
    data = None
    if text:
        match = re.search(r"\{[\s\S]*\}", text)
        candidate = match.group(0) if match else text
        try:
            data = json.loads(candidate)
        except Exception:
            data = None
    heuristic = heuristic_agent_decision(message, refs, has_previous_image)
    if not isinstance(data, dict):
        return heuristic
    action = str(data.get("action") or "").strip()
    if action not in AGENT_ACTIONS:
        action = heuristic["action"]
    prompt = str(data.get("prompt") or message).strip() or message
    reply = str(data.get("reply") or "").strip()
    if action == "edit_image" and not (refs or has_previous_image):
        action = "generate_image" if any(key.lower() in str(message).lower() for key in AGENT_IMAGE_KEYWORDS) else "chat"
    return {"action": action, "prompt": prompt, "reply": reply}


async def decide_chat_agent_action(payload, conversation, refs, *, AI_REQUEST_TIMEOUT, CODEX_DEFAULT_CHAT_MODELS, GEMINI_CLI_DEFAULT_CHAT_MODELS, MAX_HISTORY_MESSAGES, get_api_provider, heuristic_agent_decision, httpx, is_apimart_provider, is_codex_provider, is_gemini_cli_provider, latest_chat_image_refs, parse_agent_decision, resolve_chat_provider, selected_model, text_from_chat_response, upstream_message_from_record, write_diagnostic):
    has_previous_image = bool(latest_chat_image_refs(conversation, 1))
    fallback = heuristic_agent_decision(payload.message, refs, has_previous_image)
    provider_cfg = get_api_provider(payload.provider) if payload.provider not in ("modelscope",) else {}
    if is_codex_provider(provider_cfg):
        fallback["router_model"] = selected_model(payload.model, (provider_cfg.get("chat_models") or CODEX_DEFAULT_CHAT_MODELS)[0])
        return fallback
    if is_gemini_cli_provider(provider_cfg):
        fallback["router_model"] = selected_model(payload.model, (provider_cfg.get("chat_models") or GEMINI_CLI_DEFAULT_CHAT_MODELS)[0])
        return fallback
    chat_base, chat_hdrs, model = resolve_chat_provider(payload.provider, payload.model, payload.ms_model)
    history = conversation["messages"][-MAX_HISTORY_MESSAGES:]
    custom_system_prompt = str(getattr(payload, "system_prompt", "") or "").strip()
    system = (
        "你是图片创作聊天 Agent 的意图路由器。只返回 JSON，不要 Markdown。\n"
        "action 只能是 chat、generate_image、edit_image。\n"
        "chat: 普通问答或不需要调用图片工具。\n"
        "generate_image: 用户要求生成、绘制、创建新图片。\n"
        "edit_image: 用户要求修改参考图、上一张图、刚才生成的图，或上传了参考图并要求基于它变化。\n"
        "prompt 是交给生图/改图工具的完整中文提示词；普通聊天时也填用户原话。\n"
        "reply 是可选的短状态文本。"
    )
    upstream_messages = [{"role": "system", "content": system}]
    for item in history[-10:]:
        msg = upstream_message_from_record(item)
        if msg:
            upstream_messages.append(msg)
    upstream_messages.append({
        "role": "user",
        "content": (
            f"当前用户输入：{payload.message}\n"
            f"用户设置的系统提示词：{custom_system_prompt or '无'}\n"
            f"本次上传参考图数量：{len(refs)}\n"
            f"对话中是否已有上一张生成图：{'是' if has_previous_image else '否'}\n"
            "请返回 JSON，例如 {\"action\":\"generate_image\",\"prompt\":\"...\",\"reply\":\"...\"}"
        )
    })
    try:
        async with httpx.AsyncClient(timeout=AI_REQUEST_TIMEOUT) as client:
            req_body = {"model": model, "messages": upstream_messages}
            if is_apimart_provider(provider_cfg):
                req_body["stream"] = False
            response = await client.post(
                f"{chat_base}/chat/completions",
                headers=chat_hdrs,
                json=req_body,
            )
            response.raise_for_status()
            raw = response.json()
            decision = parse_agent_decision(text_from_chat_response(raw), payload.message, refs, has_previous_image)
            decision["router_model"] = model
            return decision
    except Exception as exc:
        write_diagnostic(f"chat agent intent router fallback error={type(exc).__name__}")
        fallback["router_model"] = model
        return fallback


async def build_chat_text_reply(payload, conversation, *, AI_REQUEST_TIMEOUT, CODEX_DEFAULT_CHAT_MODELS, GEMINI_CLI_DEFAULT_CHAT_MODELS, HTTPException, MAX_HISTORY_MESSAGES, chat_system_prompt, codex_chat_text, friendly_chat_error_detail, gemini_cli_chat_text, get_api_provider, httpx, is_apimart_provider, is_codex_provider, is_gemini_cli_provider, log_net_error, now_ms, public_usage, required_chat_response_text, resolve_chat_provider, safe_upstream_http_detail, safe_upstream_transport_detail, selected_model, unwrap_apimart_response, upstream_message_from_record):
    provider_cfg = get_api_provider(payload.provider) if payload.provider not in ("modelscope",) else {}
    if is_codex_provider(provider_cfg):
        model = selected_model(payload.model, (provider_cfg.get("chat_models") or CODEX_DEFAULT_CHAT_MODELS)[0])
        payload.model = model
        text, raw = await codex_chat_text(payload, conversation["messages"][-MAX_HISTORY_MESSAGES:])
        return {
            "id": uuid.uuid4().hex,
            "role": "assistant",
            "content": text,
            "created_at": now_ms(),
            "model": model,
            "raw_usage": None,
        }
    if is_gemini_cli_provider(provider_cfg):
        model = selected_model(payload.model, (provider_cfg.get("chat_models") or GEMINI_CLI_DEFAULT_CHAT_MODELS)[0])
        payload.model = model
        text, raw = await gemini_cli_chat_text(payload, conversation["messages"][-MAX_HISTORY_MESSAGES:])
        return {
            "id": uuid.uuid4().hex,
            "role": "assistant",
            "content": text,
            "created_at": now_ms(),
            "model": model,
            "raw_usage": None,
        }
    chat_base, chat_hdrs, model = resolve_chat_provider(payload.provider, payload.model, payload.ms_model)
    is_apimart = is_apimart_provider(provider_cfg)
    upstream_messages = [{"role": "system", "content": chat_system_prompt(payload)}]
    for item in conversation["messages"][-MAX_HISTORY_MESSAGES:]:
        msg = upstream_message_from_record(item)
        if msg:
            upstream_messages.append(msg)
    try:
        async with httpx.AsyncClient(timeout=AI_REQUEST_TIMEOUT) as client:
            req_body = {"model": model, "messages": upstream_messages}
            if is_apimart:
                req_body["stream"] = False
            response = await client.post(f"{chat_base}/chat/completions", headers=chat_hdrs, json=req_body)
            response.raise_for_status()
            raw = response.json()
    except httpx.HTTPStatusError as exc:
        body = exc.response.text or ""
        friendly = friendly_chat_error_detail(body, model, provider_cfg)
        raise HTTPException(status_code=exc.response.status_code, detail=safe_upstream_http_detail(exc.response, friendly=friendly)) from exc
    except httpx.HTTPError as exc:
        log_net_error("对话 Agent 网络/TLS错误", exc)
        raise HTTPException(status_code=502, detail=safe_upstream_transport_detail(exc)) from exc
    raw_data = unwrap_apimart_response(raw) if isinstance(raw, dict) else raw
    return {
        "id": uuid.uuid4().hex,
        "role": "assistant",
        "content": required_chat_response_text(raw),
        "created_at": now_ms(),
        "model": model,
        "raw_usage": public_usage(raw_data.get("usage")) if isinstance(raw_data, dict) else None,
    }


async def chat(payload, request, x_user_id='', *, AI_REQUEST_TIMEOUT, CODEX_DEFAULT_CHAT_MODELS, GEMINI_CLI_DEFAULT_CHAT_MODELS, HTTPException, IMAGE_MODEL, MAX_HISTORY_MESSAGES, chat_prompt_size_override, chat_system_prompt, codex_chat_text, display_title, friendly_chat_error_detail, friendly_image_error_detail, gemini_cli_chat_text, generate_ai_image, get_api_provider, httpx, image_references, is_apimart_provider, is_codex_provider, is_gemini_cli_provider, load_conversation, log_net_error, model_dump_compat, new_conversation, now_ms, public_usage, required_chat_response_text, resolve_chat_provider, safe_upstream_http_detail, safe_upstream_transport_detail, safe_user_id, save_ai_image_to_output, save_conversation, selected_model, unwrap_apimart_response, upstream_message_from_record):
    user_id = safe_user_id(x_user_id, request)
    conversation = (
        load_conversation(user_id, payload.conversation_id)
        if payload.conversation_id
        else new_conversation(user_id, display_title(payload.message))
    )
    if not conversation.get("messages"):
        conversation["title"] = display_title(payload.message)

    refs = [model_dump_compat(ref) for ref in payload.reference_images if ref.url]
    image_refs = image_references(refs)
    user_message = {
        "id": uuid.uuid4().hex,
        "role": "user",
        "content": payload.message,
        "created_at": now_ms(),
        "attachments": refs,
        "mode": payload.mode,
    }
    conversation["messages"].append(user_message)
    conversation["updated_at"] = now_ms()
    save_conversation(user_id, conversation)

    if payload.mode == "image":
        image_provider_id = payload.provider if payload.provider not in {"modelscope"} else "comfly"
        provider = get_api_provider(image_provider_id)
        default_model = (provider.get("image_models") or [IMAGE_MODEL])[0]
        model = selected_model(payload.image_model or payload.model, default_model)
        image_size = chat_prompt_size_override(payload.message, payload.size) or payload.size
        try:
            image_data, raw = await generate_ai_image(
                payload.message,
                image_size,
                payload.quality,
                model,
                image_refs,
                provider["id"],
                payload.aspect_ratio,
                payload.resolution,
            )
            local_url = await save_ai_image_to_output(image_data, prefix="chat_")
        except httpx.HTTPStatusError as exc:
            text = exc.response.text or ""
            detail = safe_upstream_http_detail(exc.response, "上游生图接口错误", friendly_image_error_detail(text, image_size, model))
            raise HTTPException(status_code=exc.response.status_code, detail=detail) from exc
        except httpx.HTTPError as exc:
            log_net_error(f"对话生图 网络/TLS错误 model={model}", exc)
            raise HTTPException(status_code=502, detail=safe_upstream_transport_detail(exc, "请求上游生图接口失败")) from exc
        assistant_message = {
            "id": uuid.uuid4().hex,
            "role": "assistant",
            "type": "image",
            "content": payload.message,
            "image_url": local_url,
            "created_at": now_ms(),
            "model": model,
            "size": image_size,
            "raw_usage": public_usage(raw.get("usage")) if isinstance(raw, dict) else None,
        }
    else:
        _codex_provider = get_api_provider(payload.provider)
        if is_codex_provider(_codex_provider):
            model = selected_model(payload.model, (_codex_provider.get("chat_models") or CODEX_DEFAULT_CHAT_MODELS)[0])
            payload.model = model
            text, raw = await codex_chat_text(payload, conversation["messages"][-MAX_HISTORY_MESSAGES:])
            assistant_message = {
                "id": uuid.uuid4().hex,
                "role": "assistant",
                "content": text,
                "created_at": now_ms(),
                "model": model,
                "raw_usage": None,
            }
            conversation["messages"].append(assistant_message)
            conversation["updated_at"] = now_ms()
            save_conversation(user_id, conversation)
            return {"conversation": conversation, "message": assistant_message}
        if is_gemini_cli_provider(_codex_provider):
            model = selected_model(payload.model, (_codex_provider.get("chat_models") or GEMINI_CLI_DEFAULT_CHAT_MODELS)[0])
            payload.model = model
            text, raw = await gemini_cli_chat_text(payload, conversation["messages"][-MAX_HISTORY_MESSAGES:])
            assistant_message = {
                "id": uuid.uuid4().hex,
                "role": "assistant",
                "content": text,
                "created_at": now_ms(),
                "model": model,
                "raw_usage": None,
            }
            conversation["messages"].append(assistant_message)
            conversation["updated_at"] = now_ms()
            save_conversation(user_id, conversation)
            return {"conversation": conversation, "message": assistant_message}
        chat_base, chat_hdrs, model = resolve_chat_provider(payload.provider, payload.model, payload.ms_model)
        _conv_provider = get_api_provider(payload.provider) if payload.provider not in ("modelscope",) else {}
        _conv_is_apimart = is_apimart_provider(_conv_provider)
        history = conversation["messages"][-MAX_HISTORY_MESSAGES:]
        upstream_messages = [{"role": "system", "content": chat_system_prompt(payload)}]
        for item in history:
            msg = upstream_message_from_record(item)
            if msg:
                upstream_messages.append(msg)
        try:
            async with httpx.AsyncClient(timeout=AI_REQUEST_TIMEOUT) as client:
                conv_req_body = {"model": model, "messages": upstream_messages}
                if _conv_is_apimart:
                    conv_req_body["stream"] = False
                response = await client.post(
                    f"{chat_base}/chat/completions",
                    headers=chat_hdrs,
                    json=conv_req_body,
                )
                response.raise_for_status()
                raw = response.json()
        except httpx.HTTPStatusError as exc:
            body = exc.response.text or ""
            friendly = friendly_chat_error_detail(body, model, _conv_provider)
            raise HTTPException(status_code=exc.response.status_code, detail=safe_upstream_http_detail(exc.response, friendly=friendly)) from exc
        except httpx.HTTPError as exc:
            log_net_error("对话 网络/TLS错误", exc)
            raise HTTPException(status_code=502, detail=safe_upstream_transport_detail(exc)) from exc
        raw_data = unwrap_apimart_response(raw) if isinstance(raw, dict) else raw
        assistant_message = {
            "id": uuid.uuid4().hex,
            "role": "assistant",
            "content": required_chat_response_text(raw),
            "created_at": now_ms(),
            "model": model,
            "raw_usage": public_usage(raw_data.get("usage")) if isinstance(raw_data, dict) else None,
        }

    conversation["messages"].append(assistant_message)
    conversation["updated_at"] = now_ms()
    save_conversation(user_id, conversation)
    return {"conversation": conversation, "message": assistant_message}


async def chat_agent(payload, request, x_user_id='', *, HTTPException, IMAGE_MODEL, build_chat_text_reply, chat_prompt_size_override, chat_requested_image_count, chat_split_parallel_prompts, decide_chat_agent_action, display_title, friendly_image_error_detail, generate_ai_image, httpx, image_references, image_size_from_reference, latest_chat_image_refs, load_conversation, log_net_error, model_dump_compat, new_conversation, now_ms, pick_chat_image_provider, public_usage, safe_upstream_http_detail, safe_upstream_transport_detail, safe_user_id, save_ai_image_to_output, save_conversation, selected_model, snap_size_to_multiple):
    user_id = safe_user_id(x_user_id, request)
    conversation = (
        load_conversation(user_id, payload.conversation_id)
        if payload.conversation_id
        else new_conversation(user_id, display_title(payload.message))
    )
    if not conversation.get("messages"):
        conversation["title"] = display_title(payload.message)

    refs = [model_dump_compat(ref) for ref in payload.reference_images if ref.url]
    image_refs = image_references(refs)
    user_message = {
        "id": uuid.uuid4().hex,
        "role": "user",
        "content": payload.message,
        "created_at": now_ms(),
        "attachments": refs,
        "mode": "agent",
    }
    conversation["messages"].append(user_message)
    conversation["updated_at"] = now_ms()
    save_conversation(user_id, conversation)

    decision = await decide_chat_agent_action(payload, conversation, image_refs)
    action = decision.get("action") or "chat"
    tool_refs = image_refs[:]
    inherited_size = ""
    if action == "edit_image" and not tool_refs:
        tool_refs = latest_chat_image_refs(conversation, 1)
        inherited_size = image_size_from_reference(tool_refs[0]) if tool_refs else ""
    if action == "edit_image" and not tool_refs:
        action = "generate_image"

    if action in {"generate_image", "edit_image"}:
        image_provider = pick_chat_image_provider(payload.image_provider or payload.provider, payload.provider)
        default_model = (image_provider.get("image_models") or [IMAGE_MODEL])[0]
        model = selected_model(payload.image_model or default_model, default_model)
        prompt = decision.get("prompt") or payload.message
        prompt_size = chat_prompt_size_override(payload.message, payload.size) or chat_prompt_size_override(prompt, payload.size)
        image_size = snap_size_to_multiple(prompt_size or inherited_size or payload.size, 16)
        requested_count = 1 if action == "edit_image" else chat_requested_image_count(payload.message)
        prompts = chat_split_parallel_prompts(prompt, requested_count)
        local_urls = []
        raw_items = []
        try:
            for item_prompt in prompts:
                image_data, raw = await generate_ai_image(
                    item_prompt,
                    image_size,
                    payload.quality,
                    model,
                    tool_refs,
                    image_provider["id"],
                    payload.aspect_ratio,
                    payload.resolution,
                )
                local_urls.append(await save_ai_image_to_output(image_data, prefix="chat_"))
                raw_items.append(raw)
        except httpx.HTTPStatusError as exc:
            text = exc.response.text or ""
            detail = safe_upstream_http_detail(exc.response, "上游生图接口错误", friendly_image_error_detail(text, image_size, model))
            raise HTTPException(status_code=exc.response.status_code, detail=detail) from exc
        except httpx.HTTPError as exc:
            log_net_error(f"对话生图 网络/TLS错误 model={model}", exc)
            raise HTTPException(status_code=502, detail=safe_upstream_transport_detail(exc, "请求上游生图接口失败")) from exc
        local_url = local_urls[0] if local_urls else ""
        assistant_message = {
            "id": uuid.uuid4().hex,
            "role": "assistant",
            "type": "image",
            "content": prompt,
            "image_url": local_url,
            "image_urls": local_urls,
            "created_at": now_ms(),
            "model": model,
            "provider": image_provider["id"],
            "size": image_size,
            "image_count": len(local_urls),
            "prompts": prompts,
            "agent_action": action,
            "agent_reply": decision.get("reply") or "",
            "used_references": tool_refs,
            "raw_usage": public_usage(raw_items[0].get("usage")) if raw_items and isinstance(raw_items[0], dict) else None,
        }
    else:
        assistant_message = await build_chat_text_reply(payload, conversation)
        assistant_message["agent_action"] = "chat"

    conversation["messages"].append(assistant_message)
    conversation["updated_at"] = now_ms()
    save_conversation(user_id, conversation)
    return {"conversation": conversation, "message": assistant_message, "agent": {"action": action, "decision": decision}}


async def chat_stream(payload, request, x_user_id='', *, AI_REQUEST_TIMEOUT, CODEX_DEFAULT_CHAT_MODELS, GEMINI_CLI_DEFAULT_CHAT_MODELS, HTTPException, MAX_HISTORY_MESSAGES, StreamingResponse, chat_system_prompt, codex_chat_text, display_title, friendly_chat_error_detail, gemini_cli_chat_text, get_api_provider, httpx, is_codex_provider, is_gemini_cli_provider, load_conversation, log_net_error, model_dump_compat, new_conversation, now_ms, public_usage, resolve_chat_provider, safe_upstream_http_detail, safe_upstream_transport_detail, safe_user_id, save_conversation, selected_model, sse_event, text_delta_from_chat_chunk, upstream_message_from_record):
    if payload.mode == "image":
        raise HTTPException(status_code=400, detail="图片模式请使用 /api/chat")

    user_id = safe_user_id(x_user_id, request)
    conversation = (
        load_conversation(user_id, payload.conversation_id)
        if payload.conversation_id
        else new_conversation(user_id, display_title(payload.message))
    )
    if not conversation.get("messages"):
        conversation["title"] = display_title(payload.message)

    refs = [model_dump_compat(ref) for ref in payload.reference_images if ref.url]
    user_message = {
        "id": uuid.uuid4().hex,
        "role": "user",
        "content": payload.message,
        "created_at": now_ms(),
        "attachments": refs,
        "mode": payload.mode,
    }
    conversation["messages"].append(user_message)
    conversation["updated_at"] = now_ms()
    save_conversation(user_id, conversation)

    _codex_provider = get_api_provider(payload.provider)
    if is_codex_provider(_codex_provider):
        model = selected_model(payload.model, (_codex_provider.get("chat_models") or CODEX_DEFAULT_CHAT_MODELS)[0])
        payload.model = model

        async def codex_stream():
            yield sse_event({"type": "meta", "conversation": conversation})
            try:
                text, raw = await codex_chat_text(payload, conversation["messages"][-MAX_HISTORY_MESSAGES:])
            except HTTPException as exc:
                yield sse_event({"type": "error", "detail": exc.detail})
                return
            assistant_message = {
                "id": uuid.uuid4().hex,
                "role": "assistant",
                "content": text,
                "created_at": now_ms(),
                "model": model,
                "raw_usage": None,
            }
            conversation["messages"].append(assistant_message)
            conversation["updated_at"] = now_ms()
            save_conversation(user_id, conversation)
            yield sse_event({"type": "delta", "delta": text})
            yield sse_event({"type": "done", "conversation": conversation, "message": assistant_message})

        return StreamingResponse(codex_stream(), media_type="text/event-stream")

    if is_gemini_cli_provider(_codex_provider):
        model = selected_model(payload.model, (_codex_provider.get("chat_models") or GEMINI_CLI_DEFAULT_CHAT_MODELS)[0])
        payload.model = model

        async def gemini_cli_stream():
            yield sse_event({"type": "meta", "conversation": conversation})
            try:
                text, raw = await gemini_cli_chat_text(payload, conversation["messages"][-MAX_HISTORY_MESSAGES:])
            except HTTPException as exc:
                yield sse_event({"type": "error", "detail": exc.detail})
                return
            assistant_message = {
                "id": uuid.uuid4().hex,
                "role": "assistant",
                "content": text,
                "created_at": now_ms(),
                "model": model,
                "raw_usage": None,
            }
            conversation["messages"].append(assistant_message)
            conversation["updated_at"] = now_ms()
            save_conversation(user_id, conversation)
            yield sse_event({"type": "delta", "delta": text})
            yield sse_event({"type": "done", "conversation": conversation, "message": assistant_message})

        return StreamingResponse(gemini_cli_stream(), media_type="text/event-stream")

    chat_base, chat_hdrs, model = resolve_chat_provider(payload.provider, payload.model, payload.ms_model)
    _stream_provider = get_api_provider(payload.provider) if payload.provider not in ("modelscope",) else {}
    history = conversation["messages"][-MAX_HISTORY_MESSAGES:]
    upstream_messages = [{"role": "system", "content": chat_system_prompt(payload)}]
    for item in history:
        msg = upstream_message_from_record(item)
        if msg:
            upstream_messages.append(msg)

    async def stream():
        content_parts = []
        raw_usage = None
        yield sse_event({"type": "meta", "conversation": conversation})
        try:
            async with httpx.AsyncClient(timeout=AI_REQUEST_TIMEOUT) as client:
                async with client.stream(
                    "POST",
                    f"{chat_base}/chat/completions",
                    headers=chat_hdrs,
                    json={"model": model, "messages": upstream_messages, "stream": True},
                ) as response:
                    if response.status_code >= 400:
                        detail = await response.aread()
                        body = detail.decode("utf-8", errors="ignore")
                        friendly = friendly_chat_error_detail(body, model, _stream_provider)
                        yield sse_event({"type": "error", "detail": safe_upstream_http_detail(response, friendly=friendly)})
                        return
                    async for line in response.aiter_lines():
                        if not line:
                            continue
                        if line.startswith("data:"):
                            line = line[5:].strip()
                        if line == "[DONE]":
                            break
                        try:
                            chunk = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        if isinstance(chunk, dict) and chunk.get("usage"):
                            raw_usage = public_usage(chunk.get("usage"))
                        delta = text_delta_from_chat_chunk(chunk)
                        if delta:
                            content_parts.append(delta)
                            yield sse_event({"type": "delta", "delta": delta})
        except httpx.HTTPError as exc:
            log_net_error("对话(流式) 网络/TLS错误", exc)
            yield sse_event({"type": "error", "detail": safe_upstream_transport_detail(exc)})
            return

        text = "".join(content_parts).strip()
        if not text:
            yield sse_event({"type": "error", "detail": "上游接口返回了空回复，请稍后重试"})
            return

        assistant_message = {
            "id": uuid.uuid4().hex,
            "role": "assistant",
            "content": text,
            "created_at": now_ms(),
            "model": model,
            "raw_usage": raw_usage,
        }
        conversation["messages"].append(assistant_message)
        conversation["updated_at"] = now_ms()
        save_conversation(user_id, conversation)
        yield sse_event({"type": "done", "conversation": conversation, "message": assistant_message})

    return StreamingResponse(stream(), media_type="text/event-stream")


def resolve_chat_provider(provider, model, ms_model, *, AI_BASE_URL, HTTPException, MODELSCOPE_CHAT_MODELS, RUNNINGHUB_LLM_BASE_URL, api_headers, bearer_auth_value, effective_protocol, get_api_provider, is_apimart_provider, is_codex_provider, is_gemini_cli_provider, modelscope_api_key, modelscope_api_root, preferred_chat_model, selected_model):
    if provider == "modelscope":
        clean_token = modelscope_api_key()
        if not clean_token:
            raise HTTPException(status_code=400, detail="未配置 ModelScope API Key，请在 API 设置中填写。")
        base = modelscope_api_root()
        hdrs = {"Authorization": bearer_auth_value(clean_token), "Content-Type": "application/json"}
        mdl = selected_model(ms_model or model, MODELSCOPE_CHAT_MODELS[0] if MODELSCOPE_CHAT_MODELS else "MiniMax/MiniMax-M2.7")
        return base, hdrs, mdl
    api_provider = get_api_provider(provider or "")
    if is_codex_provider(api_provider):
        raise HTTPException(status_code=400, detail="OpenAI CLI 使用本机 codex 登录态，不需要 API Key。请使用画布/聊天里的 OpenAI CLI 专用通道。")
    if is_gemini_cli_provider(api_provider):
        raise HTTPException(status_code=400, detail="Antigravity CLI 使用本机 agy 登录态，不需要 API Key。请使用画布/聊天里的 Antigravity CLI 专用通道。")
    base_root = (api_provider.get("base_url") or AI_BASE_URL).rstrip("/")
    if not base_root:
        raise HTTPException(status_code=400, detail=f"{api_provider.get('name') or api_provider['id']} 未配置 Base URL")
    default_model = preferred_chat_model(api_provider)
    mdl = selected_model(model, default_model)
    protocol = effective_protocol(api_provider, mdl)
    if protocol == "gemini":
        # APIMart's native Gemini API is served from its official API domain.
        # Keep the configured base URL for its OpenAI-compatible models only.
        if is_apimart_provider(api_provider):
            base_root = "https://api.apimart.ai"
        base = base_root if base_root.endswith("/v1beta") else base_root + "/v1beta"
    elif protocol == "volcengine":
        base = base_root if base_root.endswith("/api/v3") else base_root + "/api/v3"
    elif protocol == "runninghub":
        base = RUNNINGHUB_LLM_BASE_URL
    else:
        base = base_root if base_root.endswith("/v1") else base_root + "/v1"
    hdrs = api_headers(provider=api_provider, model=mdl)
    return base, hdrs, mdl


async def canvas_llm(payload, *, AI_REQUEST_TIMEOUT, CODEX_DEFAULT_CHAT_MODELS, GEMINI_CLI_DEFAULT_CHAT_MODELS, HTTPException, MAX_HISTORY_MESSAGES, codex_chat_text, friendly_chat_error_detail, gemini_cli_chat_text, get_api_provider, httpx, is_apimart_provider, is_codex_provider, is_gemini_cli_provider, is_image_reference_value, is_video_reference_value, log_net_error, media_reference_to_url, public_usage, required_chat_response_text, resolve_chat_provider, safe_upstream_http_detail, safe_upstream_transport_detail, selected_model, unwrap_apimart_response, video_reference_to_frame_data_urls, write_diagnostic):
    _provider = get_api_provider(payload.provider)
    if is_codex_provider(_provider):
        model = selected_model(payload.model, (_provider.get("chat_models") or CODEX_DEFAULT_CHAT_MODELS)[0])
        payload.model = model
        text, raw = await codex_chat_text(payload, payload.messages)
        return {"text": text, "model": model, "raw_usage": None}
    if is_gemini_cli_provider(_provider):
        model = selected_model(payload.model, (_provider.get("chat_models") or GEMINI_CLI_DEFAULT_CHAT_MODELS)[0])
        payload.model = model
        text, raw = await gemini_cli_chat_text(payload, payload.messages)
        return {"text": text, "model": model, "raw_usage": None}
    chat_base, chat_hdrs, model = resolve_chat_provider(payload.provider, payload.model, payload.ms_model)
    # 判断协议：APIMart 异步 vs 标准 OpenAI
    _llm_provider = get_api_provider(payload.provider) if payload.provider not in ("modelscope",) else {}
    _is_apimart = is_apimart_provider(_llm_provider)
    system_prompt = (payload.system_prompt or "").strip()
    upstream_messages = [{"role": "system", "content": system_prompt}] if system_prompt else []
    for item in payload.messages[-MAX_HISTORY_MESSAGES:]:
        role = item.get("role")
        content = item.get("content")
        if role in {"user", "assistant"} and content:
            upstream_messages.append({"role": role, "content": content})
    # 构造用户消息：有图片/视频时用 OpenAI/Gemini 多模态格式
    image_inputs = [img for img in (payload.images or []) if is_image_reference_value(img)]
    video_inputs = [video for video in (payload.videos or []) if is_video_reference_value(video)]
    audio_inputs = [audio for audio in (payload.audios or []) if isinstance(audio, str) and audio.strip()]
    if image_inputs or video_inputs or audio_inputs:
        content_parts = [{"type": "text", "text": payload.message}]
        ok_imgs = 0
        for img in image_inputs[:8]:
            if not img or not isinstance(img, str):
                continue
            ref_url = media_reference_to_url(img, max_image_size=1024)
            if not ref_url:
                continue
            content_parts.append({"type": "image_url", "image_url": {"url": ref_url}})
            ok_imgs += 1
        ok_videos = 0
        for video in video_inputs[:3]:
            if not video or not isinstance(video, str):
                continue
            frame_urls = await video_reference_to_frame_data_urls(video, max_frames=6, max_size=768)
            if frame_urls:
                ok_videos += 1
                content_parts.append({"type": "text", "text": f"以下是视频 {ok_videos} 按时间顺序抽取的关键帧，请结合这些画面理解视频内容。"})
                for frame_url in frame_urls:
                    content_parts.append({"type": "image_url", "image_url": {"url": frame_url}})
            else:
                ref_url = media_reference_to_url(video)
                if not ref_url:
                    continue
                content_parts.append({"type": "video_url", "video_url": {"url": ref_url}})
                ok_videos += 1
        ok_audios = 0
        for audio in audio_inputs[:3]:
            if not audio:
                continue
            ref_url = media_reference_to_url(audio)
            if not ref_url:
                continue
            content_parts.append({"type": "audio_url", "audio_url": {"url": ref_url}})
            ok_audios += 1
        write_diagnostic(
            f"canvas llm input provider={str(payload.provider or '')[:80]} "
            f"text_len={len(payload.message)} images={ok_imgs}/{len(payload.images)} videos={ok_videos}/{len(payload.videos)} audios={ok_audios}/{len(payload.audios)}"
        )
        upstream_messages.append({"role": "user", "content": content_parts})
    else:
        upstream_messages.append({"role": "user", "content": payload.message})
    raw = None
    try:
        async with httpx.AsyncClient(timeout=AI_REQUEST_TIMEOUT) as client:
            req_body = {"model": model, "messages": upstream_messages}
            if payload.temperature is not None:
                req_body["temperature"] = payload.temperature
            if payload.max_tokens is not None:
                req_body["max_tokens"] = payload.max_tokens
            if _is_apimart:
                req_body["stream"] = False   # APIMart 默认流式，强制关闭
            response = await client.post(
                f"{chat_base}/chat/completions",
                headers=chat_hdrs,
                json=req_body,
            )
            response.raise_for_status()
            if not response.content:
                raise HTTPException(status_code=502, detail="上游接口返回了空响应")
            raw = response.json()
    except httpx.HTTPStatusError as exc:
        body = exc.response.text or ""
        friendly = friendly_chat_error_detail(body, model, _llm_provider)
        raise HTTPException(status_code=exc.response.status_code, detail=safe_upstream_http_detail(exc.response, friendly=friendly)) from exc
    except httpx.HTTPError as exc:
        log_net_error("画布对话 网络/TLS错误", exc)
        raise HTTPException(status_code=502, detail=safe_upstream_transport_detail(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail="解析上游响应失败") from exc
    text = required_chat_response_text(raw)
    raw_data = unwrap_apimart_response(raw) if isinstance(raw, dict) else {}
    return {"text": text, "model": model, "raw_usage": public_usage(raw_data.get("usage"))}


async def call_canvas_assistant_model(fields, *, CanvasLLMRequest, HTTPException, asyncio, canvas_llm, output_file_from_url, reference_to_data_url):
    fields = dict(fields)
    images = []
    for url in fields.get("images", []):
        if url.startswith(("/assets/", "/output/", "/api/storage-files/local/")):
            if not output_file_from_url(url):
                raise HTTPException(409, "引用图片已丢失，请重新选择")
            url = await asyncio.to_thread(reference_to_data_url, {"url": url}, 1024)
            if not url.startswith("data:image/"):
                raise HTTPException(422, "引用素材无法读取为图片，请重新选择")
        images.append(url)
    fields["images"] = images
    return await canvas_llm(CanvasLLMRequest(**fields))


async def caption_image_with_provider(abs_path, prompt, provider_id, model, ms_model='', *, AI_REQUEST_TIMEOUT, CODEX_DEFAULT_CHAT_MODELS, CanvasLLMRequest, GEMINI_CLI_DEFAULT_CHAT_MODELS, HTTPException, codex_chat_text, friendly_chat_error_detail, gemini_cli_chat_text, get_api_provider, httpx, image_path_to_data_url, is_apimart_provider, is_codex_provider, is_gemini_cli_provider, log_net_error, required_chat_response_text, resolve_chat_provider, safe_upstream_http_detail, safe_upstream_transport_detail, selected_model):
    llm_provider = get_api_provider(provider_id) if provider_id not in ("modelscope",) else {}
    if is_codex_provider(llm_provider):
        resolved_model = selected_model(model, (llm_provider.get("chat_models") or CODEX_DEFAULT_CHAT_MODELS)[0])
        payload = CanvasLLMRequest(
            message=(prompt or "描述图片").strip() or "描述图片",
            provider=provider_id or "codex",
            model=resolved_model,
            images=[abs_path],
        )
        text, _raw = await codex_chat_text(payload, [])
        return text, resolved_model
    if is_gemini_cli_provider(llm_provider):
        resolved_model = selected_model(model, (llm_provider.get("chat_models") or GEMINI_CLI_DEFAULT_CHAT_MODELS)[0])
        payload = CanvasLLMRequest(
            message=(prompt or "描述图片").strip() or "描述图片",
            provider=provider_id or "gemini-cli",
            model=resolved_model,
            images=[abs_path],
        )
        text, _raw = await gemini_cli_chat_text(payload, [])
        return text, resolved_model
    chat_base, chat_hdrs, resolved_model = resolve_chat_provider(provider_id, model, ms_model)
    is_apimart = is_apimart_provider(llm_provider)
    prompt_text = (prompt or "描述图片").strip() or "描述图片"
    data_url = image_path_to_data_url(abs_path, max_size=1024)
    messages = [{
        "role": "user",
        "content": [
            {"type": "text", "text": prompt_text},
            {"type": "image_url", "image_url": {"url": data_url}},
        ],
    }]
    raw = None
    try:
        async with httpx.AsyncClient(timeout=AI_REQUEST_TIMEOUT) as client:
            req_body = {"model": resolved_model, "messages": messages}
            if is_apimart:
                req_body["stream"] = False
            response = await client.post(
                f"{chat_base}/chat/completions",
                headers=chat_hdrs,
                json=req_body,
            )
            response.raise_for_status()
            raw = response.json()
    except httpx.HTTPStatusError as exc:
        body = exc.response.text or ""
        friendly = friendly_chat_error_detail(body, resolved_model, llm_provider)
        raise HTTPException(status_code=exc.response.status_code, detail=safe_upstream_http_detail(exc.response, friendly=friendly)) from exc
    except httpx.HTTPError as exc:
        log_net_error(f"对话 网络/TLS错误 provider={llm_provider} model={resolved_model}", exc)
        raise HTTPException(status_code=502, detail=safe_upstream_transport_detail(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail="解析上游响应失败") from exc
    return required_chat_response_text(raw), resolved_model


