"""完整应用启动与音频 HTTP 入口；所有数据、凭据和供应商均为隔离夹具。"""
import sys
import tempfile
import time
import types
import unittest
import wave
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient


class AudioAppTests(unittest.TestCase):
    def test_model_discovery_selection_save_and_config_roundtrip(self):
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory(prefix='nadou-audio-models-') as directory:
            module = types.ModuleType('audio_models_qa_app')
            module.__file__ = str(Path(directory) / 'main.py')
            sys.modules[module.__name__] = module
            try:
                exec(compile((root / 'main.py').read_text(encoding='utf-8'),
                             str(root / 'main.py'), 'exec'), module.__dict__)
                original_client = httpx.AsyncClient
                ids = ['whisper-1', 'tts-1', 'gpt-image-1', 'gpt-4o', 'sora-2']
                def respond(request):
                    self.assertEqual(str(request.url), 'https://provider.test/v1/models')
                    return httpx.Response(200, json={'data': [{'id': m} for m in ids]})
                with patch.object(httpx, 'AsyncClient', side_effect=lambda **kwargs:
                                  original_client(transport=httpx.MockTransport(respond))), TestClient(module.app) as client:
                    request = {'provider_id': 'audio-test', 'base_url': 'https://provider.test/v1',
                               'api_key': 'test-only', 'protocol': 'openai'}
                    for route in ('fetch-models', 'test-connection'):
                        result = client.post('/api/providers/' + route, json=request)
                        self.assertEqual(result.status_code, 200, result.text)
                        self.assertEqual(result.json()['audio_models'], ['whisper-1'])
                        self.assertEqual(result.json()['audio_generation_models'], ['tts-1'])
                        self.assertEqual(result.json()['chat_models'], ['gpt-4o'])
                    selected = {'id': 'audio-test', 'name': '音频测试平台', 'protocol': 'openai',
                                'base_url': 'https://provider.test/v1', 'image_models': ['gpt-image-1'],
                                'chat_models': ['gpt-4o'], 'video_models': ['sora-2'],
                                'audio_models': ['whisper-1'], 'audio_generation_models': ['tts-1'],
                                'audio_timestamp_models': ['whisper-1'],
                                'audio_generation_voices': ['custom-voice'],
                                'audio_generation_protocol': 'openai-speech'}
                    saved = client.put('/api/providers', json=[selected])
                    self.assertEqual(saved.status_code, 200, saved.text)
                    for endpoint, key in [('/api/providers', 'providers'), ('/api/config', 'api_providers')]:
                        provider = next(p for p in client.get(endpoint).json()[key] if p['id'] == 'audio-test')
                        for field in ['image_models', 'chat_models', 'video_models', 'audio_models',
                                      'audio_generation_models', 'audio_timestamp_models',
                                      'audio_generation_voices', 'audio_generation_protocol']:
                            self.assertEqual(provider[field], selected[field])
                    self.assertTrue((Path(directory) / 'data' / 'api_providers.json').exists())
            finally:
                sys.modules.pop(module.__name__, None)

    def test_full_app_recognition_is_registered_and_durable(self):
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory(prefix='nadou-audio-app-') as directory:
            module = types.ModuleType('audio_qa_app')
            module.__file__ = str(Path(directory) / 'main.py')
            sys.modules[module.__name__] = module
            try:
                exec(compile((root / 'main.py').read_text(encoding='utf-8'),
                             str(root / 'main.py'), 'exec'), module.__dict__)
                self.assertEqual(module.BASE_DIR, directory)
                module.get_api_provider_exact = lambda identifier: {
                    'id': 'p', 'enabled': True, 'protocol': 'openai',
                    'base_url': 'https://provider.test/v1', 'audio_models': ['asr']}
                module.provider_env_key_value = lambda identifier: 'test-only'
                with wave.open(str(Path(directory) / 'assets' / 'a.wav'), 'wb') as audio:
                    audio.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
                    audio.writeframes(b'\0' * 32000)
                requests = []
                def respond(request):
                    requests.append(request)
                    self.assertEqual(str(request.url), 'https://provider.test/v1/audio/transcriptions')
                    self.assertIn(b'name="file"', request.content)
                    return httpx.Response(200, json={'text': '完整应用音频路由验收'})
                original_client = httpx.AsyncClient
                with patch.object(httpx, 'AsyncClient', side_effect=lambda **kwargs:
                                  original_client(transport=httpx.MockTransport(respond))), TestClient(module.app) as client:
                    self.assertIn('/api/canvas-audio-tasks', client.get('/openapi.json').json()['paths'])
                    payload = {'client_task_id': 'canvas_audio_fullapp12345678',
                               'operation': 'recognition', 'provider_id': 'p', 'model': 'asr',
                               'references': [{'kind': 'audio', 'url': '/assets/a.wav'}]}
                    response = client.post('/api/canvas-audio-tasks', json=payload)
                    self.assertEqual(response.status_code, 200, response.text)
                    for _ in range(50):
                        result = client.get('/api/canvas-audio-tasks/' + payload['client_task_id'])
                        if result.json().get('status') in {'succeeded', 'failed', 'unknown'}:
                            break
                        time.sleep(.02)
                    self.assertEqual(result.json()['status'], 'succeeded', result.text)
                    self.assertEqual(result.json()['result']['text'], '完整应用音频路由验收')
                    self.assertTrue(list((Path(directory) / 'data' / 'canvas_tasks').glob('*.json')))
                    self.assertEqual(client.post('/api/canvas-audio-tasks', json=payload).status_code, 200)
                    self.assertEqual(len(requests), 1)
                    exported = client.post('/api/canvas-workflows/export', json={
                        'nodes': [{'id': 'audio', 'type': 'audio', 'url': '/assets/a.wav',
                                   'name': 'a.wav', 'mime': 'audio/wav'}],
                        'connections': [], 'include_resources': True})
                    self.assertEqual(exported.status_code, 200, exported.text)
                    imported = client.post('/api/canvas-workflows/import', files={
                        'file': ('audio.zip', exported.content, 'application/zip')})
                    self.assertEqual(imported.status_code, 200, imported.text)
                    node = imported.json()['nodes'][0]
                    self.assertEqual(node['type'], 'audio')
                    saved_media = Path(directory) / node['url'].lstrip('/')
                    self.assertEqual(saved_media.read_bytes(),
                                     (Path(directory) / 'assets' / 'a.wav').read_bytes())
            finally:
                sys.modules.pop(module.__name__, None)
