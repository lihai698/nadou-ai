"""图片生成结果编排、原生任务续查及历史通知。

供应商执行、受理回调、媒体落盘、历史与通知由应用注入，查询不重新提交任务。
"""
import os
import re

async def query_native_catalog_image_task(kind, provider_id, task_id, *, AI_REQUEST_TIMEOUT, HTTPException, get_midjourney_task, httpx, image_output_meta, modelscope_api_key, modelscope_image_api_root, save_ai_image_to_output, urllib):
    if kind=='midjourney':return {**await get_midjourney_task(task_id,provider_id),'native_remote_task_id':task_id}
    if kind!='msgen' or provider_id!='modelscope':raise HTTPException(409,'原生图片查询归属无效')
    token=modelscope_api_key()
    if not token:raise HTTPException(400,'未配置ModelScope API Key')
    async with httpx.AsyncClient(timeout=AI_REQUEST_TIMEOUT) as client:
        response=await client.get(f'{modelscope_image_api_root()}/tasks/{urllib.parse.quote(task_id,safe="")}',headers={'Authorization':f'Bearer {token}','X-ModelScope-Task-Type':'image_generation'})
        response.raise_for_status();data=response.json()
    status=str(data.get('task_status') or '').upper()
    if status in {'FAILED','FAIL','ERROR','CANCELED','CANCELLED','TIMEOUT','REVOKED'}:return {'status':'failed','error':'魔搭原任务未成功'}
    if status!='SUCCEED':return {'status':'running','task_id':task_id}
    images=[]
    for url in data.get('output_images') or []:
        local=await save_ai_image_to_output(url,prefix='ms_native_')
        if local:images.append(local)
    if not images:raise HTTPException(502,'魔搭原任务成功但没有可保存图片')
    return {'status':'succeeded','task_id':task_id,'images':images,'image_items':[image_output_meta(url) for url in images]}


async def build_native_catalog_image_result(payload, on_remote_accept=None, *, AI_REQUEST_TIMEOUT, CloudGenRequest, HTTPException, IMAGE_POLL_INTERVAL, MidjourneySubmitRequest, MsGenerateRequest, asyncio, generate_angle_cloud, generate_cloud, image_output_meta, ms_generate, parse_size_pair, query_native_catalog_image_task, submit_midjourney, time):
    config=payload.native_config;refs=[ref.url for ref in payload.reference_images]
    if payload.native_node_type=='msgen':
        width,height=parse_size_pair(config['size']);loras=config.get('loras')
        if config['modelKey']=='zimage':result=await generate_cloud(CloudGenRequest(prompt=payload.prompt,resolution=config['size'],loras=loras))
        elif config['modelKey']=='qwen_edit':result=await generate_angle_cloud(CloudGenRequest(prompt=payload.prompt,model=config['model'],resolution=config['size'],image_urls=refs,loras=loras))
        else:result=await ms_generate(MsGenerateRequest(prompt=payload.prompt,model=config['model'],width=width,height=height,size=config['size'],image_urls=refs,loras=loras))
        url=result.get('url')
        if not isinstance(url,str) or not url.startswith(('/output/','/assets/','/api/storage-files/')):raise HTTPException(502,'原魔搭返回的素材尚未保存本地，不能登记成功')
        return {'images':[url],'image_items':[image_output_meta(url)],'request':{'provider_id':config['provider'],'model':config['model'],'size':config['size']}}
    if payload.native_node_type!='midjourney':raise HTTPException(422,'未知原生图片节点')
    submitted=await submit_midjourney(MidjourneySubmitRequest(provider_id=config['provider'],prompt=payload.prompt,mode=config['mode'],size=config['size'],version=config['version'],speed=config['speed'],reference_images=payload.reference_images[:4]))
    task_id=submitted.get('task_id')
    if not task_id:raise HTTPException(502,'Midjourney未返回原任务编号，受理状态未知')
    if on_remote_accept:await on_remote_accept(task_id,query_mode='midjourney')
    deadline=time.monotonic()+AI_REQUEST_TIMEOUT
    while time.monotonic()<deadline:
        result=await query_native_catalog_image_task('midjourney',config['provider'],task_id)
        if result.get('status')=='succeeded':return {**result,'native_remote_task_id':task_id}
        if result.get('status')=='failed':raise HTTPException(502,result.get('error') or 'Midjourney原任务未成功')
        await asyncio.sleep(IMAGE_POLL_INTERVAL)
    raise HTTPException(504,'Midjourney查询超时，请继续查询原任务')


