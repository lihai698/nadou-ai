"""普通 Modelscope 节点的 LoRA 编辑合同；只读校验，不选择模型或调用服务。"""
from __future__ import annotations

import hashlib
import json
import math

from fastapi import HTTPException

LORA_FIELDS = frozenset({'msLoraEnabled', 'msLoraId', 'msLoraStrength'})
STRENGTH_MIN = 0.1
STRENGTH_MAX = 1.0
STRENGTH_STEP = 0.05


def _error(message, status=422):
    raise HTTPException(status, message)


def _selected_model(node):
    # LoRA 控件只位于普通 msgen 的“自定义”页签；不改写原手选模型。
    if not isinstance(node, dict) or node.get('type') != 'msgen' or node.get('msgenModel') != 'custom':
        _error('LoRA 编辑只开放普通 Modelscope 节点已手选的自定义模型', 409)
    model = node.get('msCustomModel')
    if not isinstance(model, str) or not model.strip() or len(model) > 180:
        _error('请先在原节点手动选择自定义模型，助手不代选默认模型', 409)
    return model.strip()


def _valid_strength(value):
    if type(value) not in {int, float}:
        _error('LoRA 强度必须是有限数值')
    try:
        finite = math.isfinite(value)
    except OverflowError:
        finite = False
    if not finite:
        _error('LoRA 强度必须是有限数值')
    if not STRENGTH_MIN <= value <= STRENGTH_MAX:
        _error('LoRA 强度须在原生控件的0.1至1.0范围内')
    steps = (value - STRENGTH_MIN) / STRENGTH_STEP
    if abs(steps - round(steps)) > 1e-8:
        _error('LoRA 强度须按原生控件的0.05步长设置')
    return round(float(value), 2)


def read_lora_catalog(node, providers):
    """读取手选模型对应的公开目录，屏蔽凭据、备注和其它模型的 LoRA。"""
    model = _selected_model(node)
    providers = [] if providers is None else providers
    if not isinstance(providers, (list, tuple)):
        _error('Modelscope 平台目录无效', 409)
    matches = [p for p in providers if isinstance(p, dict) and p.get('id') == 'modelscope']
    if len(matches) > 1:
        _error('Modelscope 平台配置有重复标识，请先核对配置', 409)
    values = matches[0].get('ms_loras', []) if matches else []
    if not isinstance(values, list):
        _error('Modelscope LoRA 目录无效，请先核对配置', 409)
    loras = []
    seen = set()
    for entry in values:
        if not isinstance(entry, dict) or entry.get('enabled') is False:
            continue
        target = entry.get('target_model') or entry.get('model') or ''
        lora_id = entry.get('id')
        if not isinstance(target, str) or target.strip() != model or not isinstance(lora_id, str) or not lora_id.strip():
            continue
        lora_id = lora_id.strip()
        if len(lora_id) > 180:
            _error('当前模型 LoRA 标识超出平台配置范围', 409)
        if lora_id in seen:
            _error('当前模型 LoRA 标识重复，请先核对配置', 409)
        seen.add(lora_id)
        default = entry.get('strength', entry.get('default_strength', 0.8))
        try:
            default = float(default) if not isinstance(default, bool) else math.nan
        except (TypeError, ValueError, OverflowError):
            default = math.nan
        # 后台配置允许0..2，不能把这个范围当成节点编辑范围。
        # 不可用默认值保持可见为None；明确指定合法强度仍可使用此LoRA。
        default = default if math.isfinite(default) else None
        name = entry.get('name')
        name = name.strip()[:80] if isinstance(name, str) and name.strip() else lora_id
        loras.append({'id': lora_id, 'name': name, 'defaultStrength': default})
    catalog = {'nodeId': node.get('id'), 'nodeType': 'msgen', 'model': model,
               'fields': sorted(LORA_FIELDS), 'loras': loras,
               'strengthLimits': {'min': STRENGTH_MIN, 'max': STRENGTH_MAX, 'step': STRENGTH_STEP}}
    catalog['configurationHash'] = hashlib.sha256(
        json.dumps(catalog, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')
    ).hexdigest()
    return catalog


def prepare_lora_patch(node, patch, providers):
    """返回规范化patch、完整effectFields及配置摘要；输入节点和配置均不写入。"""
    catalog = read_lora_catalog(node, providers)
    if not isinstance(patch, dict) or not patch or set(patch) - LORA_FIELDS:
        _error('LoRA 编辑只接受开启、已配置编号和强度字段')
    normalized = dict(patch)
    if 'msLoraEnabled' in patch and type(patch['msLoraEnabled']) is not bool:
        _error('LoRA 开启状态必须为布尔值')
    if 'msLoraId' in patch:
        value = patch['msLoraId']
        if not isinstance(value, str) or not value.strip() or len(value) > 180:
            _error('LoRA 编号须来自当前模型目录')
        normalized['msLoraId'] = value.strip()
    if 'msLoraStrength' in patch:
        normalized['msLoraStrength'] = _valid_strength(patch['msLoraStrength'])
    enabled = normalized.get('msLoraEnabled', node.get('msLoraEnabled', False))
    if type(enabled) is not bool:
        _error('原节点 LoRA 开启状态无效，请先核对原控件', 409)
    if not enabled:
        if set(normalized) != {'msLoraEnabled'}:
            _error('请先明确开启LoRA，再修改编号或强度；关闭时保留原选择', 409)
        effects = {'msLoraEnabled': False}
    else:
        lora_id = normalized.get('msLoraId', node.get('msLoraId'))
        selected = next((l for l in catalog['loras'] if l['id'] == lora_id), None)
        if not selected:
            _error('原LoRA编号不属于当前模型有效目录，请明确选择编号；助手不代选第一项', 409)
        # 原下拉切换LoRA使用新项默认强度，滑块明确修改时优先使用指定强度。
        if 'msLoraStrength' in normalized:
            strength = normalized['msLoraStrength']
        elif 'msLoraId' in normalized or node.get('msLoraStrength') is None:
            strength = selected['defaultStrength']
        else:
            strength = node['msLoraStrength']
        strength = _valid_strength(strength)
        effects = {**normalized, 'msLoraId': selected['id'], 'msLoraStrength': strength}
    return {'patch': normalized, 'effectFields': effects, 'model': catalog['model'],
            'configurationHash': catalog['configurationHash']}


def validate_lora_snapshot(node, patch, providers, configuration_hash):
    """确认和执行前重读目录，拒绝模型/LoRA/默认强度/目录顺序变化。"""
    fresh = prepare_lora_patch(node, patch, providers)
    if fresh['configurationHash'] != configuration_hash:
        _error('当前模型或LoRA配置已变化，请重新读取后规划', 409)
    return fresh
