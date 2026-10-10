import ast
import asyncio
import copy
import json
from pathlib import Path
import subprocess
import os
import shutil
import tempfile
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from backend.canvas_assistant_media_export import (
    prepare_media_export, validate_media_export_snapshot, verify_clip_export,
)
from backend.canvas_clip import CanvasClipManager, find_media_tools
from backend.canvas_asset_rules import sanitize_export_filename


class MediaExportContractTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.metadata = {}
        self.source = self.add_file('source.mp4', duration=3)
        self.request_id = 'a' * 32
        self.task_id = 'b' * 32
        self.node = {'id': 'clip', 'type': 'clip', 'clipData': {'version': 1, 'fps': 30,
            'exportMuted': False, 'clips': [self.clip('one', 15, 30), self.clip('two', 45, 60)]}}

    def tearDown(self):
        self.temp.cleanup()

    def add_file(self, name, duration=1, width=1920, height=1080, audio=True):
        path = self.root / name
        path.write_bytes(('fixture-' + name).encode())
        self.metadata[name] = {'streams': [{'codec_type': 'video', 'codec_name': 'h264',
            'width': width, 'height': height, 'pix_fmt': 'yuv420p', 'r_frame_rate': '30/1',
            'duration': str(duration)}] + ([{'codec_type': 'audio'}] if audio else [])}
        return '/output/' + name

    def resolve(self, url):
        return self.root / url.removeprefix('/output/') if url.startswith('/output/') else None

    def probe(self, path):
        return self.metadata[path.name]

    def clip(self, identifier, start=0, end=15):
        return {'id': identifier, 'kind': 'video', 'url': self.source, 'startFrame': start,
                'endFrame': end, 'sourceOffsetFrames': 0, 'sourceNodeId': 'deleted-upstream',
                'sourceResultId': 'original-result'}

    def prepare(self, node=None, options=None, **kwargs):
        return prepare_media_export('canvas', node or self.node,
            options or {'scope': 'full', 'destination': 'canvas'},
            self.resolve, [self.root], self.probe, request_id=self.request_id, **kwargs)

    def binding(self, plan, **extra):
        return {k: plan[k] for k in ('canvasId', 'nodeId', 'rangeHash', 'requestId')} | extra

    def task(self, plan, status='succeeded', count=None):
        results = []
        for index, item in enumerate(plan['expectedResults'][:count]):
            name = (f'clip-full-{self.task_id}.mp4' if item['sourceClipId'] is None
                    else f'clip-{index+1:03d}-{self.task_id}.mp4')
            url = self.add_file(name, duration=item['durationSeconds'], audio=plan['outputSpec']['hasAudio'])
            results.append({'url': url, 'name': name, 'sourceClipId': item['sourceClipId'],
                            'durationSeconds': item['durationSeconds']})
        return {'id': self.task_id, 'canvas_id': 'canvas', 'node_id': 'clip', 'status': status, 'results': results}

    def verify_clip(self, plan, task, binding=None):
        return verify_clip_export(plan, task, binding or self.binding(plan, taskId=self.task_id),
                                  self.resolve, [self.root], self.probe)



    def test_full_preserves_gaps_and_saved_historical_sources(self):
        before = copy.deepcopy(self.node)
        plan = self.prepare()
        self.assertEqual(plan['expectedResults'][0]['durationSeconds'], 2)
        self.assertEqual(plan['nativeRequest']['clipData']['clips'][0]['startFrame'], 15)
        self.assertEqual(plan['sources'][0]['sourceNodeId'], 'deleted-upstream')
        self.assertEqual(self.node, before)
        self.assertTrue(self.verify_clip(plan, self.task(plan))['complete'])

    def test_segments_bind_each_file_and_keep_failed_partial(self):
        plan = self.prepare(options={'scope': 'segments', 'destination': 'download', 'exportMuted': True})
        task = self.task(plan, 'failed', 1)
        receipt = self.verify_clip(plan, task)
        self.assertFalse(receipt['complete'])
        self.assertEqual(receipt['status'], 'failed')
        self.assertEqual(receipt['remainingClipIds'], ['two'])
        self.assertEqual(len(receipt['files']), 1)
        self.assertFalse(receipt['files'][0]['hasAudio'])
        task['status'] = 'succeeded'
        with self.assertRaises(HTTPException):
            self.verify_clip(plan, task)

    def test_running_never_claims_complete(self):
        plan = self.prepare()
        self.assertFalse(self.verify_clip(plan, self.task(plan, 'running', 0))['complete'])

    def test_reject_remote_client_override_and_invalid_native_ranges(self):
        invalid = []
        for field, value in [('url', 'https://example.test/a.mp4'), ('endFrame', 1000),
                             ('startFrame', True), ('sourceOffsetFrames', -1), ('kind', 'audio')]:
            node = copy.deepcopy(self.node)
            node['clipData']['clips'][0][field] = value
            invalid.append(node)
        node = copy.deepcopy(self.node)
        node['clipData']['clips'][1]['startFrame'] = 20
        invalid.append(node)
        node = copy.deepcopy(self.node)
        node['clipData']['clips'][1]['id'] = 'one'
        invalid.append(node)
        with patch('socket.getaddrinfo', side_effect=AssertionError('no DNS')):
            for node in invalid:
                with self.subTest(node=node), self.assertRaises(HTTPException):
                    self.prepare(node)
        for options in [{'scope': 'full', 'destination': 'canvas', 'clipData': {}},
                        {'scope': 'full', 'destination': 'canvas', 'exportMuted': 'false'}]:
            with self.assertRaises(HTTPException):
                self.prepare(options=options)


    def test_resolver_outside_root_empty_and_corrupt_metadata(self):
        for resolver, roots, probe in [(self.resolve, [], self.probe),
                                       (lambda u: Path(__file__), [self.root], self.probe),
                                       (self.resolve, [self.root], lambda p: {'streams': [None]})]:
            with self.assertRaises(HTTPException):
                prepare_media_export('canvas', self.node, {'scope': 'full', 'destination': 'canvas'}, resolver, roots, probe)
        (self.root / 'source.mp4').write_bytes(b'')
        with self.assertRaises(HTTPException):
            self.prepare()

    def test_clip_reject_foreign_binding_forged_names_missing_files_and_spec(self):
        plan = self.prepare()
        task = self.task(plan)
        for key, value in [('id', 'c'*32), ('canvas_id', 'other'), ('node_id', 'other'), ('status', 'done')]:
            changed = copy.deepcopy(task)
            changed[key] = value
            with self.assertRaises(HTTPException):
                self.verify_clip(plan, changed)
        with self.assertRaises(HTTPException):
            self.verify_clip(plan, task, self.binding(plan, taskId=self.task_id) | {'rangeHash': 'fake'})
        result = task['results'][0]
        name = result['name']
        for key, value in [('width', 1280), ('codec_name', 'vp9'), ('duration', '10'), ('r_frame_rate', '24/1')]:
            before = copy.deepcopy(self.metadata[name])
            self.metadata[name]['streams'][0][key] = value
            with self.assertRaises(HTTPException):
                self.verify_clip(plan, task)
            self.metadata[name] = before
        result['name'] = 'other.mp4'
        with self.assertRaises(HTTPException):
            self.verify_clip(plan, task)
        result['name'] = name
        (self.root / name).unlink()
        with self.assertRaises(HTTPException):
            self.verify_clip(plan, task)

    def test_clip_reject_duplicate_result_ids(self):
        plan = self.prepare(options={'scope': 'segments', 'destination': 'download'})
        task = self.task(plan)
        task['results'].append(copy.deepcopy(task['results'][0]))
        with self.assertRaises(HTTPException):
            self.verify_clip(plan, task)






