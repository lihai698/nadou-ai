"""模型目录只使用模拟 CLI，不读取个人配置或请求供应商。"""

import asyncio
import json
import unittest
from unittest.mock import AsyncMock, patch

from backend.codex_models import list_codex_models


class FakeStdin:
    def __init__(self):
        self.messages = []

    def write(self, data):
        self.messages.append(json.loads(data))

    async def drain(self):
        pass


class FakeProcess:
    def __init__(self, messages, eof=True):
        self.stdin = FakeStdin()
        self.stdout = asyncio.StreamReader()
        self.stderr = asyncio.StreamReader()
        self.stderr.feed_eof()
        self.returncode = None
        self.killed = False
        for message in messages:
            self.stdout.feed_data((json.dumps(message) + '\n').encode())
        if eof:
            self.stdout.feed_eof()

    def kill(self):
        self.killed = True
        self.returncode = 0

    async def wait(self):
        return self.returncode


class CodexModelTests(unittest.IsolatedAsyncioTestCase):
    async def test_live_catalog_pagination_filters_hidden_and_deduplicates(self):
        proc = FakeProcess([
            {'id': 1, 'result': {}},
            {'method': 'notification', 'params': {}},
            {'id': 2, 'result': {'data': [
                {'model': 'gpt-first'}, {'model': 'hidden-model', 'hidden': True},
            ], 'nextCursor': 'second'}},
            {'id': 3, 'result': {'data': [
                {'model': 'gpt-first'}, {'model': 'gpt-second'}, {'model': ''},
            ], 'nextCursor': None}},
        ])
        with patch('backend.codex_models.asyncio.create_subprocess_exec', new=AsyncMock(return_value=proc)) as spawn:
            models = await list_codex_models('codex', cwd='.', timeout=1)
        self.assertIn('model_provider="openai"', spawn.call_args.args)
        self.assertEqual(models, ['gpt-first', 'gpt-second'])
        self.assertEqual([m['method'] for m in proc.stdin.messages],
                         ['initialize', 'initialized', 'model/list', 'model/list'])
        self.assertEqual(proc.stdin.messages[-1]['params']['cursor'], 'second')
        self.assertFalse(proc.stdin.messages[2]['params']['includeHidden'])
        self.assertTrue(proc.killed)

    async def test_cli_error_is_reported_without_secret_or_default_models(self):
        proc = FakeProcess([
            {'id': 1, 'result': {}},
            {'id': 2, 'error': {'code': -1, 'message': 'token=private-secret'}},
        ])
        with patch('backend.codex_models.asyncio.create_subprocess_exec', new=AsyncMock(return_value=proc)):
            with self.assertRaises(RuntimeError) as error:
                await list_codex_models('codex', cwd='.', timeout=1)
        self.assertNotIn('private-secret', str(error.exception))
        self.assertTrue(proc.killed)

    async def test_timeout_terminates_owned_process(self):
        proc = FakeProcess([], eof=False)
        with patch('backend.codex_models.asyncio.create_subprocess_exec', new=AsyncMock(return_value=proc)):
            with self.assertRaises(asyncio.TimeoutError):
                await list_codex_models('codex', cwd='.', timeout=0.01)
        self.assertTrue(proc.killed)

    async def test_empty_catalog_is_failure(self):
        proc = FakeProcess([{'id': 1, 'result': {}}, {'id': 2, 'result': {'data': []}}])
        with patch('backend.codex_models.asyncio.create_subprocess_exec', new=AsyncMock(return_value=proc)):
            with self.assertRaises(RuntimeError):
                await list_codex_models('codex', cwd='.', timeout=1)

    async def test_both_management_routes_use_catalog(self):
        import main
        with patch.object(main, 'codex_status', new=AsyncMock(return_value={'installed': True})), \
             patch.object(main, 'list_codex_models', new=AsyncMock(return_value=['gpt-first', 'gpt-second'])):
            payload = main.TestConnectionPayload(provider_id='codex', protocol='codex')
            connection = await main.test_provider_connection(payload)
            fetched = await main.fetch_models_from_upstream('', '', 'codex')
        for result in (connection, fetched):
            self.assertEqual(result['chat_models'], ['gpt-first', 'gpt-second'])
            self.assertEqual(result['model_count'], 3)
            self.assertEqual(result['model_source'], 'codex-cli')


if __name__ == '__main__':
    unittest.main()
