"""原生媒体导出的只读合同。调用方负责保存、权限、忙碌门禁及真实执行。

resolver/probe/binding 必须由服务端注入，不接受模型或浏览器自报的文件证明。
本模块不联网、不下载、不写媒体；计划仅供内部使用，勿整体送入模型上下文。
"""
from __future__ import annotations

import copy
import hashlib
import json
import math
from pathlib import Path
import re
import uuid

from fastapi import HTTPException
from backend.canvas_clip import FPS, MAX_FRAMES

LOCAL_MEDIA = re.compile(r'^/(?:assets/|output/|api/storage-files/)')
TOKEN = re.compile(r'^[a-f0-9]{32}$')


def _error(message, status=409):
    raise HTTPException(status, message)


def _hash(value):
    try:
        raw = json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
    except (ValueError, TypeError, OverflowError):
        _error('媒体范围含无法稳定保存的数据')
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()


def _id(value):
    if not isinstance(value, str) or not value or len(value) > 120 or any(ord(c) < 32 for c in value):
        _error('媒体导出须绑定已保存的画布、节点及片段编号')
    return value


def _number(value, minimum=0, maximum=None, integer=False):
    if type(value) not in {int, float} or integer and type(value) is not int:
        _error('媒体范围须使用原生数值，帧数须为整数')
    try:
        valid = math.isfinite(value) and value >= minimum and (maximum is None or value <= maximum)
    except OverflowError:
        valid = False
    if not valid:
        _error('媒体范围超出原生导出限制')
    return value


def _file(url, resolve_local, allowed_roots, probe):
    if not isinstance(url, str) or len(url) > 8192 or not LOCAL_MEDIA.match(url) or any(ord(c) < 32 for c in url):
        _error('助手媒体导出仅使用当前节点中已保存的本地素材，不接收远程或任意地址')
    try:
        resolved = resolve_local(url)
        if not resolved:
            _error('本地素材已不存在或不属于允许的存储目录')
        path = Path(resolved).resolve(strict=True)
        roots = [Path(root).resolve(strict=True) for root in allowed_roots]
        if not roots or not any(path.is_relative_to(root) for root in roots) or not path.is_file():
            _error('本地素材已不存在或不属于允许的存储目录')
        before = path.stat()
        if before.st_size <= 0:
            _error('本地素材文件为空')
        digest = hashlib.sha256()
        with path.open('rb') as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                digest.update(chunk)
        info = probe(path)
        after = path.stat()
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            _error('素材在核验中变化，请重新规划')
        if not isinstance(info, dict) or not isinstance(info.get('streams'), list) or any(not isinstance(s, dict) for s in info['streams']):
            _error('媒体探测没有返回有效流信息')
        streams = info['streams']
        video = next(s for s in streams if s.get('codec_type') == 'video')
        duration = float(video.get('duration') or info.get('format', {}).get('duration') or 0)
        _number(duration)
        summary = {key: video.get(key) for key in ('codec_name', 'width', 'height', 'pix_fmt', 'r_frame_rate')}
        return {'url': url, 'pathHash': hashlib.sha256(str(path).encode('utf-8')).hexdigest(),
                'size': after.st_size, 'sha256': digest.hexdigest(),
                'mtimeNs': after.st_mtime_ns, 'durationSeconds': duration, 'video': summary,
                'hasAudio': any(s.get('codec_type') == 'audio' for s in streams)}
    except HTTPException:
        raise
    except (OSError, ValueError, TypeError, KeyError, StopIteration, OverflowError):
        _error('本地素材读取或媒体探测失败，请检查原文件')


