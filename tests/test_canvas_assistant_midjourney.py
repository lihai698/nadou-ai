import ast
import copy
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import unittest

from fastapi import HTTPException
from backend.canvas_assistant_midjourney import prepare_midjourney_run_config, validate_midjourney_run_config


class MidjourneyConfigTests(unittest.TestCase):
    def setUp(self):
        self.node = {'id': 'mj', 'type': 'midjourney', 'apiProvider': 'manual', 'mode': 'imagine',
                     'version': '8.2', 'size': '16:9', 'speed': 'relax'}
        self.providers = [{'id': 'other', 'protocol': 'apimart'},
                          {'id': 'manual', 'protocol': 'apimart', 'api_key': 'private-test-secret'}]

    def prepare(self, node=None, providers=None, **kwargs):
        return prepare_midjourney_run_config(self.node if node is None else node,
            self.providers if providers is None else providers,
            reference_count=kwargs.pop('reference_count', 0), has_prompt=kwargs.pop('has_prompt', True), **kwargs)

    def test_precise_manual_provider_and_no_fallback(self):
        self.assertEqual(self.prepare()['provider'], 'manual')
        for provider_id in ['', 'missing']:
            with self.assertRaises(HTTPException):
                self.prepare({**self.node, 'apiProvider': provider_id})
        for providers in [self.providers + [self.providers[-1]],
                          [self.providers[0], {**self.providers[-1], 'enabled': False}],
                          [self.providers[0], {**self.providers[-1], 'protocol': 'openai', 'base_url': 'https://example.test'}]]:
            with self.assertRaises(HTTPException):
                self.prepare(providers=providers)

    def test_three_modes_keep_real_requirements_and_single_post(self):
        before = copy.deepcopy(self.node)
        self.assertEqual(self.prepare({**self.node, 'count': 8}, reference_count=7)['maxCalls'], 1)
        self.assertEqual(self.prepare(reference_count=7)['usedImageCount'], 4)
        self.assertEqual(self.prepare(reference_count=7)['ignoredImageCount'], 3)
        for mode in ['imagine', 'edit']:
            with self.assertRaises(HTTPException):
                self.prepare({**self.node, 'mode': mode}, reference_count=2, has_prompt=False)
        with self.assertRaises(HTTPException):
            self.prepare({**self.node, 'mode': 'edit'}, reference_count=0)
        edit = self.prepare({**self.node, 'mode': 'edit'}, reference_count=1)
        self.assertIsNone(edit['effectiveVersion'])
        blend = self.prepare({**self.node, 'mode': 'blend'}, reference_count=2, has_prompt=False)
        self.assertTrue(blend['supplierPath'].endswith('/blend'))
        for refs in [0, 1, 5]:
            with self.assertRaises(HTTPException):
                self.prepare({**self.node, 'mode': 'blend'}, reference_count=refs)
        self.assertEqual(self.node, before)

    def test_invalid_native_choices_and_no_implicit_defaults(self):
        for field, value in [('version', 'future'), ('mode', 'upscale'), ('speed', 'unknown'), ('size', ''),
                             ('size', '0:1'), ('size', '1:0'), ('size', '100:1'), ('size', '16x9')]:
            with self.assertRaises(HTTPException):
                self.prepare({**self.node, field: value})
        for field in ['version', 'mode', 'speed', 'size']:
            node = self.node.copy()
            del node[field]
            with self.assertRaises(HTTPException):
                self.prepare(node)

    def test_budget_and_read_input_types(self):
        for max_calls in [True, '1', 0, 2]:
            with self.assertRaises(HTTPException):
                self.prepare(max_calls=max_calls)
        for refs in [True, '1', -1, 21]:
            with self.assertRaises(HTTPException):
                self.prepare(reference_count=refs)
        with self.assertRaises(HTTPException):
            self.prepare(has_prompt='true')

    def test_config_changes_rejected_but_secret_rotation_not_exposed(self):
        settings = self.prepare(reference_count=1)
        self.providers[-1]['api_key'] = 'rotated-secret'
        self.providers[-1]['notes'] = 'private-note'
        self.assertEqual(self.prepare(reference_count=1), settings)
        self.assertNotIn('secret', json.dumps(settings))
        for changed in [{**self.node, 'speed': 'turbo'}, {**self.node, 'version': '7'}, {**self.node, 'size': '1:1'}]:
            with self.assertRaises(HTTPException):
                validate_midjourney_run_config(changed, self.providers, settings['configurationHash'], reference_count=1, has_prompt=True)
        with self.assertRaises(HTTPException):
            validate_midjourney_run_config(self.node, self.providers, settings['configurationHash'], reference_count=2, has_prompt=True)

    def test_real_frontend_provider_selection_and_backend_fixed_paths(self):
        root = Path(__file__).resolve().parents[1]
        source = (root / 'static/js/canvas.js').read_text(encoding='utf-8')
        function = re.search(r'function midjourneyApiProviders\(\)\{.*?\n\}', source, re.S)
        self.assertIsNotNone(function)
        host = re.search(r'function classicProviderConfigHost\(\)\{.*?\n\}', source, re.S)
        self.assertIsNotNone(host)
        providers = [{'id': 'manual', 'protocol': protocol, 'base_url': base} for protocol, base in [
            ('apimart', 'https://example.test'), ('openai', 'https://api.apimart.ai/v1'),
            ('openai', 'https://example.test'), ('openai', 'https://not-apimart.ai/v1'),
            ('APIMART', ''), ('openai', 'https://api.apimart.ai.evil.test/v1')]]
        node_binary = os.environ.get('NODE_BINARY') or shutil.which('node')
        self.assertTrue(node_binary, '原生JS联测须可用Node')
        module_path = json.dumps(str(root / 'static/js/canvas-provider-config.js'))
        script = ('let apiProviders=[];const CanvasProviderConfig=require(' + module_path + ');'
                  + host.group(0) + '\n' + function.group(0) + ';const cases=' + json.dumps(providers)
                  + ";process.stdout.write(JSON.stringify(cases.map(p=>{apiProviders=[p];return !!midjourneyApiProviders().length;})));")
        actual = json.loads(subprocess.check_output([node_binary, '-e', script], timeout=30))
        for provider, expected in zip(providers, actual):
            if expected:
                self.prepare(providers=[provider])
            else:
                with self.assertRaises(HTTPException):
                    self.prepare(providers=[provider])
        tree = ast.parse((root / 'main.py').read_text(encoding='utf-8'))
        handler = next(item for item in tree.body if isinstance(item, ast.AsyncFunctionDef) and item.name == 'submit_midjourney')
        self.assertEqual(len(handler.body), 1)
        self.assertIsInstance(handler.body[0], ast.Return)
        self.assertIsInstance(handler.body[0].value, ast.Await)
        self.assertEqual(ast.unparse(handler.body[0].value.value.func), 'midjourney_service.submit_midjourney')
        service_tree = ast.parse((root / 'backend/midjourney_service.py').read_text(encoding='utf-8'))
        handler = next(item for item in service_tree.body if isinstance(item, ast.AsyncFunctionDef) and item.name == 'submit_midjourney')
        strings = {n.value for n in ast.walk(handler) if isinstance(n, ast.Constant) and isinstance(n.value, str)}
        for mode, refs in [('imagine', 0), ('blend', 2), ('edit', 1)]:
            self.assertIn(self.prepare({**self.node, 'mode': mode}, reference_count=refs)['supplierPath'], strings)
        # 已有运行没有count循环，输入count=8不得扩展服务预算。
        entry = re.search(r'async function runMidjourneyNode\(.*?\n\}', source, re.S).group(0)
        self.assertIn('CanvasMidjourneyRunner.runMidjourneyNode', entry)
        runner_source = (root / 'static/js/canvas-midjourney-runner.js').read_text(encoding='utf-8')
        runner = re.search(r'    async function runMidjourneyNode\(.*?\n    \}', runner_source, re.S).group(0)
        self.assertEqual(runner.count("midjourneyRequest(deps, '/api/midjourney/submit'"), 1)
        self.assertNotIn('node.count', runner)


if __name__ == '__main__':
    unittest.main()
