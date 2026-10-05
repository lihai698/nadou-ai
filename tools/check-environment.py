"""Check prerequisites before starting the local application."""

import argparse
import importlib
import importlib.metadata
import json
import math
import re
import shutil
import socket
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
REQUIREMENTS = PROJECT_ROOT / "requirements.txt"
IMPORT_NAMES = {"pillow": "PIL", "python-multipart": "multipart"}
ENV_NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]*\Z")
PROVIDER_ID = re.compile(r"[A-Za-z0-9_-]{2,40}\Z")
NUMERIC_ENV = {
    "LOCAL_IMAGE_IMPORT_MAX_BYTES": int,
    "CODEX_CLI_TIMEOUT": int,
    "GEMINI_CLI_TIMEOUT": int,
    "JIMENG_POLL_SECONDS": int,
    "MAX_HISTORY_MESSAGES": int,
    "REQUEST_TIMEOUT": float,
    "IMAGE_POLL_INTERVAL": float,
    "IMAGE_TASK_TIMEOUT": float,
    "COMFYUI_HISTORY_TIMEOUT": float,
    "COMFYUI_DOWNLOAD_TIMEOUT": float,
    "APIMART_IMAGE_TASK_TIMEOUT": float,
    "APIMART_IMAGE_POLL_INTERVAL": float,
    "APIMART_IMAGE_INITIAL_POLL_DELAY": float,
    "TUDOU_ASYNC_IMAGE_TASK_TIMEOUT": float,
    "TUDOU_ASYNC_IMAGE_POLL_INTERVAL": float,
    "TUDOU_ASYNC_IMAGE_INITIAL_POLL_DELAY": float,
    "VIDEO_POLL_TIMEOUT": float,
    "ONLINE_IMAGE_PROMPT_MAX_LENGTH": int,
    "VIDEO_PROMPT_MAX_LENGTH": int,
    "LLM_MESSAGE_MAX_LENGTH": int,
    "CHAT_ATTACHMENT_MAX": int,
    "ONLINE_IMAGE_REFERENCE_MAX": int,
    "DIAGNOSTIC_LOG_MAX_BYTES": int,
    "DIAGNOSTIC_LOG_BACKUP_COUNT": int,
}

NUMERIC_ENV_BOUNDS = {
    "DIAGNOSTIC_LOG_MAX_BYTES": (1024, 64 * 1024 * 1024, "1 KiB～64 MiB"),
    "DIAGNOSTIC_LOG_BACKUP_COUNT": (1, 20, "1～20"),
}


def required_packages(path):
    packages = []
    for line in path.read_text(encoding="utf-8").splitlines():
        value = line.split("#", 1)[0].strip()
        if not value:
            continue
        match = re.fullmatch(r"([A-Za-z0-9][A-Za-z0-9_.-]*)(?:==([A-Za-z0-9][A-Za-z0-9_.+!-]*))?", value)
        if not match:
            raise ValueError(f"无法识别依赖声明：{value}")
        packages.append((match.group(1), match.group(2)))
    return packages


def check_json_config(path, label, problems, storage=False):
    if not path.exists():
        return
    if not path.is_file():
        problems.append(f"{label} 应为 JSON 文件。")
        return
    try:
        with path.open("r", encoding="utf-8-sig") as source:
            value = json.load(source)
    except json.JSONDecodeError as exc:
        problems.append(f"{label} 的 JSON 格式错误（第 {exc.lineno} 行，第 {exc.colno} 列）。")
        return
    except (OSError, UnicodeError):
        problems.append(f"{label} 无法读取，请检查文件权限和 UTF-8 编码。")
        return
    if not isinstance(value, dict):
        problems.append(f"{label} 顶层必须是 JSON 对象。")
    elif storage and any(key in value and not isinstance(value[key], str)
                         for key in ("upload", "generated", "local")):
        problems.append(f"{label} 中 upload、generated、local 路径必须是文本。")


