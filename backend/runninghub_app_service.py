"""RunningHub 应用/工作流网络执行；配置、认证及素材操作由宿主提供。"""
import asyncio
import json
import os
import time
import urllib.parse
from dataclasses import dataclass
from typing import Callable

import httpx

from .runninghub_fields import (
    rh_sort_fields, rh_field_indexes, rh_field_kind, rh_field_role,
    rh_default_value, rh_random_field_value, sanitize_runninghub_node_info_list,
    sanitize_seed_like_workflow_values,
)
from .runninghub_protocol import (
    runninghub_aspect_from_size, runninghub_resolution_from_size, runninghub_schema_value,
)


class RunningHubAppError(Exception):
    def __init__(self, status_code, detail):
        super().__init__(str(detail))
        self.status_code = status_code
        self.detail = detail


@dataclass(frozen=True)
class RunningHubAppService:
    """单次调用依赖；不持有任务状态或另一份供应商配置。"""
    provider: Callable
    api_key: Callable
    app_headers: Callable
    endpoint_url: Callable
    local_asset_path: Callable
    content_type: Callable
    error_detail: Callable
    fail_reason: Callable
    parse_size: Callable
    extract_outputs: Callable
    public_app_info: Callable
    log_error: Callable
    workflow_json_error: Callable
    workflow_node_info: Callable
    workflow_fields: Callable
    workflow_store_key: Callable
    store_output: Callable
    image_meta: Callable
    rewrite_url: Callable
    reference_limit: int
    client_factory: Callable = httpx.AsyncClient
    sleep: Callable = asyncio.sleep
    clock: Callable = time.monotonic

    async def upload_filename(self, client, provider, url, use_wallet=False):
        """把本地/远程素材上传到 RunningHub /task/openapi/upload，返回 fileName（供 nodeInfoList 使用）。"""
        text = str(url or '').strip()
        if not text:
            return ''
        path = self.local_asset_path(text)
        if path:
            filename = os.path.basename(path)
            content_type = self.content_type(path)
            with open(path, 'rb') as fh:
                content = fh.read()
        elif text.startswith(('http://', 'https://')):
            response = await client.get(text, follow_redirects=True)
            response.raise_for_status()
            content = response.content
            content_type = response.headers.get('content-type') or 'application/octet-stream'
            filename = os.path.basename(urllib.parse.urlsplit(text).path) or 'asset.bin'
        else:
            return ''
        if not content:
            return ''
        api_key = self.api_key(provider, use_wallet=use_wallet)
        upload_url = self.endpoint_url(provider, '/task/openapi/upload')
        files = {'file': (filename, content, content_type)}
        data = {'apiKey': api_key, 'fileType': 'input'}
        response = await client.post(upload_url, headers=self.app_headers(False, use_wallet), data=data, files=files)
        raw = response.json()
        if isinstance(raw, dict) and raw.get('code') in (0, '0') and isinstance(raw.get('data'), dict) and raw['data'].get('fileName'):
            return raw['data']['fileName']
        raise RunningHubAppError(status_code=502, detail=self.error_detail(self.fail_reason(raw) or 'RunningHub 上传素材失败', raw, endpoint=upload_url))

    async def generate_image(self, prompt, size, model, reference_images, provider, entry, on_remote_accept=None):
        """运行 RunningHub 工作流 / AI 应用（与智能画布一致的运行方式），返回首张图片结果。"""
        kind = entry['kind']
        entry_id = entry['id']
        fields = rh_sort_fields([f for f in entry.get('fields') or [] if isinstance(f, dict) and f.get('enabled') is True])
        idx_map = rh_field_indexes(fields)
        use_wallet = False
        timeout = httpx.Timeout(connect=20.0, read=1800.0, write=240.0, pool=20.0)
        aspect = runninghub_aspect_from_size(size, '', parse_size=self.parse_size)
        resolution = runninghub_resolution_from_size(size, '', parse_size=self.parse_size)
        (width, height) = self.parse_size(size)

        def requested_size_field_value(field):
            names = {str(field.get('fieldName') or '').strip().lower(), str(field.get('fieldKey') or '').strip().lower(), str(field.get('label') or '').strip().lower()}
            if aspect and names & {'aspectratio', 'aspect_ratio', 'ratio'}:
                return runninghub_schema_value(field, aspect)
            if resolution and 'resolution' in names:
                return runninghub_schema_value(field, resolution)
            if width and 'width' in names:
                return width
            if height and 'height' in names:
                return height
            return None
        async with self.client_factory(timeout=timeout) as client:
            uploaded = []
            for ref in (reference_images or [])[:self.reference_limit]:
                ref_url = ref.get('url') if isinstance(ref, dict) else ref
                if not ref_url:
                    continue
                file_name = await self.upload_filename(client, provider, ref_url, use_wallet)
                if file_name:
                    uploaded.append(file_name)
            node_info_list = []
            prompt_text = str(prompt or '').strip()
            for field in fields:
                node_id = str(field.get('nodeId') or '').strip()
                field_name = str(field.get('fieldName') or '').strip()
                if not node_id or not field_name:
                    continue
                kind_f = rh_field_kind(field)
                if kind_f in ('image', 'video', 'audio'):
                    if kind_f != 'image':
                        continue
                    index = idx_map.get((node_id, field_name), 0)
                    value = uploaded[index] if index < len(uploaded) else ''
                    if not value:
                        if field.get('required') is True:
                            value = rh_default_value(field)
                            if not value:
                                continue
                        else:
                            continue
                    node_info_list.append({'nodeId': node_id, 'fieldName': field_name, 'fieldValue': value})
                elif rh_field_role(field) == 'prompt':
                    value = prompt_text or rh_default_value(field)
                    node_info_list.append({'nodeId': node_id, 'fieldName': field_name, 'fieldValue': value})
                elif kind_f == 'number' and field.get('random_enabled') is True:
                    node_info_list.append({'nodeId': node_id, 'fieldName': field_name, 'fieldValue': rh_random_field_value(field)})
                else:
                    value = requested_size_field_value(field)
                    if value is None:
                        value = rh_default_value(field)
                    node_info_list.append({'nodeId': node_id, 'fieldName': field_name, 'fieldValue': value})
            api_key = self.api_key(provider, use_wallet=use_wallet)
            if kind == 'workflow':
                submit_url = self.endpoint_url(provider, '/task/openapi/create')
                body = {'apiKey': api_key, 'workflowId': entry_id, 'addMetadata': True}
                if node_info_list:
                    body['nodeInfoList'] = node_info_list
            else:
                submit_url = self.endpoint_url(provider, '/task/openapi/ai-app/run')
                body = {'apiKey': api_key, 'webappId': entry_id, 'nodeInfoList': node_info_list}
            response = await client.post(submit_url, headers=self.app_headers(True, use_wallet), json=body)
            raw = response.json()
            if not (isinstance(raw, dict) and raw.get('code') in (0, '0')):
                raise RunningHubAppError(status_code=502, detail=self.error_detail(self.fail_reason(raw) or 'RunningHub 提交失败', raw, endpoint=submit_url, entryId=entry_id))
            task_id = raw.get('data', {}).get('taskId') if isinstance(raw.get('data'), dict) else ''
            if not task_id:
                raise RunningHubAppError(status_code=502, detail=self.error_detail('RunningHub 未返回 taskId', raw, endpoint=submit_url, entryId=entry_id))
            if on_remote_accept is not None:
                await on_remote_accept(task_id, query_mode='runninghub_image')
            query_url = self.endpoint_url(provider, '/task/openapi/outputs')
            deadline = self.clock() + 1800
            last_payload = None
            while self.clock() < deadline:
                await self.sleep(2.5)
                query_response = await client.post(query_url, headers=self.app_headers(True), json={'apiKey': api_key, 'taskId': task_id})
                query_raw = query_response.json()
                last_payload = query_raw
                code = query_raw.get('code') if isinstance(query_raw, dict) else None
                if code in (0, '0'):
                    outputs = self.extract_outputs(query_raw.get('data'))
                    for remote in outputs:
                        if str(remote or '').startswith(('http://', 'https://', '/output/', '/assets/')):
                            return ({'type': 'url', 'value': str(remote)}, query_raw)
                    raise RunningHubAppError(status_code=502, detail=self.error_detail('RunningHub 任务无图片输出', query_raw, endpoint=query_url, taskId=task_id))
                if code in (805, '805'):
                    raise RunningHubAppError(status_code=502, detail=self.error_detail(f"RunningHub 任务失败：{self.fail_reason(query_raw) or '上游返回失败状态'}", query_raw, endpoint=query_url, taskId=task_id))
            raise RunningHubAppError(status_code=504, detail=self.error_detail('RunningHub 任务超时', last_payload, endpoint=query_url, taskId=task_id))

    async def app_info(self, webappId=''):
        webapp_id = str(webappId or '').strip()
        if not webapp_id:
            raise RunningHubAppError(status_code=400, detail='webappId 必填')
        provider = self.provider()
        api_key = self.api_key(provider)
        url = self.endpoint_url(provider, f'/api/webapp/apiCallDemo?apiKey={urllib.parse.quote(api_key)}&webappId={urllib.parse.quote(webapp_id)}')
        async with self.client_factory(timeout=httpx.Timeout(connect=20.0, read=120.0, write=30.0, pool=20.0)) as client:
            try:
                response = await client.get(url, headers=self.app_headers(False))
                raw = response.json()
            except httpx.HTTPStatusError as exc:
                raise RunningHubAppError(status_code=exc.response.status_code, detail=self.error_detail('RunningHub 应用信息请求失败', exc.response.text, endpoint=url, webappId=webapp_id)) from exc
            except Exception as exc:
                raise RunningHubAppError(status_code=502, detail=self.error_detail(f'请求 RunningHub 应用信息失败：{exc}', endpoint=url, webappId=webapp_id)) from exc
        if response.status_code >= 400:
            raise RunningHubAppError(status_code=response.status_code, detail=self.error_detail(f'RunningHub HTTP {response.status_code}', raw, endpoint=url, webappId=webapp_id))
        if isinstance(raw, dict) and raw.get('code') not in (0, '0', None):
            raise RunningHubAppError(status_code=400, detail=self.error_detail(self.fail_reason(raw) or 'RunningHub 查询失败', raw, endpoint=url, webappId=webapp_id))
        data = raw.get('data') if isinstance(raw, dict) else {}
        return {'success': True, 'data': self.public_app_info(data, api_key)}

    async def submit(self, payload):
        webapp_id = str(payload.webappId or '').strip()
        if not webapp_id:
            raise RunningHubAppError(status_code=400, detail='webappId 必填')
        provider = self.provider()
        api_key = self.api_key(provider, use_wallet=payload.useWallet)
        body = {'apiKey': api_key, 'webappId': webapp_id, 'nodeInfoList': sanitize_runninghub_node_info_list(payload.nodeInfoList or [])}
        instance_type = str(payload.instanceType or '').strip()
        if instance_type:
            body['instanceType'] = instance_type
        url = self.endpoint_url(provider, '/task/openapi/ai-app/run')
        async with self.client_factory(timeout=httpx.Timeout(connect=20.0, read=180.0, write=120.0, pool=20.0)) as client:
            try:
                response = await client.post(url, headers=self.app_headers(True, payload.useWallet), json=body)
                raw = response.json()
            except Exception as exc:
                raise RunningHubAppError(status_code=502, detail=self.error_detail(f'提交 RunningHub 任务失败：{exc}', endpoint=url, webappId=webapp_id)) from exc
        if response.status_code >= 400:
            self.log_error('submit-http', raw, endpoint=url, webappId=webapp_id, status=response.status_code)
            raise RunningHubAppError(status_code=response.status_code, detail=self.error_detail(f'RunningHub HTTP {response.status_code}', raw, endpoint=url, webappId=webapp_id))
        if isinstance(raw, dict) and raw.get('code') in (0, '0'):
            task_id = raw.get('data', {}).get('taskId') if isinstance(raw.get('data'), dict) else ''
            if not task_id:
                raise RunningHubAppError(status_code=502, detail=self.error_detail('RunningHub 未返回 taskId', raw, endpoint=url, webappId=webapp_id))
            return {'success': True, 'data': {'taskId': task_id}}
        self.log_error('submit-rejected', raw, endpoint=url, webappId=webapp_id)
        raise RunningHubAppError(status_code=400, detail=self.error_detail(self.fail_reason(raw) or 'RunningHub 提交失败', raw, endpoint=url, webappId=webapp_id))

    async def submit_workflow(self, payload):
        workflow_id = str(payload.workflowId or '').strip()
        if not workflow_id:
            raise RunningHubAppError(status_code=400, detail='workflowId 必填')
        provider = self.provider()
        api_key = self.api_key(provider, use_wallet=payload.useWallet)
        body = {'apiKey': api_key, 'workflowId': workflow_id, 'addMetadata': True}
        if payload.nodeInfoList:
            body['nodeInfoList'] = sanitize_runninghub_node_info_list(payload.nodeInfoList)
        workflow_payload = payload.workflow
        if workflow_payload:
            if isinstance(workflow_payload, (dict, list)):
                body['workflow'] = json.dumps(sanitize_seed_like_workflow_values(workflow_payload), ensure_ascii=False)
            else:
                body['workflow'] = str(workflow_payload)
        url = self.endpoint_url(provider, '/task/openapi/create')
        async with self.client_factory(timeout=httpx.Timeout(connect=20.0, read=180.0, write=120.0, pool=20.0)) as client:
            try:
                response = await client.post(url, headers=self.app_headers(True, payload.useWallet), json=body)
                raw = response.json()
            except Exception as exc:
                raise RunningHubAppError(status_code=502, detail=self.error_detail(f'提交 RunningHub 工作流失败：{exc}', endpoint=url, workflowId=workflow_id)) from exc
        if response.status_code >= 400:
            self.log_error('workflow-submit-http', raw, endpoint=url, workflowId=workflow_id, status=response.status_code)
            raise RunningHubAppError(status_code=response.status_code, detail=self.error_detail(f'RunningHub HTTP {response.status_code}', raw, endpoint=url, workflowId=workflow_id))
        if isinstance(raw, dict) and raw.get('code') in (0, '0'):
            task_id = raw.get('data', {}).get('taskId') if isinstance(raw.get('data'), dict) else ''
            if not task_id:
                raise RunningHubAppError(status_code=502, detail=self.error_detail('RunningHub 工作流未返回 taskId', raw, endpoint=url, workflowId=workflow_id))
            return {'success': True, 'data': {'taskId': task_id}}
        self.log_error('workflow-submit-rejected', raw, endpoint=url, workflowId=workflow_id)
        raise RunningHubAppError(status_code=400, detail=self.error_detail(self.fail_reason(raw) or 'RunningHub 工作流提交失败', raw, endpoint=url, workflowId=workflow_id))

    async def workflow_info(self, workflowId=''):
        workflow_id = str(workflowId or '').strip()
        if not workflow_id:
            raise RunningHubAppError(status_code=400, detail='workflowId 必填')
        provider = self.provider()
        api_key = self.api_key(provider)
        url = self.endpoint_url(provider, '/api/openapi/getJsonApiFormat')
        body = {'apiKey': api_key, 'workflowId': workflow_id}
        async with self.client_factory(timeout=httpx.Timeout(connect=20.0, read=180.0, write=60.0, pool=20.0)) as client:
            try:
                response = await client.post(url, headers=self.app_headers(True), json=body)
                raw = response.json()
            except Exception as exc:
                raise RunningHubAppError(status_code=502, detail=self.error_detail(f'拉取 RunningHub 工作流参数失败：{exc}', endpoint=url, workflowId=workflow_id)) from exc
        if response.status_code >= 400:
            raise RunningHubAppError(status_code=response.status_code, detail=self.error_detail(f'RunningHub HTTP {response.status_code}', raw, endpoint=url, workflowId=workflow_id))
        if not isinstance(raw, dict) or raw.get('code') not in (0, '0'):
            raise RunningHubAppError(status_code=400, detail=self.error_detail(self.fail_reason(raw) or 'RunningHub 工作流参数拉取失败', raw, endpoint=url, workflowId=workflow_id))
        data = raw.get('data') if isinstance(raw.get('data'), dict) else {}
        prompt = data.get('prompt')
        workflow_json = {}
        if isinstance(prompt, str) and prompt.strip():
            try:
                workflow_json = json.loads(prompt)
            except json.JSONDecodeError as exc:
                raise RunningHubAppError(status_code=502, detail=self.workflow_json_error(exc)) from exc
        elif isinstance(prompt, dict):
            workflow_json = prompt
        node_info_list = self.workflow_node_info(workflow_json)
        return {'success': True, 'data': {'workflowId': workflow_id, 'nodeInfoList': node_info_list}}

    async def fetch_workflow(self, payload):
        workflow_id = self.workflow_store_key(payload.workflowId)
        if not workflow_id:
            raise RunningHubAppError(status_code=400, detail='workflowId 必填')
        provider = self.provider()
        api_key = self.api_key(provider)
        url = self.endpoint_url(provider, '/api/openapi/getJsonApiFormat')
        body = {'apiKey': api_key, 'workflowId': workflow_id}
        async with self.client_factory(timeout=httpx.Timeout(connect=20.0, read=180.0, write=60.0, pool=20.0)) as client:
            try:
                response = await client.post(url, headers=self.app_headers(True), json=body)
                raw = response.json()
            except Exception as exc:
                raise RunningHubAppError(status_code=502, detail=self.error_detail(f'Failed to fetch RunningHub workflow parameters: {exc}', endpoint=url, workflowId=workflow_id)) from exc
        if response.status_code >= 400:
            raise RunningHubAppError(status_code=response.status_code, detail=self.error_detail(f'RunningHub HTTP {response.status_code}', raw, endpoint=url, workflowId=workflow_id))
        if not isinstance(raw, dict) or raw.get('code') not in (0, '0'):
            raise RunningHubAppError(status_code=400, detail=self.error_detail(self.fail_reason(raw) or 'RunningHub workflow fetch failed', raw, endpoint=url, workflowId=workflow_id))
        data = raw.get('data') if isinstance(raw.get('data'), dict) else {}
        prompt = data.get('prompt')
        workflow_json = {}
        if isinstance(prompt, str) and prompt.strip():
            try:
                workflow_json = json.loads(prompt)
            except json.JSONDecodeError as exc:
                raise RunningHubAppError(status_code=502, detail=self.workflow_json_error(exc)) from exc
        elif isinstance(prompt, dict):
            workflow_json = prompt
        fields = self.workflow_fields(workflow_json)
        return {'success': True, 'data': {'workflowId': workflow_id, 'title': payload.title or workflow_id, 'description': payload.description or '', 'fields': fields, 'workflowJson': workflow_json}}

    async def query(self, taskId='', useWallet=False):
        task_id = str(taskId or '').strip()
        if not task_id:
            raise RunningHubAppError(status_code=400, detail='taskId 必填')
        provider = self.provider()
        api_key = self.api_key(provider, use_wallet=useWallet)
        url = self.endpoint_url(provider, '/task/openapi/outputs')
        async with self.client_factory(timeout=httpx.Timeout(connect=20.0, read=240.0, write=30.0, pool=20.0)) as client:
            try:
                response = await client.post(url, headers=self.app_headers(True, useWallet), json={'apiKey': api_key, 'taskId': task_id})
                raw = response.json()
            except Exception as exc:
                raise RunningHubAppError(status_code=502, detail=self.error_detail(f'查询 RunningHub 任务失败：{exc}', endpoint=url, taskId=task_id)) from exc
            if response.status_code >= 400:
                self.log_error('query-http', raw, endpoint=url, taskId=task_id, status=response.status_code)
                raise RunningHubAppError(status_code=response.status_code, detail=self.error_detail(f'RunningHub HTTP {response.status_code}', raw, endpoint=url, taskId=task_id))
            code = raw.get('code') if isinstance(raw, dict) else None
            status = 'PENDING'
            urls = []
            image_items = []
            if code in (0, '0'):
                status = 'SUCCESS'
                for remote in self.extract_outputs(raw.get('data')):
                    try:
                        local_url = await self.store_output(client, remote)
                    except Exception:
                        local_url = remote
                    urls.append(local_url)
                    image_items.append(self.image_meta(local_url))
            elif code in (804, '804'):
                status = 'RUNNING'
            elif code in (813, '813'):
                status = 'QUEUED'
            elif code in (805, '805'):
                status = 'FAILED'
                self.log_error('query-failed', raw, endpoint=url, taskId=task_id, code=code)
            else:
                status = 'UNKNOWN'
                self.log_error('query-unknown', raw, endpoint=url, taskId=task_id, code=code)
            return {'success': True, 'data': {'status': status, 'urls': urls, 'image_items': image_items, 'failReason': self.fail_reason(raw), 'code': code}}

    async def upload_asset(self, payload):
        source_url = self.rewrite_url(str(payload.url or '').strip())
        if not source_url:
            raise RunningHubAppError(status_code=400, detail='url 必填')
        provider = self.provider()
        api_key = self.api_key(provider, use_wallet=payload.useWallet)
        filename = 'asset.bin'
        content_type = 'application/octet-stream'
        content = b''
        async with self.client_factory(timeout=httpx.Timeout(connect=20.0, read=240.0, write=240.0, pool=20.0), follow_redirects=True) as client:
            path = self.local_asset_path(source_url)
            if path:
                filename = os.path.basename(path)
                content_type = self.content_type(path)
                with open(path, 'rb') as f:
                    content = f.read()
            elif source_url.startswith(('http://', 'https://')):
                response = await client.get(source_url)
                if not response.is_success:
                    raise RunningHubAppError(status_code=400, detail=f'下载素材失败 HTTP {response.status_code}')
                content = response.content
                content_type = response.headers.get('content-type') or content_type
                filename = os.path.basename(urllib.parse.urlsplit(source_url).path) or filename
            else:
                raise RunningHubAppError(status_code=400, detail='不支持的素材地址，请选择本地素材或公网 http/https 地址。')
            if not content:
                raise RunningHubAppError(status_code=400, detail='素材为空，无法上传到 RunningHub')
            upload_url = self.endpoint_url(provider, '/task/openapi/upload')
            files = {'file': (filename, content, content_type)}
            data = {'apiKey': api_key, 'fileType': 'input'}
            try:
                response = await client.post(upload_url, headers=self.app_headers(False, payload.useWallet), data=data, files=files)
                raw = response.json()
            except Exception as exc:
                raise RunningHubAppError(status_code=502, detail=self.error_detail(f'上传素材到 RunningHub 失败：{exc}', endpoint=upload_url)) from exc
        if response.status_code >= 400:
            raise RunningHubAppError(status_code=response.status_code, detail=self.error_detail(f'RunningHub HTTP {response.status_code}', raw, endpoint=upload_url))
        if isinstance(raw, dict) and raw.get('code') in (0, '0') and isinstance(raw.get('data'), dict) and raw['data'].get('fileName'):
            return {'success': True, 'data': {'fileName': raw['data']['fileName'], 'fileType': raw['data'].get('fileType') or content_type}}
        raise RunningHubAppError(status_code=400, detail=self.error_detail(self.fail_reason(raw) or 'RunningHub 上传失败', raw, endpoint=upload_url))
