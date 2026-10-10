import copy
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import unittest

from fastapi import HTTPException
from backend.canvas_assistant_msgen import prepare_msgen_run_config, validate_msgen_run_config


class MsGenConfigTests(unittest.TestCase):
    def setUp(self):
        self.node = {'id': 'ms', 'type': 'msgen', 'count': 1, 'msgenModel': 'custom',
                     'msCustomModel': 'public/custom', 'msLoraEnabled': False}
        self.providers = [{'id': 'modelscope', 'enabled': True, 'image_models': ['public/custom'],
                           'api_key': 'secret-test-value', 'env_key': 'SECRET_TEST_KEY',
                           'ms_loras': [{'id': 'public/lora', 'target_model': 'public/custom', 'strength': 0.8}]}]

    def prepare(self, node=None, providers=None, **kwargs):
        return prepare_msgen_run_config(self.node if node is None else node,
            self.providers if providers is None else providers, image_count=kwargs.pop('image_count', 0), **kwargs)

    def test_all_original_model_tabs_and_image_requirements(self):
        expected = {'zimage': ('Tongyi-MAI/Z-Image-Turbo', '/generate'),
                    'qwen_edit': ('Qwen/Qwen-Image-Edit-2511', '/api/angle/generate'),
                    'klein_edit': ('black-forest-labs/FLUX.2-klein-9B', '/api/ms/generate'),
                    'custom': ('public/custom', '/api/ms/generate')}
        for key, (model, endpoint) in expected.items():
            node = {**self.node, 'msgenModel': key}
            with self.subTest(key=key):
                settings = self.prepare(node, image_count=2)
                self.assertEqual((settings['model'], settings['endpoint']), (model, endpoint))
                self.assertEqual(settings['usedImageCount'], 0 if key == 'zimage' else 2)
                if key in {'qwen_edit', 'klein_edit'}:
                    with self.assertRaises(HTTPException):
                        self.prepare(node, image_count=0)

    def test_no_implicit_model_default_or_provider_fallback(self):
        for node in [{**self.node, 'msgenModel': ''}, {**self.node, 'msgenModel': 'unknown'},
                     {**self.node, 'msCustomModel': ''}, {**self.node, 'msCustomModel': 'removed/model'}]:
            with self.assertRaises(HTTPException):
                self.prepare(node)
        for providers in [[], [{'id': 'other', 'image_models': ['public/custom']}],
                          self.providers * 2, [{**self.providers[0], 'enabled': False}]]:
            with self.assertRaises(HTTPException):
                self.prepare(providers=providers)

    def test_single_task_budget_and_native_reference_limit(self):
        for count in [None, True, 1.5, 2, 8, '1']:
            with self.assertRaises(HTTPException):
                self.prepare({**self.node, 'count': count})
        for max_calls in [True, 0, 2, '1']:
            with self.assertRaises(HTTPException):
                self.prepare(max_calls=max_calls)
        for image_count in [-1, 21, True, '1']:
            with self.assertRaises(HTTPException):
                self.prepare(image_count=image_count)
        self.assertEqual(self.prepare(image_count=20)['usedImageCount'], 20)

    def test_lora_reuses_catalog_and_strength_validation_without_default_id(self):
        node = {**self.node, 'msLoraEnabled': True, 'msLoraId': 'public/lora', 'msLoraStrength': 0.65}
        original, providers = copy.deepcopy(node), copy.deepcopy(self.providers)
        self.assertEqual(self.prepare(node)['loras'], {'public/lora': 0.65})
        self.assertEqual(node, original)
        self.assertEqual(self.providers, providers)
        for field, value in [('msLoraId', ''), ('msLoraId', 'not-bound'), ('msLoraStrength', 1.2),
                             ('msLoraStrength', 0.61), ('msLoraStrength', False), ('msLoraEnabled', 'true')]:
            with self.assertRaises(HTTPException):
                self.prepare({**node, field: value})

    def test_disabled_lora_preserves_old_id_but_does_not_send_it(self):
        node = {**self.node, 'msLoraId': 'old', 'msLoraStrength': 100}
        self.assertIsNone(self.prepare(node)['loras'])
        self.assertEqual(node['msLoraId'], 'old')

    def test_legacy_builtin_lora_uses_actual_builtin_model(self):
        node = {**self.node, 'msgenModel': 'zimage', 'msLoraEnabled': True,
                'msLoraId': 'builtin-lora', 'msLoraStrength': 0.8}
        providers = copy.deepcopy(self.providers)
        providers[0]['ms_loras'].append({'id': 'builtin-lora', 'target_model': 'Tongyi-MAI/Z-Image-Turbo'})
        self.assertEqual(self.prepare(node, providers)['loras'], {'builtin-lora': 0.8})
        self.assertEqual(node['msgenModel'], 'zimage')

    def test_snapshot_detects_config_and_reference_count_changes(self):
        settings = self.prepare(image_count=1)
        for image_count in [0, 2]:
            with self.assertRaises(HTTPException):
                validate_msgen_run_config(self.node, self.providers, settings['configurationHash'], image_count=image_count)
        self.providers[0]['image_models'].append('public/another')
        with self.assertRaises(HTTPException):
            validate_msgen_run_config(self.node, self.providers, settings['configurationHash'], image_count=1)
        node = {**self.node, 'msLoraEnabled': True, 'msLoraId': 'public/lora', 'msLoraStrength': 0.8}
        settings = self.prepare(node)
        self.providers[0]['ms_loras'][0]['enabled'] = False
        with self.assertRaises(HTTPException):
            validate_msgen_run_config(node, self.providers, settings['configurationHash'], image_count=0)

    def test_credentials_and_private_notes_never_returned_or_hashed(self):
        before = self.prepare()
        self.providers[0].update(api_key='different-secret', env_key='DIFFERENT_ENV', notes='private note')
        after = self.prepare()
        self.assertEqual(before, after)
        self.assertNotIn('secret', json.dumps(after))
        self.assertNotIn('env_key', json.dumps(after))

    def test_native_frontend_model_table_and_reference_limit_match(self):
        # 读取真实const并由Node解释，防止原页签/端点或参考图上限变更后合同静默漂移。
        source = (Path(__file__).resolve().parents[1] / 'static/js/canvas.js').read_text(encoding='utf-8')
        models = re.search(r'const MS_GEN_MODELS = (\{.*?\n\});', source, re.S)
        limit = re.search(r'const CANVAS_REFERENCE_IMAGE_MAX = (\d+);', source)
        self.assertIsNotNone(models)
        self.assertIsNotNone(limit)
        node_binary = os.environ.get('NODE_BINARY') or shutil.which('node')
        self.assertTrue(node_binary, '原生JS联测须可用Node')
        script = 'const models=' + models.group(1) + ';process.stdout.write(JSON.stringify(models));'
        actual = json.loads(subprocess.check_output([node_binary, '-e', script], timeout=30))
        self.assertEqual(set(actual), {'zimage', 'qwen_edit', 'klein_edit', 'custom'})
        for key, value in actual.items():
            settings = self.prepare({**self.node, 'msgenModel': key}, image_count=1)
            self.assertEqual(settings['endpoint'], value['endpoint'])
            self.assertEqual(settings['requiresImages'], bool(value.get('supportsImage')))
            self.assertEqual(settings['acceptsImages'], bool(value.get('supportsImage') or value.get('acceptsImage')))
            if key != 'custom':
                self.assertEqual(settings['model'], value['modelId'])
        self.prepare(image_count=int(limit.group(1)))
        with self.assertRaises(HTTPException):
            self.prepare(image_count=int(limit.group(1)) + 1)


if __name__ == '__main__':
    unittest.main()
