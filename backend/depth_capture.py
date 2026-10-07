"""本机深度视频任务。运行包与权重使用固定版本和 SHA-256 校验。"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import threading
import time
import uuid
import zipfile
from urllib.parse import urlparse
from urllib.request import Request, urlopen


RELEASE = "https://github.com/glanderness/BeefTV/releases/download/depth-runtime-v2/"
MODEL_RELEASE = "https://github.com/glanderness/BeefTV/releases/download/v1.5.5/"
ARTIFACTS = {
    "cpu": {"name": "beeftv-depth-runtime-v1-windows-amd64-cpu.zip", "size": 857738351,
            "sha256": "5d9c15fbe8de486db0b013ae6a61597291fb7ee1a99c0733af544e7c198b41f8",
            "files": 22343, "expanded": 3801320819},
    "cuda": {"name": "beeftv-depth-runtime-v1-windows-amd64-cuda.zip", "size": 3705698493,
             "sha256": "0fb1f4a89fe64c3db2d04c490396a6056e9de9bc9151024f6a30cc8c30747305",
             "files": 22378, "expanded": 8058171080,
             "parts": [
                 ("part-001", 1610612736, "a92b8a33cfa1456a42467626e58530b281083f256ecd40a8b1c17fcfc81124ba"),
                 ("part-002", 1610612736, "e53c318b07743fa5604a96fd3adb8713bfdcc43cf38c8c9d1c628ec71061a67b"),
                 ("part-003", 484473021, "f37ad794508edbec74661734df5d1b128342ca268f63d62c48a8e73da30bfcbf"),
             ]},
}
MODEL = {"name": "video_depth_anything_vits.pth", "size": 116440756,
         "sha256": "13379300b739e659f076a59d52e9801bd8d38c541a7e71f73bbca4dcfb013609"}
VDA_SOURCE = {
    "name": "video-depth-anything-4f5ae231.zip", "size": 7905704,
    "sha256": "012dc88e5feb7e51f5794f9b8013f4c786aa3d61c60b8e0c3c5a45e1e0feb7c5",
    "url": "https://codeload.github.com/DepthAnything/Video-Depth-Anything/zip/4f5ae23172ba60fd7bc11ef671cca678842c7072",
    "top": "Video-Depth-Anything-4f5ae23172ba60fd7bc11ef671cca678842c7072",
}
POSE_MODEL = {
    "name": "pose_landmarker_lite.task", "size": 5777746,
    "sha256": "59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a",
    "url": "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
}
POSE_WHEELS = (
    ("mediapipe-0.10.35-py3-none-win_amd64.whl", 10905503,
     "b08f001cf3c3cd0d88d9ed68f3368dc8a4913f568281a93117f083115aa672ba",
     "https://files.pythonhosted.org/packages/5b/f6/763477e9aeed98accc984ed6ee3f11a21a0c5fd1d1c6586b8d07067748ff/mediapipe-0.10.35-py3-none-win_amd64.whl"),
    ("absl_py-2.3.1-py3-none-any.whl", 135811,
     "eeecf07f0c2a93ace0772c92e596ace6d3d3996c042b2128459aaae2a76de11d",
     "https://files.pythonhosted.org/packages/8f/aa/ba0014cc4659328dc818a28827be78e6d97312ab0cb98105a770924dc11e/absl_py-2.3.1-py3-none-any.whl"),
    ("flatbuffers-25.9.23-py2.py3-none-any.whl", 30869,
     "255538574d6cb6d0a79a17ec8bc0d30985913b87513a01cce8bcdb6b4c44d0e2",
     "https://files.pythonhosted.org/packages/ee/1b/00a78aa2e8fbd63f9af08c9c19e6deb3d5d66b4dda677a0f61654680ee89/flatbuffers-25.9.23-py2.py3-none-any.whl"),
    ("sounddevice-0.5.2-py3-none-win_amd64.whl", 363808,
     "e18944b767d2dac3771a7771bdd7ff7d3acd7d334e72c4bedab17d1aed5dbc22",
     "https://files.pythonhosted.org/packages/e1/3e/61d88e6b0a7383127cdc779195cb9d83ebcf11d39bc961de5777e457075e/sounddevice-0.5.2-py3-none-win_amd64.whl"),
    ("certifi-2026.7.22-py3-none-any.whl", 136983,
     "62f22742b58a1a33014a2b6b706588a8d7e2a88ae7bd1a6ebe8c992928483775",
     "https://files.pythonhosted.org/packages/0b/a7/71ac2cff56fec219ed242bb11b8efb69fcc4bec75db06fb7bfe35de520e6/certifi-2026.7.22-py3-none-any.whl"),
    ("cffi-2.0.0-cp311-cp311-win_amd64.whl", 182820,
     "66f011380d0e49ed280c789fbd08ff0d40968ee7b665575489afa95c98196ab5",
     "https://files.pythonhosted.org/packages/ae/8f/dc5531155e7070361eb1b7e4c1a9d896d0cb21c49f807a6c03fd63fc877e/cffi-2.0.0-cp311-cp311-win_amd64.whl"),
    ("pycparser-2.23-py3-none-any.whl", 118140,
     "e5c6e8d3fbad53479cab09ac03729e0a9faf2bee3db8208a550daf5af81a5934",
     "https://files.pythonhosted.org/packages/a0/e3/59cd50310fc9b59512193629e1984c1f95e5c8ae6e5d8c69532ccc65a7fe/pycparser-2.23-py3-none-any.whl"),
)
TERMINAL = {"succeeded", "failed", "cancelled"}


class Cancelled(Exception):
    pass


def verified_file(path: Path, size: int, digest: str, check=lambda: None) -> bool:
    if not path.is_file() or path.stat().st_size != size:
        return False
    sha = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            check()
            sha.update(chunk)
    return sha.hexdigest() == digest


def extract_runtime(archive: Path, destination: Path, artifact: dict | None = None, check=lambda: None):
    root = destination.resolve()
    with zipfile.ZipFile(archive) as package:
        entries = package.infolist()
        if artifact and (len(entries) != artifact["files"] or sum(item.file_size for item in entries) != artifact["expanded"]):
            raise ValueError("深度组件文件数量或体积校验失败")
        for item in entries:
            check()
            target = (destination / item.filename).resolve()
            if not target.is_relative_to(root) or item.filename.startswith(("/", "\\")) or ":" in item.filename:
                raise ValueError("深度组件包含非法路径")
            if ((item.external_attr >> 16) & 0o170000) == 0o120000:
                raise ValueError("深度组件包含不允许的符号链接")
            if item.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with package.open(item) as source, target.open("wb") as output:
                    while chunk := source.read(1024 * 1024):
                        check()
                        output.write(chunk)


def cuda_candidate():
    if os.name != "nt" or not shutil.which("nvidia-smi"):
        return False
    try:
        result = subprocess.run(["nvidia-smi", "--query-gpu=compute_cap", "--format=csv,noheader"],
                                capture_output=True, text=True, timeout=4)
        return result.returncode == 0 and any(float(line.strip()) >= 7.5 for line in result.stdout.splitlines())
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return False


class DepthCaptureManager:
    def __init__(self, data_dir, output_dir, output_url):
        self.root = Path(data_dir) / "depth_capture"
        self.output_dir = Path(output_dir)
        self.output_url = output_url
        self.lock = threading.RLock()
        self.install_lock = threading.Lock()
        self.tasks = {}
        self.events = {}
        self.processes = {}
        task_dir = self.root / "tasks"
        task_dir.mkdir(parents=True, exist_ok=True)
        for record in task_dir.glob("*.json"):
            try:
                task = json.loads(record.read_text(encoding="utf-8"))
                if task.get("status") not in TERMINAL:
                    task.update(status="failed", stage="运行中断", error="服务重启中断了任务，请重新生成")
                    self._save(task)
                self.tasks[task["id"]] = task
            except (OSError, ValueError, KeyError, TypeError):
                continue

    def _save(self, task):
        folder = self.root / "tasks"
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / f"{task['id']}.json"
        temp = folder / f".{task['id']}.{uuid.uuid4().hex}.tmp"
        temp.write_text(json.dumps(task, ensure_ascii=False), encoding="utf-8")
        os.replace(temp, path)

    def _update(self, task_id, **fields):
        with self.lock:
            task = self.tasks[task_id]
            if task["status"] == "cancelled" and fields.get("status") != "cancelled":
                return task.copy()
            task.update(fields, updated_at=time.time())
            self._save(task)
            return task.copy()

    def get(self, task_id):
        with self.lock:
            task = self.tasks.get(task_id)
            return task.copy() if task else None

    def create(self, source_url, source_path, operation_id=""):
        with self.lock:
            if operation_id:
                existing = next((task for task in self.tasks.values() if task.get("operation_id") == operation_id), None)
                if existing:
                    if existing["source_url"] != source_url:
                        raise ValueError("操作编号已用于另一个视频")
                    return existing.copy()
            task_id = uuid.uuid4().hex
            task = dict(id=task_id, source_url=source_url, source_path=source_path, operation_id=operation_id,
                        status="queued", stage="检查深度处理组件", progress=0, error="", result_url="",
                        created_at=time.time(), updated_at=time.time())
            self.tasks[task_id] = task
            self.events[task_id] = threading.Event()
            self._save(task)
        threading.Thread(target=self._run, args=(task_id,), daemon=True, name=f"depth-{task_id[:8]}").start()
        return task.copy()

    def cancel(self, task_id):
        with self.lock:
            task = self.tasks.get(task_id)
            if not task:
                return None
            if task["status"] in TERMINAL:
                return task.copy()
            self.events.setdefault(task_id, threading.Event()).set()
            process = self.processes.get(task_id)
        if process and process.poll() is None:
            if os.name == "nt":
                subprocess.run(["taskkill", "/T", "/F", "/PID", str(process.pid)], capture_output=True)
            else:
                process.kill()
        return self._update(task_id, status="cancelled", stage="已取消")

    def _check(self, task_id):
        if self.events[task_id].is_set():
            raise Cancelled()

    def _download(self, task_id, url, destination, artifact, label, start, span):
        destination.parent.mkdir(parents=True, exist_ok=True)
        check = lambda: self._check(task_id)
        if verified_file(destination, artifact["size"], artifact["sha256"], check):
            return
        part = destination.with_name(destination.name + ".download")
        offset = part.stat().st_size if part.exists() else 0
        if offset >= artifact["size"]:
            part.unlink()
            offset = 0
        for attempt in range(2):
            check()
            headers = {"User-Agent": "NadouAI-DepthCapture/1.0"}
            if offset:
                headers["Range"] = f"bytes={offset}-"
            with urlopen(Request(url, headers=headers), timeout=60) as response:
                host = urlparse(response.url).hostname or ""
                if host not in {"github.com", "codeload.github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com",
                                "files.pythonhosted.org", "storage.googleapis.com"}:
                    raise ValueError("组件下载跳转到未经允许的地址")
                if offset and response.status != 206:
                    offset = 0
                    continue
                if offset and not response.headers.get("Content-Range", "").startswith(f"bytes {offset}-"):
                    raise ValueError("下载源返回了错误的续传位置")
                transferred = offset
                last_report = 0
                with part.open("ab" if offset else "wb") as output:
                    while chunk := response.read(1024 * 1024):
                        check()
                        output.write(chunk)
                        transferred += len(chunk)
                        if time.monotonic() - last_report > .4:
                            percent = min(99, int(transferred * 100 / artifact["size"]))
                            self._update(task_id, stage=f"下载{label} {transferred/1048576:.1f}/{artifact['size']/1048576:.1f} MB（{percent}%）",
                                         progress=start + int(span * percent / 100), downloaded=transferred,
                                         total=artifact["size"])
                            last_report = time.monotonic()
            break
        else:
            raise ValueError("下载源不支持断点续传")
        if not verified_file(part, artifact["size"], artifact["sha256"], check):
            part.rename(part.with_name(part.name + ".corrupt"))
            raise ValueError(f"{label}校验失败，请重试")
        os.replace(part, destination)

    def _ensure_runtime(self, task_id, variant):
        artifact = ARTIFACTS[variant]
        runtime = self.root / "runtimes" / variant
        python = runtime / ".python" / "python.exe"
        worker = runtime / "worker"
        binary = runtime / "bin"
        model_dir = self.root / "models" / "video-depth-anything-small" / "v1"
        model_path = model_dir / "checkpoints" / MODEL["name"]
        with self.install_lock:
            self._check(task_id)
            marker = runtime / ".nadou-runtime-sha256"
            if not (python.is_file() and (worker / "depth_capture").is_dir()
                    and (binary / "ffprobe.exe").is_file() and (binary / "ffmpeg.exe").is_file()
                    and marker.is_file() and marker.read_text(encoding="ascii") == artifact["sha256"]):
                archive = self.root / "downloads" / artifact["name"]
                if not verified_file(archive, artifact["size"], artifact["sha256"], lambda: self._check(task_id)):
                    if variant == "cpu":
                        self._download(task_id, RELEASE + artifact["name"], archive, artifact, "CPU 组件", 1, 10)
                    else:
                        parts = []
                        for index, (suffix, size, digest) in enumerate(artifact["parts"]):
                            path = archive.with_name(archive.name + "." + suffix)
                            self._download(task_id, RELEASE + artifact["name"] + "." + suffix, path,
                                           {"size": size, "sha256": digest}, f"CUDA 组件 {index+1}/3", 1+index*3, 3)
                            parts.append(path)
                        assembled = archive.with_name(archive.name + ".assembling")
                        with assembled.open("wb") as output:
                            for path in parts:
                                self._check(task_id)
                                with path.open("rb") as source:
                                    while chunk := source.read(1024 * 1024):
                                        self._check(task_id)
                                        output.write(chunk)
                        if not verified_file(assembled, artifact["size"], artifact["sha256"], lambda: self._check(task_id)):
                            raise ValueError("CUDA 组件拼接校验失败")
                        os.replace(assembled, archive)
                required = artifact["expanded"] + MODEL["size"] + 1024**3
                if shutil.disk_usage(self.root).free < required:
                    raise ValueError("磁盘空间不足，无法安装深度处理组件")
                # Windows 默认 260 字符路径限制：解压时不能把完整任务 ID 放进目录名。
                stage = runtime.with_name("s" + uuid.uuid4().hex[:8])
                stage.mkdir(parents=True, exist_ok=False)
                try:
                    self._update(task_id, stage="校验并安装深度组件", progress=12)
                    extract_runtime(archive, stage, artifact, lambda: self._check(task_id))
                    if not (stage / ".python" / "python.exe").is_file() or not (stage / "worker" / "depth_capture").is_dir():
                        raise ValueError("深度组件缺少 Python 或模型程序")
                    (stage / ".nadou-runtime-sha256").write_text(artifact["sha256"], encoding="ascii")
                    if runtime.exists():
                        shutil.rmtree(runtime)
                    os.replace(stage, runtime)
                finally:
                    if stage.exists():
                        shutil.rmtree(stage)
            self._check(task_id)
            self._download(task_id, MODEL_RELEASE + MODEL["name"], model_path, MODEL, "Small 模型", 12, 8)
            source_dir = model_dir / "Video-Depth-Anything"
            source_marker = source_dir / ".nadou-source-sha256"
            if not (source_marker.is_file() and source_marker.read_text(encoding="ascii") == VDA_SOURCE["sha256"]
                    and (source_dir / "video_depth_anything" / "video_depth.py").is_file()):
                archive = self.root / "downloads" / VDA_SOURCE["name"]
                self._download(task_id, VDA_SOURCE["url"], archive, VDA_SOURCE, "深度模型源码", 18, 2)
                stage = self.root / "sources" / ("s" + uuid.uuid4().hex[:8])
                stage.mkdir(parents=True, exist_ok=False)
                try:
                    extract_runtime(archive, stage, check=lambda: self._check(task_id))
                    unpacked = stage / VDA_SOURCE["top"]
                    if not (unpacked / "video_depth_anything" / "video_depth.py").is_file():
                        raise ValueError("深度模型源码缺少推理程序")
                    (unpacked / ".nadou-source-sha256").write_text(VDA_SOURCE["sha256"], encoding="ascii")
                    if source_dir.exists():
                        shutil.rmtree(source_dir)
                    os.replace(unpacked, source_dir)
                finally:
                    if stage.exists():
                        shutil.rmtree(stage)
        return python, worker, model_dir, binary

    def _ensure_pose(self, task_id):
        packages = self.root / "pose_packages" / "mediapipe-0.10.35"
        marker = packages / ".nadou-pose-version"
        model = self.root / "models" / "mediapipe-pose-lite" / POSE_MODEL["name"]
        with self.install_lock:
            self._check(task_id)
            if not (marker.is_file() and marker.read_text(encoding="ascii") == POSE_MODEL["sha256"]
                    and (packages / "mediapipe" / "__init__.py").is_file()):
                stage = packages.with_name(packages.name + ".staging-" + task_id)
                stage.mkdir(parents=True, exist_ok=False)
                try:
                    for index, (name, size, digest, url) in enumerate(POSE_WHEELS):
                        archive = self.root / "downloads" / name
                        self._download(task_id, url, archive, {"size": size, "sha256": digest},
                                       f"姿态组件 {index + 1}/{len(POSE_WHEELS)}", 12, 2)
                        extract_runtime(archive, stage, check=lambda: self._check(task_id))
                    (stage / ".nadou-pose-version").write_text(POSE_MODEL["sha256"], encoding="ascii")
                    packages.parent.mkdir(parents=True, exist_ok=True)
                    if packages.exists():
                        shutil.rmtree(packages)
                    os.replace(stage, packages)
                finally:
                    if stage.exists():
                        shutil.rmtree(stage)
            self._download(task_id, POSE_MODEL["url"], model, POSE_MODEL, "姿态模型", 14, 4)
        return packages, model

    def _process(self, task_id, command, cwd, env, on_line=None):
        flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        process = subprocess.Popen(command, cwd=cwd, env=env, stdout=subprocess.PIPE,
                                   stderr=subprocess.STDOUT, text=True, errors="replace", bufsize=1,
                                   creationflags=flags)
        with self.lock:
            self.processes[task_id] = process
        last_lines = []
        try:
            for line in process.stdout:
                self._check(task_id)
                if line.strip():
                    last_lines.append(line.strip()[:250])
                    last_lines = last_lines[-4:]
                    if on_line:
                        on_line(line)
            code = process.wait()
            self._check(task_id)
            if code:
                raise RuntimeError("深度处理组件执行失败：" + " ".join(last_lines)[-400:])
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()
            with self.lock:
                self.processes.pop(task_id, None)

    def _probe(self, task_id, ffprobe, path):
        result = subprocess.run([str(ffprobe), "-v", "error", "-select_streams", "v:0",
                                 "-show_entries", "stream=width,height,avg_frame_rate,nb_frames,codec_name,pix_fmt:format=duration",
                                 "-of", "json", str(path)], capture_output=True, text=True, timeout=30)
        self._check(task_id)
        if result.returncode:
            raise ValueError("视频无法解码，请使用 MP4、MOV 或 WebM 文件")
        meta = json.loads(result.stdout)
        duration = float((meta.get("format") or {}).get("duration") or 0)
        streams = meta.get("streams") or []
        if not streams or duration <= 0:
            raise ValueError("视频缺少有效画面或时长")
        return duration, streams[0]

    def _run(self, task_id):
        task = self.get(task_id)
        work = self.root / "work" / task_id
        try:
            self._update(task_id, status="running", progress=1)
            if os.name != "nt" or sys.maxsize <= 2**32:
                raise ValueError("当前深度运行组件仅支持 64 位 Windows")
            source = Path(task["source_path"])
            if not source.is_file() or source.suffix.lower() not in {".mp4", ".mov", ".webm"}:
                raise ValueError("原视频已丢失或格式不支持")
            variant = "cuda" if cuda_candidate() else "cpu"
            try:
                python, worker, model, binary = self._ensure_runtime(task_id, variant)
                if variant == "cuda":
                    work.mkdir(parents=True, exist_ok=True)
                    env = dict(os.environ, PATH=str(binary) + os.pathsep + os.environ.get("PATH", ""),
                               BEEFTV_VDA_SOURCE=str(model / "Video-Depth-Anything"))
                    self._update(task_id, stage="验证 CUDA 深度模型", progress=20)
                    self._process(task_id, [str(python), "-m", "depth_capture.probe", "--device", "cuda",
                                            "--runtime-dir", str(model), "--work-dir", str(work)], worker, env)
            except (OSError, RuntimeError, ValueError) as exc:
                if variant != "cuda":
                    raise
                self._update(task_id, stage="CUDA 不可用，改用 CPU（可能耗时较长）", progress=10,
                             fallback_reason=str(exc)[:180])
                variant = "cpu"
                python, worker, model, binary = self._ensure_runtime(task_id, variant)
            self._check(task_id)
            self._update(task_id, stage="检查输入视频", progress=21, device=variant)
            duration, stream = self._probe(task_id, binary / "ffprobe.exe", source)
            fps_parts = str(stream.get("avg_frame_rate") or "0/1").split("/", 1)
            fps = float(fps_parts[0]) / float(fps_parts[1]) if len(fps_parts) == 2 and float(fps_parts[1]) else 0
            if duration > 15 + (1 / fps if fps else .1):
                raise ValueError("视频超过 15 秒，请先使用不超过 15 秒的片段")
            source_width, source_height = int(stream.get("width") or 0), int(stream.get("height") or 0)
            if source_width < 2 or source_height < 2 or fps <= 0:
                raise ValueError("视频尺寸或帧率无效")
            scale = min(1920 / source_width, 1080 / source_height)
            target_width = max(2, round(source_width * scale / 2) * 2)
            target_height = max(2, round(source_height * scale / 2) * 2)
            work.mkdir(parents=True, exist_ok=True)
            output = work / "output"
            output.mkdir(exist_ok=True)
            env = dict(os.environ, PATH=str(binary) + os.pathsep + os.environ.get("PATH", ""), PYTHONUNBUFFERED="1",
                       BEEFTV_VDA_SOURCE=str(model / "Video-Depth-Anything"))
            command = [str(python), "-m", "depth_capture", str(source), "--output-dir", str(output),
                       "--runtime-dir", str(model), "--device", variant, "--input-size", "280",
                       "--max-resolution", "960", "--output-resolution", f"{target_width}x{target_height}", "--max-seconds", "15",
                       "--low-percentile", "2", "--high-percentile", "98", "--gamma", "1.25"]
            self._update(task_id, stage="使用 CPU 分析视频，可能耗时较长" if variant == "cpu" else "加载深度模型", progress=25)
            def on_line(line):
                if "[2/3]" in line:
                    self._update(task_id, stage="分析视频", progress=38)
                elif "[3/3]" in line:
                    self._update(task_id, stage="生成结果视频", progress=82)
            try:
                self._process(task_id, command, worker, env, on_line)
            except RuntimeError as exc:
                if variant != "cuda" or not any(word in str(exc).lower() for word in ("cuda", "device-side", "out of memory")):
                    raise
                self._update(task_id, stage="CUDA 设备故障，改用 CPU", progress=25, fallback_reason=str(exc)[:180])
                shutil.rmtree(output)
                output.mkdir()
                variant = "cpu"
                python, worker, model, binary = self._ensure_runtime(task_id, "cpu")
                command[0] = str(python)
                command[command.index("--device") + 1] = "cpu"
                env["PATH"] = str(binary) + os.pathsep + os.environ.get("PATH", "")
                self._process(task_id, command, worker, env, on_line)
            self._check(task_id)
            videos = list(output.glob("*_depth_preview.mp4"))
            if len(videos) != 1 or videos[0].stat().st_size <= 0:
                raise ValueError("深度处理没有生成有效视频")
            self._update(task_id, stage="校验结果视频", progress=90)
            result_duration, result_stream = self._probe(task_id, binary / "ffprobe.exe", videos[0])
            if abs(result_duration - min(duration, 15)) > max(.15, 1 / fps if fps else .15):
                raise ValueError("结果视频时长校验失败")
            if (int(result_stream.get("width") or 0), int(result_stream.get("height") or 0)) != (target_width, target_height):
                raise ValueError("结果视频尺寸校验失败")
            if result_stream.get("codec_name") != "h264" or result_stream.get("pix_fmt") != "yuv420p":
                raise ValueError("深度视频编码格式校验失败")
            result_fps_parts = str(result_stream.get("avg_frame_rate") or "0/1").split("/", 1)
            result_fps = float(result_fps_parts[0]) / float(result_fps_parts[1]) if len(result_fps_parts) == 2 and float(result_fps_parts[1]) else 0
            result_frames = int(result_stream.get("nb_frames") or 0)
            if not 0 < result_fps <= 30.01 or result_frames < 1:
                raise ValueError("深度视频帧率或帧数校验失败")
            self._update(task_id, stage="加载姿态模型", progress=91)
            pose_packages, pose_model = self._ensure_pose(task_id)
            pose_video = work / "pose_reference.mp4"
            pose_data = work / "pose_landmarks.json"
            pose_env = dict(env, PYTHONPATH=str(pose_packages) + os.pathsep + os.environ.get("PYTHONPATH", ""))
            pose_worker = Path(__file__).with_name("depth_pose_worker.py")
            self._update(task_id, stage="分析人体骨骼", progress=92)
            self._process(task_id, [str(python), str(pose_worker), str(source), "--model", str(pose_model),
                                    "--video", str(pose_video), "--data", str(pose_data),
                                    "--fps", str(result_fps), "--count", str(result_frames),
                                    "--width", str(target_width), "--height", str(target_height),
                                    "--ffmpeg", str(binary / "ffmpeg.exe")], worker, pose_env,
                          lambda line: self._update(task_id, stage=line.strip()[:80], progress=93)
                          if line.startswith("姿态分析 ") else None)
            if not pose_video.is_file() or not pose_data.is_file():
                raise ValueError("姿态处理没有生成完整结果")
            pose_duration, pose_stream = self._probe(task_id, binary / "ffprobe.exe", pose_video)
            if abs(pose_duration - result_duration) > max(.15, 1 / result_fps):
                raise ValueError("姿态视频与深度视频的时间轴不一致")
            if int(pose_stream.get("nb_frames") or 0) != result_frames:
                raise ValueError("姿态视频与深度视频的帧数不一致")
            if (int(pose_stream.get("width") or 0), int(pose_stream.get("height") or 0)) != (target_width, target_height):
                raise ValueError("姿态视频尺寸校验失败")
            pose_record = json.loads(pose_data.read_text(encoding="utf-8"))
            if len(pose_record.get("frames") or []) != result_frames:
                raise ValueError("姿态关键点帧数校验失败")
            detected_frames = sum(bool(frame.get("poses")) for frame in pose_record["frames"])
            self._update(task_id, stage="保存两份参考素材", progress=97)
            self.output_dir.mkdir(parents=True, exist_ok=True)
            target = self.output_dir / f"depth_capture_{task_id}.mp4"
            pose_target = self.output_dir / f"pose_capture_{task_id}.mp4"
            data_target = self.output_dir / f"pose_capture_{task_id}.json"
            os.replace(videos[0], target)
            os.replace(pose_video, pose_target)
            os.replace(pose_data, data_target)
            self._update(task_id, status="succeeded", stage="已完成", progress=100,
                         result_url=self.output_url(target.name), pose_url=self.output_url(pose_target.name),
                         pose_data_url=self.output_url(data_target.name), detected_frames=detected_frames,
                         total_frames=result_frames, device=variant, duration=result_duration)
        except Cancelled:
            self._update(task_id, status="cancelled", stage="已取消")
        except Exception as exc:
            self._update(task_id, status="failed", stage="处理失败", error=str(exc)[:400])
        finally:
            if work.exists():
                shutil.rmtree(work, ignore_errors=True)
