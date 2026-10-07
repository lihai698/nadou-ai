"""Check and export a clean nadou ai release without inheriting local Git history."""

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import urllib.error
import urllib.request
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REPO = "lihai698/nadou-ai"
LAST_UPSTREAM_VERSION = "2026.08.28"
PUBLIC_DIRS = {".github", "CLI", "backend", "docs", "packages", "python", "static", "tests", "tools", "workflows"}
ROOT_NAMES = {
    ".gitignore", "LICENSE", "README.md", "VERSION", "requirements.lock", "requirements.txt",
    "main.py", "get-pip.py", "run.bat", "安装依赖.bat",
    "mac-安装依赖.sh", "mac-启动服务.sh", "mac-启动服务.command", "mac-修复权限.command",
    "安装即梦CLI.bat", "安装即梦CLI.command", "登录即梦CLI.bat", "登录即梦CLI.command",
    "备份恢复说明.md", "MAC-使用说明.md", "新手运行与使用教程.md", "运行说明.txt",
}
PUBLIC_ENV_EXAMPLE = "API/.env.example"
ROOT_SUFFIXES = {".bat", ".command", ".md", ".py", ".sh", ".txt"}
TEXT_SUFFIXES = ROOT_SUFFIXES | {".css", ".html", ".js", ".json", ".ps1", ".toml", ".yaml", ".yml"}
SECRET_PATTERNS = (
    re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(rb"(?<![A-Za-z0-9])(?:sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})"),
)
MAX_FILE_SIZE = 95 * 1024 * 1024


def version_tuple(value):
    return tuple(int(part) for part in re.findall(r"\d+", value))


def included(relative):
    parts = Path(relative).parts
    normalized = relative.replace("\\", "/")
    if normalized == PUBLIC_ENV_EXAMPLE:
        return True
    if not parts or any(part.startswith(".") and part not in {".gitignore", ".github"} for part in parts):
        return False
    if any(part.lower() in {"evidence", "__pycache__", "node_modules", "update_backups"} for part in parts):
        return False
    if any(part.lower().endswith((".env", ".pem", ".key")) for part in parts):
        return False
    if len(parts) == 1:
        return parts[0] in ROOT_NAMES
    if parts[0] not in PUBLIC_DIRS:
        return False
    if parts[0] == "packages" and Path(relative).suffix.lower() != ".whl":
        return False
    return True


def source_files():
    raw = subprocess.check_output(
        ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], cwd=ROOT
    )
    paths = sorted({part.decode("utf-8", "surrogateescape") for part in raw.split(b"\0") if part})
    files = []
    for relative in paths:
        if not included(relative):
            continue
        path = ROOT / relative
        if not path.exists():
            continue
        if path.is_symlink() or not path.is_file():
            raise ValueError(f"发布文件不是普通文件：{relative}")
        if path.stat().st_size > MAX_FILE_SIZE:
            raise ValueError(f"GitHub 不接受超过 95 MiB 的单文件：{relative}")
        files.append((relative, path))
    return files


def github_tree():
    repository_url = f"https://api.github.com/repos/{REPO}"
    request = urllib.request.Request(repository_url, headers={"User-Agent": "nadou-ai-release-check"})
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            repository = json.load(response)
    except urllib.error.HTTPError as exc:
        raise ValueError(f"无法读取公开仓库 {REPO}（HTTP {exc.code}）") from exc
    if repository.get("full_name", "").lower() != REPO.lower() or repository.get("private"):
        raise ValueError("目标仓库不是指定的公开仓库")
    if repository.get("size") == 0:
        return None  # A new public repository has no main branch yet.
    if repository.get("default_branch") != "main":
        raise ValueError("目标仓库默认分支必须是 main")
    tree_url = f"https://api.github.com/repos/{REPO}/git/trees/main?recursive=1"
    request = urllib.request.Request(tree_url, headers={"User-Agent": "nadou-ai-release-check"})
    with urllib.request.urlopen(request, timeout=15) as response:
        result = json.load(response)
    if result.get("truncated"):
        raise ValueError("GitHub 文件列表不完整，已停止发布检查")
    return result.get("tree", [])


def git_index_snapshot():
    """Compare against Git's indexed bytes; Windows checkout line endings may differ."""
    raw = subprocess.check_output(["git", "ls-files", "-s", "-z"], cwd=ROOT)
    indexed = {}
    for entry in raw.split(b"\0"):
        if entry:
            metadata, relative = entry.split(b"\t", 1)
            indexed[relative.decode("utf-8", "surrogateescape")] = metadata.split()[1].decode("ascii")
    changed = subprocess.check_output(["git", "diff", "--name-only", "-z"], cwd=ROOT)
    modified = {part.decode("utf-8", "surrogateescape") for part in changed.split(b"\0") if part}
    return indexed, modified


