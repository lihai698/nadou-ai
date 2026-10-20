"""工具协议校验不应加载画布操作执行器。"""
from pathlib import Path
import subprocess
import sys
import unittest


class OperationProtocolBoundaryTests(unittest.TestCase):
    def test_tools_validate_without_operation_executor(self):
        root = Path(__file__).resolve().parents[1]
        script = '''
import importlib.abc, sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
class BlockExecutor(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname in {'backend.canvas_assistant_operations', 'main',
                        'backend.canvas_assistant_story', 'backend.canvas_assistant_story_analysis',
                        'backend.canvas_assistant_shot_prompts'}:
            raise AssertionError('protocol loaded execution entry: ' + fullname)
sys.meta_path.insert(0, BlockExecutor())
from backend.canvas_assistant_tools import parse_decision, validate_tool
from fastapi import HTTPException
import backend.canvas_assistant_tools as tools
assert Path(tools.__file__).resolve().is_relative_to(Path(sys.argv[1]))
operation = {'op':'create','operationId':'c','ref':'p','type':'prompt','content':'原文'}
validated = validate_tool('apply_canvas_operations', {'operations':[operation]})
assert validated['operations'][0]['content'] == '原文'
analysis = validate_tool('create_story_analysis', {'sourceNodeId':'story','title':'故事','style':'水墨'})
assert analysis == {'sourceNodeId':'story','title':'故事','style':'水墨'}
assert validate_tool('create_shot_images', {'tableId':'table','rowIds':['shot']})['newAttempt'] is False
decision = parse_decision('{"reply":"计划","operations":[{"op":"connect","operationId":"e","from":"p","to":"g"}]}')
assert decision.legacy and decision.arguments['operations'][0]['from'] == 'p'
for invalid in ({**operation, 'taskId':'forbidden'}, {**operation, 'op':'delete'}):
    try:
        validate_tool('apply_canvas_operations', {'operations':[invalid]})
    except HTTPException as exc:
        assert exc.status_code == 422
    else:
        raise AssertionError('invalid operation accepted')
'''
        result = subprocess.run([sys.executable, '-X', 'utf8', '-B', '-c', script, str(root)],
                                cwd=root, capture_output=True, text=True, encoding='utf8')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
