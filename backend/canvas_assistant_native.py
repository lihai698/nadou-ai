"""原生画布动作合同与只读预检；不在这里模拟供应商执行。"""
from __future__ import annotations

import copy
import math
import re
import secrets
from urllib.parse import urlsplit, parse_qs

from fastapi import HTTPException

from backend.canvas_assistant_node_rules import is_busy
from backend.canvas_assistant_canvas_rules import content_hash, generation_settings, would_cycle
from backend.canvas_assistant_state import PARAMETERS, SECRET_KEY, LOCAL_PATH, read_node_state, _project
from backend.canvas_assistant_loop import loop_plan, loop_input_hash, loop_receipt, loop_run_result
from backend.canvas_assistant_lora import prepare_lora_patch
from backend.canvas_assistant_msgen import prepare_msgen_run_config
from backend.canvas_assistant_midjourney import prepare_midjourney_run_config
import hashlib
import json

def timeline_hash(value):
    # JSON.stringify 会将1.0写成1；对这类数值做相同处理后再计算跨语言摘要。
    def normalize(item):
        if isinstance(item, dict):
            return {k: normalize(v) for k, v in item.items()}
        if isinstance(item, list):
            return [normalize(v) for v in item]
        if isinstance(item, float) and math.isfinite(item) and item.is_integer():
            return int(item)
        return item
    try:
        serialized = json.dumps(normalize(value), ensure_ascii=False, sort_keys=True,
                                separators=(',', ':'), allow_nan=False)
    except (TypeError, ValueError, OverflowError):
        _error('原时间线含无法稳定保存的数据，请先核对原生编辑器', 409)
    return hashlib.sha256(serialized.encode('utf-8')).hexdigest()

CLASSIC_TYPES = tuple(k for k in PARAMETERS if not k.startswith('smart-'))
SMART_TYPES = tuple(k for k in PARAMETERS if k.startswith('smart-'))
CLASSIC_RUN = {'llm','generator','midjourney','msgen','video','rh','comfy'}
SMART_RUN = {'smart-image','smart-prompt','smart-loop','smart-group'}
BOOLEAN_FIELDS = {'showPrompt','imageInput','showSystem','outputEnabled','fitImage','msLoraEnabled','enhancePrompt','enableUpsample','watermark','cameraFixed','generateAudio','useFrameRoles','multimodal','useCustomAudio','promptSplitEnabled','llmEnabled','llmSystemEnabled'}
TYPE_ENUMS = {
    'generator': {'quality':{'auto','low','medium','high'}, 'ratio':set('square landscape portrait portrait43 landscape43 story wide ultrawide ultratall source custom'.split()), 'resolution':{'auto','1k','2k','4k','custom'}},
    'msgen': {'msRatio':set('square landscape portrait portrait43 landscape43 story wide ultrawide ultratall custom'.split()),'msResolution':{'1k','2k','4k','custom'}},
    'video': {'resolution':{'','480p','720p','1080p','780P'}, 'aspectRatio':set('16:9 9:16 1:1 4:3 3:4 21:9 9:21 keep_ratio adaptive'.split())},
    'loop': {'mode':{'serial','parallel'}}, 'smart-loop': {'mode':{'serial','parallel'}},
    'llm': {'mode':{'node','chat'}},
    'midjourney': {'mode':{'imagine','blend','edit'}, 'speed':{'relax','fast','turbo'}, 'version':{'8.2','8.1','7','6.1','5.2','5.1'}, 'size':{'1:1','3:4','4:3','9:16','16:9','21:9'}},
}
TYPE_BOUNDS = {
    'generator': {'count':(1,8)}, 'msgen': {'count':(1,8), 'msWidth':(64,4096), 'msHeight':(64,4096)},
    'midjourney': {'count':(1,8)}, 'rh': {'count':(1,8)}, 'comfy': {'count':(1,8)},
    'loop': {'count':(1,100), 'loopStart':(1,9999), 'imageBatchSize':(1,100)},
    'smart-loop': {'count':(1,100), 'loopStart':(1,9999), 'imageBatchSize':(1,100)},
}
# 写合同只来自真正的编辑控件；不得与状态读取字段合并。
EDITABLE = {
    'image': set(), 'output': set(), 'clip': set(), 'shot-table': set(),
    'prompt': {'text'}, 'promptGroup': set(), 'group': set(),
    'loop': set('count mode showPrompt imageInput loopStart imageBatchSize variablePrompt fixedPrompt'.split()),
    'llm': set('mode showSystem systemPrompt chatInput userInput'.split()),
    'generator': set('ratio resolution quality customRatioWidth customRatioHeight customWidth customHeight count outputEnabled'.split()),
    'midjourney': set('mode size version speed count outputEnabled'.split()),
    'msgen': set('msRatio msResolution msCustomRatioWidth msCustomRatioHeight msCustomWidth msCustomHeight count fitImage outputEnabled'.split()),
    'video': set('duration aspectRatio resolution enhancePrompt enableUpsample watermark cameraFixed generateAudio useFrameRoles multimodal outputEnabled'.split()),
    'rh': {'count', 'outputEnabled'},
    'comfy': {'count', 'outputEnabled'}, 'smart-image': {'promptDraftText'},
    'smart-prompt': set('text promptSeparator promptSplitEnabled llmEnabled llmSystemEnabled llmSystemPrompt llmInstruction'.split()),
    'smart-loop': set('count mode showPrompt imageInput loopStart imageBatchSize fixedPrompt'.split()),
    'smart-group': set(),
}


def editable_fields(node_type):
    return sorted(EDITABLE.get(node_type, set()) | {'title'})


def _rh_run_model(node):
    model=node.get('rhModel')
    if node.get('rhMode')!='model' or not isinstance(model,str) or not model or node.get('rhConfigKey')!='model:'+model or node.get('model')!=model or node.get('apiProvider')!='runninghub':
        _error('RH 助手运行仅开放已手选且一致的模型配置，工作流与应用请使用原入口',409)
    return model


def _rh_run_selection(node):
    mode=node.get('rhMode')
    if mode=='model':return _rh_run_model(node),'image'
    field='workflowId' if mode=='workflow' else 'webappId' if mode=='app' else ''
    value=node.get(field) if field else None
    schema=node.get('rhWorkflowInfo' if mode=='workflow' else 'rhAppInfo') if field else None
    if (not field or not isinstance(value,str) or not value.strip() or node.get('rhConfigKey')!=f'{mode}:{value.strip()}'
            or node.get('apiProvider')!='runninghub' or not isinstance(node.get('rhParams'),dict)
            or not isinstance(schema,dict) or not isinstance(schema.get('nodeInfoList'),list) or not schema['nodeInfoList']):
        _error('RH 工作流或应用必须保留已手选配置、参数结构和一致标识',409)
    return f'{mode}:{value.strip()}','runninghub'


def native_run_input_hash(canvas, node_id):
    """确认后的 Comfy 连续阶段只允许自己的运行状态变化；输入和参数保持绑定。"""
    if any(n.get('id')==node_id and n.get('type')=='smart-loop' for n in canvas.get('nodes',[])):
        return loop_input_hash(canvas,node_id)
    ids={node_id}
    while True:
        before=len(ids)
        ids.update(c.get('from') for c in canvas.get('connections',[]) if c.get('to') in ids)
        for node in canvas.get('nodes',[]):
            if node.get('id') in ids:
                ids.update(node.get('items') or [])
                ids.update(node.get('inputNodeIds') or [])
        if len(ids)==before:break
    runtime={'running','runStatus','runError','assistantNativeRun','generatedOutputs','submissionWarning','submissionUnknown'}
    if any(n.get('id')==node_id and n.get('type')=='midjourney' for n in canvas.get('nodes',[])):
        runtime.update({'lastTaskId','lastTaskStatus','lastAction','lastImageCount','lastPrompt'})
    def input_node(n):
        value={k:copy.deepcopy(v) for k,v in n.items() if n.get('id')!=node_id or k not in runtime}

        return value
    data={'nodes':[input_node(n) for n in canvas.get('nodes',[]) if n.get('id') in ids],
        'connections':[c for c in canvas.get('connections',[]) if c.get('from') in ids and c.get('to') in ids], 'settings':canvas.get('settings')}
    if any(n.get('id')==node_id and n.get('type') in {'video','msgen','midjourney'} for n in canvas.get('nodes',[])):
        outputs={n['id'] for n in canvas.get('nodes',[]) if n.get('type')=='output'}
        data['connections'].extend(copy.deepcopy(c) for c in canvas.get('connections',[]) if c.get('from')==node_id and c.get('to') in outputs)
    return content_hash(data)


def validate_video_run_provider(node, providers):
    provider=next((p for p in providers or [] if p.get('id')==node.get('apiProvider') and p.get('enabled',True)),None)
    if not provider or not node.get('model') or node['model'] not in (provider.get('video_models') or []):
        _error('原视频平台或手选模型已失效，请在原节点核对；助手不代选默认模型',409)


def native_comfy_foreign_busy(canvas, proposal):
    """保留忙碌门禁，仅移除本次已保存的 Comfy 受理项。"""
    current=copy.deepcopy(canvas)
    node=next(n for n in current['nodes'] if n['id']==proposal['nodeId'])
    owned=set((node.get('assistantNativeRun') or {}).get('taskIds') or [])
    kind=(proposal.get('runSettings') or {}).get('taskKind','comfy')
    planned=(node.get('assistantNativeRun') or {}).get('plannedTaskId')
    output_ids={c.get('to') for c in current.get('connections',[]) if c.get('from')==node['id']}
    node['running']=False
    def this_run(p):
        if not isinstance(p,dict):return False

        run=p.get('run') or {}
        if not isinstance(run,dict) or not isinstance(run.get('node') or {},dict):return False
        owner=(run.get('node') or {}).get('id')
        if not (p.get('canvasTaskId') or p.get('taskId')):
            if kind=='video':return False
            return bool(p.get('assistantNativeActionId')==proposal['id'] and owner==node['id'])
        task_id=p.get('canvasTaskId') or p.get('taskId')
        if kind=='video':return task_id in (owned|({planned} if planned else set())) and p.get('assistantNativeActionId')==proposal['id'] and owner==node['id'] and (p.get('canvasTaskType') or p.get('kind'))=='video'
        return task_id in owned and (p.get('canvasTaskType') or p.get('kind'))=='comfy' and owner in {None,node['id']}
    for related in current['nodes']:
        if related['id']!=node['id'] and related['id'] not in output_ids:continue
        for field in ('pendingTasks','_pending','_directPending'):
            if isinstance(related.get(field),list):related[field]=[p for p in related[field] if not this_run(p)]

    return is_busy(node) or _related_task_busy(current,node)


