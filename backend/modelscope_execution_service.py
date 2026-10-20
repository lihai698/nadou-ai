"""ModelScope 原生图片生成、角度生成及已有任务续查。

不保存配置或任务状态；输出路径、历史、受理回调与通知均由应用注入。
"""

async def poll_angle_cloud(req, *, HTTPException, _safe_upstream_text, asyncio, httpx, log_net_error, manager, modelscope_api_key, modelscope_image_api_root, output_path_for, output_url_for, redact_log_text, save_to_history, time, upstream_error_summary, write_diagnostic):
    api_root = modelscope_image_api_root()
    clean_token = modelscope_api_key(req.api_key)
    if not clean_token:
        raise HTTPException(status_code=400, detail="未提供 ModelScope API Key")

    headers = {
        "Authorization": f"Bearer {clean_token}",
        "Content-Type": "application/json",
        "X-ModelScope-Async-Mode": "true"
    }
    task_id = req.task_id
    write_diagnostic(
        f"ModelScope 角度任务恢复轮询：task_id={redact_log_text(_safe_upstream_text(task_id, 120))}"
    )

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            for i in range(300):
                await asyncio.sleep(2)
                result = await client.get(
                    f"{api_root}/tasks/{task_id}",
                    headers={**headers, "X-ModelScope-Task-Type": "image_generation"},
                )
                result.raise_for_status()
                data = result.json()
                status = str(data.get("task_status") or "").upper()

                if status == "SUCCEED":
                    img_url = data["output_images"][0]
                    local_path = ""
                    try:
                        async with httpx.AsyncClient() as dl_client:
                            img_res = await dl_client.get(img_url)
                            if img_res.status_code == 200:
                                filename = f"cloud_angle_{int(time.time())}.png"
                                file_path = output_path_for(filename, "output")
                                with open(file_path, "wb") as f:
                                    f.write(img_res.content)
                                local_path = output_url_for(filename, "output")
                            else:
                                local_path = img_url
                    except Exception:
                        local_path = img_url

                    record = {"timestamp": time.time(), "prompt": f"Resumed {task_id}", "images": [local_path], "type": "angle"}
                    save_to_history(record)
                    if req.client_id:
                        await manager.send_personal_message({"type": "cloud_status", "status": "SUCCEED", "task_id": task_id}, req.client_id)
                    return {"url": local_path}

                elif status in {"FAILED", "FAIL", "ERROR", "CANCELED", "CANCELLED", "TIMEOUT", "REVOKED"}:
                    if req.client_id:
                        await manager.send_personal_message({"type": "cloud_status", "status": "FAILED", "task_id": task_id}, req.client_id)
                    raise HTTPException(status_code=502, detail=f"ModelScope 任务失败：{upstream_error_summary(data, fallback='请检查任务参数后重试')}")

                if i % 5 == 0 and req.client_id:
                    await manager.send_personal_message({
                        "type": "cloud_status", "status": f"{status} ({i}/300)",
                        "task_id": task_id, "progress": i, "total": 300
                    }, req.client_id)

            if req.client_id:
                await manager.send_personal_message({"type": "cloud_status", "status": "TIMEOUT", "task_id": task_id}, req.client_id)
            return {"status": "timeout", "task_id": task_id, "message": "Task still pending"}

    except HTTPException:
        raise
    except Exception as e:
        log_net_error("ModelScope 角度任务查询失败", e)
        raise HTTPException(status_code=502, detail="ModelScope 角度任务查询失败，请稍后重试。") from e


