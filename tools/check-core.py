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
PYTHON_SUITE_TIMEOUT_SECONDS = 1800


def run_check(label, command, count_pattern=None, *, cwd=None, timeout=None):
    deadline = COMMAND_TIMEOUT_SECONDS if timeout is None else timeout
    try:
        result = subprocess.run(
            command, cwd=ROOT if cwd is None else cwd, capture_output=True, text=True,
            encoding="utf-8", errors="replace", check=False,
            timeout=deadline,
        )
    except subprocess.TimeoutExpired as exc:
        print(f"失败：{label}（超过 {deadline} 秒）", flush=True)
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
    for name in ("run.bat", "安装依赖.bat", "检查核心流程.bat", "mac-启动服务.sh", "mac-安装依赖.sh"):
        shutil.copy2(ROOT / name, target / name)
    # Agent 功能依赖项目根目录的内置 Skill 文件。核心检查使用临时公开代码副本，
    # 因此必须把 skills 一并复制，否则沙箱里的 Agent 路由会把所有 Skill 读取判定为缺失。
    for name in (".github", "backend", "tests", "static", "tools", "workflows", "skills"):
        source = ROOT / name
        if source.is_dir():
            ignore = shutil.ignore_patterns("custom") if name == "workflows" else None
            shutil.copytree(source, target / name, ignore=ignore)
    public_knowledge = ROOT / "docs" / "创作助手项目知识"
    if public_knowledge.is_dir():
        (target / "docs").mkdir(exist_ok=True)
        shutil.copytree(public_knowledge, target / "docs" / "创作助手项目知识")


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    try:
        python_timeout = int(os.environ.get("NADOU_CORE_PYTHON_TIMEOUT_SECONDS", str(PYTHON_SUITE_TIMEOUT_SECONDS)))
        if python_timeout <= 0:
            raise ValueError
    except ValueError:
        raise SystemExit("NADOU_CORE_PYTHON_TIMEOUT_SECONDS 必须是正整数秒数。")
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
        print(f"开始：Python 后端与数据回归（完整测试，最多 {python_timeout} 秒）", flush=True)
        python_count = run_check(
            "Python 后端与数据回归（临时公开代码副本）",
            [sys.executable, "-c",
             "import runpy,sys;sys.path.insert(0,sys.argv.pop(1));"
             "runpy.run_module('unittest',run_name='__main__')",
             str(sandbox), "discover", "-s", "tests", "-v"],
            r"Ran (\d+) tests?", cwd=sandbox, timeout=python_timeout,
        )

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
