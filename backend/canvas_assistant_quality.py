"""创作助手图片结果的本地事实核验；不提交任务、不写画布、不评价视觉语义。"""
from __future__ import annotations

import hashlib
import base64
import io
import json
import math
import os
from pathlib import Path
import re
import stat
import subprocess
import threading
import time
import warnings
from urllib.parse import unquote, urlsplit

from PIL import Image

from backend.canvas_clip import find_media_tools


_PREFIXES = ('/output/', '/assets/', '/api/storage-files/local/')
_ERRORS = {
    'invalid_url': '仅支持当前程序的本地图片地址',
    'missing_file': '图片文件不存在或暂时无法读取',
    'unsafe_path': '图片文件不在允许的本地目录内或经过链接目录',
    'not_file': '该地址不是普通图片文件',
    'invalid_image': '图片文件无法完整读取',
    'changed_file': '图片文件在检查期间发生变化，请重新检查',
}


def _local_url(value):
    if not isinstance(value, str) or not value.startswith(_PREFIXES):
        return False
    try:
        parsed = urlsplit(value)
        if parsed.scheme or parsed.netloc or parsed.fragment or parsed.query:
            return False
        decoded = parsed.path
        # 多层编码也不能掩盖路径穿越或 Windows 分隔符。
        for _ in range(8):
            expanded = unquote(decoded)
            if expanded == decoded:
                break
            decoded = expanded
        else:
            return False
        return (decoded.startswith(_PREFIXES) and '\\' not in decoded and ':' not in decoded
                and not any(ord(c) < 32 for c in value + decoded)
                and not any(part in {'.', '..'} for part in decoded.split('/')))
    except ValueError:
        return False


def _error(url, code):
    return {'url': url if _local_url(url) else '', 'ok': False,
            'errorCode': code, 'error': _ERRORS[code]}


def _has_link(path):
    # Windows junction 也属于重解析点，不能用它绕过已登记的根目录。
    for part in (path, *path.parents):
        attrs = part.lstat()
        if stat.S_ISLNK(attrs.st_mode) or getattr(attrs, 'st_file_attributes', 0) & getattr(stat, 'FILE_ATTRIBUTE_REPARSE_POINT', 1024):
            return True
    return False


def inspect_images(urls, *, resolve_file, allowed_roots) -> list[dict]:
    """逐 URL 检查真实文件。解析器和允许根目录必须由服务端入口注入。"""
    roots = []
    for root in allowed_roots:
        try:
            resolved = Path(root).resolve(strict=True)
            if resolved.is_dir():
                roots.append(resolved)
        except (OSError, RuntimeError, ValueError, TypeError):
            continue
    results = []
    for url in urls:
        if not _local_url(url):
            results.append(_error(url, 'invalid_url'))
            continue
        try:
            supplied = resolve_file(url)
        except Exception:
            # 不回传解析器异常；它可能包含本机路径或配置。
            results.append(_error(url, 'missing_file'))
            continue
        if supplied is None:
            results.append(_error(url, 'missing_file'))
            continue
        try:
            original = Path(supplied)
            if not original.is_absolute() or _has_link(original):
                results.append(_error(url, 'unsafe_path'))
                continue
            path = original.resolve(strict=True)
            if not any(path.is_relative_to(root) for root in roots):
                results.append(_error(url, 'unsafe_path'))
                continue
            if not path.is_file():
                results.append(_error(url, 'not_file'))
                continue
        except (FileNotFoundError, NotADirectoryError):
            results.append(_error(url, 'missing_file'))
            continue
        except (OSError, RuntimeError, ValueError, TypeError):
            results.append(_error(url, 'unsafe_path'))
            continue
        try:
            # 同一打开的文件用于摘要、verify 和解码，避免路径替换后混合两份事实。
            with path.open('rb') as source, warnings.catch_warnings():
                warnings.simplefilter('error', Image.DecompressionBombWarning)
                initial = os.fstat(source.fileno())
                current = path.stat()
                if (_has_link(original) or original.resolve(strict=True) != path
                        or not stat.S_ISREG(initial.st_mode)
                        or (initial.st_dev, initial.st_ino) != (current.st_dev, current.st_ino)):
                    results.append(_error(url, 'unsafe_path'))
                    continue
                digest = hashlib.sha256()
                size = 0
                while chunk := source.read(1024 * 1024):
                    digest.update(chunk)
                    size += len(chunk)
                source.seek(0)
                with Image.open(source) as picture:
                    picture.verify()
                source.seek(0)
                with Image.open(source) as picture:
                    picture.load()
                    width, height, fmt = picture.width, picture.height, picture.format
                    # 对 GIF/WebP 等多帧图片也检查所有帧，不能只验一个完好缩略帧。
                    for frame in range(1, getattr(picture, 'n_frames', 1)):
                        picture.seek(frame)
                        picture.load()
                final = os.fstat(source.fileno())
                if (initial.st_size, initial.st_mtime_ns) != (final.st_size, final.st_mtime_ns) or size != final.st_size:
                    results.append(_error(url, 'changed_file'))
                    continue
                results.append({'url': url, 'ok': True, 'width': width, 'height': height,
                                'format': fmt, 'bytes': size, 'sha256': digest.hexdigest()})
        except Exception:
            # PIL 与文件系统的原始异常均可能包含路径，只公开稳定的错误码。
            results.append(_error(url, 'invalid_image'))
    return results