def check_release(files, allow_current_version=False, preflight=False):
    paths = {relative for relative, _ in files}
    for needed in ("main.py", "VERSION", "LICENSE", "README.md", "static/index.html", "static/update-notes.json"):
        if needed not in paths:
            raise ValueError(f"发布内容缺少：{needed}")
    version = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    notes = json.loads((ROOT / "static/update-notes.json").read_text(encoding="utf-8"))
    if not version_tuple(version) or notes.get("version") != version:
        raise ValueError("VERSION 与 static/update-notes.json 的版本不一致")
    if not preflight and version_tuple(version) <= version_tuple(LAST_UPSTREAM_VERSION):
        raise ValueError(f"首次 nadou ai 发布版本必须高于 {LAST_UPSTREAM_VERSION}")
    if notes.get("update_mode") not in {"in_app", "full_install"}:
        raise ValueError("更新说明必须指定 in_app 或 full_install")
    if not isinstance(notes.get("items"), list) or not notes["items"]:
        raise ValueError("更新说明必须包含至少一条改动")
    if "hero8152/Infinite-Canvas" not in (ROOT / "README.md").read_text(encoding="utf-8"):
        raise ValueError("README 缺少原项目来源署名")
    if REPO not in (ROOT / "main.py").read_text(encoding="utf-8"):
        raise ValueError("程序更新源尚未切到 nadou ai 仓库")
    if "DX-OS.com" in (ROOT / "static/update-notes.json").read_text(encoding="utf-8"):
        raise ValueError("更新说明仍含旧项目迁移广告")

    for relative, path in files:
        if path.suffix.lower() not in TEXT_SUFFIXES and path.name not in {"LICENSE", "VERSION", ".gitignore"}:
            continue
        data = path.read_bytes()
        for pattern in SECRET_PATTERNS:
            if pattern.search(data):
                raise ValueError(f"文件可能含密钥，请本地检查后再发布：{relative}")

    remote = None if preflight else github_tree()
    if remote is not None:
        remote_files = {item.get("path"): item.get("sha") for item in remote if item.get("type") == "blob"}
        if "main.py" not in remote_files or "static/index.html" not in remote_files:
            raise ValueError("目标仓库已有另一套程序，不能覆盖其 main 分支")
        if notes["update_mode"] == "in_app":
            indexed, modified = git_index_snapshot()
            changed = []
            for relative, path in files:
                # Existing clients only replace runtime files. Release docs,
                # tests and the release builder do not affect installed behavior.
                if (relative in {"main.py", "VERSION", "tools/prepare-release.py"}
                        or relative.startswith(("static/", "docs/", "tests/"))):
                    continue
                if relative in modified or remote_files.get(relative) != indexed.get(relative):
                    changed.append(relative)
            for relative in remote_files:
                if (included(relative) and relative not in paths
                        and relative not in {"main.py", "VERSION", "tools/prepare-release.py"}
                        and not relative.startswith(("static/", "docs/", "tests/"))):
                    changed.append(relative)
            if changed:
                raise ValueError("这些文件不由界面更新，必须使用 full_install：" + ", ".join(sorted(set(changed))[:12]))
        remote_version_url = f"https://raw.githubusercontent.com/{REPO}/main/VERSION"
        request = urllib.request.Request(remote_version_url, headers={"User-Agent": "nadou-ai-release-check"})
        with urllib.request.urlopen(request, timeout=15) as response:
            remote_version = response.read(100).decode("utf-8").strip()
        if version_tuple(version) < version_tuple(remote_version) or (
            not allow_current_version and version_tuple(version) == version_tuple(remote_version)
        ):
            raise ValueError(f"新版本 {version} 必须高于仓库现有版本 {remote_version}")
    return version, notes


def build_release(files, version, notes, parent=None):
    parent = Path(parent) if parent else ROOT / "output" / "release"
    target = parent / f"nadou-ai-{version}"
    archive = parent / f"nadou-ai-{version}.zip"
    notes_path = parent / f"nadou-ai-{version}-notes.md"
    if target.exists() or archive.exists() or notes_path.exists():
        raise FileExistsError(f"发布目录或 ZIP 已存在：{target}")
    target.mkdir(parents=True)
    manifest = {}
    for relative, source in files:
        destination = target / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        manifest[relative] = hashlib.sha256(destination.read_bytes()).hexdigest()
    (target / "RELEASE_FILES.json").write_text(
        json.dumps({"version": version, "files": manifest}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as output:
        for path in sorted(target.rglob("*")):
            if path.is_file():
                output.write(path, path.relative_to(target).as_posix())
    note_lines = [f"# nadou ai {version}", ""]
    note_lines.extend(f"- {item['text']}" for item in notes.get("items", []) if isinstance(item, dict) and item.get("text"))
    notes_path.write_text("\n".join(note_lines) + "\n", encoding="utf-8")
    return target, archive, notes_path


def main():
    parser = argparse.ArgumentParser(description="检查或制作不含本地数据与旧 Git 历史的公开发布包")
    parser.add_argument("--build", action="store_true", help="通过检查后生成完整目录和 ZIP")
    parser.add_argument("--allow-current-version", action="store_true", help="仅供已推送同一版本的发布工作流使用")
    parser.add_argument("--preflight", action="store_true", help="在创建 GitHub 仓库前检查本地发布文件")
    parser.add_argument("--output-dir", type=Path, help="指定新的发布输出目录，避免覆盖已有候选包")
    args = parser.parse_args()
    files = source_files()
    version, notes = check_release(
        files, allow_current_version=args.allow_current_version, preflight=args.preflight
    )
    print(f"发布检查通过：{version}，{len(files)} 个文件，更新模式 {notes['update_mode']}")
    if args.build:
        target, archive, notes_path = build_release(files, version, notes, args.output_dir)
        print(f"干净源码目录：{target}")
        print(f"完整安装包：{archive}")
        print(f"发布说明：{notes_path}")


if __name__ == "__main__":
    main()
