"""创建、校验和恢复本地项目快照。

示例：
  python tools/backup-restore.py create --source <项目目录> --snapshot <新目录>
  python tools/backup-restore.py verify --snapshot <快照目录>
  python tools/backup-restore.py restore --snapshot <快照目录> --destination <新目录>

恢复命令只接受不存在的新目录，不会覆盖已有文件。输出只包含文件数量、
字节数和格式版本，不打印文件内容或配置值。
"""

from __future__ import annotations

import argparse
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.backup_restore import BackupRestoreError, create_snapshot, restore_snapshot, verify_snapshot


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    create = subparsers.add_parser("create", help="创建新快照")
    create.add_argument("--source", required=True, type=Path)
    create.add_argument("--snapshot", required=True, type=Path)

    verify = subparsers.add_parser("verify", help="校验快照")
    verify.add_argument("--snapshot", required=True, type=Path)

    restore = subparsers.add_parser("restore", help="恢复到新的空目录")
    restore.add_argument("--snapshot", required=True, type=Path)
    restore.add_argument("--destination", required=True, type=Path)

    args = parser.parse_args()
    try:
        if args.command == "create":
            result = create_snapshot(args.source, args.snapshot)
        elif args.command == "verify":
            result = verify_snapshot(args.snapshot)
        else:
            result = restore_snapshot(args.snapshot, args.destination)
    except (BackupRestoreError, OSError) as exc:
        print(f"快照操作失败：{exc}", file=sys.stderr)
        return 1
    print(
        f"快照操作通过：format_version={result['format_version']}，"
        f"files={result['file_count']}，bytes={result['bytes']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
