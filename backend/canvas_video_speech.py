"""按需安装开放本地组件，或使用用户配置的兼容云端时间戳转写。"""
from __future__ import annotations

import hashlib
import json
import math
import os
import shutil
import subprocess
import tempfile
import threading
import uuid
import zipfile
from pathlib import Path

import httpx
from backend.atomic_json import write_json_atomic
from backend.canvas_video_media import VideoCancelled


def normalize_segments(values):
    if not isinstance(values, list):
        raise ValueError('音频模型没有返回真实时间戳 segments，不能分配镜头对白')
    result = []
    for item in values:
        if not isinstance(item, dict) or not isinstance(item.get('text'), str):
            raise ValueError('转写分段格式无效')
        a, b = item.get('start'), item.get('end')
        if not isinstance(a, (int, float)) or not isinstance(b, (int, float)) or not math.isfinite(a+b) or a < 0 or b < a:
            raise ValueError('转写时间戳无效')
        text = item['text'].strip()
        if text:
            result.append(dict(start=float(a), end=float(b), text=text))
    return sorted(result, key=lambda x:x['start'])


def transcribe_chunks(duration, transcribe, *, cancelled=lambda:False, on_progress=lambda *args:None):
    cursor, result, index = 0, [], 0
    while cursor < duration:
        if cancelled():
            return result
        index += 1
        nominal_end = min(duration, cursor+300)
        end = min(duration, cursor+330)
        on_progress(f'转写第 {index} 段（{int(cursor)}–{int(end)} 秒）', cursor/duration*100)
        for attempt in range(2):
            if cancelled():
                return result
            try:
                segments = normalize_segments(transcribe(cursor, end-cursor))
                break
            except VideoCancelled:
                return result
            except Exception as exc:
                if attempt:
                    raise ValueError(f'第 {index} 段转写失败，已重试一次；请重试对白或显式选择云端') from exc
        accepted = [dict(start=cursor+s['start'], end=min(duration,cursor+s['end']), text=s['text'])
                    for s in segments if s['start'] < nominal_end-cursor and s['start'] < duration-cursor]
        result.extend(accepted)
        cursor = max(nominal_end, max((s['end'] for s in accepted), default=0), cursor+1)
    return result


def file_sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as handle:
        for chunk in iter(lambda:handle.read(1024*1024), b''):
            h.update(chunk)
    return h.hexdigest()


