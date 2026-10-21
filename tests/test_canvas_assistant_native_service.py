"""助手真实后端服务的字段、任务与导出边界；只用显式端口和自制数据。"""
import asyncio
import json
import re
from threading import RLock
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch

from fastapi import HTTPException
from backend import canvas_assistant_media_export as media, canvas_clip
from backend import canvas_assistant_native as native, canvas_assistant_node_rules as node_rules
from backend.canvas_assistant_native_service import (query_canvas_assistant_native_task,
    control_canvas_assistant_native_task, canvas_assistant_workflow_fields,
    prepare_canvas_assistant_media_export, control_canvas_assistant_media_export)


class NativeTaskServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_queries_only_the_original_reader_for_each_kind(self):
        depth=Mock(return_value={'id':'original'});readers={key:AsyncMock(return_value={'kind':key}) for key in ('image','video','comfy')}
        ports={'asyncio':asyncio,'HTTPException':HTTPException,'get_canvas_depth_capture':depth,
               **{'get_canvas_'+key+'_task':value for key,value in readers.items()}}
        for kind in ('depth','image','video','comfy'):
            result=await query_canvas_assistant_native_task(kind,'original',**ports)
            self.assertEqual(result,{'id':'original'} if kind=='depth' else {'kind':kind})
        depth.assert_called_once_with('original')
        for reader in readers.values():reader.assert_awaited_once_with('original')

    async def test_unknown_query_does_not_call_any_reader(self):
        reader=AsyncMock();depth=Mock()
        with self.assertRaises(HTTPException) as caught:
            await query_canvas_assistant_native_task('unknown','original',asyncio=asyncio,HTTPException=HTTPException,
                get_canvas_depth_capture=depth,get_canvas_image_task=reader,get_canvas_video_task=reader,get_canvas_comfy_task=reader)
        self.assertEqual((caught.exception.status_code,caught.exception.detail),(422,'未开放的节点原任务查询种类'))
        reader.assert_not_called();depth.assert_not_called()

    async def test_control_keeps_refresh_and_depth_cancel_matrix(self):
        image=AsyncMock(return_value='image');video=AsyncMock(return_value='video');depth=Mock(return_value='depth')
        ports=dict(asyncio=asyncio,HTTPException=HTTPException,refresh_canvas_image_task=image,refresh_canvas_video_task=video,cancel_canvas_depth_capture=depth)
        for action,kind in (('task_refresh','image'),('task_refresh','video'),('task_cancel','depth')):
            self.assertEqual(await control_canvas_assistant_native_task(action,kind,'old-task',**ports),kind)
        for action,kind in (('task_cancel','image'),('task_cancel','video'),('task_cancel','comfy'),('task_refresh','depth'),('submit','image')):
            with self.assertRaises(HTTPException) as caught:await control_canvas_assistant_native_task(action,kind,'old-task',**ports)
            self.assertEqual((caught.exception.status_code,caught.exception.detail),(422,'原任务服务不支持此控制操作'))
        image.assert_awaited_once_with('old-task');video.assert_awaited_once_with('old-task');depth.assert_called_once_with('old-task')

    async def test_reader_error_is_preserved(self):
        error=HTTPException(404,'original missing');reader=AsyncMock(side_effect=error)
        with self.assertRaises(HTTPException) as caught:
            await query_canvas_assistant_native_task('image','original',asyncio=asyncio,HTTPException=HTTPException,
                get_canvas_depth_capture=Mock(),get_canvas_image_task=reader,get_canvas_video_task=reader,get_canvas_comfy_task=reader)
        self.assertIs(caught.exception,error)


