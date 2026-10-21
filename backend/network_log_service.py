"""网络诊断文本的 URL、代理和异常链脱敏；只通过 host 的诊断写入接口输出。"""
import re

_LOG_URL_RE = re.compile(r"https?://[^\s\"'<>]+", re.IGNORECASE)

_LOG_SECRET_ASSIGNMENT_RE = re.compile(
    r"(\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|passwd|authorization)\b\s*[:=]\s*)(?:Bearer\s+)?([^\s,;]+)",
    re.IGNORECASE,
)



def redact_url_for_log(value, *, urllib):
    """保留网络请求的主机和路径，移除用户信息、查询参数及片段。"""
    raw = str(value or "").strip()
    if not raw:
        return "?"
    try:
        parsed = urllib.parse.urlsplit(raw)
        if not parsed.scheme and not parsed.netloc:
            return parsed.path or "?"
        hostname = parsed.hostname or "?"
        if ":" in hostname and not hostname.startswith("["):
            hostname = f"[{hostname}]"
        try:
            port = f":{parsed.port}" if parsed.port else ""
        except ValueError:
            port = ""
        netloc = hostname + port
        prefix = f"{parsed.scheme}://" if parsed.scheme else "//"
        return f"{prefix}{netloc}{parsed.path or '/'}"
    except Exception:
        return "[已脱敏 URL]"


def redact_log_text(value, *, redact_url_for_log):
    """移除异常文本中的 URL 查询值和常见凭据字段，避免凭据进入诊断日志。"""
    text = str(value or "")
    text = _LOG_URL_RE.sub(lambda match: redact_url_for_log(match.group(0)), text)
    return _LOG_SECRET_ASSIGNMENT_RE.sub(r"\1<redacted>", text)


def format_proxy_summary(proxies, *, redact_url_for_log):
    """只记录代理类型及脱敏后的主机/路径，不输出代理认证信息。"""
    if not isinstance(proxies, dict) or not proxies:
        return "none"
    parts = []
    for scheme, value in sorted(proxies.items(), key=lambda item: str(item[0])):
        if str(scheme).lower() == "no_proxy":
            continue
        parts.append(f"{scheme}={redact_url_for_log(value)[:256]}")
    return ",".join(parts) or "none"


def log_net_error(context, exc, url='', *, redact_log_text, urllib, write_diagnostic, format_context, redact_url_for_log, format_proxy_summary):
    """记录可定位的网络错误，同时脱敏 URL、代理和异常链中的凭据。"""
    try:
        chain = []
        cur = exc
        seen = 0
        while cur is not None and seen < 6:
            chain.append(f"{type(cur).__module__}.{type(cur).__name__}: {redact_log_text(str(cur))[:200]}")
            nxt = getattr(cur, "__cause__", None) or getattr(cur, "__context__", None)
            if nxt is cur:
                break
            cur = nxt
            seen += 1
        if not url:
            req = getattr(exc, "request", None)
            if req is not None:
                url = str(getattr(req, "url", "") or "")
        try:
            proxies = urllib.request.getproxies() or {}
        except Exception:
            proxies = {}
        write_diagnostic(
            f"[NET-ERR] {format_context()} | {redact_log_text(context)[:300]} | "
            f"url={redact_url_for_log(url)[:512]} | "
            f"sys_proxy={format_proxy_summary(proxies)} | " + " <- ".join(chain)
        )
    except Exception:
        try:
            write_diagnostic(
                f"[NET-ERR] {format_context()} | {redact_log_text(context)[:300]} | "
                f"error={type(exc).__name__}"
            )
        except Exception:
            pass
