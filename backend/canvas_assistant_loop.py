"""智能循环的有限 DAG 预算与原轮槽归属；不执行供应商请求。"""
from __future__ import annotations

import copy
import secrets

from fastapi import HTTPException

from backend.canvas_assistant_node_rules import is_busy
from backend.canvas_assistant_canvas_rules import content_hash


def reject(message):
    raise HTTPException(409, message)


def loop_plan(canvas, loop_id, *, allocate=True, providers=None):
    nodes={n['id']:n for n in canvas.get('nodes',[]) if isinstance(n,dict) and n.get('id')}
    loop=nodes.get(loop_id)
    if not loop or loop.get('type')!='smart-loop':reject('当前画布找不到智能循环')
    rounds=loop.get('count',1);start=loop.get('loopStart',1);batch=loop.get('imageBatchSize',1) if loop.get('imageInput') else 1
    if any(type(v) is not int or not lo<=v<=hi for v,lo,hi in ((rounds,1,100),(start,1,9999),(batch,1,100))):reject('循环轮数、起始值或图片批量范围无效')
    if loop.get('mode','serial') not in {'serial','parallel'}:reject('循环模式无效')
    def image(n):return n and n.get('type','smart-image')=='smart-image' and not n.get('historyFor') and not n.get('isHistoryGroup')
    def children(source):
        ids={c.get('to') for c in canvas.get('connections',[]) if c.get('from')==source and c.get('kind','flow') in {'input','flow'}}
        return sorted((n for key,n in nodes.items() if key in ids and image(n) and not n.get('loopSourceId') and n.get('sourceNodeId')!=source and not n.get('assistantNativeOrigin')),key=lambda n:(n.get('x') or 0,n.get('y') or 0,n['id']))
    roots=children(loop_id)
    if not roots:reject('请把循环节点连接到下游图片链路')
    leaves=[n for n in roots if not children(n['id'])]
    direct=bool(leaves)
    if direct:root=leaves[-1]
    else:
        # 原入口优先从最右侧的链尾反查所属根；多根 DAG 暂要求手动明确范围。
        if len(roots)!=1:reject('多根循环 DAG 请先使用原入口明确链尾；助手不猜测执行范围')
        root=roots[0]
    touched={loop_id,root['id']};steps=[];visiting=set()
    def append(round_index,offset,source,target,kind,copy_key=None):
        request=target if source==loop_id else nodes[source]
        selected=request.get('runSettings') or {}
        if kind=='generate':
            if selected.get('engine')!='api' or selected.get('apiKind','image')!='image' or not selected.get('provider_id') or not selected.get('model') or request.get('outpaintSize'):reject('循环目前仅开放每个源节点已手选模型的 API 图片运行')
            if providers is not None:
                p=next((p for p in providers if p.get('id')==selected['provider_id'] and p.get('enabled',True)),None)
                if not p or selected['model'] not in (p.get('image_models') or []):reject('循环原节点的手选图片模型已失效')
        key=f'{offset}:{len(steps)}'
        steps.append({'key':key,'roundIndex':round_index,'roundOffset':offset,'sourceNodeId':source,'templateNodeId':target['id'],'requestNodeId':request['id'],'kind':kind,'copyFromKey':copy_key,
                      'provider':selected.get('provider_id',''),'model':selected.get('model',''),
                      **({'outputNodeId':'smart-assistant-'+secrets.token_hex(12)} if allocate else {})})
        touched.update({source,target['id'],request['id']})
        if len(steps)>400:reject('循环 DAG 超过400个轮槽，请缩小范围')
        return key
    def branch(source,round_index,offset):
        if source in visiting:reject('循环图片链形成依赖环，请先核对连接')
        visiting.add(source)
        targets=children(source)
        own_prompt=loop.get('showPrompt') and any(c.get('from')==loop_id and c.get('to')==source and c.get('kind','flow')=='input' for c in canvas.get('connections',[]))
        if own_prompt and len(targets)>1:targets=[targets[(round_index-1)%len(targets)]]
        first=None
        for i,target in enumerate(targets):
            key=append(round_index,offset,source,target,'generate' if i==0 else 'copy',first)
            if i==0:first=key
            branch(target['id'],round_index,offset)
        visiting.remove(source)
    for offset in range(rounds):
        index=start+offset*batch
        if direct:append(index,offset,loop_id,root,'generate')
        else:branch(root['id'],index,offset)
    calls=sum(s['kind']=='generate' for s in steps)
    if not 1<=calls<=100:reject('循环实际服务预算必须为1至100项；复制分支不计模型调用')
    # 纳入全部上游与成员，保留模型、提示词、原图、位置和连接；新轮槽不成为输入。
    while True:
        before=len(touched)
        touched.update(c.get('from') for c in canvas.get('connections',[]) if c.get('to') in touched)
        for key in list(touched):
            n=nodes.get(key,{})
            touched.update(n.get('items') or []);touched.update(n.get('inputNodeIds') or [])
        if len(touched)==before:break
    if not touched<=nodes.keys():reject('循环输入引用了不存在的节点')
    if any(n.get('type') in {'smart-loop','smart-group'} and key!=loop_id for key,n in nodes.items() if key in touched):reject('嵌套循环、分组或分镜尚未接入此轮槽合同')
    return {'version':1,'rounds':rounds,'startIndex':start,'batchSize':batch,'endIndex':start+(rounds-1)*batch,'mode':loop.get('mode','serial'),'direct':direct,'rootNodeId':root['id'],'scopeNodeIds':sorted(touched),'steps':steps,'maxCalls':calls}