def native_smart_group_output(canvas, proposal, *, required=True):
    """仅承认此确认动作预分配的新结果分支，不借用旧图或别的分组输出。"""
    output=next((n for n in canvas.get('nodes',[]) if n.get('id')==proposal.get('outputNodeId')),None)
    if output is None and not required:return None
    expected={'actionId':proposal['id'],'sourceNodeId':proposal['nodeId'],'inputHash':proposal['runInputHash']}
    incoming=[c for c in canvas.get('connections',[]) if c.get('to')==proposal.get('outputNodeId')]
    if (not output or output.get('type')!='smart-image' or output.get('assistantNativeOrigin')!=expected
            or len(incoming)!=1 or incoming[0].get('from')!=proposal['nodeId'] or incoming[0].get('kind')!='flow'):
        _error('智能分组原结果分支或归属已变化，只保留原任务，不写入其它节点',409)
    return output


def native_smart_group_foreign_busy(canvas, proposal):
    current=copy.deepcopy(canvas)
    node=next(n for n in current['nodes'] if n['id']==proposal['nodeId'])
    output=native_smart_group_output(current,proposal,required=False)
    node['running']=False
    owned=set((node.get('assistantNativeRun') or {}).get('taskIds') or [])
    if output:
        pending=output.get('pendingTasks') or []
        if any(not isinstance(p,dict) or p.get('taskId') not in owned or p.get('kind')!='image'
               or p.get('assistantNativeActionId')!=proposal['id'] for p in pending):return True
        if output.get('submissionUnknown'):return True
        output['pendingTasks']=[];output['pending']=0;output['running']=False
        if is_busy(output):return True
    outputs={c.get('to') for c in current.get('connections',[]) if c.get('from')==node['id']}
    return is_busy(node) or any(is_busy(n) for n in current['nodes'] if n.get('id') in outputs and n is not output)


def native_task_reference(canvas, node_id, task_kind, task_id):
    node=next((n for n in canvas.get('nodes',[]) if n.get('id')==node_id),None)
    if not node: _error('当前画布找不到任务所属节点',404)
    refs=set()
    if task_kind=='depth':
        refs.add((node.get('depthCapture') or {}).get('taskId'))
    elif task_kind=='video':
        refs.add(node.get('videoTaskId'))
    for field in ('pendingTasks','_pending','_directPending'):
        for pending in node.get(field,[]) or []:
            if not isinstance(pending,dict):continue
            kind={'online-image':'image','image':'image','comfy':'comfy','video':'video'}.get(pending.get('canvasTaskType') or pending.get('kind'))
            if kind==task_kind:refs.add(pending.get('canvasTaskId') or pending.get('taskId'))
    if task_kind=='image':refs.add(node.get('assistantTaskId'))
    run=node.get('assistantNativeRun')
    if isinstance(run,dict) and run.get('taskKind')==task_kind and isinstance(run.get('taskIds'),list):refs.update(i for i in run['taskIds'] if isinstance(i,str))
    if not task_id or task_id not in refs: _error('任务编号或种类不属于当前节点已保存的原任务，不能查询任意任务',409)
    return node


def public_native_task(task):
    # 不透传请求/配置/内部源路径；任务状态与媒体结果分别投影。
    scalar=set('id task_id status stage phase progress error message created_at updated_at result_url pose_url pose_data_url operation_id source_url canvas_id node_id assistant_action_id input_hash provider_id model segment_id query_paused remote_refreshable'.split())
    media=set('id url thumbnail thumb name kind width height duration sourceClipId status error mj_task_id'.split())
    result=_project(task,scalar)
    def outputs(value):
        if isinstance(value,str):return value if value.startswith(('/output/','/assets/','/api/storage-files/')) else ''
        if isinstance(value,dict):return _project(value,media)
        return None
    source=task.get('result') if isinstance(task.get('result'),dict) else task
    if source.get('native_remote_task_id'):result['native_remote_task_id']=source['native_remote_task_id']
    for field in ('images','image_items','videos','outputs','results'):
        if isinstance(source.get(field),list):result[field]=[v for item in source[field][:100] if (v:=outputs(item))]
    return result


def native_task_binding(node,kind):
    capture=node.get('depthCapture') or {} if kind=='depth' else {}
    identity={k:capture.get(k) for k in ('taskId','operationId','sourceUrl')}
    return content_hash({'nodes':[{'id':node['id'],'taskKind':kind,'identity':identity}],'connections':[]})


def native_run_result(canvas,proposal,tasks):
    if proposal.get('nodeType')=='smart-loop':return loop_run_result(canvas,proposal,tasks)
    receipt=native_effect(canvas,proposal);node=next(n for n in canvas['nodes'] if n['id']==proposal['nodeId'])
    if proposal.get('runSettings',{}).get('taskKind')=='llm':
        if tasks:_error('同步LLM没有异步任务，不能认领其它编号',409)
        return receipt
    expected=receipt['taskIds']
    if not isinstance(tasks,list) or len(tasks)!=len(expected) or any(not isinstance(task,dict) or (task.get('task_id') or task.get('id'))!=task_id for task_id,task in zip(expected,tasks)):_error('原任务服务返回了无效记录或不同编号，不能使用其结果',409)
    bindings={'canvas_id':canvas['id'],'node_id':node['id'],'provider_id':proposal['runSettings']['provider'],'model':proposal['runSettings']['model']}
    video=proposal['runSettings']['taskKind']=='video'
    smart_group=proposal.get('nodeType')=='smart-group'
    catalog_image=proposal.get('nodeType') in {'msgen','midjourney'}
    if video or smart_group or catalog_image:
        bindings.update(assistant_action_id=proposal['id'],input_hash=proposal['runInputHash'])
        if any(task.get(field)!=value for task in tasks for field,value in bindings.items()):_error('原任务的画布、节点、动作、输入、分段或模型归属不匹配',409)
    if any(task.get(field) and task[field]!=value for task in tasks for field,value in bindings.items()):_error('原任务服务保存的画布、节点、平台或模型归属不匹配',409)
    public=[public_native_task(task) for task in tasks]
    receipt.update(tasks=public,submissionRepeated=False)
    run=node.get('assistantNativeRun') or {}
    if (run.get('unknownCount') or node.get('submissionUnknown')) and not video:
        return {**receipt,'state':'submission_unknown','error':run.get('warning') or '仍有请求受理状态未知；保留原编号，只查询，不重复提交'}
    statuses=[t.get('status') for t in tasks]
    if video and any(s=='unknown' for s in statuses):return {**receipt,'state':'submission_unknown','error':'原视频受理状态仍未知，只查询原编号，不重新提交'}
    if any(s not in {'succeeded','failed','cancelled','canceled'} for s in statuses):return {**receipt,'state':'accepted'}
    if any(s!='succeeded' for s in statuses) or len(expected)<proposal['runSettings']['maxCalls']:
        return {**receipt,'state':'failed','error':run.get('warning') or '原任务未全部成功；已保存结果保留，重新提交须另行确认'}
    if proposal.get('nodeType')=='midjourney':
        remote=(tasks[0].get('result') or tasks[0]).get('native_remote_task_id')
        if not remote or node.get('lastTaskId')!=remote or node.get('lastAction')!=proposal['nativeImageConfig']['mode']:
            return {**receipt,'state':'accepted','error':'Midjourney原供应商编号或操作模式尚未保存，请同步原任务，不能重提'}
    def urls(value):
        if isinstance(value,str):return {value} if value.startswith(('/output/','/assets/','/api/storage-files/','http://','https://')) else set()
        if isinstance(value,list):return set().union(*(urls(v) for v in value)) if value else set()
        if isinstance(value,dict):return set().union(*(urls(value.get(k)) for k in ('url','images','image_items','outputs','videos','result','generatedOutputs')))
        return set()
    wanted=[urls(task.get('result') or task) for task in tasks]
    output_ids={c.get('to') for c in canvas.get('connections',[]) if c.get('from')==node['id']}
    if video or catalog_image:
        if proposal['outputNodeId'] not in output_ids or not any(n.get('id')==proposal['outputNodeId'] and n.get('type')=='output' for n in canvas['nodes']):_error('原视频输出连接已变化，请保留原任务，不能回填到其它节点',409)
        output_ids={proposal['outputNodeId']}
    if smart_group:output_ids={native_smart_group_output(canvas,proposal)['id']}
    saved=urls(node.get('generatedOutputs'))|urls(node.get('images') if node.get('type')=='smart-image' else [])|set().union(*(urls(n.get('images')) for n in canvas.get('nodes',[]) if n['id'] in output_ids))
    if video or catalog_image:saved=set().union(*(urls(n.get('images')) for n in canvas['nodes'] if n['id'] in output_ids))
    if smart_group:saved=urls(native_smart_group_output(canvas,proposal).get('images'))
    # Comfy 超分是顺序两阶段：第一项是中间图，原生入口只保存第二项最终媒体。
    # 两个原任务仍必须成功且有结果，但不把中间图误当作必须展示的成品。
    final_outputs=wanted[-1:] if proposal['runSettings']['taskKind']=='comfy' and len(expected)==2 else wanted
    if any(not values for values in wanted) or any(not values<=saved for values in final_outputs):return {**receipt,'state':'accepted','error':'原任务成功，媒体尚未完整保存到原生结果节点，请恢复原任务并保存'}
    return {**receipt,'state':'completed','node':read_node_state(canvas,node['id']),
            'result':{'urls':sorted(set().union(*final_outputs))}}


