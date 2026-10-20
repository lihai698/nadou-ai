"""即梦命令行输出解析、参数规则与队列状态协议。

参数模型、异常类型与清洗回调由应用注入；不启动进程或读取登录配置。
"""
import re
import json

def decode_utf16_auto(raw):
    try:
        le = raw.decode("utf-16le", errors="ignore")
    except Exception:
        le = ""
    try:
        be = raw.decode("utf-16be", errors="ignore")
    except Exception:
        be = ""
    def ascii_score(text):
        return sum(1 for ch in text if 0x20 <= ord(ch) <= 0x7e)
    return le if ascii_score(le) >= ascii_score(be) else be


def decode_wsl_output(data, *, decode_utf16_auto):
    data = data or b""
    if not data:
        return ""

    # WSL can mix UTF-16 diagnostics with UTF-8 command output in the same
    # stream. Decode per line so a WSL proxy warning does not corrupt CLI errors.
    if b"\x00" in data[:400]:
        lines = []
        for raw_line in data.splitlines():
            if not raw_line:
                lines.append("")
                continue
            sample = raw_line[:200]
            nul_ratio = sample.count(0) / max(1, len(sample))
            if nul_ratio > 0.2:
                try:
                    lines.append(decode_utf16_auto(raw_line))
                    continue
                except Exception:
                    pass
            lines.append(raw_line.decode("utf-8-sig", errors="ignore"))
        return "\n".join(lines)
    if b"\x00" in data[:200]:
        try:
            return decode_utf16_auto(data)
        except Exception:
            pass
    return data.decode("utf-8-sig", errors="ignore")


def jimeng_clean_wsl_stderr(text):
    lines = []
    skip_next_warning_context = False
    for line in str(text or "").splitlines():
        clean = line.replace("\x00", "").strip()
        low = clean.lower()
        is_proxy_warning = "localhost" in low and "wsl" in low and ("nat" in low or "proxy" in low or "代理" in clean)
        # Windows/WSL can mojibake the proxy warning. Keep explicit failures, but
        # do not turn a completed Dreamina task into a failed request for this noise.
        is_proxy_mojibake = "localhost" in low and len(clean) < 120 and not any(
            token in low for token in ("error", "failed", "traceback", "exception", "refused", "denied")
        )
        is_python_warning = "requestsdependencywarning" in low or (skip_next_warning_context and clean.startswith("warnings.warn("))
        skip_next_warning_context = "requestsdependencywarning" in low
        if clean and not is_proxy_warning and not is_proxy_mojibake and not is_python_warning:
            lines.append(clean)
    return "\n".join(lines).strip()


def jimeng_has_result_payload(raw):
    """Recognize CLI output that is usable even when its process exit code is non-zero."""
    found = False
    def visit(value):
        nonlocal found
        if found:
            return
        if isinstance(value, dict):
            keys = {str(key).lower() for key in value}
            if keys & {"submit_id", "submitid", "task_id", "taskid", "gen_status", "result_json", "images", "videos", "data"}:
                found = True
                return
            for item in value.values():
                if isinstance(item, (dict, list)):
                    visit(item)
        elif isinstance(value, list):
            for item in value:
                visit(item)
    visit(raw)
    return found


def windows_path_to_wsl(path):
    text = str(path or "").replace("\\", "/")
    match = re.match(r"^([A-Za-z]):/(.*)$", text)
    if match:
        return f"/mnt/{match.group(1).lower()}/{match.group(2)}"
    return text


def wsl_path_to_windows(path):
    text = str(path or "").strip()
    match = re.match(r"^/mnt/([A-Za-z])/(.*)$", text)
    if match:
        tail = match.group(2).replace("/", "\\")
        return f"{match.group(1).upper()}:\\{tail}"
    return text


def jimeng_cli_path_arg(path, *, jimeng_use_wsl, windows_path_to_wsl):
    return windows_path_to_wsl(path) if jimeng_use_wsl() else path


def jimeng_extract_json(text):
    text = str(text or "").strip()
    if not text:
        return {}
    decoder = json.JSONDecoder()
    parsed = []
    for i, ch in enumerate(text):
        if ch not in "[{":
            continue
        try:
            obj, _end = decoder.raw_decode(text[i:])
            if not text[:i].strip():
                return obj
            parsed.append((i, obj))
        except Exception:
            continue
    def score(item):
        _idx, obj = item
        if not isinstance(obj, dict):
            return 1
        keys = {str(key).lower() for key in obj.keys()}
        weight = 0
        for key in ("submit_id", "gen_status", "result_json", "images", "videos", "data", "total_credit"):
            if key in keys:
                weight += 10
        return weight
    return max(parsed, key=score)[1] if parsed else {"text": text}


