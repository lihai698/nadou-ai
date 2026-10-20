"""上游聊天/图片响应解析与任务编号提取。

仅解析传入的公开响应结构；不读取配置、文件或发起网络请求。
"""
import base64
import re
import json

def unwrap_apimart_response(raw):
    """APIMart 将标准 OpenAI 响应包在 {"code":200,"data":{...}} 里；如果检测到就解包。"""
    if isinstance(raw, dict) and "data" in raw and isinstance(raw.get("data"), dict) and "choices" not in raw:
        return raw["data"]
    return raw


def text_from_chat_response(data, *, unwrap_apimart_response):
    data = unwrap_apimart_response(data)
    choices = data.get("choices") or []
    if not choices:
        return ""
    message = choices[0].get("message") or {}
    content = message.get("content", "")
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict):
                parts.append(item.get("text") or item.get("content") or "")
        return "\n".join(part for part in parts if part)
    return str(content)


def required_chat_response_text(data, *, HTTPException, text_from_chat_response):
    """空的上游回复是生成失败，不能写成正常助手消息。"""
    try:
        text = text_from_chat_response(data).strip() if isinstance(data, dict) else ""
    except (AttributeError, TypeError, ValueError):
        text = ""
    if not text:
        raise HTTPException(status_code=502, detail="上游接口返回了空回复，请稍后重试")
    return text