def loop_input_hash(canvas,loop_id):
    plan=loop_plan(canvas,loop_id,allocate=False)
    data=copy.deepcopy(canvas)
    data['nodes']=[n for n in data.get('nodes',[]) if n.get('id') in plan['scopeNodeIds']]
    for n in data['nodes']:
        if n['id']==loop_id:
            for field in ('assistantNativeRun','running','runStatus','runError','submissionUnknown','submissionWarning'):n.pop(field,None)
    ids=set(plan['scopeNodeIds'])
    data['connections']=[c for c in data.get('connections',[]) if c.get('from') in ids and c.get('to') in ids]
    return content_hash(data)


def loop_slots(canvas,proposal,*,required=False):
    by_id={n['id']:n for n in canvas.get('nodes',[]) if n.get('id')}
    result={}
    for step in proposal['loopPlan']['steps']:
        output=by_id.get(step['outputNodeId'])
        if not output and not required:continue
        origin={'kind':'loop','actionId':proposal['id'],'sourceNodeId':proposal['nodeId'],'inputHash':proposal['runInputHash'],'stepKey':step['key']}
        incoming=[c for c in canvas.get('connections',[]) if c.get('to')==step['outputNodeId']]
        if (not output or output.get('type')!='smart-image' or output.get('assistantNativeOrigin')!=origin
            or output.get('loopSourceId')!=proposal['nodeId'] or output.get('loopRootId')!=step['templateNodeId'] or output.get('loopRoundIndex')!=step['roundIndex']
            or len(incoming)!=1 or incoming[0].get('from')!=step['templateNodeId'] or incoming[0].get('kind')!='flow'):
            reject('循环原轮槽、连接或归属已变化，只保留原任务，不写入其它节点')
        result[step['key']]=output
    return result


def loop_foreign_busy(canvas,proposal):
    node=next(n for n in canvas['nodes'] if n['id']==proposal['nodeId'])
    run=node.get('assistantNativeRun') or {};owned=set(run.get('taskIds') or [])
    if any(is_busy(n) for n in canvas['nodes'] if n['id'] in proposal['loopPlan']['scopeNodeIds'] and n['id']!=node['id']):return True
    for output in loop_slots(canvas,proposal).values():
        current=copy.deepcopy(output)
        pending=current.get('pendingTasks') or []
        if not isinstance(pending,list) or any(not isinstance(p,dict) or p.get('taskId') not in owned or p.get('assistantNativeActionId')!=proposal['id'] or p.get('kind')!='image' for p in pending):return True
        current['pendingTasks']=[];current['pending']=0;current['running']=False
        if is_busy(current):return True
    current=copy.deepcopy(node);current['running']=False
    return is_busy(current)


