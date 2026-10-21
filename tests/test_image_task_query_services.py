"""图片原任务查询和轮询边界；使用可控时钟，不访问网络。"""
import asyncio
from types import SimpleNamespace
import unittest

from fastapi import HTTPException

from backend import image_provider_service as service
from backend import upstream_public_policy as policy
from backend.remote_task_protocol import image_task_data, image_task_status


class Clock:
    def __init__(self):
        self.now = 0.0
        self.sleeps = []

    def monotonic(self):
        return self.now

    async def sleep(self, delay):
        self.sleeps.append(delay)
        self.now += delay


def url(provider=None, task_id='task', **overrides):
    deps = dict(AI_BASE_URL='https://default.test', is_tudou_async_image_mode=lambda p: False,
                normalize_image_request_mode=lambda mode: mode or '', is_apimart_provider=lambda p: False)
    deps.update(overrides)
    return service.image_task_url_for_provider(provider, task_id, **deps)


def failure(payload, **overrides):
    deps = dict(image_task_data=image_task_data, provider_error_summary=lambda text, fallback: text or fallback)
    deps.update(overrides)
    return policy.image_task_fail_reason(payload, **deps)


def polling(clock, fetch, **overrides):
    deps = dict(is_apimart_provider=lambda p: False, is_tudou_async_image_mode=lambda p: False,
                TUDOU_ASYNC_IMAGE_TASK_TIMEOUT=10, APIMART_IMAGE_TASK_TIMEOUT=8, IMAGE_TASK_TIMEOUT=6,
                TUDOU_ASYNC_IMAGE_POLL_INTERVAL=3, APIMART_IMAGE_POLL_INTERVAL=2, IMAGE_POLL_INTERVAL=1,
                TUDOU_ASYNC_IMAGE_INITIAL_POLL_DELAY=4, APIMART_IMAGE_INITIAL_POLL_DELAY=2,
                time=clock, asyncio=clock, fetch_image_task_payload=fetch, image_task_status=image_task_status,
                extract_image=lambda payload: None, HTTPException=HTTPException,
                IMAGE_TASK_SUCCESS_STATUSES={'SUCCESS', 'SUCCEEDED'}, IMAGE_TASK_FAILED_STATUSES={'FAILED'},
                image_task_fail_reason=failure, provider_error_summary=lambda payload: 'last',
                _safe_upstream_text=lambda value, limit: str(value)[:limit])
    deps.update(overrides)
    return deps


class ImageTaskQueryRuleTests(unittest.TestCase):
    def test_url_base_suffix_and_default(self):
        self.assertEqual(url(), 'https://default.test/v1/images/tasks/task')
        self.assertEqual(url({'base_url': 'https://host.test/v1///'}, 'a/b?x'),
                         'https://host.test/v1/images/tasks/a/b?x')

    def test_tudou_url_precedes_proxy_and_apimart(self):
        self.assertEqual(url({'base_url': 'https://host.test', 'image_request_mode': 'openai-video-proxy'},
                             is_tudou_async_image_mode=lambda p: True, is_apimart_provider=lambda p: True),
                         'https://host.test/v1/tasks/task')

    def test_proxy_url_precedes_apimart(self):
        for base in ('https://host.test', 'https://host.test/v1'):
            self.assertEqual(url({'base_url': base, 'image_request_mode': 'openai-video-proxy'},
                                 is_apimart_provider=lambda p: True), 'https://host.test/v1/videos/task')

    def test_apimart_url_and_missing_base_error(self):
        self.assertEqual(url({'base_url': 'https://host.test/v1'}, is_apimart_provider=lambda p: True),
                         'https://host.test/v1/tasks/task')
        with self.assertRaises(AttributeError):
            url({'other': 'missing base'})

    def test_url_predicate_order_and_short_circuit(self):
        events = []
        result = url({'base_url': 'x'}, is_tudou_async_image_mode=lambda p: events.append('tudou') or False,
                     normalize_image_request_mode=lambda mode: events.append('mode') or 'openai-video-proxy',
                     is_apimart_provider=lambda p: events.append('apimart') or True)
        self.assertEqual(events, ['tudou', 'mode'])
        self.assertEqual(result, 'x/v1/videos/task')

    def test_failure_reason_precedence_and_fallback(self):
        payload = {'message': 'outer', 'data': {'fail_reason': 'first', 'message': 'second', 'error': {'message': 'third'}}}
        self.assertEqual(failure(payload), 'first')
        del payload['data']['fail_reason']
        self.assertEqual(failure(payload), 'second')
        del payload['data']['message']
        self.assertEqual(failure(payload), 'third')
        payload['data']['error'] = []
        self.assertEqual(failure(payload), 'outer')
        self.assertEqual(failure([]), '生图任务失败')

    def test_failure_summary_receives_original_value(self):
        marker = {'reason': 'safe'}
        calls = []
        result = failure({'fail_reason': marker}, provider_error_summary=lambda value, **kw: calls.append((value, kw)) or 'public')
        self.assertIs(calls[0][0], marker)
        self.assertEqual(calls[0][1], {'fallback': '生图任务失败'})
        self.assertEqual(result, 'public')


