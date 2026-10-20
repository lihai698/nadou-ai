"""标准OpenAPI连接合同：MockTransport，不使用真实账户或供应商。"""
from dataclasses import replace
import json
from pathlib import Path
import re
import sys
import tempfile
from types import SimpleNamespace
import unittest

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.runninghub_openapi import RunningHubOpenAPIAdapter, RunningHubOpenAPIError
from backend import runninghub_protocol as rules


def parse_size(value):
    match = re.fullmatch(r'(\d+)x(\d+)', str(value))
    return tuple(map(int, match.groups())) if match else (0, 0)


class RuleTests(unittest.TestCase):
    def test_schema_choice_and_defaults_preserve_types_and_explicit_values(self):
        field = {'options': [{'value': '1:1'}, {'value': '16:9'}], 'defaultValue': '1:1'}
        self.assertEqual(rules.runninghub_schema_value(field, '16:9'), '16:9')
        self.assertEqual(rules.runninghub_schema_value(field, '3:2'), '1:1')
        body = {'prompt': 'kept'}
        rules.runninghub_apply_schema_defaults(body, [
            {'fieldKey': 'prompt', 'defaultValue': 'not used'},
            {'fieldKey': 'enabled', 'type': 'BOOLEAN', 'defaultValue': 'false'},
            {'fieldKey': 'steps', 'type': 'INT', 'defaultValue': '12'},
        ])
        self.assertEqual(body, {'prompt': 'kept', 'enabled': False, 'steps': 12})

    def test_ratio_resolution_and_video_model_rules(self):
        self.assertEqual(rules.runninghub_aspect_from_size('1920x1080', parse_size=parse_size), '16:9')
        self.assertEqual(rules.runninghub_resolution_from_size('3200x1800', parse_size=parse_size), '4k')
        self.assertEqual(rules.runninghub_size_for_aspect('9:16'), '720x1280')
        self.assertTrue(rules.runninghub_is_image_to_video('model/image_to_video'))


