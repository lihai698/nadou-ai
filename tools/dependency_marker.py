"""Track whether the current Python environment matches the bundled lock file."""

from __future__ import annotations

import hashlib
import importlib.metadata
import importlib.util
import re
import sys
from pathlib import Path


MARKER_NAME = ".nadou-dependencies.ok"
_REQUIREMENT_RE = re.compile(r"^([A-Za-z0-9_.-]+)==([^\s#]+)$")
_IMPORT_NAMES = {
    "pillow": "PIL",
    "python-multipart": "multipart",
}


def marker_value(root: Path, python_version: str | None = None) -> str:
    lock_path = root / "requirements.lock"
    digest = hashlib.sha256(lock_path.read_bytes()).hexdigest()
    version = python_version or platform_python_version()
    return f"{version}|{digest}"


def platform_python_version() -> str:
    return ".".join(str(part) for part in sys.version_info[:3])


def marker_path(root: Path) -> Path:
    return root / MARKER_NAME


def marker_matches(root: Path, python_version: str | None = None) -> bool:
    try:
        return marker_path(root).read_text(encoding="utf-8").strip() == marker_value(root, python_version)
    except (OSError, UnicodeError):
        return False


def locked_requirements(root: Path) -> tuple[tuple[str, str], ...]:
    """读取锁定清单中的精确版本，不接受未锁定的条目。"""

    try:
        lines = (root / "requirements.lock").read_text(encoding="utf-8-sig").splitlines()
    except (OSError, UnicodeError):
        return ()
    requirements: list[tuple[str, str]] = []
    for line in lines:
        value = line.split("#", 1)[0].strip()
        if not value:
            continue
        match = _REQUIREMENT_RE.fullmatch(value)
        if match is None:
            return ()
        requirements.append((match.group(1), match.group(2)))
    return tuple(requirements)


def dependencies_match(root: Path) -> bool:
    """确认锁定清单中的发行版和主要导入模块仍然存在。"""

    requirements = locked_requirements(root)
    if not requirements:
        return False
    try:
        for name, expected in requirements:
            if importlib.metadata.version(name) != expected:
                return False
            import_name = _IMPORT_NAMES.get(name.lower(), name.replace("-", "_"))
            if importlib.util.find_spec(import_name) is None:
                return False
    except (importlib.metadata.PackageNotFoundError, ImportError, OSError, ValueError):
        return False
    return True


def write_marker(root: Path) -> None:
    marker_path(root).write_text(marker_value(root) + "\n", encoding="utf-8")


def main(argv: list[str]) -> int:
    if len(argv) != 2 or argv[1] not in {"--check", "--write"}:
        print("用法：dependency_marker.py --check|--write", file=sys.stderr)
        return 2
    root = Path(__file__).resolve().parents[1]
    if argv[1] == "--check":
        return 0 if marker_matches(root) and dependencies_match(root) else 1
    try:
        write_marker(root)
    except OSError:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