def _catalog_limits(node_type, can_run):
    common='目录不代表已经执行，完成状态以真实回执和保存结果为准；查询和恢复使用原任务编号，受理未知不重复提交。'
    notes={
        'llm':'使用已选择的文本模型和上游输入，结果保存在原生 OUTPUT。',
        'smart-prompt':'开启 LLM 后才可运行；中间框是系统规则，下方是上游原文，顶部保存模型结果。',
        'generator':'使用已保存的图片模型和输入；实际结果须保存到原生输出节点。',
        'smart-image':'助手运行当前只开放空智能节点的 API 图片生成；视频和其他引擎沿用原入口，不由目录替用户选择模型。',
        'video':'沿用已选择的视频模型与素材；作品检查仅有限关键帧，不代表全片和音频语义已验收。',
        'comfy':'保留当前工作流和参数，部分模式包含多次服务调用；ComfyUI 无远端取消。',
        'rh':'模型、工作流或应用须有已保存且一致的配置和参数结构；按实际任务查询结果。',
        'msgen':'沿用已选择模型、输出节点和 LoRA 配置；数量及输入限制按原生运行合同检查。',
        'midjourney':'保留已选择模型、模式和原供应商任务编号；具体模式和输入限制按原生合同检查。',
        'smart-loop':'按现有逐轮输入和任务预算执行，保留每轮原任务；循环次数不由文本段数自动推断。',
        'smart-group':'按已保存的分组成员、分支和模型执行，预算按实际分支计；不把整个分组当作一次模型调用。',
    }
    if not can_run:
        return '此类型不开放独立 run；编辑、连接、预览和导出仅限 availableActions，生成须交给对应运行节点。'+common
    return notes.get(node_type,'仅运行当前节点已保存的配置与输入。')+common+'入口已接入不等于所有供应商模式和作品质量已验收。'


def native_catalog(kind):
    types = SMART_TYPES if kind == 'smart' else CLASSIC_TYPES
    rows=[]
    for t in types:
        if t == 'audio':
            rows.append({'type':t,'actions':['preview','query'],'availableActions':['preview','query'],
                         'plannedActions':[],'taskControls':{},'editableFields':[],
                         'confirmation':'只读音频素材和原任务状态',
                         'limits':'音频创建、编辑和运行沿用原手动入口，不开放助手收费调用'})
            continue
        actions=['update','preview','query','task_refresh','task_cancel','connect','export']
        if t not in {'promptGroup','shot-table','smart-shot-table'}:
            actions.append('create')
        if t in (SMART_RUN if kind=='smart' else CLASSIC_RUN): actions.append('run')
        if t in {'group','smart-group'}: actions.append('group_members')
        if t in {'rh','comfy'}: actions.append('workflow_parameters')
        if t=='msgen': actions.append('lora_parameters')

        if t in {'shot-table','smart-shot-table'}: actions.extend(['shot_edit','shot_column','shot_select','shot_materialize'])
        if t=='clip': actions.append('clip_edit')
        if t=='smart-loop': actions.append('loop_prompts')

        if t in {'clip'}: actions.append('media_export')
        available=[a for a in actions if a in {'update','create','preview','query','task_refresh','task_cancel','connect','export','loop_prompts','clip_edit','shot_edit','shot_column','shot_select','shot_materialize','group_members','workflow_parameters','lora_parameters'}]
        if t in {'llm','smart-prompt','smart-image','smart-group','smart-loop','generator','msgen','midjourney','comfy','rh','video'}:available.append('run')
        if t in {'clip'}:available.append('media_export')
        rows.append({'type':t,'actions':actions,'availableActions':available,'plannedActions':[a for a in actions if a not in available],'taskControls':{'task_refresh':['image','video'],'task_cancel':['depth']},'editableFields':editable_fields(t),
            'confirmation':'安全编辑白名单由程序自动执行，非白名单修改和导出等仍按原入口确认；可运行节点仅在本轮授权的所选模型与调用上限内自动推进，未授权或超额等待确认，不更换用户模型。',
            'limits':_catalog_limits(t,'run' in available)})
    return rows


def _error(text, code=422):
    raise HTTPException(code,text)


def native_connection_allowed(canvas,source,target):
    a,b=source.get('type'),target.get('type')
    if source['id']==target['id'] or is_busy(source):return False
    if canvas.get('kind')=='smart':
        return a in SMART_TYPES and b in SMART_TYPES and 'smart-shot-table' not in {a,b}
    generators=CLASSIC_RUN-{'llm'}
    if a=='shot-table':return False
    if b=='shot-table':return (target.get('shotTableData') or {}).get('source',{}).get('nodeId')==source['id'] and a in {'image','output',*generators}
    if a=='clip':return b=='output'
    if b=='clip':return a in {'image','group','output',*generators}
    if (target.get('depthCapture') or {}).get('sourceId')==source['id']:return a in {'image','output'}
    if a in generators:return b=='output' or b in generators
    if b=='loop':return bool(target.get('imageInput') and a in {'image','group','output'} or target.get('showPrompt') and a in {'prompt','promptGroup','loop','llm'})
    if b=='llm':return a in {'prompt','loop','promptGroup','llm','image','group','output'}
    return b in generators and a in {'image','prompt','loop','group','promptGroup','output','llm'}


def _related_task_busy(canvas, node):
    """原生输出节点可能保存任务，不能只看生成节点 running 标志。"""
    node_id=node.get('id') if isinstance(node,dict) else ''
    connections=canvas.get('connections',[]) or []
    output_ids={c.get('to') for c in connections if c.get('from')==node_id}
    def owner(pending):
        run=pending.get('run') if isinstance(pending,dict) else None
        source=run.get('node') if isinstance(run,dict) else None
        return source.get('id') if isinstance(source,dict) else None
    for output in canvas.get('nodes',[]):
        if output.get('id') not in output_ids or not (output.get('type')=='output' or node.get('type')=='smart-group' and output.get('type')=='smart-image'):
            continue
        related=dict(output)
        for field in ('pendingTasks','_pending','_directPending'):
            items=output.get(field)
            if isinstance(items,list):
                related[field]=[p for p in items if not owner(p) or owner(p)==node_id]
        if is_busy(related):
            return True
    return False


def _validate_scalar(field,value,node_type):
    if field not in editable_fields(node_type) or SECRET_KEY.search(field): _error('该字段不在原生可修改范围，模型和任务结果须保留')
    if isinstance(value,str):
        if len(value)>12000 or LOCAL_PATH.search(value): _error('字段内容过长或包含本机路径')
    elif type(value) not in {int,float,bool}: _error('只允许该原生字段的标量值')
    if field in BOOLEAN_FIELDS and type(value) is not bool: _error('开关字段必须为布尔值')
    bounds=TYPE_BOUNDS.get(node_type,{})
    if field not in BOOLEAN_FIELDS and field not in bounds and field not in {'duration'} and not isinstance(value,str): _error('正文和选项字段必须为字符串')
    if field in bounds:
        low,high=bounds[field]
        if type(value) is not int or not low<=value<=high: _error('数值超出原生范围或不是整数')
    if type(value) is float and not math.isfinite(value): _error('数值必须有限')
    if field in TYPE_ENUMS.get(node_type,{}) and value not in TYPE_ENUMS[node_type][field]: _error('参数不在该节点的原生选项中')
    if node_type=='video' and field=='duration' and (type(value) not in {int,float} or not 1<=value<=60): _error('视频时长须为1至60秒')
    if field in {'title','name'} and (not isinstance(value,str) or len(value)>80): _error('标题最多80字')


def workflow_media_field(node,schema):
    field_type=str(schema.get('fieldType') or schema.get('type') or '').lower()
    if field_type in {'image','video','audio','file','upload'}:return True
    if node['type']=='rh' and field_type not in {'int','integer','float','number','slider','bool','boolean'}:
        text=str(schema.get('fieldName',''))+' '+str(schema.get('fieldValue',''))
        return bool(re.search(r'\b(image|img|mask|photo|picture|video|movie|mp4|audio|sound|music|voice)\b|\.(png|jpe?g|webp|gif|bmp|mp4|webm|mov|m4v|mkv|mp3|wav|ogg|m4a|flac|aac)(\?|$)',text,re.I))
    return False


def workflow_patch(node,patch,workflow_fields=None):
    if node['type']=='comfy' and node.get('mode')!='custom': _error('当前不是自定义工作流模式，动态参数不会进入原生请求',409)
    if node['type']=='rh':
        value=node.get('rhWorkflowInfo' if node.get('rhMode')=='workflow' else 'rhAppInfo') or {}
        schemas=workflow_fields if workflow_fields is not None else value.get('nodeInfoList') or []
        by_id={f"{s.get('nodeId','')}::{s.get('fieldName','')}":s for s in schemas if isinstance(s,dict)}
    else:
        # ComfyUI 字段从原生选中工作流配置传入；缺真实schema时不猜测。
        schemas=workflow_fields if workflow_fields is not None else []
        by_id={s.get('id'):s for s in schemas if isinstance(s,dict)}
    if not by_id: _error('该工作流缺少已读取的原生参数schema',409)
    for key,value in patch.items():
        schema=by_id.get(key)
        if not schema or SECRET_KEY.search(str(key)+' '+str(schema.get('label',''))): _error('工作流字段未登记或属于私密配置')
        if type(value) not in {str,int,float,bool} or isinstance(value,str) and (LOCAL_PATH.search(value) or len(value)>12000): _error('工作流参数只能为有效公开标量')
        field_type=str(schema.get('fieldType') or schema.get('type') or '').lower()
        if node['type']=='comfy' and (field_type=='textarea' or re.search(r'prompt|text|提示词|正向|负向',str(schema.get('input',''))+' '+str(schema.get('name','')),re.I)): _error('ComfyUI提示词来自原生上游输入，不能把未使用的参数字段当正文编辑')
        if workflow_media_field(node,schema): _error('素材参数请沿用原生输入和上传，不能写入任意素材路径')
        random_key='rhRandomActive' if node['type']=='rh' else 'comfyRandomActive'
        if schema.get('random_enabled') is True and (node.get(random_key) or {}).get(key) is not False: _error('该参数仍开启随机，请先在原生控件关闭随机再编辑固定值')
        if field_type in {'int','integer'} and type(value) is not int: _error('工作流参数必须为整数')
        if field_type in {'float','number','slider'} and type(value) not in {int,float}: _error('工作流参数必须为数字')
        if field_type in {'bool','boolean'} and type(value) is not bool: _error('工作流参数必须为布尔值')
        if field_type not in {'int','integer','float','number','slider','bool','boolean'} and not isinstance(value,str): _error('工作流正文和选项必须为字符串')
        if field_type in {'number','slider'} and float(schema.get('step') or 1)>=1 and type(value) is not int: _error('该工作流参数必须为整数')
        if type(value) in {int,float}:
            if not math.isfinite(value) or any(type(schema.get(bound)) in {int,float} and (value<schema[bound] if bound=='min' else value>schema[bound]) for bound in ('min','max')): _error('工作流参数超出schema范围')
        options=next((schema[k] for k in ('fieldData','options','list','values','enum','choices','items','selectOptions','dropdown') if isinstance(schema.get(k),list) and schema[k]),None)
        if options is None and field_type in {'list','select','dropdown','combo','enum'} and isinstance(schema.get('fieldValue'),list): options=schema['fieldValue']
        if options is None and (field_type in {'list','select','dropdown','combo','enum'} or str(schema.get('fieldName','')).lower() in {'sampler','sampler_name','scheduler'}): _error('该选项缺少已读取的完整原生选项，不能猜测')
        if isinstance(options,list):
            allowed=[o.get('value',o.get('label',o.get('name'))) if isinstance(o,dict) else o for o in options]
            if value not in ([str(o) for o in allowed] if node['type']=='rh' else allowed): _error('工作流参数不在schema选项中')
    return copy.deepcopy(patch)


