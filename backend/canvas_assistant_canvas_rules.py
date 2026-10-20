"""助手的画布快照、上下文与媒体引用、用户生成设置和连线公共规则。

媒体输入白名单与模型输出过滤分别保留助手自身策略；不复用普通素材索引的 URL 策略。
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


def reference_kind(item):
    url = item.get("url")
    if not isinstance(url, str) or not url.startswith(("/assets/", "/output/", "/api/storage-files/local/", "data:image/")):
        return ""
    if url.startswith("data:image/") and len(url) > 4_000_000:
        return ""
    kind = str(item.get("kind") or "").lower()
    if kind:
        return kind if kind in {"image", "video"} else ""
    suffix = url.split("?", 1)[0].lower()
    if suffix.endswith((".mp4", ".webm", ".mov", ".m4v", ".avi", ".mkv")):
        return "video"
    if suffix.endswith((".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif")) or url.startswith("data:image/"):
        return "image"
    return ""


def node_reference_assets(canvas):
    items = []
    for node in canvas.get("nodes", []):
        if not isinstance(node, dict) or not node.get("id"):
            continue
        primary_kind = node.get('mediaKind') or reference_kind({'url':node.get('url')}) or ('image' if node.get('type') in {'image','smart-image'} else '')
        values = [{"url": node.get("url"), "kind": primary_kind}]
        for field in ("images", "videos"):
            values.extend({**item, "kind": "video" if field == "videos" else item.get("kind", "")} if isinstance(item, dict) else {"url": item, "kind": "video" if field == "videos" else ""} for item in (node.get(field) or []))
        seen = set()
        for item in values:
            kind = reference_kind(item)
            if not kind or item["url"] in seen:
                continue
            seen.add(item["url"])
            media_id = hashlib.sha256(item["url"].encode("utf-8")).hexdigest()[:16]
            items.append({"id": f"canvas:{node['id']}:{media_id}", "nodeId": node["id"], "url": item["url"], "thumbnail": item.get("thumbnail") or item.get("thumb") or "", "name": item.get("name") or node.get("title") or node.get("name") or ("视频" if kind == "video" else "图片"), "kind": kind, "source": "canvas", "libraryName": "当前画布", "categoryName": ""})
    return items


def canvas_context(canvas, payload, reference_assets=None, *, offset=0, limit=100):
    """只取保存画布中的白名单字段，禁止客户端任意传入媒体 URL。"""
    by_id = {node["id"]: node for node in canvas.get("nodes", []) if isinstance(node, dict) and node.get("id")}
    ordered_ids = list(dict.fromkeys(payload.selectedNodeIds + payload.referencedNodeIds))
    ids = set(ordered_ids)
    if not ids.issubset(by_id):
        raise HTTPException(409, "选中的节点或引用素材已变化，请刷新选择后重试")
    nodes, images, videos = [], [], []
    context_nodes = [by_id[node_id] for node_id in ordered_ids]
    context_nodes.extend(node for node_id, node in by_id.items() if node_id not in ids)
    for node in context_nodes[offset:offset + limit]:
        item = {k: str(node.get(k, ""))[:1800] for k in ("id", "type", "title", "name", "text", "prompt", "promptDraftText", "variablePrompt")}
        nodes.append(item)
    allowed_assets = {str(item.get("id")): item for item in [*node_reference_assets(canvas), *(reference_assets or [])] if isinstance(item, dict) and item.get("id") and reference_kind(item)}
    asset_ids = list(dict.fromkeys(getattr(payload, "referencedAssetIds", []) or []))
    if not set(asset_ids).issubset(allowed_assets):
        raise HTTPException(409, "引用的素材已变化，请刷新素材列表后重试")
    selected_assets = [allowed_assets[asset_id] for asset_id in asset_ids]
    precise_nodes = {item.get("nodeId") for item in selected_assets if item.get("source") == "canvas"}
    for item in node_reference_assets(canvas):
        if item["nodeId"] in ids and item["nodeId"] not in precise_nodes:
            target = videos if item["kind"] == "video" else images
            if item["url"] not in target:
                target.append(item["url"])
    context_assets = []
    for item in selected_assets:
        url = item.get("url")
        kind = reference_kind(item)
        entry = {"id": item.get("id"), "referenceNumber": list(allowed_assets).index(item["id"]) + 1, "name": str(item.get("name") or "素材")[:300], "kind": kind, "url": url}
        if kind == "video":
            if url not in videos:
                videos.append(url)
        elif url not in images:
            images.append(url)
        context_assets.append(entry)
    context = {"title": canvas.get("title"), "kind": canvas.get("kind"), "nodes": nodes, "assets": context_assets[:20], "selectedNodeIds": payload.selectedNodeIds, "referencedNodeIds": payload.referencedNodeIds, "referencedAssetIds": asset_ids, "connections": [{"from": c.get("from"), "to": c.get("to")} for c in canvas.get("connections", [])[:150] if isinstance(c, dict)]}
    context["availableImageAssets"] = [{k: item[k] for k in ("id", "nodeId", "name")} for item in node_reference_assets(canvas) if item["kind"] == "image"][:100]
    context['availableVideoAssets'] = [{k:item[k] for k in ('id','nodeId','name')} for item in node_reference_assets(canvas) if item['kind']=='video'][:100]
    context["counts"] = {"nodes": len(context_nodes), "connections": len(canvas.get("connections", [])), "assets": len(selected_assets)}
    context["truncation"] = {"nodes": len(nodes) != len(context_nodes), "connections": len(canvas.get("connections", [])) > 150,
                             "assets": len(context_assets) > 20, "text": any(len(str(n.get(k, ""))) > 1800 for n in context_nodes[offset:offset + limit] for k in ("text", "prompt", "promptDraftText", "variablePrompt"))}
    context["page"] = {"offset": offset, "returned": len(nodes), "nextOffset": offset + len(nodes) if offset + len(nodes) < len(context_nodes) else None}
    context["readMore"] = "read_canvas 分页补读节点目录；read_node_state 补读正文、参数与每个数组的 pagination.arrays；不能把摘要当作完整画布。"
    if len(images) > 8 or len(videos) > 3:
        raise HTTPException(422, "一轮最多发送 8 张图片和 3 个视频，请减少引用或选中的媒体节点")
    return context, images, videos


def assistant_output_media(result):
    """只接受模型适配器已经解析出的真实图片结构，并限制为可被画布安全读取的地址。"""
    values = result.get("images") if isinstance(result, dict) else None
    if not isinstance(values, list):
        return []
    output = []
    for item in values[:8]:
        url = item.get("url") if isinstance(item, dict) else item
        if not isinstance(url, str) or not url.startswith(("/assets/", "/output/", "data:image/")):
            continue
        output.append({"url": url, "name": item.get("name") if isinstance(item, dict) else "助手图片"})
    return output


def model_image_identity(value):
    """关键帧内容只保存一份；读取证据使用摘要，不重复落入回执和消息日志。"""
    return 'sha256:' + hashlib.sha256(value.encode('utf-8')).hexdigest() if value.startswith('data:image/') else value
