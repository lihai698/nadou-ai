"""RunningHub 回包解析与标准接口参数的纯规则。

本模块只处理调用方传入的数据，不读取配置、不发起请求、不保存上游回包。
标准接口网络流程由 runninghub_openapi 负责，认证与文件操作由宿主注入。
"""

import math
import os
import re

from typing import Any


def runninghub_query_status(raw: Any) -> str:
    """按既有优先级读取 RunningHub 查询状态，并返回小写文本。"""

    if not isinstance(raw, dict):
        return ""
    values = [
        raw.get("status"),
        raw.get("state"),
        raw.get("taskStatus"),
        raw.get("task_status"),
    ]
    data = raw.get("data")
    if isinstance(data, dict):
        values.extend([
            data.get("status"),
            data.get("state"),
            data.get("taskStatus"),
            data.get("task_status"),
        ])
    for value in values:
        if value is not None:
            return str(value).lower()
    return ""


def runninghub_extract_task_id(raw: Any) -> str:
    """从根对象或 ``data`` 对象提取 RunningHub 任务编号。"""

    if not isinstance(raw, dict):
        return ""
    for key in ("taskId", "task_id", "id"):
        if raw.get(key):
            return str(raw[key])
    data = raw.get("data")
    if isinstance(data, dict):
        for key in ("taskId", "task_id", "id"):
            if data.get(key):
                return str(data[key])
    return ""


def runninghub_schema_options(field):
    values = []
    for item in (field or {}).get("options") or []:
        if isinstance(item, dict):
            value = item.get("value")
        else:
            value = item
        if value is not None and str(value) != "":
            values.append(str(value))
    return values


def runninghub_schema_value(field, preferred=None):
    preferred = "" if preferred is None else str(preferred).strip()
    options = runninghub_schema_options(field)
    if preferred and (not options or preferred in options):
        return preferred
    default = (field or {}).get("defaultValue")
    if default is not None and str(default) != "":
        return default
    return options[0] if options else preferred


def runninghub_schema_field(params, *keys):
    wanted = {str(k).lower() for k in keys if k}
    for field in params or []:
        if not isinstance(field, dict):
            continue
        names = {str(field.get("fieldKey") or "").lower(), str(field.get("label") or "").lower()}
        if names & wanted:
            return field
    return None


def runninghub_aspect_from_size(size, fallback="1:1", *, parse_size):
    width, height = parse_size(size)
    if width and height:
        divisor = math.gcd(width, height) or 1
        return f"{width // divisor}:{height // divisor}"
    raw = str(size or "").strip().lower()
    if re.fullmatch(r"(auto|\d+\s*:\s*\d+)", raw):
        return raw.replace(" ", "")
    return fallback


def runninghub_resolution_from_size(size, fallback="2k", *, parse_size):
    width, height = parse_size(size)
    if width and height:
        long_edge = max(width, height)
        if long_edge >= 3200:
            return "4k"
        if long_edge >= 1400:
            return "2k"
        return "1k"
    raw = str(size or "").strip().lower()
    return raw if raw in {"1k", "2k", "4k", "480p", "720p", "1080p", "native1080p"} else fallback


def runninghub_size_for_aspect(aspect_ratio, fallback="1280x720"):
    ratio = str(aspect_ratio or "").strip()
    return {
        "9:16": "720x1280",
        "16:9": "1280x720",
        "1:1": "1024x1024",
        "4:3": "1024x768",
        "3:4": "768x1024",
    }.get(ratio, fallback)


def runninghub_is_image_to_video(value):
    text = str(value or "").strip().lower()
    compact = re.sub(r"[\s_/]+", "-", text)
    return "image-to-video" in compact or "-i2v" in compact or compact.endswith("i2v")


def runninghub_apply_schema_defaults(body, params):
    for field in params or []:
        if not isinstance(field, dict):
            continue
        key = str(field.get("fieldKey") or "").strip()
        if not key or key in body:
            continue
        default = field.get("defaultValue")
        options = runninghub_schema_options(field)
        if default is None or default == "":
            if field.get("required") is True and options:
                default = options[0]
            else:
                continue
        ftype = str(field.get("type") or "").upper()
        if ftype == "BOOLEAN":
            body[key] = bool(default) if not isinstance(default, str) else default.lower() == "true"
        elif ftype in {"INT", "INTEGER"}:
            try:
                body[key] = int(default)
            except Exception:
                body[key] = default
        elif ftype == "FLOAT":
            try:
                body[key] = float(default)
            except Exception:
                body[key] = default
        else:
            body[key] = default
    return body


