"""应用/工作流协议合同；仅使用 MockTransport。"""
from dataclasses import replace
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.runninghub_app_service import RunningHubAppService, RunningHubAppError
from backend import runninghub_fields as fields


class AppTests(unittest.IsolatedAsyncioTestCase):
    def make(self, handler):
        calls, events = [], []
        def respond(request):
            calls.append(request)
            return handler(request)
        async def sleep(seconds):
            events.append('poll')
        async def store(client, remote):
            return '/output/saved.png'
        service = RunningHubAppService(
            provider=lambda: {}, api_key=lambda *args, **kwargs: 'local-test-only',
            app_headers=lambda *args, **kwargs: {}, endpoint_url=lambda provider, path: 'https://rh.test'+path,
            local_asset_path=lambda value: None, content_type=lambda path: 'image/png',
            error_detail=lambda message, *args, **kwargs: message,
            fail_reason=lambda raw: raw.get('msg', '') if isinstance(raw, dict) else '',
            parse_size=lambda size: (1920, 1080), extract_outputs=lambda raw: raw or [],
            public_app_info=lambda raw, key: raw, log_error=lambda *args, **kwargs: None,
            workflow_json_error=lambda exc: 'invalid workflow JSON',
            workflow_node_info=lambda raw: list(raw), workflow_fields=lambda raw: list(raw),
            workflow_store_key=lambda value: str(value).strip(), store_output=store,
            image_meta=lambda value: {'url': value}, rewrite_url=lambda value: value,
            reference_limit=3, clock=lambda: 0, sleep=sleep,
            client_factory=lambda **kwargs: httpx.AsyncClient(transport=httpx.MockTransport(respond), **kwargs),
        )
        return service, calls, events

    async def test_entry_maps_prompt_dimensions_and_accepts_before_poll(self):
        def handler(request):
            if request.url.path.endswith('/create'):
                body = json.loads(request.content)
                values = {item['fieldName']: item['fieldValue'] for item in body['nodeInfoList']}
                self.assertEqual(values, {'prompt': 'hello', 'width': 1920, 'ratio': '16:9'})
                self.assertEqual(body['workflowId'], 'fixture')
                return httpx.Response(200, json={'code': 0, 'data': {'taskId': 'accepted'}})
            self.assertEqual(events[0], 'accepted')
            return httpx.Response(200, json={'code': 0, 'data': ['https://cdn.test/result.png']})
        service, calls, events = self.make(handler)
        entry = {'kind': 'workflow', 'id': 'fixture', 'fields': [
            {'nodeId': '1', 'fieldName': name, 'enabled': True} for name in ('prompt', 'width', 'ratio')
        ]}
        async def accept(identity, **metadata):
            self.assertEqual(metadata['query_mode'], 'runninghub_image')
            events.append(identity)
        result, _ = await service.generate_image('hello', '1920x1080', 'workflow:fixture', [], {}, entry, on_remote_accept=accept)
        self.assertEqual(result['value'], 'https://cdn.test/result.png')
        self.assertEqual(len(calls), 2)

    async def test_app_submit_preserves_instance_and_sanitizes_seed(self):
        def handler(request):
            body = json.loads(request.content)
            self.assertEqual(body['instanceType'], 'test-instance')
            self.assertLessEqual(int(body['nodeInfoList'][0]['fieldValue']), fields.SEED_UINT32_MAX)
            return httpx.Response(200, json={'code': 0, 'data': {'taskId': 'accepted'}})
        service, calls, _ = self.make(handler)
        result = await service.submit(SimpleNamespace(webappId='fixture', useWallet=False, instanceType='test-instance',
            nodeInfoList=[{'fieldName': 'seed', 'fieldValue': '999999999999'}]))
        self.assertEqual(result['data']['taskId'], 'accepted')
        self.assertEqual(len(calls), 1)

    async def test_workflow_submit_serializes_inline_workflow_and_omits_empty_nodes(self):
        def handler(request):
            body = json.loads(request.content)
            self.assertNotIn('nodeInfoList', body)
            self.assertTrue(body['addMetadata'])
            self.assertEqual(json.loads(body['workflow']), {'node': {'seed': 1}})
            return httpx.Response(200, json={'code': '0', 'data': {'taskId': 'accepted'}})
        service, _, _ = self.make(handler)
        result = await service.submit_workflow(SimpleNamespace(workflowId='fixture', useWallet=True, nodeInfoList=[], workflow={'node': {'seed': 1}}))
        self.assertTrue(result['success'])

    async def test_query_codes_and_success_media_projection(self):
        for code, expected in [(0, 'SUCCESS'), (804, 'RUNNING'), (813, 'QUEUED'), (805, 'FAILED'), (999, 'UNKNOWN')]:
            service, calls, _ = self.make(lambda request: httpx.Response(200, json={'code': code, 'data': ['https://cdn.test/a.png']}))
            result = await service.query('task', False)
            self.assertEqual(result['data']['status'], expected)
            self.assertEqual(result['data']['urls'], ['/output/saved.png'] if code == 0 else [])
            self.assertEqual(len(calls), 1)

    async def test_workflow_info_invalid_json_and_fetch_projection(self):
        service, _, _ = self.make(lambda request: httpx.Response(200, json={'code': 0, 'data': {'prompt': '{broken'}}))
        with self.assertRaises(RunningHubAppError) as caught:
            await service.workflow_info('fixture')
        self.assertEqual(caught.exception.status_code, 502)
        service, _, _ = self.make(lambda request: httpx.Response(200, json={'code': 0, 'data': {'prompt': '{"1":{}}'}}))
        result = await service.fetch_workflow(SimpleNamespace(workflowId='fixture', title='title', description=''))
        self.assertEqual(result['data']['fields'], ['1'])
        self.assertEqual(result['data']['workflowJson'], {'1': {}})

    async def test_submit_failure_and_missing_id_are_not_retried(self):
        for status, raw, expected in [(429, {}, 429), (200, {'code': 1}, 400), (200, {'code': 0, 'data': {}}, 502)]:
            service, calls, _ = self.make(lambda request: httpx.Response(status, json=raw))
            with self.assertRaises(RunningHubAppError) as caught:
                await service.submit(SimpleNamespace(webappId='fixture', useWallet=False, instanceType='', nodeInfoList=[]))
            self.assertEqual(caught.exception.status_code, expected)
            self.assertEqual(len(calls), 1)

    async def test_remote_upload_uses_download_bytes_and_filename(self):
        def handler(request):
            if request.method == 'GET':
                return httpx.Response(200, content=b'synthetic-image', headers={'content-type': 'image/png'})
            self.assertIn(b'synthetic-image', request.content)
            self.assertIn(b'filename="reference.png"', request.content)
            return httpx.Response(200, json={'code': 0, 'data': {'fileName': 'stored.png'}})
        service, calls, _ = self.make(handler)
        result = await service.upload_asset(SimpleNamespace(url='https://cdn.test/reference.png', useWallet=False))
        self.assertEqual(result['data']['fileName'], 'stored.png')
        self.assertEqual(len(calls), 2)

    async def test_entry_upload_local_file_and_empty_reference(self):
        def handler(request):
            self.assertIn(b'local-reference', request.content)
            return httpx.Response(200, json={'code': 0, 'data': {'fileName': 'uploaded.png'}})
        service, calls, _ = self.make(handler)
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'fixture.png'
            path.write_bytes(b'local-reference')
            service = replace(service, local_asset_path=lambda value: str(path))
            async with service.client_factory() as client:
                self.assertEqual(await service.upload_filename(client, {}, ''), '')
                self.assertEqual(await service.upload_filename(client, {}, '/assets/fixture.png'), 'uploaded.png')
        self.assertEqual(len(calls), 1)

    async def test_entry_queue_failure_and_timeout_preserve_error_status(self):
        responses = iter([
            {'code': 0, 'data': {'taskId': 'accepted'}},
            {'code': 813}, {'code': 804}, {'code': 805, 'msg': 'failed'},
        ])
        service, calls, _ = self.make(lambda request: httpx.Response(200, json=next(responses)))
        entry = {'kind': 'app', 'id': 'fixture', 'fields': []}
        with self.assertRaises(RunningHubAppError) as caught:
            await service.generate_image('p', '1:1', 'app:fixture', [], {}, entry)
        self.assertEqual(caught.exception.status_code, 502)
        self.assertEqual(len(calls), 4)
        service, calls, _ = self.make(lambda request: httpx.Response(200, json={'code': 0, 'data': {'taskId': 'accepted'}}))
        ticks = iter([0, 1801])
        service = replace(service, clock=lambda: next(ticks))
        with self.assertRaises(RunningHubAppError) as caught:
            await service.generate_image('p', '1:1', 'app:fixture', [], {}, entry)
        self.assertEqual(caught.exception.status_code, 504)
        self.assertEqual(len(calls), 1)

    async def test_app_info_projects_response_and_preserves_http_failure(self):
        service, _, _ = self.make(lambda request: httpx.Response(200, json={'code': 0, 'data': {'name': 'fixture'}}))
        self.assertEqual((await service.app_info('fixture'))['data'], {'name': 'fixture'})
        service, calls, _ = self.make(lambda request: httpx.Response(503, json={'code': 503}))
        with self.assertRaises(RunningHubAppError) as caught:
            await service.app_info('fixture')
        self.assertEqual(caught.exception.status_code, 503)
        self.assertEqual(len(calls), 1)

    async def test_entry_accept_storage_failure_stops_poll(self):
        service, calls, _ = self.make(lambda request: httpx.Response(200, json={'code': 0, 'data': {'taskId': 'accepted'}}))
        async def accept(*args, **kwargs):
            raise OSError('cannot persist')
        with self.assertRaises(OSError):
            await service.generate_image('p', '1:1', 'app:x', [], {}, {'kind': 'app', 'id': 'x'}, on_remote_accept=accept)
        self.assertEqual(len(calls), 1)


class FieldTests(unittest.TestCase):
    def test_media_order_indexes_and_default_values(self):
        values = [
            {'nodeId': '10', 'fieldName': 'image', 'fieldType': 'IMAGE', 'imageOrder': 2},
            {'nodeId': '2', 'fieldName': 'image', 'fieldType': 'IMAGE', 'imageOrder': 1},
            {'nodeId': '1', 'fieldName': 'video', 'fieldType': 'VIDEO'},
        ]
        self.assertEqual(fields.rh_field_indexes(values), {('2', 'image'): 0, ('10', 'image'): 1, ('1', 'video'): 0})
        self.assertEqual(fields.rh_default_value({'fieldValue': ['first', 'second']}), 'first')
        self.assertEqual(fields.rh_field_role({'label': '负向提示词'}), 'prompt')


if __name__ == '__main__':
    unittest.main()