_VIDEO_ERRORS = {
    **_ERRORS,
    'unsupported_video': '仅支持可独立读取的 MP4/MOV、WebM/MKV 和 AVI 本地文件，不能检查播放列表',
    'runtime_unavailable': '本地视频检查组件不可用',
    'invalid_video': '本地文件无法解析为视频',
    'video_metadata': '无法确认视频的有效尺寸和时长',
    'video_timeout': '视频检查超时，无法判断未检查的内容',
    'video_limit': '视频文件或检查输出超过安全上限',
    'video_frames': '视频元数据已读取，但未能提取全部要求的抽查帧',
}
_VIDEO_SCOPE = {'fullVideoSemantics': 'unknown', 'audioSemantics': 'unknown',
                'note': '仅核对本地文件元数据和有限时间点的抽查帧，未检查全片连续性和声音内容'}


def _video_error(url, code, *, unknown=False):
    return {'url': url if _local_url(url) else '', 'ok': False,
            'status': 'unknown' if unknown else 'needs_changes',
            'errorCode': code, 'error': _VIDEO_ERRORS[code], 'frames': [],
            'coverage': dict(_VIDEO_SCOPE)}


def _run_media(command, source, *, timeout, max_stdout, max_stderr=128 * 1024):
    """有界读取两个输出流；不用 shell、无 stdin 文本协议或外部文件输入。"""
    source.seek(0)
    options = {'creationflags': subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {}
    with subprocess.Popen(command, stdin=source, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **options) as process:
        outputs = [bytearray(), bytearray()]
        overflow = threading.Event()

        def read_stream(stream, result, limit):
            try:
                while chunk := stream.read(8192):
                    remaining = limit - len(result)
                    result.extend(chunk[:max(0, remaining)])
                    if len(chunk) > remaining:
                        overflow.set()
                        process.kill()
                        break
            except OSError:
                overflow.set()

        readers = [threading.Thread(target=read_stream, args=(process.stdout, outputs[0], max_stdout), daemon=True),
                   threading.Thread(target=read_stream, args=(process.stderr, outputs[1], max_stderr), daemon=True)]
        for reader in readers:
            reader.start()
        try:
            process.wait(timeout=max(0.001, timeout))
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
            raise TimeoutError('media timeout') from None
        finally:
            for reader in readers:
                reader.join(timeout=1)
        if overflow.is_set() or any(reader.is_alive() for reader in readers):
            raise ValueError('media output limit')
        return process.returncode, bytes(outputs[0]), bytes(outputs[1])


def _video_demuxer(header):
    # 先识别文件容器，再强制 demuxer；改后缀不能把 HLS/concat 当作本地视频。
    if len(header) >= 12 and header[4:8] == b'ftyp':
        return 'mov'
    if header.startswith(b'\x1aE\xdf\xa3'):
        return 'matroska'
    if header.startswith(b'RIFF') and header[8:12] == b'AVI ':
        return 'avi'
    return None


def _video_unchanged(original, path, initial, size):
    try:
        current = path.stat()
        return (not _has_link(original) and original.resolve(strict=True) == path
                and (initial.st_dev, initial.st_ino, initial.st_size, initial.st_mtime_ns)
                == (current.st_dev, current.st_ino, current.st_size, current.st_mtime_ns)
                and size == current.st_size)
    except (OSError, ValueError, RuntimeError):
        return False


def inspect_videos(urls, *, resolve_file, allowed_roots, tools=None, max_frames=3,
                   timeout=20, max_bytes=200 * 1024 * 1024) -> list[dict]:
    """只读本地独立容器，返回元数据和最多3张带实际时间戳的JPEG抽查帧。

    tools 可注入可信的 (ffmpeg, ffprobe) 运行时路径，默认复用剪辑模块定位。
    每文件总检查时间最多30秒、文件最多200MB、每帧输出最多2MB。
    输入限定 pipe 协议；无法从非可寻址输入抽帧的容器报告 unknown，不放开文件协议。
    """
    if (type(max_frames) is not int or not 0 <= max_frames <= 3
            or isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or not 0 < timeout <= 30
            or type(max_bytes) is not int or not 1 <= max_bytes <= 200 * 1024 * 1024):
        raise ValueError('视频检查参数超出安全范围')
    roots = []
    for root in allowed_roots:
        try:
            root = Path(root).resolve(strict=True)
            if root.is_dir():
                roots.append(root)
        except (OSError, RuntimeError, ValueError, TypeError):
            continue
    results = []
    for url in urls:
        if not _local_url(url):
            results.append(_video_error(url, 'invalid_url'))
            continue
        try:
            supplied = resolve_file(url)
        except Exception:
            results.append(_video_error(url, 'missing_file'))
            continue
        try:
            if supplied is None:
                raise FileNotFoundError()
            original = Path(supplied)
            if not original.is_absolute() or _has_link(original):
                results.append(_video_error(url, 'unsafe_path'))
                continue
            path = original.resolve(strict=True)
            if not any(path.is_relative_to(root) for root in roots):
                results.append(_video_error(url, 'unsafe_path'))
                continue
            if not stat.S_ISREG(path.stat().st_mode):
                results.append(_video_error(url, 'not_file'))
                continue
        except (FileNotFoundError, NotADirectoryError):
            results.append(_video_error(url, 'missing_file'))
            continue
        except (OSError, RuntimeError, ValueError, TypeError):
            results.append(_video_error(url, 'unsafe_path'))
            continue
        report = None
        phase = 'metadata'
        deadline = time.monotonic() + timeout
        try:
            with path.open('rb') as source:
                initial = os.fstat(source.fileno())
                current = path.stat()
                identity = (initial.st_dev, initial.st_ino)
                if (_has_link(original) or original.resolve(strict=True) != path or not stat.S_ISREG(initial.st_mode)
                        or identity != (current.st_dev, current.st_ino)):
                    results.append(_video_error(url, 'unsafe_path'))
                    continue
                if initial.st_size > max_bytes:
                    results.append(_video_error(url, 'video_limit', unknown=True))
                    continue
                demuxer = _video_demuxer(source.read(32))
                if not demuxer:
                    results.append(_video_error(url, 'unsupported_video'))
                    continue
                source.seek(0)
                digest = hashlib.sha256()
                size = 0
                while chunk := source.read(1024 * 1024):
                    digest.update(chunk)
                    size += len(chunk)
                    if size > max_bytes:
                        raise ValueError('media output limit')
                    if time.monotonic() >= deadline:
                        raise TimeoutError()
                try:
                    ffmpeg, ffprobe = tools if tools is not None else find_media_tools()
                except (OSError, ValueError, TypeError):
                    results.append(_video_error(url, 'runtime_unavailable', unknown=True))
                    continue
                safe_input = ['-protocol_whitelist', 'pipe', '-format_whitelist', demuxer,
                              '-probesize', '1048576', '-analyzeduration', '3000000', '-f', demuxer, '-i', 'pipe:0']
                command = [str(ffprobe), '-v', 'error', *safe_input, '-show_entries',
                           'stream=codec_type,width,height:format=duration', '-of', 'json']
                code, stdout, _ = _run_media(command, source, timeout=deadline - time.monotonic(), max_stdout=64 * 1024)
                if code:
                    results.append(_video_error(url, 'invalid_video'))
                    continue
                try:
                    metadata = json.loads(stdout)
                    streams = metadata['streams']
                    video = next(s for s in streams if s.get('codec_type') == 'video')
                    width, height = video['width'], video['height']
                    duration = float(metadata['format']['duration'])
                    if (type(width) is not int or type(height) is not int or not 1 <= width <= 16384
                            or not 1 <= height <= 16384 or width * height > 64 * 1024 * 1024
                            or not math.isfinite(duration) or not 0 < duration <= 24 * 60 * 60):
                        raise ValueError()
                except (KeyError, TypeError, ValueError, StopIteration):
                    results.append(_video_error(url, 'video_metadata', unknown=True))
                    continue
                report = {'url': url, 'ok': True, 'status': 'passed', 'width': width, 'height': height,
                          'duration': duration, 'format': demuxer, 'hasAudio': any(s.get('codec_type') == 'audio' for s in streams),
                          'bytes': size, 'sha256': digest.hexdigest(), 'frames': [], 'coverage': dict(_VIDEO_SCOPE)}
                phase = 'frames'
                for index in range(max_frames):
                    requested = duration * (index + 0.5) / max_frames
                    filters = f"select=gte(t\\,{requested:.6f}),scale=640:640:force_original_aspect_ratio=decrease,showinfo"
                    command = [str(ffmpeg), '-nostdin', '-hide_banner', '-loglevel', 'info', '-threads', '1',
                               *safe_input, '-map', '0:v:0', '-an', '-sn', '-dn', '-vf', filters, '-frames:v', '1',
                               '-threads', '1', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', '3', 'pipe:1']
                    code, frame, logs = _run_media(command, source, timeout=deadline - time.monotonic(), max_stdout=2 * 1024 * 1024)
                    stamps = re.findall(rb'\bpts_time:([0-9.eE+\-]+)', logs)
                    if code or not frame or not stamps:
                        raise RuntimeError('frame unavailable')
                    timestamp = float(stamps[0])
                    if not math.isfinite(timestamp) or not requested - 0.001 <= timestamp < duration + 0.001:
                        raise RuntimeError('frame timestamp')
                    with Image.open(io.BytesIO(frame)) as image:
                        if image.format != 'JPEG' or not 0 < image.width <= 640 or not 0 < image.height <= 640:
                            raise RuntimeError('frame dimensions')
                        image.verify()
                    with Image.open(io.BytesIO(frame)) as image:
                        image.load()
                        fw, fh = image.size
                    report['frames'].append({'timestampSeconds': timestamp, 'requestedSeconds': requested,
                                             'width': fw, 'height': fh, 'sha256': hashlib.sha256(frame).hexdigest(),
                                             'dataUrl': 'data:image/jpeg;base64,' + base64.b64encode(frame).decode('ascii')})
                final, current = os.fstat(source.fileno()), path.stat()
                if (_has_link(original) or original.resolve(strict=True) != path
                        or identity != (current.st_dev, current.st_ino)
                        or (initial.st_size, initial.st_mtime_ns) != (final.st_size, final.st_mtime_ns) or size != final.st_size):
                    report = _video_error(url, 'changed_file')
                elif not max_frames:
                    report.update(status='unknown', errorCode='video_frames', error='仅完成元数据读取，未提取抽查帧')
                results.append(report)
        except Exception as exc:
            code = ('video_timeout' if isinstance(exc, TimeoutError) else 'video_limit' if isinstance(exc, ValueError)
                    else 'runtime_unavailable' if isinstance(exc, FileNotFoundError) else 'video_frames' if phase == 'frames' else 'invalid_video')
            unknown = code in {'video_timeout', 'video_limit', 'runtime_unavailable', 'video_frames'}
            if report is not None and not _video_unchanged(original, path, initial, size):
                results.append(_video_error(url, 'changed_file'))
            elif report is not None and unknown:
                report.update(status='unknown', errorCode=code, error=_VIDEO_ERRORS[code])
                results.append(report)
            else:
                results.append(_video_error(url, code, unknown=unknown))
    return results


def _image_urls(items):
    if not isinstance(items, list):
        return []
    result = []
    for item in items:
        if isinstance(item, str):
            result.append(item)
        elif isinstance(item, dict) and item.get('kind', 'image') == 'image' and isinstance(item.get('url'), str):
            result.append(item['url'])
    return result


def _public_images(images):
    result = []
    for item in images:
        if not isinstance(item, dict):
            result.append(_error('', 'invalid_image'))
        elif item.get('ok') is True and _local_url(item.get('url')):
            result.append({k: item[k] for k in ('url', 'ok', 'width', 'height', 'format', 'bytes', 'sha256') if k in item})
        else:
            result.append(_error(item.get('url'), item.get('errorCode') if item.get('errorCode') in _ERRORS else 'invalid_image'))
    return result


def build_inspection(*, canvas, images, proposal=None, task=None) -> dict:
    """核对保存快照和已确认的原请求，返回硬条件三态及用于拒绝旧评价的摘要。"""
    images = _public_images(images)
    checks = []

    def check(identity, label, status, message, **facts):
        checks.append({'id': identity, 'label': label, 'status': status, 'message': message, **facts})

    valid = bool(images) and all(item.get('ok') is True for item in images)
    check('image_integrity', '图片完整性', 'passed' if valid else 'needs_changes',
          '已读取真实图片文件' if valid else '图片为空、损坏或无法安全读取', actual=len(images))
    request = proposal.get('imageRequest') if isinstance(proposal, dict) else None
    confirmed = isinstance(request, dict) and bool(request) and proposal.get('state') in {'submitted', 'submitting'}
    check('confirmed_request', '确认请求', 'passed' if confirmed else 'unknown',
          '硬条件来自用户确认的原图片请求' if confirmed else '没有可核对的已确认图片请求；不推测数量和尺寸')

    task_core = None
    proposal_core = None
    if proposal:
        proposal_core = {k: proposal.get(k) for k in ('id', 'canvasId', 'nodeId', 'nodeIds', 'taskId', 'state', 'imageRequest')}
        nodes = {n.get('id'): n for n in canvas.get('nodes', []) if isinstance(n, dict)}
        target = nodes.get(proposal.get('nodeId'))
        belongs = canvas.get('id') == proposal.get('canvasId') and target is not None
        expected_type = 'smart-image' if canvas.get('kind') == 'smart' else 'generator'
        belongs = belongs and target.get('type') == expected_type
        check('canvas_binding', '原画布与节点', 'passed' if belongs else 'needs_changes',
              '结果仍属于原画布的生成节点' if belongs else '原画布或生成节点已变化')
        task_valid = isinstance(task, dict)
        result = task.get('result') if task_valid and isinstance(task.get('result'), dict) else {}
        raw_results = result.get('images')
        task_urls = _image_urls(raw_results)
        results_well_formed = isinstance(raw_results, list) and len(raw_results) == len(task_urls)
        if task_valid:
            task_core = {k: task.get(k) for k in ('task_id', 'taskId', 'id', 'status', 'canvas_id', 'node_id', 'provider_id', 'model')}
            task_core['images'] = raw_results
            identifiers = [task[k] for k in ('task_id', 'taskId', 'id') if task.get(k)]
            owns = bool(identifiers) and bool(proposal.get('taskId')) and all(identity == proposal['taskId'] for identity in identifiers)
            owns = owns and ('canvas_id' not in task or task['canvas_id'] == proposal.get('canvasId'))
            owns = owns and ('node_id' not in task or task['node_id'] == proposal.get('nodeId'))
            if confirmed:
                owns = owns and all(not task.get(field) or task[field]==request.get(field) for field in ('provider_id','model'))
            succeeded = task.get('status') == 'succeeded'
            check('task_binding', '原任务归属与成功状态', 'passed' if owns and succeeded else 'needs_changes',
                  '原任务编号一致且已成功' if owns and succeeded else '任务编号、归属或成功状态不符合原方案')
        else:
            check('task_binding', '原任务归属与成功状态', 'unknown', '原任务记录暂不可用')
        if confirmed:
            count = request.get('n', 1)
            count_known = type(count) is int and count > 0
            count_matches = task_valid and count_known and results_well_formed and len(task_urls) == count and len(set(task_urls)) == count
            check('image_count', '原结果图片数量', 'unknown' if not task_valid or not count_known else ('passed' if count_matches else 'needs_changes'),
                  '已核对原结果数量' if count_matches else '原结果数量与确认请求不一致或数量暂不可确认', expected=count if count_known else None, actual=len(task_urls))
            readable = {item['url'] for item in images if item.get('ok') is True}
            read_matches = results_well_formed and bool(task_urls) and all(_local_url(url) and url in readable for url in task_urls)
            check('result_images', '原结果文件', 'unknown' if not task_valid else ('passed' if read_matches else 'needs_changes'),
                  '实际读取了原任务所有结果图片' if read_matches else '未完整读取原任务的真实结果图片')
            saved = set()
            if target:
                if canvas.get('kind') == 'smart':
                    saved.update(_image_urls(target.get('images')))
                else:
                    saved.update(_image_urls(target.get('generatedOutputs')))
                    output_ids = {edge.get('to') for edge in canvas.get('connections', []) if isinstance(edge, dict) and edge.get('from') == target.get('id')}
                    for node_id in output_ids:
                        output = nodes.get(node_id)
                        if output and output.get('type') == 'output':
                            saved.update(_image_urls(output.get('images')))
            saved_matches = bool(task_urls) and set(task_urls) <= saved
            check('saved_media', '原生结果保存', 'unknown' if not task_valid else ('passed' if saved_matches else 'needs_changes'),
                  '原结果已保存在原节点或其结果节点' if saved_matches else '原结果尚未完整保存在原节点或其结果节点')
            required = proposal.get('nodeIds')
            required_known = isinstance(required, list) and proposal.get('nodeId') in required and len(required) > 1
            sources = [node_id for node_id in required if node_id != proposal.get('nodeId')] if required_known else []
            members = (target or {}).get('inputNodeIds' if canvas.get('kind') == 'smart' else 'inputs') or []
            edges = {(edge.get('from'), edge.get('to')) for edge in canvas.get('connections', []) if isinstance(edge, dict) and (canvas.get('kind') != 'smart' or edge.get('kind') == 'input')}
            connected = required_known and target is not None and all(node_id in nodes and node_id in members and (node_id, target['id']) in edges for node_id in sources)
            check('input_connections', '原输入连接', 'unknown' if not required_known else ('passed' if connected else 'needs_changes'),
                  '原提示词和参考图的必要输入连接仍存在' if connected else '必要输入节点或连接已缺失，或缺少原输入记录')
            size = request.get('size')
            match = re.fullmatch(r'([1-9][0-9]{0,4})x([1-9][0-9]{0,4})', size) if isinstance(size, str) else None
            if match:
                width, height = map(int, match.groups())
                requested_images = [item for item in images if item['url'] in task_urls]
                dimension_matches = bool(requested_images) and all(item.get('ok') is True and (item.get('width'), item.get('height')) == (width, height) for item in requested_images)
                check('dimensions', '实际像素尺寸', 'unknown' if not task_valid else ('passed' if dimension_matches else 'needs_changes'),
                      '实际像素符合确认请求' if dimension_matches else '实际图片像素不符合确认请求或图片无法读取', limited=True, expected={'width': width, 'height': height})
            elif size in (None, '', 'auto'):
                check('dimensions', '实际像素尺寸', 'passed', '确认请求未限定具体像素尺寸', limited=False)
            else:
                check('dimensions', '实际像素尺寸', 'unknown', '原确认请求的像素格式无法核对', limited=False)
    hard_status = 'needs_changes' if any(item['status'] == 'needs_changes' for item in checks) else ('unknown' if any(item['status'] == 'unknown' for item in checks) else 'passed')
    snapshot = {'canvas': canvas, 'images': images, 'proposal': proposal_core, 'task': task_core}
    snapshot_hash = hashlib.sha256(json.dumps(snapshot, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode('utf-8')).hexdigest()
    return {'version': 1, 'canvasId': canvas.get('id'), 'proposalId': proposal.get('id') if proposal else None,
            'taskId': proposal.get('taskId') if proposal else None, 'images': images, 'checks': checks,
            'hardStatus': hard_status, 'status': hard_status, 'snapshotHash': snapshot_hash}


def build_video_inspection(*, canvas, videos, proposal=None, task=None) -> dict:
    """绑定用户确认的原生视频任务；抽查帧不构成全片或音频语义验收。"""
    from backend.canvas_assistant_native import native_run_input_hash

    safe_videos = []
    for item in videos:
        if not isinstance(item, dict) or not _local_url(item.get('url')):
            safe_videos.append(_video_error('', 'invalid_url'))
            continue
        public = {k: item[k] for k in ('url', 'ok', 'status', 'width', 'height', 'duration', 'format',
                                      'hasAudio', 'bytes', 'sha256', 'errorCode') if k in item}
        public['frames'] = [{k: frame[k] for k in ('timestampSeconds', 'requestedSeconds', 'width', 'height', 'sha256')
                             if k in frame} for frame in item.get('frames', []) if isinstance(frame, dict)][:3]
        public['coverage'] = dict(_VIDEO_SCOPE)
        safe_videos.append(public)
    checks = []

    def check(identity, label, status, message, **facts):
        checks.append({'id': identity, 'label': label, 'status': status, 'message': message, **facts})

    def verdict(values):
        return 'needs_changes' if 'needs_changes' in values else 'unknown' if 'unknown' in values else 'passed'

    integrity = verdict([item.get('status', 'unknown') if item.get('ok') is True
                         else ('unknown' if item.get('status') == 'unknown' else 'needs_changes')
                         for item in safe_videos]) if safe_videos else 'needs_changes'
    check('video_integrity', '视频文件完整性', integrity, '核对本地视频容器、元数据和文件摘要')
    sampled = bool(safe_videos) and all(item.get('ok') is True and item.get('frames') for item in safe_videos)
    check('video_samples', '有限时间点取样', 'passed' if sampled else 'unknown', '仅核对已提取的有限时间点，不能代表全片')
    proposal = proposal if isinstance(proposal, dict) else {}
    request = proposal.get('videoRequest')
    settings = proposal.get('runSettings') if isinstance(proposal.get('runSettings'), dict) else {}
    confirmed_at = proposal.get('confirmedAt')
    confirmed = (proposal.get('action') == 'run' and proposal.get('nodeType') == 'video'
                 and proposal.get('state') in {'executing', 'accepted', 'completed', 'submission_unknown'}
                 and type(confirmed_at) in (int, float) and math.isfinite(confirmed_at) and confirmed_at > 0
                 and isinstance(request, dict) and bool(request) and settings.get('taskKind') == 'video')
    check('confirmed_request', '确认请求', 'passed' if confirmed else 'unknown',
          '硬条件仅来自用户确认时保存的原视频请求' if confirmed else '缺少可核对的用户确认视频请求，不从自由描述推测')
    nodes = {node.get('id'): node for node in canvas.get('nodes', []) if isinstance(node, dict)}
    target = nodes.get(proposal.get('nodeId'))
    belongs = bool(target and target.get('type') == 'video' and canvas.get('id') == proposal.get('canvasId'))
    if proposal:
        check('canvas_binding', '原画布与视频节点', 'passed' if belongs else 'needs_changes', '核对原画布及原视频节点')
    receipt = proposal.get('receipt') if isinstance(proposal.get('receipt'), dict) else {}
    expected = receipt.get('taskIds')
    expected_known = (isinstance(expected, list) and bool(expected) and all(isinstance(i, str) and i for i in expected)
                      and len(set(expected)) == len(expected))
    tasks = task if isinstance(task, list) else [task] if isinstance(task, dict) else None
    task_valid = tasks is not None and all(isinstance(t, dict) for t in tasks)
    owns = bool(confirmed and expected_known and task_valid and len(tasks) == len(expected))
    bindings = {'canvas_id': proposal.get('canvasId'), 'node_id': proposal.get('nodeId'),
                'assistant_action_id': proposal.get('id'), 'input_hash': proposal.get('runInputHash'),
                'provider_id': settings.get('provider'), 'model': settings.get('model')}
    owns = owns and all(isinstance(value, str) and value for value in bindings.values())
    owns = owns and bool(re.fullmatch('[0-9a-f]{64}', str(bindings['input_hash'] or '')))
    if owns:
        for expected_id, current in zip(expected, tasks):
            ids = [current[k] for k in ('task_id', 'taskId', 'id') if current.get(k)]
            owns = owns and bool(ids) and all(i == expected_id for i in ids)
            owns = owns and all(current.get(k) == v for k, v in bindings.items()) and current.get('status') == 'succeeded'
        run = target.get('assistantNativeRun') if belongs and isinstance(target.get('assistantNativeRun'), dict) else {}
        owns = owns and run.get('actionId') == proposal.get('id') and run.get('taskKind') == 'video' and run.get('taskIds') == expected
        owns = owns and target.get('apiProvider') == settings.get('provider') and target.get('model') == settings.get('model')
    check('task_binding', '原视频任务归属与成功状态', 'unknown' if not task_valid or not confirmed else 'passed' if owns else 'needs_changes',
          '核对原受理编号、画布、节点、动作、输入摘要、手选平台模型和成功状态')
    input_matches = False
    if belongs and isinstance(proposal.get('runInputHash'), str):
        input_matches = native_run_input_hash(canvas, target['id']) == proposal['runInputHash']
    check('input_connections', '原输入参数和连接', 'unknown' if not confirmed else 'passed' if input_matches else 'needs_changes',
          '确认时的输入节点、参数及原输出连接必须保持一致')

    def video_urls(items):
        if not isinstance(items, list):
            return None
        urls = []
        for item in items:
            url = item if isinstance(item, str) else item.get('url') if isinstance(item, dict) and item.get('kind', 'video') == 'video' else None
            if not isinstance(url, str) or not _local_url(url):
                return None
            urls.append(url)
        return urls

    urls = []
    well_formed = bool(task_valid and tasks)
    if well_formed:
        for current in tasks:
            result = current.get('result') if isinstance(current.get('result'), dict) else current
            current_urls = video_urls(result.get('videos'))
            if not current_urls:
                well_formed = False
            else:
                urls.extend(current_urls)
        well_formed = well_formed and len(set(urls)) == len(urls)
    readable = {item['url'] for item in safe_videos if item.get('ok') is True}
    read_matches = well_formed and bool(urls) and set(urls) <= readable
    check('result_videos', '原任务所有视频文件', 'unknown' if not task_valid else 'passed' if read_matches else 'needs_changes',
          '必须安全读取原任务的全部真实视频结果')
    count = request.get('n') if confirmed else None
    if confirmed and count is None:
        check('video_count', '原视频结果数量', 'passed' if well_formed else 'unknown' if not task_valid else 'needs_changes',
              '确认请求未限定成品数量；服务调用上限不作为成品数量', limited=False, actual=len(urls))
    elif confirmed:
        known = type(count) is int and count > 0
        check('video_count', '原视频结果数量', 'unknown' if not known or not task_valid else 'passed' if well_formed and len(urls) == count else 'needs_changes',
              '仅核对明确确认的成品数量', limited=True, expected=count if known else None, actual=len(urls))
    output = nodes.get(proposal.get('outputNodeId'))
    output_link = belongs and output and output.get('type') == 'output' and any(
        isinstance(edge, dict) and edge.get('from') == target['id'] and edge.get('to') == output['id']
        for edge in canvas.get('connections', []))
    def saved_video_urls(items):
        # 输出节点允许保留其它已有图片；只筛选视频，原任务结果仍采用上面的严格检查。
        return set(video_urls([item for item in items if not isinstance(item, dict)
                               or item.get('kind', 'video') == 'video']) or []) if isinstance(items, list) else set()

    saved = saved_video_urls(output.get('images')) if output_link else set()
    saved_matches = bool(output_link and well_formed and urls and set(urls) <= saved)
    check('saved_media', '原视频输出保存', 'unknown' if not task_valid or not confirmed else 'passed' if saved_matches else 'needs_changes',
          '全部原结果须保存到原节点或确认的原输出节点，并保留原输出连接')
    requested = [item for item in safe_videos if item.get('url') in urls]
    metadata_available = bool(requested and read_matches)
    if confirmed:
        duration = request.get('duration')
        duration_known = type(duration) in (int, float) and math.isfinite(duration) and duration > 0
        actual_durations = [item.get('duration') for item in requested]
        actual_known = metadata_available and all(type(d) in (int, float) and math.isfinite(d) and d > 0 for d in actual_durations)
        match = actual_known and duration_known and all(abs(d - duration) <= 0.05 for d in actual_durations)
        check('duration', '实际视频时长', 'unknown' if not actual_known or not duration_known else 'passed' if match else 'needs_changes',
              '以真实容器时长核对确认值，允许最多0.05秒的封装误差', expected=duration if duration_known else None,
              actual=actual_durations, toleranceSeconds=0.05)
        actual_sizes = [(item.get('width'), item.get('height')) for item in requested]
        sizes_known = metadata_available and all(type(w) is int and type(h) is int and w > 0 and h > 0 for w, h in actual_sizes)
        ratio = request.get('aspect_ratio')
        ratio_match = re.fullmatch(r'([1-9][0-9]{0,3}):([1-9][0-9]{0,3})', ratio) if isinstance(ratio, str) else None
        if ratio_match:
            a, b = map(int, ratio_match.groups())
            matches = sizes_known and all(abs(w * b - h * a) <= max(a, b) for w, h in actual_sizes)
            check('aspect_ratio', '实际视频比例', 'unknown' if not sizes_known else 'passed' if matches else 'needs_changes',
                  '实际像素比例与确认值核对，允许一像素取整误差', limited=True, expected=ratio)
        elif ratio in (None, '', 'keep_ratio', 'adaptive'):
            check('aspect_ratio', '实际视频比例', 'unknown' if ratio in {'keep_ratio', 'adaptive'} else 'passed',
                  '动态比例缺少固定尺寸合同；未指定比例时不追加限制', limited=False)
        else:
            check('aspect_ratio', '实际视频比例', 'unknown', '确认比例格式不受支持', limited=False)
        size = request.get('size') or request.get('resolution')
        size_match = re.fullmatch(r'([1-9][0-9]{0,4})x([1-9][0-9]{0,4})', size) if isinstance(size, str) else None
        if size_match:
            expected_size = tuple(map(int, size_match.groups()))
            matches = sizes_known and all(value == expected_size for value in actual_sizes)
            check('dimensions', '实际像素尺寸', 'unknown' if not sizes_known else 'passed' if matches else 'needs_changes',
                  '核对明确确认的像素宽高', limited=True, expected={'width': expected_size[0], 'height': expected_size[1]})
        else:
            check('dimensions', '实际像素尺寸', 'passed' if size in (None, '', 'auto') else 'unknown',
                  '未限定具体像素时不追加限制；供应商分辨率档位含义未确认', limited=False)
        wants_audio = request.get('generate_audio')
        audio_known = metadata_available and all(type(item.get('hasAudio')) is bool for item in requested)
        if wants_audio is True:
            check('audio_presence', '请求音轨存在', 'unknown' if not audio_known else 'passed' if all(item['hasAudio'] for item in requested) else 'needs_changes',
                  '只核对音轨存在，不评价声音内容', limited=True)
        else:
            check('audio_presence', '请求音轨存在', 'passed' if wants_audio is False else 'unknown',
                  '未开启生成音频不等于确认成品必须静音', limited=False)
    hard_status = verdict([item['status'] for item in checks])
    check('full_video_semantics', '全片连续性和视觉语义', 'unknown', _VIDEO_SCOPE['note'])
    check('audio_semantics', '声音内容', 'unknown', '未分析全片音频，不评价对白、音乐或声画同步')
    proposal_core = {k: proposal.get(k) for k in ('id', 'action', 'nodeType', 'canvasId', 'nodeId', 'outputNodeId',
                                               'state', 'confirmedAt', 'runInputHash', 'runSettings', 'videoRequest')}
    proposal_core['taskIds'] = expected
    task_core = [{**{k: t.get(k) for k in ('task_id', 'taskId', 'id', 'status', *bindings)},
                  'videos': (t.get('result') if isinstance(t.get('result'), dict) else t).get('videos')}
                 for t in tasks] if task_valid else None
    snapshot = {'canvas': canvas, 'videos': safe_videos, 'proposal': proposal_core, 'tasks': task_core}
    snapshot_hash = hashlib.sha256(json.dumps(snapshot, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode('utf-8')).hexdigest()
    return {'version': 1, 'canvasId': canvas.get('id'), 'proposalId': proposal.get('id'), 'taskIds': expected if expected_known else [],
            'videos': safe_videos, 'checks': checks, 'hardStatus': hard_status,
            'status': 'needs_changes' if hard_status == 'needs_changes' else 'unknown', 'snapshotHash': snapshot_hash}
