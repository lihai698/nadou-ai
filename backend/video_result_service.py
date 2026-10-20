"""视频结果地址解析、公开响应整理与失败提示。

不拥有任务或输出文件；公开错误及队列摘要策略由应用注入。
"""

VIDEO_URL_KEYS = (
    "url", "video_url", "videoUrl", "mp4_url", "mp4Url",
    "output", "output_url", "outputUrl", "download_url", "downloadUrl",
    "video", "src", "uri", "preview_url", "previewUrl", "path",
    "last_frame_url", "lastFrameUrl", "remixed_from_video_id",
)

def _collect_video_url(value, urls):
    if not value:
        return
    if isinstance(value, str):
        if value.startswith("http://") or value.startswith("https://") or value.startswith("/output/") or value.startswith("/assets/"):
            urls.append(value)
        return
    if isinstance(value, list):
        for item in value:
            _collect_video_url(item, urls)
        return
    if isinstance(value, dict):
        for key in ("videos", "outputs", "data", "detail", "result", "results", "content"):
            if key in value:
                _collect_video_url(value.get(key), urls)
        for key in VIDEO_URL_KEYS:
            if key in value:
                _collect_video_url(value.get(key), urls)


def video_output_urls(raw):
    urls = []
    if not isinstance(raw, dict):
        return urls
    candidates = [raw]
    data = raw.get("data")
    detail = raw.get("detail")
    content = raw.get("content")
    if isinstance(data, dict):
        candidates.append(data)
    elif isinstance(data, list):
        for item in data:
            if isinstance(item, dict):
                candidates.append(item)
    if isinstance(detail, dict):
        candidates.append(detail)
    elif isinstance(detail, list):
        for item in detail:
            if isinstance(item, dict):
                candidates.append(item)
    if isinstance(content, dict):
        candidates.append(content)
    elif isinstance(content, list):
        for item in content:
            if isinstance(item, dict):
                candidates.append(item)
    for node in list(candidates):
        result = node.get("result") if isinstance(node, dict) else None
        results = node.get("results") if isinstance(node, dict) else None
        if isinstance(result, dict):
            candidates.append(result)
        elif isinstance(result, list):
            for item in result:
                if isinstance(item, dict):
                    candidates.append(item)
        if isinstance(results, dict):
            candidates.append(results)
        elif isinstance(results, list):
            for item in results:
                if isinstance(item, dict):
                    candidates.append(item)
    for node in candidates:
        if not isinstance(node, dict):
            continue
        for key in ("videos", "outputs", "results", "content"):
            value = node.get(key)
            if value:
                _collect_video_url(value, urls)
        for key in VIDEO_URL_KEYS:
            if key in node:
                _collect_video_url(node.get(key), urls)
    deduped = []
    for url in urls:
        if isinstance(url, str) and url and url not in deduped:
            deduped.append(url)
    return deduped


def humanize_video_task_failure(reason, *, _safe_upstream_text):
    """把上游视频任务的失败原因转成对用户友好的中文提示。
    目前主要处理 veo（Google）的内容安全过滤码。"""
    text = _safe_upstream_text(reason, 300)
    upper = text.upper()
    # veo 知名人物/真人面孔过滤
    if "PROMINENT_PEOPLE_FILTER" in upper or "PROMINENT_PEOPLE" in upper:
        return (
            "视频生成被上游内容安全策略拦截：检测到提示词或参考图里包含知名人物 / 真人面孔"
            f"（错误码：{text}）。\n\n"
            "这不是代码错误，而是 veo（Google）的内容审核规则——它会拒绝生成涉及真实/知名人物的视频。\n\n"
            "建议这样处理：\n"
            "  1. 去掉提示词里的人名、明星、公众人物等指向具体真人的描述；\n"
            "  2. 换用非真人参考图，例如插画、AI 头像、卡通形象、商品图、场景图；\n"
            "  3. 如果用了真人照片做参考图，先做模糊/遮挡/转成明显的二次元插画风，或干脆只用文字提示词测试。"
        )
    # veo 其它常见安全过滤
    if "SAFETY" in upper or "CONTENT_FILTER" in upper or "POLICY" in upper:
        return (
            "视频生成被上游内容安全策略拦截"
            f"（错误码：{text}）。\n\n"
            "这是 veo 的内容审核规则，提示词或参考图触发了安全过滤。\n"
            "请调整提示词/参考图后重试，避免涉及真人、暴力、敏感或受限内容。"
        )
    return f"视频生成任务失败：{text}"


def public_video_generation_result(result, *, _safe_upstream_text, jimeng_public_queue_info):
    """把视频生成器的内部结果压缩成可公开的最小响应。"""
    if not isinstance(result, dict):
        return {}
    payload = {}
    videos = []
    values = result.get("videos")
    if isinstance(values, (list, tuple)):
        for item in values[:32]:
            value = item.get("url") if isinstance(item, dict) else item
            value = str(value or "").strip()
            if value.startswith(("/output/", "/assets/")) and value not in videos:
                videos.append(value)
    if videos:
        payload["videos"] = videos
    for key in ("task_id", "video_id", "submit_id"):
        value = str(result.get(key) or "").strip()
        if value:
            payload[key] = value[:240]
    for key in ("jimeng_pending",):
        if key in result:
            payload[key] = bool(result.get(key))
    kind = str(result.get("kind") or "").strip()
    if kind:
        payload["kind"] = kind[:40]
    queue_info = jimeng_public_queue_info(result.get("queue_info"))
    if queue_info:
        payload["queue_info"] = queue_info
    message = str(result.get("message") or "").strip()
    if message:
        payload["message"] = _safe_upstream_text(message, 600)
    error = result.get("error")
    if error:
        payload["error"] = _safe_upstream_text(error, 600)
    status = str(result.get("status") or "").strip()
    if status:
        payload["status"] = status[:40]
    status_code = result.get("status_code")
    if isinstance(status_code, int) and 100 <= status_code <= 599:
        payload["status_code"] = status_code
    return payload