class VideoSpeech:
    def __init__(self, root, providers, api_key, media):
        self.root = Path(root) / 'video_speech'
        self.runtime = self.root / 'whisper.cpp-v1.8.2-cpu'
        self.providers, self.api_key, self.media = providers, api_key, media
        self.manifest = json.loads(Path(__file__).with_name('canvas_video_speech_assets.json').read_text(encoding='utf8'))
        self.lock = threading.RLock()
        self.install_state = {'status':'idle', 'downloadedBytes':0, 'error':''}
        self._verified = None

    def _health(self, directory):
        cli = next(directory.rglob('whisper-cli.exe'), None)
        if not cli:
            raise ValueError('本地转写引擎缺失，请重新安装')
        try:
            run = subprocess.run([str(cli), '--help'], capture_output=True, timeout=30, creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise ValueError('本地语音组件无法启动，请检查系统 DLL 或重新安装') from exc
        if run.returncode not in {0,1} or b'--vad' not in run.stderr+run.stdout:
            raise ValueError('本地转写引擎健康检查失败，请检查 DLL')
        return cli

    def _check_runtime(self):
        record = self.runtime / 'installation.json'
        if not record.exists():
            return False
        saved = json.loads(record.read_text(encoding='utf8'))
        signature = [(n, (self.runtime/n).stat().st_size, (self.runtime/n).stat().st_mtime_ns) for n in saved['hashes']]
        if signature == self._verified:
            return True
        for name, sha in saved['hashes'].items():
            path = (self.runtime/name).resolve()
            if not path.is_relative_to(self.runtime.resolve()) or file_sha(path) != sha:
                raise ValueError('本地语音组件校验失败，请重新安装')
        for asset in self.manifest['assets']:
            if asset['kind'] != 'engine' and saved['hashes'].get(asset['name']) != asset['sha256']:
                raise ValueError('本地语音权重不是已核对的多语言版本，请重新安装')
        self._health(self.runtime)
        self._verified = signature
        return True

    def installation_status(self):
        with self.lock:
            try:
                installed = self._check_runtime()
                error = self.install_state['error']
            except (OSError, ValueError, KeyError):
                installed, error = False, '本地组件损坏或无法启动，请重新安装'
            return {**self.install_state, 'installed':installed, 'error':error, 'totalBytes':sum(a['size'] for a in self.manifest['assets']),
                    'deviceNotice':'Windows CPU 转写可能较慢，首次下载约 579 MB；不自动改用云端。'}

    def start_install(self):
        with self.lock:
            if self.install_state['status'] != 'installing':
                self.install_state = {'status':'installing', 'downloadedBytes':0, 'error':''}
                threading.Thread(target=self._install_worker, daemon=True, name='video-speech-install').start()
            return self.installation_status()

    def _install_worker(self):
        try:
            self.install()
        except Exception as exc:
            with self.lock:
                self.install_state.update(status='failed', error=str(exc) if isinstance(exc,ValueError) else '组件下载或安装失败，请检查网络后重试')

    def install(self, *, cancelled=lambda:False, on_progress=lambda *args:None):
        self.root.mkdir(parents=True,exist_ok=True)
        stage = self.root / ('install-'+uuid.uuid4().hex)
        stage.mkdir()
        total = sum(a['size'] for a in self.manifest['assets'])
        downloaded = 0
        try:
            with httpx.Client(follow_redirects=True,timeout=120) as client:
                for asset in self.manifest['assets']:
                    target = stage / asset['name']
                    h = hashlib.sha256()
                    with client.stream('GET',asset['url']) as response:
                        response.raise_for_status()
                        with target.open('wb') as out:
                            for chunk in response.iter_bytes(1024*1024):
                                if cancelled():
                                    raise VideoCancelled('组件安装已取消')
                                downloaded += len(chunk)
                                if target.stat().st_size+len(chunk)>asset['size']:
                                    raise ValueError('组件体积与固定清单不符')
                                h.update(chunk);out.write(chunk)
                                with self.lock:
                                    self.install_state.update(downloadedBytes=downloaded)
                                on_progress(downloaded,total)
                    if target.stat().st_size!=asset['size'] or h.hexdigest()!=asset['sha256']:
                        raise ValueError('下载校验失败，已保留原有组件，请重试')
                    if asset['kind']=='engine':
                        with zipfile.ZipFile(target) as archive:
                            if sum(i.file_size for i in archive.infolist())>100*1024*1024:
                                raise ValueError('组件解压大小异常')
                            for member in archive.infolist():
                                destination = (stage/member.filename).resolve()
                                if not destination.is_relative_to(stage.resolve()) or member.external_attr >> 16 & 0o170000 == 0o120000:
                                    raise ValueError('组件压缩包含无效路径')
                            archive.extractall(stage)
                        target.unlink()
            self._health(stage)
            hashes = {p.relative_to(stage).as_posix():file_sha(p) for p in stage.rglob('*') if p.is_file()}
            write_json_atomic(stage/'installation.json',{'version':self.manifest['version'],'hashes':hashes})
            with self.lock:
                backup = self.root / ('previous-'+uuid.uuid4().hex)
                if self.runtime.exists():
                    self.runtime.rename(backup)
                try:
                    stage.rename(self.runtime)
                except OSError:
                    if backup.exists():backup.rename(self.runtime)
                    raise
                # 只清理本次替换的可重新安装组件，不涉及素材。
                if backup.exists():shutil.rmtree(backup)
                self._verified=None
                self.install_state.update(status='ready',error='',downloadedBytes=total)
        finally:
            if stage.exists():shutil.rmtree(stage)

    def transcribe(self, audio, selection, *, cancelled=lambda:False, on_progress=lambda *args:None):
        if cancelled():raise VideoCancelled('转写已取消')
        if selection.get('mode')=='cloud':
            provider = next((p for p in self.providers() if p['id']==selection.get('providerId') and p.get('enabled',True)),{})
            model=selection.get('model')
            if provider.get('protocol','openai')!='openai' or model not in provider.get('audio_models',[]) or model not in provider.get('audio_timestamp_models',[]):
                raise ValueError('音频模型未配置为兼容时间戳，请到 API 设置配置')
            key = self.api_key(provider['id'])
            if not key:raise ValueError('音频平台缺少 API Key，请到 API 设置配置')
            on_progress('云端对白转写',0)
            if cancelled():raise VideoCancelled('转写已取消')
            try:
                with Path(audio['path']).open('rb') as file, httpx.Client(timeout=1800) as client:
                    response = client.post(provider['base_url'].rstrip('/')+'/audio/transcriptions',headers={'Authorization':'Bearer '+key},
                        files={'file':('audio.mp3',file,'audio/mpeg')},data={'model':model,'response_format':'verbose_json'})
                    response.raise_for_status()
                    result=response.json()
            except (httpx.HTTPError,ValueError) as exc:
                raise ValueError('云端转写失败，请检查平台、模型和 verbose_json 时间戳兼容性') from exc
            segments=normalize_segments(result.get('segments'))
            return {'segments':segments,'hasSpeech':bool(segments),'detectedLanguage':result.get('language','')}
        if selection.get('mode')!='local':raise ValueError('请选择本地或云端转写')
        if not self.installation_status()['installed']:raise ValueError('本地语音组件尚未安装或损坏，请点击安装后重试')
        cli=self._health(self.runtime)
        model=self.runtime/'ggml-large-v3-turbo-q5_0.bin'
        vad=self.runtime/'ggml-silero-v6.2.0.bin'
        duration=audio['durationSeconds']
        detected_language=''
        with tempfile.TemporaryDirectory(prefix='speech-',dir=self.root) as temporary:
            folder=Path(temporary)
            def chunk(start,length):
                nonlocal detected_language
                if cancelled():raise VideoCancelled('转写已取消')
                wav=folder/'segment.wav';output=folder/'segment'
                self.media._command([self.media._tools()[0],'-v','error','-y','-ss',str(start),'-i',audio['path'],'-t',str(length),'-ar','16000','-ac','1',str(wav)],cancelled=cancelled)
                self.media._command([str(cli),'-m',str(model),'-f',str(wav),'-l','auto','--vad','--vad-model',str(vad),'-mc','0','-oj','-of',str(output)],cancelled=cancelled,timeout=7200)
                raw=json.loads(output.with_suffix('.json').read_text(encoding='utf8'))
                detected_language=raw.get('result',{}).get('language','') or detected_language
                return [{'start':s['offsets']['from']/1000,'end':s['offsets']['to']/1000,'text':s['text']} for s in raw.get('transcription',[])]
            segments=transcribe_chunks(duration,chunk,cancelled=cancelled,on_progress=on_progress)
        return {'segments':segments,'hasSpeech':bool(segments),'detectedLanguage':detected_language}
