import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image

from backend.canvas_assistant_quality import build_inspection, inspect_images, inspect_videos


class ImageInspectionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.allowed = self.root / 'allowed'
        self.allowed.mkdir()
        self.path = self.allowed / 'result.png'
        Image.new('RGB', (64, 48), 'red').save(self.path)

    def inspect(self, url='/output/result.png', path=None):
        return inspect_images([url], resolve_file=lambda _: path or self.path,
                              allowed_roots=[self.allowed])[0]

    def test_reads_actual_image_dimensions_format_and_stream_digest(self):
        result = self.inspect()
        self.assertTrue(result['ok'])
        self.assertEqual((result['width'], result['height'], result['format']), (64, 48, 'PNG'))
        self.assertEqual(result['sha256'], hashlib.sha256(self.path.read_bytes()).hexdigest())
        self.assertEqual(result['bytes'], self.path.stat().st_size)
        self.assertNotIn(str(self.allowed), json.dumps(result))

    def test_corrupt_and_truncated_images_fail_without_private_exception_text(self):
        for data in [b'not an image', self.path.read_bytes()[:45]]:
            self.path.write_bytes(data)
            result = self.inspect()
            self.assertFalse(result['ok'])
            self.assertEqual(result['errorCode'], 'invalid_image')
            self.assertNotIn(str(self.path), json.dumps(result))

    def test_remote_data_local_path_and_url_traversal_never_call_resolver(self):
        calls = []
        urls = ['https://example.test/p.png', 'data:image/png;base64,AAAA',
                str(self.path), '//example.test/p.png', '/output/../secret.png',
                '/assets/%2e%2e/secret.png', '/output/%252e%252e/secret.png',
                '/assets/a%5c..%5csecret.png', '/api/storage-files/remote/x.png']
        results = inspect_images(urls, resolve_file=lambda url: calls.append(url), allowed_roots=[self.allowed])
        self.assertFalse(calls)
        self.assertTrue(all(not r['ok'] and r['errorCode'] == 'invalid_url' for r in results))
        self.assertNotIn(str(self.path), json.dumps(results))

    def test_resolved_path_outside_allowed_root_and_directory_are_rejected(self):
        outside = self.root / 'outside.png'
        Image.new('RGB', (4, 4)).save(outside)
        self.assertEqual(self.inspect(path=outside)['errorCode'], 'unsafe_path')
        self.assertEqual(self.inspect(path=self.allowed)['errorCode'], 'not_file')

    def test_missing_file_and_resolver_failure_are_safe(self):
        self.assertEqual(self.inspect(path=self.allowed / 'absent.png')['errorCode'], 'missing_file')
        def failed(_):
            raise RuntimeError('secret: ' + str(self.path))
        result = inspect_images(['/output/x.png'], resolve_file=failed, allowed_roots=[self.allowed])[0]
        self.assertFalse(result['ok'])
        self.assertNotIn('secret', json.dumps(result))
        self.assertNotIn(str(self.path), json.dumps(result))

    def test_query_credentials_are_not_read_or_disclosed(self):
        url='/output/result.png?private=C%3A%5CUsers%5CPrivate%5Csecret.txt&api_key=secret-value'
        result=inspect_images([url],resolve_file=lambda _:self.path,allowed_roots=[self.allowed])[0]
        self.assertEqual(result['errorCode'],'invalid_url')
        self.assertNotIn('secret',json.dumps(result))

    def test_symbolic_file_and_parent_directory_links_are_rejected(self):
        link = self.allowed / 'link.png'
        directory = self.allowed / 'linked-dir'
        try:
            os.symlink(self.path, link)
            os.symlink(self.allowed, directory, target_is_directory=True)
        except OSError as exc:
            self.skipTest('系统不允许创建测试符号链接: ' + str(exc.winerror if hasattr(exc, 'winerror') else exc.errno))
        self.assertEqual(self.inspect(path=link)['errorCode'], 'unsafe_path')
        self.assertEqual(self.inspect(path=directory / 'result.png')['errorCode'], 'unsafe_path')


class VideoInspectionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.allowed = self.root / 'allowed'
        self.allowed.mkdir()
        self.path = self.allowed / 'video.mp4'
        self.path.write_bytes(b'\x00\x00\x00\x18ftypisom' + b'\x00' * 32)
        self.url = '/output/video.mp4'

    def inspect(self, **kwargs):
        return inspect_videos([self.url], resolve_file=lambda _: self.path,
                              allowed_roots=[self.allowed], **kwargs)[0]

    def test_rejects_urls_escape_links_and_playlists_before_starting_tool(self):
        with patch('backend.canvas_assistant_quality._run_media') as run:
            for url in ['https://example.test/video.mp4', '/assets/../private.mp4', '/output/x.mp4?key=private']:
                self.url = url
                self.assertEqual(self.inspect()['status'], 'needs_changes')
            self.url = '/output/video.mp4'
            self.path = self.root / 'outside.mp4'
            self.path.write_bytes(b'\x00\x00\x00\x18ftypisom' + b'\x00' * 32)
            self.assertEqual(self.inspect()['errorCode'], 'unsafe_path')
            target = self.path
            self.path = self.allowed / 'linked.mp4'
            try:
                os.symlink(target, self.path)
            except OSError:
                self.path = self.allowed / 'playlist.mp4'
            else:
                self.assertEqual(self.inspect()['errorCode'], 'unsafe_path')
                self.path = self.allowed / 'playlist.mp4'
            self.path.write_text('#EXTM3U\n#EXTINF:10\nhttps://example.test/private.ts\n')
            self.assertEqual(self.inspect()['errorCode'], 'unsupported_video')
            run.assert_not_called()

    def test_missing_runtime_and_timeout_are_unknown_without_private_error(self):
        with patch('backend.canvas_assistant_quality.find_media_tools', side_effect=ValueError('private runtime path')):
            result = self.inspect()
            self.assertEqual(result['status'], 'unknown')
            self.assertEqual(result['errorCode'], 'runtime_unavailable')
            self.assertNotIn('private', json.dumps(result))
        with patch('backend.canvas_assistant_quality._run_media', side_effect=TimeoutError('private file path')):
            result = self.inspect(tools=('ffmpeg', 'ffprobe'))
            self.assertEqual(result['status'], 'unknown')
            self.assertEqual(result['errorCode'], 'video_timeout')
            self.assertNotIn('private', json.dumps(result))

    def test_probe_failure_bad_metadata_and_file_limit_never_pass(self):
        with patch('backend.canvas_assistant_quality._run_media', return_value=(1, b'', b'private details')):
            self.assertEqual(self.inspect(tools=('ffmpeg', 'ffprobe'))['errorCode'], 'invalid_video')
        for duration in ['NaN', '-1', '0', 'infinity']:
            probe = {'streams': [{'codec_type': 'video', 'width': 64, 'height': 48}], 'format': {'duration': duration}}
            with patch('backend.canvas_assistant_quality._run_media', return_value=(0, json.dumps(probe).encode(), b'')):
                self.assertEqual(self.inspect(tools=('ffmpeg', 'ffprobe'))['status'], 'unknown')
        self.assertEqual(self.inspect(max_bytes=16)['errorCode'], 'video_limit')

    def test_frame_count_and_timeout_configuration_are_bounded(self):
        for kwargs in [{'max_frames': 4}, {'max_frames': True}, {'timeout': 31}, {'timeout': 0}, {'max_bytes': 201 * 1024 * 1024}]:
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                self.inspect(**kwargs)

    def test_all_media_commands_restrict_demuxer_protocol_and_return_limited_scope(self):
        import io
        frame = io.BytesIO()
        Image.new('RGB', (64, 48), 'green').save(frame, format='JPEG')
        probe = {'streams': [{'codec_type': 'video', 'width': 64, 'height': 48}, {'codec_type': 'audio'}],
                 'format': {'duration': '2.0'}}
        calls = []
        def run(command, source, **limits):
            calls.append((command, source, limits))
            if command[0] == 'ffprobe':
                return 0, json.dumps(probe).encode(), b''
            return 0, frame.getvalue(), b'[Parsed_showinfo_2] n: 0 pts: 10 pts_time:1.0 duration_time:0.1'
        with patch('backend.canvas_assistant_quality._run_media', side_effect=run):
            result = self.inspect(tools=('ffmpeg', 'ffprobe'), max_frames=1)
        self.assertEqual(result['status'], 'passed')
        self.assertTrue(result['hasAudio'])
        self.assertEqual(result['frames'][0]['timestampSeconds'], 1.0)
        self.assertTrue(result['frames'][0]['dataUrl'].startswith('data:image/jpeg;base64,'))
        self.assertEqual(result['coverage']['audioSemantics'], 'unknown')
        self.assertEqual(result['coverage']['fullVideoSemantics'], 'unknown')
        for command, source, limits in calls:
            self.assertEqual(command[command.index('-protocol_whitelist') + 1], 'pipe')
            self.assertEqual(command[command.index('-f') + 1], 'mov')
            self.assertIn('pipe:0', command)
            self.assertNotIn(str(self.path), command)
            self.assertLessEqual(limits['timeout'], 30)
            self.assertLessEqual(limits['max_stdout'], 2 * 1024 * 1024)

    def test_real_generated_video_metadata_and_timestamped_frames(self):
        from backend.canvas_clip import find_media_tools
        tools = find_media_tools()
        subprocess.run([tools[0], '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=80x48:rate=10:duration=1.2',
                        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1.2', '-c:v', 'mpeg4', '-c:a', 'aac',
                        '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', str(self.path)],
                       check=True, capture_output=True, timeout=20)
        result = self.inspect(tools=tools, max_frames=3)
        self.assertEqual(result['status'], 'passed', result)
        self.assertEqual((result['width'], result['height']), (80, 48))
        self.assertAlmostEqual(result['duration'], 1.2, places=1)
        self.assertEqual(len(result['frames']), 3)
        stamps = [f['timestampSeconds'] for f in result['frames']]
        self.assertEqual(stamps, sorted(stamps))
        self.assertEqual(len(set(stamps)), 3)
        self.assertTrue(all(0 <= stamp < result['duration'] for stamp in stamps))
        self.assertNotIn(str(self.root), json.dumps(result))

    def test_file_replaced_during_failed_frame_extraction_invalidates_metadata(self):
        probe = {'streams': [{'codec_type': 'video', 'width': 64, 'height': 48}], 'format': {'duration': '1'}}
        def run(command, source, **limits):
            if command[0] == 'ffprobe':
                return 0, json.dumps(probe).encode(), b''
            self.path.write_bytes(b'replaced')
            return 1, b'', b'private details'
        with patch('backend.canvas_assistant_quality._run_media', side_effect=run):
            result = self.inspect(tools=('ffmpeg', 'ffprobe'))
        self.assertEqual(result['errorCode'], 'changed_file')
        self.assertFalse(result['ok'])
        self.assertFalse(result['frames'])

    def test_process_runner_enforces_timeout_and_both_output_limits(self):
        import sys
        from backend.canvas_assistant_quality import _run_media
        cases = [('import time; time.sleep(2)', TimeoutError, 0.1),
                 ('import sys; sys.stdout.write("x" * 10000)', ValueError, 2),
                 ('import sys; sys.stderr.write("x" * 10000)', ValueError, 2)]
        for script, error, timeout in cases:
            with self.subTest(script=script), self.path.open('rb') as source, self.assertRaises(error):
                _run_media([sys.executable, '-c', script], source, timeout=timeout, max_stdout=100, max_stderr=100)