async def generate_angle_cloud(req, *, CANVAS_IMAGE_REMOTE_ACCEPT_CALLBACK, HTTPException, _safe_upstream_text, asyncio, httpx, log_net_error, manager, modelscope_api_key, modelscope_image_api_root, modelscope_image_url, modelscope_size, output_path_for, output_url_for, redact_log_text, save_to_history, schedule_coroutine, selected_model, time, upstream_error_summary, upstream_response_error_summary, write_diagnostic):
    api_root = modelscope_image_api_root()
    clean_token = modelscope_api_key(req.api_key)
    if not clean_token:
        raise HTTPException(status_code=400, detail="未提供 ModelScope API Key")

    headers = {
        "Authorization": f"Bearer {clean_token}",
        "Content-Type": "application/json",
        "X-ModelScope-Async-Mode": "true"
    }
    model = selected_model(req.model, "Qwen/Qwen-Image-Edit-2511")
    payload = {
        "model": model,
        "prompt": req.prompt.strip(),
        "image_url": [modelscope_image_url(url, max_size=1536) for url in req.image_urls]
    }
    if req.resolution:
        payload["size"] = modelscope_size(req.resolution)
    if req.loras is not None:
        payload["loras"] = req.loras

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            submit_res = await client.post(f"{api_root}/images/generations", headers=headers, json=payload)
            if submit_res.status_code != 200:
                raise HTTPException(status_code=submit_res.status_code, detail=f"ModelScope 提交失败：{upstream_response_error_summary(submit_res)}")

            task_id = submit_res.json().get("task_id")
            callback=CANVAS_IMAGE_REMOTE_ACCEPT_CALLBACK.get()
            if callback and task_id:await callback(task_id,query_mode='modelscope')
            write_diagnostic(
                f"ModelScope 角度任务已提交：task_id={redact_log_text(_safe_upstream_text(task_id, 120))}"
            )

            for i in range(300):
                await asyncio.sleep(2)
                result = await client.get(
                    f"{api_root}/tasks/{task_id}",
                    headers={**headers, "X-ModelScope-Task-Type": "image_generation"},
                )
                if result.status_code >= 400:
                    raise HTTPException(status_code=result.status_code, detail=f"ModelScope 查询失败：{upstream_response_error_summary(result)}")
                data = result.json()
                status = str(data.get("task_status") or "").upper()

                if status == "SUCCEED":
                    img_url = data["output_images"][0]
                    local_path = ""
                    try:
                        async with httpx.AsyncClient() as dl_client:
                            img_res = await dl_client.get(img_url)
                            if img_res.status_code == 200:
                                filename = f"cloud_angle_{int(time.time())}.png"
                                file_path = output_path_for(filename, "output")
                                with open(file_path, "wb") as f:
                                    f.write(img_res.content)
                                local_path = output_url_for(filename, "output")
                            else:
                                local_path = img_url
                    except Exception:
                        local_path = img_url

                    record = {"timestamp": time.time(), "prompt": req.prompt, "images": [local_path], "type": "angle"}
                    save_to_history(record)
                    if req.client_id:
                        await manager.send_personal_message({"type": "cloud_status", "status": "SUCCEED", "task_id": task_id}, req.client_id)
                    schedule_coroutine(manager.broadcast_new_image(record))
                    return {"url": local_path, "task_id": task_id}

                elif status in {"FAILED", "FAIL", "ERROR", "CANCELED", "CANCELLED", "TIMEOUT", "REVOKED"}:
                    if req.client_id:
                        await manager.send_personal_message({"type": "cloud_status", "status": "FAILED", "task_id": task_id}, req.client_id)
                    raise HTTPException(status_code=502, detail=f"ModelScope 任务失败：{upstream_error_summary(data, fallback='请检查任务参数后重试')}")

                if i % 5 == 0 and req.client_id:
                    await manager.send_personal_message({
                        "type": "cloud_status", "status": f"{status} ({i}/300)",
                        "task_id": task_id, "progress": i, "total": 300
                    }, req.client_id)

            if req.client_id:
                await manager.send_personal_message({"type": "cloud_status", "status": "TIMEOUT", "task_id": task_id}, req.client_id)
            return {"status": "timeout", "task_id": task_id, "message": "Task still pending"}

    except HTTPException:
        raise
    except Exception as e:
        log_net_error("ModelScope 角度任务生成失败", e)
        raise HTTPException(status_code=502, detail="ModelScope 角度任务生成失败，请稍后重试。") from e