async def build_online_image_result(payload, on_remote_accept=None, *, CANVAS_IMAGE_REMOTE_ACCEPT_CALLBACK, HTTPException, IMAGE_MODEL, asyncio, build_native_catalog_image_result, extract_images, extract_task_id, friendly_image_error_detail, generate_ai_image, generate_jimeng_upscale_image, get_api_provider, httpx, image_output_meta, image_references, is_jimeng_provider, log_net_error, manager, model_dump_compat, public_usage, save_ai_image_to_output, save_to_history, schedule_coroutine, selected_model, snap_size_to_multiple, time, upstream_error_summary, upstream_response_error_summary):
    if payload.native_node_type:
        return await build_native_catalog_image_result(payload, on_remote_accept=on_remote_accept or CANVAS_IMAGE_REMOTE_ACCEPT_CALLBACK.get())
    provider = get_api_provider(payload.provider_id)
    default_model = (provider.get("image_models") or [IMAGE_MODEL])[0]
    model = selected_model(payload.model, default_model)
    request_size = snap_size_to_multiple(payload.size, 16)
    refs = [model_dump_compat(ref) for ref in payload.reference_images if ref.url]
    image_refs = image_references(refs)
    count = max(1, min(8, int(payload.n or 1)))
    operation = str(payload.operation or "").strip().lower()
    if operation == "upscale":
        if not is_jimeng_provider(provider):
            raise HTTPException(status_code=400, detail="图片放大目前仅支持即梦（Dreamina）平台")
        if not image_refs:
            raise HTTPException(status_code=400, detail="请先选择要放大的图片")
        count = 1
    async def generate_one():
        if operation == "upscale":
            image_data, raw_item = await generate_jimeng_upscale_image(image_refs, payload.resolution_type)
        else:
            image_data, raw_item = await generate_ai_image(
                payload.prompt, request_size, payload.quality, model, image_refs, provider["id"],
                payload.aspect_ratio, payload.resolution,
                on_remote_accept=on_remote_accept or CANVAS_IMAGE_REMOTE_ACCEPT_CALLBACK.get(),
            )
        try:
            image_items = extract_images(raw_item) if isinstance(raw_item, dict) else [image_data]
        except HTTPException:
            image_items = [image_data]
        local_urls = []
        local_items = []
        for item in image_items:
            local_url = await save_ai_image_to_output(item, prefix="online_")
            if local_url:
                local_urls.append(local_url)
                local_items.append(image_output_meta(local_url, item))
        return local_urls, local_items, raw_item
    try:
        generated = await asyncio.gather(*(generate_one() for _ in range(count)))
    except httpx.HTTPStatusError as exc:
        log_net_error(f"生图 HTTP状态错误 provider={provider.get('id')} model={model} size={request_size}", exc)
        text = exc.response.text or ''
        friendly = friendly_image_error_detail(text, request_size, model)
        detail = friendly or f"上游生图接口错误：{upstream_response_error_summary(exc.response)}"
        raise HTTPException(status_code=exc.response.status_code, detail=detail) from exc
    except httpx.HTTPError as exc:
        log_net_error(f"生图 网络/TLS错误 provider={provider.get('id')} model={model}", exc)
        raise HTTPException(status_code=502, detail="请求上游生图接口失败，请检查网络后重试。") from exc

    local_urls = [url for urls, _items, _raw in generated for url in (urls or []) if url]
    local_items = [item for _urls, items, _raw in generated for item in (items or []) if item.get("url")]
    raw = generated[0][2] if generated else {}
    if not local_urls:
        provider_name = provider.get("name") or provider["id"]
        summary = upstream_error_summary(raw, fallback="上游没有返回图片数据")
        raise HTTPException(status_code=502, detail=f"{provider_name} 没有返回图片：{summary}")
    result = {
        "prompt": payload.prompt,
        "images": local_urls,
        "image_items": local_items,
        "timestamp": time.time(),
        "type": "online",
        "model": model,
        "provider_id": provider["id"],
        "provider_name": provider.get("name") or provider["id"],
        "task_id": extract_task_id(raw) if isinstance(raw, dict) else None,
        "request_id": raw.get("id") if isinstance(raw, dict) else None,
        "params": {"provider_id": provider["id"], "model": model, "size": request_size, "requested_size": payload.size, "quality": payload.quality, "n": count, "reference_images": refs},
        "raw_usage": public_usage(raw.get("usage")) if isinstance(raw, dict) else None,
    }
    save_to_history(result)
    schedule_coroutine(manager.broadcast_new_image(result))
    return result