def runninghub_task_endpoint(provider, model, *, RUNNINGHUB_DEFAULT_IMAGE_MODELS, runninghub_endpoint_url, runninghub_openapi_url):
    raw_model_path = str(model or "").strip()
    model_path = raw_model_path.strip("/")
    if not model_path:
        model_path = RUNNINGHUB_DEFAULT_IMAGE_MODELS[0]
    if raw_model_path.startswith("/openapi/"):
        return runninghub_endpoint_url(provider, raw_model_path)
    if model_path.startswith("openapi/"):
        return runninghub_endpoint_url(provider, f"/{model_path}")
    return runninghub_openapi_url(provider, model_path)


def runninghub_endpoint_alias_for_model(model, *, RUNNINGHUB_MODEL_ENDPOINT_ALIASES):
    model_id = str(model or "").strip().strip("/")
    if not model_id:
        return ""
    direct = RUNNINGHUB_MODEL_ENDPOINT_ALIASES.get(model_id)
    if direct:
        return direct
    lowered = model_id.lower()
    if lowered.startswith("gpt-image-2.0/") or lowered.startswith("gpt-image-2/"):
        if "/text-to-image-" in lowered or lowered.endswith("/text-to-image"):
            return "rhart-image-g-2/text-to-image"
        if "/edit-" in lowered or lowered.endswith("/edit"):
            return "rhart-image-g-2/image-to-image"
        if "/image-to-image-" in lowered or lowered.endswith("/image-to-image"):
            return "rhart-image-g-2/image-to-image"
    if lowered.startswith("nano-banana/"):
        if "/text-to-image-" in lowered or lowered.endswith("/text-to-image"):
            return "rhart-image-v1/text-to-image"
        if "/edit-" in lowered or lowered.endswith("/edit"):
            return "rhart-image-v1/edit"
    return ""


def runninghub_output_ext(remote, content_type=""):
    tail = str(remote or "").split("?", 1)[0].split("#", 1)[0]
    ext = os.path.splitext(tail)[1].lower().strip(".")
    allowed = {"png","jpg","jpeg","webp","gif","bmp","mp4","webm","mov","m4v","mkv","mp3","wav","ogg","m4a","flac","aac"}
    if ext in allowed:
        return ext
    ct = str(content_type or "").lower()
    if "mp4" in ct:
        return "mp4"
    if "webm" in ct:
        return "webm"
    if "quicktime" in ct:
        return "mov"
    if "mpeg" in ct:
        return "mp3"
    if "wav" in ct:
        return "wav"
    if "ogg" in ct:
        return "ogg"
    if "webp" in ct:
        return "webp"
    if "jpeg" in ct:
        return "jpg"
    return "png"


def rewrite_runninghub_file_url(url, *, urllib, RUNNINGHUB_FILE_HOST_REWRITES):
    text = str(url or "")
    if not text:
        return text
    try:
        parsed = urllib.parse.urlsplit(text)
    except Exception:
        return text
    target = RUNNINGHUB_FILE_HOST_REWRITES.get((parsed.netloc or "").lower())
    return parsed._replace(netloc=target).geturl() if target else text


def runninghub_extract_outputs(data, *, rewrite_runninghub_file_url):
    arr = []
    if isinstance(data, list):
        arr = data
    elif isinstance(data, dict):
        for key in ("outputs", "results", "files", "data"):
            value = data.get(key)
            if isinstance(value, list):
                arr = value
                break
        if not arr and (data.get("fileUrl") or data.get("url")):
            arr = [data]
    outputs = []
    for item in arr:
        if isinstance(item, str):
            outputs.append(rewrite_runninghub_file_url(item))
        elif isinstance(item, dict):
            url = item.get("fileUrl") or item.get("file_url") or item.get("url") or item.get("downloadUrl") or item.get("download_url")
            if isinstance(url, list):
                outputs.extend([rewrite_runninghub_file_url(u) for u in url if u])
            elif url:
                outputs.append(rewrite_runninghub_file_url(url))
    return outputs