def public_workflow_fields(node,fields):
    result=[]
    for field in fields or []:
        if not isinstance(field,dict):continue
        key=f"{field.get('nodeId','')}::{field.get('fieldName','')}" if node['type']=='rh' else field.get('id','')
        if SECRET_KEY.search(str(key)+' '+str(field.get('label',''))+' '+str(field.get('name',''))):continue
        item=_project(field,set('id nodeId fieldName fieldType type label name min max step default required random_enabled'.split()))
        item['key']=key
        item['editable']=not workflow_media_field(node,field) and not (node['type']=='comfy' and (field.get('type')=='textarea' or re.search(r'prompt|text|提示词|正向|负向',str(field.get('input',''))+' '+str(field.get('name','')),re.I)))
        for option_key in ('fieldData','options','list','values','enum','choices','items','selectOptions','dropdown'):
            if isinstance(field.get(option_key),list):item[option_key]=[_project(v,{'label','value','name'}) if isinstance(v,dict) else _project({'value':v},{'value'}).get('value') for v in field[option_key]]
        if str(field.get('fieldType','')).lower() in {'list','select','dropdown','combo','enum'} and isinstance(field.get('fieldValue'),list):
            item['options']=[_project(v,{'label','value','name'}) if isinstance(v,dict) else _project({'value':v},{'value'}).get('value') for v in field['fieldValue']]
        result.append(item)
    return result


def _catalog_media_kind(ref):
    kind=str(ref.get('kind') or ref.get('mediaKind') or '').lower()
    if kind in {'image','video','audio','text','file'}:return kind
    url=ref['url'];parsed=urlsplit(url)
    if parsed.path=='/api/media-preview':url=parse_qs(parsed.query).get('url',[url])[0]
    path=urlsplit(url).path.lower()
    for kind,extensions in [('video',r'mp4|webm|mov|m4v|avi|mkv|flv'),('audio',r'mp3|wav|m4a|aac|ogg|flac'),('text',r'txt|json|csv|srt|vtt|md')]:
        if re.search(r'\.('+extensions+r')$',path):return kind
    return 'image'


def catalog_image_inputs(canvas, node):
    """与原生直接输入相同的已保存正文/图片；复杂链路先在原入口完成。"""
    sources={n['id']:n for n in canvas.get('nodes',[])}
    ids=[c['from'] for c in canvas.get('connections',[]) if c.get('to')==node['id']]
    order=node.get('inputs') or []
    ids=[i for i in order if i in ids]+[i for i in ids if i not in order]
    refs=[];prompts=[]
    for source_id in ids:
        source=sources.get(source_id,{})
        if source.get('type') not in {'prompt','image','output','llm'}:_error('此助手运行请连接已保存的提示词、图片、输出或LLM；其它链路使用原入口',409)
        text=source.get('outputText') if source.get('type')=='llm' else source.get('text') if source.get('type')=='prompt' else ''
        if text:prompts.append(str(text))
        values=[{k:source[k] for k in ('url','kind','mediaKind') if k in source}] if source.get('type')=='image' and source.get('url') else source.get('images') or []
        for value in values:
            ref={'url':value} if isinstance(value,str) else value
            if not isinstance(ref,dict) or not isinstance(ref.get('url'),str):continue
            ref={**{k:source[k] for k in ('kind','mediaKind') if k in source},**ref}
            if _catalog_media_kind(ref)!='image':_error('魔搭和Midjourney助手运行只接受图片，不接受音视频或文件输入',409)
            refs.append({'url':ref['url'],'kind':'image'})
    return {'prompt':'\n\n'.join(prompts).strip(),'reference_images':refs}


def editable_effect(node, patch):
    expected=copy.deepcopy(patch)
    if node['type']=='msgen':
        fields={k:'ms'+k[0].upper()+k[1:] for k in ('ratio','resolution','customRatio','customRatioWidth','customRatioHeight','customSize','customWidth','customHeight')}
        reverse={v:k for k,v in fields.items()}
        size_patch={reverse[k]:v for k,v in patch.items() if k in reverse}
        if size_patch:
            size_node={'type':'generator',**{reverse[k]:v for k,v in node.items() if k in reverse}}
            effect=editable_effect(size_node,size_patch)
            expected.update({fields[k]:v for k,v in effect.items() if k in fields})
    if node['type']=='generator':
        if patch.get('resolution')=='auto':
            raw=str(node.get('model') or '').lower().strip()
            normalized=re.sub(r'[^a-z0-9]+','-',raw).strip('-');compact=re.sub(r'[^a-z0-9]+','',raw)
            if not (re.search(r'(^|-)gpt-image-2($|-)',normalized) or compact.startswith('gptimage2') or compact.endswith('gptimage2')):
                _error('当前手选模型未确认支持自动尺寸，请选择原生可用分辨率')
        size=set(patch)&{'customWidth','customHeight'};ratio=set(patch)&{'customRatioWidth','customRatioHeight'}
        if size and (ratio or set(patch)&{'ratio','resolution'}): _error('自定义像素与比例/分辨率选择须分开设置')
        if 'resolution' in patch:
            expected['_apiResolutionUserSet']=True
            if patch['resolution']=='custom': expected['ratio']=''
            else:
                if not patch.get('ratio',node.get('ratio')): expected['ratio']='square'
                expected.update(customSize='',customWidth='',customHeight='')
        if 'ratio' in patch and patch['ratio']!='custom': expected.update(customRatio='',customRatioWidth='',customRatioHeight='')
        for pair,minimum,label in [(('customWidth','customHeight'),64,'像素'),(('customRatioWidth','customRatioHeight'),1,'比例')]:
            if not set(patch)&set(pair): continue
            values=[patch.get(k,node.get(k,'')) for k in pair]
            if any(not isinstance(v,str) or not re.fullmatch(r'[0-9]{1,6}',v) or int(v)<minimum for v in values): _error('自定义'+label+'须有两个有效整数，请先读取已有值')
            expected.update(zip(pair,values))
            if minimum==64: expected.update(customSize='x'.join(values),resolution='custom',ratio='',_apiResolutionUserSet=True)
            else: expected.update(customRatio=':'.join(values),ratio='custom')
    if node['type'] in {'smart-image'} and 'promptDraftText' in patch:
        value=patch['promptDraftText']
        escaped=value.replace('&','&amp;').replace('<','&lt;').replace('>','&gt;').replace('"','&quot;').replace("'",'&#39;')
        expected.update(promptDraftHtml=escaped,promptDraftTouched=True)
    return expected


def export_scope(canvas, node_ids):
    """返回导出范围和去掉回执后的稳定哈希，避免保存回执本身改变范围哈希。"""
    if not isinstance(node_ids,list) or any(not isinstance(i,str) for i in node_ids):
        _error('导出节点范围必须是节点编号列表', 409)
    ids = list(node_ids)
    by_id = {n.get('id'): n for n in canvas.get('nodes', []) if isinstance(n, dict) and isinstance(n.get('id'), str)}
    if not 1 <= len(ids) <= 100 or len(set(ids)) != len(ids) or any(i not in by_id for i in ids):
        _error('导出节点范围必须是当前画布中1至100个不重复节点', 409)
    selected = []
    for node_id in ids:
        item = copy.deepcopy(by_id[node_id])
        item.pop('assistantExportReceipts', None)
        selected.append(item)
    id_set = set(ids)
    edges = [copy.deepcopy(edge) for edge in canvas.get('connections', [])
             if edge.get('from') in id_set and edge.get('to') in id_set]
    return ids, edges, content_hash({'nodes': selected, 'connections': edges})