class ImageTaskQueryExecutionTests(unittest.IsolatedAsyncioTestCase):
    async def test_fetch_forwards_original_client_headers_and_retry_budget(self):
        events = []
        client, provider, headers = object(), {'id': 'fixture'}, {'X-Fixture': 'header'}
        body = {'status': 'RUNNING'}
        class Response:
            def raise_for_status(self):
                events.append('status')
            def json(self):
                events.append('json')
                return body
        async def request(*args, **kw):
            events.append(('request', args, kw))
            return Response()
        result = await service.fetch_image_task_payload(client, 'task', provider,
            image_task_url_for_provider=lambda p, task: events.append(('url', p, task)) or 'fixture-url',
            api_headers=lambda **kw: events.append(('headers', kw)) or headers,
            httpx_request_with_transient_retries=request)
        self.assertIs(result, body)
        self.assertEqual(events, [('url', provider, 'task'), ('headers', {'provider': provider}),
                                  ('request', (client, 'GET', 'fixture-url'), {'attempts': 3, 'headers': headers}),
                                  'status', 'json'])

    async def test_fetch_status_error_prevents_json(self):
        class Response:
            def raise_for_status(self):
                raise LookupError('fixture-status')
            def json(self):
                raise AssertionError('not reached')
        async def request(*args, **kw):
            return Response()
        with self.assertRaisesRegex(LookupError, 'fixture-status'):
            await service.fetch_image_task_payload(object(), 'task', image_task_url_for_provider=lambda *a: 'url',
                api_headers=lambda **kw: {}, httpx_request_with_transient_retries=request)

    async def test_success_returns_original_payload_without_extraction(self):
        clock = Clock()
        body = {'data': {'status': 'succeeded'}}
        async def fetch(*args):
            return body
        def extract(payload):
            raise AssertionError('success status skips extraction')
        result = await service.wait_for_image_task(object(), 'task', **polling(clock, fetch, extract_image=extract))
        self.assertIs(result, body)
        self.assertEqual(clock.sleeps, [])

    async def test_statusless_result_uses_extraction(self):
        clock = Clock()
        body = {'images': ['fixture']}
        async def fetch(*args):
            return body
        result = await service.wait_for_image_task(object(), 'task', **polling(clock, fetch, extract_image=lambda p: 'image'))
        self.assertIs(result, body)

    async def test_statusless_http_extraction_error_keeps_polling(self):
        clock = Clock()
        replies = iter([{}, {'status': 'SUCCESS'}])
        async def fetch(*args):
            return next(replies)
        def extract(payload):
            raise HTTPException(502, 'no-image')
        result = await service.wait_for_image_task(object(), 'task', **polling(clock, fetch, extract_image=extract))
        self.assertEqual(result, {'status': 'SUCCESS'})
        self.assertEqual(clock.sleeps, [1])

    async def test_non_http_extraction_error_propagates(self):
        clock = Clock()
        async def fetch(*args):
            return {}
        def extract(payload):
            raise ValueError('fixture')
        with self.assertRaisesRegex(ValueError, 'fixture'):
            await service.wait_for_image_task(object(), 'task', **polling(clock, fetch, extract_image=extract))
        self.assertEqual(clock.sleeps, [])

    async def test_failure_is_immediate_and_uses_public_summary(self):
        clock = Clock()
        async def fetch(*args):
            return {'data': {'status': 'FAILED', 'error': {'message': 'fixture-failure'}}}
        with self.assertRaises(HTTPException) as captured:
            await service.wait_for_image_task(object(), 'task', **polling(clock, fetch))
        self.assertEqual((captured.exception.status_code, captured.exception.detail), (502, '生图任务失败：fixture-failure'))
        self.assertEqual(clock.sleeps, [])

    async def test_tudou_timeout_and_delay_win_over_apimart(self):
        clock = Clock()
        received = []
        async def fetch(*args):
            received.append(clock.now)
            return {'status': 'SUCCESS'}
        await service.wait_for_image_task(object(), 'task', **polling(clock, fetch,
            is_apimart_provider=lambda p: True, is_tudou_async_image_mode=lambda p: True))
        self.assertEqual(received, [4])
        self.assertEqual(clock.sleeps, [4])

    async def test_apimart_delay_applies_once(self):
        clock = Clock()
        replies = iter([{'status': 'running'}, {'status': 'SUCCESS'}])
        received = []
        async def fetch(*args):
            received.append(clock.now)
            return next(replies)
        await service.wait_for_image_task(object(), 'task', **polling(clock, fetch, is_apimart_provider=lambda p: True))
        self.assertEqual(received, [2, 4])
        self.assertEqual(clock.sleeps, [2, 2])

    async def test_initial_delay_clipped_to_deadline_prevents_fetch(self):
        clock = Clock()
        async def fetch(*args):
            raise AssertionError('deadline reached')
        with self.assertRaises(HTTPException) as captured:
            await service.wait_for_image_task(object(), 'task', **polling(clock, fetch,
                is_tudou_async_image_mode=lambda p: True, TUDOU_ASYNC_IMAGE_TASK_TIMEOUT=2))
        self.assertEqual(captured.exception.status_code, 504)
        self.assertEqual(clock.sleeps, [2])

    async def test_timeout_uses_last_payload_and_clipped_final_sleep(self):
        clock = Clock()
        async def fetch(*args):
            return {'status': 'unknown', 'step': clock.now}
        seen = []
        with self.assertRaises(HTTPException) as captured:
            await service.wait_for_image_task(object(), 'task', **polling(clock, fetch, IMAGE_TASK_TIMEOUT=2.5,
                provider_error_summary=lambda payload: seen.append(payload) or '', _safe_upstream_text=lambda task, limit: 'safe-task'))
        self.assertEqual(clock.sleeps, [1, 1, .5])
        self.assertEqual(seen, [{'status': 'unknown', 'step': 2.0}])
        self.assertEqual(captured.exception.detail, '生图任务超时（已等待 2 秒），task_id=safe-task')

    async def test_fetch_cancellation_is_not_swallowed_or_retried(self):
        clock = Clock()
        async def fetch(*args):
            raise asyncio.CancelledError()
        with self.assertRaises(asyncio.CancelledError):
            await service.wait_for_image_task(object(), 'task', **polling(clock, fetch))
        self.assertEqual(clock.sleeps, [])


if __name__ == '__main__':
    unittest.main()
