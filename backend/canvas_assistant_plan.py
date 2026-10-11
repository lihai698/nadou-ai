"""创作助手持久计划的纯状态规则，JSON 由现有 AssistantStore 原子保存。

本模块不执行节点、不提交供应商任务，也不验证客户端声称的成功。
调用方须在现有 owner/executionId 锁内领取/停止，并仅传入真实持久回执。
预算增量及服务调用上限来自可信后端；模型只可提出目标、要求及依赖。
"""
from __future__ import annotations

import copy
import math
import re

from fastapi import HTTPException


DEFAULT_LIMITS = {'modelCalls': None, 'toolCalls': None, 'serviceCalls': 0, 'activeSeconds': None}
MAX_STEPS = 40
STOP_REASONS = {'interrupted', 'cancelled', 'paused'}


class BudgetExhausted(HTTPException):
    def __init__(self):
        super().__init__(409, '累计执行预算不足，已保存操作不能重复提交')


def _error(message, status=422):
    raise HTTPException(status, message)


def _text(value, label, maximum=12000):
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        _error(f'{label}无效或过长')
    return value


def _id(value):
    if not isinstance(value, str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,100}', value):
        _error('计划或步骤编号无效')
    return value


def _texts(values, label):
    if not isinstance(values, list) or len(values) > 40:
        _error(f'{label}必须是最多40项的列表')
    return [_text(item, label, 2000) for item in values]


def _amounts(values, *, defaults=False):
    if not isinstance(values, dict) or set(values) - set(DEFAULT_LIMITS):
        _error('预算字段无效')
    result = dict(DEFAULT_LIMITS) if defaults else {key: 0 for key in DEFAULT_LIMITS}
    for key, value in values.items():
        if defaults and value is None and key != 'serviceCalls':
            result[key] = None
            continue
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= 2 ** 53 - 1 or not math.isfinite(value):
            _error('预算必须是有限的非负数')
        if key != 'activeSeconds' and not isinstance(value, int):
            _error('调用预算必须是整数')
        result[key] = value
    return result


def create_plan(*, plan_id, canvas_id, session_id, goal, steps, preserve=None, requirements=None, limits=None):
    """创建有限依赖计划；limits 必须由可信服务端决定，不能采用模型额度。"""
    if not isinstance(steps, list) or not 1 <= len(steps) <= MAX_STEPS:
        _error('计划必须包含1到40个步骤')
    entries = []
    for step in steps:
        if not isinstance(step, dict) or set(step) - {'id', 'description', 'dependsOn'}:
            _error('计划步骤只能包含编号、说明和依赖')
        dependencies = step.get('dependsOn', [])
        if not isinstance(dependencies, list) or len(dependencies) > MAX_STEPS:
            _error('步骤依赖无效')
        dependencies = [_id(item) for item in dependencies]
        if len(set(dependencies)) != len(dependencies):
            _error('步骤依赖重复')
        entries.append({'id': _id(step.get('id')), 'description': _text(step.get('description'), '步骤说明', 2000),
                        'dependsOn': dependencies, 'state': 'pending', 'serviceCalls': 0, 'receipt': None})
    ids = {step['id'] for step in entries}
    if len(ids) != len(entries) or any(set(step['dependsOn']) - ids for step in entries):
        _error('步骤编号重复或依赖不存在')
    visited = set()
    while len(visited) < len(entries):
        available = {step['id'] for step in entries if step['id'] not in visited and set(step['dependsOn']) <= visited}
        if not available:
            _error('计划依赖存在循环；原生循环节点应作为一个步骤使用')
        visited.update(available)
    return {'version': 1, 'id': _id(plan_id), 'canvasId': _id(canvas_id), 'sessionId': _id(session_id),
            'goal': _text(goal, '创作目标'), 'preserve': _texts([] if preserve is None else preserve, '保留要求'),
            'requirements': _texts([] if requirements is None else requirements, '输出要求'),
            'steps': entries, 'state': 'planned', 'executionId': '', 'stopReason': '',
            'budget': {'limit': _amounts(DEFAULT_LIMITS if limits is None else limits, defaults=True),
                       'used': _amounts({}), 'events': {}}}