def prepare_native_action(canvas,args,action_id,*,workflow_fields=None,creation_settings=None,providers=None,image_model_confirmed=False,media_export_prepare=None):
    if canvas.get('readOnly') or canvas.get('readonly'): _error('只读画布不能执行原生动作',409)
    if not isinstance(args,dict) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}',action_id): _error('原生动作格式无效')
    action=args.get('action')
    kinds={r['type']:r for r in native_catalog(canvas.get('kind','classic'))}
    if action=='create':
        t=args.get('type');node=None
        if t not in kinds or 'create' not in kinds[t]['actions']: _error('该类型需要原生素材/分组入口，不能凭空创建')
        public={'type':t}
        if args.get('patch'): _error('先用原生工厂创建，再按实际节点字段修改')
    else:
        node=next((n for n in canvas.get('nodes',[]) if n.get('id')==args.get('nodeId')),None)
        if not node: _error('当前画布找不到节点',404)
        t=node.get('type') or ('smart-image' if canvas.get('kind')=='smart' else '')
        if t not in kinds or action not in kinds[t]['actions']: _error('该节点动作没有开放')
        if action not in {'query','preview','task_refresh','task_cancel'} and (is_busy(node) or _related_task_busy(canvas,node) or (node.get('shotTableData') or {}).get('task',{}).get('status')=='running'): _error('节点有正在执行的原任务，请先查询',409)
        public={'nodeId':node['id']}
        if action=='export':
            raw_ids=args['nodeIds'] if args.get('nodeIds') is not None else [node['id']]
            ids, edges, scope_hash = export_scope(canvas, raw_ids)
            if node['id'] not in ids:
                _error('导出范围必须包含当前锚点节点', 409)
            if any(is_busy(n) or _related_task_busy(canvas,n) for n in canvas.get('nodes',[]) if n.get('id') in ids):
                _error('导出范围包含正在执行的节点，请等原任务完成后重新规划', 409)
            if type(args.get('includeResources')) is not bool:
                _error('导出格式必须明确选择 JSON 或包含资源的 ZIP', 409)
            public.update(nodeIds=ids, includeResources=args['includeResources'])
            public['connectionIds']=[edge.get('id') for edge in edges if edge.get('id')]
            public['connectionCount']=len(edges)
            public['exportFormat']='zip' if args['includeResources'] else 'json'
            public['exportScopeHash']=scope_hash
        if action in {'update','workflow_parameters','lora_parameters'}:
            patch=args.get('patch')
            if not isinstance(patch,dict) or not 1<=len(patch)<=30: _error('请提供1至30项有效字段')
            if action=='update':
                for field,value in patch.items(): _validate_scalar(field,value,t)
                public['patch']=copy.deepcopy(patch)
            elif action=='lora_parameters':
                lora=prepare_lora_patch(node,patch,providers)
                public['patch']=lora['patch']
            else:
                public['patch']=workflow_patch(node,patch,workflow_fields)
        elif args.get('patch'): _error('此动作不接受额外字段')
        special = {
            'run': {'maxCalls'},
            'connect': {'sourceId'},
            'task_refresh': {'taskKind','taskId'}, 'task_cancel': {'taskKind','taskId'},
            'group_members': {'memberIds'}, 'shot_edit': {'rowId','columnId','value'},
            'shot_column': {'columnAction','columnId','label'}, 'shot_select': {'selectedRowIds'},
            'shot_materialize': {'selectedRowIds'}, 'clip_edit': {'clipId','clipAction','startFrame','endFrame'},
            'loop_prompts': {'values'},
            'export': {'nodeIds','includeResources'},
            'media_export': {'scope','destination','exportMuted','segmentId'},
        }.get(action,set())
        for field in special:
            if field in args: public[field]=copy.deepcopy(args[field])

        if action=='run':
            if node.get('shotPromptOrigin') and t in {'generator','smart-image'}:
                from backend.canvas_assistant_shot_prompts import validate_shot_image
                validate_shot_image(canvas,node)
            if t not in {'llm','smart-prompt','smart-image','smart-group','smart-loop','generator','msgen','midjourney','comfy','rh','video'}:_error('此类型的原生执行回执仍待接入，不能登记可执行方案',409)
            selected=node.get('runSettings') or {} if t in {'smart-image','smart-group'} else {}
            if not isinstance(selected,dict):_error('智能图片的原生运行设置无效，请在原节点重新核对',409)
            count=selected.get('count',1) if t in {'smart-image','smart-group'} else node.get('count',1)
            if count is None: count=1
            if (t!='smart-loop' and (type(count) is not int or not 1<=count<=8)) or type(public.get('maxCalls')) is not int:
                _error('运行必须明确确认当前节点的1至8项调用上限，不能扩大或猜测批量范围')
            if t=='smart-loop':
                planned_loop=loop_plan(canvas,node['id'],providers=providers)
                if public['maxCalls']!=planned_loop['maxCalls']:_error('循环确认上限与逐轮 DAG 实际预算不同；每轮图片数量为1，复制分支不计调用',409)
                if any(is_busy(n) for n in canvas['nodes'] if n['id'] in planned_loop['scopeNodeIds']):_error('循环链路或上游有原任务，请先核对原编号',409)
                task_kind='image';provider='per-slot';model='逐轮使用原节点手选模型'
            elif t in {'llm','smart-prompt'}:
                origin=node.get('storyAnalysisOrigin') or node.get('shotPromptOrigin')
                if origin and (not any(n.get('id')==origin.get('sourceNodeId') and n.get('text','').strip() for n in canvas.get('nodes',[])) or not any(c.get('from')==origin.get('sourceNodeId') and c.get('to')==node['id'] and c.get('kind')=='input' for c in canvas.get('connections',[]))):
                    _error('分析原文或输入连接已丢失，请先恢复再运行',409)
                if public['maxCalls']!=1:_error('LLM 运行每次只允许确认一个模型调用',409)
                if not node.get('llmProvider') or not node.get('llmModel' if t=='smart-prompt' else 'model'):_error('请先在原节点手动选择文本平台和模型，助手不代选默认模型',409)
                if t=='smart-prompt' and node.get('llmEnabled') is not True:_error('请先在智能提示词节点开启 LLM 改写',409)
                has_input=bool((node.get('llmInstruction') if t=='smart-prompt' else node.get('userInput') or node.get('outputText')) or any(c.get('to')==node['id'] and c.get('from') and c.get('from')!=node['id'] and (t!='smart-prompt' or c.get('kind')=='input') for c in canvas.get('connections',[])))
                if not has_input:_error('LLM 节点缺少输入正文，请先连接提示词或填写正文',409)
                task_kind='llm'; provider=node.get('llmProvider'); model=node.get('llmModel' if t=='smart-prompt' else 'model')
            # Comfy 节点的一次运行通常提交一个任务；增强/编辑开启超分时还会提交第二个任务。
            # 这里登记真实上限，避免把 count 当成服务任务数量而漏掉第二个原任务。
            elif t=='comfy':
                extra = bool((node.get('mode')=='enhance' and node.get('enhanceUpscale')) or (node.get('mode') not in {'text','enhance','custom'} and node.get('editUpscale')))
                expected_calls=2 if extra else 1
                if public['maxCalls']!=expected_calls:_error('运行确认数量与当前 Comfy 节点实际任务预算不一致，请重新读取节点',409)
                task_kind='comfy'; provider='comfyui'; model=str(node.get('comfyWorkflow') or node.get('mode') or 'comfy')
            elif t in {'msgen','midjourney'}:
                inputs=catalog_image_inputs(canvas,node)
                config=prepare_msgen_run_config(node,providers,image_count=len(inputs['reference_images']),max_calls=public['maxCalls']) if t=='msgen' else prepare_midjourney_run_config(node,providers,reference_count=len(inputs['reference_images']),has_prompt=bool(inputs['prompt']),max_calls=public['maxCalls'])
                if t=='msgen' and not inputs['prompt']:_error('魔搭原生运行需要已保存的输入提示词',409)
                outputs=[n for n in canvas['nodes'] if n.get('type')=='output' and any(c.get('from')==node['id'] and c.get('to')==n['id'] for c in canvas.get('connections',[]))]
                if node.get('outputEnabled') is not True or len(outputs)!=1 or count!=1:_error('魔搭和Midjourney助手运行须数量1、开启输出并连接唯一原输出节点',409)
                task_kind='image';provider=config['provider'];model=config['model']
            elif t=='video':
                validate_video_run_provider(node,providers)
                outputs=[n for n in canvas['nodes'] if n.get('type')=='output' and any(c.get('from')==node['id'] and c.get('to')==n['id'] for c in canvas.get('connections',[]))]
                if public['maxCalls']!=1 or node.get('outputEnabled') is not True or len(outputs)!=1:_error('视频助手仅开放单任务，请先开启并连接唯一已保存输出节点',409)
                task_kind='video';provider=node['apiProvider'];model=node['model']
            elif t=='rh':
                model,task_kind=_rh_run_selection(node)
                if count!=1 or public['maxCalls']!=1 or node.get('outputEnabled') is not True:
                    _error('RH 助手运行目前只开放单次图片任务，请先开启并连接原生输出节点',409)
                outputs={c.get('to') for c in canvas.get('connections',[]) if c.get('from')==node['id']}
                if not any(n.get('id') in outputs and n.get('type')=='output' for n in canvas.get('nodes',[])):
                    _error('RH 单次运行须先连接已保存的原生输出节点',409)
                provider='runninghub'
            elif t in {'smart-image','smart-group'}:
                if selected.get('engine')!='api' or selected.get('apiKind','image')!='image' or (t=='smart-image' and node.get('images')) or node.get('outpaintSize'):
                    _error('智能图片目前仅开放空图片节点的 API 图片运行；已有结果、扩图或其它引擎请使用原入口',409)
                if not selected.get('provider_id') or not selected.get('model'):_error('请先在原节点手动选择图片平台和模型',409)
                if public['maxCalls']!=count:_error('确认数量与智能图片节点的实际调用数量不一致',409)
                ancestors={node['id']}
                while True:
                    before=len(ancestors);ancestors.update(c.get('from') for c in canvas.get('connections',[]) if c.get('to') in ancestors)
                    for candidate in canvas.get('nodes',[]):
                        if candidate.get('id') in ancestors:
                            ancestors.update(candidate.get('inputNodeIds') or [])
                            ancestors.update(candidate.get('items') or [])
                    if len(ancestors)==before:break
                if any(n.get('id') in ancestors and (n.get('type') in {'smart-loop'} or n.get('type')=='smart-group' and n['id']!=node['id']) for n in canvas.get('nodes',[])):
                    _error('循环、分组与分镜批量运行尚未接入此确认入口，请使用原入口',409)
                if any(n.get('id') in ancestors and n['id']!=node['id'] and is_busy(n) for n in canvas.get('nodes',[])):
                    _error('分组成员或上游仍有原任务，请先完成或查询原任务',409)
                task_kind='image';provider=selected['provider_id'];model=selected['model']
            else:
                if public['maxCalls']!=count:_error('运行必须明确确认当前节点的1至8项调用上限，不能扩大或猜测批量范围')
                if not node.get('apiProvider') or not node.get('model'):_error('请先在原节点手动选择平台和模型，助手不代选默认模型',409)
                task_kind='image'; provider=node.get('apiProvider'); model=node.get('model')
            if node.get('submissionUnknown'):_error('原提交受理状态未知，只能查询原任务；不能再次提交',409)
        if action=='export':
            # export 的连接范围由节点集合派生，不接受模型自行传入边界。
            if public.get('connectionIds') is None:
                public['connectionIds']=[]
        if action=='connect':
            source=next((n for n in canvas.get('nodes',[]) if n.get('id')==public.get('sourceId')),None)
            if not source or not native_connection_allowed(canvas,source,node):_error('原生输入连接不允许或源节点仍在执行')
            if would_cycle(canvas.get('connections',[]),source['id'],node['id']):_error('新连接形成依赖环，请先读取原生循环输入规则')
        if action in {'task_refresh','task_cancel'}:
            supported={'image','video'} if action=='task_refresh' else {'depth'}
            if public.get('taskKind') not in supported: _error('该原任务服务不支持此操作；ComfyUI停止等待不等于远端取消')
            native_task_reference(canvas,node['id'],public['taskKind'],public.get('taskId'))
        if action=='loop_prompts':
            values=public.get('values')
            if not isinstance(values,list) or not 1<=len(values)<=100 or any(not isinstance(v,str) or len(v)>12000 or LOCAL_PATH.search(v) for v in values): _error('循环字段必须为1至100项公开正文，每项最多12000字')
        if action=='group_members':
            ids=public.get('memberIds')
            if not isinstance(ids,list) or len(ids)>100 or any(not isinstance(i,str) for i in ids): _error('成员必须为当前画布节点编号列表')
            by_id={n['id']:n for n in canvas.get('nodes',[])}
            if node['id'] in ids or len(set(ids))!=len(ids) or not set(ids)<=set(by_id): _error('分组成员不存在、重复或包含自身')
            if any(by_id[i].get('type') in {'group','promptGroup','smart-group'} for i in ids): _error('嵌套分组需要原生手动核对，当前动作不开放')
            if t=='smart-group' and any(by_id[i].get('type') not in {'smart-prompt','smart-loop'} for i in ids): _error('智能分组仅开放提示词和循环成员；吸收图片会删除原节点，须手动操作')
            if any(is_busy(by_id[i]) for i in ids): _error('成员有未结束原任务，不能移动其分组归属')
        if action.startswith('shot_'):
            table=node.get('shotTableData') or {}
            rows={r['id']:r for r in table.get('rows',[]) if isinstance(r,dict) and isinstance(r.get('id'),str)}
            columns={c['id']:c for c in table.get('columns',[]) if isinstance(c,dict) and isinstance(c.get('id'),str)}
            if action in {'shot_select','shot_materialize'}:
                ids=public.get('selectedRowIds')
                if not isinstance(ids,list) or len(ids)>121 or any(not isinstance(i,str) for i in ids) or not set(ids)<=set(rows) or len(set(ids))!=len(ids): _error('所选镜头必须存在且不能重复')
                if action=='shot_materialize' and not ids: _error('请至少选择一个镜头')
                if action=='shot_materialize':
                    if any((table.get('shotPromptMap') or {}).get(rid) for rid in ids):_error('这些镜头使用LLM提示词处理，请调用create_shot_images创建配图节点',409)
                    by_id={n['id']:n for n in canvas.get('nodes',[])}
                    edges={(c.get('from'),c.get('to')) for c in canvas.get('connections',[])}
                    source=table.get('source') or {};smart=t=='smart-shot-table'
                    for row_id in ids:
                        chain=(table.get('generationMap') or {}).get(f"{source.get('fingerprint') or source.get('sourceUrl')}:{row_id}")
                        if chain is None:continue
                        if not isinstance(chain,dict):_error('已有镜头生成归属记录损坏，请先手动核对',409)
                        prompt=by_id.get(chain.get('promptId'));gen=by_id.get(chain.get('generatorId'));out=by_id.get(chain.get('outputId'))
                        origin=(gen or {}).get('shotTableOrigin') or {}
                        if not prompt or not gen or not out or prompt.get('type')!=('smart-prompt' if smart else 'prompt') or gen.get('type')!=('smart-image' if smart else 'generator') or out.get('type')!=('smart-image' if smart else 'output') or (prompt['id'],gen['id']) not in edges or not smart and (gen['id'],out['id']) not in edges or origin.get('tableId')!=node['id'] or origin.get('rowId')!=row_id:
                            _error('已有镜头链不完整或归属不同，请先手动核对；未创建新链',409)
                        if any(is_busy(n) or _related_task_busy(canvas,n) for n in (prompt,gen,out)):_error('已有镜头链还有原任务，不能重新建立或移动',409)
            if action=='shot_edit':
                value=public.get('value')
                if public.get('rowId') not in rows or public.get('columnId') not in {*columns,'imagePrompt','motionPrompt'}: _error('镜头行或编辑字段不存在')
                if not isinstance(value,str) or len(value)>12000 or LOCAL_PATH.search(value): _error('镜头字段只允许12000字内公开正文')
            if action=='shot_column':
                if public.get('columnAction') not in {'add','rename','delete'}: _error('自定义列动作无效')
                if public['columnAction']!='add' and (columns.get(public.get('columnId'),{}).get('kind')!='custom'): _error('内置列不能改名或删除')
                label=public.get('label','')
                if public['columnAction']!='delete' and (not isinstance(label,str) or not 1<=len(label.strip())<=60 or SECRET_KEY.search(label) or LOCAL_PATH.search(label)): _error('自定义列名必须为1至60字公开说明')
                if public['columnAction']=='add' and len(columns)>=36: _error('自定义列最多30个')
                if public['columnAction']=='add':
                    public['columnId']='assistant-column-'+action_id
                    if public['columnId'] in columns: _error('新增列编号已存在，不能覆盖')
                if public['columnAction']!='delete':public['label']=label.strip()
        if action=='clip_edit':
            clips={c.get('id'):c for c in (node.get('clipData') or {}).get('clips',[]) if isinstance(c,dict)}
            if public.get('clipId') not in clips or public.get('clipAction') not in {'trim','move','remove'}: _error('剪辑片段或动作无效')
            start,end=public.get('startFrame'),public.get('endFrame')
            if public['clipAction']!='remove' and (type(start) is not int or start<0 or public['clipAction']=='trim' and (type(end) is not int or end<=start)): _error('剪辑帧范围无效')
            clip=clips[public['clipId']]
            if public['clipAction']=='move':
                end=start+clip['endFrame']-clip['startFrame']
                if any(start<c['endFrame'] and end>c['startFrame'] for key,c in clips.items() if key!=public['clipId']): _error('移动范围与其他片段重叠，请先读取时间线空隙')
            elif public['clipAction']=='trim':
                ordered=sorted(clips.values(),key=lambda c:(c['startFrame'],c['endFrame']))
                index=ordered.index(clip)
                minimum=ordered[index-1]['endFrame'] if index else 0
                maximum=ordered[index+1]['startFrame'] if index+1<len(ordered) else math.inf
                if clip.get('kind')=='video':
                    minimum=max(minimum,clip['startFrame']-clip.get('sourceOffsetFrames',0))
                    maximum=min(maximum,clip['startFrame']+clip.get('sourceDurationFrames',clip['endFrame']-clip['startFrame'])-clip.get('sourceOffsetFrames',0))
                if start<minimum or start>=clip['endFrame'] or end>maximum: _error('裁剪超出相邻片段或源素材范围，未执行部分修改')
    allowed={'action',*public.keys(),'nodeId','type','patch'}
    if set(args)-allowed: _error('动作含未开放参数')
    proposal={'id':action_id,'action':action,'nodeId':node['id'] if node else '', 'nodeType':t,'arguments':public,
            'canvasId':canvas['id'],'updatedAt':canvas.get('updated_at',0),'canvasHash':content_hash(canvas),
            'editableFields':editable_fields(t),'chargeable':action=='run','state':'pending'}
    if action in {'task_refresh','task_cancel'}:
        proposal.update(serverAction=True,taskOwnerHash=native_task_binding(node,public['taskKind']))
    if action=='media_export':
        if not media_export_prepare:_error('媒体导出尚未接入真实文件预检',409)
        options={k:v for k,v in public.items() if k!='nodeId'}
        plan=media_export_prepare(canvas['id'],node,options)
        proposal.update(serverAction=True,mediaExportPlan=plan,mediaExportSummary={'mode':plan['mode'],'rangeHash':plan['rangeHash'],'requestId':plan['requestId'],'fileCount':len(plan['expectedResults']),'durationSeconds':sum(r['durationSeconds'] for r in plan['expectedResults']),'destination':options['destination'],'audioPolicy':plan['outputSpec'].get('audioPolicy') or ('original' if plan['mode']=='source-download' else 'preserve-with-silence' if plan['outputSpec'].get('hasAudio') else 'muted')})
    if action=='export':
        proposal['exportScopeHash']=public['exportScopeHash']
        proposal['exportFormat']=public['exportFormat']
        proposal['exportNodeIds']=public['nodeIds']
        proposal['exportIncludeResources']=public['includeResources']
    if action=='run':
        if t in {'comfy','rh','video','smart-group','smart-loop','msgen','midjourney'}:proposal['runInputHash']=native_run_input_hash(canvas,node['id'])
        if t in {'msgen','midjourney'}:
            proposal.update(outputNodeId=outputs[0]['id'],configurationHash=config['configurationHash'],nativeImageConfig=config)
        if t=='smart-loop':proposal['loopPlan']=planned_loop
        if t=='smart-group':proposal['outputNodeId']='smart-assistant-'+secrets.token_hex(12)

        if t=='video':
            proposal['outputNodeId']=outputs[0]['id']
            proposal['videoRequest']={'duration':float(node.get('duration') or 5),'aspect_ratio':node.get('aspectRatio') or '16:9','resolution':node.get('resolution') or '', 'generate_audio':bool(node.get('generateAudio'))}
        if t=='rh' and task_kind=='runninghub':proposal['outputNodeId']=next(n['id'] for n in canvas['nodes'] if n.get('id') in outputs and n.get('type')=='output')
        if t=='smart-loop':
            proposal['runSettings']={'provider':provider,'model':model,'maxCalls':planned_loop['maxCalls'],'taskKind':'image'}
        elif t in {'llm','smart-prompt'}:
            proposal['runSettings']={'provider':node['llmProvider'],'model':node['llmModel' if t=='smart-prompt' else 'model'],'maxCalls':public['maxCalls'],'taskKind':'llm'}
        elif t=='comfy':
            mode=node.get('mode') or 'text'
            workflow=node.get('comfyWorkflow') if mode=='custom' else {'text':'Z-Image.json','enhance':'Z-Image-Enhance.json','edit':'Flux2-Klein.json'}.get(mode,'Flux2-Klein.json')
            if public['maxCalls']==2:workflow=str(workflow)+' + upscale.json'
            proposal['runSettings']={'provider':'comfyui','model':str(workflow or 'comfy'),'maxCalls':public['maxCalls'],'taskKind':'comfy'}
        elif t in {'msgen','midjourney'}:
            proposal['runSettings']={'provider':provider,'model':model,'maxCalls':1,'taskKind':'image'}
        elif t=='video':
            proposal['runSettings']={'provider':node['apiProvider'],'model':node['model'],'maxCalls':1,'taskKind':'video'}
        elif t=='rh':
            rh_model,rh_kind=_rh_run_selection(node)
            proposal['runSettings']={'provider':'runninghub','model':rh_model,'maxCalls':1,'taskKind':rh_kind}
        elif t in {'smart-image','smart-group'}:
            proposal['runSettings']={'provider':selected['provider_id'],'model':selected['model'],'maxCalls':public['maxCalls'],'taskKind':'image'}
        else:
            proposal['runSettings']={'provider':node['apiProvider'],'model':node['model'],'maxCalls':public['maxCalls'],'taskKind':'image'}
    if action=='shot_materialize':
        if not image_model_confirmed: _error('请先手动指定并勾选图片模型；创建生成链不会自动生成',409)
        settings=generation_settings(canvas,creation_settings,providers or [])
        if not settings.get('provider_id') or not settings.get('model'): _error('请先手动选择图片平台和模型',409)
        if settings.get('ratio','square') not in TYPE_ENUMS['generator']['ratio']-{'source','custom'} or settings.get('resolution','1k') not in {'1k','2k','4k'}: _error('镜头生成链目前请使用原生固定比例和1K/2K/4K，特殊尺寸须在生成节点手动设置',409)
        if settings.get('quality','auto') not in TYPE_ENUMS['generator']['quality']: _error('图片质量不属于原生选项')
        proposal['creationSettings']={k:settings.get(k,default) for k,default in [('provider_id',''),('model',''),('ratio','square'),('resolution','1k'),('quality','auto')]}
        proposal['baselineGenerationMap']=copy.deepcopy((node.get('shotTableData') or {}).get('generationMap') or {})
        proposal['baselineNodeIds']=[n['id'] for n in canvas.get('nodes',[])]
    if action=='update': proposal['effectFields']=editable_effect({**node,'type':t},public['patch'])
    if action=='lora_parameters':
        proposal.update(effectFields=lora['effectFields'],configurationHash=lora['configurationHash'],loraModel=lora['model'])




    if action=='workflow_parameters':
        schema=workflow_fields if workflow_fields is not None else {key:node.get(key) for key in ('rhAppInfo','rhWorkflowInfo')}
        proposal['workflowSchemaHash']=content_hash({'nodes':[{'schema':schema}],'connections':[]})
    if action in {'shot_edit','shot_column','shot_select'}:proposal['tableRevision']=int((node.get('shotTableData') or {}).get('revision') or 0)
    return proposal


