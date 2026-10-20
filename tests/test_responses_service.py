import ast
import json
from pathlib import Path
import unittest
from unittest.mock import AsyncMock

import httpx
from fastapi import HTTPException

from backend import responses_service as service


class ResponsesServiceTests(unittest.IsolatedAsyncioTestCase):
    def background_dependencies(self, fallback):
        return dict(
            RESPONSES_POLL_INTERVAL=0, RESPONSES_POLL_MAX_SECONDS=2,
            RESPONSES_REJECT_STATUSES={400, 404, 405, 415, 422},
            _responses_wrap=service._responses_wrap,
            log_net_error=lambda *args: None,
            post_openai_responses_stream=fallback,
            upstream_response_error_summary=lambda *args, **kwargs: 'mock failure',
            write_diagnostic=lambda *args: None,
        )

    async def test_background_task_polls_original_receipt_without_resubmitting(self):
        calls = []

        def handle(request):
            calls.append((request.method, str(request.url)))
            if request.method == 'POST':
                self.assertTrue(json.loads(request.content)['background'])
                return httpx.Response(200, json={'id': 'receipt-1', 'status': 'queued'})
            return httpx.Response(200, json={'id': 'receipt-1', 'status': 'completed', 'output': []})

        fallback = AsyncMock()
        # Execute only the public entry definition, without importing app configuration.
        tree = ast.parse((Path(__file__).resolve().parents[1] / 'main.py').read_text(encoding='utf-8'))
        entry = next(node for node in tree.body if isinstance(node, ast.AsyncFunctionDef)
                     and node.name == 'post_openai_responses')
        namespace = {'responses_service': service, **self.background_dependencies(fallback)}
        exec(compile(ast.Module(body=[entry], type_ignores=[]), 'main-entry', 'exec'), namespace)
        async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
            response = await namespace['post_openai_responses'](client, 'https://mock.invalid/responses', {}, {})
        self.assertEqual(response.json()['id'], 'receipt-1')
        self.assertEqual([method for method, _ in calls], ['POST', 'GET'])
        self.assertTrue(calls[1][1].endswith('/receipt-1'))
        fallback.assert_not_awaited()

    async def test_server_failure_does_not_submit_stream_fallback(self):
        fallback = AsyncMock()
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(503))) as client:
            response = await service.post_openai_responses(client, 'https://mock.invalid/responses', {}, {},
                                                          **self.background_dependencies(fallback))
        self.assertEqual(response.status_code, 503)
        fallback.assert_not_awaited()

    async def test_rejected_background_delegates_once_with_original_body(self):
        body = {'model': 'mock', 'input': 'test'}
        fallback = AsyncMock(return_value='stream result')
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(422))) as client:
            response = await service.post_openai_responses(client, 'https://mock.invalid/responses', {}, body,
                                                          **self.background_dependencies(fallback))
        self.assertEqual(response, 'stream result')
        self.assertEqual(body, {'model': 'mock', 'input': 'test'})
        self.assertEqual(fallback.await_count, 1)
        self.assertIs(fallback.await_args.args[3], body)

    async def test_stream_retains_partial_image_when_completed_event_has_no_image(self):
        events = [{'partial_image_b64': 'mock-image'}, {'type': 'response.completed',
                  'response': {'id': 'receipt-2', 'output': []}}]
        content = ''.join('data: ' + json.dumps(event) + '\n\n' for event in events)
        async with httpx.AsyncClient(transport=httpx.MockTransport(
            lambda r: httpx.Response(200, headers={'content-type': 'text/event-stream'}, content=content)
        )) as client:
            response = await service.post_openai_responses_stream(
                client, 'https://mock.invalid/responses', {}, {}, HTTPException=HTTPException,
                _responses_wrap=service._responses_wrap, extract_images=lambda value: [],
                image_payload_from_string=lambda value, **kw: {'type': 'b64', 'value': value} if value else None,
                write_diagnostic=lambda *args: None,
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['output'][0]['result'], 'mock-image')

    async def test_local_reference_falls_back_to_inline_data_if_upload_fails(self):
        upload = AsyncMock(side_effect=HTTPException(503, 'mock unavailable'))
        result = await service.responses_input_image_url(
            '/assets/ref.png', HTTPException=HTTPException,
            openai_video_proxy_public_reference_url=AsyncMock(),
            output_file_from_url=lambda value: '/isolated/ref.png',
            reference_to_data_url=lambda *args, **kw: 'data:image/png;base64,bW9jaw==',
            upload_local_video_to_cloud=upload, write_diagnostic=lambda *args: None,
        )
        self.assertEqual(result, 'data:image/png;base64,bW9jaw==')
        upload.assert_awaited_once_with('/assets/ref.png')

    def test_output_parser_accepts_markdown_and_size_adapter_preserves_square(self):
        self.assertEqual(service.responses_output_text_image({'output_text': '![mock](https://mock.invalid/a.png)'}),
                         {'type': 'url', 'value': 'https://mock.invalid/a.png'})
        self.assertEqual(service.responses_proxy_tool_size('1536x1024'), '1024x1536')
        self.assertEqual(service.responses_proxy_tool_size('1024x1024'), '1024x1024')
