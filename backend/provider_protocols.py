"""供应商和单模型协议规则。

只处理调用方传入的配置值；配置读取、密钥和网络请求仍由应用入口负责。
"""

import re


# 单模型可覆盖的协议（仅 OpenAI / Gemini，二者可共用同一站点的 Base URL + Key）
PER_MODEL_PROTOCOL_OPTIONS = {"openai", "gemini"}
# 协议固定、不支持单模型覆盖的内置平台
FIXED_PROTOCOL_PROVIDER_IDS = {"modelscope", "volcengine", "jimeng", "runninghub"}


def provider_protocol(provider):
    return str((provider or {}).get("protocol") or "openai").strip().lower()


def normalize_model_protocols(value):
    """规整 {模型名: 协议} 覆盖表，仅保留 openai/gemini。"""
    out = {}
    if isinstance(value, dict):
        for raw_name, raw_proto in value.items():
            name = str(raw_name or "").strip()
            proto = str(raw_proto or "").strip().lower()
            if name and proto in PER_MODEL_PROTOCOL_OPTIONS:
                out[name] = proto
    return out


def normalize_model_name_map(value):
    """规整 {模型ID: 展示名}，只保存真正有意义的显示标签。"""
    normalized = {}
    if isinstance(value, dict):
        for raw_model, raw_label in value.items():
            model = str(raw_model or "").strip()
            label = re.sub(r"\s+", " ", str(raw_label or "").strip())[:160]
            if model and label and label != model:
                normalized[model] = label
    return normalized


def effective_protocol(provider, model=""):
    """返回某模型实际生效的协议：优先单模型覆盖，否则用平台全局协议。"""
    base = provider_protocol(provider)
    pid = str((provider or {}).get("id") or "").strip().lower()
    if pid in FIXED_PROTOCOL_PROVIDER_IDS:
        return base
    overrides = (provider or {}).get("model_protocols")
    if isinstance(overrides, dict):
        val = str(overrides.get(str(model or "").strip()) or "").strip().lower()
        if val in PER_MODEL_PROTOCOL_OPTIONS:
            return val
    return base


def looks_like_vision_chat_model(model):
    lc = str(model or "").strip().lower()
    if not lc:
        return False
    vision_keys = [
        "vision", "vl-", "-vl-", "internvl", "qvq", "qwen-vl",
        "doubao-vision", "glm-4v", "minicpm-v",
    ]
    return any(key in lc for key in vision_keys)


def preferred_chat_model(provider, *, CHAT_MODEL, is_volcengine_provider, looks_like_vision_chat_model):
    values = [str(item or "").strip() for item in (provider.get("chat_models") or [CHAT_MODEL])]
    models = [item for item in values if item]
    if not models:
        return CHAT_MODEL
    if is_volcengine_provider(provider):
        endpoint_models = [item for item in models if item.lower().startswith("ep-")]
        if endpoint_models:
            return endpoint_models[0]
        text_like_models = [item for item in models if not looks_like_vision_chat_model(item)]
        if text_like_models:
            return text_like_models[0]
    return models[0]


def is_apimart_provider(provider, *, provider_protocol):
    base_url = str((provider or {}).get("base_url") or "").lower()
    return provider_protocol(provider) == "apimart" or "apimart.ai" in base_url


def detect_image_request_mode(base_url='', models=None):
    base = str(base_url or "").strip().lower()
    if "apihub.agnes-ai.com" in base:
        return "openai-json"
    for model in models or []:
        if str(model or "").strip().lower().startswith("agnes-image-"):
            return "openai-json"
    return ""


def effective_image_request_mode(provider, model='', *, detect_image_request_mode, normalize_image_request_mode):
    detected = detect_image_request_mode((provider or {}).get("base_url"), [model])
    if detected:
        return detected
    return normalize_image_request_mode((provider or {}).get("image_request_mode"))


def is_gemini_provider(provider, *, provider_protocol):
    return provider_protocol(provider) == "gemini"


def is_tudou_provider(provider, *, is_tudou_base_url):
    if not isinstance(provider, dict):
        return False
    return str(provider.get("id") or "").strip().lower() == "tudou" or is_tudou_base_url(provider.get("base_url") or "")


def is_tudou_async_image_mode(provider, model='', *, normalize_image_request_mode, is_tudou_async_image_model):
    return (
        normalize_image_request_mode((provider or {}).get("image_request_mode")) == "tudou-async"
        and (not model or is_tudou_async_image_model(model))
    )


def is_tudou_async_image_model(model):
    return str(model or "").strip().lower().startswith("gpt-image-2")


def is_tudou_grok_image_model(model):
    return str(model or "").strip().lower().startswith("grok-imagine-image")


def is_tudou_grok_video_model(model):
    return str(model or "").strip().lower().startswith("grok-imagine-video")


def is_volcengine_provider(provider, *, provider_protocol):
    return provider_protocol(provider) == "volcengine"


def is_runninghub_provider(provider, *, provider_protocol):
    return provider_protocol(provider) == "runninghub" or str((provider or {}).get("id") or "").strip().lower() == "runninghub"


def is_jimeng_provider(provider, *, provider_protocol):
    return provider_protocol(provider) == "jimeng" or str((provider or {}).get("id") or "").strip().lower() == "jimeng"


def is_codex_provider(provider, *, provider_protocol):
    return provider_protocol(provider) == "codex"


def is_gemini_cli_provider(provider, *, provider_protocol):
    return provider_protocol(provider) == "gemini-cli"


def is_yuli_provider(provider):
    base_url = str((provider or {}).get("base_url") or "").lower()
    return "yuli.host" in base_url


def is_lingjing_provider(provider):
    base_url = str((provider or {}).get("base_url") or "").lower()
    provider_id = str((provider or {}).get("id") or "").strip().lower()
    return provider_id == "lingjing" or "apistudio.vip" in base_url


def is_agnes_provider(provider, model=''):
    base_url = str((provider or {}).get("base_url") or "").lower()
    model_id = str(model or "").strip().lower()
    return "apihub.agnes-ai.com" in base_url or model_id.startswith("agnes-video-")


def avatar_platform_for_provider(provider, *, is_apimart_provider, is_volcengine_provider):
    if not provider:
        return ""
    if is_apimart_provider(provider):
        return "apimart"
    if is_volcengine_provider(provider):
        return "volcengine"
    return ""


def provider_supports_avatar(provider, *, avatar_platform_for_provider, AVATAR_SUPPORTED_PLATFORMS):
    return avatar_platform_for_provider(provider) in AVATAR_SUPPORTED_PLATFORMS
