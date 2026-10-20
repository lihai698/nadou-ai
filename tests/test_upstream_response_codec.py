import ast
import json
from pathlib import Path
import unittest

from fastapi import HTTPException
from backend import upstream_response_codec as codec


class UpstreamResponseCodecTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Only execute pure entry definitions and literal hints, never application setup.
        tree = ast.parse((Path(__file__).resolve().parents[1] / 'main.py').read_text(encoding='utf-8'))
        names = {'unwrap_apimart_response', 'text_from_chat_response', 'required_chat_response_text',
                 'text_delta_from_chat_chunk', 'sse_event', 'looks_like_generated_image_url',
                 'looks_like_image_base64', 'image_payload_from_string', 'extract_image_flexible',
                 'extract_images', 'extract_image', 'extract_task_id', 'extract_task_id_from_text',
                 'images_api_unsupported'}
        cls.entries = {'upstream_response_codec': codec, 'HTTPException': HTTPException}
        for node in tree.body:
            if isinstance(node, ast.Assign):
                for target in node.targets:
                    if isinstance(target, ast.Name) and target.id in {
                        'IMAGE_OUTPUT_KEY_HINTS', 'IMAGE_CONTAINER_KEY_HINTS', 'IMAGE_BASE64_KEY_HINTS'
                    }:
                        cls.entries[target.id] = ast.literal_eval(node.value)
        definitions = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
        if len(definitions) != len(names):
            raise AssertionError('Missing production codec entry')
        exec(compile(ast.Module(body=definitions, type_ignores=[]), 'codec-main-entries', 'exec'), cls.entries)

    def test_nested_images_are_deduplicated_and_preserve_order(self):
        url = 'https://mock.invalid/first.png'
        data = {'data': {'result': {'images': [{'url': url}, {'url': [url, 'https://mock.invalid/second.webp']} ]}}}
        images = self.entries['extract_images'](data)
        self.assertEqual([item['value'] for item in images], [url, 'https://mock.invalid/second.webp'])

    def test_native_inline_and_markdown_data_images_keep_mime(self):
        data = {'candidates': [{'content': {'parts': [
            {'inlineData': {'data': 'mock-one', 'mimeType': 'image/jpeg'}},
            {'text': '![mock](data:image/webp;base64,bW9jaw==)'},
        ]}}]}
        images = self.entries['extract_images'](data)
        self.assertEqual([(item['value'], item['mime_type']) for item in images],
                         [('mock-one', 'image/jpeg'), ('bW9jaw==', 'image/webp')])

    def test_recursive_flexible_lookup_and_task_receipts_use_real_entries(self):
        self.assertEqual(self.entries['extract_image_flexible']({'results': [{'outputs': {'image_url': 'https://mock.invalid/a.png'}}]})['value'],
                         'https://mock.invalid/a.png')
        self.assertEqual(self.entries['extract_task_id']({'data': [{'data': {'taskId': 'receipt-original'}}]}),
                         'receipt-original')
        self.assertEqual(self.entries['extract_task_id_from_text']('query task_id: receipt-original'), 'receipt-original')

    def test_chat_wrapper_and_text_parts_are_normalized(self):
        data = {'code': 200, 'data': {'choices': [{'message': {'content': [{'text': '你好'}, {'content': '世界'}]}}]}}
        self.assertEqual(self.entries['required_chat_response_text'](data), '你好\n世界')
        self.assertEqual(self.entries['text_delta_from_chat_chunk']({'choices': [{'delta': {'content': [{'text': 'a'}, {'text': 'b'}]}}]}), 'ab')

    def test_empty_chat_and_unrecognized_images_remain_errors(self):
        for name, data in [('required_chat_response_text', {}), ('extract_images', {'data': []})]:
            with self.subTest(name=name), self.assertRaises(HTTPException) as caught:
                self.entries[name](data)
            self.assertEqual(caught.exception.status_code, 502)

    def test_sse_preserves_unicode_and_event_boundary(self):
        output = self.entries['sse_event']({'text': '中文'})
        self.assertTrue(output.startswith('data: ')); self.assertTrue(output.endswith('\n\n'))
        self.assertEqual(json.loads(output[6:]), {'text': '中文'})