class NativeWorkflowServiceTests(unittest.TestCase):
    def read(self,node,provider=None,store=None,**extra):
        ports=dict(HTTPException=HTTPException,get_workflow=lambda key:{'config':{'fields':[{'name':key}]}},
            runninghub_provider_with_workflow_store=lambda p:p,runninghub_provider=lambda:provider,re=re,
            runninghub_entry_id=lambda entry,mode:str(entry.get('workflowId' if mode=='workflow' else 'appId','')),
            load_runninghub_workflow_store=lambda:store or {},runninghub_workflow_store_key=lambda key:'store-'+key)
        ports.update(extra);return canvas_assistant_workflow_fields(node,**ports)

    def test_comfy_reads_selected_config_and_rejects_missing_selection(self):
        self.assertEqual(self.read({'type':'comfy','comfyWorkflow':'fixture'}),[{'name':'fixture'}])
        with self.assertRaises(HTTPException) as caught:self.read({'type':'comfy'})
        self.assertEqual((caught.exception.status_code,caught.exception.detail),(409,'请先在原生节点选择工作流'))

    def test_other_nodes_and_rh_model_have_no_workflow_fields(self):
        for kind in ('prompt','smart-image','smart-group',None):self.assertEqual(self.read({'type':kind}),[])
        self.assertEqual(self.read({'type':'rh','rhMode':'model'},provider={}),[])

    def test_enabled_fields_have_priority_and_empty_enabled_set_keeps_original(self):
        enabled={'enabled':True,'name':'yes'};other={'enabled':False,'name':'no'}
        for fields,expected in [([enabled,other],[enabled]),([other,'legacy'],[other,'legacy'])]:
            self.assertEqual(self.read({'type':'rh','webappId':'one'},provider={'rh_apps':[{'appId':'one','fields':fields}]}),expected)

    def test_selected_config_rejects_different_saved_id_or_mode(self):
        provider={'rh_apps':[{'appId':'one'}],'image_models':['image']}
        for node in ({'type':'rh','rhConfigKey':'app:one','webappId':'two'},
                     {'type':'rh','rhConfigKey':'app:one','rhMode':'workflow','workflowId':'one'},
                     {'type':'rh','rhConfigKey':'model:image','webappId':'one'}):
            with self.assertRaises(HTTPException) as caught:self.read(node,provider=provider)
            self.assertEqual(caught.exception.status_code,409)

    def test_stale_or_disabled_config_key_does_not_override_live_selected_entry(self):
        fields=[{'name':'live'}];provider={'rh_apps':[{'appId':'one','fields':fields},{'appId':'old','enabled':False}]}
        for key in ('app:missing','app:old','malformed'):
            self.assertEqual(self.read({'type':'rh','webappId':'one','rhConfigKey':key},provider=provider),fields)

    def test_disabled_or_hidden_entry_rejected_before_store_fallback(self):
        for flag in ('enabled','hidden'):
            entry={'workflowId':'one',flag:flag=='hidden'}
            with self.assertRaises(HTTPException) as caught:
                self.read({'type':'rh','rhMode':'workflow','workflowId':'one'},provider={'rh_workflows':[entry]},load_runninghub_workflow_store=Mock(side_effect=AssertionError('no fallback')))
            self.assertEqual((caught.exception.status_code,caught.exception.detail),(409,'原生选中的工作流已停用，请重新手动选择'))

    def test_workflow_store_precedes_node_cache_and_empty_fields_are_authoritative(self):
        node={'type':'rh','rhMode':'workflow','workflowId':'one','rhWorkflowInfo':{'nodeInfoList':[{'name':'cached'}]}}
        fields=[{'enabled':True,'name':'store'},{'enabled':False,'name':'off'}]
        self.assertEqual(self.read(node,provider={},store={'store-one':{'fields':fields}}),[fields[0]])
        self.assertEqual(self.read(node,provider={},store={'store-one':{'fields':[]}}),[])
        self.assertEqual(self.read(node,provider={},store={'store-one':{'fields':'legacy'}}),[{'name':'cached'}])

    def test_provider_fields_precede_store_and_missing_app_uses_cache(self):
        fields=[{'enabled':True,'name':'provider'}]
        self.assertEqual(self.read({'type':'rh','rhMode':'workflow','workflowId':'one'},provider={'rh_workflows':[{'workflowId':'one','fields':fields}]},load_runninghub_workflow_store=Mock(side_effect=AssertionError('no store'))),fields)
        self.assertEqual(self.read({'type':'rh','webappId':'missing','rhAppInfo':{'nodeInfoList':['cache']}},provider={}),['cache'])

    def test_comfy_loader_error_keeps_identity(self):
        error=HTTPException(404,'fixture missing')
        with self.assertRaises(HTTPException) as caught:self.read({'type':'comfy','comfyWorkflow':'missing'},get_workflow=Mock(side_effect=error))
        self.assertIs(caught.exception,error)


