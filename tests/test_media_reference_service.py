"""Reference conversion with synthetic files, mock downloads and simulated ffmpeg."""
import ast
import asyncio
import base64
import math
import os
import re
import shutil
import tempfile
import types
import unittest
import urllib.parse
from io import BytesIO
from pathlib import Path
from typing import Optional
import httpx
from PIL import Image
from backend import media_reference_service


NAMES = 'image_path_to_data_url content_type_for_path is_image_reference_value is_video_reference_value convert_output_to_jpg reference_to_data_url is_image_reference image_references media_reference_to_url is_private_asset_url looks_like_image_media_url probe_local_audio_duration_seconds video_reference_to_frame_data_urls compress_data_url_image modelscope_image_url volcengine_media_reference_url volcengine_video_reference_content_items'.split()


class MediaReferenceServiceTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.diagnostics, self.requests = [], []
        self.http_status = 200
        self.process_status = 0

        def handler(request):
            self.requests.append(str(request.url))
            return httpx.Response(self.http_status, content=b'fixture-video')

        def process(command, **kwargs):
            self.command = command
            if self.process_status == 0:
                Path(command[-1].replace('%03d', '001')).write_bytes(b'fixture-frame')
            return types.SimpleNamespace(returncode=self.process_status)

        self.ns = dict(media_reference_service=media_reference_service, os=os, re=re, math=math, asyncio=asyncio, urllib=urllib, Optional=Optional,
                       base64=base64, BytesIO=BytesIO, Image=Image, ASSETS_DIR=str(self.root), OUTPUT_DIR=str(self.root),
                       write_diagnostic=self.diagnostics.append,
                       output_file_from_url=lambda url: str(self.root / Path(url).name) if url.startswith(('/output/', '/assets/')) else None,
                       tempfile=types.SimpleNamespace(mkstemp=lambda **kwargs: tempfile.mkstemp(dir=self.root, **kwargs), mkdtemp=lambda **kwargs: tempfile.mkdtemp(dir=self.root, **kwargs)),
                       shutil=types.SimpleNamespace(which=lambda name: name, rmtree=shutil.rmtree),
                       subprocess=types.SimpleNamespace(run=process),
                       httpx=types.SimpleNamespace(Timeout=httpx.Timeout, AsyncClient=lambda **kwargs: httpx.AsyncClient(transport=httpx.MockTransport(handler), **kwargs)))
        tree = ast.parse(Path('main.py').read_text(encoding='utf-8'))
        selected = [n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name in NAMES]
        exec(compile(ast.Module(body=selected, type_ignores=[]), 'main.py', 'exec'), self.ns)

    async def test_local_reference_resize_keeps_alpha_and_remote_reference_passthrough(self):
        Image.new('RGBA', (40, 20), (100, 150, 200, 100)).save(self.root / 'reference.png')
        result = self.ns['reference_to_data_url']({'url': '/output/reference.png'}, max_size=10)
        self.assertTrue(result.startswith('data:image/png;base64,'))
        with Image.open(BytesIO(base64.b64decode(result.split(',', 1)[1]))) as image:
            self.assertEqual(image.size, (10, 5))
            self.assertEqual(image.mode, 'RGBA')
        self.assertEqual(self.ns['media_reference_to_url']('https://mock.invalid/image'), 'https://mock.invalid/image')
        self.assertEqual(self.requests, [])

    async def test_invalid_image_resize_falls_back_to_original_bytes(self):
        raw = b'not-an-image-fixture'
        (self.root / 'invalid.png').write_bytes(raw)
        result = self.ns['reference_to_data_url']({'url': '/output/invalid.png'}, max_size=10)
        self.assertEqual(base64.b64decode(result.split(',', 1)[1]), raw)
        self.assertTrue(self.diagnostics)
        self.assertEqual(self.ns['compress_data_url_image']('data:image/png;base64,invalid'), 'data:image/png;base64,invalid')

    async def test_remote_video_extracts_frames_then_removes_all_temporary_files(self):
        result = await self.ns['video_reference_to_frame_data_urls']('https://mock.invalid/video.mp4', max_frames=2, max_size=100)
        self.assertEqual(result, ['data:image/jpeg;base64,' + base64.b64encode(b'fixture-frame').decode()])
        self.assertEqual(list(self.root.iterdir()), [])
        self.assertEqual(self.command[self.command.index('-frames:v') + 1], '2')
        self.assertEqual(len(self.requests), 1)

    async def test_download_and_process_failures_cleanup_and_private_video_stays_private(self):
        self.http_status = 503
        self.assertEqual(await self.ns['video_reference_to_frame_data_urls']('https://mock.invalid/fail.mp4'), [])
        self.assertEqual(list(self.root.iterdir()), [])
        self.http_status = 200
        self.process_status = 1
        self.assertEqual(await self.ns['video_reference_to_frame_data_urls']('https://mock.invalid/fail.mp4'), [])
        self.assertEqual(list(self.root.iterdir()), [])
        before = len(self.requests)
        result = await self.ns['volcengine_video_reference_content_items']('asset://synthetic-video')
        self.assertEqual(result, [{'type': 'video_url', 'video_url': {'url': 'asset://synthetic-video'}, 'role': 'reference_video'}])
        self.assertEqual(len(self.requests), before)