def text_delta_from_chat_chunk(data):
    choices = data.get("choices") or []
    if not choices:
        return ""
    delta = choices[0].get("delta") or {}
    content = delta.get("content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict):
                parts.append(item.get("text") or item.get("content") or "")
        return "".join(parts)
    return str(content) if content else ""


def sse_event(data):
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


def looks_like_generated_image_url(value):
    text = str(value or "").strip()
    if not text:
        return False
    if text.startswith("data:image/"):
        return True
    clean = text.split("?", 1)[0].split("#", 1)[0].lower()
    return text.startswith(("http://", "https://", "/output/", "/assets/")) and re.search(r"\.(png|jpe?g|webp|gif|bmp|tiff?)$", clean)


def looks_like_image_base64(value):
    text = str(value or "").strip()
    if not text:
        return False
    if text.startswith("data:image/"):
        return True
    if len(text) < 200:
        return False
    sample = re.sub(r"\s+", "", text[:4096])
    if not re.fullmatch(r"[A-Za-z0-9+/=_-]+", sample):
        return False
    padded = sample.replace("-", "+").replace("_", "/")
    padded += "=" * (-len(padded) % 4)
    try:
        head = base64.b64decode(padded[:256], validate=False)
    except Exception:
        return False
    return (
        head.startswith(b"\x89PNG\r\n\x1a\n")
        or head.startswith(b"\xff\xd8\xff")
        or head.startswith(b"RIFF") and head[8:12] == b"WEBP"
        or head.startswith(b"GIF87a")
        or head.startswith(b"GIF89a")
    )


def image_payload_from_string(value, mime_type='image/png', assume_b64=False, *, looks_like_generated_image_url, looks_like_image_base64):
    text = str(value or "").strip()
    if not text:
        return None
    # Some Gemini-compatible proxies (including APIMart's image models) return
    # the generated image as Markdown: ![image](data:image/jpeg;base64,...).
    # Extract the embedded data URL before handling plain URLs/base64 values.
    embedded_data_url = re.search(r"data:(image/[A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/_=-]+)", text)
    if embedded_data_url:
        return {
            "type": "b64",
            "value": embedded_data_url.group(2),
            "mime_type": embedded_data_url.group(1),
        }
    if text.startswith("data:image/"):
        header, sep, encoded = text.partition(",")
        if sep and encoded:
            return {
                "type": "b64",
                "value": encoded.strip(),
                "mime_type": header.split(";", 1)[0].replace("data:", "", 1) or mime_type or "image/png",
            }
    if looks_like_generated_image_url(text):
        return {"type": "url", "value": text}
    if assume_b64 or looks_like_image_base64(text):
        return {"type": "b64", "value": text, "mime_type": mime_type or "image/png"}
    return None


def extract_image_flexible(value, depth=0, *, IMAGE_BASE64_KEY_HINTS, IMAGE_CONTAINER_KEY_HINTS, IMAGE_OUTPUT_KEY_HINTS, extract_image_flexible, image_payload_from_string):
    if depth > 8 or value is None:
        return None
    if isinstance(value, str):
        return image_payload_from_string(value)
    if isinstance(value, list):
        for item in value:
            found = extract_image_flexible(item, depth + 1)
            if found:
                return found
        return None
    if not isinstance(value, dict):
        return None
    for key in IMAGE_BASE64_KEY_HINTS:
        item = value.get(key)
        if isinstance(item, str) and item.strip():
            return image_payload_from_string(item, value.get("mime_type") or value.get("mimeType") or "image/png", assume_b64=True)
    for key in IMAGE_OUTPUT_KEY_HINTS:
        item = value.get(key)
        if isinstance(item, str):
            found = image_payload_from_string(item, value.get("mime_type") or value.get("mimeType") or "image/png")
            if found:
                return found
        found = extract_image_flexible(item, depth + 1)
        if found:
            return found
    for key in IMAGE_CONTAINER_KEY_HINTS:
        found = extract_image_flexible(value.get(key), depth + 1)
        if found:
            return found
    return None


def extract_images(data, *, HTTPException, IMAGE_BASE64_KEY_HINTS, IMAGE_CONTAINER_KEY_HINTS, IMAGE_OUTPUT_KEY_HINTS, image_payload_from_string, looks_like_generated_image_url):
    found = []
    seen = set()

    def add_image(item):
        if not isinstance(item, dict):
            return
        img_type = item.get("type") or "url"
        value = item.get("value")
        if not value:
            return
        key = (img_type, value)
        if key in seen:
            return
        seen.add(key)
        found.append(item)

    def collect(value, depth=0):
        if depth > 8 or value is None:
            return
        if isinstance(value, str):
            found = image_payload_from_string(value)
            if found:
                add_image(found)
            return
        if isinstance(value, list):
            for item in value:
                collect(item, depth + 1)
            return
        if not isinstance(value, dict):
            return
        if value.get("type") == "image_generation_call":
            result = value.get("result")
            if isinstance(result, str) and result.strip():
                add_image(image_payload_from_string(
                    result,
                    value.get("mime_type") or value.get("mimeType") or "image/png",
                    assume_b64=not looks_like_generated_image_url(result),
                ))
            else:
                collect(result, depth + 1)
        has_direct_url = any(
            isinstance(value.get(key), str) and looks_like_generated_image_url(value.get(key))
            for key in IMAGE_OUTPUT_KEY_HINTS
        )
        if not has_direct_url:
            for key in IMAGE_BASE64_KEY_HINTS:
                item = value.get(key)
                if isinstance(item, str) and item.strip():
                    add_image(image_payload_from_string(item, value.get("mime_type") or value.get("mimeType") or "image/png", assume_b64=True))
        for key in IMAGE_OUTPUT_KEY_HINTS:
            item = value.get(key)
            if isinstance(item, str):
                add_image(image_payload_from_string(item, value.get("mime_type") or value.get("mimeType") or "image/png"))
            else:
                collect(item, depth + 1)
        for key in IMAGE_CONTAINER_KEY_HINTS:
            collect(value.get(key), depth + 1)

    candidates = data.get("candidates") if isinstance(data, dict) else None
    if isinstance(candidates, list):
        for candidate in candidates:
            if not isinstance(candidate, dict):
                continue
            content = candidate.get("content") or {}
            parts = content.get("parts") if isinstance(content, dict) else None
            if not isinstance(parts, list):
                continue
            for part in parts:
                if not isinstance(part, dict):
                    continue
                inline = part.get("inlineData") or part.get("inline_data") or {}
                if not isinstance(inline, dict):
                    inline = {}
                value = inline.get("data")
                if value:
                    add_image({
                        "type": "b64",
                        "value": value,
                        "mime_type": inline.get("mimeType") or inline.get("mime_type") or "image/png",
                    })
                # APIMart Gemini image models can return a Markdown data URL in
                # the text part instead of the native inlineData structure.
                embedded = image_payload_from_string(part.get("text"))
                if embedded:
                    add_image(embedded)

    current = data
    if isinstance(current, dict) and isinstance(current.get("data"), dict) and isinstance(current["data"].get("result"), dict):
        current = current["data"]
    if isinstance(current, dict) and isinstance(current.get("result"), dict):
        for item in current["result"].get("images") or []:
            if not isinstance(item, dict):
                collect(item)
                continue
            url = item.get("url")
            if isinstance(url, list):
                for one in url:
                    collect(one)
            else:
                collect(url)
            collect(item)

    collect(data)
    if isinstance(data, dict) and isinstance(data.get("data"), dict) and isinstance(data["data"].get("data"), dict):
        collect(data["data"]["data"])
    if found:
        return found
    raise HTTPException(status_code=502, detail="无法识别生图接口返回格式")


def extract_image(data, *, HTTPException, extract_image_flexible, extract_images):
    try:
        images = extract_images(data)
        if images:
            return images[0]
    except HTTPException:
        pass
    candidates = data.get("candidates") if isinstance(data, dict) else None
    if isinstance(candidates, list):
        for candidate in candidates:
            if not isinstance(candidate, dict):
                continue
            content = candidate.get("content") or {}
            parts = content.get("parts") if isinstance(content, dict) else None
            if not isinstance(parts, list):
                continue
            for part in parts:
                if not isinstance(part, dict):
                    continue
                inline = part.get("inlineData") or part.get("inline_data") or {}
                if not isinstance(inline, dict):
                    continue
                value = inline.get("data")
                if value:
                    return {
                        "type": "b64",
                        "value": value,
                        "mime_type": inline.get("mimeType") or inline.get("mime_type") or "image/png",
                    }
    if isinstance(data.get("data"), dict) and isinstance(data["data"].get("result"), dict):
        data = data["data"]
    if isinstance(data.get("result"), dict):
        result_images = data["result"].get("images") or []
        if result_images:
            first = result_images[0]
            url = first.get("url")
            if isinstance(url, list) and url:
                return {"type": "url", "value": url[0]}
            if isinstance(url, str) and url:
                return {"type": "url", "value": url}
    flexible = extract_image_flexible(data)
    if flexible:
        return flexible
    if isinstance(data.get("data"), dict) and isinstance(data["data"].get("data"), dict):
        data = data["data"]["data"]
    images = data.get("data") or []
    if not isinstance(images, list) or not images:
        raise HTTPException(status_code=502, detail="生图接口没有返回图片数据")
    first = images[0]
    if first.get("url"):
        return {"type": "url", "value": first["url"]}
    if first.get("b64_json"):
        return {"type": "b64", "value": first["b64_json"]}
    flexible = extract_image_flexible(first)
    if flexible:
        return flexible
    raise HTTPException(status_code=502, detail="无法识别生图接口返回格式")


def extract_task_id(data, *, extract_task_id):
    if data.get("task_id"):
        return str(data["task_id"])
    if data.get("taskId"):
        return str(data["taskId"])
    if data.get("submit_id"):
        return str(data["submit_id"])
    if data.get("video_id"):
        return str(data["video_id"])
    if data.get("videoId"):
        return str(data["videoId"])
    if data.get("id") and str(data.get("id", "")).startswith("task"):
        return str(data["id"])
    nested = data.get("data")
    if isinstance(nested, list) and nested:
        first = nested[0]
        if isinstance(first, dict):
            return extract_task_id(first)
    if isinstance(nested, dict):
        return extract_task_id(nested)
    return None


def extract_task_id_from_text(text):
    value = str(text or "")
    match = re.search(r"(?:task_id|taskId|task id)\s*[=:：]\s*([A-Za-z0-9_.:-]+)", value, re.IGNORECASE)
    return match.group(1) if match else ""


def images_api_unsupported(response):
    text = str(getattr(response, "text", "") or "").lower()
    return "images api is not supported" in text or "not supported for this platform" in text


