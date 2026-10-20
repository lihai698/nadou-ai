"""Comfy输出分类、筛选、下载与文本保存。

索引、文件、锁和供应商调用由应用显式注入，保留现有提交/清理顺序。
"""
import os
import uuid
import urllib.request
import json
import urllib.parse

def download_image(comfy_address, comfy_url_path, prefix='studio_', *, COMFYUI_DOWNLOAD_TIMEOUT, output_path_for, output_url_for, shutil, write_diagnostic):
    filename = f"{prefix}{uuid.uuid4().hex[:10]}.png"
    local_path = output_path_for(filename, "output")
    full_url = f"http://{comfy_address}{comfy_url_path}"
    try:
        with urllib.request.urlopen(full_url, timeout=COMFYUI_DOWNLOAD_TIMEOUT) as response, open(local_path, 'wb') as out_file:
            shutil.copyfileobj(response, out_file)
        return output_url_for(filename, "output")
    except Exception as e:
        write_diagnostic(f"comfy output download failed error={type(e).__name__}")
        if comfy_url_path.startswith("/view"):
            return comfy_url_path.replace("/view", "/api/view", 1)
        return full_url


def comfy_output_extension(item):
    filename = str((item or {}).get("filename") or "")
    ext = os.path.splitext(filename)[1].lower()
    if ext in {
        ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff",
        ".mp4", ".webm", ".mov", ".m4v", ".avi", ".mkv",
        ".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac",
        ".txt", ".json", ".csv", ".srt", ".vtt", ".md",
    }:
        return ext
    fmt = str((item or {}).get("format") or "").lower()
    if "mpeg" in fmt or "mp3" in fmt:
        return ".mp3"
    if "wav" in fmt or "wave" in fmt:
        return ".wav"
    if "ogg" in fmt:
        return ".ogg"
    if "flac" in fmt:
        return ".flac"
    if "text" in fmt or "plain" in fmt:
        return ".txt"
    if "json" in fmt:
        return ".json"
    if "webm" in fmt:
        return ".webm"
    if "quicktime" in fmt or "mov" in fmt:
        return ".mov"
    if "mp4" in fmt or "h264" in fmt or "video" in fmt:
        return ".mp4"
    return ext or ".bin"


def is_video_output_item(item, *, comfy_output_extension):
    ext = comfy_output_extension(item)
    fmt = str((item or {}).get("format") or "").lower()
    return ext in {".mp4", ".webm", ".mov", ".m4v", ".avi", ".mkv"} or "video" in fmt


def comfy_output_kind(item, *, comfy_output_extension):
    ext = comfy_output_extension(item)
    fmt = str((item or {}).get("format") or "").lower()
    if ext in {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff"} or "image" in fmt:
        return "image"
    if ext in {".mp4", ".webm", ".mov", ".m4v", ".avi", ".mkv"} or "video" in fmt:
        return "video"
    if ext in {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"} or "audio" in fmt or "sound" in fmt:
        return "audio"
    if ext in {".txt", ".json", ".csv", ".srt", ".vtt", ".md"} or "text" in fmt or "json" in fmt:
        return "text"
    return "file"


def download_comfy_output(comfy_address, item, prefix='studio_', *, COMFYUI_DOWNLOAD_TIMEOUT, comfy_output_extension, output_path_for, output_url_for, shutil, write_diagnostic):
    ext = comfy_output_extension(item)
    filename = f"{prefix}{uuid.uuid4().hex[:10]}{ext}"
    local_path = output_path_for(filename, "output")
    subfolder = urllib.parse.quote(str(item.get("subfolder") or ""))
    file_type = urllib.parse.quote(str(item.get("type") or "output"))
    comfy_url_path = f"/view?filename={urllib.parse.quote(str(item['filename']))}&subfolder={subfolder}&type={file_type}"
    full_url = f"http://{comfy_address}{comfy_url_path}"
    try:
        with urllib.request.urlopen(full_url, timeout=COMFYUI_DOWNLOAD_TIMEOUT) as response, open(local_path, 'wb') as out_file:
            shutil.copyfileobj(response, out_file)
        return output_url_for(filename, "output")
    except Exception as e:
        write_diagnostic(f"comfy output download failed error={type(e).__name__}")
        if comfy_url_path.startswith("/view"):
            return comfy_url_path.replace("/view", "/api/view", 1)
        return full_url


def save_comfy_text_output(value, prefix='studio_', name='', *, output_path_for, output_url_for, sanitize_export_filename, write_text_atomic):
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, indent=2)
    stem = sanitize_export_filename(name or "comfy_text.txt", "comfy_text.txt")
    _, ext = os.path.splitext(stem)
    if ext.lower() not in {".txt", ".json", ".csv", ".srt", ".vtt", ".md"}:
        stem += ".txt"
    filename = f"{prefix}{uuid.uuid4().hex[:10]}_{stem}"
    path = output_path_for(filename, "output")
    write_text_atomic(path, text, encoding="utf-8", newline="")
    return output_url_for(filename, "output")


def comfy_text_values_from_output(node_output):
    values = []
    text_keys = ("text", "texts", "prompt", "prompts", "string", "strings", "caption", "captions")
    for key in text_keys:
        if key not in node_output:
            continue
        value = node_output.get(key)
        items = value if isinstance(value, list) else [value]
        for item in items:
            if isinstance(item, dict):
                text = item.get("text") or item.get("prompt") or item.get("caption") or item.get("value")
                name = item.get("filename") or item.get("name") or f"{key}.txt"
            else:
                text = item
                name = f"{key}.txt"
            if text is None:
                continue
            text = str(text)
            if text.strip():
                values.append((text, name))
    return values


def collect_comfy_file_items(node_output):
    items = []
    for key, value in (node_output or {}).items():
        if key in {"text", "texts", "prompt", "prompts", "string", "strings", "caption", "captions"}:
            continue
        candidates = value if isinstance(value, list) else [value]
        for item in candidates:
            if isinstance(item, dict) and item.get("filename"):
                items.append((key, item))
    return items


def comfy_class_is_preview(class_type, *, COMFY_PREVIEW_CLASS_HINTS):
    ct = str(class_type or "").lower()
    return bool(ct) and any(h in ct for h in COMFY_PREVIEW_CLASS_HINTS)


def comfy_class_is_debug_text(class_type, *, COMFY_DEBUG_TEXT_CLASS_HINTS):
    ct = str(class_type or "").lower()
    return bool(ct) and any(h in ct for h in COMFY_DEBUG_TEXT_CLASS_HINTS)


def get_comfy_history(comfy_address, prompt_id):
    try:
        with urllib.request.urlopen(f"http://{comfy_address}/history/{prompt_id}") as response:
            return json.loads(response.read())
    except Exception as e:
        return {}