async def generate_cloud(req, *, CANVAS_IMAGE_REMOTE_ACCEPT_CALLBACK, HTTPException, _safe_upstream_text, asyncio, httpx, log_net_error, manager, modelscope_api_key, modelscope_image_api_root, modelscope_size, output_path_for, output_url_for, redact_log_text, save_to_history, time, upstream_error_summary, upstream_response_error_summary, write_diagnostic):
    api_root = modelscope_image_api_root()
    clean_token = modelscope_api_key(req.api_key)
    if not clean_token:
        raise HTTPException(status_code=400, detail="未提供 ModelScope API Key")

    headers = {
        "Authorization": f"Bearer {clean_token}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": "Tongyi-MAI/Z-Image-Turbo",
        "prompt": req.prompt.strip(),
        "size": modelscope_size(req.resolution),
        "n": 1
    }
    if req.loras is not None:
        payload["loras"] = req.loras

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            submit_res = await client.post(
                f"{api_root}/images/generations",
                headers={**headers, "X-ModelScope-Async-Mode": "true"},
                json=payload
            )
            if submit_res.status_code != 200:
                raise HTTPException(status_code=submit_res.status_code, detail=f"ModelScope 提交失败：{upstream_response_error_summary(submit_res)}")

            task_id = submit_res.json().get("task_id")
            callback=CANVAS_IMAGE_REMOTE_ACCEPT_CALLBACK.get()
            if callback and task_id:await callback(task_id,query_mode='modelscope')
            write_diagnostic(
                f"ModelScope Z-Image 任务已提交：task_id={redact_log_text(_safe_upstream_text(task_id, 120))}"
            )

            for i in range(200):
                await asyncio.sleep(3)
                result = await client.get(
                    f"{api_root}/tasks/{task_id}",
                    headers={**headers, "X-ModelScope-Task-Type": "image_generation"},
                )
                if result.status_code >= 400:
                    raise HTTPException(status_code=result.status_code, detail=f"ModelScope 查询失败：{upstream_response_error_summary(result)}")
                data = result.json()
                status = str(data.get("task_status") or "").upper()

                if i % 5 == 0:
                    write_diagnostic(
                        "ModelScope Z-Image 任务轮询："
                        f"task_id={redact_log_text(_safe_upstream_text(task_id, 120))} "
                        f"poll={i} status={redact_log_text(_safe_upstream_text(status, 80))}"
                    )

                if status == "SUCCEED":
                    img_url = data["output_images"][0]
                    local_path = ""
                    try:
                        async with httpx.AsyncClient() as dl_client:
                            img_res = await dl_client.get(img_url)
                            if img_res.status_code == 200:
                                filename = f"cloud_{int(time.time())}.png"
                                file_path = output_path_for(filename, "output")
                                with open(file_path, "wb") as f:
                                    f.write(img_res.content)
                                local_path = output_url_for(filename, "output")
                            else:
                                local_path = img_url
                    except Exception as dl_e:
                        write_diagnostic(
                            f"ModelScope 图片下载失败：{redact_log_text(dl_e)[:300]}"
                        )
                        local_path = img_url

                    record = {"timestamp": time.time(), "prompt": req.prompt, "images": [local_path], "type": "cloud"}
                    save_to_history(record)
                    try:
                        await manager.broadcast_new_image(record)
                    except Exception:
                        pass
                    return {"url": local_path}

                elif status in {"FAILED", "FAIL", "ERROR", "CANCELED", "CANCELLED", "TIMEOUT", "REVOKED"}:
                    raise HTTPException(status_code=502, detail=f"ModelScope 任务失败：{upstream_error_summary(data, fallback='请检查任务参数后重试')}")

            raise Exception("Cloud generation timeout")

    except HTTPException:
        raise
    except Exception as e:
        log_net_error("ModelScope 云端生图失败", e)
        raise HTTPException(status_code=502, detail="ModelScope 云端生图失败，请稍后重试。") from e


