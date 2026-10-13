"""逐镜素材与原生 LLM 提示词处理节点；不生成或伪造模型结果。"""
import copy
import hashlib
import json

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from backend.canvas_assistant_story_analysis import StoryAnalysis, create_analysis


class ShotPrompts(BaseModel):
    model_config=ConfigDict(extra='forbid',strict=True)
    tableId:str=Field(min_length=1,max_length=100)
    rowIds:list[str]=Field(min_length=1,max_length=30)


class ShotImages(ShotPrompts):
    newAttempt:bool=False


def shot_input(table,row):
    production=table.get('productionData') or {}
    shot=next((s for s in production.get('shots',[]) if s.get('id')==row['id']),{})
    assets={}
    for key,refs in [('characters','characterIds'),('scenes','sceneIds'),('props','propIds')]:
        assets[key]=[copy.deepcopy(a) for a in production.get(key,[]) if a.get('id') in ([shot.get('sceneId')] if key=='scenes' else shot.get(refs,[]))]
    return {'rowId':row['id'],'index':row.get('index'), 'durationSeconds':row.get('durationSeconds'),
        'cells':copy.deepcopy(row.get('cells') or {}),'imagePrompt':row.get('imagePrompt',''),
        'motionPrompt':row.get('motionPrompt',''),'style':production.get('style',''),'assets':assets}


def create_shot_prompts(candidate,data,settings,providers):
    from backend.canvas_assistant_operations import is_busy
    table_node=next((n for n in candidate['nodes'] if n['id']==data.tableId),None)
    if not table_node or table_node.get('type') not in {'shot-table','smart-shot-table'}:
        raise HTTPException(409,'请指定已有原生分镜表')
    table=table_node.get('shotTableData') or {}
    rows={r['id']:r for r in table.get('rows',[])}
    if len(set(data.rowIds))!=len(data.rowIds) or any(r not in rows for r in data.rowIds):
        raise HTTPException(422,'镜头编号不存在或重复，请重新读取分镜表')
    provider,model=settings.get('textProvider'),settings.get('textModel')
    if not any(p.get('id')==provider and p.get('enabled',True) and model in (p.get('chat_models') or []) for p in providers):
        raise HTTPException(409,'请先明确选择可用文本模型')
    smart=candidate.get('kind')=='smart'
    mapping=table.setdefault('shotPromptMap',{})
    created=[];edges=[];processors=[]
    for row_id in data.rowIds:
        row=rows[row_id]
        text=json.dumps(shot_input(table,row),ensure_ascii=False,sort_keys=True,indent=2)
        if len(text)>12000:raise HTTPException(422,'单镜素材超过12000字，请先缩短该镜素材')
        prior=mapping.get(row_id)
        if prior:
            source=next((n for n in candidate['nodes'] if n['id']==prior.get('sourceNodeId')),None)
            processor=next((n for n in candidate['nodes'] if n['id']==prior.get('processorId')),None)
            if not source or not processor or processor.get('shotPromptOrigin')!={'tableId':data.tableId,'rowId':row_id,'sourceNodeId':source['id']}:
                raise HTTPException(409,'逐镜处理节点归属已变化，请恢复原连接')
            if processor.get('llmProvider')!=provider or processor.get('llmModel' if smart else 'model')!=model:
                raise HTTPException(409,'该镜已有文本模型，请在原节点核对模型后运行')
            if is_busy(source) or is_busy(processor):raise HTTPException(409,'该镜仍在运行，请先等待或停止原任务')
            if not any(c.get('from')==source['id'] and c.get('to')==processor['id'] and c.get('kind')=='input' for c in candidate['connections']):
                raise HTTPException(409,'该镜素材输入连接已改变，请先恢复')
            source['text']=text
        else:
            sid='shot_source_'+hashlib.sha256(json.dumps([candidate['id'],data.tableId,row_id],ensure_ascii=False).encode()).hexdigest()[:24]
            if any(n['id']==sid for n in candidate['nodes']):raise HTTPException(409,'逐镜素材节点已存在但映射丢失，请先核对')
            source={'id':sid,'type':'smart-prompt' if smart else 'prompt','title':f'分镜 {row.get("index",row_id)} · 素材',
                'text':text,'x':float(table_node.get('x',0))+1200,'y':float(table_node.get('y',0))+len(mapping)*500,'w':340,'h':360,
                'storyWorkflowOrigin':{'tableId':data.tableId}}
            if smart:source.update(images=[],llmEnabled=False,llmSystemEnabled=False,promptSplitEnabled=False,promptSeparator=';')
            candidate['nodes'].append(source);created.append(sid)
            added,linked,receipt=create_analysis(candidate,StoryAnalysis(sourceNodeId=sid,title=f'分镜 {row.get("index",row_id)}',style=table.get('productionData',{}).get('style') or '遵循镜头素材'),settings,providers)
            processor=next(n for n in candidate['nodes'] if n['id']==receipt['analysisNodeId'])
            processor.pop('storyAnalysisOrigin',None)
            processor.update(title=f'分镜 {row.get("index",row_id)} · LLM提示词',shotPromptOrigin={'tableId':data.tableId,'rowId':row_id,'sourceNodeId':sid},storyWorkflowOrigin={'tableId':data.tableId})
            instruction='根据上游单镜素材编写可直接用于图片模型的画面提示词。只输出提示词正文，不输出JSON、解释或Markdown。cells是当前用户编辑的镜头内容，优先于旧imagePrompt；保持角色、场景、道具及风格一致，只描绘本镜，不编造其他镜头。'
            if smart:processor.update(llmInstruction='处理上游单镜素材为图片提示词。',llmSystemPrompt=instruction)
            else:processor['systemPrompt']=instruction
            eid=sid+'_table';candidate['connections'].append({'id':eid,'from':data.tableId,'to':sid,'kind':'story'})
            created.extend(added);edges.extend([*linked,eid]);mapping[row_id]={'sourceNodeId':sid,'processorId':processor['id']}
        processors.append(processor['id'])
    return created,edges,{'tableId':data.tableId,'rowIds':data.rowIds,'processorIds':processors,'requiresRun':True}


