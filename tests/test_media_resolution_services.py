"""素材文件回退与远程媒体读取的完整边界；只使用自制临时文件。"""
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import urllib.parse

from fastapi import HTTPException
import requests

from backend import media_storage_service as storage, provider_media_transfer as transfer


class LocalMediaResolutionTests(unittest.TestCase):
    def resolve(self, name, root):
        return storage.local_media_file_by_basename(name, OUTPUT_OUTPUT_DIR=str(root/'output'),
            OUTPUT_INPUT_DIR=str(root/'input'), ASSETS_DIR=str(root/'assets'))

    def test_all_five_roots_keep_priority_until_last_match_is_removed(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            paths=[root/'output',root/'input',root/'assets/output',root/'assets/input',root/'assets/library']
            for folder in paths:folder.mkdir(parents=True);(folder/'中文.png').write_bytes(b'fixture')
            for folder in paths:
                self.assertEqual(self.resolve('中文.png',root),str(folder/'中文.png'))
                (folder/'中文.png').unlink()
            self.assertIsNone(self.resolve('中文.png',root))

    def test_unquote_precedes_basename_and_keeps_same_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'output').mkdir();target=root/'output/中文.png';target.write_bytes(b'fixture')
            for name in ('中文.png','folder/中文.png','folder%2F%E4%B8%AD%E6%96%87.png','..%2F中文.png'):
                self.assertEqual(self.resolve(name,root),str(target))

    def test_empty_missing_directory_and_query_are_not_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'output/directory.png').mkdir(parents=True)
            (root/'output/a.png').write_bytes(b'fixture')
            for name in (None,'','folder/','missing.png','directory.png','a.png?x=1'):
                self.assertIsNone(self.resolve(name,root),name)

    def test_commonpath_rejection_skips_isfile(self):
        with patch.object(storage.os.path,'commonpath',return_value='different-root'),patch.object(storage.os.path,'isfile') as isfile:
            self.assertIsNone(self.resolve('a.png',Path('fixture')))
            isfile.assert_not_called()

    def test_commonpath_and_isfile_errors_are_preserved(self):
        for name in ('commonpath','isfile'):
            error=ValueError('fixture '+name)
            with patch.object(storage.os.path,name,side_effect=error):
                with self.assertRaises(ValueError) as caught:self.resolve('a.png',Path('fixture'))
            self.assertIs(caught.exception,error)


