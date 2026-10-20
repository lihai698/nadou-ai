"""助手会话历史、执行归属与回执恢复；由路由注入数据根目录和写入操作。

仅本模块通过原子 JSON 与进程锁读写会话历史，不加载 HTTP 路由或执行器。
"""
from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import re
import time
import uuid
from pathlib import Path
from threading import RLock

from fastapi import HTTPException

from backend.atomic_json import write_json_atomic
from backend.process_lock import interprocess_file_lock
from backend import canvas_assistant_plan as persistent_plan
from backend.canvas_assistant_receipt_rules import receipt_key


def checked_id(value):
    if not re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", value or ""):
        raise HTTPException(400, "无效的助手或画布编号")
    return value


class AssistantStore:
    def __init__(self, root, owner=None):
        self.root = root
        self.owner = owner or uuid.uuid4().hex
        self.lock = RLock()

    def path(self, user, canvas_id):
        checked_id(canvas_id)
        user_key = hashlib.sha256(user.encode("utf-8")).hexdigest()
        return Path(self.root()) / user_key / f"{canvas_id}.json"

    def transact(self, user, canvas_id, change=None):
        path = self.path(user, canvas_id)
        with self.lock, interprocess_file_lock(str(path)):
            try:
                doc = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"sessions": {}, "activeSessionId": ""}
                if not isinstance(doc, dict) or not isinstance(doc.get("sessions"), dict):
                    raise ValueError("invalid store")
                if any(not isinstance(s, dict) or not isinstance(s.get("turns"), list) for s in doc["sessions"].values()):
                    raise ValueError("invalid session")
            except (ValueError, OSError) as exc:
                raise HTTPException(500, "助手历史文件无法读取，原文件已保留") from exc
            recovered = False
            for session in doc["sessions"].values():
                for turn in session["turns"]:
                    if turn.get("state") == "running" and turn.get("owner") != self.owner:
                        plan = (turn.get('agent') or {}).get('plan')
                        if plan and plan['state'] == 'running':
                            turn['agent']['plan'] = persistent_plan.stop_plan(plan, execution_id=plan['executionId'])
                        turn.update(state="interrupted", error="服务已重启，这一轮未完成，请确认后重试")
                        recovered = True
            result = change(doc) if change else doc
            if change or recovered:
                write_json_atomic(path, doc)
            return result

    def session(self, doc, session_id):
        checked_id(session_id)
        session = doc["sessions"].get(session_id)
        if not session:
            raise HTTPException(404, "当前画布中找不到这段对话")
        return session

    def create(self, user, canvas_id, title):
        def change(doc):
            if len(doc["sessions"]) >= 50:
                raise HTTPException(409, "当前画布对话数量已达上限")
            session = {"id": uuid.uuid4().hex, "title": title.strip() or "新对话", "createdAt": int(time.time() * 1000), "turns": []}
            doc["sessions"][session["id"]] = session
            doc["activeSessionId"] = session["id"]
            return session
        return self.transact(user, canvas_id, change)

    def history(self, user, canvas_id, session_id):
        def change(doc):
            session = self.session(doc, session_id)
            doc["activeSessionId"] = session_id
            return session
        return self.transact(user, canvas_id, change)

    def start(self, user, payload):
        checked_id(payload.requestId)
        def change(doc):
            session = self.session(doc, payload.sessionId)
            if any(t.get("id") == payload.requestId for t in session["turns"]):
                raise HTTPException(409, "这条消息已提交，请先查看对话历史")
            if any(t.get("state") in {"running", "waiting_confirmation", "waiting_result"}
                   for s in doc["sessions"].values() for t in s["turns"]):
                raise HTTPException(409, "当前画布的助手仍在回复，请先停止或等待")
            if len(session["turns"]) >= 200:
                raise HTTPException(409, "这段对话已达上限，请新建对话")
            previous = []
            for turn in session["turns"][-12:]:
                if turn.get("state") == "completed":
                    previous.extend([{"role": "user", "content": turn["message"]}, {"role": "assistant", "content": turn["reply"]}])
            payload._execution_id = uuid.uuid4().hex
            session["turns"].append({"id": payload.requestId, "message": payload.message, "reply": "", "state": "running", "owner": self.owner, "executionId": payload._execution_id, "createdAt": int(time.time() * 1000), "provider": payload.provider, "model": payload.model, "selectedNodeIds": payload.selectedNodeIds, "referencedNodeIds": payload.referencedNodeIds, "referencedAssetIds": getattr(payload, "referencedAssetIds", [])})
            if len(session["turns"]) == 1 and session["title"] == "新对话":
                session["title"] = payload.message.strip()[:30]
            doc["activeSessionId"] = payload.sessionId
            return previous
        return self.transact(user, payload.canvasId, change)

    def finish(self, user, canvas_id, session_id, request_id, state, reply="", error="", media=None, execution_id=None):
        def change(doc):
            session = self.session(doc, session_id)
            turn = next((t for t in session["turns"] if t["id"] == request_id), None)
            if not turn:
                raise HTTPException(404, "助手回合不存在")
            if turn["state"] == "running" and (execution_id is None or (turn.get("owner") == self.owner and turn.get("executionId") == execution_id)):
                plan = (turn.get('agent') or {}).get('plan')
                if plan and plan['state'] == 'running' and state in {'interrupted', 'paused', 'failed'}:
                    turn['agent']['plan'] = persistent_plan.stop_plan(plan, execution_id=plan['executionId'], reason='interrupted' if state == 'failed' else state)
                turn.update(state=state, reply=reply, error=error)
                if media is not None:
                    turn["media"] = media
            return turn
        return self.transact(user, canvas_id, change)

    def plan(self, user, payload, reply):
        def change(doc):
            turn = next(t for t in self.session(doc, payload.sessionId)["turns"] if t["id"] == payload.requestId)
            if turn["state"] == "running":
                turn["plannedReply"] = reply
        self.transact(user, payload.canvasId, change)

    def checkpoint(self, user, payload, agent, step=None):
        def change(doc):
            turn = next(t for t in self.session(doc, payload.sessionId)["turns"] if t["id"] == payload.requestId)
            if turn.get("owner") != self.owner or turn.get("executionId", "") != payload._execution_id:
                raise asyncio.CancelledError()
            if turn["state"] != "running":
                # 旧协议原子操作已经结束，只允许落其最后一次步骤回执。
                if not (step and step.get("tool") == "legacy_operations" and turn["state"] == "completed"):
                    raise asyncio.CancelledError()
            turn["agent"] = copy.deepcopy(agent)
            if step:
                turn["plannedReply"] = step.get("reply", "")
                steps = turn.setdefault("steps", [])
                existing = next((item for item in steps if item["id"] == step["id"]), None)
                if existing:
                    existing.update(copy.deepcopy(step))
                else:
                    steps.append(copy.deepcopy(step))
            return copy.deepcopy(turn)
        return self.transact(user, payload.canvasId, change)

    def apply_step(self, user, payload, operations, apply_operations, step_id, reply, legacy=False):
        # 写入与停止共用历史锁；每一步复用原生固定编号回执。
        def change(doc):
            turn = next(t for t in self.session(doc, payload.sessionId)["turns"] if t["id"] == payload.requestId)
            if turn["state"] != "running" or turn.get("owner") != self.owner or turn.get("executionId", "") != payload._execution_id:
                raise asyncio.CancelledError()
            step_payload = payload.model_copy(update={"requestId": step_id})
            summary = apply_operations(user, step_payload, operations) if operations else None
            if legacy:
                turn.update(state="completed", reply=reply, error="")
            if summary:
                turn["change"] = merge_changes(turn.get("change"), summary)
                if summary.get("proposals"):
                    turn.setdefault("proposals", []).extend(copy.deepcopy(summary["proposals"]))
                turn.setdefault("writeReceipts", {})[step_id] = copy.deepcopy(summary)
            return copy.deepcopy(summary or {})
        return self.transact(user, payload.canvasId, change)

    def reconcile(self, user, canvas_id, receipts):
        def change(doc):
            for session in doc["sessions"].values():
                for turn in session["turns"]:
                    if turn.get("agent"):
                        # 本进程的执行器会保存最终 checkpoint；历史读取不能抢走其执行权。
                        if turn.get("state") == "running" and turn.get("owner") == self.owner:
                            continue
                        for step in turn.get("steps", []):
                            receipt = receipts.get(receipt_key(user, step["id"]))
                            if receipt and (step["id"] not in turn.get("writeReceipts", {}) or step["state"] == "running" or not turn.get("change")):
                                if not turn.get("change"):
                                    for saved_receipt in turn.get("writeReceipts", {}).values():
                                        turn["change"] = merge_changes(turn.get("change"), saved_receipt)
                                if step["id"] not in turn.get("writeReceipts", {}):
                                    turn["change"] = merge_changes(turn.get("change"), receipt)
                                turn.setdefault("writeReceipts", {})[step["id"]] = copy.deepcopy(receipt)
                                step.update(state="succeeded", result={"change": copy.deepcopy(receipt)})
                                for proposal in receipt.get("proposals", []):
                                    if not any(p["id"] == proposal["id"] for p in turn.get("proposals", [])):
                                        turn.setdefault("proposals", []).append(copy.deepcopy(proposal))
                                if turn.get("state") != "cancelled":
                                    turn.update(state="interrupted", error="已恢复保存回执，请核对画布后继续，不会重复写入")
                                turn["agent"]["payload"]["expectedUpdatedAt"] = receipt.get("updatedAtAfter", 0)
                                if not any(m.get("kind") == "tool_result" and m.get("id") == step["id"] for m in turn["agent"]["messages"]):
                                    turn["agent"]["messages"].append({"kind": "tool_result", "id": step["id"], "ok": True, "result": {"change": receipt}})
                                if step["tool"] == "legacy_operations" and turn.get("state") != "cancelled":
                                    turn.update(state="completed", reply=turn.get("plannedReply") or "画布操作已保存，请在画布上查看。", error="")
                        continue
                    receipt = receipts.get(receipt_key(user, turn["id"]))
                    if receipt and not turn.get("change"):
                        turn.update(change=receipt, state="completed", reply=turn.get("plannedReply") or "画布操作已保存，请在画布上查看。", error="")
                        if receipt.get("proposals") and not turn.get("proposals"):
                            turn["proposals"] = copy.deepcopy(receipt["proposals"])
        if receipts:
            self.transact(user, canvas_id, change)

    def stop(self, user, payload):
        def change(doc):
            turn = next((t for t in self.session(doc, payload.sessionId)["turns"] if t["id"] == payload.requestId), None)
            if not turn:
                raise HTTPException(404, "助手回合不存在")
            if turn.get("agent") and turn["state"] in {"running", "waiting_confirmation", "waiting_result", "interrupted", "paused"}:
                plan = turn['agent'].get('plan')
                if plan and plan['state'] not in {'completed', 'cancelled'}:
                    plan = persistent_plan.claim_plan(plan, canvas_id=payload.canvasId, session_id=payload.sessionId, execution_id=plan['executionId'] or turn['executionId'])
                    turn['agent']['plan'] = persistent_plan.stop_plan(plan, execution_id=plan['executionId'], reason='cancelled')
                turn.update(state="cancelled", error="已停止本轮；已受理任务仍可查询和回填")
            elif not turn.get("agent") and turn["state"] == "running":
                turn.update(state="cancelled", reply="", error="已停止本轮回复；上游可能仍在处理")
            return copy.deepcopy(turn)
        return self.transact(user, payload.canvasId, change)

    def turn(self, user, payload):
        def read(doc):
            turn = next((t for t in self.session(doc, payload.sessionId)["turns"] if t["id"] == payload.requestId), None)
            if not turn:
                raise HTTPException(404, "助手回合不存在")
            return copy.deepcopy(turn)
        return self.transact(user, payload.canvasId, read)

    def claim_continue(self, user, payload):
        def change(doc):
            session = self.session(doc, payload.sessionId)
            turn = next((t for t in session["turns"] if t["id"] == payload.requestId), None)
            if not turn or not turn.get("agent"):
                raise HTTPException(409, "旧回合请重新发送创作需求")
            if turn["state"] == "cancelled":
                raise HTTPException(409, "本轮已停止，请重新发送创作需求")
            if turn["state"] == "completed":
                if turn["agent"].get("consumedTasks"):
                    return copy.deepcopy(turn), False
                raise HTTPException(409, "这一轮已经完成")
            if any(t.get("state") == "running" for s in doc["sessions"].values() for t in s["turns"]):
                raise HTTPException(409, "当前画布有正在执行的助手回合，请等待或停止")
            execution_id = uuid.uuid4().hex
            plan = turn['agent'].get('plan')
            if plan and plan['state'] != 'completed':
                remaining=plan['budget']['limit'];used=plan['budget']['used']
                if any(remaining[key] is not None and used[key]>=remaining[key] for key in ('modelCalls','toolCalls','activeSeconds')):
                    raise HTTPException(409, '累计执行预算已用完，进度已保留；不能通过继续重置额度')
                if plan['state'] == 'running':
                    plan = persistent_plan.stop_plan(plan,execution_id=plan['executionId'])
                turn['agent']['plan'] = persistent_plan.claim_plan(plan, canvas_id=payload.canvasId, session_id=payload.sessionId, execution_id=execution_id)
                for step in turn.get('steps',[]):
                    receipt=turn.get('writeReceipts',{}).get(step['id'])
                    if step['tool']=='execute_plan_step' and (step.get('arguments') or {}).get('tool')=='apply_canvas_operations' and receipt:
                        ids=list(dict.fromkeys(receipt.get('createdNodeIds',[])+receipt.get('updatedNodeIds',[])+receipt.get('affectedNodeIds',[])))
                        turn['agent']['plan']=persistent_plan.record_step(turn['agent']['plan'],step['arguments']['stepId'],
                            {'id':step['id'],'state':'completed','nodeIds':ids},execution_id=execution_id)
                for proposal in turn.get('nativeActions',[]):
                    receipt=proposal.get('receipt') or {}
                    if proposal.get('planStepId') and receipt.get('state') in {'completed','accepted','failed','submission_unknown'}:
                        turn['agent']['plan']=persistent_plan.record_step(turn['agent']['plan'],proposal['planStepId'],
                            {'id':proposal['id'],'state':receipt['state'],'nodeIds':receipt.get('nodeIds',[]),
                             'tasks':[{'kind':receipt['taskKind'],'id':i} for i in receipt.get('taskIds',[])],
                             'error':receipt.get('error',''),**({'synchronousEvidence':receipt['synchronousEvidence']} if receipt.get('synchronousEvidence') else {})},execution_id=execution_id)
            turn.update(state="running", error="", owner=self.owner, executionId=execution_id)
            return copy.deepcopy(turn), True
        return self.transact(user, payload.canvasId, change)


def merge_changes(previous, current):
    if not previous:
        return copy.deepcopy(current)
    merged = {**previous, **copy.deepcopy(current)}
    for key in ("createdNodeIds", "updatedNodeIds", "createdEdgeIds", "affectedNodeIds"):
        merged[key] = list(dict.fromkeys([*previous.get(key, []), *current.get(key, [])]))
    merged["nodePatches"] = [*previous.get("nodePatches", []), *copy.deepcopy(current.get("nodePatches", []))]
    merged["proposals"] = [*previous.get("proposals", []), *copy.deepcopy(current.get("proposals", []))]
    return merged
