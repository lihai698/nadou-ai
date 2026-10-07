"""远端媒体任务协议的纯规则层。

这个模块不发起网络请求、不读取供应商配置，也不保存上游原始回包。
它把图片、视频和 ComfyUI 周边适配器都需要遵守的边界集中起来：

* 各供应商的状态文字归一到有限的本地状态；
* 传输失败或缺少明确状态时只能得到 ``unknown``，不能假装失败或成功；
* 浏览器停止等待不会生成 ``cancelled``；
* 只有适配器明确声明并收到确认响应，才允许记录远端取消。

应用入口可以用 ``RemoteTaskContract`` 描述某个供应商的能力，再把网络
响应交给 ``observe_remote_task`` 和 ``remote_task_decision``。这样提交、
查询和取消可以逐家接入，而不会把一次 HTTP 断线误当成可安全重提。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Optional


REMOTE_PENDING = "pending"
REMOTE_RUNNING = "running"
REMOTE_SUCCEEDED = "succeeded"
REMOTE_FAILED = "failed"
REMOTE_CANCELLED = "cancelled"
REMOTE_UNKNOWN = "unknown"

REMOTE_TERMINAL_STATES = frozenset(
    {REMOTE_SUCCEEDED, REMOTE_FAILED, REMOTE_CANCELLED}
)
REMOTE_ACTIVE_STATES = frozenset({REMOTE_PENDING, REMOTE_RUNNING})

_SUCCESS_STATUSES = frozenset(
    {
        "SUCCESS",
        "SUCCESSFUL",
        "SUCCEED",
        "SUCCEEDED",
        "COMPLETED",
        "COMPLETE",
        "DONE",
        "FINISHED",
        "FINISH",
        "OK",
        "READY",
    }
)
_FAILED_STATUSES = frozenset(
    {
        "FAILURE",
        "FAILED",
        "FAIL",
        "ERROR",
        "ERRORED",
        "TIMEOUT",
        "TIMEDOUT",
        "REJECTED",
        "EXPIRED",
    }
)
_CANCELLED_STATUSES = frozenset(
    {"CANCEL", "CANCELED", "CANCELLED", "REVOKED", "ABORTED"}
)
_PENDING_STATUSES = frozenset(
    {
        "QUEUED",
        "QUEUE",
        "PENDING",
        "SUBMITTED",
        "ACCEPTED",
        "WAITING",
        "WAITING_IN_QUEUE",
        "IN_QUEUE",
    }
)
_RUNNING_STATUSES = frozenset(
    {
        "RUNNING",
        "PROCESSING",
        "IN_PROGRESS",
        "GENERATING",
        "EXECUTING",
    }
)

# 图片查询接口仍需要保留供应商原始的大写状态，以兼容现有轮询器。
# 这些集合只描述状态，不执行请求，也不决定本地任务是否终态。
IMAGE_TASK_SUCCESS_STATUSES = frozenset(
    {"SUCCESS", "SUCCESSFUL", "SUCCEED", "SUCCEEDED", "COMPLETED", "COMPLETE", "DONE", "FINISHED", "OK", "READY"}
)
IMAGE_TASK_FAILED_STATUSES = frozenset(
    {"FAILURE", "FAILED", "FAIL", "ERROR", "ERRORED", "CANCELED", "CANCELLED", "TIMEOUT", "REJECTED", "EXPIRED"}
)

_TRANSIENT_HTTP_STATUSES = frozenset({408, 425, 429, 500, 502, 503, 504, 520, 522, 524})
_MEDIA_KEYS = frozenset(
    {
        "image",
        "images",
        "video",
        "videos",
        "output",
        "outputs",
        "result_url",
        "result_urls",
        "video_url",
        "image_url",
        "url",
    }
)
_TASK_ID_KEYS = (
    "task_id",
    "taskId",
    "submit_id",
    "submitId",
    "video_id",
    "videoId",
    "id",
)


class RemoteTaskProtocolError(ValueError):
    """提交或观察结果不符合最小远端任务协议。"""


def image_task_data(payload: Any) -> dict:
    """读取图片任务回包的 ``data`` 包装；非法形状返回空对象。"""

    if isinstance(payload, dict) and isinstance(payload.get("data"), dict):
        return payload["data"]
    return payload if isinstance(payload, dict) else {}


def image_task_status(payload: Any) -> str:
    """提取图片任务状态并统一为大写，保留未知文字供上层决定。"""

    task_data = image_task_data(payload)
    return str(task_data.get("status") or task_data.get("task_status") or "").upper()


@dataclass(frozen=True)
class RemoteTaskContract:
    """某个供应商与任务类型的能力声明。

    ``supports_query`` 表示已有适配器能用远端编号查询；
    ``supports_cancel`` 只有在适配器真的实现并验证了取消接口时才能设为
    ``True``。当前项目内置供应商都不自动获得取消能力，避免界面停止被
    误报成远端已取消。
    """

    provider_id: str
    protocol: str
    kind: str
    query_mode: str
    supports_query: bool
    supports_cancel: bool = False


@dataclass(frozen=True)
class RemoteTaskObservation:
    """一次提交、查询或取消操作得到的脱敏观察结果。"""

    status: str
    task_id: str = ""
    error: str = ""
    retryable: bool = False
    remote_confirmed: bool = False
    operation: str = "query"


@dataclass(frozen=True)
class RemoteTaskDecision:
    """本地任务表下一步应采用的状态和动作边界。"""

    status: str
    retryable: bool = False
    remote_confirmed: bool = False
    should_resubmit: bool = False
    preserve_task_id: bool = True
    error: str = ""


def _text(value: Any, limit: int = 240) -> str:
    return str(value or "").strip()[:limit]


def _payload_data(payload: Any) -> Mapping[str, Any]:
    if not isinstance(payload, Mapping):
        return {}
    for key in ("data", "detail", "task"):
        value = payload.get(key)
        if isinstance(value, Mapping):
            return value
    return payload


def _contains_media(payload: Any) -> bool:
    if not isinstance(payload, Mapping):
        return False
    data = _payload_data(payload)
    for key in _MEDIA_KEYS:
        value = data.get(key)
        if isinstance(value, (str, bytes)) and value:
            return True
        if isinstance(value, (list, tuple, dict)) and value:
            return True
    return False


def normalize_remote_status(value: Any, *, output_present: bool = False) -> str:
    """把常见供应商状态归一化；未知文字始终返回 ``unknown``。"""

    raw = _text(value, 80).upper().replace("-", "_").replace(" ", "_")
    if raw in _SUCCESS_STATUSES:
        return REMOTE_SUCCEEDED
    if raw in _CANCELLED_STATUSES:
        return REMOTE_CANCELLED
    if raw in _FAILED_STATUSES:
        return REMOTE_FAILED
    if raw in _PENDING_STATUSES:
        return REMOTE_PENDING
    if raw in _RUNNING_STATUSES:
        return REMOTE_RUNNING
    # 某些接口不返回 status，但已经返回了媒体地址。只有在明确没有失败
    # 状态时才允许这个保守的成功兜底。
    if not raw and output_present:
        return REMOTE_SUCCEEDED
    return REMOTE_UNKNOWN


def remote_status_from_payload(payload: Any) -> str:
    """从 ``data``/``detail`` 包装中读取状态，并处理媒体地址兜底。"""

    data = _payload_data(payload)
    value = data.get("status") or data.get("task_status") or data.get("taskStatus") or data.get("state")
    return normalize_remote_status(value, output_present=_contains_media(payload))


def remote_task_id_from_payload(payload: Any) -> str:
    """提取受理编号；只访问约定字段，不递归读取用户输入正文。"""

    if not isinstance(payload, Mapping):
        return ""
    containers = [payload]
    for key in ("data", "detail", "task", "result"):
        value = payload.get(key)
        if isinstance(value, Mapping):
            containers.append(value)
    for container in containers:
        for key in _TASK_ID_KEYS:
            value = _text(container.get(key), 256)
            if value:
                return value
    return ""


def remote_error_from_payload(payload: Any) -> str:
    """提取短错误摘要，避免把完整上游回包写入本地任务记录。"""

    data = _payload_data(payload)
    error = data.get("error")
    if isinstance(error, Mapping):
        value = error.get("message") or error.get("detail") or error.get("code")
    else:
        value = error
    value = value or data.get("fail_reason") or data.get("message") or data.get("reason")
    return _text(value, 600)


def provider_task_contract(provider: Any, kind: str) -> RemoteTaskContract:
    """返回保守的查询/取消能力声明，不执行网络请求。

    ``kind`` 只接受 ``image``、``video`` 或 ``comfy``。ComfyUI 的本地
    任务记录由本应用查询，不把它误报为已具备远端供应商查询能力。
    """

    if isinstance(provider, Mapping):
        provider_id = _text(provider.get("id"), 80).lower()
        protocol = _text(provider.get("protocol"), 80).lower() or provider_id or "openai"
    else:
        provider_id = _text(provider, 80).lower()
        protocol = provider_id or "openai"
    task_kind = _text(kind, 20).lower()
    if task_kind not in {"image", "video", "comfy"}:
        raise RemoteTaskProtocolError("任务类型无效")

    if task_kind == "comfy":
        return RemoteTaskContract(provider_id or "comfy", protocol, task_kind, "local", False)

    if provider_id == "runninghub" or protocol == "runninghub":
        # RunningHub 查询当前使用统一 query 接口，方法由适配器负责。
        return RemoteTaskContract(provider_id or "runninghub", protocol, task_kind, "http_post", True)
    if provider_id == "jimeng" or protocol == "jimeng":
        # 即梦查询经过 CLI/专用适配器，不强行规定 HTTP 方法。
        return RemoteTaskContract(provider_id or "jimeng", protocol, task_kind, "adapter", True)
    if protocol in {"openai", "apimart", "gemini", "gemini-cli", "volcengine", "codex"}:
        return RemoteTaskContract(provider_id or protocol, protocol, task_kind, "http_get", True)
    return RemoteTaskContract(provider_id or "unknown", protocol, task_kind, "unsupported", False)


def _http_result_status(http_status: Optional[int], operation: str) -> Optional[RemoteTaskObservation]:
    if http_status is None or 200 <= int(http_status) < 300:
        return None
    status = int(http_status)
    op = _text(operation, 20).lower() or "query"
    # 查询端点的 404 只能说明当前端点查不到，不能说明远端任务已停止。
    if status == 404 and op in {"query", "cancel"}:
        return RemoteTaskObservation(REMOTE_UNKNOWN, retryable=False, operation=op)
    if status in _TRANSIENT_HTTP_STATUSES:
        return RemoteTaskObservation(REMOTE_UNKNOWN, retryable=True, operation=op)
    if op == "submit" and 400 <= status < 500:
        return RemoteTaskObservation(REMOTE_FAILED, retryable=False, remote_confirmed=True, operation=op)
    # 查询或取消收到其它明确错误时仍不能声称远端任务失败/已取消。
    return RemoteTaskObservation(REMOTE_UNKNOWN, retryable=False, operation=op)


def observe_remote_task(
    payload: Any = None,
    *,
    operation: str = "query",
    http_status: Optional[int] = None,
    transport_error: bool = False,
) -> RemoteTaskObservation:
    """把一次网络结果变成脱敏观察结果。

    ``transport_error``、超时、5xx、429 以及查询 404 都不会被转成
    ``failed``；调用方必须保留任务编号并避免自动再次提交。
    """

    op = _text(operation, 20).lower() or "query"
    if transport_error:
        return RemoteTaskObservation(REMOTE_UNKNOWN, retryable=True, operation=op)
    http_observation = _http_result_status(http_status, op)
    if http_observation is not None:
        return http_observation

    task_id = remote_task_id_from_payload(payload)
    raw_status = remote_status_from_payload(payload)
    error = remote_error_from_payload(payload)
    if op == "submit" and raw_status == REMOTE_UNKNOWN and task_id:
        # 受理响应常常只返回 task id；这不是失败，也不是完成。
        raw_status = REMOTE_PENDING
    if op == "cancel":
        if raw_status == REMOTE_CANCELLED:
            return RemoteTaskObservation(raw_status, task_id, error, remote_confirmed=True, operation=op)
        # 取消接口返回 2xx 但没有明确 cancelled 也不能宣称已取消。
        return RemoteTaskObservation(REMOTE_UNKNOWN, task_id, error, retryable=False, operation=op)
    return RemoteTaskObservation(
        raw_status,
        task_id,
        error,
        retryable=raw_status in {REMOTE_PENDING, REMOTE_RUNNING, REMOTE_UNKNOWN},
        remote_confirmed=raw_status in REMOTE_TERMINAL_STATES,
        operation=op,
    )


def remote_task_decision(current_status: Any, observation: RemoteTaskObservation) -> RemoteTaskDecision:
    """根据观察结果给出本地状态决策。

    ``should_resubmit`` 永远为 ``False``：未知状态下重提是否安全必须由
    用户或供应商幂等协议另行确认，不能由通用层猜测。
    """

    current = _text(current_status, 40).lower() or REMOTE_UNKNOWN
    if current in REMOTE_TERMINAL_STATES and observation.status == REMOTE_UNKNOWN:
        # 已确认的终态不能因一次查询故障退回未知。
        return RemoteTaskDecision(current, retryable=observation.retryable, remote_confirmed=True, error=observation.error)
    status = observation.status if observation.status in {
        REMOTE_PENDING,
        REMOTE_RUNNING,
        REMOTE_SUCCEEDED,
        REMOTE_FAILED,
        REMOTE_CANCELLED,
        REMOTE_UNKNOWN,
    } else REMOTE_UNKNOWN
    return RemoteTaskDecision(
        status,
        retryable=observation.retryable,
        remote_confirmed=observation.remote_confirmed,
        should_resubmit=False,
        preserve_task_id=True,
        error=observation.error,
    )


def local_stop_decision(current_status: Any) -> RemoteTaskDecision:
    """描述浏览器/本地等待停止，不伪造远端取消。"""

    status = _text(current_status, 40).lower()
    if status not in REMOTE_ACTIVE_STATES and status not in REMOTE_TERMINAL_STATES:
        status = REMOTE_UNKNOWN
    return RemoteTaskDecision(
        status,
        retryable=False,
        remote_confirmed=False,
        should_resubmit=False,
        preserve_task_id=True,
        error="本地已停止等待；远端状态未被取消",
    )


def cancel_remote_task(
    contract: RemoteTaskContract,
    *,
    payload: Any = None,
    http_status: Optional[int] = None,
    transport_error: bool = False,
) -> RemoteTaskObservation:
    """处理取消结果；未声明能力或无明确确认时不返回 ``cancelled``。"""

    if not contract.supports_cancel:
        return RemoteTaskObservation(REMOTE_UNKNOWN, operation="cancel")
    observation = observe_remote_task(
        payload,
        operation="cancel",
        http_status=http_status,
        transport_error=transport_error,
    )
    if observation.status == REMOTE_CANCELLED and observation.remote_confirmed:
        return observation
    return RemoteTaskObservation(
        REMOTE_UNKNOWN,
        observation.task_id,
        observation.error,
        retryable=observation.retryable,
        operation="cancel",
    )


def submission_summary(provider: Any, kind: str, payload: Any) -> dict[str, Any]:
    """生成可持久化的受理摘要，不包含原始 prompt/workflow/回包。"""

    contract = provider_task_contract(provider, kind)
    task_id = remote_task_id_from_payload(payload)
    if not task_id:
        raise RemoteTaskProtocolError("提交响应缺少远端任务编号")
    observation = observe_remote_task(payload, operation="submit", http_status=200)
    return {
        "provider_id": contract.provider_id,
        "protocol": contract.protocol,
        "kind": contract.kind,
        "remote_task_id": task_id,
        "status": observation.status,
        "query_supported": contract.supports_query,
        "cancel_supported": contract.supports_cancel,
        "raw_persisted": False,
    }

