import base64
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend import upload_service as service
from backend.asset_media_rules import _local_upload_kind_ext

class UploadError(Exception):
    def __init__(self, status_code, detail):
        self.status_code, self.detail = status_code, detail
        super().__init__(detail)

class File:
    def __init__(self, data, name='file.png', content_type='image/png'):
        self.data, self.filename, self.content_type = data, name, content_type
    async def read(self, size):
        chunk, self.data = self.data[:size], self.data[size:]
        return chunk

def limit_error(filename='file', batch=False):
    return UploadError(413, 'batch' if batch else filename)

class UploadServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_exact_limit_and_batch_failure(self):
        batch = {'total': 0}
        options = dict(batch_state=batch, file_limit=4, batch_limit=5, chunk_bytes=2, limit_error=limit_error)
        self.assertEqual(await service.read_upload_file_limited(File(b'abcd'), **options), b'abcd')
        with self.assertRaises(UploadError) as error:
            await service.read_upload_file_limited(File(b'ef'), **options)
        self.assertEqual(error.exception.status_code, 413)
        self.assertEqual(error.exception.detail, 'batch')
        self.assertEqual(batch['total'], 4)

    async def test_file_limit_stops_before_retaining_excess_chunk(self):
        with self.assertRaises(UploadError) as error:
            await service.read_upload_file_limited(File(b'abcde', 'large.png'), file_limit=4, batch_limit=10, chunk_bytes=2, limit_error=limit_error)
        self.assertEqual(error.exception.detail, 'large.png')

    async def test_reference_storage_preserves_bytes_and_media_fallback(self):
        async def read(file, batch_state): return await file.read(100)
        with tempfile.TemporaryDirectory() as tmp:
            result = await service.upload_ai_reference([File(b'video', 'clip', 'video/webm'), File(b'', 'empty')], read_limited=read, output_path=lambda n,k: str(Path(tmp)/n), output_url=lambda n,k: '/assets/input/'+n)
            self.assertEqual(len(result['files']), 1)
            item = result['files'][0]
            self.assertEqual(item['kind'], 'video')
            self.assertTrue(item['url'].endswith('.webm'))
            self.assertEqual((Path(tmp)/Path(item['url']).name).read_bytes(), b'video')

    async def test_comfy_fanout_retains_last_success_and_logs_only_error_type(self):
        calls, logs = [], []
        def post(url, **kwargs):
            calls.append(url)
            if 'first' in url: raise OSError('private details')
            return SimpleNamespace(status_code=200, json=lambda: {'name':'accepted.png'})
        async def read(file, batch_state): return b'fixture'
        result = await service.upload_image([File(b'x')], read_limited=read, get_instances=lambda:['first','second'], http=SimpleNamespace(post=post), diagnostic=logs.append, error_factory=UploadError)
        self.assertEqual(result, {'files':[{'comfy_name':'accepted.png'}]})
        self.assertEqual(len(calls), 2)
        self.assertEqual(logs, ['comfy upload failed error=OSError'])

    async def test_base64_writes_decoded_bytes_and_preserves_name(self):
        payload=SimpleNamespace(data='data:image/png;base64,'+base64.b64encode(b'fixture').decode(),content_type='',name='sample.png')
        with tempfile.TemporaryDirectory() as tmp:
            result=await service.upload_ai_base64(payload,size_hint=lambda s:s,max_bytes=100,limit_error=limit_error,kind_ext=_local_upload_kind_ext,output_path=lambda n,k:str(Path(tmp)/n),output_url=lambda n,k:'/assets/input/'+n,error_factory=UploadError)
            item=result['files'][0]
            self.assertEqual(item['name'],'sample.png')
            self.assertEqual((Path(tmp)/Path(item['url']).name).read_bytes(),b'fixture')

    async def test_empty_base64_keeps_error_status(self):
        payload=SimpleNamespace(data='',content_type='',name='')
        with self.assertRaises(UploadError) as error:
            await service.upload_ai_base64(payload,size_hint=lambda s:s,max_bytes=100,limit_error=limit_error,kind_ext=_local_upload_kind_ext,output_path=lambda *a:None,output_url=lambda *a:None,error_factory=UploadError)
        self.assertEqual((error.exception.status_code,error.exception.detail),(400,'内容为空'))

    async def test_comfy_base64_preserves_data_url_type_and_payload(self):
        sent=[]
        def post(url, **kwargs):
            sent.append((url,kwargs))
            return SimpleNamespace(status_code=200,json=lambda:{'name':'remote.png'})
        payload=SimpleNamespace(data='data:image/png;base64,'+base64.b64encode(b'fixture').decode(),content_type='',name='sample.png')
        result=await service.upload_comfyui_base64(payload,size_hint=lambda s:s,max_bytes=100,limit_error=limit_error,kind_ext=_local_upload_kind_ext,get_instances=lambda:['fixture'],http=SimpleNamespace(post=post),diagnostic=lambda s:None,error_factory=UploadError)
        self.assertEqual(result,{'name':'remote.png'})
        self.assertEqual(sent[0][1]['files']['image'][1:],(b'fixture','image/png'))
        self.assertEqual(sent[0][1]['timeout'],10)

    async def test_comfy_failure_statuses_remain_distinct(self):
        http=SimpleNamespace(post=lambda *a,**k:SimpleNamespace(status_code=500))
        async def read(file,batch_state): return b'fixture'
        with self.assertRaises(UploadError) as multipart:
            await service.upload_image([File(b'x')],read_limited=read,get_instances=lambda:['fixture'],http=http,diagnostic=lambda s:None,error_factory=UploadError)
        self.assertEqual(multipart.exception.status_code,500)
        payload=SimpleNamespace(data=base64.b64encode(b'fixture').decode(),content_type='',name='')
        with self.assertRaises(UploadError) as encoded:
            await service.upload_comfyui_base64(payload,size_hint=lambda s:s,max_bytes=100,limit_error=limit_error,kind_ext=_local_upload_kind_ext,get_instances=lambda:['fixture'],http=http,diagnostic=lambda s:None,error_factory=UploadError)
        self.assertEqual(encoded.exception.status_code,502)

if __name__ == '__main__': unittest.main()
