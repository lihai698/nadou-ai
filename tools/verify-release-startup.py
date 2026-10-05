"""Verify that a public release can start from a clean temporary directory.

The release builder checks what is safe to publish.  This tool is the follow-up
check that exercises the exported runtime without writing generated files into
the release directory and without inheriting local credentials.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path


REQUIRED_FILES = ("main.py", "VERSION", "static/index.html")
PRIVATE_FILE_NAMES = {
    "history.json",
    "global_config.json",
    "API/.env",
}
PRIVATE_TOP_LEVEL = {"data", "assets", "output"}
SANDBOX_OMIT = {
    ".git",
    ".github",
    "CLI",
    "docs",
    "packages",
    "python",
    "tests",
    "tools",
    "__pycache__",
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _relative_name(path: Path) -> str:
    return path.as_posix()


def _safe_manifest_path(value: object) -> str:
    relative = str(value or "").replace("\\", "/")
    candidate = Path(relative)
    if not relative or candidate.is_absolute() or ".." in candidate.parts:
        raise ValueError(f"发布清单包含不安全路径：{relative!r}")
    if relative != candidate.as_posix():
        raise ValueError(f"发布清单路径格式不统一：{relative!r}")
    return relative


def _manifest(release_dir: Path) -> tuple[str, dict[str, str]]:
    manifest_path = release_dir / "RELEASE_FILES.json"
    if not manifest_path.is_file():
        raise ValueError("发布目录缺少 RELEASE_FILES.json；请先运行 prepare-release.py --build")
    try:
        raw = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError("RELEASE_FILES.json 无法读取或不是有效 JSON") from exc
    if not isinstance(raw, dict) or not isinstance(raw.get("files"), dict):
        raise ValueError("RELEASE_FILES.json 的 files 必须是对象")
    version = str(raw.get("version") or "").strip()
    if not version:
        raise ValueError("RELEASE_FILES.json 缺少版本号")
    files: dict[str, str] = {}
    for raw_path, raw_hash in raw["files"].items():
        relative = _safe_manifest_path(raw_path)
        digest = str(raw_hash or "").lower()
        if len(digest) != 64 or any(char not in "0123456789abcdef" for char in digest):
            raise ValueError(f"发布清单的 SHA256 无效：{relative}")
        files[relative] = digest
    return version, files


def _private_path(relative: str) -> bool:
    normalized = relative.replace("\\", "/")
    if normalized in PRIVATE_FILE_NAMES:
        return True
    first = normalized.split("/", 1)[0]
    return first in PRIVATE_TOP_LEVEL


def validate_release_dir(release_dir: Path) -> tuple[str, dict[str, str]]:
    """Validate the exported directory and return its version and manifest."""

    release_dir = release_dir.expanduser().resolve()
    if not release_dir.is_dir():
        raise ValueError(f"发布目录不存在：{release_dir}")
    version, files = _manifest(release_dir)
    for required in REQUIRED_FILES:
        if not (release_dir / required).is_file():
            raise ValueError(f"发布目录缺少：{required}")
    file_version = (release_dir / "VERSION").read_text(encoding="utf-8-sig").strip()
    if file_version != version:
        raise ValueError("VERSION 与 RELEASE_FILES.json 的版本不一致")
    for relative, expected in files.items():
        path = release_dir / Path(relative)
        if not path.is_file() or path.is_symlink():
            raise ValueError(f"发布清单文件缺失或不是普通文件：{relative}")
        if sha256_file(path) != expected:
            raise ValueError(f"发布文件哈希不一致：{relative}")
        if _private_path(relative):
            raise ValueError(f"公开发布目录含私人路径：{relative}")

    listed = set(files)
    extras = []
    for path in release_dir.rglob("*"):
        if path.is_symlink():
            raise ValueError(f"发布目录含符号链接：{_relative_name(path.relative_to(release_dir))}")
        if not path.is_file():
            continue
        relative = _relative_name(path.relative_to(release_dir))
        if relative == "RELEASE_FILES.json":
            continue
        if relative not in listed:
            extras.append(relative)
    if extras:
        raise ValueError("发布目录含清单外文件：" + ", ".join(sorted(extras)[:8]))
    return version, files


def find_python(release_dir: Path, override: Path | None = None) -> Path:
    candidates = [override] if override else [release_dir / "python" / "python.exe", release_dir / "python" / "python"]
    for candidate in candidates:
        if candidate and candidate.is_file():
            return candidate.resolve()
    raise ValueError("发布目录缺少可执行 Python：python/python.exe（或 python/python）")


def _copy_runtime(release_dir: Path, sandbox: Path) -> None:
    """Copy only files needed to import and serve the app into the sandbox."""

    for child in release_dir.iterdir():
        if child.name in SANDBOX_OMIT or child.name == "RELEASE_FILES.json":
            continue
        destination = sandbox / child.name
        if child.is_dir():
            shutil.copytree(child, destination, symlinks=False)
        elif child.is_file():
            shutil.copy2(child, destination)


def _safe_environment() -> dict[str, str]:
    blocked = ("API_KEY", "TOKEN", "SECRET", "PASSWORD", "PRIVATE_KEY")
    environment = {
        name: value
        for name, value in os.environ.items()
        if not any(fragment in name.upper() for fragment in blocked)
    }
    environment.update(
        {
            "NADOU_BIND_HOST": "127.0.0.1",
            "PYTHONIOENCODING": "utf-8",
            "PYTHONUNBUFFERED": "1",
        }
    )
    return environment


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def _request_status(url: str) -> tuple[int, bytes]:
    request = urllib.request.Request(url, headers={"User-Agent": "nadou-release-startup-check"})
    with urllib.request.urlopen(request, timeout=2) as response:
        return int(response.status), response.read(4096)


def _wait_for_page(process: subprocess.Popen, url: str, timeout: float) -> tuple[int, bytes]:
    deadline = time.monotonic() + timeout
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"发布包进程提前退出，退出码 {process.returncode}")
        try:
            return _request_status(url)
        except (OSError, urllib.error.URLError) as exc:
            last_error = exc
            time.sleep(0.2)
    raise TimeoutError(f"等待发布包页面超时：{url}（{type(last_error).__name__ if last_error else '未知原因'}）")


def verify_startup(release_dir: Path, python_path: Path | None = None, timeout: float = 30.0) -> dict[str, object]:
    version, files = validate_release_dir(release_dir)
    interpreter = find_python(release_dir, python_path)
    dependency_probe = subprocess.run(
        [str(interpreter), "-c", "import uvicorn, fastapi, httpx, PIL"],
        cwd=release_dir.resolve(),
        env=_safe_environment(),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    if dependency_probe.returncode != 0:
        raise RuntimeError("发布包运行依赖未安装或无法导入；请先运行安装依赖脚本")
    port = _free_port()
    command = (
        "import os, sys; sys.path.insert(0, os.getcwd()); import uvicorn, main; "
        "uvicorn.run(main.app, host='127.0.0.1', "
        "port=int(os.environ['NADOU_VERIFY_PORT']), "
        "ws_ping_interval=None, ws_ping_timeout=None)"
    )
    with tempfile.TemporaryDirectory(prefix="nadou-release-startup-") as directory:
        sandbox = Path(directory)
        _copy_runtime(release_dir.resolve(), sandbox)
        environment = _safe_environment()
        environment["NADOU_VERIFY_PORT"] = str(port)
        # 项目自带的 Windows Python 使用 python310._pth，不会自动把当前
        # 工作目录放进 sys.path；显式加入沙盒，确保导入的是沙盒内的 main.py。
        environment["PYTHONPATH"] = str(sandbox)
        process = subprocess.Popen(
            [str(interpreter), "-c", command],
            cwd=sandbox,
            env=environment,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        try:
            root_status, root_body = _wait_for_page(process, f"http://127.0.0.1:{port}/", timeout)
            static_status, static_body = _wait_for_page(
                process, f"http://127.0.0.1:{port}/static/index.html", timeout
            )
            if root_status != 200 or static_status != 200:
                raise RuntimeError(f"页面状态异常：/={root_status}，/static/index.html={static_status}")
            if b"<html" not in root_body.lower() or b"<html" not in static_body.lower():
                raise RuntimeError("启动页面没有返回 HTML 内容")
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
    return {"version": version, "files": len(files), "port": port, "root": 200, "static": 200}


def main() -> int:
    parser = argparse.ArgumentParser(description="在临时干净目录启动并检查公开发布包")
    parser.add_argument("release_dir", type=Path, help="prepare-release.py --build 生成的目录")
    parser.add_argument("--python", dest="python_path", type=Path, help="仅供隔离验收覆盖 Python 路径")
    parser.add_argument("--timeout", type=float, default=30.0, help="等待页面的秒数，默认 30")
    args = parser.parse_args()
    if args.timeout <= 0:
        parser.error("--timeout 必须大于 0")
    try:
        result = verify_startup(args.release_dir, args.python_path, args.timeout)
    except (OSError, ValueError, RuntimeError, TimeoutError) as exc:
        print(f"发布包启动检查失败：{exc}", file=sys.stderr)
        return 1
    print(
        f"发布包启动检查通过：{result['version']}，{result['files']} 个文件，"
        f"根页和静态页 HTTP 200（临时端口 {result['port']}）"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