def _copy(plan):
    if not isinstance(plan, dict) or plan.get('version') != 1:
        _error('计划格式或版本不支持，原记录应保留', 409)
    try:
        if set(plan) != {'version', 'id', 'canvasId', 'sessionId', 'goal', 'preserve', 'requirements',
                         'steps', 'state', 'executionId', 'stopReason', 'budget'}:
            raise ValueError('plan fields')
        if not isinstance(plan['steps'], list):
            raise ValueError('steps')
        for step in plan['steps']:
            if not isinstance(step, dict) or set(step) != {'id', 'description', 'dependsOn', 'state', 'serviceCalls', 'receipt'}:
                raise ValueError('step fields')
            if step['state'] not in {'pending', 'waiting_confirmation', 'running', 'waiting_result', 'unknown', 'completed', 'failed'}:
                raise ValueError('step state')
            _amounts({'serviceCalls': step['serviceCalls']})
            if step['receipt'] is not None and _receipt(step['receipt']) != step['receipt']:
                raise ValueError('receipt')
        budget = plan['budget']
        if not isinstance(budget, dict) or set(budget) != {'limit', 'used', 'events'}:
            raise ValueError('budget fields')
        if set(budget['limit']) != set(DEFAULT_LIMITS) or set(budget['used']) != set(DEFAULT_LIMITS):
            raise ValueError('budget keys')
        limit, used = _amounts(budget['limit'], defaults=True), _amounts(budget['used'])
        if not isinstance(budget['events'], dict):
            raise ValueError('events')
        total = _amounts({})
        for event_id, event in budget['events'].items():
            _text(event_id, '预算事件编号', 240)
            if not isinstance(event, dict) or set(event) != set(DEFAULT_LIMITS):
                raise ValueError('event keys')
            amounts = _amounts(event)
            total = {key: total[key] + amounts[key] for key in DEFAULT_LIMITS}
        if total != used or any(limit[key] is not None and used[key] > limit[key] for key in DEFAULT_LIMITS):
            raise ValueError('budget accounting')
        done = {step['id'] for step in plan['steps'] if step['state'] == 'completed'}
        receipt_ids = set()
        for step in plan['steps']:
            state, calls, receipt = step['state'], step['serviceCalls'], step['receipt']
            event = budget['events'].get(f"service:{step['id']}")
            if state == 'pending' and (receipt is not None or calls or event is not None):
                raise ValueError('pending step has effects')
            if state == 'waiting_confirmation' and (receipt is not None or not calls or event is not None):
                raise ValueError('confirmation step has effects')
            if state not in {'pending', 'waiting_confirmation'}:
                if not set(step['dependsOn']) <= done:
                    raise ValueError('unfinished dependency')
                if (calls and event != _amounts({'serviceCalls': calls})) or (not calls and event is not None):
                    raise ValueError('service reservation')
            if state in {'completed', 'failed', 'waiting_result'}:
                expected = {'completed': 'completed', 'failed': 'failed', 'waiting_result': 'accepted'}[state]
                if receipt is None or receipt['state'] != expected:
                    raise ValueError('receipt state')
            if state == 'running' and receipt is not None:
                raise ValueError('running receipt')
            if state == 'unknown' and receipt is not None and receipt['state'] != 'submission_unknown':
                raise ValueError('unknown receipt')
            if receipt is not None:
                if receipt['id'] in receipt_ids or calls and len(receipt['tasks']) > calls:
                    raise ValueError('receipt ownership')
                if calls and state == 'completed' and not receipt['tasks'] and not (calls==1 and receipt.get('synchronousEvidence')):
                    raise ValueError('missing original tasks')
                receipt_ids.add(receipt['id'])
        create_plan(plan_id=plan['id'], canvas_id=plan['canvasId'], session_id=plan['sessionId'],
                    goal=plan['goal'], preserve=plan['preserve'], requirements=plan['requirements'], limits=limit,
                    steps=[{key: step[key] for key in ('id', 'description', 'dependsOn')} for step in plan['steps']])
        if plan['state'] not in {'planned', 'running', 'completed', *STOP_REASONS}:
            raise ValueError('plan state')
        if (plan['state'] == 'completed') != (len(done) == len(plan['steps'])):
            raise ValueError('plan completion')
        if plan['state'] in {'running', 'completed'}:
            _id(plan['executionId'])
        elif plan['executionId'] != '':
            raise ValueError('execution lease')
        if plan['stopReason'] not in {'', *STOP_REASONS}:
            raise ValueError('stop reason')
    except (KeyError, TypeError, ValueError, HTTPException) as exc:
        raise HTTPException(409, '持久计划记录无效，保留原文件并核对，不自动重建或执行') from exc
    return copy.deepcopy(plan)


def _owned(plan, execution_id, *, completed=False):
    _id(execution_id)
    allowed = {'running', 'completed'} if completed else {'running'}
    if plan.get('executionId') != execution_id or plan.get('state') not in allowed:
        _error('计划已停止或执行归属已改变，请读取原记录', 409)


def _step(plan, step_id):
    result = next((step for step in plan['steps'] if step['id'] == step_id), None)
    if result is None:
        _error('计划步骤不存在', 404)
    return result


