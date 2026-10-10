"""普通魔搭节点原模型/LoRA选择的只读合同；不生成、不代选模型。"""
from __future__ import annotations

import hashlib
import json
import math
import re

from fastapi import HTTPException
from backend.canvas_assistant_lora import prepare_lora_patch

# 对应 canvas.js 的 MS_GEN_MODELS；实际请求仍由原生运行入口组织。
MODELS = {
    'zimage': {'model': 'Tongyi-MAI/Z-Image-Turbo', 'endpoint': '/generate',
               'requiresImages': False, 'acceptsImages': False},
    'qwen_edit': {'model': 'Qwen/Qwen-Image-Edit-2511', 'endpoint': '/api/angle/generate',
                  'requiresImages': True, 'acceptsImages': True},
    'klein_edit': {'model': 'black-forest-labs/FLUX.2-klein-9B', 'endpoint': '/api/ms/generate',
                   'requiresImages': True, 'acceptsImages': True},
    'custom': {'model': None, 'endpoint': '/api/ms/generate',
               'requiresImages': False, 'acceptsImages': True},
}
CUSTOM_BUILTINS = frozenset({MODELS['zimage']['model'], MODELS['klein_edit']['model']})


def msgen_size(node):
    from backend.canvas_assistant_generation import SIZE_CHOICES
    resolution=node.get('msResolution') or '1k';ratio=node.get('msRatio') or 'square'
    if resolution=='custom':
        value=str(node.get('msCustomSize') or '')
        match=re.fullmatch(r'(\d+)x(\d+)',value)
        if not match or any(not 64<=int(v)<=8192 for v in match.groups()):_error('魔搭自定义尺寸无效，请先在原节点核对')
        return value
    index={'1k':0,'2k':1,'4k':2}.get(resolution)
    if index is None:_error('魔搭分辨率不在原生目录')
    if ratio in {'custom','source'}:
        match=re.fullmatch(r'(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)',str(node.get('msCustomRatio') or ''))
        if not match or any(float(v)<=0 for v in match.groups()):_error('魔搭自定义比例无效')
        value=float(match[1])/float(match[2]);long_side=[1536,2048,3840][index];limit=[1572864,4194304,8294400][index]
        width=long_side if value>=1 else min(long_side*value,math.sqrt(limit*value))
        height=min(long_side/value,math.sqrt(limit/value)) if value>=1 else long_side
        return f'{max(64,math.floor(width/16)*16)}x{max(64,math.floor(height/16)*16)}'
    return SIZE_CHOICES.get(ratio,SIZE_CHOICES['square'])[index]


def _error(message):
    raise HTTPException(409, message)


def prepare_msgen_run_config(node, providers, *, image_count, max_calls=1):
    """只检验当前显式模型、参考图要求、单任务预算及已绑定LoRA。

    image_count 来自服务端读取的实际上游图片，不能使用模型自报数目。
    输入/尺寸/源归属/canvasHash、唯一原输出、readonly/busy门禁仍归调用方。
    旧手动 runMsGenNode 支持多任务；助手首轮只开放count=1/max_calls=1。
    """
    if not isinstance(node, dict) or node.get('type') != 'msgen':
        _error('当前节点不是普通魔搭生成节点')
    key = node.get('msgenModel')
    if not isinstance(key, str) or key not in MODELS:
        _error('请先在原魔搭节点明确选择模型页签，助手不代选默认模型')
    if type(node.get('count')) is not int or node['count'] != 1 or type(max_calls) is not int or max_calls != 1:
        _error('魔搭助手首轮只开放一次原任务，请先在原节点设置数量为1')
    if type(image_count) is not int or not 0 <= image_count <= 20:
        _error('魔搭参考图须来自已读取的原生图片输入，最多20张')
    if not isinstance(providers, (list, tuple)):
        _error('魔搭平台配置目录无效')
    matches = [p for p in providers if isinstance(p, dict) and p.get('id') == 'modelscope']
    if len(matches) != 1 or matches[0].get('enabled') is False:
        _error('魔搭平台未启用或配置标识重复，请先核对API设置')
    provider = matches[0]
    configured = provider.get('image_models', [])
    if not isinstance(configured, list) or any(not isinstance(m, str) for m in configured):
        _error('魔搭公开图片模型目录无效')
    model = MODELS[key]['model']
    if key == 'custom':
        model = node.get('msCustomModel')
        if not isinstance(model, str) or not model.strip() or len(model) > 180:
            _error('请先在原节点手动选择魔搭自定义模型')
        model = model.strip()
        if model not in set(m.strip() for m in configured) | CUSTOM_BUILTINS:
            _error('原自定义模型已不在当前平台目录，请重新手动确认选择')
    settings = {'provider': 'modelscope', 'modelKey': key, 'model': model,
                'endpoint': MODELS[key]['endpoint'], 'requiresImages': MODELS[key]['requiresImages'],
                'acceptsImages': MODELS[key]['acceptsImages'], 'maxCalls': 1, 'count': 1,
                'usedImageCount': image_count if MODELS[key]['acceptsImages'] else 0}
    settings['size']=msgen_size(node)
    if settings['requiresImages'] and image_count == 0:
        _error('当前魔搭编辑模型须连接至少一张图片')
    enabled = node.get('msLoraEnabled', False)
    if type(enabled) is not bool:
        _error('原魔搭LoRA开启状态无效')
    lora_hash = None
    if enabled:
        # 原run可处理遗留的内置模型LoRA；复用同一目录/强度合同，不改真实节点页签。
        projected = {**node, 'msgenModel': 'custom', 'msCustomModel': model}
        patch = prepare_lora_patch(projected, {'msLoraEnabled': True}, providers)
        settings['loras'] = {patch['effectFields']['msLoraId']: patch['effectFields']['msLoraStrength']}
        lora_hash = patch['configurationHash']
    else:
        settings['loras'] = None
    # 仅公开生效配置进入摘要；不暴露或保存key/env_key/个人备注。
    public_config = {'provider': 'modelscope', 'enabled': provider.get('enabled', True),
                     'imageModels': configured, 'loraConfigurationHash': lora_hash, 'settings': settings}
    try:
        serialized = json.dumps(public_config, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
    except (TypeError, ValueError, OverflowError):
        _error('魔搭公开配置无法稳定保存，请核对API设置')
    settings['configurationHash'] = hashlib.sha256(serialized.encode('utf-8')).hexdigest()
    return settings


def validate_msgen_run_config(node, providers, configuration_hash, *, image_count, max_calls=1):
    current = prepare_msgen_run_config(node, providers, image_count=image_count, max_calls=max_calls)
    if current['configurationHash'] != configuration_hash:
        _error('魔搭模型、参考图范围或LoRA配置已变化，请重新规划')
    return current
