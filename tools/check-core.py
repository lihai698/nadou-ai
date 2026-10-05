"""Run the local core regression checks without contacting generation services."""

import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile


ROOT = Path(__file__).resolve().parents[1]
COMMAND_TIMEOUT_SECONDS = 180


def run_check(label, command, count_pattern=None):
    try:
        result = subprocess.run(
            command, cwd=ROOT, capture_output=True, text=True,
            encoding="utf-8", errors="replace", check=False,
            timeout=COMMAND_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired as exc:
        print(f"失败：{label}（超过 {COMMAND_TIMEOUT_SECONDS} 秒）", flush=True)
        print((exc.stdout or "") + (exc.stderr or ""), flush=True)
        raise SystemExit(124)
    output = (result.stdout or "") + (result.stderr or "")
    if result.returncode:
        print(f"失败：{label}（退出码 {result.returncode}）", flush=True)
        print(output, flush=True)
        raise SystemExit(result.returncode)
    match = re.search(count_pattern, output) if count_pattern else None
    if count_pattern and (not match or int(match.group(1)) <= 0):
        print(f"失败：{label}（没有可确认的测试计数）", flush=True)
        print(output, flush=True)
        raise SystemExit(1)
    suffix = f"（{match.group(1)} 项）" if match else ""
    print(f"通过：{label}{suffix}", flush=True)
    return int(match.group(1)) if match else 0


def prepare_python_sandbox(target):
    """Copy public code and tests only; never copy API/, data/, assets/ or output/."""
    for name in ("main.py",):
        shutil.copy2(ROOT / name, target / name)
    for name in ("backend", "tests", "static", "tools", "workflows"):
        source = ROOT / name
        if source.is_dir():
            shutil.copytree(source, target / name)


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    node = os.environ.get("NODE_BINARY") or shutil.which("node")
    if not node:
        raise SystemExit("缺少 Node.js 18+；安装后重试，或用 NODE_BINARY 指定可执行文件。")
    node_version = subprocess.run(
        [node, "--version"], cwd=ROOT, capture_output=True, text=True,
        encoding="utf-8", errors="replace", check=False,
        timeout=COMMAND_TIMEOUT_SECONDS,
    ).stdout.strip()
    version_match = re.fullmatch(r"v(\d+)(?:\.\d+){0,2}", node_version)
    if not version_match or int(version_match.group(1)) < 18:
        raise SystemExit(f"Node.js 版本过低：{node_version or '未知'}；需要 18 或以上。")
    tests = sorted((ROOT / "tests").glob("*.test.cjs"))
    if not tests:
        raise SystemExit("未找到画布 JavaScript 测试文件。")

    with tempfile.TemporaryDirectory(prefix="nadou-core-check-") as sandbox_name:
        sandbox = Path(sandbox_name)
        prepare_python_sandbox(sandbox)
        result = subprocess.run(
            [sys.executable, "-m", "unittest", "discover", "-s", "tests", "-v"],
            cwd=sandbox, capture_output=True, text=True,
            encoding="utf-8", errors="replace", check=False,
            timeout=COMMAND_TIMEOUT_SECONDS,
        )
        output = (result.stdout or "") + (result.stderr or "")
        if result.returncode:
            print("失败：Python 后端与数据回归", flush=True)
            print(output, flush=True)
            raise SystemExit(result.returncode)
        match = re.search(r"Ran (\d+) tests?", output)
        if not match or int(match.group(1)) <= 0:
            print("失败：Python 后端与数据回归（没有可确认的测试计数）", flush=True)
            print(output, flush=True)
            raise SystemExit(1)
        python_count = int(match.group(1))
        print(f"通过：Python 后端与数据回归（{python_count} 项；临时公开代码副本）", flush=True)

    javascript_files = sorted((ROOT / "static" / "js").glob("*.js"))
    for script in javascript_files:
        run_check(f"语法 {script}", [node, "--check", script])
    javascript_count = 0
    for script in tests:
        javascript_count += run_check(
            f"页面逻辑 {script.name}", [node, str(script)], r"(?:#|ℹ) tests (\d+)",
        )
    run_check("中英文词条与页面引用", [node, "static/js/i18n/validate-i18n.js"])
    print(f"核心检查完成：Python {python_count} 项，JavaScript {javascript_count} 项。")


if __name__ == "__main__":
    main()
