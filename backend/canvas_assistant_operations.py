"""助手的有限画布操作；只构造候选文档，由入口持锁保存。"""
from __future__ import annotations

import copy
import hashlib
import html
import json

from fastapi import HTTPException
from backend.canvas_assistant_operation_schema import UpdateNode, ProposeImage, CreateStoryWorkflow, CreateStoryAnalysis, ImportStoryAnalysis, CreateShotPrompts, CreateShotImages
from backend.canvas_assistant_canvas_rules import content_hash, generation_settings, allowed_connection, would_cycle
from backend.canvas_assistant_node_rules import CreateNode, new_node, is_busy
from backend.canvas_assistant_story import create_story_nodes
from backend.canvas_assistant_story_schema import StoryWorkflow, StoryAnalysis, ShotPrompts, ShotImages
from backend.canvas_assistant_story_analysis import create_analysis, import_analysis
from backend.canvas_assistant_shot_prompts import create_shot_prompts, create_shot_images


def receipt_key(user, request_id):
    return hashlib.sha256((user + ":" + request_id).encode()).hexdigest()


def prepare_operations(canvas, operations, *, request_id, user, expected_updated_at, creation_settings, providers, image_model_confirmed=False, reference_images=None):
    """一批操作全部校验后生成候选；任何失败均不改传入文档。"""
    wire = [op.model_dump(by_alias=True, exclude_none=True) for op in operations]
    digest = hashlib.sha256(json.dumps(wire, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    key = receipt_key(user, request_id)
    previous = (canvas.get("assistant_receipts") or {}).get(key)
    if previous:
        if previous["operationHash"] != digest:
            raise HTTPException(409, "这一轮已执行过不同操作，请查看历史")
        return None, copy.deepcopy(previous)
    if canvas.get("updated_at", 0) != expected_updated_at:
        raise HTTPException(409, "画布刚刚被修改，本轮未执行，请保存后重试")
    candidate = copy.deepcopy(canvas)
    kind = canvas.get("kind", "classic")
    nodes = candidate.setdefault("nodes", [])
    connections = candidate.setdefault("connections", [])
    by_id = {node["id"]: node for node in nodes}
    aliases, operation_ids = {}, set()
    created, updated, edges, affected = [], [], [], []
    generation = None
    proposals = []
    workflows = []
    analyses = []
    shot_prompts = []
    shot_images = []
    # 新节点置于现有节点下方，不覆盖正在编辑的节点。
    base_y = max([float(n.get("y", 0)) + max(float(n.get("h", 300)), 300) for n in nodes] or [0]) + 90
    base_x = min([float(n.get("x", 100)) for n in nodes] or [100])
    for op in operations:
        if op.operationId in operation_ids:
            raise HTTPException(422, "同一轮操作编号重复，本轮未执行")
        operation_ids.add(op.operationId)
        if isinstance(op, CreateShotImages):
            if not image_model_confirmed:
                raise HTTPException(409,'请先手动选择并确认图片模型')
            settings=generation_settings(canvas,creation_settings,providers)
            added,linked,receipt=create_shot_images(candidate,ShotImages.model_validate(op.model_dump(exclude={'op','operationId'})),settings,key+':'+op.operationId)
            created.extend(added);edges.extend(linked);affected.extend([op.tableId,*added]);shot_images.append(receipt)
            by_id.update({n['id']:n for n in nodes})
        elif isinstance(op, CreateShotPrompts):
            added,linked,receipt=create_shot_prompts(candidate,ShotPrompts.model_validate(op.model_dump(exclude={'op','operationId'})),creation_settings or {},providers)
            created.extend(added);edges.extend(linked);affected.extend([op.tableId,*added]);shot_prompts.append(receipt)
            by_id.update({n['id']:n for n in nodes})
        elif isinstance(op, CreateStoryAnalysis):
            added,linked,analysis=create_analysis(candidate,StoryAnalysis.model_validate(op.model_dump(exclude={'op','operationId'})),creation_settings or {},providers)
            created.extend(added);edges.extend(linked);affected.extend([op.sourceNodeId,*added]);analyses.append(analysis)
            by_id.update({n['id']:n for n in nodes})
        elif isinstance(op, ImportStoryAnalysis):
            added,linked,workflow=import_analysis(candidate,op.analysisNodeId)
            created.extend(added);edges.extend(linked);affected.extend([op.analysisNodeId,workflow['tableId']]);workflows.append(workflow)
            by_id.update({n['id']:n for n in nodes})
        elif isinstance(op, CreateStoryWorkflow):
            if not image_model_confirmed:
                raise HTTPException(409, '请先手动选择并勾选图片模型，工作流只创建节点、不生成')
            generation = generation_settings(canvas, creation_settings, providers)
            data = StoryWorkflow.model_validate(op.model_dump(exclude={'op', 'operationId'}))
            added, linked, workflow = create_story_nodes(candidate, data, key=key+':'+op.operationId, settings=generation, x=base_x, y=base_y)
            created.extend(added); edges.extend(linked); affected.extend([op.sourceNodeId,*added]);workflows.append(workflow)
            by_id.update({n['id']:n for n in nodes})
        elif isinstance(op, ProposeImage):
            if proposals:
                raise HTTPException(422, "一轮只提出一个图片方案，请分开创作")
            if not image_model_confirmed:
                raise HTTPException(409, "请先在模型选择中指定并勾选图片模型，再提出生成方案")
            from backend.canvas_assistant_generation import add_image_proposal
            generation = generation_settings(canvas, creation_settings, providers)
            if not generation.get("provider_id") or not generation.get("model"):
                raise HTTPException(409, "请先指定图片模型")
            proposal, added_nodes, added_edges = add_image_proposal(candidate, op, key=key, settings=generation,
                reference_images=reference_images, x=base_x, y=base_y + len(created) * 360)
            proposals.append(proposal)
            for node in added_nodes:
                by_id[node["id"]] = node
                created.append(node["id"])
                affected.append(node["id"])
            edges.extend(edge["id"] for edge in added_edges)
        elif isinstance(op, CreateNode):
            if op.ref in aliases or op.ref in by_id:
                raise HTTPException(422, "新节点引用名称重复，本轮未执行")
            node_id = "assistant_" + hashlib.sha256((key + ":" + op.ref).encode()).hexdigest()[:28]
            if node_id in by_id:
                raise HTTPException(409, "助手节点编号已存在，请查看画布")
            if op.type in {"image_generator", "video_generator"} and generation is None:
                generation = generation_settings(canvas, creation_settings, providers)
            index = len(created)
            node = new_node(kind, op, node_id, base_x + (index % 3) * 400, base_y + (index // 3) * 360, generation or {}, expected_updated_at)
            aliases[op.ref] = node_id
            nodes.append(node); by_id[node_id] = node; created.append(node_id)
            affected.append(node_id)
        elif isinstance(op, UpdateNode):
            node_id = aliases.get(op.nodeId, op.nodeId)
            node = by_id.get(node_id)
            if not node:
                raise HTTPException(409, "要修改的节点已不存在，本轮未执行")
            if is_busy(node):
                raise HTTPException(409, "目标节点正在运行，本轮未修改，请等待任务结束")
            if all(value is None for value in (op.title, op.content, op.x, op.y)):
                raise HTTPException(422, "节点修改没有提供内容，本轮未执行")
            before = copy.deepcopy(node)
            for field in ('x', 'y'):
                value = getattr(op, field)
                if value is not None:
                    node[field] = value
            if op.title is not None:
                node["title"] = op.title
            if op.content is not None:
                if node.get("type") in {"prompt", "text", "smart-prompt"}:
                    node["text"] = op.content
                    if node.get('storyWorkflowOrigin'):
                        from backend.canvas_assistant_story import sync_story_prompt
                        synced = sync_story_prompt(candidate, node, op.content)
                        updated.extend(nid for nid in synced if nid not in updated)
                        affected.extend(synced)
                elif kind == "smart" and node.get("type") in {"smart-loop", "smart-image"}:
                    node.update(promptDraftText=op.content, promptDraftHtml=html.escape(op.content), promptDraftTouched=True)
                else:
                    raise HTTPException(422, "此节点正文不可直接修改，请修改它的提示词节点")
            if node != before and node_id not in updated:
                updated.append(node_id)
                affected.append(node_id)
        else:
            source_id, target_id = aliases.get(op.from_, op.from_), aliases.get(op.to, op.to)
            source, target = by_id.get(source_id), by_id.get(target_id)
            if not source or not target or source_id == target_id:
                raise HTTPException(422, "连线目标无效，本轮未执行")
            if is_busy(target):
                raise HTTPException(409, "连线目标正在运行，本轮未执行")
            affected.extend([source_id, target_id])
            if not allowed_connection(kind, source, target):
                raise HTTPException(422, "这两类节点不能连接，本轮未执行")
            connection_kind = "input" if kind == "smart" else None
            duplicate = any(c.get("from") == source_id and c.get("to") == target_id and (kind != "smart" or c.get("kind", "flow") == "input") for c in connections)
            if not duplicate:
                if would_cycle(connections, source_id, target_id):
                    raise HTTPException(422, "连线会形成循环，本轮未执行")
                edge_id = "assistant_edge_" + hashlib.sha256((key + ":" + op.operationId).encode()).hexdigest()[:24]
                connection = {"id": edge_id, "from": source_id, "to": target_id}
                if connection_kind:
                    connection["kind"] = connection_kind
                connections.append(connection); edges.append(edge_id)
            if kind == "smart":
                target["inputNodeIds"] = list(dict.fromkeys([*(target.get("inputNodeIds") or []), source_id]))
                if target.get("type") == "smart-loop":
                    if source.get("type") == "smart-prompt" or source.get("showPrompt"):
                        target["showPrompt"] = True
                    if source.get("type") in {"smart-image", "smart-group"} or source.get("imageInput"):
                        target["imageInput"] = True
    # 只记录受控字段差异，用于普通画布保留同一时刻尚未保存的手动编辑。
    originals = {node["id"]: node for node in canvas.get("nodes", [])}
    patches = []
    for node in nodes:
        original = originals.get(node["id"])
        if original is None:
            continue
        changes = {name: {"before": original.get(name), "after": node.get(name)}
                   for name in ("title", "text", "promptDraftText", "promptDraftHtml", "promptDraftTouched", "inputNodeIds", "showPrompt", "imageInput", "shotTableData", "storyWorkflowOrigin", "x", "y")
                   if original.get(name) != node.get(name)}
        if changes:
            patches.append({"nodeId": node["id"], "fields": changes})
            if node["id"] not in updated:
                updated.append(node["id"])
    summary = {"createdNodeIds": created, "updatedNodeIds": updated, "createdEdgeIds": edges, "affectedNodeIds": list(dict.fromkeys(affected)), "nodePatches": patches,
               "operationIds": [op.operationId for op in operations], "operationHash": digest,
               "updatedAtBefore": expected_updated_at, "contentHashBefore": content_hash(canvas), "contentHashAfter": content_hash(candidate)}
    if workflows:
        summary['storyWorkflows'] = workflows
    if analyses:
        summary['storyAnalyses'] = analyses
    if shot_images:
        summary['shotImages'] = shot_images
    if shot_prompts:
        summary['shotPrompts'] = shot_prompts
    if proposals:
        from backend.canvas_assistant_generation import bind_snapshot
        for proposal in proposals:
            bind_snapshot(candidate, proposal, providers)
        summary["proposals"] = proposals
    receipts = candidate.setdefault("assistant_receipts", {})
    receipts[key] = summary
    while len(receipts) > 100:
        del receipts[next(iter(receipts))]
    return candidate, summary
