"""RunningHub 应用/工作流字段排序、默认值与种子约束。"""
import json
import functools
import random
import re

SEED_UINT32_MAX = 4294967295

def rh_field_kind(field):
    field = field or {}
    t = str(field.get("fieldType") or "").strip().upper()
    if t == "IMAGE":
        return "image"
    if t == "VIDEO":
        return "video"
    if t == "AUDIO":
        return "audio"
    if t == "SLIDER":
        return "slider"
    if t in ("NUMBER", "FLOAT", "INTEGER", "INT"):
        return "number"
    if t in ("BOOLEAN", "BOOL"):
        return "boolean"
    key = f"{field.get('fieldName') or ''} {field.get('fieldValue') or ''}".lower()
    if re.search(r"\b(image|img|mask|photo|picture)\b", key) or re.search(r"\.(png|jpe?g|webp|gif|bmp)(\?|$)", key, re.I):
        return "image"
    if re.search(r"\b(video|movie|mp4)\b", key) or re.search(r"\.(mp4|webm|mov|m4v|mkv)(\?|$)", key, re.I):
        return "video"
    if re.search(r"\b(audio|sound|music|voice)\b", key) or re.search(r"\.(mp3|wav|ogg|m4a|flac|aac)(\?|$)", key, re.I):
        return "audio"
    return "text"


def rh_field_role(field):
    kind = rh_field_kind(field)
    if kind in ("image", "video", "audio", "number", "slider", "boolean"):
        return kind
    field = field or {}
    text = f"{field.get('fieldName') or ''} {field.get('label') or ''} {field.get('group') or ''}".lower()
    if re.search(r"prompt|positive|negative|text|caption|description|关键词|提示词|正向|负向", text):
        return "prompt"
    return "text"


def _rh_natural_cmp(x, y):
    if x == y:
        return 0
    if x.isdigit() and y.isdigit():
        ix, iy = int(x), int(y)
        return (ix > iy) - (ix < iy)
    return (x > y) - (x < y)


def _rh_field_cmp(a, b):
    ak, bk = rh_field_kind(a), rh_field_kind(b)
    if ak == "image" and bk == "image":
        try:
            ao = int(a.get("imageOrder") or 0) or 9999
        except Exception:
            ao = 9999
        try:
            bo = int(b.get("imageOrder") or 0) or 9999
        except Exception:
            bo = 9999
        if ao != bo:
            return ao - bo
    if ak == "image" and bk != "image":
        return -1
    if ak != "image" and bk == "image":
        return 1
    node_cmp = _rh_natural_cmp(str(a.get("nodeId") or ""), str(b.get("nodeId") or ""))
    if node_cmp != 0:
        return node_cmp
    fa, fb = str(a.get("fieldName") or ""), str(b.get("fieldName") or "")
    return (fa > fb) - (fa < fb)


def rh_sort_fields(fields):
    return sorted(list(fields or []), key=functools.cmp_to_key(_rh_field_cmp))


def rh_field_indexes(fields):
    counters = {"image": 0, "video": 0, "audio": 0}
    mapping = {}
    for field in rh_sort_fields(fields):
        kind = rh_field_kind(field)
        if kind in counters:
            mapping[(str(field.get("nodeId") or ""), str(field.get("fieldName") or ""))] = counters[kind]
            counters[kind] += 1
    return mapping


def rh_default_value(field):
    value = (field or {}).get("fieldValue")
    if isinstance(value, list):
        value = value[0] if value else ""
    if value is None or isinstance(value, dict):
        return ""
    return str(value)


def rh_is_seed_like_name(*parts) -> bool:
    text = " ".join(str(part or "") for part in parts).lower()
    return any(key in text for key in ("seed", "noise", "随机", "种子", "噪"))


def normalize_seed_uint32(value):
    try:
        if isinstance(value, bool):
            return value
        raw = str(value).strip()
        if not raw:
            return value
        num = int(float(raw))
    except Exception:
        return value
    if 0 <= num <= SEED_UINT32_MAX:
        return value
    safe = ((abs(num) - 1) % SEED_UINT32_MAX) + 1
    return str(safe) if isinstance(value, str) else safe


