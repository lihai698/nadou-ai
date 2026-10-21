"""上游 HTTP 请求的瞬时错误重试；请求参数与应用依赖显式传入。"""

async def httpx_request_with_transient_retries(client, method, url, attempts, retry_delay, kwargs, *, asyncio, httpx, write_diagnostic, redact_url_for_log, redact_log_text):
    attempts = max(1, int(attempts or 1))
    last_exc = None
    retry_statuses = {502, 503, 504, 520, 522, 524}
    for attempt in range(attempts):
        try:
            response = await client.request(method, url, **kwargs)
            if response.status_code in retry_statuses and attempt + 1 < attempts:
                await asyncio.sleep(retry_delay * (attempt + 1))
                continue
            return response
        except (httpx.RemoteProtocolError, httpx.ReadError, httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadTimeout, httpx.PoolTimeout) as exc:
            last_exc = exc
            if attempt + 1 >= attempts:
                raise
            write_diagnostic(
                f"[HTTPX-RETRY] {method} {redact_url_for_log(url)} transient error: "
                f"{redact_log_text(exc)[:300]}; retry {attempt + 2}/{attempts}"
            )
            await asyncio.sleep(retry_delay * (attempt + 1))
    if last_exc:
        raise last_exc
    raise httpx.HTTPError(f"请求失败：{method} {redact_url_for_log(url)[:512]}")