def validate_native_snapshot(canvas,proposal,*,workflow_fields=None,providers=None,media_export_prepare=None):
    if canvas.get('id')!=proposal.get('canvasId') or canvas.get('updated_at',0)!=proposal.get('updatedAt') or content_hash(canvas)!=proposal.get('canvasHash'):
        _error('画布或上游已变化，请读取状态重新规划；未执行原生动作',409)
    fresh=prepare_native_action(canvas,{'action':proposal['action'],**proposal['arguments']},proposal['id'],workflow_fields=workflow_fields,
        creation_settings=proposal.get('creationSettings'),providers=providers,image_model_confirmed=bool(proposal.get('creationSettings')),media_export_prepare=media_export_prepare)
    if proposal['action']=='media_export' and fresh['mediaExportPlan']['rangeHash']!=proposal['mediaExportPlan']['rangeHash']:_error('导出原媒体或范围已变化，请重新规划',409)
    if fresh.get('workflowSchemaHash')!=proposal.get('workflowSchemaHash'): _error('工作流参数配置已变化，请重新读取后规划',409)
    if fresh.get('configurationHash')!=proposal.get('configurationHash'): _error('原模型或LoRA配置已变化，请重新读取后规划',409)


def native_effect(canvas, proposal):
    """只从真实保存文档核对效果；客户端不提交成功状态或任务编号。"""
    if canvas.get('id') != proposal['canvasId']: _error('动作不属于当前画布',409)
    args=proposal['arguments']; action=proposal['action']
    nodes={n.get('id'):n for n in canvas.get('nodes',[]) if isinstance(n,dict)}
    node=nodes.get(proposal.get('nodeId'))
    if action=='create':
        created=[n for key,n in nodes.items() if key not in proposal.get('baselineNodeIds',[]) and n.get('assistantNativeActionId')==proposal['id'] and (n.get('type') or ('smart-image' if canvas.get('kind')=='smart' else ''))==proposal['nodeType']]
        if len(created)!=1: _error('尚未核对到唯一保存的新节点，不能宣称创建成功',409)
        ids=[created[0]['id']]
    elif action in {'update','lora_parameters'}:
        if not node or any(node.get(k)!=v for k,v in proposal.get('effectFields',args['patch']).items()): _error('字段及其原生关联状态尚未按方案保存，不能返回成功',409)
        if action=='lora_parameters' and node.get('msCustomModel')!=proposal.get('loraModel'): _error('原LoRA模型已变化，不能将当前字段当作确认结果',409)

        ids=[node['id']]
    elif action=='workflow_parameters':
        params=(node or {}).get('rhParams' if proposal['nodeType']=='rh' else 'comfyParams') or {}
        for key,value in args['patch'].items():
            expected=str(value).lower() if type(value) is bool else str(value)
            actual=(params.get(key) or {}).get('value') if proposal['nodeType']=='rh' else params.get(key)
            if actual!=(expected if proposal['nodeType']=='rh' else value): _error('工作流原生参数尚未按方案保存',409)
        ids=[node['id']]
    elif action=='run':
        if proposal.get('nodeType')=='smart-loop':return loop_receipt(canvas,proposal)
        run=(node or {}).get('assistantNativeRun') or {};settings=proposal['runSettings'];task_ids=run.get('taskIds')
        if settings.get('taskKind')=='llm':
            if not node or run.get('actionId')!=proposal['id'] or run.get('taskKind')!='llm':
                _error('尚未取得原生 LLM 执行回执，不能宣称运行成功',409)
            if run.get('knownRejected') is True or run.get('status')=='failed':
                return {'state':'failed','nodeIds':[node['id']],'taskIds':[],
                        'taskKind':'llm','error':run.get('error') or 'LLM 原生调用未执行，已保存失败状态',
                        'outputText':node.get('outputText') or '', 'submissionRepeated':False,
                        'updatedAt':canvas.get('updated_at',0)}
            smart=proposal['nodeType']=='smart-prompt'
            if node.get('llmProvider')!=settings['provider'] or node.get('llmModel' if smart else 'model')!=settings['model']:
                _error('原智能提示词的文本模型已变化，请手动核对原回执',409)
            output=node.get('text' if smart else 'outputText')
            if run.get('status') in {'succeeded','done'} and output!=run.get('outputText'):
                _error('智能提示词正文已变化，不能将当前正文当作原 LLM 结果',409)
            if run.get('status') in {'succeeded','done'} and isinstance(output,str) and output.strip():
                return {'state':'completed','nodeIds':[node['id']],'taskIds':[],
                        'taskKind':'llm','outputText':output,
                        'synchronousEvidence':{'kind':'llm','actionId':proposal['id'],'nodeId':node['id'],'outputHash':timeline_hash(output)},
                        'submissionRepeated':False,'updatedAt':canvas.get('updated_at',0)}
            return {'state':'submission_unknown','nodeIds':[node['id']],'taskIds':[],
                    'taskKind':'llm','updatedAt':canvas.get('updated_at',0)}
        if node and run.get('actionId')==proposal['id'] and run.get('taskKind')==settings['taskKind'] and task_ids==[] and (run.get('knownRejected') is True or run.get('submissionStarted') is False):
            return {'state':'failed','nodeIds':[node['id']],'taskIds':[],'error':run.get('error') or '原生预检未提交任务，请读取输入后重新规划','submissionRepeated':False,'updatedAt':canvas.get('updated_at',0)}
        if node and settings['taskKind']=='video' and run.get('actionId')==proposal['id'] and run.get('taskKind')=='video' and task_ids==[] and run.get('submissionStarted') is True and re.fullmatch(r'canvas_video_[A-Za-z0-9_-]{8,87}',str(run.get('plannedTaskId') or '')):
            return {'state':'submission_unknown','nodeIds':[node['id']],'taskIds':[run['plannedTaskId']],'taskKind':'video','queryPlannedTask':True,'submissionRepeated':False,'updatedAt':canvas.get('updated_at',0)}
        if not node or run.get('actionId')!=proposal['id'] or run.get('taskKind')!=settings['taskKind'] or not isinstance(task_ids,list) or not task_ids or len(task_ids)>settings['maxCalls'] or any(not isinstance(i,str) or not i for i in task_ids) or len(set(task_ids))!=len(task_ids):_error('尚未取得原生服务受理编号；只查询，不重新提交',409)
        if node.get('type')=='rh':
            rh_model,rh_kind=_rh_run_selection(node)
            if rh_model!=settings['model'] or rh_kind!=settings['taskKind']:_error('原 RH 配置已变化，请保留原任务回执',409)
            if rh_kind=='runninghub' and (run.get('inputHash')!=proposal.get('runInputHash') or run.get('outputNodeId')!=proposal.get('outputNodeId')):
                _error('RH 原任务的输入或输出归属不匹配，只查询原编号',409)
            if rh_kind=='runninghub' and run.get('status') in {'succeeded','done'}:
                output_id=proposal.get('outputNodeId')
                connected=any(c.get('from')==node['id'] and c.get('to')==output_id for c in canvas.get('connections',[]))
                output=nodes.get(output_id)
                results=run.get('resultUrls')
                saved={item.get('url') if isinstance(item,dict) else item for item in (output or {}).get('images',[]) if isinstance(item,(dict,str))}
                if (not connected or not output or output.get('type')!='output' or not isinstance(results,list)
                        or not results or any(not isinstance(url,str) or not url or url not in saved for url in results)):
                    _error('RH 原任务已完成但结果尚未保存到绑定输出节点，只查询原编号',409)
                return {'state':'completed','nodeIds':[node['id'],output_id],'taskIds':task_ids,'taskKind':'runninghub',
                        'submissionRepeated':False,'updatedAt':canvas.get('updated_at',0),'result':{'urls':results},'node':read_node_state(canvas,node['id'])}
        if proposal.get('nodeType')=='smart-group':
            native_smart_group_output(canvas,proposal)
            if run.get('outputNodeId')!=proposal.get('outputNodeId') or run.get('inputHash')!=proposal.get('runInputHash'):
                _error('智能分组原任务的输入或结果分支不匹配，只查询原编号',409)
        selected=node.get('runSettings') or {} if node.get('type') in {'smart-image','smart-group'} else {'provider_id':node.get('apiProvider'),'model':node.get('model')}
        if node.get('type') in {'msgen','midjourney'}:
            if native_run_input_hash(canvas,node['id'])!=proposal.get('runInputHash') or run.get('inputHash')!=proposal.get('runInputHash') or run.get('outputNodeId')!=proposal.get('outputNodeId'):_error('原魔搭或Midjourney输入或输出归属变化，只保留原任务',409)
            selected={'provider_id':settings['provider'],'model':settings['model']}
        if settings['taskKind']=='image' and (selected.get('provider_id')!=settings['provider'] or selected.get('model')!=settings['model']):_error('原运行节点的模型已经改变，请保留原任务回执并手动核对',409)
        return {'state':'accepted','nodeIds':[node['id']],'taskIds':task_ids,'taskKind':run['taskKind'],'updatedAt':canvas.get('updated_at',0)}
    elif action=='export':
        if not node:
            _error('导出锚点节点已不存在', 409)
        ids, edges, scope_hash = export_scope(canvas, args.get('nodeIds') or [proposal['nodeId']])
        if scope_hash != proposal.get('exportScopeHash') or ids != proposal.get('exportNodeIds'):
            _error('导出范围或节点内容已变化，请重新规划', 409)
        receipts=node.get('assistantExportReceipts') or []
        receipt=next((item for item in receipts if isinstance(item,dict) and item.get('actionId')==proposal['id']),None)
        expected_format='zip' if args.get('includeResources') else 'json'
        if not isinstance(receipt,dict) or receipt.get('status')!='download_started' or receipt.get('format')!=expected_format:
            _error('尚未取得已保存的导出回执，不能宣称导出成功', 409)
        if receipt.get('nodeIds')!=ids or receipt.get('connectionIds')!=[edge.get('id') for edge in edges if edge.get('id')]:
            _error('导出回执范围与当前节点不一致', 409)
        if receipt.get('scopeHash')!=scope_hash or type(receipt.get('bytes')) is not int or receipt['bytes']<=0:
            _error('导出回执缺少有效文件大小或范围校验', 409)
        if (receipt.get('nodeId')!=proposal['nodeId'] or receipt.get('includeResources') is not args.get('includeResources')
                or not isinstance(receipt.get('filename'),str) or not receipt['filename'].endswith('.'+expected_format)
                or type(receipt.get('downloadedAt')) is not int or receipt['downloadedAt']<=0):
            _error('导出回执缺少文件信息或格式选择不一致', 409)
        if expected_format=='zip' and receipt.get('archiveMagic')!='PK':
            _error('ZIP 导出回执未通过压缩包头校验', 409)
        return {'state':'completed','nodeIds':ids,'taskIds':[],'exportReceipt':copy.deepcopy(receipt),
                'exportFormat':expected_format,'updatedAt':canvas.get('updated_at',0)}
    elif action=='connect':
        edge=next((c for c in canvas.get('connections',[]) if c.get('from')==args['sourceId'] and c.get('to')==proposal['nodeId'] and (canvas.get('kind')!='smart' or c.get('kind')=='input')),None)
        if not edge:_error('原生连接尚未保存',409)
        ids=[args['sourceId'],proposal['nodeId']]
    elif action=='group_members':
        if not node or node.get('items')!=args['memberIds'] or any(i not in nodes for i in args['memberIds']): _error('分组成员尚未完整保存或原节点已丢失',409)
        ids=[node['id'],*args['memberIds']]
    elif action=='shot_materialize':
        table=(node or {}).get('shotTableData') or {};source=table.get('source') or {}
        maps=table.get('generationMap') or {};rows={r['id']:r for r in table.get('rows',[]) if isinstance(r,dict)}
        edges={(c.get('from'),c.get('to')) for c in canvas.get('connections',[])}
        settings=proposal.get('creationSettings') or {};ids=[proposal['nodeId']]
        smart=proposal['nodeType']=='smart-shot-table'
        for row_id in args['selectedRowIds']:
            key=f"{source.get('fingerprint') or source.get('sourceUrl')}:{row_id}"
            chain=maps.get(key) or {};prompt=nodes.get(chain.get('promptId'));gen=nodes.get(chain.get('generatorId'));out=nodes.get(chain.get('outputId'))
            origin=(gen or {}).get('shotTableOrigin') or {};row=rows.get(row_id) or {}
            if not prompt or not gen or not out or prompt.get('type')!=('smart-prompt' if smart else 'prompt') or gen.get('type')!=('smart-image' if smart else 'generator') or out.get('type')!=('smart-image' if smart else 'output') or (prompt['id'],gen['id']) not in edges or not smart and (gen['id'],out['id']) not in edges or origin.get('tableId')!=node['id'] or origin.get('rowId')!=row_id:
                _error('镜头生成链、原生连接或镜头归属尚未完整保存',409)
            if gen['id'] not in proposal.get('baselineNodeIds',[]):
                actual=gen.get('runSettings') or {} if smart else {'provider_id':gen.get('apiProvider'),**{k:gen.get(k) for k in ('model','ratio','resolution','quality','count')}}
                if any(actual.get(k)!=v for k,v in settings.items()) or actual.get('count')!=1 or prompt.get('text')!=(row.get('imagePrompt') or (row.get('cells') or {}).get('visual') or ''): _error('新镜头生成链的模型、参数或提示词与确认方案不同',409)
            elif (proposal.get('baselineGenerationMap') or {}).get(key)!=chain: _error('复用的镜头生成链与原记录不同',409)
            ids.extend(dict.fromkeys([prompt['id'],gen['id'],out['id']]))
    elif action=='loop_prompts':
        expected=[v.strip() for v in args['values']]
        if not node or node.get('variablePrompts')!=expected or node.get('variablePrompt')!='\n'.join(v for v in expected if v): _error('循环字段或兼容正文尚未保存',409)
        ids=[node['id']]
    elif action in {'shot_edit','shot_column','shot_select'}:
        table=(node or {}).get('shotTableData') or {}
        if int(table.get('revision') or 0)<=proposal.get('tableRevision',0): _error('镜头表原生编辑版本尚未保存',409)
        if action=='shot_edit':
            row=next((r for r in table.get('rows',[]) if r.get('id')==args['rowId']),None)
            field=args['columnId'];value=row.get(field) if row and field in {'imagePrompt','motionPrompt'} else (row or {}).get('cells',{}).get(field)
            if value!=args['value'] or field=='motion' and (row or {}).get('motionPrompt')!=args['value']: _error('镜头正文或运镜提示词尚未完整保存',409)
        elif action=='shot_select':
            if table.get('selectedRowIds')!=args['selectedRowIds']: _error('镜头选择尚未保存',409)
        else:
            column=next((c for c in table.get('columns',[]) if c.get('id')==args['columnId']),None)
            if args['columnAction']=='delete':
                if column or any(args['columnId'] in r.get('cells',{}) for r in table.get('rows',[])): _error('自定义列及其正文尚未删除',409)
            elif not column or column.get('kind')!='custom' or column.get('label')!=args['label'] or args['columnAction']=='add' and column.get('hint')!=args['label']: _error('自定义列尚未按原生规则保存',409)
        ids=[node['id']]
    elif action=='clip_edit':
        data=(node or {}).get('clipData') or {}; clips=data.get('clips') or []
        old=proposal.get('beforeClipData') or {}; clip=next((c for c in clips if c.get('id')==args['clipId']),None)
        if not set(old.get('excludedSources',[]))<=set(data.get('excludedSources',[])): _error('原剪辑排除状态丢失',409)
        if args['clipAction']=='remove':
            import json
            removed=next((c for c in old.get('clips',[]) if c.get('id')==args['clipId']),None)
            if not removed or clip: _error('剪辑素材尚未移除',409)
            key=json.dumps([removed.get('sourceNodeId') or '',removed.get('sourceResultId') or removed.get('url')],ensure_ascii=False,separators=(',',':'))
            still_used=any((c.get('sourceNodeId') or '',c.get('sourceResultId') or c.get('url'))==(removed.get('sourceNodeId') or '',removed.get('sourceResultId') or removed.get('url')) for c in clips)
            if not still_used and key not in data.get('excludedSources',[]): _error('移除素材未保存排除键，可能被重新导入',409)
        elif not clip or clip.get('startFrame')!=args['startFrame'] or args['clipAction']=='trim' and clip.get('endFrame')!=args['endFrame']: _error('剪辑帧位置尚未按方案保存',409)
        ids=[node['id']]
    elif action in {'query','preview'}:
        if not node: _error('节点已不存在',404)
        return {'state':'completed','nodeIds':[node['id']],'node':read_node_state(canvas,node['id'])}
    else: _error('该动作的真实结果校验尚未接入',409)

    return {'state':'completed','nodeIds':ids,'taskIds':[],'updatedAt':canvas.get('updated_at',0)}
