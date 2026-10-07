#!/usr/bin/env python3
"""生成并显式应用本地图片/ComfyUI任务记录的过期清理计划。

默认只生成计划，不删除任何文件。清理分两步执行：

    python tools/cleanup-task-records.py --write-plan output/task-cleanup.json
    python tools/cleanup-task-records.py --apply-plan output/task-cleanup.json

应用阶段会重新校验任务记录的状态、时间、文件指纹和路径；计划过期或记录
发生变化时会拒绝删除。视频任务目录不在本工具范围内，因为视频记录必须先
完成远端对账。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.atomic_json import write_json_atomic
from backend.task_record_cleanup import (
    TaskCleanupCandidate,
    TaskCleanupError,
    TaskCleanupPlan,
    apply_task_cleanup_plan,
    plan_expired_task_cleanup,
)


PLAN_VERSION = 1
DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60


def default_root() -> Path:
    configured = str(os.getenv("NADOU_CANVAS_TASK_DIR") or "").strip()
    return Path(configured) if configured else PROJECT_ROOT / "data" / "canvas_tasks"


def plan_to_json(plan: TaskCleanupPlan) -> Dict[str, Any]:
    return {
        "version": PLAN_VERSION,
        "root": plan.root,
        "now": float(plan.now),
        "ttl_seconds": float(plan.ttl_seconds),
        "candidates": [
            {
                "task_id": candidate.task_id,
                "status": candidate.status,
                "age_seconds": float(candidate.age_seconds),
                "timestamp_field": candidate.timestamp_field,
                "timestamp": float(candidate.timestamp),
                "stat_token": list(candidate.stat_token),
                "content_sha256": candidate.content_sha256,
            }
            for candidate in plan.candidates
        ],
        "preserved_task_ids": list(plan.preserved_task_ids),
    }


def plan_from_json(value: Any) -> TaskCleanupPlan:
    if not isinstance(value, dict) or value.get("version") != PLAN_VERSION:
        raise TaskCleanupError("清理计划版本无效")
    try:
        candidates = tuple(
            TaskCleanupCandidate(
                task_id=str(item["task_id"]),
                status=str(item["status"]),
                age_seconds=float(item["age_seconds"]),
                timestamp_field=str(item["timestamp_field"]),
                timestamp=float(item["timestamp"]),
                stat_token=tuple(int(part) for part in item["stat_token"]),
                content_sha256=str(item["content_sha256"]),
            )
            for item in value.get("candidates", [])
        )
        preserved = tuple(str(item) for item in value.get("preserved_task_ids", []))
        return TaskCleanupPlan(
            root=str(value["root"]),
            now=float(value["now"]),
            ttl_seconds=float(value["ttl_seconds"]),
            candidates=candidates,
            preserved_task_ids=preserved,
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise TaskCleanupError("清理计划格式无效") from exc


def read_plan(path: Path) -> TaskCleanupPlan:
    try:
        with path.open("r", encoding="utf-8-sig") as handle:
            return plan_from_json(json.load(handle))
    except FileNotFoundError as exc:
        raise TaskCleanupError("清理计划文件不存在") from exc
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise TaskCleanupError("清理计划文件无法读取") from exc


def print_plan(plan: TaskCleanupPlan) -> None:
    print(f"任务记录目录：{plan.root}")
    print(f"过期阈值：{plan.ttl_seconds / 86400:.2f} 天")
    print(f"可清理：{len(plan.candidates)} 条；保留：{len(plan.preserved_task_ids)} 条")
    for candidate in plan.candidates:
        print(f"  {candidate.task_id}  status={candidate.status}  age_days={candidate.age_seconds / 86400:.2f}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="安全清理已确认结束且过期的图片/ComfyUI任务记录")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--write-plan", type=Path, help="生成并保存清理计划，不删除记录")
    mode.add_argument("--apply-plan", type=Path, help="读取并显式应用已有清理计划")
    parser.add_argument("--root", type=Path, default=None, help="任务记录目录，默认 data/canvas_tasks")
    parser.add_argument("--ttl-days", type=float, default=30.0, help="终态记录的最短保留天数，默认 30")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        if args.apply_plan:
            plan = read_plan(args.apply_plan)
            print_plan(plan)
            removed = apply_task_cleanup_plan(plan)
            print(f"已删除：{len(removed)} 条")
            for task_id in removed:
                print(f"  {task_id}")
            return 0

        root = args.root or default_root()
        if args.ttl_days <= 0:
            raise TaskCleanupError("保留天数必须大于零")
        plan = plan_expired_task_cleanup(root, ttl_seconds=args.ttl_days * 86400)
        print_plan(plan)
        if args.write_plan:
            target = args.write_plan
            target.parent.mkdir(parents=True, exist_ok=True)
            write_json_atomic(target, plan_to_json(plan), ensure_ascii=False, indent=2)
            print(f"计划已保存：{target}")
        else:
            print("当前为只读预览；如需删除，请使用 --write-plan 保存后再用 --apply-plan 应用。")
        return 0
    except (TaskCleanupError, OSError, ValueError) as exc:
        print(f"清理未执行：{exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