async def query_image_task(payload, *, HTTPException, IMAGE_TASK_FAILED_STATUSES, extract_images, fetch_image_task_payload, get_api_provider, httpx, image_output_meta, image_task_fail_reason, image_task_status, is_runninghub_provider, log_net_error, manager, rewrite_runninghub_file_url, runninghub_api_key, runninghub_app_headers, runninghub_endpoint_url, runninghub_extract_outputs, runninghub_fail_reason, runninghub_store_remote_output, safe_upstream_http_detail, safe_upstream_transport_detail, save_ai_image_to_output, save_to_history, schedule_coroutine, time, upstream_response_error_summary):
    provider = get_api_provider(payload.provider_id)
    task_id = str(payload.task_id or "").strip()
    if is_runninghub_provider(provider):
        api_key = runninghub_api_key(provider)
        url = runninghub_endpoint_url(provider, "/task/openapi/outputs")
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(connect=20.0, read=240.0, write=30.0, pool=20.0)) as client:
                response = await client.post(url, headers=runninghub_app_headers(True), json={"apiKey": api_key, "taskId": task_id})
                response.raise_for_status()
                raw = response.json()
                code = raw.get("code") if isinstance(raw, dict) else None
                if code in (0, "0"):
                    local_urls = []
                    local_items = []
                    for remote in runninghub_extract_outputs(raw.get("data")):
                        try:
                            local_url = await runninghub_store_remote_output(client, remote)
                        except Exception:
                            local_url = rewrite_runninghub_file_url(remote)
                        if local_url:
                            local_urls.append(local_url)
                            local_items.append(image_output_meta(local_url))
                    if not local_urls:
                        # 上游成功码只代表请求处理完成；没有可保存媒体时不能伪装成成功，
                        # 也不能写入一张空历史卡片或广播成功通知。
                        return {
                            "status": "failed",
                            "task_id": task_id,
                            "provider_id": provider["id"],
                            "provider_name": provider.get("name") or provider["id"],
                            "error": "RunningHub 任务完成但没有返回可用图片。",
                        }
                    result = {
                        "status": "succeeded",
                        "prompt": "",
                        "images": local_urls,
                        "image_items": local_items,
                        "timestamp": time.time(),
                        "type": "online",
                        "model": "",
                        "provider_id": provider["id"],
                        "provider_name": provider.get("name") or provider["id"],
                        "task_id": task_id,
                        "request_id": "",
                        "params": {"provider_id": provider["id"]},
                    }
                    save_to_history(result)
                    schedule_coroutine(manager.broadcast_new_image(result))
                    return result
                if code in (805, "805"):
                    return {
                        "status": "failed",
                        "task_id": task_id,
                        "provider_id": provider["id"],
                        "provider_name": provider.get("name") or provider["id"],
                        "error": runninghub_fail_reason(raw),
                    }
                return {
                    "status": "running",
                    "task_id": task_id,
                    "provider_id": provider["id"],
                    "provider_name": provider.get("name") or provider["id"],
                    "message": "RunningHub 任务仍在生成中",
                }
        except httpx.HTTPStatusError as exc:

            raise HTTPException(status_code=exc.response.status_code, detail=safe_upstream_http_detail(exc.response, "查询 RunningHub 任务失败")) from exc
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail=safe_upstream_transport_detail(exc, "查询 RunningHub 任务失败")) from exc
    timeout = httpx.Timeout(connect=20.0, read=300.0, write=60.0, pool=20.0)
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            raw = await fetch_image_task_payload(client, task_id, provider)
    except httpx.HTTPStatusError as exc:
        log_net_error(f"查询生图任务 HTTP状态错误 provider={provider.get('id')} task_id={task_id}", exc)
        raise HTTPException(status_code=exc.response.status_code, detail=f"查询上游生图任务失败：{upstream_response_error_summary(exc.response)}") from exc
    except httpx.HTTPError as exc:
        log_net_error(f"查询生图任务 网络/TLS错误 provider={provider.get('id')} task_id={task_id}", exc)
        raise HTTPException(status_code=502, detail="查询上游生图任务失败，请检查网络连接") from exc

    status = image_task_status(raw)
    image_items = []
    try:
        image_items = extract_images(raw)
    except HTTPException:
        image_items = []
    if image_items:
        local_urls = []
        local_items = []
        for item in image_items:
            local_url = await save_ai_image_to_output(item, prefix="online_")
            if local_url:
                local_urls.append(local_url)
                local_items.append(image_output_meta(local_url, item))
        if not local_urls:
            # 远端已有结果但本地没有保存下来时，不能写入空成功历史或继续返回运行中。
            return {
                "status": "failed",
                "task_id": task_id,
                "provider_id": provider["id"],
                "provider_name": provider.get("name") or provider["id"],
                "error": "任务已完成但没有保存可用图片。",
            }
        result = {
            "status": "succeeded",
            "prompt": "",
            "images": local_urls,
            "image_items": local_items,
            "timestamp": time.time(),
            "type": "online",
            "model": "",
            "provider_id": provider["id"],
            "provider_name": provider.get("name") or provider["id"],
            "task_id": task_id,
            "request_id": raw.get("id") if isinstance(raw, dict) else "",
            "params": {"provider_id": provider["id"]},
        }
        save_to_history(result)
        schedule_coroutine(manager.broadcast_new_image(result))
        return result
    if status in IMAGE_TASK_FAILED_STATUSES:
        return {
            "status": "failed",
            "task_id": task_id,
            "provider_id": provider["id"],
            "provider_name": provider.get("name") or provider["id"],
            "error": image_task_fail_reason(raw),
            "raw": {"status": status, "error_summary": image_task_fail_reason(raw)},
        }
    return {
        "status": "running",
        "task_id": task_id,
        "provider_id": provider["id"],
        "provider_name": provider.get("name") or provider["id"],
        "message": "任务仍在生成中",
    }


