"""普通画布的真实 MP4 剪辑导出。入口注入存储路径，不反向依赖 main。"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import copy
import hashlib
import http.client
import ipaddress
import json
import math
import os
from pathlib import Path
import shutil
import socket
import ssl
import subprocess
import tempfile
import threading
import time
from urllib.parse import urljoin, urlsplit
import uuid

from backend.atomic_json import write_json_atomic

FPS = 30
MAX_FRAMES = 30 * 60 * 60 * 6
MAX_REMOTE_BYTES = 200 * 1024 * 1024
TERMINAL = {"succeeded", "failed"}
MEDIA_DEMUXERS = "mov,matroska,avi,mpeg,mpegts,ogg,flv,gif,image2,png_pipe,jpeg_pipe,bmp_pipe,webp_pipe,tiff_pipe"


class CanvasClipConflict(ValueError):
    """同一请求的数据发生变化，或同节点仍在导出。"""


def find_media_tools(data_dir=None):
    """优先系统工具，再复用已安装的深度运行包或本机工具缓存。"""
    ffmpeg, ffprobe = shutil.which("ffmpeg"), shutil.which("ffprobe")
    if ffmpeg and ffprobe:
        return ffmpeg, ffprobe
    roots = []
    data_roots = [Path(data_dir)] if data_dir else []
    # 工具安装与测试/用户切换的数据目录独立；已有安装继续可用。
    installed_data = Path(__file__).resolve().parents[1] / "data"
    if installed_data not in data_roots:
        data_roots.append(installed_data)
    for data_root in data_roots:
        roots.extend(data_root / "depth_capture" / "runtimes" / v / "bin" for v in ("cpu", "cuda"))
    roots.append(Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "nadou-ai" / "tools" / "ffmpeg" / "bin")
    for root in roots:
        for suffix in (".exe", ""):
            a, b = root / ("ffmpeg" + suffix), root / ("ffprobe" + suffix)
            if a.is_file() and b.is_file():
                return str(a), str(b)
    raise ValueError("未找到 FFmpeg 和 FFprobe，请安装剪辑导出组件后重试")


def validate_public_media_url(url):
    """返回公网 IP 快照；下载直连此 IP，避免检查后 DNS 改指向内网。"""
    try:
        parsed = urlsplit(url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("素材地址必须是无账号密码的公网 HTTP/HTTPS 地址")
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        if port not in {80, 443}:
            raise ValueError("远程素材只支持公网 HTTP/HTTPS 标准端口")
        if any(ord(char) < 32 for char in url):
            raise ValueError("远程素材地址包含非法字符")
        addresses = list(dict.fromkeys(item[4][0] for item in socket.getaddrinfo(parsed.hostname, port, type=socket.SOCK_STREAM)))
        if not addresses or any(not ipaddress.ip_address(address).is_global for address in addresses):
            raise ValueError("远程素材不允许访问内网、本机或保留地址")
        return parsed, port, addresses
    except (OSError, OverflowError) as exc:
        raise ValueError("远程素材域名无法解析，请检查地址") from exc


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, hostname, ip, port):
        super().__init__(hostname, port, timeout=30, context=ssl.create_default_context())
        self.connect_ip = ip

    def connect(self):
        self.sock = socket.create_connection((self.connect_ip, self.port), self.timeout)
        self.sock = self._context.wrap_socket(self.sock, server_hostname=self.host)


def download_public_media(url, destination):
    """受限流式下载：不记录签名 URL，逐跳检查重定向，不允许内网代理。"""
    deadline = time.monotonic() + 120
    for _ in range(6):
        parsed, port, addresses = validate_public_media_url(url)
        connection = (_PinnedHTTPSConnection(parsed.hostname, addresses[0], port) if parsed.scheme == "https"
                      else http.client.HTTPConnection(addresses[0], port, timeout=30))
        try:
            host = parsed.hostname if port == (443 if parsed.scheme == "https" else 80) else f"{parsed.hostname}:{port}"
            path = parsed.path or "/"
            if parsed.query:
                path += "?" + parsed.query
            connection.request("GET", path, headers={"Host": host, "User-Agent": "ComfyUI-API-Modelscope/1.0"})
            response = connection.getresponse()
            if response.status in {301, 302, 303, 307, 308}:
                target = response.getheader("Location")
                if not target:
                    raise ValueError("远程素材重定向无目标地址")
                url = urljoin(url, target)
                continue
            if response.status != 200:
                raise ValueError(f"远程素材下载失败（HTTP {response.status}）")
            if int(response.getheader("Content-Length", "0")) > MAX_REMOTE_BYTES:
                raise ValueError("远程素材超过 200 MB，请先保存到本地素材库")
            count = 0
            with Path(destination).open("wb") as output:
                while chunk := response.read(256 * 1024):
                    count += len(chunk)
                    if count > MAX_REMOTE_BYTES or time.monotonic() > deadline:
                        raise ValueError("远程素材下载超限或超时，请先保存到本地素材库")
                    output.write(chunk)
            if not count:
                raise ValueError("远程素材为空")
            return
        except (OSError, http.client.HTTPException) as exc:
            raise ValueError("远程素材下载失败，请检查地址或网络连接") from exc
        finally:
            connection.close()
    raise ValueError("远程素材重定向次数过多")


def _integer(value, name, minimum=0):
    if type(value) is not int or not minimum <= value <= MAX_FRAMES:
        raise ValueError(f"{name}必须是合法整数帧")
    return value


class CanvasClipManager:
    def __init__(self, data_dir, output_dir, output_url, local_path, allowed_roots, *, tools=None, rewrite_url=None):
        self.root = Path(data_dir) / "canvas_clip"
        self.output_dir = Path(output_dir).resolve()
        self.output_url = output_url
        self.local_path = local_path
        self.allowed_roots = [Path(root).resolve() for root in allowed_roots if root]
        self.tools = tools
        self.rewrite_url = rewrite_url or (lambda url: url)
        self.lock = threading.RLock()
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="canvas-clip")
        self.tasks = {}
        self.requests = {}
        self.root.mkdir(parents=True, exist_ok=True)
        for path in self.root.glob("*.json"):
            try:
                task = json.loads(path.read_text(encoding="utf-8"))
                if task["id"] != path.stem:
                    continue
                if task["status"] not in TERMINAL:
                    task.update(status="failed", error="服务重启中断了剪辑导出，编辑和已完成结果保留，请重试")
                    write_json_atomic(path, task)
                self.tasks[task["id"]] = task
                self.requests[(task["canvas_id"], task["node_id"], task["request_id"])] = task["id"]
            except (OSError, ValueError, KeyError, TypeError):
                # 不覆盖损坏记录，也不让一份损坏状态阻止其余任务查询。
                continue

    def close(self):
        self.executor.shutdown(wait=True)

    def _resolve_local(self, url):
        try:
            path = self.local_path(url)
        except Exception as exc:
            raise ValueError("素材路径无效或超出本地素材目录") from exc
        if not path:
            raise ValueError("素材文件不存在，请重新选择已有图片或视频")
        source = Path(path).resolve()
        if not any(source.is_relative_to(root) for root in self.allowed_roots):
            raise ValueError("素材路径超出本地素材目录")
        if not source.is_file():
            raise ValueError("素材文件不存在")
        return str(source)

    def _validate(self, payload):
        if not isinstance(payload, dict):
            raise ValueError("导出参数无效")
        for key in ("canvas_id", "node_id", "request_id"):
            if not isinstance(payload.get(key), str) or not 1 <= len(payload[key]) <= 120 or any(ord(c) < 32 for c in payload[key]):
                raise ValueError("画布、节点和请求编号不能为空或过长")
        if payload.get("scope") not in {"full", "segments"}:
            raise ValueError("导出范围必须是 full 或 segments")
        data = payload.get("clipData")
        if not isinstance(data, dict) or type(data.get("version")) is not int or data["version"] != 1 or type(data.get("fps")) is not int or data["fps"] != FPS:
            raise ValueError("剪辑数据版本无效，当前只支持 30fps")
        if type(data.get("exportMuted", False)) is not bool:
            raise ValueError("导出静音设置必须为布尔值")
        clips = data.get("clips")
        if not isinstance(clips, list) or not 1 <= len(clips) <= 200:
            raise ValueError("请添加 1–200 个图片或视频片段再导出")
        ids = set()
        normalized = []
        for clip in clips:
            if not isinstance(clip, dict) or not isinstance(clip.get("id"), str) or not clip["id"] or len(clip["id"]) > 120 or clip["id"] in ids:
                raise ValueError("片段编号无效或重复")
            ids.add(clip["id"])
            if clip.get("kind") not in {"image", "video"}:
                raise ValueError("剪辑只支持图片和视频，不支持独立音频")
            start = _integer(clip.get("startFrame"), "片段开始")
            end = _integer(clip.get("endFrame"), "片段结束", 1)
            offset = _integer(clip.get("sourceOffsetFrames", 0), "源素材偏移")
            if end <= start:
                raise ValueError("片段必须至少保留 1 帧")
            url = clip.get("url")
            if not isinstance(url, str) or not url or len(url) > 8192:
                raise ValueError("片段素材地址为空或无效")
            url = self.rewrite_url(url)
            if url.startswith(("http://", "https://")):
                validate_public_media_url(url)
            else:
                self._resolve_local(url)
            normalized.append({"id": clip["id"], "kind": clip["kind"], "url": url,
                "startFrame": start, "endFrame": end, "sourceOffsetFrames": offset})
        normalized.sort(key=lambda clip: clip["startFrame"])
        if any(a["endFrame"] > b["startFrame"] for a, b in zip(normalized, normalized[1:])):
            raise ValueError("片段重叠，请调整时间线后导出")
        return {"canvas_id": payload["canvas_id"], "node_id": payload["node_id"], "request_id": payload["request_id"],
                "scope": payload["scope"], "clipData": {"version": 1, "fps": FPS, "exportMuted": data.get("exportMuted", False), "clips": normalized}}

    def create(self, payload):
        payload = self._validate(copy.deepcopy(payload))
        fingerprint = hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        key = (payload["canvas_id"], payload["node_id"], payload["request_id"])
        with self.lock:
            previous = self.requests.get(key)
            if previous:
                task = self.tasks[previous]
                if task["fingerprint"] != fingerprint:
                    raise CanvasClipConflict("该请求编号已经用于其他导出内容，请重试")
                return self.get(previous)
            if any(t["canvas_id"] == key[0] and t["node_id"] == key[1] and t["status"] not in TERMINAL for t in self.tasks.values()):
                raise CanvasClipConflict("此剪辑节点正在导出，请等待当前任务完成")
            task_id = uuid.uuid4().hex
            task = {"id": task_id, "status": "queued", "canvas_id": key[0], "node_id": key[1], "progress": 0,
                    "error": "", "results": [], "request_id": key[2], "fingerprint": fingerprint}
            self.tasks[task_id] = task
            self.requests[key] = task_id
            self._update(task_id)
            self.executor.submit(self._run, task_id, payload)
            return self.get(task_id)

    def get(self, task_id):
        with self.lock:
            task = self.tasks.get(task_id)
            return copy.deepcopy({k: v for k, v in task.items() if k not in {"request_id", "fingerprint"}}) if task else None

    def _update(self, task_id, **fields):
        with self.lock:
            self.tasks[task_id].update(fields)
            write_json_atomic(self.root / f"{task_id}.json", self.tasks[task_id])

    def _command(self, command, label, timeout=900):
        try:
            process = subprocess.run(command, capture_output=True, timeout=timeout)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise ValueError(f"{label}失败：工具不可用或处理超时") from exc
        if process.returncode:
            # FFmpeg 日志可能含签名地址或本机路径；不直接回传。
            raise ValueError(f"{label}失败：素材可能损坏或编码不支持，请检查素材后重试")
        return process.stdout

    def _probe(self, path):
        raw = self._command([self.tools[1], "-v", "error", "-protocol_whitelist", "file,pipe", "-format_whitelist", MEDIA_DEMUXERS,
                             "-show_streams", "-show_format", "-of", "json", str(path)], "媒体探测", 30)
        try:
            info = json.loads(raw)
            video = next(stream for stream in info["streams"] if stream.get("codec_type") == "video")
            duration = float(video.get("duration") or info.get("format", {}).get("duration") or 0)
            if not math.isfinite(duration) or duration < 0:
                raise ValueError()
            return duration, video, any(stream.get("codec_type") == "audio" for stream in info["streams"])
        except (ValueError, KeyError, StopIteration, TypeError) as exc:
            raise ValueError("素材中没有可解码的视频或图片") from exc

    def _render(self, clip, frames, source, target, muted):
        seconds = frames / FPS
        args = [self.tools[0], "-hide_banner", "-loglevel", "error", "-y", "-nostdin"]
        has_audio = False
        if clip is None:
            args += ["-f", "lavfi", "-i", "color=black:s=1920x1080:r=30"]
        else:
            duration, _, has_audio = self._probe(source)
            if clip["kind"] == "video":
                if duration <= 0 or clip["sourceOffsetFrames"] + frames > math.ceil(duration * FPS - 0.001):
                    raise ValueError("裁剪超出视频真实时长，请重新确认源素材时长")
                args += ["-ss", f"{clip['sourceOffsetFrames']/FPS:.9f}", "-protocol_whitelist", "file,pipe", "-format_whitelist", MEDIA_DEMUXERS, "-i", str(source)]
            else:
                has_audio = False
                args += ["-loop", "1", "-framerate", str(FPS), "-protocol_whitelist", "file,pipe", "-format_whitelist", MEDIA_DEMUXERS, "-i", str(source)]
        if not muted and not has_audio:
            args += ["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000"]
        args += ["-map", "0:v:0", "-vf", f"fps=30,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,trim=end_frame={frames},setpts=PTS-STARTPTS",
                 "-t", f"{seconds:.9f}", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-threads", "2"]
        if muted:
            args += ["-an"]
        else:
            args += ["-map", "0:a:0" if has_audio else "1:a:0", "-af", f"aresample=48000,apad,atrim=duration={seconds:.9f},asetpts=PTS-STARTPTS", "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2"]
        # MOV 同时支持无压缩音频与精确的 1/30 秒视频时间基；MKV 的毫秒时间基
        # 会使短片段在 MP4 封装后成为近似帧率，并在重复拼接时累积误差。
        self._command(args + ["-video_track_timescale", "15360", str(target)], "片段渲染")

    def _finalize(self, parts, frames, target, muted, work):
        manifest = work / "concat.txt"
        # 中间文件名由本任务生成，不插入素材路径或用户文本。
        manifest.write_text("".join(f"file '{part.name}'\n" for part in parts), encoding="utf-8")
        args = [self.tools[0], "-hide_banner", "-loglevel", "error", "-y", "-nostdin", "-f", "concat", "-safe", "1", "-i", str(manifest), "-map", "0:v:0", "-c:v", "copy", "-t", f"{frames/FPS:.9f}"]
        args += ["-an"] if muted else ["-map", "0:a:0", "-c:a", "aac", "-ar", "48000", "-ac", "2"]
        self._command(args + ["-movflags", "+faststart", str(target)], "成片封装")
        duration, video, has_audio = self._probe(target)
        if (video.get("codec_name") != "h264" or video.get("width") != 1920 or video.get("height") != 1080
            or video.get("pix_fmt") != "yuv420p" or video.get("r_frame_rate") != "30/1"
            or has_audio == muted or abs(duration - frames/FPS) > 2/FPS):
            raise ValueError("成片规格或时长校验失败，请重试")
        return duration

    def _source(self, clip, work, cache):
        url = clip["url"]
        if url not in cache:
            if url.startswith(("http://", "https://")):
                source = work / f"source-{len(cache):03d}.bin"
                download_public_media(url, source)
                cache[url] = str(source)
            else:
                cache[url] = self._resolve_local(url)
        return cache[url]

    def _run(self, task_id, payload):
        try:
            self.tools = self.tools or find_media_tools(self.root.parent)
            self.output_dir.mkdir(parents=True, exist_ok=True)
            self._update(task_id, status="running", progress=1)
            clips = payload["clipData"]["clips"]
            muted = payload["clipData"]["exportMuted"]
            results, errors = [], []
            with tempfile.TemporaryDirectory(prefix="nadou-clip-") as directory:
                work = Path(directory)
                cache = {}
                if payload["scope"] == "segments":
                    for index, clip in enumerate(clips):
                        name = f"clip-{index+1:03d}-{task_id}.mp4"
                        target = self.output_dir / name
                        try:
                            source = self._source(clip, work, cache)
                            part = work / f"part-{index:03d}.mov"
                            frames = clip["endFrame"] - clip["startFrame"]
                            self._render(clip, frames, source, part, muted)
                            duration = self._finalize([part], frames, target, muted, work)
                            results.append({"url": self.output_url(name), "durationSeconds": duration, "sourceClipId": clip["id"], "name": name})
                        except Exception as exc:
                            target.unlink(missing_ok=True)
                            errors.append(f"片段 {clip['id']}：{self._error(exc)}")
                        self._update(task_id, results=copy.deepcopy(results), progress=int((index+1)/len(clips)*99))
                else:
                    parts, cursor = [], 0
                    for index, clip in enumerate(clips):
                        if clip["startFrame"] > cursor:
                            part = work / f"part-{len(parts):03d}.mov"
                            self._render(None, clip["startFrame"] - cursor, None, part, muted)
                            parts.append(part)
                        source = self._source(clip, work, cache)
                        part = work / f"part-{len(parts):03d}.mov"
                        self._render(clip, clip["endFrame"] - clip["startFrame"], source, part, muted)
                        parts.append(part)
                        cursor = clip["endFrame"]
                        self._update(task_id, progress=int((index+1)/len(clips)*85))
                    name = f"clip-full-{task_id}.mp4"
                    target = self.output_dir / name
                    try:
                        duration = self._finalize(parts, cursor, target, muted, work)
                        results.append({"url": self.output_url(name), "durationSeconds": duration, "sourceClipId": None, "name": name})
                    except Exception:
                        target.unlink(missing_ok=True)
                        raise
            error = (("部分片段导出失败，已完成结果保留。" if results else "片段导出失败。") + "；".join(errors)) if errors else ""
            self._update(task_id, status="failed" if errors else "succeeded", progress=100, results=results, error=error)
        except Exception as exc:
            self._update(task_id, status="failed", error=self._error(exc))

    @staticmethod
    def _error(exc):
        return str(exc)[:1200] if isinstance(exc, ValueError) else "剪辑导出失败，请检查素材及输出目录后重试"
