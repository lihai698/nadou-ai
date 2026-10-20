"""Comfy工作流文件、字段配置和运行请求装配。

索引、文件、锁和供应商调用由应用显式注入，保留现有提交/清理顺序。
"""
import os
import uuid
import json

def workflow_path_from_name(name, *, HTTPException, WORKFLOW_DIR, WORKFLOW_NAME_RE):
    if not WORKFLOW_NAME_RE.match(name):
        raise HTTPException(status_code=400, detail="Invalid workflow name")
    path = os.path.abspath(os.path.join(WORKFLOW_DIR, *name.split("/")))
    workflow_root = os.path.abspath(WORKFLOW_DIR)
    if os.path.commonpath([workflow_root, path]) != workflow_root:
        raise HTTPException(status_code=400, detail="Invalid workflow name")
    return path


def workflow_config_path(name, *, workflow_path_from_name):
    return workflow_path_from_name(name).replace(".json", ".config.json")


def _save_workflow_json_or_raise(path, payload, label, *, HTTPException, WORKFLOW_STORAGE_LOCK, write_json_atomic):
    """以原子方式保存工作流文件，并保护已有损坏文件。

    工作流上传和字段配置都属于用户可恢复的本地 JSON。写入前先读取已有
    文件，只有确认它仍是对象时才允许替换；解析失败或原子替换失败均保留
    原文件，并转换为受控的 HTTP 500，避免直接截断导致故障现场丢失。
    """
    if not isinstance(payload, dict):
        raise ValueError(f"{label}必须是 JSON 对象")
    with WORKFLOW_STORAGE_LOCK:
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as handle:
                    existing = json.load(handle)
                if not isinstance(existing, dict):
                    raise ValueError(f"{label}记录格式无效")
            except (OSError, UnicodeError, ValueError, json.JSONDecodeError) as exc:
                raise HTTPException(
                    status_code=500,
                    detail=f"现有{label}文件损坏或无法读取，已保留原文件；请从备份恢复后重试。",
                ) from exc
        try:
            write_json_atomic(path, payload, ensure_ascii=False, indent=2)
        except (OSError, UnicodeError, ValueError) as exc:
            raise HTTPException(
                status_code=500,
                detail=f"{label}文件无法保存，已保留原文件；请排除磁盘故障或从备份恢复后重试。",
            ) from exc


def is_builtin_workflow(name, *, BUILTIN_WORKFLOWS):
    return "/" not in name and os.path.basename(name) in BUILTIN_WORKFLOWS


def list_workflows(*, CUSTOM_WORKFLOW_FOLDER, LEGACY_CUSTOM_WORKFLOW_FOLDER, WORKFLOW_DIR, is_builtin_workflow, workflow_config_path):
    if not os.path.isdir(WORKFLOW_DIR):
        return {"workflows": []}
    items = []
    for root, dirs, files in os.walk(WORKFLOW_DIR):
        if os.path.abspath(root) == os.path.abspath(WORKFLOW_DIR):
            dirs[:] = [d for d in dirs if d in {CUSTOM_WORKFLOW_FOLDER, LEGACY_CUSTOM_WORKFLOW_FOLDER}]
        for fn in sorted(files):
            if not fn.endswith(".json") or fn.endswith(".config.json"):
                continue
            rel = os.path.relpath(os.path.join(root, fn), WORKFLOW_DIR).replace("\\", "/")
            if is_builtin_workflow(rel):
                continue
            cfg = {}
            cfg_path = workflow_config_path(rel)
            if os.path.exists(cfg_path):
                try:
                    with open(cfg_path, "r", encoding="utf-8") as f:
                        cfg = json.load(f) or {}
                except Exception:
                    cfg = {}
            items.append({
                "name": rel,
                "title": cfg.get("title") or fn.replace(".json", ""),
                "builtin": False,
                "field_count": len(cfg.get("fields") or []),
            })
    items.sort(key=lambda item: (0 if item["name"].startswith(f"{CUSTOM_WORKFLOW_FOLDER}/") else 1, item["title"]))
    return {"workflows": items}


def get_workflow(name, *, HTTPException, WORKFLOW_NAME_RE, is_builtin_workflow, workflow_config_path, workflow_path_from_name):
    if not WORKFLOW_NAME_RE.match(name):
        raise HTTPException(status_code=400, detail="Invalid workflow name")
    workflow_path = workflow_path_from_name(name)
    if not os.path.exists(workflow_path):
        raise HTTPException(status_code=404, detail="Workflow not found")
    with open(workflow_path, "r", encoding="utf-8") as f:
        workflow = json.load(f)
    cfg = {"title": name.replace(".json", ""), "fields": []}
    cfg_path = workflow_config_path(name)
    if os.path.exists(cfg_path):
        try:
            with open(cfg_path, "r", encoding="utf-8") as f:
                cfg = json.load(f) or cfg
        except Exception:
            pass
    return {"name": name, "workflow": workflow, "config": cfg, "builtin": is_builtin_workflow(name)}


