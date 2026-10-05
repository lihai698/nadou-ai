"""Core canvas HTTP behavior using temporary storage; no external generation."""
import json
import sys
import tempfile
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main


class CanvasBaselineTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.root = Path(self.stack.enter_context(tempfile.TemporaryDirectory()))
        paths = {
            'DATA_DIR': 'data', 'CANVAS_DIR': 'data/canvases',
            'PROJECTS_PATH': 'data/projects.json',
            'ASSETS_DIR': 'assets', 'OUTPUT_DIR': 'output',
            'OUTPUT_INPUT_DIR': 'assets/input',
            'OUTPUT_OUTPUT_DIR': 'assets/output',
            'ASSET_LIBRARY_PATH': 'data/asset_library.json',
            'CONVERSATION_DIR': 'data/conversations',
            'MEDIA_PREVIEW_DIR': 'data/media_previews',
            'HISTORY_FILE': 'history.json',
        }
        for name, relative in paths.items():
            path = self.root / relative
            (path.parent if path.suffix else path).mkdir(parents=True, exist_ok=True)
            self.stack.enter_context(patch.object(main, name, str(path)))
        # ASGITransport does not run startup migrations or launch external tasks.
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app), base_url='http://baseline.test')
        self.addAsyncCleanup(self.client.aclose)

    async def create(self, kind='classic'):
        result = await self.client.post('/api/canvases', json={
            'title': '中文验收画布', 'kind': kind})
        self.assertEqual(result.status_code, 200, result.text)
        return result.json()['canvas']

    async def roundtrip(self, kind):
        canvas = await self.create(kind)
        media = Path(main.OUTPUT_INPUT_DIR) / '中文参考图.png'
        from PIL import Image
        Image.new('RGB', (8, 8), 'blue').save(media)
        before = media.read_bytes()
        url = '/assets/input/%E4%B8%AD%E6%96%87%E5%8F%82%E8%80%83%E5%9B%BE.png'
        nodes = [
            {'id': 'prompt', 'type': 'text', 'text': '中文提示词', 'x': 10, 'y': 20},
            {'id': 'reference', 'type': 'image', 'url': url},
            {'id': 'result', 'type': 'smart-image' if kind == 'smart' else 'output',
             'images': [], 'settings': {'seed': 42}},
        ]
        connections = [{'from': 'prompt', 'to': 'result'},
                       {'from': 'reference', 'to': 'result'}]
        payload = dict(title='保存后的中文标题', nodes=nodes, connections=connections,
                       viewport={'x': 30, 'y': 40, 'scale': 0.8},
                       settings={'sample': '中文'}, logs=[],
                       base_updated_at=canvas['updated_at'])
        saved = await self.client.put('/api/canvases/' + canvas['id'], json=payload)
        self.assertEqual(saved.status_code, 200, saved.text)
        loaded = await self.client.get('/api/canvases/' + canvas['id'])
        self.assertEqual(loaded.status_code, 200)
        actual = loaded.json()['canvas']
        for key in ('title', 'nodes', 'connections', 'settings'):
            self.assertEqual(actual[key], payload[key])
        self.assertEqual(actual['kind'], kind)
        expected_view = payload['viewport'] if kind == 'smart' else canvas['viewport']
        self.assertEqual(actual['viewport'], expected_view)
        disk = json.loads(Path(main.canvas_path(canvas['id'])).read_text(encoding='utf-8'))
        self.assertEqual(actual, disk)
        self.assertEqual(Path(main.local_media_path_from_url(url)), media)
        self.assertEqual(media.read_bytes(), before)

    async def test_classic_save_read_preserves_nodes_links_and_media(self):
        await self.roundtrip('classic')

    async def test_smart_save_read_preserves_nodes_links_and_viewport(self):
        await self.roundtrip('smart')

    async def test_stale_save_rejected_without_overwriting_disk(self):
        canvas = await self.create()
        endpoint = '/api/canvases/' + canvas['id']
        payload = {'title': '新标题', 'base_updated_at': canvas['updated_at']}
        self.assertEqual((await self.client.put(endpoint, json=payload)).status_code, 200)
        before = Path(main.canvas_path(canvas['id'])).read_bytes()
        payload['title'] = '不应覆盖'
        self.assertEqual((await self.client.put(endpoint, json=payload)).status_code, 409)
        self.assertEqual(Path(main.canvas_path(canvas['id'])).read_bytes(), before)

    async def test_soft_delete_restore_preserves_canvas_and_media(self):
        canvas = await self.create('smart')
        endpoint = '/api/canvases/' + canvas['id']
        media = Path(main.OUTPUT_INPUT_DIR) / '保留.txt'
        media.write_text('isolated sample', encoding='utf-8')
        self.assertEqual((await self.client.delete(endpoint)).status_code, 200)
        self.assertTrue(Path(main.canvas_path(canvas['id'])).exists())
        self.assertEqual((await self.client.get(endpoint)).status_code, 404)
        restored = await self.client.post(endpoint + '/restore')
        self.assertEqual(restored.status_code, 200)
        actual = (await self.client.get(endpoint)).json()['canvas']
        for key in ('id', 'kind', 'nodes', 'connections', 'title'):
            self.assertEqual(actual[key], canvas[key])
        self.assertNotIn('deleted_at', actual)
        self.assertTrue(media.exists())

    async def test_purge_removes_only_canvas_document(self):
        canvas = await self.create()
        media = Path(main.OUTPUT_OUTPUT_DIR) / '保留结果.txt'
        media.write_text('isolated result', encoding='utf-8')
        endpoint = '/api/canvases/' + canvas['id']
        self.assertEqual((await self.client.delete(endpoint + '/purge')).status_code, 200)
        self.assertFalse(Path(main.canvas_path(canvas['id'])).exists())
        self.assertTrue(media.exists())
        self.assertEqual((await self.client.get(endpoint)).status_code, 404)

    async def test_trash_scan_removes_expired_but_keeps_recent_and_active(self):
        active, recent, expired = [await self.create() for _ in range(3)]
        now = main.now_ms()
        recent['deleted_at'] = now - 1000
        expired['deleted_at'] = now - main.CANVAS_TRASH_RETENTION_MS - 1000
        main.save_canvas(recent)
        main.save_canvas(expired)
        response = await self.client.get('/api/canvases/trash')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(Path(main.canvas_path(active['id'])).exists())
        self.assertTrue(Path(main.canvas_path(recent['id'])).exists())
        self.assertFalse(Path(main.canvas_path(expired['id'])).exists())


if __name__ == '__main__':
    unittest.main()
