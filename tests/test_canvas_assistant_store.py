"""会话历史可以独立恢复，不加载 HTTP 路由、工具或画布执行器。"""
from pathlib import Path
import subprocess
import sys
import unittest


class AssistantStoreBoundaryTests(unittest.TestCase):
    def test_store_recovers_without_routes_or_executors(self):
        root = Path(__file__).resolve().parents[1]
        script = '''
import asyncio, importlib.abc, json, sys, tempfile
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0, sys.argv[1])
class BlockExecution(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname == 'main' or (fullname.startswith('backend.canvas_assistant') and fullname not in {
            'backend.canvas_assistant_store', 'backend.canvas_assistant_receipt_rules',
            'backend.canvas_assistant_plan'}):
            raise AssertionError('store loaded route or executor: ' + fullname)
sys.meta_path.insert(0, BlockExecution())
from backend.canvas_assistant_store import AssistantStore, checked_id
from backend.canvas_assistant_receipt_rules import receipt_key
from fastapi import HTTPException
import backend.canvas_assistant_store as store_module
assert Path(store_module.__file__).resolve().is_relative_to(Path(sys.argv[1]))
assert checked_id('canvas-A_1') == 'canvas-A_1'
for bad in ('../escape', 'a/b', '', 'x' * 101):
    try:
        checked_id(bad)
    except HTTPException as exc:
        assert exc.status_code == 400
    else:
        raise AssertionError('invalid identifier accepted')
assert receipt_key('owner', 'turn') == receipt_key('owner', 'turn')
assert receipt_key('owner', 'turn') != receipt_key('other', 'turn')
with tempfile.TemporaryDirectory() as directory:
    store = AssistantStore(lambda: directory, owner='process-one')
    session = store.create('owner', 'canvas', '新对话')
    payload = SimpleNamespace(canvasId='canvas', sessionId=session['id'], requestId='turn',
        message='创建节点', provider='fixture', model='text', selectedNodeIds=[], referencedNodeIds=[])
    store.start('owner', payload)
    old_execution = payload._execution_id
    agent = {'payload': {'expectedUpdatedAt': 0}, 'messages': []}
    step = {'id': 'step', 'tool': 'apply_canvas_operations', 'state': 'running'}
    store.checkpoint('owner', payload, agent, step)
    restored = AssistantStore(lambda: directory, owner='process-two')
    assert restored.turn('owner', payload)['state'] == 'interrupted'
    receipt = {'updatedAtAfter': 2, 'createdNodeIds': ['node']}
    restored.reconcile('owner', 'canvas', {receipt_key('owner', 'step'): receipt})
    restored.reconcile('owner', 'canvas', {receipt_key('owner', 'step'): receipt})
    recovered = restored.turn('owner', payload)
    assert recovered['change']['createdNodeIds'] == ['node']
    assert len(recovered['agent']['messages']) == 1
    continued, claimed = restored.claim_continue('owner', payload)
    assert claimed and continued['owner'] == 'process-two' and continued['executionId'] != old_execution
    try:
        store.checkpoint('owner', payload, agent)
    except asyncio.CancelledError:
        pass
    else:
        raise AssertionError('old process retained execution ownership')
    restored.stop('owner', payload)
    restored.reconcile('owner', 'canvas', {receipt_key('owner', 'step'): receipt})
    assert restored.turn('owner', payload)['state'] == 'cancelled'
    try:
        restored.claim_continue('owner', payload)
    except HTTPException as exc:
        assert exc.status_code == 409
    else:
        raise AssertionError('cancelled turn resumed')
    path = restored.path('owner', 'broken')
    path.parent.mkdir(parents=True, exist_ok=True)
    broken = b'{broken history'
    path.write_bytes(broken)
    try:
        restored.transact('owner', 'broken')
    except HTTPException as exc:
        assert exc.status_code == 500
    else:
        raise AssertionError('corrupt history overwritten')
    assert path.read_bytes() == broken
'''
        result = subprocess.run([sys.executable, '-X', 'utf8', '-B', '-c', script, str(root)],
                                cwd=root, capture_output=True, text=True, encoding='utf8')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