async def ms_generate(req, *, CANVAS_IMAGE_REMOTE_ACCEPT_CALLBACK, HTTPException, _safe_upstream_text, asyncio, httpx, log_net_error, manager, modelscope_api_key, modelscope_image_api_root, modelscope_image_url, modelscope_size, output_path_for, output_url_for, redact_log_text, save_to_history, schedule_coroutine, time, upstream_error_summary, upstream_response_error_summary, write_diagnostic):
    api_root = modelscope_image_api_root()
    clean_token = modelscope_api_key(req.api_key)
    if not clean_token:
        raise HTTPException(status_code=400, detail="未配置 ModelScope API Key，请在 API 设置中填写，或重新保存 ModelScope Token。")

    headers = {
        "Authorization": f"Bearer {clean_token}",
        "Content-Type": "application/json",
        "X-ModelScope-Async-Mode": "true"
    }
    payload = {
        "model": req.model,
        "prompt": req.prompt.strip(),
    }
    if req.width and req.height:
        payload["width"] = req.width
        payload["height"] = req.height
        payload["size"] = modelscope_size(req.size or f"{req.width}x{req.height}")
    elif req.size:
        payload["size"] = modelscope_size(req.size)
    if req.image_urls:
        payload["image_url"] = [modelscope_image_url(url, max_size=1536) for url in req.image_urls]
    if req.loras is not None:
        payload["loras"] = req.loras

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            submit_res = await client.post(
                f"{api_root}/images/generations",
                headers=headers,
                json=payload
            )
            if submit_res.status_code != 200:
                raise HTTPException(status_code=submit_res.status_code, detail=f"ModelScope 提交失败：{upstream_response_error_summary(submit_res)}")

            task_id = submit_res.json().get("task_id")
            callback=CANVAS_IMAGE_REMOTE_ACCEPT_CALLBACK.get()
            if callback and task_id:await callback(task_id,query_mode='modelscope')
            write_diagnostic(
                "ModelScope 通用生图任务已提交："
                f"model={redact_log_text(_safe_upstream_text(req.model, 120))} "
                f"task_id={redact_log_text(_safe_upstream_text(task_id, 120))}"
            )

            TERMINAL_FAILED_STATUSES = {"FAILED", "FAIL", "ERROR", "CANCELED", "CANCELLED", "TIMEOUT", "REVOKED"}

            for i in range(300):
                await asyncio.sleep(2)
                try:
                    result = await client.get(
                        f"{api_root}/tasks/{task_id}",
                        headers={**headers, "X-ModelScope-Task-Type": "image_generation"},
                    )
                    if result.status_code >= 400:
                        raise HTTPException(status_code=result.status_code, detail=f"ModelScope 查询失败：{upstream_response_error_summary(result)}")
                    data = result.json()
                    status = data.get("task_status")
                    write_diagnostic(
                        "ModelScope 通用生图任务轮询："
                        f"task_id={redact_log_text(_safe_upstream_text(task_id, 120))} "
                        f"poll={i} status={redact_log_text(_safe_upstream_text(status, 80))}"
                    )

                    if status == "SUCCEED":
                        img_url = data["output_images"][0]
                        local_path = ""
                        try:
                            async with httpx.AsyncClient() as dl_client:
                                img_res = await dl_client.get(img_url)
                                if img_res.status_code == 200:
                                    filename = f"ms_{req.model.replace('/', '_').replace(':', '_')}_{int(time.time())}.png"
                                    file_path = output_path_for(filename, "output")
                                    with open(file_path, "wb") as f:
                                        f.write(img_res.content)
                                    local_path = output_url_for(filename, "output")
                                else:
                                    local_path = img_url
                        except Exception:
                            local_path = img_url

                        record = {
                            "timestamp": time.time(),
                            "prompt": req.prompt,
                            "images": [local_path],
                            "type": "klein",
                            "model": req.model,
                        }
                        save_to_history(record)
                        schedule_coroutine(manager.broadcast_new_image(record))
                        return {"url": local_path, "task_id": task_id}

                    elif status in TERMINAL_FAILED_STATUSES:
                        raise HTTPException(status_code=502, detail=f"ModelScope 任务失败：{upstream_error_summary(data, fallback='请检查任务参数后重试')}")

                except HTTPException:
                    raise
                except Exception as loop_e:
                    log_net_error("ModelScope 任务轮询失败", loop_e)
                    continue

            raise HTTPException(status_code=504, detail="MS 生图超时")

    except HTTPException:
        raise
    except Exception as e:
        log_net_error("ModelScope 生图失败", e)
        raise HTTPException(status_code=502, detail="ModelScope 生图失败，请稍后重试。") from e


