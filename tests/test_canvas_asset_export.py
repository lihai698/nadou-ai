"""Characterize real export routes using temporary media and simulated downloads.

Run through tools/check-core.py's public-code sandbox, as main initializes storage.
"""
import io
import tempfile
import unittest
import urllib.parse
import zipfile
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

import httpx

import main


class CanvasAssetExportTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.root = Path(self.stack.enter_context(tempfile.TemporaryDirectory()))
        for name, relative in {
            'ASSETS_DIR': 'assets',
            'OUTPUT_DIR': 'output',
            'OUTPUT_OUTPUT_DIR': 'output/generated',
            'OUTPUT_INPUT_DIR': 'output/input',
            'LOCAL_UPLOAD_DIR': 'output/local',
        }.items():
            path = self.root / relative
            path.mkdir(parents=True, exist_ok=True)
            self.stack.enter_context(patch.object(main, name, str(path)))
        self.remote = self.stack.enter_context(patch.object(
            main, 'fetch_remote_media_bytes', return_value=None))
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app, raise_app_exceptions=False),
            base_url='http://asset-export.test')
        self.addAsyncCleanup(self.client.aclose)

    def asset(self, name, content=b'fixture-media'):
        path = Path(main.ASSETS_DIR) / name
        path.write_bytes(content)
        return '/assets/' + urllib.parse.quote(name)

    def archive(self, response):
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers['content-type'], 'application/zip')
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            return {name: archive.read(name) for name in archive.namelist()}

    async def test_zip_local_items_keep_order_names_and_bytes(self):
        first = self.asset('原图.png', b'first-image')
        second = self.asset('配音.wav', b'second-audio')
        response = await self.client.post('/api/canvas-assets/download', json={
            'filename': '中文:素材',
            'items': [
                {'url': first, 'name': '素材.png'},
                {'url': second, 'name': '素材.png'},
                {'url': first, 'name': '素材-2.png'},
            ],
        })
        self.assertEqual(self.archive(response), {
            '素材.png': b'first-image',
            '素材-2.png': b'second-audio',
            '素材-2-2.png': b'first-image',
        })
        self.assertEqual(response.headers['content-disposition'],
                         "attachment; filename*=UTF-8''" + urllib.parse.quote('中文_素材.zip'))
        self.remote.assert_not_called()

    async def test_zip_legacy_urls_and_default_filename(self):
        url = self.asset('原图.png')
        response = await self.client.post('/api/canvas-assets/download', json={'urls': [url]})
        self.assertEqual(self.archive(response), {'原图.png': b'fixture-media'})

    async def test_zip_includes_utf8_prompts_and_media_with_unique_names(self):
        url = self.asset('镜头.mp4', b'video-fixture')
        response = await self.client.post('/api/canvas-assets/download', json={'items': [
            {'kind': 'text', 'text': '图片提示词：完整中文', 'name': '提示词'},
            {'kind': 'text', 'text': '视频提示词：向前推镜', 'name': '提示词.txt'},
            {'url': url, 'name': '镜头.mp4'},
        ]})
        self.assertEqual(self.archive(response), {
            '提示词.txt': '图片提示词：完整中文'.encode('utf-8'),
            '提示词-2.txt': '视频提示词：向前推镜'.encode('utf-8'),
            '镜头.mp4': b'video-fixture',
        })
        self.assertEqual(response.headers['content-disposition'],
                         "attachment; filename*=UTF-8''canvas-output-images.zip")

    async def test_zip_items_take_precedence_over_legacy_urls(self):
        chosen = self.asset('chosen.png', b'chosen')
        ignored = self.asset('ignored.png', b'ignored')
        response = await self.client.post('/api/canvas-assets/download', json={
            'urls': [ignored], 'items': [{'url': chosen}], 'filename': 'already.ZIP',
        })
        self.assertEqual(self.archive(response), {'chosen.png': b'chosen'})
        self.assertTrue(response.headers['content-disposition'].endswith('already.ZIP'))

    async def test_zip_reuses_local_basename_before_remote_download(self):
        (Path(main.OUTPUT_OUTPUT_DIR) / 'cached.png').write_bytes(b'local-cache')
        response = await self.client.post('/api/canvas-assets/download', json={
            'urls': ['https://mock.invalid/expired/cached.png?token=fixture'],
        })
        self.assertEqual(self.archive(response), {'cached.png': b'local-cache'})
        self.remote.assert_not_called()

    async def test_zip_remote_content_uses_decoded_filename(self):
        url = 'https://mock.invalid/' + urllib.parse.quote('远程片段.webm') + '?download=1'
        self.remote.return_value = (b'remote-video', 'video/webm')
        response = await self.client.post('/api/canvas-assets/download', json={'urls': [url]})
        self.assertEqual(self.archive(response), {'远程片段.webm': b'remote-video'})
        self.remote.assert_called_once_with(url)

    async def test_zip_skips_failed_downloads_but_keeps_valid_items(self):
        url = self.asset('kept.png', b'kept')

        def download(value):
            if value.endswith('throws.png'):
                raise OSError('simulated remote failure')
            return None

        self.remote.side_effect = download
        response = await self.client.post('/api/canvas-assets/download', json={
            'urls': ['', '/assets/missing.png', 'https://mock.invalid/throws.png', url],
        })
        self.assertEqual(self.archive(response), {'kept.png': b'kept'})

    async def test_zip_empty_or_all_missing_returns_existing_404(self):
        for payload in ({}, {'urls': [' ', '/assets/missing.png']}):
            with self.subTest(payload=payload):
                response = await self.client.post('/api/canvas-assets/download', json=payload)
                self.assertEqual(response.status_code, 404)
                self.assertEqual(response.json()['detail'], '没有可下载的本地图片')

    async def test_zip_processes_only_first_thousand_items(self):
        url = self.asset('keep.png')
        self.remote.side_effect = AssertionError('item beyond limit must not be read')
        response = await self.client.post('/api/canvas-assets/download', json={
            'items': [{'url': url}] + [{'url': ''}] * 999
                     + [{'url': 'https://mock.invalid/beyond-limit.png'}],
        })
        self.assertEqual(self.archive(response), {'keep.png': b'fixture-media'})
        self.remote.assert_not_called()

    async def test_zip_failure_does_not_return_a_successful_partial_archive(self):
        url = self.asset('unreadable.png')
        with patch.object(zipfile.ZipFile, 'write', side_effect=OSError('simulated read failure')):
            response = await self.client.post('/api/canvas-assets/download', json={'urls': [url]})
        self.assertEqual(response.status_code, 500)

    async def test_group_mixed_export_keeps_utf8_extensions_and_duplicates(self):
        url = self.asset('配音.wav', b'audio-content')
        target = self.root / '自选目录'
        response = await self.client.post('/api/smart-canvas/group-export', json={
            'folder': ' ' + str(target) + ' ',
            'items': [
                {'kind': 'text', 'text': ' 第一段中文\n', 'name': '稿.txt'},
                {'kind': 'TEXT', 'text': '第二段', 'name': '稿.txt'},
                {'kind': 'audio', 'url': url, 'name': '配音'},
                {'kind': 'audio', 'url': url, 'name': '配音'},
            ],
        })
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {'ok': True, 'folder': str(target), 'count': 4})
        self.assertEqual({p.name for p in target.iterdir()},
                         {'稿.txt', '稿-2.txt', '配音.wav', '配音-2.wav'})
        self.assertEqual((target / '稿.txt').read_text(encoding='utf-8'), ' 第一段中文\n')
        self.assertEqual((target / '稿-2.txt').read_text(encoding='utf-8'), '第二段')
        self.assertEqual((target / '配音.wav').read_bytes(), b'audio-content')
        self.assertEqual((target / '配音-2.wav').read_bytes(), b'audio-content')
        self.remote.assert_not_called()

    async def test_group_default_folder_uses_current_output_root(self):
        with patch.object(main.time, 'strftime', return_value='20261021-120000'):
            response = await self.client.post('/api/smart-canvas/group-export', json={
                'group_name': '镜头:一', 'items': [{'kind': 'text', 'text': '正文'}],
            })
        self.assertEqual(response.status_code, 200, response.text)
        folder = Path(main.OUTPUT_DIR) / 'smart-groups' / '镜头_一-20261021-120000'
        self.assertEqual(response.json()['folder'], str(folder))
        self.assertEqual((folder / '1.txt').read_text(encoding='utf-8'), '正文')

    async def test_group_skips_blank_missing_and_remote_media(self):
        target = self.root / 'skip-missing'
        response = await self.client.post('/api/smart-canvas/group-export', json={
            'folder': str(target),
            'items': [
                {'kind': 'text', 'text': ' \n'},
                {'kind': 'image', 'url': '/assets/missing.png'},
                {'kind': 'video', 'url': 'https://mock.invalid/remote.webm'},
                {'kind': 'text', 'text': 'kept', 'name': '文稿:正文'},
            ],
        })
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['count'], 1)
        self.assertEqual({p.name for p in target.iterdir()}, {'文稿_正文.txt'})
        self.remote.assert_not_called()

    async def test_group_empty_export_returns_existing_404(self):
        target = self.root / 'empty'
        response = await self.client.post('/api/smart-canvas/group-export', json={
            'folder': str(target),
            'items': [{'kind': 'text', 'text': ' '}, {'kind': 'image', 'url': '/assets/missing.png'}],
        })
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()['detail'], '没有可导出的内容')
        self.assertEqual(list(target.iterdir()), [])

    async def test_group_processes_only_first_two_thousand_items(self):
        target = self.root / 'limit'
        response = await self.client.post('/api/smart-canvas/group-export', json={
            'folder': str(target),
            'items': [{'kind': 'text', 'text': 'kept'}]
                     + [{'kind': 'text', 'text': ''}] * 1999
                     + [{'kind': 'text', 'text': 'beyond-limit', 'name': 'excluded'}],
        })
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['count'], 1)
        self.assertEqual({p.name for p in target.iterdir()}, {'1.txt'})

    async def test_group_copy_failure_does_not_report_success(self):
        url = self.asset('failed.png')
        target = self.root / 'copy-failure'
        with patch.object(main.shutil, 'copy2', side_effect=OSError('simulated full disk')):
            response = await self.client.post('/api/smart-canvas/group-export', json={
                'folder': str(target), 'items': [{'kind': 'image', 'url': url}],
            })
        self.assertEqual(response.status_code, 500)
        self.assertEqual(list(target.iterdir()), [])

    async def test_routes_keep_request_validation(self):
        for route, payload in (
            ('/api/canvas-assets/download', {'urls': 'not-a-list'}),
            ('/api/smart-canvas/group-export', {'items': ['not-an-item']}),
        ):
            with self.subTest(route=route):
                response = await self.client.post(route, json=payload)
                self.assertEqual(response.status_code, 422)
        self.remote.assert_not_called()