def jimeng_parse_version(text):
    match = re.search(r"(\d+)\.(\d+)\.(\d+)", str(text or ""))
    if not match:
        return None
    return tuple(int(part) for part in match.groups())


def jimeng_decode_cli_output(stdout, stderr, *, decode_wsl_output, jimeng_clean_wsl_stderr, jimeng_use_wsl):
    out_text = (decode_wsl_output(stdout) if jimeng_use_wsl() else stdout.decode("utf-8", errors="replace")).strip()
    err_text = (decode_wsl_output(stderr) if jimeng_use_wsl() else stderr.decode("utf-8", errors="replace")).strip()
    clean_err_text = jimeng_clean_wsl_stderr(err_text) if jimeng_use_wsl() else err_text
    return out_text, clean_err_text


def jimeng_submit_id(raw):
    found = []
    def visit(value):
        if isinstance(value, dict):
            for key, item in value.items():
                if str(key).lower() in {"submit_id", "submitid", "task_id", "taskid"} and item:
                    found.append(str(item))
                else:
                    visit(item)
        elif isinstance(value, list):
            for item in value:
                visit(item)
    visit(raw)
    return found[0] if found else ""


def jimeng_queue_info(raw):
    """从即梦原始返回里就近取出 queue_info（含 queue_idx/queue_length/queue_status）。"""
    found = []
    def visit(value):
        if isinstance(value, dict):
            qi = value.get("queue_info")
            if isinstance(qi, dict) and qi:
                found.append(qi)
            for item in value.values():
                if isinstance(item, (dict, list)):
                    visit(item)
        elif isinstance(value, list):
            for item in value:
                visit(item)
    visit(raw)
    return found[0] if found else {}


def jimeng_public_queue_info(value):
    """保留排队提示所需的小字段，避免把 CLI 原始回包带到响应或任务记录。"""
    source = value if isinstance(value, dict) else {}
    result = {}
    for key in ("queue_idx", "queue_length"):
        item = source.get(key)
        if isinstance(item, bool):
            continue
        try:
            number = int(item)
        except (TypeError, ValueError):
            continue
        if 0 <= number <= 1000000:
            result[key] = number
    status = str(source.get("queue_status") or "").strip().lower()
    if status in {"queued", "pending", "running", "processing", "waiting", "success", "failed"}:
        result["queue_status"] = status
    return result


def jimeng_pending_payload(exc, *, jimeng_public_queue_info):
    qi = jimeng_public_queue_info(exc.queue_info)
    idx = qi.get("queue_idx")
    length = qi.get("queue_length")
    if idx is not None and length is not None:
        msg = f"即梦云端排队中（第 {idx}/{length} 位），任务未丢失，可继续等待或手动查询。submit_id={exc.submit_id}"
    else:
        msg = f"即梦任务仍在生成中，任务未丢失。submit_id={exc.submit_id}"
    return {
        "jimeng_pending": True,
        "submit_id": exc.submit_id,
        "kind": exc.kind,
        "queue_info": qi,
        "message": msg,
    }


def jimeng_failure_reason(raw, *, jimeng_friendly_error_detail):
    found = []
    def visit(value):
        if isinstance(value, dict):
            status = str(value.get("gen_status") or value.get("status") or "").strip().lower()
            reason = value.get("fail_reason") or value.get("failReason") or value.get("error") or value.get("message") or value.get("msg")
            if reason and (status in {"fail", "failed", "error"} or "fail" in str(reason).lower() or "invalid param" in str(reason).lower()):
                found.append(reason)
            for item in value.values():
                if isinstance(item, (dict, list)):
                    visit(item)
        elif isinstance(value, list):
            for item in value:
                visit(item)
    visit(raw)
    return jimeng_friendly_error_detail(found[0]) if found else ""


def jimeng_has_explicit_failure(raw):
    """识别即梦回包中的明确失败状态，即使没有附带错误文字。"""
    failure_statuses = {
        "fail",
        "failed",
        "failure",
        "error",
        "errored",
        "timeout",
        "timedout",
        "rejected",
        "expired",
    }
    found = False

    def visit(value):
        nonlocal found
        if found:
            return
        if isinstance(value, dict):
            status = str(
                value.get("gen_status")
                or value.get("status")
                or value.get("task_status")
                or value.get("taskStatus")
                or ""
            ).strip().lower().replace("-", "_").replace(" ", "_")
            if status in failure_statuses:
                found = True
                return
            for item in value.values():
                if isinstance(item, (dict, list)):
                    visit(item)
        elif isinstance(value, list):
            for item in value:
                visit(item)

    visit(raw)
    return found


def jimeng_friendly_error_detail(detail, *, provider_error_summary):
    text = str(detail or "").strip()
    if "aigccomplianceconfirmationrequired" in text.lower():
        return "即梦要求先完成内容安全授权。请在 Dreamina 网页端按提示确认授权后，再返回此处重试。"
    return provider_error_summary(detail, fallback="即梦请求失败")


