import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

from fastapi import HTTPException
from backend import provider_registry_service as service


class ProviderRegistryServiceTests(unittest.TestCase):
    def test_corrupt_existing_registry_is_retained_and_never_written(self):
        with tempfile.TemporaryDirectory(prefix='provider-registry-test-') as folder:
            path = Path(folder) / 'providers.json'; path.write_text('{broken', encoding='utf-8')
            writes = []
            with self.assertRaises(HTTPException) as caught:
                service.save_api_providers([], API_PROVIDERS_FILE=str(path), DATA_DIR=folder,
                                           GLOBAL_CONFIG_LOCK=_Lock(), HTTPException=HTTPException,
                                           write_json_atomic=lambda *args, **kw: writes.append(args))
            self.assertEqual(caught.exception.status_code, 500)
            self.assertEqual(path.read_text(encoding='utf-8'), '{broken'); self.assertEqual(writes, [])

    def test_registry_write_holds_the_injected_lock_and_preserves_payload(self):
        lock = _Lock(); payload = [{'id': 'mock', 'image_models': ['mock-image']}]
        with tempfile.TemporaryDirectory(prefix='provider-registry-test-') as folder:
            path = Path(folder) / 'providers.json'; path.write_text('[]', encoding='utf-8')

            def write(target, value, **kwargs):
                self.assertTrue(lock.held); self.assertIs(value, payload)
                Path(target).write_text(json.dumps(value, **kwargs), encoding='utf-8')

            service.save_api_providers(payload, API_PROVIDERS_FILE=str(path), DATA_DIR=folder,
                                       GLOBAL_CONFIG_LOCK=lock, HTTPException=HTTPException, write_json_atomic=write)
            self.assertFalse(lock.held); self.assertEqual(json.loads(path.read_text(encoding='utf-8')), payload)

    def test_bad_registry_returns_defaults_with_controlled_diagnostic(self):
        defaults = [{'id': 'mock-default'}]; diagnostics = []
        with tempfile.TemporaryDirectory(prefix='provider-registry-test-') as folder:
            path = Path(folder) / 'providers.json'; path.write_text('{broken', encoding='utf-8')
            result = service.load_api_providers(API_PROVIDERS_FILE=str(path), default_api_providers=lambda: defaults,
                merge_default_api_providers=lambda value, **kw: value, normalize_provider=lambda value: value,
                write_diagnostic=diagnostics.append)
        self.assertIs(result, defaults); self.assertEqual(diagnostics, ['API provider config load failed error=JSONDecodeError'])

    def test_public_metadata_uses_masking_callback_and_keeps_input_unchanged(self):
        provider = {'id': 'mock', 'name': 'Mock'}; masked = []
        result = service.public_provider(provider,
            VOLCENGINE_DEFAULT_PROJECT_NAME='mock-project', VOLCENGINE_DEFAULT_REGION='mock-region',
            mask_secret=lambda value: masked.append(value) or '***', normalize_runninghub_entries=lambda value, kind: value,
            provider_env_key_value=lambda identity: 'synthetic-test-value', provider_key_env=lambda identity: 'MOCK_KEY',
            runninghub_provider_with_workflow_store=lambda value: value, runninghub_wallet_key_env=lambda: '',
            runninghub_wallet_key_value=lambda: '', volcengine_access_key_env=lambda: '', volcengine_access_key_value=lambda: '',
            volcengine_secret_key_env=lambda: '', volcengine_secret_key_value=lambda: '',
            volcengine_voice_api_key_env=lambda: '', volcengine_voice_api_key_value=lambda: '')
        self.assertEqual(provider, {'id': 'mock', 'name': 'Mock'})
        self.assertTrue(result['has_key']); self.assertEqual(result['key_preview'], '***')
        self.assertEqual(masked, ['synthetic-test-value']); self.assertNotIn('synthetic-test-value', json.dumps(result))


class _Lock:
    held = False

    def __enter__(self):
        self.held = True

    def __exit__(self, *args):
        self.held = False


class ProviderSettingsEntryTests(unittest.IsolatedAsyncioTestCase):
    def payload(self):
        return [SimpleNamespace(primary=False, clear_key=False, api_key=None, record={
            'id': 'comfly', 'base_url': 'https://mock.invalid',
            'image_models': ['mock-image'], 'chat_models': ['mock-chat'], 'video_models': []})]

    def dependencies(self, events, fail=False):
        def save(providers):
            events.append('save')
            if fail:
                raise HTTPException(500, 'mock storage failure')

        return dict(HTTPException=HTTPException, model_dump_compat=lambda item, **kw: dict(item.record),
            normalize_provider=lambda record: record, preserve_runninghub_hidden_overrides=lambda record: record,
            provider_key_env=lambda identity: 'MOCK_KEY', prune_runninghub_workflow_store_for_provider=lambda record: None,
            public_provider=lambda record: {'id': record['id']}, reload_env_globals=lambda: events.append('reload'),
            runninghub_wallet_key_env=lambda: 'MOCK_WALLET', save_api_providers=save,
            sync_runninghub_provider_workflows_to_static_template=lambda record: None,
            update_env_values=lambda values: events.append(('env', values)),
            volcengine_access_key_env=lambda: 'MOCK_AK', volcengine_secret_key_env=lambda: 'MOCK_SK',
            volcengine_voice_api_key_env=lambda: 'MOCK_VOICE')

    async def test_settings_entry_saves_before_publishing_environment_changes(self):
        events = []
        result = await service.save_providers(self.payload(), **self.dependencies(events))
        self.assertEqual(result, {'providers': [{'id': 'comfly'}]})
        self.assertEqual(events[0], 'save'); self.assertEqual(events[2], 'reload')
        self.assertEqual(events[1], ('env', {'COMFLY_BASE_URL': 'https://mock.invalid',
            'IMAGE_MODELS': 'mock-image', 'CHAT_MODELS': 'mock-chat', 'VIDEO_MODELS': ''}))

    async def test_storage_failure_cannot_publish_environment_changes(self):
        events = []
        with self.assertRaises(HTTPException):
            await service.save_providers(self.payload(), **self.dependencies(events, fail=True))
        self.assertEqual(events, ['save'])

    async def test_frontend_config_exports_presence_flags_without_test_credentials(self):
        result = await service.ai_config(AI_API_KEY='synthetic-test-value', AI_BASE_URL='https://mock.invalid',
            CHAT_MODEL='mock-chat', CHAT_MODELS=['mock-chat'], COMFYUI_INSTANCES=[], IMAGE_MODEL='mock-image',
            IMAGE_MODELS=['mock-image'], MODELSCOPE_CHAT_MODELS=[], VIDEO_MODELS=[],
            modelscope_api_key=lambda: 'synthetic-test-value', public_api_providers=lambda: [{'id': 'mock'}])
        self.assertTrue(result['has_api_key']); self.assertTrue(result['has_ms_key'])
        self.assertEqual(result['api_providers'], [{'id': 'mock'}])
        self.assertNotIn('synthetic-test-value', json.dumps(result))
