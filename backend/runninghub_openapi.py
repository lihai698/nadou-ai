"""RunningHub 标准 OpenAPI 图像、视频执行；宿主注入配置与文件操作。"""
import asyncio
import os
import time
from dataclasses import dataclass
from typing import Callable

import httpx

from .runninghub_protocol import (
    runninghub_schema_value,
    runninghub_schema_field,
    runninghub_aspect_from_size,
    runninghub_resolution_from_size,
    runninghub_size_for_aspect,
    runninghub_is_image_to_video,
    runninghub_apply_schema_defaults,
    runninghub_query_status,
    runninghub_extract_task_id,
)


class RunningHubOpenAPIError(Exception):
    def __init__(self, status_code, detail):
        super().__init__(str(detail))
        self.status_code = status_code
        self.detail = detail


@dataclass(frozen=True)
class RunningHubOpenAPIAdapter:
    """一个请求的宿主依赖；不持有密钥、模型目录或全局任务状态。"""
    model_definition: Callable
    task_endpoint: Callable
    openapi_url: Callable
    api_headers: Callable
    json_headers: Callable
    resolve_file: Callable
    content_type: Callable
    parse_size: Callable
    rewrite_url: Callable
    generic_extract: Callable
    fail_reason: Callable
    error_detail: Callable
    response_error: Callable
    video_urls: Callable
    extract_outputs: Callable
    save_video: Callable
    upload_headers: Callable
    reference_limit: int
    video_timeout: float
    extract_errors: tuple = ()
    client_factory: Callable = httpx.AsyncClient
    sleep: Callable = asyncio.sleep
    clock: Callable = time.monotonic

    @property
    def image_errors(self):
        return (RunningHubOpenAPIError,) + self.extract_errors

    def extract_image(self, raw):
        if not isinstance(raw, dict):
            raise RunningHubOpenAPIError(status_code=502, detail='RunningHub 返回格式不是 JSON 对象')
        containers = [raw]
        data = raw.get('data')
        if isinstance(data, dict):
            containers.append(data)
        for container in containers:
            results = container.get('results') or container.get('result') or container.get('outputs') or container.get('output')
            if isinstance(results, dict):
                results = [results]
            if isinstance(results, list):
                for item in results:
                    if isinstance(item, str) and item.startswith(('http://', 'https://')):
                        return {'type': 'url', 'value': self.rewrite_url(item)}
                    if not isinstance(item, dict):
                        continue
                    if item.get('type') == 'url' and item.get('value'):
                        return {'type': 'url', 'value': self.rewrite_url(item['value'])}
                    if item.get('type') == 'b64' and item.get('value'):
                        return {'type': 'b64', 'value': item['value'], 'mime_type': item.get('mime_type') or 'image/png'}
                    url = item.get('url') or item.get('fileUrl') or item.get('file_url') or item.get('download_url') or item.get('imageUrl') or item.get('image_url')
                    if isinstance(url, list) and url:
                        url = url[0]
                    if isinstance(url, str) and url:
                        return {'type': 'url', 'value': self.rewrite_url(url)}
        image = self.generic_extract(raw)
        if image.get('type') == 'url':
            image['value'] = self.rewrite_url(image.get('value'))
        return image

    async def upload_reference(self, client, provider, ref):
        path = self.resolve_file(ref.get('url', ''))
        if not path:
            value = ref.get('url', '')
            return value if str(value).startswith(('http://', 'https://')) else ''
        upload_url = self.openapi_url(provider, 'media/upload/binary')
        headers = self.upload_headers(provider)
        with open(path, 'rb') as fh:
            files = {'file': (os.path.basename(path), fh, self.content_type(path))}
            response = await client.post(upload_url, headers=headers, files=files, timeout=120)
        response.raise_for_status()
        raw = response.json()
        data = raw.get('data') if isinstance(raw, dict) else None
        candidates = [raw, data] if isinstance(data, dict) else [raw]
        for item in candidates:
            if not isinstance(item, dict):
                continue
            value = item.get('download_url') or item.get('downloadUrl') or item.get('url') or item.get('fileUrl') or item.get('file_url')
            if value:
                return str(value)
        raise RunningHubOpenAPIError(status_code=502, detail=self.error_detail('RunningHub 上传图片未返回 download_url', raw, endpoint=upload_url))

    async def wait_image_task(self, client, provider, task_id):
        query_url = self.openapi_url(provider, 'query')
        deadline = self.clock() + 1800
        last_payload = None
        while self.clock() < deadline:
            await self.sleep(2)
            response = await client.post(query_url, headers=self.api_headers(provider), json={'taskId': task_id})
            if response.status_code >= 400:
                raise RunningHubOpenAPIError(status_code=response.status_code, detail=self.error_detail(f'RunningHub 任务查询失败（HTTP {response.status_code}）', self.response_error(response), endpoint=query_url, taskId=task_id))
            raw = response.json()
            last_payload = raw
            status = runninghub_query_status(raw)
            if status in {'success', 'succeeded', 'completed', 'complete', 'finished', 'finish', 'done', '3'}:
                return raw
            if status in {'failed', 'fail', 'error', 'canceled', 'cancelled', '4'}:
                raise RunningHubOpenAPIError(status_code=502, detail=self.error_detail(f"RunningHub 任务失败：{self.fail_reason(raw) or '上游返回失败状态'}", raw, endpoint=query_url, taskId=task_id))
            try:
                return {'data': {'results': [self.extract_image(raw)]}}
            except self.image_errors:
                pass
        raise RunningHubOpenAPIError(status_code=504, detail=self.error_detail('RunningHub 生图任务超时', last_payload, endpoint=query_url, taskId=task_id))

    async def generate_image(self, prompt, size, model, reference_images=None, provider=None, on_remote_accept=None):
        model_def = await self.model_definition(provider, model)
        endpoint = self.task_endpoint(provider, model_def.get('endpoint') or model)
        params = model_def.get('params') if isinstance(model_def.get('params'), list) else []
        aspect = runninghub_aspect_from_size(size, '1:1', parse_size=self.parse_size)
        resolution = runninghub_resolution_from_size(size, '2k', parse_size=self.parse_size)
        body = {'prompt': prompt}
        if runninghub_schema_field(params, 'aspectRatio'):
            field = runninghub_schema_field(params, 'aspectRatio')
            body['aspectRatio'] = runninghub_schema_value(field, aspect)
        elif runninghub_schema_field(params, 'ratio'):
            field = runninghub_schema_field(params, 'ratio')
            body['ratio'] = runninghub_schema_value(field, aspect)
        if runninghub_schema_field(params, 'resolution'):
            field = runninghub_schema_field(params, 'resolution')
            body['resolution'] = runninghub_schema_value(field, resolution)
        (width, height) = self.parse_size(size)
        if width and height:
            if runninghub_schema_field(params, 'width'):
                body['width'] = width
            if runninghub_schema_field(params, 'height'):
                body['height'] = height
        quality_field = runninghub_schema_field(params, 'quality')
        if quality_field:
            body['quality'] = runninghub_schema_value(quality_field, 'medium')
        async with self.client_factory(timeout=httpx.Timeout(connect=20.0, read=1800.0, write=180.0, pool=20.0)) as client:
            image_urls = []
            for ref in (reference_images or [])[:self.reference_limit]:
                url = await self.upload_reference(client, provider, ref)
                if url:
                    image_urls.append(url)
            if image_urls:
                image_field = runninghub_schema_field(params, 'imageUrls', 'imageUrl', 'images', 'image')
                key = str((image_field or {}).get('fieldKey') or 'imageUrls')
                if key.endswith('s') or (image_field or {}).get('multipleInputs') is True:
                    body[key] = image_urls
                else:
                    body[key] = image_urls[0]
            runninghub_apply_schema_defaults(body, params)
            response = await client.post(endpoint, headers=self.json_headers(provider), json=body)
            response.raise_for_status()
            raw = response.json()
            try:
                return (self.extract_image(raw), raw)
            except self.image_errors:
                task_id = runninghub_extract_task_id(raw)
                if not task_id:
                    raise RunningHubOpenAPIError(status_code=502, detail=self.error_detail('RunningHub 未返回 taskId 或图片结果', raw, endpoint=endpoint))
            if on_remote_accept is not None:
                await on_remote_accept(task_id, query_mode='runninghub_image')
            result = await self.wait_image_task(client, provider, task_id)
            return (self.extract_image(result), result)

    async def wait_task(self, client, provider, task_id, output_kind=''):
        query_url = self.openapi_url(provider, 'query')
        deadline = self.clock() + 1800
        last_payload = None
        while self.clock() < deadline:
            await self.sleep(3)
            response = await client.post(query_url, headers=self.json_headers(provider), json={'taskId': task_id})
            response.raise_for_status()
            raw = response.json()
            last_payload = raw
            status = runninghub_query_status(raw).upper()
            if status in {'SUCCESS', 'SUCCEEDED', 'COMPLETED', 'COMPLETE', 'FINISHED', 'DONE', '3'}:
                return raw
            if status in {'FAILED', 'FAIL', 'ERROR', 'CANCEL', 'CANCELED', 'CANCELLED', '4'}:
                raise RunningHubOpenAPIError(status_code=502, detail=self.error_detail(f"RunningHub 任务失败：{self.fail_reason(raw) or '上游返回失败状态'}", raw, endpoint=query_url, taskId=task_id))
            if output_kind == 'video' and self.video_urls(raw):
                return raw
        raise RunningHubOpenAPIError(status_code=504, detail=self.error_detail('RunningHub 任务超时', last_payload or task_id, endpoint=query_url, taskId=task_id))

    async def generate_video(self, payload, provider, on_remote_accept=None):
        model_def = await self.model_definition(provider, payload.model)
        endpoint = self.task_endpoint(provider, model_def.get('endpoint') or payload.model)
        image_to_video = runninghub_is_image_to_video(payload.model) or runninghub_is_image_to_video(model_def.get('endpoint')) or runninghub_is_image_to_video(endpoint)
        params = model_def.get('params') if isinstance(model_def.get('params'), list) else []
        body = {'prompt': str(payload.prompt or '')}
        aspect = str(payload.aspect_ratio or '16:9').strip() or '16:9'
        if runninghub_schema_field(params, 'aspectRatio'):
            field = runninghub_schema_field(params, 'aspectRatio')
            body['aspectRatio'] = runninghub_schema_value(field, aspect)
        if runninghub_schema_field(params, 'ratio'):
            field = runninghub_schema_field(params, 'ratio')
            body['ratio'] = runninghub_schema_value(field, aspect)
        if runninghub_schema_field(params, 'size'):
            field = runninghub_schema_field(params, 'size')
            body['size'] = runninghub_schema_value(field, runninghub_size_for_aspect(aspect))
        if runninghub_schema_field(params, 'duration'):
            field = runninghub_schema_field(params, 'duration')
            body['duration'] = runninghub_schema_value(field, str(max(1, min(60, int(payload.duration or 5)))))
        if runninghub_schema_field(params, 'resolution'):
            field = runninghub_schema_field(params, 'resolution')
            body['resolution'] = runninghub_schema_value(field, str(payload.resolution or '720p').lower())
        if runninghub_schema_field(params, 'generateAudio'):
            body['generateAudio'] = bool(payload.generate_audio)
        if runninghub_schema_field(params, 'watermark'):
            body['watermark'] = bool(payload.watermark)
        async with self.client_factory(timeout=self.video_timeout) as client:
            image_refs = []
            for ref in (payload.images or [])[:10]:
                ref_url = getattr(ref, 'url', '') or ''
                if ref_url:
                    up = await self.upload_reference(client, provider, {'url': ref_url})
                    if up:
                        image_refs.append({'url': up, 'role': str(getattr(ref, 'role', '') or '').strip().lower()})
            image_urls = [item['url'] for item in image_refs if item.get('url')]
            if image_urls:
                first_url = next((item['url'] for item in image_refs if item.get('role') in {'first_frame', 'first'}), image_urls[0])
                last_url = next((item['url'] for item in image_refs if item.get('role') in {'last_frame', 'last'}), image_urls[1] if len(image_urls) > 1 else '')
                first_field = runninghub_schema_field(params, 'firstFrameUrl', 'first_frame_url', 'firstFrameImage', 'first_frame_image')
                last_field = runninghub_schema_field(params, 'lastFrameUrl', 'last_frame_url', 'lastFrameImage', 'last_frame_image')
                if first_field and first_url:
                    body[str(first_field.get('fieldKey'))] = first_url
                if last_field and last_url:
                    body[str(last_field.get('fieldKey'))] = last_url
                image_field = runninghub_schema_field(params, 'imageUrls', 'image_urls', 'imageUrl', 'image_url', 'referenceImages', 'referenceImageUrls')
                key = str((image_field or {}).get('fieldKey') or '')
                if key and key in body:
                    pass
                elif key and (key.endswith('s') or (image_field or {}).get('multipleInputs') is True):
                    body[key] = image_urls
                elif key:
                    body[key] = image_urls[0]
                elif image_to_video and 'firstFrameUrl' not in body:
                    body['firstFrameUrl'] = first_url
            first_required = runninghub_schema_field(params, 'firstFrameUrl', 'first_frame_url', 'firstFrameImage', 'first_frame_image')
            if first_required and (not body.get(str(first_required.get('fieldKey') or ''))):
                raise RunningHubOpenAPIError(status_code=400, detail='当前 RunningHub 模型是图生视频，需要连接一张首帧图片后再生成。')
            if image_to_video and (not body.get('firstFrameUrl')) and (not image_urls):
                raise RunningHubOpenAPIError(status_code=400, detail='当前 RunningHub 模型是图生视频，需要连接一张首帧图片后再生成。')
            runninghub_apply_schema_defaults(body, params)
            response = await client.post(endpoint, headers=self.json_headers(provider), json=body)
            response.raise_for_status()
            raw = response.json()
            task_id = runninghub_extract_task_id(raw)
            if not task_id:
                fail_reason = self.fail_reason(raw)
                if fail_reason:
                    raise RunningHubOpenAPIError(status_code=502, detail=f'RunningHub 视频接口错误：{fail_reason}')
            if task_id and on_remote_accept:
                await on_remote_accept(task_id)
            result = raw
            if task_id and (not self.video_urls(raw)):
                result = await self.wait_task(client, provider, task_id, 'video')
            urls = self.video_urls(result)
            if not urls:
                outputs = self.extract_outputs(result)
                urls = [url for url in outputs if str(url).startswith(('http://', 'https://', '/output/', '/assets/'))]
            if not urls:
                raise RunningHubOpenAPIError(status_code=502, detail='RunningHub 视频生成成功但没有返回视频地址')
            local_urls = [await self.save_video(url, prefix='rh_video_') for url in urls]
            return {'videos': local_urls, 'task_id': task_id, 'raw': result}
