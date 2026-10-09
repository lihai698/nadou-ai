"""视频拆解的持久任务、一次确认和模型编排；不直接写画布。"""
from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import math
import re
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Event, RLock

from fastapi import APIRouter, Header, HTTPException, Request
from backend.atomic_json import write_json_atomic
from backend.canvas_video_media import VideoCancelled

TERMINAL = {'ready', 'failed', 'cancelled', 'interrupted'}
BUILTIN = [('shotSize', '景别'), ('motion', '运镜'), ('visual', '画面'), ('dialogue', '对白'), ('onScreenText', '屏幕文字'), ('mood', '情绪')]


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def shot_rows(cuts, duration):
    q = lambda n: round(float(n) * 10) / 10
    end = q(duration)
    points = [0, *sorted({q(c['seconds']) for c in cuts if 0 < q(c['seconds']) < end}), end]
    return [dict(id=f'shot-{i+1}', index=i+1, startSeconds=a, endSeconds=b, durationSeconds=q(b-a),
                 keyframeUrl='', cells={k: '' for k, _ in BUILTIN}, imagePrompt='', motionPrompt='',
                 carriedOver=False, visionFailed=False) for i, (a, b) in enumerate(zip(points, points[1:]))]


def parse_analysis(text, custom):
    if not isinstance(text, str):
        raise ValueError('模型返回的内容不是文本')
    decoder = json.JSONDecoder()
    value = None
    clean = text.strip()
    if clean.startswith('['):
        raise ValueError('模型返回数组，要求单镜头 JSON 对象')
    for match in re.finditer(r'\{', text):
        try:
            value, _ = decoder.raw_decode(text[match.start():])
            break
        except ValueError:
            continue
    keys = ['shotSize', 'visual', 'mood', 'onScreenText', 'imagePrompt', 'motionPrompt', *[c['id'] for c in custom]]
    if not isinstance(value, dict) or any(not isinstance(value.get(k), str) for k in keys) or not value.get('visual', '').strip():
        raise ValueError('模型未返回完整的镜头字段或有效画面分析')
    return {k: value[k][:12000] for k in keys}


def vision_supported(provider, model):
    return (provider.get('enabled', True) and provider.get('supports_vision') is not False
            and model not in provider.get('text_only_models', [])
            and provider.get('protocol', 'openai') not in {'codex', 'gemini-cli', 'runninghub', 'jimeng', 'volcengine'}
            and not re.search(r'(?:^|[-/])(embedding|rerank|deepseek-reasoner|o1-mini)(?:$|[-/])', model, re.I))


