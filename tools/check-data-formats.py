"""只读检查画布、项目及两种旧容器；可比较隔离备份与恢复副本。

用法：python tools/check-data-formats.py --root <副本目录> [--snapshot <备份目录>]
不会修改文件，不输出 JSON 内容、路径配置值或生成记录。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.data_formats import InvalidDataFormat, canvas_version, projects_and_version


def _files(root: Path, *, all_json: bool = False):
    # 先规范化路径；不存在的目录仍走统一的“待检查目录不存在”错误。
    root = root.resolve()
    if not root.is_dir():
        raise InvalidDataFormat("待检查目录不存在")
    canvas_dir = root / "data" / "canvases"
    yielded: set[str] = set()
    if canvas_dir.exists():
        if (not canvas_dir.is_dir() or canvas_dir.is_symlink()
                or not canvas_dir.resolve().is_relative_to(root)):
            raise InvalidDataFormat("data/canvases 必须是普通目录")
        for path in sorted(canvas_dir.glob("*.json")):
            relative = path.relative_to(root).as_posix()
            yielded.add(relative)
            yield "canvas", path, relative
    for kind, relative in (
        ("projects", "data/projects.json"),
        ("storage_settings", "data/storage_settings.json"),
        ("history", "history.json"),
    ):
        path = root / relative
        if path.exists():
            yielded.add(relative)
            yield kind, path, relative
    if all_json:
        # 只扩展到项目数据范围：根目录的兼容历史/配置，以及 data 下的
        # 对话、素材索引、任务记录、平台配置和其他本地 JSON。不会扫描
        # 代码、依赖包、浏览器目录或用户导出的任意 JSON。
        candidates = []
        for path in (root / "history.json", root / "global_config.json"):
            if path.exists():
                candidates.append(path)
        data_dir = root / "data"
        if data_dir.exists():
            if data_dir.is_symlink() or not data_dir.resolve().is_relative_to(root):
                raise InvalidDataFormat("data 必须是位于副本内的普通目录")
            if not data_dir.is_dir():
                raise InvalidDataFormat("data 必须是普通目录")
            candidates.extend(data_dir.rglob("*.json"))
        for path in sorted(candidates):
            relative = path.relative_to(root).as_posix()
            if relative in yielded:
                continue
            yield "json", path, relative


def _version(kind: str, data: object) -> int:
    if kind == "json":
        # 其他本地 JSON 暂不强行迁移容器结构；这里仅确认 UTF-8 JSON
        # 可解析，版本统一记为 0，避免恢复检查伪造业务格式约束。
        return 0
    if kind == "canvas":
        return canvas_version(data)
    if kind == "projects":
        return projects_and_version(data)[1]
    if kind == "storage_settings":
        if not isinstance(data, dict) or "format_version" in data:
            raise InvalidDataFormat("存储设置必须保持无版本标记的扁平对象")
        return 0
    if not isinstance(data, list) or any(not isinstance(item, dict) for item in data):
        raise InvalidDataFormat("历史记录必须是对象数组")
    return 0


def _atomic_temp_files(root: Path) -> list[Path]:
    """列出项目数据范围内原子 JSON 写入留下的临时文件。

    ``write_json_atomic`` 使用 ``.<target>.json.<随机值>.tmp`` 命名。
    只扫描根目录（历史文件）和 ``data``（配置、对话、任务及素材索引），
    避免把代码、依赖包或用户导出目录中的普通临时文件误判为项目数据。
    """
    candidates: dict[str, Path] = {}
    scan_roots = [root, root / "data"]
    for scan_root in scan_roots:
        if scan_root.is_symlink():
            relative = scan_root.relative_to(root).as_posix() or "."
            raise InvalidDataFormat(f"{relative}: 数据目录必须是普通目录")
        if not scan_root.exists():
            continue
        if not scan_root.is_dir():
            relative = scan_root.relative_to(root).as_posix() or "."
            raise InvalidDataFormat(f"{relative}: 数据目录必须是普通目录")
        paths = scan_root.glob(".*.json.*.tmp") if scan_root == root else scan_root.rglob(".*.json.*.tmp")
        for path in paths:
            relative = path.relative_to(root).as_posix()
            resolved = path.resolve()
            if path.is_symlink() or not resolved.is_relative_to(root):
                raise InvalidDataFormat(f"{relative}: 临时文件必须位于副本目录内")
            candidates[relative] = path
    return [candidates[key] for key in sorted(candidates)]


def audit_tree(root: Path, *, all_json: bool = False) -> dict[str, tuple[str, int, str]]:
    """返回相对路径到（种类、格式版本、SHA256）的只读清单。"""
    root = root.resolve()
    if not root.is_dir():
        raise InvalidDataFormat("待检查目录不存在")
    temporary_files = _atomic_temp_files(root)
    if temporary_files:
        relative = temporary_files[0].relative_to(root).as_posix()
        raise InvalidDataFormat(
            f"{relative}: 存在中断写入的临时文件，请先核对目标和备份"
        )
    result = {}
    for kind, path, relative in _files(root, all_json=all_json):
        if (path.is_symlink() or not path.is_file()
                or not path.resolve().is_relative_to(root.resolve())):
            raise InvalidDataFormat(f"{relative}: 必须是普通文件")
        try:
            content = path.read_bytes()
            data = json.loads(content.decode("utf-8-sig"))
            version = _version(kind, data)
        except (OSError, UnicodeError, ValueError) as exc:
            raise InvalidDataFormat(f"{relative}: {type(exc).__name__}: {exc}") from exc
        result[relative] = kind, version, hashlib.sha256(content).hexdigest()
    return result


def compare_snapshot(current: dict, snapshot: dict) -> list[str]:
    """比较数据文件路径与内容哈希；不把私人内容放进报告。"""
    differences = []
    for relative in sorted(current.keys() | snapshot.keys()):
        if relative not in current:
            differences.append(f"{relative}: 当前副本缺少文件")
        elif relative not in snapshot:
            differences.append(f"{relative}: 备份缺少文件")
        elif current[relative][2] != snapshot[relative][2]:
            differences.append(f"{relative}: 内容哈希不同")
    return differences


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True, type=Path, help="待检查的数据副本目录")
    parser.add_argument("--snapshot", type=Path, help="可选：与原始备份的 JSON 哈希比较")
    parser.add_argument(
        "--all-json",
        action="store_true",
        help="扩展检查根目录兼容 JSON 和 data/ 下全部 JSON（只输出类型、数量和哈希差异）",
    )
    args = parser.parse_args()
    try:
        current = audit_tree(args.root, all_json=args.all_json)
        counts = {}
        for kind, version, _ in current.values():
            counts[(kind, version)] = counts.get((kind, version), 0) + 1
        summary = ", ".join(
            f"{kind} v{version}: {count}"
            for (kind, version), count in sorted(counts.items())
        ) or "未找到目标 JSON"
        print(f"格式检查通过：{summary}")
        if args.snapshot:
            differences = compare_snapshot(
                current,
                audit_tree(args.snapshot, all_json=args.all_json),
            )
            if differences:
                for item in differences:
                    print(f"备份不一致：{item}")
                return 1
            print(f"备份比对通过：{len(current)} 个 JSON 文件路径与 SHA256 一致")
    except (InvalidDataFormat, OSError) as exc:
        print(f"格式检查失败：{exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
