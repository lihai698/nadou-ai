import json
import uuid
import base64
import hashlib
import hmac
import ipaddress
import datetime
import urllib.request
import urllib.parse
import urllib.error
import os
import re
import random
import sys
import subprocess
import time
import traceback
import shutil
import glob
from backend import asset_library_service
from backend import image_openai_service, image_tool_request_service, video_http_service, video_request_service
from backend import shared_folder_service
from backend import local_asset_service
from backend import avatar_asset_service
from backend import media_cleanup_service
from backend import media_storage_service
from backend import conversation_service
from backend import chat_execution_service
from backend import workflow_archive_service
from backend import canvas_asset_export_service
from backend import comfy_workflow_service
from backend import runninghub_config_service
from backend import runninghub_fields
from backend import runninghub_model_registry_service
from backend import prompt_library_service
from backend import image_provider_service
from backend import image_size_rules
from backend import provider_protocols
from backend import tudou_provider_service
from backend import midjourney_service
from backend import video_provider_service
from backend import comfy_generation_service
from backend import comfy_backend_selection
from backend import static_page_service
from backend import network_log_service
from backend import comfy_output_service
from backend import responses_service
from backend import upstream_response_codec
from backend import upstream_http_service
from backend import gemini_cli_service
from backend import codex_cli_service
from backend import jimeng_provider_protocol
from backend import jimeng_execution_service
from backend import provider_registry_service
from backend import provider_probe_service
from backend import upstream_public_policy
from backend import chat_attachment_service
from backend import generation_output_service
from backend import media_reference_service
from backend import provider_media_transfer
from backend import image_result_service
from backend import video_result_service
from backend import agnes_video_service
from backend import openai_video_service
from backend import modelscope_execution_service
from backend import update_release_service
from backend import update_staging_service
from backend import update_backup_service
from backend import full_update_service
from backend import application_restart_service
from backend import asset_library_files
from backend import asset_library_index
from backend import upload_service
import asyncio
import logging
import requests
import zipfile
import mimetypes
import tempfile
import math
import shlex
import html
import xml.etree.ElementTree as ET
from contextvars import ContextVar
from contextlib import contextmanager
from typing import List, Dict, Any, Optional, Tuple, Mapping
from threading import Lock, RLock, Thread, local
import httpx
from PIL import Image, ImageOps
from io import BytesIO
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, UploadFile, File, Form, Header, Request
from fastapi.exceptions import RequestValidationError
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response, StreamingResponse, JSONResponse
from pydantic import BaseModel, Field
from fastapi.middleware.cors import CORSMiddleware
from backend.versioning import version_gt
from backend import canvas_audio_service
from backend.versioning import version_tuple
from backend.provider_protocols import (
    effective_protocol,
    normalize_model_name_map,
    normalize_model_protocols,
    provider_protocol,
)
from backend.model_selection import (
    model_list_from_values,
    normalize_model_list,
    selected_model,
)
from backend.codex_models import list_codex_models
from backend.tracing import (
    bind_context,
    current_request_id,
    current_trace_id,
    format_context,
    request_context,
    reset_context,
    task_context,
)
from backend.diagnostics import configure_diagnostics, write_diagnostic
from backend.atomic_json import write_json_atomic, write_text_atomic
from backend.process_lock import interprocess_file_lock
from backend.canvas_assistant import create_assistant_router
from backend.canvas_assistant_canvas_rules import canvas_context
from backend import canvas_assistant_reference_service
from backend import canvas_assistant_native_service
from backend.canvas_assistant_generation import validate_snapshot
from backend.canvas_assistant_operations import prepare_operations
from backend.realtime import (
    ConnectionManager,
    manager,
    schedule_coroutine,
    set_global_loop,
)
from backend.canvas_store import CanvasStore, CanvasStoreError
from backend.project_store import ProjectStore, ProjectOperationError
from backend import canvas_video_task_service
from backend import canvas_task_service
from backend.canvas_task_service import (
    public_task as _public_canvas_task,
    remote_records as _canvas_remote_records,
    remote_statuses as _canvas_remote_statuses,
    remote_errors as _canvas_remote_errors,
    remote_results as _canvas_remote_results,
    update_remote_tracking as _update_canvas_remote_tracking,
)
from backend import project_service
from backend.canvas_records import (
    CANVAS_COLORS,
    canvas_record,
    sort_canvas_records,
)
from backend.project_records import project_record, project_list_records
from backend.history_records import history_records_for_api, read_history_records
from backend.task_states import image_batch_outcome, task_state_update
from backend.task_records import (
    TaskRecordError,
    read_task_record,
    task_input_summary,
    write_task_record,
)
from backend.task_record_cleanup import (
    DEFAULT_TASK_TTL_SECONDS,
    TaskCleanupError,
    plan_expired_task_cleanup,
    public_task_cleanup_plan,
)
from backend.remote_task_protocol import (
    IMAGE_TASK_FAILED_STATUSES,
    IMAGE_TASK_SUCCESS_STATUSES,
    REMOTE_FAILED,
    REMOTE_PENDING,
    REMOTE_SUCCEEDED,
    REMOTE_UNKNOWN,
    image_task_data,
    image_task_status,
    observe_remote_task,
    remote_task_decision,
)
from backend import runninghub_protocol
from backend.runninghub_app_service import RunningHubAppService, RunningHubAppError
from backend.runninghub_openapi import RunningHubOpenAPIAdapter, RunningHubOpenAPIError
from backend.runninghub_protocol import runninghub_extract_task_id, runninghub_query_status
from backend.image_generation_dispatch import ImageGenerationDispatchContext, resolve_image_generation_dispatch
from backend.task_concurrency import TaskConcurrencyGate, configured_task_limits
from backend import comfy_task_service
from backend.extensions import ExtensionError, ExtensionRegistry
from backend.local_media_extension import LOCAL_MEDIA_EXTENSION
from backend import asset_media_rules, canvas_asset_rules
from backend.asset_media_rules import (
    asset_library_media_kind,
    asset_library_safe_extension,
    _local_upload_kind_ext,
    _local_upload_display_name,
    _sniff_image_ext_bytes,
)
from backend.canvas_asset_rules import (
    canvas_asset_url_value,
    canvas_asset_downloadable_url,
    filename_from_media_url,
    sanitize_asset_name,
    sanitize_export_filename,
)
from backend.media_reference_rules import (
    collect_local_media_urls,
    json_value_references_media_path,
)
from backend.prompt_templates import (
    extract_prompt_template_section,
    parse_prompt_template_markdown as _parse_prompt_template_markdown,
    prompt_template_category,
)
from backend.storage_paths import (
    UnknownStorageKind,
    UnsafeStoragePath,
    normalize_storage_path,
    resolve_storage_dirs,
    output_storage as resolve_output_storage,
    output_path_for as resolve_output_path,
    output_url_for as resolve_output_url,
    storage_kind_root,
    storage_file_path as resolve_storage_file_path,
    output_file_from_url as resolve_output_file,
)
from backend import local_env
from backend.depth_capture import DepthCaptureManager
from backend.canvas_clip import CanvasClipManager, CanvasClipConflict
from backend.canvas_video_media import VideoMedia
from backend.canvas_video_deconstruction import VideoDeconstructionManager, create_video_deconstruction_router
from backend.canvas_video_speech import VideoSpeech
from backend.canvas_local_vision import LocalVideoVision

QUIET_ACCESS_PATHS = {
    "/api/queue_status",
    "/api/canvases",
    "/api/canvases/trash",
}
QUIET_ACCESS_PREFIXES = (
    "/api/canvases/",
)

class QuietAccessLogFilter(logging.Filter):
    def filter(self, record):
        args = record.args if isinstance(record.args, tuple) else ()
        if len(args) >= 3:
            path = str(args[2]).split("?", 1)[0]
            status = int(args[4]) if len(args) >= 5 and str(args[4]).isdigit() else 0
            quiet_dynamic = any(path.startswith(prefix) and path.endswith("/meta") for prefix in QUIET_ACCESS_PREFIXES)
            if (path in QUIET_ACCESS_PATHS or quiet_dynamic) and status < 400:
                return False
        message = record.getMessage()
        if any(f'"GET {path}' in message and '" 200' in message for path in QUIET_ACCESS_PATHS):
            return False
        if 'GET /api/canvases/' in message and '/meta' in message and '" 200' in message:
            return False
        return True

logging.getLogger("uvicorn.access").addFilter(QuietAccessLogFilter())

app = FastAPI()


def model_dump_compat(value, **kwargs):
    """兼容 Pydantic 1/2 的模型转字典方法。"""

    dump = getattr(value, "model_dump", None)
    if callable(dump):
        return dump(**kwargs)
    legacy = getattr(value, "dict", None)
    if callable(legacy):
        return legacy(**kwargs)
    return dict(value)


def configured_bind_host():
    return os.getenv("NADOU_BIND_HOST", "").strip() or "127.0.0.1"


def bind_host_requires_access_control(host=None):
    value = str(host if host is not None else configured_bind_host()).strip().strip("[]").lower()
    if value in {"localhost", "127.0.0.1", "::1"}:
        return False
    try:
        return not ipaddress.ip_address(value).is_loopback
    except ValueError:
        # 未知主机名可能解析到局域网地址，按远端监听处理更安全。
        return True


def configured_access_token():
    return str(os.getenv("NADOU_ACCESS_TOKEN", "") or "").strip()


def supplied_access_token(scope):
    headers = {
        key.decode("latin-1").lower(): value.decode("latin-1")
        for key, value in scope.get("headers", [])
    }
    direct = headers.get("x-nadou-access-token", "").strip()
    if direct:
        return direct
    authorization = headers.get("authorization", "").strip()
    scheme, _, value = authorization.partition(" ")
    if scheme.lower() == "bearer":
        return value.strip()
    if scheme.lower() == "basic":
        try:
            decoded = base64.b64decode(value, validate=True).decode("utf-8")
        except (ValueError, UnicodeError):
            return ""
        _, separator, password = decoded.partition(":")
        return password if separator else decoded
    return ""


class RemoteAccessMiddleware:
    """非回环监听时保护 HTTP 与 WebSocket，默认本机监听不增加登录步骤。"""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") not in {"http", "websocket"} or not bind_host_requires_access_control():
            await self.app(scope, receive, send)
            return
        if scope.get("type") == "http" and scope.get("method", "").upper() == "OPTIONS":
            # 允许跨域预检先完成；真正的 GET/POST 仍必须携带令牌。
            await self.app(scope, receive, send)
            return
        token = configured_access_token()
        supplied = supplied_access_token(scope)
        authorized = bool(token and supplied and hmac.compare_digest(supplied, token))
        if authorized:
            await self.app(scope, receive, send)
            return
        if scope.get("type") == "websocket":
            await send({"type": "websocket.close", "code": 1008, "reason": "需要访问令牌"})
            return
        if not token:
            status = 503
            body = "服务绑定到非本机地址，但未配置 NADOU_ACCESS_TOKEN。"
            headers = [(b"content-type", b"text/plain; charset=utf-8")]
        else:
            status = 401
            body = "需要 NADOU_ACCESS_TOKEN。"
            headers = [
                (b"content-type", b"text/plain; charset=utf-8"),
                (b"www-authenticate", b'Basic realm="nadou ai"'),
            ]
        payload = body.encode("utf-8")
        headers.append((b"content-length", str(len(payload)).encode("ascii")))
        await send({"type": "http.response.start", "status": status, "headers": headers})
        await send({"type": "http.response.body", "body": payload})


@app.middleware("http")
async def request_tracing_middleware(request: Request, call_next):
    """为每个 HTTP 请求建立可传递的 request/trace 标识。

    ``X-Request-ID`` 标识单次 HTTP 请求，``X-Trace-ID`` 用于把同一次页面
    操作发起的多个请求和后台任务串起来。后台任务由 ``asyncio.create_task``
    创建时会继承当前上下文，因此网络诊断日志可以定位到提交它的请求。
    """

    trace_id, request_id = request_context(request.headers)
    tokens = bind_context(trace_id, request_id)
    request.state.trace_id = trace_id
    request.state.request_id = request_id
    try:
        response = await call_next(request)
    except Exception:
        # 保留原始异常，让 FastAPI 的异常处理层决定响应；上下文仍在 finally 中恢复。
        raise
    finally:
        reset_context(tokens)
    response.headers["X-Trace-ID"] = trace_id
    response.headers["X-Request-ID"] = request_id
    return response

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(RemoteAccessMiddleware)

GITHUB_REPO_SLUG = "lihai698/nadou-ai"
GITHUB_REPO_URL = f"https://github.com/{GITHUB_REPO_SLUG}"
GITHUB_RAW_ROOT = f"https://raw.githubusercontent.com/{GITHUB_REPO_SLUG}/main"
GITHUB_VERSION_URL = GITHUB_RAW_ROOT + "/VERSION"
GITHUB_TREE_URL = f"https://api.github.com/repos/{GITHUB_REPO_SLUG}/git/trees/main?recursive=1"
GITHUB_COMMIT_URL = f"https://api.github.com/repos/{GITHUB_REPO_SLUG}/commits/main"
GITHUB_UPDATE_NOTES_URL = GITHUB_RAW_ROOT + "/static/update-notes.json"

def configure_runtime_diagnostics():
    """启动时配置诊断日志；自定义路径不可用时回退到默认路径。"""

    default_path = os.path.join(DATA_DIR, "logs", "diagnostics.log")
    requested_path = os.getenv("DIAGNOSTIC_LOG_FILE") or default_path
    limits = {
        "max_bytes": os.getenv("DIAGNOSTIC_LOG_MAX_BYTES"),
        "backup_count": os.getenv("DIAGNOSTIC_LOG_BACKUP_COUNT"),
    }
    try:
        return configure_diagnostics(requested_path, **limits)
    except (OSError, TypeError, ValueError) as exc:
        # 日志是诊断辅助设施，不能因为自定义目录权限问题阻断本地画布启动。
        if os.path.abspath(str(requested_path)) != os.path.abspath(default_path):
            try:
                configured = configure_diagnostics(default_path, **limits)
            except (OSError, TypeError, ValueError):
                configured = ""
            if configured:
                write_diagnostic(
                    f"diagnostic log path fallback error={type(exc).__name__}"
                )
                return configured
        try:
            configure_diagnostics("")
        except (OSError, TypeError, ValueError):
            pass
        return ""


@app.on_event("startup")
async def startup_event():
    set_global_loop(asyncio.get_running_loop())
    configure_runtime_diagnostics()
    sync_static_html_versions()
    # 启动时整理资产库：给所有图片分组（含默认角色/场景）建好文件夹，并把根目录里的旧素材归整进去。
    try:
        await asyncio.to_thread(migrate_asset_library_into_dirs)
    except Exception as exc:
        write_diagnostic(
            f"startup asset library migration failed error={type(exc).__name__}"
        )
    # 修复历史遗留的双重扩展名素材（foo.png.png → foo.png），否则这些卡片无法显示
    try:
        await asyncio.to_thread(migrate_double_extension_uploads)
    except Exception as exc:
        write_diagnostic(
            f"startup duplicate extension migration failed error={type(exc).__name__}"
        )
    # 纠正内容与扩展名不符的图片（如 WebP 内容却叫 .png），否则严格客户端解不出来
    try:
        await asyncio.to_thread(migrate_mislabeled_image_extensions)
    except Exception as exc:
        write_diagnostic(
            f"startup mislabeled extension migration failed error={type(exc).__name__}"
        )

@app.websocket("/ws/stats")
async def websocket_endpoint(websocket: WebSocket, client_id: str = None):
    await manager.connect(websocket, client_id)
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
    except WebSocketDisconnect:
        await manager.disconnect(websocket, client_id)
    except Exception as e:
        write_diagnostic(f"realtime websocket failed error={type(e).__name__}")
        await manager.disconnect(websocket, client_id)

# --- 配置区域 ---

CLIENT_ID = str(uuid.uuid4())
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WORKFLOW_DIR = os.path.join(BASE_DIR, "workflows")
WORKFLOW_PATH = os.path.join(WORKFLOW_DIR, "Z-Image.json")
STATIC_DIR = os.path.join(BASE_DIR, "static")
STATIC_RUNNINGHUB_DIR = os.path.join(STATIC_DIR, "runninghub")
STATIC_RUNNINGHUB_THUMBNAIL_DIR = os.path.join(STATIC_RUNNINGHUB_DIR, "thumbnails")
STATIC_RUNNINGHUB_API_PROVIDERS_FILE = os.path.join(STATIC_RUNNINGHUB_DIR, "api_providers.json")
STATIC_RUNNINGHUB_MODEL_REGISTRY_FILE = os.path.join(STATIC_RUNNINGHUB_DIR, "models_registry.json")
OUTPUT_DIR = os.path.join(BASE_DIR, "output")
ASSETS_DIR = os.path.join(BASE_DIR, "assets")
OUTPUT_INPUT_DIR = os.path.join(ASSETS_DIR, "input")
OUTPUT_OUTPUT_DIR = os.path.join(ASSETS_DIR, "output")
ASSET_LIBRARY_DIR = os.path.join(ASSETS_DIR, "library")
LOCAL_UPLOAD_DIR = os.path.join(ASSETS_DIR, "uploads")
HISTORY_FILE = os.path.join(BASE_DIR, "history.json")
API_ENV_FILE = os.path.join(BASE_DIR, "API", ".env")
DATA_DIR = os.path.join(BASE_DIR, "data")
CONVERSATION_DIR = os.path.join(DATA_DIR, "conversations")
CANVAS_DIR = os.path.join(DATA_DIR, "canvases")
CANVAS_TASK_DIR = os.getenv("NADOU_CANVAS_TASK_DIR") or os.path.join(DATA_DIR, "canvas_tasks")
CANVAS_VIDEO_TASK_DIR = os.path.join(DATA_DIR, "canvas_video_tasks")
TASK_CONCURRENCY_LIMITS = configured_task_limits()
CANVAS_IMAGE_TASK_GATE = TaskConcurrencyGate(TASK_CONCURRENCY_LIMITS["image"], name="image")
CANVAS_COMFY_TASK_GATE = TaskConcurrencyGate(TASK_CONCURRENCY_LIMITS["comfy"], name="comfy")
CANVAS_VIDEO_TASK_GATE = TaskConcurrencyGate(TASK_CONCURRENCY_LIMITS["video"], name="video")
EXTENSION_REGISTRY = ExtensionRegistry((LOCAL_MEDIA_EXTENSION,))
for _disabled_extension_id in {
    item.strip().lower()
    for item in str(os.getenv("NADOU_DISABLED_EXTENSIONS") or "").split(",")
    if item.strip()
}:
    try:
        EXTENSION_REGISTRY.disable(_disabled_extension_id)
    except ExtensionError:
        write_diagnostic("unknown disabled extension id")
MEDIA_PREVIEW_DIR = os.path.join(DATA_DIR, "media_previews")
ASSET_LIBRARY_PATH = os.path.join(DATA_DIR, "asset_library.json")
ASSET_LIBRARY_LOCK = RLock()
ASSET_LIBRARY_LOCK_STATE = local()
PROMPT_LIBRARY_PATH = os.path.join(DATA_DIR, "prompt_libraries.json")
PROMPT_LIBRARY_LOCK = RLock()
API_PROVIDERS_FILE = os.path.join(DATA_DIR, "api_providers.json")
RUNNINGHUB_WORKFLOW_STORE_FILE = os.path.join(DATA_DIR, "runninghub_workflows.json")
SHARED_FOLDERS_FILE = os.path.join(DATA_DIR, "shared_folders.json")
GLOBAL_CONFIG_FILE = os.path.join(BASE_DIR, "global_config.json")
CANVAS_TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
LOCAL_IMAGE_IMPORT_MAX_BYTES = int(os.getenv("LOCAL_IMAGE_IMPORT_MAX_BYTES", str(50 * 1024 * 1024)))
# 所有用户上传入口统一限制：单文件 100MB，单次请求累计 500MB。
UPLOAD_MAX_FILE_BYTES = 100 * 1024 * 1024
UPLOAD_MAX_BATCH_BYTES = 500 * 1024 * 1024
UPLOAD_READ_CHUNK_BYTES = 1024 * 1024
BASE64_UPLOAD_MAX_BYTES = UPLOAD_MAX_FILE_BYTES
BASE64_UPLOAD_MAX_TEXT_LENGTH = ((BASE64_UPLOAD_MAX_BYTES + 2) // 3) * 4 + 512
WORKFLOW_ZIP_MAX_FILES = 2000
WORKFLOW_ZIP_MAX_UNCOMPRESSED_BYTES = UPLOAD_MAX_BATCH_BYTES


def _upload_limit_error(filename="文件", *, batch=False):
    return upload_service._upload_limit_error(filename, batch=batch, HTTPException=HTTPException, UPLOAD_MAX_BATCH_BYTES=UPLOAD_MAX_BATCH_BYTES, UPLOAD_MAX_FILE_BYTES=UPLOAD_MAX_FILE_BYTES)


async def read_upload_file_limited(file: UploadFile, *, batch_state=None):
    return await upload_service.read_upload_file_limited(file, batch_state=batch_state, file_limit=UPLOAD_MAX_FILE_BYTES, batch_limit=UPLOAD_MAX_BATCH_BYTES, chunk_bytes=UPLOAD_READ_CHUNK_BYTES, limit_error=_upload_limit_error)


def _base64_payload_size_hint(value):
    return upload_service._base64_payload_size_hint(value, BASE64_UPLOAD_MAX_TEXT_LENGTH=BASE64_UPLOAD_MAX_TEXT_LENGTH, BASE64_UPLOAD_MAX_BYTES=BASE64_UPLOAD_MAX_BYTES, _upload_limit_error=_upload_limit_error)


async def read_httpx_response_limited(response, *, batch_state=None, filename="远程文件"):
    return await upload_service.read_httpx_response_limited(response, batch_state=batch_state, filename=filename, UPLOAD_MAX_FILE_BYTES=UPLOAD_MAX_FILE_BYTES, UPLOAD_READ_CHUNK_BYTES=UPLOAD_READ_CHUNK_BYTES, UPLOAD_MAX_BATCH_BYTES=UPLOAD_MAX_BATCH_BYTES, _upload_limit_error=_upload_limit_error)


def validate_workflow_zip_limits(archive):
    return workflow_archive_service.validate_workflow_zip_limits(archive, HTTPException=HTTPException, WORKFLOW_ZIP_MAX_FILES=WORKFLOW_ZIP_MAX_FILES, WORKFLOW_ZIP_MAX_UNCOMPRESSED_BYTES=WORKFLOW_ZIP_MAX_UNCOMPRESSED_BYTES)


LOCAL_IMAGE_IMPORT_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
RUNNINGHUB_THUMBNAIL_EXTS = (".jpg",)
STORAGE_SETTINGS_FILE = os.path.join(DATA_DIR, "storage_settings.json")
STORAGE_SETTINGS_LOCK = RLock()
DEFAULT_STORAGE_DIRS = {
    "upload": OUTPUT_INPUT_DIR,
    "generated": OUTPUT_OUTPUT_DIR,
    "local": LOCAL_UPLOAD_DIR,
}

def _storage_abs_path(value, fallback):
    return normalize_storage_path(value, fallback, BASE_DIR)

def _read_storage_settings_raw():
    try:
        with open(STORAGE_SETTINGS_FILE, "r", encoding="utf-8-sig") as f:
            raw = json.load(f)
    except FileNotFoundError:
        return {}
    if not isinstance(raw, dict):
        raise ValueError("存储目录设置必须是 JSON 对象")
    return raw

def load_storage_settings():
    with STORAGE_SETTINGS_LOCK:
        try:
            raw = _read_storage_settings_raw()
        except Exception as exc:
            write_diagnostic(
                f"storage settings load failed error={type(exc).__name__}"
            )
            raw = {}
        return {"dirs": resolve_storage_dirs(raw, DEFAULT_STORAGE_DIRS, BASE_DIR)}

def save_storage_settings(payload):
    # 原有 RLock 只覆盖当前进程；外层文件锁把“读旧值、合并 PATCH、写回”
    # 扩展到多个服务进程，避免不同进程分别基于同一旧快照覆盖彼此字段。
    with interprocess_file_lock(STORAGE_SETTINGS_FILE):
        with STORAGE_SETTINGS_LOCK:
            raw = _read_storage_settings_raw()
            changes = payload or {}
            merged = dict(raw)
            merged.update(changes)
            dirs = resolve_storage_dirs(merged, DEFAULT_STORAGE_DIRS, BASE_DIR)
            for path in dirs.values():
                os.makedirs(path, exist_ok=True)
            write_json_atomic(STORAGE_SETTINGS_FILE, dirs, ensure_ascii=False, indent=2)
            apply_storage_settings(dirs)
            return {"dirs": dirs}

def apply_storage_settings(dirs=None):
    global OUTPUT_INPUT_DIR, OUTPUT_OUTPUT_DIR, LOCAL_UPLOAD_DIR
    with STORAGE_SETTINGS_LOCK:
        dirs = dirs or load_storage_settings().get("dirs") or {}
        OUTPUT_INPUT_DIR = dirs.get("upload") or OUTPUT_INPUT_DIR
        OUTPUT_OUTPUT_DIR = dirs.get("generated") or OUTPUT_OUTPUT_DIR
        LOCAL_UPLOAD_DIR = dirs.get("local") or LOCAL_UPLOAD_DIR

apply_storage_settings()

QUEUE = []
QUEUE_LOCK = Lock()
HISTORY_LOCK = Lock()
GLOBAL_CONFIG_LOCK = Lock()
CONVERSATION_LOCK = Lock()
CANVAS_LOCK = RLock()
LOAD_LOCK = Lock()
RUNNINGHUB_WORKFLOW_LOCK = RLock()
WORKFLOW_STORAGE_LOCK = RLock()
NEXT_TASK_ID = 1
UPDATE_LOCK = Lock()
JIMENG_LOGIN_SESSION = {
    "proc": None,
    "stdout": "",
    "stderr": "",
    "started_at": 0.0,
}

PROVIDER_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{2,40}$")
SUPPORTED_PROVIDER_PROTOCOLS = {"openai", "apimart", "gemini", "gemini-cli", "volcengine", "runninghub", "jimeng", "codex"}
SUPPORTED_IMAGE_REQUEST_MODES = {"openai", "openai-json", "openai-video-proxy", "openai-responses", "tudou-async"}
RUNNINGHUB_DEFAULT_BASE_URL = "https://www.runninghub.ai"
RUNNINGHUB_OPENAPI_BASE_URL = "https://www.runninghub.ai/openapi/v2"
RUNNINGHUB_MODEL_REGISTRY_URL = "https://raw.githubusercontent.com/HM-RunningHub/ComfyUI_RH_OpenAPI/main/models_registry.json"
RUNNINGHUB_LLM_BASE_URL = "https://llm.runninghub.ai/v1"
RUNNINGHUB_FILE_HOST_REWRITES = {
    "rh-images-1252422369.cos.ap-beijing.myqcloud.com": "rh-images.xiaoyaoyou.com",
}
LINGJING_DEFAULT_BASE_URL = "https://apistudio.vip"
RUNNINGHUB_LLM_MODELS_URLS = [
    "https://llm.runninghub.ai/v1/models",
]
RUNNINGHUB_FALLBACK_CHAT_MODELS = [
    "google/gemini-3.1-flash-lite-preview",
    "qwen/qwen3-vl-235b-a22b-instruct",
    "qwen/qwen-plus",
    "openai/gpt-5.1",
]
JIMENG_DEFAULT_IMAGE_MODELS = [
    "5.0Pro",
    "5.0",
    "4.7",
    "4.6",
    "4.5",
    "4.1",
    "4.0",
    "3.1",
    "3.0",
]
JIMENG_DEFAULT_VIDEO_MODELS = [
    "seedance2.0_vip",
    "seedance2.0fast_vip",
    "seedance2.0",
    "seedance2.0fast",
    "seedance2.0mini",
]
CODEX_DEFAULT_IMAGE_MODELS = ["gpt-image-2"]
CODEX_DEFAULT_CHAT_MODELS = ["gpt-5.5"]
GEMINI_CLI_DEFAULT_IMAGE_MODELS = ["auto"]
GEMINI_CLI_DEFAULT_CHAT_MODELS = ["auto"]
try:
    CODEX_DEFAULT_TIMEOUT = max(30, min(3600, int(os.getenv("CODEX_CLI_TIMEOUT", "900"))))
except Exception:
    CODEX_DEFAULT_TIMEOUT = 900
try:
    GEMINI_CLI_DEFAULT_TIMEOUT = max(30, min(3600, int(os.getenv("GEMINI_CLI_TIMEOUT", "900"))))
except Exception:
    GEMINI_CLI_DEFAULT_TIMEOUT = 900
JIMENG_LEGACY_IMAGE_MODELS = {
    "jimeng-image-2k",
    "jimeng-image-4k",
}
JIMENG_LEGACY_VIDEO_MODELS = {
    "jimeng-video-720p",
    "jimeng-video-1080p",
}
try:
    JIMENG_DEFAULT_POLL_SECONDS = max(1, min(3600, int(os.getenv("JIMENG_POLL_SECONDS", "900"))))
except Exception:
    JIMENG_DEFAULT_POLL_SECONDS = 900
VOLCENGINE_DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"
VOLCENGINE_DEFAULT_PROJECT_NAME = "default"
VOLCENGINE_DEFAULT_REGION = "cn-beijing"
RUNNINGHUB_DEFAULT_IMAGE_MODELS = [
    "gpt-image-2.0/text-to-image-channel-low-price",
    "gpt-image-2.0/edit-channel-low-price",
    "gpt-image-2/text-to-image-official-stable",
    "gpt-image-2/image-to-image-official-stable",
    "nano-banana/text-to-image-official-stable",
    "nano-banana/edit-official-stable",
]
RUNNINGHUB_DEFAULT_VIDEO_MODELS = [
    "google/veo3.1-fast/text-to-video-channel-low-price",
    "sora-2/text-to-video-official-stable",
    "seedance-2.0-global/text-to-video",
    "seedance-2.0-global/image-to-video",
]
RUNNINGHUB_MODEL_ENDPOINT_ALIASES = {
    "Seedance2.0 Image to Video": "bytedance/seedance-2.0-global/image-to-video",
    "Seedance2.0 Text to Video": "bytedance/seedance-2.0-global/text-to-video",
    "seedance2.0 image to video": "bytedance/seedance-2.0-global/image-to-video",
    "seedance2.0 text to video": "bytedance/seedance-2.0-global/text-to-video",
    "gpt-image-2.0/text-to-image-channel-low-price": "rhart-image-g-2/text-to-image",
    "gpt-image-2/text-to-image-channel-low-price": "rhart-image-g-2/text-to-image",
    "gpt-image-2.0/edit-channel-low-price": "rhart-image-g-2/image-to-image",
    "gpt-image-2/edit-channel-low-price": "rhart-image-g-2/image-to-image",
    "gpt-image-2.0/image-to-image-channel-low-price": "rhart-image-g-2/image-to-image",
    "gpt-image-2/image-to-image-channel-low-price": "rhart-image-g-2/image-to-image",
    "nano-banana/text-to-image-channel-low-price": "rhart-image-v1/text-to-image",
    "nano-banana/edit-channel-low-price": "rhart-image-v1/edit",
}
RUNNINGHUB_DEFAULT_APPS = [
    {
        "id": "2058517022748798977",
        "appId": "2058517022748798977",
        "title": "2511-风格迁移",
        "note": "",
        "thumbnail": "",
        "enabled": True,
        "fields": [
            {
                "id": "100::image",
                "nodeId": "100",
                "fieldName": "image",
                "fieldValue": "pasted/57ef7dc980b6446bca366caaf3f94eb12b22b23f78aa30e294b39cabd7d0187b.png",
                "fieldType": "IMAGE",
                "label": "image",
                "enabled": True,
                "sourceFromUpstream": True,
                "group": "AI 应用参数",
                "note": "image",
                "options": [],
                "random_enabled": False,
                "min": "",
                "max": "",
                "step": "",
                "imageOrder": 0,
                "required": False,
            },
            {
                "id": "112::image",
                "nodeId": "112",
                "fieldName": "image",
                "fieldValue": "8cff63ee4b3e0285ca85ab90a52e26746df84ed0dec0be9d76c679cbb62a247d.png",
                "fieldType": "IMAGE",
                "label": "image",
                "enabled": True,
                "sourceFromUpstream": True,
                "group": "AI 应用参数",
                "note": "image",
                "options": [],
                "random_enabled": False,
                "min": "",
                "max": "",
                "step": "",
                "imageOrder": 0,
                "required": False,
            },
            {
                "id": "14::seed",
                "nodeId": "14",
                "fieldName": "seed",
                "fieldValue": "3250470112",
                "fieldType": "INT",
                "label": "seed",
                "enabled": True,
                "sourceFromUpstream": True,
                "group": "AI 应用参数",
                "note": "seed",
                "options": [],
                "random_enabled": True,
                "min": "1",
                "max": "4294967295",
                "step": "1",
                "imageOrder": 0,
                "required": False,
            },
        ],
    },
    {
        "id": "1997622492837646338",
        "appId": "1997622492837646338",
        "title": "2511-光线迁移",
        "note": "",
        "thumbnail": "",
        "enabled": True,
    },
]
RUNNINGHUB_DEFAULT_WORKFLOWS = [
    {
        "id": "2058554058318897153",
        "workflowId": "2058554058318897153",
        "title": "GPT-Image-2-图片编辑",
        "note": "",
        "thumbnail": "",
        "enabled": True,
        "optionalImageMode": "prune-workflow",
    },
    {
        "id": "2058541134623891458",
        "workflowId": "2058541134623891458",
        "title": "NanoBanana-2-图片编辑",
        "note": "",
        "thumbnail": "",
        "enabled": True,
        "optionalImageMode": "prune-workflow",
    },
]

def ensure_runtime_config_files():
    """首次运行时提前创建配置目录，避免第一次保存 API Key 时才创建目录/文件。"""
    try:
        local_env.ensure_runtime_files(API_ENV_FILE, DATA_DIR)
    except Exception as e:
        write_diagnostic(
            f"runtime config initialization failed error={type(e).__name__}"
        )

def load_env_file():
    try:
        local_env.load_env_file(API_ENV_FILE, os.environ)
    except Exception as e:
        write_diagnostic(f"runtime env load failed error={type(e).__name__}")
ensure_runtime_config_files()
load_env_file()

COMFYUI_INSTANCES = [s.strip() for s in os.getenv("COMFYUI_INSTANCES", "127.0.0.1:8188").split(",") if s.strip()]
COMFYUI_ADDRESS = COMFYUI_INSTANCES[0]

AI_BASE_URL = os.getenv("COMFLY_BASE_URL", "https://ai.comfly.chat").rstrip("/")
AI_API_KEY = os.getenv("COMFLY_API_KEY", "")
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "").strip().rstrip("/")
PUBLIC_MEDIA_BASE_URL = os.getenv("PUBLIC_MEDIA_BASE_URL", "").strip().rstrip("/")
MODELSCOPE_API_KEY = os.getenv("MODELSCOPE_API_KEY", "")
MODELSCOPE_CHAT_BASE_URL = "https://api-inference.modelscope.cn/v1"
MODELSCOPE_DEFAULT_IMAGE_MODELS = [
    "Tongyi-MAI/Z-Image-Turbo",
    "Qwen/Qwen-Image-2512",
    "Qwen/Qwen-Image-Edit-2511",
    "black-forest-labs/FLUX.2-klein-9B",
]
MODELSCOPE_DEFAULT_CHAT_MODELS = [
    "Qwen/Qwen3-235B-A22B",
    "Qwen/Qwen3-VL-235B-A22B-Instruct",
    "MiniMax/MiniMax-M2.7:MiniMax",
]
_MODELSCOPE_CONFIGURED_CHAT_MODELS = [m.strip() for m in os.getenv("MODELSCOPE_CHAT_MODELS", "").split(",") if m.strip()]
MODELSCOPE_CHAT_MODELS = list(dict.fromkeys([m for m in [*MODELSCOPE_DEFAULT_CHAT_MODELS, *_MODELSCOPE_CONFIGURED_CHAT_MODELS] if m]))
MODELSCOPE_DEFAULT_IMAGE_MODEL = MODELSCOPE_DEFAULT_IMAGE_MODELS[0]
MODELSCOPE_DEFAULT_CHAT_MODEL = "Qwen/Qwen3-235B-A22B"
MODELSCOPE_DEFAULT_LORAS = [
    {
        "id": "Daniel8152/film",
        "name": "Z-Image Film",
        "target_model": "Tongyi-MAI/Z-Image-Turbo",
        "strength": 0.8,
        "enabled": True,
        "note": "",
    },
    {
        "id": "Daniel8152/Qwen-Image-2512-Film",
        "name": "Qwen Image 2512 Film",
        "target_model": "Qwen/Qwen-Image-2512",
        "strength": 0.8,
        "enabled": True,
        "note": "",
    },
    {
        "id": "Daniel8152/Klein-enhance",
        "name": "Klein enhance",
        "target_model": "black-forest-labs/FLUX.2-klein-9B",
        "strength": 0.8,
        "enabled": True,
        "note": "",
    },
]
MODELSCOPE_DEFAULTS_VERSION = 3
CHAT_MODEL = os.getenv("CHAT_MODEL", "gpt-4o-mini")
IMAGE_MODEL = os.getenv("IMAGE_MODEL", "gpt-image-2")
SYSTEM_PROMPT = os.getenv("SYSTEM_PROMPT", "You are a helpful assistant.")
MAX_HISTORY_MESSAGES = int(os.getenv("MAX_HISTORY_MESSAGES", "30"))
AI_REQUEST_TIMEOUT = float(os.getenv("REQUEST_TIMEOUT", "1800"))
IMAGE_POLL_INTERVAL = float(os.getenv("IMAGE_POLL_INTERVAL", "2"))
IMAGE_TASK_TIMEOUT = float(os.getenv("IMAGE_TASK_TIMEOUT", str(AI_REQUEST_TIMEOUT)))
COMFYUI_HISTORY_TIMEOUT = int(float(os.getenv("COMFYUI_HISTORY_TIMEOUT", "1800")))
# 下载 ComfyUI 产物的 socket 超时（秒，作用于连接和每次 read）。没有它时一次网络卡顿会让 urlopen 永久挂起，
# 导致 generate() 不返回、画布卡片一直转圈拿不到结果。给得足够大以容纳大视频/大图的正常下载。
COMFYUI_DOWNLOAD_TIMEOUT = float(os.getenv("COMFYUI_DOWNLOAD_TIMEOUT", "120"))
APIMART_IMAGE_TASK_TIMEOUT = float(os.getenv("APIMART_IMAGE_TASK_TIMEOUT", "1800"))
APIMART_IMAGE_POLL_INTERVAL = float(os.getenv("APIMART_IMAGE_POLL_INTERVAL", "5"))
APIMART_IMAGE_INITIAL_POLL_DELAY = float(os.getenv("APIMART_IMAGE_INITIAL_POLL_DELAY", "10"))
TUDOU_ASYNC_IMAGE_TASK_TIMEOUT = float(os.getenv("TUDOU_ASYNC_IMAGE_TASK_TIMEOUT", "1800"))
TUDOU_ASYNC_IMAGE_POLL_INTERVAL = float(os.getenv("TUDOU_ASYNC_IMAGE_POLL_INTERVAL", "4"))
TUDOU_ASYNC_IMAGE_INITIAL_POLL_DELAY = float(os.getenv("TUDOU_ASYNC_IMAGE_INITIAL_POLL_DELAY", "12"))
VIDEO_POLL_TIMEOUT = float(os.getenv("VIDEO_POLL_TIMEOUT", "1800"))
ONLINE_IMAGE_PROMPT_MAX_LENGTH = int(os.getenv("ONLINE_IMAGE_PROMPT_MAX_LENGTH", "20000"))
VIDEO_PROMPT_MAX_LENGTH = int(os.getenv("VIDEO_PROMPT_MAX_LENGTH", "4000"))
LLM_MESSAGE_MAX_LENGTH = int(os.getenv("LLM_MESSAGE_MAX_LENGTH", "20000"))
CHAT_ATTACHMENT_MAX = int(os.getenv("CHAT_ATTACHMENT_MAX", "20"))
ONLINE_IMAGE_REFERENCE_MAX = int(os.getenv("ONLINE_IMAGE_REFERENCE_MAX", "20"))

FIELD_LABELS = {
    "prompt": "提示词",
    "message": "文本",
    "system_prompt": "系统提示词",
}

def friendly_validation_error(errors):
    parts = []
    for err in errors or []:
        loc = [str(item) for item in err.get("loc", []) if item != "body"]
        field = loc[-1] if loc else ""
        label = FIELD_LABELS.get(field, field or "请求参数")
        ctx = err.get("ctx") or {}
        limit = ctx.get("limit_value") or ctx.get("max_length") or ctx.get("min_length")
        err_type = str(err.get("type") or "")
        msg = str(err.get("msg") or "")
        if "max_length" in err_type or "at most" in msg:
            parts.append(f"{label}过长：当前内容超过后端上限 {limit} 个字符。请拆分为多个提示词节点，或先用 LLM 节点压缩后再生成。")
        elif "min_length" in err_type:
            parts.append(f"{label}不能为空。")
        else:
            parts.append(f"{label}格式不正确：{msg}")
    return "\n".join(parts) or "请求参数不正确。"

@app.exception_handler(RequestValidationError)
async def request_validation_exception_handler(request: Request, exc: RequestValidationError):
    trace_fields = {
        "trace_id": getattr(getattr(request, "state", None), "trace_id", "") or current_trace_id(),
        "request_id": getattr(getattr(request, "state", None), "request_id", "") or current_request_id(),
    }
    return JSONResponse(
        status_code=422,
        content={"detail": friendly_validation_error(exc.errors()), "errors": exc.errors(), **trace_fields},
    )

def model_list(env_name, primary, defaults):
    configured = os.getenv(env_name, "")
    configured_values = [item.strip() for item in configured.split(",") if item.strip()]
    values = configured_values or [primary, *defaults]
    deduped = []
    for value in values:
        if value and value not in deduped:
            deduped.append(value)
    return deduped

def reload_env_globals():
    """保存 API 设置后，将 os.environ 里最新的值同步回模块级全局变量，
    避免保存后需要重启才能生效。"""
    global MODELSCOPE_API_KEY, AI_API_KEY, AI_BASE_URL
    global IMAGE_MODELS, CHAT_MODELS, VIDEO_MODELS, MODELSCOPE_CHAT_MODELS
    MODELSCOPE_API_KEY = os.getenv("MODELSCOPE_API_KEY", "")
    AI_API_KEY = os.getenv("COMFLY_API_KEY", "")
    AI_BASE_URL = os.getenv("COMFLY_BASE_URL", "https://ai.comfly.chat").rstrip("/")
    IMAGE_MODELS = model_list("IMAGE_MODELS", os.getenv("IMAGE_MODEL", IMAGE_MODEL), ["nano-banana-pro"])
    CHAT_MODELS = model_list("CHAT_MODELS", os.getenv("CHAT_MODEL", CHAT_MODEL), ["gpt-4o-mini", "gemini-3.1-flash-image-preview-2k"])
    VIDEO_MODELS = model_list("VIDEO_MODELS", "veo3-fast", [
        "veo2", "veo2-fast", "veo2-pro",
        "veo3", "veo3-fast", "veo3-pro",
        "veo3.1", "veo3.1-fast", "veo3.1-quality", "veo3.1-lite",
        "sora-2", "sora-2-pro",
        "wan2.6-t2v", "wan2.6-i2v",
        "wan2.5-t2v-preview", "wan2.5-i2v-preview",
        "wan2.2-t2v-plus", "wan2.2-i2v-plus", "wan2.2-i2v-flash",
        "doubao-seedance-2-0-260128",
        "doubao-seedance-2-0-fast-260128",
        "doubao-seedance-1-5-pro-251215",
        "doubao-seedance-1-0-pro-250528",
        "doubao-seedance-1-0-lite-t2v-250428",
        "doubao-seedance-1-0-lite-i2v-250428",
    ])
    _configured = [m.strip() for m in os.getenv("MODELSCOPE_CHAT_MODELS", "").split(",") if m.strip()]
    MODELSCOPE_CHAT_MODELS = list(dict.fromkeys([m for m in [*MODELSCOPE_DEFAULT_CHAT_MODELS, *_configured] if m]))

CHAT_MODELS = model_list("CHAT_MODELS", CHAT_MODEL, ["gpt-4o-mini", "gemini-3.1-flash-image-preview-2k"])
IMAGE_MODELS = model_list("IMAGE_MODELS", IMAGE_MODEL, ["nano-banana-pro"])
VIDEO_MODELS = model_list("VIDEO_MODELS", "veo3-fast", [
    # —— Veo 系列 ——
    "veo2", "veo2-fast", "veo2-pro",
    "veo3", "veo3-fast", "veo3-pro",
    "veo3.1", "veo3.1-fast", "veo3.1-quality", "veo3.1-lite",
    # —— Sora ——
    "sora-2", "sora-2-pro",
    # —— 阿里 通义万相 ——
    "wan2.6-t2v", "wan2.6-i2v",
    "wan2.5-t2v-preview", "wan2.5-i2v-preview",
    "wan2.2-t2v-plus", "wan2.2-i2v-plus", "wan2.2-i2v-flash",
    # —— 火山 豆包 Seedance ——
    "doubao-seedance-2-0-260128",
    "doubao-seedance-2-0-fast-260128",
    "doubao-seedance-1-5-pro-251215",
    "doubao-seedance-1-0-pro-250528",
    "doubao-seedance-1-0-lite-t2v-250428",
    "doubao-seedance-1-0-lite-i2v-250428",
])

def provider_key_env(provider_id):
    if provider_id == "comfly":
        return "COMFLY_API_KEY"
    if provider_id == "modelscope":
        return "MODELSCOPE_API_KEY"
    if provider_id == "runninghub":
        return "RUNNINGHUB_API_KEY"
    if provider_id == "volcengine":
        return "ARK_API_KEY"
    return f"API_PROVIDER_{re.sub(r'[^A-Za-z0-9]', '_', provider_id).upper()}_KEY"

def runninghub_wallet_key_env():
    return "RUNNINGHUB_WALLET_API_KEY"

def volcengine_access_key_env():
    return "VOLCENGINE_ACCESS_KEY_ID"

def volcengine_secret_key_env():
    return "VOLCENGINE_SECRET_ACCESS_KEY"

def volcengine_voice_api_key_env():
    """豆包语音独立 API Key，不与方舟 API Key 共用。"""
    return "VOLCENGINE_DOUBAO_VOICE_API_KEY"

def read_api_env_value(key: str) -> str:
    return local_env.read_env_value(API_ENV_FILE, key)

def provider_env_key_value(provider_id: str) -> str:
    provider_id = str(provider_id or "").strip().lower()
    env_key = provider_key_env(provider_id)
    key = os.getenv(env_key, "") or read_api_env_value(env_key)
    if key:
        return key
    if provider_id == "modelscope":
        return MODELSCOPE_API_KEY or ""
    return ""

def runninghub_wallet_key_value() -> str:
    env_key = runninghub_wallet_key_env()
    return os.getenv(env_key, "") or read_api_env_value(env_key)

def volcengine_access_key_value() -> str:
    env_key = volcengine_access_key_env()
    return os.getenv(env_key, "") or read_api_env_value(env_key)

def volcengine_secret_key_value() -> str:
    env_key = volcengine_secret_key_env()
    return os.getenv(env_key, "") or read_api_env_value(env_key)

def volcengine_voice_api_key_value() -> str:
    env_key = volcengine_voice_api_key_env()
    return os.getenv(env_key, "") or read_api_env_value(env_key)

def volcengine_provider_api_key(explicit_key: str = "") -> str:
    explicit_key = str(explicit_key or "").strip()
    if explicit_key:
        return explicit_key
    return provider_env_key_value("volcengine")

def mask_secret(value):
    if not value:
        return ""
    tail = value[-4:] if len(value) > 4 else value
    return f"••••••••{tail}"

def strip_auth_scheme(value, scheme="Bearer"):
    text = str(value or "").strip()
    if not text:
        return ""
    pattern = rf"^{re.escape(scheme)}\s+"
    return re.sub(pattern, "", text, flags=re.I).strip()

def bearer_auth_value(value):
    token = strip_auth_scheme(value, "Bearer")
    return f"Bearer {token}" if token else ""

def default_api_providers():
    # 独立入口平台强制保留，其他平台均可自定义增删
    return provider_registry_service.default_api_providers(MODELSCOPE_CHAT_BASE_URL=MODELSCOPE_CHAT_BASE_URL, MODELSCOPE_CHAT_MODELS=MODELSCOPE_CHAT_MODELS, MODELSCOPE_DEFAULTS_VERSION=MODELSCOPE_DEFAULTS_VERSION, MODELSCOPE_DEFAULT_IMAGE_MODELS=MODELSCOPE_DEFAULT_IMAGE_MODELS, MODELSCOPE_DEFAULT_LORAS=MODELSCOPE_DEFAULT_LORAS, RUNNINGHUB_DEFAULT_APPS=RUNNINGHUB_DEFAULT_APPS, RUNNINGHUB_DEFAULT_BASE_URL=RUNNINGHUB_DEFAULT_BASE_URL, RUNNINGHUB_DEFAULT_WORKFLOWS=RUNNINGHUB_DEFAULT_WORKFLOWS, VOLCENGINE_DEFAULT_BASE_URL=VOLCENGINE_DEFAULT_BASE_URL, VOLCENGINE_DEFAULT_PROJECT_NAME=VOLCENGINE_DEFAULT_PROJECT_NAME, VOLCENGINE_DEFAULT_REGION=VOLCENGINE_DEFAULT_REGION)

def merge_default_api_providers(providers, inject_missing=True):
    return provider_registry_service.merge_default_api_providers(providers, inject_missing, CODEX_DEFAULT_CHAT_MODELS=CODEX_DEFAULT_CHAT_MODELS, CODEX_DEFAULT_IMAGE_MODELS=CODEX_DEFAULT_IMAGE_MODELS, GEMINI_CLI_DEFAULT_CHAT_MODELS=GEMINI_CLI_DEFAULT_CHAT_MODELS, GEMINI_CLI_DEFAULT_IMAGE_MODELS=GEMINI_CLI_DEFAULT_IMAGE_MODELS, JIMENG_DEFAULT_IMAGE_MODELS=JIMENG_DEFAULT_IMAGE_MODELS, JIMENG_DEFAULT_VIDEO_MODELS=JIMENG_DEFAULT_VIDEO_MODELS, JIMENG_LEGACY_IMAGE_MODELS=JIMENG_LEGACY_IMAGE_MODELS, JIMENG_LEGACY_VIDEO_MODELS=JIMENG_LEGACY_VIDEO_MODELS, MODELSCOPE_DEFAULTS_VERSION=MODELSCOPE_DEFAULTS_VERSION, MODELSCOPE_DEFAULT_CHAT_MODELS=MODELSCOPE_DEFAULT_CHAT_MODELS, MODELSCOPE_DEFAULT_IMAGE_MODELS=MODELSCOPE_DEFAULT_IMAGE_MODELS, MODELSCOPE_DEFAULT_LORAS=MODELSCOPE_DEFAULT_LORAS, VOLCENGINE_DEFAULT_PROJECT_NAME=VOLCENGINE_DEFAULT_PROJECT_NAME, VOLCENGINE_DEFAULT_REGION=VOLCENGINE_DEFAULT_REGION, default_api_providers=default_api_providers, is_jimeng_provider=is_jimeng_provider, load_static_runninghub_provider=load_static_runninghub_provider, merge_runninghub_system_entries=merge_runninghub_system_entries, model_list_from_values=model_list_from_values, normalize_ms_loras=normalize_ms_loras)

def normalize_ms_loras(values):
    return provider_registry_service.normalize_ms_loras(values)

def normalize_runninghub_entry(raw, kind):
    return provider_registry_service.normalize_runninghub_entry(raw, kind, runninghub_normalize_field=runninghub_normalize_field, runninghub_workflow_json_from_config=runninghub_workflow_json_from_config)

def runninghub_workflow_json_from_config(config):
    return runninghub_config_service.runninghub_workflow_json_from_config(config)

def runninghub_workflow_without_raw(config):
    return runninghub_config_service.runninghub_workflow_without_raw(config, runninghub_workflow_json_from_config=runninghub_workflow_json_from_config)

def normalize_runninghub_entries(values, kind):
    return provider_registry_service.normalize_runninghub_entries(values, kind, normalize_runninghub_entry=normalize_runninghub_entry)

def runninghub_entry_id(entry, kind):
    return provider_registry_service.runninghub_entry_id(entry, kind)

def static_runninghub_thumbnail_url(entry_id, kind):
    return provider_registry_service.static_runninghub_thumbnail_url(entry_id, kind, RUNNINGHUB_THUMBNAIL_EXTS=RUNNINGHUB_THUMBNAIL_EXTS, STATIC_DIR=STATIC_DIR, STATIC_RUNNINGHUB_DIR=STATIC_RUNNINGHUB_DIR, STATIC_RUNNINGHUB_THUMBNAIL_DIR=STATIC_RUNNINGHUB_THUMBNAIL_DIR)

def apply_runninghub_system_thumbnails(entries, kind):
    return provider_registry_service.apply_runninghub_system_thumbnails(entries, kind, normalize_runninghub_entries=normalize_runninghub_entries, runninghub_entry_id=runninghub_entry_id, static_runninghub_thumbnail_url=static_runninghub_thumbnail_url)

def merge_runninghub_entry_overlay(system_entry, user_entry):
    # 系统模板只提供默认值；同 ID 的用户配置优先，允许用户修改/隐藏内置模板。
    return provider_registry_service.merge_runninghub_entry_overlay(system_entry, user_entry)

def merge_runninghub_system_entries(system_entries, user_entries, kind):
    return provider_registry_service.merge_runninghub_system_entries(system_entries, user_entries, kind, apply_runninghub_system_thumbnails=apply_runninghub_system_thumbnails, merge_runninghub_entry_overlay=merge_runninghub_entry_overlay, runninghub_entry_id=runninghub_entry_id)

def load_static_runninghub_provider():
    return provider_registry_service.load_static_runninghub_provider(STATIC_RUNNINGHUB_API_PROVIDERS_FILE=STATIC_RUNNINGHUB_API_PROVIDERS_FILE, apply_runninghub_system_thumbnails=apply_runninghub_system_thumbnails, normalize_provider=normalize_provider, write_diagnostic=write_diagnostic)

def merge_runninghub_provider_with_static(provider):
    return provider_registry_service.merge_runninghub_provider_with_static(provider, load_static_runninghub_provider=load_static_runninghub_provider, merge_runninghub_system_entries=merge_runninghub_system_entries, model_list_from_values=model_list_from_values, normalize_provider=normalize_provider)

def preserve_runninghub_hidden_overrides(provider):
    return provider_registry_service.preserve_runninghub_hidden_overrides(provider, load_static_runninghub_provider=load_static_runninghub_provider, normalize_runninghub_entries=normalize_runninghub_entries, normalize_runninghub_entry=normalize_runninghub_entry, runninghub_entry_id=runninghub_entry_id)

def normalize_endpoint_override(value, label):
    return provider_registry_service.normalize_endpoint_override(value, label, HTTPException=HTTPException)

def normalize_image_request_mode(value):
    return provider_registry_service.normalize_image_request_mode(value, SUPPORTED_IMAGE_REQUEST_MODES=SUPPORTED_IMAGE_REQUEST_MODES)

LOCKED_RECOMMENDED_PROVIDER_RULES = {
    "exellome": {
        "names": {"exellome"},
        "base_urls": {"https://new.exellome.online"},
        "protocol": "apimart",
        "image_request_mode": "openai-video-proxy",
        "video_models": [],
    },
    "fhl": {
        "names": {"fhl"},
        "base_urls": {"https://www.fhl.mom"},
        "protocol": "openai",
        "image_request_mode": "openai",
        "video_models": [],
    },
}

def is_tudou_base_url(base_url=""):
    return provider_registry_service.is_tudou_base_url(base_url)

def locked_recommended_provider_rule(provider_id="", name="", base_url=""):
    return provider_registry_service.locked_recommended_provider_rule(provider_id, name, base_url, LOCKED_RECOMMENDED_PROVIDER_RULES=LOCKED_RECOMMENDED_PROVIDER_RULES)

def apply_locked_recommended_model_rules(base_url="", grouped=None):
    return provider_registry_service.apply_locked_recommended_model_rules(base_url, grouped, locked_recommended_provider_rule=locked_recommended_provider_rule)

def provider_endpoint_url(provider, key, default_path):
    return provider_registry_service.provider_endpoint_url(provider, key, default_path, AI_BASE_URL=AI_BASE_URL)

def runninghub_endpoint_url(provider, path):
    return provider_registry_service.runninghub_endpoint_url(provider, path, RUNNINGHUB_DEFAULT_BASE_URL=RUNNINGHUB_DEFAULT_BASE_URL)

def runninghub_openapi_base_url(provider=None):
    return provider_registry_service.runninghub_openapi_base_url(provider, RUNNINGHUB_DEFAULT_BASE_URL=RUNNINGHUB_DEFAULT_BASE_URL)

def runninghub_openapi_url(provider, path=""):
    return provider_registry_service.runninghub_openapi_url(provider, path, runninghub_openapi_base_url=runninghub_openapi_base_url)

def normalize_provider(item):
    return provider_registry_service.normalize_provider(item, HTTPException=HTTPException, PROVIDER_ID_RE=PROVIDER_ID_RE, RUNNINGHUB_DEFAULT_BASE_URL=RUNNINGHUB_DEFAULT_BASE_URL, SUPPORTED_PROVIDER_PROTOCOLS=SUPPORTED_PROVIDER_PROTOCOLS, VOLCENGINE_DEFAULT_BASE_URL=VOLCENGINE_DEFAULT_BASE_URL, VOLCENGINE_DEFAULT_PROJECT_NAME=VOLCENGINE_DEFAULT_PROJECT_NAME, VOLCENGINE_DEFAULT_REGION=VOLCENGINE_DEFAULT_REGION, detect_image_request_mode=detect_image_request_mode, locked_recommended_provider_rule=locked_recommended_provider_rule, model_list_from_values=model_list_from_values, normalize_endpoint_override=normalize_endpoint_override, normalize_image_request_mode=normalize_image_request_mode, normalize_model_name_map=normalize_model_name_map, normalize_model_protocols=normalize_model_protocols, normalize_ms_loras=normalize_ms_loras, normalize_runninghub_entries=normalize_runninghub_entries)

def load_api_providers():
    return provider_registry_service.load_api_providers(API_PROVIDERS_FILE=API_PROVIDERS_FILE, default_api_providers=default_api_providers, merge_default_api_providers=merge_default_api_providers, normalize_provider=normalize_provider, write_diagnostic=write_diagnostic)

def save_api_providers(providers):
    return provider_registry_service.save_api_providers(providers, API_PROVIDERS_FILE=API_PROVIDERS_FILE, DATA_DIR=DATA_DIR, GLOBAL_CONFIG_LOCK=GLOBAL_CONFIG_LOCK, HTTPException=HTTPException, write_json_atomic=write_json_atomic)

def default_runninghub_static_provider():
    return provider_registry_service.default_runninghub_static_provider(RUNNINGHUB_DEFAULT_BASE_URL=RUNNINGHUB_DEFAULT_BASE_URL)

def mutate_static_runninghub_provider(mutator):
    return provider_registry_service.mutate_static_runninghub_provider(mutator, STATIC_RUNNINGHUB_API_PROVIDERS_FILE=STATIC_RUNNINGHUB_API_PROVIDERS_FILE, STATIC_RUNNINGHUB_DIR=STATIC_RUNNINGHUB_DIR, default_runninghub_static_provider=default_runninghub_static_provider, write_diagnostic=write_diagnostic, write_json_atomic=write_json_atomic)

def sync_runninghub_provider_workflows_to_static_template(provider):
    return provider_registry_service.sync_runninghub_provider_workflows_to_static_template(provider, RUNNINGHUB_DEFAULT_BASE_URL=RUNNINGHUB_DEFAULT_BASE_URL, mutate_static_runninghub_provider=mutate_static_runninghub_provider, normalize_runninghub_entries=normalize_runninghub_entries, runninghub_workflow_store_key=runninghub_workflow_store_key)

def public_provider(provider):
    return provider_registry_service.public_provider(provider, VOLCENGINE_DEFAULT_PROJECT_NAME=VOLCENGINE_DEFAULT_PROJECT_NAME, VOLCENGINE_DEFAULT_REGION=VOLCENGINE_DEFAULT_REGION, mask_secret=mask_secret, normalize_runninghub_entries=normalize_runninghub_entries, provider_env_key_value=provider_env_key_value, provider_key_env=provider_key_env, runninghub_provider_with_workflow_store=runninghub_provider_with_workflow_store, runninghub_wallet_key_env=runninghub_wallet_key_env, runninghub_wallet_key_value=runninghub_wallet_key_value, volcengine_access_key_env=volcengine_access_key_env, volcengine_access_key_value=volcengine_access_key_value, volcengine_secret_key_env=volcengine_secret_key_env, volcengine_secret_key_value=volcengine_secret_key_value, volcengine_voice_api_key_env=volcengine_voice_api_key_env, volcengine_voice_api_key_value=volcengine_voice_api_key_value)

def public_api_providers():
    return provider_registry_service.public_api_providers(load_api_providers=load_api_providers, public_provider=public_provider)

def get_primary_provider_id(providers=None):
    return provider_registry_service.get_primary_provider_id(providers, load_api_providers=load_api_providers)

def get_api_provider(provider_id="comfly"):
    return provider_registry_service.get_api_provider(provider_id, HTTPException=HTTPException, get_primary_provider_id=get_primary_provider_id, load_api_providers=load_api_providers)

def get_api_provider_exact(provider_id: str):
    return provider_registry_service.get_api_provider_exact(provider_id, HTTPException=HTTPException, load_api_providers=load_api_providers)

def modelscope_provider_config():
    return provider_registry_service.modelscope_provider_config(get_api_provider_exact=get_api_provider_exact)


def read_legacy_modelscope_token() -> str:
    """读取旧版 global_config.json 中的 Token，失败时返回空字符串。"""

    try:
        with open(GLOBAL_CONFIG_FILE, "r", encoding="utf-8") as config_file:
            config = json.load(config_file)
    except FileNotFoundError:
        return ""
    except (json.JSONDecodeError, UnicodeError) as exc:
        write_diagnostic(
            f"[CONFIG-TOKEN] {format_context()} legacy_config_invalid error={type(exc).__name__}",
            level=logging.WARNING,
        )
        return ""
    except OSError as exc:
        write_diagnostic(
            f"[CONFIG-TOKEN] {format_context()} legacy_config_read_failed error={type(exc).__name__}",
            level=logging.WARNING,
        )
        return ""
    if not isinstance(config, dict) or not isinstance(config.get("modelscope_token", ""), str):
        write_diagnostic(
            f"[CONFIG-TOKEN] {format_context()} legacy_config_invalid error=InvalidSchema",
            level=logging.WARNING,
        )
        return ""
    return config.get("modelscope_token", "")


def modelscope_api_key(explicit_key: str = ""):
    return (
        strip_auth_scheme(explicit_key, "Bearer")
        or strip_auth_scheme(provider_env_key_value("modelscope"), "Bearer")
        or strip_auth_scheme(MODELSCOPE_API_KEY, "Bearer")
        or strip_auth_scheme(read_legacy_modelscope_token(), "Bearer")
    )

def modelscope_api_root(provider=None):
    return provider_registry_service.modelscope_api_root(provider, MODELSCOPE_CHAT_BASE_URL=MODELSCOPE_CHAT_BASE_URL, modelscope_provider_config=modelscope_provider_config)

def modelscope_image_api_root():
    return provider_registry_service.modelscope_image_api_root(MODELSCOPE_CHAT_BASE_URL=MODELSCOPE_CHAT_BASE_URL)

def update_env_values(updates):
    local_env.update_env_values(API_ENV_FILE, updates, os.environ)

BACKEND_LOCAL_LOAD = {addr: 0 for addr in COMFYUI_INSTANCES}

os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(ASSETS_DIR, exist_ok=True)
os.makedirs(OUTPUT_INPUT_DIR, exist_ok=True)
os.makedirs(OUTPUT_OUTPUT_DIR, exist_ok=True)
os.makedirs(ASSET_LIBRARY_DIR, exist_ok=True)
os.makedirs(LOCAL_UPLOAD_DIR, exist_ok=True)
os.makedirs(STATIC_DIR, exist_ok=True)
os.makedirs(WORKFLOW_DIR, exist_ok=True)
os.makedirs(CONVERSATION_DIR, exist_ok=True)
os.makedirs(CANVAS_DIR, exist_ok=True)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/output", StaticFiles(directory=OUTPUT_DIR), name="output")
app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")

# --- Pydantic 模型 ---

def current_app_version():
    version_file = os.path.join(BASE_DIR, "VERSION")
    try:
        if os.path.exists(version_file):
            with open(version_file, "r", encoding="utf-8") as f:
                version = (f.read().strip().splitlines() or [""])[0].strip()
                if version:
                    return version
    except Exception:
        pass
    try:
        return time.strftime("%Y.%m.%d", time.localtime())
    except Exception:
        return ""

def update_notes_path() -> str:
    return update_release_service.update_notes_path(STATIC_DIR=STATIC_DIR, os=os)

def safe_update_notes(payload: Any, version: str = "") -> Dict[str, Any]:
    return update_release_service.safe_update_notes(payload, version)

def read_local_update_notes(version: str = "") -> Dict[str, Any]:
    return update_release_service.read_local_update_notes(version, current_app_version=current_app_version, json=json, os=os, safe_update_notes=safe_update_notes, update_notes_path=update_notes_path)

def fetch_remote_update_notes(url: str, version: str = "", timeout: float = 5.0) -> Dict[str, Any]:
    return update_release_service.fetch_remote_update_notes(url, version, timeout, Any=Any, Dict=Dict, json=json, requests=requests, safe_update_notes=safe_update_notes, time=time, urllib=urllib, write_diagnostic=write_diagnostic)

def versioned_static_html(html: str) -> str:
    return static_page_service.versioned_static_html(html, current_app_version=current_app_version, urllib=urllib, re=re, os=os, STATIC_DIR=STATIC_DIR)

def sync_static_html_versions():
    return static_page_service.sync_static_html_versions(current_app_version=current_app_version, urllib=urllib, os=os, re=re, STATIC_DIR=STATIC_DIR, versioned_static_html=versioned_static_html, write_text_atomic=write_text_atomic, write_diagnostic=write_diagnostic)

def static_html_response(filename: str):
    return static_page_service.static_html_response(filename, os=os, STATIC_DIR=STATIC_DIR, versioned_static_html=versioned_static_html, Response=Response)

STATIC_PROMPT_TEMPLATE_MD = os.path.join(STATIC_DIR, "system-prompts", "infinite-canvas-prompt-templates.md")
PROMPT_TEMPLATE_PATHS = [STATIC_PROMPT_TEMPLATE_MD]
PROMPT_TEMPLATE_EN = {
    "多机位九宫格": {
        "name": "9-Angle Multi-Camera Grid",
        "scene": "Show the same subject or scene from 9 camera angles for character turnarounds, product views, or space scouting.",
    },
    "多机位九宫格4K": {
        "name": "9-Angle Multi-Camera Grid 4K",
        "scene": "A high-resolution 9-angle reference sheet for print-grade output, large displays, and fine material study.",
    },
    "剧情推演四宫格": {
        "name": "4-Panel Story Progression",
        "scene": "Preview four consecutive story beats or emotional stages for storyboard planning and narrative rhythm tests.",
    },
    "角色脸部三视图": {
        "name": "Character Face 3-View Sheet",
        "scene": "Front, side, and three-quarter face references for Actor ID locking and expression consistency.",
    },
    "产品三视图": {
        "name": "Product 3-View Sheet",
        "scene": "Front, side, and top product views for industrial design, ecommerce detail pages, and technical documents.",
    },
    "25宫格连贯分镜": {
        "name": "25-Panel Continuous Storyboard",
        "scene": "A full 5x5 storyboard for continuous scene or action flow, useful for film previews and motion continuity tests.",
    },
    "电影级光影校正": {
        "name": "Cinematic Lighting Comparison",
        "scene": "Compare the same subject or scene under different lighting conditions for mood, color, and lighting choices.",
    },
    "角色设定参考表（胸口特写+全身三视图）": {
        "name": "Character Reference Sheet: Portrait + Full-Body Views",
        "scene": "A consistency reference combining a face anchor and full-body front, side, and back views for Actor ID and costume lock.",
    },
    "6种基础表情胸像（2×3六宫格）": {
        "name": "6 Basic Expression Busts",
        "scene": "Six basic expressions of the same character for expression consistency, emotion baselines, and Seedance Talk-to-Edit reference.",
    },
    "360全景图": {
        "name": "360 Panorama VR Image",
        "scene": "Generate a seamless 360-degree VR panorama with continuous left and right edges and natural pole transitions.",
    },
}

def prompt_template_markdown_path() -> str:
    return prompt_library_service.prompt_template_markdown_path(PROMPT_TEMPLATE_PATHS=PROMPT_TEMPLATE_PATHS)

def parse_prompt_template_markdown(text: str):
    """兼容旧入口，把翻译映射显式传给独立解析规则模块。"""

    return _parse_prompt_template_markdown(text, PROMPT_TEMPLATE_EN)

@app.get("/api/app-info")
def app_info():
    return update_release_service.app_info(GITHUB_REPO_URL=GITHUB_REPO_URL, GITHUB_TREE_URL=GITHUB_TREE_URL, GITHUB_UPDATE_NOTES_URL=GITHUB_UPDATE_NOTES_URL, GITHUB_VERSION_URL=GITHUB_VERSION_URL, current_app_version=current_app_version, read_local_update_notes=read_local_update_notes)

def connectivity_probe(name: str, url: str, timeout: float = 5.0) -> Dict[str, Any]:
    return update_release_service.connectivity_probe(name, url, timeout, requests=requests, time=time, urllib=urllib, write_diagnostic=write_diagnostic)

def update_connectivity_targets() -> List[Tuple[str, str, str, bool]]:
    return update_release_service.update_connectivity_targets(GITHUB_TREE_URL=GITHUB_TREE_URL, GITHUB_VERSION_URL=GITHUB_VERSION_URL)

@app.get("/api/update-connectivity/probe")
def update_connectivity_probe(name: str):
    return update_release_service.update_connectivity_probe(name, HTTPException=HTTPException, connectivity_probe=connectivity_probe, update_connectivity_targets=update_connectivity_targets)

@app.get("/api/update-connectivity")
def update_connectivity():
    return update_release_service.update_connectivity(connectivity_probe=connectivity_probe, update_connectivity_targets=update_connectivity_targets)

def fetch_remote_version(url: str, timeout: float = 5.0) -> Dict[str, Any]:
    return update_release_service.fetch_remote_version(url, timeout, Any=Any, Dict=Dict, re=re, requests=requests, time=time, urllib=urllib, write_diagnostic=write_diagnostic)

@app.get("/api/check-update")
def check_update():
    return update_release_service.check_update(Any=Any, Dict=Dict, GITHUB_UPDATE_NOTES_URL=GITHUB_UPDATE_NOTES_URL, GITHUB_VERSION_URL=GITHUB_VERSION_URL, current_app_version=current_app_version, fetch_remote_update_notes=fetch_remote_update_notes, fetch_remote_version=fetch_remote_version, version_gt=version_gt)

def update_allowed_file(path: str) -> bool:
    return update_staging_service.update_allowed_file(path)

def github_get(url: str, headers: Optional[Dict[str, str]] = None, timeout: int = 30) -> requests.Response:
    return update_release_service.github_get(url, headers, timeout, requests=requests, urllib=urllib, write_diagnostic=write_diagnostic)

def github_json(url: str):
    return update_release_service.github_json(url, github_get=github_get, json=json)

def github_bytes(url: str) -> bytes:
    return update_release_service.github_bytes(url, github_get=github_get)

def download_github_update_files(files: List[str], staging_root: str, commit_sha: str) -> None:
    return update_staging_service.download_github_update_files(files, staging_root, commit_sha, GITHUB_RAW_ROOT=GITHUB_RAW_ROOT, github_bytes=github_bytes, os=os, safe_update_target=safe_update_target, urllib=urllib)

def safe_update_target(path: str) -> str:
    return update_staging_service.safe_update_target(path, BASE_DIR=BASE_DIR, os=os, update_allowed_file=update_allowed_file)

def safe_static_dir() -> str:
    return update_staging_service.safe_static_dir(BASE_DIR=BASE_DIR, STATIC_DIR=STATIC_DIR, os=os)

def schedule_self_restart(delay_seconds: int = 3) -> bool:
    return application_restart_service.schedule_self_restart(delay_seconds, BASE_DIR=BASE_DIR, logging=logging, os=os, subprocess=subprocess)

class UpdateRequest(BaseModel):
    auto_restart: bool = False
    restart_delay: int = 3

def github_update_file_list() -> Tuple[List[str], List[str], List[str], str]:
    return update_staging_service.github_update_file_list(GITHUB_COMMIT_URL=GITHUB_COMMIT_URL, GITHUB_REPO_SLUG=GITHUB_REPO_SLUG, github_json=github_json, re=re, update_allowed_file=update_allowed_file)

def staged_update_file_list(staging_root: str) -> Tuple[List[str], List[str], List[str]]:
    return update_staging_service.staged_update_file_list(staging_root, os=os, update_allowed_file=update_allowed_file)

def stage_update_from_github(staging_root: str) -> Tuple[List[str], List[str], List[str]]:
    return update_staging_service.stage_update_from_github(staging_root, download_github_update_files=download_github_update_files, github_update_file_list=github_update_file_list)

def validate_staged_update(staging_root: str, root_files: List[str], static_files: List[str]) -> None:
    return update_staging_service.validate_staged_update(staging_root, root_files, static_files, current_app_version=current_app_version, os=os, safe_update_target=safe_update_target, version_gt=version_gt)

UPDATE_BACKUP_MANIFEST = "manifest.json"
UPDATE_BACKUP_FORMAT = 2
UPDATE_BACKUP_RETENTION = 10

def update_backup_root() -> str:
    return update_backup_service.update_backup_root(DATA_DIR=DATA_DIR, os=os)

def next_update_backup_dir(prefix: str = "") -> str:
    return update_backup_service.next_update_backup_dir(prefix, os=os, time=time, update_backup_root=update_backup_root)

def update_backup_manifest_path(backup_dir: str) -> str:
    return update_backup_service.update_backup_manifest_path(backup_dir, UPDATE_BACKUP_MANIFEST=UPDATE_BACKUP_MANIFEST, os=os)

def read_update_backup_manifest(backup_dir: str) -> Dict[str, Any]:
    return update_backup_service.read_update_backup_manifest(backup_dir, json=json, update_backup_manifest_path=update_backup_manifest_path)

def write_update_backup_manifest(backup_dir: str, payload: Dict[str, Any]) -> None:
    return update_backup_service.write_update_backup_manifest(backup_dir, payload, update_backup_manifest_path=update_backup_manifest_path, write_json_atomic=write_json_atomic)

def count_regular_files(path: str) -> int:
    return update_backup_service.count_regular_files(path, os=os)

def prune_update_backups(keep_names: Optional[set] = None) -> List[str]:
    return update_backup_service.prune_update_backups(keep_names, List=List, UPDATE_BACKUP_RETENTION=UPDATE_BACKUP_RETENTION, list_update_backups=list_update_backups, os=os, shutil=shutil, update_backup_root=update_backup_root, write_diagnostic=write_diagnostic)

def create_update_backup(
    backup_dir: str,
    root_files: List[str],
    static_files: List[str],
    *,
    kind: str,
    source: str = "",
    target_version: str = "",
    parent_backup: str = "",
    update_notes: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    return update_backup_service.create_update_backup(backup_dir, root_files, static_files, kind=kind, source=source, target_version=target_version, parent_backup=parent_backup, update_notes=update_notes, Any=Any, Dict=Dict, UPDATE_BACKUP_FORMAT=UPDATE_BACKUP_FORMAT, count_regular_files=count_regular_files, current_app_version=current_app_version, os=os, safe_static_dir=safe_static_dir, safe_update_notes=safe_update_notes, safe_update_target=safe_update_target, shutil=shutil, time=time, update_allowed_file=update_allowed_file, update_backup_root=update_backup_root, write_update_backup_manifest=write_update_backup_manifest)

@app.post("/api/update-from-github")
def update_from_github(req: UpdateRequest = UpdateRequest()):
    return update_staging_service.update_from_github(req, Any=Any, DATA_DIR=DATA_DIR, Dict=Dict, HTTPException=HTTPException, UPDATE_LOCK=UPDATE_LOCK, create_update_backup=create_update_backup, json=json, next_update_backup_dir=next_update_backup_dir, os=os, prune_update_backups=prune_update_backups, safe_static_dir=safe_static_dir, safe_update_notes=safe_update_notes, safe_update_target=safe_update_target, schedule_self_restart=schedule_self_restart, shutil=shutil, stage_update_from_github=stage_update_from_github, time=time, validate_staged_update=validate_staged_update, write_diagnostic=write_diagnostic)


# The full-release updater is installed by one final in-app bridge release. The
# helper runs outside Python so Windows can replace the bundled interpreter.
FULL_UPDATE_MAX_BYTES = 1024 * 1024 * 1024
FULL_UPDATE_MAX_FILES = 10000
FULL_UPDATE_PUBLIC_DIRS = {".github", "API", "CLI", "backend", "docs", "packages", "python", "static", "tests", "tools", "workflows"}
FULL_UPDATE_PUBLIC_ROOTS = {
    ".gitignore", "LICENSE", "README.md", "VERSION", "requirements.lock", "requirements.txt",
    "main.py", "get-pip.py", "run.bat", "安装依赖.bat", "mac-安装依赖.sh",
    "mac-启动服务.sh", "mac-启动服务.command", "mac-修复权限.command",
    "安装即梦CLI.bat", "安装即梦CLI.command", "登录即梦CLI.bat", "登录即梦CLI.command",
    "备份恢复说明.md", "MAC-使用说明.md", "新手运行与使用教程.md", "运行说明.txt",
}


def full_update_path(value: str) -> str:
    return full_update_service.full_update_path(value, FULL_UPDATE_PUBLIC_DIRS=FULL_UPDATE_PUBLIC_DIRS, FULL_UPDATE_PUBLIC_ROOTS=FULL_UPDATE_PUBLIC_ROOTS, re=re)


def full_update_status_path(job_id: str) -> str:
    return full_update_service.full_update_status_path(job_id, DATA_DIR=DATA_DIR, os=os, re=re)


def write_full_update_status(job_id: str, **changes: Any) -> None:
    return full_update_service.write_full_update_status({'full_update_status_path': full_update_status_path, 'json': json, 'os': os, 'write_json_atomic': write_json_atomic}, job_id, **changes)


def verify_full_update_zip(archive_path: str, stage_dir: str, expected_version: str) -> List[str]:
    return full_update_service.verify_full_update_zip(archive_path, stage_dir, expected_version, FULL_UPDATE_MAX_BYTES=FULL_UPDATE_MAX_BYTES, FULL_UPDATE_MAX_FILES=FULL_UPDATE_MAX_FILES, full_update_path=full_update_path, hashlib=hashlib, json=json, os=os, re=re, zipfile=zipfile)


def full_update_release(version: str) -> Tuple[str, str]:
    return full_update_service.full_update_release(version, GITHUB_REPO_SLUG=GITHUB_REPO_SLUG, github_json=github_json, re=re)


def download_full_update(job_id: str, version: str, archive_path: str) -> None:
    return full_update_service.download_full_update(job_id, version, archive_path, FULL_UPDATE_MAX_BYTES=FULL_UPDATE_MAX_BYTES, full_update_release=full_update_release, requests=requests, time=time, urllib=urllib, write_full_update_status=write_full_update_status)


def run_full_update(job_id: str, version: str) -> None:
    return full_update_service.run_full_update(job_id, version, BASE_DIR=BASE_DIR, DATA_DIR=DATA_DIR, STATIC_DIR=STATIC_DIR, UPDATE_LOCK=UPDATE_LOCK, current_app_version=current_app_version, download_full_update=download_full_update, full_update_path=full_update_path, full_update_status_path=full_update_status_path, json=json, next_update_backup_dir=next_update_backup_dir, os=os, shutil=shutil, subprocess=subprocess, verify_full_update_zip=verify_full_update_zip, write_diagnostic=write_diagnostic, write_full_update_status=write_full_update_status, write_json_atomic=write_json_atomic)


@app.post("/api/update-job")
def start_full_update():
    return full_update_service.start_full_update(HTTPException=HTTPException, Thread=Thread, UPDATE_LOCK=UPDATE_LOCK, check_update=check_update, os=os, run_full_update=run_full_update, uuid=uuid, write_full_update_status=write_full_update_status)


@app.get("/api/update-job/{job_id}")
def get_full_update_status(job_id: str):
    return full_update_service.get_full_update_status(job_id, HTTPException=HTTPException, full_update_status_path=full_update_status_path, json=json)


def schedule_full_update_rollback(backup_dir: str, record: Dict[str, Any]) -> Dict[str, Any]:
    return full_update_service.schedule_full_update_rollback(backup_dir, record, BASE_DIR=BASE_DIR, DATA_DIR=DATA_DIR, STATIC_DIR=STATIC_DIR, current_app_version=current_app_version, full_update_path=full_update_path, full_update_status_path=full_update_status_path, next_update_backup_dir=next_update_backup_dir, os=os, shutil=shutil, subprocess=subprocess, uuid=uuid, write_full_update_status=write_full_update_status, write_json_atomic=write_json_atomic)

def list_update_backups() -> List[Dict[str, Any]]:
    return update_backup_service.list_update_backups(count_regular_files=count_regular_files, json=json, os=os, read_update_backup_manifest=read_update_backup_manifest, update_backup_root=update_backup_root)

@app.get("/api/update-backups")
def get_update_backups():
    return update_backup_service.get_update_backups(list_update_backups=list_update_backups)

class RollbackRequest(BaseModel):
    name: str = ""
    auto_restart: bool = False
    restart_delay: int = 3

@app.post("/api/update-rollback")
def rollback_update(req: RollbackRequest):
    return update_backup_service.rollback_update(req, DATA_DIR=DATA_DIR, HTTPException=HTTPException, UPDATE_LOCK=UPDATE_LOCK, create_update_backup=create_update_backup, current_app_version=current_app_version, json=json, next_update_backup_dir=next_update_backup_dir, os=os, prune_update_backups=prune_update_backups, read_update_backup_manifest=read_update_backup_manifest, safe_static_dir=safe_static_dir, safe_update_target=safe_update_target, schedule_full_update_rollback=schedule_full_update_rollback, schedule_self_restart=schedule_self_restart, shutil=shutil, update_allowed_file=update_allowed_file, write_diagnostic=write_diagnostic)

class GenerateRequest(BaseModel):
    prompt: str = ""
    width: int = 1024
    height: int = 1024
    workflow_json: str = "Z-Image.json"
    params: Dict[str, Any] = {}
    type: str = "zimage"
    client_id: str = ""
    convert_to_jpg: bool = False
    assistant_action_id: str = Field(default="", max_length=100)
    canvas_id: str = Field(default="", max_length=100)
    node_id: str = Field(default="", max_length=100)
    input_hash: str = Field(default="", max_length=64)
    segment_id: str = Field(default="", max_length=100)

class DeleteHistoryRequest(BaseModel):
    timestamp: float

class DeleteCanvasLogRequest(BaseModel):
    log_id: str
    delete_unreferenced_media: bool = False
    reset_referencing_nodes: bool = False
    base_updated_at: int = 0

class ClearCanvasRequest(BaseModel):
    client_id: str = ""
    base_updated_at: int = 0

class TokenRequest(BaseModel):
    token: str

class CloudGenRequest(BaseModel):
    prompt: str
    api_key: str = ""
    model: str = ""
    resolution: str = "1024x1024"
    type: str = "zimage"
    image_urls: List[str] = []
    loras: Optional[Any] = None
    client_id: Optional[str] = None

class CloudPollRequest(BaseModel):
    task_id: str
    api_key: str = ""
    client_id: Optional[str] = None

class AIReference(BaseModel):
    url: str = ""
    name: str = ""
    role: str = ""
    kind: str = ""
    mime: str = ""
    original_url: str = ""
    source_url: str = ""
    originalLocalUrl: str = ""

class OnlineImageRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=ONLINE_IMAGE_PROMPT_MAX_LENGTH)
    provider_id: str = "comfly"
    model: str = ""
    size: str = "1024x1024"
    aspect_ratio: str = ""
    resolution: str = ""
    quality: str = "auto"
    n: int = 1
    reference_images: List[AIReference] = []
    operation: str = ""
    resolution_type: str = ""
    assistant_action_id: str = Field(default="", max_length=100)
    canvas_id: str = Field(default="", max_length=100)
    node_id: str = Field(default="", max_length=100)
    input_hash: str = Field(default="", max_length=64)
    assistant_slot_key: str = Field(default="", max_length=80)
    native_node_type: str = ""
    native_configuration_hash: str = Field(default="", max_length=64)
    native_config: Dict[str, Any] = {}

class MidjourneySubmitRequest(BaseModel):
    provider_id: str = ""
    prompt: str = Field(default="", max_length=ONLINE_IMAGE_PROMPT_MAX_LENGTH)
    size: str = "1:1"
    version: str = "6.1"
    speed: str = "relax"
    reference_images: List[AIReference] = []
    mode: str = "imagine"

class MidjourneyActionRequest(BaseModel):
    provider_id: str = ""
    task_id: str = Field(min_length=1, max_length=240)
    action: str = "variation"
    index: int = 1
    speed: str = "relax"
    direction: str = ""
    zoom_ratio: Optional[float] = None
    custom_id: str = Field(default="", max_length=600)
    prompt: str = Field(default="", max_length=ONLINE_IMAGE_PROMPT_MAX_LENGTH)

class MidjourneyModalRequest(BaseModel):
    provider_id: str = ""
    task_id: str = Field(min_length=1, max_length=240)
    prompt: str = Field(default="", max_length=ONLINE_IMAGE_PROMPT_MAX_LENGTH)
    speed: str = "relax"
    mask_image: Optional[AIReference] = None

class ImageTaskQueryRequest(BaseModel):
    provider_id: str = "comfly"
    task_id: str = Field(min_length=1, max_length=240)


class ExtensionMediaProbeRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=240)
    content_type: str = Field(default="", max_length=128)
    head_base64: str = Field(default="", max_length=180)

CANVAS_TASKS: Dict[str, Dict[str, Any]] = {}
CANVAS_TASK_LOCK = Lock()
CANVAS_TASK_PROCESS_ID = uuid.uuid4().hex
CANVAS_TASK_UNKNOWN = "本地任务记录已失效，远端状态未知；请勿直接重复提交。"
CANVAS_IMAGE_REMOTE_ACCEPT_CALLBACK = ContextVar(
    "canvas_image_remote_accept_callback", default=None
)

class CanvasVideoRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=VIDEO_PROMPT_MAX_LENGTH)
    provider_id: str = "comfly"
    model: str = "veo3-fast"
    duration: int = 5
    aspect_ratio: str = "16:9"
    resolution: str = ""
    size: str = ""
    images: List[AIReference] = []
    videos: List[str] = []
    audios: List[str] = []
    enhance_prompt: bool = False
    enable_upsample: bool = False
    watermark: bool = False
    seed: Optional[int] = None
    camerafixed: bool = False
    return_last_frame: bool = False
    generate_audio: bool = False
    multimodal: bool = False
    trusted_asset: bool = False


class CanvasVideoTaskRequest(CanvasVideoRequest):
    # The canvas saves this ID before POST, so a lost response cannot force a new submission.
    client_task_id: str = Field(min_length=20, max_length=100)
    assistant_action_id: str = Field(default="", max_length=100)
    canvas_id: str = Field(default="", max_length=100)
    node_id: str = Field(default="", max_length=100)
    input_hash: str = Field(default="", max_length=64)


class CanvasDepthCaptureRequest(BaseModel):
    source_url: str = Field(min_length=1, max_length=2048)
    operation_id: str = Field(min_length=20, max_length=100)

class TempShUploadRequest(BaseModel):
    url: str = ""

class CloudVideoUploadRequest(BaseModel):
    url: str = ""
    service: str = "auto"

class RunningHubSubmitRequest(BaseModel):
    webappId: str = ""
    nodeInfoList: List[Dict[str, Any]] = []
    instanceType: str = ""
    useWallet: bool = False

class RunningHubWorkflowSubmitRequest(BaseModel):
    workflowId: str = ""
    nodeInfoList: List[Dict[str, Any]] = []
    workflow: Any = None
    useWallet: bool = False

class RunningHubUploadAssetRequest(BaseModel):
    url: str = ""
    useWallet: bool = False

class JimengHelpRequest(BaseModel):
    command: str = ""

class CodexHelpRequest(BaseModel):
    command: str = ""

class GeminiCliHelpRequest(BaseModel):
    command: str = ""

class JimengQueryMediaRequest(BaseModel):
    submit_id: str = ""
    kind: str = "image"

class RunningHubWorkflowConfigField(BaseModel):
    id: str = ""
    nodeId: str = ""
    fieldName: str = ""
    fieldValue: str = ""
    fieldType: str = "TEXT"
    label: str = ""
    enabled: bool = True
    sourceFromUpstream: bool = True
    group: str = ""
    note: str = ""
    options: List[str] = Field(default_factory=list)
    random_enabled: bool = False
    min: Any = ""
    max: Any = ""
    step: Any = ""
    imageOrder: int = 0
    required: bool = False

class RunningHubWorkflowConfig(BaseModel):
    workflowId: str = ""
    title: str = ""
    description: str = ""
    fields: List[RunningHubWorkflowConfigField] = Field(default_factory=list)
    workflowJson: Dict[str, Any] = Field(default_factory=dict)
    optionalImageMode: str = "prune-workflow"
    raw: Dict[str, Any] = Field(default_factory=dict)

class ApiProviderPayload(BaseModel):
    id: str = ""
    name: str = ""
    base_url: str = ""
    protocol: str = "openai"
    image_request_mode: str = "openai"
    image_generation_endpoint: str = ""
    image_edit_endpoint: str = ""
    enabled: bool = True
    primary: bool = False
    image_models: List[str] = []
    chat_models: List[str] = []
    video_models: List[str] = []
    audio_models: List[str] = []
    audio_generation_models: List[str] = Field(default_factory=list)
    audio_generation_protocol: str = "openai-speech"
    audio_generation_voices: List[str] = Field(default_factory=list)
    audio_generation_instructions: bool = False
    audio_timestamp_models: List[str] = []
    model_names: Dict[str, str] = {}
    model_protocols: Dict[str, str] = {}
    ms_loras: List[Dict[str, Any]] = []
    ms_defaults_version: int = 0
    rh_apps: List[Dict[str, Any]] = []
    rh_workflows: List[Dict[str, Any]] = []
    volcengine_project_name: str = VOLCENGINE_DEFAULT_PROJECT_NAME
    volcengine_region: str = VOLCENGINE_DEFAULT_REGION
    volcengine_access_key_id: Optional[str] = None
    volcengine_secret_access_key: Optional[str] = None
    volcengine_voice_api_key: Optional[str] = None
    api_key: Optional[str] = None
    wallet_api_key: Optional[str] = None
    clear_key: bool = False
    clear_wallet_key: bool = False
    clear_volcengine_access_key_id: bool = False
    clear_volcengine_secret_access_key: bool = False
    clear_volcengine_voice_api_key: bool = False

class ChatRequest(BaseModel):
    conversation_id: str = ""
    message: str = Field(min_length=1, max_length=LLM_MESSAGE_MAX_LENGTH)
    system_prompt: str = ""
    model: str = ""
    image_model: str = ""
    image_provider: str = ""
    mode: str = "chat"
    size: str = "1024x1024"
    aspect_ratio: str = ""
    resolution: str = ""
    quality: str = "auto"
    reference_images: List[AIReference] = []
    provider: str = "comfly"
    ms_model: str = ""

def chat_system_prompt(payload):
    prompt = str(getattr(payload, "system_prompt", "") or "").strip()
    return prompt or SYSTEM_PROMPT

class MsGenerateRequest(BaseModel):
    prompt: str
    api_key: str = ""
    model: str = "black-forest-labs/FLUX.2-klein-9B"
    image_urls: List[str] = []
    width: int = 0
    height: int = 0
    size: str = ""
    loras: Optional[Any] = None
    client_id: Optional[str] = None

class CanvasLLMRequest(BaseModel):
    message: str = Field(min_length=1, max_length=LLM_MESSAGE_MAX_LENGTH)
    system_prompt: str = ""
    model: str = ""
    messages: List[Dict[str, Any]] = []
    provider: str = "comfly"
    ms_model: str = ""
    images: List[str] = []   # 可以是 /output/*.png、/assets/*.png 本地路径 或 http(s) URL 或 data URL
    videos: List[str] = []   # 可以是 /output/*.mp4、/assets/*.mp4 本地路径 或 http(s) URL 或 data URL
    audios: List[str] = []   # 可以是 /output/*.wav、/assets/*.mp3 本地路径或 http(s) URL
    temperature: Optional[float] = Field(default=None, ge=0, le=2)
    max_tokens: Optional[int] = Field(default=None, ge=1, le=32000)

class ConversationCreateRequest(BaseModel):
    title: str = "新对话"

class CanvasCreateRequest(BaseModel):
    title: str = "未命名画布"
    icon: str = "🧩"
    kind: str = "classic"
    project: Optional[str] = None
    board_x: Optional[float] = None
    board_y: Optional[float] = None

class CanvasMetaUpdate(BaseModel):
    title: Optional[str] = None
    icon: Optional[str] = None
    owner: Optional[str] = None
    color: Optional[str] = None
    pinned: Optional[bool] = None
    project: Optional[str] = None
    board_x: Optional[float] = None
    board_y: Optional[float] = None

class ProjectCreateRequest(BaseModel):
    name: str = "新项目"

class ProjectUpdateRequest(BaseModel):
    name: Optional[str] = None
    order: Optional[int] = None

class CanvasSaveRequest(BaseModel):
    title: str = "未命名画布"
    icon: str = "🧩"
    nodes: List[Dict[str, Any]] = []
    connections: List[Dict[str, Any]] = []
    viewport: Dict[str, Any] = {}
    logs: List[Dict[str, Any]] = []
    settings: Dict[str, Any] = {}
    client_id: str = ""
    base_updated_at: int = 0
    base_meta_revision: Optional[int] = None

class CanvasAssetCheckRequest(BaseModel):
    urls: List[str] = []

class CanvasAssetDownloadRequest(BaseModel):
    urls: List[str] = []
    items: List[Dict[str, Any]] = []
    filename: str = "canvas-output-images.zip"

class CanvasWorkflowExportRequest(BaseModel):
    nodes: List[Dict[str, Any]] = []
    connections: List[Dict[str, Any]] = []
    filename: str = "canvas-workflow.zip"
    include_resources: bool = True
    library_id: str = ""
    category_id: str = ""
    name: str = ""
    cover_url: str = ""

class SmartCanvasGroupExportItem(BaseModel):
    kind: str = ""
    url: str = ""
    text: str = ""
    name: str = ""

class SmartCanvasGroupExportRequest(BaseModel):
    folder: str = ""
    group_name: str = "group"
    items: List[SmartCanvasGroupExportItem] = []





class LocalImageImportRequest(BaseModel):
    path: str = ""
    paths: List[str] = Field(default_factory=list)

class LocalAssetCaptionRequest(BaseModel):
    names: List[str] = []
    provider: str = "comfly"
    model: str = ""
    ms_model: str = ""
    prompt: str = "描述图片"

class LocalAssetCaptionSaveRequest(BaseModel):
    name: str = ""
    caption: str = ""

class LocalAssetClassifyRequest(BaseModel):
    names: List[str] = []
    provider: str = "comfly"
    model: str = ""
    ms_model: str = ""
    prompt: str = ""

class LocalAssetUrlImportItem(BaseModel):
    url: str = ""
    name: str = ""
    data: str = ""          # 可选：base64 / dataURL，由插件在网页上下文里读取（blob: 等无法服务端下载的素材）
    content_type: str = ""  # 配合 data 使用，用于推断扩展名

class LocalAssetUrlImportRequest(BaseModel):
    items: List[LocalAssetUrlImportItem] = []
    folder: str = ""
    classify: bool = False
    provider: str = "comfly"
    model: str = ""
    ms_model: str = ""
    prompt: str = ""

class LocalAssetFolderRequest(BaseModel):
    parent: str = ""
    path: str = ""
    name: str = ""

class LocalAssetRenameRequest(BaseModel):
    path: str = ""
    name: str = ""

class AssetLibraryCategoryRequest(BaseModel):
    name: str = "新文件夹"
    type: str = "image"
    library_id: str = ""

class AssetLibraryRequest(BaseModel):
    name: str = "资产库"

class AssetLibraryAddRequest(BaseModel):
    category_id: str = ""
    url: str = ""
    name: str = ""
    library_id: str = ""

class AssetLibraryBatchAddRequest(BaseModel):
    category_id: str = ""
    library_id: str = ""
    items: List[AssetLibraryAddRequest] = []

class SharedFolderRegister(BaseModel):
    path: str = ""
    name: str = ""

class SharedFolderImport(BaseModel):
    library_id: str = ""
    category_id: str = ""
    folder_id: str = ""
    paths: List[str] = []

class AssetLibraryRenameRequest(BaseModel):
    name: str = ""
    library_id: str = ""

class AssetLibraryBatchDeleteRequest(BaseModel):
    ids: List[str] = []
    library_id: str = ""

class AssetLibraryBatchMoveRequest(BaseModel):
    ids: List[str] = []
    library_id: str = ""
    target_library_id: str = ""
    target_category_id: str = ""

class AssetLibraryBatchCropRequest(BaseModel):
    ids: List[str] = []
    library_id: str = ""
    target_library_id: str = ""
    target_category_id: str = ""
    mode: str = "square"

class AssetAvatarRegisterRequest(BaseModel):
    library_id: str = ""
    provider_id: str = ""
    project_name: str = "default"
    group_name: str = ""

class AssetLibraryClassifyRequest(BaseModel):
    library_id: str = ""
    ids: List[str] = []
    provider: str = "comfly"
    model: str = ""
    ms_model: str = ""
    prompt: str = ""

class PromptLibraryRequest(BaseModel):
    name: str = "提示词库"

class PromptLibraryItemRequest(BaseModel):
    library_id: str = ""
    item_id: str = ""
    name: str = "提示词"
    category: str = "custom"
    positive: str = ""
    negative: str = ""
    scene: str = ""

class PromptLibraryBatchDeleteRequest(BaseModel):
    ids: List[str] = []

class PromptLibraryCategoryRequest(BaseModel):
    name: str = "新分组"
    library_id: str = ""

# --- 负载均衡 ---

def check_images_exist(backend_addr, images):
    return comfy_backend_selection.check_images_exist(backend_addr, images, urllib=urllib, requests=requests)


def is_comfy_input_media_value(input_name: str, value: Any) -> bool:
    return comfy_backend_selection.is_comfy_input_media_value(input_name, value)

def collect_required_comfy_media(params: Dict[str, Any]) -> List[str]:
    return comfy_backend_selection.collect_required_comfy_media(params, is_comfy_input_media_value=is_comfy_input_media_value)

def comfy_prompt_error_message(status_code: int, error_body: str) -> str:
    return upstream_public_policy.comfy_prompt_error_message(status_code, error_body, safe_cli_public_text=safe_cli_public_text)

def get_best_backend(required_images: List[str] = None):
    return comfy_backend_selection.get_best_backend(required_images, get_instances=lambda: COMFYUI_INSTANCES, get_backend_load=lambda: BACKEND_LOCAL_LOAD, urllib=urllib, json=json, LOAD_LOCK=LOAD_LOCK, check_images_exist=check_images_exist, write_diagnostic=write_diagnostic)

def reserve_best_backend(required_images: List[str] = None):
    return comfy_backend_selection.reserve_best_backend(required_images, get_instances=lambda: COMFYUI_INSTANCES, get_backend_load=lambda: BACKEND_LOCAL_LOAD, urllib=urllib, json=json, LOAD_LOCK=LOAD_LOCK, check_images_exist=check_images_exist, write_diagnostic=write_diagnostic)

# --- 辅助工具 ---

def download_image(comfy_address, comfy_url_path, prefix="studio_"):
    return comfy_output_service.download_image(comfy_address, comfy_url_path, prefix, COMFYUI_DOWNLOAD_TIMEOUT=COMFYUI_DOWNLOAD_TIMEOUT, output_path_for=output_path_for, output_url_for=output_url_for, shutil=shutil, write_diagnostic=write_diagnostic)

def comfy_output_extension(item):
    return comfy_output_service.comfy_output_extension(item)

def is_video_output_item(item):
    return comfy_output_service.is_video_output_item(item, comfy_output_extension=comfy_output_extension)

def comfy_output_kind(item):
    return comfy_output_service.comfy_output_kind(item, comfy_output_extension=comfy_output_extension)

def download_comfy_output(comfy_address, item, prefix="studio_"):
    return comfy_output_service.download_comfy_output(comfy_address, item, prefix, COMFYUI_DOWNLOAD_TIMEOUT=COMFYUI_DOWNLOAD_TIMEOUT, comfy_output_extension=comfy_output_extension, output_path_for=output_path_for, output_url_for=output_url_for, shutil=shutil, write_diagnostic=write_diagnostic)

def save_comfy_text_output(value, prefix="studio_", name=""):
    return comfy_output_service.save_comfy_text_output(value, prefix, name, output_path_for=output_path_for, output_url_for=output_url_for, sanitize_export_filename=sanitize_export_filename, write_text_atomic=write_text_atomic)

def comfy_text_values_from_output(node_output):
    return comfy_output_service.comfy_text_values_from_output(node_output)

def collect_comfy_file_items(node_output):
    return comfy_output_service.collect_comfy_file_items(node_output)

# 纯预览/对比类节点：其输出只用于界面展示（PreviewImage、rgthree 的 Image Comparer 等），
# 工作流里通常还有 SaveImage 产出真正结果，故有正式产出时应丢弃这些冗余预览/对比图。
COMFY_PREVIEW_CLASS_HINTS = ("previewimage", "comparer", "imagecompare", "image compare")
# show/utility 类调试文本节点：ShowText、各种 *Anything、CR Text、MathExpression、note 等，
# 它们的 ui 文本基本是调试信息，不应混进最终结果。
COMFY_DEBUG_TEXT_CLASS_HINTS = (
    "showtext", "show text", "showanything", "show any", "preview any", "previewany",
    "displaytext", "display text", "display any", "anything everywhere", "convertanything",
    "easy show", "note", "mathexpression", "cr text", "text multiline", "string function",
    "debug",
)

def comfy_class_is_preview(class_type):
    return comfy_output_service.comfy_class_is_preview(class_type, COMFY_PREVIEW_CLASS_HINTS=COMFY_PREVIEW_CLASS_HINTS)

def comfy_class_is_debug_text(class_type):
    return comfy_output_service.comfy_class_is_debug_text(class_type, COMFY_DEBUG_TEXT_CLASS_HINTS=COMFY_DEBUG_TEXT_CLASS_HINTS)

_PUBLIC_USAGE_FIELDS = frozenset({
    "prompt_tokens", "completion_tokens", "total_tokens", "input_tokens",
    "output_tokens", "cached_tokens", "reasoning_tokens", "cost",
    "input_cost", "output_cost", "total_cost",
})

def public_usage(value):
    """只保留上游用量中的有限数值，不透传调试字段或嵌套数据。"""
    if not isinstance(value, dict):
        return None
    result = {}
    for key in _PUBLIC_USAGE_FIELDS:
        number = value.get(key)
        if isinstance(number, (int, float)) and not isinstance(number, bool) and math.isfinite(number) and 0 <= number <= 10**15:
            result[key] = number
    return result or None

def sanitize_record_usage(record):
    return conversation_service.sanitize_record_usage(record, public_usage=public_usage)

def sanitize_conversation_usage(conversation):
    return conversation_service.sanitize_conversation_usage(conversation, sanitize_record_usage=sanitize_record_usage)

def save_to_history(record):
    return conversation_service.save_to_history(record, HISTORY_FILE=HISTORY_FILE, HISTORY_LOCK=HISTORY_LOCK, sanitize_record_usage=sanitize_record_usage, write_json_atomic=write_json_atomic)

def get_comfy_history(comfy_address, prompt_id):
    return comfy_output_service.get_comfy_history(comfy_address, prompt_id)

def safe_user_id(user_id, request: Request):
    candidate = (user_id or "").strip()
    if not candidate and request.client:
        candidate = f"ip-{request.client.host}"
    if not candidate:
        candidate = "anonymous"
    candidate = re.sub(r"[^a-zA-Z0-9_.-]", "-", candidate)[:80].strip(".-")
    return candidate or "anonymous"

def user_dir(user_id):
    return conversation_service.user_dir(user_id, CONVERSATION_DIR=CONVERSATION_DIR)

def conversation_path(user_id, conversation_id):
    return conversation_service.conversation_path(user_id, conversation_id, HTTPException=HTTPException, user_dir=user_dir)

def now_ms():
    return int(time.time() * 1000)

def save_conversation(user_id, conversation):
    return conversation_service.save_conversation(user_id, conversation, CONVERSATION_LOCK=CONVERSATION_LOCK, conversation_path=conversation_path, sanitize_conversation_usage=sanitize_conversation_usage, write_json_atomic=write_json_atomic)

def new_conversation(user_id, title="新对话"):
    return conversation_service.new_conversation(user_id, title, now_ms=now_ms, save_conversation=save_conversation)

def load_conversation(user_id, conversation_id):
    return conversation_service.load_conversation(user_id, conversation_id, HTTPException=HTTPException, conversation_path=conversation_path, sanitize_conversation_usage=sanitize_conversation_usage)

def list_conversations(user_id):
    return conversation_service.list_conversations(user_id, user_dir=user_dir)

@contextmanager
def _canvas_store():
    """按调用注入当前路径和共享锁；只把存储领域错误转换为既有 HTTP 错误。"""
    try:
        yield CanvasStore(CANVAS_DIR, lock=CANVAS_LOCK, now_ms=now_ms,
                          new_id=lambda: uuid.uuid4().hex, default_project=DEFAULT_PROJECT_ID,
                          retention_ms=CANVAS_TRASH_RETENTION_MS, writer=write_json_atomic)
    except CanvasStoreError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


def _require_canvas_format(canvas):
    with _canvas_store() as store:
        store.validate(canvas)

def _write_canvas_document(canvas):
    with _canvas_store() as store:
        store.write(canvas)

def save_canvas(canvas):
    with _canvas_store() as store:
        store.save(canvas)

# ===== 项目（按项目分类管理画布）=====
PROJECTS_PATH = os.path.join(DATA_DIR, "projects.json")
DEFAULT_PROJECT_ID = "default"

@contextmanager
def _project_store():
    """注入当前路径与共享锁，保持现有项目接口的 HTTP 错误边界。"""
    try:
        yield ProjectStore(PROJECTS_PATH, lock=CANVAS_LOCK, now_ms=now_ms,
                           new_id=lambda: uuid.uuid4().hex, default_id=DEFAULT_PROJECT_ID)
    except ProjectOperationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

def ensure_default_project():
    """保证默认项目存在；画布归属由原有画布入口管理。"""
    with _project_store() as store:
        return store.ensure_default()

def new_project(name="新项目"):
    with _project_store() as store:
        return store.create(name)

def list_projects():
    return project_list_records(
        ensure_default_project(), iter_canvas_records(include_deleted=False), default_id=DEFAULT_PROJECT_ID
    )


def _project_canvases_for_move(project_id):
    with _canvas_store() as store:
        return store.for_project(project_id)


def new_canvas(title="未命名画布", icon="layers", kind="classic", project=None, board_x=None, board_y=None):
    with _canvas_store() as store:
        return store.create(title, icon, kind, project, board_x, board_y)

def load_canvas(canvas_id):
    with _canvas_store() as store:
        return store.load(canvas_id)

def cleanup_expired_canvas_trash():
    with _canvas_store() as store:
        store.cleanup_trash()

def iter_canvas_records(include_deleted=False):
    with _canvas_store() as store:
        return store.records(include_deleted)

def list_canvases():
    return sort_canvas_records(iter_canvas_records(include_deleted=False))

def list_deleted_canvases():
    return sort_canvas_records(iter_canvas_records(include_deleted=True), include_deleted=True)


def canvas_assets_index():
    with _canvas_store() as store:
        return canvas_asset_rules.summarize_canvas_assets(store.asset_documents())

def display_title(text):
    title = re.sub(r"\s+", " ", text or "").strip()
    return title[:24] or "新对话"

def resolve_chat_provider(provider: str, model: str, ms_model: str):
    return chat_execution_service.resolve_chat_provider(provider, model, ms_model, AI_BASE_URL=AI_BASE_URL, HTTPException=HTTPException, MODELSCOPE_CHAT_MODELS=MODELSCOPE_CHAT_MODELS, RUNNINGHUB_LLM_BASE_URL=RUNNINGHUB_LLM_BASE_URL, api_headers=api_headers, bearer_auth_value=bearer_auth_value, effective_protocol=effective_protocol, get_api_provider=get_api_provider, is_apimart_provider=is_apimart_provider, is_codex_provider=is_codex_provider, is_gemini_cli_provider=is_gemini_cli_provider, modelscope_api_key=modelscope_api_key, modelscope_api_root=modelscope_api_root, preferred_chat_model=preferred_chat_model, selected_model=selected_model)



def redact_url_for_log(value):
    return network_log_service.redact_url_for_log(value, urllib=urllib)


def redact_log_text(value):
    return network_log_service.redact_log_text(value, redact_url_for_log=redact_url_for_log)


def format_proxy_summary(proxies):
    return network_log_service.format_proxy_summary(proxies, redact_url_for_log=redact_url_for_log)


def log_net_error(context, exc, url=""):
    return network_log_service.log_net_error(context, exc, url, redact_log_text=redact_log_text, urllib=urllib, write_diagnostic=write_diagnostic, format_context=format_context, redact_url_for_log=redact_url_for_log, format_proxy_summary=format_proxy_summary)

def api_headers(json_body=True, provider=None, model=""):
    if provider:
        if is_codex_provider(provider) or is_gemini_cli_provider(provider):
            raise HTTPException(status_code=400, detail="CLI 协议使用本机登录态，不需要 API Key。当前入口应走对应 CLI 专用通道。")
        api_key = provider_env_key_value(provider["id"])
        provider_name = provider.get("name") or provider["id"]
        if not api_key:
            raise HTTPException(status_code=400, detail=f"未配置 {provider_name} 的 API Key，请在 API 平台管理中填写。")
    else:
        api_key = AI_API_KEY
        if not api_key:
            raise HTTPException(status_code=400, detail="未配置 COMFLY_API_KEY，请在 API/.env 中填写。")
    # APIMart proxies Gemini's request format but authenticates with its normal
    # OpenAI-compatible Bearer key. Direct Gemini-compatible providers use x-goog.
    if provider and effective_protocol(provider, model) == "gemini" and not is_apimart_provider(provider):
        headers = {"Accept": "application/json", "x-goog-api-key": api_key}
    else:
        headers = {"Accept": "application/json", "Authorization": bearer_auth_value(api_key)}
    if json_body:
        headers["Content-Type"] = "application/json"
    return headers

def looks_like_vision_chat_model(model):
    return provider_protocols.looks_like_vision_chat_model(model)

def preferred_chat_model(provider):
    return provider_protocols.preferred_chat_model(provider, CHAT_MODEL=CHAT_MODEL, is_volcengine_provider=is_volcengine_provider, looks_like_vision_chat_model=looks_like_vision_chat_model)

def modelscope_size(value, fallback="1024x1024"):
    return image_size_rules.modelscope_size(value, fallback, re=re, HTTPException=HTTPException)

def unwrap_apimart_response(raw):
    return upstream_response_codec.unwrap_apimart_response(raw)

def text_from_chat_response(data):
    return upstream_response_codec.text_from_chat_response(data, unwrap_apimart_response=unwrap_apimart_response)

def required_chat_response_text(data):
    return upstream_response_codec.required_chat_response_text(data, HTTPException=HTTPException, text_from_chat_response=text_from_chat_response)

def text_delta_from_chat_chunk(data):
    return upstream_response_codec.text_delta_from_chat_chunk(data)

def sse_event(data):
    return upstream_response_codec.sse_event(data)

IMAGE_OUTPUT_KEY_HINTS = (
    "url", "image_url", "imageUrl", "image", "output_url", "outputUrl",
    "result_url", "resultUrl", "download_url", "downloadUrl", "asset_url", "assetUrl",
)
IMAGE_CONTAINER_KEY_HINTS = (
    "images", "image", "output", "outputs", "result", "results", "data", "items", "files",
)
IMAGE_BASE64_KEY_HINTS = ("b64_json", "base64", "image_base64", "imageBase64")

def looks_like_generated_image_url(value):
    return upstream_response_codec.looks_like_generated_image_url(value)

def looks_like_image_base64(value):
    return upstream_response_codec.looks_like_image_base64(value)

def image_payload_from_string(value, mime_type="image/png", assume_b64=False):
    return upstream_response_codec.image_payload_from_string(value, mime_type, assume_b64, looks_like_generated_image_url=looks_like_generated_image_url, looks_like_image_base64=looks_like_image_base64)

def extract_image_flexible(value, depth=0):
    return upstream_response_codec.extract_image_flexible(value, depth, IMAGE_BASE64_KEY_HINTS=IMAGE_BASE64_KEY_HINTS, IMAGE_CONTAINER_KEY_HINTS=IMAGE_CONTAINER_KEY_HINTS, IMAGE_OUTPUT_KEY_HINTS=IMAGE_OUTPUT_KEY_HINTS, extract_image_flexible=extract_image_flexible, image_payload_from_string=image_payload_from_string)

def extract_images(data):
    return upstream_response_codec.extract_images(data, HTTPException=HTTPException, IMAGE_BASE64_KEY_HINTS=IMAGE_BASE64_KEY_HINTS, IMAGE_CONTAINER_KEY_HINTS=IMAGE_CONTAINER_KEY_HINTS, IMAGE_OUTPUT_KEY_HINTS=IMAGE_OUTPUT_KEY_HINTS, image_payload_from_string=image_payload_from_string, looks_like_generated_image_url=looks_like_generated_image_url)

def extract_image(data):
    return upstream_response_codec.extract_image(data, HTTPException=HTTPException, extract_image_flexible=extract_image_flexible, extract_images=extract_images)

def extract_task_id(data):
    return upstream_response_codec.extract_task_id(data, extract_task_id=extract_task_id)

def extract_task_id_from_text(text):
    return upstream_response_codec.extract_task_id_from_text(text)

def images_api_unsupported(response):
    return upstream_response_codec.images_api_unsupported(response)

def responses_image_size_instruction(size: str) -> str:
    return responses_service.responses_image_size_instruction(size)

def responses_proxy_tool_size(size: str) -> str:
    return responses_service.responses_proxy_tool_size(size)

async def responses_input_image_url(ref, require_public_url=False) -> str:
    return await responses_service.responses_input_image_url(ref, require_public_url, HTTPException=HTTPException, openai_video_proxy_public_reference_url=openai_video_proxy_public_reference_url, output_file_from_url=output_file_from_url, reference_to_data_url=reference_to_data_url, upload_local_video_to_cloud=upload_local_video_to_cloud, write_diagnostic=write_diagnostic)

def responses_no_image_detail(data) -> str:
    return responses_service.responses_no_image_detail(data, _safe_upstream_text=_safe_upstream_text)

def responses_output_text_image(raw):
    return responses_service.responses_output_text_image(raw)

def _responses_wrap(url, status_code, payload):
    return responses_service._responses_wrap(url, status_code, payload)

RESPONSES_REJECT_STATUSES = {400, 404, 405, 415, 422}
RESPONSES_POLL_INTERVAL = 5.0
RESPONSES_POLL_MAX_SECONDS = 1500.0

async def post_openai_responses(client, url, headers, body):
    return await responses_service.post_openai_responses(client, url, headers, body, RESPONSES_POLL_INTERVAL=RESPONSES_POLL_INTERVAL, RESPONSES_POLL_MAX_SECONDS=RESPONSES_POLL_MAX_SECONDS, RESPONSES_REJECT_STATUSES=RESPONSES_REJECT_STATUSES, _responses_wrap=_responses_wrap, log_net_error=log_net_error, post_openai_responses_stream=post_openai_responses_stream, upstream_response_error_summary=upstream_response_error_summary, write_diagnostic=write_diagnostic)

async def post_openai_responses_stream(client, url, headers, body):
    return await responses_service.post_openai_responses_stream(client, url, headers, body, HTTPException=HTTPException, _responses_wrap=_responses_wrap, extract_images=extract_images, image_payload_from_string=image_payload_from_string, write_diagnostic=write_diagnostic)

def is_apimart_provider(provider):
    return provider_protocols.is_apimart_provider(provider, provider_protocol=provider_protocol)

def detect_image_request_mode(base_url="", models=None):
    return provider_protocols.detect_image_request_mode(base_url, models)

def effective_image_request_mode(provider, model=""):
    return provider_protocols.effective_image_request_mode(provider, model, detect_image_request_mode=detect_image_request_mode, normalize_image_request_mode=normalize_image_request_mode)

def is_gemini_provider(provider):
    return provider_protocols.is_gemini_provider(provider, provider_protocol=provider_protocol)

def is_tudou_provider(provider):
    return provider_protocols.is_tudou_provider(provider, is_tudou_base_url=is_tudou_base_url)

def is_tudou_async_image_mode(provider, model=""):
    return provider_protocols.is_tudou_async_image_mode(provider, model, normalize_image_request_mode=normalize_image_request_mode, is_tudou_async_image_model=is_tudou_async_image_model)

def is_tudou_async_image_model(model):
    return provider_protocols.is_tudou_async_image_model(model)

def tudou_image_model_for_request(model):
    return tudou_provider_service.tudou_image_model_for_request(model)

def tudou_async_resolution(model, resolution, size=""):
    return tudou_provider_service.tudou_async_resolution(model, resolution, size, parse_size_pair=parse_size_pair)

def tudou_async_size(size, aspect_ratio=""):
    return tudou_provider_service.tudou_async_size(size, aspect_ratio)

def tudou_png_or_jpeg_data_url(value):
    return tudou_provider_service.tudou_png_or_jpeg_data_url(value, BytesIO=BytesIO, Image=Image, ImageOps=ImageOps)

async def tudou_async_reference_images(reference_images):
    return await tudou_provider_service.tudou_async_reference_images(reference_images, ONLINE_IMAGE_REFERENCE_MAX=ONLINE_IMAGE_REFERENCE_MAX, reference_to_data_url=reference_to_data_url, tudou_png_or_jpeg_data_url=tudou_png_or_jpeg_data_url)

async def generate_tudou_async_image(prompt, size, quality, model, reference_images, provider, aspect_ratio="", resolution="", on_remote_accept=None):
    return await tudou_provider_service.generate_tudou_async_image(prompt, size, quality, model, reference_images, provider, aspect_ratio, resolution, on_remote_accept, HTTPException=HTTPException, api_headers=api_headers, extract_image=extract_image, extract_task_id=extract_task_id, httpx=httpx, provider_endpoint_url=provider_endpoint_url, tudou_async_reference_images=tudou_async_reference_images, tudou_async_resolution=tudou_async_resolution, tudou_async_size=tudou_async_size, upstream_error_summary=upstream_error_summary, upstream_response_error_summary=upstream_response_error_summary, wait_for_image_task=wait_for_image_task)

def is_tudou_grok_image_model(model):
    return provider_protocols.is_tudou_grok_image_model(model)

def is_tudou_grok_video_model(model):
    return provider_protocols.is_tudou_grok_video_model(model)

def is_volcengine_provider(provider):
    return provider_protocols.is_volcengine_provider(provider, provider_protocol=provider_protocol)

def is_runninghub_provider(provider):
    return provider_protocols.is_runninghub_provider(provider, provider_protocol=provider_protocol)

def is_jimeng_provider(provider):
    return provider_protocols.is_jimeng_provider(provider, provider_protocol=provider_protocol)

def is_codex_provider(provider):
    return provider_protocols.is_codex_provider(provider, provider_protocol=provider_protocol)

def is_gemini_cli_provider(provider):
    return provider_protocols.is_gemini_cli_provider(provider, provider_protocol=provider_protocol)

def codex_env_value(key):
    return os.getenv(key, "") or read_api_env_value(key)

def _windows_codex_install_candidates():
    return codex_cli_service._windows_codex_install_candidates(glob=glob, os=os)

def codex_cli_executable():
    return codex_cli_service.codex_cli_executable(_windows_codex_install_candidates=_windows_codex_install_candidates, codex_env_value=codex_env_value, os=os, shutil=shutil)

def codex_timeout(default=CODEX_DEFAULT_TIMEOUT):
    return codex_cli_service.codex_timeout(default)

def codex_model_for_exec(model="", fallback=""):
    return codex_cli_service.codex_model_for_exec(model, fallback)

def codex_decode_output(stdout, stderr):
    return codex_cli_service.codex_decode_output(stdout, stderr)

async def run_codex_cli(prompt, model="", image_paths=None, timeout=None, output_last_message=True):
    return await codex_cli_service.run_codex_cli(prompt, model, image_paths, timeout, output_last_message, BASE_DIR=BASE_DIR, HTTPException=HTTPException, OUTPUT_OUTPUT_DIR=OUTPUT_OUTPUT_DIR, codex_cli_executable=codex_cli_executable, codex_decode_output=codex_decode_output, codex_model_for_exec=codex_model_for_exec, codex_timeout=codex_timeout, safe_cli_executable_name=safe_cli_executable_name, safe_cli_public_text=safe_cli_public_text, tempfile=tempfile, write_diagnostic=write_diagnostic)

def codex_output_image_files(since_time=0):
    return codex_cli_service.codex_output_image_files(since_time, OUTPUT_OUTPUT_DIR=OUTPUT_OUTPUT_DIR)

def codex_output_url_from_path(path):
    return codex_cli_service.codex_output_url_from_path(path, OUTPUT_OUTPUT_DIR=OUTPUT_OUTPUT_DIR, output_url_for=output_url_for)

def gpt_image_2_skill_executable():
    configured = str(codex_env_value("GPT_IMAGE_2_SKILL_BIN") or "").strip()
    if configured:
        return configured
    return (
        shutil.which("gpt-image-2-skill")
        or shutil.which("gpt-image-2-skill.exe")
        or shutil.which("gpt-image-2-skill.cmd")
        or ""
    )

def gpt_image_2_skill_environment():
    env = dict(os.environ)
    if os.name == "nt":
        # The Rust helper reads proxy environment variables, not Windows Internet Settings.
        # urllib uses the existing Windows proxy when no proxy is supplied by the process.
        proxies = urllib.request.getproxies()
        for scheme, key in (("https", "HTTPS_PROXY"), ("http", "HTTP_PROXY"), ("all", "ALL_PROXY"), ("no", "NO_PROXY")):
            value = proxies.get(scheme)
            if value and not env.get(key) and not env.get(key.lower()):
                env[key] = value
    return env

def gpt_image_2_skill_auth_file():
    configured = str(codex_env_value("GPT_IMAGE_2_SKILL_AUTH_FILE") or codex_env_value("CODEX_AUTH_FILE") or "").strip()
    if configured:
        return configured
    project_auth = os.path.join(BASE_DIR, "API", "openai-gpt-account-auth.json")
    user_profile = os.getenv("USERPROFILE", "").strip()
    candidates = [
        project_auth,
        os.path.join(user_profile, ".codex", "auth.json") if user_profile else "",
        os.path.join(os.path.expanduser("~"), ".codex", "auth.json"),
    ]
    for path in candidates:
        if path and os.path.isfile(path):
            return path
    return candidates[0] if candidates and candidates[0] else ""

def gpt_image_2_skill_auth_json(auth_file=""):
    path = str(auth_file or "").strip()
    if not path or not os.path.isfile(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8-sig") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}

def gpt_image_2_skill_access_token(auth_data):
    if not isinstance(auth_data, dict):
        return ""
    for key in ("access_token", "accessToken"):
        value = str(auth_data.get(key) or "").strip()
        if value:
            return value
    tokens = auth_data.get("tokens")
    if isinstance(tokens, dict):
        for key in ("access_token", "accessToken"):
            value = str(tokens.get(key) or "").strip()
            if value:
                return value
    return ""

def gpt_image_2_skill_api_key(auth_data=None):
    for key in ("GPT_IMAGE_2_SKILL_API_KEY", "OPENAI_API_KEY"):
        value = str(codex_env_value(key) or "").strip()
        if value:
            return value
    if isinstance(auth_data, dict):
        value = str(auth_data.get("OPENAI_API_KEY") or auth_data.get("api_key") or auth_data.get("apiKey") or "").strip()
        if value:
            return value
    user_profile = os.getenv("USERPROFILE", "").strip()
    user_auth = os.path.join(user_profile, ".codex", "auth.json") if user_profile else ""
    if user_auth:
        user_data = gpt_image_2_skill_auth_json(user_auth)
        value = str(user_data.get("OPENAI_API_KEY") or user_data.get("api_key") or user_data.get("apiKey") or "").strip()
        if value:
            return value
    return ""

def gpt_image_2_skill_provider_args(auth_file=""):
    return codex_cli_service.gpt_image_2_skill_provider_args(auth_file, gpt_image_2_skill_access_token=gpt_image_2_skill_access_token, gpt_image_2_skill_api_key=gpt_image_2_skill_api_key, gpt_image_2_skill_auth_json=gpt_image_2_skill_auth_json)

def gpt_image_2_skill_model_arg(model="", provider="openai", fallback_model=""):
    return codex_cli_service.gpt_image_2_skill_model_arg(model, provider, fallback_model, CODEX_DEFAULT_CHAT_MODELS=CODEX_DEFAULT_CHAT_MODELS)

def gpt_image_2_skill_size_arg(size="", model="", prompt="", provider="openai"):
    return codex_cli_service.gpt_image_2_skill_size_arg(size, model, prompt, provider, CHAT_RATIO_SIZE_OPTIONS=CHAT_RATIO_SIZE_OPTIONS, normalize_gpt_image_2_size=normalize_gpt_image_2_size)

def gpt_image_2_skill_prompt_arg(prompt="", size="", provider="openai"):
    return codex_cli_service.gpt_image_2_skill_prompt_arg(prompt, size, provider, gpt_image_2_skill_size_arg=gpt_image_2_skill_size_arg, math=math, parse_size_pair=parse_size_pair)

def parse_gpt_image_2_skill_output(stdout_text="", stderr_text=""):
    return codex_cli_service.parse_gpt_image_2_skill_output(stdout_text, stderr_text)

def gpt_image_2_skill_failure_message(stdout_text="", stderr_text="", returncode=0):
    return codex_cli_service.gpt_image_2_skill_failure_message(stdout_text, stderr_text, returncode)

def codex_postprocess_image_to_requested_size(path="", requested_size="", provider=""):
    return codex_cli_service.codex_postprocess_image_to_requested_size(path, requested_size, provider, Image=Image, ImageOps=ImageOps, parse_size_pair=parse_size_pair, write_diagnostic=write_diagnostic)

async def generate_codex_provider_image_via_gpt_image_2_skill(prompt, size, model, ref_paths=None):
    return await codex_cli_service.generate_codex_provider_image_via_gpt_image_2_skill(prompt, size, model, ref_paths, BASE_DIR=BASE_DIR, HTTPException=HTTPException, OUTPUT_OUTPUT_DIR=OUTPUT_OUTPUT_DIR, codex_cli_executable=codex_cli_executable, codex_decode_output=codex_decode_output, codex_output_url_from_path=codex_output_url_from_path, codex_postprocess_image_to_requested_size=codex_postprocess_image_to_requested_size, codex_timeout=codex_timeout, gpt_image_2_skill_api_key=gpt_image_2_skill_api_key, gpt_image_2_skill_auth_file=gpt_image_2_skill_auth_file, gpt_image_2_skill_auth_json=gpt_image_2_skill_auth_json, gpt_image_2_skill_environment=gpt_image_2_skill_environment, gpt_image_2_skill_executable=gpt_image_2_skill_executable, gpt_image_2_skill_failure_message=gpt_image_2_skill_failure_message, gpt_image_2_skill_model_arg=gpt_image_2_skill_model_arg, gpt_image_2_skill_prompt_arg=gpt_image_2_skill_prompt_arg, gpt_image_2_skill_provider_args=gpt_image_2_skill_provider_args, gpt_image_2_skill_size_arg=gpt_image_2_skill_size_arg, list_codex_models=list_codex_models, parse_gpt_image_2_skill_output=parse_gpt_image_2_skill_output, safe_cli_public_text=safe_cli_public_text)

async def codex_prepare_local_media(ref_url):
    return await codex_cli_service.codex_prepare_local_media(ref_url, HTTPException=HTTPException, base64=base64, httpx=httpx, mimetypes=mimetypes, output_file_from_url=output_file_from_url, tempfile=tempfile)

async def codex_reference_paths(reference_images=None):
    return await codex_cli_service.codex_reference_paths(reference_images, ONLINE_IMAGE_REFERENCE_MAX=ONLINE_IMAGE_REFERENCE_MAX, codex_prepare_local_media=codex_prepare_local_media)

def codex_models_payload(raw=None, chat_models=None):
    return codex_cli_service.codex_models_payload(raw, chat_models, CODEX_DEFAULT_IMAGE_MODELS=CODEX_DEFAULT_IMAGE_MODELS, safe_cli_public_raw=safe_cli_public_raw)

async def fetch_codex_models_payload(status=None):
    return await codex_cli_service.fetch_codex_models_payload(status, BASE_DIR=BASE_DIR, HTTPException=HTTPException, codex_cli_executable=codex_cli_executable, codex_models_payload=codex_models_payload, codex_status=codex_status, list_codex_models=list_codex_models, safe_cli_public_text=safe_cli_public_text)

async def generate_codex_provider_image(prompt, size, model, reference_images=None, provider=None):
    return await codex_cli_service.generate_codex_provider_image(prompt, size, model, reference_images, provider, HTTPException=HTTPException, codex_reference_paths=codex_reference_paths, generate_codex_provider_image_via_gpt_image_2_skill=generate_codex_provider_image_via_gpt_image_2_skill)

def codex_chat_prompt(payload, history_messages=None):
    return codex_cli_service.codex_chat_prompt(payload, history_messages, MAX_HISTORY_MESSAGES=MAX_HISTORY_MESSAGES)

async def codex_chat_text(payload, history_messages=None):
    return await codex_cli_service.codex_chat_text(payload, history_messages, CODEX_DEFAULT_CHAT_MODELS=CODEX_DEFAULT_CHAT_MODELS, codex_chat_prompt=codex_chat_prompt, codex_reference_paths=codex_reference_paths, codex_timeout=codex_timeout, model_dump_compat=model_dump_compat, run_codex_cli=run_codex_cli)

def gemini_cli_env_value(key):
    return os.getenv(key, "") or read_api_env_value(key)

def antigravity_cli_winget_candidates():
    return gemini_cli_service.antigravity_cli_winget_candidates(glob=glob, os=os)

def gemini_cli_executable():
    return gemini_cli_service.gemini_cli_executable(antigravity_cli_winget_candidates=antigravity_cli_winget_candidates, gemini_cli_env_value=gemini_cli_env_value, shutil=shutil)

def is_antigravity_cli(exe):
    return gemini_cli_service.is_antigravity_cli(exe)

def gemini_cli_display_name(exe=None):
    return gemini_cli_service.gemini_cli_display_name(exe, gemini_cli_executable=gemini_cli_executable, is_antigravity_cli=is_antigravity_cli)

def gemini_cli_timeout(default=GEMINI_CLI_DEFAULT_TIMEOUT):
    return gemini_cli_service.gemini_cli_timeout(default)

def gemini_cli_image_timeout():
    return gemini_cli_service.gemini_cli_image_timeout()

def gemini_cli_model(model="", fallback=""):
    return gemini_cli_service.gemini_cli_model(model, fallback)

def gemini_cli_text_from_raw(raw, fallback_text=""):
    return gemini_cli_service.gemini_cli_text_from_raw(raw, fallback_text, gemini_cli_text_from_raw=gemini_cli_text_from_raw)

def gemini_cli_parse_stdout(out_text):
    return gemini_cli_service.gemini_cli_parse_stdout(out_text, gemini_cli_text_from_raw=gemini_cli_text_from_raw, jimeng_extract_json=jimeng_extract_json)

async def run_gemini_cli(prompt, model="", timeout=None, allow_tools=False):
    return await gemini_cli_service.run_gemini_cli(prompt, model, timeout, allow_tools, BASE_DIR=BASE_DIR, HTTPException=HTTPException, codex_decode_output=codex_decode_output, gemini_cli_display_name=gemini_cli_display_name, gemini_cli_executable=gemini_cli_executable, gemini_cli_model=gemini_cli_model, gemini_cli_parse_stdout=gemini_cli_parse_stdout, gemini_cli_timeout=gemini_cli_timeout, is_antigravity_cli=is_antigravity_cli, safe_cli_executable_name=safe_cli_executable_name, safe_cli_public_text=safe_cli_public_text, write_diagnostic=write_diagnostic)

def gemini_cli_models_payload(raw=None):
    return gemini_cli_service.gemini_cli_models_payload(raw, GEMINI_CLI_DEFAULT_CHAT_MODELS=GEMINI_CLI_DEFAULT_CHAT_MODELS, GEMINI_CLI_DEFAULT_IMAGE_MODELS=GEMINI_CLI_DEFAULT_IMAGE_MODELS, model_list_from_values=model_list_from_values, safe_cli_public_raw=safe_cli_public_raw)

def gemini_cli_reference_note(reference_images=None):
    return gemini_cli_service.gemini_cli_reference_note(reference_images, ONLINE_IMAGE_REFERENCE_MAX=ONLINE_IMAGE_REFERENCE_MAX)

async def gemini_cli_reference_paths(reference_images=None):
    return await gemini_cli_service.gemini_cli_reference_paths(reference_images, codex_reference_paths=codex_reference_paths)

def gemini_cli_image_size_instruction(size="", model=""):
    return gemini_cli_service.gemini_cli_image_size_instruction(size, model)

async def generate_gemini_cli_provider_image(prompt, size, model, reference_images=None, provider=None):
    return await gemini_cli_service.generate_gemini_cli_provider_image(prompt, size, model, reference_images, provider, GEMINI_CLI_DEFAULT_IMAGE_MODELS=GEMINI_CLI_DEFAULT_IMAGE_MODELS, HTTPException=HTTPException, OUTPUT_OUTPUT_DIR=OUTPUT_OUTPUT_DIR, codex_output_image_files=codex_output_image_files, codex_output_url_from_path=codex_output_url_from_path, codex_postprocess_image_to_requested_size=codex_postprocess_image_to_requested_size, gemini_cli_display_name=gemini_cli_display_name, gemini_cli_executable=gemini_cli_executable, gemini_cli_image_size_instruction=gemini_cli_image_size_instruction, gemini_cli_image_timeout=gemini_cli_image_timeout, gemini_cli_reference_paths=gemini_cli_reference_paths, gemini_cli_timeout=gemini_cli_timeout, is_antigravity_cli=is_antigravity_cli, run_gemini_cli=run_gemini_cli, safe_cli_public_text=safe_cli_public_text)

def gemini_cli_chat_prompt(payload, history_messages=None):
    return gemini_cli_service.gemini_cli_chat_prompt(payload, history_messages, MAX_HISTORY_MESSAGES=MAX_HISTORY_MESSAGES, model_dump_compat=model_dump_compat)

async def gemini_cli_chat_text(payload, history_messages=None):
    return await gemini_cli_service.gemini_cli_chat_text(payload, history_messages, GEMINI_CLI_DEFAULT_CHAT_MODELS=GEMINI_CLI_DEFAULT_CHAT_MODELS, gemini_cli_chat_prompt=gemini_cli_chat_prompt, gemini_cli_display_name=gemini_cli_display_name, gemini_cli_reference_paths=gemini_cli_reference_paths, gemini_cli_timeout=gemini_cli_timeout, run_gemini_cli=run_gemini_cli)

def is_yuli_provider(provider):
    # 玉玉API（yuli.host）的视频接口走自有格式（/v1/video/create + /v1/video/query），
    # 与通用 OpenAI /v1/videos/generations 不同，需单独识别。
    return provider_protocols.is_yuli_provider(provider)

def is_lingjing_provider(provider):
    return provider_protocols.is_lingjing_provider(provider)

def is_agnes_provider(provider, model=""):
    return provider_protocols.is_agnes_provider(provider, model)

# ---- 数字人/真人认证：平台无关分发 ----
# 认证是一个跨平台功能。每个平台用不同的资产 API 实现，但对外是统一入口。
# 新增平台时：在 avatar_platform_for_provider 里加一条识别，并把平台键加进
# AVATAR_SUPPORTED_PLATFORMS，再在 register/avatar-status 端点里补一个分发分支即可。
AVATAR_SUPPORTED_PLATFORMS = {"apimart", "volcengine"}  # 已接入官方资产 API 的平台

def avatar_platform_for_provider(provider) -> str:
    return provider_protocols.avatar_platform_for_provider(provider, is_apimart_provider=is_apimart_provider, is_volcengine_provider=is_volcengine_provider)

def provider_supports_avatar(provider) -> bool:
    return provider_protocols.provider_supports_avatar(provider, avatar_platform_for_provider=avatar_platform_for_provider, AVATAR_SUPPORTED_PLATFORMS=AVATAR_SUPPORTED_PLATFORMS)

def jimeng_env_value(key):
    return os.getenv(key, "") or read_api_env_value(key)

def jimeng_use_wsl():
    return jimeng_execution_service.jimeng_use_wsl(jimeng_env_value=jimeng_env_value)

def jimeng_cli_executable():
    return jimeng_execution_service.jimeng_cli_executable(jimeng_env_value=jimeng_env_value, jimeng_use_wsl=jimeng_use_wsl, shutil=shutil)

def jimeng_cli_missing_message():
    return jimeng_execution_service.jimeng_cli_missing_message(BASE_DIR=BASE_DIR, decode_wsl_output=decode_wsl_output, os=os, re=re, shutil=shutil, subprocess=subprocess)

def decode_utf16_auto(raw: bytes) -> str:
    # WSL/Windows interop emits UTF-16 for null-heavy diagnostics, but the
    # endianness varies by source (console vs proxy vs subprocess), so a
    # hard-coded "utf-16le" silently byte-swaps UTF-16BE text into garbage
    # (e.g. "localhost" -> 氀漀挀愀氀栀漀猀琀). Decode both ways and keep
    # whichever produces more plain ASCII, since diagnostics are ASCII-heavy.
    return jimeng_provider_protocol.decode_utf16_auto(raw)

def decode_wsl_output(data: bytes) -> str:
    return jimeng_provider_protocol.decode_wsl_output(data, decode_utf16_auto=decode_utf16_auto)

def jimeng_wsl_base_args(exe="wsl.exe"):
    return jimeng_execution_service.jimeng_wsl_base_args(exe, BASE_DIR=BASE_DIR, decode_wsl_output=decode_wsl_output, jimeng_env_value=jimeng_env_value, re=re, subprocess=subprocess, write_diagnostic=write_diagnostic)

def jimeng_clean_wsl_stderr(text):
    return jimeng_provider_protocol.jimeng_clean_wsl_stderr(text)

def jimeng_has_result_payload(raw):
    return jimeng_provider_protocol.jimeng_has_result_payload(raw)

def windows_path_to_wsl(path):
    return jimeng_provider_protocol.windows_path_to_wsl(path)

def wsl_path_to_windows(path):
    return jimeng_provider_protocol.wsl_path_to_windows(path)

def jimeng_cli_path_arg(path):
    return jimeng_provider_protocol.jimeng_cli_path_arg(path, jimeng_use_wsl=jimeng_use_wsl, windows_path_to_wsl=windows_path_to_wsl)

def jimeng_poll_seconds(default=JIMENG_DEFAULT_POLL_SECONDS):
    return jimeng_execution_service.jimeng_poll_seconds(default, os=os)

def jimeng_video_submit_poll_seconds():
    return jimeng_execution_service.jimeng_video_submit_poll_seconds(os=os)

def jimeng_extract_json(text):
    return jimeng_provider_protocol.jimeng_extract_json(text)

async def run_jimeng_cli(args, timeout=120, raw_text=False):
    return await jimeng_execution_service.run_jimeng_cli(args, timeout, raw_text, BASE_DIR=BASE_DIR, HTTPException=HTTPException, jimeng_cli_executable=jimeng_cli_executable, jimeng_cli_missing_message=jimeng_cli_missing_message, jimeng_command=jimeng_command, jimeng_decode_cli_output=jimeng_decode_cli_output, jimeng_extract_json=jimeng_extract_json, jimeng_friendly_error_detail=jimeng_friendly_error_detail, jimeng_has_result_payload=jimeng_has_result_payload, safe_cli_executable_name=safe_cli_executable_name, safe_cli_public_text=safe_cli_public_text, write_diagnostic=write_diagnostic)

# 旧版 dreamina CLI 将 submit_id 用 16 位 hex，v1.4.2 起升级为 UUID，
# 与当前轮询逻辑不兼容。这里做尽力而为的版本探测，失败不阻断主流程。
JIMENG_MIN_CLI_VERSION = (1, 4, 2)

def jimeng_parse_version(text):
    return jimeng_provider_protocol.jimeng_parse_version(text)

async def jimeng_cli_version():
    return await jimeng_execution_service.jimeng_cli_version(HTTPException=HTTPException, jimeng_parse_version=jimeng_parse_version, run_jimeng_cli=run_jimeng_cli)

def jimeng_command(clean_args, exe=None):
    return jimeng_execution_service.jimeng_command(clean_args, exe, jimeng_cli_executable=jimeng_cli_executable, jimeng_use_wsl=jimeng_use_wsl, jimeng_wsl_base_args=jimeng_wsl_base_args, shlex=shlex)

def jimeng_decode_cli_output(stdout, stderr):
    return jimeng_provider_protocol.jimeng_decode_cli_output(stdout, stderr, decode_wsl_output=decode_wsl_output, jimeng_clean_wsl_stderr=jimeng_clean_wsl_stderr, jimeng_use_wsl=jimeng_use_wsl)

def jimeng_login_text():
    return jimeng_execution_service.jimeng_login_text(JIMENG_LOGIN_SESSION=JIMENG_LOGIN_SESSION)

def jimeng_login_qr_from_text(text):
    return jimeng_execution_service.jimeng_login_qr_from_text(text, re=re)

async def jimeng_login_reader(proc):
    return await jimeng_execution_service.jimeng_login_reader(proc, JIMENG_LOGIN_SESSION=JIMENG_LOGIN_SESSION, asyncio=asyncio, decode_wsl_output=decode_wsl_output, jimeng_clean_wsl_stderr=jimeng_clean_wsl_stderr, jimeng_use_wsl=jimeng_use_wsl)

def jimeng_submit_id(raw):
    return jimeng_provider_protocol.jimeng_submit_id(raw)

class JimengPendingError(Exception):
    """即梦任务还在云端排队/生成（轮询超时但未失败）。submit_id 可用于后续续查。"""
    def __init__(self, submit_id, kind="image", queue_info=None, raw=None):
        self.submit_id = str(submit_id or "")
        self.kind = kind or "image"
        self.queue_info = queue_info if isinstance(queue_info, dict) else {}
        self.raw = raw
        super().__init__(f"jimeng pending submit_id={self.submit_id}")

def jimeng_queue_info(raw):
    return jimeng_provider_protocol.jimeng_queue_info(raw)

def jimeng_public_queue_info(value):
    return jimeng_provider_protocol.jimeng_public_queue_info(value)


def jimeng_pending_payload(exc: "JimengPendingError"):
    return jimeng_provider_protocol.jimeng_pending_payload(exc, jimeng_public_queue_info=jimeng_public_queue_info)

@app.exception_handler(JimengPendingError)
async def jimeng_pending_exception_handler(request: Request, exc: JimengPendingError):
    # 轮询超时但任务还在云端排队：返回 202 + submit_id，让前端保持「排队中」卡片并续查
    return JSONResponse(status_code=202, content=jimeng_pending_payload(exc))

def jimeng_failure_reason(raw):
    return jimeng_provider_protocol.jimeng_failure_reason(raw, jimeng_friendly_error_detail=jimeng_friendly_error_detail)


def jimeng_has_explicit_failure(raw):
    return jimeng_provider_protocol.jimeng_has_explicit_failure(raw)

def jimeng_friendly_error_detail(detail):
    return jimeng_provider_protocol.jimeng_friendly_error_detail(detail, provider_error_summary=provider_error_summary)

def jimeng_collect_media_values(value, outputs):
    return jimeng_provider_protocol.jimeng_collect_media_values(value, outputs, jimeng_collect_media_values=jimeng_collect_media_values)

def jimeng_output_values(raw):
    return jimeng_provider_protocol.jimeng_output_values(raw, jimeng_collect_media_values=jimeng_collect_media_values)

JIMENG_RATIO_CHOICES = [(21, 9), (16, 9), (3, 2), (4, 3), (1, 1), (3, 4), (2, 3), (9, 16)]
def jimeng_ratio_from_size(size, fallback="1:1"):
    return jimeng_provider_protocol.jimeng_ratio_from_size(size, fallback, JIMENG_RATIO_CHOICES=JIMENG_RATIO_CHOICES, parse_size_pair=parse_size_pair)

# 官方 dreamina 支持的图片模型（来自 text2image/image2image -h）。
# image2image 不支持 3.0/3.1。
JIMENG_TEXT2IMAGE_MODELS = {"3.0", "3.1", "4.0", "4.1", "4.5", "4.6", "4.7", "5.0", "5.0Pro"}
JIMENG_IMAGE2IMAGE_MODELS = {"4.0", "4.1", "4.5", "4.6", "4.7", "5.0", "5.0Pro"}

def jimeng_normalize_image_model(model):
    return jimeng_provider_protocol.jimeng_normalize_image_model(model)

def jimeng_image_model_version(model, mode="text2image"):
    return jimeng_provider_protocol.jimeng_image_model_version(model, mode, JIMENG_IMAGE2IMAGE_MODELS=JIMENG_IMAGE2IMAGE_MODELS, JIMENG_TEXT2IMAGE_MODELS=JIMENG_TEXT2IMAGE_MODELS, jimeng_normalize_image_model=jimeng_normalize_image_model)

def jimeng_image_resolution(model, size, mode="text2image"):
    return jimeng_provider_protocol.jimeng_image_resolution(model, size, mode, jimeng_normalize_image_model=jimeng_normalize_image_model, parse_size_pair=parse_size_pair)

JIMENG_VIDEO_HIGH_RES_MODELS = {"seedance2.0_vip"}
JIMENG_VIDEO_MODEL_VERSIONS = {
    "seedance1.0fast", "seedance1.5pro", "seedance2.0", "seedance2.0fast",
    "seedance2.0_vip", "seedance2.0fast_vip", "seedance2.0mini",
}
JIMENG_VIDEO_MODELS_BY_COMMAND = {
    "text2video": {"seedance2.0", "seedance2.0fast", "seedance2.0_vip", "seedance2.0fast_vip", "seedance2.0mini"},
    "image2video": {"seedance1.0fast", "seedance1.5pro", "seedance2.0", "seedance2.0fast", "seedance2.0_vip", "seedance2.0fast_vip", "seedance2.0mini"},
    "multimodal2video": {"seedance2.0", "seedance2.0fast", "seedance2.0_vip", "seedance2.0fast_vip", "seedance2.0mini"},
    "frames2video": {"seedance1.5pro", "seedance2.0", "seedance2.0fast", "seedance2.0_vip", "seedance2.0fast_vip", "seedance2.0mini"},
}

def jimeng_video_resolution(model, resolution):
    return jimeng_provider_protocol.jimeng_video_resolution(model, resolution, HTTPException=HTTPException, JIMENG_VIDEO_HIGH_RES_MODELS=JIMENG_VIDEO_HIGH_RES_MODELS, jimeng_video_model_version=jimeng_video_model_version)

# 各模型支持的时长区间（秒）：3.0 系列 3-10，3.5pro 4-12，seedance 4-15
def jimeng_video_duration_range(model, command=""):
    return jimeng_provider_protocol.jimeng_video_duration_range(model, command, jimeng_video_model_version=jimeng_video_model_version)

def jimeng_video_duration(duration, model=None, command=""):
    return jimeng_provider_protocol.jimeng_video_duration(duration, model, command, HTTPException=HTTPException, jimeng_video_duration_range=jimeng_video_duration_range, jimeng_video_model_version=jimeng_video_model_version)

def jimeng_transition_duration(total_duration, transition_count):
    return jimeng_provider_protocol.jimeng_transition_duration(total_duration, transition_count)

def jimeng_multiframe_transition_prompts(prompt, segments):
    return jimeng_provider_protocol.jimeng_multiframe_transition_prompts(prompt, segments)

def jimeng_video_model_version(model):
    return jimeng_provider_protocol.jimeng_video_model_version(model, JIMENG_VIDEO_MODEL_VERSIONS=JIMENG_VIDEO_MODEL_VERSIONS)

def jimeng_video_model_for_command(model, command):
    return jimeng_provider_protocol.jimeng_video_model_for_command(model, command, HTTPException=HTTPException, JIMENG_VIDEO_MODELS_BY_COMMAND=JIMENG_VIDEO_MODELS_BY_COMMAND, jimeng_video_model_version=jimeng_video_model_version)

def jimeng_video_resolution_arg(model, resolution):
    return jimeng_provider_protocol.jimeng_video_resolution_arg(model, resolution, jimeng_video_resolution=jimeng_video_resolution)

def jimeng_video_ratio_arg(aspect_ratio):
    return jimeng_provider_protocol.jimeng_video_ratio_arg(aspect_ratio)

def jimeng_video_ratio(aspect_ratio, default="16:9"):
    return jimeng_provider_protocol.jimeng_video_ratio(aspect_ratio, default, HTTPException=HTTPException, jimeng_video_ratio_arg=jimeng_video_ratio_arg)

def jimeng_append_model_resolution_args(args, payload: CanvasVideoRequest, model_version=""):
    return jimeng_provider_protocol.jimeng_append_model_resolution_args(args, payload, model_version, jimeng_video_resolution_arg=jimeng_video_resolution_arg)

def jimeng_multiframe_resolution(resolution):
    return jimeng_provider_protocol.jimeng_multiframe_resolution(resolution, HTTPException=HTTPException)

def jimeng_video_ref_role(ref):
    return jimeng_provider_protocol.jimeng_video_ref_role(ref)

def jimeng_video_ref_url(ref):
    return jimeng_provider_protocol.jimeng_video_ref_url(ref)

def jimeng_local_output_url(path, kind="image"):
    return jimeng_execution_service.jimeng_local_output_url(path, kind, OUTPUT_OUTPUT_DIR=OUTPUT_OUTPUT_DIR, content_type_for_path=content_type_for_path, output_path_for=output_path_for, output_url_for=output_url_for, shutil=shutil)

async def jimeng_store_output_value(value, kind="image"):
    return await jimeng_execution_service.jimeng_store_output_value(value, kind, jimeng_local_output_url=jimeng_local_output_url, jimeng_use_wsl=jimeng_use_wsl, save_ai_image_to_output=save_ai_image_to_output, save_remote_video_to_output=save_remote_video_to_output, wsl_path_to_windows=wsl_path_to_windows)

async def jimeng_query_result(submit_id, kind="image"):
    return await jimeng_execution_service.jimeng_query_result(submit_id, kind, OUTPUT_OUTPUT_DIR=OUTPUT_OUTPUT_DIR, jimeng_cli_path_arg=jimeng_cli_path_arg, jimeng_poll_seconds=jimeng_poll_seconds, run_jimeng_cli=run_jimeng_cli)

async def jimeng_store_outputs(raw, kind="image", allow_query=True):
    return await jimeng_execution_service.jimeng_store_outputs(raw, kind, allow_query, HTTPException=HTTPException, JimengPendingError=JimengPendingError, jimeng_failure_reason=jimeng_failure_reason, jimeng_output_values=jimeng_output_values, jimeng_query_result=jimeng_query_result, jimeng_queue_info=jimeng_queue_info, jimeng_store_output_value=jimeng_store_output_value, jimeng_store_outputs=jimeng_store_outputs, jimeng_submit_id=jimeng_submit_id, provider_error_summary=provider_error_summary)

async def jimeng_prepare_local_media(ref_url, kind="image"):
    return await jimeng_execution_service.jimeng_prepare_local_media(ref_url, kind, HTTPException=HTTPException, base64=base64, httpx=httpx, mimetypes=mimetypes, output_file_from_url=output_file_from_url, tempfile=tempfile)

async def generate_jimeng_provider_image(prompt, size, model, reference_images=None, provider=None):
    return await jimeng_execution_service.generate_jimeng_provider_image(prompt, size, model, reference_images, provider, jimeng_cli_path_arg=jimeng_cli_path_arg, jimeng_image_model_version=jimeng_image_model_version, jimeng_image_resolution=jimeng_image_resolution, jimeng_poll_seconds=jimeng_poll_seconds, jimeng_prepare_local_media=jimeng_prepare_local_media, jimeng_ratio_from_size=jimeng_ratio_from_size, jimeng_store_outputs=jimeng_store_outputs, run_jimeng_cli=run_jimeng_cli)

JIMENG_UPSCALE_RESOLUTIONS = {"2k", "4k", "8k"}

def jimeng_normalize_upscale_resolution(value):
    return jimeng_provider_protocol.jimeng_normalize_upscale_resolution(value, JIMENG_UPSCALE_RESOLUTIONS=JIMENG_UPSCALE_RESOLUTIONS)

async def generate_jimeng_upscale_image(reference_images, resolution_type):
    return await jimeng_execution_service.generate_jimeng_upscale_image(reference_images, resolution_type, HTTPException=HTTPException, jimeng_cli_path_arg=jimeng_cli_path_arg, jimeng_normalize_upscale_resolution=jimeng_normalize_upscale_resolution, jimeng_poll_seconds=jimeng_poll_seconds, jimeng_prepare_local_media=jimeng_prepare_local_media, jimeng_store_outputs=jimeng_store_outputs, run_jimeng_cli=run_jimeng_cli)

async def generate_jimeng_video(payload: CanvasVideoRequest, provider):
    return await jimeng_execution_service.generate_jimeng_video(payload, provider, HTTPException=HTTPException, _notify_canvas_video_remote_accept=_notify_canvas_video_remote_accept, jimeng_append_model_resolution_args=jimeng_append_model_resolution_args, jimeng_cli_path_arg=jimeng_cli_path_arg, jimeng_multiframe_resolution=jimeng_multiframe_resolution, jimeng_multiframe_transition_prompts=jimeng_multiframe_transition_prompts, jimeng_poll_seconds=jimeng_poll_seconds, jimeng_prepare_local_media=jimeng_prepare_local_media, jimeng_store_outputs=jimeng_store_outputs, jimeng_submit_id=jimeng_submit_id, jimeng_transition_duration=jimeng_transition_duration, jimeng_video_duration=jimeng_video_duration, jimeng_video_model_for_command=jimeng_video_model_for_command, jimeng_video_ratio=jimeng_video_ratio, jimeng_video_ref_role=jimeng_video_ref_role, jimeng_video_ref_url=jimeng_video_ref_url, jimeng_video_submit_poll_seconds=jimeng_video_submit_poll_seconds, run_jimeng_cli=run_jimeng_cli)

def image_task_url_for_provider(provider, task_id):
    return image_provider_service.image_task_url_for_provider(provider, task_id, AI_BASE_URL=AI_BASE_URL, is_tudou_async_image_mode=is_tudou_async_image_mode, normalize_image_request_mode=normalize_image_request_mode, is_apimart_provider=is_apimart_provider)

def image_task_fail_reason(payload):
    return upstream_public_policy.image_task_fail_reason(payload, image_task_data=image_task_data, provider_error_summary=provider_error_summary)

async def httpx_request_with_transient_retries(client, method, url, attempts=2, retry_delay=1.2, **kwargs):
    return await upstream_http_service.httpx_request_with_transient_retries(client, method, url, attempts, retry_delay, kwargs, asyncio=asyncio, httpx=httpx, write_diagnostic=write_diagnostic, redact_url_for_log=redact_url_for_log, redact_log_text=redact_log_text)

async def fetch_image_task_payload(client, task_id, provider=None):
    return await image_provider_service.fetch_image_task_payload(client, task_id, provider, image_task_url_for_provider=image_task_url_for_provider, httpx_request_with_transient_retries=httpx_request_with_transient_retries, api_headers=api_headers)

async def wait_for_image_task(client, task_id, provider=None):
    return await image_provider_service.wait_for_image_task(client, task_id, provider, is_apimart_provider=is_apimart_provider, is_tudou_async_image_mode=is_tudou_async_image_mode, TUDOU_ASYNC_IMAGE_TASK_TIMEOUT=TUDOU_ASYNC_IMAGE_TASK_TIMEOUT, APIMART_IMAGE_TASK_TIMEOUT=APIMART_IMAGE_TASK_TIMEOUT, IMAGE_TASK_TIMEOUT=IMAGE_TASK_TIMEOUT, TUDOU_ASYNC_IMAGE_POLL_INTERVAL=TUDOU_ASYNC_IMAGE_POLL_INTERVAL, APIMART_IMAGE_POLL_INTERVAL=APIMART_IMAGE_POLL_INTERVAL, IMAGE_POLL_INTERVAL=IMAGE_POLL_INTERVAL, TUDOU_ASYNC_IMAGE_INITIAL_POLL_DELAY=TUDOU_ASYNC_IMAGE_INITIAL_POLL_DELAY, APIMART_IMAGE_INITIAL_POLL_DELAY=APIMART_IMAGE_INITIAL_POLL_DELAY, time=time, asyncio=asyncio, fetch_image_task_payload=fetch_image_task_payload, image_task_status=image_task_status, extract_image=extract_image, HTTPException=HTTPException, IMAGE_TASK_SUCCESS_STATUSES=IMAGE_TASK_SUCCESS_STATUSES, IMAGE_TASK_FAILED_STATUSES=IMAGE_TASK_FAILED_STATUSES, image_task_fail_reason=image_task_fail_reason, provider_error_summary=provider_error_summary, _safe_upstream_text=_safe_upstream_text)

def output_storage(category="output"):
    return resolve_output_storage(category, _current_storage_dirs())


def _current_storage_dirs():
    """返回当前已生效的存储目录；配置读写仍由入口层管理。"""

    return {
        "upload": OUTPUT_INPUT_DIR,
        "generated": OUTPUT_OUTPUT_DIR,
        "local": LOCAL_UPLOAD_DIR,
    }

def output_url_for(filename, category="output"):
    return resolve_output_url(filename, category, _current_storage_dirs(), ASSETS_DIR)

def output_path_for(filename, category="output"):
    return resolve_output_path(filename, category, _current_storage_dirs())

def storage_kind_dir(kind):
    try:
        return storage_kind_root(kind, _current_storage_dirs())
    except UnknownStorageKind as exc:
        raise HTTPException(status_code=404, detail="未知存储目录") from exc

def storage_file_path(kind, rel):
    try:
        return resolve_storage_file_path(kind, rel, _current_storage_dirs())
    except UnknownStorageKind as exc:
        raise HTTPException(status_code=404, detail="未知存储目录") from exc
    except UnsafeStoragePath as exc:
        raise HTTPException(status_code=400, detail="非法文件路径") from exc

def output_file_from_url(url):
    try:
        return resolve_output_file(
            url,
            _current_storage_dirs(),
            ASSETS_DIR,
            OUTPUT_DIR,
        )
    except UnknownStorageKind as exc:
        raise HTTPException(status_code=404, detail="未知存储目录") from exc
    except UnsafeStoragePath as exc:
        raise HTTPException(status_code=400, detail="非法文件路径") from exc

def local_media_path_from_url(url: str) -> Optional[str]:
    return media_storage_service.local_media_path_from_url(url, ASSETS_DIR=ASSETS_DIR, OUTPUT_DIR=OUTPUT_DIR, storage_file_path=storage_file_path)

_canvas_clip_manager = None
_canvas_clip_manager_key = None
_canvas_clip_manager_lock = Lock()


def canvas_clip_manager():
    global _canvas_clip_manager, _canvas_clip_manager_key
    key = (os.path.realpath(DATA_DIR), os.path.realpath(OUTPUT_OUTPUT_DIR))
    with _canvas_clip_manager_lock:
        if _canvas_clip_manager is None or _canvas_clip_manager_key != key:
            dirs = dict(_current_storage_dirs())
            assets_root, legacy_output = ASSETS_DIR, OUTPUT_DIR

            def clip_local_path(url):
                # 捕获任务开始时的存储映射，避免用户切换存储目录后读到别的素材。
                return resolve_output_file(url, dirs, assets_root, legacy_output)

            _canvas_clip_manager = CanvasClipManager(
                DATA_DIR, OUTPUT_OUTPUT_DIR,
                lambda name: resolve_output_url(name, "output", dirs, assets_root),
                clip_local_path,
                [assets_root, legacy_output, *dirs.values()],
                rewrite_url=rewrite_runninghub_file_url,
            )
            _canvas_clip_manager_key = key
        return _canvas_clip_manager


@app.post("/api/canvas-clip/export")
def create_canvas_clip_export(payload: Dict[str, Any]):
    try:
        task = canvas_clip_manager().create(payload)
    except CanvasClipConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {key: task[key] for key in ("id", "status", "canvas_id", "node_id")}


@app.get("/api/canvas-clip/tasks/{task_id}")
def get_canvas_clip_export(task_id: str):
    if not re.fullmatch(r"[0-9a-f]{32}", task_id):
        raise HTTPException(status_code=404, detail="剪辑导出任务不存在")
    task = canvas_clip_manager().get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="剪辑导出任务不存在")
    return task


_depth_capture_manager = None
_depth_capture_manager_key = None
_depth_capture_manager_lock = Lock()


def canvas_depth_capture_manager():
    global _depth_capture_manager, _depth_capture_manager_key
    key = (os.path.realpath(DATA_DIR), os.path.realpath(OUTPUT_OUTPUT_DIR))
    with _depth_capture_manager_lock:
        if _depth_capture_manager is None or _depth_capture_manager_key != key:
            _depth_capture_manager = DepthCaptureManager(
                DATA_DIR, OUTPUT_OUTPUT_DIR, lambda name: output_url_for(name, "output")
            )
            _depth_capture_manager_key = key
        return _depth_capture_manager


def public_depth_capture_task(task):
    return {key: value for key, value in task.items()
            if key not in {"source_path", "fallback_reason"}}


@app.post("/api/canvas-depth-capture")
def create_canvas_depth_capture(request: CanvasDepthCaptureRequest):
    if not re.fullmatch(r"[A-Za-z0-9_-]{20,100}", request.operation_id):
        raise HTTPException(status_code=400, detail="操作编号无效")
    try:
        source_path = local_media_path_from_url(request.source_url)
    except (HTTPException, OSError, ValueError):
        source_path = None
    if not source_path:
        raise HTTPException(status_code=400, detail="请先将视频保存到本地素材库或画布")
    source = os.path.realpath(source_path)
    roots = [ASSETS_DIR, OUTPUT_DIR, *_current_storage_dirs().values()]
    try:
        allowed = any(os.path.commonpath([source, os.path.realpath(root)]) == os.path.realpath(root)
                      for root in roots if root)
    except ValueError:
        allowed = False
    if not allowed:
        raise HTTPException(status_code=400, detail="视频路径超出本地素材目录")
    if not os.path.isfile(source) or os.path.splitext(source)[1].lower() not in {".mp4", ".mov", ".webm"}:
        raise HTTPException(status_code=400, detail="请选择 MP4、MOV 或 WebM 视频")
    try:
        task = canvas_depth_capture_manager().create(request.source_url, source, request.operation_id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return public_depth_capture_task(task)


@app.get("/api/canvas-depth-capture/{task_id}")
def get_canvas_depth_capture(task_id: str):
    if not re.fullmatch(r"[0-9a-f]{32}", task_id):
        raise HTTPException(status_code=404, detail="深度任务不存在")
    task = canvas_depth_capture_manager().get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="深度任务不存在")
    return public_depth_capture_task(task)


@app.post("/api/canvas-depth-capture/{task_id}/cancel")
def cancel_canvas_depth_capture(task_id: str):
    if not re.fullmatch(r"[0-9a-f]{32}", task_id):
        raise HTTPException(status_code=404, detail="深度任务不存在")
    task = canvas_depth_capture_manager().cancel(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="深度任务不存在")
    return public_depth_capture_task(task)


def generated_media_path_from_url(url: str) -> Optional[str]:
    return media_cleanup_service.generated_media_path_from_url(url, HTTPException=HTTPException, OUTPUT_DIR=OUTPUT_DIR, OUTPUT_OUTPUT_DIR=OUTPUT_OUTPUT_DIR, local_media_path_from_url=local_media_path_from_url)

def json_references_media_path(value: Any, target_path: str) -> bool:
    """兼容入口：用应用的本地 URL 映射器执行纯引用匹配规则。"""

    return json_value_references_media_path(value, target_path, local_media_path_from_url)

def persisted_json_references_media_path(target_path: str) -> bool:
    return media_cleanup_service.persisted_json_references_media_path(target_path, ASSET_LIBRARY_PATH=ASSET_LIBRARY_PATH, CANVAS_DIR=CANVAS_DIR, CONVERSATION_DIR=CONVERSATION_DIR, json_references_media_path=json_references_media_path)

class HistoryPruneError(Exception):
    """历史卡片未能安全清理，调用方必须保留对应媒体。"""


def prune_generation_history_for_media(paths: List[str]) -> int:
    return media_cleanup_service.prune_generation_history_for_media(paths, HISTORY_FILE=HISTORY_FILE, HISTORY_LOCK=HISTORY_LOCK, HistoryPruneError=HistoryPruneError, json_references_media_path=json_references_media_path, write_json_atomic=write_json_atomic)

def smart_owned_result_items(images: List[Any], paths: List[str]) -> List[Any]:
    return media_cleanup_service.smart_owned_result_items(images, paths, json_references_media_path=json_references_media_path)

def expand_canvas_generated_media_paths(canvas: Dict[str, Any], paths: List[str]) -> List[str]:
    return media_cleanup_service.expand_canvas_generated_media_paths(canvas, paths, collect_local_media_urls=collect_local_media_urls, generated_media_path_from_url=generated_media_path_from_url, json_references_media_path=json_references_media_path, smart_owned_result_items=smart_owned_result_items)

def reset_canvas_result_nodes_for_media(canvas: Dict[str, Any], paths: List[str]) -> List[str]:
    return media_cleanup_service.reset_canvas_result_nodes_for_media(canvas, paths, json_references_media_path=json_references_media_path, smart_owned_result_items=smart_owned_result_items)

def delete_media_preview_cache(path: str) -> int:
    return media_cleanup_service.delete_media_preview_cache(path, MEDIA_PREVIEW_DIR=MEDIA_PREVIEW_DIR)

def image_has_alpha(img: Image.Image) -> bool:
    return media_storage_service.image_has_alpha(img)

STORAGE_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif"}

def storage_file_item(kind, root, path):
    return media_storage_service.storage_file_item(kind, root, path, Image=Image)

@app.get("/api/storage-settings")
async def get_storage_settings():
    settings = load_storage_settings()
    return {
        "dirs": settings["dirs"],
        "defaults": {key: os.path.abspath(value) for key, value in DEFAULT_STORAGE_DIRS.items()},
    }

@app.patch("/api/storage-settings")
async def update_storage_settings(payload: Dict[str, str]):
    return save_storage_settings(payload or {})

@app.get("/api/storage-files")
async def list_storage_files(kind: str = "generated", offset: int = 0, limit: int = 80):
    return await media_storage_service.list_storage_files(kind, offset, limit, STORAGE_IMAGE_EXTS=STORAGE_IMAGE_EXTS, storage_file_item=storage_file_item, storage_kind_dir=storage_kind_dir)

@app.get("/api/storage-files/{kind}/{rel_path:path}")
async def get_storage_file(kind: str, rel_path: str):
    return await media_storage_service.get_storage_file(kind, rel_path, FileResponse=FileResponse, HTTPException=HTTPException, content_type_for_path=content_type_for_path, storage_file_path=storage_file_path)

@app.post("/api/storage-files/delete")
async def delete_storage_files(payload: Dict[str, Any]):
    return await media_storage_service.delete_storage_files(payload, ASSET_LIBRARY_LOCK=ASSET_LIBRARY_LOCK, CANVAS_LOCK=CANVAS_LOCK, CONVERSATION_LOCK=CONVERSATION_LOCK, HISTORY_FILE=HISTORY_FILE, HISTORY_LOCK=HISTORY_LOCK, HTTPException=HTTPException, json_references_media_path=json_references_media_path, persisted_json_references_media_path=persisted_json_references_media_path, storage_file_path=storage_file_path, storage_kind_dir=storage_kind_dir)

@app.get("/api/asset-classification-prompt")
async def get_asset_classification_prompt():
    current = load_asset_classification_prompt()
    return {
        "prompt": current,
        "default_prompt": ASSET_CLASSIFICATION_PROMPT,
        "custom": current.strip() != ASSET_CLASSIFICATION_PROMPT.strip(),
    }

@app.patch("/api/asset-classification-prompt")
async def update_asset_classification_prompt(payload: Dict[str, str]):
    prompt = save_asset_classification_prompt((payload or {}).get("prompt") or "")
    return {"prompt": prompt, "custom": True}

def media_preview_cache_paths(path: str, width: int):
    return media_storage_service.media_preview_cache_paths(path, width, MEDIA_PREVIEW_DIR=MEDIA_PREVIEW_DIR)

def is_video_preview_file(path: str) -> bool:
    return media_storage_service.is_video_preview_file(path)

def generate_video_preview_image(path: str, width: int) -> Image.Image:
    return media_storage_service.generate_video_preview_image(path, width, Image=Image, ImageOps=ImageOps, shutil=shutil, subprocess=subprocess)

@app.get("/api/media-preview")
async def media_preview(url: str, w: int = 512):
    return await media_storage_service.media_preview(url, w, FileResponse=FileResponse, HTTPException=HTTPException, Image=Image, ImageOps=ImageOps, MEDIA_PREVIEW_DIR=MEDIA_PREVIEW_DIR, generate_video_preview_image=generate_video_preview_image, image_has_alpha=image_has_alpha, is_video_preview_file=is_video_preview_file, media_preview_cache_paths=media_preview_cache_paths, output_file_from_url=output_file_from_url, write_diagnostic=write_diagnostic)

@app.get("/api/image-jpeg")
async def image_jpeg(url: str, w: int = 0):
    return await media_storage_service.image_jpeg(url, w, FileResponse=FileResponse, HTTPException=HTTPException, Image=Image, ImageOps=ImageOps, MEDIA_PREVIEW_DIR=MEDIA_PREVIEW_DIR, output_file_from_url=output_file_from_url, write_diagnostic=write_diagnostic)

def local_media_file_by_basename(name: str):
    return media_storage_service.local_media_file_by_basename(name, OUTPUT_OUTPUT_DIR=OUTPUT_OUTPUT_DIR, OUTPUT_INPUT_DIR=OUTPUT_INPUT_DIR, ASSETS_DIR=ASSETS_DIR)

def fetch_remote_media_bytes(url: str, timeout: float = 30.0, max_bytes: int = 200 * 1024 * 1024):
    return provider_media_transfer.fetch_remote_media_bytes(url, timeout, max_bytes, rewrite_runninghub_file_url=rewrite_runninghub_file_url, urllib=urllib, requests=requests, HTTPException=HTTPException)

def origin_from_url(value):
    parsed = urllib.parse.urlparse(str(value or ""))
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return ""
    return f"{parsed.scheme}://{parsed.netloc}".lower()

def ensure_same_origin_request(request: Request):
    host = str(request.headers.get("host") or "").lower()
    expected = f"{request.url.scheme}://{host}".lower() if host else ""
    origin = origin_from_url(request.headers.get("origin", ""))
    referer = origin_from_url(request.headers.get("referer", ""))
    actual = origin or referer
    if expected and actual != expected:
        raise HTTPException(status_code=403, detail="只允许从当前页面导入本地图片")

def normalize_local_image_path(value):
    return upload_service.normalize_local_image_path(value, HTTPException=HTTPException)

def import_local_image_file(path):
    return upload_service.import_local_image_file(path, HTTPException=HTTPException, LOCAL_IMAGE_IMPORT_EXTS=LOCAL_IMAGE_IMPORT_EXTS, LOCAL_IMAGE_IMPORT_MAX_BYTES=LOCAL_IMAGE_IMPORT_MAX_BYTES, Image=Image, output_path_for=output_path_for, output_url_for=output_url_for)

def default_asset_library():
    return asset_library_index.default_asset_library(now_ms=now_ms)

def normalize_asset_library(lib):
    return asset_library_index.normalize_asset_library(lib, default_asset_library=default_asset_library, sanitize_asset_name=sanitize_asset_name, migrate_asset_item_registrations=migrate_asset_item_registrations, sort_asset_library_items=sort_asset_library_items, now_ms=now_ms)

AVATAR_LEGACY_FLAT_FIELDS = ("platform", "provider_id", "project_name", "avatar_task_id",
                             "avatar_status", "avatar_detail", "asset_uri", "asset_id", "registered_at")

def migrate_asset_item_registrations(item):
    return asset_library_index.migrate_asset_item_registrations(item, AVATAR_LEGACY_FLAT_FIELDS=AVATAR_LEGACY_FLAT_FIELDS)

@contextmanager
def asset_library_index_lock():
    """按进程内锁、索引文件锁的顺序保护素材库索引。"""

    with ASSET_LIBRARY_LOCK:
        path = os.path.abspath(os.fspath(ASSET_LIBRARY_PATH))
        held_path = getattr(ASSET_LIBRARY_LOCK_STATE, "path", None)
        if held_path is not None:
            if held_path != path:
                raise RuntimeError("素材库索引锁定期间路径发生变化")
            yield
            return
        with interprocess_file_lock(path):
            ASSET_LIBRARY_LOCK_STATE.path = path
            try:
                yield
            finally:
                del ASSET_LIBRARY_LOCK_STATE.path


def load_asset_library():
    return asset_library_index.load_asset_library(asset_library_index_lock=asset_library_index_lock, ASSET_LIBRARY_PATH=ASSET_LIBRARY_PATH, default_asset_library=default_asset_library, save_asset_library=save_asset_library, HTTPException=HTTPException, normalize_asset_library=normalize_asset_library)

def sort_asset_library_items(lib):
    return asset_library_index.sort_asset_library_items(lib)

def unique_asset_category_dir(library, base_name: str) -> str:
    return asset_library_files.unique_asset_category_dir(library, base_name, sanitize_asset_name=sanitize_asset_name, ASSET_LIBRARY_DIR=ASSET_LIBRARY_DIR)

def remove_asset_library_file(item) -> None:
    return asset_library_files.remove_asset_library_file(item, local_media_path_from_url=local_media_path_from_url, ASSET_LIBRARY_DIR=ASSET_LIBRARY_DIR, CANVAS_LOCK=CANVAS_LOCK, HISTORY_LOCK=HISTORY_LOCK, CONVERSATION_LOCK=CONVERSATION_LOCK, HISTORY_FILE=HISTORY_FILE, json_references_media_path=json_references_media_path, ASSET_LIBRARY_LOCK=ASSET_LIBRARY_LOCK, persisted_json_references_media_path=persisted_json_references_media_path, write_diagnostic=write_diagnostic)

def make_asset_library_item(src: str, name: str = "", subdir: str = "") -> Tuple[str, Dict[str, Any]]:
    return asset_library_files.make_asset_library_item(src, name, subdir, asset_library_media_kind=asset_library_media_kind, asset_library_safe_extension=asset_library_safe_extension, sanitize_asset_name=sanitize_asset_name, ASSET_LIBRARY_DIR=ASSET_LIBRARY_DIR, asset_library_file_fingerprint=asset_library_file_fingerprint, now_ms=now_ms)


def asset_library_file_fingerprint(path: str) -> Tuple[int, str]:
    return asset_library_files.asset_library_file_fingerprint(path)


def find_duplicate_asset_library_item(category: Dict[str, Any], candidate: Dict[str, Any]):
    return asset_library_files.find_duplicate_asset_library_item(category, candidate, ASSET_LIBRARY_DIR=ASSET_LIBRARY_DIR, asset_library_media_kind=asset_library_media_kind, local_media_path_from_url=local_media_path_from_url, asset_library_file_fingerprint=asset_library_file_fingerprint)

ASSET_CLASSIFICATION_PROMPT = """请识别这张图片，输出严格 JSON，不要 Markdown，不要解释。
目标是给素材库做非常全面的筛选分类。所有字段都用中文短标签数组，尽量具体但不要虚构。
JSON 结构：
{
  "summary": "一句话描述",
  "categories": {
    "environment": ["室内/室外/自然/城市/棚拍/商业空间等环境大类"],
    "scene": ["室内/室外/棚拍/街景/自然/商业空间等"],
    "space": ["卧室/餐厅/客厅/厨房/浴室/办公室/店铺/展厅/户外道路等"],
    "subject": ["人物/模特/产品/家具/建筑/食物/动物/车辆/植物等"],
    "model": ["无人/单人模特/多人模特/男性模特/女性模特/儿童模特/半身模特/全身模特/手部模特等"],
    "people": ["无人/单人/多人/男性/女性/儿童/半身/全身/手部特写等"],
    "style": ["写实/摄影/插画/3D/极简/奢华/复古/现代/电商/电影感等"],
    "lighting": ["自然光/硬光/柔光/逆光/侧光/夜景/暖光/冷光/高对比/低对比等"],
    "color": ["白色/黑色/暖色/冷色/高饱和/低饱和/莫兰迪/金属色等"],
    "composition": ["近景/中景/远景/俯拍/仰拍/正面/侧面/居中/留白/对称/特写等"],
    "mood": ["温馨/高级/清爽/科技/自然/浪漫/神秘/活力/安静等"],
    "use_case": ["广告/电商主图/海报/社媒/样机/参考图/背景/角色参考/空间参考等"],
    "objects": ["画面中重要物体"],
    "materials": ["木材/金属/玻璃/布料/皮革/石材/陶瓷等"],
    "quality": ["高清/模糊/低清/噪点/水印/截图/透明背景等"]
  },
  "tags": ["综合关键词，20个以内"]
}
要求：只返回可解析 JSON；每个数组最多 8 项；如果不确定就省略该标签。"""
ASSET_CLASSIFICATION_PROMPT_FILE = os.path.join(DATA_DIR, "asset_classification_prompt.txt")

def load_asset_classification_prompt():
    try:
        if os.path.isfile(ASSET_CLASSIFICATION_PROMPT_FILE):
            with open(ASSET_CLASSIFICATION_PROMPT_FILE, "r", encoding="utf-8-sig") as f:
                text = f.read().strip()
                if text:
                    return text
    except Exception as exc:
        write_diagnostic(f"asset classification rule load failed error={type(exc).__name__}")
    return ASSET_CLASSIFICATION_PROMPT

def save_asset_classification_prompt(text):
    value = str(text or "").strip()
    if not value:
        raise HTTPException(status_code=400, detail="分类规则不能为空")
    if len(value) > 20000:
        raise HTTPException(status_code=400, detail="分类规则过长")
    os.makedirs(DATA_DIR, exist_ok=True)
    write_text_atomic(ASSET_CLASSIFICATION_PROMPT_FILE, value, encoding="utf-8", newline="")
    return value


def _local_upload_classification_path(filename):
    return local_asset_service._local_upload_classification_path(filename, LOCAL_UPLOAD_DIR=LOCAL_UPLOAD_DIR)


def _read_local_upload_classification(filename):
    return local_asset_service._read_local_upload_classification(filename, _local_upload_classification_path=_local_upload_classification_path, now_ms=now_ms)

def _write_local_upload_classification(filename, classification):
    return local_asset_service._write_local_upload_classification(filename, classification, _local_upload_classification_path=_local_upload_classification_path, now_ms=now_ms, write_json_atomic=write_json_atomic)

def asset_classification_prompt(extra_prompt=""):
    base = load_asset_classification_prompt()
    extra = str(extra_prompt or "").strip()
    if not extra:
        return base
    return base + "\n\n用户补充分类要求：\n" + extra[:4000]

async def classify_image_with_provider(abs_path, provider_id="", model="", ms_model="", prompt=""):
    text, resolved_model = await caption_image_with_provider(
        abs_path,
        asset_classification_prompt(prompt),
        provider_id or get_primary_provider_id(),
        model,
        ms_model,
    )
    classification = asset_media_rules.parse_asset_classification_text(text, now_ms=now_ms)
    classification["model"] = resolved_model
    classification["provider"] = provider_id or get_primary_provider_id()
    return classification

async def classify_asset_image_best_effort(abs_path, provider_id="", model="", ms_model="", prompt=""):
    try:
        return await classify_image_with_provider(abs_path, provider_id, model, ms_model, prompt)
    except Exception as exc:
        write_diagnostic(f"asset classification failed error={type(exc).__name__}")
        return None

def migrate_asset_library_into_dirs():
    with asset_library_index_lock():
        _migrate_asset_library_into_dirs_locked()

def _migrate_asset_library_into_dirs_locked():
    return asset_library_files._migrate_asset_library_into_dirs_locked(load_asset_library=load_asset_library, write_diagnostic=write_diagnostic, unique_asset_category_dir=unique_asset_category_dir, ASSET_LIBRARY_DIR=ASSET_LIBRARY_DIR, save_asset_library=save_asset_library)

def asset_library_workflow_category(lib, library_id="", category_id=""):
    return workflow_archive_service.asset_library_workflow_category(lib, library_id, category_id, HTTPException=HTTPException, find_asset_library=find_asset_library)

def make_workflow_library_item_from_bytes(raw: bytes, filename: str, name: str = "") -> Dict[str, Any]:
    return workflow_archive_service.make_workflow_library_item_from_bytes(raw, filename, name, ASSET_LIBRARY_DIR=ASSET_LIBRARY_DIR, BytesIO=BytesIO, HTTPException=HTTPException, now_ms=now_ms, sanitize_asset_name=sanitize_asset_name, sanitize_export_filename=sanitize_export_filename, validate_workflow_zip_limits=validate_workflow_zip_limits)

def save_asset_library(lib):
    return asset_library_index.save_asset_library(lib, asset_library_index_lock=asset_library_index_lock, normalize_asset_library=normalize_asset_library, sort_asset_library_items=sort_asset_library_items, now_ms=now_ms, write_json_atomic=write_json_atomic, ASSET_LIBRARY_PATH=ASSET_LIBRARY_PATH, schedule_coroutine=schedule_coroutine, manager=manager)

def serialize_asset_library_update(route):
    """Serialise routes whose read/modify/save body contains no await."""
    from functools import wraps

    @wraps(route)
    async def wrapped(*args, **kwargs):
        with asset_library_index_lock():
            return await route(*args, **kwargs)

    return wrapped

def find_asset_category(lib, category_id):
    return asset_library_index.find_asset_category(lib, category_id)

def find_asset_library(lib, library_id=""):
    return asset_library_index.find_asset_library(lib, library_id, normalize_asset_library=normalize_asset_library)

def find_asset_category_in_library(lib, category_id, library_id=""):
    return asset_library_index.find_asset_category_in_library(lib, category_id, library_id, find_asset_library=find_asset_library)

def find_asset_category_with_library(lib, category_id, library_id=""):
    return asset_library_index.find_asset_category_with_library(lib, category_id, library_id, normalize_asset_library=normalize_asset_library)

# ---------------- 共享文件夹（局域网只读浏览/引用） ----------------
SHARED_MEDIA_EXTS = {
    ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp",
    ".mp4", ".webm", ".mov", ".m4v", ".mkv",
    ".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac",
}
SHARED_SCAN_MAX_ENTRIES = 8000
SHARED_FOLDERS_LOCK = RLock()

def _shared_folders_load_unlocked():
    return shared_folder_service._shared_folders_load_unlocked(SHARED_FOLDERS_FILE=SHARED_FOLDERS_FILE)

def shared_folders_load():
    return shared_folder_service.shared_folders_load(SHARED_FOLDERS_FILE=SHARED_FOLDERS_FILE, SHARED_FOLDERS_LOCK=SHARED_FOLDERS_LOCK, _shared_folders_load_unlocked=_shared_folders_load_unlocked, interprocess_file_lock=interprocess_file_lock)

def _shared_folders_save_unlocked(data):
    return shared_folder_service._shared_folders_save_unlocked(data, DATA_DIR=DATA_DIR, SHARED_FOLDERS_FILE=SHARED_FOLDERS_FILE, write_json_atomic=write_json_atomic)

def shared_folders_save(data):
    return shared_folder_service.shared_folders_save(data, SHARED_FOLDERS_FILE=SHARED_FOLDERS_FILE, SHARED_FOLDERS_LOCK=SHARED_FOLDERS_LOCK, _shared_folders_save_unlocked=_shared_folders_save_unlocked, interprocess_file_lock=interprocess_file_lock)

def _save_shared_folders_or_raise(data, *, locked=False):
    return shared_folder_service._save_shared_folders_or_raise(data, locked=locked, HTTPException=HTTPException, _shared_folders_save_unlocked=_shared_folders_save_unlocked, shared_folders_save=shared_folders_save)

def _shared_folders_update(mutator):
    return shared_folder_service._shared_folders_update(mutator, SHARED_FOLDERS_FILE=SHARED_FOLDERS_FILE, SHARED_FOLDERS_LOCK=SHARED_FOLDERS_LOCK, _save_shared_folders_or_raise=_save_shared_folders_or_raise, _shared_folders_load_unlocked=_shared_folders_load_unlocked, interprocess_file_lock=interprocess_file_lock)

def shared_folder_by_id(folder_id):
    return shared_folder_service.shared_folder_by_id(folder_id, shared_folders_load=shared_folders_load)

def shared_folder_abs(entry):
    return shared_folder_service.shared_folder_abs(entry, BASE_DIR=BASE_DIR)

def shared_resolve_register(path):
    return shared_folder_service.shared_resolve_register(path, BASE_DIR=BASE_DIR, HTTPException=HTTPException)

def shared_child_abs(folder_abs, rel):
    return shared_folder_service.shared_child_abs(folder_abs, rel, HTTPException=HTTPException)

def image_path_to_data_url(path, max_size=1024):
    return media_reference_service.image_path_to_data_url(path, max_size, BytesIO=BytesIO, Image=Image, base64=base64, content_type_for_path=content_type_for_path, write_diagnostic=write_diagnostic)

def scan_shared_tree(folder_id, folder_abs, rel_prefix="", display="", counter=None):
    return shared_folder_service.scan_shared_tree(folder_id, folder_abs, rel_prefix, display, counter, SHARED_MEDIA_EXTS=SHARED_MEDIA_EXTS, SHARED_SCAN_MAX_ENTRIES=SHARED_SCAN_MAX_ENTRIES, asset_library_media_kind=asset_library_media_kind, scan_shared_tree=scan_shared_tree)

def builtin_prompt_templates():
    return prompt_library_service.builtin_prompt_templates(parse_prompt_template_markdown=parse_prompt_template_markdown, prompt_template_markdown_path=prompt_template_markdown_path, write_diagnostic=write_diagnostic)

def normalize_prompt_category_id(category="custom"):
    return prompt_library_service.normalize_prompt_category_id(category)

def normalize_prompt_library_item(item):
    return prompt_library_service.normalize_prompt_library_item(item, normalize_prompt_category_id=normalize_prompt_category_id, now_ms=now_ms, sanitize_asset_name=sanitize_asset_name)

def seed_system_prompt_library():
    return prompt_library_service.seed_system_prompt_library(builtin_prompt_templates=builtin_prompt_templates, defaultPromptTemplateCategories=defaultPromptTemplateCategories)

def default_prompt_libraries():
    return prompt_library_service.default_prompt_libraries(now_ms=now_ms, seed_system_prompt_library=seed_system_prompt_library)

def defaultPromptTemplateCategories():
    return prompt_library_service.defaultPromptTemplateCategories()

def normalize_prompt_template_categories(*category_lists, include_defaults=True):
    return prompt_library_service.normalize_prompt_template_categories(*category_lists, include_defaults=include_defaults, defaultPromptTemplateCategories=defaultPromptTemplateCategories, normalize_prompt_category_id=normalize_prompt_category_id, sanitize_asset_name=sanitize_asset_name)

def normalize_prompt_libraries(data):
    return prompt_library_service.normalize_prompt_libraries(data, default_prompt_libraries=default_prompt_libraries, normalize_prompt_category_id=normalize_prompt_category_id, normalize_prompt_library_item=normalize_prompt_library_item, normalize_prompt_template_categories=normalize_prompt_template_categories, now_ms=now_ms, sanitize_asset_name=sanitize_asset_name, seed_system_prompt_library=seed_system_prompt_library)

def _save_prompt_libraries_unlocked(data):
    return prompt_library_service._save_prompt_libraries_unlocked(data, DATA_DIR=DATA_DIR, PROMPT_LIBRARY_PATH=PROMPT_LIBRARY_PATH, normalize_prompt_libraries=normalize_prompt_libraries, now_ms=now_ms, write_json_atomic=write_json_atomic)

def _load_prompt_libraries_unlocked(*, strict=False):
    return prompt_library_service._load_prompt_libraries_unlocked(strict=strict, HTTPException=HTTPException, PROMPT_LIBRARY_PATH=PROMPT_LIBRARY_PATH, _save_prompt_libraries_unlocked=_save_prompt_libraries_unlocked, default_prompt_libraries=default_prompt_libraries, normalize_prompt_libraries=normalize_prompt_libraries)

def load_prompt_libraries():
    return prompt_library_service.load_prompt_libraries(PROMPT_LIBRARY_LOCK=PROMPT_LIBRARY_LOCK, PROMPT_LIBRARY_PATH=PROMPT_LIBRARY_PATH, _load_prompt_libraries_unlocked=_load_prompt_libraries_unlocked, interprocess_file_lock=interprocess_file_lock)

def save_prompt_libraries(data):
    return prompt_library_service.save_prompt_libraries(data, PROMPT_LIBRARY_LOCK=PROMPT_LIBRARY_LOCK, PROMPT_LIBRARY_PATH=PROMPT_LIBRARY_PATH, _save_prompt_libraries_unlocked=_save_prompt_libraries_unlocked, interprocess_file_lock=interprocess_file_lock)

def serialize_prompt_library_update(route):
    """把无 await 的提示词库路由读改写置于同一跨进程锁区间。"""
    from functools import wraps

    @wraps(route)
    async def wrapped(*args, **kwargs):
        with interprocess_file_lock(PROMPT_LIBRARY_PATH):
            with PROMPT_LIBRARY_LOCK:
                return await route(*args, **kwargs)

    return wrapped

def public_prompt_libraries(data=None):
    return prompt_library_service.public_prompt_libraries(data, load_prompt_libraries=load_prompt_libraries, normalize_prompt_libraries=normalize_prompt_libraries, now_ms=now_ms)

def find_prompt_library(data, library_id=""):
    return prompt_library_service.find_prompt_library(data, library_id)

def content_type_for_path(path):
    return media_reference_service.content_type_for_path(path)

def is_image_reference_value(value):
    return media_reference_service.is_image_reference_value(value, content_type_for_path=content_type_for_path, output_file_from_url=output_file_from_url)

def is_video_reference_value(value):
    return media_reference_service.is_video_reference_value(value, content_type_for_path=content_type_for_path, output_file_from_url=output_file_from_url)

def convert_output_to_jpg(url, quality=88):
    return media_reference_service.convert_output_to_jpg(url, quality, ASSETS_DIR=ASSETS_DIR, Image=Image, OUTPUT_DIR=OUTPUT_DIR, output_file_from_url=output_file_from_url, write_diagnostic=write_diagnostic)

def reference_to_data_url(ref, max_size=None):
    return media_reference_service.reference_to_data_url(ref, max_size, BytesIO=BytesIO, Image=Image, base64=base64, content_type_for_path=content_type_for_path, output_file_from_url=output_file_from_url, write_diagnostic=write_diagnostic)

def is_image_reference(ref):
    return media_reference_service.is_image_reference(ref)

def image_references(refs):
    return media_reference_service.image_references(refs, is_image_reference=is_image_reference)

TEXT_ATTACHMENT_EXTS = {".txt", ".md", ".markdown", ".json", ".csv", ".log", ".py", ".js", ".ts", ".tsx", ".jsx", ".html", ".css", ".xml", ".yaml", ".yml"}
XLSX_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff"}
EXCEL_MAX_SHEETS = 8
EXCEL_MAX_ROWS_PER_SHEET = 80
EXCEL_MAX_COLS_PER_ROW = 30
MAX_ATTACHMENT_TEXT_CHARS = 12000

def _xml_local_name(tag):
    return chat_attachment_service._xml_local_name(tag)

def _xlsx_join_text(node):
    return chat_attachment_service._xlsx_join_text(node, _xml_local_name=_xml_local_name)

def _xlsx_shared_strings(archive):
    return chat_attachment_service._xlsx_shared_strings(archive, ET=ET, _xlsx_join_text=_xlsx_join_text, _xml_local_name=_xml_local_name)

def _xlsx_sheet_paths(archive):
    return chat_attachment_service._xlsx_sheet_paths(archive, ET=ET, _xml_local_name=_xml_local_name)

def _xlsx_cell_text(cell, shared_strings):
    return chat_attachment_service._xlsx_cell_text(cell, shared_strings, _xlsx_join_text=_xlsx_join_text, _xml_local_name=_xml_local_name)

def read_xlsx_attachment(path, limit=MAX_ATTACHMENT_TEXT_CHARS):
    return chat_attachment_service.read_xlsx_attachment(path, limit, ET=ET, EXCEL_MAX_COLS_PER_ROW=EXCEL_MAX_COLS_PER_ROW, EXCEL_MAX_ROWS_PER_SHEET=EXCEL_MAX_ROWS_PER_SHEET, EXCEL_MAX_SHEETS=EXCEL_MAX_SHEETS, XLSX_IMAGE_EXTS=XLSX_IMAGE_EXTS, _xlsx_cell_text=_xlsx_cell_text, _xlsx_shared_strings=_xlsx_shared_strings, _xlsx_sheet_paths=_xlsx_sheet_paths, _xml_local_name=_xml_local_name, zipfile=zipfile)

def xlsx_embedded_image_data_urls(path, max_images=4, max_size=1536):
    return chat_attachment_service.xlsx_embedded_image_data_urls(path, max_images, max_size, BytesIO=BytesIO, Image=Image, XLSX_IMAGE_EXTS=XLSX_IMAGE_EXTS, base64=base64, write_diagnostic=write_diagnostic, zipfile=zipfile)

def attachment_embedded_image_data_urls(refs, max_images=4):
    return chat_attachment_service.attachment_embedded_image_data_urls(refs, max_images, is_image_reference=is_image_reference, output_file_from_url=output_file_from_url, xlsx_embedded_image_data_urls=xlsx_embedded_image_data_urls)

def read_text_attachment(path, limit=MAX_ATTACHMENT_TEXT_CHARS):
    return chat_attachment_service.read_text_attachment(path, limit, ET=ET, TEXT_ATTACHMENT_EXTS=TEXT_ATTACHMENT_EXTS, html=html, read_xlsx_attachment=read_xlsx_attachment, write_diagnostic=write_diagnostic, zipfile=zipfile)

def attachment_text_blocks(refs, limit_each=MAX_ATTACHMENT_TEXT_CHARS):
    return chat_attachment_service.attachment_text_blocks(refs, limit_each, CHAT_ATTACHMENT_MAX=CHAT_ATTACHMENT_MAX, is_image_reference=is_image_reference, output_file_from_url=output_file_from_url, read_text_attachment=read_text_attachment)

def media_reference_to_url(value, max_image_size=None):
    return media_reference_service.media_reference_to_url(value, max_image_size, reference_to_data_url=reference_to_data_url)

def is_private_asset_url(value: str) -> bool:
    return media_reference_service.is_private_asset_url(value)

def volcengine_media_reference_url(value, max_image_size=1536):
    return media_reference_service.volcengine_media_reference_url(value, max_image_size, is_private_asset_url=is_private_asset_url, reference_to_data_url=reference_to_data_url)

def looks_like_image_media_url(value: str) -> bool:
    return media_reference_service.looks_like_image_media_url(value, urllib=urllib)

def volcengine_content_role(role: str, kind: str = "image") -> Optional[str]:
    return video_request_service.volcengine_content_role(role, kind)

def volcengine_video_duration(duration) -> int:
    return video_request_service.volcengine_video_duration(duration)

def volcengine_video_resolution(value: str) -> str:
    return video_request_service.volcengine_video_resolution(value)

def is_volcengine_seedance2_model(model: str) -> bool:
    return video_request_service.is_volcengine_seedance2_model(model)

def probe_local_audio_duration_seconds(value: str) -> Optional[float]:
    return media_reference_service.probe_local_audio_duration_seconds(value, math=math, output_file_from_url=output_file_from_url, shutil=shutil, subprocess=subprocess)

async def volcengine_video_reference_content_items(value, max_frames=4, max_size=768):
    return await media_reference_service.volcengine_video_reference_content_items(value, max_frames, max_size, is_private_asset_url=is_private_asset_url, video_reference_to_frame_data_urls=video_reference_to_frame_data_urls)

async def video_reference_to_frame_data_urls(value, max_frames=6, max_size=768):
    return await media_reference_service.video_reference_to_frame_data_urls(value, max_frames, max_size, asyncio=asyncio, base64=base64, httpx=httpx, output_file_from_url=output_file_from_url, shutil=shutil, subprocess=subprocess, tempfile=tempfile, urllib=urllib, write_diagnostic=write_diagnostic)

def compress_data_url_image(value, max_size=1536, jpeg_quality=88):
    return media_reference_service.compress_data_url_image(value, max_size, jpeg_quality, BytesIO=BytesIO, Image=Image, base64=base64, write_diagnostic=write_diagnostic)

def modelscope_image_url(value, max_size=1536):
    return media_reference_service.modelscope_image_url(value, max_size, reference_to_data_url=reference_to_data_url)

def valid_video_image_input(value: str) -> bool:
    return provider_media_transfer.valid_video_image_input(value)

def valid_apimart_video_image_input(value: str) -> bool:
    return provider_media_transfer.valid_apimart_video_image_input(value)

def apply_trusted_asset_prompt_index(prompt: str, image_count: int, video_count: int, audio_count: int) -> str:
    return video_request_service.apply_trusted_asset_prompt_index(prompt, image_count, video_count, audio_count)

def public_base_url() -> str:
    # 实时读 API/.env 且文件优先：公网隧道重启后地址会变，隧道脚本只改 .env；
    # 启动时 load_env_file 会把旧值复制进 os.environ，若 env 优先会永远读到过期地址
    value = (
        read_api_env_value("PUBLIC_MEDIA_BASE_URL") or
        os.getenv("PUBLIC_MEDIA_BASE_URL") or
        PUBLIC_MEDIA_BASE_URL or
        read_api_env_value("PUBLIC_BASE_URL") or
        os.getenv("PUBLIC_BASE_URL") or
        PUBLIC_BASE_URL or
        ""
    ).strip().rstrip("/")
    if value and re.match(r"^https?://", value, re.I):
        return value
    return ""

def public_media_url_suffix() -> str:
    token = str(os.getenv("PUBLIC_MEDIA_TOKEN") or "").strip()
    return f"?token={urllib.parse.quote(token)}" if token else ""

def local_asset_public_url(value: str) -> str:
    return provider_media_transfer.local_asset_public_url(value, output_file_from_url=output_file_from_url, public_base_url=public_base_url, public_media_url_suffix=public_media_url_suffix, urllib=urllib)

async def openai_video_proxy_public_reference_url(ref) -> str:
    return await provider_media_transfer.openai_video_proxy_public_reference_url(ref, HTTPException=HTTPException, local_asset_public_url=local_asset_public_url, output_file_from_url=output_file_from_url, public_error_detail=public_error_detail, safe_cli_public_text=safe_cli_public_text, upload_local_video_to_cloud=upload_local_video_to_cloud, urllib=urllib)

def openai_video_proxy_local_image_path(ref) -> str:
    return provider_media_transfer.openai_video_proxy_local_image_path(ref, content_type_for_path=content_type_for_path, output_file_from_url=output_file_from_url, urllib=urllib)

def normalize_apimart_video_reference(value: str) -> str:
    return provider_media_transfer.normalize_apimart_video_reference(value, local_asset_public_url=local_asset_public_url, valid_apimart_video_image_input=valid_apimart_video_image_input)

def apimart_video_reference_error(value: str) -> str:
    return provider_media_transfer.apimart_video_reference_error(value, output_file_from_url=output_file_from_url)

def apimart_video_duration(duration) -> int:
    return video_request_service.apimart_video_duration(duration)

def apimart_veo31_duration(duration) -> int:
    return video_request_service.apimart_veo31_duration(duration)

def is_apimart_veo31_model(model: str) -> bool:
    return video_request_service.is_apimart_veo31_model(model)

def apimart_veo31_model(model: str) -> str:
    return video_request_service.apimart_veo31_model(model)

def apimart_veo31_aspect(aspect: str) -> str:
    return video_request_service.apimart_veo31_aspect(aspect)

def apimart_veo31_resolution(resolution: str) -> str:
    return video_request_service.apimart_veo31_resolution(resolution)

def apimart_upload_file_payload(path: str):
    return provider_media_transfer.apimart_upload_file_payload(path, BytesIO=BytesIO, Image=Image, content_type_for_path=content_type_for_path)

def invalid_video_image_preview(value: str) -> str:
    return provider_media_transfer.invalid_video_image_preview(value, safe_cli_public_text=safe_cli_public_text)

def extract_apimart_asset_url(payload):
    return provider_media_transfer.extract_apimart_asset_url(payload, extract_apimart_asset_url=extract_apimart_asset_url, valid_apimart_video_image_input=valid_apimart_video_image_input)

def apimart_upload_payload_from_bytes(data: bytes, mime: str, name_hint: str = "image"):
    return provider_media_transfer.apimart_upload_payload_from_bytes(data, mime, name_hint, BytesIO=BytesIO, Image=Image, mimetypes=mimetypes)

def apimart_upload_raw_file_payload(path: str):
    return provider_media_transfer.apimart_upload_raw_file_payload(path, content_type_for_path=content_type_for_path)

APIMART_UPLOAD_RETRY_ATTEMPTS = 3

def is_transient_tls_error(exc) -> bool:
    """识别可重试的瞬时 TLS/传输错误，如 SSLV3_ALERT_BAD_RECORD_MAC、EOF occurred 等，
    这类错误多由连接池中被污染/复用坏掉的 TLS 连接引起，换新连接重试通常即可成功。"""
    if isinstance(exc, httpx.TransportError):
        return True
    msg = f"{type(exc).__name__}: {exc}".upper()
    return any(token in msg for token in (
        "SSL", "BAD RECORD MAC", "EOF OCCURRED", "DECRYPTION FAILED", "WRONG VERSION NUMBER",
    ))

async def apimart_upload_post(client, upload_url, headers, file_tuple, timeout=60):
    return await provider_media_transfer.apimart_upload_post(client, upload_url, headers, file_tuple, timeout, APIMART_UPLOAD_RETRY_ATTEMPTS=APIMART_UPLOAD_RETRY_ATTEMPTS, asyncio=asyncio, httpx=httpx, is_transient_tls_error=is_transient_tls_error, log_net_error=log_net_error)

async def upload_image_for_apimart(client, provider, ref_url: str) -> str:
    return await provider_media_transfer.upload_image_for_apimart(client, provider, ref_url, _safe_upstream_text=_safe_upstream_text, api_headers=api_headers, apimart_upload_file_payload=apimart_upload_file_payload, apimart_upload_payload_from_bytes=apimart_upload_payload_from_bytes, apimart_upload_post=apimart_upload_post, base64=base64, extract_apimart_asset_url=extract_apimart_asset_url, log_net_error=log_net_error, output_file_from_url=output_file_from_url, valid_apimart_video_image_input=valid_apimart_video_image_input, video_api_root=video_api_root, write_diagnostic=write_diagnostic)

async def upload_video_for_apimart(client, provider, ref_url: str) -> str:
    return await provider_media_transfer.upload_video_for_apimart(client, provider, ref_url, api_headers=api_headers, apimart_upload_raw_file_payload=apimart_upload_raw_file_payload, apimart_video_reference_error=apimart_video_reference_error, content_type_for_path=content_type_for_path, extract_apimart_asset_url=extract_apimart_asset_url, local_asset_public_url=local_asset_public_url, log_net_error=log_net_error, output_file_from_url=output_file_from_url, upstream_response_error_summary=upstream_response_error_summary, valid_apimart_video_image_input=valid_apimart_video_image_input, video_api_root=video_api_root, write_diagnostic=write_diagnostic)

async def upload_audio_for_apimart(client, provider, ref_url: str) -> str:
    return await provider_media_transfer.upload_audio_for_apimart(client, provider, ref_url, _safe_upstream_text=_safe_upstream_text, api_headers=api_headers, apimart_upload_raw_file_payload=apimart_upload_raw_file_payload, apimart_video_reference_error=apimart_video_reference_error, base64=base64, content_type_for_path=content_type_for_path, extract_apimart_asset_url=extract_apimart_asset_url, local_asset_public_url=local_asset_public_url, log_net_error=log_net_error, mimetypes=mimetypes, output_file_from_url=output_file_from_url, upstream_response_error_summary=upstream_response_error_summary, valid_apimart_video_image_input=valid_apimart_video_image_input, video_api_root=video_api_root)

async def upload_media_for_apimart(client, provider, ref_url: str, kind: str) -> str:
    return await provider_media_transfer.upload_media_for_apimart(client, provider, ref_url, kind, upload_audio_for_apimart=upload_audio_for_apimart, upload_image_for_apimart=upload_image_for_apimart, upload_video_for_apimart=upload_video_for_apimart)

def apimart_avatar_asset_type(kind: str) -> str:
    return avatar_asset_service.apimart_avatar_asset_type(kind)

def extract_apimart_avatar_asset_uri(payload) -> str:
    return avatar_asset_service.extract_apimart_avatar_asset_uri(payload, extract_apimart_avatar_asset_uri=extract_apimart_avatar_asset_uri)

async def submit_apimart_avatar_asset(provider, public_url: str, name: str, kind: str, project_name: str = "default", group_name: str = "") -> str:
    return await avatar_asset_service.submit_apimart_avatar_asset(provider, public_url, name, kind, project_name, group_name, HTTPException=HTTPException, api_headers=api_headers, apimart_avatar_asset_type=apimart_avatar_asset_type, httpx=httpx, upstream_response_error_summary=upstream_response_error_summary, video_api_root=video_api_root)

AVATAR_TASK_DONE_STATUSES = {"completed", "complete", "succeeded", "success", "active", "done"}
AVATAR_TASK_FAIL_STATUSES = {"failed", "fail", "error", "rejected", "canceled", "cancelled", "expired"}

async def check_apimart_avatar_task(provider, task_id: str) -> Dict[str, Any]:
    return await avatar_asset_service.check_apimart_avatar_task(provider, task_id, AVATAR_TASK_DONE_STATUSES=AVATAR_TASK_DONE_STATUSES, AVATAR_TASK_FAIL_STATUSES=AVATAR_TASK_FAIL_STATUSES, HTTPException=HTTPException, api_headers=api_headers, extract_apimart_avatar_asset_uri=extract_apimart_avatar_asset_uri, httpx=httpx, upstream_response_error_summary=upstream_response_error_summary, video_api_root=video_api_root)

# ---- 火山 Ark 私域素材资产（Assets）API：AK/SK 签名 V4 + CreateAssetGroup/CreateAsset/GetAsset ----
VOLCENGINE_ARK_ASSET_HOST = "open.volcengineapi.com"
VOLCENGINE_ARK_ASSET_SERVICE = "ark"
VOLCENGINE_ARK_ASSET_REGION = "cn-beijing"
VOLCENGINE_ARK_ASSET_VERSION = "2024-01-01"

def _volc_hmac(key: bytes, msg: str) -> bytes:
    return avatar_asset_service._volc_hmac(key, msg, hmac=hmac, hashlib=hashlib)

def volcengine_sign_v4_headers(ak: str, sk: str, action: str, body_str: str,
                               service: str = VOLCENGINE_ARK_ASSET_SERVICE,
                               region: str = VOLCENGINE_ARK_ASSET_REGION,
                               version: str = VOLCENGINE_ARK_ASSET_VERSION,
                               host: str = VOLCENGINE_ARK_ASSET_HOST) -> Dict[str, str]:
    return avatar_asset_service.volcengine_sign_v4_headers(ak, sk, action, body_str, service, region, version, host, datetime=datetime, hashlib=hashlib, urllib=urllib, _volc_hmac=_volc_hmac, hmac=hmac)

async def volcengine_ark_asset_call(client, action: str, body: Dict[str, Any]) -> Dict[str, Any]:
    return await avatar_asset_service.volcengine_ark_asset_call(client, action, body, HTTPException=HTTPException, VOLCENGINE_ARK_ASSET_HOST=VOLCENGINE_ARK_ASSET_HOST, VOLCENGINE_ARK_ASSET_VERSION=VOLCENGINE_ARK_ASSET_VERSION, provider_error_summary=provider_error_summary, upstream_response_error_summary=upstream_response_error_summary, volcengine_access_key_value=volcengine_access_key_value, volcengine_secret_key_value=volcengine_secret_key_value, volcengine_sign_v4_headers=volcengine_sign_v4_headers)

async def volcengine_ensure_asset_group(client, project_name: str, group_name: str) -> str:
    return await avatar_asset_service.volcengine_ensure_asset_group(client, project_name, group_name, HTTPException=HTTPException, volcengine_ark_asset_call=volcengine_ark_asset_call)

async def submit_volcengine_avatar_asset(public_url: str, name: str, kind: str,
                                         project_name: str = "default", group_name: str = "") -> str:
    return await avatar_asset_service.submit_volcengine_avatar_asset(public_url, name, kind, project_name, group_name, HTTPException=HTTPException, apimart_avatar_asset_type=apimart_avatar_asset_type, httpx=httpx, volcengine_ark_asset_call=volcengine_ark_asset_call, volcengine_ensure_asset_group=volcengine_ensure_asset_group)

async def check_volcengine_avatar_task(asset_id: str, project_name: str = "default") -> Dict[str, Any]:
    return await avatar_asset_service.check_volcengine_avatar_task(asset_id, project_name, httpx=httpx, volcengine_ark_asset_call=volcengine_ark_asset_call)

def volcengine_public_asset_url(url: str) -> str:
    return avatar_asset_service.volcengine_public_asset_url(url, local_asset_public_url=local_asset_public_url)

def local_media_path_for_cloud_upload(ref_url: str, allowed_prefixes=("image/", "video/")) -> str:
    return provider_media_transfer.local_media_path_for_cloud_upload(ref_url, allowed_prefixes, HTTPException=HTTPException, content_type_for_path=content_type_for_path, output_file_from_url=output_file_from_url)

def local_video_path_for_cloud_upload(ref_url: str) -> str:
    return local_media_path_for_cloud_upload(ref_url, ("video/",))

async def upload_video_to_litterbox(path: str, source_url: str) -> Dict[str, str]:
    return await provider_media_transfer.upload_video_to_litterbox(path, source_url, HTTPException=HTTPException, content_type_for_path=content_type_for_path, httpx=httpx, safe_upstream_http_detail=safe_upstream_http_detail)

async def upload_video_to_temp_sh(path: str, source_url: str) -> Dict[str, str]:
    return await provider_media_transfer.upload_video_to_temp_sh(path, source_url, HTTPException=HTTPException, content_type_for_path=content_type_for_path, httpx=httpx, safe_upstream_http_detail=safe_upstream_http_detail)

async def upload_local_video_to_cloud(ref_url: str, service: str = "auto") -> Dict[str, str]:
    return await provider_media_transfer.upload_local_video_to_cloud(ref_url, service, HTTPException=HTTPException, local_media_path_for_cloud_upload=local_media_path_for_cloud_upload, upload_video_to_litterbox=upload_video_to_litterbox, upload_video_to_temp_sh=upload_video_to_temp_sh)

async def upload_local_video_to_temp_sh(ref_url: str) -> Dict[str, str]:
    return await upload_local_video_to_cloud(ref_url, "auto")

async def save_ai_image_to_output(image_data, prefix="online_", category="output"):
    return await generation_output_service.save_ai_image_to_output(image_data, prefix, category, base64=base64, httpx=httpx, log_net_error=log_net_error, output_path_for=output_path_for, output_url_for=output_url_for, rewrite_runninghub_file_url=rewrite_runninghub_file_url, uuid=uuid)

def image_output_meta(url, source_item=None):
    return generation_output_service.image_output_meta(url, source_item, Image=Image, output_file_from_url=output_file_from_url, urllib=urllib)

async def save_remote_video_to_output(url, prefix="video_", category="output"):
    return await generation_output_service.save_remote_video_to_output(url, prefix, category, VIDEO_POLL_TIMEOUT=VIDEO_POLL_TIMEOUT, httpx=httpx, output_path_for=output_path_for, output_url_for=output_url_for, urllib=urllib, uuid=uuid, write_diagnostic=write_diagnostic)

def parse_size_pair(size):
    return image_size_rules.parse_size_pair(size)

def snap_size_to_multiple(size, multiple=16):
    return image_size_rules.snap_size_to_multiple(size, multiple, parse_size_pair=parse_size_pair)

CHAT_RATIO_SIZE_OPTIONS = {
    "1:1": ("1024x1024", "1536x1536", "2048x2048"),
    "2:3": ("720x1080", "1024x1536", "1365x2048"),
    "3:2": ("1080x720", "1536x1024", "2048x1365"),
    "3:4": ("1008x1344", "1536x2048", "2448x3264"),
    "4:3": ("1344x1008", "2048x1536", "3264x2448"),
    "9:16": ("720x1280", "1080x1920", "1440x2560"),
    "16:9": ("1280x720", "1920x1080", "2560x1440"),
}

def chat_prompt_size_override(message, current_size=""):
    return image_size_rules.chat_prompt_size_override(message, current_size, CHAT_RATIO_SIZE_OPTIONS=CHAT_RATIO_SIZE_OPTIONS, parse_size_pair=parse_size_pair)

# GPT-Image-2 限制：长边最大 3840，主要受最大像素限制（约 829 万 = 3840x2160）。
# 这里只用于上游报错后给出友好的像素上限提示；不对尺寸做任何缩小（用户选什么就原样发送）。
GPT_IMAGE2_MAX_EDGE = 3840
GPT_IMAGE2_MAX_PIXELS = 8_294_400
GPT_IMAGE2_MIN_PIXELS = 655_360

def is_gpt_image_2_model(model):
    return image_size_rules.is_gpt_image_2_model(model)

def normalize_gpt_image_2_size(size):
    return image_size_rules.normalize_gpt_image_2_size(size, parse_size_pair=parse_size_pair, GPT_IMAGE2_MAX_EDGE=GPT_IMAGE2_MAX_EDGE, GPT_IMAGE2_MAX_PIXELS=GPT_IMAGE2_MAX_PIXELS, GPT_IMAGE2_MIN_PIXELS=GPT_IMAGE2_MIN_PIXELS)

def gpt_image_2_size_error_message(size):
    return image_size_rules.gpt_image_2_size_error_message(size, parse_size_pair=parse_size_pair)

def gpt_image_2_size_exceeds_supported(size):
    return image_size_rules.gpt_image_2_size_exceeds_supported(size, parse_size_pair=parse_size_pair, GPT_IMAGE2_MAX_EDGE=GPT_IMAGE2_MAX_EDGE, GPT_IMAGE2_MAX_PIXELS=GPT_IMAGE2_MAX_PIXELS)

def apimart_size_resolution(size):
    return image_size_rules.apimart_size_resolution(size, parse_size_pair=parse_size_pair)

VOLCENGINE_MIN_PIXELS = 3_686_400
VOLCENGINE_MIN_EDGE = 1536
VOLCENGINE_MAX_EDGE = 4096
VOLCENGINE_RATIO_CHOICES = [
    (1, 1, "1:1"),
    (4, 3, "4:3"),
    (3, 4, "3:4"),
    (16, 9, "16:9"),
    (9, 16, "9:16"),
    (21, 9, "21:9"),
    (9, 21, "9:21"),
    (3, 2, "3:2"),
    (2, 3, "2:3"),
    (5, 4, "5:4"),
    (4, 5, "4:5"),
]

def is_volcengine_seedream_model(model):
    return image_size_rules.is_volcengine_seedream_model(model)

def normalize_volcengine_size(size, model=""):
    return image_size_rules.normalize_volcengine_size(size, model, parse_size_pair=parse_size_pair, is_volcengine_seedream_model=is_volcengine_seedream_model, VOLCENGINE_RATIO_CHOICES=VOLCENGINE_RATIO_CHOICES, VOLCENGINE_MIN_PIXELS=VOLCENGINE_MIN_PIXELS, VOLCENGINE_MIN_EDGE=VOLCENGINE_MIN_EDGE, VOLCENGINE_MAX_EDGE=VOLCENGINE_MAX_EDGE)

def friendly_image_error_detail(text, size="", model=""):
    return upstream_public_policy.friendly_image_error_detail(text, size, model, gpt_image_2_size_error_message=gpt_image_2_size_error_message, gpt_image_2_size_exceeds_supported=gpt_image_2_size_exceeds_supported, is_gpt_image_2_model=is_gpt_image_2_model)

def parse_error_payload_text(text):
    return upstream_public_policy.parse_error_payload_text(text)

def friendly_chat_error_detail(text, model="", provider=None):
    return upstream_public_policy.friendly_chat_error_detail(text, model, provider, is_volcengine_provider=is_volcengine_provider, parse_error_payload_text=parse_error_payload_text)

def safe_upstream_http_detail(response, label="上游接口错误", friendly=""):
    return upstream_public_policy.safe_upstream_http_detail(response, label, friendly, _safe_upstream_text=_safe_upstream_text, upstream_response_error_summary=upstream_response_error_summary)

def safe_upstream_transport_detail(exc, label="请求上游接口失败"):
    """传输异常只暴露类型；完整脱敏信息由 log_net_error 记录。"""
    return f"{label}（{type(exc).__name__}），请检查网络和 API 地址。"

async def generate_modelscope_provider_image(prompt, size, model, reference_images=None, provider=None):
    return await image_provider_service.generate_modelscope_provider_image(prompt, size, model, reference_images, provider, AI_REQUEST_TIMEOUT=AI_REQUEST_TIMEOUT, HTTPException=HTTPException, IMAGE_POLL_INTERVAL=IMAGE_POLL_INTERVAL, ONLINE_IMAGE_REFERENCE_MAX=ONLINE_IMAGE_REFERENCE_MAX, extract_image=extract_image, httpx=httpx, log_net_error=log_net_error, modelscope_api_key=modelscope_api_key, modelscope_image_api_root=modelscope_image_api_root, modelscope_image_url=modelscope_image_url, parse_size_pair=parse_size_pair, selected_model=selected_model, upstream_error_summary=upstream_error_summary, upstream_response_error_summary=upstream_response_error_summary)

def gemini_model_name(model):
    return image_provider_service.gemini_model_name(model, selected_model=selected_model)

def gemini_endpoint_url(provider, model):
    return image_provider_service.gemini_endpoint_url(provider, model, gemini_model_name=gemini_model_name, is_apimart_provider=is_apimart_provider, provider_endpoint_url=provider_endpoint_url)

def gemini_image_config(size):
    return image_provider_service.gemini_image_config(size, apimart_size_resolution=apimart_size_resolution, parse_size_pair=parse_size_pair)

def gemini_reference_part(ref):
    return image_provider_service.gemini_reference_part(ref, reference_to_data_url=reference_to_data_url)

async def generate_gemini_provider_image(prompt, size, model, reference_images=None, provider=None):
    return await image_provider_service.generate_gemini_provider_image(prompt, size, model, reference_images, provider, ONLINE_IMAGE_REFERENCE_MAX=ONLINE_IMAGE_REFERENCE_MAX, api_headers=api_headers, extract_image=extract_image, gemini_endpoint_url=gemini_endpoint_url, gemini_image_config=gemini_image_config, gemini_model_name=gemini_model_name, gemini_reference_part=gemini_reference_part, httpx=httpx, is_apimart_provider=is_apimart_provider, unwrap_apimart_response=unwrap_apimart_response)

def volcengine_endpoint_url(provider):
    return image_provider_service.volcengine_endpoint_url(provider, provider_endpoint_url=provider_endpoint_url)

def volcengine_image_payload(ref):
    return image_provider_service.volcengine_image_payload(ref, reference_to_data_url=reference_to_data_url)

async def generate_volcengine_provider_image(prompt, size, model, reference_images=None, provider=None):
    return await image_provider_service.generate_volcengine_provider_image(prompt, size, model, reference_images, provider, ONLINE_IMAGE_REFERENCE_MAX=ONLINE_IMAGE_REFERENCE_MAX, api_headers=api_headers, extract_image=extract_image, httpx=httpx, normalize_volcengine_size=normalize_volcengine_size, volcengine_endpoint_url=volcengine_endpoint_url, volcengine_image_payload=volcengine_image_payload)

def runninghub_api_headers(provider, use_wallet=True):
    api_key = runninghub_api_key(provider, use_wallet=use_wallet)
    if not api_key:
        raise HTTPException(status_code=400, detail="未配置 RunningHub API Key，请在 API 设置中填写。")
    return {"Authorization": bearer_auth_value(api_key), "Accept": "application/json", "Content-Type": "application/json"}

def runninghub_json_headers(provider, use_wallet=True):
    return runninghub_api_headers(provider, use_wallet=use_wallet)

def runninghub_provider():
    return get_api_provider_exact("runninghub")

def runninghub_api_key(provider=None, use_wallet=False, prefer_wallet=False):
    provider = provider or runninghub_provider()
    provider_id = (provider or {}).get("id") or "runninghub"
    free_key = str((provider or {}).get("api_key") or "").strip() or provider_env_key_value(provider_id)
    wallet_key = str((provider or {}).get("wallet_api_key") or "").strip() or runninghub_wallet_key_value()
    if use_wallet and not wallet_key:
        raise HTTPException(status_code=400, detail="未配置 RunningHub 账户余额 API Key。标准模型接口只能走账户余额，请在 RH 设置中填写账户余额 Key。")
    api_key = wallet_key if (use_wallet or prefer_wallet) and wallet_key else free_key
    if not api_key:
        raise HTTPException(status_code=400, detail="未配置 RunningHub API Key，请在 RH 设置中填写。")
    return api_key

def runninghub_app_headers(json_body=True, use_wallet=False, provider=None):
    provider = provider or runninghub_provider()
    host = urllib.parse.urlsplit(str((provider or {}).get("base_url") or RUNNINGHUB_DEFAULT_BASE_URL)).netloc or "www.runninghub.ai"
    headers = {"Host": host}
    if provider:
        api_key = runninghub_api_key(provider, use_wallet=use_wallet)
        if api_key:
            headers["Authorization"] = bearer_auth_value(api_key)
    if json_body:
        headers["Content-Type"] = "application/json"
    return headers

def runninghub_local_asset_path(url):
    return provider_media_transfer.runninghub_local_asset_path(url, urllib=urllib, OUTPUT_INPUT_DIR=OUTPUT_INPUT_DIR, OUTPUT_OUTPUT_DIR=OUTPUT_OUTPUT_DIR, output_file_from_url=output_file_from_url)

def runninghub_output_ext(remote, content_type=""):
    return runninghub_protocol.runninghub_output_ext(remote, content_type)

def rewrite_runninghub_file_url(url):
    return runninghub_protocol.rewrite_runninghub_file_url(url, urllib=urllib, RUNNINGHUB_FILE_HOST_REWRITES=RUNNINGHUB_FILE_HOST_REWRITES)

def runninghub_extract_outputs(data):
    return runninghub_protocol.runninghub_extract_outputs(data, rewrite_runninghub_file_url=rewrite_runninghub_file_url)

async def runninghub_store_remote_output(client, remote):
    return await generation_output_service.runninghub_store_remote_output(client, remote, rewrite_runninghub_file_url=rewrite_runninghub_file_url, runninghub_output_ext=runninghub_output_ext, uuid=uuid, output_path_for=output_path_for, output_url_for=output_url_for)

def runninghub_fail_reason(raw):
    return upstream_public_policy.runninghub_fail_reason(raw, _safe_upstream_text=_safe_upstream_text, upstream_error_summary=upstream_error_summary)


# 上游失败回包可能包含完整请求体、HTML、调试栈或错误凭据。错误提示只需要
# 状态码和一小段可读原因，日志也不应把供应商的 raw JSON 原样写入 stdout。
_UPSTREAM_ERROR_KEYS = (
    "message", "msg", "errorMessage", "error_info", "error", "detail", "failedReason",
    "failReason", "failure_reason", "reason", "description", "exception_message",
)
_UPSTREAM_CODE_KEYS = ("code", "errorCode", "status", "statusCode")
_UPSTREAM_SECRET_JSON_RE = re.compile(
    r"([\"']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|passwd|authorization)[\"']?\s*:\s*[\"']?(?:Bearer\s+)?)([^\"',}\s]+)",
    re.IGNORECASE,
)


def _safe_upstream_text(value, limit=600):
    return upstream_public_policy._safe_upstream_text(value, limit, _UPSTREAM_SECRET_JSON_RE=_UPSTREAM_SECRET_JSON_RE, redact_log_text=redact_log_text)


# CLI 状态/帮助/登录管理接口会把本机进程输出展示给浏览器。CLI 输出通常不是
# 业务结果解析入口，适合在这个边界做统一的长度和隐私收敛；生图/视频任务仍
# 使用原始结构，避免影响任务结果解析。
CLI_PUBLIC_TEXT_LIMIT = 12000
CLI_PUBLIC_RAW_LIMIT = 16000
_CLI_LOCAL_PATH_RE = re.compile(
    r"(?<![\w:/])(?:[A-Za-z]:[\\/](?:[^\\/\r\n<>\"']+[\\/])*[^\\/\r\n<>\"']*|/(?:Users|home|root|tmp|var/folders|private/var)/[^\r\n<>\"']+)",
    re.IGNORECASE,
)
_CLI_SECRET_KEY_RE = re.compile(
    r"(?:^|[_-])(api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|passwd|authorization|cookie)(?:$|[_-])",
    re.IGNORECASE,
)


def safe_cli_public_text(value, limit=CLI_PUBLIC_TEXT_LIMIT):
    return upstream_public_policy.safe_cli_public_text(value, limit, CLI_PUBLIC_TEXT_LIMIT=CLI_PUBLIC_TEXT_LIMIT, _CLI_LOCAL_PATH_RE=_CLI_LOCAL_PATH_RE, _UPSTREAM_SECRET_JSON_RE=_UPSTREAM_SECRET_JSON_RE, redact_log_text=redact_log_text)


def public_error_detail(value, fallback="操作失败", limit=800):
    return upstream_public_policy.public_error_detail(value, fallback, limit, safe_cli_public_text=safe_cli_public_text)


def public_comfy_error_detail(value, fallback="ComfyUI 生成失败"):
    """把 ComfyUI 内部异常收敛为可操作的短提示。"""
    return public_error_detail(value, fallback=fallback, limit=800)


def runninghub_workflow_json_error(exc):
    return upstream_public_policy.runninghub_workflow_json_error(exc)


def safe_cli_executable_name(value):
    return upstream_public_policy.safe_cli_executable_name(value, safe_cli_public_text=safe_cli_public_text)


def safe_cli_public_raw(value, *, max_depth=5, max_items=64, max_chars=CLI_PUBLIC_RAW_LIMIT):
    return upstream_public_policy.safe_cli_public_raw(value, max_depth=max_depth, max_items=max_items, max_chars=max_chars, CLI_PUBLIC_RAW_LIMIT=CLI_PUBLIC_RAW_LIMIT, _CLI_SECRET_KEY_RE=_CLI_SECRET_KEY_RE, safe_cli_public_text=safe_cli_public_text)


_JIMENG_CREDIT_KEY_RE = re.compile(r"credit|balance|quota|point|coin|积分|余额", re.I)
_JIMENG_NUMBER_RE = re.compile(r"^-?(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$")


def public_jimeng_credit(value, *, max_items=32):
    return upstream_public_policy.public_jimeng_credit(value, max_items=max_items, _CLI_SECRET_KEY_RE=_CLI_SECRET_KEY_RE, _JIMENG_CREDIT_KEY_RE=_JIMENG_CREDIT_KEY_RE, _JIMENG_NUMBER_RE=_JIMENG_NUMBER_RE, math=math, safe_cli_public_text=safe_cli_public_text)


def upstream_error_summary(raw=None, fallback="", limit=600):
    return upstream_public_policy.upstream_error_summary(raw, fallback, limit, _UPSTREAM_CODE_KEYS=_UPSTREAM_CODE_KEYS, _UPSTREAM_ERROR_KEYS=_UPSTREAM_ERROR_KEYS, _safe_upstream_text=_safe_upstream_text, parse_error_payload_text=parse_error_payload_text)


def upstream_response_error_summary(response, fallback="上游请求失败", limit=300):
    return upstream_public_policy.upstream_response_error_summary(response, fallback, limit, looks_like_html_response=looks_like_html_response, provider_error_summary=provider_error_summary)


def provider_error_summary(raw=None, fallback="", limit=300):
    return upstream_public_policy.provider_error_summary(raw, fallback, limit, upstream_error_summary=upstream_error_summary)


def probe_error_payload(response, fallback="上游探测失败"):
    return upstream_public_policy.probe_error_payload(response, fallback, upstream_response_error_summary=upstream_response_error_summary)


def runninghub_error_detail(message, raw=None, **extra):
    return upstream_public_policy.runninghub_error_detail({'_safe_upstream_text': _safe_upstream_text, 'redact_url_for_log': redact_url_for_log, 'upstream_error_summary': upstream_error_summary}, message, raw, **extra)

def log_runninghub_error(stage, raw=None, **extra):
    return upstream_public_policy.log_runninghub_error({'redact_log_text': redact_log_text, 'upstream_error_summary': upstream_error_summary, 'write_diagnostic': write_diagnostic}, stage, raw, **extra)

def runninghub_infer_workflow_field_type(field_name, field_value):
    return runninghub_fields.runninghub_infer_workflow_field_type(field_name, field_value)

def runninghub_is_workflow_link_value(value):
    return runninghub_fields.runninghub_is_workflow_link_value(value)

def runninghub_workflow_node_info_list(workflow_json):
    return runninghub_fields.runninghub_workflow_node_info_list(workflow_json, runninghub_infer_workflow_field_type=runninghub_infer_workflow_field_type, runninghub_is_workflow_link_value=runninghub_is_workflow_link_value)

def runninghub_task_endpoint(provider, model):
    return runninghub_protocol.runninghub_task_endpoint(provider, model, RUNNINGHUB_DEFAULT_IMAGE_MODELS=RUNNINGHUB_DEFAULT_IMAGE_MODELS, runninghub_endpoint_url=runninghub_endpoint_url, runninghub_openapi_url=runninghub_openapi_url)

def runninghub_endpoint_alias_for_model(model):
    return runninghub_protocol.runninghub_endpoint_alias_for_model(model, RUNNINGHUB_MODEL_ENDPOINT_ALIASES=RUNNINGHUB_MODEL_ENDPOINT_ALIASES)

def runninghub_registry_fallback():
    return runninghub_model_registry_service.runninghub_registry_fallback()

def runninghub_registry_items_from_raw(raw):
    return runninghub_model_registry_service.runninghub_registry_items_from_raw(raw)

def runninghub_registry_model_from_id(model_id, output_type=""):
    return runninghub_model_registry_service.runninghub_registry_model_from_id(model_id, output_type, classify_upstream_model=classify_upstream_model)

async def fetch_runninghub_llm_models(provider=None):
    return await runninghub_model_registry_service.fetch_runninghub_llm_models(provider, RUNNINGHUB_LLM_MODELS_URLS=RUNNINGHUB_LLM_MODELS_URLS, httpx=httpx, looks_like_html_response=looks_like_html_response, parse_upstream_models=parse_upstream_models, redact_url_for_log=redact_url_for_log, runninghub_api_headers=runninghub_api_headers, runninghub_registry_model_from_id=runninghub_registry_model_from_id, upstream_response_error_summary=upstream_response_error_summary)

async def fetch_runninghub_model_registry(provider=None, include_fallback=True, include_meta=False):
    return await runninghub_model_registry_service.fetch_runninghub_model_registry(provider, include_fallback, include_meta, HTTPException=HTTPException, RUNNINGHUB_MODEL_REGISTRY_URL=RUNNINGHUB_MODEL_REGISTRY_URL, STATIC_RUNNINGHUB_MODEL_REGISTRY_FILE=STATIC_RUNNINGHUB_MODEL_REGISTRY_FILE, fetch_runninghub_llm_models=fetch_runninghub_llm_models, httpx=httpx, looks_like_html_response=looks_like_html_response, runninghub_api_headers=runninghub_api_headers, runninghub_model_id=runninghub_model_id, runninghub_openapi_url=runninghub_openapi_url, runninghub_registry_fallback=runninghub_registry_fallback, runninghub_registry_items_from_raw=runninghub_registry_items_from_raw, upstream_response_error_summary=upstream_response_error_summary)

def runninghub_model_id(item):
    return runninghub_model_registry_service.runninghub_model_id(item)

def runninghub_model_display_name(item, model_id=""):
    return runninghub_model_registry_service.runninghub_model_display_name(item, model_id, runninghub_model_id=runninghub_model_id)

def runninghub_registry_payload(items):
    return runninghub_model_registry_service.runninghub_registry_payload(items, RUNNINGHUB_DEFAULT_IMAGE_MODELS=RUNNINGHUB_DEFAULT_IMAGE_MODELS, RUNNINGHUB_DEFAULT_VIDEO_MODELS=RUNNINGHUB_DEFAULT_VIDEO_MODELS, RUNNINGHUB_FALLBACK_CHAT_MODELS=RUNNINGHUB_FALLBACK_CHAT_MODELS, runninghub_model_display_name=runninghub_model_display_name, runninghub_model_id=runninghub_model_id)

async def runninghub_models_payload(provider=None):
    return await runninghub_model_registry_service.runninghub_models_payload(provider, fetch_runninghub_model_registry=fetch_runninghub_model_registry, runninghub_registry_payload=runninghub_registry_payload, safe_cli_public_raw=safe_cli_public_raw)

async def runninghub_model_definition(provider, model):
    return await runninghub_model_registry_service.runninghub_model_definition(provider, model, RUNNINGHUB_DEFAULT_IMAGE_MODELS=RUNNINGHUB_DEFAULT_IMAGE_MODELS, classify_upstream_model=classify_upstream_model, fetch_runninghub_model_registry=fetch_runninghub_model_registry, runninghub_endpoint_alias_for_model=runninghub_endpoint_alias_for_model, runninghub_model_id=runninghub_model_id)

def runninghub_aspect_from_size(size, fallback="1:1"):
    return runninghub_protocol.runninghub_aspect_from_size(size, fallback, parse_size=parse_size_pair)

RUNNINGHUB_ENTRY_MODEL_RE = re.compile(r"^(app|workflow):(.+)$")

def runninghub_entry_config_from_model(provider, model):
    return runninghub_config_service.runninghub_entry_config_from_model(provider, model, RUNNINGHUB_ENTRY_MODEL_RE=RUNNINGHUB_ENTRY_MODEL_RE, RUNNINGHUB_WORKFLOW_LOCK=RUNNINGHUB_WORKFLOW_LOCK, load_runninghub_workflow_store=load_runninghub_workflow_store, runninghub_entry_id=runninghub_entry_id, runninghub_provider_workflow_config=runninghub_provider_workflow_config, runninghub_select_workflow_config=runninghub_select_workflow_config, runninghub_workflow_store_key=runninghub_workflow_store_key)

def _runninghub_app_service():
    return RunningHubAppService(
        provider=runninghub_provider,
        api_key=runninghub_api_key,
        app_headers=runninghub_app_headers,
        endpoint_url=runninghub_endpoint_url,
        local_asset_path=runninghub_local_asset_path,
        content_type=content_type_for_path,
        error_detail=runninghub_error_detail,
        fail_reason=runninghub_fail_reason,
        parse_size=parse_size_pair,
        extract_outputs=runninghub_extract_outputs,
        public_app_info=public_runninghub_app_info,
        log_error=log_runninghub_error,
        workflow_json_error=runninghub_workflow_json_error,
        workflow_node_info=runninghub_workflow_node_info_list,
        workflow_fields=runninghub_collect_workflow_fields,
        workflow_store_key=runninghub_workflow_store_key,
        store_output=runninghub_store_remote_output,
        image_meta=image_output_meta,
        rewrite_url=rewrite_runninghub_file_url,
        reference_limit=ONLINE_IMAGE_REFERENCE_MAX,
        client_factory=httpx.AsyncClient,
        sleep=asyncio.sleep,
        clock=time.monotonic,
    )


@contextmanager
def _runninghub_app_errors():
    try:
        yield
    except RunningHubAppError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


async def generate_runninghub_entry_image(prompt, size, model, reference_images, provider, entry, on_remote_accept=None):
    with _runninghub_app_errors():
        return await _runninghub_app_service().generate_image(prompt, size, model, reference_images, provider, entry, on_remote_accept=on_remote_accept)

def _runninghub_openapi_adapter():
    return RunningHubOpenAPIAdapter(
        model_definition=runninghub_model_definition,
        task_endpoint=runninghub_task_endpoint,
        openapi_url=runninghub_openapi_url,
        api_headers=runninghub_api_headers,
        json_headers=runninghub_json_headers,
        upload_headers=lambda provider: {
            "Authorization": bearer_auth_value(runninghub_api_key(provider, use_wallet=True)),
            "Accept": "application/json",
        },
        resolve_file=output_file_from_url,
        content_type=content_type_for_path,
        parse_size=parse_size_pair,
        rewrite_url=rewrite_runninghub_file_url,
        generic_extract=extract_image,
        fail_reason=runninghub_fail_reason,
        error_detail=runninghub_error_detail,
        response_error=upstream_response_error_summary,
        video_urls=video_output_urls,
        extract_outputs=runninghub_extract_outputs,
        save_video=save_remote_video_to_output,
        reference_limit=ONLINE_IMAGE_REFERENCE_MAX,
        video_timeout=VIDEO_POLL_TIMEOUT,
        extract_errors=(HTTPException,),
        client_factory=httpx.AsyncClient,
        sleep=asyncio.sleep,
        clock=time.monotonic,
    )


@contextmanager
def _runninghub_openapi_errors():
    try:
        yield
    except RunningHubOpenAPIError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


async def generate_runninghub_provider_image(prompt, size, model, reference_images=None, provider=None, on_remote_accept=None):
    entry = runninghub_entry_config_from_model(provider, model)
    if entry:
        return await generate_runninghub_entry_image(prompt, size, model, reference_images, provider, entry, on_remote_accept=on_remote_accept)
    with _runninghub_openapi_errors():
        return await _runninghub_openapi_adapter().generate_image(
            prompt, size, model, reference_images, provider, on_remote_accept=on_remote_accept,
        )

async def generate_runninghub_video(payload, provider, on_remote_accept=None):
    with _runninghub_openapi_errors():
        return await _runninghub_openapi_adapter().generate_video(payload, provider, on_remote_accept=on_remote_accept)

async def _post_video_proxy_image(client, provider, model, prompt, size, image_refs, base_url):
    return await image_tool_request_service.post_video_proxy_image(client, provider, model, prompt, size, image_refs, base_url,
        api_headers=api_headers,
        content_type_for_path=content_type_for_path,
        httpx_request_with_transient_retries=httpx_request_with_transient_retries,
        openai_video_proxy_local_image_path=openai_video_proxy_local_image_path,
        openai_video_proxy_public_reference_url=openai_video_proxy_public_reference_url,
        runninghub_aspect_from_size=runninghub_aspect_from_size,
    )

async def _post_responses_image(client, provider, model, prompt, size, quality, image_refs, base_url):
    return await image_tool_request_service.post_responses_image(client, provider, model, prompt, size, quality, image_refs, base_url,
        ONLINE_IMAGE_REFERENCE_MAX=ONLINE_IMAGE_REFERENCE_MAX,
        api_headers=api_headers,
        locked_recommended_provider_rule=locked_recommended_provider_rule,
        post_openai_responses=post_openai_responses,
        provider_endpoint_url=provider_endpoint_url,
        responses_image_size_instruction=responses_image_size_instruction,
        responses_input_image_url=responses_input_image_url,
        responses_proxy_tool_size=responses_proxy_tool_size,
    )

async def _generate_openai_image(prompt, size, quality, model, reference_images, provider, on_remote_accept=None):
    return await image_openai_service.generate_openai_image(prompt, size, quality, model, reference_images, provider, on_remote_accept,
        AI_BASE_URL=AI_BASE_URL,
        AI_REQUEST_TIMEOUT=AI_REQUEST_TIMEOUT,
        HTTPException=HTTPException,
        ONLINE_IMAGE_REFERENCE_MAX=ONLINE_IMAGE_REFERENCE_MAX,
        api_headers=api_headers,
        apimart_size_resolution=apimart_size_resolution,
        content_type_for_path=content_type_for_path,
        effective_image_request_mode=effective_image_request_mode,
        extract_image=extract_image,
        extract_task_id=extract_task_id,
        friendly_image_error_detail=friendly_image_error_detail,
        httpx=httpx,
        images_api_unsupported=images_api_unsupported,
        is_apimart_provider=is_apimart_provider,
        is_gpt_image_2_model=is_gpt_image_2_model,
        log_net_error=log_net_error,
        output_file_from_url=output_file_from_url,
        provider_endpoint_url=provider_endpoint_url,
        reference_to_data_url=reference_to_data_url,
        responses_no_image_detail=responses_no_image_detail,
        responses_output_text_image=responses_output_text_image,
        upstream_response_error_summary=upstream_response_error_summary,
        wait_for_image_task=wait_for_image_task,
        write_diagnostic=write_diagnostic,
        post_video_proxy_image=_post_video_proxy_image,
        post_responses_image=_post_responses_image,
    )

async def generate_ai_image(prompt, size, quality, model, reference_images=None, provider_id="comfly", aspect_ratio="", resolution="", on_remote_accept=None):
    return await image_provider_service.generate_ai_image(prompt, size, quality, model, reference_images, provider_id, aspect_ratio, resolution, on_remote_accept,
        ImageGenerationDispatchContext=ImageGenerationDispatchContext,
        effective_protocol=effective_protocol,
        generate_codex_provider_image=generate_codex_provider_image,
        generate_gemini_cli_provider_image=generate_gemini_cli_provider_image,
        generate_gemini_provider_image=generate_gemini_provider_image,
        generate_jimeng_provider_image=generate_jimeng_provider_image,
        generate_modelscope_provider_image=generate_modelscope_provider_image,
        generate_runninghub_provider_image=generate_runninghub_provider_image,
        generate_tudou_async_image=generate_tudou_async_image,
        generate_tudou_grok_image=generate_tudou_grok_image,
        generate_volcengine_provider_image=generate_volcengine_provider_image,
        get_api_provider=get_api_provider,
        is_codex_provider=is_codex_provider,
        is_gemini_cli_provider=is_gemini_cli_provider,
        is_jimeng_provider=is_jimeng_provider,
        is_runninghub_provider=is_runninghub_provider,
        is_tudou_async_image_mode=is_tudou_async_image_mode,
        is_tudou_grok_image_model=is_tudou_grok_image_model,
        is_tudou_provider=is_tudou_provider,
        is_volcengine_provider=is_volcengine_provider,
        resolve_image_generation_dispatch=resolve_image_generation_dispatch,
        tudou_image_model_for_request=tudou_image_model_for_request,
        generate_openai_image=_generate_openai_image,
    )

def upstream_message_from_record(item):
    role = item.get("role")
    if role not in {"user", "assistant"} or item.get("type") == "image":
        return None
    attachments = item.get("attachments") or []
    if attachments and role == "user":
        text = item.get("content", "")
        blocks = attachment_text_blocks(attachments)
        if blocks:
            text = f"{text}\n\n以下是用户上传附件的可读内容，请在回答时参考：\n\n" + "\n\n---\n\n".join(blocks)
        content = [{"type": "text", "text": text}]
        image_urls = []
        for ref in image_references(attachments[:CHAT_ATTACHMENT_MAX]):
            url = reference_to_data_url(ref)
            if url:
                image_urls.append(url)
        image_urls.extend(attachment_embedded_image_data_urls(attachments[:CHAT_ATTACHMENT_MAX], max_images=max(0, CHAT_ATTACHMENT_MAX - len(image_urls))))
        for url in image_urls[:CHAT_ATTACHMENT_MAX]:
            content.append({"type": "image_url", "image_url": {"url": url}})
        return {"role": role, "content": content}
    return {"role": role, "content": item.get("content", "")}

AGENT_ACTIONS = {"chat", "generate_image", "edit_image"}
AGENT_IMAGE_KEYWORDS = [
    "生成", "画", "出图", "生图", "图片", "图像", "海报", "头像", "壁纸",
    "插画", "照片", "photo", "image", "picture", "draw", "generate",
]
AGENT_EDIT_KEYWORDS = [
    "修改", "改成", "换成", "调整", "优化", "编辑", "重绘", "上一张", "刚才",
    "这张", "那张", "参考图", "改图", "edit", "modify", "change", "revise",
]
CN_NUMERAL_MAP = {
    "一": 1, "二": 2, "两": 2, "俩": 2, "三": 3, "四": 4,
}

def latest_chat_image_refs(conversation, limit=1):
    return chat_execution_service.latest_chat_image_refs(conversation, limit)

def image_size_from_reference(ref):
    return chat_execution_service.image_size_from_reference(ref, Image=Image, output_file_from_url=output_file_from_url, write_diagnostic=write_diagnostic)

def chat_requested_image_count(message):
    return chat_execution_service.chat_requested_image_count(message, CN_NUMERAL_MAP=CN_NUMERAL_MAP)

def chat_split_parallel_prompts(prompt, count):
    return chat_execution_service.chat_split_parallel_prompts(prompt, count)

def pick_chat_image_provider(provider_id="", fallback_id=""):
    return chat_execution_service.pick_chat_image_provider(provider_id, fallback_id, get_api_provider=get_api_provider, load_api_providers=load_api_providers)

def heuristic_agent_decision(message, refs, has_previous_image):
    return chat_execution_service.heuristic_agent_decision(message, refs, has_previous_image, AGENT_EDIT_KEYWORDS=AGENT_EDIT_KEYWORDS, AGENT_IMAGE_KEYWORDS=AGENT_IMAGE_KEYWORDS)

def parse_agent_decision(raw_text, message, refs, has_previous_image):
    return chat_execution_service.parse_agent_decision(raw_text, message, refs, has_previous_image, AGENT_ACTIONS=AGENT_ACTIONS, AGENT_IMAGE_KEYWORDS=AGENT_IMAGE_KEYWORDS, heuristic_agent_decision=heuristic_agent_decision)

async def decide_chat_agent_action(payload, conversation, refs):
    return await chat_execution_service.decide_chat_agent_action(payload, conversation, refs, AI_REQUEST_TIMEOUT=AI_REQUEST_TIMEOUT, CODEX_DEFAULT_CHAT_MODELS=CODEX_DEFAULT_CHAT_MODELS, GEMINI_CLI_DEFAULT_CHAT_MODELS=GEMINI_CLI_DEFAULT_CHAT_MODELS, MAX_HISTORY_MESSAGES=MAX_HISTORY_MESSAGES, get_api_provider=get_api_provider, heuristic_agent_decision=heuristic_agent_decision, httpx=httpx, is_apimart_provider=is_apimart_provider, is_codex_provider=is_codex_provider, is_gemini_cli_provider=is_gemini_cli_provider, latest_chat_image_refs=latest_chat_image_refs, parse_agent_decision=parse_agent_decision, resolve_chat_provider=resolve_chat_provider, selected_model=selected_model, text_from_chat_response=text_from_chat_response, upstream_message_from_record=upstream_message_from_record, write_diagnostic=write_diagnostic)

async def build_chat_text_reply(payload, conversation):
    return await chat_execution_service.build_chat_text_reply(payload, conversation, AI_REQUEST_TIMEOUT=AI_REQUEST_TIMEOUT, CODEX_DEFAULT_CHAT_MODELS=CODEX_DEFAULT_CHAT_MODELS, GEMINI_CLI_DEFAULT_CHAT_MODELS=GEMINI_CLI_DEFAULT_CHAT_MODELS, HTTPException=HTTPException, MAX_HISTORY_MESSAGES=MAX_HISTORY_MESSAGES, chat_system_prompt=chat_system_prompt, codex_chat_text=codex_chat_text, friendly_chat_error_detail=friendly_chat_error_detail, gemini_cli_chat_text=gemini_cli_chat_text, get_api_provider=get_api_provider, httpx=httpx, is_apimart_provider=is_apimart_provider, is_codex_provider=is_codex_provider, is_gemini_cli_provider=is_gemini_cli_provider, log_net_error=log_net_error, now_ms=now_ms, public_usage=public_usage, required_chat_response_text=required_chat_response_text, resolve_chat_provider=resolve_chat_provider, safe_upstream_http_detail=safe_upstream_http_detail, safe_upstream_transport_detail=safe_upstream_transport_detail, selected_model=selected_model, unwrap_apimart_response=unwrap_apimart_response, upstream_message_from_record=upstream_message_from_record)

# --- 路由接口 ---

@app.get("/")
async def index():
    return static_html_response("index.html")

@app.get("/api/view")
def view_image(filename: str, type: str = "input", subfolder: str = ""):
    return media_storage_service.view_image(filename, type, subfolder, COMFYUI_INSTANCES=COMFYUI_INSTANCES, requests=requests, Response=Response, FileResponse=FileResponse, HTTPException=HTTPException, output_path_for=output_path_for, content_type_for_path=content_type_for_path)

@app.get("/api/download-output")
def download_output(request: Request, url: str, name: str = "", inline: bool = False):
    return media_storage_service.download_output(request, url, name, inline, rewrite_runninghub_file_url=rewrite_runninghub_file_url, output_file_from_url=output_file_from_url, local_media_file_by_basename=local_media_file_by_basename, filename_from_media_url=filename_from_media_url, sanitize_export_filename=sanitize_export_filename, FileResponse=FileResponse, content_type_for_path=content_type_for_path, HTTPException=HTTPException, requests=requests, StreamingResponse=StreamingResponse)



@app.post("/api/upload")
async def upload_image(files: List[UploadFile] = File(...)):
    return await upload_service.upload_image(files, read_limited=read_upload_file_limited, get_instances=lambda: COMFYUI_INSTANCES, http=requests, diagnostic=write_diagnostic, error_factory=HTTPException)

@app.post("/api/ai/upload")
async def upload_ai_reference(
    files: List[UploadFile] = File(...),
):
    return await upload_service.upload_ai_reference(files, read_limited=read_upload_file_limited, output_path=output_path_for, output_url=output_url_for)

class Base64UploadRequest(BaseModel):
    data: str = Field(default="", max_length=BASE64_UPLOAD_MAX_TEXT_LENGTH)  # 纯 base64 或 data:URL
    name: str = ""
    content_type: str = ""

@app.post("/api/ai/upload-base64")
async def upload_ai_base64(payload: Base64UploadRequest):
    return await upload_service.upload_ai_base64(payload, size_hint=_base64_payload_size_hint, max_bytes=BASE64_UPLOAD_MAX_BYTES, limit_error=_upload_limit_error, kind_ext=_local_upload_kind_ext, output_path=output_path_for, output_url=output_url_for, error_factory=HTTPException)

@app.post("/api/comfyui/upload-base64")
async def upload_comfyui_base64(payload: Base64UploadRequest):
    return await upload_service.upload_comfyui_base64(payload, size_hint=_base64_payload_size_hint, max_bytes=BASE64_UPLOAD_MAX_BYTES, limit_error=_upload_limit_error, kind_ext=_local_upload_kind_ext, get_instances=lambda: COMFYUI_INSTANCES, http=requests, diagnostic=write_diagnostic, error_factory=HTTPException)

def _local_upload_rel_path(value):
    return local_asset_service._local_upload_rel_path(value, HTTPException=HTTPException)

def _local_upload_abs(rel):
    return local_asset_service._local_upload_abs(rel, HTTPException=HTTPException, LOCAL_UPLOAD_DIR=LOCAL_UPLOAD_DIR, _local_upload_rel_path=_local_upload_rel_path)

def _local_upload_safe_path(name):
    return local_asset_service._local_upload_safe_path(name, HTTPException=HTTPException, _local_upload_abs=_local_upload_abs)

def _local_upload_safe_folder(path_value):
    return local_asset_service._local_upload_safe_folder(path_value, _local_upload_abs=_local_upload_abs)

def _local_upload_safe_folder_name(name):
    return local_asset_service._local_upload_safe_folder_name(name, HTTPException=HTTPException, sanitize_asset_name=sanitize_asset_name)

def _local_upload_safe_file_stem(name):
    return local_asset_service._local_upload_safe_file_stem(name, HTTPException=HTTPException, sanitize_asset_name=sanitize_asset_name)

def _local_upload_caption_path(filename):
    return local_asset_service._local_upload_caption_path(filename, LOCAL_UPLOAD_DIR=LOCAL_UPLOAD_DIR)

def _read_local_upload_caption(filename):
    return local_asset_service._read_local_upload_caption(filename, _local_upload_caption_path=_local_upload_caption_path)

def _local_upload_item(filename):
    return local_asset_service._local_upload_item(filename, Image=Image, LOCAL_UPLOAD_DIR=LOCAL_UPLOAD_DIR, _local_upload_display_name=_local_upload_display_name, _local_upload_kind_ext=_local_upload_kind_ext, _local_upload_rel_path=_local_upload_rel_path, _read_local_upload_caption=_read_local_upload_caption, _read_local_upload_classification=_read_local_upload_classification)

def _local_upload_folder_node(path="", name="全部上传"):
    return local_asset_service._local_upload_folder_node(path, name, _local_upload_rel_path=_local_upload_rel_path)

def _local_upload_tree_and_items():
    return local_asset_service._local_upload_tree_and_items(LOCAL_UPLOAD_DIR=LOCAL_UPLOAD_DIR, _local_upload_folder_node=_local_upload_folder_node, _local_upload_item=_local_upload_item, _local_upload_kind_ext=_local_upload_kind_ext)

_DOUBLE_EXT_RE = re.compile(r'(\.[A-Za-z0-9]{1,5})\1$', re.IGNORECASE)
_DOUBLE_EXT_MEDIA = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif",
                     ".mp4", ".webm", ".mov", ".m4v", ".flv"}

def migrate_double_extension_uploads():
    return local_asset_service.migrate_double_extension_uploads(LOCAL_UPLOAD_DIR=LOCAL_UPLOAD_DIR, _DOUBLE_EXT_MEDIA=_DOUBLE_EXT_MEDIA, _DOUBLE_EXT_RE=_DOUBLE_EXT_RE, write_diagnostic=write_diagnostic)

def _sniff_image_ext(path):
    try:
        with open(path, "rb") as f:
            return _sniff_image_ext_bytes(f.read(16))
    except OSError:
        return None

def migrate_mislabeled_image_extensions():
    return local_asset_service.migrate_mislabeled_image_extensions(LOCAL_UPLOAD_DIR=LOCAL_UPLOAD_DIR, _sniff_image_ext=_sniff_image_ext, write_diagnostic=write_diagnostic)

@app.post("/api/local-assets/upload")
async def upload_local_assets(files: List[UploadFile] = File(...), folder: str = Form("")):
    return await local_asset_service.upload_local_assets(files, folder, _local_upload_item=_local_upload_item, _local_upload_kind_ext=_local_upload_kind_ext, _local_upload_safe_folder=_local_upload_safe_folder, _write_local_upload_classification=_write_local_upload_classification, classify_asset_image_best_effort=classify_asset_image_best_effort, read_upload_file_limited=read_upload_file_limited)

@app.post("/api/local-assets/import-urls")
async def import_local_assets_from_urls(payload: LocalAssetUrlImportRequest):
    return await local_asset_service.import_local_assets_from_urls(payload, HTTPException=HTTPException, UPLOAD_MAX_BATCH_BYTES=UPLOAD_MAX_BATCH_BYTES, UPLOAD_MAX_FILE_BYTES=UPLOAD_MAX_FILE_BYTES, _base64_payload_size_hint=_base64_payload_size_hint, _local_upload_item=_local_upload_item, _local_upload_kind_ext=_local_upload_kind_ext, _local_upload_safe_folder=_local_upload_safe_folder, _sniff_image_ext_bytes=_sniff_image_ext_bytes, _upload_limit_error=_upload_limit_error, _write_local_upload_classification=_write_local_upload_classification, classify_asset_image_best_effort=classify_asset_image_best_effort, httpx=httpx, public_error_detail=public_error_detail, read_httpx_response_limited=read_httpx_response_limited, safe_cli_public_text=safe_cli_public_text)

@app.get("/api/local-assets")
async def list_local_assets():
    return await local_asset_service.list_local_assets(_local_upload_tree_and_items=_local_upload_tree_and_items)

@app.post("/api/local-assets/folders")
async def create_local_asset_folder(payload: LocalAssetFolderRequest, request: Request):
    return await local_asset_service.create_local_asset_folder(payload, request, HTTPException=HTTPException, _local_upload_safe_folder=_local_upload_safe_folder, _local_upload_safe_folder_name=_local_upload_safe_folder_name, _local_upload_tree_and_items=_local_upload_tree_and_items, ensure_same_origin_request=ensure_same_origin_request)

@app.patch("/api/local-assets/folders")
async def rename_local_asset_folder(payload: LocalAssetFolderRequest, request: Request):
    return await local_asset_service.rename_local_asset_folder(payload, request, HTTPException=HTTPException, _local_upload_safe_folder=_local_upload_safe_folder, _local_upload_safe_folder_name=_local_upload_safe_folder_name, _local_upload_tree_and_items=_local_upload_tree_and_items, ensure_same_origin_request=ensure_same_origin_request)

@app.patch("/api/local-assets/items")
async def rename_local_asset_item(payload: LocalAssetRenameRequest, request: Request):
    return await local_asset_service.rename_local_asset_item(payload, request, HTTPException=HTTPException, _local_upload_abs=_local_upload_abs, _local_upload_caption_path=_local_upload_caption_path, _local_upload_classification_path=_local_upload_classification_path, _local_upload_item=_local_upload_item, _local_upload_kind_ext=_local_upload_kind_ext, _local_upload_safe_file_stem=_local_upload_safe_file_stem, _local_upload_safe_path=_local_upload_safe_path, _local_upload_tree_and_items=_local_upload_tree_and_items, ensure_same_origin_request=ensure_same_origin_request)

@app.post("/api/local-assets/delete")
async def delete_local_assets(payload: dict, request: Request):
    return await local_asset_service.delete_local_assets(payload, request, ASSET_LIBRARY_LOCK=ASSET_LIBRARY_LOCK, CANVAS_LOCK=CANVAS_LOCK, CONVERSATION_LOCK=CONVERSATION_LOCK, HISTORY_FILE=HISTORY_FILE, HISTORY_LOCK=HISTORY_LOCK, HTTPException=HTTPException, _local_upload_caption_path=_local_upload_caption_path, _local_upload_classification_path=_local_upload_classification_path, _local_upload_safe_path=_local_upload_safe_path, ensure_same_origin_request=ensure_same_origin_request, json_references_media_path=json_references_media_path, persisted_json_references_media_path=persisted_json_references_media_path)

@app.post("/api/local-assets/move")
async def move_local_assets(payload: dict, request: Request):
    return await local_asset_service.move_local_assets(payload, request, HTTPException=HTTPException, _local_upload_abs=_local_upload_abs, _local_upload_caption_path=_local_upload_caption_path, _local_upload_classification_path=_local_upload_classification_path, _local_upload_safe_folder=_local_upload_safe_folder, _local_upload_safe_path=_local_upload_safe_path, _local_upload_tree_and_items=_local_upload_tree_and_items, ensure_same_origin_request=ensure_same_origin_request)

@app.post("/api/local-assets/caption")
async def caption_local_assets(payload: LocalAssetCaptionRequest):
    return await local_asset_service.caption_local_assets(payload, HTTPException=HTTPException, _local_upload_caption_path=_local_upload_caption_path, _local_upload_kind_ext=_local_upload_kind_ext, _local_upload_safe_path=_local_upload_safe_path, caption_image_with_provider=caption_image_with_provider, public_error_detail=public_error_detail, write_text_atomic=write_text_atomic)

@app.post("/api/local-assets/classify")
async def classify_local_assets(payload: LocalAssetClassifyRequest):
    return await local_asset_service.classify_local_assets(payload, HTTPException=HTTPException, _local_upload_classification_path=_local_upload_classification_path, _local_upload_kind_ext=_local_upload_kind_ext, _local_upload_safe_path=_local_upload_safe_path, _write_local_upload_classification=_write_local_upload_classification, classify_image_with_provider=classify_image_with_provider, public_error_detail=public_error_detail)

@app.patch("/api/local-assets/caption")
async def save_local_asset_caption(payload: LocalAssetCaptionSaveRequest):
    return await local_asset_service.save_local_asset_caption(payload, HTTPException=HTTPException, _local_upload_caption_path=_local_upload_caption_path, _local_upload_kind_ext=_local_upload_kind_ext, _local_upload_safe_path=_local_upload_safe_path, write_text_atomic=write_text_atomic)

@app.post("/api/temp-sh/upload")
async def temp_sh_upload(payload: TempShUploadRequest, request: Request):
    ensure_same_origin_request(request)
    return await upload_local_video_to_cloud(payload.url, "auto")

@app.post("/api/cloud-video/upload")
async def cloud_video_upload(payload: CloudVideoUploadRequest, request: Request):
    ensure_same_origin_request(request)
    return await upload_local_video_to_cloud(payload.url, payload.service)

@app.post("/api/ai/import-local-image")
async def import_local_ai_reference(payload: LocalImageImportRequest, request: Request):
    ensure_same_origin_request(request)
    requested = [payload.path] if payload.path else []
    requested.extend(payload.paths or [])
    requested = [p for p in requested if str(p or "").strip()][:20]
    if not requested:
        raise HTTPException(status_code=400, detail="没有可导入的本地图片")
    return {"files": [import_local_image_file(normalize_local_image_path(path)) for path in requested]}


def public_runninghub_app_info(data, api_key=""):
    return upstream_public_policy.public_runninghub_app_info(data, api_key, _UPSTREAM_SECRET_JSON_RE=_UPSTREAM_SECRET_JSON_RE, redact_log_text=redact_log_text)

@app.get("/api/runninghub/app-info")
async def runninghub_app_info(webappId: str = ""):
    with _runninghub_app_errors():
        return await _runninghub_app_service().app_info(webappId)

@app.post("/api/runninghub/submit")
async def runninghub_submit(payload: RunningHubSubmitRequest):
    with _runninghub_app_errors():
        return await _runninghub_app_service().submit(payload)

@app.post("/api/runninghub/workflow-submit")
async def runninghub_workflow_submit(payload: RunningHubWorkflowSubmitRequest):
    with _runninghub_app_errors():
        return await _runninghub_app_service().submit_workflow(payload)

@app.get("/api/runninghub/workflow-info")
async def runninghub_workflow_info(workflowId: str = ""):
    with _runninghub_app_errors():
        return await _runninghub_app_service().workflow_info(workflowId)

@app.get("/api/runninghub/workflows")
def list_runninghub_workflows():
    return runninghub_config_service.list_runninghub_workflows(RUNNINGHUB_WORKFLOW_LOCK=RUNNINGHUB_WORKFLOW_LOCK, load_api_providers=load_api_providers, load_runninghub_workflow_store=load_runninghub_workflow_store, runninghub_provider_workflow_config=runninghub_provider_workflow_config, runninghub_saved_hidden_workflow_ids=runninghub_saved_hidden_workflow_ids, runninghub_select_workflow_config=runninghub_select_workflow_config, runninghub_workflow_store_key=runninghub_workflow_store_key)

@app.get("/api/runninghub/workflows/{workflow_id:path}")
def get_runninghub_workflow(workflow_id: str):
    return runninghub_config_service.get_runninghub_workflow(workflow_id, HTTPException=HTTPException, RUNNINGHUB_WORKFLOW_LOCK=RUNNINGHUB_WORKFLOW_LOCK, load_runninghub_workflow_store=load_runninghub_workflow_store, runninghub_provider_workflow_config=runninghub_provider_workflow_config, runninghub_select_workflow_config=runninghub_select_workflow_config, runninghub_workflow_store_key=runninghub_workflow_store_key, runninghub_workflow_without_raw=runninghub_workflow_without_raw)

@app.post("/api/runninghub/workflows/fetch")
async def fetch_runninghub_workflow(payload: RunningHubWorkflowConfig):
    with _runninghub_app_errors():
        return await _runninghub_app_service().fetch_workflow(payload)

@app.put("/api/runninghub/workflows/{workflow_id:path}")
def save_runninghub_workflow(workflow_id: str, payload: RunningHubWorkflowConfig):
    return runninghub_config_service.save_runninghub_workflow(workflow_id, payload, HTTPException=HTTPException, RUNNINGHUB_WORKFLOW_LOCK=RUNNINGHUB_WORKFLOW_LOCK, _save_runninghub_workflow_store_or_raise=_save_runninghub_workflow_store_or_raise, load_runninghub_workflow_store=load_runninghub_workflow_store, now_ms=now_ms, runninghub_is_saved_link_field=runninghub_is_saved_link_field, runninghub_normalize_field=runninghub_normalize_field, runninghub_workflow_json_from_config=runninghub_workflow_json_from_config, runninghub_workflow_store_key=runninghub_workflow_store_key, sync_runninghub_workflow_to_provider=sync_runninghub_workflow_to_provider)

@app.delete("/api/runninghub/workflows/{workflow_id:path}")
def delete_runninghub_workflow(workflow_id: str):
    return runninghub_config_service.delete_runninghub_workflow(workflow_id, HTTPException=HTTPException, RUNNINGHUB_WORKFLOW_LOCK=RUNNINGHUB_WORKFLOW_LOCK, _save_runninghub_workflow_store_or_raise=_save_runninghub_workflow_store_or_raise, load_runninghub_workflow_store=load_runninghub_workflow_store, remove_runninghub_workflow_from_provider=remove_runninghub_workflow_from_provider, runninghub_provider_workflow_config=runninghub_provider_workflow_config, runninghub_workflow_store_key=runninghub_workflow_store_key)

@app.get("/api/runninghub/query")
async def runninghub_query(taskId: str = "", useWallet: bool = False):
    with _runninghub_app_errors():
        return await _runninghub_app_service().query(taskId, useWallet)

@app.post("/api/runninghub/upload-asset")
async def runninghub_upload_asset(payload: RunningHubUploadAssetRequest):
    with _runninghub_app_errors():
        return await _runninghub_app_service().upload_asset(payload)

@app.get("/api/codex/status")
async def codex_status():
    return await codex_cli_service.codex_status(BASE_DIR=BASE_DIR, asyncio=asyncio, codex_cli_executable=codex_cli_executable, codex_decode_output=codex_decode_output, gpt_image_2_skill_executable=gpt_image_2_skill_executable, safe_cli_executable_name=safe_cli_executable_name, safe_cli_public_raw=safe_cli_public_raw, safe_cli_public_text=safe_cli_public_text)

@app.post("/api/codex/help")
async def codex_help(payload: CodexHelpRequest):
    return await codex_cli_service.codex_help(payload, BASE_DIR=BASE_DIR, CLI_PUBLIC_TEXT_LIMIT=CLI_PUBLIC_TEXT_LIMIT, HTTPException=HTTPException, asyncio=asyncio, codex_cli_executable=codex_cli_executable, codex_decode_output=codex_decode_output, safe_cli_public_raw=safe_cli_public_raw, safe_cli_public_text=safe_cli_public_text)

@app.get("/api/gemini-cli/status")
async def gemini_cli_status():
    return await gemini_cli_service.gemini_cli_status(BASE_DIR=BASE_DIR, asyncio=asyncio, codex_decode_output=codex_decode_output, gemini_cli_display_name=gemini_cli_display_name, gemini_cli_executable=gemini_cli_executable, is_antigravity_cli=is_antigravity_cli, safe_cli_executable_name=safe_cli_executable_name, safe_cli_public_raw=safe_cli_public_raw, safe_cli_public_text=safe_cli_public_text)

@app.post("/api/gemini-cli/help")
async def gemini_cli_help(payload: GeminiCliHelpRequest):
    return await gemini_cli_service.gemini_cli_help(payload, BASE_DIR=BASE_DIR, CLI_PUBLIC_TEXT_LIMIT=CLI_PUBLIC_TEXT_LIMIT, HTTPException=HTTPException, asyncio=asyncio, codex_decode_output=codex_decode_output, gemini_cli_display_name=gemini_cli_display_name, gemini_cli_executable=gemini_cli_executable, is_antigravity_cli=is_antigravity_cli, safe_cli_public_raw=safe_cli_public_raw, safe_cli_public_text=safe_cli_public_text)

@app.get("/api/jimeng/status")
async def jimeng_status():
    return await jimeng_execution_service.jimeng_status(HTTPException=HTTPException, JIMENG_MIN_CLI_VERSION=JIMENG_MIN_CLI_VERSION, jimeng_cli_executable=jimeng_cli_executable, jimeng_cli_missing_message=jimeng_cli_missing_message, jimeng_cli_version=jimeng_cli_version, public_error_detail=public_error_detail, public_jimeng_credit=public_jimeng_credit, run_jimeng_cli=run_jimeng_cli)

@app.get("/api/jimeng/credit")
async def jimeng_credit():
    return await jimeng_execution_service.jimeng_credit(public_jimeng_credit=public_jimeng_credit, run_jimeng_cli=run_jimeng_cli)

@app.post("/api/jimeng/logout")
async def jimeng_logout():
    return await jimeng_execution_service.jimeng_logout(run_jimeng_cli=run_jimeng_cli, safe_cli_public_text=safe_cli_public_text)

@app.post("/api/jimeng/login/start")
async def jimeng_login_start():
    return await jimeng_execution_service.jimeng_login_start(BASE_DIR=BASE_DIR, HTTPException=HTTPException, JIMENG_LOGIN_SESSION=JIMENG_LOGIN_SESSION, asyncio=asyncio, jimeng_cli_executable=jimeng_cli_executable, jimeng_command=jimeng_command, jimeng_login_qr_from_text=jimeng_login_qr_from_text, jimeng_login_reader=jimeng_login_reader, jimeng_login_text=jimeng_login_text, safe_cli_public_text=safe_cli_public_text, time=time)

@app.get("/api/jimeng/login/status")
async def jimeng_login_status():
    return await jimeng_execution_service.jimeng_login_status(HTTPException=HTTPException, JIMENG_LOGIN_SESSION=JIMENG_LOGIN_SESSION, jimeng_login_qr_from_text=jimeng_login_qr_from_text, jimeng_login_text=jimeng_login_text, public_jimeng_credit=public_jimeng_credit, run_jimeng_cli=run_jimeng_cli, safe_cli_public_text=safe_cli_public_text)

@app.post("/api/jimeng/help")
async def jimeng_help(payload: JimengHelpRequest):
    return await jimeng_execution_service.jimeng_help(payload, HTTPException=HTTPException, run_jimeng_cli=run_jimeng_cli, safe_cli_public_text=safe_cli_public_text)

@app.post("/api/jimeng/query-media")
async def jimeng_query_media(payload: JimengQueryMediaRequest):
    return await jimeng_execution_service.jimeng_query_media(payload, HTTPException=HTTPException, JimengPendingError=JimengPendingError, jimeng_pending_payload=jimeng_pending_payload, jimeng_public_queue_info=jimeng_public_queue_info, jimeng_query_result=jimeng_query_result, jimeng_store_outputs=jimeng_store_outputs, public_error_detail=public_error_detail)

@app.get("/api/config")
async def ai_config():
    return await provider_registry_service.ai_config(AI_API_KEY=AI_API_KEY, AI_BASE_URL=AI_BASE_URL, CHAT_MODEL=CHAT_MODEL, CHAT_MODELS=CHAT_MODELS, COMFYUI_INSTANCES=COMFYUI_INSTANCES, IMAGE_MODEL=IMAGE_MODEL, IMAGE_MODELS=IMAGE_MODELS, MODELSCOPE_CHAT_MODELS=MODELSCOPE_CHAT_MODELS, VIDEO_MODELS=VIDEO_MODELS, modelscope_api_key=modelscope_api_key, public_api_providers=public_api_providers)

@app.get("/api/models")
async def ai_models():
    return {"chat_models": CHAT_MODELS, "image_models": IMAGE_MODELS, "video_models": VIDEO_MODELS}

@app.get("/api/providers")
async def api_providers():
    return {"providers": public_api_providers()}

@app.put("/api/providers")
async def save_providers(payload: List[ApiProviderPayload]):
    return await provider_registry_service.save_providers(payload, HTTPException=HTTPException, model_dump_compat=model_dump_compat, normalize_provider=normalize_provider, preserve_runninghub_hidden_overrides=preserve_runninghub_hidden_overrides, provider_key_env=provider_key_env, prune_runninghub_workflow_store_for_provider=prune_runninghub_workflow_store_for_provider, public_provider=public_provider, reload_env_globals=reload_env_globals, runninghub_wallet_key_env=runninghub_wallet_key_env, save_api_providers=save_api_providers, sync_runninghub_provider_workflows_to_static_template=sync_runninghub_provider_workflows_to_static_template, update_env_values=update_env_values, volcengine_access_key_env=volcengine_access_key_env, volcengine_secret_key_env=volcengine_secret_key_env, volcengine_voice_api_key_env=volcengine_voice_api_key_env)

# --- ModelScope Token (从 env 读取，不再支持通过 UI 修改) ---

def modelscope_token_response(token: str) -> JSONResponse:
    """返回浏览器临时使用的 Token，并禁止浏览器及代理缓存机密内容。"""

    return JSONResponse(
        {"token": token},
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0",
            "Vary": "Origin",
        },
    )


def modelscope_token_status_response(configured: bool) -> JSONResponse:
    """返回 Token 是否已配置，但不把凭据交给浏览器。"""

    return JSONResponse(
        {"configured": bool(configured)},
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0",
            "Vary": "Origin",
        },
    )


def same_origin_request_allowed(request: Request) -> bool:
    """判断带 Origin 的浏览器请求是否与当前服务同源。"""

    origin = request.headers.get("origin")
    if origin is None:
        # 保持旧版直接请求兼容；远程监听仍由 RemoteAccessMiddleware 鉴权。
        return True
    try:
        source = urllib.parse.urlsplit(origin)
        target = request.url
        source_port = source.port if source.port is not None else (443 if source.scheme == "https" else 80)
        target_port = target.port if target.port is not None else (443 if target.scheme == "https" else 80)
        return (
            source.scheme in ("http", "https")
            and source.hostname is not None
            and target.hostname is not None
            and source.username is None
            and source.password is None
            and not (source.path or source.query or source.fragment)
            and source.scheme == target.scheme
            and source.hostname.lower() == target.hostname.lower()
            and source_port == target_port
        )
    except ValueError:
        return False


@app.get("/api/config/token")
async def get_global_token(request: Request):
    # Browser requests must come from this service's own origin. Use ASGI's
    # scheme (which a trusted proxy may set), never raw X-Forwarded-* headers.
    if not same_origin_request_allowed(request):
        raise HTTPException(status_code=403, detail="跨站来源不允许读取 Token")

    # 优先读 env，回退到 global_config.json（兼容旧数据）
    saved_token = modelscope_api_key()
    if saved_token:
        return modelscope_token_response(saved_token)
    return modelscope_token_response(read_legacy_modelscope_token())


@app.get("/api/config/token/status")
async def get_global_token_status(request: Request):
    """供新页面判断服务端是否有 Token，不向浏览器返回完整密钥。"""

    if not same_origin_request_allowed(request):
        raise HTTPException(status_code=403, detail="跨站来源不允许读取 Token 状态")
    saved_token = modelscope_api_key()
    if saved_token:
        return modelscope_token_status_response(True)
    return modelscope_token_status_response(bool(read_legacy_modelscope_token()))

# --- 在线生图 (COMFLY) ---

class TestConnectionPayload(BaseModel):
    base_url: str = ""
    api_key: str = ""
    provider_id: str = ""
    protocol: str = "openai"
    image_request_mode: str = "openai"

def protocol_from_payload(payload):
    provider_id = str(getattr(payload, "provider_id", "") or "").strip().lower()
    if provider_id == "volcengine":
        return "volcengine"
    if provider_id == "runninghub":
        return "runninghub"
    if provider_id == "jimeng":
        return "jimeng"
    base_url = str(getattr(payload, "base_url", "") or "").strip().lower()
    if "runninghub.cn" in base_url or "runninghub.ai" in base_url:
        return "runninghub"
    protocol = str(getattr(payload, "protocol", "") or "openai").strip().lower()
    return protocol if protocol in SUPPORTED_PROVIDER_PROTOCOLS else "openai"

def api_key_from_payload(payload, protocol: str = ""):
    explicit = str(getattr(payload, "api_key", "") or "").strip()
    provider_id = str(getattr(payload, "provider_id", "") or "").strip().lower()
    protocol = str(protocol or protocol_from_payload(payload) or "").strip().lower()
    if explicit:
        return explicit
    if provider_id:
        if provider_id == "runninghub":
            value = os.getenv(runninghub_wallet_key_env(), "")
            if value:
                return value
        value = provider_env_key_value(provider_id)
        if value:
            return value
    if protocol == "volcengine":
        return volcengine_provider_api_key("")
    return ""

def upstream_models_url(base_url: str, protocol: str):
    return provider_probe_service.upstream_models_url(base_url, protocol, runninghub_openapi_url=runninghub_openapi_url)

def upstream_model_headers(api_key: str, protocol: str):
    return provider_probe_service.upstream_model_headers(api_key, protocol, bearer_auth_value=bearer_auth_value)

_PUBLIC_PROBE_KEYS = frozenset({
    "status", "status_code", "code", "error_summary", "message", "source",
    "openapi_count", "llm_count", "model_count", "protocol", "models_error",
    "task_probe", "openai_probe", "openai_compat_probe", "async_probe",
})


def public_probe_raw(value):
    return provider_probe_service.public_probe_raw(value, _PUBLIC_PROBE_KEYS=_PUBLIC_PROBE_KEYS, _safe_upstream_text=_safe_upstream_text, public_probe_raw=public_probe_raw)


def volcengine_default_model_payload(status=200, message="", raw=None):
    return provider_probe_service.volcengine_default_model_payload(status, message, raw, public_probe_raw=public_probe_raw)

def volcengine_task_probe_url(base_url: str):
    return provider_probe_service.volcengine_task_probe_url(base_url)

async def probe_volcengine_task_endpoint(client, base_url: str, api_key: str):
    return await provider_probe_service.probe_volcengine_task_endpoint(client, base_url, api_key, looks_like_html_response=looks_like_html_response, probe_error_payload=probe_error_payload, upstream_model_headers=upstream_model_headers, volcengine_task_probe_url=volcengine_task_probe_url)

def openai_compat_root_for_probe(base_url: str):
    return provider_probe_service.openai_compat_root_for_probe(base_url)

async def probe_openai_compat_bearer_endpoint(client, base_url: str, api_key: str):
    return await provider_probe_service.probe_openai_compat_bearer_endpoint(client, base_url, api_key, looks_like_html_response=looks_like_html_response, openai_compat_root_for_probe=openai_compat_root_for_probe, probe_error_payload=probe_error_payload, upstream_model_headers=upstream_model_headers)

async def probe_openai_models_endpoint(client, base_url: str, api_key: str):
    return await provider_probe_service.probe_openai_models_endpoint(client, base_url, api_key, apply_locked_recommended_model_rules=apply_locked_recommended_model_rules, looks_like_html_response=looks_like_html_response, parse_upstream_models=parse_upstream_models, probe_error_payload=probe_error_payload, upstream_model_headers=upstream_model_headers, upstream_models_url=upstream_models_url)

async def probe_volcengine_auto_detect(client, base_url: str, api_key: str):
    return await provider_probe_service.probe_volcengine_auto_detect(client, base_url, api_key, probe_openai_compat_bearer_endpoint=probe_openai_compat_bearer_endpoint, probe_volcengine_task_endpoint=probe_volcengine_task_endpoint)

def classify_upstream_model(mid):
    return provider_probe_service.classify_upstream_model(mid)

def parse_upstream_models(raw, protocol="openai"):
    return provider_probe_service.parse_upstream_models(raw, protocol, classify_upstream_model=classify_upstream_model)

@app.post("/api/providers/test-connection")
async def test_provider_connection(payload: TestConnectionPayload):
    return await provider_probe_service.test_provider_connection(payload, HTTPException=HTTPException, JIMENG_DEFAULT_IMAGE_MODELS=JIMENG_DEFAULT_IMAGE_MODELS, JIMENG_DEFAULT_VIDEO_MODELS=JIMENG_DEFAULT_VIDEO_MODELS, RUNNINGHUB_DEFAULT_BASE_URL=RUNNINGHUB_DEFAULT_BASE_URL, _safe_upstream_text=_safe_upstream_text, api_key_from_payload=api_key_from_payload, apply_locked_recommended_model_rules=apply_locked_recommended_model_rules, detect_image_request_mode=detect_image_request_mode, fetch_codex_models_payload=fetch_codex_models_payload, gemini_cli_models_payload=gemini_cli_models_payload, gemini_cli_status=gemini_cli_status, httpx=httpx, jimeng_status=jimeng_status, log_net_error=log_net_error, looks_like_html_response=looks_like_html_response, normalize_image_request_mode=normalize_image_request_mode, parse_upstream_models=parse_upstream_models, probe_volcengine_auto_detect=probe_volcengine_auto_detect, protocol_from_payload=protocol_from_payload, runninghub_models_payload=runninghub_models_payload, safe_cli_public_raw=safe_cli_public_raw, safe_cli_public_text=safe_cli_public_text, upstream_model_headers=upstream_model_headers, upstream_models_url=upstream_models_url, upstream_response_error_summary=upstream_response_error_summary, volcengine_default_model_payload=volcengine_default_model_payload)

@app.post("/api/providers/probe-async")
async def probe_async_endpoint(payload: TestConnectionPayload):
    return await provider_probe_service.probe_async_endpoint(payload, HTTPException=HTTPException, api_key_from_payload=api_key_from_payload, bearer_auth_value=bearer_auth_value, codex_status=codex_status, detect_image_request_mode=detect_image_request_mode, gemini_cli_status=gemini_cli_status, httpx=httpx, is_tudou_base_url=is_tudou_base_url, log_net_error=log_net_error, looks_like_html_response=looks_like_html_response, normalize_image_request_mode=normalize_image_request_mode, probe_error_payload=probe_error_payload, probe_openai_compat_bearer_endpoint=probe_openai_compat_bearer_endpoint, probe_openai_models_endpoint=probe_openai_models_endpoint, probe_volcengine_auto_detect=probe_volcengine_auto_detect, probe_volcengine_task_endpoint=probe_volcengine_task_endpoint, protocol_from_payload=protocol_from_payload, safe_cli_public_raw=safe_cli_public_raw, safe_cli_public_text=safe_cli_public_text)

async def fetch_models_from_upstream(base_url: str, api_key: str, protocol: str = "openai", image_request_mode: str = "openai"):
    return await provider_probe_service.fetch_models_from_upstream(base_url, api_key, protocol, image_request_mode, HTTPException=HTTPException, JIMENG_DEFAULT_IMAGE_MODELS=JIMENG_DEFAULT_IMAGE_MODELS, JIMENG_DEFAULT_VIDEO_MODELS=JIMENG_DEFAULT_VIDEO_MODELS, RUNNINGHUB_DEFAULT_BASE_URL=RUNNINGHUB_DEFAULT_BASE_URL, SUPPORTED_PROVIDER_PROTOCOLS=SUPPORTED_PROVIDER_PROTOCOLS, _safe_upstream_text=_safe_upstream_text, apply_locked_recommended_model_rules=apply_locked_recommended_model_rules, detect_image_request_mode=detect_image_request_mode, fetch_codex_models_payload=fetch_codex_models_payload, gemini_cli_models_payload=gemini_cli_models_payload, gemini_cli_status=gemini_cli_status, httpx=httpx, log_net_error=log_net_error, looks_like_html_response=looks_like_html_response, normalize_image_request_mode=normalize_image_request_mode, parse_upstream_models=parse_upstream_models, probe_volcengine_auto_detect=probe_volcengine_auto_detect, runninghub_models_payload=runninghub_models_payload, upstream_model_headers=upstream_model_headers, upstream_models_url=upstream_models_url, upstream_response_error_summary=upstream_response_error_summary, volcengine_default_model_payload=volcengine_default_model_payload, volcengine_provider_api_key=volcengine_provider_api_key)

@app.post("/api/providers/fetch-models")
async def fetch_upstream_models_from_payload(payload: TestConnectionPayload):
    return await provider_probe_service.fetch_upstream_models_from_payload(payload, api_key_from_payload=api_key_from_payload, fetch_models_from_upstream=fetch_models_from_upstream, protocol_from_payload=protocol_from_payload)

@app.get("/api/providers/{provider_id}/fetch-models")
async def fetch_upstream_models(provider_id: str):
    return await provider_probe_service.fetch_upstream_models(provider_id, HTTPException=HTTPException, fetch_models_from_upstream=fetch_models_from_upstream, get_api_provider_exact=get_api_provider_exact, is_codex_provider=is_codex_provider, is_gemini_cli_provider=is_gemini_cli_provider, provider_env_key_value=provider_env_key_value, provider_protocol=provider_protocol, runninghub_wallet_key_env=runninghub_wallet_key_env)

async def query_native_catalog_image_task(kind, provider_id, task_id):
    return await image_result_service.query_native_catalog_image_task(kind, provider_id, task_id, AI_REQUEST_TIMEOUT=AI_REQUEST_TIMEOUT, HTTPException=HTTPException, get_midjourney_task=get_midjourney_task, httpx=httpx, image_output_meta=image_output_meta, modelscope_api_key=modelscope_api_key, modelscope_image_api_root=modelscope_image_api_root, save_ai_image_to_output=save_ai_image_to_output, urllib=urllib)


async def build_native_catalog_image_result(payload, on_remote_accept=None):
    return await image_result_service.build_native_catalog_image_result(payload, on_remote_accept, AI_REQUEST_TIMEOUT=AI_REQUEST_TIMEOUT, CloudGenRequest=CloudGenRequest, HTTPException=HTTPException, IMAGE_POLL_INTERVAL=IMAGE_POLL_INTERVAL, MidjourneySubmitRequest=MidjourneySubmitRequest, MsGenerateRequest=MsGenerateRequest, asyncio=asyncio, generate_angle_cloud=generate_angle_cloud, generate_cloud=generate_cloud, image_output_meta=image_output_meta, ms_generate=ms_generate, parse_size_pair=parse_size_pair, query_native_catalog_image_task=query_native_catalog_image_task, submit_midjourney=submit_midjourney, time=time)


async def build_online_image_result(payload: OnlineImageRequest, on_remote_accept=None):
    return await image_result_service.build_online_image_result(payload, on_remote_accept, CANVAS_IMAGE_REMOTE_ACCEPT_CALLBACK=CANVAS_IMAGE_REMOTE_ACCEPT_CALLBACK, HTTPException=HTTPException, IMAGE_MODEL=IMAGE_MODEL, asyncio=asyncio, build_native_catalog_image_result=build_native_catalog_image_result, extract_images=extract_images, extract_task_id=extract_task_id, friendly_image_error_detail=friendly_image_error_detail, generate_ai_image=generate_ai_image, generate_jimeng_upscale_image=generate_jimeng_upscale_image, get_api_provider=get_api_provider, httpx=httpx, image_output_meta=image_output_meta, image_references=image_references, is_jimeng_provider=is_jimeng_provider, log_net_error=log_net_error, manager=manager, model_dump_compat=model_dump_compat, public_usage=public_usage, save_ai_image_to_output=save_ai_image_to_output, save_to_history=save_to_history, schedule_coroutine=schedule_coroutine, selected_model=selected_model, snap_size_to_multiple=snap_size_to_multiple, time=time, upstream_error_summary=upstream_error_summary, upstream_response_error_summary=upstream_response_error_summary)

@app.post("/api/online-image")
async def online_image(payload: OnlineImageRequest):
    return await build_online_image_result(payload)

# Midjourney is intentionally kept outside the generic image-generation flow.
# APIMart exposes it as a task API with its own action endpoints, which does not
# match either OpenAI images or Gemini image responses.
APIMART_MIDJOURNEY_API_ROOT = "https://api.apimart.ai"
MIDJOURNEY_SPEEDS = {"relax", "fast", "turbo"}
MIDJOURNEY_ACTION_PATHS = {
    "upscale": "/v1/midjourney/generations/upscale",
    "variation": "/v1/midjourney/generations/variation",
    "low_variation": "/v1/midjourney/generations/low-variation",
    "high_variation": "/v1/midjourney/generations/high-variation",
    "reroll": "/v1/midjourney/generations/reroll",
    "zoom": "/v1/midjourney/generations/zoom",
    "pan": "/v1/midjourney/generations/pan",
    "inpaint": "/v1/midjourney/generations/inpaint",
    "remix_subtle": "/v1/midjourney/generations/remix-subtle",
    "remix_strong": "/v1/midjourney/generations/remix-strong",
}

def apimart_midjourney_provider(provider_id: str):
    return midjourney_service.apimart_midjourney_provider(provider_id, HTTPException=HTTPException, api_headers=api_headers, get_api_provider_exact=get_api_provider_exact, is_apimart_provider=is_apimart_provider)

def midjourney_response_data(raw):
    return midjourney_service.midjourney_response_data(raw)

def midjourney_task_id(raw):
    return midjourney_service.midjourney_task_id(raw, midjourney_response_data=midjourney_response_data)

def midjourney_task_status(raw):
    return midjourney_service.midjourney_task_status(raw, midjourney_response_data=midjourney_response_data)

def midjourney_error_detail(raw, fallback="Midjourney 请求失败"):
    return midjourney_service.midjourney_error_detail(raw, fallback, provider_error_summary=provider_error_summary)

def public_midjourney_submission(raw, task_id, provider_id, **extra):
    """只向画布返回 Midjourney 继续轮询所需字段。"""
    payload = {
        "task_id": str(task_id or "")[:240],
        "status": midjourney_task_status(raw) or "queued",
        "provider_id": str(provider_id or "")[:120],
    }
    for key, value in extra.items():
        if value is not None and key in {"mode", "action"}:
            payload[key] = str(value)[:40]
    return payload


def midjourney_remote_images(raw):
    return midjourney_service.midjourney_remote_images(raw, midjourney_response_data=midjourney_response_data)

async def midjourney_reference_urls(reference_images):
    return await midjourney_service.midjourney_reference_urls(reference_images, reference_to_data_url=reference_to_data_url)

async def midjourney_modal_mask_url(reference):
    return await midjourney_service.midjourney_modal_mask_url(reference, AIReference=AIReference, BytesIO=BytesIO, HTTPException=HTTPException, Image=Image, ImageOps=ImageOps, model_dump_compat=model_dump_compat, reference_to_data_url=reference_to_data_url, write_diagnostic=write_diagnostic)

async def apimart_midjourney_request(provider, path, body):
    return await midjourney_service.apimart_midjourney_request(provider, path, body, APIMART_MIDJOURNEY_API_ROOT=APIMART_MIDJOURNEY_API_ROOT, HTTPException=HTTPException, api_headers=api_headers, httpx=httpx, midjourney_task_id=midjourney_task_id, upstream_response_error_summary=upstream_response_error_summary)

async def midjourney_result(provider, task_id: str):
    return await midjourney_service.midjourney_result(provider, task_id, APIMART_MIDJOURNEY_API_ROOT=APIMART_MIDJOURNEY_API_ROOT, HTTPException=HTTPException, IMAGE_TASK_FAILED_STATUSES=IMAGE_TASK_FAILED_STATUSES, IMAGE_TASK_SUCCESS_STATUSES=IMAGE_TASK_SUCCESS_STATUSES, api_headers=api_headers, httpx=httpx, image_output_meta=image_output_meta, midjourney_error_detail=midjourney_error_detail, midjourney_remote_images=midjourney_remote_images, midjourney_task_status=midjourney_task_status, save_ai_image_to_output=save_ai_image_to_output, upstream_response_error_summary=upstream_response_error_summary)

@app.post("/api/midjourney/submit")
async def submit_midjourney(payload: MidjourneySubmitRequest):
    return await midjourney_service.submit_midjourney(payload, HTTPException=HTTPException, MIDJOURNEY_SPEEDS=MIDJOURNEY_SPEEDS, apimart_midjourney_provider=apimart_midjourney_provider, apimart_midjourney_request=apimart_midjourney_request, midjourney_reference_urls=midjourney_reference_urls, model_dump_compat=model_dump_compat, public_midjourney_submission=public_midjourney_submission)

@app.post("/api/midjourney/actions")
async def submit_midjourney_action(payload: MidjourneyActionRequest):
    return await midjourney_service.submit_midjourney_action(payload, HTTPException=HTTPException, MIDJOURNEY_ACTION_PATHS=MIDJOURNEY_ACTION_PATHS, MIDJOURNEY_SPEEDS=MIDJOURNEY_SPEEDS, apimart_midjourney_provider=apimart_midjourney_provider, apimart_midjourney_request=apimart_midjourney_request, public_midjourney_submission=public_midjourney_submission)

@app.post("/api/midjourney/modal")
async def submit_midjourney_modal(payload: MidjourneyModalRequest):
    return await midjourney_service.submit_midjourney_modal(payload, HTTPException=HTTPException, MIDJOURNEY_SPEEDS=MIDJOURNEY_SPEEDS, apimart_midjourney_provider=apimart_midjourney_provider, apimart_midjourney_request=apimart_midjourney_request, midjourney_modal_mask_url=midjourney_modal_mask_url, midjourney_task_status=midjourney_task_status, public_midjourney_submission=public_midjourney_submission)

@app.get("/api/midjourney/tasks/{task_id}")
async def get_midjourney_task(task_id: str, provider_id: str):
    return await midjourney_service.get_midjourney_task(task_id, provider_id, apimart_midjourney_provider=apimart_midjourney_provider, midjourney_result=midjourney_result)

@app.post("/api/image-task-query")
async def query_image_task(payload: ImageTaskQueryRequest):
    return await image_result_service.query_image_task(payload, HTTPException=HTTPException, IMAGE_TASK_FAILED_STATUSES=IMAGE_TASK_FAILED_STATUSES, extract_images=extract_images, fetch_image_task_payload=fetch_image_task_payload, get_api_provider=get_api_provider, httpx=httpx, image_output_meta=image_output_meta, image_task_fail_reason=image_task_fail_reason, image_task_status=image_task_status, is_runninghub_provider=is_runninghub_provider, log_net_error=log_net_error, manager=manager, rewrite_runninghub_file_url=rewrite_runninghub_file_url, runninghub_api_key=runninghub_api_key, runninghub_app_headers=runninghub_app_headers, runninghub_endpoint_url=runninghub_endpoint_url, runninghub_extract_outputs=runninghub_extract_outputs, runninghub_fail_reason=runninghub_fail_reason, runninghub_store_remote_output=runninghub_store_remote_output, safe_upstream_http_detail=safe_upstream_http_detail, safe_upstream_transport_detail=safe_upstream_transport_detail, save_ai_image_to_output=save_ai_image_to_output, save_to_history=save_to_history, schedule_coroutine=schedule_coroutine, time=time, upstream_response_error_summary=upstream_response_error_summary)

def _read_canvas_task_record(task_id: str) -> Optional[Dict[str, Any]]:
    try:
        return read_task_record(CANVAS_TASK_DIR, task_id)
    except TaskRecordError as exc:
        raise HTTPException(
            status_code=500,
            detail="本地任务记录损坏或无法读取；已停止重复提交，请先检查本地记录",
        ) from exc


def _durable_canvas_task(task: Dict[str, Any]) -> Dict[str, Any]:
    return canvas_task_service.durable_task(task, sanitize_usage=sanitize_record_usage)


def _write_canvas_task_record(task: Dict[str, Any], *, required: bool = False) -> bool:
    return canvas_task_service.write_record(
        task, required=required, root=CANVAS_TASK_DIR, snapshot=_durable_canvas_task,
        diagnostic=write_diagnostic, writer=write_task_record,
    )


async def persist_canvas_image_remote_accept(task_id: str, remote_task_id: str, *,
                                             query_mode: str = "http_get", batch: bool = False) -> None:
    await canvas_task_service.persist_remote_accept(
        task_id, remote_task_id, query_mode=query_mode, batch=batch,
        tasks=CANVAS_TASKS, task_lock=CANVAS_TASK_LOCK, process_id=CANVAS_TASK_PROCESS_ID,
        read_record=_read_canvas_task_record, write_record=_write_canvas_task_record,
    )


def _load_canvas_task_for_worker(task_id: str) -> Optional[Dict[str, Any]]:
    return canvas_task_service.load_for_worker(
        task_id, tasks=CANVAS_TASKS, process_id=CANVAS_TASK_PROCESS_ID,
        read_record=_read_canvas_task_record, diagnostic=write_diagnostic,
        read_error_types=(HTTPException,),
    )


def _mark_canvas_worker_start_failed(task: Dict[str, Any], task_id: str) -> None:
    canvas_task_service.mark_start_failed(
        task, task_id, tasks=CANVAS_TASKS, write_record=_write_canvas_task_record,
    )


def _interrupted_canvas_task(task: Dict[str, Any]) -> Dict[str, Any]:
    return canvas_task_service.interrupted_task(
        task, process_id=CANVAS_TASK_PROCESS_ID, unknown_message=CANVAS_TASK_UNKNOWN,
        write_record=_write_canvas_task_record,
    )


async def run_canvas_image_task(task_id: str, payload: OnlineImageRequest):
    await canvas_task_service.run_image_task(
        task_id, payload, gate=CANVAS_IMAGE_TASK_GATE, worker=_run_canvas_image_task,
    )


async def _run_canvas_image_task(task_id: str, payload: OnlineImageRequest):
    await canvas_task_service.run_image_worker(
        task_id, payload, task_lock=CANVAS_TASK_LOCK, load_task=_load_canvas_task_for_worker,
        mark_start_failed=_mark_canvas_worker_start_failed, write_record=_write_canvas_task_record,
        generate=build_online_image_result, accept_callback=CANVAS_IMAGE_REMOTE_ACCEPT_CALLBACK,
        persist_accept=persist_canvas_image_remote_accept, pending_error=JimengPendingError,
        pending_payload=jimeng_pending_payload, public_queue_info=jimeng_public_queue_info,
        public_error_detail=public_comfy_error_detail, extract_task_id=extract_task_id_from_text,
        unknown_message=CANVAS_TASK_UNKNOWN, diagnostic=write_diagnostic,
    )

class CanvasAudioTaskRequest(BaseModel):
    client_task_id: str = Field(min_length=20, max_length=100, pattern=r"^canvas_audio_[A-Za-z0-9_-]+$")
    provider_id: str = Field(min_length=1, max_length=120)
    model: str = Field(min_length=1, max_length=240)
    prompt: str = Field(default="", max_length=10000)
    settings: Dict[str, Any] = Field(default_factory=dict)
    references: List[Dict[str, Any]] = Field(default_factory=list, max_length=3)
    operation: str = Field(default="generation", pattern=r"^(generation|recognition)$")


CANVAS_AUDIO_TASK_GATE = asyncio.Semaphore(3)


@contextmanager
def _canvas_audio_task_errors():
    try:
        yield
    except canvas_audio_service.AudioServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


async def build_canvas_audio_result(payload: CanvasAudioTaskRequest):
    with _canvas_audio_task_errors():
        return await canvas_audio_service.build_result(
            payload, get_provider=get_api_provider_exact, media_factory=video_deconstruction_media,
            headers_for=api_headers, upstream_http_detail=safe_upstream_http_detail,
            public_error=public_comfy_error_detail, output_path=output_path_for, output_url=output_url_for,
        )


async def run_canvas_audio_task(task_id, payload):
    await canvas_audio_service.run_task(
        task_id, payload, gate=CANVAS_AUDIO_TASK_GATE, task_lock=CANVAS_TASK_LOCK,
        load_task=_load_canvas_task_for_worker, mark_start_failed=_mark_canvas_worker_start_failed,
        write_record=_write_canvas_task_record, generate=build_canvas_audio_result,
        public_error=public_comfy_error_detail,
    )


@app.post("/api/canvas-audio-tasks")
async def create_canvas_audio_task(payload: CanvasAudioTaskRequest, request: Request):
    with _canvas_audio_task_errors():
        return await canvas_audio_service.create_task(
            payload, tasks=CANVAS_TASKS, task_lock=CANVAS_TASK_LOCK, root=CANVAS_TASK_DIR,
            process_id=CANVAS_TASK_PROCESS_ID, get_provider=get_api_provider_exact,
            headers_for=api_headers, snapshot=_durable_canvas_task,
            worker=run_canvas_audio_task, spawn=asyncio.create_task, trace_factory=task_context,
            trace_id=getattr(request.state, "trace_id", ""), request_id=getattr(request.state, "request_id", ""),
        )


@app.get("/api/canvas-audio-tasks/{task_id}")
async def get_canvas_audio_task(task_id: str):
    with _canvas_audio_task_errors():
        return canvas_audio_service.get_task(
            task_id, tasks=CANVAS_TASKS, task_lock=CANVAS_TASK_LOCK,
            read_record=_read_canvas_task_record, write_record=_write_canvas_task_record,
            public_record=_public_canvas_task, interrupted_record=_interrupted_canvas_task,
        )


@app.post("/api/canvas-audio-tasks/{task_id}/refresh")
async def refresh_canvas_audio_task(task_id: str):
    # 同步音频协议没有远端查询编号；刷新只查询本地记录，绝不二次提交。
    return await get_canvas_audio_task(task_id)


@app.post("/api/canvas-image-tasks")
async def create_canvas_image_task(payload: OnlineImageRequest, request: Request):
    return await enqueue_canvas_image_task(payload, request)


async def enqueue_canvas_image_task(payload: OnlineImageRequest, request: Request, task_id=None):
    return await canvas_task_service.enqueue_canvas_image_task(payload, request, task_id, AIReference=AIReference, CANVAS_TASKS=CANVAS_TASKS, CANVAS_TASK_LOCK=CANVAS_TASK_LOCK, CANVAS_TASK_PROCESS_ID=CANVAS_TASK_PROCESS_ID, HTTPException=HTTPException, TaskRecordError=TaskRecordError, _read_canvas_task_record=_read_canvas_task_record, _write_canvas_task_record=_write_canvas_task_record, asyncio=asyncio, canvas_assistant_providers=canvas_assistant_providers, hashlib=hashlib, load_canvas=load_canvas, model_dump_compat=model_dump_compat, run_canvas_image_task=run_canvas_image_task, task_context=task_context, task_input_summary=task_input_summary)

@app.get("/api/canvas-image-tasks/{task_id}")
async def get_canvas_image_task(task_id: str):
    return await canvas_task_service.get_canvas_image_task(task_id, CANVAS_TASKS=CANVAS_TASKS, CANVAS_TASK_LOCK=CANVAS_TASK_LOCK, HTTPException=HTTPException, _interrupted_canvas_task=_interrupted_canvas_task, _public_canvas_task=_public_canvas_task, _read_canvas_task_record=_read_canvas_task_record)


@app.post("/api/canvas-image-tasks/{task_id}/refresh")
async def refresh_canvas_image_task(task_id: str):
    return await canvas_task_service.refresh_canvas_image_task(task_id, CANVAS_TASKS=CANVAS_TASKS, CANVAS_TASK_LOCK=CANVAS_TASK_LOCK, CANVAS_TASK_PROCESS_ID=CANVAS_TASK_PROCESS_ID, HTTPException=HTTPException, ImageTaskQueryRequest=ImageTaskQueryRequest, _canvas_remote_errors=_canvas_remote_errors, _canvas_remote_records=_canvas_remote_records, _canvas_remote_results=_canvas_remote_results, _canvas_remote_statuses=_canvas_remote_statuses, _public_canvas_task=_public_canvas_task, _read_canvas_task_record=_read_canvas_task_record, _update_canvas_remote_tracking=_update_canvas_remote_tracking, _write_canvas_task_record=_write_canvas_task_record, get_api_provider_exact=get_api_provider_exact, image_batch_outcome=image_batch_outcome, is_runninghub_provider=is_runninghub_provider, public_comfy_error_detail=public_comfy_error_detail, query_image_task=query_image_task, query_native_catalog_image_task=query_native_catalog_image_task, task_state_update=task_state_update)


@app.get("/api/maintenance/task-records/cleanup-plan")
async def get_task_record_cleanup_plan(
    ttl_seconds: float = DEFAULT_TASK_TTL_SECONDS,
):
    """生成任务记录的只读过期清理计划。

    这是供维护者手动核对的入口，只调用计划阶段，不删除记录，也不会在
    启动流程中自动运行。应用阶段仍需由明确的维护脚本持有计划后显式调用。
    ``canvas_video_tasks`` 不在本入口范围内，视频记录必须先完成远端对账。
    """

    try:
        # 计划扫描没有 await；与当前进程的任务记录写入共用进程内锁，目录级
        # 扫描本身由 task_record_cleanup 持有跨进程文件锁，避免快照交错。
        with CANVAS_TASK_LOCK:
            plan = plan_expired_task_cleanup(
                CANVAS_TASK_DIR,
                ttl_seconds=ttl_seconds,
            )
        return public_task_cleanup_plan(plan)
    except TaskCleanupError as exc:
        write_diagnostic(
            f"canvas task cleanup plan failed error={type(exc).__name__}"
        )
        raise HTTPException(
            status_code=409,
            detail="无法生成任务记录清理计划，请先检查本地任务记录",
        ) from exc


@app.get("/api/maintenance/task-concurrency")
async def get_task_concurrency():
    """公开本进程任务闸门计数，便于维护页面解释排队原因。"""

    return {
        "scope": "process",
        "limits": dict(TASK_CONCURRENCY_LIMITS),
        "tasks": [
            CANVAS_IMAGE_TASK_GATE.status(),
            CANVAS_COMFY_TASK_GATE.status(),
            CANVAS_VIDEO_TASK_GATE.status(),
        ],
    }


@app.get("/api/extensions")
async def list_extensions():
    """列出已显式注册的扩展及其依赖状态。"""

    return {"extensions": EXTENSION_REGISTRY.public_descriptors()}


@app.post("/api/extensions/{extension_id}/run")
async def run_extension(extension_id: str, payload: ExtensionMediaProbeRequest):
    """执行一个受控扩展；当前内置示例只处理少量文件头字节。"""

    try:
        head = base64.b64decode(payload.head_base64 or "", validate=True)
    except (ValueError, TypeError):
        raise HTTPException(status_code=422, detail="扩展文件头编码无效")
    if len(head) > 128:
        raise HTTPException(status_code=422, detail="扩展文件头过大")
    result = EXTENSION_REGISTRY.run(
        extension_id,
        {
            "filename": payload.filename,
            "content_type": payload.content_type,
            "head": head,
        },
    )
    return result.public()

async def run_canvas_comfy_task(task_id: str, payload: GenerateRequest):
    await comfy_task_service.run_comfy_task(
        task_id,
        payload,
        gate=CANVAS_COMFY_TASK_GATE,
        worker=_run_canvas_comfy_task,
    )


async def _run_canvas_comfy_task(task_id: str, payload: GenerateRequest):
    await comfy_task_service.run_comfy_task_worker(
        task_id,
        payload,
        task_lock=CANVAS_TASK_LOCK,
        load_task=_load_canvas_task_for_worker,
        mark_start_failed=_mark_canvas_worker_start_failed,
        write_record=_write_canvas_task_record,
        generate=generate,
        task_state_update=task_state_update,
        public_error_detail=public_comfy_error_detail,
        write_diagnostic=write_diagnostic,
        record_error_types=(OSError, TaskRecordError),
    )

@app.post("/api/canvas-comfy-tasks")
async def create_canvas_comfy_task(payload: GenerateRequest, request: Request):
    return await comfy_task_service.create_canvas_comfy_task(payload, request, re=re, HTTPException=HTTPException, uuid=uuid, task_context=task_context, CANVAS_TASK_LOCK=CANVAS_TASK_LOCK, CANVAS_TASKS=CANVAS_TASKS, time=time, task_input_summary=task_input_summary, CANVAS_TASK_PROCESS_ID=CANVAS_TASK_PROCESS_ID, _write_canvas_task_record=_write_canvas_task_record, TaskRecordError=TaskRecordError, asyncio=asyncio, run_canvas_comfy_task=run_canvas_comfy_task)

@app.get("/api/canvas-comfy-tasks/{task_id}")
async def get_canvas_comfy_task(task_id: str):
    return await comfy_task_service.get_canvas_comfy_task(task_id, CANVAS_TASK_LOCK=CANVAS_TASK_LOCK, CANVAS_TASKS=CANVAS_TASKS, _read_canvas_task_record=_read_canvas_task_record, HTTPException=HTTPException, _public_canvas_task=_public_canvas_task, _interrupted_canvas_task=_interrupted_canvas_task)

# --- 图像生成参数 schema（供客户端动态渲染参数表单，避免把参数写死在前端） ---
IMAGE_PARAM_RATIOS = [
    {"value": "1:1", "label": "1:1"},
    {"value": "3:4", "label": "3:4"},
    {"value": "4:3", "label": "4:3"},
    {"value": "16:9", "label": "16:9"},
    {"value": "9:16", "label": "9:16"},
    {"value": "2:3", "label": "2:3"},
    {"value": "3:2", "label": "3:2"},
]
IMAGE_PARAM_RESOLUTIONS = [
    {"value": "1k", "label": "1K"},
    {"value": "2k", "label": "2K"},
    {"value": "4k", "label": "4K"},
]

def build_image_param_fields(engine: str, provider: dict, model: str):
    return image_provider_service.build_image_param_fields(engine, provider, model, is_gpt_image_2_model=is_gpt_image_2_model, IMAGE_PARAM_RESOLUTIONS=IMAGE_PARAM_RESOLUTIONS, IMAGE_PARAM_RATIOS=IMAGE_PARAM_RATIOS, ONLINE_IMAGE_REFERENCE_MAX=ONLINE_IMAGE_REFERENCE_MAX)

@app.get("/api/image-params")
async def image_params(provider_id: str = "", model: str = ""):
    return await image_provider_service.image_params(provider_id, model, load_api_providers=load_api_providers, is_runninghub_provider=is_runninghub_provider, is_volcengine_provider=is_volcengine_provider, build_image_param_fields=build_image_param_fields)

# --- Canvas Video ---



def video_output_urls(raw):
    return video_result_service.video_output_urls(raw)

def video_api_root(provider):
    return video_provider_service.video_api_root(provider, AI_BASE_URL=AI_BASE_URL, is_volcengine_provider=is_volcengine_provider)

def looks_like_html_response(text: str) -> bool:
    sample = str(text or "").lstrip()[:200].lower()
    return sample.startswith("<!doctype html") or sample.startswith("<html") or "<head" in sample

def video_submit_url_candidates(provider, base_url):
    return video_provider_service.video_submit_url_candidates(provider, base_url, is_agnes_provider=is_agnes_provider, is_apimart_provider=is_apimart_provider, is_lingjing_provider=is_lingjing_provider, is_volcengine_provider=is_volcengine_provider, is_yuli_provider=is_yuli_provider)

def video_task_url_candidates(provider, base_url, task_id, submit_url=""):
    return video_provider_service.video_task_url_candidates(provider, base_url, task_id, submit_url, is_agnes_provider=is_agnes_provider, is_apimart_provider=is_apimart_provider, is_lingjing_provider=is_lingjing_provider, is_tudou_provider=is_tudou_provider, is_volcengine_provider=is_volcengine_provider, is_yuli_provider=is_yuli_provider)

VIDEO_TASK_SUCCESS_STATUSES = {
    "SUCCESS", "SUCCEED", "SUCCEEDED", "COMPLETED", "COMPLETE",
    "DONE", "FINISHED", "FINISH", "OK", "READY",
}
VIDEO_TASK_FAILURE_STATUSES = {
    "FAILURE", "FAILED", "FAIL", "ERROR", "ERRORED",
    "CANCELED", "CANCELLED", "TIMEOUT", "TIMEDOUT", "REJECTED", "EXPIRED",
}

def humanize_video_task_failure(reason) -> str:
    return video_result_service.humanize_video_task_failure(reason, _safe_upstream_text=_safe_upstream_text)

def public_video_generation_result(result):
    return video_result_service.public_video_generation_result(result, _safe_upstream_text=_safe_upstream_text, jimeng_public_queue_info=jimeng_public_queue_info)


async def wait_for_video_task(client, provider, task_id, submit_url=""):
    return await video_provider_service.wait_for_video_task(client, provider, task_id, submit_url, HTTPException=HTTPException, IMAGE_POLL_INTERVAL=IMAGE_POLL_INTERVAL, VIDEO_POLL_TIMEOUT=VIDEO_POLL_TIMEOUT, VIDEO_TASK_FAILURE_STATUSES=VIDEO_TASK_FAILURE_STATUSES, VIDEO_TASK_SUCCESS_STATUSES=VIDEO_TASK_SUCCESS_STATUSES, _notify_canvas_video_remote_accept=_notify_canvas_video_remote_accept, api_headers=api_headers, humanize_video_task_failure=humanize_video_task_failure, upstream_error_summary=upstream_error_summary, video_api_root=video_api_root, video_output_urls=video_output_urls, video_task_url_candidates=video_task_url_candidates)

def apimart_video_size(size):
    return video_request_service.apimart_video_size(size)

def agnes_video_dimensions(aspect_ratio="", resolution=""):
    return agnes_video_service.agnes_video_dimensions(aspect_ratio, resolution)

def agnes_video_frame_count(duration, fps=24):
    return agnes_video_service.agnes_video_frame_count(duration, fps)

async def agnes_video_image_url(ref):
    return await agnes_video_service.agnes_video_image_url(ref, upload_local_video_to_cloud=upload_local_video_to_cloud)

async def wait_for_agnes_video_task(client, provider, video_id, model):
    return await agnes_video_service.wait_for_agnes_video_task(client, provider, video_id, model, HTTPException=HTTPException, VIDEO_POLL_TIMEOUT=VIDEO_POLL_TIMEOUT, VIDEO_TASK_FAILURE_STATUSES=VIDEO_TASK_FAILURE_STATUSES, VIDEO_TASK_SUCCESS_STATUSES=VIDEO_TASK_SUCCESS_STATUSES, _notify_canvas_video_remote_accept=_notify_canvas_video_remote_accept, api_headers=api_headers, humanize_video_task_failure=humanize_video_task_failure, upstream_error_summary=upstream_error_summary, video_api_root=video_api_root, video_output_urls=video_output_urls)

async def generate_agnes_video(client, payload, provider, base_url, requested_model):
    return await agnes_video_service.generate_agnes_video(client, payload, provider, base_url, requested_model, HTTPException=HTTPException, agnes_video_dimensions=agnes_video_dimensions, agnes_video_frame_count=agnes_video_frame_count, agnes_video_image_url=agnes_video_image_url, api_headers=api_headers, model_list_from_values=model_list_from_values, save_remote_video_to_output=save_remote_video_to_output, selected_model=selected_model, video_output_urls=video_output_urls, wait_for_agnes_video_task=wait_for_agnes_video_task, wait_for_video_task=wait_for_video_task)

# ---- 玉玉API（yuli.host）OpenAI 视频格式：/v1/videos（multipart，支持 seconds 时长）----

def yuli_is_veo_openai_model(model: str) -> bool:
    # OpenAI multipart 格式当前只支持 veo_3_1 和 veo_3_1-fast
    return openai_video_service.yuli_is_veo_openai_model(model)

def yuli_openai_model_name(model: str) -> str:
    return openai_video_service.yuli_openai_model_name(model)

def yuli_openai_size(aspect_ratio: str) -> str:
    return openai_video_service.yuli_openai_size(aspect_ratio)

def lingjing_openai_video_model(model: str) -> str:
    return openai_video_service.lingjing_openai_video_model(model)

def yuli_video_seconds(duration) -> str:
    return openai_video_service.yuli_video_seconds(duration)

async def yuli_fetch_reference_bytes(client, ref_url):
    return await media_reference_service.yuli_fetch_reference_bytes(client, ref_url, content_type_for_path=content_type_for_path, output_file_from_url=output_file_from_url)

async def generate_lingjing_openai_video(client, payload, provider, base_url, requested_model):
    return await openai_video_service.generate_lingjing_openai_video(client, payload, provider, base_url, requested_model, HTTPException=HTTPException, api_headers=api_headers, extract_task_id=extract_task_id, lingjing_openai_video_model=lingjing_openai_video_model, save_remote_video_to_output=save_remote_video_to_output, selected_model=selected_model, video_output_urls=video_output_urls, wait_for_video_task=wait_for_video_task, yuli_fetch_reference_bytes=yuli_fetch_reference_bytes, yuli_openai_size=yuli_openai_size, yuli_video_seconds=yuli_video_seconds)

async def generate_yuli_openai_video(client, payload, provider, base_url, requested_model):
    return await openai_video_service.generate_yuli_openai_video(client, payload, provider, base_url, requested_model, HTTPException=HTTPException, api_headers=api_headers, extract_task_id=extract_task_id, save_remote_video_to_output=save_remote_video_to_output, video_output_urls=video_output_urls, wait_for_video_task=wait_for_video_task, yuli_fetch_reference_bytes=yuli_fetch_reference_bytes, yuli_openai_model_name=yuli_openai_model_name, yuli_openai_size=yuli_openai_size, yuli_video_seconds=yuli_video_seconds)

TUDOU_GROK_IMAGE_SIZES = {"1024x1024", "1280x720", "720x1280", "1792x1024", "1024x1792"}
TUDOU_GROK_IMAGE_ASPECT_SIZES = {
    "1:1": "1024x1024", "16:9": "1280x720", "9:16": "720x1280",
    "3:2": "1792x1024", "2:3": "1024x1792",
}

def tudou_grok_image_size(size, aspect_ratio=""):
    return tudou_provider_service.tudou_grok_image_size(size, aspect_ratio, TUDOU_GROK_IMAGE_ASPECT_SIZES=TUDOU_GROK_IMAGE_ASPECT_SIZES, TUDOU_GROK_IMAGE_SIZES=TUDOU_GROK_IMAGE_SIZES)

def tudou_api_endpoint(base_url, path):
    return tudou_provider_service.tudou_api_endpoint(base_url, path)

def tudou_reference_urls(ref):
    return tudou_provider_service.tudou_reference_urls(ref)

async def generate_tudou_grok_image(prompt, size, model, reference_images, provider, aspect_ratio=""):
    return await tudou_provider_service.generate_tudou_grok_image(prompt, size, model, reference_images, provider, aspect_ratio, HTTPException=HTTPException, api_headers=api_headers, extract_images=extract_images, httpx=httpx, selected_model=selected_model, tudou_api_endpoint=tudou_api_endpoint, tudou_grok_image_size=tudou_grok_image_size, tudou_reference_urls=tudou_reference_urls, upstream_error_summary=upstream_error_summary, upstream_response_error_summary=upstream_response_error_summary, yuli_fetch_reference_bytes=yuli_fetch_reference_bytes)

TUDOU_VIDEO_SUCCESS_STATUSES = {"COMPLETED", "COMPLETE", "DONE", "FINISHED", "SUCCESS", "SUCCEED", "SUCCEEDED", "SUCCESSFUL", "OK", "READY"}
TUDOU_VIDEO_FAILED_STATUSES = {"FAILED", "FAIL", "FAILURE", "ERROR", "ERRORED", "CANCELED", "CANCELLED", "TIMEOUT", "REJECTED", "EXPIRED"}

def tudou_video_family(model):
    return tudou_provider_service.tudou_video_family(model)

def is_tudou_video_model(model):
    return bool(tudou_video_family(model)) or is_tudou_grok_video_model(model)

def tudou_snap_choice(value, choices, default):
    return tudou_provider_service.tudou_snap_choice(value, choices, default)

def tudou_video_aspect(value, allowed=("16:9", "9:16"), default="16:9"):
    return tudou_provider_service.tudou_video_aspect(value, allowed, default)

def tudou_task_data(raw):
    return tudou_provider_service.tudou_task_data(raw)

def tudou_extract_task_id(raw):
    return tudou_provider_service.tudou_extract_task_id(raw, tudou_task_data=tudou_task_data)

def tudou_video_result_urls(raw):
    return tudou_provider_service.tudou_video_result_urls(raw, tudou_task_data=tudou_task_data)

async def tudou_public_image_urls(images, limit):
    return await tudou_provider_service.tudou_public_image_urls(images, limit, openai_video_proxy_public_reference_url=openai_video_proxy_public_reference_url)

async def tudou_public_media_urls(items, limit):
    return await tudou_provider_service.tudou_public_media_urls(items, limit, openai_video_proxy_public_reference_url=openai_video_proxy_public_reference_url)

async def tudou_wait_video_task(client, provider, base_url, task_id):
    return await tudou_provider_service.tudou_wait_video_task(client, provider, base_url, task_id, HTTPException=HTTPException, TUDOU_VIDEO_FAILED_STATUSES=TUDOU_VIDEO_FAILED_STATUSES, TUDOU_VIDEO_SUCCESS_STATUSES=TUDOU_VIDEO_SUCCESS_STATUSES, VIDEO_POLL_TIMEOUT=VIDEO_POLL_TIMEOUT, _notify_canvas_video_remote_accept=_notify_canvas_video_remote_accept, api_headers=api_headers, tudou_task_data=tudou_task_data, tudou_video_result_urls=tudou_video_result_urls, upstream_error_summary=upstream_error_summary)

async def generate_tudou_video(client, payload, provider, base_url, requested_model):
    return await tudou_provider_service.generate_tudou_video(client, payload, provider, base_url, requested_model, HTTPException=HTTPException, api_headers=api_headers, openai_video_proxy_public_reference_url=openai_video_proxy_public_reference_url, save_remote_video_to_output=save_remote_video_to_output, selected_model=selected_model, tudou_extract_task_id=tudou_extract_task_id, tudou_public_image_urls=tudou_public_image_urls, tudou_public_media_urls=tudou_public_media_urls, tudou_snap_choice=tudou_snap_choice, tudou_video_aspect=tudou_video_aspect, tudou_video_family=tudou_video_family, tudou_video_result_urls=tudou_video_result_urls, tudou_wait_video_task=tudou_wait_video_task, upstream_error_summary=upstream_error_summary)

def tudou_grok_video_seconds(duration):
    return tudou_provider_service.tudou_grok_video_seconds(duration)

def tudou_grok_video_size(aspect_ratio="", resolution=""):
    return tudou_provider_service.tudou_grok_video_size(aspect_ratio, resolution)

async def tudou_grok_video_part(client, ref):
    return await tudou_provider_service.tudou_grok_video_part(client, ref, yuli_fetch_reference_bytes=yuli_fetch_reference_bytes)

async def save_video_bytes_to_output(data, prefix="video_", ext=".mp4"):
    return await generation_output_service.save_video_bytes_to_output(data, prefix, ext, HTTPException=HTTPException, output_path_for=output_path_for, output_url_for=output_url_for, uuid=uuid)

async def download_tudou_grok_video_content(client, provider, base_url, task_id):
    return await tudou_provider_service.download_tudou_grok_video_content(client, provider, base_url, task_id, api_headers=api_headers, save_video_bytes_to_output=save_video_bytes_to_output)

async def generate_tudou_grok_video(client, payload, provider, base_url, requested_model):
    return await tudou_provider_service.generate_tudou_grok_video(client, payload, provider, base_url, requested_model, HTTPException=HTTPException, api_headers=api_headers, download_tudou_grok_video_content=download_tudou_grok_video_content, extract_task_id=extract_task_id, save_remote_video_to_output=save_remote_video_to_output, selected_model=selected_model, tudou_grok_video_part=tudou_grok_video_part, tudou_grok_video_seconds=tudou_grok_video_seconds, tudou_grok_video_size=tudou_grok_video_size, upstream_error_summary=upstream_error_summary, video_output_urls=video_output_urls, wait_for_video_task=wait_for_video_task)

def volcengine_video_prompt_text(prompt, aspect_ratio="", duration=None):
    return video_request_service.volcengine_video_prompt_text(prompt, aspect_ratio, duration)

CANVAS_VIDEO_TASK_LOCK = RLock()
CANVAS_VIDEO_TASK_PROCESS_ID = uuid.uuid4().hex
CANVAS_VIDEO_TASK_UNKNOWN = "视频请求可能已被上游受理，远端状态未知；请勿直接重新提交，以免重复计费。"
CANVAS_VIDEO_TASK_VOLATILE: Dict[str, Dict[str, Any]] = {}
CANVAS_VIDEO_REMOTE_ACCEPT_CALLBACK = ContextVar(
    "canvas_video_remote_accept_callback", default=None
)


async def _notify_canvas_video_remote_accept(remote_task_id: str, *, query_mode: str) -> None:
    """在视频适配器开始长轮询前，把可安全续查的远端编号交给任务记录。"""

    callback = CANVAS_VIDEO_REMOTE_ACCEPT_CALLBACK.get()
    if callback is None:
        return
    await callback(
        str(remote_task_id or ""),
        query_supported=True,
        query_mode=str(query_mode or "")[:40],
    )




def _video_remote_observation_for_result(result: Any, videos: Any = None):
    return canvas_video_task_service.result_observation(result, videos, output_urls=video_output_urls)


async def query_runninghub_video_task_once(provider: Dict[str, Any], remote_task_id: str):
    return await video_provider_service.query_runninghub_video_task_once(provider, remote_task_id, HTTPException=HTTPException, httpx=httpx, observe_remote_task=observe_remote_task, runninghub_extract_outputs=runninghub_extract_outputs, runninghub_fail_reason=runninghub_fail_reason, runninghub_json_headers=runninghub_json_headers, runninghub_openapi_url=runninghub_openapi_url, runninghub_query_status=runninghub_query_status, runninghub_store_remote_output=runninghub_store_remote_output, video_output_urls=video_output_urls, write_diagnostic=write_diagnostic)


async def query_jimeng_video_task_once(remote_task_id: str, kind: str = "video"):
    return await jimeng_execution_service.query_jimeng_video_task_once(remote_task_id, kind, HTTPException=HTTPException, JimengPendingError=JimengPendingError, jimeng_failure_reason=jimeng_failure_reason, jimeng_has_explicit_failure=jimeng_has_explicit_failure, jimeng_query_result=jimeng_query_result, jimeng_store_outputs=jimeng_store_outputs, observe_remote_task=observe_remote_task, public_error_detail=public_error_detail)


async def query_video_task_once(
    provider: Dict[str, Any],
    remote_task_id: str,
    *,
    query_mode: str = "http_get",
    model: str = "",
):
    return await video_provider_service.query_video_task_once(provider, remote_task_id, query_mode=query_mode, model=model, HTTPException=HTTPException, TUDOU_VIDEO_FAILED_STATUSES=TUDOU_VIDEO_FAILED_STATUSES, TUDOU_VIDEO_SUCCESS_STATUSES=TUDOU_VIDEO_SUCCESS_STATUSES, VIDEO_TASK_FAILURE_STATUSES=VIDEO_TASK_FAILURE_STATUSES, VIDEO_TASK_SUCCESS_STATUSES=VIDEO_TASK_SUCCESS_STATUSES, api_headers=api_headers, httpx=httpx, observe_remote_task=observe_remote_task, save_remote_video_to_output=save_remote_video_to_output, tudou_video_result_urls=tudou_video_result_urls, upstream_error_summary=upstream_error_summary, video_api_root=video_api_root, video_output_urls=video_output_urls, video_task_url_candidates=video_task_url_candidates, write_diagnostic=write_diagnostic)


@contextmanager
def _canvas_video_task_errors():
    try:
        yield
    except canvas_video_task_service.VideoTaskError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


def canvas_video_task_path(task_id: str) -> str:
    with _canvas_video_task_errors():
        return canvas_video_task_service.record_path(task_id, root=CANVAS_VIDEO_TASK_DIR)


@contextmanager
def canvas_video_task_record_lock(task_id: str):
    with canvas_video_task_service.record_lock(task_id, root=CANVAS_VIDEO_TASK_DIR, lock=CANVAS_VIDEO_TASK_LOCK):
        yield


def read_canvas_video_task(task_id: str) -> Optional[Dict[str, Any]]:
    with _canvas_video_task_errors():
        return canvas_video_task_service.read_record(task_id, root=CANVAS_VIDEO_TASK_DIR)


def write_canvas_video_task(task: Dict[str, Any]) -> None:
    with _canvas_video_task_errors():
        canvas_video_task_service.write_record(task, root=CANVAS_VIDEO_TASK_DIR)


async def persist_canvas_video_remote_accept(task_id: str, remote_task_id: str, *,
                                             query_supported: bool = True,
                                             query_mode: str = "runninghub_openapi") -> None:
    await canvas_video_task_service.persist_remote_accept(
        task_id, remote_task_id, query_supported=query_supported, query_mode=query_mode,
        process_id=CANVAS_VIDEO_TASK_PROCESS_ID, record_lock=canvas_video_task_record_lock,
        read_record=read_canvas_video_task, write_record=write_canvas_video_task,
    )


def public_canvas_video_task(task: Dict[str, Any]) -> Dict[str, Any]:
    return canvas_video_task_service.public_task(task, public_error=public_error_detail)


def interrupted_canvas_video_task(task: Dict[str, Any]) -> Dict[str, Any]:
    return canvas_video_task_service.interrupted_task(
        task, process_id=CANVAS_VIDEO_TASK_PROCESS_ID, unknown_message=CANVAS_VIDEO_TASK_UNKNOWN,
    )


def visible_canvas_video_task(recorded: Dict[str, Any]) -> Dict[str, Any]:
    return canvas_video_task_service.visible_task(recorded, volatile=CANVAS_VIDEO_TASK_VOLATILE)


def validate_canvas_video_assistant_task(
    payload: CanvasVideoTaskRequest,
    existing: Optional[Dict[str, Any]] = None,
    *,
    check_provider: bool = False,
) -> Dict[str, str]:
    return canvas_video_task_service.validate_canvas_video_assistant_task(payload, existing, check_provider=check_provider, re=re, HTTPException=HTTPException, hashlib=hashlib, json=json, model_dump_compat=model_dump_compat, get_api_provider_exact=get_api_provider_exact, model_list_from_values=model_list_from_values)


async def run_canvas_video_task(task_id: str, payload: CanvasVideoTaskRequest) -> None:
    await canvas_video_task_service.run_video_task(
        task_id, payload, gate=CANVAS_VIDEO_TASK_GATE, worker=_run_canvas_video_task,
    )


async def _run_canvas_video_task(task_id: str, payload: CanvasVideoTaskRequest) -> None:
    await canvas_video_task_service.run_video_worker(
        task_id, payload, record_lock=canvas_video_task_record_lock,
        read_record=read_canvas_video_task, write_record=write_canvas_video_task,
        process_id=CANVAS_VIDEO_TASK_PROCESS_ID, task_lock=CANVAS_VIDEO_TASK_LOCK,
        volatile=CANVAS_VIDEO_TASK_VOLATILE, validate=validate_canvas_video_assistant_task,
        accept_callback=CANVAS_VIDEO_REMOTE_ACCEPT_CALLBACK, persist_accept=persist_canvas_video_remote_accept,
        generate=canvas_video, result_observation=_video_remote_observation_for_result,
        pending_error=JimengPendingError, pending_payload=jimeng_pending_payload,
        public_queue_info=jimeng_public_queue_info, public_error=public_error_detail,
        unknown_message=CANVAS_VIDEO_TASK_UNKNOWN, diagnostic=write_diagnostic,
        record_error_types=(OSError, HTTPException),
    )


@app.post("/api/canvas-video-tasks")
async def create_canvas_video_task(payload: CanvasVideoTaskRequest):
    with _canvas_video_task_errors():
        return await canvas_video_task_service.create_task(
            payload, path_check=canvas_video_task_path, validate=validate_canvas_video_assistant_task,
            record_lock=canvas_video_task_record_lock, read_record=read_canvas_video_task,
            write_record=write_canvas_video_task, volatile=CANVAS_VIDEO_TASK_VOLATILE,
            process_id=CANVAS_VIDEO_TASK_PROCESS_ID, visible_record=visible_canvas_video_task,
            interrupted_record=interrupted_canvas_video_task, public_record=public_canvas_video_task,
            worker=run_canvas_video_task, spawn=asyncio.create_task,
        )


@app.get("/api/canvas-video-tasks/{task_id}")
async def get_canvas_video_task(task_id: str):
    with _canvas_video_task_errors():
        return canvas_video_task_service.get_task(
            task_id, record_lock=canvas_video_task_record_lock, read_record=read_canvas_video_task,
            volatile=CANVAS_VIDEO_TASK_VOLATILE, visible_record=visible_canvas_video_task,
            interrupted_record=interrupted_canvas_video_task, public_record=public_canvas_video_task,
        )


async def _query_canvas_video_remote(task, remote_id, provider_id, query_mode):
    return await canvas_video_task_service._query_canvas_video_remote(task, remote_id, provider_id, query_mode, get_api_provider_exact=get_api_provider_exact, HTTPException=HTTPException, is_runninghub_provider=is_runninghub_provider, query_runninghub_video_task_once=query_runninghub_video_task_once, is_jimeng_provider=is_jimeng_provider, query_jimeng_video_task_once=query_jimeng_video_task_once, is_tudou_provider=is_tudou_provider, is_agnes_provider=is_agnes_provider, query_video_task_once=query_video_task_once)


@app.post("/api/canvas-video-tasks/{task_id}/refresh")
async def refresh_canvas_video_task(task_id: str):
    with _canvas_video_task_errors():
        return await canvas_video_task_service.refresh_task(
            task_id, record_lock=canvas_video_task_record_lock, read_record=read_canvas_video_task,
            write_record=write_canvas_video_task, volatile=CANVAS_VIDEO_TASK_VOLATILE,
            visible_record=visible_canvas_video_task, interrupted_record=interrupted_canvas_video_task,
            public_record=public_canvas_video_task, query_remote=_query_canvas_video_remote,
            public_error=public_error_detail, unknown_message=CANVAS_VIDEO_TASK_UNKNOWN,
        )


async def _build_video_request(client, payload, provider, base_url, requested_model):
    if is_apimart_provider(provider):
        return await video_request_service.build_apimart_video_body(
            client, payload, provider, requested_model, is_apimart_veo31_model(requested_model),
            HTTPException=HTTPException,
            apimart_veo31_aspect=apimart_veo31_aspect,
            apimart_veo31_duration=apimart_veo31_duration,
            apimart_veo31_model=apimart_veo31_model,
            apimart_veo31_resolution=apimart_veo31_resolution,
            apimart_video_duration=apimart_video_duration,
            apimart_video_reference_error=apimart_video_reference_error,
            apimart_video_size=apimart_video_size,
            apply_trusted_asset_prompt_index=apply_trusted_asset_prompt_index,
            invalid_video_image_preview=invalid_video_image_preview,
            looks_like_image_media_url=looks_like_image_media_url,
            selected_model=selected_model,
            upload_audio_for_apimart=upload_audio_for_apimart,
            upload_image_for_apimart=upload_image_for_apimart,
            upload_video_for_apimart=upload_video_for_apimart,
            valid_apimart_video_image_input=valid_apimart_video_image_input,
        )
    is_volcengine = is_volcengine_provider(provider)
    volc_is_proxy = bool(is_volcengine and urllib.parse.urlparse(base_url).path.rstrip("/"))
    return await video_request_service.build_native_video_body(
        payload, is_volcengine, volc_is_proxy, is_yuli_provider(provider),
        HTTPException=HTTPException,
        apply_trusted_asset_prompt_index=apply_trusted_asset_prompt_index,
        looks_like_image_media_url=looks_like_image_media_url,
        model_dump_compat=model_dump_compat,
        probe_local_audio_duration_seconds=probe_local_audio_duration_seconds,
        reference_to_data_url=reference_to_data_url,
        selected_model=selected_model,
        volcengine_content_role=volcengine_content_role,
        volcengine_media_reference_url=volcengine_media_reference_url,
        volcengine_video_duration=volcengine_video_duration,
        volcengine_video_reference_content_items=volcengine_video_reference_content_items,
        volcengine_video_resolution=volcengine_video_resolution,
    )

async def _generate_http_video(payload, provider, base_url, requested_model):
    return await video_http_service.generate_http_video(payload, provider, base_url, requested_model,
        HTTPException=HTTPException,
        VIDEO_POLL_TIMEOUT=VIDEO_POLL_TIMEOUT,
        _safe_upstream_text=_safe_upstream_text,
        api_headers=api_headers,
        extract_task_id=extract_task_id,
        httpx=httpx,
        log_net_error=log_net_error,
        looks_like_html_response=looks_like_html_response,
        public_video_generation_result=public_video_generation_result,
        redact_url_for_log=redact_url_for_log,
        safe_upstream_http_detail=safe_upstream_http_detail,
        safe_upstream_transport_detail=safe_upstream_transport_detail,
        save_remote_video_to_output=save_remote_video_to_output,
        video_output_urls=video_output_urls,
        wait_for_video_task=wait_for_video_task,
        video_submit_url_candidates=video_submit_url_candidates,
        build_video_request=_build_video_request,
    )

@app.post("/api/canvas-video")
async def canvas_video(payload: CanvasVideoRequest):
    return await video_provider_service.canvas_video(payload,
        CANVAS_VIDEO_REMOTE_ACCEPT_CALLBACK=CANVAS_VIDEO_REMOTE_ACCEPT_CALLBACK,
        HTTPException=HTTPException,
        VIDEO_POLL_TIMEOUT=VIDEO_POLL_TIMEOUT,
        friendly_image_error_detail=friendly_image_error_detail,
        generate_agnes_video=generate_agnes_video,
        generate_jimeng_video=generate_jimeng_video,
        generate_lingjing_openai_video=generate_lingjing_openai_video,
        generate_runninghub_video=generate_runninghub_video,
        generate_tudou_grok_video=generate_tudou_grok_video,
        generate_tudou_video=generate_tudou_video,
        generate_yuli_openai_video=generate_yuli_openai_video,
        get_api_provider=get_api_provider,
        httpx=httpx,
        is_agnes_provider=is_agnes_provider,
        is_jimeng_provider=is_jimeng_provider,
        is_lingjing_provider=is_lingjing_provider,
        is_runninghub_provider=is_runninghub_provider,
        is_tudou_grok_video_model=is_tudou_grok_video_model,
        is_tudou_provider=is_tudou_provider,
        is_tudou_video_model=is_tudou_video_model,
        is_yuli_provider=is_yuli_provider,
        log_net_error=log_net_error,
        model_list_from_values=model_list_from_values,
        provider_env_key_value=provider_env_key_value,
        public_video_generation_result=public_video_generation_result,
        safe_upstream_http_detail=safe_upstream_http_detail,
        safe_upstream_transport_detail=safe_upstream_transport_detail,
        selected_model=selected_model,
        video_api_root=video_api_root,
        video_submit_url_candidates=video_submit_url_candidates,
        write_diagnostic=write_diagnostic,
        yuli_is_veo_openai_model=yuli_is_veo_openai_model,
        generate_http_video=_generate_http_video,
    )

# --- Canvas LLM ---

@app.post("/api/canvas-llm")
async def canvas_llm(payload: CanvasLLMRequest):
    return await chat_execution_service.canvas_llm(payload, AI_REQUEST_TIMEOUT=AI_REQUEST_TIMEOUT, CODEX_DEFAULT_CHAT_MODELS=CODEX_DEFAULT_CHAT_MODELS, GEMINI_CLI_DEFAULT_CHAT_MODELS=GEMINI_CLI_DEFAULT_CHAT_MODELS, HTTPException=HTTPException, MAX_HISTORY_MESSAGES=MAX_HISTORY_MESSAGES, codex_chat_text=codex_chat_text, friendly_chat_error_detail=friendly_chat_error_detail, gemini_cli_chat_text=gemini_cli_chat_text, get_api_provider=get_api_provider, httpx=httpx, is_apimart_provider=is_apimart_provider, is_codex_provider=is_codex_provider, is_gemini_cli_provider=is_gemini_cli_provider, is_image_reference_value=is_image_reference_value, is_video_reference_value=is_video_reference_value, log_net_error=log_net_error, media_reference_to_url=media_reference_to_url, public_usage=public_usage, required_chat_response_text=required_chat_response_text, resolve_chat_provider=resolve_chat_provider, safe_upstream_http_detail=safe_upstream_http_detail, safe_upstream_transport_detail=safe_upstream_transport_detail, selected_model=selected_model, unwrap_apimart_response=unwrap_apimart_response, video_reference_to_frame_data_urls=video_reference_to_frame_data_urls, write_diagnostic=write_diagnostic)

async def call_canvas_assistant_model(fields):
    return await chat_execution_service.call_canvas_assistant_model(fields, CanvasLLMRequest=CanvasLLMRequest, HTTPException=HTTPException, asyncio=asyncio, canvas_llm=canvas_llm, output_file_from_url=output_file_from_url, reference_to_data_url=reference_to_data_url)


def canvas_assistant_providers():
    """确认快照包含真实凭据摘要；公开模型目录与回合均不返回凭据。"""
    values = public_api_providers()
    for provider in values:
        credentials = [provider_env_key_value(provider['id'])]
        if provider.get('protocol') == 'codex':
            auth = gpt_image_2_skill_auth_json(gpt_image_2_skill_auth_file())
            credentials.append(auth)  # 登录变更（含令牌刷新）后重新确认方案。
        if provider['id'] == 'volcengine':
            credentials.extend([volcengine_access_key_value(), volcengine_secret_key_value()])
        provider['_configuration_revision'] = hashlib.sha256(json.dumps(credentials, sort_keys=True).encode()).hexdigest()
    return values


_video_deconstruction_manager = None
_video_deconstruction_key = None
_video_deconstruction_lock = Lock()
_video_speech_engine = None
_video_speech_key = None


def video_deconstruction_media(_context=None):
    dirs, assets_root, legacy_output = dict(_current_storage_dirs()), ASSETS_DIR, OUTPUT_DIR
    return VideoMedia(OUTPUT_OUTPUT_DIR, lambda name: resolve_output_url(name, 'output', dirs, assets_root),
                      lambda url: resolve_output_file(url, dirs, assets_root, legacy_output),
                      [assets_root, legacy_output, *dirs.values()])


def validate_video_deconstruction_source(context, _user):
    document = load_canvas(context.get('canvas_id', ''))
    if document.get('readOnly') or document.get('readonly'):
        raise ValueError('只读画布不能拆解视频')
    node = next((n for n in document.get('nodes', []) if n.get('id') == context.get('node_id')), None)
    if not node:
        raise ValueError('原视频节点已不存在，请保存画布后重试')
    candidates = [(node.get('url'), 'primary')] if node.get('type') == 'image' else []
    for item in [*node.get('images', []), *node.get('generatedOutputs', [])]:
        if isinstance(item, str):
            candidates.append((item, item))
        elif isinstance(item, dict):
            candidates.append((item.get('url'), str(item.get('id') or item.get('resultId') or item.get('url'))))
    if (context.get('source_url'), context.get('result_id')) not in candidates:
        raise ValueError('视频素材已经改变，请重新打开编辑入口')
    table_id = context.get('table_id')
    if table_id:
        table = next((n for n in document.get('nodes', []) if n.get('id') == table_id and n.get('type') in {'shot-table', 'smart-shot-table'}), None)
        if not table or table.get('shotTableData', {}).get('revision', 0) != context.get('table_revision', 0):
            raise ValueError('镜头表已变化，请保存后重新确认')
    return {k: context[k] for k in ('canvas_id', 'node_id', 'result_id', 'source_url', 'operation_id', 'table_id', 'table_revision') if k in context}


def video_speech_engine():
    global _video_speech_engine, _video_speech_key
    key = (os.path.realpath(DATA_DIR), os.path.realpath(OUTPUT_OUTPUT_DIR))
    if _video_speech_engine is None or key != _video_speech_key:
        _video_speech_engine = VideoSpeech(DATA_DIR, load_api_providers, provider_env_key_value, video_deconstruction_media())
        _video_speech_key = key
    return _video_speech_engine


def video_deconstruction_manager():
    global _video_deconstruction_manager, _video_deconstruction_key
    key = (os.path.realpath(DATA_DIR), os.path.realpath(OUTPUT_OUTPUT_DIR))
    with _video_deconstruction_lock:
        if _video_deconstruction_manager is None or key != _video_deconstruction_key:
            _video_deconstruction_manager = VideoDeconstructionManager(DATA_DIR, validate_video_deconstruction_source,
                video_deconstruction_media, canvas_assistant_providers, call_canvas_assistant_model,
                lambda *args, **kwargs: video_speech_engine().transcribe(*args, **kwargs),
                local_vision=LocalVideoVision(DATA_DIR, lambda url: video_deconstruction_media().resolve({'source_url':url})))
            _video_deconstruction_key = key
        return _video_deconstruction_manager


app.include_router(create_video_deconstruction_router(manager=video_deconstruction_manager, user_id=safe_user_id,
                                                     speech_engine=video_speech_engine))


def apply_canvas_assistant_operations(user, payload, operations):
    with CANVAS_LOCK:
        current = load_canvas(payload.canvasId)
        assets = canvas_assistant_reference_assets() if payload.referencedAssetIds else []
        _, reference_images, _ = canvas_context(current, payload, assets)
        candidate, summary = prepare_operations(
            current, operations, request_id=payload.requestId, user=user,
            expected_updated_at=payload.expectedUpdatedAt,
            creation_settings=payload.creationSettings, providers=canvas_assistant_providers(),
            image_model_confirmed=payload.imageModelConfirmed, reference_images=reference_images,
        )
        if candidate is not None:
            for proposal in summary.get("proposals", []):
                proposal["referenceAssetSnapshot"] = [{"id": a["id"], "url": a["url"]} for a in assets if a["id"] in payload.referencedAssetIds]
            _require_canvas_format(candidate)
            candidate["updated_at"] = max(now_ms(), int(current.get("updated_at") or 0) + 1)
            summary["updatedAtAfter"] = candidate["updated_at"]
            _write_canvas_document(candidate)
        return summary


async def notify_canvas_assistant_changed(canvas_id):
    await manager.broadcast_canvas_updated(canvas_id, int(load_canvas(canvas_id).get("updated_at") or 0), "canvas-assistant")


async def submit_canvas_assistant_image(proposal, image_request, request):
    with CANVAS_LOCK:
        current = load_canvas(request.state.assistant_canvas_id)
        validate_snapshot(current, proposal, canvas_assistant_providers(), proposal["confirmedUpdatedAt"])
        return await enqueue_canvas_image_task(OnlineImageRequest.model_validate(image_request), request, proposal["taskId"])


def canvas_assistant_reference_assets():
    """从真实素材索引读取公开展示字段，不接受客户端自报媒体地址。"""
    return canvas_assistant_reference_service.read_reference_assets(
        load_asset_library=load_asset_library, load_local_tree_and_items=_local_upload_tree_and_items,
        media_kind=asset_library_media_kind)


async def query_canvas_assistant_native_task(kind, task_id):
    return await canvas_assistant_native_service.query_canvas_assistant_native_task(kind, task_id, asyncio=asyncio, get_canvas_depth_capture=get_canvas_depth_capture, get_canvas_image_task=get_canvas_image_task, get_canvas_video_task=get_canvas_video_task, get_canvas_comfy_task=get_canvas_comfy_task, HTTPException=HTTPException)


async def control_canvas_assistant_native_task(action, kind, task_id):
    return await canvas_assistant_native_service.control_canvas_assistant_native_task(action, kind, task_id, asyncio=asyncio, refresh_canvas_image_task=refresh_canvas_image_task, refresh_canvas_video_task=refresh_canvas_video_task, cancel_canvas_depth_capture=cancel_canvas_depth_capture, HTTPException=HTTPException)


def canvas_assistant_workflow_fields(node):
    return canvas_assistant_native_service.canvas_assistant_workflow_fields(node, HTTPException=HTTPException, get_workflow=get_workflow, runninghub_provider_with_workflow_store=runninghub_provider_with_workflow_store, runninghub_provider=runninghub_provider, re=re, runninghub_entry_id=runninghub_entry_id, load_runninghub_workflow_store=load_runninghub_workflow_store, runninghub_workflow_store_key=runninghub_workflow_store_key)

def prepare_canvas_assistant_media_export(canvas_id,node,options,request_id=None):
    return canvas_assistant_native_service.prepare_canvas_assistant_media_export(canvas_id, node, options, request_id, DATA_DIR=DATA_DIR, subprocess=subprocess, HTTPException=HTTPException, json=json, local_media_path_from_url=local_media_path_from_url, OUTPUT_DIR=OUTPUT_DIR, ASSETS_DIR=ASSETS_DIR, _current_storage_dirs=_current_storage_dirs)


async def control_canvas_assistant_media_export(proposal,*,submit=False):
    return await canvas_assistant_native_service.control_canvas_assistant_media_export(proposal, submit=submit, load_canvas=load_canvas, HTTPException=HTTPException, OUTPUT_DIR=OUTPUT_DIR, ASSETS_DIR=ASSETS_DIR, _current_storage_dirs=_current_storage_dirs, DATA_DIR=DATA_DIR, subprocess=subprocess, json=json, asyncio=asyncio, local_media_path_from_url=local_media_path_from_url, canvas_clip_manager=canvas_clip_manager, create_canvas_clip_export=create_canvas_clip_export)


app.include_router(create_assistant_router(
    root=lambda: os.path.join(DATA_DIR, "canvas_assistant"),
    load_canvas=load_canvas,
    providers=canvas_assistant_providers,
    user_id=safe_user_id,
    call_model=call_canvas_assistant_model,
    public_error=public_error_detail,
    apply_operations=apply_canvas_assistant_operations,
    notify_changed=notify_canvas_assistant_changed,
    load_reference_assets=canvas_assistant_reference_assets,
    submit_image=submit_canvas_assistant_image,
    query_image=get_canvas_image_task,
    query_native_task=query_canvas_assistant_native_task,
    control_native_task=control_canvas_assistant_native_task,
    workflow_fields=canvas_assistant_workflow_fields,
    resolve_result_file=local_media_path_from_url,
    result_roots=lambda:[OUTPUT_DIR,ASSETS_DIR,*_current_storage_dirs().values()],
    media_export_prepare=prepare_canvas_assistant_media_export,
    media_export_control=control_canvas_assistant_media_export,
))

# --- 对话管理 ---

@app.get("/api/conversations")
async def conversations(request: Request, x_user_id: str = Header(default="")):
    return await conversation_service.conversations(request, x_user_id, list_conversations=list_conversations, safe_user_id=safe_user_id)

@app.post("/api/conversations")
async def create_conversation(payload: ConversationCreateRequest, request: Request, x_user_id: str = Header(default="")):
    return await conversation_service.create_conversation(payload, request, x_user_id, new_conversation=new_conversation, safe_user_id=safe_user_id)

@app.get("/api/conversations/{conversation_id}")
async def get_conversation(conversation_id: str, request: Request, x_user_id: str = Header(default="")):
    return await conversation_service.get_conversation(conversation_id, request, x_user_id, load_conversation=load_conversation, safe_user_id=safe_user_id)

@app.delete("/api/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str, request: Request, x_user_id: str = Header(default="")):
    return await conversation_service.delete_conversation(conversation_id, request, x_user_id, conversation_path=conversation_path, safe_user_id=safe_user_id)

# --- 画布管理 ---

@app.get("/api/canvases")
async def canvases():
    return {"canvases": list_canvases()}

@app.get("/api/projects")
async def get_projects():
    return {"projects": list_projects()}

@app.post("/api/projects")
async def create_project(payload: ProjectCreateRequest):
    return {"project": project_record(new_project(payload.name))}

@app.post("/api/projects/{project_id}")
async def update_project(project_id: str, payload: ProjectUpdateRequest):
    with _project_store() as store:
        return {"project": project_record(store.update(project_id, name=payload.name, order=payload.order))}

@app.delete("/api/projects/{project_id}")
async def delete_project(project_id: str):
    """删除项目：默认项目不可删除；其余项目删除后，其下画布回归默认项目（不删画布）。"""
    with _project_store() as store:
        return project_service.delete_project(
            project_id, store=store, read_canvases=_project_canvases_for_move,
            write_canvas=_write_canvas_document,
        )

@app.get("/api/canvases/trash")
async def trashed_canvases():
    return {"canvases": list_deleted_canvases(), "retention_days": 30}

@app.post("/api/canvases")
async def create_canvas(payload: CanvasCreateRequest):
    return {"canvas": new_canvas(payload.title, payload.icon, payload.kind, payload.project, payload.board_x, payload.board_y)}

@app.get("/api/canvases/{canvas_id}/meta")
async def get_canvas_meta(canvas_id: str):
    with _canvas_store() as store:
        return store.meta(canvas_id)

@app.post("/api/canvases/{canvas_id}/meta")
async def update_canvas_meta(canvas_id: str, payload: CanvasMetaUpdate):
    with _canvas_store() as store:
        canvas = store.update_meta(canvas_id, payload.model_dump())
    return {"canvas": canvas_record(canvas)}

@app.get("/api/canvases/{canvas_id}")
async def get_canvas(canvas_id: str):
    return {"canvas": load_canvas(canvas_id)}

@app.post("/api/canvases/{canvas_id}/touch")
async def touch_canvas(canvas_id: str):
    with _canvas_store() as store:
        canvas = store.touch(canvas_id)
    return {"canvas": canvas_record(canvas), "updated_at": canvas.get("updated_at", 0)}

@app.get("/api/canvas-assets")
async def list_canvas_assets():
    # canvas_assets_index 会同步遍历并解析所有画布 JSON，放进线程池避免阻塞事件循环
    # （否则画布多时一次请求就会卡住整个 asyncio loop，连 WebSocket 一起掉线）。
    return await asyncio.to_thread(canvas_assets_index)

@app.get("/api/smart-canvas/prompt-templates")
async def smart_canvas_prompt_templates():
    return await prompt_library_service.smart_canvas_prompt_templates(BASE_DIR=BASE_DIR, builtin_prompt_templates=builtin_prompt_templates, prompt_template_markdown_path=prompt_template_markdown_path, write_diagnostic=write_diagnostic)

@app.post("/api/canvas-assets/check")
async def check_canvas_assets(payload: CanvasAssetCheckRequest):
    result = {}
    for url in payload.urls[:3000]:
        text = str(url or "").strip()
        if not text:
            continue
        if text.startswith("/output/") or text.startswith("/assets/"):
            result[text] = bool(output_file_from_url(text))
        else:
            result[text] = True
    return {"exists": result}

@app.post("/api/canvas-assets/download")
async def download_canvas_assets(payload: CanvasAssetDownloadRequest):
    return await canvas_asset_export_service.download_canvas_assets(
        payload, output_file_from_url=output_file_from_url,
        local_media_file_by_basename=local_media_file_by_basename,
        fetch_remote_media_bytes=fetch_remote_media_bytes)

def canvas_workflow_collect_resource_refs(value, found=None):
    return workflow_archive_service.canvas_workflow_collect_resource_refs(value, found, canvas_workflow_collect_resource_refs=canvas_workflow_collect_resource_refs)

def canvas_workflow_unique_archive_name(base, used):
    return workflow_archive_service.canvas_workflow_unique_archive_name(base, used, sanitize_export_filename=sanitize_export_filename)

def canvas_workflow_replace_strings(value, mapping):
    return workflow_archive_service.canvas_workflow_replace_strings(value, mapping, canvas_workflow_replace_strings=canvas_workflow_replace_strings)

def canvas_workflow_payload(nodes, connections, resources=None):
    return workflow_archive_service.canvas_workflow_payload(nodes, connections, resources, now_ms=now_ms)

def build_canvas_workflow_archive(payload: CanvasWorkflowExportRequest) -> Tuple[bytes, Dict[str, Any]]:
    return workflow_archive_service.build_canvas_workflow_archive(payload, BytesIO=BytesIO, HTTPException=HTTPException, canvas_workflow_collect_resource_refs=canvas_workflow_collect_resource_refs, canvas_workflow_payload=canvas_workflow_payload, canvas_workflow_unique_archive_name=canvas_workflow_unique_archive_name, output_file_from_url=output_file_from_url)

@app.post("/api/canvas-workflows/export")
async def export_canvas_workflow(payload: CanvasWorkflowExportRequest):
    return await workflow_archive_service.export_canvas_workflow(payload, Response=Response, build_canvas_workflow_archive=build_canvas_workflow_archive, sanitize_export_filename=sanitize_export_filename)

@app.post("/api/canvas-workflows/export-to-library")
@serialize_asset_library_update
async def export_canvas_workflow_to_library(payload: CanvasWorkflowExportRequest):
    return await workflow_archive_service.export_canvas_workflow_to_library(payload, asset_library_workflow_category=asset_library_workflow_category, build_canvas_workflow_archive=build_canvas_workflow_archive, load_asset_library=load_asset_library, make_workflow_library_item_from_bytes=make_workflow_library_item_from_bytes, sanitize_export_filename=sanitize_export_filename, save_asset_library=save_asset_library)

@app.post("/api/asset-library/workflows/upload")
async def upload_asset_library_workflows(
    files: List[UploadFile] = File(...),
    library_id: str = Form(""),
    category_id: str = Form(""),
):
    return await workflow_archive_service.upload_asset_library_workflows(files, library_id, category_id, HTTPException=HTTPException, asset_library_index_lock=asset_library_index_lock, asset_library_workflow_category=asset_library_workflow_category, load_asset_library=load_asset_library, make_workflow_library_item_from_bytes=make_workflow_library_item_from_bytes, read_upload_file_limited=read_upload_file_limited, save_asset_library=save_asset_library)

@app.post("/api/canvas-workflows/import")
async def import_canvas_workflow(file: UploadFile = File(...)):
    return await workflow_archive_service.import_canvas_workflow(file, ASSETS_DIR=ASSETS_DIR, BytesIO=BytesIO, HTTPException=HTTPException, OUTPUT_INPUT_DIR=OUTPUT_INPUT_DIR, canvas_workflow_payload=canvas_workflow_payload, canvas_workflow_replace_strings=canvas_workflow_replace_strings, read_upload_file_limited=read_upload_file_limited, sanitize_export_filename=sanitize_export_filename, shutil=shutil, validate_workflow_zip_limits=validate_workflow_zip_limits, write_diagnostic=write_diagnostic)

def smart_group_export_folder(folder: str, group_name: str) -> str:
    return canvas_asset_export_service.smart_group_export_folder(
        folder, group_name, output_dir=OUTPUT_DIR)

@app.post("/api/smart-canvas/group-export")
async def export_smart_canvas_group(payload: SmartCanvasGroupExportRequest):
    return await canvas_asset_export_service.export_smart_canvas_group(
        payload, export_folder=smart_group_export_folder,
        output_file_from_url=output_file_from_url)

@app.get("/api/asset-library")
async def get_asset_library():
    return {"library": load_asset_library()}

@app.get("/api/prompt-libraries")
async def get_prompt_libraries():
    return await prompt_library_service.get_prompt_libraries(public_prompt_libraries=public_prompt_libraries)

@app.post("/api/prompt-libraries")
@serialize_prompt_library_update
async def create_prompt_library(payload: PromptLibraryRequest):
    return await prompt_library_service.create_prompt_library(payload, _load_prompt_libraries_unlocked=_load_prompt_libraries_unlocked, _save_prompt_libraries_unlocked=_save_prompt_libraries_unlocked, public_prompt_libraries=public_prompt_libraries, sanitize_asset_name=sanitize_asset_name)

@app.patch("/api/prompt-libraries/{library_id}")
@serialize_prompt_library_update
async def rename_prompt_library(library_id: str, payload: PromptLibraryRequest):
    return await prompt_library_service.rename_prompt_library(library_id, payload, HTTPException=HTTPException, _load_prompt_libraries_unlocked=_load_prompt_libraries_unlocked, _save_prompt_libraries_unlocked=_save_prompt_libraries_unlocked, find_prompt_library=find_prompt_library, public_prompt_libraries=public_prompt_libraries, sanitize_asset_name=sanitize_asset_name)

@app.delete("/api/prompt-libraries/{library_id}")
@serialize_prompt_library_update
async def delete_prompt_library(library_id: str):
    return await prompt_library_service.delete_prompt_library(library_id, HTTPException=HTTPException, _load_prompt_libraries_unlocked=_load_prompt_libraries_unlocked, _save_prompt_libraries_unlocked=_save_prompt_libraries_unlocked, public_prompt_libraries=public_prompt_libraries)

@app.post("/api/prompt-libraries/items")
@serialize_prompt_library_update
async def add_prompt_library_item(payload: PromptLibraryItemRequest):
    return await prompt_library_service.add_prompt_library_item(payload, HTTPException=HTTPException, _load_prompt_libraries_unlocked=_load_prompt_libraries_unlocked, _save_prompt_libraries_unlocked=_save_prompt_libraries_unlocked, find_prompt_library=find_prompt_library, normalize_prompt_library_item=normalize_prompt_library_item, now_ms=now_ms, public_prompt_libraries=public_prompt_libraries)

@app.patch("/api/prompt-libraries/items/{item_id}")
@serialize_prompt_library_update
async def update_prompt_library_item(item_id: str, payload: PromptLibraryItemRequest):
    return await prompt_library_service.update_prompt_library_item(item_id, payload, HTTPException=HTTPException, _load_prompt_libraries_unlocked=_load_prompt_libraries_unlocked, _save_prompt_libraries_unlocked=_save_prompt_libraries_unlocked, normalize_prompt_library_item=normalize_prompt_library_item, now_ms=now_ms, public_prompt_libraries=public_prompt_libraries)

@app.delete("/api/prompt-libraries/items/{item_id}")
@serialize_prompt_library_update
async def delete_prompt_library_item(item_id: str):
    return await prompt_library_service.delete_prompt_library_item(item_id, HTTPException=HTTPException, _load_prompt_libraries_unlocked=_load_prompt_libraries_unlocked, _save_prompt_libraries_unlocked=_save_prompt_libraries_unlocked, public_prompt_libraries=public_prompt_libraries)

@app.post("/api/prompt-libraries/items/delete")
@serialize_prompt_library_update
async def batch_delete_prompt_library_items(payload: PromptLibraryBatchDeleteRequest):
    return await prompt_library_service.batch_delete_prompt_library_items(payload, HTTPException=HTTPException, _load_prompt_libraries_unlocked=_load_prompt_libraries_unlocked, _save_prompt_libraries_unlocked=_save_prompt_libraries_unlocked, public_prompt_libraries=public_prompt_libraries)

PROMPT_BUILTIN_CATEGORY_IDS = {"view", "storyboard", "character", "product", "lighting", "custom"}

@app.post("/api/prompt-libraries/categories")
@serialize_prompt_library_update
async def add_prompt_library_category(payload: PromptLibraryCategoryRequest):
    return await prompt_library_service.add_prompt_library_category(payload, HTTPException=HTTPException, PROMPT_BUILTIN_CATEGORY_IDS=PROMPT_BUILTIN_CATEGORY_IDS, _load_prompt_libraries_unlocked=_load_prompt_libraries_unlocked, _save_prompt_libraries_unlocked=_save_prompt_libraries_unlocked, find_prompt_library=find_prompt_library, public_prompt_libraries=public_prompt_libraries, sanitize_asset_name=sanitize_asset_name)

@app.patch("/api/prompt-libraries/categories/{category_id}")
@serialize_prompt_library_update
async def rename_prompt_library_category(category_id: str, payload: PromptLibraryCategoryRequest):
    # 系统库（内置）分组也允许重命名：分组的 id 不变，只改显示名，
    # 这样画布与素材库管理共用同一份分组数据，重命名两端实时同步。
    return await prompt_library_service.rename_prompt_library_category(category_id, payload, HTTPException=HTTPException, _load_prompt_libraries_unlocked=_load_prompt_libraries_unlocked, _save_prompt_libraries_unlocked=_save_prompt_libraries_unlocked, public_prompt_libraries=public_prompt_libraries, sanitize_asset_name=sanitize_asset_name)

@app.delete("/api/prompt-libraries/categories/{category_id}")
@serialize_prompt_library_update
async def delete_prompt_library_category(category_id: str):
    # 系统库（内置）分组也允许删除，与素材库管理/画布保持一致。
    return await prompt_library_service.delete_prompt_library_category(category_id, HTTPException=HTTPException, _load_prompt_libraries_unlocked=_load_prompt_libraries_unlocked, _save_prompt_libraries_unlocked=_save_prompt_libraries_unlocked, public_prompt_libraries=public_prompt_libraries)

@app.post("/api/asset-library/libraries")
@serialize_asset_library_update
async def create_asset_library(payload: AssetLibraryRequest):
    return await asset_library_service.create_asset_library(payload, load_asset_library=load_asset_library, sanitize_asset_name=sanitize_asset_name, save_asset_library=save_asset_library)

@app.patch("/api/asset-library/libraries/{library_id}")
@serialize_asset_library_update
async def rename_asset_library(library_id: str, payload: AssetLibraryRenameRequest):
    return await asset_library_service.rename_asset_library(library_id, payload, HTTPException=HTTPException, find_asset_library=find_asset_library, load_asset_library=load_asset_library, sanitize_asset_name=sanitize_asset_name, save_asset_library=save_asset_library)

@app.delete("/api/asset-library/libraries/{library_id}")
async def delete_asset_library(library_id: str):
    # 先提交索引，再清理实体文件。这样即使清理中途失败，也不会留下指向
    # 已删除资产库条目的索引；remove_asset_library_file 会再次检查剩余引用。
    return await asset_library_service.delete_asset_library(library_id, ASSET_LIBRARY_DIR=ASSET_LIBRARY_DIR, HTTPException=HTTPException, asset_library_index_lock=asset_library_index_lock, load_asset_library=load_asset_library, remove_asset_library_file=remove_asset_library_file, save_asset_library=save_asset_library, write_diagnostic=write_diagnostic)

@app.post("/api/asset-library/categories")
@serialize_asset_library_update
async def create_asset_library_category(payload: AssetLibraryCategoryRequest):
    return await asset_library_service.create_asset_library_category(payload, ASSET_LIBRARY_DIR=ASSET_LIBRARY_DIR, HTTPException=HTTPException, find_asset_library=find_asset_library, load_asset_library=load_asset_library, sanitize_asset_name=sanitize_asset_name, save_asset_library=save_asset_library, unique_asset_category_dir=unique_asset_category_dir, write_diagnostic=write_diagnostic)

@app.patch("/api/asset-library/categories/{category_id}")
@serialize_asset_library_update
async def rename_asset_library_category(category_id: str, payload: AssetLibraryRenameRequest):
    return await asset_library_service.rename_asset_library_category(category_id, payload, HTTPException=HTTPException, find_asset_category_with_library=find_asset_category_with_library, load_asset_library=load_asset_library, sanitize_asset_name=sanitize_asset_name, save_asset_library=save_asset_library)

@app.delete("/api/asset-library/categories/{category_id}")
async def delete_asset_library_category(category_id: str, library_id: str = ""):
    return await asset_library_service.delete_asset_library_category(category_id, library_id, ASSET_LIBRARY_DIR=ASSET_LIBRARY_DIR, HTTPException=HTTPException, asset_library_index_lock=asset_library_index_lock, find_asset_category_with_library=find_asset_category_with_library, load_asset_library=load_asset_library, remove_asset_library_file=remove_asset_library_file, save_asset_library=save_asset_library, write_diagnostic=write_diagnostic)

@app.post("/api/asset-library/items")
async def add_asset_library_item(payload: AssetLibraryAddRequest):
    return await asset_library_service.add_asset_library_item(payload, HTTPException=HTTPException, import_asset_library_media_sources=import_asset_library_media_sources, output_file_from_url=output_file_from_url)


async def import_asset_library_media_sources(sources, library_id: str, category_id: str):
    return await asset_library_service.import_asset_library_media_sources(sources, library_id, category_id, HTTPException=HTTPException, asset_library_index_lock=asset_library_index_lock, classify_asset_image_best_effort=classify_asset_image_best_effort, find_asset_category_in_library=find_asset_category_in_library, find_duplicate_asset_library_item=find_duplicate_asset_library_item, load_asset_library=load_asset_library, make_asset_library_item=make_asset_library_item, output_file_from_url=output_file_from_url, remove_asset_library_file=remove_asset_library_file, save_asset_library=save_asset_library)

@app.post("/api/asset-library/items/batch")
async def batch_add_asset_library_items(payload: AssetLibraryBatchAddRequest):
    return await asset_library_service.batch_add_asset_library_items(payload, import_asset_library_media_sources=import_asset_library_media_sources, output_file_from_url=output_file_from_url)

@app.get("/api/shared-folders")
async def list_shared_folders():
    return await shared_folder_service.list_shared_folders(shared_folder_abs=shared_folder_abs, shared_folders_load=shared_folders_load)

@app.post("/api/shared-folders")
async def register_shared_folder(payload: SharedFolderRegister):
    return await shared_folder_service.register_shared_folder(payload, _shared_folders_update=_shared_folders_update, now_ms=now_ms, sanitize_asset_name=sanitize_asset_name, shared_folder_abs=shared_folder_abs, shared_resolve_register=shared_resolve_register)

@app.delete("/api/shared-folders/{folder_id}")
async def unregister_shared_folder(folder_id: str):
    return await shared_folder_service.unregister_shared_folder(folder_id, HTTPException=HTTPException, _shared_folders_update=_shared_folders_update)

@app.get("/api/shared-folders/{folder_id}/tree")
async def get_shared_folder_tree(folder_id: str):
    return await shared_folder_service.get_shared_folder_tree(folder_id, HTTPException=HTTPException, scan_shared_tree=scan_shared_tree, shared_folder_abs=shared_folder_abs, shared_folder_by_id=shared_folder_by_id)

@app.get("/api/shared-folders/{folder_id}/file")
async def get_shared_folder_file(folder_id: str, path: str = ""):
    return await shared_folder_service.get_shared_folder_file(folder_id, path, FileResponse=FileResponse, HTTPException=HTTPException, SHARED_MEDIA_EXTS=SHARED_MEDIA_EXTS, content_type_for_path=content_type_for_path, shared_child_abs=shared_child_abs, shared_folder_abs=shared_folder_abs, shared_folder_by_id=shared_folder_by_id)

@app.post("/api/shared-folders/import")
async def import_shared_folder_files(payload: SharedFolderImport):
    return await shared_folder_service.import_shared_folder_files(payload, HTTPException=HTTPException, SHARED_MEDIA_EXTS=SHARED_MEDIA_EXTS, import_asset_library_media_sources=import_asset_library_media_sources, shared_child_abs=shared_child_abs, shared_folder_abs=shared_folder_abs, shared_folder_by_id=shared_folder_by_id)

async def caption_image_with_provider(abs_path, prompt, provider_id, model, ms_model=""):
    return await chat_execution_service.caption_image_with_provider(abs_path, prompt, provider_id, model, ms_model, AI_REQUEST_TIMEOUT=AI_REQUEST_TIMEOUT, CODEX_DEFAULT_CHAT_MODELS=CODEX_DEFAULT_CHAT_MODELS, CanvasLLMRequest=CanvasLLMRequest, GEMINI_CLI_DEFAULT_CHAT_MODELS=GEMINI_CLI_DEFAULT_CHAT_MODELS, HTTPException=HTTPException, codex_chat_text=codex_chat_text, friendly_chat_error_detail=friendly_chat_error_detail, gemini_cli_chat_text=gemini_cli_chat_text, get_api_provider=get_api_provider, httpx=httpx, image_path_to_data_url=image_path_to_data_url, is_apimart_provider=is_apimart_provider, is_codex_provider=is_codex_provider, is_gemini_cli_provider=is_gemini_cli_provider, log_net_error=log_net_error, required_chat_response_text=required_chat_response_text, resolve_chat_provider=resolve_chat_provider, safe_upstream_http_detail=safe_upstream_http_detail, safe_upstream_transport_detail=safe_upstream_transport_detail, selected_model=selected_model)

@app.patch("/api/asset-library/items/{item_id}")
@serialize_asset_library_update
async def rename_asset_library_item(item_id: str, payload: AssetLibraryRenameRequest):
    return await asset_library_service.rename_asset_library_item(item_id, payload, HTTPException=HTTPException, load_asset_library=load_asset_library, sanitize_asset_name=sanitize_asset_name, save_asset_library=save_asset_library)

def find_asset_item_in_library(lib, item_id, library_id=""):
    return asset_library_index.find_asset_item_in_library(lib, item_id, library_id)

@app.post("/api/asset-library/items/classify")
async def classify_asset_library_items(payload: AssetLibraryClassifyRequest):
    return await asset_library_service.classify_asset_library_items(payload, asset_library_index_lock=asset_library_index_lock, asset_library_media_kind=asset_library_media_kind, classify_image_with_provider=classify_image_with_provider, find_asset_item_in_library=find_asset_item_in_library, load_asset_library=load_asset_library, output_file_from_url=output_file_from_url, public_error_detail=public_error_detail, save_asset_library=save_asset_library)

@app.post("/api/asset-library/items/{item_id}/register-avatar")
async def register_asset_library_avatar(item_id: str, payload: AssetAvatarRegisterRequest):
    return await avatar_asset_service.register_asset_library_avatar(item_id, payload, AVATAR_SUPPORTED_PLATFORMS=AVATAR_SUPPORTED_PLATFORMS, HTTPException=HTTPException, VIDEO_POLL_TIMEOUT=VIDEO_POLL_TIMEOUT, VOLCENGINE_DEFAULT_PROJECT_NAME=VOLCENGINE_DEFAULT_PROJECT_NAME, asset_library_index_lock=asset_library_index_lock, avatar_platform_for_provider=avatar_platform_for_provider, find_asset_item_in_library=find_asset_item_in_library, get_api_provider=get_api_provider, httpx=httpx, load_asset_library=load_asset_library, now_ms=now_ms, save_asset_library=save_asset_library, submit_apimart_avatar_asset=submit_apimart_avatar_asset, submit_volcengine_avatar_asset=submit_volcengine_avatar_asset, upload_media_for_apimart=upload_media_for_apimart, valid_apimart_video_image_input=valid_apimart_video_image_input, volcengine_public_asset_url=volcengine_public_asset_url)

@app.post("/api/asset-library/items/{item_id}/avatar-status")
async def check_asset_library_avatar(item_id: str, payload: AssetAvatarRegisterRequest):
    return await avatar_asset_service.check_asset_library_avatar(item_id, payload, AVATAR_SUPPORTED_PLATFORMS=AVATAR_SUPPORTED_PLATFORMS, HTTPException=HTTPException, VOLCENGINE_DEFAULT_PROJECT_NAME=VOLCENGINE_DEFAULT_PROJECT_NAME, asset_library_index_lock=asset_library_index_lock, avatar_platform_for_provider=avatar_platform_for_provider, check_apimart_avatar_task=check_apimart_avatar_task, check_volcengine_avatar_task=check_volcengine_avatar_task, find_asset_item_in_library=find_asset_item_in_library, get_api_provider=get_api_provider, load_asset_library=load_asset_library, save_asset_library=save_asset_library)

@app.delete("/api/asset-library/items/{item_id}")
async def delete_asset_library_item(item_id: str):
    return await asset_library_service.delete_asset_library_item(item_id, HTTPException=HTTPException, asset_library_index_lock=asset_library_index_lock, load_asset_library=load_asset_library, remove_asset_library_file=remove_asset_library_file, save_asset_library=save_asset_library)

@app.post("/api/asset-library/items/delete")
async def batch_delete_asset_library_items(payload: AssetLibraryBatchDeleteRequest):
    return await asset_library_service.batch_delete_asset_library_items(payload, HTTPException=HTTPException, asset_library_index_lock=asset_library_index_lock, load_asset_library=load_asset_library, remove_asset_library_file=remove_asset_library_file, save_asset_library=save_asset_library)

@app.post("/api/asset-library/items/move")
@serialize_asset_library_update
async def batch_move_asset_library_items(payload: AssetLibraryBatchMoveRequest):
    return await asset_library_service.batch_move_asset_library_items(payload, HTTPException=HTTPException, find_asset_category_in_library=find_asset_category_in_library, load_asset_library=load_asset_library, save_asset_library=save_asset_library)

@app.post("/api/asset-library/items/crop")
@serialize_asset_library_update
async def batch_crop_asset_library_items(payload: AssetLibraryBatchCropRequest):
    return await asset_library_service.batch_crop_asset_library_items(payload, HTTPException=HTTPException, Image=Image, find_asset_category_in_library=find_asset_category_in_library, load_asset_library=load_asset_library, make_asset_library_item=make_asset_library_item, output_file_from_url=output_file_from_url, save_asset_library=save_asset_library)

@app.put("/api/canvases/{canvas_id}")
async def update_canvas(canvas_id: str, payload: CanvasSaveRequest):
    with _canvas_store() as store:
        canvas = store.update_content(canvas_id, payload.model_dump(), fields=payload.model_fields_set)
    await manager.broadcast_canvas_updated(canvas_id, int(canvas.get("updated_at") or now_ms()), payload.client_id)
    return {"canvas": canvas}

@app.post("/api/canvases/{canvas_id}/clear")
async def clear_canvas(canvas_id: str, payload: ClearCanvasRequest):
    return await media_cleanup_service.clear_canvas(canvas_id, payload, ASSET_LIBRARY_LOCK=ASSET_LIBRARY_LOCK, CANVAS_LOCK=CANVAS_LOCK, CONVERSATION_LOCK=CONVERSATION_LOCK, HISTORY_FILE=HISTORY_FILE, HISTORY_LOCK=HISTORY_LOCK, HTTPException=HTTPException, HistoryPruneError=HistoryPruneError, collect_local_media_urls=collect_local_media_urls, delete_media_preview_cache=delete_media_preview_cache, expand_canvas_generated_media_paths=expand_canvas_generated_media_paths, generated_media_path_from_url=generated_media_path_from_url, json_references_media_path=json_references_media_path, load_canvas=load_canvas, manager=manager, now_ms=now_ms, persisted_json_references_media_path=persisted_json_references_media_path, prune_generation_history_for_media=prune_generation_history_for_media, save_canvas=save_canvas)

@app.post("/api/canvases/{canvas_id}/logs/delete")
async def delete_canvas_log(canvas_id: str, payload: DeleteCanvasLogRequest):
    return await media_cleanup_service.delete_canvas_log(canvas_id, payload, ASSET_LIBRARY_LOCK=ASSET_LIBRARY_LOCK, CANVAS_LOCK=CANVAS_LOCK, CONVERSATION_LOCK=CONVERSATION_LOCK, HISTORY_FILE=HISTORY_FILE, HISTORY_LOCK=HISTORY_LOCK, HTTPException=HTTPException, HistoryPruneError=HistoryPruneError, collect_local_media_urls=collect_local_media_urls, delete_media_preview_cache=delete_media_preview_cache, expand_canvas_generated_media_paths=expand_canvas_generated_media_paths, generated_media_path_from_url=generated_media_path_from_url, json_references_media_path=json_references_media_path, load_canvas=load_canvas, manager=manager, now_ms=now_ms, persisted_json_references_media_path=persisted_json_references_media_path, prune_generation_history_for_media=prune_generation_history_for_media, reset_canvas_result_nodes_for_media=reset_canvas_result_nodes_for_media, save_canvas=save_canvas)

@app.delete("/api/canvases/{canvas_id}")
async def delete_canvas(canvas_id: str):
    with _canvas_store() as store:
        store.delete(canvas_id)
    return {"ok": True}

@app.post("/api/canvases/{canvas_id}/restore")
async def restore_canvas(canvas_id: str):
    with _canvas_store() as store:
        canvas = store.restore(canvas_id)
    return {"canvas": canvas}

@app.delete("/api/canvases/{canvas_id}/purge")
async def purge_canvas(canvas_id: str):
    with _canvas_store() as store:
        store.purge(canvas_id)
    return {"ok": True}

# --- GPT 对话 ---

@app.post("/api/chat")
async def chat(payload: ChatRequest, request: Request, x_user_id: str = Header(default="")):
    return await chat_execution_service.chat(payload, request, x_user_id, AI_REQUEST_TIMEOUT=AI_REQUEST_TIMEOUT, CODEX_DEFAULT_CHAT_MODELS=CODEX_DEFAULT_CHAT_MODELS, GEMINI_CLI_DEFAULT_CHAT_MODELS=GEMINI_CLI_DEFAULT_CHAT_MODELS, HTTPException=HTTPException, IMAGE_MODEL=IMAGE_MODEL, MAX_HISTORY_MESSAGES=MAX_HISTORY_MESSAGES, chat_prompt_size_override=chat_prompt_size_override, chat_system_prompt=chat_system_prompt, codex_chat_text=codex_chat_text, display_title=display_title, friendly_chat_error_detail=friendly_chat_error_detail, friendly_image_error_detail=friendly_image_error_detail, gemini_cli_chat_text=gemini_cli_chat_text, generate_ai_image=generate_ai_image, get_api_provider=get_api_provider, httpx=httpx, image_references=image_references, is_apimart_provider=is_apimart_provider, is_codex_provider=is_codex_provider, is_gemini_cli_provider=is_gemini_cli_provider, load_conversation=load_conversation, log_net_error=log_net_error, model_dump_compat=model_dump_compat, new_conversation=new_conversation, now_ms=now_ms, public_usage=public_usage, required_chat_response_text=required_chat_response_text, resolve_chat_provider=resolve_chat_provider, safe_upstream_http_detail=safe_upstream_http_detail, safe_upstream_transport_detail=safe_upstream_transport_detail, safe_user_id=safe_user_id, save_ai_image_to_output=save_ai_image_to_output, save_conversation=save_conversation, selected_model=selected_model, unwrap_apimart_response=unwrap_apimart_response, upstream_message_from_record=upstream_message_from_record)

@app.post("/api/chat/agent")
async def chat_agent(payload: ChatRequest, request: Request, x_user_id: str = Header(default="")):
    return await chat_execution_service.chat_agent(payload, request, x_user_id, HTTPException=HTTPException, IMAGE_MODEL=IMAGE_MODEL, build_chat_text_reply=build_chat_text_reply, chat_prompt_size_override=chat_prompt_size_override, chat_requested_image_count=chat_requested_image_count, chat_split_parallel_prompts=chat_split_parallel_prompts, decide_chat_agent_action=decide_chat_agent_action, display_title=display_title, friendly_image_error_detail=friendly_image_error_detail, generate_ai_image=generate_ai_image, httpx=httpx, image_references=image_references, image_size_from_reference=image_size_from_reference, latest_chat_image_refs=latest_chat_image_refs, load_conversation=load_conversation, log_net_error=log_net_error, model_dump_compat=model_dump_compat, new_conversation=new_conversation, now_ms=now_ms, pick_chat_image_provider=pick_chat_image_provider, public_usage=public_usage, safe_upstream_http_detail=safe_upstream_http_detail, safe_upstream_transport_detail=safe_upstream_transport_detail, safe_user_id=safe_user_id, save_ai_image_to_output=save_ai_image_to_output, save_conversation=save_conversation, selected_model=selected_model, snap_size_to_multiple=snap_size_to_multiple)

@app.post("/api/chat/stream")
async def chat_stream(payload: ChatRequest, request: Request, x_user_id: str = Header(default="")):
    return await chat_execution_service.chat_stream(payload, request, x_user_id, AI_REQUEST_TIMEOUT=AI_REQUEST_TIMEOUT, CODEX_DEFAULT_CHAT_MODELS=CODEX_DEFAULT_CHAT_MODELS, GEMINI_CLI_DEFAULT_CHAT_MODELS=GEMINI_CLI_DEFAULT_CHAT_MODELS, HTTPException=HTTPException, MAX_HISTORY_MESSAGES=MAX_HISTORY_MESSAGES, StreamingResponse=StreamingResponse, chat_system_prompt=chat_system_prompt, codex_chat_text=codex_chat_text, display_title=display_title, friendly_chat_error_detail=friendly_chat_error_detail, gemini_cli_chat_text=gemini_cli_chat_text, get_api_provider=get_api_provider, httpx=httpx, is_codex_provider=is_codex_provider, is_gemini_cli_provider=is_gemini_cli_provider, load_conversation=load_conversation, log_net_error=log_net_error, model_dump_compat=model_dump_compat, new_conversation=new_conversation, now_ms=now_ms, public_usage=public_usage, resolve_chat_provider=resolve_chat_provider, safe_upstream_http_detail=safe_upstream_http_detail, safe_upstream_transport_detail=safe_upstream_transport_detail, safe_user_id=safe_user_id, save_conversation=save_conversation, selected_model=selected_model, sse_event=sse_event, text_delta_from_chat_chunk=text_delta_from_chat_chunk, upstream_message_from_record=upstream_message_from_record)

# --- 历史记录 ---

@app.get("/api/history")
async def get_history_api(type: str = None):
    return await conversation_service.get_history_api(type, HISTORY_FILE=HISTORY_FILE, history_records_for_api=history_records_for_api, read_history_records=read_history_records, sanitize_record_usage=sanitize_record_usage, write_diagnostic=write_diagnostic)

@app.get("/api/queue_status")
async def get_queue_status(client_id: str):
    with QUEUE_LOCK:
        total = len(QUEUE)
        positions = [i + 1 for i, t in enumerate(QUEUE) if t["client_id"] == client_id]
        position = positions[0] if positions else 0
    return {"total": total, "position": position}

@app.post("/api/history/delete")
async def delete_history(req: DeleteHistoryRequest):
    return await media_cleanup_service.delete_history(req, ASSET_LIBRARY_LOCK=ASSET_LIBRARY_LOCK, CANVAS_LOCK=CANVAS_LOCK, CONVERSATION_LOCK=CONVERSATION_LOCK, HISTORY_FILE=HISTORY_FILE, HISTORY_LOCK=HISTORY_LOCK, generated_media_path_from_url=generated_media_path_from_url, json_references_media_path=json_references_media_path, persisted_json_references_media_path=persisted_json_references_media_path, write_diagnostic=write_diagnostic, write_json_atomic=write_json_atomic)

# --- ModelScope 角度控制 ---

@app.post("/api/angle/poll_status")
async def poll_angle_cloud(req: CloudPollRequest):
    return await modelscope_execution_service.poll_angle_cloud(req, HTTPException=HTTPException, _safe_upstream_text=_safe_upstream_text, asyncio=asyncio, httpx=httpx, log_net_error=log_net_error, manager=manager, modelscope_api_key=modelscope_api_key, modelscope_image_api_root=modelscope_image_api_root, output_path_for=output_path_for, output_url_for=output_url_for, redact_log_text=redact_log_text, save_to_history=save_to_history, time=time, upstream_error_summary=upstream_error_summary, write_diagnostic=write_diagnostic)

@app.post("/api/angle/generate")
async def generate_angle_cloud(req: CloudGenRequest):
    return await modelscope_execution_service.generate_angle_cloud(req, CANVAS_IMAGE_REMOTE_ACCEPT_CALLBACK=CANVAS_IMAGE_REMOTE_ACCEPT_CALLBACK, HTTPException=HTTPException, _safe_upstream_text=_safe_upstream_text, asyncio=asyncio, httpx=httpx, log_net_error=log_net_error, manager=manager, modelscope_api_key=modelscope_api_key, modelscope_image_api_root=modelscope_image_api_root, modelscope_image_url=modelscope_image_url, modelscope_size=modelscope_size, output_path_for=output_path_for, output_url_for=output_url_for, redact_log_text=redact_log_text, save_to_history=save_to_history, schedule_coroutine=schedule_coroutine, selected_model=selected_model, time=time, upstream_error_summary=upstream_error_summary, upstream_response_error_summary=upstream_response_error_summary, write_diagnostic=write_diagnostic)

# --- ModelScope Z-Image 云端生图 ---

@app.post("/generate")
async def generate_cloud(req: CloudGenRequest):
    return await modelscope_execution_service.generate_cloud(req, CANVAS_IMAGE_REMOTE_ACCEPT_CALLBACK=CANVAS_IMAGE_REMOTE_ACCEPT_CALLBACK, HTTPException=HTTPException, _safe_upstream_text=_safe_upstream_text, asyncio=asyncio, httpx=httpx, log_net_error=log_net_error, manager=manager, modelscope_api_key=modelscope_api_key, modelscope_image_api_root=modelscope_image_api_root, modelscope_size=modelscope_size, output_path_for=output_path_for, output_url_for=output_url_for, redact_log_text=redact_log_text, save_to_history=save_to_history, time=time, upstream_error_summary=upstream_error_summary, upstream_response_error_summary=upstream_response_error_summary, write_diagnostic=write_diagnostic)

# --- ModelScope 通用图片生成（支持图生图） ---

@app.post("/api/ms/generate")
async def ms_generate(req: MsGenerateRequest):
    return await modelscope_execution_service.ms_generate(req, CANVAS_IMAGE_REMOTE_ACCEPT_CALLBACK=CANVAS_IMAGE_REMOTE_ACCEPT_CALLBACK, HTTPException=HTTPException, _safe_upstream_text=_safe_upstream_text, asyncio=asyncio, httpx=httpx, log_net_error=log_net_error, manager=manager, modelscope_api_key=modelscope_api_key, modelscope_image_api_root=modelscope_image_api_root, modelscope_image_url=modelscope_image_url, modelscope_size=modelscope_size, output_path_for=output_path_for, output_url_for=output_url_for, redact_log_text=redact_log_text, save_to_history=save_to_history, schedule_coroutine=schedule_coroutine, time=time, upstream_error_summary=upstream_error_summary, upstream_response_error_summary=upstream_response_error_summary, write_diagnostic=write_diagnostic)

# --- 本地 ComfyUI 生图 ---

@app.post("/api/generate")
def generate(req: GenerateRequest):
    global NEXT_TASK_ID
    with QUEUE_LOCK:
        task_id = NEXT_TASK_ID
        NEXT_TASK_ID += 1
        current_task = {"task_id": task_id, "client_id": req.client_id}
        QUEUE.append(current_task)
    return comfy_generation_service.generate(req, task_id, current_task, CLIENT_ID=CLIENT_ID, COMFYUI_HISTORY_TIMEOUT=COMFYUI_HISTORY_TIMEOUT, LOAD_LOCK=LOAD_LOCK, QUEUE=QUEUE, QUEUE_LOCK=QUEUE_LOCK, WORKFLOW_DIR=WORKFLOW_DIR, WORKFLOW_PATH=WORKFLOW_PATH, collect_comfy_file_items=collect_comfy_file_items, collect_required_comfy_media=collect_required_comfy_media, comfy_class_is_debug_text=comfy_class_is_debug_text, comfy_class_is_preview=comfy_class_is_preview, comfy_output_kind=comfy_output_kind, comfy_prompt_error_message=comfy_prompt_error_message, comfy_text_values_from_output=comfy_text_values_from_output, convert_output_to_jpg=convert_output_to_jpg, download_comfy_output=download_comfy_output, get_backend_load=lambda: BACKEND_LOCAL_LOAD, get_comfy_history=get_comfy_history, get_instances=lambda: COMFYUI_INSTANCES, manager=manager, public_comfy_error_detail=public_comfy_error_detail, requests=requests, reserve_best_backend=reserve_best_backend, save_comfy_text_output=save_comfy_text_output, save_to_history=save_to_history, schedule_coroutine=schedule_coroutine, write_diagnostic=write_diagnostic)

# --- ComfyUI 工作流管理 ---

BUILTIN_WORKFLOWS = {"Z-Image.json", "Z-Image-Enhance.json", "2511.json", "klein-enhance.json", "Flux2-Klein.json", "upscale.json"}
CUSTOM_WORKFLOW_FOLDER = "custom"
LEGACY_CUSTOM_WORKFLOW_FOLDER = "自定义"
WORKFLOW_NAME_RE = re.compile(rf"^(?:(?:{CUSTOM_WORKFLOW_FOLDER}|{LEGACY_CUSTOM_WORKFLOW_FOLDER})/)?[a-zA-Z0-9_一-龥\.\-]+\.json$")

class WorkflowField(BaseModel):
    id: str
    node: str = ""
    input: str = ""
    name: str = ""
    type: str = "text"
    default: Any = None
    min: Optional[float] = None
    max: Optional[float] = None
    step: Optional[float] = None
    options: List[str] = []
    random_enabled: bool = False

class WorkflowConfig(BaseModel):
    title: str = ""
    fields: List[WorkflowField] = []
    mini_cards: Dict[str, Any] = {}

class WorkflowUploadRequest(BaseModel):
    name: str
    workflow: Dict[str, Any]

class WorkflowRunRequest(BaseModel):
    fields: Dict[str, Any] = {}
    config: WorkflowConfig
    client_id: str = ""

def workflow_path_from_name(name: str) -> str:
    return comfy_workflow_service.workflow_path_from_name(name, HTTPException=HTTPException, WORKFLOW_DIR=WORKFLOW_DIR, WORKFLOW_NAME_RE=WORKFLOW_NAME_RE)

def workflow_config_path(name: str) -> str:
    return comfy_workflow_service.workflow_config_path(name, workflow_path_from_name=workflow_path_from_name)


def _save_workflow_json_or_raise(path: str, payload: Dict[str, Any], label: str):
    return comfy_workflow_service._save_workflow_json_or_raise(path, payload, label, HTTPException=HTTPException, WORKFLOW_STORAGE_LOCK=WORKFLOW_STORAGE_LOCK, write_json_atomic=write_json_atomic)


def is_builtin_workflow(name: str) -> bool:
    return comfy_workflow_service.is_builtin_workflow(name, BUILTIN_WORKFLOWS=BUILTIN_WORKFLOWS)

def runninghub_workflow_store_path() -> str:
    return RUNNINGHUB_WORKFLOW_STORE_FILE

def _load_runninghub_workflow_store_unlocked():
    return runninghub_config_service._load_runninghub_workflow_store_unlocked(RUNNINGHUB_WORKFLOW_STORE_FILE=RUNNINGHUB_WORKFLOW_STORE_FILE)

def load_runninghub_workflow_store():
    return runninghub_config_service.load_runninghub_workflow_store(RUNNINGHUB_WORKFLOW_LOCK=RUNNINGHUB_WORKFLOW_LOCK, _load_runninghub_workflow_store_unlocked=_load_runninghub_workflow_store_unlocked)

def save_runninghub_workflow_store(store):
    return runninghub_config_service.save_runninghub_workflow_store(store, DATA_DIR=DATA_DIR, RUNNINGHUB_WORKFLOW_LOCK=RUNNINGHUB_WORKFLOW_LOCK, RUNNINGHUB_WORKFLOW_STORE_FILE=RUNNINGHUB_WORKFLOW_STORE_FILE, runninghub_workflow_without_raw=runninghub_workflow_without_raw, write_json_atomic=write_json_atomic)

def _save_runninghub_workflow_store_or_raise(store):
    return runninghub_config_service._save_runninghub_workflow_store_or_raise(store, HTTPException=HTTPException, save_runninghub_workflow_store=save_runninghub_workflow_store)

def prune_runninghub_workflow_store_for_provider(provider):
    return runninghub_config_service.prune_runninghub_workflow_store_for_provider(provider, RUNNINGHUB_WORKFLOW_LOCK=RUNNINGHUB_WORKFLOW_LOCK, _save_runninghub_workflow_store_or_raise=_save_runninghub_workflow_store_or_raise, load_runninghub_workflow_store=load_runninghub_workflow_store, runninghub_workflow_store_key=runninghub_workflow_store_key)

def runninghub_workflow_config_has_payload(cfg):
    return runninghub_config_service.runninghub_workflow_config_has_payload(cfg, runninghub_workflow_json_from_config=runninghub_workflow_json_from_config)

def runninghub_static_workflow_entry(workflow_id: str):
    return runninghub_config_service.runninghub_static_workflow_entry(workflow_id, load_static_runninghub_provider=load_static_runninghub_provider, runninghub_workflow_store_key=runninghub_workflow_store_key)

def runninghub_static_workflow_config(workflow_id: str):
    return runninghub_config_service.runninghub_static_workflow_config(workflow_id, runninghub_is_saved_link_field=runninghub_is_saved_link_field, runninghub_normalize_field=runninghub_normalize_field, runninghub_static_workflow_entry=runninghub_static_workflow_entry, runninghub_workflow_config_has_payload=runninghub_workflow_config_has_payload, runninghub_workflow_json_from_config=runninghub_workflow_json_from_config, runninghub_workflow_store_key=runninghub_workflow_store_key)

def runninghub_workflow_entry_from_config(cfg, fallback=None):
    return runninghub_config_service.runninghub_workflow_entry_from_config(cfg, fallback, normalize_runninghub_entry=normalize_runninghub_entry, runninghub_workflow_json_from_config=runninghub_workflow_json_from_config, runninghub_workflow_store_key=runninghub_workflow_store_key)

def runninghub_saved_hidden_workflow_ids():
    return runninghub_config_service.runninghub_saved_hidden_workflow_ids(API_PROVIDERS_FILE=API_PROVIDERS_FILE, runninghub_workflow_store_key=runninghub_workflow_store_key)

def runninghub_provider_with_workflow_store(provider):
    return runninghub_config_service.runninghub_provider_with_workflow_store(provider, load_runninghub_workflow_store=load_runninghub_workflow_store, normalize_runninghub_entries=normalize_runninghub_entries, runninghub_saved_hidden_workflow_ids=runninghub_saved_hidden_workflow_ids, runninghub_select_workflow_config=runninghub_select_workflow_config, runninghub_workflow_config_has_payload=runninghub_workflow_config_has_payload, runninghub_workflow_entry_from_config=runninghub_workflow_entry_from_config, runninghub_workflow_store_key=runninghub_workflow_store_key)

def runninghub_provider_workflow_config(workflow_id: str):
    return runninghub_config_service.runninghub_provider_workflow_config(workflow_id, load_api_providers=load_api_providers, runninghub_is_saved_link_field=runninghub_is_saved_link_field, runninghub_normalize_field=runninghub_normalize_field, runninghub_saved_hidden_workflow_ids=runninghub_saved_hidden_workflow_ids, runninghub_workflow_config_has_payload=runninghub_workflow_config_has_payload, runninghub_workflow_json_from_config=runninghub_workflow_json_from_config, runninghub_workflow_store_key=runninghub_workflow_store_key)

def runninghub_select_workflow_config(local_cfg, provider_cfg, workflow_id: str = ""):
    return runninghub_config_service.runninghub_select_workflow_config(local_cfg, provider_cfg, workflow_id, runninghub_static_workflow_config=runninghub_static_workflow_config)

def sync_runninghub_workflow_to_provider(cfg):
    return runninghub_config_service.sync_runninghub_workflow_to_provider(cfg, RUNNINGHUB_DEFAULT_APPS=RUNNINGHUB_DEFAULT_APPS, RUNNINGHUB_DEFAULT_BASE_URL=RUNNINGHUB_DEFAULT_BASE_URL, load_api_providers=load_api_providers, normalize_provider=normalize_provider, now_ms=now_ms, runninghub_is_saved_link_field=runninghub_is_saved_link_field, runninghub_normalize_field=runninghub_normalize_field, runninghub_workflow_json_from_config=runninghub_workflow_json_from_config, runninghub_workflow_store_key=runninghub_workflow_store_key, save_api_providers=save_api_providers, sync_runninghub_provider_workflows_to_static_template=sync_runninghub_provider_workflows_to_static_template)

def remove_runninghub_workflow_from_provider(workflow_id: str):
    return runninghub_config_service.remove_runninghub_workflow_from_provider(workflow_id, load_api_providers=load_api_providers, load_static_runninghub_provider=load_static_runninghub_provider, normalize_provider=normalize_provider, normalize_runninghub_entry=normalize_runninghub_entry, runninghub_workflow_store_key=runninghub_workflow_store_key, save_api_providers=save_api_providers, sync_runninghub_provider_workflows_to_static_template=sync_runninghub_provider_workflows_to_static_template)

def runninghub_workflow_store_key(workflow_id: str) -> str:
    return runninghub_config_service.runninghub_workflow_store_key(workflow_id)

def runninghub_normalize_field(raw, fallback=None):
    return runninghub_config_service.runninghub_normalize_field(raw, fallback, model_dump_compat=model_dump_compat)

def runninghub_is_saved_link_field(field):
    return runninghub_config_service.runninghub_is_saved_link_field(field, runninghub_is_workflow_link_value=runninghub_is_workflow_link_value)

def runninghub_collect_workflow_fields(workflow_json):
    return runninghub_config_service.runninghub_collect_workflow_fields(workflow_json, runninghub_infer_workflow_field_type=runninghub_infer_workflow_field_type, runninghub_is_workflow_link_value=runninghub_is_workflow_link_value)

class ComfyInstancesPayload(BaseModel):
    instances: List[str] = []

@app.get("/api/comfyui/instances")
def get_comfyui_instances():
    return {"instances": COMFYUI_INSTANCES}

@app.put("/api/comfyui/instances")
def save_comfyui_instances(payload: ComfyInstancesPayload):
    # 宽容校验：去前后空白、去 http(s):// 前缀、去尾部斜杠；要求形如 host:port
    cleaned = []
    for item in payload.instances:
        s = str(item or "").strip()
        if not s:
            continue
        s = re.sub(r"^https?://", "", s)
        s = s.rstrip("/")
        if ":" not in s:
            raise HTTPException(status_code=400, detail=f"地址缺少端口号：{item}（应为 host:port，例如 127.0.0.1:8188）")
        host, _, port = s.rpartition(":")
        if not host or not port.isdigit():
            raise HTTPException(status_code=400, detail=f"地址不合法：{item}（应为 host:port，例如 127.0.0.1:8188）")
        if s in cleaned:
            continue
        cleaned.append(s)
    if not cleaned:
        raise HTTPException(status_code=400, detail="至少保留一个 ComfyUI 后端地址")
    # 写入 env 文件
    try:
        update_env_values({"COMFYUI_INSTANCES": ",".join(cleaned)})
    except Exception as e:
        write_diagnostic(f"comfyui env write failed error={type(e).__name__}")
        raise HTTPException(status_code=500, detail="保存 ComfyUI 地址失败，请检查配置文件权限。") from e
    # 更新进程中的全局变量
    global COMFYUI_INSTANCES, COMFYUI_ADDRESS, BACKEND_LOCAL_LOAD
    COMFYUI_INSTANCES = cleaned
    COMFYUI_ADDRESS = cleaned[0]
    new_load = {addr: 0 for addr in cleaned}
    for addr, n in (BACKEND_LOCAL_LOAD or {}).items():
        if addr in new_load:
            new_load[addr] = n
    BACKEND_LOCAL_LOAD = new_load
    return {"instances": COMFYUI_INSTANCES}

@app.get("/api/workflows")
def list_workflows():
    return comfy_workflow_service.list_workflows(CUSTOM_WORKFLOW_FOLDER=CUSTOM_WORKFLOW_FOLDER, LEGACY_CUSTOM_WORKFLOW_FOLDER=LEGACY_CUSTOM_WORKFLOW_FOLDER, WORKFLOW_DIR=WORKFLOW_DIR, is_builtin_workflow=is_builtin_workflow, workflow_config_path=workflow_config_path)

@app.get("/api/workflows/{name:path}")
def get_workflow(name: str):
    return comfy_workflow_service.get_workflow(name, HTTPException=HTTPException, WORKFLOW_NAME_RE=WORKFLOW_NAME_RE, is_builtin_workflow=is_builtin_workflow, workflow_config_path=workflow_config_path, workflow_path_from_name=workflow_path_from_name)

@app.post("/api/workflows")
def upload_workflow(payload: WorkflowUploadRequest):
    return comfy_workflow_service.upload_workflow(payload, CUSTOM_WORKFLOW_FOLDER=CUSTOM_WORKFLOW_FOLDER, HTTPException=HTTPException, WORKFLOW_DIR=WORKFLOW_DIR, WORKFLOW_NAME_RE=WORKFLOW_NAME_RE, _save_workflow_json_or_raise=_save_workflow_json_or_raise, workflow_path_from_name=workflow_path_from_name)

@app.put("/api/workflows/{name:path}/config")
def save_workflow_config(name: str, payload: WorkflowConfig):
    return comfy_workflow_service.save_workflow_config(name, payload, HTTPException=HTTPException, WORKFLOW_NAME_RE=WORKFLOW_NAME_RE, _save_workflow_json_or_raise=_save_workflow_json_or_raise, model_dump_compat=model_dump_compat, workflow_config_path=workflow_config_path, workflow_path_from_name=workflow_path_from_name)

@app.delete("/api/workflows/{name:path}")
def delete_workflow(name: str):
    return comfy_workflow_service.delete_workflow(name, HTTPException=HTTPException, WORKFLOW_NAME_RE=WORKFLOW_NAME_RE, is_builtin_workflow=is_builtin_workflow, workflow_config_path=workflow_config_path, workflow_path_from_name=workflow_path_from_name)

@app.post("/api/workflows/{name:path}/run")
def run_workflow(name: str, payload: WorkflowRunRequest):
    return comfy_workflow_service.run_workflow(name, payload, Any=Any, Dict=Dict, GenerateRequest=GenerateRequest, HTTPException=HTTPException, WORKFLOW_NAME_RE=WORKFLOW_NAME_RE, generate=generate, workflow_path_from_name=workflow_path_from_name)

def run_application_server():
    """启动单个服务实例，避免多进程各自计数而重复提交任务。"""
    import uvicorn

    # 关闭服务端协议级 WebSocket ping：部分客户端（如 PS UXP 面板）不会自动回 pong，
    # 默认 20s ping/20s 超时会把这些连接每隔一会儿就踢掉造成"频繁断连"。
    # 客户端有自己的应用层心跳 + 断线重连兜底，这里禁用协议 ping 更稳。
    # 默认只供本机使用；需要局域网访问时须显式配置监听地址。
    bind_host = configured_bind_host()
    if bind_host_requires_access_control(bind_host) and not configured_access_token():
        print("NADOU_BIND_HOST 为非本机地址时必须配置 NADOU_ACCESS_TOKEN。", flush=True)
        raise SystemExit(2)
    allow_multi = str(os.getenv("NADOU_ALLOW_MULTI_INSTANCE", "")).strip().lower() in {
        "1", "true", "yes", "on"
    }
    settings = {
        "host": bind_host,
        "port": local_env.server_port(),
        "ws_ping_interval": None,
        "ws_ping_timeout": None,
    }
    if allow_multi:
        uvicorn.run(app, **settings)
        return
    lock_path = os.path.join(DATA_DIR, ".service-instance")
    try:
        with interprocess_file_lock(lock_path, timeout=0):
            uvicorn.run(app, **settings)
    except TimeoutError as exc:
        print("已有 nadou ai 服务实例正在运行；如确需多实例，请设置 NADOU_ALLOW_MULTI_INSTANCE=1。", flush=True)
        raise SystemExit(2) from exc


if __name__ == "__main__":
    run_application_server()
