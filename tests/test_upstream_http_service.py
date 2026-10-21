"""上游共用重试的次数、等待、异常、日志与请求参数合同。"""

import asyncio
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.upstream_http_service import httpx_request_with_transient_retries


class RetryTests(unittest.IsolatedAsyncioTestCase):
    async def execute(self, replies, attempts=2, delay=1.2, kwargs=None, method='GET', **ports):
        events = []
        position = 0

        async def request(given_method, url, **given):
            nonlocal position
            events.append(('request', given_method, url, given))
            reply = replies[min(position, len(replies) - 1)]
            position += 1
            if isinstance(reply, BaseException):
                raise reply
            return reply

        async def sleep(duration):
            events.append(('sleep', duration))

        deps = dict(asyncio=SimpleNamespace(sleep=sleep), httpx=httpx,
                    write_diagnostic=lambda value: events.append(('log', value)),
                    redact_url_for_log=lambda value: 'safe-url', redact_log_text=lambda value: 'safe-error')
        deps.update(ports)
        try:
            result = await httpx_request_with_transient_retries(
                SimpleNamespace(request=request), method, 'fixture-url', attempts, delay, kwargs or {}, **deps)
        except BaseException as error:
            error.fixture_events = events
            raise
        return result, events

    async def test_success_keeps_response_identity_and_forwarded_kwargs(self):
        response = SimpleNamespace(status_code=201)
        kwargs = {'headers': {'X-Fixture': 'yes'}, 'json': {'prompt': '中文'}, 'timeout': 7,
                  'asyncio': 'request-key', 'httpx': 'request-key', 'kwargs': 'request-key'}
        result, events = await self.execute([response], kwargs=kwargs, method='POST')
        self.assertIs(result, response)
        self.assertEqual(events, [('request', 'POST', 'fixture-url', kwargs)])

    async def test_retryable_status_set_retries_once(self):
        for code in (502, 503, 504, 520, 522, 524):
            with self.subTest(code=code):
                success = SimpleNamespace(status_code=200)
                result, events = await self.execute([SimpleNamespace(status_code=code), success])
                self.assertIs(result, success)
                self.assertEqual([row[0] for row in events], ['request', 'sleep', 'request'])
                self.assertEqual(events[1], ('sleep', 1.2))

    async def test_other_statuses_are_returned_without_retry(self):
        for code in (200, 302, 400, 401, 404, 408, 429, 500, 501):
            with self.subTest(code=code):
                response = SimpleNamespace(status_code=code)
                result, events = await self.execute([response], attempts=4)
                self.assertIs(result, response)
                self.assertEqual(len(events), 1)

    async def test_final_retryable_status_returns_response(self):
        response = SimpleNamespace(status_code=503)
        result, events = await self.execute([response], attempts=3, delay=.25)
        self.assertIs(result, response)
        self.assertEqual([row for row in events if row[0]=='sleep'], [('sleep', .25), ('sleep', .5)])
        self.assertFalse(any(row[0]=='log' for row in events))

    async def test_attempt_values_are_coerced_and_clamped(self):
        for value, count in ((None,1), (0,1), (-3,1), ('3',3), (2.8,2), (True,1)):
            with self.subTest(value=value):
                _, events = await self.execute([SimpleNamespace(status_code=503)], attempts=value)
                self.assertEqual(sum(row[0]=='request' for row in events), count)

    async def test_invalid_attempts_fail_before_request(self):
        with self.assertRaises(ValueError) as caught:
            await self.execute([SimpleNamespace(status_code=200)], attempts='bad')
        self.assertEqual(caught.exception.fixture_events, [])

    async def test_each_transient_transport_error_is_retried(self):
        for kind in (httpx.RemoteProtocolError, httpx.ReadError, httpx.ConnectError,
                     httpx.ConnectTimeout, httpx.ReadTimeout, httpx.PoolTimeout):
            with self.subTest(kind=kind.__name__):
                result, events = await self.execute([kind('temporary'), SimpleNamespace(status_code=200)])
                self.assertEqual(result.status_code, 200)
                self.assertEqual([row[0] for row in events], ['request', 'log', 'sleep', 'request'])

    async def test_last_transport_error_is_same_instance_without_final_log_or_sleep(self):
        error = httpx.ReadError('final')
        with self.assertRaises(httpx.ReadError) as caught:
            await self.execute([error], attempts=2)
        self.assertIs(caught.exception, error)
        self.assertEqual([row[0] for row in error.fixture_events], ['request','log','sleep','request'])

    async def test_nontransient_transport_and_other_errors_propagate(self):
        for error in (httpx.WriteError('write'), httpx.WriteTimeout('write'), httpx.UnsupportedProtocol('scheme'), ValueError('invalid')):
            with self.subTest(kind=type(error).__name__):
                with self.assertRaises(type(error)) as caught:
                    await self.execute([error], attempts=3)
                self.assertIs(caught.exception, error)
                self.assertEqual(len(error.fixture_events), 1)

    async def test_request_cancellation_propagates(self):
        error = asyncio.CancelledError()
        with self.assertRaises(asyncio.CancelledError) as caught:
            await self.execute([error], attempts=3)
        self.assertIs(caught.exception, error)
        self.assertEqual(len(error.fixture_events), 1)

    async def test_sleep_cancellation_propagates_before_next_request(self):
        async def cancel(delay):
            raise asyncio.CancelledError()
        with self.assertRaises(asyncio.CancelledError) as caught:
            await self.execute([SimpleNamespace(status_code=503)], asyncio=SimpleNamespace(sleep=cancel))
        self.assertEqual(len(caught.exception.fixture_events), 1)

    async def test_mixed_status_and_exception_use_shared_linear_backoff(self):
        _, events = await self.execute([SimpleNamespace(status_code=503), httpx.ConnectError('transient'),
                                        SimpleNamespace(status_code=200)], attempts=3, delay=.5)
        self.assertEqual([row[0] for row in events], ['request','sleep','request','log','sleep','request'])
        self.assertEqual([row[1] for row in events if row[0]=='sleep'], [.5, 1.])
        self.assertIn('retry 3/3', events[3][1])

    async def test_logging_redacts_then_truncates_exception(self):
        calls = []
        error = httpx.ConnectError('fixture-private')
        def url(value):
            calls.append(('url', value)); return 'clean-url'
        def text(value):
            calls.append(('error', value)); return 'x'*350
        _, events = await self.execute([error,SimpleNamespace(status_code=200)],
                                       redact_url_for_log=url, redact_log_text=text)
        self.assertEqual(calls, [('url','fixture-url'),('error',error)])
        self.assertEqual(events[1], ('log', '[HTTPX-RETRY] GET clean-url transient error: '+'x'*300+'; retry 2/2'))

    async def test_diagnostic_failure_propagates_before_wait(self):
        def fail(message):
            raise LookupError('diagnostic')
        with self.assertRaises(LookupError) as caught:
            await self.execute([httpx.ConnectError('temporary')], write_diagnostic=fail)
        self.assertEqual([row[0] for row in caught.exception.fixture_events], ['request'])

    async def test_retry_keeps_same_mutable_payload_object(self):
        payload = {'prompt': 'same body'}
        _, events = await self.execute([SimpleNamespace(status_code=503)], kwargs={'json':payload}, method='POST')
        calls = [row for row in events if row[0]=='request']
        self.assertEqual(len(calls), 2)
        self.assertTrue(all(row[3]['json'] is payload for row in calls))


if __name__ == '__main__':
    unittest.main()