def next_steps(plan):
    """仅列出尚未开始且依赖已完成的步骤；不返回可自动重试的失败步骤。"""
    plan = _copy(plan)
    if plan['state'] in {'cancelled', 'interrupted', 'paused', 'completed'}:
        return []
    done = {step['id'] for step in plan['steps'] if step['state'] == 'completed'}
    return [step['id'] for step in plan['steps'] if step['state'] == 'pending' and set(step['dependsOn']) <= done]


def claim_plan(plan, *, canvas_id, session_id, execution_id):
    """恢复只换执行归属，不重置额度、回执或原任务；需在 Store 事务中调用。"""
    result = _copy(plan)
    _id(execution_id)
    if result['canvasId'] != canvas_id or result['sessionId'] != session_id:
        _error('计划不属于当前画布或会话', 409)
    if result['state'] in {'cancelled', 'completed'}:
        _error('计划已停止或完成，不能自动重开', 409)
    if result['executionId'] and result['executionId'] != execution_id:
        _error('计划已有执行器，请先停止或核对原状态', 409)
    result.update(state='running', executionId=execution_id, stopReason='')
    return result


def set_service_limit(plan, total, *, canvas_id, session_id):
    """仅供明确用户设置入口在 Store 事务中调用，不向模型开放。

    设置应用内累计服务次数上限不代表确认任何步骤；任务仍须逐项确认。
    本规则不执行步骤、提交任务、重置已用额度或改变其它累计预算。
    """
    result = _copy(plan)
    if type(total) is not int or not 0 <= total <= 100:
        _error('累计服务次数必须是0到100之间的整数')
    if result['canvasId'] != canvas_id or result['sessionId'] != session_id:
        _error('计划不属于当前画布或会话', 409)
    if result['state'] in {'completed', 'cancelled'}:
        _error('计划已经完成或停止，不能修改服务额度', 409)
    if any(step['state'] in {'running', 'waiting_result', 'unknown'} for step in result['steps']):
        _error('仍有正在执行或状态待核对的步骤，请先处理原任务', 409)
    if total < result['budget']['used']['serviceCalls']:
        _error('累计服务额度不能低于已经使用的次数', 409)
    result['budget']['limit']['serviceCalls'] = total
    return result


def charge_budget(plan, event_id, amounts, *, execution_id):
    """请求前记账；同事件同增量幂等，失败/断线不退款，绝不自动扩额。"""
    result = _copy(plan)
    _owned(result, execution_id, completed=True)
    _text(event_id, '预算事件编号', 240)
    amounts = _amounts(amounts)
    budget = result['budget']
    if event_id in budget['events']:
        if budget['events'][event_id] != amounts:
            _error('相同预算事件的调用范围已改变', 409)
        return result
    used = {key: budget['used'][key] + amounts[key] for key in DEFAULT_LIMITS}
    if any(budget['limit'][key] is not None and used[key] > budget['limit'][key] for key in DEFAULT_LIMITS):
        raise BudgetExhausted()
    budget['used'] = used
    budget['events'][event_id] = amounts
    return result


def start_step(plan, step_id, *, execution_id, service_calls=0, confirmed=False):
    """service_calls 来自原生预检的真实调用上限；确认后预留且只启动一次。"""
    result = _copy(plan)
    _owned(result, execution_id)
    _amounts({'serviceCalls': service_calls})
    if not isinstance(confirmed, bool):
        _error('确认状态无效')
    step = _step(result, step_id)
    if step['state'] in {'completed', 'running', 'waiting_result'}:
        if step['serviceCalls'] != service_calls:
            _error('已开始步骤的调用范围不能改变', 409)
        return result
    if step['state'] in {'unknown', 'failed'}:
        _error('已开始或失败步骤只核对原回执，重新提交必须另建确认方案', 409)
    done = {item['id'] for item in result['steps'] if item['state'] == 'completed'}
    if not set(step['dependsOn']) <= done:
        _error('前置步骤尚未完成', 409)
    if any(item['id'] != step_id and item['state'] in {'running', 'waiting_result', 'unknown', 'waiting_confirmation'} for item in result['steps']):
        _error('仍有阶段等待执行或核验，请先处理原阶段', 409)
    if step['state'] == 'waiting_confirmation' and step['serviceCalls'] != service_calls:
        _error('待确认阶段的调用范围已经变化', 409)
    if service_calls and not confirmed:
        step['serviceCalls'] = service_calls
        step['state'] = 'waiting_confirmation'
        return result
    if service_calls:
        result = charge_budget(result, f'service:{step_id}', {'serviceCalls': service_calls}, execution_id=execution_id)
        step = _step(result, step_id)
    step['serviceCalls'] = service_calls
    step['state'] = 'running'
    return result


