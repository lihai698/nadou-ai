"""分镜分析专用的本地 llama.cpp 连接；不读取云端平台或密钥。"""
from __future__ import annotations

import asyncio
import base64
import json
import io
import subprocess
import threading
import time
from pathlib import Path

import httpx
from PIL import Image
from backend.canvas_video_media import VideoCancelled


class LocalVideoVision:
    def __init__(self, data_dir, resolve_image):
        self.config_path = Path(data_dir) / 'local_video_vision.json'
        self.resolve_image = resolve_image
        self.lock = threading.RLock()
        self.process = None
        self.users = 0
        self.inference_lock = threading.Lock()

    def _config(self):
        if not self.config_path.is_file():
            return {}
        return json.loads(self.config_path.read_text(encoding='utf8'))

    def _model(self):
        with httpx.Client(timeout=3, trust_env=False) as client:
            response = client.get('http://127.0.0.1:8085/v1/models')
            response.raise_for_status()
            models = response.json().get('data', [])
        if not models:
            raise ValueError('本地视觉服务未提供模型')
        return models[0]['id']

    def acquire(self, cancelled=lambda:False):
        with self.lock:
            try:
                model = self._model()
            except (httpx.HTTPError, ValueError):
                config = self._config()
                executable = Path(config.get('executable', ''))
                model_path = Path(config.get('model', ''))
                projector = Path(config.get('projector', ''))
                if not all(p.is_file() for p in (executable, model_path, projector)):
                    raise ValueError('本地视觉模型未就绪，请先配置本机 llama.cpp 与视觉模型文件')
                # 仅管理本功能启动的进程，不关闭用户自行启动的模型服务。
                if self.process is None or self.process.poll() is not None:
                    self.process = subprocess.Popen([
                        str(executable), '-m', str(model_path), '--mmproj', str(projector),
                        '--host', '127.0.0.1', '--port', '8085', '-c', '8192',
                        '--parallel', '1', '--fit', 'on', '--fit-target', '4096',
                        '--reasoning', 'off', '--alias', 'nadou-local-vision', '--jinja',
                    ], cwd=executable.parent, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                        creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                deadline = time.monotonic() + 180
                try:
                    while True:
                        if cancelled():raise ValueError('本地模型加载已取消')
                        if self.process.poll() is not None:raise ValueError('本地视觉模型启动失败，请检查显存和模型文件')
                        try:
                            model = self._model()
                            break
                        except (httpx.HTTPError, ValueError):
                            if time.monotonic() >= deadline:raise ValueError('本地视觉模型加载超时')
                            time.sleep(.5)
                except Exception:
                    if self.users == 0:self._stop()
                    raise
            self.users += 1
            return model

    def _stop(self):
        if self.process is not None:
            self.process.terminate()
            try:self.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait()
            self.process = None

    def release(self):
        with self.lock:
            self.users = max(0, self.users-1)
            if self.users == 0:self._stop()

    async def analyze(self, fields):
        # 多个任务可能运行于不同的 asyncio.run 事件循环，串行由线程锁控制。
        return await asyncio.to_thread(self._analyze, fields)

    def _analyze(self, fields):
        content = [{'type':'text', 'text':fields['message']}]
        for url in fields['images']:
            path = Path(self.resolve_image(url))
            # 多帧覆盖动作演进，限制像素数为专业分析与两个提示词留出输出空间。
            with Image.open(path) as original:
                frame = original.convert('RGB')
                frame.thumbnail((512, 512))
                buffer = io.BytesIO()
                frame.save(buffer, format='JPEG', quality=90)
            encoded = base64.b64encode(buffer.getvalue()).decode('ascii')
            content.append({'type':'image_url', 'image_url':{'url':'data:image/jpeg;base64,'+encoded}})
        with self.inference_lock:
            if fields.get('cancelled', lambda:False)():raise VideoCancelled('本地分析已取消')
            with httpx.Client(timeout=600, trust_env=False) as client:
                response = client.post('http://127.0.0.1:8085/v1/chat/completions', json={
                    'model':fields['model'], 'messages':[
                        {'role':'system','content':fields['system_prompt']}, {'role':'user','content':content}],
                    'max_tokens':min(4000, max(1200, int(fields.get('max_tokens', 2800)))), 'temperature':.2, 'stream':False,
                    'chat_template_kwargs':{'enable_thinking':False},
                })
                response.raise_for_status()
                result = response.json()
        choice = result['choices'][0]
        if choice.get('finish_reason') == 'length':
            raise ValueError('本地模型输出被截断，请检查上下文容量后重试')
        return {'text':choice['message']['content'], 'raw_usage':result.get('usage')}
