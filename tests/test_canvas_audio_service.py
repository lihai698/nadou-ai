"""音频服务合同：使用本地记录和模拟供应商，禁止真实生成。"""
import asyncio
from pathlib import Path
import sys
import tempfile
from threading import RLock
from types import SimpleNamespace
import unittest

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend import canvas_audio_service as service
from backend.task_records import TaskRecordError, read_task_record, write_task_record


class AudioServiceTests(unittest.IsolatedAsyncioTestCase):
    def worker(self, generate, writer):
        task = {'id': 'canvas_audio_service_test123', 'status': 'queued', 'type': 'audio-generation'}
        args = dict(gate=asyncio.Semaphore(1), task_lock=RLock(), load_task=lambda identity: task,
                    mark_start_failed=lambda task, identity: task.update(status='failed'),
                    write_record=writer, generate=generate, public_error=lambda error, **kwargs: str(error))
        return task, args

    async def test_success_is_written_after_running(self):
        writes = []
        async def generate(payload):
            self.assertEqual(task['status'], 'running')
            return {'text': '模拟识别结果', 'kind': 'text'}
        task, args = self.worker(generate, lambda value, **kwargs: writes.append(value['status']))
        await service.run_task(task['id'], None, **args)
        self.assertEqual(writes, ['running', 'succeeded'])

    async def test_running_write_failure_never_calls_generator(self):
        async def generate(payload):
            self.fail('must not submit')
        def writer(value, **kwargs):
            raise TaskRecordError('test write failure')
        task, args = self.worker(generate, writer)
        await service.run_task(task['id'], None, **args)
        self.assertEqual(task['status'], 'failed')

    async def test_transport_failure_is_unknown_without_retry(self):
        calls = []
        async def generate(payload):
            calls.append(1)
            raise httpx.ReadTimeout('test interruption')
        task, args = self.worker(generate, lambda *args, **kwargs: True)
        await service.run_task(task['id'], None, **args)
        self.assertEqual(calls, [1])
        self.assertEqual(task['status'], 'unknown')

    async def test_final_write_failure_is_not_public_success_until_query_persists_it(self):
        async def generate(payload):
            return {'text': '待保存文字', 'kind': 'text'}
        def fail_final(value, **kwargs):
            if value['status'] == 'succeeded':
                raise TaskRecordError('test final write failure')
        task, args = self.worker(generate, fail_final)
        await service.run_task(task['id'], None, **args)
        tasks = {task['id']: task}
        read_args = dict(tasks=tasks, task_lock=RLock(), read_record=lambda identity: None,
                         write_record=fail_final, public_record=lambda value: value,
                         interrupted_record=lambda value: value)
        with self.assertRaises(service.AudioServiceError) as error:
            service.get_task(task['id'], **read_args)
        self.assertEqual(error.exception.status_code, 503)
        writes = []
        read_args['write_record'] = lambda value, **kwargs: writes.append(dict(value))
        result = service.get_task(task['id'], **read_args)
        self.assertEqual(result['result']['text'], '待保存文字')
        self.assertNotIn('_audioResultSavePending', result)
        self.assertNotIn('_audioResultSavePending', task)
        self.assertEqual(len(writes), 1)

    async def test_existing_id_checks_request_hash_before_provider_or_worker(self):
        class Payload(SimpleNamespace):
            def model_dump(self):
                return vars(self)
        payload = Payload(client_task_id='canvas_audio_service_test123', provider_id='test', model='tts',
                          prompt='测试', settings={}, references=[], operation='generation')
        with tempfile.TemporaryDirectory() as root:
            import hashlib, json
            digest = hashlib.sha256(json.dumps(payload.model_dump(), ensure_ascii=False, sort_keys=True).encode()).hexdigest()
            write_task_record(root, {'id': payload.client_task_id, 'type': 'audio-generation', 'status': 'queued',
                                    'input_summary': {'request_hash': digest}})
            args = dict(tasks={}, task_lock=RLock(), root=root, process_id='current',
                        get_provider=lambda identity: self.fail('no new provider request'), headers_for=lambda **kwargs: {},
                        snapshot=lambda value: value, worker=lambda *args: self.fail('no new worker'),
                        spawn=lambda coroutine: self.fail('no new scheduling'), trace_factory=lambda *args, **kwargs: {})
            result = await service.create_task(payload, **args)
            self.assertEqual(result['status'], 'queued')
            payload.prompt = 'different'
            with self.assertRaises(service.AudioServiceError) as error:
                await service.create_task(payload, **args)
            self.assertEqual(error.exception.status_code, 409)


if __name__ == '__main__':
    unittest.main()
