"""纯音频节点规则：参数归一化、结果校验、引用摘要和旧节点迁移。"""

from __future__ import annotations

import mimetypes
import posixpath
import re
from copy import deepcopy
from typing import Any, Mapping, Sequence
from urllib.parse import urlparse


class AudioConfigError(ValueError):
    """音频模型或参数配置不满足当前 provider 能力。"""


class AudioResultError(ValueError):
    """供应商响应没有返回可用的音频结果。"""


def build_audio_recognition_request(provider, model, settings):
    if provider.get('protocol', 'openai') != 'openai':
        raise AudioConfigError('音频识别需要 OpenAI 兼容转写协议，请核对 API 配置')
    if model not in (provider.get('audio_models') or []):
        raise AudioConfigError('请选择已配置的音频识别模型')
    base = str(provider.get('base_url') or '').rstrip('/')
    if not base.startswith(('https://', 'http://')):
        raise AudioConfigError('音频平台地址未配置')
    fields = {'model': model, 'response_format': 'json'}
    language = str(settings.get('audioLanguage') or '').strip()
    if language:
        if not re.fullmatch(r'[a-z]{2,3}(?:-[A-Za-z]{2,4})?', language):
            raise AudioConfigError('识别语言格式无效')
        fields['language'] = language
    return base + ('' if base.endswith('/v1') else '/v1') + '/audio/transcriptions', fields


def validate_recognition_references(references):
    if len(references) != 1 or references[0].get('kind') != 'audio':
        raise AudioConfigError('音频识别需要连接一个音频素材；其他素材请在下游继续使用')
    if not validate_audio_reference_url(references[0].get('url')):
        raise AudioConfigError('音频素材地址无效，请重新导入')


def audio_text_result(payload):
    text = payload.get('text') if isinstance(payload, Mapping) else None
    if not isinstance(text, str) or not text.strip():
        raise AudioResultError('识别模型没有返回有效文字，请检查音频与模型配置')
    return {'text': text.strip(), 'kind': 'text'}


_AUDIO_FORMATS = ("mp3", "wav", "opus", "aac", "flac", "pcm")
_AUDIO_EXTENSIONS = {fmt: f"audio/{'mpeg' if fmt == 'mp3' else fmt}" for fmt in _AUDIO_FORMATS}
_AUDIO_EXTENSIONS["m4a"] = "audio/mp4"
_AUDIO_EXTENSIONS["ogg"] = "audio/ogg"


def _text(value: Any) -> str:
    return str(value or "").strip()