class RealClipExportContractTests(unittest.TestCase):

    def test_real_native_export_receipt_and_file_probe(self):
        ffmpeg, ffprobe = find_media_tools(Path(__file__).resolve().parents[1] / 'data')
        with tempfile.TemporaryDirectory(prefix='assistant-export-') as directory:
            root = Path(directory)
            media, output = root / 'media', root / 'output'
            media.mkdir()
            output.mkdir()
            subprocess.run([ffmpeg, '-v', 'error', '-y', '-f', 'lavfi', '-i',
                            'color=blue:s=64x64:r=30:d=0.4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
                            str(media / 'source.mp4')], check=True, capture_output=True, timeout=30)
            def resolve(url):
                return (media / url.removeprefix('/assets/') if url.startswith('/assets/')
                        else output / url.removeprefix('/output/') if url.startswith('/output/') else None)
            def probe(path):
                return json.loads(subprocess.check_output([ffprobe, '-v', 'error', '-show_streams',
                    '-show_format', '-of', 'json', str(path)], timeout=30))
            node = {'id': 'clip', 'type': 'clip', 'clipData': {'version': 1, 'fps': 30, 'exportMuted': True,
                    'clips': [{'id': 'one', 'kind': 'video', 'url': '/assets/source.mp4',
                               'startFrame': 3, 'endFrame': 9, 'sourceOffsetFrames': 3}]}}
            plan = prepare_media_export('canvas', node, {'scope': 'full', 'destination': 'canvas'},
                                        resolve, [media, output], probe)
            manager = CanvasClipManager(root / 'data', output, lambda name: '/output/' + name,
                                         resolve, [media, output], tools=(ffmpeg, ffprobe))
            try:
                task = manager.create(plan['nativeRequest'])
                deadline = time.monotonic() + 60
                while task['status'] not in {'succeeded', 'failed'} and time.monotonic() < deadline:
                    time.sleep(0.05)
                    task = manager.get(task['id'])
                binding = {k: plan[k] for k in ('canvasId', 'nodeId', 'rangeHash', 'requestId')} | {'taskId': task['id']}
                result = verify_clip_export(plan, task, binding, resolve, [media, output], probe)
                self.assertTrue(result['complete'], task.get('error'))
                self.assertAlmostEqual(result['files'][0]['durationSeconds'], 0.3, delta=2/30)
                self.assertEqual(manager.create(plan['nativeRequest'])['id'], task['id'])
            finally:
                manager.close()


if __name__ == '__main__':
    unittest.main()
