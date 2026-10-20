"""助手节点公共规则：严格创建输入、原生节点构造与原任务忙碌保护。

只处理传入数据；不依赖助手编排、持久化、模型服务或主入口。
"""
from __future__ import annotations

import html
from typing import Literal

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field


class StrictOperation(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    operationId: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,60}$")


class CreateNode(StrictOperation):
    op: Literal["create"]
    ref: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,40}$")
    type: Literal["prompt", "text", "image_generator", "video_generator", "storyboard"]
    title: str = Field(default="", max_length=80)
    content: str = Field(default="", max_length=12000)


def new_node(kind, op, node_id, x, y, settings, created_at):
    node = {"id": node_id, "x": x, "y": y, "title": op.title or {"prompt": "提示词", "text": "文本", "image_generator": "图片生成", "video_generator": "视频生成", "storyboard": "分镜表"}[op.type]}
    if op.type == "storyboard":
        if op.content:
            raise HTTPException(422, "空白分镜表不接受正文；创建后使用原生分镜编辑")
        labels = [("shotSize", "景别"), ("motion", "运镜"), ("visual", "画面"), ("dialogue", "对白"), ("onScreenText", "屏幕文字"), ("mood", "情绪")]
        extra = [("scene", "场景"), ("characters", "角色"), ("props", "道具"), ("sounds", "音效 / 配乐"), ("voice", "声音 / 旁白"), ("camera", "机位 / 构图"), ("action", "动作"), ("transition", "衔接")]
        node.update(type="smart-shot-table" if kind == "smart" else "shot-table", name=node["title"], w=1120, h=390,
                    shotTableData={"version": 1, "source": {"kind": "manual", "nodeId": "", "sourceUrl": "", "title": node["title"], "fingerprint": "manual-" + node_id, "durationSeconds": 0},
                                   "columns": [{"id": k, "label": v, "kind": "builtin"} for k, v in labels] + [{"id": k, "label": v, "kind": "custom", "hint": v} for k, v in extra],
                                   "rows": [], "selectedRowIds": [], "revision": 0, "analysisSettings": {}, "generationMap": {}, "task": {"status": "ready"}})
        return node
    if op.type in {"prompt", "text"}:
        node.update(type="smart-prompt" if kind == "smart" else op.type, text=op.content)
        if kind == "smart":
            node.update(w=316, h=240, promptSeparator=";", promptSplitEnabled=False, llmEnabled=False, llmSystemEnabled=False, created_at=created_at)
        return node
    video = op.type == "video_generator"
    if kind == "smart":
        run_settings = {**settings, "engine": "api", "apiKind": "video" if video else "image", "count": 1}
        node.update(type="smart-image" if video else "smart-loop", created_at=created_at,
                    runSettings=run_settings, promptDraftText=op.content, promptDraftHtml=html.escape(op.content), promptDraftTouched=True)
        if video:
            node.update(images=[], outputKind="video")
        else:
            node.update(w=340, h=248, count=1, mode="serial", showPrompt=True, imageInput=False, loopStart=1, imageBatchSize=1, variablePrompt="")
    else:
        node.update(type="video" if video else "generator", inputs=[], apiProvider=settings.get("videoProvider" if video else "provider_id", ""), model=settings.get("videoModel" if video else "model", ""))
        if op.content:
            raise HTTPException(422, "普通生成节点需要连接提示词节点，请将正文写入提示词节点")
        if video:
            node.update(duration=settings.get("videoDuration", 5), aspectRatio=settings.get("videoAspect", "16:9"), resolution=settings.get("videoResolution", ""),
                        enhancePrompt=settings.get("videoEnhancePrompt", False), enableUpsample=settings.get("videoEnableUpsample", False), watermark=settings.get("videoWatermark", False),
                        cameraFixed=settings.get("videoCameraFixed", False), generateAudio=settings.get("videoGenerateAudio", False), useFrameRoles=settings.get("videoUseFrameRoles", False), multimodal=settings.get("videoMultimodal", False), tempShLinks=[], running=False)
        else:
            node.update(ratio=settings.get("ratio", "square"), resolution=settings.get("resolution", "1k"), quality=settings.get("quality", "auto"), customRatio="", customSize="", customRatioWidth="", customRatioHeight="", customWidth="", customHeight="")
            node.update({name: settings[name] for name in ("customRatio", "customSize", "customRatioWidth", "customRatioHeight", "customWidth", "customHeight") if name in settings})
    return node


def audio_task_active(node):
    # 查询暂停、受理未知仍属于原任务；running=false 不能解除操作保护。
    return bool(node.get("audioTaskId") and node.get("audioStatus") not in {"done", "failed", "cancelled", "canceled"})


def is_busy(node):
    capture = node.get("depthCapture") or {}
    terminal = {"succeeded", "success", "completed", "failed", "cancelled", "canceled", "ready", "no-speech", "dismissed"}
    def unfinished(items):
        if not isinstance(items, list):
            return bool(items)
        return any(not isinstance(item, dict) or str(item.get("status", "")).lower() not in terminal for item in items)
    return bool(audio_task_active(node) or node.get("running") or node.get("pending") or unfinished(node.get("pendingTasks")) or unfinished(node.get("_pending")) or
                unfinished(node.get("_directPending")) or node.get("jimengPending") or
                (capture and capture.get("status") not in {"succeeded", "failed", "cancelled"}))
