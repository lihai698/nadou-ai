"""Offline avatar protocol/state tests; no application config or real network."""
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from contextlib import nullcontext
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from backend import avatar_asset_service as service
class Error(Exception):
    def __init__(self,status_code,detail):self.status_code=status_code;self.detail=detail
class Client:
    def __init__(self,payload):self.payload=payload
    async def __aenter__(self):return self
    async def __aexit__(self,*args):pass
    async def get(self,*args,**kwargs):return SimpleNamespace(status_code=200,json=lambda:self.payload)
    async def post(self,*args,**kwargs):return SimpleNamespace(status_code=200,json=lambda:self.payload)
def extract(value):return service.extract_apimart_avatar_asset_uri(value,extract_apimart_avatar_asset_uri=extract)
class AvatarAssetTests(unittest.IsolatedAsyncioTestCase):
    def test_nested_uri(self):
        self.assertEqual(extract({'data':{'result':[{'asset_id':'fixture'}]}}),'asset://fixture')
        self.assertEqual(extract({'url':'https://example.invalid/image.png'}),'')
    async def test_status_mapping_and_missing_asset(self):
        for payload,expected in [({'status':'completed','result':{'asset_id':'fixture'}},'Active'),({'status':'completed'},'Failed'),({'status':'rejected'},'Failed'),({'status':'pending'},'Processing')]:
            result=await service.check_apimart_avatar_task({},'task',AVATAR_TASK_DONE_STATUSES={'completed'},AVATAR_TASK_FAIL_STATUSES={'rejected'},HTTPException=Error,api_headers=lambda **_: {},extract_apimart_avatar_asset_uri=extract,httpx=SimpleNamespace(AsyncClient=lambda **_:Client(payload)),upstream_response_error_summary=lambda *a,**k:'error',video_api_root=lambda _:'https://example.invalid')
            self.assertEqual(result['status'],expected)
    async def test_submit_rejects_missing_task_id(self):
        with self.assertRaises(Error) as raised:
            await service.submit_apimart_avatar_asset({},'https://example.invalid/image','name','image',HTTPException=Error,api_headers=lambda **_: {},apimart_avatar_asset_type=service.apimart_avatar_asset_type,httpx=SimpleNamespace(AsyncClient=lambda **_:Client({'data':{}})),upstream_response_error_summary=lambda *a:'error',video_api_root=lambda _:'https://example.invalid')
        self.assertEqual(raised.exception.status_code,502)
    async def test_group_reuses_exact_project_match(self):
        calls=[]
        async def call(client,action,body):
            calls.append(action);return {'Items':[{'Id':'wrong','Name':'组','ProjectName':'other'},{'Id':'right','Name':'组','ProjectName':'default'}]}
        value=await service.volcengine_ensure_asset_group(None,'default','组',HTTPException=Error,volcengine_ark_asset_call=call)
        self.assertEqual(value,'right');self.assertEqual(calls,['ListAssetGroups'])
    async def test_stale_poll_cannot_overwrite_new_registration(self):
        item={'registrations':{'apimart':{'task_id':'old'}}};saved=[]
        async def check(*args):
            item['registrations']['apimart']={'task_id':'new'}
            return {'status':'Active','asset_uri':'asset://old'}
        with self.assertRaises(Error) as raised:
            await service.check_asset_library_avatar('item',SimpleNamespace(library_id='',provider_id='fixture'),AVATAR_SUPPORTED_PLATFORMS={'apimart'},HTTPException=Error,VOLCENGINE_DEFAULT_PROJECT_NAME='default',asset_library_index_lock=nullcontext,avatar_platform_for_provider=lambda _:'apimart',check_apimart_avatar_task=check,check_volcengine_avatar_task=check,find_asset_item_in_library=lambda *_:item,get_api_provider=lambda _:{},load_asset_library=lambda:{},save_asset_library=saved.append)
        self.assertEqual(raised.exception.status_code,409);self.assertEqual(saved,[]);self.assertEqual(item['registrations']['apimart']['task_id'],'new')
if __name__=='__main__':unittest.main()
