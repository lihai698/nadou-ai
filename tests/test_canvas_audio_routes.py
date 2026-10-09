"""只加载真实音频路由定义，隔离目录与模拟供应商，不读取个人配置。"""
import ast
import asyncio
import hashlib
import json
import mimetypes
import os
import tempfile
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Dict, List
from unittest.mock import patch

import httpx
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field
from backend.canvas_audio import *
from backend.task_records import (TaskRecordError, _read_task_record_unlocked,
    _write_task_record_unlocked, read_task_record, write_task_record, task_records_lock, mark_interrupted_task)
from backend.task_states import task_state_update


def load_routes(root):
    source = ast.parse(Path('main.py').read_text(encoding='utf-8'))
    names = {'CanvasAudioTaskRequest', 'build_canvas_audio_result', 'run_canvas_audio_task',
             'create_canvas_audio_task', 'get_canvas_audio_task', 'refresh_canvas_audio_task', '_durable_canvas_task', '_interrupted_canvas_task', '_public_canvas_task'}
    selected = [n for n in source.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and n.name in names]
    selected += [n for n in source.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id in {'_CANVAS_TASK_PERSISTED_FIELDS', '_CANVAS_RESULT_PERSISTED_FIELDS'} for t in n.targets)]
    ns = dict(globals(), app=FastAPI(), CANVAS_TASKS={}, CANVAS_TASK_LOCK=threading.RLock(),
              CANVAS_TASK_DIR=str(root), CANVAS_TASK_PROCESS_ID='test-process', CANVAS_TASK_UNKNOWN='服务重启，原任务状态未知', CANVAS_AUDIO_TASK_GATE=asyncio.Semaphore(3),
              sanitize_record_usage=lambda value: None, task_context=lambda *args, **kwargs: {},
              api_headers=lambda **kwargs: {'Authorization': 'Bearer test-only'},
              public_comfy_error_detail=lambda *args, **kwargs: kwargs.get('fallback', '音频失败'),
              safe_upstream_http_detail=lambda response: '音频平台请求失败')
    exec(compile(ast.Module(body=selected, type_ignores=[]), 'main-audio-routes', 'exec'), ns)
    ns['_write_canvas_task_record'] = lambda task, **kw: write_task_record(str(root), ns['_durable_canvas_task'](task))
    ns['_read_canvas_task_record'] = lambda task_id: read_task_record(str(root), task_id)
    ns['_load_canvas_task_for_worker'] = lambda task_id: ns['CANVAS_TASKS'].get(task_id)
    return ns


class AudioRouteTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.ns = load_routes(self.root)
        self.provider = {'id': 'p', 'enabled': True, 'protocol': 'openai', 'base_url': 'https://provider.test/v1',
                         'audio_models': ['asr'], 'audio_generation_models': ['tts']}
        self.ns['get_api_provider_exact'] = lambda identifier: self.provider
        self.payload = self.ns['CanvasAudioTaskRequest'](client_task_id='canvas_audio_test12345678', provider_id='p',
            model='asr', operation='recognition', references=[{'kind':'audio', 'url':'/assets/a.wav', 'name':'a.wav'}])

    async def asyncTearDown(self):
        self.temp.cleanup()

    async def test_queue_is_durable_and_duplicate_never_calls_provider_twice(self):
        started = asyncio.Event()
        calls = []
        async def fake(payload):
            calls.append(payload.model);started.set();return {'kind':'text','text':'识别文字'}
        self.ns['build_canvas_audio_result'] = fake
        request = SimpleNamespace(state=SimpleNamespace())
        submitted = await self.ns['create_canvas_audio_task'](self.payload, request)
        await started.wait();await asyncio.sleep(0)
        duplicate = await self.ns['create_canvas_audio_task'](self.payload, request)
        self.assertEqual(submitted['task_id'], duplicate['task_id'])
        self.assertEqual(calls, ['asr'])
        self.ns['CANVAS_TASKS'].clear()
        result = await self.ns['get_canvas_audio_task'](self.payload.client_task_id)
        self.assertEqual(result['result']['text'], '识别文字')
        await self.ns['refresh_canvas_audio_task'](self.payload.client_task_id)
        self.assertEqual(calls, ['asr'])

    async def test_recognition_posts_multipart_and_returns_real_text(self):
        media = self.root/'audio.wav';media.write_bytes(b'RIFF'+b'\0'*40)
        self.ns['video_deconstruction_media'] = lambda: SimpleNamespace(resolve=lambda source: media)
        calls = []
        real_client = httpx.AsyncClient
        def respond(request):
            calls.append(request)
            self.assertIn(b'name="file"', request.content)
            self.assertIn(b'asr', request.content)
            self.assertNotIn(b'alloy', request.content)
            return httpx.Response(200, json={'text':'真实模拟识别文字'})
        with patch.object(httpx, 'AsyncClient', side_effect=lambda **kw: real_client(transport=httpx.MockTransport(respond))):
            result = await self.ns['build_canvas_audio_result'](self.payload)
        self.assertEqual(result['kind'], 'text')
        self.assertEqual(result['text'], '真实模拟识别文字')
        self.assertEqual(str(calls[0].url), 'https://provider.test/v1/audio/transcriptions')

    async def test_uncertain_response_becomes_unknown_without_retry(self):
        self.ns['CANVAS_TASKS'][self.payload.client_task_id] = {'id': self.payload.client_task_id, 'type':'audio-generation', 'status':'queued'}
        async def fail(payload):
            raise httpx.ReadTimeout('test-only')
        self.ns['build_canvas_audio_result'] = fail
        await self.ns['run_canvas_audio_task'](self.payload.client_task_id, self.payload)
        result = await self.ns['get_canvas_audio_task'](self.payload.client_task_id)
        self.assertEqual(result['status'], 'unknown')

    async def test_completed_result_is_not_reported_until_durable(self):
        self.ns['CANVAS_TASKS'][self.payload.client_task_id] = {'id':self.payload.client_task_id,'type':'audio-generation','status':'queued'}
        original=self.ns['_write_canvas_task_record']
        def disk_fail(task, **kwargs):
            if task['status']=='succeeded':
                if kwargs.get('required'):raise TaskRecordError('disk full')
                return False
            return original(task, **kwargs)
        self.ns['_write_canvas_task_record']=disk_fail
        async def result(payload):return {'kind':'text','text':'不能丢的识别文字'}
        self.ns['build_canvas_audio_result']=result
        await self.ns['run_canvas_audio_task'](self.payload.client_task_id,self.payload)
        with self.assertRaises(HTTPException) as caught:
            await self.ns['get_canvas_audio_task'](self.payload.client_task_id)
        self.assertEqual(caught.exception.status_code,503)
        self.ns['_write_canvas_task_record']=original
        recovered=await self.ns['get_canvas_audio_task'](self.payload.client_task_id)
        self.assertEqual(recovered['result']['text'],'不能丢的识别文字')
        self.ns['CANVAS_TASKS'].clear()
        self.assertEqual((await self.ns['get_canvas_audio_task'](self.payload.client_task_id))['result']['text'],'不能丢的识别文字')

    async def test_restart_queued_task_is_unknown_and_never_submitted(self):
        task={'id':self.payload.client_task_id,'type':'audio-generation','status':'queued','process_id':'previous-process'}
        self.ns['_write_canvas_task_record'](task)
        result=await self.ns['get_canvas_audio_task'](task['id'])
        self.assertEqual(result['status'],'unknown')
        self.assertNotIn('process_id',result)

    async def test_speech_binary_is_validated_and_saved_before_return(self):
        self.ns['output_path_for']=lambda name, group:str(self.root/name)
        self.ns['output_url_for']=lambda name, group:'/output/'+name
        payload=self.ns['CanvasAudioTaskRequest'](client_task_id='canvas_audio_generate123456',provider_id='p',model='tts',prompt='中文配音',settings={'audioFormat':'wav'})
        content=b'RIFF'+b'\0'*4+b'WAVE'+b'\0'*40
        real_client=httpx.AsyncClient
        def respond(request):
            self.assertEqual(json.loads(request.content)['input'],'中文配音')
            return httpx.Response(200,content=content,headers={'content-type':'audio/wav'})
        with patch.object(httpx,'AsyncClient',side_effect=lambda **kw:real_client(transport=httpx.MockTransport(respond))):
            result=await self.ns['build_canvas_audio_result'](payload)
        item=result['audios'][0]
        self.assertEqual((self.root/item['name']).read_bytes(),content)
        self.assertEqual(item['kind'],'audio')
        self.assertEqual(item['sizeBytes'],len(content))


if __name__ == '__main__': unittest.main()
