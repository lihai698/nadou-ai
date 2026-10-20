"""公共节点规则必须能在没有操作编排器时供领域模块使用。"""
from pathlib import Path
import subprocess
import sys
import unittest


class NodeRuleBoundaryTests(unittest.TestCase):
    def test_domain_modules_import_without_operation_orchestrator(self):
        root = Path(__file__).resolve().parents[1]
        script = '''
import importlib, importlib.abc, sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
class BlockOrchestrator(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname in {'backend.canvas_assistant_operations', 'main'}:
            raise AssertionError('domain imported orchestrator: ' + fullname)
sys.meta_path.insert(0, BlockOrchestrator())
for name in ('node_rules', 'generation', 'story', 'story_analysis', 'shot_prompts', 'state'):
    module = importlib.import_module('backend.canvas_assistant_' + name)
    assert Path(module.__file__).resolve().is_relative_to(Path(sys.argv[1]))
from backend.canvas_assistant_node_rules import CreateNode, new_node, is_busy
from backend.canvas_assistant_story import sync_story_prompt
from fastapi import HTTPException
for kind in ('classic', 'smart'):
    op = CreateNode(op='create', operationId='c', ref='p', type='image_generator')
    node = new_node(kind, op, 'image', 10, 20, {'provider_id':'user-provider', 'model':'user-model'}, 5)
    assert (node.get('runSettings') or node).get('model') == 'user-model'
    assert node['type'] == ('smart-loop' if kind == 'smart' else 'generator')
    node.update(audioTaskId='original-task', audioStatus='query-paused', running=False)
    assert is_busy(node)
    node['audioStatus'] = 'done'
    assert not is_busy(node)
# Exercise the former deferred back-import on a real domain operation.
image = {'id':'image', 'type':'generator', 'shotTableOrigin':{'tableId':'table','rowId':'row'},
         'audioTaskId':'task', 'audioStatus':'unknown'}
table = {'id':'table', 'shotTableData':{'rows':[{'id':'row','imagePrompt':'old'}],
         'generationMap':{'row':{'promptId':'prompt','generatorId':'image'}}}}
canvas = {'nodes':[table,image], 'connections':[{'from':'prompt','to':'image'}]}
prompt = {'id':'prompt', 'storyWorkflowOrigin':{'tableId':'table'}}
try:
    sync_story_prompt(canvas, prompt, 'new')
except HTTPException as exc:
    assert exc.status_code == 409
else:
    raise AssertionError('busy story image was edited')
assert table['shotTableData']['rows'][0]['imagePrompt'] == 'old'
image['audioStatus'] = 'done'
assert sync_story_prompt(canvas, prompt, 'new') == ['table','image']
assert table['shotTableData']['rows'][0]['imagePrompt'] == 'new'
'''
        result = subprocess.run([sys.executable, '-X', 'utf8', '-B', '-c', script, str(root)], cwd=root,
                                capture_output=True, text=True, encoding='utf8')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
