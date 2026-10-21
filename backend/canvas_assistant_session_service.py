"""助手应用职责；会话状态、存储、策略和外部能力由原路由显式注入。"""


def identity(request, header, canvas_id, *, HTTPException, checked_id, load_canvas, user_id):
    checked_id(canvas_id)
    canvas = load_canvas(canvas_id)
    if canvas.get("id") != canvas_id:
        raise HTTPException(400, "画布编号不匹配")
    return user_id(header, request), canvas


async def status(*, HTTPException, apply_operations, knowledge, providers, skills):
    configured = providers()
    def catalog(category):
        return [{"id": p["id"], "name": p.get("name") or p["id"], "models": p[category],
                 "ready": bool(p.get("has_key") or p.get("protocol") in {"codex", "gemini-cli", "gemini_cli", "jimeng"})}
                for p in configured if p.get("enabled", True) and p.get(category)]
    knowledge_info = {"available": False, "version": "", "coverage": {}}
    if apply_operations:
        try:
            snapshot = knowledge.snapshot()
            knowledge_info = {"available": True, "version": snapshot.get("knowledgeVersion", ""), "coverage": {"entries": len(snapshot.get("entries", [])), "documented": sum(item.get("coverage", {}).get("documented") == "passed" for item in snapshot.get("entries", [])), "readable": sum(item.get("coverage", {}).get("readable") == "passed" for item in snapshot.get("entries", [])), "actionable": sum(item.get("coverage", {}).get("actionable") == "passed" for item in snapshot.get("entries", [])), "verified": sum(item.get("coverage", {}).get("verified") == "passed" for item in snapshot.get("entries", []))}}
        except HTTPException as exc:
            knowledge_info = {"available": False, "version": "", "coverage": {}, "error": str(exc.detail)}
    knowledge_info['coverageMeaning']='actionable/verified 仅统计整条能力完整登记为 passed 的数量；pending 不代表未接入，组件测试、模拟流程与真实供应商质量验收须分开查看。'
    return {"stage": "agent" if apply_operations else "conversation",
            "providers": catalog("chat_models"), "image_providers": catalog("image_models"),
            "skills": skills.index() if apply_operations else [], "knowledge": knowledge_info}


async def get_canvas(canvasId, request, x_user_id, *, canvas_overview, context_rules, identity):
    _, canvas = identity(request, x_user_id, canvasId)
    from types import SimpleNamespace
    context, _, _ = context_rules.canvas_context(canvas, SimpleNamespace(selectedNodeIds=[], referencedNodeIds=[]))
    return {"canvas": context, "overview": canvas_overview(canvas, offset=0, limit=50), "updatedAt": canvas.get("updated_at", 0)}


async def reference_assets(canvasId, request, x_user_id, *, asyncio, context_rules, identity, load_reference_assets):
    _, canvas = identity(request, x_user_id, canvasId)
    assets = await asyncio.to_thread(load_reference_assets) if load_reference_assets else []
    fields = ("id", "nodeId", "url", "thumbnail", "name", "kind", "source", "libraryId", "categoryId", "libraryName", "categoryName")
    return {"items": [{key: item.get(key, "") for key in fields} for item in [*context_rules.node_reference_assets(canvas), *assets] if context_rules.reference_kind(item)]}


async def sessions(canvasId, request, x_user_id, *, asyncio, identity, store):
    user, canvas = identity(request, x_user_id, canvasId)
    await asyncio.to_thread(store.reconcile, user, canvasId, canvas.get("assistant_receipts") or {})
    doc = await asyncio.to_thread(store.transact, user, canvasId)
    return {"activeSessionId": doc["activeSessionId"], "sessions": [{k: s[k] for k in ("id", "title", "createdAt")} for s in reversed(list(doc["sessions"].values()))]}


async def create(payload, request, x_user_id, *, asyncio, identity, store):
    user, _ = identity(request, x_user_id, payload.canvasId)
    return {"session": await asyncio.to_thread(store.create, user, payload.canvasId, payload.title)}


async def history(canvasId, sessionId, request, x_user_id, *, asyncio, identity, public_native, public_skill_usage, store):
    user, canvas = identity(request, x_user_id, canvasId)
    await asyncio.to_thread(store.reconcile, user, canvasId, canvas.get("assistant_receipts") or {})
    session=await asyncio.to_thread(store.history, user, canvasId, sessionId)
    for turn in session.get('turns',[]):
        turn['nativeActions']=[public_native(p) for p in turn.get('nativeActions',[])]
        turn['skillsUsed']=public_skill_usage(turn)
    return {"session":session}


async def cancel(payload, request, x_user_id, *, asyncio, checked_id, identity, running, store):
    user, _ = identity(request, x_user_id, payload.canvasId)
    checked_id(payload.requestId)
    turn = await asyncio.to_thread(store.stop, user, payload)
    task = running.get((user, payload.canvasId, payload.sessionId, payload.requestId))
    if turn["state"] == "cancelled" and task and not task.done():
        task.cancel()
    return {"state": turn["state"]}
