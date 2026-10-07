"""验证任务记录维护命令的两步流程不会默认删除文件。"""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from backend.task_records import write_task_record


class TaskCleanupCliTests(unittest.TestCase):
    def test_plan_then_explicit_apply(self):
        tool = Path(__file__).resolve().parents[1] / "tools" / "cleanup-task-records.py"
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "tasks"
            root.mkdir()
            write_task_record(
                str(root),
                {"id": "canvas_img_old_task", "status": "succeeded", "updated_at": 0},
            )
            write_task_record(
                str(root),
                {"id": "canvas_img_running_old", "status": "running", "updated_at": 0},
            )
            plan = Path(temp) / "cleanup-plan.json"

            preview = subprocess.run(
                [sys.executable, str(tool), "--root", str(root), "--ttl-days", "0.00001"],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(preview.returncode, 0, preview.stderr)
            self.assertTrue((root / "canvas_img_old_task.json").exists())

            planned = subprocess.run(
                [
                    sys.executable,
                    str(tool),
                    "--root",
                    str(root),
                    "--ttl-days",
                    "0.00001",
                    "--write-plan",
                    str(plan),
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(planned.returncode, 0, planned.stderr)
            self.assertTrue(plan.is_file())
            self.assertTrue((root / "canvas_img_old_task.json").exists())
            self.assertEqual(json.loads(plan.read_text(encoding="utf-8"))["version"], 1)

            applied = subprocess.run(
                [sys.executable, str(tool), "--apply-plan", str(plan)],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(applied.returncode, 0, applied.stderr)
            self.assertFalse((root / "canvas_img_old_task.json").exists())
            self.assertTrue((root / "canvas_img_running_old.json").exists())


if __name__ == "__main__":
    unittest.main()
