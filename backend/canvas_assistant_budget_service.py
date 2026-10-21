"""助手回合的额度与自动执行授权事务；策略和存储入口由应用显式提供。"""


async def plan_budget(payload, request, x_user_id, *, identity, store, persistent_plan, copy, time, asyncio, HTTPException):
    user,_=identity(request,x_user_id,payload.canvasId)
    def change(doc):
        turn=next((t for t in store.session(doc,payload.sessionId)['turns'] if t['id']==payload.requestId),None)
        plan=(turn or {}).get('agent',{}).get('plan')
        if not plan:raise HTTPException(404,'当前回合没有可设置额度的创作计划')
        if turn['state'] in {'running','cancelled','completed'}:raise HTTPException(409,'请在计划等待确认或暂停时设置额度')
        updated=persistent_plan.set_service_limit(plan,payload.total,canvas_id=payload.canvasId,session_id=payload.sessionId)
        if updated==plan:return {'plan':copy.deepcopy(plan)}
        if len(turn.get('serviceBudgetAuthorizations') or [])>=100:raise HTTPException(409,'本计划额度设置次数已达上限，请保留进度')
        turn['agent']['plan']=updated
        turn.setdefault('serviceBudgetAuthorizations',[]).append({'total':payload.total,'at':int(time.time()*1000)})
        return {'plan':copy.deepcopy(updated)}
    return await asyncio.to_thread(store.transact,user,payload.canvasId,change)


async def authorization(payload, request, x_user_id, *, identity, store, authorize_autonomy, persistent_plan, copy, asyncio, HTTPException):
    user,_=identity(request,x_user_id,payload.canvasId)
    def change(doc):
        turn=next((t for t in store.session(doc,payload.sessionId)['turns'] if t['id']==payload.requestId),None)
        if not turn:raise HTTPException(404,'当前创作回合不存在')
        grant=authorize_autonomy(turn,payload.total,[m.model_dump() for m in payload.models])
        plan=(turn.get('agent') or {}).get('plan')
        if plan:
            used=plan['budget']['used']['serviceCalls']
            turn['agent']['plan']=persistent_plan.set_service_limit(plan,used+max(0,grant['limit']-grant['used']),canvas_id=payload.canvasId,session_id=payload.sessionId)
        return {'authorization':copy.deepcopy(grant)}
    return await asyncio.to_thread(store.transact,user,payload.canvasId,change)
