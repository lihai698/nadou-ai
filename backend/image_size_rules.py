"""Current image size algorithms; application-owned limits and callbacks are explicit.

No configuration, files, subprocesses or network are accessed here.
"""
import math
import re

def parse_size_pair(size):
    match = re.fullmatch(r"\s*(\d+)\s*[xX*]\s*(\d+)\s*", str(size or ""))
    if not match:
        return 0, 0
    return int(match.group(1)), int(match.group(2))


def snap_size_to_multiple(size, multiple=16, *, parse_size_pair):
    width, height = parse_size_pair(size)
    if not width or not height:
        return size
    step = max(1, int(multiple or 16))
    snapped_w = max(step, int(math.ceil(width / step) * step))
    snapped_h = max(step, int(math.ceil(height / step) * step))
    return f"{snapped_w}x{snapped_h}"


def chat_prompt_size_override(message, current_size="", *, CHAT_RATIO_SIZE_OPTIONS, parse_size_pair):
    text = str(message or "")
    direct = re.search(r"(?<!\d)([1-9]\d{2,4})\s*[xX×*]\s*([1-9]\d{2,4})(?!\d)", text)
    if direct:
        width, height = int(direct.group(1)), int(direct.group(2))
        if width >= 256 and height >= 256:
            return f"{width}x{height}"

    normalized = (
        text.replace("：", ":")
        .replace("﹕", ":")
        .replace("∶", ":")
        .replace("比", ":")
        .replace("／", "/")
        .replace("/", ":")
    )
    ratio_match = re.search(r"(?<!\d)(1|2|3|4|9|16)\s*:\s*(1|2|3|4|9|16)(?!\d)", normalized)
    if not ratio_match:
        return ""
    ratio = f"{int(ratio_match.group(1))}:{int(ratio_match.group(2))}"
    options = CHAT_RATIO_SIZE_OPTIONS.get(ratio)
    if not options:
        return ""
    width, height = parse_size_pair(current_size)
    wants_4k = bool(re.search(r"(?i)\b4\s*k\b|4K|超清|超高分辨率", text))
    wants_2k = bool(re.search(r"(?i)\b2\s*k\b|2K|高清|高分辨率", text))
    long_edge = max(width, height)
    if wants_4k or long_edge >= 2400:
        return options[2] if len(options) > 2 else options[-1]
    if wants_2k or long_edge >= 1500:
        return options[1] if len(options) > 1 else options[0]
    return options[0]


def is_gpt_image_2_model(model):
    raw = str(model or "").strip().lower()
    normalized = re.sub(r"[^a-z0-9]+", "-", raw).strip("-")
    compact = re.sub(r"[^a-z0-9]+", "", raw)
    return (
        normalized == "gpt-image-2"
        or normalized.startswith("gpt-image-2-")
        or normalized.endswith("-gpt-image-2")
        or "-gpt-image-2-" in normalized
        or compact == "gptimage2"
        or compact.startswith("gptimage2")
        or compact.endswith("gptimage2")
    )