class NativeMediaExportServiceTests(unittest.IsolatedAsyncioTestCase):
    def ports(self,**extra):
        node={'id':'node','type':'clip'};canvas={'id':'canvas','nodes':[node]};request={'fixture':'original-request'}
        plan={'canvasId':'canvas','nodeId':'node','rangeHash':'range','requestId':'request','nativeRequest':request,'mode':'clip-task'}
        task={'results':[{'url':'/output/result.mp4','name':'result.mp4','kind':'video','durationSeconds':2,'sourceClipId':'source','private':'omit'}],'error':'original-error'}
        manager=SimpleNamespace(lock=RLock(),requests={('canvas','node','request'):'original-task'},get=Mock(return_value=task))
        ports=dict(load_canvas=Mock(return_value=canvas),HTTPException=HTTPException,OUTPUT_DIR='output',ASSETS_DIR='assets',
            _current_storage_dirs=lambda:{'upload':'input'},DATA_DIR='data',subprocess=SimpleNamespace(run=Mock(return_value=SimpleNamespace(returncode=0,stdout='{"streams":[]}'))),
            json=json,asyncio=asyncio,local_media_path_from_url=Mock(),canvas_clip_manager=Mock(return_value=manager),create_canvas_clip_export=Mock())
        ports.update(extra);return plan,node,canvas,manager,ports

    async def run_control(self,plan,ports,submit=False,validate=None,verify=None):
        with (patch.object(canvas_clip,'find_media_tools',return_value=('ffmpeg','ffprobe')),
             patch.object(media,'validate_media_export_snapshot',validate or Mock()),
             patch.object(media,'verify_clip_export',verify or Mock(return_value={'status':'succeeded','taskId':'original-task'})),
             patch.object(native,'_related_task_busy',return_value=False),patch.object(node_rules,'is_busy',return_value=False)):
            return await control_canvas_assistant_media_export({'mediaExportPlan':plan},submit=submit,**ports)

    async def test_prepare_passes_current_roots_request_binding_and_real_probe(self):
        _,node,_,_,ports=self.ports();observed=[]
        def prepare(cid,given,options,resolver,roots,probe,request_id=None):
            observed.append((cid,given,options,resolver,roots,request_id));return probe('fixture.mp4')
        names=('DATA_DIR','subprocess','HTTPException','json','local_media_path_from_url','OUTPUT_DIR','ASSETS_DIR','_current_storage_dirs')
        with patch.object(canvas_clip,'find_media_tools',return_value=('ffmpeg','ffprobe')),patch.object(media,'prepare_media_export',prepare):
            result=prepare_canvas_assistant_media_export('canvas',node,{'scope':'full'},'bound',**{k:ports[k] for k in names})
        self.assertEqual(result,{'streams':[]});self.assertEqual(observed[0][4:],(['output','assets','input'],'bound'))
        self.assertEqual(ports['subprocess'].run.call_args.args[0],['ffprobe','-v','error','-show_streams','-show_format','-of','json','fixture.mp4'])
        self.assertEqual(ports['subprocess'].run.call_args.kwargs,dict(capture_output=True,text=True,timeout=30))

    async def test_probe_nonzero_preserves_public_error(self):
        _,node,_,_,ports=self.ports();ports['subprocess'].run.return_value=SimpleNamespace(returncode=1,stdout='')
        names=('DATA_DIR','subprocess','HTTPException','json','local_media_path_from_url','OUTPUT_DIR','ASSETS_DIR','_current_storage_dirs')
        def prepare(*args,**kwargs):return args[5]('fixture')
        with patch.object(canvas_clip,'find_media_tools',return_value=('ffmpeg','ffprobe')),patch.object(media,'prepare_media_export',prepare):
            with self.assertRaises(HTTPException) as caught:prepare_canvas_assistant_media_export('canvas',node,{},**{k:ports[k] for k in names})
        self.assertEqual((caught.exception.status_code,caught.exception.detail),(409,'无法探测原本地媒体'))

    async def test_query_uses_existing_task_and_projects_only_public_result_fields(self):
        plan,_,_,manager,ports=self.ports();result=await self.run_control(plan,ports)
        ports['create_canvas_clip_export'].assert_not_called();manager.get.assert_called_once_with('original-task')
        self.assertEqual(result,{'status':'succeeded','taskId':'original-task','error':'original-error','message':'','results':[
            {'url':'/output/result.mp4','name':'result.mp4','kind':'video','durationSeconds':2,'sourceClipId':'source'}]})

    async def test_submit_passes_original_request_after_snapshot_validation(self):
        plan,_,_,_,ports=self.ports();events=[]
        ports['create_canvas_clip_export'].side_effect=lambda req:events.append(('submit',req))
        await self.run_control(plan,ports,submit=True,validate=Mock(side_effect=lambda *a:events.append(('validate',a[0]))))
        self.assertEqual([x[0] for x in events],['validate','submit']);self.assertIs(events[1][1],plan['nativeRequest'])

    async def test_missing_binding_is_unknown_without_resubmitting_on_query(self):
        plan,_,_,manager,ports=self.ports();manager.requests.clear()
        result=await self.run_control(plan,ports)
        self.assertEqual(result,{'status':'unknown','results':[],'message':'未找到原导出受理记录，不重复提交'})
        manager.get.assert_not_called();ports['create_canvas_clip_export'].assert_not_called()

    async def test_readonly_or_missing_original_node_rejected(self):
        for flag in ('readOnly','readonly','missing'):
            plan,_,canvas,_,ports=self.ports()
            if flag=='missing':canvas['nodes']=[]
            else:canvas[flag]=True
            with self.assertRaises(HTTPException) as caught:await self.run_control(plan,ports,submit=True)
            self.assertEqual((caught.exception.status_code,caught.exception.detail),(409,'原导出画布或节点不可写'))
            ports['create_canvas_clip_export'].assert_not_called()

    async def test_busy_gate_applies_to_submit_but_query_remains_available(self):
        plan,_,_,_,ports=self.ports()
        with patch.object(native,'_related_task_busy',return_value=True),patch.object(node_rules,'is_busy',return_value=False):
            with self.assertRaises(HTTPException) as caught:await control_canvas_assistant_media_export({'mediaExportPlan':plan},submit=True,**ports)
        self.assertEqual(caught.exception.status_code,409);ports['create_canvas_clip_export'].assert_not_called()

    async def test_invalid_snapshot_stops_before_submit(self):
        plan,_,_,manager,ports=self.ports();error=HTTPException(409,'original changed')
        with self.assertRaises(HTTPException) as caught:await self.run_control(plan,ports,submit=True,validate=Mock(side_effect=error))
        self.assertIs(caught.exception,error);ports['create_canvas_clip_export'].assert_not_called();manager.get.assert_not_called()

    async def test_unsupported_mode_is_rejected_after_snapshot_check(self):
        plan,_,_,_,ports=self.ports();plan['mode']='legacy';validated=Mock()
        with self.assertRaises(HTTPException) as caught:await self.run_control(plan,ports,validate=validated)
        validated.assert_called_once();self.assertEqual((caught.exception.status_code,caught.exception.detail),(409,'此媒体导出类型已不支持'))
