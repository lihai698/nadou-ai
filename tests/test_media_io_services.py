"""本地素材读取/导入与下载流的边界回归；只使用自制临时媒体。"""
import asyncio
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from fastapi import HTTPException
from fastapi.responses import FileResponse, Response, StreamingResponse
from PIL import Image
import requests

from backend import media_storage_service as storage, upload_service as upload


class LocalMediaIOTests(unittest.TestCase):
    def test_new_owners_own_all_five_real_bodies(self):
        for owner, names in ((storage, ('local_media_path_from_url', 'view_image', 'download_output')),
                             (upload, ('normalize_local_image_path', 'import_local_image_file'))):
            for name in names:
                self.assertTrue(callable(getattr(owner, name)))

    def resolve(self, url, root, port=lambda *_: None):
        return storage.local_media_path_from_url(url, ASSETS_DIR=str(root/'assets'), OUTPUT_DIR=str(root/'output'), storage_file_path=port)

    def test_local_url_decoding_query_and_source_roots(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            for kind in ('assets','output'):
                (root/kind).mkdir();path=root/kind/'中文.png';path.write_bytes(b'fixture')
                self.assertEqual(self.resolve('/'+kind+'/%E4%B8%AD%E6%96%87.png?v=1',root),str(path))
            for value in ('',None,'https://example.invalid/a.png',' /assets/中文.png','/assets/','/assets/missing.png','/assets/../outside.png'):
                self.assertIsNone(self.resolve(value,root),value)

    def test_storage_url_delegates_kind_and_relative_path_and_keeps_errors(self):
        port=Mock(return_value='fixture-path')
        self.assertEqual(self.resolve('/api/storage-files/local/folder/a.png?x=1',Path('.'),port),'fixture-path')
        port.assert_called_once_with('local','folder/a.png')
        error=HTTPException(400,'fixture path error')
        with self.assertRaises(HTTPException) as caught:
            self.resolve('/api/storage-files/unknown/a.png',Path('.'),Mock(side_effect=error))
        self.assertIs(caught.exception,error)

    def test_local_url_commonpath_value_error_is_still_none(self):
        with patch.object(storage.os.path,'commonpath',side_effect=ValueError('different drives')):
            self.assertIsNone(self.resolve('/assets/a.png',Path('.')))

    def test_normalize_local_file_uri_quotes_and_absolute_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'中文.png'
            for value in (str(path),path.as_uri(),' "'+path.as_uri()+'" '):
                self.assertEqual(upload.normalize_local_image_path(value,HTTPException=HTTPException),str(path))

    def test_normalize_rejects_empty_relative_and_remote_file_host(self):
        for value,detail in [('', '本地图片路径为空'),('relative.png','只支持本机绝对图片路径'),
                             ('file://example.invalid/a.png','只支持本机图片路径')]:
            with self.subTest(value=value),self.assertRaises(HTTPException) as caught:
                upload.normalize_local_image_path(value,HTTPException=HTTPException)
            self.assertEqual((caught.exception.status_code,caught.exception.detail),(400,detail))

    def import_image(self,path,dest,**overrides):
        ports={'HTTPException':HTTPException,'LOCAL_IMAGE_IMPORT_EXTS':{'.png','.jpg','.jpeg','.webp','.gif'},
               'LOCAL_IMAGE_IMPORT_MAX_BYTES':50*1024*1024,'Image':Image,
               'output_path_for':lambda name,kind:str(dest/name),'output_url_for':lambda name,kind:'/assets/input/'+name}
        ports.update(overrides)
        return upload.import_local_image_file(str(path),**ports)

    def test_import_validated_image_preserves_bytes_name_and_destination(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);dest=root/'dest';dest.mkdir();source=root/'中文.PNG';Image.new('RGB',(12,8),'blue').save(source)
            result=self.import_image(source,dest)
            self.assertEqual((result['name'],result['kind']),('中文.PNG','image'))
            self.assertRegex(result['url'],r'^/assets/input/ai_ref_[0-9a-f]{12}\.png$')
            self.assertEqual((dest/result['url'].rsplit('/',1)[1]).read_bytes(),source.read_bytes())

    def test_import_invalid_media_size_and_missing_file_do_not_write(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);dest=root/'dest';dest.mkdir()
            (root/'bad.png').write_bytes(b'not an image');(root/'empty.png').write_bytes(b'');(root/'bad.txt').write_text('fixture')
            for name,status,overrides in [('bad.txt',400,{}),('missing.png',404,{}),('empty.png',400,{}),('bad.png',400,{}),('bad.png',413,{'LOCAL_IMAGE_IMPORT_MAX_BYTES':1})]:
                with self.subTest(name=name,status=status),self.assertRaises(HTTPException) as caught:self.import_image(root/name,dest,**overrides)
                self.assertEqual(caught.exception.status_code,status)
            self.assertEqual(list(dest.iterdir()),[])

    def test_import_stat_and_copy_failures_keep_public_errors(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);source=root/'a.png';Image.new('RGB',(2,2)).save(source)
            with patch.object(upload.os.path,'getsize',side_effect=OSError('fixture stat')):
                with self.assertRaises(HTTPException) as caught:self.import_image(source,root)
                self.assertEqual(caught.exception.status_code,404)
            with patch.object(upload.shutil,'copyfile',side_effect=OSError('fixture copy')):
                with self.assertRaises(HTTPException) as caught:self.import_image(source,root)
                self.assertEqual((caught.exception.status_code,caught.exception.detail),(500,'导入本地图片失败'))


class DownloadIOTests(unittest.IsolatedAsyncioTestCase):
    def ports(self,**overrides):
        ports={'rewrite_runninghub_file_url':lambda url:url,'output_file_from_url':lambda url:None,
               'local_media_file_by_basename':lambda name:None,'filename_from_media_url':lambda url,fallback:Path(url.split('?')[0]).name or fallback,
               'sanitize_export_filename':lambda value,fallback:value or fallback,'FileResponse':FileResponse,
               'content_type_for_path':lambda path:'video/mp4','HTTPException':HTTPException,'requests':requests,'StreamingResponse':StreamingResponse}
        ports.update(overrides);return ports

    def download(self,url='https://example.invalid/video.mp4',request=None,**ports):
        return storage.download_output(request or SimpleNamespace(headers={}),url,**self.ports(**ports))

    async def test_local_resolution_precedes_basename_fallback_and_remote(self):
        fallback=Mock(side_effect=AssertionError('no fallback after local hit'))
        response=self.download(output_file_from_url=lambda url:'fixture.mp4',local_media_file_by_basename=fallback)
        self.assertIsInstance(response,FileResponse);self.assertEqual(response.path,'fixture.mp4');fallback.assert_not_called()
        response=self.download(local_media_file_by_basename=lambda name:'fallback.mp4')
        self.assertEqual(response.path,'fallback.mp4')

    async def test_download_validates_url_before_network(self):
        with patch.object(requests,'get',side_effect=AssertionError('no network')):
            for value in ('file:///fixture.mp4','/missing.mp4','https:///missing.mp4'):
                with self.subTest(value=value),self.assertRaises(HTTPException) as caught:self.download(url=value)
                self.assertEqual((caught.exception.status_code,caught.exception.detail),(400,'无效的下载地址'))

    async def test_range_status_headers_stream_laziness_and_close(self):
        events=[]
        upstream=Mock(status_code=206,headers={'content-type':'video/mp4','content-range':'bytes 0-5/10','accept-ranges':'bytes'})
        def chunks(chunk_size):
            events.append(chunk_size);yield b'abc';yield b'';yield b'def'
        upstream.iter_content=chunks
        with patch.object(requests,'get',return_value=upstream) as get:
            response=self.download(request=SimpleNamespace(headers={'range':'bytes=0-5'}))
        self.assertEqual(events,[]);upstream.close.assert_not_called()
        self.assertEqual(response.status_code,206)
        self.assertEqual(response.headers['content-range'],'bytes 0-5/10')
        self.assertEqual(response.headers['accept-ranges'],'bytes')
        get.assert_called_once_with('https://example.invalid/video.mp4',stream=True,timeout=(10,60),
                                   headers={'User-Agent':'ComfyUI-API-Modelscope/1.0','Range':'bytes=0-5'})
        self.assertEqual([part async for part in response.body_iterator],[b'abc',b'def'])
        self.assertEqual(events,[256*1024]);upstream.close.assert_called_once()

    async def test_stream_failure_still_closes_upstream(self):
        upstream=Mock(status_code=200,headers={})
        def chunks(chunk_size):yield b'a';raise OSError('fixture stream')
        upstream.iter_content=chunks
        with patch.object(requests,'get',return_value=upstream):response=self.download()
        with self.assertRaises(OSError):[part async for part in response.body_iterator]
        upstream.close.assert_called_once()

    async def test_download_error_does_not_reveal_private_url(self):
        with patch.object(requests,'get',side_effect=requests.RequestException('fixture-private')):
            with self.assertRaises(HTTPException) as caught:self.download()
        self.assertEqual((caught.exception.status_code,caught.exception.detail),(502,'远程文件下载失败，请检查地址或网络连接。'))

    async def test_inline_and_attachment_filename_rules(self):
        for inline in (False,True):
            upstream=Mock(status_code=200,headers={});upstream.iter_content.return_value=[]
            with patch.object(requests,'get',return_value=upstream):
                response=storage.download_output(SimpleNamespace(headers={}), 'https://example.invalid/video.mp4', '目录/中文.mp4', inline,**self.ports())
            self.assertEqual(response.headers['content-disposition'],('inline' if inline else 'attachment')+"; filename*=UTF-8''%E4%B8%AD%E6%96%87.mp4")
            self.assertEqual(response.media_type,'application/octet-stream')
            self.assertEqual([part async for part in response.body_iterator],[]);upstream.close.assert_called_once()


class ViewIOTests(unittest.TestCase):
    def view(self,**overrides):
        fields={'COMFYUI_INSTANCES':['first','second'],'requests':Mock(),'Response':Response,'FileResponse':FileResponse,
                'HTTPException':HTTPException,'output_path_for':lambda name,kind:'fixture.png','content_type_for_path':lambda path:'image/png'}
        fields.update(overrides)
        return storage.view_image('a.png',**fields)

    def test_view_returns_first_success_and_keeps_backend_order(self):
        http=Mock();http.get.side_effect=[OSError('fixture first'),SimpleNamespace(status_code=200,content=b'fixture',headers={'Content-Type':'image/png'})]
        response=self.view(requests=http)
        self.assertEqual(response.body,b'fixture');self.assertEqual([c.args[0] for c in http.get.call_args_list],['http://first/view','http://second/view'])

    def test_view_falls_back_to_basename_only_for_input_output_without_subfolder(self):
        port=Mock(return_value='fixture.png')
        with patch.object(storage.os.path,'isfile',return_value=True):response=self.view(COMFYUI_INSTANCES=[],output_path_for=port)
        self.assertEqual(response.path,'fixture.png');port.assert_called_once_with('a.png','input')
        for fields in ({'subfolder':'folder'},{'type':'temp'}):
            with self.subTest(fields=fields),self.assertRaises(HTTPException) as caught:self.view(COMFYUI_INSTANCES=[],**fields)
            self.assertEqual((caught.exception.status_code,caught.exception.detail),(404,'Image not found on any available backend'))