def jimeng_collect_media_values(value, outputs, *, jimeng_collect_media_values):
    media_ext = re.compile(r"\.(png|jpe?g|webp|gif|bmp|mp4|webm|mov|m4v|avi|mkv)(\?|#|$)", re.I)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return
        if text.startswith(("http://", "https://", "/output/", "/assets/", "file://")) or media_ext.search(text):
            outputs.append(text)
        return
    if isinstance(value, list):
        for item in value:
            jimeng_collect_media_values(item, outputs)
        return
    if isinstance(value, dict):
        for key in (
            "url", "urls", "image", "images", "image_url", "image_urls",
            "video", "videos", "video_url", "video_urls", "output", "outputs",
            "result", "results", "file", "files", "path", "paths",
            "download_url", "download_urls", "downloadUrl", "file_path", "filePath",
        ):
            if key in value:
                jimeng_collect_media_values(value.get(key), outputs)
        for item in value.values():
            if isinstance(item, (dict, list)):
                jimeng_collect_media_values(item, outputs)


def jimeng_output_values(raw, *, jimeng_collect_media_values):
    outputs = []
    jimeng_collect_media_values(raw, outputs)
    deduped = []
    for value in outputs:
        if value not in deduped:
            deduped.append(value)
    return deduped


def jimeng_ratio_from_size(size, fallback='1:1', *, JIMENG_RATIO_CHOICES, parse_size_pair):
    width, height = parse_size_pair(size)
    if not width or not height:
        return fallback
    ratio = width / max(1, height)
    left, right = min(JIMENG_RATIO_CHOICES, key=lambda item: abs(ratio - item[0] / item[1]))
    return f"{left}:{right}"


def jimeng_normalize_image_model(model):
    text = str(model or "").strip()
    if re.search(r"\b5(?:\.0)?\s*[-_ ]?pro\b", text, re.IGNORECASE):
        return "5.0Pro"
    match = re.search(r"(\d+\.\d+)", text)
    return match.group(1) if match else ""


def jimeng_image_model_version(model, mode='text2image', *, JIMENG_IMAGE2IMAGE_MODELS, JIMENG_TEXT2IMAGE_MODELS, jimeng_normalize_image_model):
    version = jimeng_normalize_image_model(model)
    allowed = JIMENG_IMAGE2IMAGE_MODELS if mode == "image2image" else JIMENG_TEXT2IMAGE_MODELS
    return version if version in allowed else ""


def jimeng_image_resolution(model, size, mode='text2image', *, jimeng_normalize_image_model, parse_size_pair):
    text = str(model or "").lower()
    if "4k" in text:
        desired = "4k"
    elif "1k" in text:
        desired = "1k"
    elif "2k" in text:
        desired = "2k"
    else:
        width, height = parse_size_pair(size)
        longest_side = max(width, height)
        pixel_count = width * height
        if longest_side > 3072 or pixel_count > 6000000:
            desired = "4k"
        elif longest_side > 1536 or pixel_count > 1572864:
            desired = "2k"
        else:
            desired = "1k"
    # 按官方规则收敛到模型允许的分辨率
    version = jimeng_normalize_image_model(model)
    if mode == "image2image":
        if version == "5.0Pro":
            return desired if desired in {"1k", "2k", "4k"} else "1k"
        return "4k" if desired == "4k" else "2k"
    if version in ("3.0", "3.1", "5.0Pro"):
        if version == "5.0Pro" and desired == "4k":
            return "4k"
        return "1k" if desired == "1k" else "2k"
    # 4.x/5.0 只支持 2k/4k
    return "4k" if desired == "4k" else "2k"


def jimeng_video_resolution(model, resolution, *, HTTPException, JIMENG_VIDEO_HIGH_RES_MODELS, jimeng_video_model_version):
    version = jimeng_video_model_version(model)
    requested = str(resolution or "").strip().lower()
    if not requested:
        requested = "720p"
    elif requested in {"4k", "4kp"}:
        requested = "4k"
    elif requested in {"1080p", "1080"}:
        requested = "1080p"
    elif requested in {"720p", "720"}:
        requested = "720p"
    else:
        raise HTTPException(status_code=400, detail="即梦视频只支持 720p；seedance2.0_vip 额外支持 1080p 和 4k。")
    if version not in JIMENG_VIDEO_HIGH_RES_MODELS:
        if requested != "720p":
            raise HTTPException(status_code=400, detail=f"即梦模型 {version or model} 只支持 720p。")
        return requested
    return requested


def jimeng_video_duration_range(model, command='', *, jimeng_video_model_version):
    version = jimeng_video_model_version(model)
    if command in {"image2video", "frames2video"} and version == "seedance1.5pro":
        return 5, 12
    if command == "image2video" and version == "seedance1.0fast":
        return 5, 10
    return 4, 15


