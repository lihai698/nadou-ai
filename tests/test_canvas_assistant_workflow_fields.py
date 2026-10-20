"""真实main字段入口，模拟配置读取边界，不加载用户配置或服务。"""
import ast
import asyncio
import re
import unittest
from pathlib import Path
from fastapi import HTTPException
from backend import provider_registry_service


class WorkflowFieldSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        module=ast.parse(Path('main.py').read_text(encoding='utf8'))
        cls.functions=ast.Module(body=[n for n in module.body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef)) and n.name in {'canvas_assistant_workflow_fields','runninghub_entry_id','control_canvas_assistant_native_task'}],type_ignores=[])

    def test_task_control_real_entry_only_forwards_refresh_or_existing_depth_cancel(self):
        calls=[]
        async def image(task):calls.append(('image',task));return {'task_id':task}
        async def video(task):calls.append(('video',task));return {'task_id':task}
        def depth(task):calls.append(('depth',task));return {'id':task}
        namespace={'asyncio':asyncio,'HTTPException':HTTPException,'refresh_canvas_image_task':image,'refresh_canvas_video_task':video,'cancel_canvas_depth_capture':depth}
        exec(compile(self.functions,'main.py','exec'),namespace)
        control=namespace['control_canvas_assistant_native_task']
        for action,kind in [('task_refresh','image'),('task_refresh','video'),('task_cancel','depth')]:
            asyncio.run(control(action,kind,'original-id'))
        self.assertEqual(calls,[('image','original-id'),('video','original-id'),('depth','original-id')])
        for action,kind in [('task_cancel','comfy'),('task_cancel','video'),('task_refresh','depth'),('run','image')]:
            with self.assertRaises(HTTPException):asyncio.run(control(action,kind,'original-id'))
        self.assertEqual(len(calls),3)

    def test_selected_entry_and_enabled_fields_match_native_request(self):
        fields=[{'nodeId':'1','fieldName':'steps','enabled':True},{'nodeId':'2','fieldName':'ignored','enabled':False}]
        provider={'rh_apps':[{'appId':'selected','fields':fields},{'appId':'old','fields':[{'fieldName':'wrong'}]}]}
        namespace={'re':re,'HTTPException':HTTPException,'provider_registry_service':provider_registry_service,'runninghub_provider':lambda:provider,'runninghub_provider_with_workflow_store':lambda p:p,'load_runninghub_workflow_store':lambda:{},'runninghub_workflow_store_key':lambda x:x}
        exec(compile(self.functions,'main.py','exec'),namespace)
        read=namespace['canvas_assistant_workflow_fields']
        self.assertEqual(read({'type':'rh','rhMode':'app','webappId':'selected','rhConfigKey':'app:selected'}),[fields[0]])
        with self.assertRaises(HTTPException):read({'type':'rh','rhMode':'app','webappId':'old','rhConfigKey':'app:selected'})