def loop_receipt(canvas,proposal):
    node=next((n for n in canvas['nodes'] if n['id']==proposal['nodeId']),None)
    run=(node or {}).get('assistantNativeRun') or {}
    plan=proposal['loopPlan'];ledger=run.get('slots');task_ids=run.get('taskIds')
    if run.get('actionId')!=proposal['id'] or run.get('inputHash')!=proposal['runInputHash'] or not isinstance(ledger,dict) or not isinstance(task_ids,list):reject('循环原动作或轮槽记录未保存')
    outputs=loop_slots(canvas,proposal)
    allowed={s['key']:s for s in plan['steps']}
    if set(ledger)-set(allowed):reject('循环轮槽记录包含未确认的额外步骤')
    accepted=[]
    for key,value in ledger.items():
        step=allowed[key]
        if not isinstance(value,dict) or value.get('outputNodeId')!=step['outputNodeId'] or key not in outputs:reject('循环轮槽记录与确认方案不一致')
        ids=value.get('taskIds',[])
        if not isinstance(ids,list) or len(ids)>(1 if step['kind']=='generate' else 0) or any(not isinstance(i,str) or not i for i in ids):reject('循环轮槽超出真实服务预算')
        accepted.extend(ids)
    if len(set(accepted))!=len(accepted) or set(accepted)!=set(task_ids) or len(task_ids)>plan['maxCalls']:reject('循环原任务编号重复、丢失或超出预算')
    if loop_input_hash(canvas,proposal['nodeId'])!=proposal['runInputHash']:reject('循环原输入或 DAG 已变化，请保留原任务')
    unknown=run.get('unknownCount') or node.get('submissionUnknown') or any(v.get('status') in {'submitting','unknown'} for v in ledger.values())
    state='submission_unknown' if unknown else 'failed' if not task_ids and (run.get('knownRejected') or run.get('submissionStarted') is False) else 'accepted'
    return {'state':state,'taskIds':task_ids,'taskKind':'image','nodeIds':[node['id'],*[n['id'] for n in outputs.values()]],
            'pendingSlots':sum(ledger.get(s['key'],{}).get('status')!='succeeded' for s in plan['steps']),'unsubmittedSlots':sum(s['kind']=='generate' and not ledger.get(s['key'],{}).get('taskIds') and ledger.get(s['key'],{}).get('status','ready')=='ready' for s in plan['steps']),
            'updatedAt':canvas.get('updated_at',0),'submissionRepeated':False}


def loop_run_result(canvas,proposal,tasks):
    receipt=loop_receipt(canvas,proposal)
    if len(tasks)!=len(receipt['taskIds']):reject('循环原任务服务返回数量不一致')
    node=next(n for n in canvas['nodes'] if n['id']==proposal['nodeId']);ledger=node['assistantNativeRun']['slots'];outputs=loop_slots(canvas,proposal)
    tasks_by_id={t.get('task_id') or t.get('id'):t for t in tasks}
    if set(tasks_by_id)!=set(receipt['taskIds']):reject('循环原任务服务返回不同编号')
    def urls(value):
        if isinstance(value,str):return {value}
        if isinstance(value,list):return set().union(*(urls(v) for v in value)) if value else set()
        if isinstance(value,dict):return set().union(*(urls(value.get(k)) for k in ('url','result','images','image_items','outputs')))
        return set()
    all_saved=True
    for step in proposal['loopPlan']['steps']:
        entry=ledger.get(step['key'],{});saved=urls(outputs.get(step['key'],{}).get('images'))
        if step['kind']=='copy':
            original=outputs.get(step['copyFromKey'],{})
            if entry.get('status')!='succeeded' or not saved or saved!=urls(original.get('images')):all_saved=False
            continue
        ids=entry.get('taskIds',[])
        if not ids:all_saved=False;continue
        task=tasks_by_id[ids[0]]
        binding={'canvas_id':canvas['id'],'node_id':proposal['nodeId'],'assistant_action_id':proposal['id'],'input_hash':proposal['runInputHash'],'provider_id':step['provider'],'model':step['model']}
        if any(task.get(k)!=v for k,v in binding.items()):reject('循环原任务的画布、源、动作、模型或输入归属不一致')
        if task.get('status') in {'failed','cancelled','canceled'}:return {**receipt,'state':'failed','error':'循环原任务未全部成功，已完成轮槽保留，不自动重提'}
        wanted=urls(task.get('result'))
        if task.get('status')!='succeeded' or not wanted or wanted!=saved:all_saved=False
    return {**receipt,'state':'completed' if all_saved and not receipt['pendingSlots'] and receipt['state']!='submission_unknown' else receipt['state']}
