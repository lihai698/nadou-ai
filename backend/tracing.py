"""请求、追踪和后台任务标识。

这个模块只负责标识的生成、校验和当前异步上下文管理，不读取配置、不访问
网络，也不依赖 :mod:`main`。HTTP 入口可以把同一个 ``trace_id`` 传给后台
任务，从而把一次页面操作的请求、任务和网络错误串起来。
"""

from __future__ import annotations

from contextvars import ContextVar, Token
import re
import uuid
from typing import Any, Dict, Mapping, Tuple


# 只接受适合放进日志和响应头的短标识，避免把换行或超长用户输入带入诊断信息。
IDENTIFIER_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")

_TRACE_ID: ContextVar[str] = ContextVar("nadou_trace_id", default="")
_REQUEST_ID: ContextVar[str] = ContextVar("nadou_request_id", default="")


def new_identifier() -> str:
    """生成不含敏感信息的本地随机标识。"""

    return uuid.uuid4().hex


def normalize_identifier(value: Any, fallback: str = "") -> str:
    """校验外部传入的标识；非法、空值和超长值使用 ``fallback``。"""

    candidate = str(value or "").strip()
    if IDENTIFIER_RE.fullmatch(candidate):
        return candidate
    return fallback


def request_context(headers: Mapping[str, Any]) -> Tuple[str, str]:
    """根据请求头生成 ``(trace_id, request_id)``。

    客户端可以用 ``X-Trace-ID`` 串联同一次操作；如果没有提供，则以本次
    请求 ID 作为追踪 ID。非法头值不会原样进入日志或响应。
    """

    def header(name: str) -> Any:
        # Starlette Headers 不区分大小写；普通 Mapping 也尽量兼容常见写法。
        return headers.get(name) or headers.get(name.lower()) or headers.get(name.title())

    request_id = normalize_identifier(header("x-request-id"), "")
    if not request_id:
        request_id = new_identifier()
    trace_id = normalize_identifier(header("x-trace-id"), "")
    if not trace_id:
        trace_id = request_id
    return trace_id, request_id


def bind_context(trace_id: str, request_id: str) -> Tuple[Token[str], Token[str]]:
    """绑定当前异步任务的追踪上下文，并返回用于恢复的令牌。"""

    return _TRACE_ID.set(normalize_identifier(trace_id, "")), _REQUEST_ID.set(normalize_identifier(request_id, ""))


def reset_context(tokens: Tuple[Token[str], Token[str]]) -> None:
    """恢复调用前的上下文，防止不同请求之间串号。"""

    trace_token, request_token = tokens
    _TRACE_ID.reset(trace_token)
    _REQUEST_ID.reset(request_token)


def current_trace_id() -> str:
    return _TRACE_ID.get()


def current_request_id() -> str:
    return _REQUEST_ID.get()


def context_fields(trace_id: str = "", request_id: str = "") -> Dict[str, str]:
    """返回适合并入 JSON 任务记录或日志的稳定字段。"""

    return {
        "trace_id": normalize_identifier(trace_id, current_trace_id() or "") or "",
        "request_id": normalize_identifier(request_id, current_request_id() or "") or "",
    }


def task_context(task_id: str, trace_id: str = "", request_id: str = "") -> Dict[str, str]:
    """构造任务关联字段，任务 ID 由调用方按原有格式生成。"""

    return {
        "task_id": str(task_id or ""),
        **context_fields(trace_id, request_id),
    }


def format_context(trace_id: str = "", request_id: str = "") -> str:
    """格式化日志上下文；没有 HTTP 上下文时明确标记为 ``none``。"""

    fields = context_fields(trace_id, request_id)
    return f"trace_id={fields['trace_id'] or 'none'} request_id={fields['request_id'] or 'none'}"

