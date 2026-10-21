"""助手与现有原生后端的应用服务：读取工作流字段、控制既有任务与执行媒体导出。

目录、读取器和提交入口显式注入；不持有会话，不导入 main，不直接调用供应商。
"""

async def query_canvas_assistant_native_task(kind, task_id, *, asyncio, get_canvas_depth_capture, get_canvas_image_task, get_canvas_video_task, get_canvas_comfy_task, HTTPException):
    if kind == 'depth':
        return await asyncio.to_thread(get_canvas_depth_capture, task_id)
    reader = {'image': get_canvas_image_task, 'video': get_canvas_video_task, 'comfy': get_canvas_comfy_task}.get(kind)
    if not reader:
        raise HTTPException(422, '未开放的节点原任务查询种类')
    return await reader(task_id)


async def control_canvas_assistant_native_task(action, kind, task_id, *, asyncio, refresh_canvas_image_task, refresh_canvas_video_task, cancel_canvas_depth_capture, HTTPException):
    """只控制现有编号；不调用任何生成提交入口。"""
    if action == 'task_refresh':
        reader = {'image':refresh_canvas_image_task, 'video':refresh_canvas_video_task}.get(kind)
        if reader:
            return await reader(task_id)
    elif action == 'task_cancel' and kind == 'depth':
        return await asyncio.to_thread(cancel_canvas_depth_capture, task_id)
    raise HTTPException(422, '原任务服务不支持此控制操作')


def canvas_assistant_workflow_fields(node, *, HTTPException, get_workflow, runninghub_provider_with_workflow_store, runninghub_provider, re, runninghub_entry_id, load_runninghub_workflow_store, runninghub_workflow_store_key):
    """只读取当前原生工作流字段；不把密钥或工作流原始代码提供给助手。"""
    if node.get('type') == 'comfy':
        name = node.get('comfyWorkflow')
        if not name:
            raise HTTPException(409, '请先在原生节点选择工作流')
        return get_workflow(name).get('config', {}).get('fields') or []
    if node.get('type') == 'rh':
        mode = node.get('rhMode') or 'app'
        provider = runninghub_provider_with_workflow_store(runninghub_provider() or {})
        selected = re.fullmatch(r'(app|workflow|model):(.+)', str(node.get('rhConfigKey') or ''))
        if selected:
            selected_mode, selected_id = selected.groups()
            entries = provider.get('rh_workflows' if selected_mode == 'workflow' else 'rh_apps') or []
            found = selected_id in (provider.get('image_models') or []) if selected_mode == 'model' else any(
                runninghub_entry_id(item, selected_mode) == selected_id and item.get('enabled') is not False and item.get('hidden') is not True for item in entries if isinstance(item, dict))
            if found and (mode != selected_mode or selected_mode != 'model' and str(node.get('workflowId' if selected_mode == 'workflow' else 'webappId') or '') != selected_id):
                raise HTTPException(409, '节点工作流选择和保存编号不一致，请在原生节点重新选择并保存')
        if mode == 'model':
            return []
        key = str(node.get('workflowId' if mode == 'workflow' else 'webappId') or '')
        entries = provider.get('rh_workflows' if mode == 'workflow' else 'rh_apps') or []
        entry = next((item for item in entries if isinstance(item, dict) and runninghub_entry_id(item, mode) == key), None)
        if entry and (entry.get('enabled') is False or entry.get('hidden') is True):
            raise HTTPException(409, '原生选中的工作流已停用，请重新手动选择')
        def usable(fields):
            enabled = [field for field in fields if isinstance(field, dict) and field.get('enabled') is True]
            return enabled or fields
        if entry and entry.get('fields'):
            return usable(entry['fields'])
        if mode == 'workflow':
            config = load_runninghub_workflow_store().get(runninghub_workflow_store_key(key)) or {}
            if isinstance(config.get('fields'), list):
                return usable(config['fields'])
        return (node.get('rhWorkflowInfo' if mode == 'workflow' else 'rhAppInfo') or {}).get('nodeInfoList') or []
    return []


def prepare_canvas_assistant_media_export(canvas_id, node, options, request_id=None, *, DATA_DIR, subprocess, HTTPException, json, local_media_path_from_url, OUTPUT_DIR, ASSETS_DIR, _current_storage_dirs):
    from backend.canvas_assistant_media_export import prepare_media_export
    from backend.canvas_clip import find_media_tools
    _,ffprobe=find_media_tools(DATA_DIR)
    def probe(path):
        result=subprocess.run([ffprobe,'-v','error','-show_streams','-show_format','-of','json',str(path)],capture_output=True,text=True,timeout=30)
        if result.returncode:raise HTTPException(409,'无法探测原本地媒体')
        return json.loads(result.stdout)
    return prepare_media_export(canvas_id,node,options,local_media_path_from_url,[OUTPUT_DIR,ASSETS_DIR,*_current_storage_dirs().values()],probe,request_id=request_id)


async def control_canvas_assistant_media_export(proposal, *, submit=False, load_canvas, HTTPException, OUTPUT_DIR, ASSETS_DIR, _current_storage_dirs, DATA_DIR, subprocess, json, asyncio, local_media_path_from_url, canvas_clip_manager, create_canvas_clip_export):
    from pathlib import Path
    from backend.canvas_assistant_media_export import validate_media_export_snapshot,verify_clip_export
    from backend.canvas_clip import find_media_tools
    plan=proposal['mediaExportPlan'];canvas=load_canvas(plan['canvasId'])
    node=next((n for n in canvas['nodes'] if n['id']==plan['nodeId']),None)
    if not node or canvas.get('readOnly') or canvas.get('readonly'):raise HTTPException(409,'原导出画布或节点不可写')
    from backend.canvas_assistant_native import _related_task_busy
    from backend.canvas_assistant_node_rules import is_busy
    if submit and (is_busy(node) or _related_task_busy(canvas,node)):raise HTTPException(409,'原节点仍有其它任务，未开始媒体导出')
    roots=[OUTPUT_DIR,ASSETS_DIR,*_current_storage_dirs().values()]
    _,ffprobe=find_media_tools(DATA_DIR)
    def probe(path):
        result=subprocess.run([ffprobe,'-v','error','-show_streams','-show_format','-of','json',str(path)],capture_output=True,text=True,timeout=30)
        if result.returncode:raise HTTPException(409,'无法探测原本地媒体')
        return json.loads(result.stdout)
    await asyncio.to_thread(validate_media_export_snapshot,plan,node,local_media_path_from_url,roots,probe)
    binding={k:plan[k] for k in ('canvasId','nodeId','rangeHash','requestId')}
    results=[]
    if plan['mode']=='clip-task':
        manager=canvas_clip_manager()
        if submit:await asyncio.to_thread(create_canvas_clip_export,plan['nativeRequest'])
        with manager.lock:task_id=manager.requests.get((plan['canvasId'],plan['nodeId'],plan['requestId']))
        if not task_id:return {'status':'unknown','results':[],'message':'未找到原导出受理记录，不重复提交'}
        task=manager.get(task_id);binding['taskId']=task_id
        checked=await asyncio.to_thread(verify_clip_export,plan,task,binding,local_media_path_from_url,roots,probe)
        results=task['results'];checked['error']=task.get('error','')
    else:
        raise HTTPException(409,'此媒体导出类型已不支持')
    return {'status':checked['status'],'results':[{k:r[k] for k in ('url','name','kind','durationSeconds','sourceClipId') if k in r} for r in results],'taskId':checked.get('taskId'),'error':checked.get('error',''),'message':checked.get('message','')}
