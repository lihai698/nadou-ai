"""Comfy工作流执行：输入同步、参数覆盖、提交与结果收集。

任务编号由应用锁内分配，动态后端配置通过读取函数提供。
"""
import os
import json
import time
import random
import urllib.request
import urllib.parse
import urllib.error

def generate(req, task_id, current_task, *, CLIENT_ID, COMFYUI_HISTORY_TIMEOUT, LOAD_LOCK, QUEUE, QUEUE_LOCK, WORKFLOW_DIR, WORKFLOW_PATH, collect_comfy_file_items, collect_required_comfy_media, comfy_class_is_debug_text, comfy_class_is_preview, comfy_output_kind, comfy_prompt_error_message, comfy_text_values_from_output, convert_output_to_jpg, download_comfy_output, get_backend_load, get_comfy_history, get_instances, manager, public_comfy_error_detail, requests, reserve_best_backend, save_comfy_text_output, save_to_history, schedule_coroutine, write_diagnostic):
    target_backend = None
    try:
        required_images = collect_required_comfy_media(req.params)

        target_backend = reserve_best_backend(required_images)

        for image_name in required_images:
            need_sync = False
            try:
                check_url = f"http://{target_backend}/view?filename={urllib.parse.quote(image_name)}&type=input"
                resp = requests.get(check_url, stream=True, timeout=0.5)
                resp.close()
                if resp.status_code != 200:
                    need_sync = True
            except:
                need_sync = True

            if need_sync:
                image_content = None
                image_type = "image/png"
                for addr in get_instances():
                    if addr == target_backend: continue
                    try:
                        src_url = f"http://{addr}/view?filename={urllib.parse.quote(image_name)}&type=input"
                        r = requests.get(src_url, timeout=5)
                        if r.status_code == 200:
                            image_content = r.content
                            image_type = r.headers.get("Content-Type", "image/png")
                            break
                    except: continue

                if image_content:
                    try:
                        files = {'image': (image_name, image_content, image_type)}
                        requests.post(f"http://{target_backend}/upload/image", files=files, timeout=10)
                    except Exception as e:
                        write_diagnostic(f"comfy sync upload failed error={type(e).__name__}")

        workflow_path = os.path.join(WORKFLOW_DIR, req.workflow_json)
        if not os.path.exists(workflow_path) and req.workflow_json == "Z-Image.json":
            workflow_path = WORKFLOW_PATH
        if not os.path.exists(workflow_path):
            raise Exception(f"Workflow file not found: {req.workflow_json}")

        with open(workflow_path, 'r', encoding='utf-8') as f:
            workflow = json.load(f)

        seed = random.randint(1, 4294967295)

        if "23" in workflow and req.prompt:
            workflow["23"]["inputs"]["text"] = req.prompt
        if "144" in workflow:
            workflow["144"]["inputs"]["width"] = req.width
            workflow["144"]["inputs"]["height"] = req.height
        if "22" in workflow:
            workflow["22"]["inputs"]["seed"] = seed
        if "158" in workflow:
            workflow["158"]["inputs"]["noise_seed"] = seed
        for node_id in ["146", "181"]:
            if node_id in workflow and "inputs" in workflow[node_id] and "seed" in workflow[node_id]["inputs"]:
                workflow[node_id]["inputs"]["seed"] = seed
        if "184" in workflow and "inputs" in workflow["184"] and "seed" in workflow["184"]["inputs"]:
            workflow["184"]["inputs"]["seed"] = seed
        if "172" in workflow and "inputs" in workflow["172"] and "seed" in workflow["172"]["inputs"]:
            workflow["172"]["inputs"]["seed"] = seed
        if "14" in workflow and "inputs" in workflow["14"] and "seed" in workflow["14"]["inputs"]:
            workflow["14"]["inputs"]["seed"] = seed

        for node_id, node_inputs in req.params.items():
            if node_id in workflow:
                if "inputs" not in workflow[node_id]:
                    workflow[node_id]["inputs"] = {}
                for input_name, value in node_inputs.items():
                    if value is None:
                        workflow[node_id]["inputs"].pop(input_name, None)
                        continue
                    workflow[node_id]["inputs"][input_name] = value
            elif isinstance(node_inputs, dict) and node_inputs.get("class_type") and isinstance(node_inputs.get("inputs"), dict):
                workflow[str(node_id)] = {
                    "class_type": str(node_inputs.get("class_type")),
                    "inputs": node_inputs.get("inputs") or {},
                    "_meta": node_inputs.get("_meta") if isinstance(node_inputs.get("_meta"), dict) else {"title": str(node_inputs.get("class_type"))},
                }

        p = {"prompt": workflow, "client_id": CLIENT_ID}
        data = json.dumps(p).encode('utf-8')
        try:
            post_req = urllib.request.Request(f"http://{target_backend}/prompt", data=data)
            prompt_id = json.loads(urllib.request.urlopen(post_req, timeout=10).read())['prompt_id']
        except urllib.error.HTTPError as e:
            error_body = e.read().decode('utf-8')
            raise Exception(comfy_prompt_error_message(e.code, error_body))

        history_data = None
        for i in range(COMFYUI_HISTORY_TIMEOUT):
            try:
                res = get_comfy_history(target_backend, prompt_id)
                if prompt_id in res:
                    history_data = res[prompt_id]
                    break
            except Exception:
                pass
            time.sleep(1)

        if not history_data:
            raise Exception("ComfyUI 渲染超时")

        local_images = []
        local_videos = []
        local_audios = []
        local_texts = []
        local_files = []
        local_items = []
        local_urls = []
        current_timestamp = time.time()
        if 'outputs' in history_data:
            # 先把所有节点的输出收集为候选（带上 class_type），再决定下载哪些，
            # 避免把冗余的预览/对比图、调试文本一起下载进结果（后端层过滤，历史记录也更干净）。
            workflow_nodes = workflow if isinstance(workflow, dict) else {}
            def _class_type_of(nid):
                node_def = workflow_nodes.get(str(nid))
                return str(node_def.get("class_type") or "") if isinstance(node_def, dict) else ""
            file_candidates = []   # (node_id, class_type, output_key, item, kind)
            text_candidates = []   # (node_id, class_type, text, name)
            for node_id in history_data['outputs']:
                node_output = history_data['outputs'][node_id]
                class_type = _class_type_of(node_id)
                for output_key, item in collect_comfy_file_items(node_output):
                    file_candidates.append((node_id, class_type, output_key, item, comfy_output_kind(item)))
                for text, name in comfy_text_values_from_output(node_output):
                    text_candidates.append((node_id, class_type, text, name))

            # 只要存在“非预览节点”产出的图片，就把 PreviewImage/对比节点的图片视为冗余丢弃；
            # 若整个工作流只有预览图（没有 SaveImage 等），则保留预览图作为唯一结果，避免零输出。
            has_primary_image = any(
                kind == "image" and not comfy_class_is_preview(ct)
                for (_nid, ct, _ok, _it, kind) in file_candidates
            )
            prefix = f"{req.type}_{int(current_timestamp)}_"
            for node_id, class_type, output_key, item, kind in file_candidates:
                if kind == "image" and has_primary_image and comfy_class_is_preview(class_type):
                    continue  # 跳过冗余的预览/对比图
                local_path = download_comfy_output(target_backend, item, prefix=prefix)
                if kind == "image" and req.convert_to_jpg:
                    local_path = convert_output_to_jpg(local_path)
                name = os.path.basename(str(item.get("filename") or "")) or os.path.basename(str(local_path).split("?", 1)[0])
                entry = {
                    "url": local_path,
                    "kind": kind,
                    "name": name,
                    "node_id": str(node_id),
                    "output_key": str(output_key),
                    "class_type": class_type,
                }
                if kind == "image":
                    local_images.append(local_path)
                elif kind == "video":
                    local_videos.append(local_path)
                elif kind == "audio":
                    local_audios.append(local_path)
                elif kind == "text":
                    local_texts.append(local_path)
                else:
                    local_files.append(local_path)
                local_items.append(entry)
                local_urls.append(local_path)

            # 默认抑制 show/utility 类节点的调试文本，避免 .txt 噪声混入结果。
            for node_id, class_type, text, name in text_candidates:
                if comfy_class_is_debug_text(class_type):
                    continue
                local_path = save_comfy_text_output(text, prefix=prefix, name=name)
                entry = {
                    "url": local_path,
                    "kind": "text",
                    "name": os.path.basename(str(local_path).split("?", 1)[0]),
                    "node_id": str(node_id),
                    "output_key": "text",
                    "class_type": class_type,
                }
                local_texts.append(local_path)
                local_items.append(entry)
                local_urls.append(local_path)

        result = {
            "prompt": req.prompt if req.prompt else "Detail Enhance",
            "images": local_images,
            "videos": local_videos,
            "audios": local_audios,
            "texts": local_texts,
            "files": local_files,
            "items": local_items,
            "outputs": local_urls,
            "seed": seed,
            "timestamp": current_timestamp,
            "type": req.type,
            "workflow_json": req.workflow_json,
            "task_id": task_id,
            "prompt_id": prompt_id,
            "backend": target_backend,
            "params": req.params
        }
        save_to_history(result)
        schedule_coroutine(manager.broadcast_new_image(result))
        return result

    except Exception as e:
        write_diagnostic(f"comfy generation failed error={type(e).__name__}")
        return {"images": [], "error": public_comfy_error_detail(e)}
    finally:
        if target_backend:
            with LOAD_LOCK:
                if get_backend_load().get(target_backend, 0) > 0:
                    get_backend_load()[target_backend] -= 1
        if current_task:
            with QUEUE_LOCK:
                if current_task in QUEUE:
                    QUEUE.remove(current_task)