def prepare_media_export(canvas_id, node, options, resolve_local, allowed_roots, probe, *, request_id=None):
    """从真实保存节点取范围；options 不能注入 URL、clipData、结果或任意文件名。

    clip 的历史源保存在 clipData，本合同不强制已断开的上游节点继续存在。
    request_id 由调用方持久保存。
    """
    canvas_id = _id(canvas_id)
    if not isinstance(node, dict) or not isinstance(node.get('type'), str) or node['type'] not in {'clip'}:
        _error('此节点没有已接入的原生媒体导出入口')
    node_id = _id(node.get('id'))
    if not isinstance(options, dict):
        _error('媒体导出须明确选择范围和去向')
    request_id = uuid.uuid4().hex if request_id is None else request_id
    if not isinstance(request_id, str) or not TOKEN.fullmatch(request_id):
        _error('媒体导出请求编号须为服务端持久保存的32位编号')
    kind = node['type']
    scope, destination = options.get('scope'), options.get('destination')
    sources, expected = [], []
    if kind == 'clip':
        if set(options) - {'scope', 'destination', 'exportMuted'} or scope not in {'full', 'segments'} or destination not in {'canvas', 'download'}:
            _error('剪辑导出须选择完整成片或逐段文件，以及画布或下载去向')
        data = node.get('clipData')
        if not isinstance(data, dict) or type(data.get('version')) is not int or data['version'] != 1 or type(data.get('fps')) is not int or data['fps'] != FPS:
            _error('剪辑数据版本或帧率与原生入口不一致')
        muted = options.get('exportMuted', data.get('exportMuted'))
        if type(muted) is not bool:
            _error('剪辑导出须明确是否静音')
        clips = data.get('clips')
        if not isinstance(clips, list) or not 1 <= len(clips) <= 200:
            _error('剪辑导出须有1至200个有效片段')
        normalized, ids = [], set()
        for clip in clips:
            if not isinstance(clip, dict):
                _error('剪辑片段数据损坏')
            clip_id = _id(clip.get('id'))
            if clip_id in ids or clip.get('kind') not in {'image', 'video'}:
                _error('剪辑片段编号重复或媒体类型不受支持')
            ids.add(clip_id)
            start, end, offset = [_number(clip.get(k), 0, MAX_FRAMES, True) for k in ('startFrame', 'endFrame', 'sourceOffsetFrames')]
            if end <= start:
                _error('剪辑片段结束帧须晚于开始帧')
            source = _file(clip.get('url'), resolve_local, allowed_roots, probe)
            if clip['kind'] == 'video' and (source['durationSeconds'] <= 0 or (offset + end - start) / FPS > source['durationSeconds'] + 1 / FPS):
                _error('剪辑裁剪范围超出实际视频时长')
            sources.append({'clipId': clip_id, 'sourceNodeId': clip.get('sourceNodeId'),
                            'sourceResultId': clip.get('sourceResultId'), 'file': source})
            normalized.append({'id': clip_id, 'kind': clip['kind'], 'url': clip['url'],
                               'startFrame': start, 'endFrame': end, 'sourceOffsetFrames': offset})
        normalized.sort(key=lambda c: c['startFrame'])
        if any(b['startFrame'] < a['endFrame'] for a, b in zip(normalized, normalized[1:])):
            _error('原生单轨剪辑不允许片段重叠')
        sources.sort(key=lambda s: next(i for i, c in enumerate(normalized) if c['id'] == s['clipId']))
        if scope == 'full':
            expected = [{'sourceClipId': None, 'durationSeconds': normalized[-1]['endFrame'] / FPS}]
        else:
            expected = [{'sourceClipId': c['id'], 'durationSeconds': (c['endFrame'] - c['startFrame']) / FPS} for c in normalized]
        mode = 'clip-task'
        request = {'canvas_id': canvas_id, 'node_id': node_id, 'scope': scope, 'request_id': request_id,
                   'clipData': {'version': 1, 'fps': FPS, 'exportMuted': muted, 'clips': normalized}}
        output_spec = {'width': 1920, 'height': 1080, 'hasAudio': not muted}
    plan = {'canvasId': canvas_id, 'nodeId': node_id, 'nodeType': kind, 'mode': mode,
            'options': copy.deepcopy(options), 'sources': sources, 'expectedResults': expected,
            'outputSpec': output_spec, 'nativeRequest': request, 'requestId': request_id}
    # 请求编号/唯一文件名不属于素材范围；验证时复用原编号，不发起新任务。
    scope_request = {k: v for k, v in request.items() if k not in {'request_id', 'filename'}}
    plan['rangeHash'] = _hash({k: v for k, v in plan.items() if k not in {'nativeRequest', 'requestId'}} | {'request': scope_request})
    return plan


