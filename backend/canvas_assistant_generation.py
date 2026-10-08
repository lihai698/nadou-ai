"""图片提议的原生节点和确认快照；不负责供应商执行、轮询或结果保存。"""
from __future__ import annotations

import hashlib
import html
import json
import math
import re

from fastapi import HTTPException


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


SETTING_FIELDS = ("engine", "apiKind", "provider_id", "model", "ratio", "resolution", "quality", "customRatio", "customSize", "customRatioWidth", "customRatioHeight", "customWidth", "customHeight", "count")
NODE_FIELDS = ("id", "type", "title", "text", "promptDraftText", "url", "images", "apiProvider", "model", "ratio", "resolution", "quality", "count", "customRatio", "customSize", "customRatioWidth", "customRatioHeight", "customWidth", "customHeight", "inputNodeIds", "inputs")

# 与两种原生画布的 SIZE_MAP 一致；仅校验确认请求，不负责生成。
SIZE_CHOICES = {
    'square': ('1024x1024','2048x2048','4096x4096'), 'portrait': ('1024x1536','1360x2048','2352x3520'),
    'landscape': ('1536x1024','2048x1360','3520x2352'), 'portrait43': ('1008x1344','1536x2048','2448x3264'),
    'landscape43': ('1344x1008','2048x1536','3264x2448'), 'story': ('720x1280','1152x2048','2160x3840'),
    'wide': ('1280x720','2048x1152','3840x2160'), 'ultrawide': ('1280x544','2048x880','3840x1648'),
    'ultratall': ('544x1280','880x2048','1648x3840'),
}
RATIO_VALUES = dict(zip(SIZE_CHOICES, ('1:1','2:3','3:2','3:4','4:3','9:16','16:9','21:9','9:21')))


def node_content(node):
    result = {key: node[key] for key in NODE_FIELDS if key in node}
    if not result.get("images"):
        result.pop("images", None)  # 原生智能画布保存会给提示词节点补空 images。
    if node.get("runSettings"):
        result["runSettings"] = {k: node["runSettings"][k] for k in SETTING_FIELDS if k in node["runSettings"]}
    return result


def canvas_signature(canvas):
    # 排除显示尺寸、坐标和运行计时；原生渲染调整布局不改变生成内容。
    return digest({"nodes": [node_content(n) for n in canvas.get("nodes", [])], "connections": canvas.get("connections", []),
                   "settings": {k: canvas.get("settings", {})[k] for k in SETTING_FIELDS if k in canvas.get("settings", {})}})


def provider_signature(providers, provider_id, model):
    provider = next((p for p in providers if p.get("id") == provider_id and p.get("enabled", True)), None)
    if not provider or model not in (provider.get("image_models") or []):
        raise HTTPException(409, "所选图片模型或平台配置已变化，请重新提出生成方案")
    return digest(provider)


def target_signature(canvas, proposal):
    ids = set(proposal["nodeIds"])
    nodes = [node_content(n) for n in canvas.get("nodes", []) if n.get("id") in ids and n.get("id") != proposal["nodeId"]] + \
            [{k: v for k, v in node_content(n).items() if k != "images"} for n in canvas.get("nodes", []) if n.get("id") == proposal["nodeId"]]
    # 原生普通画布会自动接下游 output；它不改变本方案输入。
    edges = [edge for edge in canvas.get('connections', []) if edge.get('to') in ids]
    return digest({'nodes':nodes, 'connections':edges})


def add_image_proposal(canvas, op, *, key, settings, reference_images, x, y):
    from backend.canvas_assistant_operations import CreateNode, new_node
    kind = canvas.get("kind", "classic")
    proposal_id = "proposal_" + digest([key, op.operationId])[:28]
    prompt_id, target_id = proposal_id + "_prompt", proposal_id + "_image"
    prompt_op = CreateNode(op="create", operationId="p", ref="p", type="prompt", title=op.title or "图片提示词", content=op.prompt)
    target_op = CreateNode(op="create", operationId="g", ref="g", type="image_generator", title=op.title or "图片生成", content="")
    prompt = new_node(kind, prompt_op, prompt_id, x, y, settings, canvas.get("updated_at", 0))
    target = new_node(kind, target_op, target_id, x + 400, y, settings, canvas.get("updated_at", 0))
    if kind == "smart":
        for name in ("mode", "showPrompt", "imageInput", "loopStart", "imageBatchSize", "variablePrompt"):
            target.pop(name, None)
        target.update(type="smart-image", images=[], outputKind="image", promptDraftText=op.prompt, promptDraftHtml=html.escape(op.prompt))
    else:
        target["count"] = 1
        target["_apiResolutionUserSet"] = True
    created = [prompt, target]
    input_ids = [prompt_id]
    refs = list(dict.fromkeys(reference_images or []))
    for index, url in enumerate(refs):
        node_id = proposal_id + f"_ref{index}"
        ref = {"id": node_id, "type": "smart-image" if kind == "smart" else "image", "x": x, "y": y + 300 + index * 220, "name": f"参考图 {index + 1}"}
        ref.update({"images": [{"url": url}], "outputKind": "image"} if kind == "smart" else {"url": url})
        created.append(ref)
        input_ids.append(node_id)
    target["inputNodeIds" if kind == "smart" else "inputs"] = input_ids
    edges = [{"id": proposal_id + f"_edge{i}", "from": node_id, "to": target_id, **({"kind": "input"} if kind == "smart" else {})} for i, node_id in enumerate(input_ids)]
    canvas["nodes"].extend(created)
    canvas["connections"].extend(edges)
    return {"id": proposal_id, "canvasId": canvas["id"], "kind": "image", "title": op.title or "图片生成方案", "nodeId": target_id, "nodeIds": [n["id"] for n in created],
            "prompt": op.prompt, "referenceImages": refs, "provider": settings["provider_id"], "model": settings["model"],
            "ratio": settings.get("ratio", "square"), "resolution": settings.get("resolution", "1k"), "quality": settings.get("quality", "auto"),
            "customRatio": settings.get("customRatio", ""), "customSize": settings.get("customSize", ""),
            "taskId": "canvas_img_assistant_" + digest([key, proposal_id])[:32], "state": "pending"}, created, edges