def normalize_gpt_image_2_size(size, *, parse_size_pair, GPT_IMAGE2_MAX_EDGE, GPT_IMAGE2_MAX_PIXELS, GPT_IMAGE2_MIN_PIXELS):
    width, height = parse_size_pair(size)
    if not width or not height:
        return size or "auto"
    # 已在 GPT 支持范围内（长边≤3840 且 总像素≤约829万）的尺寸原样返回，不做任何改动。
    if max(width, height) <= GPT_IMAGE2_MAX_EDGE and width * height <= GPT_IMAGE2_MAX_PIXELS:
        return f"{width}x{height}"
    # 超限时按比例等比缩小到 GPT 上限，保持原始宽高比（例如 4096x4096 → ~2864x2864，仍是 1:1）。
    ratio = width / height
    if ratio > 3:
        width = height * 3
    elif ratio < 1 / 3:
        height = width * 3
    scale = min(
        1.0,
        GPT_IMAGE2_MAX_EDGE / max(width, height),
        (GPT_IMAGE2_MAX_PIXELS / max(1, width * height)) ** 0.5,
    )
    width = max(16, int((width * scale) // 16) * 16)
    height = max(16, int((height * scale) // 16) * 16)
    if width * height < GPT_IMAGE2_MIN_PIXELS:
        grow = (GPT_IMAGE2_MIN_PIXELS / max(1, width * height)) ** 0.5
        width = int((width * grow + 15) // 16) * 16
        height = int((height * grow + 15) // 16) * 16
    return f"{width}x{height}"


def gpt_image_2_size_error_message(size, *, parse_size_pair):
    width, height = parse_size_pair(size)
    display_size = size or "未指定"
    return (
        f"GPT-Image-2 不支持当前尺寸 {display_size}：它有最大像素限制"
        "（长边最大 3840、总像素约 829 万）。请改用更小的尺寸，"
        "或切换到 nano-banana 生成更高分辨率。"
    )


def gpt_image_2_size_exceeds_supported(size, *, parse_size_pair, GPT_IMAGE2_MAX_EDGE, GPT_IMAGE2_MAX_PIXELS):
    width, height = parse_size_pair(size)
    return bool(width and height and (max(width, height) > GPT_IMAGE2_MAX_EDGE or width * height > GPT_IMAGE2_MAX_PIXELS))


def apimart_size_resolution(size, *, parse_size_pair):
    width, height = parse_size_pair(size)
    if not width or not height:
        raw = str(size or "").strip().lower()
        if raw in {"1k", "2k", "4k"}:
            return "1:1", raw
        if re.fullmatch(r"(auto|\d+\s*:\s*\d+)", raw):
            return raw.replace(" ", ""), "1k"
        return "1:1", "1k"
    long_edge = max(width, height)
    pixels = width * height
    if long_edge >= 3000 or pixels > 4_500_000:
        resolution = "4k"
    elif long_edge >= 1800 or pixels > 1_800_000:
        resolution = "2k"
    else:
        resolution = "1k"
    common = [
        (1, 1, "1:1"), (3, 2, "3:2"), (2, 3, "2:3"), (4, 3, "4:3"), (3, 4, "3:4"),
        (5, 4, "5:4"), (4, 5, "4:5"), (16, 9, "16:9"), (9, 16, "9:16"),
        (2, 1, "2:1"), (1, 2, "1:2"), (3, 1, "3:1"), (1, 3, "1:3"),
        (21, 9, "21:9"), (9, 21, "9:21"),
    ]
    ratio = width / height
    best = min(common, key=lambda item: abs(ratio - item[0] / item[1]))
    return best[2], resolution


def is_volcengine_seedream_model(model):
    value = str(model or "").strip().lower()
    return "seedream" in value or "doubao-seedream" in value


def normalize_volcengine_size(size, model="", *, parse_size_pair, is_volcengine_seedream_model, VOLCENGINE_RATIO_CHOICES, VOLCENGINE_MIN_PIXELS, VOLCENGINE_MIN_EDGE, VOLCENGINE_MAX_EDGE):
    width, height = parse_size_pair(size)
    raw = str(size or "").strip().lower()
    if not width or not height:
        if raw == "4k":
            return "4096x4096"
        if raw == "2k":
            return "2048x2048"
        return "2048x2048" if is_volcengine_seedream_model(model) else (size or "1024x1024")
    if not is_volcengine_seedream_model(model):
        return f"{width}x{height}"
    ratio = width / max(1, height)
    best_ratio = min(VOLCENGINE_RATIO_CHOICES, key=lambda item: abs(ratio - item[0] / item[1]))
    rw, rh = best_ratio[0], best_ratio[1]
    scale = max(
        (VOLCENGINE_MIN_PIXELS / max(1, rw * rh)) ** 0.5,
        VOLCENGINE_MIN_EDGE / max(1, min(rw, rh)),
    )
    target_w = rw * scale
    target_h = rh * scale
    cap = min(1.0, VOLCENGINE_MAX_EDGE / max(target_w, target_h))
    target_w *= cap
    target_h *= cap
    snapped_w = max(64, int(target_w // 16) * 16)
    snapped_h = max(64, int(target_h // 16) * 16)
    while snapped_w * snapped_h < VOLCENGINE_MIN_PIXELS:
        if snapped_w <= snapped_h:
            snapped_w += 16
        else:
            snapped_h += 16
        if max(snapped_w, snapped_h) > VOLCENGINE_MAX_EDGE:
            break
    return f"{snapped_w}x{snapped_h}"