def processed_prompt(candidate,table_id,row_id):
    nodes={n['id']:n for n in candidate['nodes']}
    table=(nodes.get(table_id) or {}).get('shotTableData') or {}
    row=next((r for r in table.get('rows',[]) if r['id']==row_id),None)
    mapping=(table.get('shotPromptMap') or {}).get(row_id) or {}
    source=nodes.get(mapping.get('sourceNodeId'));processor=nodes.get(mapping.get('processorId'))
    if not row or not source or not processor:
        raise HTTPException(409,'请先为该镜创建并运行LLM提示词处理节点')
    output=processor.get('text' if processor['type']=='smart-prompt' else 'outputText','')
    proof=processor.get('shotPromptResult') or {}
    try:current=json.loads(source.get('text',''))==shot_input(table,row)
    except (TypeError,ValueError):current=False
    if not current or not output.strip() or proof.get('sourceText')!=source.get('text') or proof.get('outputText')!=output:
        raise HTTPException(409,'该镜素材或结果已改变，请刷新并重新运行本镜LLM')
    if (proof.get('provider'),proof.get('model'))!=(processor.get('llmProvider'),processor.get('llmModel' if processor['type']=='smart-prompt' else 'model')):
        raise HTTPException(409,'该镜文本模型已改变，请重新运行本镜LLM')
    if processor.get('shotPromptOrigin')!={'tableId':table_id,'rowId':row_id,'sourceNodeId':source['id']} or not any(c.get('from')==source['id'] and c.get('to')==processor['id'] and c.get('kind')=='input' for c in candidate['connections']):
        raise HTTPException(409,'逐镜处理节点归属或输入连接已变化')
    from backend.canvas_assistant_operations import is_busy
    if is_busy(processor) or is_busy(source):raise HTTPException(409,'该镜文本模型尚未完成运行')
    return row,source,processor,output


def validate_shot_image(candidate,node):
    origin=node.get('shotPromptOrigin')
    if not origin:return
    _,source,processor,output=processed_prompt(candidate,origin.get('tableId'),origin.get('rowId'))
    if origin.get('processorId')!=processor['id'] or origin.get('sourceNodeId')!=source['id'] or origin.get('outputText')!=output:
        raise HTTPException(409,'图片节点对应旧版提示词，请为本镜创建新的配图节点')
    inputs=[c for c in candidate['connections'] if c.get('to')==node['id']]
    if len(inputs)!=1 or inputs[0].get('from')!=processor['id']:
        raise HTTPException(409,'本镜图片输入连接已改变，请先核对')


