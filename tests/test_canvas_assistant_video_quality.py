import copy
from pathlib import Path
import subprocess
import tempfile
import unittest

from backend.canvas_assistant_quality import build_video_inspection, inspect_videos
from backend.canvas_assistant_native import native_run_input_hash
from backend.canvas_clip import find_media_tools


class VideoResultInspectionTests(unittest.TestCase):
    def setUp(self):
        self.url = '/output/original.mp4'
        self.canvas = {'id': 'c', 'kind': 'classic', 'settings': {}, 'nodes': [
            {'id': 'prompt', 'type': 'prompt', 'text': '原提示词'},
            {'id': 'video', 'type': 'video', 'apiProvider': 'p', 'model': 'm', 'duration': 5,
             'inputs': ['prompt'], 'generatedOutputs': [{'url': self.url, 'kind': 'video'}],
             'assistantNativeRun': {'actionId': 'a', 'taskKind': 'video', 'taskIds': ['original']}},
            {'id': 'out', 'type': 'output', 'images': [{'url': self.url, 'kind': 'video'}]}],
            'connections': [{'from': 'prompt', 'to': 'video'}, {'from': 'video', 'to': 'out'}]}
        self.proposal = {'id': 'a', 'action': 'run', 'nodeType': 'video', 'canvasId': 'c',
                         'nodeId': 'video', 'outputNodeId': 'out', 'state': 'completed', 'confirmedAt': 1,
                         'runInputHash': native_run_input_hash(self.canvas, 'video'),
                         'runSettings': {'taskKind': 'video', 'provider': 'p', 'model': 'm', 'maxCalls': 1},
                         'videoRequest': {'duration': 5, 'aspect_ratio': '16:9', 'resolution': '', 'generate_audio': True},
                         'receipt': {'taskIds': ['original']}}
        self.task = {'task_id': 'original', 'status': 'succeeded', 'canvas_id': 'c', 'node_id': 'video',
                     'assistant_action_id': 'a', 'input_hash': self.proposal['runInputHash'],
                     'provider_id': 'p', 'model': 'm', 'result': {'videos': [self.url], 'task_id': 'remote'}}
        self.videos = [{'url': self.url, 'ok': True, 'status': 'passed', 'width': 1280, 'height': 720,
                        'duration': 5.0, 'hasAudio': True, 'sha256': '1' * 64, 'format': 'mov', 'bytes': 100,
                        'frames': [{'timestampSeconds': 2.5, 'sha256': '2' * 64, 'width': 640, 'height': 360,
                                    'dataUrl': 'data:image/jpeg;base64,private'}]}]

    def inspect(self):
        return build_video_inspection(canvas=self.canvas, videos=self.videos, proposal=self.proposal, task=self.task)

    def check(self, key):
        return next(c for c in self.inspect()['checks'] if c['id'] == key)

    def test_trusted_hard_conditions_pass_but_semantics_remain_unknown(self):
        result = self.inspect()
        self.assertEqual(result['hardStatus'], 'passed')
        self.assertEqual(result['status'], 'unknown')
        for key in ('task_binding', 'input_connections', 'saved_media', 'duration', 'aspect_ratio', 'audio_presence'):
            self.assertEqual(self.check(key)['status'], 'passed', key)
        self.assertEqual(self.check('full_video_semantics')['status'], 'unknown')
        self.assertEqual(self.check('audio_semantics')['status'], 'unknown')
        self.assertNotIn('dataUrl', str(result))

    def test_generated_outputs_alone_cannot_prove_original_output_saved(self):
        self.canvas['nodes'][2]['images']=[]
        self.assertEqual(self.check('saved_media')['status'],'needs_changes')
        self.assertEqual(self.inspect()['hardStatus'],'needs_changes')

    def test_each_owner_field_and_all_identifiers_are_required(self):
        original = copy.deepcopy(self.task)
        for field in ('task_id', 'canvas_id', 'node_id', 'assistant_action_id', 'input_hash', 'provider_id', 'model'):
            for value in (None, 'foreign'):
                with self.subTest(field=field, value=value):
                    self.task = {**original, field: value}
                    self.assertEqual(self.check('task_binding')['status'], 'needs_changes')
        self.task = {**original, 'id': 'foreign'}
        self.assertEqual(self.check('task_binding')['status'], 'needs_changes')

    def test_pending_or_missing_confirmation_never_becomes_confirmed(self):
        original = copy.deepcopy(self.proposal)
        for changes in ({'state': 'pending'}, {'confirmedAt': None}, {'videoRequest': None}, {'action': 'update'},
                        {'runSettings': {'taskKind': 'image'}}):
            with self.subTest(changes=changes):
                self.proposal = {**original, **changes}
                self.assertEqual(self.check('confirmed_request')['status'], 'unknown')
                self.assertNotEqual(self.inspect()['hardStatus'], 'passed')

    def test_duration_ratio_exact_size_and_audio_presence_mismatch(self):
        for changes, check in (({'duration': 4.5}, 'duration'), ({'width': 720, 'height': 1280}, 'aspect_ratio'),
                               ({'hasAudio': False}, 'audio_presence')):
            original = copy.deepcopy(self.videos)
            self.videos[0].update(changes)
            self.assertEqual(self.check(check)['status'], 'needs_changes')
            self.videos = original
        self.proposal['videoRequest']['size'] = '1920x1080'
        self.assertEqual(self.check('dimensions')['status'], 'needs_changes')

    def test_unsupported_resolution_and_unknown_metadata_stay_unknown(self):
        self.proposal['videoRequest']['resolution'] = '780P'
        self.assertEqual(self.check('dimensions')['status'], 'unknown')
        self.proposal['videoRequest']['resolution'] = ''
        self.videos[0].pop('duration')
        self.assertEqual(self.check('duration')['status'], 'unknown')

    def test_result_set_is_complete_and_output_count_not_guessed_from_max_calls(self):
        self.task['result']['videos'].append('/output/second.mp4')
        self.assertEqual(self.check('result_videos')['status'], 'needs_changes')
        self.videos.append({**self.videos[0], 'url': '/output/second.mp4'})
        self.canvas['nodes'][2]['images'].append({'url': '/output/second.mp4', 'kind': 'video'})
        self.assertEqual(self.check('video_count')['status'], 'passed')
        self.assertFalse(self.check('video_count')['limited'])
        self.assertEqual(self.check('result_videos')['status'], 'passed')
        for invalid in (self.url, {'url': self.url, 'kind': 'image'}, None, 'https://foreign/video.mp4'):
            with self.subTest(invalid=invalid):
                self.task['result']['videos'] = [self.url, invalid]
                self.assertEqual(self.check('result_videos')['status'], 'needs_changes')

    def test_saved_output_and_original_input_cannot_be_replaced(self):
        self.canvas['connections'].pop()
        self.assertEqual(self.check('saved_media')['status'], 'needs_changes')
        self.canvas['connections'].append({'from': 'video', 'to': 'out'})
        self.canvas['nodes'][0]['text'] = '更改后提示词'
        self.assertEqual(self.check('input_connections')['status'], 'needs_changes')

    def test_other_images_in_original_output_do_not_hide_saved_video(self):
        self.canvas['nodes'][1]['generatedOutputs'] = []
        self.canvas['nodes'][2]['images'].append({'url': '/output/old.png', 'kind': 'image'})
        self.assertEqual(self.check('saved_media')['status'], 'passed')

    def test_missing_task_and_no_sample_are_unknown(self):
        self.task = None
        self.assertEqual(self.check('task_binding')['status'], 'unknown')
        self.assertEqual(self.inspect()['hardStatus'], 'unknown')
        self.videos[0]['frames'] = []
        self.assertEqual(self.check('video_samples')['status'], 'unknown')

    def test_receipt_task_list_matches_all_tasks(self):
        self.task = [self.task]
        self.assertEqual(self.check('task_binding')['status'], 'passed')
        self.proposal['receipt']['taskIds'] = ['foreign']
        self.assertEqual(self.check('task_binding')['status'], 'needs_changes')

    def test_snapshot_changes_for_actual_file_confirmed_request_and_task(self):
        baseline = copy.deepcopy((self.canvas, self.proposal, self.task, self.videos))
        initial = self.inspect()['snapshotHash']
        for target, field, value in ((self.videos[0], 'sha256', '3' * 64),
                                     (self.proposal['videoRequest'], 'duration', 6), (self.task, 'status', 'failed')):
            previous = target[field]
            target[field] = value
            self.assertNotEqual(initial, self.inspect()['snapshotHash'])
            target[field] = previous
        self.assertEqual(baseline, (self.canvas, self.proposal, self.task, self.videos))

    def test_duration_tolerance_is_bounded_and_invalid_metadata_is_unknown(self):
        self.videos[0]['duration'] = 5.049
        self.assertEqual(self.check('duration')['status'], 'passed')
        self.videos[0]['duration'] = 5.06
        self.assertEqual(self.check('duration')['status'], 'needs_changes')
        for invalid in (True, None, float('inf'), float('nan'), '5'):
            with self.subTest(invalid=invalid):
                self.videos[0]['duration'] = invalid
                self.assertEqual(self.check('duration')['status'], 'unknown')

    def test_real_local_video_metadata_is_used_for_confirmed_hard_conditions(self):
        tools = find_media_tools()
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / 'original.mp4'
            subprocess.run([tools[0], '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=80x48:rate=10:duration=1.2',
                            '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1.2', '-c:v', 'mpeg4', '-c:a', 'aac',
                            '-movflags', '+faststart', '-shortest', str(output)], check=True, capture_output=True, timeout=10)
            self.videos = inspect_videos([self.url], resolve_file=lambda _: output, allowed_roots=[temp], tools=tools)
            self.canvas['nodes'][1]['duration'] = 1.2
            self.proposal['runInputHash'] = native_run_input_hash(self.canvas, 'video')
            self.task['input_hash'] = self.proposal['runInputHash']
            self.proposal['videoRequest'].update(duration=1.2, aspect_ratio='5:3', size='80x48')
            self.assertEqual(self.inspect()['hardStatus'], 'passed')
            self.assertEqual(self.inspect()['status'], 'unknown')
            self.proposal['videoRequest']['duration'] = 5
            self.assertEqual(self.check('duration')['status'], 'needs_changes')


if __name__ == '__main__':
    unittest.main()
