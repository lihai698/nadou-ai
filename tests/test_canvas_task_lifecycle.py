"""Exercise real task routes/workers with a controlled, network-free generator."""
import asyncio
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main


class CanvasTaskLifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tasks_patch = patch.object(main, 'CANVAS_TASKS', {})
        self.tasks_patch.start()
        self.addCleanup(self.tasks_patch.stop)
        self.task_dir = tempfile.TemporaryDirectory()
        self.task_dir_patch = patch.object(main, 'CANVAS_TASK_DIR', self.task_dir.name)
        self.task_dir_patch.start()
        self.addCleanup(self.task_dir_patch.stop)
        self.addCleanup(self.task_dir.cleanup)
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app), base_url='http://test')
        self.addAsyncCleanup(self.client.aclose)

    async def exercise(self, error=None):
        entered, release = asyncio.Event(), asyncio.Event()
        workers = []
        real_create_task = asyncio.create_task

        async def generator(payload):
            entered.set()
            await release.wait()
            if error is not None:
                raise error
            return {'images': ['/assets/output/test-only.png'], 'prompt': payload.prompt}

        def spawn(coroutine):
            task = real_create_task(coroutine)
            workers.append(task)
            return task

        with patch.object(main, 'build_online_image_result', side_effect=generator) as generate:
            with patch.object(main.asyncio, 'create_task', side_effect=spawn):
                try:
                    response = await self.client.post('/api/canvas-image-tasks', json={
                        'prompt': '隔离任务验收', 'provider_id': 'test-only'})
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.json()['status'], 'queued')
                    task_id = response.json()['task_id']
                    await asyncio.wait_for(entered.wait(), 2)
                    running = await self.client.get('/api/canvas-image-tasks/' + task_id)
                    self.assertEqual(running.json()['status'], 'running')
                    self.assertIsNone(running.json()['result'])
                    release.set()
                    await asyncio.wait_for(asyncio.gather(*workers), 2)
                    finished = await self.client.get('/api/canvas-image-tasks/' + task_id)
                    again = await self.client.get('/api/canvas-image-tasks/' + task_id)
                    self.assertEqual(finished.json(), again.json())
                    self.assertEqual(generate.call_count, 1, 'Polling must not resubmit generation')
                    return finished.json()
                finally:
                    release.set()
                    for task in workers:
                        if not task.done():
                            task.cancel()
                    await asyncio.gather(*workers, return_exceptions=True)

    async def test_success_moves_queued_running_succeeded(self):
        task = await self.exercise()
        self.assertEqual(task['status'], 'succeeded')
        self.assertEqual(task['error'], '')
        self.assertEqual(task['result']['images'], ['/assets/output/test-only.png'])
        persisted = json.loads(
            Path(self.task_dir.name, task['id'] + '.json').read_text(encoding='utf-8')
        )
        self.assertNotIn('prompt', persisted.get('result') or {})

    async def test_upstream_failure_preserves_error_and_recovery_id(self):
        error = main.HTTPException(status_code=503, detail='模拟上游服务不可用')
        error.upstream_task_id = 'test-recovery-id'
        task = await self.exercise(error)
        self.assertEqual(task['status'], 'failed')
        self.assertEqual(task['status_code'], 503)
        self.assertEqual(task['error'], error.detail)
        self.assertEqual(task['upstream_task_id'], 'test-recovery-id')
        self.assertIsNone(task['result'])

    async def test_timeout_is_failure_without_false_output(self):
        task = await self.exercise(httpx.ReadTimeout('模拟读取超时'))
        self.assertEqual(task['status'], 'failed')
        self.assertIn('模拟读取超时', task['error'])
        self.assertIsNone(task['result'])

    async def test_connection_loss_is_failure_without_resubmit(self):
        task = await self.exercise(httpx.ConnectError('模拟连接中断'))
        self.assertEqual(task['status'], 'failed')
        self.assertIn('模拟连接中断', task['error'])
        self.assertIsNone(task['result'])

    async def test_jimeng_pending_keeps_remote_query_id_without_false_result(self):
        pending = main.JimengPendingError('test-remote-id', queue_info={'queue_idx': 2, 'queue_length': 5})
        task = await self.exercise(pending)
        self.assertEqual(task['status'], 'jimeng_pending')
        self.assertEqual(task['submit_id'], 'test-remote-id')
        self.assertEqual(task['queue_info'], {'queue_idx': 2, 'queue_length': 5})
        self.assertTrue(task['jimeng_pending'])
        self.assertIsNone(task['result'])
        self.assertEqual(task['error'], '')

    async def test_cleared_task_memory_reads_same_process_record(self):
        task = await self.exercise()
        main.CANVAS_TASKS.clear()  # The durable record survives loss of the memory cache.
        response = await self.client.get('/api/canvas-image-tasks/' + task['id'])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['status'], 'succeeded')

    async def test_submission_stops_before_worker_when_record_cannot_save(self):
        created_workers = []
        real_create_task = asyncio.create_task

        def capture_worker(coroutine):
            created_workers.append(coroutine)
            return real_create_task(coroutine)

        with patch.object(main, '_write_canvas_task_record', side_effect=OSError('disk full')):
            with patch.object(main.asyncio, 'create_task', side_effect=capture_worker):
                response = await self.client.post('/api/canvas-image-tasks', json={
                    'prompt': '不会提交的隔离任务', 'provider_id': 'test-only'})

        self.assertEqual(response.status_code, 503)
        self.assertIn('记录无法保存', response.json()['detail'])
        self.assertEqual(created_workers, [])
        self.assertEqual(main.CANVAS_TASKS, {})

    async def test_corrupt_persisted_record_returns_controlled_error(self):
        task = await self.exercise()
        main.CANVAS_TASKS.clear()
        record_path = Path(self.task_dir.name, task['id'] + '.json')
        record_path.write_text('{"private":"secret"', encoding='utf-8')

        response = await self.client.get('/api/canvas-image-tasks/' + task['id'])

        self.assertEqual(response.status_code, 500)
        self.assertNotIn('secret', json.dumps(response.json(), ensure_ascii=False))

    async def test_batch_worker_keeps_all_remote_ids_when_one_branch_fails(self):
        task_id = 'canvas_img_batch_worker_123456789'
        task = {
            'id': task_id, 'type': 'online-image', 'status': 'queued',
            'created_at': 1.0, 'updated_at': 1.0, 'result': None, 'error': '',
            'provider_id': 'test-only', 'model': 'image-model',
            'input_summary': {'prompt_length': 3},
            'process_id': main.CANVAS_TASK_PROCESS_ID,
        }
        main.CANVAS_TASKS[task_id] = task
        payload = main.OnlineImageRequest(prompt='批量恢复测试', provider_id='test-only', n=2)

        async def generator(_payload):
            callback = main.CANVAS_IMAGE_REMOTE_ACCEPT_CALLBACK.get()
            await callback('remote-image-1')
            await callback('remote-image-2')
            error = main.HTTPException(status_code=504, detail='其中一个批次超时')
            error.upstream_task_id = 'remote-image-2'
            raise error

        with patch.object(main, 'build_online_image_result', side_effect=generator):
            await main._run_canvas_image_task(task_id, payload)
        self.assertEqual(main.CANVAS_TASKS[task_id]['status'], 'unknown')
        self.assertEqual(main.CANVAS_TASKS[task_id]['upstream_task_ids'], [
            'remote-image-1', 'remote-image-2'
        ])
