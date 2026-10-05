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