def _receipt(receipt):
    if not isinstance(receipt, dict) or set(receipt) - {'id', 'state', 'nodeIds', 'tasks', 'error', 'synchronousEvidence'}:
        _error('回执字段无效；不能传入模型或客户端自称成功的内容')
    if receipt.get('state') not in {'completed', 'accepted', 'failed', 'submission_unknown'}:
        _error('回执状态无效')
    nodes = receipt.get('nodeIds', [])
    tasks = receipt.get('tasks', [])
    if not isinstance(nodes, list) or len(nodes) > 100 or not isinstance(tasks, list) or len(tasks) > 100:
        _error('回执节点或任务列表无效')
    nodes = [_id(node) for node in nodes]
    refs = []
    for task in tasks:
        if not isinstance(task, dict) or set(task) != {'kind', 'id'} or task['kind'] not in {'image', 'video', 'comfy', 'depth', 'runninghub'}:
            _error('原任务引用无效')
        task_id = _text(task['id'], '原任务编号', 240)
        if not re.fullmatch(r'[a-zA-Z0-9_.:-]+', task_id):
            _error('原任务编号不能包含路径或任意内容')
        refs.append({'kind': task['kind'], 'id': task_id})
    if len(set(nodes)) != len(nodes) or len({(task['kind'], task['id']) for task in refs}) != len(refs):
        _error('回执引用重复')
    if receipt['state'] == 'accepted' and not refs:
        _error('已受理回执必须包含原任务编号')
    error = receipt.get('error', '')
    if not isinstance(error, str) or len(error) > 2000:
        _error('回执错误说明无效')
    result={'id': _id(receipt.get('id')), 'state': receipt['state'], 'nodeIds': nodes, 'tasks': refs, 'error': error}
    evidence=receipt.get('synchronousEvidence')
    if evidence is not None:
        if (not isinstance(evidence,dict) or set(evidence)!={'kind','actionId','nodeId','outputHash'} or evidence.get('kind')!='llm'
            or evidence.get('actionId')!=result['id'] or nodes!=[evidence.get('nodeId')] or refs or receipt['state']!='completed'
            or not isinstance(evidence.get('outputHash'),str) or not re.fullmatch(r'[0-9a-f]{64}',evidence['outputHash'])):
            _error('同步LLM回执必须绑定原动作、唯一原节点和服务端核实的正文摘要')
        result['synchronousEvidence']=copy.deepcopy(evidence)
    return result


def record_step(plan, step_id, receipt, *, execution_id):
    """只消费服务端核实的实际保存回执；accepted 不等于作品合格。"""
    result = _copy(plan)
    _owned(result, execution_id, completed=True)
    step = _step(result, step_id)
    receipt = _receipt(receipt)
    if any(other['id'] != step_id and (other['receipt'] or {}).get('id') == receipt['id'] for other in result['steps']):
        _error('该回执已经属于另一个计划步骤，不能重复认领', 409)
    # 零新提交步骤可引用已存在的原任务；查询/取消不占新生成次数。
    if step['serviceCalls'] and len(receipt['tasks']) > step['serviceCalls']:
        _error('原任务数量超过已确认的服务调用范围', 409)
    if step['serviceCalls'] and receipt['state'] == 'completed' and not receipt['tasks'] and not (step['serviceCalls']==1 and receipt.get('synchronousEvidence')):
        _error('服务调用完成须核对原任务编号，不能仅使用文字成功回执', 409)
    previous = step['receipt']
    if step['state'] not in {'running', 'waiting_result', 'unknown', 'completed'}:
        _error('该步骤尚未执行或已经失败', 409)
    if previous:
        if previous['id'] != receipt['id'] or (previous['tasks'] and previous['tasks'] != receipt['tasks']) or (previous['nodeIds'] and previous['nodeIds'] != receipt['nodeIds']):
            _error('回执或原任务归属已经改变，不能替换原编号', 409)
        if step['state'] == 'completed':
            if previous != receipt:
                _error('已完成回执不能改写', 409)
            return result
    step['receipt'] = receipt
    step['state'] = {'completed': 'completed', 'accepted': 'waiting_result', 'failed': 'failed', 'submission_unknown': 'unknown'}[receipt['state']]
    if all(item['state'] == 'completed' for item in result['steps']):
        result['state'] = 'completed'
    return result


def stop_plan(plan, *, execution_id, reason='interrupted'):
    """断线或停止保留预算和回执；无受理编号的在途步骤转 unknown，不重提。"""
    result = _copy(plan)
    _owned(result, execution_id)
    if reason not in STOP_REASONS:
        _error('停止原因无效')
    for step in result['steps']:
        if step['state'] == 'running':
            step['state'] = 'waiting_result' if (step['receipt'] or {}).get('tasks') else 'unknown'
    result.update(state=reason, executionId='', stopReason=reason)
    return result
