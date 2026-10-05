"""验证任务记录维护计划入口只读且不删除文件。"""

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main
from backend.task_records import write_task_record


class TaskRecordCleanupRouteTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.task_dir = tempfile.TemporaryDirectory()
        self.dir_patch = patch.object(main, "CANVAS_TASK_DIR", self.task_dir.name)
        self.dir_patch.start()
        self.addCleanup(self.dir_patch.stop)
        self.addCleanup(self.task_dir.cleanup)
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app),
            base_url="http://maintenance.test",
        )
        self.addAsyncCleanup(self.client.aclose)

    def _write(self, task_id, status, **extra):
        record = {"id": task_id, "status": status}
        record.update(extra)
        write_task_record(self.task_dir.name, record)

    async def test_get_plan_is_read_only_and_excludes_unfinished_tasks(self):
        self._write("canvas_img_old_success", "succeeded", updated_at=100)
        self._write("canvas_img_old_running", "running", updated_at=100)

        response = await self.client.get(
            "/api/maintenance/task-records/cleanup-plan",
            params={"ttl_seconds": 100},
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["mode"], "plan_only")
        self.assertFalse(body["applied"])
        self.assertEqual(body["candidate_count"], 1)
        self.assertEqual(body["candidates"][0]["task_id"], "canvas_img_old_success")
        self.assertEqual(body["preserved_count"], 1)
        self.assertTrue(Path(self.task_dir.name, "canvas_img_old_success.json").is_file())
        self.assertTrue(Path(self.task_dir.name, "canvas_img_old_running.json").is_file())

    async def test_invalid_or_corrupt_records_return_fixed_error_without_body(self):
        response = await self.client.get(
            "/api/maintenance/task-records/cleanup-plan",
            params={"ttl_seconds": 0},
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["detail"], "无法生成任务记录清理计划，请先检查本地任务记录")

        Path(self.task_dir.name, "canvas_img_corrupt_record.json").write_text(
            '{"id":"canvas_img_corrupt_record","status":"succeeded",',
            encoding="utf-8",
        )
        response = await self.client.get(
            "/api/maintenance/task-records/cleanup-plan",
            params={"ttl_seconds": 100},
        )
        self.assertEqual(response.status_code, 409)
        self.assertNotIn("canvas_img_corrupt_record", json.dumps(response.json(), ensure_ascii=False))


if __name__ == "__main__":
    unittest.main()