def sanitize_seed_like_workflow_values(value, parent_key=""):
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            if rh_is_seed_like_name(key) and not isinstance(item, (dict, list)):
                result[key] = normalize_seed_uint32(item)
            else:
                result[key] = sanitize_seed_like_workflow_values(item, key)
        return result
    if isinstance(value, list):
        return [sanitize_seed_like_workflow_values(item, parent_key) for item in value]
    if rh_is_seed_like_name(parent_key):
        return normalize_seed_uint32(value)
    return value


def sanitize_runninghub_node_info_list(items):
    result = []
    for item in items or []:
        if not isinstance(item, dict):
            continue
        clean = dict(item)
        if rh_is_seed_like_name(clean.get("fieldName"), clean.get("label"), clean.get("note")):
            clean["fieldValue"] = normalize_seed_uint32(clean.get("fieldValue"))
        result.append(clean)
    return result


def rh_random_field_value(field):
    def _num(raw, default):
        try:
            s = str(raw).strip()
            if s == "" or s.lower() == "none":
                return default
            return float(s)
        except Exception:
            return default
    looks_seed = rh_is_seed_like_name((field or {}).get("fieldName"), (field or {}).get("label"), (field or {}).get("note"))
    lo = _num((field or {}).get("min"), 0.0)
    hi = _num((field or {}).get("max"), float(SEED_UINT32_MAX) if looks_seed else 999999.0)
    if looks_seed:
        hi = min(hi, float(SEED_UINT32_MAX))
        lo = max(0.0, min(lo, hi))
    if hi < lo:
        lo, hi = hi, lo
    step = _num((field or {}).get("step"), 1.0)
    value = random.uniform(lo, hi)
    if step and step > 0:
        value = lo + round((value - lo) / step) * step
    if float(step).is_integer() and float(lo).is_integer() and float(hi).is_integer():
        return str(int(round(value)))
    return str(value)



def runninghub_infer_workflow_field_type(field_name, field_value):
    key = f"{field_name or ''} {field_value or ''}".lower()
    if re.search(r"\b(image|img|mask|photo|picture)\b", key) or re.search(r"\.(png|jpe?g|webp|gif|bmp)(\?|$)", key, re.I):
        return "IMAGE"
    if re.search(r"\b(video|movie|mp4)\b", key) or re.search(r"\.(mp4|webm|mov|m4v|mkv)(\?|$)", key, re.I):
        return "VIDEO"
    if re.search(r"\b(audio|sound|music|voice)\b", key) or re.search(r"\.(mp3|wav|ogg|m4a|flac|aac)(\?|$)", key, re.I):
        return "AUDIO"
    text = str(field_value or "").strip()
    if text.lower() in {"true", "false"}:
        return "BOOLEAN"
    try:
        if text:
            float(text)
            return "NUMBER"
    except Exception:
        pass
    return "TEXT"


def runninghub_is_workflow_link_value(value):
    return (
        isinstance(value, list)
        and len(value) == 2
        and isinstance(value[0], str)
        and isinstance(value[1], int)
    )


def runninghub_workflow_node_info_list(workflow_json, *, runninghub_infer_workflow_field_type, runninghub_is_workflow_link_value):
    result = []
    if not isinstance(workflow_json, dict):
        return result
    for node_id, node_content in workflow_json.items():
        inputs = node_content.get("inputs") if isinstance(node_content, dict) else None
        if not isinstance(inputs, dict):
            continue
        for field_name, raw_value in inputs.items():
            if runninghub_is_workflow_link_value(raw_value):
                continue
            if isinstance(raw_value, (dict, list)):
                field_value = json.dumps(raw_value, ensure_ascii=False)
            elif raw_value is None:
                field_value = ""
            else:
                field_value = str(raw_value)
            result.append({
                "nodeId": str(node_id),
                "fieldName": str(field_name),
                "fieldValue": field_value,
                "fieldType": runninghub_infer_workflow_field_type(field_name, field_value),
                "source": "workflow",
            })
    return result

