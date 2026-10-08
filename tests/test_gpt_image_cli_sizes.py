"""检查真实生图入口的尺寸转换，不请求供应商或读取账号凭据。"""

import unittest
from unittest.mock import AsyncMock, patch

import main


class GptImageCliProxyTests(unittest.TestCase):
    def test_inherits_enabled_windows_proxy_without_changing_parent_environment(self):
        with patch.dict(main.os.environ, {'TASK_TEST_ENV': 'kept'}, clear=True), \
             patch.object(main.os, 'name', 'nt'), \
             patch.object(main.urllib.request, 'getproxies', return_value={'https': 'http://127.0.0.1:10808', 'http': 'http://127.0.0.1:10808'}):
            child = main.gpt_image_2_skill_environment()
            self.assertEqual(child['HTTPS_PROXY'], 'http://127.0.0.1:10808')
            self.assertEqual(child['HTTP_PROXY'], 'http://127.0.0.1:10808')
            self.assertEqual(child['TASK_TEST_ENV'], 'kept')
            self.assertNotIn('HTTPS_PROXY', main.os.environ)

    def test_explicit_process_proxy_takes_precedence(self):
        with patch.dict(main.os.environ, {'HTTPS_PROXY': 'http://explicit.example:8080'}, clear=True), \
             patch.object(main.os, 'name', 'nt'), \
             patch.object(main.urllib.request, 'getproxies', return_value={'https': 'http://system.example:8080'}):
            child = main.gpt_image_2_skill_environment()
            self.assertEqual(child['HTTPS_PROXY'], 'http://explicit.example:8080')


class GptImageCliSizeTests(unittest.TestCase):
    def test_error_keeps_upstream_rejection_detail(self):
        error = '{"ok":false,"error":{"message":"HTTP 400","detail":"The model is not supported for this account."}}'
        self.assertIn('not supported for this account', main.gpt_image_2_skill_failure_message(error))

    def test_one_k_is_explicit_pixels_supported_by_helper(self):
        for provider in ('codex', 'openai'):
            with self.subTest(provider=provider):
                self.assertEqual(main.gpt_image_2_skill_size_arg('1K', provider=provider), '1024x1024')

    def test_explicit_dimensions_keep_orientation_and_override_prompt(self):
        for size in ('1024x1536', '1536x1024', '1024x2048', '2048x1024', '720x1280'):
            with self.subTest(size=size):
                self.assertEqual(
                    main.gpt_image_2_skill_size_arg(size, prompt='背景里写上4K', provider='codex'), size
                )

    def test_auto_does_not_request_four_k(self):
        self.assertEqual(main.gpt_image_2_skill_size_arg('auto', provider='codex'), 'auto')

    def test_supported_resolution_presets_remain_presets(self):
        for size in ('2K', '4K'):
            with self.subTest(size=size):
                self.assertEqual(main.gpt_image_2_skill_size_arg(size, provider='codex'), size)


class GptImageCliRequestTests(unittest.IsolatedAsyncioTestCase):
    async def test_generation_entry_sends_valid_one_k_dimensions(self):
        process = type('FakeProcess', (), {'returncode': 1})()
        process.communicate = AsyncMock(return_value=(b'', b'fake parameter check failure'))
        with patch.object(main, 'gpt_image_2_skill_executable', return_value='fake-helper'), \
             patch.object(main, 'gpt_image_2_skill_auth_file', return_value=''), \
             patch.object(main, 'gpt_image_2_skill_provider_args', return_value=(['--provider', 'codex'], 'codex')), \
             patch.object(main, 'gpt_image_2_skill_api_key', return_value=''), \
             patch.object(main, 'gpt_image_2_skill_environment', return_value={'HTTPS_PROXY': 'http://proxy.example:8080'}), \
             patch.object(main, 'list_codex_models', new=AsyncMock(return_value=['account-current-model', 'another-model'])), \
             patch.object(main.asyncio, 'create_subprocess_exec', new=AsyncMock(return_value=process)) as spawn:
            with self.assertRaises(main.HTTPException):
                await main.generate_codex_provider_image_via_gpt_image_2_skill('a test drawing', '1024x1024', 'gpt-image-2')
        args = spawn.call_args.args
        self.assertEqual(args[args.index('--size') + 1], '1024x1024')
        self.assertEqual(args[args.index('--model') + 1], 'account-current-model')
        self.assertEqual(spawn.call_args.kwargs['env']['HTTPS_PROXY'], 'http://proxy.example:8080')


if __name__ == '__main__':
    unittest.main()
