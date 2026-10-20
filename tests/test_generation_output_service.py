"""Real media persistence entry points, temporary files and mock HTTP only."""
import ast
import base64
import os
import tempfile
import types
import unittest
import urllib.parse
import uuid
from pathlib import Path
import httpx
from PIL import Image
from backend import generation_output_service


class GenerationOutputServiceTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.calls, self.errors = [], []
        self.response = (200, b'fixture', 'image/webp')

        def handler(request):
            self.calls.append(str(request.url))
            status, content, mime = self.response
            return httpx.Response(status, content=content, headers={'Content-Type': mime})

        self.ns = dict(generation_output_service=generation_output_service, os=os, urllib=urllib, uuid=uuid, base64=base64, Image=Image,
                       VIDEO_POLL_TIMEOUT=5, write_diagnostic=self.errors.append,
                       log_net_error=lambda *args: self.errors.append(args),
                       rewrite_runninghub_file_url=lambda url: url,
                       output_path_for=lambda filename, category: str(self.root / filename),
                       output_url_for=lambda filename, category: '/output/' + filename,
                       output_file_from_url=lambda url: str(self.root / Path(url).name) if url.startswith('/output/') else None,
                       httpx=types.SimpleNamespace(Timeout=httpx.Timeout, AsyncClient=lambda **kwargs: httpx.AsyncClient(transport=httpx.MockTransport(handler), **kwargs)))
        tree = ast.parse(Path('main.py').read_text(encoding='utf-8'))
        names = {'save_ai_image_to_output', 'image_output_meta', 'save_remote_video_to_output'}
        selected = [n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name in names]
        exec(compile(ast.Module(body=selected, type_ignores=[]), 'main.py', 'exec'), self.ns)

    async def test_base64_mime_extension_and_existing_media_passthrough(self):
        url = await self.ns['save_ai_image_to_output']({'type': 'b64', 'value': base64.b64encode(b'fixture').decode(), 'mime_type': 'image/jpeg'})
        self.assertTrue(url.endswith('.jpg'))
        self.assertEqual((self.root / Path(url).name).read_bytes(), b'fixture')
        self.assertEqual(await self.ns['save_ai_image_to_output']({'type': 'url', 'value': '/assets/existing.png'}), '/assets/existing.png')
        self.assertEqual(self.calls, [])

    async def test_remote_image_mime_and_failure_preserve_the_source_url(self):
        url = await self.ns['save_ai_image_to_output']({'type': 'url', 'value': 'https://mock.invalid/image'})
        self.assertTrue(url.endswith('.webp'))
        self.assertEqual((self.root / Path(url).name).read_bytes(), b'fixture')
        self.response = (503, b'fixture error', 'text/plain')
        original = 'https://mock.invalid/failure'
        self.assertEqual(await self.ns['save_ai_image_to_output']({'type': 'url', 'value': original}), original)
        self.assertEqual(len(list(self.root.iterdir())), 1)
        self.assertEqual(len(self.errors), 1)

    async def test_video_mime_selection_and_failed_download_cleanup(self):
        self.response = (200, b'video fixture', 'video/webm')
        url = await self.ns['save_remote_video_to_output']('https://mock.invalid/video')
        self.assertTrue(url.endswith('.webm'))
        for content, mime in [(b'<html>fixture</html>', 'text/html'), (b'', 'video/mp4')]:
            self.response = (200, content, mime)
            original = 'https://mock.invalid/failure.mp4'
            self.assertEqual(await self.ns['save_remote_video_to_output'](original), original)
        self.assertEqual(len(list(self.root.iterdir())), 1)
        self.assertEqual(len(self.errors), 2)
        self.assertEqual(await self.ns['save_remote_video_to_output']('/output/kept.mp4'), '/output/kept.mp4')

    async def test_local_image_dimensions_override_declared_dimensions_only(self):
        Image.new('RGB', (30, 20)).save(self.root / 'image.png')
        result = self.ns['image_output_meta']('/output/image.png', {'width': 999, 'height': 'bad', 'layout_w': 120})
        self.assertEqual((result['width'], result['height']), (30, 20))
        self.assertEqual(result['layout_w'], 120)
        self.assertEqual(result['name'], 'image.png')
        self.assertEqual(self.ns['image_output_meta'](''), {'url': '', 'kind': 'image'})
