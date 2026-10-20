"""助手的画布快照、用户生成设置和连线公共规则。

仅处理调用方传入的数据，不依赖操作编排、原生动作、持久化或服务入口。
"""
from __future__ import annotations

import hashlib
import json
import math

from fastapi import HTTPException


def content_hash(canvas):
    content = {key: canvas.get(key) for key in ("nodes", "connections", "settings")}
    # 浏览器保存会把 0.0 写为 0；相同数值不应使原生确认失效。
    def numbers(value):
        if isinstance(value,dict):return {key:numbers(item) for key,item in value.items()}
        if isinstance(value,list):return [numbers(item) for item in value]
        if isinstance(value,float) and value.is_integer():return int(value)
        return value
    content=numbers(content)
    return hashlib.sha256(json.dumps(content, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def generation_settings(canvas, incoming, providers):
    """设置来自用户画布界面，模型操作无法指定或覆盖这些字段。"""
    names = ("engine", "provider_id", "model", "ratio", "resolution", "quality", "customRatio", "customSize", "customRatioWidth", "customRatioHeight", "customWidth", "customHeight", "videoProvider", "videoModel", "videoDuration", "videoAspect", "videoResolution", "videoEnhancePrompt", "videoEnableUpsample", "videoWatermark", "videoCameraFixed", "videoGenerateAudio", "videoMultimodal", "videoUseFrameRoles")
    source = incoming or canvas.get("settings") or {}
    settings = {k: source[k] for k in names if k in source and isinstance(source[k], (str, int, float, bool))}
    if any(isinstance(v, str) and len(v) > 200 for v in settings.values()):
        raise HTTPException(422, "生成设置格式不正确")
    if any(isinstance(v, (int, float)) and not math.isfinite(v) for v in settings.values()):
        raise HTTPException(422, "生成设置数值不正确")
    duration = settings.get("videoDuration", 5)
    if not isinstance(duration, (int, float)) or isinstance(duration, bool) or not 1 <= duration <= 120:
        raise HTTPException(422, "视频时长不在支持范围内")
    if settings.get("engine", "api") not in {"api", ""}:
        raise HTTPException(409, "本阶段新建生成节点使用 API 设置，请先选择 API 生成")
    for provider_key, model_key, category in (("provider_id", "model", "image_models"), ("videoProvider", "videoModel", "video_models")):
        provider_id, model = settings.get(provider_key, ""), settings.get(model_key, "")
        if model:
            provider = next((p for p in providers if p.get("id") == provider_id and p.get("enabled", True)), None)
            if not provider or model not in (provider.get(category) or []):
                raise HTTPException(409, "用户选择的生成模型已变化，请重新选择后发送")
    return settings


def allowed_connection(kind, source, target):
    a, b = source.get("type"), target.get("type")
    if kind == "smart":
        if a == "smart-prompt":
            return b in {"smart-image", "smart-loop"}
        if a in {"smart-image", "smart-group"}:
            return b in {"smart-image", "smart-loop", "smart-prompt"}
        if a == "smart-loop":
            return b == "smart-image" or (b == "smart-loop" and (source.get("showPrompt") or source.get("imageInput")))
        return False
    generators = {"generator", "midjourney", "msgen", "comfy", "video", "rh"}
    if a in generators:
        return b == "output" or b in generators
    if b == "loop":
        return bool((target.get("imageInput") and a in {"image", "group", "output"}) or (target.get("showPrompt") and a in {"prompt", "promptGroup", "loop", "llm"}))
    if b == "llm":
        return a in {"prompt", "loop", "promptGroup", "llm", "image", "group", "output"}
    return b in generators and a in {"image", "prompt", "loop", "group", "promptGroup", "output", "llm"}


def would_cycle(connections, source, target):
    visited, pending = set(), [target]
    while pending:
        node = pending.pop()
        if node == source:
            return True
        if node in visited:
            continue
        visited.add(node)
        pending.extend(c.get("to") for c in connections if c.get("from") == node)
    return False
