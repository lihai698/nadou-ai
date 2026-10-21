"""Task admission and remote dispatch without application, credentials or generation."""
import asyncio
import hashlib
import json
import re
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock

from fastapi import HTTPException
from backend import comfy_task_service as comfy
from backend import canvas_video_task_service as video
from backend.task_records import TaskRecordError


class CanvasTaskAdmissionServiceTests(unittest.IsolatedAsyncioTestCase):
    def comfy_fixture(self, **updates):
        events=[];tasks={};lock=threading.RLock()
        async def worker(*args):raise AssertionError('worker must not execute during admission')
        def write(record,required=False):
            self.assertTrue(lock._is_owned());events.append(['persist',dict(record),required])
        def spawn(coro):events.append(['spawn',dict(tasks)]);coro.close()
        deps=dict(re=re,HTTPException=HTTPException,uuid=SimpleNamespace(uuid4=lambda:SimpleNamespace(hex='f'*32)),
                  task_context=lambda task_id,**fields:{'trace_id':fields['trace_id'],'request_id':fields['request_id']},
                  CANVAS_TASK_LOCK=lock,CANVAS_TASKS=tasks,time=SimpleNamespace(time=lambda:123),
                  task_input_summary=lambda **fields:fields,CANVAS_TASK_PROCESS_ID='owner',_write_canvas_task_record=write,
                  TaskRecordError=TaskRecordError,asyncio=SimpleNamespace(create_task=spawn),run_canvas_comfy_task=worker)
        deps.update(updates)
        payload=SimpleNamespace(assistant_action_id='',canvas_id='',node_id='',input_hash='',segment_id='',workflow_json='fixture.json',prompt='中文')
        request=SimpleNamespace(state=SimpleNamespace(trace_id='trace',request_id='request'))
        return payload,request,deps,events,tasks

    async def test_comfy_persists_under_original_lock_before_spawning(self):
        payload,request,deps,events,tasks=self.comfy_fixture()
        result=await comfy.create_canvas_comfy_task(payload,request,**deps)
        self.assertEqual([x[0] for x in events],['persist','spawn'])
        self.assertEqual(result,{'task_id':'canvas_comfy_'+'f'*32,'status':'queued','trace_id':'trace','request_id':'request'})
        record=tasks[result['task_id']]
        self.assertEqual(record['input_summary'],{'prompt':'中文','workflow_json':'fixture.json'})
        self.assertEqual((record['created_at'],record['updated_at'],record['process_id']),(123,123,'owner'))

    async def test_comfy_preserves_assistant_binding_and_segment(self):
        payload,request,deps,events,tasks=self.comfy_fixture()
        payload.assistant_action_id='action-a';payload.canvas_id='canvas-a';payload.node_id='node-a';payload.input_hash='a'*64;payload.segment_id='segment-a'
        result=await comfy.create_canvas_comfy_task(payload,request,**deps)
        for key in ('assistant_action_id','canvas_id','node_id','input_hash','segment_id'):self.assertEqual(result[key],getattr(payload,key))
        self.assertEqual((result['provider_id'],result['model']),('comfyui','fixture.json'))

    async def test_comfy_invalid_binding_never_persists_or_spawns(self):
        for key in ('canvas_id','node_id','input_hash','assistant_action_id','segment_id'):
            with self.subTest(key=key):
                payload,request,deps,events,tasks=self.comfy_fixture()
                payload.assistant_action_id='action-a';payload.canvas_id='canvas-a';payload.node_id='node-a';payload.input_hash='a'*64
                setattr(payload,key,'../invalid')
                with self.assertRaises(HTTPException) as raised:await comfy.create_canvas_comfy_task(payload,request,**deps)
                self.assertEqual(raised.exception.status_code,422);self.assertEqual((events,tasks),([],{}))

    async def test_comfy_failed_durable_write_removes_volatile_task_and_does_not_spawn(self):
        for error in (OSError('disk full'),TaskRecordError('invalid record')):
            with self.subTest(error=type(error).__name__):
                payload,request,deps,events,tasks=self.comfy_fixture(_write_canvas_task_record=Mock(side_effect=error))
                with self.assertRaises(HTTPException) as raised:await comfy.create_canvas_comfy_task(payload,request,**deps)
                self.assertEqual(raised.exception.status_code,503);self.assertEqual((events,tasks),([],{}))

    async def test_comfy_reads_memory_before_disk_and_preserves_projection_order(self):
        for memory in (True,False):
            with self.subTest(memory=memory):
                events=[];original={'id':'task','status':'running'};reader=Mock(return_value=original)
                def interrupted(value):events.append(['interrupted',dict(value)]);value['status']='interrupted';return value
                def public(value):events.append(['public',dict(value)]);return {'status':value['status']}
                result=await comfy.get_canvas_comfy_task('task',CANVAS_TASK_LOCK=threading.RLock(),CANVAS_TASKS={'task':original} if memory else {},
                    _read_canvas_task_record=reader,HTTPException=HTTPException,_interrupted_canvas_task=interrupted,_public_canvas_task=public)
                self.assertEqual(result,{'status':'interrupted'});self.assertEqual([x[0] for x in events],['interrupted','public']);self.assertEqual(original['status'],'running')
                self.assertEqual(reader.call_count,0 if memory else 1)

    async def test_comfy_missing_record_is_original_404(self):
        with self.assertRaises(HTTPException) as raised:
            await comfy.get_canvas_comfy_task('missing',CANVAS_TASK_LOCK=threading.RLock(),CANVAS_TASKS={},_read_canvas_task_record=lambda _:None,
                HTTPException=HTTPException,_interrupted_canvas_task=Mock(),_public_canvas_task=Mock())
        self.assertEqual(raised.exception.status_code,404)

    def video_fixture(self):
        payload=SimpleNamespace(assistant_action_id='action-a',canvas_id='canvas-a',node_id='node-a',input_hash='b'*64,provider_id='provider-a',model='model-a',prompt='中文')
        deps=dict(re=re,HTTPException=HTTPException,hashlib=hashlib,json=json,model_dump_compat=lambda p:vars(p),
                  get_api_provider_exact=Mock(return_value={'id':'provider-a','enabled':True,'video_models':['model-a']}),model_list_from_values=lambda v:v)
        return payload,deps

    def test_video_binding_includes_full_canonical_request_digest(self):
        payload,deps=self.video_fixture();binding=video.validate_canvas_video_assistant_task(payload,check_provider=True,**deps)
        self.assertEqual(binding['request_hash'],hashlib.sha256(json.dumps(vars(payload),ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest())
        self.assertEqual(binding['input_hash'],'b'*64);deps['get_api_provider_exact'].assert_called_once_with('provider-a')

    def test_manual_video_requests_keep_unbound_compatibility(self):
        payload,deps=self.video_fixture();payload.assistant_action_id=''
        self.assertEqual(video.validate_canvas_video_assistant_task(payload,check_provider=True,**deps),{})
        deps['get_api_provider_exact'].assert_not_called()

    def test_video_existing_task_rejects_foreign_owner_parameters_and_type(self):
        payload,deps=self.video_fixture();binding=video.validate_canvas_video_assistant_task(payload,**deps)
        existing={**binding,'type':'video','provider_id':payload.provider_id,'model':payload.model}
        self.assertEqual(video.validate_canvas_video_assistant_task(payload,existing,**deps),binding)
        for key in ('canvas_id','node_id','input_hash','request_hash','provider_id','model','type'):
            with self.subTest(key=key),self.assertRaises(HTTPException) as raised:
                video.validate_canvas_video_assistant_task(payload,{**existing,key:'changed'},**deps)
            self.assertEqual(raised.exception.status_code,409)

    def test_video_unavailable_or_changed_provider_never_accepts_binding(self):
        for provider in ({'id':'other','video_models':['model-a']},{'id':'provider-a','enabled':False,'video_models':['model-a']},{'id':'provider-a','video_models':['other']}):
            payload,deps=self.video_fixture();deps['get_api_provider_exact'].return_value=provider
            with self.subTest(provider=provider),self.assertRaises(HTTPException) as raised:video.validate_canvas_video_assistant_task(payload,check_provider=True,**deps)
            self.assertEqual(raised.exception.status_code,409)
        payload,deps=self.video_fixture();deps['get_api_provider_exact'].side_effect=HTTPException(404,'absent')
        with self.assertRaises(HTTPException) as raised:video.validate_canvas_video_assistant_task(payload,check_provider=True,**deps)
        self.assertEqual(raised.exception.status_code,409)

    def query_fixture(self,protocol):
        provider={'id':'runninghub' if protocol=='runninghub_openapi' else 'provider-a','protocol':protocol}
        return provider,dict(get_api_provider_exact=Mock(return_value=provider),HTTPException=HTTPException,
            is_runninghub_provider=lambda p:p['protocol']=='runninghub_openapi',is_jimeng_provider=lambda p:p['protocol']=='jimeng_cli',
            is_tudou_provider=lambda p:p['protocol']=='tudou_http_get',is_agnes_provider=lambda p,m:p['protocol']=='agnes_http_get' and m=='model-a',
            query_runninghub_video_task_once=AsyncMock(return_value=({'status':'pending'},['/output/a.mp4'])),
            query_jimeng_video_task_once=AsyncMock(return_value=({'status':'pending'},['/output/a.mp4'])),
            query_video_task_once=AsyncMock(return_value=({'status':'pending'},['/output/a.mp4'])))

    async def test_remote_dispatch_preserves_original_reader_and_arguments(self):
        for mode in ('runninghub_openapi','jimeng_cli','http_get','tudou_http_get','agnes_http_get'):
            provider,deps=self.query_fixture(mode)
            result=await video._query_canvas_video_remote({'model':'model-a'},'remote-a',provider['id'],mode,**deps)
            self.assertEqual(result,(provider,{'status':'pending'},['/output/a.mp4']))
            if mode=='runninghub_openapi':deps['query_runninghub_video_task_once'].assert_awaited_once_with(provider,'remote-a')
            elif mode=='jimeng_cli':deps['query_jimeng_video_task_once'].assert_awaited_once_with('remote-a','video')
            else:deps['query_video_task_once'].assert_awaited_once_with(provider,'remote-a',query_mode=mode,model='model-a')

    async def test_remote_protocol_change_and_unknown_mode_never_query(self):
        for protocol,mode in [('http_get','runninghub_openapi'),('http_get','jimeng_cli'),('http_get','tudou_http_get'),('http_get','agnes_http_get'),('jimeng_cli','http_get'),('runninghub_openapi','http_get'),('http_get','unknown')]:
            provider,deps=self.query_fixture(protocol)
            with self.subTest(protocol=protocol,mode=mode),self.assertRaises(HTTPException) as raised:
                await video._query_canvas_video_remote({'model':'model-a'},'remote-a','runninghub' if mode=='runninghub_openapi' else provider['id'],mode,**deps)
            self.assertEqual(raised.exception.status_code,409)
            for name in ('query_runninghub_video_task_once','query_jimeng_video_task_once','query_video_task_once'):deps[name].assert_not_awaited()

    async def test_remote_missing_provider_preserves_cause_and_refuses_query(self):
        _,deps=self.query_fixture('http_get');cause=HTTPException(404,'missing');deps['get_api_provider_exact'].side_effect=cause
        with self.assertRaises(HTTPException) as raised:await video._query_canvas_video_remote({},'remote-a','provider-a','http_get',**deps)
        self.assertEqual(raised.exception.status_code,409);self.assertIs(raised.exception.__cause__,cause)


if __name__=='__main__':unittest.main()
