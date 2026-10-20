"""故事生产数据校验及原生节点落地；内容由创作助手提供，不在此代写。"""
from __future__ import annotations

import copy
import hashlib
import html
import json

from fastapi import HTTPException
from backend.canvas_assistant_node_rules import CreateNode, is_busy, new_node


def create_story_nodes(candidate, data, *, key, settings, x, y, images=True):
    """调用方已持锁且完成画布版本/幂等检查；此处仅修改候选文档。"""
    nodes = candidate['nodes']
    source = next((n for n in nodes if n['id'] == data.sourceNodeId), None)
    if not source or source.get('type') not in {'prompt', 'text', 'smart-prompt'} or not source.get('text', '').strip():
        raise HTTPException(409, '请先将完整故事保存为文本节点，再读取真实编号创建工作流')
    smart = candidate.get('kind') == 'smart'
    table_type = 'smart-shot-table' if smart else 'shot-table'
    if images and (not settings.get('provider_id') or not settings.get('model')):
        raise HTTPException(409, '请先手动选择图片模型，新建分镜节点将保留此选择')
    groups = {name: getattr(data, name) for name in ('beats', 'characters', 'scenes', 'props', 'sounds', 'shots')}
    for name, values in groups.items():
        ids = [v.id for v in values]
        if len(ids) != len(set(ids)):
            raise HTTPException(422, f'{name}编号重复')
    lookup = {name: {v.id: v for v in values} for name, values in groups.items()}
    validation_errors = []
    for beat in data.beats:
        if beat.sourceExcerpt not in source['text']:
            validation_errors.append(f'剧情 {beat.id} 的原文引用与故事节点不一致')
    for sound in data.sounds:
        if sound.characterId and (sound.kind != 'voice' or sound.characterId not in lookup['characters']):
            validation_errors.append(f'声音 {sound.id} 的角色引用无效')
        if sound.kind == 'voice' and not sound.characterId:
            validation_errors.append(f'人物声音 {sound.id} 缺少角色引用')
    for shot in data.shots:
        for category, refs in (('beats', [shot.beatId]), ('scenes', [shot.sceneId]), ('characters', shot.characterIds), ('props', shot.propIds), ('sounds', shot.soundIds + [d.soundId for d in shot.dialogue])):
            if any(ref not in lookup[category] for ref in refs):
                validation_errors.append(f'分镜 {shot.id} 引用了不存在的 {category}')
        for line in shot.dialogue:
            sound = lookup['sounds'].get(line.soundId)
            if not sound:
                continue  # 缺失声音已在上面的引用检查中报告。
            if sound.kind not in {'voice', 'narration'} or sound.characterId and sound.characterId not in shot.characterIds:
                validation_errors.append(f'分镜 {shot.id} 的对白与人物声音不对应')
    if {s.beatId for s in data.shots} != set(lookup['beats']):
        validation_errors.append('每个剧情段落都需要有对应分镜，不能遗漏剧情')
    if validation_errors:
        # 一次返回本批所有来源/引用错误，让助手完整修正；整批仍不落地。
        raise HTTPException(422, '\n'.join(dict.fromkeys(validation_errors)))
    fingerprint = hashlib.sha256(source['text'].encode()).hexdigest()
    workflow_hash = hashlib.sha256(json.dumps({'data':data.model_dump(),'settings':settings,'source':fingerprint},ensure_ascii=False,sort_keys=True).encode()).hexdigest()
    existing = next((n for n in nodes if n.get('type') == table_type and (n.get('shotTableData') or {}).get('productionData',{}).get('workflowHash') == workflow_hash),None)
    if existing:
        table=existing['shotTableData']
        return [],[],dict(tableId=existing['id'],sourceNodeId=source['id'],sourceFingerprint=fingerprint,
                         documentNodeIds=copy.deepcopy(table['productionData']['documentNodeIds']),shotCount=len(table['rows']),
                         durationSeconds=table['source']['durationSeconds'],generationMap=copy.deepcopy(table['generationMap']),reused=True)
    uid = lambda ref: 'story_' + hashlib.sha256((key + ':' + ref).encode()).hexdigest()[:28]
    table_id = uid('table')
    created, edges = [], []
    # 正文→拆解→资产→表→逐镜提示词从左向右展开，避免前半程无连线。
    x = float(source.get('x', x))
    source['y'] = y + 495

    def link(ref, from_id, to_id, kind='story'):
        edge = dict(id=uid('edge-'+ref), **{'from':from_id, 'to':to_id}, kind=kind)
        candidate['connections'].append(edge)
        edges.append(edge['id'])

    def add(node):
        if any(n['id'] == node['id'] for n in nodes):
            raise HTTPException(409, '工作流节点已存在，请读取原回执')
        nodes.append(node); created.append(node['id'])

    def prompt(ref, title, text, px, py):
        # 原生提示词节点没有独立标题栏，正文首行必须能看出文档用途。
        if not ref.startswith('shot-'):
            text = title + '\n\n' + text
        n = dict(id=uid(ref), type='smart-prompt' if smart else 'prompt', title=title, text=text, x=px, y=py, w=316, h=260,
                 promptSeparator=';', promptSplitEnabled=False, llmEnabled=False, llmSystemEnabled=False,
                 storyWorkflowOrigin={'tableId': table_id, 'sourceNodeId': source['id'], 'sourceFingerprint': fingerprint})
        add(n)
        return n['id']

    breakdown = '\n\n'.join(f'{b.id} · {b.title}\n原文：{b.sourceExcerpt}\n剧情：{b.summary}' for b in data.beats)
    overview = prompt('overview', '工作流总览 · ' + data.title, '故事文本 → 剧情拆解 → 角色 / 场景 / 道具 / 声音 → 分镜表 → 每镜提示词 → 配图节点\n\n统一风格：' + data.style + '\n各阶段内容已由助手创作并保存；声音是制作设计，尚未合成音频；图片节点等待手动确认生成。', x+480, y+990)
    document_ids = {'overview': overview, 'beats': prompt('beats', '剧情拆解', breakdown, x+480, y+495)}
    link('source-beats', source['id'], document_ids['beats'])
    link('source-overview', source['id'], overview)
    labels = {'characters': '角色设定', 'scenes': '场景设定', 'props': '道具清单', 'sounds': '声音设计'}
    for i, category in enumerate(labels):
        text = '\n\n'.join(f'{v.id} · {v.name}\n' + (f'类型：{v.kind}；角色：{v.characterId or "旁白 / 环境"}\n' if category == 'sounds' else '') + v.description for v in groups[category]) or '本故事未使用此类资产。'
        document_ids[category] = prompt(category, labels[category], text, x+960, y+i*330)
        link('beats-'+category, document_ids['beats'], document_ids[category])
        link(category+'-table', document_ids[category], table_id)
    link('beats-table', document_ids['beats'], table_id)
    builtins = [('shotSize','景别'),('motion','运镜'),('visual','画面'),('dialogue','对白'),('onScreenText','屏幕文字'),('mood','情绪')]
    custom = [('beat','剧情来源'),('scene','场景'),('characters','角色'),('props','道具'),('sounds','音效 / 配乐'),('voice','声音 / 旁白'),('camera','机位 / 构图'),('action','动作'),('transition','衔接')]
    table = dict(version=1, revision=0, source=dict(kind='text', nodeId=source['id'], resultId='', sourceUrl='', title=data.title, fingerprint=fingerprint, durationSeconds=0),
                 columns=[dict(id=k,label=v,kind='builtin') for k,v in builtins] + [dict(id=k,label=v,kind='custom',hint=v) for k,v in custom],
                 rows=[], selectedRowIds=[], generationMap={}, analysisSettings={}, task={'status':'ready'},
                 productionData={**data.model_dump(), 'documentNodeIds': document_ids, 'sourceFingerprint':fingerprint,'workflowHash':workflow_hash})
    elapsed = 0
    named = lambda cat, refs: '、'.join(f'{r} · {lookup[cat][r].name}' for r in refs)
    for index, shot in enumerate(data.shots):
        duration = round(shot.durationSeconds,1)
        if duration <= 0:
            raise HTTPException(422, '镜头时长至少0.1秒')
        cells = {k:getattr(shot,k) for k,_ in builtins if k != 'dialogue'}
        cells.update(dialogue='\n'.join(f'{lookup["sounds"][d.soundId].name}：{d.text}' for d in shot.dialogue),
                     beat=f'{shot.beatId} · {lookup["beats"][shot.beatId].title}', scene=named('scenes',[shot.sceneId]),
                     characters=named('characters',shot.characterIds),props=named('props',shot.propIds),sounds=named('sounds',shot.soundIds),
                     voice='\n'.join(f'{d.soundId} · {lookup["sounds"][d.soundId].description}' for d in shot.dialogue),
                     camera=shot.camera,action=shot.action,transition=shot.transition)
        end = round(elapsed+duration,1)
        row = dict(id=shot.id,index=index+1,startSeconds=elapsed,endSeconds=end,durationSeconds=duration,cells=cells,
                   keyframeUrl='',imagePrompt=shot.imagePrompt,motionPrompt=shot.motionPrompt,visionFailed=False,carriedOver=False)
        table['rows'].append(row); elapsed=end
        # 拼入所引用资产的固定设定，所有镜头共享同一份人物/场景/道具定义。
        context = '\n'.join(f'{lookup[cat][ref].name}：{lookup[cat][ref].description}' for cat,refs in [('characters',shot.characterIds),('scenes',[shot.sceneId]),('props',shot.propIds)] for ref in refs)
        # 先显示本镜差异，再附统一设定，避免缩小后六镜都只显示相同开头。
        text = (f'分镜 {index+1} · {shot.title}\n本镜画面：{shot.visual}\n'
                f'景别：{shot.shotSize}\n机位 / 构图：{shot.camera}\n'
                f'动作：{shot.action}\n\n画面提示词：{shot.imagePrompt}\n\n'
                f'统一风格：{data.style}\n引用资产设定：\n{context}')
        if len(text)>12000:
            raise HTTPException(422, f'分镜 {shot.id} 的资产设定与提示词过长，请精简')
        row['imagePrompt'] = text
        if not images:
            continue
        px,py=x+2680,y+index*330
        p = prompt('shot-'+shot.id, f'分镜 {index+1} · {shot.title}',text,px,py)
        link('table-'+shot.id, table_id, p)
        image_id=uid('image-'+shot.id)
        origin=dict(tableId=table_id,rowId=shot.id,sourceFingerprint=fingerprint,durationSeconds=duration,motionPrompt=shot.motionPrompt)
        if smart:
            add(dict(id=image_id,type='smart-image',title=f'分镜 {index+1} 配图',x=px+370,y=py,w=340,h=260,images=[],
                 runSettings={**settings,'engine':'api','apiKind':'image','count':1},
                 promptDraftText=text,promptDraftHtml=html.escape(text),promptDraftTouched=True,shotTableOrigin=origin))
            output_id = image_id
        else:
            image = new_node('classic', CreateNode(op='create', operationId='image', ref='image', type='image_generator', title=f'分镜 {index+1} 配图'), image_id, px+370, py, settings, candidate.get('updated_at'))
            image.update(w=340, h=260, count=1, shotTableOrigin=origin)
            add(image)
            output_id = uid('output-'+shot.id)
            add(dict(id=output_id, type='output', title=f'分镜 {index+1} 输出', x=px+810, y=py, w=260, h=260, images=[]))
            link('output-'+shot.id, image_id, output_id, 'input')
        link(shot.id, p, image_id, 'input')
        table['generationMap'][f'{fingerprint}:{shot.id}']=dict(promptId=p,generatorId=image_id,outputId=output_id)
    table['source']['durationSeconds']=elapsed
    table['selectedRowIds']=[s.id for s in data.shots]
    add(dict(id=table_id,type=table_type,name=data.title+' · 文本分镜表',title='文本分镜表',x=x+1400,y=y+495,w=1120,h=390,shotTableData=table))
    return created, edges, {'tableId':table_id,'sourceNodeId':source['id'],'sourceFingerprint':fingerprint,'documentNodeIds':document_ids,'shotCount':len(data.shots),'durationSeconds':elapsed,'generationMap':copy.deepcopy(table['generationMap'])}