class AdapterTests(unittest.IsolatedAsyncioTestCase):
    def make(self, handler, params=None, model='text-to-image'):
        calls, saved, events = [], [], []
        async def definition(provider, requested):
            return {'endpoint': model, 'params': params or []}
        async def save_video(url, **kwargs):
            saved.append(url)
            return '/output/test-video.mp4'
        async def sleep(seconds):
            events.append(('sleep', seconds))
        def extract(raw):
            raise RunningHubOpenAPIError(502, 'no image')
        def respond(request):
            calls.append(request)
            return handler(request)
        adapter = RunningHubOpenAPIAdapter(
            model_definition=definition, task_endpoint=lambda provider, name: 'https://rh.test/'+name,
            openapi_url=lambda provider, route: 'https://rh.test/'+route,
            api_headers=lambda provider: {}, json_headers=lambda provider: {}, upload_headers=lambda provider: {},
            resolve_file=lambda url: None, content_type=lambda path: 'image/png',
            parse_size=parse_size, rewrite_url=lambda url: url, generic_extract=extract,
            fail_reason=lambda raw: raw.get('error',''), error_detail=lambda message,*args,**kwargs: message,
            response_error=lambda response: 'upstream error',
            video_urls=lambda raw: raw.get('videos',[]), extract_outputs=lambda raw: raw.get('outputs',[]),
            save_video=save_video, reference_limit=3, video_timeout=30,
            client_factory=lambda **kwargs: httpx.AsyncClient(transport=httpx.MockTransport(respond),**kwargs),
            sleep=sleep, clock=lambda: 0,
        )
        return adapter, calls, saved, events

    async def test_image_submit_accept_then_poll_with_schema_and_reference_limits(self):
        params=[{'fieldKey':'aspectRatio','options':['1:1','16:9']}, {'fieldKey':'quality','defaultValue':'medium'}]
        def handler(request):
            if request.url.path=='/text-to-image':
                body=json.loads(request.content)
                self.assertEqual(body['aspectRatio'],'16:9')
                self.assertEqual(body['quality'],'medium')
                self.assertEqual(len(body['imageUrls']),3)
                return httpx.Response(200,json={'taskId':'remote-1'})
            self.assertEqual(events[0],('accept','remote-1','runninghub_image'))
            self.assertEqual(json.loads(request.content),{'taskId':'remote-1'})
            return httpx.Response(200,json={'status':'SUCCESS','results':['https://cdn.test/image.png']})
        adapter,calls,_,events=self.make(handler,params)
        async def accept(identity,**metadata):events.append(('accept',identity,metadata['query_mode']))
        image,raw=await adapter.generate_image('test','1920x1080','model',[{'url':'https://ref.test/a.png'}]*4,{},on_remote_accept=accept)
        self.assertEqual(image['value'],'https://cdn.test/image.png')
        self.assertEqual(len(calls),2)

    async def test_immediate_image_result_does_not_poll_or_accept(self):
        adapter,calls,_,events=self.make(lambda request:httpx.Response(200,json={'results':['https://cdn.test/direct.png']}))
        async def accept(*args,**kwargs):self.fail('direct result is not an accepted pending task')
        result,_=await adapter.generate_image('test','1024x1024','model',[],{},on_remote_accept=accept)
        self.assertEqual(result['type'],'url');self.assertEqual(len(calls),1);self.assertEqual(events,[])

    async def test_submission_http_failure_is_not_retried(self):
        adapter,calls,_,_=self.make(lambda request:httpx.Response(503,json={'error':'unavailable'}))
        with self.assertRaises(httpx.HTTPStatusError):
            await adapter.generate_image('test','1024x1024','model',[],{})
        self.assertEqual(len(calls),1)

    async def test_image_poll_retries_pending_but_reports_failed_and_http_status(self):
        responses = iter([
            httpx.Response(200, json={'status': 'RUNNING'}),
            httpx.Response(200, json={'status': 'FAILED', 'error': 'provider failed'}),
        ])
        adapter, calls, _, _ = self.make(lambda request: next(responses))
        async with adapter.client_factory() as client:
            with self.assertRaises(RunningHubOpenAPIError) as caught:
                await adapter.wait_image_task(client, {}, 'task')
        self.assertEqual(caught.exception.status_code, 502)
        self.assertIn('provider failed', caught.exception.detail)
        self.assertEqual(len(calls), 2)
        adapter, _, _, _ = self.make(lambda request: httpx.Response(429, json={}))
        async with adapter.client_factory() as client:
            with self.assertRaises(RunningHubOpenAPIError) as caught:
                await adapter.wait_image_task(client, {}, 'task')
        self.assertEqual(caught.exception.status_code, 429)

    async def test_poll_deadlines_do_not_submit_again(self):
        for method in ('wait_image_task', 'wait_task'):
            adapter, calls, _, _ = self.make(lambda request: self.fail('deadline expired'))
            ticks = iter([0, 1801])
            adapter = replace(adapter, clock=lambda: next(ticks))
            async with adapter.client_factory() as client:
                with self.assertRaises(RunningHubOpenAPIError) as caught:
                    await getattr(adapter, method)(client, {}, 'task')
            self.assertEqual(caught.exception.status_code, 504)
            self.assertEqual(calls, [])

    async def test_callback_failure_stops_before_poll_without_resubmitting(self):
        adapter, calls, _, _ = self.make(lambda request: httpx.Response(200, json={'taskId': 'accepted'}))
        async def accept(*args, **kwargs):
            raise OSError('cannot persist remote identity')
        with self.assertRaises(OSError):
            await adapter.generate_image('test', '1:1', 'model', [], {}, on_remote_accept=accept)
        self.assertEqual(len(calls), 1)

    async def test_video_poll_accepts_outputs_without_terminal_status_and_reports_cancel(self):
        adapter, _, _, _ = self.make(lambda request: httpx.Response(200, json={'videos': ['https://cdn.test/v.mp4']}))
        async with adapter.client_factory() as client:
            result = await adapter.wait_task(client, {}, 'task', 'video')
        self.assertEqual(result['videos'], ['https://cdn.test/v.mp4'])
        adapter, _, _, _ = self.make(lambda request: httpx.Response(200, json={'status': 'CANCEL'}))
        async with adapter.client_factory() as client:
            with self.assertRaises(RunningHubOpenAPIError) as caught:
                await adapter.wait_task(client, {}, 'task', 'video')
        self.assertEqual(caught.exception.status_code, 502)

    async def test_video_maps_frames_before_poll_and_saves_local_output(self):
        params=[{'fieldKey':'firstFrameUrl'},{'fieldKey':'lastFrameUrl'},{'fieldKey':'generateAudio'}]
        def handler(request):
            if request.url.path=='/image-to-video':
                body=json.loads(request.content)
                self.assertEqual(body['firstFrameUrl'],'https://ref.test/first.png')
                self.assertEqual(body['lastFrameUrl'],'https://ref.test/last.png')
                self.assertTrue(body['generateAudio'])
                return httpx.Response(200,json={'taskId':'remote-video'})
            self.assertEqual(events[0],('accept','remote-video'))
            return httpx.Response(200,json={'status':'SUCCESS','videos':['https://cdn.test/video.mp4']})
        adapter,calls,saved,events=self.make(handler,params,'image-to-video')
        payload=SimpleNamespace(model='image-to-video',prompt='test',aspect_ratio='16:9',duration=5,resolution='720p',generate_audio=True,watermark=False,
            images=[SimpleNamespace(url='https://ref.test/last.png',role='last_frame'),SimpleNamespace(url='https://ref.test/first.png',role='first_frame')])
        async def accept(identity):events.append(('accept',identity))
        result=await adapter.generate_video(payload,{},on_remote_accept=accept)
        self.assertEqual(result['videos'],['/output/test-video.mp4']);self.assertEqual(saved,['https://cdn.test/video.mp4']);self.assertEqual(len(calls),2)

    async def test_required_first_frame_rejects_before_submission(self):
        adapter,calls,_,_=self.make(lambda request:self.fail('must not submit'),[{'fieldKey':'firstFrameUrl'}],'image-to-video')
        payload=SimpleNamespace(model='image-to-video',prompt='test',aspect_ratio='16:9',duration=5,resolution='',generate_audio=False,watermark=False,images=[])
        with self.assertRaises(RunningHubOpenAPIError) as error:await adapter.generate_video(payload,{})
        self.assertEqual(error.exception.status_code,400);self.assertEqual(calls,[])

    async def test_reference_upload_uses_multipart_and_preserves_public_url_passthrough(self):
        def handler(request):
            self.assertIn(b'name="file"',request.content)
            return httpx.Response(200,json={'data':{'download_url':'https://cdn.test/upload.png'}})
        adapter,calls,_,_=self.make(handler)
        with tempfile.TemporaryDirectory() as root:
            file=Path(root)/'fixture.png';file.write_bytes(b'synthetic')
            adapter = replace(adapter, resolve_file=lambda url: str(file) if url=='/assets/fixture.png' else None)
            async with adapter.client_factory() as client:
                self.assertEqual(await adapter.upload_reference(client,{}, {'url':'https://ref.test/public.png'}),'https://ref.test/public.png')
                self.assertEqual(await adapter.upload_reference(client,{}, {'url':'/assets/fixture.png'}),'https://cdn.test/upload.png')
        self.assertEqual(len(calls),1)


if __name__=='__main__':unittest.main()
