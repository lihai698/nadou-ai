import ast
import asyncio
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from backend import gemini_cli_service as service


class FakeProcess:
    def __init__(self, returncode=0):
        self.returncode = returncode
        self.killed = False

    async def communicate(self):
        return b'{"response":"mock reply"}', b''

    def kill(self):
        self.killed = True

    async def wait(self):
        self.returncode = 1


class GeminiCliServiceTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        tree = ast.parse((Path(__file__).resolve().parents[1] / 'main.py').read_text(encoding='utf-8'))
        names = {node.name for node in ast.parse(Path(service.__file__).read_text(encoding='utf-8')).body
                 if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))}
        definitions = [node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
                       and node.name in names and not node.decorator_list]
        self.e = dict(gemini_cli_service=service, HTTPException=HTTPException, BASE_DIR='.',
                      GEMINI_CLI_DEFAULT_TIMEOUT=30,
                      gemini_cli_executable=lambda: 'mock-cli',
                      codex_decode_output=lambda out, err: (out.decode(), err.decode()),
                      safe_cli_executable_name=lambda value: 'mock-cli', safe_cli_public_text=lambda *args: 'safe error',
                      write_diagnostic=lambda *args: None, jimeng_extract_json=lambda value: {},
                      MAX_HISTORY_MESSAGES=2, model_dump_compat=lambda value: value,
                      ONLINE_IMAGE_REFERENCE_MAX=2)
        exec(compile(ast.Module(body=definitions, type_ignores=[]), 'gemini-main-entries', 'exec'), self.e)
        # No environment, executable discovery or credentials are used in these tests.
        # Decorated management routes are tested through real main in test_stage6_cli_output.
        self.e['gemini_cli_executable'] = lambda: 'mock-cli'
        self.e['gemini_cli_timeout'] = lambda: 30

    async def test_real_entry_uses_mock_process_and_preserves_text_only_command(self):
        spawn = AsyncMock(return_value=FakeProcess())
        with patch.object(service.asyncio, 'create_subprocess_exec', spawn):
            result = await self.e['run_gemini_cli']('mock prompt', model='mock-model', allow_tools=False)
        self.assertEqual(result['text'], 'mock reply')
        args = spawn.await_args.args
        self.assertEqual(args[0], 'mock-cli')
        self.assertIn('mock-model', args); self.assertIn('mock prompt', args)
        self.assertNotIn('--approval-mode', args)
        self.assertNotIn('--dangerously-skip-permissions', args)

    async def test_timeout_kills_and_reaps_only_the_mock_child(self):
        process = FakeProcess(returncode=None)

        async def timeout(awaitable, **kwargs):
            await awaitable
            raise asyncio.TimeoutError()

        with patch.object(service.asyncio, 'create_subprocess_exec', AsyncMock(return_value=process)), \
             patch.object(service.asyncio, 'wait_for', timeout):
            with self.assertRaises(HTTPException) as caught:
                await self.e['run_gemini_cli']('mock prompt')
        self.assertEqual(caught.exception.status_code, 504)
        self.assertTrue(process.killed); self.assertEqual(process.returncode, 1)

    def test_recursive_cli_text_parser_keeps_nested_output(self):
        self.assertEqual(self.e['gemini_cli_text_from_raw']([{'response': 'first'}, {'items': [{'text': 'second'}]}]),
                         'first\nsecond')
        raw, text = self.e['gemini_cli_parse_stdout']('{"response":"reply"}')
        self.assertEqual(raw, {'response': 'reply'}); self.assertEqual(text, 'reply')

    def test_chat_prompt_keeps_recent_supported_roles_and_media_without_loading_files(self):
        payload = SimpleNamespace(system_prompt='system', message='current', images=['/assets/mock.png'])
        prompt, images = self.e['gemini_cli_chat_prompt'](payload, [
            {'role': 'user', 'content': 'too old'}, {'role': 'tool', 'content': 'omit'},
            {'role': 'assistant', 'content': 'recent'}])
        self.assertNotIn('too old', prompt); self.assertNotIn('omit', prompt)
        self.assertIn('recent', prompt); self.assertIn('current', prompt)
        self.assertEqual(images, [{'url': '/assets/mock.png'}])

    def test_reference_limit_and_orientation_instructions_are_preserved(self):
        refs, temps = self.e['gemini_cli_reference_note']([{'url': 'a'}, {'url': 'b'}, {'url': 'c'}])
        self.assertEqual(refs, ['a', 'b']); self.assertEqual(temps, [])
        self.assertIn('竖版', self.e['gemini_cli_image_size_instruction']('1024x1536'))
        self.assertIn('4K', self.e['gemini_cli_image_size_instruction']('', 'mock-4k'))
