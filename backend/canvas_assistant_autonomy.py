"""本轮自动执行授权：普通编辑白名单、手选模型和持久调用上限。"""
from fastapi import HTTPException


def safe_action(proposal):
    return (not proposal.get('chargeable') and proposal.get('action') in {
        'create','update','connect','shot_edit','shot_select','shot_materialize','loop_prompts','shot_column'}
        and not (proposal.get('action')=='shot_column' and (proposal.get('arguments') or {}).get('columnAction')=='delete'))


def selected_models(turn):
    payload=(turn.get('agent') or {}).get('payload') or {}
    settings=payload.get('creationSettings') or {}
    pairs={(turn.get('provider'),turn.get('model'))}
    if payload.get('imageModelConfirmed'):
        pairs.add((settings.get('provider_id'),settings.get('model')))
    # 原节点上手选的模型也必须在授权界面明确列出。
    for proposal in turn.get('nativeActions',[]):
        if proposal.get('action')=='run' and proposal.get('state')=='pending':
            run=proposal.get('runSettings') or {};pairs.add((run.get('provider'),run.get('model')))
    for proposal in turn.get('proposals',[]):
        if proposal.get('state')=='pending':pairs.add((proposal.get('provider'),proposal.get('model')))
    return {p for p in pairs if all(isinstance(v,str) and v for v in p) and p[0]!='per-slot'}


def authorize(turn,total,models):
    if turn.get('state') not in {'waiting_confirmation','waiting_result','paused','interrupted'}:
        raise HTTPException(409,'只能授权当前等待中的创作回合；已停止或完成的回合不能自动执行')
    pairs={(m['provider'],m['model']) for m in models}
    if not pairs or not pairs<=selected_models(turn):raise HTTPException(409,'授权模型必须来自本轮手选模型或待确认的原节点')
    prior=turn.get('authorization') or {};used=prior.get('used',0)
    if type(total) is not int or not max(1,used)<=total<=100:raise HTTPException(422,'节点运行上限必须为已预留数量至100之间的整数')
    turn['authorization']={'limit':total,'used':used,'models':[{'provider':p,'model':m} for p,m in sorted(pairs)],'reservations':prior.get('reservations',{})}
    return turn['authorization']


def reserve(turn,identity,provider,model,calls):
    if turn.get('state') not in {'waiting_confirmation','waiting_result','interrupted'}:
        raise HTTPException(409,'当前回合不允许自动提交，停止后不会继续运行')
    if any(p.get('state') in {'submission_unknown','submitting'} for p in [*turn.get('nativeActions',[]),*turn.get('proposals',[])]):
        raise HTTPException(409,'本轮存在受理状态未知的任务，请先查询原任务')
    grant=turn.get('authorization') or {}
    if not grant or {'provider':provider,'model':model} not in grant.get('models',[]):raise HTTPException(409,'这个模型尚未获得本轮自动执行授权')
    if type(calls) is not int or not 1<=calls<=100:raise HTTPException(422,'自动执行调用数量无效')
    item={'provider':provider,'model':model,'calls':calls}
    existing=grant['reservations'].get(identity)
    if existing:
        if existing!=item:raise HTTPException(409,'同一动作的模型或调用范围已变化')
        return
    if grant['used']+calls>grant['limit']:raise HTTPException(409,'本轮节点运行额度已用完，请在任务面板重新确认上限')
    grant['used']+=calls;grant['reservations'][identity]=item
