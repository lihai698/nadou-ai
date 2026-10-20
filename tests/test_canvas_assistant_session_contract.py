"""助手请求和公开回执无需加载路由、历史存储或执行器。"""
from pathlib import Path
import subprocess
import sys
import unittest


class SessionContractBoundaryTests(unittest.TestCase):
    def test_requests_and_public_views_without_execution_or_history(self):
        root = Path(__file__).resolve().parents[1]
        script = '''
import copy, importlib.abc, sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
class BlockExecution(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname == 'main' or (fullname.startswith('backend.canvas_assistant') and fullname not in {
            'backend.canvas_assistant_request_schema', 'backend.canvas_assistant_session_views',
            'backend.canvas_assistant_skills'}):
            raise AssertionError('session contract loaded execution or storage: ' + fullname)
sys.meta_path.insert(0, BlockExecution())
from backend.canvas_assistant_request_schema import TurnRequest, AuthorizationRequest, PlanBudgetRequest, NativeActionRequest
from backend.canvas_assistant_session_views import public_native, public_skill_usage, final_event
from backend.canvas_assistant_skills import BUILTINS, SkillCatalog
from pydantic import ValidationError
import backend.canvas_assistant_request_schema as schema
assert Path(schema.__file__).resolve().is_relative_to(Path(sys.argv[1]))
def no_disk(*args, **kwargs):
    raise AssertionError('request contract read Skill files')
SkillCatalog.snapshot = no_disk
fields = dict(canvasId='canvas',sessionId='session',requestId='turn',message='保持原文',provider='fixture',model='text',expectedUpdatedAt=1)
for skill in ('auto', *BUILTINS):
    payload = TurnRequest(**fields, skillId=skill)
    payload._execution_id = 'private-owner'
    assert '_execution_id' not in payload.model_dump()
for changed in ({'skillId':'unknown'}, {'message':''}, {'selectedNodeIds':['x']*31}):
    try:
        TurnRequest(**{**fields, **changed})
    except ValidationError:
        pass
    else:
        raise AssertionError('invalid turn accepted')
common = {key:fields[key] for key in ('canvasId','sessionId','requestId')}
for model, values in (
    (AuthorizationRequest, dict(total=True,models=[dict(provider='p',model='m')])),
    (PlanBudgetRequest, dict(total=1,unexpected=True)),
    (NativeActionRequest, dict(turnId='turn',actionId='action',action='delete'))):
    try:
        model(**{**common, **values})
    except ValidationError:
        pass
    else:
        raise AssertionError('invalid action or authorization accepted')
proposal = {'id':'action','action':'native_run','receipt':{'nodeIds':['node']},
    'beforeClipData':{'private':'clip'},'baselineNodeIds':['old'],
    'baselineGenerationMap':{'old':'internal'},'mediaExportPlan':{'private':'plan'}}
original = copy.deepcopy(proposal)
public = public_native(proposal)
assert public == {'id':'action','action':'native_run','receipt':{'nodeIds':['node']}}
public['receipt']['nodeIds'].append('changed')
assert proposal == original
turn = {'state':'completed','reply':'已保存','agent':{'skillsUsed':[
    {'id':'prompt-polish','name':'提示词整理','version':'v1','files':{'SKILL.md':'private body'}},
    {'id':'invalid'}]}}
assert public_skill_usage(turn) == [{'id':'prompt-polish','name':'提示词整理','version':'v1'}]
event = final_event(turn,'turn')
assert event == {'type':'turn_end','state':'completed','error':'','turnId':'turn','change':None,
    'proposals':[],'media':[],'reply':'已保存','steps':[],
    'skillsUsed':[{'id':'prompt-polish','name':'提示词整理','version':'v1'}]}
assert 'agent' not in event
'''
        result = subprocess.run([sys.executable, '-X', 'utf8', '-B', '-c', script, str(root)],
                                cwd=root, capture_output=True, text=True, encoding='utf8')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
