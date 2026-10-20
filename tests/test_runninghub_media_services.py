"""RunningHub 媒体出入的现有路径、解析及落盘合同。"""
import os
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch
import urllib.parse

from backend import generation_output_service as output
from backend import provider_media_transfer as transfer
from backend import runninghub_protocol as protocol


class ProtocolTests(unittest.TestCase):
    def rewrite(self, value):
        return protocol.rewrite_runninghub_file_url(value, urllib=urllib,
            RUNNINGHUB_FILE_HOST_REWRITES={'old.test': 'new.test'})

    def extract(self, value):
        return protocol.runninghub_extract_outputs(value, rewrite_runninghub_file_url=self.rewrite)

    def test_extension_prefers_url_over_content_type(self):
        self.assertEqual(protocol.runninghub_output_ext('https://x/a.JPEG?x=.mp4#f', 'video/mp4'), 'jpeg')
        self.assertEqual(protocol.runninghub_output_ext('x.MKV#f', 'image/jpeg'), 'mkv')

    def test_extension_content_type_priority_and_default(self):
        for content_type, expected in [('video/mp4', 'mp4'), ('video/webm', 'webm'),
                ('video/quicktime', 'mov'), ('audio/mpeg', 'mp3'), ('audio/wav', 'wav'),
                ('audio/ogg', 'ogg'), ('image/webp', 'webp'), ('image/jpeg', 'jpg'),
                ('audio/flac', 'png'), ('', 'png')]:
            with self.subTest(content_type=content_type):
                self.assertEqual(protocol.runninghub_output_ext('https://x/no', content_type), expected)

    def test_rewrite_case_query_fragment_and_parse_failure(self):
        self.assertEqual(self.rewrite('https://OLD.TEST/a?x=1#f'), 'https://new.test/a?x=1#f')
        for value in ['', 'http://[bad', '/assets/input/a.png', 'https://unknown.test/a']:
            self.assertEqual(self.rewrite(value), value)
        self.assertEqual(self.rewrite(None), '')

    def test_output_array_priority_and_duplicates(self):
        value = {'outputs': ['a', 'a', ''], 'results': ['ignored'], 'url': 'root'}
        self.assertEqual(self.extract(value), ['a', 'a', ''])
        self.assertEqual(self.extract({'outputs': None, 'results': ['r'], 'files': ['f']}), ['r'])

    def test_empty_first_array_falls_back_to_root_without_next_array(self):
        self.assertEqual(self.extract({'outputs': [], 'results': ['ignored'], 'url': 'root'}), ['root'])
        self.assertEqual(self.extract({'outputs': [], 'results': ['ignored']}), [])
        self.assertEqual(self.extract({'file_url': 'no-root-fallback'}), [])

    def test_output_url_field_priority_and_truthiness(self):
        self.assertEqual(self.extract([{'fileUrl': '', 'file_url': 'first', 'url': 'second'},
            {'downloadUrl': 'third', 'download_url': 'fourth'}, {'download_url': 'fifth'},
            {'fileUrl': [0, '', None, 'https://old.test/a', 'again', 'again', 7]}, 12, None]),
            ['first', 'third', 'fifth', 'https://new.test/a', 'again', 'again', '7'])

    def test_output_rewrite_reads_only_selected_values_in_order(self):
        seen = []
        result = protocol.runninghub_extract_outputs({'files': ['a', {'url': ['b', '', 'a']}], 'data': ['ignored']},
            rewrite_runninghub_file_url=lambda value: seen.append(value) or value)
        self.assertEqual(result, ['a', 'b', 'a'])
        self.assertEqual(seen, ['a', 'b', 'a'])


class LocalPathTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.input = self.root / 'input'; self.input.mkdir()
        self.output = self.root / 'output'; self.output.mkdir()
        (self.input / '中文 image.png').write_bytes(b'input')
        (self.output / 'result.mp4').write_bytes(b'output')
        self.delegated = []

    def local(self, value):
        return transfer.runninghub_local_asset_path(value, urllib=urllib, OUTPUT_INPUT_DIR=str(self.input),
            OUTPUT_OUTPUT_DIR=str(self.output), output_file_from_url=lambda value: self.delegated.append(value) or 'delegated')

    def test_input_alias_and_decoding_before_file_lookup(self):
        for value in ['/input/%E4%B8%AD%E6%96%87%20image.png?q=1', '/assets/input/中文 image.png']:
            self.assertEqual(Path(self.local(value)).read_bytes(), b'input')
        self.assertEqual(Path(self.local('/assets/output/result.mp4?x')).read_bytes(), b'output')

    def test_prefix_is_checked_before_decoding_and_fallback_is_untouched(self):
        self.assertIsNone(self.local('/%69nput/中文 image.png'))
        self.assertEqual(self.local('/assets/%69nput/a?x'), 'delegated')
        self.assertEqual(self.local('/output/a?x'), 'delegated')
        self.assertEqual(self.delegated, ['/assets/%69nput/a?x', '/output/a?x'])

    def test_missing_empty_remote_and_traversal(self):
        for value in ['', None, '/input/', '/input/missing', '/input/../outside',
                '/input/%2e%2e/outside', 'https://x/input/a']:
            with self.subTest(value=value): self.assertIsNone(self.local(value))

    def test_windows_commonpath_error_is_not_swallowed(self):
        with patch.object(transfer.os.path, 'commonpath', side_effect=ValueError('different drive')):
            with self.assertRaisesRegex(ValueError, 'different drive'): self.local('/input/a')


class StoreTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name); self.events = []
        owner = self

        class Client:
            async def get(self, value, **kwargs):
                owner.events.append(['get', value, kwargs]); return owner.response

        self.client = Client()
        self.response = SimpleNamespace(is_success=True, headers={'content-type': 'audio/mpeg'}, content=b'fixture')
        self.ports = {'rewrite_runninghub_file_url': lambda value: self.event('rewrite', value, 'https://new.test/file' if value == 'remote' else value),
            'runninghub_output_ext': lambda value, ct: self.event('ext', [value, ct], 'mp3'),
            'uuid': SimpleNamespace(uuid4=lambda: self.event('uuid', None, SimpleNamespace(hex='a'*32))),
            'output_path_for': lambda name, category: self.event('path', [name, category], str(self.root/name)),
            'output_url_for': lambda name, category: self.event('url', [name, category], '/assets/output/'+name)}

    def event(self, name, value, result):
        self.events.append([name, value]); return result

    async def store(self, value):
        return await output.runninghub_store_remote_output(self.client, value, **self.ports)

    async def test_success_order_and_real_bytes(self):
        result = await self.store('remote')
        self.assertEqual(result, '/assets/output/rh_aaaaaaaaaaaa.mp3')
        self.assertEqual((self.root/'rh_aaaaaaaaaaaa.mp3').read_bytes(), b'fixture')
        self.assertEqual([row[0] for row in self.events], ['rewrite', 'get', 'ext', 'uuid', 'path', 'url'])
        self.assertEqual(self.events[1], ['get', 'https://new.test/file', {'follow_redirects': True}])

    async def test_non_http_returns_rewritten_value_without_io(self):
        for value in ['', None, '/assets/output/a', 'HTTP://x/a']:
            self.events.clear(); self.assertEqual(await self.store(value), value)
            self.assertEqual(self.events, [['rewrite', value]])

    async def test_non_success_has_no_extension_uuid_or_write(self):
        self.response.is_success = False
        self.assertEqual(await self.store('remote'), 'https://new.test/file')
        self.assertEqual([row[0] for row in self.events], ['rewrite', 'get'])
        self.assertEqual(list(self.root.iterdir()), [])

    async def test_network_error_propagates(self):
        async def failure(*args, **kwargs): raise OSError('network')
        self.client.get = failure
        with self.assertRaisesRegex(OSError, 'network'): await self.store('remote')
        self.assertEqual([row[0] for row in self.events], ['rewrite'])

    async def test_content_read_failure_leaves_created_file(self):
        class Broken:
            is_success = True
            headers = {}
            @property
            def content(self): raise OSError('read')
        self.response = Broken()
        with self.assertRaisesRegex(OSError, 'read'): await self.store('remote')
        self.assertEqual((self.root/'rh_aaaaaaaaaaaa.mp3').read_bytes(), b'')
        self.assertEqual([row[0] for row in self.events], ['rewrite', 'get', 'ext', 'uuid', 'path'])

    async def test_url_error_keeps_written_bytes(self):
        self.ports['output_url_for'] = lambda *_: (_ for _ in ()).throw(ValueError('url'))
        with self.assertRaisesRegex(ValueError, 'url'): await self.store('remote')
        self.assertEqual((self.root/'rh_aaaaaaaaaaaa.mp3').read_bytes(), b'fixture')


if __name__ == '__main__':
    unittest.main()