def check_env_config(path, problems, notices):
    """Validate local settings without including their values in diagnostics."""
    if not path.exists() or not path.is_file():
        return
    try:
        lines = path.read_text(encoding="utf-8-sig").splitlines()
    except (OSError, UnicodeError):
        problems.append("API/.env 无法读取，请检查文件权限和 UTF-8 编码。")
        return
    seen = set()
    for line_number, raw_line in enumerate(lines, 1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            problems.append(f"API/.env 第 {line_number} 行缺少 =；请写成 参数名=值。")
            continue
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip()
        if not ENV_NAME.fullmatch(key):
            problems.append(f"API/.env 第 {line_number} 行参数名格式错误。")
            continue
        if key in seen:
            problems.append(f"API/.env 第 {line_number} 行的 {key} 重复；请只保留一项。")
            continue
        seen.add(key)
        if value.startswith(('"', "'")) != value.endswith(('"', "'")) or (
            value.startswith(('"', "'")) and (len(value) < 2 or value[-1] != value[0])
        ):
            problems.append(f"API/.env 第 {line_number} 行的 {key} 引号未配对。")
            continue
        # main.py trims matching outer quotes when it loads API/.env.
        if len(value) >= 2 and value[0] in {'"', "'"} and value[-1] == value[0]:
            value = value[1:-1]
        if key in NUMERIC_ENV:
            try:
                number = NUMERIC_ENV[key](value)
                if not math.isfinite(number):
                    raise ValueError
            except ValueError:
                problems.append(f"API/.env 第 {line_number} 行的 {key} 必须是有效数字。")
            else:
                bounds = NUMERIC_ENV_BOUNDS.get(key)
                if bounds and not bounds[0] <= number <= bounds[1]:
                    problems.append(
                        f"API/.env 第 {line_number} 行的 {key} 必须在 {bounds[2]} 范围内。"
                    )
        elif key == "COMFYUI_INSTANCES" and not any(part.strip() for part in value.split(",")):
            problems.append(f"API/.env 第 {line_number} 行的 COMFYUI_INSTANCES 至少需要一个地址。")
        elif key in {"COMFLY_BASE_URL", "PUBLIC_BASE_URL", "PUBLIC_MEDIA_BASE_URL"}:
            if value and not value.startswith(("http://", "https://")):
                problems.append(f"API/.env 第 {line_number} 行的 {key} 应以 http:// 或 https:// 开头。")


def check_provider_config(path, problems, notices):
    """Catch saved provider entries that would otherwise silently fall back to defaults."""
    if not path.exists():
        return
    try:
        with path.open("r", encoding="utf-8-sig") as source:
            providers = json.load(source)
    except json.JSONDecodeError as exc:
        problems.append(f"data/api_providers.json 格式错误（第 {exc.lineno} 行，第 {exc.colno} 列）。")
        return
    except (OSError, UnicodeError):
        problems.append("data/api_providers.json 无法读取，请检查文件权限和 UTF-8 编码。")
        return
    if not isinstance(providers, list):
        problems.append("data/api_providers.json 顶层必须是平台列表。")
        return
    ids = set()
    for index, provider in enumerate(providers, 1):
        label = f"data/api_providers.json 第 {index} 个平台"
        if not isinstance(provider, dict):
            problems.append(f"{label} 必须是 JSON 对象。")
            continue
        provider_id = str(provider.get("id") or "").strip().lower()
        if not PROVIDER_ID.fullmatch(provider_id):
            problems.append(f"{label} 缺少有效 id（2～40 位字母、数字、下划线或连字符）。")
            continue
        if provider_id in ids:
            problems.append(f"{label} 的 id 重复。")
        ids.add(provider_id)
        base_url = str(provider.get("base_url") or "").strip()
        if base_url and not base_url.startswith(("http://", "https://")):
            problems.append(f"{label} 的 base_url 应以 http:// 或 https:// 开头。")
        protocol = str(provider.get("protocol") or "openai").strip().lower()
        if not base_url and provider.get("enabled", True) and provider_id not in {
            "modelscope", "runninghub", "volcengine"
        } and protocol not in {"codex", "gemini-cli", "jimeng"}:
            problems.append(f"{label} 缺少 base_url；请到 API 设置中填写。")
        version = provider.get("ms_defaults_version")
        if version and not str(version).isdigit():
            problems.append(f"{label} 的 ms_defaults_version 必须是非负整数。")


def check_local_path_types(root, problems):
    """Keep the private configuration file and user directories distinguishable."""
    for name in ("API/.env", "data", "assets"):
        path = root / name
        if not path.exists():
            continue
        expected_file = name == "API/.env"
        if expected_file and not path.is_file():
            problems.append("本地路径 API/.env 应为文件。")
        elif not expected_file and not path.is_dir():
            problems.append(f"本地路径 {name} 应为目录。")


def check_port(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        try:
            listener.bind(("0.0.0.0", port))
        except OSError:
            return False
    return True


def check_disk_space(root, minimum_bytes, problems):
    """检查配置根目录所在磁盘的可用空间，不读取目录中的文件。"""

    try:
        minimum = int(minimum_bytes)
    except (TypeError, ValueError, OverflowError):
        problems.append("磁盘最低可用空间必须是非负整数（字节）。")
        return None
    if minimum < 0:
        problems.append("磁盘最低可用空间必须是非负整数（字节）。")
        return None
    if minimum == 0:
        return None

    probe = Path(root).expanduser()
    # 启动前目录可能尚未创建；使用最近的已有父目录查询同一磁盘。
    while not probe.exists() and probe != probe.parent:
        probe = probe.parent
    try:
        usage = shutil.disk_usage(str(probe))
    except OSError:
        problems.append("无法检查配置根目录所在磁盘的可用空间，请手动确认磁盘状态。")
        return None
    if usage.free < minimum:
        problems.append(
            f"配置根目录所在磁盘可用空间不足：至少需要 {minimum} 字节。"
        )
    return usage.free


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)
        sys.stderr.reconfigure(encoding="utf-8", line_buffering=True)
    parser = argparse.ArgumentParser(description="检查本地启动环境，不读取或显示密钥内容")
    parser.add_argument("--port", type=int, default=3000, help="准备使用的端口，默认 3000")
    parser.add_argument("--requirements", type=Path, default=REQUIREMENTS,
                        help="依赖清单路径，默认项目根目录 requirements.txt")
    parser.add_argument("--config-root", type=Path, default=PROJECT_ROOT,
                        help="配置根目录，默认项目根目录；隔离验收可指定自制配置目录")
    parser.add_argument(
        "--min-free-bytes", type=int, default=0,
        help="要求配置根目录所在磁盘的最低可用空间（字节）；默认 0 表示不设门槛",
    )
    args = parser.parse_args()
    problems = []
    notices = []

    disk_free = check_disk_space(args.config_root, args.min_free_bytes, problems)
    if args.min_free_bytes > 0 and disk_free is not None and disk_free >= args.min_free_bytes:
        print(f"磁盘空间: 可用 {disk_free} 字节，满足最低要求")

    print(f"Python: {sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro} ({sys.executable})")
    if sys.version_info < (3, 10):
        problems.append("Python 版本低于项目已验证的 3.10，请使用项目内 python\\python.exe 或 Python 3.10 及以上版本。")
    if not args.requirements.is_file():
        problems.append(f"缺少依赖清单：{args.requirements}")
    else:
        try:
            packages = required_packages(args.requirements)
        except (OSError, UnicodeError, ValueError) as exc:
            problems.append(f"无法读取依赖清单：{exc}")
        else:
            for name, expected_version in packages:
                try:
                    version = importlib.metadata.version(name)
                    print(f"依赖 {name}: {version}")
                except importlib.metadata.PackageNotFoundError:
                    problems.append(f"缺少 Python 依赖 {name}；请先运行安装依赖.bat。")
                    continue
                if expected_version and version != expected_version:
                    problems.append(f"Python 依赖 {name} 需要 {expected_version}，当前为 {version}；请重新运行安装依赖.bat。")
                try:
                    importlib.import_module(IMPORT_NAMES.get(name.lower(), name.replace("-", "_")))
                except Exception as exc:
                    problems.append(f"Python 依赖 {name} 无法导入（{type(exc).__name__}）；请检查安装结果。")

    if not 1 <= args.port <= 65535:
        problems.append("端口必须在 1～65535 之间。")
    elif check_port(args.port):
        print(f"端口 {args.port}: 可用")
    else:
        problems.append(f"端口 {args.port} 已被占用；请先停止已有服务，再运行 run.bat。")

    for name in ("ffmpeg", "ffprobe"):
        print(f"可选工具 {name}: {'已找到' if shutil.which(name) else '未在 PATH 中找到'}")

    for name in ("API/.env", "data", "assets"):
        path = args.config_root / name
        print(f"本地路径 {name}: {'存在' if path.exists() else '尚未创建'}")
    check_local_path_types(args.config_root, problems)

    if not (args.config_root / "API" / ".env").exists():
        notices.append("尚未创建 API/.env；本地画布可以启动，使用在线服务前请复制 API/.env.example 并填写对应配置。")

    check_env_config(args.config_root / "API" / ".env", problems, notices)
    check_json_config(args.config_root / "global_config.json", "global_config.json", problems)
    check_json_config(args.config_root / "data" / "storage_settings.json",
                      "data/storage_settings.json", problems, storage=True)
    check_provider_config(args.config_root / "data" / "api_providers.json", problems, notices)

    for notice in notices:
        print(f"配置提示：{notice}", file=sys.stderr)

    if problems:
        for problem in problems:
            print(f"启动检查未通过：{problem}", file=sys.stderr)
        return 1
    print("启动检查通过。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
