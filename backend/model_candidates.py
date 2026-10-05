"""候选模型顺序和切换边界的纯规则。

模块不发起请求、不读取配置文件，也不决定具体供应商。入口层传入当前
响应摘要后，可据此判断是否允许尝试下一个候选模型。
"""

from .model_selection import model_list_from_values, selected_model


RETRYABLE_MODEL_STATUSES = frozenset({404, 408, 425, 429, 500, 502, 503, 504, 520, 522, 524})
TERMINAL_MODEL_STATUSES = frozenset({400, 401, 402, 403, 409, 413, 415, 422})

_MODEL_UNAVAILABLE_MARKERS = (
    "model not found",
    "model_not_found",
    "unknown model",
    "unsupported model",
    "model unavailable",
    "模型不存在",
    "模型不可用",
    "不支持该模型",
)
_RETRYABLE_TRANSPORT_MARKERS = (
    "timeout",
    "timed out",
    "temporarily unavailable",
    "service unavailable",
    "gateway",
    "连接超时",
    "暂时不可用",
    "网关错误",
)
_TERMINAL_AUTH_MARKERS = (
    "invalid api key",
    "invalid api_key",
    "unauthorized",
    "forbidden",
    "permission denied",
    "余额不足",
    "权限不足",
    "密钥无效",
)
_TERMINAL_REQUEST_MARKERS = (
    "invalid request",
    "invalid parameter",
    "content policy",
    "内容安全",
    "参数错误",
    "提示词不合法",
)


def candidate_models(requested, configured, fallback):
    """返回候选模型，显式请求时只保留用户指定的模型。"""
    if str(requested or "").strip():
        return [selected_model(requested, fallback)]
    models = model_list_from_values(configured or [])
    if models:
        return models
    return [selected_model("", fallback)]


def classify_model_failure(
    status_code=0,
    error_text="",
    *,
    remote_task_id="",
    accepted=False,
):
    """将一次失败归类为可切换或必须停止的边界。"""
    if accepted or str(remote_task_id or "").strip():
        return "accepted"
    try:
        status = int(status_code or 0)
    except (TypeError, ValueError):
        status = 0
    text = str(error_text or "").strip().lower()
    if status in {401, 403} or any(marker in text for marker in _TERMINAL_AUTH_MARKERS):
        return "terminal_auth"
    if status == 402 or "quota" in text or "余额" in text:
        return "terminal_quota"
    if status in TERMINAL_MODEL_STATUSES and status != 404:
        return "terminal_request"
    if any(marker in text for marker in _TERMINAL_REQUEST_MARKERS):
        return "terminal_request"
    if status == 404 or any(marker in text for marker in _MODEL_UNAVAILABLE_MARKERS):
        return "retryable_model_unavailable"
    if status in RETRYABLE_MODEL_STATUSES or any(marker in text for marker in _RETRYABLE_TRANSPORT_MARKERS):
        return "retryable_transport"
    return "terminal_unknown"


def can_try_next_model(status_code=0, error_text="", *, remote_task_id="", accepted=False):
    """只有明确的未受理模型/传输失败才允许切换。"""
    return classify_model_failure(
        status_code,
        error_text,
        remote_task_id=remote_task_id,
        accepted=accepted,
    ).startswith("retryable_")