def jimeng_video_duration(duration, model=None, command='', *, HTTPException, jimeng_video_duration_range, jimeng_video_model_version):
    low, high = jimeng_video_duration_range(model, command)
    default = max(low, min(high, 5))
    try:
        text = str(duration).strip() if duration is not None else ""
        value = default if text == "" else int(text)
    except Exception:
        raise HTTPException(status_code=400, detail=f"即梦视频时长必须是 {low}-{high} 秒的整数。")
    if not low <= value <= high:
        raise HTTPException(status_code=400, detail=f"即梦模型 {jimeng_video_model_version(model) or model} 只支持 {low}-{high} 秒时长。")
    return value


def jimeng_transition_duration(total_duration, transition_count):
    count = max(1, int(transition_count or 1))
    try:
        total = float(total_duration) if str(total_duration).strip() else 0.0
    except Exception:
        total = 0.0
    return max(1, min(8, int(round(3.0 if total <= 0 else total / count))))


def jimeng_multiframe_transition_prompts(prompt, segments):
    segments = max(1, int(segments or 1))
    prompts = [line.strip() for line in str(prompt or "").splitlines() if line.strip()]
    if not prompts:
        return []
    if len(prompts) == 1:
        prompts *= segments
    elif len(prompts) < segments:
        prompts.extend([prompts[-1]] * (segments - len(prompts)))
    return prompts[:segments]


def jimeng_video_model_version(model, *, JIMENG_VIDEO_MODEL_VERSIONS):
    value = str(model or "").strip()
    low = value.lower()
    aliases = {
        "seedance1.0fast": "seedance1.0fast",
        "seedance1.5pro": "seedance1.5pro",
        "seedance2.0fast_vip": "seedance2.0fast_vip",
        "seedance2.0_vip": "seedance2.0_vip",
        "seedance2.0mini": "seedance2.0mini",
        "seedance2.0fast": "seedance2.0fast",
        "seedance2.0": "seedance2.0",
    }
    for key, mapped in aliases.items():
        if key in low:
            return mapped if mapped in JIMENG_VIDEO_MODEL_VERSIONS else ""
    return ""


def jimeng_video_model_for_command(model, command, *, HTTPException, JIMENG_VIDEO_MODELS_BY_COMMAND, jimeng_video_model_version):
    version = jimeng_video_model_version(model)
    allowed = JIMENG_VIDEO_MODELS_BY_COMMAND.get(command) or set()
    if version in allowed:
        return version
    supported = "、".join(sorted(allowed))
    raise HTTPException(status_code=400, detail=f"即梦 {command} 不支持模型「{model}」。可用模型：{supported}。")


def jimeng_video_resolution_arg(model, resolution, *, jimeng_video_resolution):
    return jimeng_video_resolution(model, resolution)


def jimeng_video_ratio_arg(aspect_ratio):
    value = str(aspect_ratio or "").strip()
    allowed = {"1:1", "3:4", "16:9", "4:3", "9:16", "21:9"}
    if value in allowed:
        return value
    return ""


def jimeng_video_ratio(aspect_ratio, default='16:9', *, HTTPException, jimeng_video_ratio_arg):
    value = str(aspect_ratio or "").strip()
    if not value:
        return default
    ratio = jimeng_video_ratio_arg(value)
    if not ratio:
        raise HTTPException(status_code=400, detail="即梦视频比例仅支持 1:1、3:4、16:9、4:3、9:16、21:9。")
    return ratio


def jimeng_append_model_resolution_args(args, payload, model_version='', *, jimeng_video_resolution_arg):
    if model_version:
        args.append(f"--model_version={model_version}")
    args.append(f"--video_resolution={jimeng_video_resolution_arg(model_version or payload.model, payload.resolution)}")


def jimeng_multiframe_resolution(resolution, *, HTTPException):
    value = str(resolution or "").strip().lower()
    if not value:
        return "720p"
    if value in {"720", "720p"}:
        return "720p"
    if value in {"1080", "1080p"}:
        return "1080p"
    raise HTTPException(status_code=400, detail="即梦多帧视频只支持 720p 或 1080p。")


def jimeng_video_ref_role(ref):
    role = getattr(ref, "role", "")
    if isinstance(ref, dict):
        role = ref.get("role", role)
    return str(role or "").lower()


def jimeng_video_ref_url(ref):
    url = getattr(ref, "url", "")
    if isinstance(ref, dict):
        url = ref.get("url", url)
    return str(url or "").strip()


def jimeng_normalize_upscale_resolution(value, *, JIMENG_UPSCALE_RESOLUTIONS):
    resolution = str(value or "").strip().lower()
    return resolution if resolution in JIMENG_UPSCALE_RESOLUTIONS else "2k"