def _number(value: Any, default: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return number if number == number else default


def _bounded(value: Any, default: float, minimum: float, maximum: float) -> str:
    number = float(max(minimum, min(maximum, _number(value, default))))
    if number.is_integer():
        return str(int(number))
    return f"{number:.2f}".rstrip("0").rstrip(".")


def audio_capabilities(provider: Mapping[str, Any]) -> dict[str, Any]:
    protocol = _text(provider.get("audio_generation_protocol")) or "openai-speech"
    if protocol not in {"openai-speech", "minimax-speech", "minimax-music"}:
        raise AudioConfigError("不支持当前音频生成协议")
    minimax = protocol == "minimax-speech"
    music = protocol == "minimax-music"
    voices = [_text(item) for item in (provider.get("audio_generation_voices") or []) if _text(item)]
    if not voices and not music:
        voices = ["male-qn-qingse"] if minimax else ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse", "marin", "cedar"]
    return {"protocol": protocol, "voices": voices,
            "formats": ["mp3", "wav", "flac"] if minimax or music else ["mp3", "wav", "opus", "aac", "flac"],
            "speed_range": [0.5, 2] if minimax else [0.25, 4],
            "speed": not music, "pitch": minimax, "volume": minimax,
            "instructions": bool(provider.get("audio_generation_instructions")) and not minimax and not music,
            "music": music, "reference_audio": False}


def build_audio_request(provider: Mapping[str, Any], model: str, prompt: str, values: Mapping[str, Any], references=()) -> tuple[str, dict[str, Any]]:
    settings = normalize_audio_settings(model, provider, values)
    if not _text(prompt):
        raise AudioConfigError("请填写台词或音乐描述，或连接提示词节点")
    if references:
        raise AudioConfigError("当前音频生成协议不支持参考音频；参考素材可连接到支持音频的 API 视频或工作流节点")
    capabilities = audio_capabilities(provider)
    base = _text(provider.get("base_url")).rstrip("/")
    if not base.startswith(("https://", "http://")):
        raise AudioConfigError("音频平台地址未配置")
    if capabilities["protocol"] == "openai-speech":
        body = {"model": model, "input": _text(prompt), "voice": settings["audioVoice"],
                "response_format": settings["audioFormat"], "speed": float(settings["audioSpeed"])}
        if settings["audioInstructions"]:
            body["instructions"] = settings["audioInstructions"]
        return base + ("" if base.endswith("/v1") else "/v1") + "/audio/speech", body
    root = base[:-3] if base.endswith("/v1") else base
    audio_setting = {"format": settings["audioFormat"], "sample_rate": 32000, "bitrate": 128000}
    if capabilities["music"]:
        return root + "/v1/music_generation", {"model": model, "prompt": _text(prompt),
                "lyrics": _text(values.get("audioLyrics")), "output_format": "hex", "audio_setting": audio_setting}
    return root + "/v1/t2a_v2", {"model": model, "text": _text(prompt), "stream": False,
            "voice_setting": {"voice_id": settings["audioVoice"], "speed": float(settings["audioSpeed"]),
                              "pitch": int(float(settings["audioPitch"])), "vol": float(settings["audioVolume"])},
            "audio_setting": audio_setting, "output_format": "hex"}


def validate_audio_bytes(data: bytes, fmt: str) -> None:
    """拒绝空响应、JSON/HTML假音频和与容器不匹配的内容。"""
    signatures = {"wav": lambda b: b[:4] == b"RIFF" and b[8:12] == b"WAVE",
                  "mp3": lambda b: b[:3] == b"ID3" or (b[0] == 255 and b[1] & 224 == 224),
                  "flac": lambda b: b[:4] == b"fLaC", "opus": lambda b: b[:4] == b"OggS",
                  "aac": lambda b: b[0] == 255 and b[1] & 246 == 240}
    if len(data) < 12 or len(data) > 100 * 1024 * 1024 or not signatures.get(fmt, lambda _: False)(data):
        raise AudioResultError("供应商没有返回有效音频文件，请核对模型、格式及平台协议")


def normalize_audio_settings(model: str, provider: Mapping[str, Any], values: Mapping[str, Any] | None = None) -> dict[str, str]:
    """按 provider 已配置能力生成可保存、可提交的音频设置。"""

    selected_model = _text(model)
    configured = {_text(item) for item in (provider.get("audio_generation_models") or []) if _text(item)}
    if not selected_model or selected_model not in configured:
        raise AudioConfigError("请选择已配置的音频模型")
    values = values or {}
    profile = audio_capabilities(provider)
    voices = [
        _text(item.get("value") if isinstance(item, Mapping) else item)
        for item in (profile.get("voices") or [])
        if _text(item.get("value") if isinstance(item, Mapping) else item)
    ]
    formats = [
        _text(item).lower()
        for item in (profile.get("formats") or _AUDIO_FORMATS)
        if _text(item)
    ]
    if not formats:
        formats = list(_AUDIO_FORMATS)
    requested_voice = _text(values.get("audioVoice"))
    requested_format = _text(values.get("audioFormat")).lower()
    return {
        "model": selected_model,
        "audioVoice": requested_voice if requested_voice in voices else (voices[0] if voices else "alloy"),
        "audioFormat": requested_format if requested_format in formats else ("mp3" if "mp3" in formats else formats[0]),
        "audioSpeed": _bounded(values.get("audioSpeed"), 1, *profile["speed_range"]),
        "audioPitch": _bounded(values.get("audioPitch"), 0, -12, 12) if profile["pitch"] else "0",
        "audioVolume": _bounded(values.get("audioVolume"), 1, 0, 10) if profile["volume"] else "1",
        "audioInstructions": _text(values.get("audioInstructions"))[:2000] if profile["instructions"] else "",
    }


def validate_audio_reference_url(value: str) -> bool:
    """只接受项目媒体路径、asset URI 或 HTTPS/HTTP URL。"""

    url = _text(value)
    if not url or "\x00" in url:
        return False
    parsed = urlparse(url)
    if parsed.scheme in {"http", "https", "asset"}:
        return bool(parsed.netloc or parsed.scheme == "asset")
    if parsed.scheme or re.match(r"^[A-Za-z]:[\\/]|^\\\\", url):
        return False
    from urllib.parse import unquote
    path = unquote(parsed.path)
    return path.startswith(("/assets/", "/output/", "/api/storage-files/")) and "\\" not in path and ".." not in path.split("/")


def audio_input_summary(prompt: str, references: Sequence[Mapping[str, Any]] | None) -> dict[str, Any]:
    ids: list[str] = []
    for reference in references or []:
        if not isinstance(reference, Mapping) or _text(reference.get("kind")).lower() != "audio":
            continue
        identifier = _text(reference.get("id"))
        url = _text(reference.get("url"))
        if identifier and url and validate_audio_reference_url(url) and identifier not in ids:
            ids.append(identifier)
    return {"prompt": _text(prompt)[:4000], "reference_audio_ids": ids[:3], "reference_audio_count": min(3, len(ids))}


def _audio_url_item(payload: Any) -> tuple[str, str, str] | None:
    if isinstance(payload, str):
        return (_text(payload), "", "") if _text(payload) else None
    if not isinstance(payload, Mapping):
        return None
    url = _text(payload.get("url") or payload.get("audio_url") or payload.get("uri"))
    if not url:
        return None
    return url, _text(payload.get("name") or payload.get("filename")), _text(payload.get("mime") or payload.get("mime_type") or payload.get("content_type"))


def _first_audio_item(payload: Mapping[str, Any]) -> tuple[str, str, str] | None:
    candidates: list[Any] = []
    for key in ("audios", "audio", "outputs", "items", "data", "result"):
        value = payload.get(key)
        if isinstance(value, list):
            candidates.extend(value)
        elif value is not None:
            candidates.append(value)
    for value in candidates:
        item = _audio_url_item(value)
        if item:
            return item
    return None


def _audio_mime(url: str, supplied: str, fmt: str = "") -> str:
    if supplied.startswith("audio/"):
        return supplied
    suffix = posixpath.splitext(urlparse(url).path)[1].lower().lstrip(".")
    return _AUDIO_EXTENSIONS.get(suffix) or _AUDIO_EXTENSIONS.get(fmt.lower()) or mimetypes.guess_type(url)[0] or "audio/mpeg"


def audio_result_from_payload(payload: Mapping[str, Any], *, task_id: str, provider_id: str, model: str) -> dict[str, Any]:
    item = _first_audio_item(payload)
    if not item:
        raise AudioResultError("音频任务完成但没有返回真实音频")
    url, name, mime = item
    if not validate_audio_reference_url(url):
        raise AudioResultError("音频任务返回了不可用的媒体地址")
    filename = name or posixpath.basename(urlparse(url).path) or f"audio-{task_id}.mp3"
    return {
        "kind": "audio",
        "url": url,
        "name": filename,
        "mime": _audio_mime(url, mime),
        "task_id": _text(task_id),
        "provider_id": _text(provider_id),
        "model": _text(model),
    }


def migrate_audio_node(node: Mapping[str, Any]) -> dict[str, Any]:
    """把旧 image+mediaKind=audio 形状转换成可保存的新素材节点。"""

    value = deepcopy(dict(node))
    is_audio = _text(value.get("type")) == "audio" or (
        _text(value.get("type")) == "image" and _text(value.get("mediaKind")).lower() == "audio"
    )
    if not is_audio:
        return value
    value["type"] = "audio"
    value.pop("mediaKind", None)
    value.setdefault("source", "upload")
    value.setdefault("mime", _audio_mime(_text(value.get("url")), _text(value.get("mime"))))
    value.setdefault("name", "音频素材")
    value.setdefault("inputs", [])
    return value
