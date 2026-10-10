"""原生 Midjourney 首次运行配置合同；不提交、查询或自动追加续作任务。"""
from __future__ import annotations

import hashlib
import json
import re

from fastapi import HTTPException

VERSIONS = frozenset({'8.2', '8.1', '7', '6.1', '5.2', '5.1'})
SPEEDS = frozenset({'relax', 'fast', 'turbo'})
MODES = frozenset({'imagine', 'blend', 'edit'})
APIMART_FRONTEND_URL = re.compile(r'(^|\.)apimart\.ai(?:/|$)', re.I)


def _error(message):
    raise HTTPException(409, message)


def prepare_midjourney_run_config(node, providers, *, reference_count, has_prompt, max_calls=1):
    """服务端先读取上游，再注入图片数/正文存在状态；不接受模型自报。

    与当前 midjourneyApiProviders 使用同一平台筛选，精确保留原apiProvider。
    原 count 控件未进入运行循环，一个上游任务可能返回网格/多图，不扩大POST预算。
    本合同不替代原输入hash、唯一输出、权限/忙碌门禁及任务受理持久保存。
    """
    if not isinstance(node, dict) or node.get('type') != 'midjourney':
        _error('当前节点不是普通Midjourney节点')
    provider_id = node.get('apiProvider')
    if not isinstance(provider_id, str) or not provider_id.strip():
        _error('请先在原节点手动选择Midjourney平台，助手不代选首个平台')
    if not isinstance(providers, (list, tuple)):
        _error('Midjourney平台目录无效')
    matches = [p for p in providers if isinstance(p, dict) and p.get('id') == provider_id]
    if len(matches) != 1 or matches[0].get('enabled') is False:
        _error('原Midjourney平台未启用、已不存在或编号重复')
    provider = matches[0]
    protocol = str(provider.get('protocol') or '').lower()
    if protocol != 'apimart' and not APIMART_FRONTEND_URL.search(str(provider.get('base_url') or '')):
        _error('原Midjourney平台已不属于当前APIMart目录，请手动核对选择')
    mode, speed, version, size = [node.get(k) for k in ('mode', 'speed', 'version', 'size')]
    if not isinstance(mode, str) or mode not in MODES:
        _error('请先在原节点明确选择文生图、多图融合或图片编辑模式')
    if not isinstance(speed, str) or speed not in SPEEDS:
        _error('原Midjourney速度不在relax/fast/turbo范围')
    if not isinstance(version, str) or version not in VERSIONS:
        _error('原Midjourney版本不在当前原生版本目录，请重新手动选择')
    if not isinstance(size, str) or not re.fullmatch(r'[1-9]\d?:[1-9]\d?', size):
        _error('原Midjourney画幅须为有效的宽:高，不代用默认画幅')
    if type(max_calls) is not int or max_calls != 1:
        _error('Midjourney一次原生运行只开放一个新任务，续作须另行确认')
    if type(reference_count) is not int or not 0 <= reference_count <= 20 or type(has_prompt) is not bool:
        _error('须先读取当前画布实际图片输入和提示词，不能自报范围')
    if mode == 'blend' and not 2 <= reference_count <= 4:
        _error('Midjourney多图融合须连接2至4张图片')
    if mode != 'blend' and not has_prompt:
        _error('当前Midjourney模式须有实际提示词')
    if mode == 'edit' and not reference_count:
        _error('Midjourney图片编辑须连接至少一张图片')
    settings = {'provider': provider_id, 'model': f'midjourney-v{version}' if mode == 'imagine' else 'midjourney',
                'mode': mode, 'size': size, 'version': version, 'effectiveVersion': version if mode == 'imagine' else None,
                'speed': speed, 'maxCalls': 1, 'referenceCount': reference_count,
                'usedImageCount': min(reference_count, 4), 'ignoredImageCount': max(0, reference_count - 4),
                'endpoint': '/api/midjourney/submit', 'queryEndpoint': '/api/midjourney/tasks/{task_id}',
                'supplierPath': {'imagine': '/v1/midjourney/generations', 'blend': '/v1/midjourney/generations/blend',
                                 'edit': '/v1/midjourney/generations/edits'}[mode]}
    # 官方固定host；个人base_url仅用于是否属于原生目录，不加入执行地址或泄露凭据。
    public_config = {'settings': settings, 'hasPrompt': has_prompt, 'platformProtocol': protocol}
    serialized = json.dumps(public_config, sort_keys=True, ensure_ascii=False, separators=(',', ':'))
    settings['configurationHash'] = hashlib.sha256(serialized.encode('utf-8')).hexdigest()
    return settings


def validate_midjourney_run_config(node, providers, configuration_hash, *, reference_count, has_prompt, max_calls=1):
    current = prepare_midjourney_run_config(node, providers, reference_count=reference_count,
                                           has_prompt=has_prompt, max_calls=max_calls)
    if current['configurationHash'] != configuration_hash:
        _error('Midjourney平台、原参数或输入范围已变化，请重新规划')
    return current