def create_shot_images(candidate,data,settings,key):
    from backend.canvas_assistant_operations import CreateNode,new_node,is_busy
    if not settings.get('provider_id') or not settings.get('model'):
        raise HTTPException(409,'请先选择图片平台和模型')
    defaults={'ratio':'square','resolution':'1k','quality':'auto','customRatio':'','customSize':'','customRatioWidth':'','customRatioHeight':'','customWidth':'','customHeight':''}
    settings={**defaults,**settings}
    table_node=next((n for n in candidate['nodes'] if n['id']==data.tableId),None)
    if not table_node or table_node.get('type') not in {'shot-table','smart-shot-table'}:raise HTTPException(409,'请指定已有分镜表')
    if len(set(data.rowIds))!=len(data.rowIds):raise HTTPException(422,'镜头编号不能重复')
    table=table_node['shotTableData'];smart=candidate.get('kind')=='smart';created=[];edges=[];generators=[];reused=[]
    for rid in data.rowIds:
        row,source,processor,output=processed_prompt(candidate,data.tableId,rid)
        origin={'tableId':data.tableId,'rowId':rid,'sourceNodeId':source['id'],'processorId':processor['id'],'outputText':output}
        mk=f'{table.get("source",{}).get("fingerprint") or table.get("source",{}).get("sourceUrl","")}:{rid}'
        prior=table.setdefault('generationMap',{}).get(mk) or {}
        old=next((n for n in candidate['nodes'] if n['id']==prior.get('generatorId')),None)
        old_output=next((n for n in candidate['nodes'] if n['id']==prior.get('outputId')),None)
        if old and (is_busy(old) or old_output and is_busy(old_output) or old.get('submissionUnknown') or (old.get('assistantNativeRun') or {}).get('status') in {'submitting','submission_unknown','unknown'}):
            raise HTTPException(409,'本镜已有未结束或受理未知任务，请查询原任务，不重复提交')
        old_settings=((old or {}).get('runSettings') or {}) if smart else {**(old or {}),'provider_id':(old or {}).get('apiProvider')}
        same_settings=all(old_settings.get(k,defaults.get(k))==settings[k] for k in [*defaults,'provider_id','model'])
        if old and old.get('shotPromptOrigin')==origin and not data.newAttempt and same_settings and old_settings.get('count',1)==1:
            validate_shot_image(candidate,old);generators.append(old['id']);reused.append(old['id']);continue
        gid='shot_image_'+hashlib.sha256(json.dumps([candidate['id'],data.tableId,rid,origin,settings,key],ensure_ascii=False,sort_keys=True).encode()).hexdigest()[:24]
        x=float(processor.get('x',0))+440;y=float(processor.get('y',0))
        shot_origin={'tableId':data.tableId,'rowId':rid,'sourceFingerprint':table.get('source',{}).get('fingerprint',''),'durationSeconds':row.get('durationSeconds'), 'motionPrompt':row.get('motionPrompt','')}
        if smart:
            gen={'id':gid,'type':'smart-image','title':f'分镜 {row.get("index",rid)} 配图','x':x,'y':y,'w':340,'h':260,'images':[],
                'runSettings':{**settings,'engine':'api','apiKind':'image','count':1},'promptDraftText':'','promptDraftHtml':'','promptDraftTouched':False}
            oid=gid
        else:
            gen=new_node('classic',CreateNode(op='create',operationId='image',ref='image',type='image_generator',title=f'分镜 {row.get("index",rid)} 配图'),gid,x,y,settings,candidate.get('updated_at'))
            gen.update(w=340,h=260,count=1);oid=gid+'_output'
            candidate['nodes'].append({'id':oid,'type':'output','title':'分镜输出','x':x+440,'y':y,'w':260,'h':260,'images':[]});created.append(oid)
            candidate['connections'].append({'id':oid+'_edge','from':gid,'to':oid,'kind':'input'});edges.append(oid+'_edge')
        gen.update(shotTableOrigin=shot_origin,shotPromptOrigin=origin)
        candidate['nodes'].append(gen);created.append(gid)
        candidate['connections'].append({'id':gid+'_input','from':processor['id'],'to':gid,'kind':'input'});edges.append(gid+'_input')
        table['generationMap'][mk]={'promptId':source['id'],'promptProcessorId':processor['id'],'generatorId':gid,'outputId':oid}
        generators.append(gid)
    return created,edges,{'tableId':data.tableId,'rowIds':data.rowIds,'generatorIds':generators,'reusedIds':reused,'requiresRun':bool(created)}
