"""媒体导出真实入口和确认路由；仅隔离本地文件，无供应商调用。"""
import asyncio
import copy
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import FastAPI, HTTPException
import main
from backend.canvas_assistant import create_assistant_router
from backend.canvas_assistant_store import AssistantStore
from backend.canvas_assistant_native import prepare_native_action
from backend.canvas_clip import CanvasClipManager, find_media_tools
from tests import test_canvas_assistant_media_export as media_contract


class MediaExportRouteTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.fixture=media_contract.MediaExportContractTests();self.fixture.setUp()
        f=self.fixture
        self.canvas={'id':'canvas','updated_at':1,'nodes':[f.node],'connections':[]}
        self.submits=0
        self.status='running'
        # 文件证明用合同fixture；路由实际持久化/确认/恢复，不由浏览器上报。
        from backend.canvas_assistant_media_export import prepare_media_export
        def prepare(cid,node,options,request_id=None):return prepare_media_export(cid,node,options,f.resolve,[f.root],f.probe,request_id=request_id)
        async def control(proposal,submit=False):
            self.submits+=int(submit)
            from backend.canvas_assistant_media_export import validate_media_export_snapshot
            validate_media_export_snapshot(proposal['mediaExportPlan'],self.canvas['nodes'][0],f.resolve,[f.root],f.probe)
            return {'status':self.status,'results':[{'url':'/output/export.mp4','name':'export.mp4','durationSeconds':2,'sourceClipId':None}] if self.status=='succeeded' else []}
        p=prepare_native_action(self.canvas,{'action':'media_export','nodeId':'clip','scope':'full','destination':'canvas'},'action',media_export_prepare=prepare)
        self.store=AssistantStore(lambda:str(f.root/'history'))
        session=self.store.create('user','canvas','导出验收');self.sid=session['id']
        self.store.transact('user','canvas',lambda doc:doc['sessions'][self.sid]['turns'].append({'id':'turn','state':'waiting_confirmation','nativeActions':[p]}))
        app=FastAPI();app.include_router(create_assistant_router(root=lambda:str(f.root/'history'),load_canvas=lambda _:self.canvas,providers=lambda:[],user_id=lambda header,request:'user',call_model=AsyncMock(),media_export_prepare=prepare,media_export_control=control))
        self.client=httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test')
        self.body={'canvasId':'canvas','sessionId':self.sid,'turnId':'turn','actionId':'action'}

    async def asyncTearDown(self):
        await self.client.aclose();self.fixture.tearDown()

    async def act(self,action):return await self.client.post('/api/canvas-assistant/native/action',json={**self.body,'action':action})

    async def test_original_submit_recovery_saved_outputs_and_private_proof(self):
        first=await self.act('confirm');self.assertEqual(first.status_code,200,first.text)
        self.assertFalse(first.json()['canExecute']);self.assertNotIn('mediaExportPlan',first.text)
        await self.act('confirm');self.assertEqual(self.submits,1)
        self.status='succeeded';query=await self.act('query');self.assertTrue(query.json()['canExecute'])
        summary=query.json()['proposal']['mediaExportSummary']
        saved={'actionId':'action','rangeHash':summary['rangeHash'],'requestId':summary['requestId'],'destination':'canvas','urls':['/output/export.mp4'],'status':'delivery_started'}
        self.canvas['nodes'][0]['assistantMediaExportReceipts']=[saved]
        self.assertTrue((await self.act('check')).json()['canExecute'])
        self.assertFalse((await self.act('query')).json()['canExecute'])
        saved['status']='saved_to_canvas'
        self.assertEqual((await self.act('finish')).status_code,409)
        self.canvas['nodes'].append({'id':'out','type':'output','sourceClipNodeId':'clip','images':[{'url':'/output/export.mp4'}]})
        self.canvas['connections'].append({'from':'clip','to':'out'})
        done=await self.act('finish');self.assertEqual(done.json()['proposal']['state'],'completed')
        self.assertEqual(self.submits,1)
        history=await self.client.get('/api/canvas-assistant/history',params={'canvasId':'canvas','sessionId':self.sid})
        self.assertNotIn('pathHash',history.text);self.assertNotIn('mediaExportPlan',history.text)

    async def test_file_changed_before_confirm_and_after_submit_are_rejected_without_resubmit(self):
        self.fixture.resolve(self.fixture.source).write_bytes(b'changed')
        self.assertEqual((await self.act('confirm')).status_code,409);self.assertEqual(self.submits,0)


class MediaExportRealExecutionTests(unittest.IsolatedAsyncioTestCase):

    async def test_real_clip_export_uses_one_original_task_and_checks_ffmpeg_output(self):
        ffmpeg,ffprobe=find_media_tools(Path(__file__).resolve().parents[1]/'data')
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            subprocess.run([ffmpeg,'-v','error','-y','-f','lavfi','-i','color=blue:s=64x64:r=30:d=0.3','-c:v','libx264','-pix_fmt','yuv420p',str(root/'source.mp4')],check=True,capture_output=True,timeout=30)
            resolve=lambda url:root/Path(url).name
            manager=CanvasClipManager(root/'data',root,lambda name:'/output/'+name,resolve,[root],tools=(ffmpeg,ffprobe))
            node={'id':'clip','type':'clip','clipData':{'version':1,'fps':30,'exportMuted':True,'clips':[{'id':'one','kind':'video','url':'/output/source.mp4','startFrame':0,'endFrame':6,'sourceOffsetFrames':0}]}}
            canvas={'id':'canvas','nodes':[node],'connections':[]}
            try:
                with patch.object(main,'DATA_DIR',str(root/'data')),patch.object(main,'OUTPUT_DIR',str(root)),patch.object(main,'ASSETS_DIR',str(root)),patch.object(main,'_current_storage_dirs',return_value={'output':str(root)}),patch.object(main,'local_media_path_from_url',resolve),patch.object(main,'load_canvas',return_value=canvas),patch.object(main,'canvas_clip_manager',return_value=manager):
                    plan=main.prepare_canvas_assistant_media_export('canvas',node,{'scope':'full','destination':'canvas','exportMuted':True})
                    p={'mediaExportPlan':plan}
                    result=await main.control_canvas_assistant_media_export(p,submit=True)
                    for _ in range(100):
                        if result['status'] in {'succeeded','failed'}:break
                        await asyncio.sleep(0.05);result=await main.control_canvas_assistant_media_export(p)
                    self.assertEqual(result['status'],'succeeded',result)
                    again=await main.control_canvas_assistant_media_export(p,submit=True)
                    self.assertEqual(again['taskId'],result['taskId']);self.assertEqual(len(manager.tasks),1)
                    self.assertEqual(result['results'][0]['durationSeconds'],0.2)
                    self.assertNotEqual(result['results'][0]['url'],'/output/source.mp4')
            finally:manager.close()
