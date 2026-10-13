"""功能删除边界：历史数据保留，专属执行关闭，共享入口仍存在。"""
import copy
import unittest

from fastapi import HTTPException
from backend.canvas_assistant_native import native_catalog, prepare_native_action
from backend.canvas_assistant_state import read_node_state


class RemovedDirectorTests(unittest.TestCase):
    def test_retired_nodes_cannot_be_created_or_run_and_history_stays_intact(self):
        for kind, types in [('classic', ['minimax', 'ltxDirector']), ('smart', ['smart-minimax'])]:
            for node_type in types:
                canvas = {'id': 'c', 'kind': kind, 'updated_at': 1, 'connections': [],
                          'nodes': [{'id': 'old', 'type': node_type, 'segments': [{'id': 's', 'result': {'url': '/output/original.mp4'}}],
                                     'ltxTimelineData': '{"segments":[]}', 'workflow': 'historical.json'}]}
                original = copy.deepcopy(canvas)
                self.assertNotIn(node_type, {r['type'] for r in native_catalog(kind)})
                for action in [{'action': 'create', 'type': node_type}, {'action': 'run', 'nodeId': 'old', 'maxCalls': 1}]:
                    with self.assertRaises(HTTPException):
                        prepare_native_action(canvas, action, 'removed')
                self.assertEqual(read_node_state(canvas, 'old')['capabilityStatus'], 'unknown')
                self.assertEqual(canvas, original)

    def test_shared_native_capabilities_remain_available(self):
        classic = {r['type']: r for r in native_catalog('classic')}
        smart = {r['type']: r for r in native_catalog('smart')}
        for name in ['llm', 'generator', 'video', 'comfy', 'rh', 'midjourney', 'msgen']:
            self.assertIn('run', classic[name]['availableActions'])
        self.assertIn('media_export', classic['clip']['availableActions'])
        for name in ['smart-image', 'smart-prompt', 'smart-group', 'smart-loop']:
            self.assertIn('run', smart[name]['availableActions'])