def sync_story_prompt(candidate, prompt, content):
    """编辑工作流提示词时同步对应表行和图片草稿，不改模型或已有结果。"""
    origin = prompt.get('storyWorkflowOrigin') or {}
    if not origin:
        return []
    nodes = {n['id']: n for n in candidate['nodes']}
    table_node = nodes.get(origin.get('tableId'))
    if not table_node:
        raise HTTPException(409, '工作流镜头表已丢失，请先核对来源')
    table = table_node.get('shotTableData') or {}
    chains = [v for v in (table.get('generationMap') or {}).values() if v.get('promptId') == prompt['id']]
    if any(v.get('promptProcessorId') for v in chains):
        raise HTTPException(409,'逐镜素材由分镜表同步，请编辑对应表行再运行本镜LLM')
    if not chains:  # 资产文档也记录表归属，但不是某镜配图链。
        return []
    if len(chains) != 1:
        raise HTTPException(409, '提示词对应多个镜头，未修改')
    image = nodes.get(chains[0].get('generatorId'))
    row_id = (image or {}).get('shotTableOrigin', {}).get('rowId')
    row = next((r for r in table.get('rows', []) if r['id'] == row_id), None)
    if (not image or image.get('type') not in {'smart-image', 'generator'} or not row
            or image.get('shotTableOrigin', {}).get('tableId') != table_node['id']
            or not any(e['from'] == prompt['id'] and e['to'] == image['id'] for e in candidate['connections'])):
        raise HTTPException(409, '镜头配图链不完整，未修改')
    if is_busy(image):
        raise HTTPException(409, '对应配图节点正在运行，未修改')
    if row.get('imagePrompt') == content and (image.get('type') == 'generator' or image.get('promptDraftText') == content):
        return []
    row['imagePrompt'] = content
    table['revision'] = int(table.get('revision') or 0) + 1
    production = table.get('productionData') or {}
    for shot in production.get('shots', []):
        if shot['id'] == row_id:
            shot['imagePrompt'] = content
    production.pop('workflowHash', None)  # 编辑后不能再以旧正文摘要复用。
    if image.get('type') == 'smart-image':
        image.update(promptDraftText=content, promptDraftHtml=html.escape(content), promptDraftTouched=True)
    return [table_node['id'], image['id']]
