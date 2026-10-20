"""对话文档、生成历史存储与列表读取。

索引、文件、锁和供应商调用由应用显式注入，保留现有提交/清理顺序。
"""
import os
import uuid
import time
import re
import json

def sanitize_record_usage(record, *, public_usage):
    if isinstance(record, dict) and "raw_usage" in record:
        record["raw_usage"] = public_usage(record["raw_usage"])
    return record


def sanitize_conversation_usage(conversation, *, sanitize_record_usage):
    if isinstance(conversation, dict):
        for message in conversation.get("messages") or []:
            sanitize_record_usage(message)
    return conversation


def save_to_history(record, *, HISTORY_FILE, HISTORY_LOCK, sanitize_record_usage, write_json_atomic):
    sanitize_record_usage(record)
    with HISTORY_LOCK:
        history = []
        if os.path.exists(HISTORY_FILE):
            try:
                with open(HISTORY_FILE, 'r', encoding='utf-8') as f:
                    history = json.load(f)
            except: pass
        if "timestamp" not in record:
            record["timestamp"] = time.time()
        history.insert(0, record)
        write_json_atomic(HISTORY_FILE, history[:5000], ensure_ascii=False, indent=4)


def user_dir(user_id, *, CONVERSATION_DIR):
    path = os.path.join(CONVERSATION_DIR, user_id)
    os.makedirs(path, exist_ok=True)
    return path


def conversation_path(user_id, conversation_id, *, HTTPException, user_dir):
    cleaned = re.sub(r"[^a-zA-Z0-9_-]", "", conversation_id or "")
    if not cleaned:
        raise HTTPException(status_code=400, detail="无效的对话 ID")
    return os.path.join(user_dir(user_id), f"{cleaned}.json")


def save_conversation(user_id, conversation, *, CONVERSATION_LOCK, conversation_path, sanitize_conversation_usage, write_json_atomic):
    sanitize_conversation_usage(conversation)
    with CONVERSATION_LOCK:
        path = conversation_path(user_id, conversation["id"])
        write_json_atomic(path, conversation, ensure_ascii=False, indent=2)


def new_conversation(user_id, title='新对话', *, now_ms, save_conversation):
    timestamp = now_ms()
    conversation = {
        "id": uuid.uuid4().hex,
        "title": (title or "新对话")[:80],
        "created_at": timestamp,
        "updated_at": timestamp,
        "messages": [],
    }
    save_conversation(user_id, conversation)
    return conversation


def load_conversation(user_id, conversation_id, *, HTTPException, conversation_path, sanitize_conversation_usage):
    path = conversation_path(user_id, conversation_id)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="对话不存在")
    with open(path, 'r', encoding='utf-8') as f:
        return sanitize_conversation_usage(json.load(f))


def list_conversations(user_id, *, user_dir):
    records = []
    for filename in os.listdir(user_dir(user_id)):
        if not filename.endswith(".json"):
            continue
        path = os.path.join(user_dir(user_id), filename)
        try:
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except Exception:
            continue
        messages = data.get("messages", [])
        last_message = next((m for m in reversed(messages) if m.get("role") != "system"), None)
        records.append({
            "id": data.get("id"),
            "title": data.get("title", "新对话"),
            "created_at": data.get("created_at", 0),
            "updated_at": data.get("updated_at", 0),
            "last_message": (last_message or {}).get("content", ""),
        })
    return sorted(records, key=lambda item: item["updated_at"], reverse=True)


async def conversations(request, x_user_id='', *, list_conversations, safe_user_id):
    user_id = safe_user_id(x_user_id, request)
    return {"user_id": user_id, "conversations": list_conversations(user_id)}


async def create_conversation(payload, request, x_user_id='', *, new_conversation, safe_user_id):
    user_id = safe_user_id(x_user_id, request)
    return {"conversation": new_conversation(user_id, payload.title)}


async def get_conversation(conversation_id, request, x_user_id='', *, load_conversation, safe_user_id):
    user_id = safe_user_id(x_user_id, request)
    return {"conversation": load_conversation(user_id, conversation_id)}


async def delete_conversation(conversation_id, request, x_user_id='', *, conversation_path, safe_user_id):
    user_id = safe_user_id(x_user_id, request)
    path = conversation_path(user_id, conversation_id)
    if os.path.exists(path):
        os.remove(path)
    return {"ok": True}


async def get_history_api(type=None, *, HISTORY_FILE, history_records_for_api, read_history_records, sanitize_record_usage, write_diagnostic):
    try:
        records = history_records_for_api(read_history_records(HISTORY_FILE), type)
        return [sanitize_record_usage(record) for record in records]
    except Exception as e:
        write_diagnostic(f"history file read failed error={type(e).__name__}")
        return []


