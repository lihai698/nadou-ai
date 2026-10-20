"""真实 HTTP 路由必须使用存储模块，而不是只测试一个闲置的新类。"""
import sys
import tempfile
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main
from backend.canvas_store import CanvasStore, CanvasStoreError


class CanvasStoreRouteTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_crud_routes_delegate_to_store(self):
        with tempfile.TemporaryDirectory() as directory, ExitStack() as stack:
            stack.enter_context(patch.object(main, 'CANVAS_DIR', directory))
            names = ['create', 'load', 'meta', 'update_meta', 'touch', 'update_content', 'delete', 'restore', 'purge', 'records']
            spies = {name: stack.enter_context(patch.object(CanvasStore, name, autospec=True, side_effect=getattr(CanvasStore, name))) for name in names}
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url='http://test') as client:
                made = await client.post('/api/canvases', json={'title': '存储路由验收', 'kind': 'classic'})
                self.assertEqual(made.status_code, 200)
                identity = made.json()['canvas']['id']
                endpoint = '/api/canvases/' + identity
                self.assertEqual((await client.get('/api/canvases')).status_code, 200)
                self.assertEqual((await client.get(endpoint)).status_code, 200)
                self.assertEqual((await client.get(endpoint + '/meta')).status_code, 200)
                self.assertEqual((await client.post(endpoint + '/meta', json={'title': '新标题'})).status_code, 200)
                self.assertEqual((await client.post(endpoint + '/touch')).status_code, 200)
                saved = await client.put(endpoint, json={'nodes': [{'id': 'n', 'type': 'prompt'}], 'connections': [], 'logs': []})
                self.assertEqual(saved.status_code, 200)
                self.assertEqual(saved.json()['canvas']['title'], '新标题')
                self.assertEqual((await client.delete(endpoint)).status_code, 200)
                self.assertEqual((await client.post(endpoint + '/restore')).status_code, 200)
                self.assertEqual((await client.delete(endpoint + '/purge')).status_code, 200)
                self.assertFalse((Path(directory) / f'{identity}.json').exists())
            for name, spy in spies.items():
                self.assertGreater(spy.call_count, 0, name)

    async def test_store_error_is_translated_without_changing_detail(self):
        detail = {'reason': 'meta_conflict', 'message': '原冲突', 'canvas': {'id': 'c'}}
        with patch.object(CanvasStore, 'update_content', side_effect=CanvasStoreError(status_code=409, detail=detail)):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url='http://test') as client:
                response = await client.put('/api/canvases/c', json={'nodes': [], 'connections': []})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['detail'], detail)