def upload_workflow(payload, *, CUSTOM_WORKFLOW_FOLDER, HTTPException, WORKFLOW_DIR, WORKFLOW_NAME_RE, _save_workflow_json_or_raise, workflow_path_from_name):
    name = os.path.basename(payload.name.strip())
    if not name.endswith(".json"):
        name = name + ".json"
    if not WORKFLOW_NAME_RE.match(name):
        raise HTTPException(status_code=400, detail="工作流名称不合法，请使用中文/英文/数字/_-.")
    if not isinstance(payload.workflow, dict) or not payload.workflow:
        raise HTTPException(status_code=400, detail="工作流 JSON 为空")
    # 简单校验：是 API 格式（节点 id 为 key，含 class_type）
    sample = next(iter(payload.workflow.values()), None)
    if not isinstance(sample, dict) or "class_type" not in sample:
        raise HTTPException(status_code=400, detail="不是有效的 ComfyUI API 工作流 JSON（需包含 class_type）")
    custom_dir = os.path.join(WORKFLOW_DIR, CUSTOM_WORKFLOW_FOLDER)
    os.makedirs(custom_dir, exist_ok=True)
    stored_name = f"{CUSTOM_WORKFLOW_FOLDER}/{name}"
    path = workflow_path_from_name(stored_name)
    _save_workflow_json_or_raise(path, payload.workflow, "工作流")
    return {"name": stored_name}


def save_workflow_config(name, payload, *, HTTPException, WORKFLOW_NAME_RE, _save_workflow_json_or_raise, model_dump_compat, workflow_config_path, workflow_path_from_name):
    if not WORKFLOW_NAME_RE.match(name):
        raise HTTPException(status_code=400, detail="Invalid workflow name")
    workflow_path = workflow_path_from_name(name)
    if not os.path.exists(workflow_path):
        raise HTTPException(status_code=404, detail="Workflow not found")
    cfg_path = workflow_config_path(name)
    # Pydantic 2 推荐 model_dump；保留旧方法回退以兼容 Pydantic 1。
    config = model_dump_compat(payload)
    _save_workflow_json_or_raise(cfg_path, config, "工作流配置")
    return {"config": config}


def delete_workflow(name, *, HTTPException, WORKFLOW_NAME_RE, is_builtin_workflow, workflow_config_path, workflow_path_from_name):
    if not WORKFLOW_NAME_RE.match(name):
        raise HTTPException(status_code=400, detail="Invalid workflow name")
    if is_builtin_workflow(name):
        raise HTTPException(status_code=400, detail="内置工作流不可删除")
    workflow_path = workflow_path_from_name(name)
    cfg_path = workflow_config_path(name)
    if not os.path.exists(workflow_path):
        raise HTTPException(status_code=404, detail="Workflow not found")
    os.remove(workflow_path)
    if os.path.exists(cfg_path):
        os.remove(cfg_path)
    return {"ok": True}


def run_workflow(name, payload, *, Any, Dict, GenerateRequest, HTTPException, WORKFLOW_NAME_RE, generate, workflow_path_from_name):
    if not WORKFLOW_NAME_RE.match(name):
        raise HTTPException(status_code=400, detail="Invalid workflow name")
    if not os.path.exists(workflow_path_from_name(name)):
        raise HTTPException(status_code=404, detail="Workflow not found")
    # 根据 config 的字段把值映射成 params 节点覆盖
    params: Dict[str, Dict[str, Any]] = {}
    for field in payload.config.fields:
        if not field.node or not field.input:
            continue
        if field.id in payload.fields:
            value = payload.fields[field.id]
            # 类型转换
            if field.type in ("number", "slider"):
                try:
                    value = float(value) if (field.step and field.step < 1) else int(float(value))
                except Exception:
                    pass
            elif field.type == "boolean":
                value = bool(value)
            elif field.type == "dropdown":
                # 下拉值如果看起来是数字（如 "1024" / "2048" / "0.8"），自动转成 int/float
                if isinstance(value, str):
                    s = value.strip()
                    try:
                        if s and ('.' in s or 'e' in s.lower()):
                            value = float(s)
                        elif s and (s.lstrip('-').isdigit()):
                            value = int(s)
                    except (ValueError, TypeError):
                        pass
            params.setdefault(field.node, {})[field.input] = value
    req = GenerateRequest(
        prompt="",
        workflow_json=name,
        params=params,
        type="workflow-test",
        client_id=payload.client_id or str(uuid.uuid4()),
    )
    return generate(req)


