"""真实音频HTTP入口委托、持久查询与不重复提交回归。"""
import asyncio
from contextlib import ExitStack
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main
from backend import canvas_audio_service as service


class AudioServiceRouteTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        root = self.stack.enter_context(tempfile.TemporaryDirectory())
        self.stack.enter_context(patch.object(main, 'CANVAS_TASK_DIR', root))
        self.stack.enter_context(patch.object(main, 'CANVAS_TASKS', {}))
        provider = {'id': 'test-only', 'enabled': True, 'protocol': 'openai',
                    'base_url': 'https://provider.test', 'audio_generation_models': ['tts']}
        self.stack.enter_context(patch.object(main, 'get_api_provider_exact', return_value=provider))
        self.stack.enter_context(patch.object(main, 'api_headers', return_value={'Authorization': 'Bearer test-only'}))
        self.body = {'client_task_id': 'canvas_audio_http_service_123', 'provider_id': 'test-only',
                     'model': 'tts', 'prompt': '本地测试', 'settings': {'audioFormat': 'wav'}}
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url='http://audio-service.test')
        self.addAsyncCleanup(self.client.aclose)

    async def test_routes_call_new_service_and_refresh_never_submits_again(self):
        finished = asyncio.Event()
        async def generate(payload):
            finished.set()
            return {'audios': [{'url': '/output/test-only.wav', 'kind': 'audio'}]}
        with patch.object(main, 'build_canvas_audio_result', side_effect=generate) as generator, \
             patch.object(service, 'create_task', wraps=service.create_task) as create, \
             patch.object(service, 'run_task', wraps=service.run_task) as worker, \
             patch.object(service, 'get_task', wraps=service.get_task) as get:
            response = await self.client.post('/api/canvas-audio-tasks', json=self.body)
            self.assertEqual(response.status_code, 200)
            await asyncio.wait_for(finished.wait(), 2)
            await asyncio.sleep(0)
            endpoint = '/api/canvas-audio-tasks/' + self.body['client_task_id']
            self.assertEqual((await self.client.get(endpoint)).json()['status'], 'succeeded')
            main.CANVAS_TASKS.clear()
            self.assertEqual((await self.client.post(endpoint + '/refresh')).json()['status'], 'succeeded')
            duplicate = await self.client.post('/api/canvas-audio-tasks', json=self.body)
            self.assertEqual(duplicate.status_code, 200)
            changed = await self.client.post('/api/canvas-audio-tasks', json={**self.body, 'prompt': '不同参数'})
            self.assertEqual(changed.status_code, 409)
            self.assertEqual(generator.call_count, 1)
            worker.assert_awaited_once()
            self.assertEqual(create.await_count, 3)
            self.assertGreaterEqual(get.call_count, 2)