class RemoteMediaResolutionTests(unittest.TestCase):
    def execute(self, chunks=(b'a',b'',b'bc'), headers=None, error=None, rewrite=None, **options):
        events=[]
        class Response:
            def __enter__(self):events.append('enter');return self
            def __exit__(self,*exc):events.append(('exit',exc[0]));return False
            def raise_for_status(self):
                events.append('status')
                if error is not None:raise error
            def iter_content(self,chunk_size):
                events.append(('chunks',chunk_size))
                for chunk in chunks:
                    events.append(('yield',chunk))
                    if isinstance(chunk,BaseException):raise chunk
                    yield chunk
        response=Response();response.headers=headers if headers is not None else {'content-type':'image/png'}
        get=Mock(return_value=response)
        def rewrite_url(value):events.append(('rewrite',value));return rewrite if rewrite is not None else value
        try:
            value=transfer.fetch_remote_media_bytes(options.pop('url','https://fixture.invalid/a.png'),
                rewrite_runninghub_file_url=rewrite_url,urllib=urllib,requests=SimpleNamespace(get=get),HTTPException=HTTPException,**options)
        except BaseException as exc:
            exc.fixture_events=events;exc.fixture_get=get;raise
        return value,events,get

    def test_stream_chunks_empty_chunks_content_type_and_close_order(self):
        value,events,get=self.execute()
        self.assertEqual(value,(b'abc','image/png'))
        self.assertEqual(events,[('rewrite','https://fixture.invalid/a.png'),'enter','status',('chunks',262144),
            ('yield',b'a'),('yield',b''),('yield',b'bc'),('exit',None)])
        get.assert_called_once_with('https://fixture.invalid/a.png',stream=True,timeout=30.0,
            headers={'User-Agent':'ComfyUI-API-Modelscope/1.0'})

    def test_rewrite_and_trim_happen_before_validation_and_get(self):
        value,events,get=self.execute(url=' fixture-source ',rewrite='https://fixture.invalid/rewritten',timeout=7)
        self.assertEqual(value[0],b'abc');self.assertEqual(events[0],('rewrite','fixture-source'))
        self.assertEqual(get.call_args.args,('https://fixture.invalid/rewritten',));self.assertEqual(get.call_args.kwargs['timeout'],7)

    def test_invalid_urls_do_not_request(self):
        for url in (None,'','/assets/a.png','file:///a.png','ftp://fixture.invalid/a.png','https:///a.png','http:'):
            value,events,get=self.execute(url=url)
            self.assertIsNone(value);get.assert_not_called();self.assertEqual(len(events),1)

    def test_rewrite_can_invalidate_url(self):
        value,events,get=self.execute(rewrite='/invalid')
        self.assertIsNone(value);get.assert_not_called()

    def test_missing_and_empty_content_type_fall_back(self):
        for headers in ({},{'content-type':''}):
            self.assertEqual(self.execute(headers=headers)[0],(b'abc','application/octet-stream'))

    def test_empty_stream_is_valid_at_zero_and_negative_limit(self):
        for limit in (0,-1):self.assertEqual(self.execute(chunks=(b'',),max_bytes=limit)[0],(b'','image/png'))

    def test_exact_limit_is_allowed(self):
        self.assertEqual(self.execute(max_bytes=3)[0],(b'abc','image/png'))

    def test_over_limit_raises_413_closes_stream_and_stops_consuming(self):
        with self.assertRaises(HTTPException) as caught:self.execute(chunks=(b'ab',b'cd',b'never'),max_bytes=3)
        self.assertEqual((caught.exception.status_code,caught.exception.detail),(413,'文件太大，无法下载'))
        self.assertEqual(caught.exception.fixture_events[-1],('exit',HTTPException))
        self.assertNotIn(('yield',b'never'),caught.exception.fixture_events)

    def test_status_error_precedes_stream_and_still_closes(self):
        error=requests.HTTPError('fixture status')
        with self.assertRaises(requests.HTTPError) as caught:self.execute(error=error,max_bytes=0)
        self.assertIs(caught.exception,error)
        self.assertEqual(error.fixture_events[-3:],['enter','status',('exit',requests.HTTPError)])

    def test_read_error_keeps_identity_and_closes(self):
        error=requests.ConnectionError('fixture read')
        with self.assertRaises(requests.ConnectionError) as caught:self.execute(chunks=(b'a',error))
        self.assertIs(caught.exception,error);self.assertEqual(error.fixture_events[-1],('exit',requests.ConnectionError))

    def test_connect_error_is_not_wrapped(self):
        error=requests.Timeout('fixture connect');get=Mock(side_effect=error)
        with self.assertRaises(requests.Timeout) as caught:
            transfer.fetch_remote_media_bytes('https://fixture.invalid/a',rewrite_runninghub_file_url=lambda value:value,
                urllib=urllib,requests=SimpleNamespace(get=get),HTTPException=HTTPException)
        self.assertIs(caught.exception,error)

    def test_rewrite_error_happens_before_request(self):
        error=ValueError('fixture rewrite');get=Mock()
        with self.assertRaises(ValueError) as caught:
            transfer.fetch_remote_media_bytes('url',rewrite_runninghub_file_url=Mock(side_effect=error),
                urllib=urllib,requests=SimpleNamespace(get=get),HTTPException=HTTPException)
        self.assertIs(caught.exception,error);get.assert_not_called()