class ResultInspectionTests(unittest.TestCase):
    def setUp(self):
        self.url = '/output/result.png'
        self.images = [{'url': self.url, 'ok': True, 'width': 64, 'height': 48,
                        'format': 'PNG', 'sha256': 'a' * 64, 'bytes': 100}]
        self.canvas = {'id': 'c', 'kind': 'classic', 'updated_at': 1,
                       'nodes': [{'id': 'prompt', 'type': 'prompt', 'text': '海报'},
                                 {'id': 'gen', 'type': 'generator', 'inputs': ['prompt'],
                                  'generatedOutputs': [self.url]},
                                 {'id': 'output', 'type': 'output', 'images': [self.url]}],
                       'connections': [{'from': 'prompt', 'to': 'gen'}, {'from': 'gen', 'to': 'output'}]}
        self.proposal = {'id': 'p', 'canvasId': 'c', 'nodeId': 'gen', 'nodeIds': ['prompt', 'gen'],
                         'taskId': 'original', 'state': 'submitted',
                         'imageRequest': {'prompt': '海报', 'size': '64x48', 'n': 1}}
        self.task = {'task_id': 'original', 'status': 'succeeded', 'result': {'images': [self.url]}}

    def report(self):
        return build_inspection(canvas=self.canvas, images=self.images, proposal=self.proposal, task=self.task)

    def test_task_provider_and_model_must_match_confirmed_request(self):
        self.proposal['imageRequest'].update(provider_id='original-provider',model='original-model')
        for field in ('provider_id','model'):
            self.task[field]='foreign'
            self.assertEqual(self.report()['hardStatus'],'needs_changes')
            self.task.pop(field)

    def check(self, report, identity):
        return next(c for c in report['checks'] if c['id'] == identity)

    def test_confirmed_classic_and_smart_saved_results_pass(self):
        before = copy.deepcopy((self.canvas, self.images, self.proposal, self.task))
        self.assertEqual(self.report()['hardStatus'], 'passed')
        self.assertEqual(before, (self.canvas, self.images, self.proposal, self.task))
        self.canvas['kind'] = 'smart'
        self.canvas['nodes'][1] = {'id': 'gen', 'type': 'smart-image', 'inputNodeIds': ['prompt'],
                                   'images': [{'url': self.url, 'kind': 'image'}]}
        self.canvas['connections'][0]['kind'] = 'input'
        self.assertEqual(self.report()['hardStatus'], 'passed')

    def test_dimension_mismatch_is_hard_failure_even_with_model_requirements(self):
        self.images[0]['width'] = 65
        self.proposal['requirements'] = ['宽度必须 65']
        result = self.report()
        self.assertEqual(result['hardStatus'], 'needs_changes')
        self.assertEqual(self.check(result, 'dimensions')['status'], 'needs_changes')

    def test_auto_size_does_not_invent_pixel_constraint(self):
        self.proposal['imageRequest']['size'] = 'auto'
        self.proposal['customSize'] = '1x1'
        self.images[0]['width'] = 234
        result = self.report()
        self.assertEqual(result['hardStatus'], 'passed')
        self.assertFalse(self.check(result, 'dimensions')['limited'])

    def test_missing_confirmation_is_unknown_not_guessed_from_node_or_model(self):
        self.proposal.pop('imageRequest')
        self.proposal.update(size='64x48', count=1, requirements=['64x48，1 张'])
        self.assertEqual(self.report()['hardStatus'], 'unknown')
        result = build_inspection(canvas=self.canvas, images=self.images)
        self.assertEqual(result['hardStatus'], 'unknown')

    def test_unreadable_image_cannot_pass(self):
        self.images[0] = {'url': self.url, 'ok': False, 'errorCode': 'invalid_image', 'error': '图片文件无法完整读取'}
        self.assertEqual(self.report()['hardStatus'], 'needs_changes')

    def test_foreign_task_canvas_node_and_non_success_status_cannot_pass(self):
        for field, value in [('task_id', 'foreign'), ('canvas_id', 'other'), ('node_id', 'other'),
                             ('status', 'running'), ('id', 'foreign')]:
            with self.subTest(field=field):
                previous = copy.deepcopy(self.task)
                self.task[field] = value
                self.assertEqual(self.report()['hardStatus'], 'needs_changes')
                self.task = previous
        self.proposal['canvasId'] = 'other'
        self.assertEqual(self.report()['hardStatus'], 'needs_changes')

    def test_original_result_count_and_inspected_urls_are_checked(self):
        self.task['result']['images'].append('/output/other.png')
        result = self.report()
        self.assertEqual(self.check(result, 'image_count')['status'], 'needs_changes')
        self.task['result']['images'] = ['/output/foreign.png']
        self.assertEqual(self.check(self.report(), 'result_images')['status'], 'needs_changes')

    def test_malformed_result_items_are_not_silently_omitted(self):
        for value in [{}, {'url': self.url, 'kind': 'video'}, None]:
            with self.subTest(value=value):
                self.task['result']['images'] = [self.url, value]
                self.assertEqual(self.report()['hardStatus'], 'needs_changes')

    def test_changed_image_bytes_produce_new_snapshot_even_at_same_dimensions(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'result.png'
            def read():
                return inspect_images([self.url], resolve_file=lambda _: path, allowed_roots=[temp])
            Image.new('RGB', (64, 48), 'red').save(path)
            self.images = read()
            original = self.report()['snapshotHash']
            Image.new('RGB', (64, 48), 'blue').save(path)
            self.images = read()
            self.assertEqual(self.report()['hardStatus'], 'passed')
            self.assertNotEqual(self.report()['snapshotHash'], original)

    def test_missing_saved_media_wrong_media_kind_and_foreign_output_cannot_pass(self):
        for change in ['absent', 'foreign_output', 'video']:
            with self.subTest(change=change):
                previous = copy.deepcopy(self.canvas)
                self.canvas['nodes'][1]['generatedOutputs'] = []
                if change == 'absent':
                    self.canvas['nodes'][2]['images'] = []
                elif change == 'foreign_output':
                    self.canvas['connections'].pop()
                else:
                    self.canvas['nodes'][2]['images'] = [{'url': self.url, 'kind': 'video'}]
                self.assertEqual(self.check(self.report(), 'saved_media')['status'], 'needs_changes')
                self.canvas = previous

    def test_required_source_node_input_membership_and_edge_must_remain(self):
        for change in ['node', 'membership', 'edge']:
            with self.subTest(change=change):
                previous = copy.deepcopy(self.canvas)
                if change == 'node':
                    self.canvas['nodes'].pop(0)
                elif change == 'membership':
                    self.canvas['nodes'][1]['inputs'] = []
                else:
                    self.canvas['connections'].pop(0)
                self.assertEqual(self.check(self.report(), 'input_connections')['status'], 'needs_changes')
                self.canvas = previous

    def test_snapshot_changes_with_file_canvas_confirmation_or_task_result(self):
        original = self.report()['snapshotHash']
        for subject, key, value in [(self.images[0], 'sha256', 'b' * 64),
                                    (self.canvas, 'updated_at', 2),
                                    (self.proposal['imageRequest'], 'size', '65x48'),
                                    (self.task['result'], 'images', ['/output/replaced.png'])]:
            with self.subTest(key=key):
                previous = copy.deepcopy(subject[key])
                subject[key] = value
                self.assertNotEqual(self.report()['snapshotHash'], original)
                subject[key] = previous
        self.assertEqual(self.report()['snapshotHash'], original)


if __name__ == '__main__':
    unittest.main()
