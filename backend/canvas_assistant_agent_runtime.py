"""助手应用职责；会话状态、存储、策略和外部能力由原路由显式注入。"""


async def drive_agent(user, payload, previous, agent, queue, *, AssistantPlan, HTTPException, ProjectKnowledge, SkillCatalog, apply_operations, asyncio, call_model, canvas_overview, context_rules, control_native_task, copy, create_persistent_plan, current_workflow_fields, load_canvas, load_reference_assets, media_export_control, media_export_prepare, native_catalog, native_task_reference, notify_changed, persistent_plan, prepare_native_action, providers, public_native, public_native_task, public_workflow_fields, query_image, query_native_task, read_lora_catalog, read_node_state, result_inspection, run_agent, store, validate_tool):
    if agent.get('plan') and agent['plan']['state'] == 'completed':
        await asyncio.to_thread(store.checkpoint,user,payload,agent)
        return {'state':'completed','reply':'创作计划的步骤已按真实保存回执完成，请在画布查看；作品质量仍须另外核验。'}
    def update_plan(change):
        def transaction(doc):
            turn = next(t for t in store.session(doc, payload.sessionId)['turns'] if t['id'] == payload.requestId)
            if turn['state'] != 'running' or turn.get('executionId') != payload._execution_id or turn.get('owner') != store.owner:
                raise asyncio.CancelledError()
            plan = change(turn)
            turn.setdefault('agent', {})['plan'] = copy.deepcopy(plan)
            return copy.deepcopy(plan)
        return store.transact(user, payload.canvasId, transaction)
    async def budget(state, amounts, event_id):
        state['plan'] = await asyncio.to_thread(update_plan, lambda turn: persistent_plan.charge_budget(
            turn['agent']['plan'], event_id, amounts, execution_id=payload._execution_id))
        return state
    async def checkpoint(state, step=None):
        state["payload"] = payload.model_dump()
        saved = await asyncio.to_thread(store.turn, user, payload)
        if (saved.get('agent') or {}).get('plan'):
            state['plan'] = copy.deepcopy(saved['agent']['plan'])
            plan = state['plan']
            delta = state['activeSeconds'] - plan['budget']['used']['activeSeconds']
            if delta > 0:
                limit = plan['budget']['limit']['activeSeconds']
                remaining = None if limit is None else limit - plan['budget']['used']['activeSeconds']
                state = await budget(state, {'activeSeconds':delta if remaining is None else min(delta,remaining)}, f"time:{payload._execution_id}:{state['activeSeconds']}")
                if remaining is not None and delta > remaining:
                    raise persistent_plan.BudgetExhausted()
        await asyncio.to_thread(store.checkpoint, user, payload, state, step)
    async def read_current(node_ids=None, *, offset=0, limit=100):
        current = await asyncio.to_thread(load_canvas, payload.canvasId)
        assets = await asyncio.to_thread(load_reference_assets) if load_reference_assets and payload.referencedAssetIds else []
        selection = payload.model_copy(update={"selectedNodeIds": node_ids}) if node_ids is not None else payload
        context, images, videos = context_rules.canvas_context(current, selection, assets, offset=offset, limit=limit)
        context["updatedAt"] = current.get("updated_at", 0)
        context["imageModel"] = {k: payload.creationSettings.get(k) for k in ("provider_id", "model", "ratio", "resolution", "quality")}
        context["imageModelConfirmed"] = payload.imageModelConfirmed
        return current, context, images, videos
    async def own_proposal(proposal_id):
        turn = await asyncio.to_thread(lambda: copy.deepcopy(next(t for t in store.history(user, payload.canvasId, payload.sessionId)["turns"] if t["id"] == payload.requestId)))
        proposal = next((p for p in turn.get("proposals", []) if p["id"] == proposal_id), None)
        if not proposal:
            raise HTTPException(404, "只能读取本轮已有生成方案")
        return proposal
    async def execute(name, args, step_id, reply, legacy, plan_execution=False):
        saved_turn = await asyncio.to_thread(store.turn, user, payload)
        if (saved_turn.get('agent') or {}).get('plan') and name not in {'create_plan','execute_plan_step'} and not plan_execution:
            raise HTTPException(409, '已有创作计划，请通过 execute_plan_step 按依赖执行，不能绕过步骤')
        if name == 'execute_plan_step':
            inner_args = validate_tool(args['tool'], args['arguments'])
            def begin(turn):
                plan = turn['agent'].get('plan')
                if not plan:
                    raise HTTPException(409, '请先保存创作计划')
                step = next((s for s in plan['steps'] if s['id'] == args['stepId']), None)
                if step and step['state'] != 'pending':
                    raise HTTPException(409, '该计划步骤已开始，只能核对原回执；不会再次执行')
                service_calls = 0
                if args['tool'] == 'propose_native_action':
                    current = load_canvas(payload.canvasId)
                    preview = prepare_native_action(current, inner_args, step_id,
                        workflow_fields=current_workflow_fields(current,inner_args.get('nodeId')) if inner_args['action']=='workflow_parameters' else None,
                        creation_settings=payload.creationSettings,providers=providers(),image_model_confirmed=payload.imageModelConfirmed)
                    service_calls = (preview.get('runSettings') or {}).get('maxCalls',0)
                return persistent_plan.start_step(plan, args['stepId'], execution_id=payload._execution_id, service_calls=service_calls)
            await asyncio.to_thread(update_plan, begin)
            try:
                outcome = await execute(args['tool'], inner_args, step_id, reply, False, True)
            except HTTPException as exc:
                def fail_step(turn):
                    plan=copy.deepcopy(turn['agent']['plan'])
                    step=next(s for s in plan['steps'] if s['id']==args['stepId'])
                    if step['state']=='waiting_confirmation':
                        step.update(state='running',serviceCalls=0)
                    return persistent_plan.record_step(plan,args['stepId'],{'id':step_id,'state':'failed','error':str(exc.detail)[:2000]},execution_id=payload._execution_id)
                await asyncio.to_thread(update_plan,fail_step)
                raise
            if outcome.get('nativeActions'):
                def bind(doc):
                    turn = next(t for t in store.session(doc,payload.sessionId)['turns'] if t['id']==payload.requestId)
                    proposal = next(p for p in turn['nativeActions'] if p['id']==step_id)
                    proposal['planStepId'] = args['stepId']
                await asyncio.to_thread(store.transact,user,payload.canvasId,bind)
            else:
                change = outcome.get('change') or {}
                nodes = list(dict.fromkeys(change.get('createdNodeIds', []) + change.get('updatedNodeIds', []) + change.get('affectedNodeIds', [])))
                outcome['plan'] = await asyncio.to_thread(update_plan, lambda turn: persistent_plan.record_step(
                    turn['agent']['plan'], args['stepId'], {'id':step_id, 'state':'completed', 'nodeIds':nodes}, execution_id=payload._execution_id))
            return outcome
        if name == 'create_plan':
            saved_turn = await asyncio.to_thread(lambda: next(
                t for t in store.history(user, payload.canvasId, payload.sessionId)['turns']
                if t['id'] == payload.requestId
            ))
            existing = (saved_turn.get('agent') or {}).get('plan') or agent.get('plan')
            if existing:
                definition = [{k:s[k] for k in ('id','description','dependsOn')} for s in existing.get('steps',[])]
                if existing.get('goal') == args['goal'] and definition == args['steps'] and existing.get('preserve') == args.get('preserve',[]) and existing.get('requirements') == args.get('requirements',[]):
                    return {'plan': copy.deepcopy(existing)}
                raise HTTPException(409, '本轮已有持久创作计划，请先按现有计划继续')
            plan = create_persistent_plan(
                plan_id=f'plan-{step_id}',
                canvas_id=payload.canvasId,
                session_id=payload.sessionId,
                goal=args['goal'],
                steps=args['steps'],
                preserve=args.get('preserve') or [],
                requirements=args.get('requirements') or [],
            )
            plan = persistent_plan.claim_plan(plan, canvas_id=payload.canvasId, session_id=payload.sessionId, execution_id=payload._execution_id)
            def initialize(turn):
                saved_agent = turn.get('agent') or {}
                return persistent_plan.charge_budget(plan, 'initial', {key:saved_agent.get(key,0) for key in ('modelCalls','toolCalls','activeSeconds')}, execution_id=payload._execution_id)
            return {'plan': await asyncio.to_thread(update_plan, initialize)}
        if name=='read_native_task':
            if not query_native_task:raise HTTPException(409,'当前入口尚未接入节点原任务查询')
            current=await asyncio.to_thread(load_canvas,payload.canvasId)
            node=native_task_reference(current,args['nodeId'],args['taskKind'],args['taskId'])
            task=await query_native_task(args['taskKind'],args['taskId'])
            if not isinstance(task,dict) or (task.get('id') or task.get('task_id'))!=args['taskId']:raise HTTPException(409,'原任务返回的编号不匹配，未接收结果')
            latest=await asyncio.to_thread(load_canvas,payload.canvasId)
            latest_node=native_task_reference(latest,args['nodeId'],args['taskKind'],args['taskId'])
            for owner_node in (node,latest_node):
                if task.get('canvas_id') and task['canvas_id']!=payload.canvasId or task.get('node_id') and task['node_id']!=owner_node['id']:raise HTTPException(409,'原任务保存的归属不匹配')
                if args['taskKind']=='depth':
                    capture=owner_node.get('depthCapture') or {}
                    if any(task.get(remote) and capture.get(local) and task[remote]!=capture[local] for remote,local in [('operation_id','operationId'),('source_url','sourceUrl')]):raise HTTPException(409,'原深度任务来源或操作编号已变化')
            return {'nodeId':node['id'],'taskKind':args['taskKind'],'task':public_native_task(task),'state':read_node_state(latest,node['id'])}
        if name == 'read_native_capabilities':
            current = await asyncio.to_thread(load_canvas, payload.canvasId)
            def configured_fields():
                result=[]
                for node in current.get('nodes',[]):
                    if node.get('type') not in {'rh','comfy'}:continue
                    if args.get('nodeId') and node['id']!=args['nodeId']:continue
                    try:
                        fields=public_workflow_fields(node,current_workflow_fields(current,node['id']))
                        offset=args.get('offset',0);limit=args.get('limit',50)
                        result.append({'nodeId':node['id'],'fields':fields[offset:offset+limit],
                            'total':len(fields),'offset':offset,'nextOffset':offset+limit if offset+limit<len(fields) else None})
                    except HTTPException as error:result.append({'nodeId':node['id'],'error':str(error.detail)})
                return result
            loras=[]
            for node in current.get('nodes',[]):
                if node.get('type')!='msgen' or node.get('msgenModel')!='custom' or args.get('nodeId') and node['id']!=args['nodeId']:continue
                try:loras.append(read_lora_catalog(node,providers()))
                except HTTPException as error:loras.append({'nodeId':node['id'],'error':str(error.detail)})
            return {'capabilities': native_catalog(current.get('kind', 'classic')),'workflowParameters':await asyncio.to_thread(configured_fields),'loraParameters':loras}
        if name == 'propose_native_action':
            if agent.get('knowledgeSnapshot') and ProjectKnowledge.changed(agent['knowledgeSnapshot']):
                raise HTTPException(409, '项目规则来源已变化，请复核后开始新回合；未提出原生动作')
            def register(doc):
                turn=next(t for t in store.session(doc,payload.sessionId)['turns'] if t['id']==payload.requestId)
                if turn['state']!='running' or turn.get('executionId')!=payload._execution_id or turn.get('owner')!=store.owner: raise asyncio.CancelledError()
                current=load_canvas(payload.canvasId)
                if current.get('updated_at',0)!=payload.expectedUpdatedAt: raise HTTPException(409,'画布已变化，请先读取画布再规划')
                proposal=prepare_native_action(current,args,step_id,workflow_fields=current_workflow_fields(current,args.get('nodeId')) if args['action']=='workflow_parameters' else None,
                    creation_settings=payload.creationSettings,providers=providers(),image_model_confirmed=payload.imageModelConfirmed,media_export_prepare=media_export_prepare)
                entry=next(r for r in native_catalog(current.get('kind','classic')) if r['type']==proposal['nodeType'])
                if proposal['action'] not in entry['availableActions']: raise HTTPException(422,'该动作尚未接入真实处理器，不能执行；请使用已开放动作')
                if proposal.get('serverAction') and not (media_export_control if proposal['action']=='media_export' else control_native_task):raise HTTPException(409,'当前入口尚未接入原任务控制，不登记可执行方案')
                proposal['baselineNodeIds']=[n['id'] for n in current.get('nodes',[])]
                if proposal['action']=='clip_edit':
                    data=next(n for n in current['nodes'] if n['id']==proposal['nodeId']).get('clipData') or {}
                    proposal['beforeClipData']={'excludedSources':copy.deepcopy(data.get('excludedSources') or []),
                        'clips':[{k:copy.deepcopy(c[k]) for k in ('id','sourceNodeId','sourceResultId','url','startFrame','endFrame') if k in c} for c in data.get('clips',[]) if isinstance(c,dict)]}
                turn.setdefault('nativeActions',[]).append(proposal)
                return public_native(proposal)
            proposal=await asyncio.to_thread(store.transact,user,payload.canvasId,register)
            return {'nativeActions':[proposal]}
        if name == "read_canvas":
            current, context, images, videos = await read_current(args.get("nodeIds") or None, offset=args.get("offset", 0), limit=args.get("limit", 50))
            payload.expectedUpdatedAt = context["updatedAt"]
            return {"canvas": context, "overview": canvas_overview(current, node_ids=args.get("nodeIds") or None, offset=args.get("offset", 0), limit=args.get("limit", 50)), "context": context, "images": images, "videos": videos}
        if name == "read_project_knowledge":
            if not agent.get("knowledgeSnapshot"):
                raise HTTPException(503, "项目知识暂不可用，请先检查安装文件")
            return {"knowledge": ProjectKnowledge.read(agent["knowledgeSnapshot"], args["capabilityId"], args.get("section", "overview"))}
        if name == "read_node_state":
            current = await asyncio.to_thread(load_canvas, payload.canvasId)
            return {"node": read_node_state(current, args["nodeId"], text_offset=args.get("textOffset", 0), text_limit=args.get("textLimit", 12000), item_offset=args.get("itemOffset", 0), item_limit=args.get("itemLimit", 30), array_path=args.get("arrayPath", ""))}
        if name == "read_skill":
            skill = SkillCatalog.read(agent["skillSnapshot"], args["skillId"], args["file"])
            return {"skill": skill}
        if name in {"apply_canvas_operations", "propose_image", "legacy_operations", "create_story_workflow", "create_story_analysis", "import_story_analysis", "create_shot_prompts", "create_shot_images"}:
            if agent.get("knowledgeSnapshot") and ProjectKnowledge.changed(agent["knowledgeSnapshot"]):
                raise HTTPException(409, "项目知识来源已变化，当前回合保留旧知识快照；请复核知识资料后开始新回合，未写入画布")
            if name == 'create_shot_images':
                raw_ops=[{**args,'op':'shot_images','operationId':'shot-images'}]
            elif name == 'create_shot_prompts':
                raw_ops=[{**args,'op':'shot_prompts','operationId':'shot-prompts'}]
            elif name in {'create_story_analysis','import_story_analysis'}:
                raw_ops=[{**args,'op':'story_analysis' if name=='create_story_analysis' else 'story_analysis_result','operationId':'analysis'}]
            elif name == 'create_story_workflow':
                raw_ops = [{**args, 'op':'story_workflow', 'operationId':'story-workflow'}]
            else:
                raw_ops = args.get("operations") if name != "propose_image" else [
                    {"op": "propose_image", "operationId": "image1", "title": args["title"], "prompt": args["prompt"]}]
            plan = AssistantPlan.model_validate({"reply": reply or "保存画布操作", "operations": raw_ops})
            # Shield只保护原子保存；停止后的checkpoint阻止下一模型/工具。
            operation_payload=payload.model_copy(update={'creationSettings':{**payload.creationSettings,'textProvider':payload.provider,'textModel':payload.model}})
            writer = asyncio.create_task(asyncio.to_thread(store.apply_step, user, operation_payload, plan.operations, apply_operations, step_id, reply, legacy))
            try:
                summary = await asyncio.shield(writer)
            except asyncio.CancelledError:
                await asyncio.shield(writer)
                raise
            if summary and notify_changed:
                await notify_changed(payload.canvasId)
            _, context, images, videos = await read_current()
            payload.expectedUpdatedAt = summary.get("updatedAtAfter", context["updatedAt"])
            return {"change": summary, "proposals": summary.get("proposals", []), "context": context, "images": images, "videos": videos}
        if name == "read_image_task":
            proposal = await own_proposal(args["proposalId"])
            if proposal["state"] not in {"submitted", "submitting"} or not query_image:
                raise HTTPException(409, "该方案尚未受理，没有可查询的原任务")
            task = await query_image(proposal["taskId"])
            return {"task": {"taskId": proposal["taskId"], "status": task.get("status"), "error": task.get("error", "")}}
        if name in {'inspect_result','record_result_review'}:
            return await result_inspection.inspect_or_review(
                name, args, step_id, payload=payload, saved_turn=saved_turn, own_proposal=own_proposal)
        raise HTTPException(422, "未开放的画布工具")
    return await run_agent(payload=payload, previous=previous, agent=agent, checkpoint=checkpoint,
                           execute=execute, call_model=call_model, emit=queue.put, budget=budget)
