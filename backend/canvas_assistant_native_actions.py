"""助手应用职责；会话状态、存储、策略和外部能力由原路由显式注入。"""


def current_workflow_fields(canvas, node_id, *, workflow_fields):
    node=next((n for n in canvas.get('nodes',[]) if n.get('id')==node_id),None)
    return workflow_fields(node) if workflow_fields and node and node.get('type') in {'rh','comfy'} else None


async def native_action(payload, request, x_user_id, *, HTTPException, ProjectKnowledge, asyncio, content_hash, control_native_task, copy, current_workflow_fields, identity, load_canvas, loop_foreign_busy, loop_plan, media_export_control, media_export_prepare, native_comfy_foreign_busy, native_effect, native_run_input_hash, native_run_result, native_smart_group_foreign_busy, native_task_binding, native_task_reference, persistent_plan, prepare_native_action, providers, public_native, public_native_task, query_native_task, read_node_state, reserve_autonomy, safe_action, store, time, uuid, validate_native_snapshot, validate_video_run_provider):
    user,_=identity(request,x_user_id,payload.canvasId)
    def record_plan(turn, proposal):
        plan = (turn.get('agent') or {}).get('plan')
        if not plan or not proposal.get('planStepId') or plan['state'] in {'cancelled','interrupted','paused'}:
            return
        receipt = proposal.get('receipt') or {}
        state = receipt.get('state')
        if state not in {'completed','accepted','failed','submission_unknown'}:
            return
        turn['agent']['plan'] = persistent_plan.record_step(plan, proposal['planStepId'],
            {'id':proposal['id'], 'state':state, 'nodeIds':receipt.get('nodeIds',[]),
             'tasks':[{'kind':receipt['taskKind'],'id':i} for i in receipt.get('taskIds',[])],
             'error':receipt.get('error',''),**({'synchronousEvidence':receipt['synchronousEvidence']} if receipt.get('synchronousEvidence') else {})}, execution_id=plan['executionId'])
    def transition(doc):
        turn=next((t for t in store.session(doc,payload.sessionId)['turns'] if t['id']==payload.turnId),None)
        proposal=next((p for p in (turn or {}).get('nativeActions',[]) if p['id']==payload.actionId),None)
        if not proposal: raise HTTPException(404,'当前对话找不到这项原生动作')
        if payload.action in {'confirm','check','resume'}:
            snapshot=(turn.get('agent') or {}).get('knowledgeSnapshot')
            if snapshot and ProjectKnowledge.changed(snapshot):
                raise HTTPException(409,'项目规则或原生源码已变化，请重新读取后规划；未执行原生动作')
        current=load_canvas(payload.canvasId)
        can_execute=False
        if proposal['action']=='media_export' and payload.action in {'check','query','finish'}:
            if proposal['state'] in {'pending','dismissed','failed','completed'}:return {'proposal':public_native(proposal),'canExecute':False}
            if current.get('readOnly') or current.get('readonly'):raise HTTPException(409,'画布只读，不能接入导出结果')
            if payload.action=='check' and turn['state']=='cancelled':raise HTTPException(409,'本轮已停止，不再发起下载或写入画布')
            return {'proposal':public_native(proposal),'canExecute':False}
        if payload.action=='check':
            comfy_run=proposal['action']=='run' and proposal.get('nodeType') in {'comfy','video','smart-group','smart-loop','msgen','midjourney'} and bool(proposal.get('runInputHash'))
            unchanged=native_run_input_hash(current,proposal['nodeId'])==proposal['runInputHash'] if comfy_run else content_hash(current)==proposal['canvasHash']
            if proposal['state']!='executing' or turn['state']=='cancelled' or current.get('readOnly') or current.get('readonly') or not unchanged: raise HTTPException(409,'已停止、画布只读或输入变化，不能沿用旧确认')
            node=next((n for n in current['nodes'] if n['id']==proposal['nodeId']),{})
            owned=node.get('assistantNativeRun') or {}
            if comfy_run and owned:
                task_ids=owned.get('taskIds')
                if owned.get('actionId')!=proposal['id'] or owned.get('taskKind')!=proposal['runSettings']['taskKind'] or not isinstance(task_ids,list) or any(not isinstance(i,str) or not i for i in task_ids) or len(set(task_ids))!=len(task_ids) or len(task_ids)>=proposal['runSettings']['maxCalls'] or owned.get('unknownCount') or node.get('submissionUnknown'):
                    raise HTTPException(409,'原任务归属、剩余预算或受理状态不允许新提交；只查询原任务')
                foreign_busy=loop_foreign_busy(current,proposal) if proposal['nodeType']=='smart-loop' else native_smart_group_foreign_busy(current,proposal) if proposal['nodeType']=='smart-group' else native_comfy_foreign_busy(current,proposal)
                if foreign_busy:raise HTTPException(409,'节点仍有其它原任务在执行，不能提交后续阶段')
                if proposal['nodeType']=='smart-loop':loop_plan(current,proposal['nodeId'],allocate=False,providers=providers())
                if proposal['nodeType']=='video':validate_video_run_provider(node,providers())
                if proposal['nodeType'] in {'msgen','midjourney'}:
                    fresh=prepare_native_action({**current,'nodes':[{**n,'running':False,'assistantNativeRun':{},'submissionUnknown':False} if n['id']==node['id'] else n for n in current['nodes']]},{'action':'run',**proposal['arguments']},proposal['id'],providers=providers())
                    if fresh.get('configurationHash')!=proposal.get('configurationHash'):raise HTTPException(409,'原魔搭或Midjourney配置已变化，未提交新任务')
            else:
                fresh=prepare_native_action(current,{'action':proposal['action'],**proposal['arguments']},proposal['id'],workflow_fields=current_workflow_fields(current,proposal['nodeId']) if proposal['action']=='workflow_parameters' else None,
                    creation_settings=proposal.get('creationSettings'),providers=providers(),image_model_confirmed=bool(proposal.get('creationSettings')))
                if fresh.get('workflowSchemaHash')!=proposal.get('workflowSchemaHash'): raise HTTPException(409,'工作流配置已变化，请重新读取后规划')
                if fresh.get('configurationHash')!=proposal.get('configurationHash'):raise HTTPException(409,'原模型或LoRA配置已变化，请重新读取后规划')
            can_execute=True
        elif payload.action=='resume':
            if proposal.get('nodeType')!='smart-loop' or proposal.get('action')!='run' or proposal['state'] not in {'executing','accepted'} or turn['state']=='cancelled':raise HTTPException(409,'只有尚未取消的原循环确认可继续未完成轮次')
            receipt=native_effect(current,proposal)
            if receipt['state'] in {'submission_unknown','failed'} or not receipt.get('pendingSlots') or current.get('readOnly') or current.get('readonly') or loop_foreign_busy(current,proposal):raise HTTPException(409,'循环受理未知、失败、只读或无未完成轮槽，只能查询原任务')
            loop_plan(current,proposal['nodeId'],allocate=False,providers=providers())
            proposal['state']='executing';can_execute=True
        elif payload.action=='confirm' and proposal['state']=='pending':
            if turn['state'] not in {'waiting_confirmation','interrupted'}: raise HTTPException(409,'本轮已经停止或尚未结束规划')
            # 前端确认前的正常保存会递增版本；仅内容完全相同且本次版本匹配时更新绑定。
            if payload.expectedUpdatedAt is not None:
                if payload.expectedUpdatedAt!=current.get('updated_at',0) or content_hash(current)!=proposal['canvasHash']: raise HTTPException(409,'画布或上游已变化，不能沿用旧确认')
                proposal['updatedAt']=payload.expectedUpdatedAt
            validate_native_snapshot(current,proposal,workflow_fields=current_workflow_fields(current,proposal['nodeId']) if proposal['action']=='workflow_parameters' else None,providers=providers(),media_export_prepare=media_export_prepare)
            if payload.automatic:
                if proposal.get('chargeable'):
                    run=proposal.get('runSettings') or {}
                    reserve_autonomy(turn,'native:'+proposal['id'],run.get('provider'),run.get('model'),run.get('maxCalls'))
                elif not safe_action(proposal):raise HTTPException(409,'这项操作需要在任务面板手动确认')
            if proposal.get('planStepId') and proposal.get('chargeable'):
                plan = turn['agent']['plan']
                if plan['state'] in {'interrupted','paused'}:
                    plan=persistent_plan.claim_plan(plan,canvas_id=payload.canvasId,session_id=payload.sessionId,execution_id=turn['executionId'])
                turn['agent']['plan'] = persistent_plan.start_step(plan,proposal['planStepId'],execution_id=plan['executionId'],service_calls=proposal['runSettings']['maxCalls'],confirmed=True)
            proposal.update(state='executing',confirmedAt=int(time.time()*1000))
            can_execute=True
        elif payload.action=='dismiss':
            if proposal['state']!='pending': raise HTTPException(409,'动作已经确认，不能取消其已发生的操作')
            proposal['state']='dismissed'
        elif payload.action=='abandon':
            if proposal['state']!='executing' or proposal.get('chargeable'): raise HTTPException(409,'已受理或提交未知的服务动作只能查询原任务，不能重新执行')
            try:
                receipt=native_effect(current,proposal)
            except HTTPException:
                receipt={'state':'failed','error':'未核对到方案的完整保存效果；已保存操作与手动修改保留，不重放该动作','updatedAt':current.get('updated_at',0)}
                if proposal.get('nodeId') and any(n.get('id')==proposal['nodeId'] for n in current.get('nodes',[])):
                    receipt['node']=read_node_state(current,proposal['nodeId'])
            proposal.update(state=receipt['state'],receipt=receipt)
        elif payload.action=='retry':
            if proposal.get('retryProposalId'):
                found=next((item for item in turn.get('nativeActions',[]) if item.get('id')==proposal['retryProposalId']),None)
                if found:return {'proposal':copy.deepcopy(found),'canExecute':False}
            if proposal.get('action')!='run' or not proposal.get('chargeable') or proposal.get('state')!='failed':
                raise HTTPException(409,'只有明确未受理的失败运行才能重试；请先查询原任务')
            receipt=proposal.get('receipt') or {}
            if receipt.get('state') in {'submission_unknown','accepted','completed'} or receipt.get('taskIds'):
                raise HTTPException(409,'原任务受理状态不明确或已有编号，只能查询原任务，不能重提')
            current=load_canvas(payload.canvasId)
            node=next((item for item in current.get('nodes',[]) if item.get('id')==proposal.get('nodeId')),None)
            run=(node or {}).get('assistantNativeRun') or {}
            if run.get('taskIds') or run.get('submissionUnknown') or run.get('unknownCount') or run.get('submissionStarted'):
                raise HTTPException(409,'原节点存在已受理或未知任务，只能查询原任务，不能重提')
            fresh_id=payload.turnId+'_retry_'+uuid.uuid4().hex[:20]
            fresh=prepare_native_action(current,{'action':'run',**proposal.get('arguments',{})},fresh_id,
                workflow_fields=current_workflow_fields(current,proposal.get('nodeId')),
                providers=providers())
            fresh['retryOf']=proposal['id'];fresh['state']='pending'
            proposal['retryProposalId']=fresh['id'];turn.setdefault('nativeActions',[]).append(fresh)
            turn['state']='waiting_confirmation'
            return {'proposal':copy.deepcopy(fresh),'canExecute':False}
        elif payload.action in {'query','finish'} and proposal['state']=='executing' and not proposal.get('serverAction'):
            try:
                receipt=native_effect(current,proposal)
            except HTTPException:
                if payload.action=='finish': raise
            else:
                proposal.update(state=receipt['state'],receipt=receipt)
        if payload.action=='confirm' and turn['state']=='cancelled': raise HTTPException(409,'本轮已停止，不再执行新动作')
        record_plan(turn,proposal)
        return {'proposal':public_native(proposal),'canExecute':can_execute}
    result=await asyncio.to_thread(store.transact,user,payload.canvasId,transition)
    proposal=result['proposal']
    if proposal['action']=='media_export':
        if proposal['state']!='executing' or payload.action not in {'confirm','query','finish','check'}:return result
        def private(doc):
            turn=next(t for t in store.session(doc,payload.sessionId)['turns'] if t['id']==payload.turnId)
            return copy.deepcopy(next(p for p in turn['nativeActions'] if p['id']==payload.actionId))
        original=await asyncio.to_thread(store.transact,user,payload.canvasId,private)
        if not media_export_control:raise HTTPException(503,'原媒体导出服务不可用')
        checked=await media_export_control(original,submit=payload.action=='confirm' and result['canExecute'])
        def record_media(doc):
            turn=next(t for t in store.session(doc,payload.sessionId)['turns'] if t['id']==payload.turnId)
            p=next(p for p in turn['nativeActions'] if p['id']==payload.actionId)
            node=next((n for n in load_canvas(payload.canvasId)['nodes'] if n['id']==p['nodeId']),None)
            if not node:raise HTTPException(409,'原导出节点已不存在')
            receipt={'state':'waiting_result','nodeIds':[p['nodeId']],'taskIds':[],'mediaExport':checked,'submissionRepeated':False}
            ready=checked['status'] in {'succeeded','available'}
            if checked['status']=='failed':receipt.update(state='failed',error=checked.get('error') or '原媒体导出失败，保留已有文件，不自动重试')
            if ready:
                saved=next((r for r in node.get('assistantMediaExportReceipts',[]) if r.get('actionId')==p['id']),None)
                expected={'actionId':p['id'],'rangeHash':p['mediaExportPlan']['rangeHash'],'requestId':p['mediaExportPlan']['requestId'],'destination':p['arguments']['destination'],'urls':[f['url'] for f in checked['results']]}
                if saved:
                    if any(saved.get(k)!=v for k,v in expected.items()) or saved.get('status') not in {'delivery_started','saved_to_canvas' if expected['destination']=='canvas' else 'download_started'}:raise HTTPException(409,'媒体导出保存回执与原文件不一致')
                    if expected['destination']=='canvas' and saved['status']=='saved_to_canvas':
                        current=load_canvas(payload.canvasId)
                        outputs=[n for n in current['nodes'] if n.get('type')=='output' and n.get('sourceClipNodeId')==p['nodeId']]
                        urls={i.get('url') for n in outputs for i in n.get('images',[]) if isinstance(i,dict)}
                        if not set(expected['urls'])<=urls or any(not any(c.get('from')==p['nodeId'] and c.get('to')==n['id'] for c in current.get('connections',[])) for n in outputs if any(i.get('url') in expected['urls'] for i in n.get('images',[]) if isinstance(i,dict))):raise HTTPException(409,'导出成片尚未保存到原画布输出')
                    if saved['status']!='delivery_started':receipt.update(state='completed',exportReceipt=saved)
                    else:receipt['error']='交付已经登记；中断时不重复下载，请核对原文件和画布'
            p['receipt']=receipt
            p['updatedAt']=load_canvas(payload.canvasId).get('updated_at',0)
            if receipt['state'] in {'completed','failed'}:p['state']=receipt['state']
            record_plan(turn,p)
            return {'proposal':public_native(p),'canExecute':ready and (not saved or payload.action=='check' and saved.get('status')=='delivery_started') if ready else False}
        return await asyncio.to_thread(store.transact,user,payload.canvasId,record_media)
    if proposal['action']=='run' and payload.action in {'query','finish'} and proposal['state'] in {'executing','accepted','submission_unknown'} and proposal.get('runSettings',{}).get('taskKind')!='runninghub':
        if not query_native_task:raise HTTPException(503,'原任务查询服务未接入，不能核验运行结果')
        receipt=native_effect(load_canvas(payload.canvasId),proposal)
        try:
            tasks=await asyncio.gather(*(query_native_task(receipt['taskKind'],task_id) for task_id in receipt['taskIds']))
        except HTTPException as exc:
            if receipt.get('taskKind')!='video' or exc.status_code not in {404,408,429,500,502,503,504}:raise
            def record_unknown(doc):
                turn=next(t for t in store.session(doc,payload.sessionId)['turns'] if t['id']==payload.turnId)
                p=next(p for p in turn['nativeActions'] if p['id']==payload.actionId)
                p.update(state='submission_unknown',receipt={**receipt,'state':'submission_unknown','error':'原视频记录暂时无法确认，保留原编号，只查询，不重新提交'})
                record_plan(turn,p)
                return {'proposal':public_native(p),'canExecute':False}
            return await asyncio.to_thread(store.transact,user,payload.canvasId,record_unknown)
        def record_run(doc):
            turn=next(t for t in store.session(doc,payload.sessionId)['turns'] if t['id']==payload.turnId)
            p=next(p for p in turn['nativeActions'] if p['id']==payload.actionId)
            checked=native_run_result(load_canvas(payload.canvasId),p,tasks)
            p.update(state=checked['state'],receipt=checked)
            record_plan(turn,p)
            return {'proposal':public_native(p),'canExecute':False}
        return await asyncio.to_thread(store.transact,user,payload.canvasId,record_run)
    if not proposal.get('serverAction'):return result
    should_control=payload.action=='confirm' and result['canExecute']
    result['canExecute']=False
    if not should_control and not (payload.action=='query' and proposal['state']=='executing'):return result
    args=proposal['arguments']
    try:
        # 领取已持久化。重复confirm只读取回执，响应丢失后query只读原编号。
        if should_control:
            if not control_native_task:raise HTTPException(503,'当前原任务控制服务未接入')
            task=await control_native_task(proposal['action'],args['taskKind'],args['taskId'])
        else:
            if not query_native_task:raise HTTPException(503,'当前原任务查询服务未接入')
            task=await query_native_task(args['taskKind'],args['taskId'])
    except HTTPException as error:
        def failed(doc):
            turn=next(t for t in store.session(doc,payload.sessionId)['turns'] if t['id']==payload.turnId)
            p=next(p for p in turn['nativeActions'] if p['id']==payload.actionId)
            if p['state']=='executing':p.update(state='failed',receipt={'state':'failed','error':str(error.detail),'taskId':args['taskId'],'taskKind':args['taskKind'],'submissionRepeated':False})
            record_plan(turn,p)
            return {'proposal':public_native(p),'canExecute':False}
        return await asyncio.to_thread(store.transact,user,payload.canvasId,failed)
    def record(doc):
        turn=next(t for t in store.session(doc,payload.sessionId)['turns'] if t['id']==payload.turnId)
        p=next(p for p in turn['nativeActions'] if p['id']==payload.actionId)
        current=load_canvas(payload.canvasId)
        owner_node=native_task_reference(current,p['nodeId'],args['taskKind'],args['taskId'])
        if native_task_binding(owner_node,args['taskKind'])!=p['taskOwnerHash']:raise HTTPException(409,'原任务所属素材已变化，未回填旧结果')
        if not isinstance(task,dict) or (task.get('task_id') or task.get('id'))!=args['taskId']:raise HTTPException(409,'任务服务返回了不同编号，未使用其结果')
        if task.get('canvas_id') and task['canvas_id']!=payload.canvasId or task.get('node_id') and task['node_id']!=owner_node['id']:raise HTTPException(409,'任务服务保存的归属不匹配')
        if args['taskKind']=='depth':
            capture=owner_node.get('depthCapture') or {}
            if any(task.get(remote) and capture.get(local) and task[remote]!=capture[local] for remote,local in [('operation_id','operationId'),('source_url','sourceUrl')]):raise HTTPException(409,'原深度任务来源或操作编号已变化，未回填旧结果')
        complete=proposal['action']=='task_refresh' or task.get('status') in {'cancelled','canceled','succeeded','failed'}
        if p['state']=='executing':p.update(state='completed' if complete else 'executing',receipt={'state':'completed' if complete else 'waiting_result','taskIds':[args['taskId']],'taskKind':args['taskKind'],'task':public_native_task(task),'nodeIds':[p['nodeId']],'updatedAt':current.get('updated_at',0),'submissionRepeated':False})
        record_plan(turn,p)
        return {'proposal':public_native(p),'canExecute':False}
    return await asyncio.to_thread(store.transact,user,payload.canvasId,record)
