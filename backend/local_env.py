"""本地 API 配置文件的最小读写边界。

模块只处理调用方明确传入的 `.env` 路径、数据目录和进程环境映射。
它不读取默认路径，不拥有密钥，也不导入应用入口；这样配置文件的边界
可以单独测试，应用仍负责决定哪些配置项需要保存。
"""

from __future__ import annotations

import os
import re
import tempfile
from threading import RLock
from typing import MutableMapping, Mapping


_UPDATE_LOCK = RLock()


def ensure_runtime_files(env_path: str, data_dir: str) -> None:
    """创建配置目录、数据目录和空配置文件（如果尚不存在）。"""

    if not str(env_path or "").strip() or not str(data_dir or "").strip():
        raise ValueError("env_path 和 data_dir 不能为空")
    env_path = os.path.abspath(str(env_path))
    data_dir = os.path.abspath(str(data_dir))
    os.makedirs(os.path.dirname(env_path), exist_ok=True)
    os.makedirs(data_dir, exist_ok=True)
    if not os.path.exists(env_path):
        with open(env_path, "a", encoding="utf-8"):
            pass


def _clean_value(value: str) -> str:
    return str(value or "").strip().strip('"').strip("'")


def load_env_file(path: str, environ: MutableMapping[str, str]) -> None:
    """把 `.env` 中尚未存在于进程环境的键加载进去。"""

    path = os.path.abspath(str(path or ""))
    if not path or not os.path.exists(path):
        return
    with open(path, "r", encoding="utf-8-sig") as handle:
        for raw_line in handle.read().splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            if key:
                environ.setdefault(key, _clean_value(value))


def read_env_value(path: str, key: str) -> str:
    """读取一个配置值；文件不存在或读取失败时返回空字符串。"""

    wanted = str(key or "").strip()
    path = os.path.abspath(str(path or ""))
    if not wanted or not path or not os.path.exists(path):
        return ""
    try:
        with open(path, "r", encoding="utf-8-sig") as handle:
            for raw_line in handle.read().splitlines():
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                env_key, value = line.split("=", 1)
                if env_key.strip() == wanted:
                    return _clean_value(value)
    except OSError:
        return ""
    return ""


def env_quote(value: object) -> str:
    """按原 `.env` 规则引用空格、注释符或引号。"""

    text = str(value or "")
    if not text or re.search(r"\s|#|['\"]", text):
        return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'
    return text


def update_env_values(path: str, updates: Mapping[str, object], environ: MutableMapping[str, str]) -> None:
    """更新指定键，保留注释、空行和未涉及的配置项。"""

    if not str(path or "").strip():
        raise ValueError("path 不能为空")
    path = os.path.abspath(str(path))
    if not isinstance(updates, Mapping):
        raise TypeError("updates 必须是映射")
    with _UPDATE_LOCK:
        directory = os.path.dirname(path)
        os.makedirs(directory, exist_ok=True)
        lines = []
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8-sig") as handle:
                lines = handle.read().splitlines()
        seen = set()
        next_lines = []
        applied = {}
        for line in lines:
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in line:
                next_lines.append(line)
                continue
            key = line.split("=", 1)[0].strip()
            if key in updates:
                value = str(updates[key] or "")
                next_lines.append(f"{key}={env_quote(value)}")
                applied[key] = value
                seen.add(key)
            else:
                next_lines.append(line)
        for raw_key, raw_value in updates.items():
            key = str(raw_key or "").strip()
            if not key or key in seen:
                continue
            value = str(raw_value or "")
            next_lines.append(f"{key}={env_quote(value)}")
            applied[key] = value
        fd, temporary = tempfile.mkstemp(prefix=".env.", suffix=".tmp", dir=directory)
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="") as handle:
                handle.write("\n".join(next_lines).rstrip() + "\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, path)
        except BaseException:
            try:
                os.unlink(temporary)
            except OSError:
                pass
            raise
        environ.update(applied)
