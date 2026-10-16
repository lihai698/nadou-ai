"""原生文本分析节点与分镜结果导入，不在后端伪造模型输出。"""
import copy
import hashlib
import json
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from backend.canvas_assistant_story import StoryWorkflow, create_story_nodes


class StoryAnalysis(BaseModel):
    model_config=ConfigDict(extra='forbid',strict=True)
    sourceNodeId:str=Field(min_length=1,max_length=100)
    title:str=Field(min_length=1,max_length=80)
    style:str=Field(min_length=1,max_length=2000)


class StoryAnalysisResult(BaseModel):
    model_config=ConfigDict(extra='forbid',strict=True)
    analysisNodeId:str=Field(min_length=1,max_length=100)


def create_analysis(candidate,data,settings,providers):
    source=next((n for n in candidate['nodes'] if n['id']==data.sourceNodeId),None)
    smart=candidate.get('kind')=='smart'
    if not source or source.get('type')!=('smart-prompt' if smart else 'prompt') or not source.get('text','').strip():
        raise HTTPException(409,'请先保存原文到原生提示词节点')
    provider,model=settings.get('textProvider'),settings.get('textModel')
    selected=next((p for p in providers if p.get('id')==provider and p.get('enabled',True)),None)
    if not selected or model not in (selected.get('chat_models') or []):
        raise HTTPException(409,'请先明确选择可用文本模型')
    spec=data.model_dump()
    for n in candidate['nodes']:
        if n.get('storyAnalysisOrigin')==spec and n.get('llmProvider')==provider and n.get('llmModel' if smart else 'model')==model:
            return [],[],{'analysisNodeId':n['id'],'sourceNodeId':source['id'],'reused':True}
    nid='analysis_'+hashlib.sha256(json.dumps([candidate['id'],spec,provider,model],ensure_ascii=False,sort_keys=True).encode()).hexdigest()[:24]
    instruction=('分析输入故事，保持原文事实，输出完整分镜生产数据。只返回JSON对象，不要Markdown或解释。'
        'sourceNodeId必须为'+json.dumps(source['id'])+'；title为'+json.dumps(data.title,ensure_ascii=False)+
        '；style为'+json.dumps(data.style,ensure_ascii=False)+'。每段剧情须引用原文并有对应分镜。声音仅为设计，不声称已生成。'
        '遵循以下JSON Schema：'+json.dumps(StoryWorkflow.model_json_schema(),ensure_ascii=False))
    node={'id':nid,'type':'smart-prompt' if smart else 'llm','title':data.title+' · LLM分析',
        'x':float(source.get('x',0))+440,'y':float(source.get('y',0)),'w':360,'h':420,
        'llmProvider':provider,'storyAnalysisOrigin':spec}
    if smart:
        node.update(text='',images=[],llmEnabled=True,llmModel=model,llmInstruction=instruction,
            llmSystemEnabled=False,llmSystemPrompt='',inputNodeIds=[source['id']],promptSplitEnabled=False,promptSeparator=';')
    else:
        node.update(model=model,mode='node',showSystem=True,systemPrompt=instruction,userInput='',outputText='',messages=[])
    edge={'id':nid+'_input','from':source['id'],'to':nid,'kind':'input'}
    candidate['nodes'].append(node);candidate['connections'].append(edge)
    return [nid],[edge['id']],{'analysisNodeId':nid,'sourceNodeId':source['id'],'provider':provider,'model':model,'requiresRun':True}


def import_analysis(candidate,analysis_id):
    node=next((n for n in candidate['nodes'] if n['id']==analysis_id),None)
    origin=(node or {}).get('storyAnalysisOrigin')
    if not origin or node.get('running'):
        raise HTTPException(409,'请先完成原生文本分析节点的运行')
    if node.get('llmOutputStale'):
        raise HTTPException(409,'分析规则或模型已变化，请重新运行分析节点')
    source=next((n for n in candidate['nodes'] if n['id']==origin['sourceNodeId']),None)
    if not any(c.get('from')==origin['sourceNodeId'] and c.get('to')==analysis_id and c.get('kind')=='input' for c in candidate['connections']):
        raise HTTPException(409,'原文到分析节点的输入连接已改变，请核对并重新运行')
    proof=node.get('storyAnalysisResult') or {}
    output=node.get('text' if node['type']=='smart-prompt' else 'outputText','')
    if not source or not proof or proof.get('sourceText')!=source.get('text') or proof.get('outputText')!=output:
        raise HTTPException(409,'原文或分析结果已变化，请重新运行分析节点')
    if (proof.get('provider'),proof.get('model'))!=(node.get('llmProvider'),node.get('llmModel' if node['type']=='smart-prompt' else 'model')):
        raise HTTPException(409,'分析模型已变化，请重新运行')
    try:
        text=output.strip()
        if text.startswith('```'):
            text='\n'.join(text.splitlines()[1:-1])
        data=StoryWorkflow.model_validate_json(text)
    except (ValidationError,ValueError,TypeError):
        raise HTTPException(422,'分析结果不符合分镜JSON格式，原结果保留，请修正后重新运行')
    if data.sourceNodeId!=source['id']:
        raise HTTPException(422,'分析结果引用了错误的原文节点')
    # 复用已有剧情引用与分镜校验和原生表结构，仅落地本阶段所需的表。
    scratch=copy.deepcopy(candidate)
    _,_,receipt=create_story_nodes(scratch,data,key=analysis_id,settings={},x=0,y=0,images=False)
    built=next(n for n in scratch['nodes'] if n['id']==receipt['tableId'])
    tid='analysis_table_'+hashlib.sha256(analysis_id.encode()).hexdigest()[:24]
    table=copy.deepcopy(built);table.update(id=tid,x=float(node.get('x',0))+440,y=float(node.get('y',0)))
    table['shotTableData']['productionData'].update(documentNodeIds={},analysisNodeId=analysis_id)
    table['shotTableData']['generationMap']={}
    old=next((n for n in candidate['nodes'] if n['id']==tid),None)
    if old:
        if old.get('type')!=table['type'] or (old.get('shotTableData') or {}).get('productionData',{}).get('analysisNodeId')!=analysis_id:
            raise HTTPException(409,'分镜输出节点归属已变化')
        previous=old.get('shotTableData') or {}
        if previous.get('generationMap') or previous.get('shotPromptMap') or previous.get('revision',0):
            raise HTTPException(409,'分镜已有手动编辑或配图链，请保留当前结果，另建分析流程')
        old['shotTableData']=table['shotTableData'];created=[]
    else:
        candidate['nodes'].append(table);created=[tid]
    node['storyWorkflowOrigin']={'tableId':tid,'sourceNodeId':source['id']}
    eid=tid+'_result'
    if not any(c['id']==eid for c in candidate['connections']):
        candidate['connections'].append({'id':eid,'from':analysis_id,'to':tid,'kind':'story'});edges=[eid]
    else:edges=[]
    return created,edges,{**receipt,'tableId':tid,'documentNodeIds':{},'analysisNodeId':analysis_id,'generationMap':{}}