class VideoDeconstructionManager:
    def __init__(self, root, validate_source, media_factory, providers, call_vision, transcribe):
        self.root = Path(root) / 'video_deconstruction_tasks'
        self.root.mkdir(parents=True, exist_ok=True)
        self.validate_source, self.media_factory = validate_source, media_factory
        self.providers, self.call_vision, self.transcribe = providers, call_vision, transcribe
        self.lock, self.tasks, self.events, self.media = RLock(), {}, {}, {}
        self.pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix='video-deconstruction')
        for path in self.root.glob('*.json'):
            task = json.loads(path.read_text(encoding='utf8'))
            if task['status'] not in TERMINAL:
                task.update(status='interrupted', phase='服务已重启', error='任务中断，请重新确认后重试')
                write_json_atomic(path, task)
            self.tasks[task['id']] = task

    def close(self):
        for event in self.events.values():
            event.set()
        self.pool.shutdown(wait=True)

    def _public(self, task):
        return copy.deepcopy({k: v for k, v in task.items() if k not in {'owner', 'payloadHash', 'providersRevision', 'selection', 'audio', 'options'}})

    def _persist(self, task):
        write_json_atomic(self.root / (task['id'] + '.json'), task)

    def _task(self, task_id, user):
        task = self.tasks.get(task_id)
        if not task or task['owner'] != user:
            raise ValueError('任务不存在或不属于当前用户')
        return task

    def _update(self, task, **fields):
        with self.lock:
            if task['status'] in TERMINAL:
                return
            task.update(fields)
            self._persist(task)

    def get(self, task_id, user):
        with self.lock:
            return self._public(self._task(task_id, user))

    def cancel(self, task_id, user):
        with self.lock:
            task = self._task(task_id, user)
            if task['status'] not in TERMINAL:
                self.events[task_id].set()
                task.update(status='cancelled', phase='已停止后续处理', error='已发出的模型调用可能仍计费')
                self._persist(task)
            return self._public(task)

    def prepare(self, context, user, mode, options):
        if mode not in {'detect', 'frames', 'table', 'retry-shot', 'retry-speech'}:
            raise ValueError('拆解模式无效')
        if not isinstance(context, dict) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', context.get('operation_id', '')):
            raise ValueError('操作编号无效')
        if not isinstance(options, dict) or len(json.dumps(options)) > 1_000_000:
            raise ValueError('拆解参数无效或过大')
        canonical = self.validate_source(copy.deepcopy(context), user)
        media = self.media_factory(canonical)
        canonical['source_fingerprint'] = media.fingerprint(canonical)
        payload_hash = digest([canonical, mode, options])
        with self.lock:
            for task in self.tasks.values():
                if task['owner'] == user and task['context']['operation_id'] == canonical['operation_id']:
                    if task['payloadHash'] != payload_hash:
                        raise ValueError('同一操作编号不能用于另一项任务')
                    return self._public(task)
            task = dict(id=uuid.uuid4().hex, owner=user, context=canonical, mode=mode, options=copy.deepcopy(options),
                        payloadHash=payload_hash, status='queued', phase='准备本地检测', progress=0, rows=[], error='', createdAt=time.time())
            self.tasks[task['id']] = task
            self.events[task['id']] = Event()
            self.media[task['id']] = media
            self._persist(task)
            self.pool.submit(self._prepare, task)
            return self._public(task)

    def _cancelled(self, task):
        return self.events[task['id']].is_set()

    def _same_source(self, task, check_revision=False):
        input_context = copy.deepcopy(task['context'])
        if not check_revision:
            input_context.pop('table_id', None)
        context = self.validate_source(input_context, task['owner'])
        if self.media[task['id']].fingerprint(context) != task['context']['source_fingerprint']:
            raise ValueError('原视频已变化，请重新拆解')

    def _prepare(self, task):
        media = self.media[task['id']]
        cancelled = lambda: self._cancelled(task)
        try:
            self._update(task, status='running')
            mode, opts = task['mode'], task['options']
            # 重试使用服务器自己的已分析行，不采信前端提供的图片或时间。
            if mode.startswith('retry-'):
                with self.lock:
                    prior = self._task(opts.get('priorTaskId'), task['owner'])
                    if prior['context']['source_fingerprint'] != task['context']['source_fingerprint'] or not prior.get('rows'):
                        raise ValueError('原任务不对应当前视频')
                    detected, rows = copy.deepcopy(prior['detected']), copy.deepcopy(prior['rows'])
                ids = opts.get('rowIds', []) if mode == 'retry-shot' else []
                if mode == 'retry-shot' and (len(ids) != 1 or ids[0] not in {r['id'] for r in rows}):
                    raise ValueError('请指定一个有效镜头重试')
                self._update(task, detected=detected, rows=rows, retryRowIds=ids, speechOnly=mode == 'retry-speech', speech=copy.deepcopy(prior.get('speech', {})))
            elif mode == 'frames':
                with self.lock:
                    prior = self._task(opts.get('detectionTaskId'), task['owner'])
                    if prior['status'] != 'ready' or prior['mode'] != 'detect' or prior['context']['source_fingerprint'] != task['context']['source_fingerprint']:
                        raise ValueError('检测结果已经失效，请重新检测')
                    detected = copy.deepcopy(prior['detected'])
                cuts = detected['cuts']
                if cuts:
                    ids = opts.get('indices', [])
                    if not ids or len(ids) != len(set(ids)) or any(i not in {c['index'] for c in cuts} for i in ids):
                        raise ValueError('请选择有效切点')
                    seconds = [c['seconds'] for c in cuts if c['index'] in ids]
                else:
                    duration = detected['durationSeconds']
                    count = min(8, max(3, math.floor(duration / 2.5 + .5)))
                    seconds = [round(duration * (i+1)/(count+1), 3) for i in range(count)]
                self._same_source(task)
                result = media.extract_frames(task['context'], seconds, cancelled=cancelled,
                    on_progress=lambda done, total: self._update(task, phase='抽取图片', progress=done / total * 100, progressDetail=f'{done}/{total}'))
                if cancelled():
                    with self.lock:
                        task.update(frames=result['frames'], failures=result['failures'], extractionSettled=True)
                        self._persist(task)
                else:
                    self._update(task, status='ready', frames=result['frames'], failures=result['failures'], detected=detected, extractionSettled=True, phase='抽图完成')
                return
            else:
                detected = media.detect(task['context'], cancelled=cancelled,
                    on_progress=lambda phase, progress: self._update(task, phase=phase, progress=progress))
                self._update(task, detected=detected)
                if mode == 'detect':
                    self._update(task, status='ready', phase='切点检测完成', progress=100)
                    return
                self._update(task, rows=shot_rows(detected['cuts'], detected['durationSeconds']))
            if cancelled():
                return
            columns = opts.get('columns') or [dict(id=k, label=v, kind='builtin') for k, v in BUILTIN]
            if not isinstance(columns, list) or len(columns) > 36 or any(not isinstance(c, dict) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', c.get('id', '')) or c.get('kind') not in {'builtin', 'custom'} or not isinstance(c.get('label'), str) for c in columns):
                raise ValueError('分析列无效')
            self._update(task, columns=columns)
            # 音轨失败与视觉分离，音轨不可用时仍允许分析画面。
            try:
                audio = media.extract_audio(task['context'], cancelled=cancelled)
            except VideoCancelled:
                return
            except ValueError as exc:
                audio = {'hasAudio': False, 'error': str(exc)}
            row_ids = task.get('retryRowIds') or [r['id'] for r in task['rows']]
            vision_calls = 0 if task.get('speechOnly') else len(row_ids)
            revision = digest(self.providers())
            quote = dict(id=uuid.uuid4().hex, sourceFingerprint=task['context']['source_fingerprint'], tableRevision=task['context'].get('table_revision', 0),
                         columns=columns, visionCalls=vision_calls, framesPerShot=3, audioCalls=int(audio.get('hasAudio', False) and mode != 'retry-shot'), expiresAt=time.time()+1800)
            self._update(task, audio=audio, quote=quote, providersRevision=revision, status='awaiting-confirmation', phase='等待整批调用确认', progress=0)
        except Exception as exc:
            self._update(task, status='failed', phase='本地准备失败', error=str(exc) if isinstance(exc, ValueError) else '拆解准备失败，请检查视频和存储目录')

    def confirm(self, task_id, user, selection, quote_id):
        with self.lock:
            task = self._task(task_id, user)
            quote = task.get('quote', {})
            if task['status'] != 'awaiting-confirmation' or quote_id != quote.get('id') or time.time() > quote['expiresAt']:
                raise ValueError('确认已失效或已使用，请重新准备')
            if digest(self.providers()) != task['providersRevision']:
                raise ValueError('平台配置已改变，请重新准备')
            self._same_source(task, check_revision=True)
            selected = copy.deepcopy(selection)
            provider = next((p for p in self.providers() if p['id'] == selected.get('providerId')), {})
            if quote['visionCalls'] and (selected.get('model') not in provider.get('chat_models', []) or not vision_supported(provider, selected.get('model', ''))):
                raise ValueError('请选择已启用、支持读图和分析参数的模型')
            speech = selected.get('speech', {'mode': 'local'})
            if quote['audioCalls'] and speech.get('mode') == 'cloud':
                ap = next((p for p in self.providers() if p['id'] == speech.get('providerId') and p.get('enabled', True)), {})
                if ap.get('protocol', 'openai') != 'openai' or speech.get('model') not in ap.get('audio_timestamp_models', []):
                    raise ValueError('请选择已配置并兼容时间戳的音频模型')
            if speech.get('mode') not in {'local', 'cloud'}:
                raise ValueError('转写方式无效')
            task.update(selection=selected, remainingVision=quote['visionCalls'], remainingAudio=quote['audioCalls'], status='running', phase='分析镜头', progress=0)
            self._persist(task)
            self.pool.submit(self._analyze, task)
            return self._public(task)

    def _consume(self, task, kind):
        with self.lock:
            if self._cancelled(task):
                raise VideoCancelled('任务已取消')
            if digest(self.providers()) != task['providersRevision']:
                raise ValueError('平台配置变化，已停止整批调用')
            self._same_source(task)
            field = 'remaining' + kind
            if task[field] <= 0:
                raise ValueError('本批调用授权已耗尽')
            task[field] -= 1
            self._persist(task)

    def _analyze(self, task):
        asyncio.run(self._analyze_async(task))

    async def _analyze_async(self, task):
        semaphore = asyncio.Semaphore(4)
        cancelled = lambda: self._cancelled(task)
        custom = [c for c in task['columns'] if c['kind'] == 'custom']
        rows = copy.deepcopy(task['rows'])
        done = 0
        row_ids = task.get('retryRowIds') or [r['id'] for r in rows]
        targets = [] if task.get('speechOnly') else [r for r in rows if r['id'] in row_ids]

        async def analyze(row):
            nonlocal done
            async with semaphore:
                if cancelled():
                    return
                a, b = row['startSeconds'], row['endSeconds']
                seconds = [round(a+(b-a)*p, 3) for p in (.08, .5, .92)]
                extracted = await asyncio.to_thread(self.media[task['id']].extract_frames, task['context'], seconds, cancelled=cancelled)
                # 授权问题是全批失败，不伪装为某一镜的读图失败。
                if cancelled():
                    return
                if not extracted['failures'] and len(extracted['frames']) == 3:
                    self._consume(task, 'Vision')
                    try:
                        fields = dict(provider=task['selection']['providerId'], model=task['selection']['model'], images=[f['url'] for f in extracted['frames']],
                            temperature=.2, max_tokens=4000, message=f'镜头 {row["index"]}，{a}–{b} 秒。这三帧是同一镜头的首、中、尾画面。',
                            system_prompt='分析同一镜头全部画面，只返回一个 JSON 对象。汇总所有帧的字幕、价格和角标。shotSize 为极特写/特写/近景/中景/全景/远景；mood 为2–4字；visual 为30–60字中文事实；onScreenText 多条用 / 分隔，无则空；imagePrompt 描述主体、构图、光线、材质、风格；motionPrompt 描述运镜与动作演进。不要猜测对白。所有字段必须是字符串。自定义字段：'+json.dumps({c['id']:c.get('hint') or c['label'] for c in custom}, ensure_ascii=False))
                        response = await self.call_vision(fields)
                        result = parse_analysis(response.get('text'), custom)
                        row.update(imagePrompt=result.pop('imagePrompt'), motionPrompt=result.pop('motionPrompt'), keyframeUrl=extracted['frames'][1]['url'], visionFailed=False, failureReason='')
                        row['cells'].update(result, motion=row['motionPrompt'])
                        row['usage'] = response.get('raw_usage')
                    except Exception:
                        row.update(visionFailed=True, failureReason='模型未读出完整镜头内容，请检查模型的读图能力或重试')
                else:
                    row.update(visionFailed=True, failureReason='镜头抽帧失败，请检查素材后重试')
                    if extracted['frames']:
                        row['keyframeUrl'] = extracted['frames'][0]['url']
                done += 1
                self._update(task, rows=copy.deepcopy(rows), progress=done/max(1, len(targets))*100, progressDetail=f'{done}/{len(targets)}')

        async def speech():
            if not task['quote']['audioCalls']:
                return task.get('speech', {'status':'failed' if task['audio'].get('error') else 'no-audio', 'error':task['audio'].get('error','')})
            self._consume(task, 'Audio')
            try:
                if not self.transcribe:
                    raise ValueError('语音引擎尚未安装，请安装后重试或显式选择云端')
                result = await asyncio.to_thread(self.transcribe, task['audio'], task['selection'].get('speech', {'mode':'local'}),
                    cancelled=cancelled, on_progress=lambda phase, progress: self._update(task, speechProgress=phase))
                return {**result, 'status':'ready' if result.get('segments') else 'no-speech'}
            except VideoCancelled:
                return {'status':'cancelled', 'segments':[]}
            except Exception as exc:
                return {'status':'failed', 'error':str(exc) if isinstance(exc, ValueError) else '转写失败，请检查语音模型配置', 'segments':[]}

        try:
            values = await asyncio.gather(*[analyze(r) for r in targets], speech())
            sr = values[-1]
            if sr.get('status') in {'ready', 'no-speech'}:
                for row in rows:
                    row['cells']['dialogue'] = ''
                    row['carriedOver'] = False
                for segment in sr.get('segments', []):
                    start, end = segment['start'], segment['end']
                    index = next((i for i,r in enumerate(rows) if start < r['endSeconds']), len(rows)-1)
                    if index >= 0:
                        rows[index]['cells']['dialogue'] = (rows[index]['cells']['dialogue']+' '+segment['text']).strip()
                        for later in rows[index+1:]:
                            if later['startSeconds'] < end:
                                later['carriedOver'] = True
            failures = sum(r['visionFailed'] for r in rows)
            self._update(task, status='ready', rows=rows, speech=sr, phase='镜头表完成', progress=100,
                error=(f'{failures} 个镜头未读出，可单镜重试。' if failures else '') + (sr.get('error','') if sr.get('status')=='failed' else ''))
        except VideoCancelled:
            pass
        except Exception as exc:
            self.events[task['id']].set()
            self._update(task, status='failed', rows=rows, failureKind='authorization', error=str(exc) if isinstance(exc, ValueError) else '整批分析中断，请重新确认')


def create_video_deconstruction_router(*, manager, user_id, speech_engine):
    router = APIRouter(prefix='/api/canvas-video-deconstruction')
    def invoke(fn, *args):
        try:
            return fn(*args)
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc
    @router.post('/prepare')
    def prepare(payload: dict, request: Request, x_user_id: str = Header(default='')):
        return invoke(manager().prepare, payload.get('context'), user_id(x_user_id, request), payload.get('mode'), payload.get('options', {}))
    @router.get('/tasks/{task_id}')
    def get(task_id: str, request: Request, x_user_id: str = Header(default='')):
        return invoke(manager().get, task_id, user_id(x_user_id, request))
    @router.post('/tasks/{task_id}/cancel')
    def cancel(task_id: str, request: Request, x_user_id: str = Header(default='')):
        return invoke(manager().cancel, task_id, user_id(x_user_id, request))
    @router.post('/tasks/{task_id}/confirm')
    def confirm(task_id: str, payload: dict, request: Request, x_user_id: str = Header(default='')):
        return invoke(manager().confirm, task_id, user_id(x_user_id, request), payload.get('selection', {}), payload.get('quoteId'))
    @router.get('/models')
    def models():
        return {'providers':[dict(id=p['id'], name=p.get('name',p['id']), models=[dict(id=m,enabled=bool(vision_supported(p,m))) for m in p.get('chat_models',[])],
                                 audioModels=p.get('audio_timestamp_models',[]) if p.get('protocol','openai')=='openai' else [], imageModels=p.get('image_models',[]))
                             for p in manager().providers() if p.get('enabled',True)], 'localSpeech':speech_engine().installation_status()}
    @router.post('/speech/install')
    def install():
        return speech_engine().start_install()
    @router.get('/speech/install')
    def installation():
        return speech_engine().installation_status()
    return router
