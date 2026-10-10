"""助手图片任务归属实际入队/落盘验证；模拟工作线程，禁止真实服务调用。"""
import tempfile
import asyncio
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
import main


class CanvasImageAssistantOwnershipTests(unittest.IsolatedAsyncioTestCase):
    async def test_loop_slot_atomic_enqueue_is_idempotent_and_rejects_changed_request(self):
        binding={'assistant_action_id':'loop-action','canvas_id':'canvas-one','node_id':'loop','input_hash':'b'*64,'assistant_slot_key':'0:0'}
        request=SimpleNamespace(state=SimpleNamespace(trace_id='',request_id=''))
        payload=main.OnlineImageRequest(prompt='私有测试正文，不落盘',provider_id='mock',model='manual',**binding)
        worker=AsyncMock()
        with tempfile.TemporaryDirectory() as folder,patch.object(main,'CANVAS_TASK_DIR',folder),patch.object(main,'CANVAS_TASKS',{}),patch.object(main,'run_canvas_image_task',worker):
            first,second=await asyncio.gather(main.enqueue_canvas_image_task(payload,request),main.enqueue_canvas_image_task(payload,request))
            self.assertEqual(first['task_id'],second['task_id']);await asyncio.sleep(0);self.assertEqual(worker.await_count,1)
            main.CANVAS_TASKS.clear()
            again=await main.enqueue_canvas_image_task(payload,request);self.assertEqual(again['task_id'],first['task_id']);self.assertEqual(worker.await_count,1)
            for field,value in [('prompt','changed'),('model','foreign'),('size','1536x1024')]:
                with self.subTest(field=field),self.assertRaises(HTTPException):await main.enqueue_canvas_image_task(payload.model_copy(update={field:value}),request)
            public=await main.get_canvas_image_task(first['task_id']);self.assertEqual(public['assistant_slot_key'],'0:0');self.assertNotIn('assistant_request_hash',public)
            record=next(Path(folder).glob('*.json')).read_text(encoding='utf8');self.assertNotIn('私有测试正文',record)
            other=await main.enqueue_canvas_image_task(payload.model_copy(update={'assistant_slot_key':'1:1'}),request);self.assertNotEqual(other['task_id'],first['task_id'])

    async def test_image_task_persists_complete_binding_without_prompt(self):
        binding={'assistant_action_id':'action-one','canvas_id':'canvas-one','node_id':'group-one','input_hash':'a'*64}
        request=SimpleNamespace(state=SimpleNamespace(trace_id='',request_id=''))
        with tempfile.TemporaryDirectory() as folder, patch.object(main,'CANVAS_TASK_DIR',folder), patch.object(main,'CANVAS_TASKS',{}), patch.object(main,'run_canvas_image_task',new=AsyncMock()):
            result=await main.enqueue_canvas_image_task(main.OnlineImageRequest(prompt='隔离正文不可写入任务记录',provider_id='mock',model='mock-image',**binding),request)
            task=await main.get_canvas_image_task(result['task_id'])
            for key,value in binding.items():self.assertEqual(task[key],value)
            record=next(Path(folder).glob('*.json')).read_text(encoding='utf8')
            self.assertNotIn('隔离正文不可写入任务记录',record)
            main.CANVAS_TASKS.clear()
            restored=await main.get_canvas_image_task(result['task_id'])
            for key,value in binding.items():self.assertEqual(restored[key],value)
            for invalid in [{'canvas_id':''},{'node_id':'../other'},{'input_hash':'invalid'}]:
                with self.subTest(invalid=invalid),self.assertRaises(HTTPException):
                    await main.enqueue_canvas_image_task(main.OnlineImageRequest(prompt='测试',**{**binding,**invalid}),request)
            self.assertEqual(len(list(Path(folder).glob('*.json'))),1)
            manual=await main.enqueue_canvas_image_task(main.OnlineImageRequest(prompt='旧手动入口'),request)
            self.assertNotIn('assistant_action_id',await main.get_canvas_image_task(manual['task_id']))
