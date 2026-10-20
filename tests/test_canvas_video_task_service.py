"""视频任务服务独立合同，不加载应用配置或请求真实供应商。"""
import asyncio
from contextlib import nullcontext
import json
from pathlib import Path
from threading import RLock
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend import canvas_video_task_service as service


def record(**fields):
    return {'id': 'canvas_video_service_test123', 'type': 'video', 'status': 'running',
            'process_id': 'current', 'created_at': 1, 'updated_at': 2, **fields}


class VideoTaskRecordTests(unittest.TestCase):
    def test_storage_preserves_records_and_rejects_non_video_ids(self):
        with tempfile.TemporaryDirectory() as root:
            value = record(extra={'legacy': True})
            with service.record_lock(value['id'], root=root, lock=RLock()):
                service.write_record(value, root=root)
                self.assertEqual(service.read_record(value['id'], root=root), value)
            with self.assertRaises(service.VideoTaskError) as error:
                service.record_path('canvas_img_not_video_123', root=root)
            self.assertEqual(error.exception.status_code, 400)

    def test_damaged_record_has_fixed_error_without_raw_contents(self):
        with tempfile.TemporaryDirectory() as root:
            target = Path(service.record_path(record()['id'], root=root))
            target.write_text('{ invalid test data', encoding='utf-8')
            with self.assertRaises(service.VideoTaskError) as error:
                service.read_record(record()['id'], root=root)
            self.assertEqual(error.exception.status_code, 500)
            self.assertNotIn('invalid test data', error.exception.detail)

    def test_public_snapshot_filters_private_fields_and_external_results(self):
        value = record(prompt='private-test-text', request_hash='private-test-hash',
            input_summary={'prompt_length': 12, 'prompt': 'omit', 'duration': 99999},
            result={'videos': ['/output/local.mp4', 'https://provider.test/private.mp4'], 'raw': {'omit': True}},
            error='internal-error', remote={'status': 'UNKNOWN', 'error': 'internal-error', 'raw': 'omit'})
        public = service.public_task(value, public_error=lambda value, **kwargs: 'safe error')
        self.assertNotIn('prompt', public)
        self.assertNotIn('request_hash', public)
        self.assertNotIn('process_id', public)
        self.assertEqual(public['result']['videos'], ['/output/local.mp4'])
        self.assertNotIn('prompt', public['input_summary'])
        self.assertEqual(public['input_summary']['duration'], 3600)
        self.assertEqual(public['error'], 'safe error')

    def test_other_process_running_is_unknown_view_without_modifying_record(self):
        value = record(remote={'task_id': 'remote-original', 'query_supported': True, 'query_mode': 'http_get'})
        before = json.loads(json.dumps(value))
        visible = service.interrupted_task(value, process_id='next', unknown_message='unknown')
        self.assertEqual(value, before)
        self.assertEqual(visible['status'], 'unknown')
        self.assertEqual(visible['remote']['task_id'], 'remote-original')
        self.assertEqual(visible['remote']['query_mode'], 'http_get')

    def test_durable_terminal_wins_over_volatile_result(self):
        persisted = record(status='failed')
        cached = record(status='succeeded')
        self.assertIs(service.visible_task(persisted, volatile={persisted['id']: cached}), persisted)
        running = record()
        self.assertIs(service.visible_task(running, volatile={running['id']: cached}), cached)

    def test_output_result_is_success_even_if_adapter_omits_raw(self):
        observed = service.result_observation({'task_id': 'remote-original'}, ['/output/test.mp4'], output_urls=lambda value: [])
        self.assertEqual(observed.status, service.REMOTE_SUCCEEDED)
        self.assertEqual(observed.task_id, 'remote-original')


class VideoTaskAsyncTests(unittest.IsolatedAsyncioTestCase):
    async def test_remote_accept_keeps_id_and_query_mode_before_long_wait(self):
        value = record()
        writes = []
        await service.persist_remote_accept(value['id'], 'remote-original', query_mode='http_get',
            process_id='current', record_lock=lambda identity: nullcontext(),
            read_record=lambda identity: value, write_record=writes.append)
        self.assertEqual(writes[0]['upstream_task_id'], 'remote-original')
        self.assertTrue(writes[0]['remote']['query_supported'])
        self.assertEqual(writes[0]['remote']['query_mode'], 'http_get')

    async def test_execution_gate_is_held_only_around_worker(self):
        gate = asyncio.Semaphore(1)
        calls = []
        async def worker(identity, payload):
            calls.append(identity)
            self.assertTrue(gate.locked())
        await service.run_video_task('test', None, gate=gate, worker=worker)
        self.assertEqual(calls, ['test'])
        self.assertFalse(gate.locked())


if __name__ == '__main__':
    unittest.main()
