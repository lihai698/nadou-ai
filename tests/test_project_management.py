"""项目管理真实 HTTP 合同：隔离数据、跨文件失败与重试。"""
import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main
from backend import project_store


class ProjectManagementTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.canvases = self.root / "canvases"
        self.canvases.mkdir()
        self.projects = self.root / "projects.json"
        self.projects.write_text(json.dumps({"format_version": 1, "projects": [
            {"id": "default", "name": "默认项目", "order": 0},
            {"id": "p1", "name": "第一项目", "order": 1, "created_at": 7},
            {"id": "p2", "name": "第二项目", "order": 2}]}), encoding="utf-8")
        self.now = 1800000000000
        for name, value in [("CANVAS_DIR", str(self.canvases)), ("PROJECTS_PATH", str(self.projects)),
                            ("now_ms", lambda: self.now)]:
            p = patch.object(main, name, value)
            p.start()
            self.addCleanup(p.stop)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app, raise_app_exceptions=False),
                                       base_url="http://project-management.test")
        self.addAsyncCleanup(self.client.aclose)

    def canvas(self, filename, **extra):
        record = {"id": filename, "kind": "classic", "project": "p1", "format_version": 1,
                  "nodes": [{"id": "n1", "text": "保留中文内容"}], "connections": [],
                  "logs": [{"text": "保留记录"}], "updated_at": 10, **extra}
        path = self.canvases / (filename + ".json")
        path.write_text(json.dumps(record, ensure_ascii=False), encoding="utf-8")
        return path, record

    def project_ids(self):
        return [p["id"] for p in json.loads(self.projects.read_text(encoding="utf-8"))["projects"]]

    async def test_list_uses_summary_and_only_counts_active_canvases(self):
        self.canvas("classic")
        self.canvas("smart", kind="smart")
        self.canvas("legacy", project="")
        self.canvas("deleted", deleted_at=self.now - 1000)
        self.canvas("orphan", project="unknown")
        with patch.object(main, "project_list_records", wraps=main.project_list_records) as summarize:
            response = await self.client.get("/api/projects")
        self.assertEqual(response.status_code, 200)
        summarize.assert_called_once()
        self.assertEqual([(p["id"], p["canvas_count"]) for p in response.json()["projects"]],
                         [("default", 1), ("p1", 2), ("p2", 0)])

    async def test_update_delegates_and_keeps_error_and_partial_update_contract(self):
        with patch.object(project_store.ProjectStore, "update", autospec=True,
                          side_effect=project_store.ProjectStore.update) as update:
            response = await self.client.post("/api/projects/p1", json={"order": 0})
        self.assertEqual(response.status_code, 200)
        update.assert_called_once()
        self.assertEqual(response.json()["project"], {"id": "p1", "name": "第一项目", "order": 0,
                                                      "created_at": 7, "updated_at": self.now})
        missing = await self.client.post("/api/projects/missing", json={"name": "新"})
        self.assertEqual(missing.status_code, 404)
        self.assertEqual(missing.json()["detail"], "项目不存在")
        before = self.projects.read_bytes()
        with patch.object(project_store, "write_json_atomic", side_effect=OSError("write failure")):
            failed = await self.client.post("/api/projects/p1", json={"name": "不能保存"})
        self.assertEqual(failed.status_code, 500)
        self.assertEqual(self.projects.read_bytes(), before)

    async def test_delete_default_and_missing_keep_files(self):
        path, _ = self.canvas("c1")
        before = path.read_bytes(), self.projects.read_bytes()
        for identity, status, message in [("default", 400, "默认项目不可删除"),
                                           ("missing", 404, "项目不存在")]:
            response = await self.client.delete("/api/projects/" + identity)
            self.assertEqual(response.status_code, status)
            self.assertEqual(response.json()["detail"], message)
        self.assertEqual((path.read_bytes(), self.projects.read_bytes()), before)

    async def test_delete_validates_all_files_before_any_migration(self):
        valid, _ = self.canvas("c1")
        bad = self.canvases / "bad.json"
        fixtures = [("{broken", 500, "画布文件读取失败，项目未删除"),
                    (json.dumps({"id": "wrong"}), 500, "画布文件名与 ID 不一致，项目未删除"),
                    (json.dumps({"id": "bad", "format_version": 2}), 409, None)]
        for contents, status, message in fixtures:
            with self.subTest(contents=contents):
                bad.write_text(contents, encoding="utf-8")
                before = valid.read_bytes(), self.projects.read_bytes()
                response = await self.client.delete("/api/projects/p1")
                self.assertEqual(response.status_code, status, response.text)
                if message:
                    self.assertEqual(response.json()["detail"], message)
                self.assertEqual((valid.read_bytes(), self.projects.read_bytes()), before)

    async def test_partial_canvas_failure_preserves_project_and_retry_only_moves_remaining(self):
        first, a = self.canvas("first")
        second, b = self.canvas("second", kind="smart")
        unrelated, _ = self.canvas("unrelated", project="p2")
        before_project = self.projects.read_bytes()
        before_unrelated = unrelated.read_bytes()
        real_write = main._write_canvas_document
        writes = []

        def fail_second(record):
            writes.append(record["id"])
            if len(writes) == 2:
                raise OSError("second canvas failure")
            return real_write(record)

        with patch.object(main, "_write_canvas_document", side_effect=fail_second):
            failed = await self.client.delete("/api/projects/p1")
        self.assertEqual(failed.status_code, 500)
        self.assertEqual(self.projects.read_bytes(), before_project)
        self.assertEqual(sum(json.loads(p.read_text(encoding="utf-8"))["project"] == "default"
                             for p in (first, second)), 1)
        retry = await self.client.delete("/api/projects/p1")
        self.assertEqual(retry.status_code, 200)
        self.assertEqual(retry.json(), {"ok": True, "moved": 1})
        self.assertNotIn("p1", self.project_ids())
        for path, old in ((first, a), (second, b)):
            expected = copy.deepcopy(old)
            expected["project"] = "default"
            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), expected)
        self.assertEqual(unrelated.read_bytes(), before_unrelated)

    async def test_delete_route_uses_service_and_keeps_deleted_canvas_contents(self):
        from backend import project_service
        path, old = self.canvas("trash", deleted_at=self.now - 1000)
        with patch.object(project_service, "delete_project", wraps=project_service.delete_project) as delete:
            response = await self.client.delete("/api/projects/p1")
        self.assertEqual(response.status_code, 200)
        delete.assert_called_once()
        self.assertEqual(response.json(), {"ok": True, "moved": 1})
        old["project"] = "default"
        self.assertEqual(json.loads(path.read_text(encoding="utf-8")), old)


if __name__ == "__main__":
    unittest.main()
