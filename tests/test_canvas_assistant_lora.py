import copy
import json
import math
import unittest

from fastapi import HTTPException

from backend.canvas_assistant_lora import prepare_lora_patch, read_lora_catalog, validate_lora_snapshot


class LoraContractTests(unittest.TestCase):
    def setUp(self):
        self.node = {'id': 'ms', 'type': 'msgen', 'msgenModel': 'custom',
                     'msCustomModel': 'chosen-model', 'msLoraEnabled': True,
                     'msLoraId': 'selected', 'msLoraStrength': 0.5,
                     'generatedOutputs': [{'url': '/output/keep.png'}]}
        self.providers = [{'id': 'modelscope', 'api_key': 'PRIVATE_SENTINEL',
                           'ms_loras': [
                               {'id': 'selected', 'target_model': 'chosen-model', 'strength': 0.8,
                                'name': '已选LoRA', 'note': 'PRIVATE_SENTINEL'},
                               {'id': 'other-choice', 'target_model': 'chosen-model', 'strength': 0.85},
                               {'id': 'disabled', 'target_model': 'chosen-model', 'enabled': False},
                               {'id': 'foreign', 'target_model': 'other-model', 'strength': 0.7}]}]

    def test_catalog_is_current_model_scoped_and_public(self):
        value = read_lora_catalog(self.node, self.providers)
        self.assertEqual([r['id'] for r in value['loras']], ['selected', 'other-choice'])
        self.assertEqual(value['model'], 'chosen-model')
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(value))
        self.assertEqual(value['strengthLimits'], {'min': 0.1, 'max': 1.0, 'step': 0.05})

    def test_prepare_preserves_node_provider_and_saved_results(self):
        before = copy.deepcopy((self.node, self.providers))
        result = prepare_lora_patch(self.node, {'msLoraStrength': 0.75}, self.providers)
        self.assertEqual(result['effectFields'], {'msLoraId': 'selected', 'msLoraStrength': 0.75})
        self.assertEqual((self.node, self.providers), before)

    def test_enabling_requires_explicit_or_existing_valid_selection(self):
        self.node.update(msLoraEnabled=False, msLoraId='')
        with self.assertRaises(HTTPException):
            prepare_lora_patch(self.node, {'msLoraEnabled': True}, self.providers)
        result = prepare_lora_patch(self.node, {'msLoraEnabled': True, 'msLoraId': 'other-choice'}, self.providers)
        self.assertEqual(result['effectFields'], {'msLoraEnabled': True, 'msLoraId': 'other-choice', 'msLoraStrength': 0.85})

    def test_switch_uses_native_selected_default_unless_strength_explicit(self):
        self.assertEqual(prepare_lora_patch(self.node, {'msLoraId': 'other-choice'}, self.providers)['effectFields']['msLoraStrength'], 0.85)
        self.assertEqual(prepare_lora_patch(self.node, {'msLoraId': 'other-choice', 'msLoraStrength': 0.3}, self.providers)['effectFields']['msLoraStrength'], 0.3)

    def test_strength_range_step_and_non_numeric_values(self):
        for value in [0, 0.05, 1.05, 2, 0.11, 0.83, True, '0.8', None, math.nan, math.inf, 10**500]:
            with self.subTest(value=value), self.assertRaises(HTTPException):
                prepare_lora_patch(self.node, {'msLoraStrength': value}, self.providers)
        for value in [0.1, 1, 0.30000000000000004]:
            with self.subTest(value=value):
                self.assertEqual(prepare_lora_patch(self.node, {'msLoraStrength': value}, self.providers)['effectFields']['msLoraStrength'], round(value, 2))

    def test_unknown_disabled_foreign_and_arbitrary_identifiers_rejected(self):
        for value in ['missing', 'disabled', 'foreign', '', 3, '/tmp/lora', 'https://arbitrary.example/lora']:
            with self.subTest(value=value), self.assertRaises(HTTPException):
                prepare_lora_patch(self.node, {'msLoraId': value}, self.providers)

    def test_hidden_controls_cannot_change_without_explicit_enable(self):
        self.node['msLoraEnabled'] = False
        for patch in [{'msLoraId': 'selected'}, {'msLoraStrength': 0.8}, {'msLoraEnabled': False, 'msLoraId': 'selected'}]:
            with self.subTest(patch=patch), self.assertRaises(HTTPException):
                prepare_lora_patch(self.node, patch, self.providers)

    def test_disable_preserves_stale_selection_and_results(self):
        self.node['msLoraId'] = 'removed'
        before = copy.deepcopy(self.node)
        value = prepare_lora_patch(self.node, {'msLoraEnabled': False}, [])
        self.assertEqual(value['effectFields'], {'msLoraEnabled': False})
        self.assertEqual(self.node, before)

    def test_only_native_custom_model_page_is_supported(self):
        for changes in [{'type': 'smart-image'}, {'msgenModel': 'zimage'}, {'msgenModel': 'custom', 'msCustomModel': ''}]:
            with self.subTest(changes=changes), self.assertRaises(HTTPException):
                prepare_lora_patch({**self.node, **changes}, {'msLoraStrength': 0.8}, self.providers)

    def test_patch_rejects_models_results_tasks_and_invalid_toggle(self):
        for patch in [{}, {'msCustomModel': 'other-model'}, {'msgenModel': 'zimage'},
                      {'generatedOutputs': []}, {'taskId': 'fake'}, {'api_key': 'private'},
                      {'msLoraEnabled': 1}, {'msLoraEnabled': 'true'}]:
            with self.subTest(patch=patch), self.assertRaises(HTTPException):
                prepare_lora_patch(self.node, patch, self.providers)

    def test_confirm_revalidates_model_directory_defaults_order_and_enabled(self):
        patch = {'msLoraStrength': 0.8}
        digest = prepare_lora_patch(self.node, patch, self.providers)['configurationHash']
        self.assertEqual(validate_lora_snapshot(self.node, patch, self.providers, digest)['model'], 'chosen-model')
        for change in ['default', 'order', 'removed', 'disabled', 'name']:
            providers = copy.deepcopy(self.providers)
            entries = providers[0]['ms_loras']
            if change == 'default': entries[0]['strength'] = 0.9
            if change == 'order': entries.reverse()
            if change == 'removed': entries.pop(0)
            if change == 'disabled': entries[0]['enabled'] = False
            if change == 'name': entries[0]['name'] = '变化'
            with self.subTest(change=change), self.assertRaises(HTTPException):
                validate_lora_snapshot(self.node, patch, providers, digest)
        providers = copy.deepcopy(self.providers)
        providers[0]['ms_loras'].append({'id': 'selected', 'target_model': 'other-model', 'strength': 0.8})
        with self.assertRaises(HTTPException):
            validate_lora_snapshot({**self.node, 'msCustomModel': 'other-model'}, patch, providers, digest)

    def test_bad_catalog_defaults_need_explicit_valid_strength(self):
        for default in [0, 1.5, 'invalid', math.nan, 0.83]:
            providers = copy.deepcopy(self.providers)
            providers[0]['ms_loras'][1]['strength'] = default
            with self.subTest(default=default):
                with self.assertRaises(HTTPException):
                    prepare_lora_patch(self.node, {'msLoraId': 'other-choice'}, providers)
                self.assertEqual(prepare_lora_patch(self.node, {'msLoraId': 'other-choice', 'msLoraStrength': 0.8}, providers)['effectFields']['msLoraStrength'], 0.8)

    def test_duplicates_and_malformed_directory_fail_without_mutating(self):
        variants = [{}, [self.providers[0], self.providers[0]],
                    [{'id': 'modelscope', 'ms_loras': {}}],
                    [{'id': 'modelscope', 'ms_loras': None}],
                    [{'id': 'modelscope', 'ms_loras': [self.providers[0]['ms_loras'][0]] * 2}]]
        for providers in variants:
            before = copy.deepcopy(providers)
            with self.subTest(providers=providers), self.assertRaises(HTTPException):
                read_lora_catalog(self.node, providers)
            self.assertEqual(providers, before)


if __name__ == '__main__':
    unittest.main()