def validate_media_export_snapshot(plan, node, resolve_local, allowed_roots, probe):
    current = prepare_media_export(plan['canvasId'], node, plan['options'], resolve_local, allowed_roots, probe,
                                   request_id=plan['requestId'])
    if current['rangeHash'] != plan['rangeHash']:
        _error('导出范围、结果或原媒体已变化，请重新规划')
    return current


def _binding(plan, binding):
    if not isinstance(binding, dict) or any(binding.get(k) != plan[k] for k in ('canvasId', 'nodeId', 'rangeHash', 'requestId')):
        _error('未取得绑定原范围的服务端持久导出记录，不能核验成功')


def _output(plan, result, expected, resolve_local, allowed_roots, probe):
    file = _file(result.get('url'), resolve_local, allowed_roots, probe)
    if any(file['pathHash'] == source['file']['pathHash'] for source in plan['sources']):
        _error('导出回执指向原素材，不能作为新的成片结果')
    video, spec = file['video'], plan['outputSpec']
    if (video['codec_name'] != 'h264' or video['pix_fmt'] != 'yuv420p' or video['r_frame_rate'] != '30/1'
        or any(video.get(k) != spec[k] for k in ('width', 'height')) or file['hasAudio'] != spec['hasAudio']
        or abs(file['durationSeconds'] - expected['durationSeconds']) > 2 / FPS + 1e-9):
        _error('实际导出文件的规格、音轨或时长与选定范围不一致')
    if 'durationSeconds' in result and abs(_number(result['durationSeconds']) - file['durationSeconds']) > 2 / FPS:
        _error('导出回执时长与实际文件不一致')
    return file


def verify_clip_export(plan, task, binding, resolve_local, allowed_roots, probe):
    """读取原 taskId；failed 的部分成功仍是 failed，不自动重试。"""
    _binding(plan, binding)
    task_id = binding.get('taskId')
    if plan['mode'] != 'clip-task' or not isinstance(task_id, str) or not TOKEN.fullmatch(task_id) or not isinstance(task, dict):
        _error('剪辑导出缺少有效原任务绑定')
    if task.get('id') != task_id or task.get('canvas_id') != plan['canvasId'] or task.get('node_id') != plan['nodeId']:
        _error('剪辑导出任务不属于原画布和节点')
    status, results = task.get('status'), task.get('results')
    if not isinstance(status, str) or status not in {'queued', 'running', 'failed', 'succeeded'} or not isinstance(results, list):
        _error('剪辑导出任务状态或回执无效')
    expected = {r['sourceClipId']: (i, r) for i, r in enumerate(plan['expectedResults'])}
    seen, files = set(), []
    for result in results:
        if not isinstance(result, dict):
            _error('剪辑导出文件回执无效')
        clip_id = result.get('sourceClipId')
        if clip_id is not None and not isinstance(clip_id, str) or clip_id not in expected or clip_id in seen:
            _error('剪辑导出结果重复或不属于选定片段')
        seen.add(clip_id)
        index, item = expected[clip_id]
        filename = f'clip-full-{task_id}.mp4' if clip_id is None else f'clip-{index+1:03d}-{task_id}.mp4'
        if result.get('name') != filename or str(result.get('url', '')).rsplit('/', 1)[-1] != filename:
            _error('剪辑导出文件名与原任务不一致')
        files.append(_output(plan, result, item, resolve_local, allowed_roots, probe) | {'sourceClipId': clip_id})
    if status == 'succeeded' and seen != set(expected):
        _error('任务声称成功但缺少选定范围内的输出文件')
    return {'status': status, 'complete': status == 'succeeded', 'files': files,
            'remainingClipIds': [k for k in expected if k not in seen], 'taskId': task_id, 'rangeHash': plan['rangeHash']}
