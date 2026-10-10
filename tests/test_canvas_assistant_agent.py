"""多步助手真实路由测试；仅模型边界模拟，画布校验、历史与回执实际执行。"""
import asyncio
import copy
import json
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

import httpx
import anyio
from fastapi import FastAPI, HTTPException, Request

from backend.canvas_assistant import AssistantStore, CancelRequest, TurnRequest, create_assistant_router
from backend.canvas_assistant_agent import run_agent
from backend.canvas_assistant_operations import receipt_key
from backend.canvas_assistant_operations import prepare_operations
from backend.canvas_assistant import reference_kind
from backend.canvas_assistant_tools import tool_catalog


def decision(tool=None, arguments=None, reply="已完成"):
    return {"reply": reply, "tool": tool, "arguments": arguments or {}}


class AgentRouteTests(unittest.IsolatedAsyncioTestCase):
    async def test_loop_resume_remaining_copy_after_last_generation_has_no_new_budget(self):
        from tests.test_canvas_assistant_loop import LoopContractTests
        from backend.canvas_assistant_loop import loop_slots
        self.canvas.update(LoopContractTests().canvas(dag=True));self.canvas['id']='canvas-a'
        self.canvas['nodes'][0]['showPrompt']=False
        for node in self.canvas['nodes']:
            if node.get('runSettings'):node['runSettings'].update(provider_id='mock',model='image')
        self.responses=[decision('propose_native_action',{'action':'run','nodeId':'loop','maxCalls':2})]
        await self.send();p=(await self.history())['nativeActions'][0]
        body={'canvasId':'canvas-a','sessionId':self.session,'turnId':'turn-a','actionId':p['id']}
        async def act(action):return await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':action})
        self.assertEqual((await act('confirm')).status_code,200)
        run={'actionId':p['id'],'taskKind':'image','taskIds':[],'inputHash':p['runInputHash'],'slots':{},'submissionStarted':True}
        self.canvas['nodes'][0]['assistantNativeRun']=run
        for step in p['loopPlan']['steps']:
            out={'id':step['outputNodeId'],'type':'smart-image','images':[],'loopSourceId':'loop','loopRootId':step['templateNodeId'],'loopRoundIndex':step['roundIndex'],
                 'assistantNativeOrigin':{'kind':'loop','actionId':p['id'],'sourceNodeId':'loop','inputHash':p['runInputHash'],'stepKey':step['key']}}
            self.canvas['nodes'].append(out);self.canvas['connections'].append({'from':step['templateNodeId'],'to':out['id'],'kind':'flow'})
            entry={'outputNodeId':out['id'],'taskIds':[],'status':'ready'};run['slots'][step['key']]=entry
            if step['kind']=='generate':
                tid='original-'+step['key'];url='/output/'+tid+'.png'
                run['taskIds'].append(tid);entry.update(taskIds=[tid],status='succeeded');out['images']=[{'url':url}]
                self.native_tasks[('image',tid)]={'task_id':tid,'status':'succeeded','canvas_id':'canvas-a','node_id':'loop','assistant_action_id':p['id'],'input_hash':p['runInputHash'],'provider_id':'mock','model':'image','result':{'images':[url]}}
        partial=await act('finish');self.assertEqual(partial.status_code,200,partial.text)
        self.assertEqual(partial.json()['proposal']['receipt']['unsubmittedSlots'],0)
        self.assertEqual(partial.json()['proposal']['receipt']['pendingSlots'],2)
        resumed=await act('resume');self.assertEqual(resumed.status_code,200,resumed.text);self.assertTrue(resumed.json()['canExecute'])
        self.assertEqual((await act('check')).status_code,409)
        slots=loop_slots(self.canvas,p)
        for step in p['loopPlan']['steps']:
            if step['kind']=='copy':
                slots[step['key']]['images']=copy.deepcopy(slots[step['copyFromKey']]['images']);run['slots'][step['key']]['status']='succeeded'
        done=await act('finish');self.assertEqual(done.json()['proposal']['state'],'completed',done.text)

    async def test_loop_original_budget_check_stop_resume_and_saved_slot_finish(self):
        from backend.canvas_assistant_loop import loop_slots
        from tests.test_canvas_assistant_loop import LoopContractTests
        self.canvas.update(LoopContractTests().canvas());self.canvas['id']='canvas-a'
        self.canvas['nodes'][1]['runSettings'].update(provider_id='mock',model='image')
        self.responses=[decision('propose_native_action',{'action':'run','nodeId':'loop','maxCalls':2}),decision(reply='循环原轮槽已保存')]
        await self.send();p=(await self.history())['nativeActions'][0]
        body={'canvasId':'canvas-a','sessionId':self.session,'turnId':'turn-a','actionId':p['id']}
        async def act(action):return await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':action})
        self.assertEqual((await act('confirm')).status_code,200)
        node=self.canvas['nodes'][0];run={'actionId':p['id'],'taskKind':'image','taskIds':[],'inputHash':p['runInputHash'],'slots':{},'submissionStarted':False}
        node['assistantNativeRun']=run
        for step in p['loopPlan']['steps']:
            out={'id':step['outputNodeId'],'type':'smart-image','images':[],'loopSourceId':'loop','loopRootId':step['templateNodeId'],'loopRoundIndex':step['roundIndex'],
                 'assistantNativeOrigin':{'kind':'loop','actionId':p['id'],'sourceNodeId':'loop','inputHash':p['runInputHash'],'stepKey':step['key']}}
            self.canvas['nodes'].append(out);self.canvas['connections'].append({'from':step['templateNodeId'],'to':out['id'],'kind':'flow'})
            run['slots'][step['key']]={'outputNodeId':out['id'],'taskIds':[],'status':'ready'}
        self.canvas['updated_at']+=1
        self.assertEqual((await act('check')).status_code,200)
        self.canvas['nodes'][1]['promptDraftText']='changed';self.assertEqual((await act('check')).status_code,409);self.canvas['nodes'][1]['promptDraftText']='原正文'
        slots=loop_slots(self.canvas,p)
        first=p['loopPlan']['steps'][0];entry=run['slots'][first['key']];entry.update(status='succeeded',taskIds=['original-one']);run['taskIds']=['original-one'];run['submissionStarted']=True
        slots[first['key']]['images']=[{'url':'/output/one.png'}]
        self.native_tasks[('image','original-one')]={'task_id':'original-one','status':'succeeded','canvas_id':'canvas-a','node_id':'loop','assistant_action_id':p['id'],'input_hash':p['runInputHash'],'provider_id':'mock','model':'image','result':{'images':['/output/one.png']}}
        partial=await act('finish');self.assertEqual(partial.status_code,200,partial.text);self.assertEqual(partial.json()['proposal']['state'],'accepted')
        self.assertEqual(partial.json()['proposal']['receipt']['unsubmittedSlots'],1)
        continued=await act('resume');self.assertEqual(continued.status_code,200,continued.text);self.assertTrue(continued.json()['canExecute'])
        run['unknownCount']=1;self.assertEqual((await act('check')).status_code,409);self.assertEqual((await act('resume')).status_code,409);run['unknownCount']=0
        second=p['loopPlan']['steps'][1];run['slots'][second['key']].update(status='succeeded',taskIds=['original-two']);run['taskIds'].append('original-two');slots[second['key']]['images']=[{'url':'/output/two.png'}]
        self.native_tasks[('image','original-two')]={**self.native_tasks[('image','original-one')],'task_id':'original-two','result':{'images':['/output/two.png']}}
        self.assertEqual((await act('check')).status_code,409)
        done=await act('finish');self.assertEqual(done.status_code,200,done.text);self.assertEqual(done.json()['proposal']['state'],'completed')
        self.assertEqual((await act('resume')).status_code,409)
        self.assertFalse((await act('confirm')).json().get('canExecute',False))
        continued=await self.client.post('/api/canvas-assistant/continue',json={'canvasId':'canvas-a','sessionId':self.session,'requestId':'turn-a'})
        self.assertIn('"state": "completed"',continued.text)

    async def test_smart_group_saved_branch_check_budget_finish_and_continue(self):
        node={'id':'group','type':'smart-group','items':['member'],'images':[], 'runSettings':{'engine':'api','apiKind':'image','provider_id':'manual','model':'selected','count':2}}
        member={'id':'member','type':'smart-prompt','text':'分组正文'}
        self.canvas.update(kind='smart',nodes=[node,member],connections=[])
        self.responses=[decision('propose_native_action',{'action':'run','nodeId':'group','maxCalls':2}),decision(reply='分组原结果已保存')]
        await self.send();action=(await self.history())['nativeActions'][0]
        body={'canvasId':'canvas-a','sessionId':self.session,'turnId':'turn-a','actionId':action['id']}
        confirm=await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'confirm'})
        self.assertEqual(confirm.status_code,200,confirm.text)
        node['assistantNativeRun']={'actionId':action['id'],'taskKind':'image','taskIds':[],'submissionStarted':False,'outputNodeId':action['outputNodeId'],'inputHash':action['runInputHash']}
        out={'id':action['outputNodeId'],'type':'smart-image','images':[],'pending':2,'assistantNativeOrigin':{'actionId':action['id'],'sourceNodeId':'group','inputHash':action['runInputHash']}}
        self.canvas['nodes'].append(out);self.canvas['connections'].append({'from':'group','to':out['id'],'kind':'flow'});self.canvas['updated_at']+=1
        async def check():return await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'check'})
        self.assertEqual((await check()).status_code,200)
        member['text']='异步编辑';self.assertEqual((await check()).status_code,409);member['text']='分组正文'
        out['assistantNativeOrigin']['sourceNodeId']='other';self.assertEqual((await check()).status_code,409);out['assistantNativeOrigin']['sourceNodeId']='group'
        node['assistantNativeRun']['taskIds']=['one'];node['assistantNativeRun']['submissionStarted']=True
        out['pendingTasks']=[{'taskId':'one','kind':'image','assistantNativeActionId':action['id']}]
        self.assertEqual((await check()).status_code,200)
        out['pendingTasks'].append({'taskId':'foreign','kind':'image','assistantNativeActionId':action['id']})
        self.assertEqual((await check()).status_code,409);out['pendingTasks'].pop()
        node['assistantNativeRun']['taskIds'].append('two');self.assertEqual((await check()).status_code,409)
        for i in ['one','two']:
            self.native_tasks[('image',i)]={'task_id':i,'status':'succeeded','canvas_id':'canvas-a','node_id':'group','assistant_action_id':action['id'],'input_hash':action['runInputHash'],'provider_id':'manual','model':'selected','result':{'images':['/output/'+i+'.png']}}
        out['images']=[{'url':'/output/one.png'},{'url':'/output/two.png'}];out['pendingTasks']=[];out['pending']=0
        done=await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'finish'})
        self.assertEqual(done.status_code,200,done.text);self.assertEqual(done.json()['proposal']['state'],'completed')
        repeated=await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'confirm'})
        self.assertFalse(repeated.json().get('canExecute',False))
        continued=await self.client.post('/api/canvas-assistant/continue',json={'canvasId':'canvas-a','sessionId':self.session,'requestId':'turn-a'})
        self.assertIn('"state": "completed"',continued.text)
        self.assertIn('/output/one.png',self.seen[-1]['message'])

    async def test_export_confirm_finish_saved_receipt_reload_and_continue(self):
        node={'id':'p','type':'prompt','text':'导出正文'}
        self.canvas.update(nodes=[node],connections=[])
        self.responses=[decision('propose_native_action',{'action':'export','nodeId':'p','includeResources':False}),decision(reply='已发起下载')]
        await self.send();action=(await self.history())['nativeActions'][0]
        body={'canvasId':'canvas-a','sessionId':self.session,'turnId':'turn-a','actionId':action['id']}
        confirmed=await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'confirm'})
        self.assertEqual(confirmed.status_code,200,confirmed.text);self.assertTrue(confirmed.json()['canExecute'])
        missing=await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'finish'})
        self.assertEqual(missing.status_code,409,missing.text)
        node['assistantExportReceipts']=[{'actionId':action['id'],'status':'download_started','format':'json','nodeId':'p','filename':'workflow.json','includeResources':False,'nodeIds':['p'],'connectionIds':[],'scopeHash':action['exportScopeHash'],'bytes':128,'downloadedAt':1}]
        self.canvas['updated_at']+=1
        done=await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'finish'})
        self.assertEqual(done.status_code,200,done.text);self.assertEqual(done.json()['proposal']['state'],'completed')
        repeated=await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'confirm'})
        self.assertFalse(repeated.json().get('canExecute',False))
        self.assertEqual((await self.history())['nativeActions'][0]['receipt']['exportReceipt']['filename'],'workflow.json')
        continued=await self.client.post('/api/canvas-assistant/continue',json={'canvasId':'canvas-a','sessionId':self.session,'requestId':'turn-a'})
        self.assertIn('"state": "completed"',continued.text);self.assertIn('workflow.json',self.seen[-1]['message'])

    async def test_rh_app_finish_uses_bound_saved_result_without_local_task_query(self):
        node={'id':'rh','type':'rh','rhMode':'app','rhConfigKey':'app:user-app','webappId':'user-app','apiProvider':'runninghub','count':1,'outputEnabled':True,'rhParams':{'12::steps':{'value':'20'}},'rhAppInfo':{'nodeInfoList':[{'nodeId':'12','fieldName':'steps','fieldType':'INT'}]}}
        out={'id':'out','type':'output','images':[{'url':'/output/old.png'}]}
        self.canvas.update(nodes=[node,out],connections=[{'from':'rh','to':'out'}])
        self.responses=[decision('propose_native_action',{'action':'run','nodeId':'rh','maxCalls':1}),decision(reply='已读取本轮 RH 结果')]
        await self.send();action=(await self.history())['nativeActions'][0]
        body={'canvasId':'canvas-a','sessionId':self.session,'turnId':'turn-a','actionId':action['id']}
        confirm=await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'confirm'})
        self.assertEqual(confirm.status_code,200,confirm.text)
        node['assistantNativeRun']={'actionId':action['id'],'taskKind':'runninghub','taskIds':['rh-original'],'inputHash':action['runInputHash'],'outputNodeId':'out','status':'succeeded','resultUrls':['/output/current.png']}
        missing=await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'finish'})
        self.assertEqual(missing.status_code,409,missing.text)
        out['images'].append({'url':'/output/current.png'});self.canvas['updated_at']+=1
        done=await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'finish'})
        self.assertEqual(done.status_code,200,done.text)
        self.assertEqual(done.json()['proposal']['state'],'completed')
        self.assertEqual(self.native_queries,[])
        repeated=await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'finish'})
        self.assertEqual(repeated.status_code,200,repeated.text)
        continued=await self.client.post('/api/canvas-assistant/continue',json={'canvasId':'canvas-a','sessionId':self.session,'requestId':'turn-a'})
        self.assertIn('"state": "completed"',continued.text)
        self.assertIn('/output/current.png',self.seen[-1]['message'])
        self.assertEqual(self.native_queries,[])


    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.canvas = {"id": "canvas-a", "kind": "classic", "title": "创作", "updated_at": 20,
                       "nodes": [], "connections": [], "settings": {}}
        self.providers = [{"id": "mock", "name": "模拟", "enabled": True, "has_key": True,
                           "chat_models": ["chat"], "image_models": ["image"]}]
        self.responses = [decision()]
        self.model_error = None
        self.seen = []
        self.tasks = {}
        self.native_tasks = {}
        self.native_queries = []
        self.native_query_hook = None
        self.native_controls = []
        self.native_control_gate = None
        self.native_control_started = asyncio.Event()
        self.native_control_hook = None
        self.native_control_status = None
        self.workflow_fields = {}
        self.gate = None
        self.started = asyncio.Event()
        self.assets = []
        self.test_app = self.app()
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=self.test_app), base_url="http://test", headers={"X-User-Id": "owner"})
        self.session = (await self.client.post("/api/canvas-assistant/sessions", json={"canvasId": "canvas-a"})).json()["session"]["id"]

    def app(self):
        async def model(fields):
            self.seen.append(copy.deepcopy(fields))
            self.started.set()
            if self.model_error:
                raise self.model_error
            if self.gate:
                await self.gate.wait()
            item = self.responses.pop(0) if len(self.responses) > 1 else self.responses[0]
            return {"text": json.dumps(item, ensure_ascii=False) if isinstance(item, dict) else item}

        def apply(user, payload, operations):
            candidate, receipt = prepare_operations(self.canvas, operations, request_id=payload.requestId,
                user=user, expected_updated_at=payload.expectedUpdatedAt, creation_settings=payload.creationSettings,
                providers=self.providers, image_model_confirmed=payload.imageModelConfirmed)
            if candidate:
                candidate["updated_at"] += 1
                receipt["updatedAtAfter"] = candidate["updated_at"]
                self.canvas = candidate
            return receipt

        async def query(task_id):
            if task_id not in self.tasks:
                raise HTTPException(404, "未受理")
            return self.tasks[task_id]

        async def submit(proposal, body, request):
            self.tasks.setdefault(proposal["taskId"], {"task_id": proposal["taskId"], "status": "queued"})
            return self.tasks[proposal["taskId"]]

        async def query_native(kind,task_id):
            self.native_queries.append((kind,task_id))
            if (kind,task_id) not in self.native_tasks:raise HTTPException(404,'原任务不存在')
            if self.native_query_hook:self.native_query_hook()
            return self.native_tasks[(kind,task_id)]

        async def control_native(action,kind,task_id):
            self.native_controls.append((action,kind,task_id))
            self.native_control_started.set()
            if self.native_control_gate:await self.native_control_gate.wait()
            if self.native_control_hook:self.native_control_hook()
            if (kind,task_id) not in self.native_tasks:raise HTTPException(404,'原任务不存在')
            task=self.native_tasks[(kind,task_id)]
            task['status']=self.native_control_status or ('cancelled' if action=='task_cancel' else 'succeeded')
            return task

        app = FastAPI()
        app.include_router(create_assistant_router(root=lambda: self.temp.name, load_canvas=lambda cid: self.canvas,
            providers=lambda: self.providers, user_id=lambda header, request: header, call_model=model,
            apply_operations=apply, submit_image=submit, query_image=query, query_native_task=query_native, load_reference_assets=lambda: self.assets,
            workflow_fields=lambda node:self.workflow_fields.get(node['id']),control_native_task=control_native,
            resolve_result_file=lambda url:Path(self.temp.name)/Path(url).name, result_roots=lambda:[self.temp.name]))
        return app

    async def asyncTearDown(self):
        await self.client.aclose()
        self.temp.cleanup()

    def payload(self, **changes):
        return {"canvasId": "canvas-a", "sessionId": self.session, "requestId": "turn-a", "message": "整理海报",
                "provider": "mock", "model": "chat", "expectedUpdatedAt": self.canvas["updated_at"],
                "skillId": "auto", "imageModelConfirmed": True,
                "creationSettings": {"engine": "api", "provider_id": "mock", "model": "image", "ratio": "square", "resolution": "1k"}, **changes}

    async def send(self, **changes):
        result = await self.client.post("/api/canvas-assistant/chat", json=self.payload(**changes))
        self.assertEqual(result.status_code, 200, result.text)
        return [json.loads(line) for line in result.text.splitlines()]

    async def history(self):
        result = await self.client.get("/api/canvas-assistant/history", params={"canvasId": "canvas-a", "sessionId": self.session})
        return result.json()["session"]["turns"][0]

    async def test_result_review_uses_real_pixels_and_persists_unknown_unconfirmed_requirements(self):
        from PIL import Image
        from backend.canvas_assistant import node_reference_assets
        Image.new('RGB',(72,48),'white').save(Path(self.temp.name)/'review.png')
        self.canvas['nodes']=[{'id':'image','type':'image','url':'/output/review.png'}]
        asset=node_reference_assets(self.canvas)[0]['id']
        self.responses=[decision('inspect_result',{'assetIds':[asset]}),
                        decision('record_result_review',{'inspectionId':'turn-a_s1','status':'passed','findings':['白色横向图片，未看到文字'],'limitations':['未指定创作目标']}),decision()]
        events=await self.send();self.assertEqual(events[-1]['state'],'completed')
        turn=await self.history();inspection=turn['steps'][0]['result']['resultInspection']
        self.assertEqual(inspection['images'][0]['width'],72)
        self.assertEqual(inspection['images'][0]['height'],48)
        self.assertEqual(self.seen[1]['images'],['/output/review.png'])
        review=turn['steps'][1]['result']['review']
        self.assertEqual(review['status'],'unknown')
        self.assertEqual(review['visualStatus'],'passed')
        self.assertEqual(review['findings'],['白色横向图片，未看到文字'])
        self.assertTrue(any(event.get('step',{}).get('review') for event in events))

    async def test_result_review_rejects_replaced_file_and_no_image_input(self):
        from PIL import Image
        from backend.canvas_assistant import node_reference_assets
        Image.new('RGB',(72,48)).save(Path(self.temp.name)/'review.png')
        self.canvas['nodes']=[{'id':'image','type':'image','url':'/output/review.png'}]
        asset=node_reference_assets(self.canvas)[0]['id']
        self.responses=[decision('inspect_result',{'assetIds':[asset]}),decision('read_canvas'),
                        decision('record_result_review',{'inspectionId':'turn-a_s1','status':'passed','findings':['图片合格']}),decision()]
        # 首次检查后在实际下一模型请求边界替换图片文件。
        old_seen=self.seen
        class ReplacingInputs(list):
            def append(inner,fields):
                super().append(fields)
                if len(inner)==2:Image.new('RGB',(16,16),'red').save(Path(self.temp.name)/'review.png')
        self.seen=ReplacingInputs(old_seen)
        events=await self.send();self.assertEqual(events[-1]['state'],'completed')
        turn=await self.history();self.assertEqual(turn['steps'][2]['state'],'failed')
        self.assertIn('变化',turn['steps'][2]['error'])

    async def test_result_review_without_inspection_cannot_pass(self):
        self.responses=[decision('record_result_review',{'inspectionId':'invented','status':'passed','findings':['模型自评分合格']}),decision()]
        await self.send();turn=await self.history()
        self.assertEqual(turn['steps'][0]['state'],'failed')
        self.assertIn('检查',turn['steps'][0]['error'])

    def video_asset(self, *, smart=False):
        import subprocess
        from backend.canvas_clip import find_media_tools
        from backend.canvas_assistant import node_reference_assets
        video=Path(self.temp.name)/'review.mp4'
        subprocess.run([find_media_tools()[0],'-v','error','-f','lavfi','-i','testsrc=size=80x48:rate=10:duration=1.2',
                        '-f','lavfi','-i','sine=frequency=440:duration=1.2','-c:v','mpeg4','-c:a','aac',
                        '-pix_fmt','yuv420p','-movflags','+faststart','-y',str(video)],check=True,capture_output=True,timeout=20)
        self.canvas['kind']='smart' if smart else 'classic'
        self.canvas['nodes']=[{'id':'video','type':'smart-image' if smart else 'image',
                               'url':'/output/review.mp4','mediaKind':'video'}]
        assets=node_reference_assets(self.canvas)
        self.assertEqual(assets[0]['kind'],'video')
        return assets[0]['id'],video

    async def test_video_result_review_sends_timestamped_frames_but_never_claims_full_quality(self):
        asset,_=self.video_asset()
        self.responses=[decision('inspect_result',{'assetIds':[asset]}),
                        decision('record_result_review',{'inspectionId':'turn-a_s1','status':'passed','findings':['抽查帧主体可见']}),decision()]
        events=await self.send()
        turn=await self.history()
        self.assertEqual(turn['steps'][0]['state'],'succeeded',turn['steps'][0])
        inspection=turn['steps'][0]['result']['resultInspection']
        self.assertEqual(events[-1]['state'],'completed')
        self.assertIn(asset,self.seen[0]['system_prompt'])
        self.assertEqual(len(self.seen[1]['images']),3)
        self.assertTrue(all(url.startswith('data:image/jpeg;base64,') for url in self.seen[1]['images']))
        self.assertEqual(self.seen[1]['videos'],[])
        video=inspection['videos'][0]
        self.assertEqual((video['width'],video['height']),(80,48))
        stamps=[frame['timestampSeconds'] for frame in video['frames']]
        self.assertEqual(stamps,sorted(stamps));self.assertEqual(len(set(stamps)),3)
        self.assertEqual([frame['inputImageIndex'] for frame in video['frames']],[1,2,3])
        review=turn['steps'][1]['result']['review']
        self.assertEqual(review['status'],'unknown');self.assertEqual(review['visualStatus'],'passed')
        self.assertEqual(review['coverage']['audioSemantics'],'unknown')
        self.assertEqual(review['coverage']['fullVideoSemantics'],'unknown')
        self.assertTrue(review['limitations'])
        self.assertNotIn('data:image/',json.dumps(turn['steps']))
        self.assertNotIn('data:image/',self.seen[1]['message'])
        self.assertNotIn('data:image/',json.dumps(turn['agent']['lastModelInputImages']))

    async def test_native_video_inspection_uses_confirmed_request_original_task_and_keeps_full_quality_unknown(self):
        from backend.canvas_assistant_native import prepare_native_action
        self.video_asset()
        node={'id':'video','type':'video','apiProvider':'mock','model':'video-user','duration':1.2,'aspectRatio':'5:3','outputEnabled':True,'generateAudio':True,'generatedOutputs':[{'url':'/output/review.mp4','kind':'video'}]}
        output={'id':'out','type':'output','images':[{'url':'/output/review.mp4','kind':'video'}]}
        self.canvas.update(nodes=[node,output,{'id':'prompt','type':'prompt','text':'原视频'}],connections=[{'from':'prompt','to':'video'},{'from':'video','to':'out'}])
        self.providers[0]['video_models']=['video-user']
        proposal=prepare_native_action(self.canvas,{'action':'run','nodeId':'video','maxCalls':1},'video-run',providers=self.providers)
        proposal.update(state='completed',confirmedAt=1,receipt={'taskIds':['canvas_video_trusted123']})
        node['assistantNativeRun']={'actionId':proposal['id'],'taskKind':'video','taskIds':['canvas_video_trusted123']}
        self.native_tasks[('video','canvas_video_trusted123')]={'task_id':'canvas_video_trusted123','status':'succeeded','canvas_id':'canvas-a','node_id':'video','assistant_action_id':'video-run','input_hash':proposal['runInputHash'],'provider_id':'mock','model':'video-user','result':{'videos':['/output/review.mp4']}}
        self.responses=[decision('inspect_result',{'proposalId':'video-run'}),decision('record_result_review',{'inspectionId':'turn-a_s1','status':'passed','findings':['有限取样可读']}),decision()]
        original_turn=AssistantStore.turn
        def saved_turn(store,user,payload):
            turn=original_turn(store,user,payload)
            turn['nativeActions']=[proposal]
            return turn
        with patch.object(AssistantStore,'turn',new=saved_turn):
            await self.send()
        turn=await self.history();self.assertEqual(turn['steps'][0]['state'],'succeeded',turn['steps'][0])
        inspection=turn['steps'][0]['result']['resultInspection']
        self.assertEqual(inspection['hardStatus'],'passed');self.assertEqual(inspection['status'],'unknown')
        self.assertEqual(turn['steps'][1]['result']['review']['status'],'unknown')
        self.assertEqual(self.native_queries,[('video','canvas_video_trusted123'),('video','canvas_video_trusted123')])
        self.assertEqual(len(self.seen[1]['images']),3)

    async def test_smart_video_and_image_inspection_preserves_image_input(self):
        from PIL import Image
        from backend.canvas_assistant import node_reference_assets
        asset,_=self.video_asset(smart=True)
        Image.new('RGB',(20,16),'blue').save(Path(self.temp.name)/'review.png')
        self.canvas['nodes'].append({'id':'image','type':'smart-image','url':'/output/review.png'})
        image=next(item['id'] for item in node_reference_assets(self.canvas) if item['kind']=='image')
        self.responses=[decision('inspect_result',{'assetIds':[asset,image]}),decision()]
        await self.send();turn=await self.history()
        self.assertEqual(turn['steps'][0]['state'],'succeeded')
        self.assertIn('/output/review.png',self.seen[1]['images'])
        self.assertEqual(len(self.seen[1]['images']),4)

    async def test_video_review_rejects_changed_file(self):
        asset,video=self.video_asset()
        self.responses=[decision('inspect_result',{'assetIds':[asset]}),
                        decision('record_result_review',{'inspectionId':'turn-a_s1','status':'passed','findings':['合格']}),decision()]
        class Replace(list):
            def append(inner,fields):
                super().append(fields)
                if len(inner)==2:video.write_bytes(b'replaced video')
        self.seen=Replace()
        await self.send();turn=await self.history()
        self.assertEqual(turn['steps'][1]['state'],'failed')
        self.assertIn('变化',turn['steps'][1]['error'])

    async def test_video_review_rejects_missing_actual_frame_input(self):
        asset,_=self.video_asset()
        self.responses=[decision('inspect_result',{'assetIds':[asset]}),decision('read_canvas'),
                        decision('record_result_review',{'inspectionId':'turn-a_s1','status':'passed','findings':['合格']}),decision()]
        await self.send();turn=await self.history()
        self.assertEqual(turn['steps'][2]['state'],'failed')
        self.assertIn('实际读取',turn['steps'][2]['error'])

    async def test_video_text_only_model_gets_no_frames_and_cannot_record_visual_pass(self):
        asset,_=self.video_asset();self.providers[0]['supports_vision']=False
        self.responses=[decision('inspect_result',{'assetIds':[asset]}),
                        decision('record_result_review',{'inspectionId':'turn-a_s1','status':'passed','findings':['合格']}),decision()]
        await self.send();turn=await self.history()
        self.assertEqual(self.seen[1]['images'],[])
        self.assertEqual(turn['steps'][1]['state'],'failed')

    async def test_video_inspection_rejects_canvas_change_during_sampling(self):
        asset,_=self.video_asset()
        from backend.canvas_assistant_quality import inspect_videos
        def changed(*args,**kwargs):
            result=inspect_videos(*args,**kwargs)
            self.canvas=copy.deepcopy(self.canvas);self.canvas['readOnly']=True
            return result
        self.responses=[decision('inspect_result',{'assetIds':[asset]}),decision()]
        with patch('backend.canvas_assistant_quality.inspect_videos',side_effect=changed):
            await self.send()
        turn=await self.history();self.assertEqual(turn['steps'][0]['state'],'failed')
        self.assertIn('变化',turn['steps'][0]['error'])

    async def test_video_inspection_rejects_arbitrary_url_and_foreign_asset_id(self):
        self.responses=[decision('inspect_result',{'assetIds':['/output/arbitrary.mp4']}),decision()]
        with patch('backend.canvas_assistant_quality.inspect_videos') as inspect:
            await self.send()
        turn=await self.history();self.assertEqual(turn['steps'][0]['state'],'failed')
        inspect.assert_not_called()

    async def test_unreadable_video_preserves_hard_failure_without_visual_claim(self):
        from backend.canvas_assistant import node_reference_assets
        self.canvas['nodes']=[{'id':'video','type':'image','url':'/output/broken.mp4','mediaKind':'video'}]
        Path(self.temp.name,'broken.mp4').write_bytes(b'not a video')
        asset=node_reference_assets(self.canvas)[0]['id']
        self.responses=[decision('inspect_result',{'assetIds':[asset]}),
                        decision('record_result_review',{'inspectionId':'turn-a_s1','status':'unknown','findings':['文件无法读取']}),decision()]
        await self.send();turn=await self.history()
        self.assertEqual(turn['steps'][0]['state'],'succeeded')
        self.assertEqual(self.seen[1]['images'],[])
        review=turn['steps'][1]['result']['review']
        self.assertEqual(review['status'],'needs_changes')
        self.assertEqual(review['visualStatus'],'unknown')
        self.assertEqual(review['videos'][0]['errorCode'],'unsupported_video')

    async def test_video_sampling_limit_rejects_before_reading_any_file(self):
        from backend.canvas_assistant import node_reference_assets
        self.canvas['nodes']=[{'id':str(i),'type':'image','url':f'/output/{i}.mp4','mediaKind':'video'} for i in range(3)]
        self.responses=[decision('inspect_result',{'assetIds':[a['id'] for a in node_reference_assets(self.canvas)]}),decision()]
        with patch('backend.canvas_assistant_quality.inspect_videos') as inspect:
            await self.send()
        turn=await self.history();self.assertEqual(turn['steps'][0]['state'],'failed')
        self.assertIn('不超过8',turn['steps'][0]['error'])
        inspect.assert_not_called()

    async def test_user_plan_service_limit_is_persisted_without_running_or_charging(self):
        self.responses=[decision('create_plan',{'goal':'读取后等待','steps':[{'id':'read','description':'读取画布'}]}),decision()]
        await self.send();before=(await self.history())['agent']['plan']
        body={'canvasId':'canvas-a','sessionId':self.session,'requestId':'turn-a','total':2}
        for _ in range(2):
            result=await self.client.post('/api/canvas-assistant/plan/budget',json=body)
            self.assertEqual(result.status_code,200,result.text)
        turn=await self.history();plan=turn['agent']['plan']
        self.assertEqual(plan['budget']['limit']['serviceCalls'],2)
        self.assertEqual(plan['budget']['used'],before['budget']['used'])
        self.assertEqual(plan['budget']['events'],before['budget']['events'])
        self.assertEqual(plan['steps'],before['steps'])
        self.assertEqual(len(turn['serviceBudgetAuthorizations']),1)
        self.assertFalse(self.tasks)
        for total in (True,2.5,101,-1):
            invalid=await self.client.post('/api/canvas-assistant/plan/budget',json={**body,'total':total})
            self.assertEqual(invalid.status_code,422)
        other=await self.client.post('/api/canvas-assistant/plan/budget',json=body,headers={'X-User-Id':'other'})
        self.assertNotEqual(other.status_code,200)

    async def test_result_review_text_only_model_cannot_record_visual_pass(self):
        from PIL import Image
        from backend.canvas_assistant import node_reference_assets
        Image.new('RGB',(72,48)).save(Path(self.temp.name)/'review.png')
        self.canvas['nodes']=[{'id':'image','type':'image','url':'/output/review.png'}]
        asset=node_reference_assets(self.canvas)[0]['id'];self.providers[0]['supports_vision']=False
        self.responses=[decision('inspect_result',{'assetIds':[asset]}),decision('record_result_review',{'inspectionId':'turn-a_s1','status':'passed','findings':['合格']}),decision()]
        await self.send();turn=await self.history()
        self.assertEqual(self.seen[1]['images'],[])
        self.assertEqual(turn['steps'][1]['state'],'failed')
        self.assertIn('未实际读取',turn['steps'][1]['error'])

    async def test_operation_result_reaches_next_decision_and_preserves_actual_node(self):
        self.responses = [decision("apply_canvas_operations", {"operations": [
            {"op": "create", "operationId": "make", "ref": "p", "type": "prompt", "title": "海报", "content": "柔和晨光"}]}), decision("read_canvas"), decision(reply="已核对画布中的海报提示词")]
        events = await self.send()
        self.assertEqual(events[-1]["state"], "completed")
        self.assertEqual(len(self.canvas["nodes"]), 1)
        self.assertEqual(self.canvas["nodes"][0]["text"], "柔和晨光")
        self.assertEqual(len(self.seen), 3)
        self.assertIn(self.canvas["nodes"][0]["id"], json.dumps(self.seen[1], ensure_ascii=False))
        turn = await self.history()
        self.assertEqual(turn["reply"], "已核对画布中的海报提示词")
        self.assertEqual(turn["agent"]["modelCalls"], 3)
        self.assertEqual([s["state"] for s in turn["steps"]], ["succeeded", "succeeded"])

    async def test_create_plan_is_persisted_in_agent_state_with_trusted_budget(self):
        self.responses = [
            decision("create_plan", {
                "goal": "完成海报并核对结果",
                "steps": [
                    {"id": "read", "description": "读取画布", "dependsOn": []},
                    {"id": "create", "description": "创建海报节点", "dependsOn": ["read"]},
                ],
                "preserve": ["保留原有节点"],
                "requirements": ["只使用已选择模型"],
            }),
            decision(reply="计划已保存，等待按步骤执行"),
        ]
        events = await self.send()
        self.assertEqual(events[-1]["state"], "paused")
        turn = await self.history()
        plan = turn["agent"]["plan"]
        self.assertEqual(plan["goal"], "完成海报并核对结果")
        self.assertEqual([step["id"] for step in plan["steps"]], ["read", "create"])
        self.assertEqual(plan["budget"]["limit"], {"modelCalls": 6, "toolCalls": 8, "serviceCalls": 0, "activeSeconds": 900})
        self.assertEqual(turn["steps"][0]["state"], "succeeded")

    async def test_plan_steps_follow_dependencies_and_actual_receipts(self):
        self.responses = [decision('create_plan', {'goal': '读取后修改正文', 'steps': [
            {'id': 'read', 'description': '读取画布'},
            {'id': 'edit', 'description': '修改正文', 'dependsOn': ['read']}]}),
            decision('execute_plan_step', {'stepId': 'read', 'tool': 'read_canvas', 'arguments': {}}),
            decision('execute_plan_step', {'stepId': 'edit', 'tool': 'apply_canvas_operations', 'arguments': {'operations': [
                {'op': 'create', 'operationId': 'p', 'ref': 'p', 'type': 'prompt', 'content': '已保存的中文'}]}}),
            decision(reply='已按计划完成')]
        with patch('backend.canvas_assistant.ProjectKnowledge.changed', return_value=False):
            events = await self.send()
        self.assertEqual(events[-1]['state'], 'completed', events[-1])
        plan = (await self.history())['agent']['plan']
        self.assertEqual(plan['state'], 'completed')
        self.assertEqual([s['state'] for s in plan['steps']], ['completed', 'completed'])
        self.assertEqual(plan['steps'][1]['receipt']['nodeIds'], [self.canvas['nodes'][0]['id']])
        self.assertEqual(plan['budget']['used']['modelCalls'], 3)
        self.assertEqual(plan['budget']['used']['toolCalls'], 3)

    async def test_plan_cannot_complete_by_model_prose_or_skip_dependencies(self):
        self.responses = [decision('create_plan', {'goal': '有依赖', 'steps': [
            {'id': 'read', 'description': '读取'}, {'id': 'edit', 'description': '修改', 'dependsOn': ['read']}]}),
            decision('execute_plan_step', {'stepId': 'edit', 'tool': 'read_canvas', 'arguments': {}}),
            decision(reply='已经全部完成')]
        events = await self.send()
        self.assertEqual(events[-1]['state'], 'paused')
        plan = (await self.history())['agent']['plan']
        self.assertEqual([s['state'] for s in plan['steps']], ['pending', 'pending'])
        self.assertEqual(plan['state'], 'paused')

    async def test_plan_native_edit_records_saved_effect_then_continues(self):
        self.canvas['nodes'] = [{'id':'p','type':'prompt','text':'旧正文'}]
        self.responses = [decision('create_plan', {'goal':'修改', 'steps':[{'id':'edit','description':'修改正文'}]}),
            decision('execute_plan_step', {'stepId':'edit','tool':'propose_native_action','arguments':{'action':'update','nodeId':'p','patch':{'text':'计划中文正文'}}}),
            decision(reply='已完成')]
        with patch('backend.canvas_assistant.ProjectKnowledge.changed',return_value=False):
            self.assertEqual((await self.send())[-1]['state'],'waiting_confirmation')
            turn = await self.history()
            proposal = turn['nativeActions'][0]
            body = {'canvasId':'canvas-a','sessionId':self.session,'turnId':'turn-a','actionId':proposal['id']}
            self.assertTrue((await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'confirm'})).json()['canExecute'])
            self.canvas['nodes'][0]['text']='计划中文正文'
            self.canvas['updated_at']+=1
            finished = await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'finish'})
            self.assertEqual(finished.status_code,200,finished.text)
            self.assertEqual((await self.history())['agent']['plan']['state'],'completed')
            continued = await self.client.post('/api/canvas-assistant/continue',json={'canvasId':'canvas-a','sessionId':self.session,'requestId':'turn-a'})
        events = [json.loads(line) for line in continued.text.splitlines()]
        self.assertEqual(events[-1]['state'],'completed',events[-1])

    async def test_plan_llm_saved_receipt_unlocks_next_step_without_fake_task_or_replay(self):
        self.canvas['nodes']=[{'id':'llm','type':'llm','userInput':'原文','llmProvider':'mock','model':'chat'}]
        self.responses=[decision('create_plan',{'goal':'改写再读取','steps':[{'id':'run','description':'改写'},{'id':'next','description':'读取','dependsOn':['run']}]}),
            decision('execute_plan_step',{'stepId':'run','tool':'propose_native_action','arguments':{'action':'run','nodeId':'llm','maxCalls':1}})]
        await self.send();p=(await self.history())['nativeActions'][0]
        body={'canvasId':'canvas-a','sessionId':self.session,'turnId':'turn-a','actionId':p['id']}
        budget=await self.client.post('/api/canvas-assistant/plan/budget',json={'canvasId':'canvas-a','sessionId':self.session,'requestId':'turn-a','total':1})
        self.assertEqual(budget.status_code,200,budget.text)
        with patch('backend.canvas_assistant.ProjectKnowledge.changed',return_value=False):
            response=await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'confirm'})
        self.assertEqual(response.status_code,200,response.text)
        n=self.canvas['nodes'][0];n.update(outputText='完成原文改写',assistantNativeRun={'actionId':p['id'],'taskKind':'llm','taskIds':[],'status':'succeeded','outputText':'完成原文改写'})
        finished=await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'finish'})
        self.assertEqual(finished.status_code,200,finished.text)
        turn=await self.history();plan=turn['agent']['plan'];self.assertEqual(plan['steps'][0]['state'],'completed');self.assertEqual(plan['steps'][0]['receipt']['tasks'],[])
        self.assertEqual(plan['budget']['used']['serviceCalls'],1);self.assertIn('outputHash',plan['steps'][0]['receipt']['synchronousEvidence'])
        self.responses=[decision('execute_plan_step',{'stepId':'next','tool':'read_canvas','arguments':{}})]
        continued=await self.client.post('/api/canvas-assistant/continue',json={'canvasId':'canvas-a','sessionId':self.session,'requestId':'turn-a'})
        self.assertEqual(continued.status_code,200,continued.text)
        self.assertEqual((await self.history())['agent']['plan']['state'],'completed');self.assertEqual(self.native_queries,[])

    async def test_plan_rh_original_task_receipt_completes_and_survives_continue(self):
        node={'id':'rh','type':'rh','rhMode':'app','rhConfigKey':'app:user-app','webappId':'user-app','apiProvider':'runninghub','count':1,'outputEnabled':True,'rhParams':{'12::steps':{'value':'20'}},'rhAppInfo':{'nodeInfoList':[{'nodeId':'12','fieldName':'steps','fieldType':'INT'}]}}
        out={'id':'out','type':'output','images':[]};self.canvas['nodes']=[node,out];self.canvas['connections']=[{'from':'rh','to':'out'}]
        self.responses=[decision('create_plan',{'goal':'RH并读取','steps':[{'id':'run','description':'RH运行'},{'id':'next','description':'读取','dependsOn':['run']}]}),decision('execute_plan_step',{'stepId':'run','tool':'propose_native_action','arguments':{'action':'run','nodeId':'rh','maxCalls':1}})]
        await self.send();p=(await self.history())['nativeActions'][0]
        body={'canvasId':'canvas-a','sessionId':self.session,'turnId':'turn-a','actionId':p['id']}
        budget=await self.client.post('/api/canvas-assistant/plan/budget',json={'canvasId':'canvas-a','sessionId':self.session,'requestId':'turn-a','total':1});self.assertEqual(budget.status_code,200,budget.text)
        with patch('backend.canvas_assistant.ProjectKnowledge.changed',return_value=False):confirm=await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'confirm'})
        self.assertEqual(confirm.status_code,200,confirm.text)
        node['assistantNativeRun']={'actionId':p['id'],'taskKind':'runninghub','taskIds':['rh-original'],'inputHash':p['runInputHash'],'outputNodeId':'out','status':'succeeded','resultUrls':['/output/current.png']};out['images']=[{'url':'/output/current.png'}]
        done=await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'finish'});self.assertEqual(done.status_code,200,done.text)
        self.assertEqual((await self.history())['agent']['plan']['steps'][0]['receipt']['tasks'],[{'kind':'runninghub','id':'rh-original'}])
        self.responses=[decision('execute_plan_step',{'stepId':'next','tool':'read_canvas','arguments':{}})]
        continued=await self.client.post('/api/canvas-assistant/continue',json={'canvasId':'canvas-a','sessionId':self.session,'requestId':'turn-a'});self.assertEqual(continued.status_code,200,continued.text)
        self.assertEqual((await self.history())['agent']['plan']['state'],'completed');self.assertEqual(self.native_queries,[])

    async def test_plan_native_run_default_zero_budget_blocks_confirmation(self):
        self.canvas['nodes']=[{'id':'g','type':'generator','apiProvider':'mock','model':'image','count':1}]
        self.responses=[decision('create_plan',{'goal':'生成','steps':[{'id':'run','description':'运行'}]}),
            decision('execute_plan_step',{'stepId':'run','tool':'propose_native_action','arguments':{'action':'run','nodeId':'g','maxCalls':1}})]
        with patch('backend.canvas_assistant.ProjectKnowledge.changed',return_value=False):
            self.assertEqual((await self.send())[-1]['state'],'waiting_confirmation')
            turn=await self.history()
            response=await self.client.post('/api/canvas-assistant/native/action',json={'canvasId':'canvas-a','sessionId':self.session,'turnId':'turn-a','actionId':turn['nativeActions'][0]['id'],'action':'confirm'})
        self.assertEqual(response.status_code,409,response.text)
        turn=await self.history()
        self.assertEqual(turn['nativeActions'][0]['state'],'pending')
        self.assertEqual(turn['agent']['plan']['budget']['used']['serviceCalls'],0)

    async def test_plan_pause_resume_keeps_budget_and_completed_steps(self):
        self.responses=[decision('create_plan',{'goal':'两步读取','steps':[{'id':'a','description':'读画布'},{'id':'b','description':'再读','dependsOn':['a']}]}),
            decision('execute_plan_step',{'stepId':'a','tool':'read_canvas','arguments':{}}),decision(reply='暂时结束')]
        self.assertEqual((await self.send())[-1]['state'],'paused')
        before=(await self.history())['agent']['plan']
        self.responses=[decision('execute_plan_step',{'stepId':'b','tool':'read_canvas','arguments':{}}),decision(reply='完成')]
        result=await self.client.post('/api/canvas-assistant/continue',json={'canvasId':'canvas-a','sessionId':self.session,'requestId':'turn-a'})
        events=[json.loads(line) for line in result.text.splitlines()]
        self.assertEqual(events[-1]['state'],'completed',events[-1])
        after=(await self.history())['agent']['plan']
        self.assertEqual(after['steps'][0],before['steps'][0])
        self.assertEqual(after['budget']['used']['modelCalls'],4)
        self.assertEqual(after['budget']['used']['toolCalls'],3)

    async def test_plan_stop_preserves_state_and_disallows_resume(self):
        self.responses=[decision('create_plan',{'goal':'读取','steps':[{'id':'a','description':'读'}]}),decision(reply='稍后执行')]
        await self.send()
        await self.client.post('/api/canvas-assistant/cancel',json={'canvasId':'canvas-a','sessionId':self.session,'requestId':'turn-a'})
        turn=await self.history()
        self.assertEqual(turn['agent']['plan']['state'],'cancelled')
        self.assertEqual(turn['agent']['plan']['budget']['used']['modelCalls'],2)
        result=await self.client.post('/api/canvas-assistant/continue',json={'canvasId':'canvas-a','sessionId':self.session,'requestId':'turn-a'})
        self.assertEqual(result.status_code,409)

    async def test_plan_native_first_step_allows_next_step_on_continue(self):
        self.canvas['nodes']=[{'id':'p','type':'prompt','text':'旧'}]
        self.responses=[decision('create_plan',{'goal':'修改再读','steps':[{'id':'edit','description':'修改'},{'id':'read','description':'读回','dependsOn':['edit']}]}),
            decision('execute_plan_step',{'stepId':'edit','tool':'propose_native_action','arguments':{'action':'update','nodeId':'p','patch':{'text':'新'}}}),
            decision('execute_plan_step',{'stepId':'read','tool':'read_canvas','arguments':{}}),decision(reply='完成')]
        with patch('backend.canvas_assistant.ProjectKnowledge.changed',return_value=False):
            await self.send()
            turn=await self.history()
            body={'canvasId':'canvas-a','sessionId':self.session,'turnId':'turn-a','actionId':turn['nativeActions'][0]['id']}
            await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'confirm'})
            self.canvas['nodes'][0]['text']='新';self.canvas['updated_at']+=1
            await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'finish'})
            result=await self.client.post('/api/canvas-assistant/continue',json={'canvasId':'canvas-a','sessionId':self.session,'requestId':'turn-a'})
        self.assertEqual(result.status_code,200,result.text)
        self.assertEqual([json.loads(l) for l in result.text.splitlines()][-1]['state'],'completed')

    async def test_plan_existing_task_refresh_preserves_original_without_new_service_budget(self):
        self.canvas['nodes']=[{'id':'out','type':'output','_pending':[{'canvasTaskType':'online-image','canvasTaskId':'old','status':'query-paused'}]}]
        self.native_tasks[('image','old')]={'task_id':'old','status':'interrupted','result':{'images':['/output/result.png']}}
        self.responses=[decision('create_plan',{'goal':'查询原任务','steps':[{'id':'query','description':'刷新原任务'}]}),
            decision('execute_plan_step',{'stepId':'query','tool':'propose_native_action','arguments':{'action':'task_refresh','nodeId':'out','taskKind':'image','taskId':'old'}})]
        with patch('backend.canvas_assistant.ProjectKnowledge.changed',return_value=False):
            await self.send()
            turn=await self.history()
            body={'canvasId':'canvas-a','sessionId':self.session,'turnId':'turn-a','actionId':turn['nativeActions'][0]['id'],'action':'confirm'}
            result=await self.client.post('/api/canvas-assistant/native/action',json=body)
        self.assertEqual(result.status_code,200,result.text)
        plan=(await self.history())['agent']['plan']
        self.assertEqual(plan['state'],'completed')
        self.assertEqual(plan['steps'][0]['receipt']['tasks'],[{'kind':'image','id':'old'}])
        self.assertEqual(plan['budget']['used']['serviceCalls'],0)
        self.assertEqual(len(self.native_controls),1)

    async def test_plan_recovers_atomic_write_receipt_without_replaying_operation(self):
        self.responses=[decision('create_plan',{'goal':'创建后读回','steps':[{'id':'edit','description':'创建'},{'id':'read','description':'核对','dependsOn':['edit']}]}),
            decision('execute_plan_step',{'stepId':'edit','tool':'apply_canvas_operations','arguments':{'operations':[{'op':'create','operationId':'p','ref':'p','type':'prompt','content':'保存但回执尚未记入计划'}]}}),decision(reply='稍后继续')]
        with patch('backend.canvas_assistant.ProjectKnowledge.changed',return_value=False):
            await self.send()
        store=AssistantStore(lambda:self.temp.name)
        def crash_window(doc):
            turn=doc['sessions'][self.session]['turns'][0]
            turn['state']='interrupted'
            plan=turn['agent']['plan'];plan.update(state='interrupted',stopReason='interrupted',executionId='')
            plan['steps'][0].update(state='unknown',receipt=None)
        store.transact('owner','canvas-a',crash_window)
        self.responses=[decision('execute_plan_step',{'stepId':'read','tool':'read_canvas','arguments':{}}),decision(reply='完成')]
        result=await self.client.post('/api/canvas-assistant/continue',json={'canvasId':'canvas-a','sessionId':self.session,'requestId':'turn-a'})
        self.assertEqual(result.status_code,200,result.text)
        self.assertEqual([json.loads(l) for l in result.text.splitlines()][-1]['state'],'completed')
        self.assertEqual(len(self.canvas['nodes']),1)
        self.assertEqual((await self.history())['agent']['plan']['steps'][0]['receipt']['nodeIds'],[self.canvas['nodes'][0]['id']])

    async def test_plan_finishes_when_last_step_uses_last_model_call(self):
        steps=[{'id':f's{i}','description':'读取画布','dependsOn':[f's{i-1}'] if i else []} for i in range(5)]
        self.responses=[decision('create_plan',{'goal':'五步读取','steps':steps})]+[
            decision('execute_plan_step',{'stepId':f's{i}','tool':'read_canvas','arguments':{}}) for i in range(5)]
        events=await self.send()
        self.assertEqual(events[-1]['state'],'completed')
        self.assertEqual(len(self.seen),6)

    async def test_plan_smaller_trusted_budget_pauses_before_extra_model_request(self):
        self.responses=[decision('create_plan',{'goal':'两步','steps':[{'id':'a','description':'读'},{'id':'b','description':'再读','dependsOn':['a']}]}),
            decision('execute_plan_step',{'stepId':'a','tool':'read_canvas','arguments':{}}),decision(reply='不应调用')]
        with patch('backend.canvas_assistant_plan.DEFAULT_LIMITS',{'modelCalls':2,'toolCalls':8,'serviceCalls':0,'activeSeconds':900}):
            events=await self.send()
        self.assertEqual(events[-1]['state'],'paused')
        self.assertEqual(len(self.seen),2)
        plan=(await self.history())['agent']['plan']
        self.assertEqual(plan['state'],'paused')
        self.assertEqual(plan['budget']['used']['modelCalls'],2)

    async def test_native_proposal_claim_saved_effect_and_receipt_continue_real_route(self):
        self.canvas['nodes'] = [{'id': 'loop', 'type': 'smart-loop', 'variablePrompts': ['原字段'], 'variablePrompt': '原字段'}]
        self.canvas['kind'] = 'smart'
        values = ['第一字段\n内部换行', '', '第二字段']
        self.responses = [decision('propose_native_action', {'action': 'loop_prompts', 'nodeId': 'loop', 'values': values}), decision(reply='已核对保存的循环字段')]
        events = await self.send()
        self.assertEqual(events[-1]['state'], 'waiting_confirmation')
        turn = await self.history()
        action = turn['nativeActions'][0]
        body = {'canvasId': 'canvas-a', 'sessionId': self.session, 'turnId': 'turn-a', 'actionId': action['id'], 'action': 'confirm'}
        claimed = await self.client.post('/api/canvas-assistant/native/action', json=body)
        self.assertEqual(claimed.status_code, 200, claimed.text)
        self.assertTrue(claimed.json()['canExecute'])
        duplicate = await self.client.post('/api/canvas-assistant/native/action', json=body)
        self.assertFalse(duplicate.json()['canExecute'])
        forged = await self.client.post('/api/canvas-assistant/native/action', json={**body, 'action': 'finish'})
        self.assertEqual(forged.status_code, 409, forged.text)
        self.canvas['nodes'][0].update(variablePrompts=values, variablePrompt='\n'.join(filter(None, values)))
        self.canvas['updated_at'] += 1
        saved = await self.client.post('/api/canvas-assistant/native/action', json={**body, 'action': 'finish'})
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(saved.json()['proposal']['state'], 'completed')
        continued = await self.client.post('/api/canvas-assistant/continue', json={'canvasId': 'canvas-a', 'sessionId': self.session, 'requestId': 'turn-a'})
        self.assertIn('"state": "completed"', continued.text)
        self.assertIn('第一字段', json.dumps(self.seen[-1], ensure_ascii=False))
        self.assertEqual(len(self.seen), 2)

    async def test_native_confirmation_rejects_changed_canvas_and_cancelled_turn(self):
        self.canvas['nodes'] = [{'id': 'p', 'type': 'prompt', 'text': '原文'}]
        self.responses = [decision('propose_native_action', {'action': 'update', 'nodeId': 'p', 'patch': {'text': '新文'}})]
        await self.send()
        action = (await self.history())['nativeActions'][0]
        body = {'canvasId': 'canvas-a', 'sessionId': self.session, 'turnId': 'turn-a', 'actionId': action['id'], 'action': 'confirm'}
        self.canvas['nodes'][0]['text'] = '手动修改'
        conflict = await self.client.post('/api/canvas-assistant/native/action', json=body)
        self.assertEqual(conflict.status_code, 409)
        await self.client.post('/api/canvas-assistant/cancel', json={'canvasId': 'canvas-a', 'sessionId': self.session, 'requestId': 'turn-a'})
        cancelled = await self.client.post('/api/canvas-assistant/native/action', json=body)
        self.assertEqual(cancelled.status_code, 409)

    async def test_native_confirmation_and_execution_recheck_knowledge_drift(self):
        self.canvas['nodes']=[{'id':'p','type':'prompt','text':'before'}]
        self.responses=[decision('propose_native_action',{'action':'update','nodeId':'p','patch':{'text':'after'}})]
        await self.send()
        action=(await self.history())['nativeActions'][0]
        body={'canvasId':'canvas-a','sessionId':self.session,'turnId':'turn-a','actionId':action['id']}
        with patch('backend.canvas_assistant.ProjectKnowledge.changed',return_value=True):
            rejected=await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'confirm'})
        self.assertEqual(rejected.status_code,409,rejected.text)
        self.assertEqual((await self.history())['nativeActions'][0]['state'],'pending')
        accepted=await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'confirm'})
        self.assertTrue(accepted.json()['canExecute'])
        with patch('backend.canvas_assistant.ProjectKnowledge.changed',return_value=True):
            rejected=await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'check'})
        self.assertEqual(rejected.status_code,409,rejected.text)
        self.assertEqual(self.canvas['nodes'][0]['text'],'before')

    async def test_native_refresh_confirmed_once_queries_original_task_on_reopen(self):
        self.canvas['nodes']=[{'id':'out','type':'output','_pending':[{'canvasTaskType':'online-image','canvasTaskId':'old','status':'query-paused'}]}]
        self.native_tasks[('image','old')]={'task_id':'old','status':'interrupted','result':{'images':['/output/result.png']},'api_key':'hidden'}
        self.responses=[decision('propose_native_action',{'action':'task_refresh','nodeId':'out','taskKind':'image','taskId':'old'}),decision(reply='已读取原任务结果')]
        await self.send()
        action=(await self.history())['nativeActions'][0]
        body={'canvasId':'canvas-a','sessionId':self.session,'turnId':'turn-a','actionId':action['id'],'action':'confirm'}
        first=await self.client.post('/api/canvas-assistant/native/action',json=body)
        self.assertEqual(first.status_code,200,first.text);self.assertFalse(first.json()['canExecute'])
        self.assertEqual(first.json()['proposal']['receipt']['task']['status'],'succeeded')
        duplicate=await self.client.post('/api/canvas-assistant/native/action',json=body)
        self.assertEqual(duplicate.status_code,200,duplicate.text)
        self.assertEqual(self.native_controls,[('task_refresh','image','old')]);self.assertEqual(self.tasks,{})
        self.assertNotIn('hidden',first.text)
        continued=await self.client.post('/api/canvas-assistant/continue',json={'canvasId':'canvas-a','sessionId':self.session,'requestId':'turn-a'})
        self.assertIn('"state": "completed"',continued.text);self.assertIn('/output/result.png',self.seen[-1]['message'])

    async def test_native_control_two_confirmers_do_not_repeat_remote_action(self):
        self.canvas['nodes']=[{'id':'depth','type':'image','depthCapture':{'taskId':'old','status':'running','sourceUrl':'/output/source.mp4','operationId':'op'}}]
        self.native_tasks[('depth','old')]={'id':'old','status':'running','source_url':'/output/source.mp4','operation_id':'op'}
        self.responses=[decision('propose_native_action',{'action':'task_cancel','nodeId':'depth','taskKind':'depth','taskId':'old'})]
        await self.send()
        action=(await self.history())['nativeActions'][0]
        body={'canvasId':'canvas-a','sessionId':self.session,'turnId':'turn-a','actionId':action['id'],'action':'confirm'}
        self.native_control_gate=asyncio.Event()
        first=asyncio.create_task(self.client.post('/api/canvas-assistant/native/action',json=body))
        await asyncio.wait_for(self.native_control_started.wait(),5)
        duplicate=await self.client.post('/api/canvas-assistant/native/action',json=body)
        self.assertEqual(duplicate.status_code,200,duplicate.text);self.assertFalse(duplicate.json()['canExecute'])
        self.native_control_gate.set()
        done=await first
        self.assertEqual(done.json()['proposal']['receipt']['task']['status'],'cancelled')
        self.assertEqual(self.native_controls,[('task_cancel','depth','old')])

    async def test_native_cancel_ack_running_waits_and_queries_same_task_without_second_cancel(self):
        self.canvas['nodes']=[{'id':'depth','type':'image','depthCapture':{'taskId':'old','status':'running','sourceUrl':'/output/source.mp4','operationId':'op'}}]
        self.native_tasks[('depth','old')]={'id':'old','status':'running','source_url':'/output/source.mp4','operation_id':'op'}
        self.native_control_status='running'
        self.responses=[decision('propose_native_action',{'action':'task_cancel','nodeId':'depth','taskKind':'depth','taskId':'old'})]
        await self.send()
        action=(await self.history())['nativeActions'][0]
        body={'canvasId':'canvas-a','sessionId':self.session,'turnId':'turn-a','actionId':action['id'],'action':'confirm'}
        first=await self.client.post('/api/canvas-assistant/native/action',json=body)
        self.assertEqual(first.json()['proposal']['state'],'executing')
        waiting=await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'query'})
        self.assertEqual(waiting.json()['proposal']['state'],'executing')
        self.native_tasks[('depth','old')]['status']='cancelled'
        done=await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'query'})
        self.assertEqual(done.json()['proposal']['state'],'completed')
        self.assertEqual(self.native_controls,[('task_cancel','depth','old')])
        self.assertEqual(self.native_queries,[('depth','old'),('depth','old')])

    async def test_native_run_uses_original_tasks_and_requires_saved_real_outputs(self):
        self.canvas['nodes']=[{'id':'g','type':'generator','count':1,'apiProvider':'mock','model':'image'}]
        self.responses=[decision('propose_native_action',{'action':'run','nodeId':'g','maxCalls':1}),decision(reply='已读取真实运行结果')]
        await self.send()
        action=(await self.history())['nativeActions'][0]
        body={'canvasId':'canvas-a','sessionId':self.session,'turnId':'turn-a','actionId':action['id'],'action':'confirm'}
        confirmed=await self.client.post('/api/canvas-assistant/native/action',json=body)
        self.assertTrue(confirmed.json()['canExecute'])
        self.canvas['nodes'][0]['assistantNativeRun']={'actionId':action['id'],'taskKind':'image','taskIds':['original']}
        self.native_tasks[('image','original')]={'task_id':'original','status':'running'}
        waiting=await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'finish'})
        self.assertEqual(waiting.json()['proposal']['state'],'accepted')
        self.native_tasks[('image','original')].update(status='succeeded',result={'images':['/output/real.png']})
        missing=await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'query'})
        self.assertEqual(missing.json()['proposal']['state'],'accepted')
        self.canvas['nodes'][0]['generatedOutputs']=['/output/real.png']
        done=await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'query'})
        self.assertEqual(done.json()['proposal']['state'],'completed')
        self.assertEqual(self.native_queries,[('image','original')]*3)
        self.assertEqual(self.native_controls,[]);self.assertEqual(self.tasks,{})
        continued=await self.client.post('/api/canvas-assistant/continue',json={'canvasId':'canvas-a','sessionId':self.session,'requestId':'turn-a'})
        self.assertIn('"state": "completed"',continued.text);self.assertIn('/output/real.png',self.seen[-1]['message'])

    async def test_smart_prompt_run_route_confirm_finish_restore_and_continue(self):
        self.canvas['kind']='smart'
        self.canvas['nodes']=[{'id':'p','type':'smart-prompt','text':'原文','llmEnabled':True,'llmProvider':'mock','llmModel':'chat'}]
        self.responses=[decision('propose_native_action',{'action':'run','nodeId':'p','maxCalls':1}),decision(reply='已核对保存的智能改写正文')]
        await self.send()
        action=(await self.history())['nativeActions'][0]
        body={'canvasId':'canvas-a','sessionId':self.session,'turnId':'turn-a','actionId':action['id']}
        first=await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'confirm'})
        self.assertTrue(first.json()['canExecute'])
        duplicate=await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'confirm'})
        self.assertFalse(duplicate.json()['canExecute'])
        check=await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'check'})
        self.assertTrue(check.json()['canExecute'])
        node=self.canvas['nodes'][0]
        node.update(text='已保存的智能 LLM 正文',assistantNativeRun={'actionId':action['id'],'taskKind':'llm','taskIds':[],'status':'succeeded','outputText':'已保存的智能 LLM 正文'})
        done=await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'finish'})
        self.assertEqual(done.status_code,200,done.text)
        self.assertEqual(done.json()['proposal']['state'],'completed')
        restored=(await self.history())['nativeActions'][0]
        self.assertEqual(restored['receipt']['outputText'],node['text'])
        self.assertEqual(restored['runSettings']['model'],'chat')
        continued=await self.client.post('/api/canvas-assistant/continue',json={'canvasId':'canvas-a','sessionId':self.session,'requestId':'turn-a'})
        self.assertIn('"state": "completed"',continued.text)
        self.assertIn('已保存的智能 LLM 正文',self.seen[-1]['message'])
        self.assertEqual(self.native_queries,[])

    async def test_smart_image_run_route_confirm_finish_restore_and_continue_keeps_model(self):
        self.canvas['kind']='smart'
        node={'id':'image','type':'smart-image','images':[],
              'runSettings':{'engine':'api','apiKind':'image','provider_id':'mock','model':'image','count':1}}
        self.canvas['nodes']=[node]
        self.responses=[decision('propose_native_action',{'action':'run','nodeId':'image','maxCalls':1}),decision(reply='已核对智能图片原任务')]
        await self.send()
        action=(await self.history())['nativeActions'][0]
        body={'canvasId':'canvas-a','sessionId':self.session,'turnId':'turn-a','actionId':action['id']}
        confirmed=await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'confirm'})
        self.assertEqual(confirmed.status_code,200,confirmed.text);self.assertTrue(confirmed.json()['canExecute'])
        check=await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'check'})
        self.assertEqual(check.status_code,200,check.text);self.assertTrue(check.json()['canExecute'])
        node.update(assistantNativeRun={'actionId':action['id'],'taskKind':'image','taskIds':['smart-original']},
                    images=[{'url':'/output/smart-original.png','kind':'image'}])
        self.native_tasks[('image','smart-original')]={'task_id':'smart-original','status':'succeeded','result':{'images':['/output/smart-original.png']}}
        done=await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'finish'})
        self.assertEqual(done.status_code,200,done.text);self.assertEqual(done.json()['proposal']['state'],'completed')
        restored=(await self.history())['nativeActions'][0]
        self.assertEqual(restored['receipt']['taskIds'],['smart-original'])
        self.assertEqual(restored['runSettings']['model'],'image')
        self.assertEqual(restored['runSettings']['provider'],'mock')
        continued=await self.client.post('/api/canvas-assistant/continue',json={'canvasId':'canvas-a','sessionId':self.session,'requestId':'turn-a'})
        self.assertIn('"state": "completed"',continued.text)
        self.assertIn('/output/smart-original.png',self.seen[-1]['message'])
        self.assertEqual(node['runSettings']['model'],'image')
        self.assertEqual(self.native_queries,[('image','smart-original')]);self.assertEqual(self.tasks,{})

    async def test_native_control_does_not_land_response_on_changed_depth_source(self):
        self.canvas['nodes']=[{'id':'depth','type':'image','depthCapture':{'taskId':'old','status':'running','sourceUrl':'/output/source.mp4','operationId':'op'}}]
        self.native_tasks[('depth','old')]={'id':'old','status':'running'}
        self.responses=[decision('propose_native_action',{'action':'task_cancel','nodeId':'depth','taskKind':'depth','taskId':'old'})]
        await self.send()
        action=(await self.history())['nativeActions'][0]
        self.native_control_hook=lambda:self.canvas['nodes'][0]['depthCapture'].update(sourceUrl='/output/new.mp4')
        result=await self.client.post('/api/canvas-assistant/native/action',json={'canvasId':'canvas-a','sessionId':self.session,'turnId':'turn-a','actionId':action['id'],'action':'confirm'})
        self.assertEqual(result.status_code,409,result.text)
        self.assertEqual((await self.history())['nativeActions'][0]['state'],'executing')

    async def test_native_task_control_changed_reference_is_rejected_before_call(self):
        self.canvas['nodes']=[{'id':'out','type':'output','_pending':[{'canvasTaskType':'video','canvasTaskId':'old'}]}]
        self.responses=[decision('propose_native_action',{'action':'task_refresh','nodeId':'out','taskKind':'video','taskId':'old'})]
        await self.send()
        action=(await self.history())['nativeActions'][0]
        self.canvas['nodes'][0]['_pending'][0]['canvasTaskId']='new'
        result=await self.client.post('/api/canvas-assistant/native/action',json={'canvasId':'canvas-a','sessionId':self.session,'turnId':'turn-a','actionId':action['id'],'action':'confirm'})
        self.assertEqual(result.status_code,409,result.text);self.assertEqual(self.native_controls,[])

    async def test_read_native_task_only_queries_persisted_current_node_task(self):
        self.canvas['nodes']=[{'id':'depth','type':'image','depthCapture':{'taskId':'original-depth','operationId':'op','sourceUrl':'/output/video.mp4','status':'running'}}]
        self.native_tasks[('depth','original-depth')]={'id':'original-depth','operation_id':'op','source_url':'/output/video.mp4','status':'succeeded','progress':100,'result_url':'/output/depth.mp4','source_path':'D:/private.mp4','api_key':'private','pose_url':'/output/pose.mp4'}
        self.responses=[decision('read_native_task',{'nodeId':'depth','taskKind':'depth','taskId':'original-depth'}),decision(reply='已查询原深度任务')]
        result=await self.send()
        self.assertEqual(result[-1]['state'],'completed')
        self.assertEqual(self.native_queries,[('depth','original-depth')])
        text=json.dumps(self.seen[-1],ensure_ascii=False)
        self.assertIn('/output/depth.mp4',text);self.assertNotIn('private',text)
        self.assertEqual(self.tasks,{})

    async def test_read_native_task_rejects_foreign_id_or_kind_before_query(self):
        self.canvas['nodes']=[{'id':'depth','type':'image','depthCapture':{'taskId':'owned','status':'running'}}]
        self.responses=[decision('read_native_task',{'nodeId':'depth','taskKind':'depth','taskId':'foreign'}),decision(reply='未查外部任务')]
        await self.send()
        self.assertEqual(self.native_queries,[])
        self.assertIn('不属于',json.dumps(self.seen[-1],ensure_ascii=False))

    async def test_read_native_image_video_comfy_use_saved_local_ids_and_result_formats(self):
        for index,(kind,node) in enumerate([
            ('image',{'id':'out','type':'output','_pending':[{'canvasTaskType':'online-image','canvasTaskId':'image-local','taskId':'upstream-image'}]}),
            ('video',{'id':'out','type':'smart-image','videoTaskId':'video-local'}),
            ('comfy',{'id':'out','type':'smart-image','pendingTasks':[{'kind':'comfy','taskId':'comfy-local','segmentId':'segment'}]})]):
            task_id=kind+'-local';self.canvas['nodes']=[node]
            media_url='/output/'+kind+('.mp4' if kind=='video' else '.png')
            result={'videos':[media_url]} if kind=='video' else {'images':[media_url],'image_items':[{'url':media_url,'kind':'image','width':512,'height':512,'api_key':'hidden'}]}
            self.native_tasks[(kind,task_id)]={'task_id':task_id,'status':'succeeded','result':result}
            self.responses=[decision('read_native_task',{'nodeId':'out','taskKind':kind,'taskId':task_id}),decision(reply='已读取本地原任务')]
            result=await self.send(requestId='kind-'+str(index))
            self.assertEqual(result[-1]['state'],'completed')
            text=json.dumps(self.seen[-1],ensure_ascii=False);self.assertIn(media_url,text);self.assertNotIn('hidden',text)
        self.assertEqual(self.native_queries,[('image','image-local'),('video','video-local'),('comfy','comfy-local')])
        self.assertEqual(self.tasks,{})

    async def test_depth_query_rechecks_changed_source_after_async_read(self):
        self.canvas['nodes']=[{'id':'depth','type':'image','depthCapture':{'taskId':'owned','sourceUrl':'/output/old.mp4','operationId':'old-op'}}]
        self.native_tasks[('depth','owned')]={'id':'owned','source_url':'/output/old.mp4','operation_id':'old-op','status':'succeeded','result_url':'/output/old-depth.mp4'}
        def replace_canvas():
            self.canvas=copy.deepcopy(self.canvas)
            self.canvas['nodes'][0]['depthCapture'].update(sourceUrl='/output/new.mp4',operationId='new-op')
        self.native_query_hook=replace_canvas
        self.responses=[decision('read_native_task',{'nodeId':'depth','taskKind':'depth','taskId':'owned'}),decision(reply='已拒绝旧来源结果')]
        await self.send()
        text=json.dumps(self.seen[-1],ensure_ascii=False)
        self.assertIn('来源或操作编号已变化',text);self.assertNotIn('/output/old-depth.mp4',text)

    async def test_native_dynamic_fields_can_be_paged_by_selected_node(self):
        self.canvas['nodes']=[{'id':'wf','type':'comfy','mode':'custom'},{'id':'other','type':'comfy','mode':'custom'}]
        self.workflow_fields['wf']=[{'id':str(i),'type':'number'} for i in range(120)]
        self.workflow_fields['other']=[{'id':'other','type':'number'}]
        self.responses=[decision('read_native_capabilities',{'nodeId':'wf','offset':100,'limit':30}),decision()]
        await self.send()
        transcript=json.loads(self.seen[-1]['message'].split('\n',1)[1])
        result=next(item['result'] for item in transcript if item.get('kind')=='tool_result')['workflowParameters']
        self.assertEqual(len(result),1);self.assertEqual(result[0]['total'],120);self.assertEqual(result[0]['offset'],100)
        self.assertEqual(result[0]['fields'][-1]['key'],'119');self.assertIsNone(result[0]['nextOffset'])

    async def test_materialize_refuses_missing_manual_image_choice_and_binds_config(self):
        self.canvas['nodes']=[{'id':'table','type':'shot-table','shotTableData':{'source':{'sourceUrl':'/output/source.mp4'},'rows':[{'id':'r','imagePrompt':'商品'}],'generationMap':{}}}]
        self.responses=[decision('propose_native_action',{'action':'shot_materialize','nodeId':'table','selectedRowIds':['r']})]
        await self.send(imageModelConfirmed=False)
        self.assertFalse((await self.history()).get('nativeActions'))
        await self.send(requestId='turn-b')
        history=(await self.client.get('/api/canvas-assistant/history',params={'canvasId':'canvas-a','sessionId':self.session})).json()['session']
        action=history['turns'][-1]['nativeActions'][0]
        self.assertFalse(action['chargeable']);self.assertEqual(action['creationSettings']['model'],'image')
        self.providers[0]['image_models']=[]
        result=await self.client.post('/api/canvas-assistant/native/action',json={'canvasId':'canvas-a','sessionId':self.session,'turnId':'turn-b','actionId':action['id'],'action':'confirm'})
        self.assertEqual(result.status_code,409,result.text)

    async def test_workflow_schema_is_loaded_from_configuration_and_rechecked_before_execution(self):
        self.canvas['nodes']=[{'id':'wf','type':'comfy','comfyWorkflow':'public.json','mode':'custom'}]
        self.workflow_fields['wf']=[{'id':'steps','type':'number','min':1,'max':30}]
        self.responses=[decision('propose_native_action',{'action':'workflow_parameters','nodeId':'wf','patch':{'steps':12}})]
        await self.send()
        action=(await self.history())['nativeActions'][0]
        body={'canvasId':'canvas-a','sessionId':self.session,'turnId':'turn-a','actionId':action['id']}
        self.workflow_fields['wf'][0]['max']=20
        blocked=await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'confirm'})
        self.assertEqual(blocked.status_code,409,blocked.text)
        self.workflow_fields['wf'][0]['max']=30
        confirm=await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'confirm'})
        self.assertEqual(confirm.status_code,200,confirm.text)
        self.workflow_fields['wf'][0]['max']=20
        blocked=await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'check'})
        self.assertEqual(blocked.status_code,409,blocked.text)
        self.workflow_fields['wf'][0]['max']=30
        self.canvas['nodes'][0]['comfyParams']={'steps':12};self.canvas['updated_at']+=1
        done=await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'finish'})
        self.assertEqual(done.status_code,200,done.text)
        self.assertEqual(done.json()['proposal']['receipt']['state'],'completed')

    async def test_comfy_second_submission_accepts_owned_receipt_but_rejects_input_changes(self):
        node={'id':'comfy','type':'comfy','mode':'enhance','enhanceUpscale':True,'count':8}
        prompt={'id':'prompt','type':'prompt','text':'已确认正文'}
        self.canvas.update(nodes=[node,prompt],connections=[{'from':'prompt','to':'comfy'}])
        self.responses=[decision('propose_native_action',{'action':'run','nodeId':'comfy','maxCalls':2})]
        await self.send()
        action=(await self.history())['nativeActions'][0]
        body={'canvasId':'canvas-a','sessionId':self.session,'turnId':'turn-a','actionId':action['id']}
        self.assertEqual((await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'confirm'})).status_code,200)
        node.update(assistantNativeRun={'actionId':action['id'],'taskKind':'comfy','taskIds':['first'],'submissionStarted':True},running=True)
        self.canvas['nodes'].append({'id':'output','type':'output','images':[],'_pending':[{'canvasTaskId':'first','canvasTaskType':'comfy'}]})
        self.canvas['connections'].append({'from':'comfy','to':'output'})
        self.canvas['updated_at']+=1
        allowed=await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'check'})
        self.assertEqual(allowed.status_code,200,allowed.text)
        output=self.canvas['nodes'][-1]
        for pending in [{'canvasTaskId':'foreign','canvasTaskType':'comfy','run':{'node':{'id':'comfy'}}}, {'id':'unknown-no-task-id','run':{'node':{'id':'comfy'}}}]:
            output['_pending'].append(pending)
            blocked=await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'check'})
            self.assertEqual(blocked.status_code,409,blocked.text)
            output['_pending'].pop()
        for target,field,new in [(prompt,'text','未确认正文'),(node,'enhanceUpscale',False),(node,'model','替换模型')]:
            old=target.get(field);target[field]=new
            blocked=await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'check'})
            self.assertEqual(blocked.status_code,409,blocked.text)
            if old is None:target.pop(field)
            else:target[field]=old
        for flag in ['readOnly','readonly']:
            self.canvas[flag]=True
            blocked=await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'check'})
            self.assertEqual(blocked.status_code,409,blocked.text)
            self.canvas.pop(flag)
        node['assistantNativeRun']['actionId']='foreign'
        blocked=await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'check'})
        self.assertEqual(blocked.status_code,409,blocked.text)
        node['assistantNativeRun']['actionId']=action['id']
        node['assistantNativeRun']['taskIds'].append('second')
        blocked=await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'check'})
        self.assertEqual(blocked.status_code,409,blocked.text)

    async def test_video_gate_owned_pending_and_query_lost_response_without_resubmit(self):
        self.providers[0]['video_models']=['video-user']
        node={'id':'video','type':'video','apiProvider':'mock','model':'video-user','outputEnabled':True}
        output={'id':'out','type':'output','images':[]}
        prompt={'id':'prompt','type':'prompt','text':'原视频正文'}
        self.canvas.update(nodes=[node,output,prompt],connections=[{'from':'prompt','to':'video'},{'from':'video','to':'out'}])
        self.responses=[decision('propose_native_action',{'action':'run','nodeId':'video','maxCalls':1})]
        await self.send();action=(await self.history())['nativeActions'][0]
        body={'canvasId':'canvas-a','sessionId':self.session,'turnId':'turn-a','actionId':action['id']}
        confirmed=await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'confirm'})
        self.assertEqual(confirmed.status_code,200,confirmed.text)
        task_id='canvas_video_original123'
        node.update(running=True,assistantNativeRun={'actionId':action['id'],'taskKind':'video','taskIds':[],'plannedTaskId':task_id,'submissionStarted':False})
        output['_pending']=[{'canvasTaskId':task_id,'canvasTaskType':'video','assistantNativeActionId':action['id'],'run':{'node':{'id':'video'}}}]
        self.canvas['updated_at']+=1
        for started in [False,True]:
            node['assistantNativeRun']['submissionStarted']=started
            checked=await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'check'})
            self.assertEqual(checked.status_code,200,checked.text)
        self.providers[0]['enabled']=False
        self.assertEqual((await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'check'})).status_code,409)
        self.providers[0]['enabled']=True
        output['_pending'].append({'canvasTaskId':'foreign','canvasTaskType':'video','run':{'node':{'id':'video'}}})
        self.assertEqual((await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'check'})).status_code,409)
        output['_pending'].pop()
        missing=await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'query'})
        self.assertEqual(missing.status_code,200,missing.text);self.assertEqual(missing.json()['proposal']['state'],'submission_unknown')
        self.native_tasks[('video',task_id)]={'task_id':task_id,'status':'succeeded','canvas_id':'canvas-a','node_id':'video','assistant_action_id':action['id'],'input_hash':action['runInputHash'],'provider_id':'mock','model':'video-user','result':{'videos':['/output/accepted-video.mp4']}}
        queried=await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'query'})
        self.assertEqual(queried.status_code,200,queried.text);self.assertEqual(queried.json()['proposal']['state'],'accepted')
        output['images']=[{'url':'/output/accepted-video.mp4','kind':'video'}]
        finished=await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'finish'})
        self.assertEqual(finished.status_code,200,finished.text);self.assertEqual(finished.json()['proposal']['state'],'completed')
        self.assertTrue(all(kind=='video' and ident==task_id for kind,ident in self.native_queries))

    async def test_native_confirm_save_version_change_and_unexecuted_failure_can_continue(self):
        self.canvas['nodes']=[{'id':'p','type':'prompt','text':'before'}]
        self.responses=[decision('propose_native_action',{'action':'update','nodeId':'p','patch':{'text':'after'}}),decision(reply='已读取失败状态，保留手动修改')]
        await self.send()
        action=(await self.history())['nativeActions'][0]
        self.canvas['updated_at']+=1  # 仅普通保存的版本改变
        body={'canvasId':'canvas-a','sessionId':self.session,'turnId':'turn-a','actionId':action['id'],'expectedUpdatedAt':self.canvas['updated_at']}
        confirmed=await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'confirm'})
        self.assertTrue(confirmed.json()['canExecute'])
        self.canvas['nodes'][0]['text']='手动修改';self.canvas['updated_at']+=1
        checked=await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'check'})
        self.assertEqual(checked.status_code,409)
        query=await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'query'})
        self.assertEqual(query.json()['proposal']['state'],'executing')
        abandoned=await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'abandon'})
        self.assertEqual(abandoned.status_code,200,abandoned.text)
        self.assertEqual(abandoned.json()['proposal']['state'],'failed')
        result=await self.client.post('/api/canvas-assistant/continue',json={'canvasId':'canvas-a','sessionId':self.session,'requestId':'turn-a'})
        self.assertIn('"state": "completed"',result.text)
        self.assertEqual(self.canvas['nodes'][0]['text'],'手动修改')
        self.assertIn('failed',json.dumps(self.seen[-1]))

    async def test_native_failed_unaccepted_run_creates_fresh_confirmation_but_unknown_blocks_retry(self):
        node={'id':'generator','type':'generator','provider_id':'mock','apiProvider':'mock','model':'image','ratio':'square','resolution':'1k','count':1,'quality':'auto','outputEnabled':False}
        self.canvas['nodes']=[node]
        self.responses=[decision('propose_native_action',{'action':'run','nodeId':'generator','maxCalls':1})]
        await self.send();action=(await self.history())['nativeActions'][0]
        body={'canvasId':'canvas-a','sessionId':self.session,'turnId':'turn-a','actionId':action['id']}
        confirmed=await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'confirm'})
        self.assertEqual(confirmed.status_code,200,confirmed.text)
        node['assistantNativeRun']={'actionId':action['id'],'taskKind':'image','taskIds':[],'submissionStarted':False,'knownRejected':True}
        failed=await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'finish'})
        self.assertEqual(failed.status_code,200,failed.text);self.assertEqual(failed.json()['proposal']['state'],'failed')
        node['assistantNativeRun']={'actionId':action['id'],'taskKind':'image','taskIds':['original'],'submissionStarted':True}
        blocked_before=await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'retry'})
        self.assertEqual(blocked_before.status_code,409,blocked_before.text)
        node['assistantNativeRun']={'actionId':action['id'],'taskKind':'image','taskIds':[],'submissionStarted':False,'knownRejected':True}
        retry=await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'retry'})
        self.assertEqual(retry.status_code,200,retry.text);fresh=retry.json()['proposal']
        self.assertNotEqual(fresh['id'],action['id']);self.assertEqual(fresh['state'],'pending');self.assertEqual(fresh['retryOf'],action['id'])
        repeated=await self.client.post('/api/canvas-assistant/native/action',json={**body,'action':'retry'})
        self.assertEqual(repeated.status_code,200,repeated.text);self.assertEqual(repeated.json()['proposal']['id'],fresh['id'])

    async def test_shot_table_rules_and_last_row_reach_next_real_model_request(self):
        self.canvas["nodes"] = [{"id": "table", "type": "shot-table", "shotTableData": {
            "version": 1, "source": {"nodeId": "video", "sourceUrl": "/output/video.mp4"},
            "columns": [{"id": "visual", "kind": "builtin", "label": "画面"}],
            "rows": [{"id": f"shot-{i}", "index": i, "cells": {"visual": f"镜头{i}"}, "imagePrompt": "原片对照"} for i in range(121)],
            "task": {"taskId": "original-analysis", "status": "idle", "quote": {"visionCalls": 121}},
        }}]
        before = copy.deepcopy(self.canvas)
        self.responses = [decision("read_project_knowledge", {"capabilityId": "classic.shot_table", "section": "execution"}),
                          decision("read_node_state", {"nodeId": "table", "arrayPath": "shotTableData.rows", "itemOffset": 120}), decision()]
        events = await self.send()
        self.assertEqual(events[-1]["state"], "completed")
        transcript = json.dumps(self.seen[-1], ensure_ascii=False)
        self.assertIn("shot-120", transcript)
        self.assertIn("original-analysis", transcript)
        self.assertIn("visionCalls", transcript)
        self.assertEqual(self.canvas, before)
        self.assertEqual(self.tasks, {})

    async def test_hand_selected_skill_enters_actual_model_request_and_is_saved(self):
        events = await self.send(skillId="poster-layout")
        self.assertIn("视觉层级", self.seen[0]["system_prompt"])
        turn = await self.history()
        self.assertEqual(turn["agent"]["skillId"], "poster-layout")
        self.assertEqual(turn["agent"]["skillsUsed"][0]["id"], "poster-layout")
        self.assertEqual(turn["skillsUsed"][0]["id"], "poster-layout")
        self.assertEqual(events[-1]["skillsUsed"], turn["skillsUsed"])
        self.assertEqual(set(turn["skillsUsed"][0]), {"id", "name", "version"})

    async def test_auto_without_skill_read_has_no_invented_usage(self):
        events = await self.send()
        self.assertEqual(events[-1]["skillsUsed"], [])
        self.assertEqual((await self.history())["skillsUsed"], [])

    async def test_skill_catalog_exposes_categories_without_body(self):
        result = await self.client.get('/api/canvas-assistant/status')
        skills = result.json()['skills']
        self.assertEqual({s['category'] for s in skills}, {'图像', '文案'})
        self.assertTrue(all('files' not in s and 'content' not in s for s in skills))

    async def test_invalid_skill_rejected_before_model_call(self):
        result = await self.client.post("/api/canvas-assistant/chat", json=self.payload(skillId="../../auth"))
        self.assertEqual(result.status_code, 422)
        self.assertEqual(self.seen, [])

    async def test_automatic_skill_read_and_path_escape_rejected(self):
        self.responses = [decision("read_skill", {"skillId": "prompt-polish"}), decision()]
        events = await self.send()
        self.assertEqual(events[-1]["state"], "completed")
        self.assertIn("主体", json.dumps(self.seen[1], ensure_ascii=False))
        self.assertEqual((await self.history())["agent"]["skillsUsed"][0]["id"], "prompt-polish")
        self.assertEqual(events[-1]["skillsUsed"][0]["id"], "prompt-polish")
        self.assertEqual((await self.history())["skillsUsed"], events[-1]["skillsUsed"])

    async def test_repeated_invalid_tool_stops_without_writes(self):
        self.responses = [decision("delete_canvas", {"path": "private"})]
        events = await self.send()
        self.assertEqual(events[-1]["state"], "failed")
        self.assertEqual(self.canvas["nodes"], [])
        self.assertLessEqual(len(self.seen), 2)
        self.assertNotIn('"path": "private"', events[-1].get("error", ""))

    async def test_model_request_limit_finishes_with_real_read_receipts(self):
        self.responses = [decision("read_canvas")]
        events = await self.send()
        self.assertEqual(events[-1]["state"], "paused")
        self.assertEqual((await self.history())["agent"]["modelCalls"], 6)
        self.assertEqual(self.canvas["nodes"], [])

    async def propose(self, **changes):
        self.responses = [decision("propose_image", {"title": "海报", "prompt": "晨光咖啡海报"}, "请确认生成")]
        events = await self.send(**changes)
        self.assertEqual(events[-1]["state"], "waiting_confirmation")
        session = (await self.client.get("/api/canvas-assistant/history", params={"canvasId": "canvas-a", "sessionId": self.session})).json()["session"]
        turn = next(t for t in session["turns"] if t["id"] == changes.get("requestId", "turn-a"))
        self.assertEqual(self.tasks, {})
        proposal = turn["proposals"][0]
        from backend.canvas_assistant import AssistantStore
        store = AssistantStore(lambda: self.temp.name)
        def submitted(doc):
            stored = next(t for t in doc["sessions"][self.session]["turns"] if t["id"] == turn["id"])
            stored["proposals"][0]["state"] = "submitted"
        store.transact("owner", "canvas-a", submitted)
        proposal["state"] = "submitted"
        self.tasks[proposal["taskId"]] = {"status": "queued"}
        return proposal

    async def resume(self):
        return await self.client.post("/api/canvas-assistant/continue", json={"canvasId": "canvas-a", "sessionId": self.session, "requestId": "turn-a"})

    async def test_result_review_cannot_override_confirmed_wrong_pixel_size(self):
        from PIL import Image
        Image.new('RGB',(64,48)).save(Path(self.temp.name)/'review.png')
        proposal=await self.propose()
        def bind_confirmed_request(doc):
            stored=doc['sessions'][self.session]['turns'][0]['proposals'][0]
            stored['imageRequest']={'provider_id':'mock','model':'image','prompt':stored['prompt'],'reference_images':[],'size':'1024x1024','n':1}
        AssistantStore(lambda:self.temp.name).transact('owner','canvas-a',bind_confirmed_request)
        target=next(n for n in self.canvas['nodes'] if n['id']==proposal['nodeId']);target['generatedOutputs']=['/output/review.png']
        self.tasks[proposal['taskId']]={'task_id':proposal['taskId'],'status':'succeeded','provider_id':'mock','model':'image','result':{'images':['/output/review.png']}}
        self.responses=[decision('inspect_result',{'proposalId':proposal['id']}),decision('record_result_review',{'inspectionId':'turn-a_s2','status':'passed','findings':['主体可见']}),decision()]
        result=await self.resume();self.assertEqual(result.status_code,200,result.text)
        turn=await self.history();review=turn['steps'][-1]['result']['review']
        self.assertEqual(review['status'],'needs_changes');self.assertEqual(review['visualStatus'],'passed')
        dimensions=next(c for c in review['checks'] if c['id']=='dimensions')
        self.assertEqual(dimensions['expected'],{'width':1024,'height':1024})
        self.assertEqual(review['images'][0]['width'],64)

    async def test_unfinished_task_cannot_resume_or_consume_text_budget(self):
        await self.propose()
        result = await self.resume()
        self.assertEqual(result.status_code, 409)
        self.assertEqual((await self.history())["agent"]["modelCalls"], 1)

    async def test_finished_task_is_read_as_actual_image_and_continuation_is_idempotent(self):
        proposal = await self.propose()
        self.tasks[proposal["taskId"]] = {"status": "succeeded", "result": {"images": ["/output/mock.png"]}}
        self.responses = [decision(reply="已读取真实图片，主体清楚，建议增加标题留白")]
        result = await self.resume()
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(json.loads(result.text.splitlines()[-1])["state"], "completed")
        self.assertEqual(self.seen[-1]["images"], ["/output/mock.png"])
        self.assertEqual((await self.history())["agent"]["modelCalls"], 2)
        again = await self.resume()
        self.assertEqual(again.status_code, 200)
        self.assertEqual((await self.history())["agent"]["modelCalls"], 2)
        self.assertEqual(len(self.tasks), 1)

    async def test_cancel_while_waiting_blocks_automatic_or_manual_continuation(self):
        proposal = await self.propose()
        result = await self.client.post("/api/canvas-assistant/cancel", json={"canvasId": "canvas-a", "sessionId": self.session, "requestId": "turn-a"})
        self.assertEqual(result.json()["state"], "cancelled")
        self.tasks[proposal["taskId"]] = {"status": "succeeded", "result": {"images": ["/output/mock.png"]}}
        self.assertEqual((await self.resume()).status_code, 409)

    async def test_foreign_task_result_and_unsafe_media_are_not_sent_to_model(self):
        proposal = await self.propose()
        self.tasks[proposal["taskId"]] = {"status": "succeeded", "result": {"images": ["https://private.test/key"]}}
        result = await self.resume()
        self.assertEqual(result.status_code, 422)
        self.assertEqual(len(self.seen), 1)

    async def test_model_http_422_is_not_retried_as_protocol_error(self):
        self.model_error = HTTPException(422, "上游模型请求参数无效")
        events = await self.send()
        self.assertEqual(events[-1]["state"], "failed")
        self.assertEqual(len(self.seen), 1)

    async def test_new_chat_is_rejected_while_agent_waits_for_result(self):
        await self.propose()
        store = AssistantStore(lambda: self.temp.name)
        def mark_waiting(doc):
            turn = doc["sessions"][self.session]["turns"][0]
            turn["state"] = "waiting_result"
            turn["agent"] = {"modelCalls": 1, "toolCalls": 1, "activeSeconds": 0}
        store.transact("owner", "canvas-a", mark_waiting)
        result = await self.client.post("/api/canvas-assistant/chat", json=self.payload(requestId="turn-b"))
        self.assertEqual(result.status_code, 409)

    async def test_late_write_receipt_does_not_reopen_cancelled_turn(self):
        store = AssistantStore(lambda: self.temp.name)
        payload = TurnRequest.model_validate(self.payload(requestId="turn-race"))
        store.start("owner", payload)
        agent = {"version": 1, "modelCalls": 1, "toolCalls": 1, "activeSeconds": 0,
                 "messages": [], "payload": payload.model_dump()}
        step = {"id": "turn-race_s1", "tool": "apply_canvas_operations", "state": "running"}
        store.checkpoint("owner", payload, agent, step)
        store.stop("owner", CancelRequest(canvasId="canvas-a", sessionId=self.session, requestId="turn-race"))
        store.reconcile("owner", "canvas-a", {receipt_key("owner", step["id"]): {"updatedAtAfter": 2, "createdNodeIds": ["n1"]}})
        turn = store.turn("owner", payload)
        self.assertEqual(turn["state"], "cancelled")
        self.assertEqual(turn["steps"][0]["state"], "succeeded")

    async def test_remote_reference_url_is_not_forwarded_to_agent(self):
        self.canvas["nodes"] = [{"id": "img", "type": "image", "url": "https://private.test/secret.png"}]
        result = await self.client.post("/api/canvas-assistant/chat", json=self.payload(referencedNodeIds=["img"]))
        self.assertEqual(result.status_code, 200)
        self.assertEqual(self.seen[0]["images"], [])

    def test_reference_kind_only_accepts_local_media(self):
        self.assertEqual(reference_kind({"url": "https://private.test/secret.png", "kind": "image"}), "")
        self.assertEqual(reference_kind({"url": "/assets/safe.png", "kind": "image"}), "image")

    async def test_node_manual_reaches_actual_next_model_request(self):
        self.canvas["nodes"] = [{"id": "loop", "type": "loop", "count": 3, "mode": "serial", "variablePrompt": "{x}"}]
        self.responses = [
            decision("read_project_knowledge", {"capabilityId": "classic.loop", "section": "parameters"}),
            decision("read_node_state", {"nodeId": "loop"}),
            decision(reply="已读取节点规则和当前状态"),
        ]
        await self.send(message="先理解这个循环节点再给我建议")
        self.assertIn("count", json.dumps(self.seen[1], ensure_ascii=False))
        self.assertIn("serial", json.dumps(self.seen[2], ensure_ascii=False))

    def test_readable_is_not_actionable(self):
        catalog = {item["name"]: item for item in tool_catalog()}
        self.assertIn("read_project_knowledge", catalog)
        knowledge = json.loads((Path(__file__).parents[1] / "skills/canvas-assistant/project-knowledge/index.json").read_text(encoding="utf-8"))
        comfy = next(item for item in knowledge["entries"] if item["id"] == "classic.comfy")
        self.assertEqual(comfy["coverage"]["actionable"], "pending")

    async def test_status_reports_knowledge_coverage(self):
        result = await self.client.get("/api/canvas-assistant/status")
        self.assertEqual(result.status_code, 200)
        self.assertTrue(result.json()["knowledge"]["available"])
        self.assertEqual(result.json()["knowledge"]["coverage"]["entries"], 23)

    async def test_missing_knowledge_still_allows_existing_base_chat(self):
        from unittest.mock import patch
        with patch("backend.canvas_assistant.ProjectKnowledge.snapshot", side_effect=HTTPException(503, "项目知识索引不可用，请检查安装文件")):
            status = (await self.client.get("/api/canvas-assistant/status")).json()
            self.assertFalse(status["knowledge"]["available"])
            self.assertIn("不可用", status["knowledge"]["error"])
            self.responses = [decision("read_project_knowledge", {"capabilityId": "classic.loop"}), decision(reply="知识不可用，先对话梳理要求")]
            await self.send()
            self.assertEqual((await self.history())["state"], "completed")
            self.assertIn("知识不可用", self.seen[0]["system_prompt"])
            self.assertEqual(self.canvas["nodes"], [])

    async def test_stale_knowledge_blocks_writes_but_keeps_reads(self):
        from unittest.mock import patch
        self.responses = [decision("read_canvas"), decision("apply_canvas_operations", {"operations": [{"op": "create", "operationId": "p", "ref": "p", "type": "prompt", "content": "must not write"}]}), decision(reply="来源变化，先复核")]
        with patch("backend.canvas_assistant.ProjectKnowledge.changed", return_value=["classic.loop"]):
            await self.send()
        self.assertEqual(self.canvas["nodes"], [])
        self.assertIn("来源已变化", json.dumps(self.seen[2], ensure_ascii=False))

    async def test_unknown_knowledge_returns_real_error_without_writes(self):
        self.responses = [decision("read_project_knowledge", {"capabilityId": "classic.not_found"}), decision(reply="没有此知识编号")]
        await self.send()
        self.assertIn("找不到", json.dumps(self.seen[1], ensure_ascii=False))
        self.assertEqual(self.canvas["nodes"], [])

    async def test_canvas_context_exposes_truncation_and_page_after_hundred(self):
        self.canvas["nodes"] = [{"id": str(i), "type": "prompt", "text": "x" * 2000} for i in range(130)]
        self.responses = [decision("read_canvas", {"offset": 100, "limit": 30}), decision(reply="读到最后30个节点")]
        await self.send()
        self.assertEqual(self.seen[0]["system_prompt"].count('"counts"'), 1)
        fields = json.loads(self.seen[1]["message"].split("\n", 1)[1])
        canvas = fields[-1]["result"]["canvas"]
        self.assertEqual(canvas["nodes"][0]["id"], "100")
        self.assertEqual(canvas["counts"]["nodes"], 130)
        self.assertTrue(canvas["truncation"]["text"])

    async def test_paged_read_reaches_next_model_call(self):
        self.canvas["nodes"] = [{"id": "p", "type": "prompt", "text": "z" * 30001}]
        self.responses = [
            decision("read_node_state", {"nodeId": "p", "textOffset": 0, "textLimit": 12000}),
            decision("read_node_state", {"nodeId": "p", "textOffset": 12000, "textLimit": 12000}),
            decision(reply="已读取分页内容"),
        ]
        await self.send(message="读取完整提示词")
        self.assertIn("nextOffset", json.dumps(self.seen[1], ensure_ascii=False))
        self.assertIn("z" * 12000, json.dumps(self.seen[2], ensure_ascii=False))

    async def test_original_requirement_survives_tools_and_image_continuation(self):
        message = "唯一创作要求 USER_BRIEF_517：不要红色，标题为清晨咖啡"
        self.responses = [decision("read_canvas"), decision(reply="PREVIOUS_REPLY_318")]
        await self.send(message=message)
        self.assertIn(message, json.dumps(self.seen[1], ensure_ascii=False))
        turn_before_continue = await self.history()
        self.assertTrue(turn_before_continue["agent"]["knowledgeVersion"])
        proposal = await self.propose(requestId="turn-b", message=message)
        self.tasks[proposal["taskId"]] = {"status": "succeeded", "result": {"images": ["/output/mock.png"]}}
        self.responses = [decision()]
        result = await self.client.post("/api/canvas-assistant/continue", json={"canvasId": "canvas-a", "sessionId": self.session, "requestId": "turn-b"})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertIn(message, json.dumps(self.seen[-1], ensure_ascii=False))
        self.assertIn("PREVIOUS_REPLY_318", json.dumps(self.seen[-1]["messages"]), "图片续行必须保留此前已完成的对话上下文")

    async def test_library_reference_is_reloaded_for_image_continuation(self):
        self.assets = [{"id": "asset:library:ref", "kind": "image", "url": "/assets/reference.png"}]
        proposal = await self.propose(referencedAssetIds=[self.assets[0]["id"]])
        self.tasks[proposal["taskId"]] = {"status": "succeeded", "result": {"images": ["/output/mock.png"]}}
        self.responses = [decision()]
        result = await self.resume()
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(json.loads(result.text.splitlines()[-1])["state"], "completed")
        self.assertIn("/assets/reference.png", self.seen[-1]["system_prompt"])

    async def test_history_reconcile_does_not_release_active_writer(self):
        store = AssistantStore(lambda: self.temp.name)
        payload = TurnRequest.model_validate(self.payload(requestId="race"))
        store.start("owner", payload)
        agent = {"modelCalls": 1, "toolCalls": 1, "activeSeconds": 0, "messages": [], "payload": payload.model_dump()}
        step = {"id": "race_s1", "tool": "apply_canvas_operations", "state": "running"}
        store.checkpoint("owner", payload, agent, step)
        receipt = {"updatedAtAfter": 21, "createdNodeIds": ["n1"]}
        store.reconcile("owner", "canvas-a", {receipt_key("owner", step["id"]): receipt})
        self.assertEqual(store.turn("owner", payload)["state"], "running")
        with self.assertRaises(HTTPException) as denied:
            store.claim_continue("owner", payload)
        self.assertEqual(denied.exception.status_code, 409)
        store.checkpoint("owner", payload, agent, {**step, "state": "succeeded"})

    async def test_replaced_library_reference_blocks_continuation(self):
        self.assets = [{"id": "asset:library:ref", "kind": "image", "url": "/assets/reference.png"}]
        proposal = await self.propose(referencedAssetIds=[self.assets[0]["id"]])
        self.tasks[proposal["taskId"]] = {"status": "succeeded", "result": {"images": ["/output/mock.png"]}}
        self.assets[0]["url"] = "/assets/replacement.png"
        self.responses = [decision()]
        before = len(self.seen)
        result = await self.resume()
        self.assertEqual(json.loads(result.text.splitlines()[-1])["state"], "interrupted")
        self.assertEqual(len(self.seen), before, "素材变化不能静默替换后再发模型请求")

    async def test_previous_executor_cannot_checkpoint_after_new_claim(self):
        store = AssistantStore(lambda: self.temp.name)
        payload = TurnRequest.model_validate(self.payload(requestId="epoch"))
        store.start("owner", payload)
        agent = {"modelCalls": 1, "toolCalls": 0, "activeSeconds": 0, "messages": [], "payload": payload.model_dump()}
        store.checkpoint("owner", payload, agent)
        store.finish("owner", "canvas-a", self.session, "epoch", "interrupted")
        store.claim_continue("owner", payload)
        with self.assertRaises(asyncio.CancelledError):
            store.checkpoint("owner", payload, agent)

    async def test_disconnect_is_recoverable_but_explicit_stop_is_not(self):
        self.gate = asyncio.Event()
        route = next(r for r in self.test_app.routes if getattr(r, "path", "") == "/api/canvas-assistant/chat")
        request = Request({"type": "http", "method": "POST", "path": route.path, "headers": [], "query_string": b""})
        response = await route.endpoint(TurnRequest.model_validate(self.payload()), request, x_user_id="owner")
        await response.body_iterator.__anext__()
        await self.started.wait()
        await response.body_iterator.aclose()
        self.assertEqual((await self.history())["state"], "interrupted")
        self.gate = None
        self.responses = [decision()]
        result = await self.resume()
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(json.loads(result.text.splitlines()[-1])["state"], "completed")

    async def test_asgi_disconnect_completes_interruption_checkpoint(self):
        self.gate = asyncio.Event()
        route = next(r for r in self.test_app.routes if getattr(r, "path", "") == "/api/canvas-assistant/chat")
        scope = {"type": "http", "asgi": {"spec_version": "2.0"}, "method": "POST", "path": route.path, "headers": [], "query_string": b""}
        app = self.app()
        @app.middleware("http")
        async def tracing(request, call_next):
            return await call_next(request)
        scope.update(http_version="1.1", scheme="http", server=("test", 80), client=("127.0.0.1", 1),
                     headers=[(b"content-type", b"application/json"), (b"x-user-id", b"owner")])
        disconnected = asyncio.Event()
        body_sent = False
        async def receive():
            nonlocal body_sent
            if not body_sent:
                body_sent = True
                return {"type": "http.request", "body": json.dumps(self.payload()).encode(), "more_body": False}
            await disconnected.wait()
            return {"type": "http.disconnect"}
        async def sent(event):
            if event["type"] == "http.response.body" and event.get("body"):
                await self.started.wait()
                disconnected.set()
        await app(scope, receive, sent)
        for _ in range(80):
            # 不走另一 router owner 的恢复读，直接检查断线处理实际落盘的状态。
            doc = json.loads(await asyncio.to_thread(AssistantStore(lambda: self.temp.name).path("owner", "canvas-a").read_text, encoding="utf-8"))
            turn = doc["sessions"][self.session]["turns"][0]
            if turn["state"] != "running":
                break
            await asyncio.sleep(0.05)
        self.assertEqual(turn["state"], "interrupted")

    async def test_repeated_stream_cancellation_does_not_leave_running_turn(self):
        self.gate = asyncio.Event()
        route = next(r for r in self.test_app.routes if getattr(r, "path", "") == "/api/canvas-assistant/chat")
        request = Request({"type": "http", "method": "POST", "path": route.path, "headers": [], "query_string": b""})
        response = await route.endpoint(TurnRequest.model_validate(self.payload()), request, x_user_id="owner")
        await response.body_iterator.__anext__()
        await self.started.wait()
        # 模拟 HTTP 中间件的取消作用域：每次 await 都可能再次传播取消。
        try:
            with anyio.CancelScope() as scope:
                scope.cancel()
                await response.body_iterator.aclose()
        except asyncio.CancelledError:
            pass  # HTTP 连接已取消，断线后仍必须保存可恢复状态。
        for _ in range(20):
            turn = await self.history()
            if turn["state"] != "running":
                break
        self.assertEqual(turn["state"], "interrupted")


if __name__ == "__main__":
    unittest.main()
