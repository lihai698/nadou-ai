"""共享任务记录和图片worker的独立服务合同，无真实生成请求。"""
import asyncio
from contextvars import ContextVar
from pathlib import Path
from threading import Lock
from types import SimpleNamespace
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend import canvas_task_service as service
from backend.task_records import TaskRecordError


def task():
    return {'id': 'canvas_img_service_test123', 'status': 'queued', 'process_id': 'current',
            'created_at': 1, 'updated_at': 1, 'type': 'online-image'}


class RecordPolicyTests(unittest.TestCase):
    def test_durable_snapshot_filters_payload_and_sanitizes_result(self):
        original = {**task(), 'prompt': 'test prompt', 'workflow_json': 'test workflow',
                    'result': {'images': ['result.png'], 'internal': 'omit', 'raw_usage': {'v': 1}}}
        def sanitize(value):
            value['raw_usage'] = {'normalized': True}
        durable = service.durable_task(original, sanitize_usage=sanitize)
        self.assertNotIn('prompt', durable)
        self.assertNotIn('workflow_json', durable)
        self.assertNotIn('internal', durable['result'])
        self.assertEqual(durable['result']['raw_usage'], {'normalized': True})
        self.assertEqual(original['result']['raw_usage'], {'v': 1})

    def test_required_write_failure_raises_but_optional_returns_false(self):
        def fail(*args):
            raise OSError('test failure')
        args = dict(root='unused', snapshot=lambda value: value, diagnostic=lambda value: None, writer=fail)
        self.assertFalse(service.write_record(task(), **args))
        with self.assertRaises(TaskRecordError):
            service.write_record(task(), required=True, **args)

    def test_worker_recovery_only_restores_current_process(self):
        cache = {}
        args = dict(tasks=cache, process_id='current', diagnostic=lambda value: None,
                    read_error_types=(TaskRecordError,))
        self.assertIsNone(service.load_for_worker('id', read_record=lambda identity: {**task(), 'process_id': 'previous'}, **args))
        record = task()
        self.assertIs(service.load_for_worker('id', read_record=lambda identity: record, **args), record)
        self.assertIs(cache['id'], record)

    def test_interrupted_record_is_written_without_exposing_private_identity(self):
        writes = []
        record = {**task(), 'process_id': 'previous', 'assistant_request_hash': 'test-only'}
        result = service.interrupted_task(record, process_id='current', unknown_message='unknown', write_record=writes.append)
        self.assertEqual(result['status'], 'unknown')
        self.assertEqual(len(writes), 1)
        self.assertNotIn('process_id', service.public_task(result))
        self.assertNotIn('assistant_request_hash', service.public_task(result))


class WorkerTests(unittest.IsolatedAsyncioTestCase):
    def make(self, generate, writer=None):
        record = task()
        callback = ContextVar('service-test-accept', default=None)
        writes = []
        class Pending(Exception):
            submit_id = 'queue-id'
            kind = 'image'
            queue_info = {}
        args = dict(task_lock=Lock(), load_task=lambda identity: record,
                    mark_start_failed=lambda value, identity: value.update(status='failed'),
                    write_record=writer or (lambda value, **kwargs: writes.append(dict(value))),
                    generate=generate, accept_callback=callback, persist_accept=lambda *args, **kwargs: None,
                    pending_error=Pending, pending_payload=lambda error: {'message': 'queued upstream'},
                    public_queue_info=lambda info: info, public_error_detail=lambda error, **kwargs: str(error),
                    extract_task_id=lambda detail: '', unknown_message='unknown', diagnostic=lambda text: None)
        return record, callback, writes, args

    async def test_worker_success_persists_running_before_generation_and_restores_context(self):
        async def generate(payload):
            self.assertEqual(record['status'], 'running')
            self.assertTrue(callable(callback.get()))
            return {'images': ['local-test.png']}
        record, callback, writes, args = self.make(generate)
        await service.run_image_worker(record['id'], SimpleNamespace(n=1), **args)
        self.assertEqual([value['status'] for value in writes], ['running', 'succeeded'])
        self.assertIsNone(callback.get())

    async def test_start_failure_never_calls_generator(self):
        async def generate(payload):
            self.fail('must not submit')
        def writer(value, **kwargs):
            raise TaskRecordError('blocked')
        record, _, _, args = self.make(generate, writer)
        await service.run_image_worker(record['id'], SimpleNamespace(n=1), **args)
        self.assertEqual(record['status'], 'failed')

    async def test_final_write_failure_keeps_success_in_memory(self):
        async def generate(payload):
            return {'images': ['result.png']}
        def writer(value, **kwargs):
            if value['status'] == 'succeeded':
                raise OSError('blocked final write')
        record, _, _, args = self.make(generate, writer)
        await service.run_image_worker(record['id'], SimpleNamespace(n=1), **args)
        self.assertEqual(record['status'], 'succeeded')

    async def test_batch_failure_keeps_accepted_ids_unknown_without_resubmission(self):
        async def generate(payload):
            raise RuntimeError('one branch failed')
        record, _, _, args = self.make(generate)
        record.update(upstream_task_ids=['remote-a', 'remote-b'])
        await service.run_image_worker(record['id'], SimpleNamespace(n=2), **args)
        self.assertEqual(record['status'], 'unknown')
        self.assertEqual(record['upstream_task_ids'], ['remote-a', 'remote-b'])

    async def test_remote_accept_failure_keeps_original_id_on_error(self):
        record = task()
        def fail(value, **kwargs):
            raise TaskRecordError('disk failure')
        with self.assertRaises(TaskRecordError) as error:
            await service.persist_remote_accept(record['id'], 'remote-a', tasks={record['id']: record},
                task_lock=Lock(), process_id='current', read_record=lambda identity: None, write_record=fail)
        self.assertEqual(error.exception.upstream_task_id, 'remote-a')
        self.assertTrue(error.exception.remote_accept_persist_failed)
        self.assertEqual(record['upstream_task_id'], 'remote-a')


if __name__ == '__main__':
    unittest.main()