def bind_snapshot(canvas, proposal, providers):
    proposal["snapshotHash"] = canvas_signature(canvas)
    proposal["targetHash"] = target_signature(canvas, proposal)
    proposal["providerHash"] = provider_signature(providers, proposal["provider"], proposal["model"])
    proposal["providerName"] = next(p.get("name") or p["id"] for p in providers if p.get("id") == proposal["provider"])


def validate_snapshot(canvas, proposal, providers, expected_updated_at):
    if canvas.get("updated_at", 0) != expected_updated_at or canvas_signature(canvas) != proposal["snapshotHash"]:
        raise HTTPException(409, "画布内容或生成设置已变化，请保存修改后重新提出生成方案")
    if provider_signature(providers, proposal["provider"], proposal["model"]) != proposal["providerHash"]:
        raise HTTPException(409, "图片平台配置已变化，请重新提出生成方案")


def validate_image_request(proposal, image_request):
    allowed = {"prompt", "provider_id", "model", "size", "aspect_ratio", "resolution", "quality", "n", "reference_images"}
    if set(image_request) - allowed or image_request.get("n", 1) != 1:
        raise HTTPException(422, "本次方案只生成一张图片，请重新提出生成方案")
    refs = [item.get("url") if isinstance(item, dict) else item for item in image_request.get("reference_images", [])]
    if (image_request.get("provider_id"), image_request.get("model"), image_request.get("prompt"), refs) != (proposal["provider"], proposal["model"], proposal["prompt"], proposal["referenceImages"]):
        raise HTTPException(409, "生成请求与确认的方案不一致，请重新提出方案")
    size = image_request.get("size", "1024x1024")
    if size != "auto" and not re.fullmatch(r"[1-9][0-9]{0,4}x[1-9][0-9]{0,4}", size):
        raise HTTPException(422, "图片尺寸格式不正确")
    if image_request.get("quality", "auto") != proposal["quality"]:
        raise HTTPException(409, "图片质量设置与方案不一致，请重新提出方案")
    resolution, ratio = proposal['resolution'], proposal['ratio']
    if image_request.get('resolution', '') not in {'', resolution if resolution in {'1k','2k','4k'} else ''}:
        raise HTTPException(409, '图片分辨率与方案不一致，请重新提出方案')
    expected_aspect = RATIO_VALUES.get(ratio, proposal.get('customRatio', '') if ratio == 'custom' else '')
    if image_request.get('aspect_ratio', '') not in {'', expected_aspect}:
        raise HTTPException(409, '图片比例与方案不一致，请重新提出方案')
    if resolution == 'auto':
        expected_size = 'auto'
    elif resolution == 'custom':
        expected_size = proposal.get('customSize', '').strip()
    elif (ratio == 'custom' or (ratio == 'source' and not proposal['referenceImages'])) and proposal.get('customRatio'):
        parts = str(proposal['customRatio']).split(':')
        try:
            aspect = float(parts[0]) / float(parts[1]) if len(parts) == 2 else float(parts[0])
            long_side = {'1k':1536, '2k':2048, '4k':3840}.get(resolution, 1024)
            pixels = {'1k':1572864, '2k':4194304, '4k':8294400}.get(resolution, long_side ** 2)
            w = long_side if aspect >= 1 else min(long_side * aspect, math.sqrt(pixels * aspect))
            h = min(long_side / aspect, math.sqrt(pixels / aspect)) if aspect >= 1 else long_side
            expected_size = f'{max(64, math.floor(w / 16) * 16)}x{max(64, math.floor(h / 16) * 16)}'
        except (ValueError, ZeroDivisionError, OverflowError):
            raise HTTPException(422, '自定义图片比例不正确')
    elif ratio == 'source' and proposal['referenceImages']:
        # 适配参考图由原生客户端读取图片尺寸；仍约束所选分辨率的长边和像素预算。
        w, h = map(int, size.split('x'))
        limit = {'1k':1536, '2k':2048, '4k':3840}.get(resolution, 1536)
        pixels = {'1k':1572864, '2k':4194304, '4k':8294400}.get(resolution, 1572864)
        if max(w, h) > limit or w * h > pixels:
            raise HTTPException(409, '适配尺寸超出方案分辨率，请重新提出方案')
        return
    else:
        expected_size = SIZE_CHOICES.get(ratio, SIZE_CHOICES['square'])[{'1k':0,'2k':1,'4k':2}.get(resolution, 0)]
    if size != expected_size:
        raise HTTPException(409, '图片尺寸与方案不一致，请重新提出方案')
