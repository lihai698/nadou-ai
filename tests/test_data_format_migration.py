"""阶段 10：旧 JSON 按需标版本、未来版本保护与隔离恢复。"""

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import main
from backend.data_formats import (
    InvalidDataFormat,
    UnsupportedDataFormat,
    canvas_version,
    projects_and_version,
)


class FormatRuleTests(unittest.TestCase):
    def test_legacy_current_and_future_version_rules(self):
        self.assertEqual(canvas_version({"id": "c1", "nodes": [], "connections": []}), 0)
        self.assertEqual(canvas_version({"id": "c1", "format_version": 1}), 1)
        self.assertEqual(projects_and_version([{"id": "p1"}])[1], 0)
        self.assertEqual(projects_and_version({"projects": [{"id": "p1"}]})[1], 0)
        self.assertEqual(projects_and_version({"format_version": 1, "projects": []})[1], 1)
        for bad in (True, "1", -1):
            with self.subTest(bad=bad), self.assertRaises(InvalidDataFormat):
                canvas_version({"id": "c1", "format_version": bad})
        with self.assertRaises(UnsupportedDataFormat):
            projects_and_version({"format_version": 2, "projects": []})

    def test_legacy_reader_compatibility_is_recorded_explicitly(self):
        """确认版本标记对旧程序的影响，避免把恢复能力当成兼容性。"""

        def legacy_canvas_reader(document):
            if not isinstance(document, dict) or not document.get("id"):
                raise ValueError("legacy canvas shape")
            return document["id"]

        def legacy_projects_reader(document):
            if not isinstance(document, list):
                raise ValueError("legacy projects shape")
            return [item["id"] for item in document if isinstance(item, dict) and item.get("id")]

        old_canvas = {"id": "c1", "nodes": [], "connections": [], "format_version": 1}
        new_projects = {"format_version": 1, "projects": [{"id": "p1"}]}
        self.assertEqual(legacy_canvas_reader(old_canvas), "c1")
        with self.assertRaises(ValueError):
            legacy_projects_reader(new_projects)
        self.assertEqual(projects_and_version([{"id": "p1"}])[0][0]["id"], "p1")


class FormatHttpTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="format-migration-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.canvas_dir = self.root / "data" / "canvases"
        self.canvas_dir.mkdir(parents=True)
        self.projects_path = self.root / "data" / "projects.json"
        for name, value in (("CANVAS_DIR", str(self.canvas_dir)),
                            ("PROJECTS_PATH", str(self.projects_path))):
            context = patch.object(main, name, value)
            context.start()
            self.addCleanup(context.stop)
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app, raise_app_exceptions=False),
            base_url="http://formats.test",
        )
        self.addAsyncCleanup(self.client.aclose)

    def seed_canvas(self, canvas_id="c1", **extra):
        document = {
            "id": canvas_id, "title": "旧标题", "icon": "layers",
            "kind": "classic", "project": "p1", "updated_at": 10,
            "nodes": [{"id": "n1", "type": "text", "text": "保留内容"}],
            "connections": [], "viewport": {"x": 0, "y": 0, "scale": 1},
        }
        document.update(extra)
        path = self.canvas_dir / f"{canvas_id}.json"
        path.write_text(json.dumps(document, ensure_ascii=False), encoding="utf-8")
        return path

    async def test_legacy_canvas_and_project_read_then_write_version_one(self):
        canvas_path = self.seed_canvas()
        self.projects_path.write_text(json.dumps([
            {"id": "default", "name": "默认项目", "order": 0},
            {"id": "p1", "name": "旧项目", "order": 1},
        ], ensure_ascii=False), encoding="utf-8")
        old_canvas = (await self.client.get("/api/canvases/c1")).json()["canvas"]
        self.assertNotIn("format_version", old_canvas)
        saved = await self.client.put("/api/canvases/c1", json={
            "title": "新标题", "nodes": old_canvas["nodes"], "connections": [],
            "base_updated_at": old_canvas["updated_at"],
        })
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(json.loads(canvas_path.read_text(encoding="utf-8"))["format_version"], 1)
        self.assertEqual(saved.json()["canvas"]["nodes"], old_canvas["nodes"])

        old_projects = (await self.client.get("/api/projects")).json()["projects"]
        self.assertEqual([item["id"] for item in old_projects], ["default", "p1"])
        created = await self.client.post("/api/projects", json={"name": "新项目"})
        self.assertEqual(created.status_code, 200, created.text)
        project_data = json.loads(self.projects_path.read_text(encoding="utf-8"))
        self.assertEqual(project_data["format_version"], 1)
        self.assertEqual([item["id"] for item in project_data["projects"][:2]], ["default", "p1"])

    async def test_future_or_invalid_versions_refuse_read_and_preserve_bytes(self):
        canvas_path = self.seed_canvas(format_version=2)
        before_canvas = canvas_path.read_bytes()
        for method, url, data in (
            ("get", "/api/canvases/c1", None),
            ("post", "/api/canvases/c1/meta", {"title": "覆盖"}),
            ("put", "/api/canvases/c1", {"title": "覆盖", "nodes": [], "connections": []}),
        ):
            with self.subTest(method=method):
                response = await getattr(self.client, method)(url, **({"json": data} if data else {}))
                self.assertEqual(response.status_code, 409, response.text)
                self.assertEqual(canvas_path.read_bytes(), before_canvas)

        self.projects_path.write_text('{"format_version":2,"projects":[{"id":"p1"}]}', encoding="utf-8")
        before_projects = self.projects_path.read_bytes()
        self.assertEqual((await self.client.get("/api/projects")).status_code, 409)
        self.assertEqual((await self.client.post("/api/projects", json={"name": "覆盖"})).status_code, 409)
        self.assertEqual(self.projects_path.read_bytes(), before_projects)

        self.projects_path.write_text('{"projects": broken}', encoding="utf-8")
        corrupt = self.projects_path.read_bytes()
        self.assertEqual((await self.client.post("/api/projects", json={"name": "覆盖"})).status_code, 500)
        self.assertEqual(self.projects_path.read_bytes(), corrupt)

    async def test_project_delete_migrates_canvas_atomically_then_removes_project(self):
        canvas_path = self.seed_canvas()
        self.projects_path.write_text(json.dumps({"projects": [
            {"id": "default", "name": "默认项目"},
            {"id": "p1", "name": "要删除的项目"},
        ]}, ensure_ascii=False), encoding="utf-8")
        result = await self.client.delete("/api/projects/p1")
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()["moved"], 1)
        canvas = json.loads(canvas_path.read_text(encoding="utf-8"))
        self.assertEqual((canvas["project"], canvas["format_version"], canvas["updated_at"]),
                         ("default", 1, 10))
        projects = json.loads(self.projects_path.read_text(encoding="utf-8"))
        self.assertEqual(projects["format_version"], 1)
        self.assertEqual([item["id"] for item in projects["projects"]], ["default"])

    async def test_project_delete_failure_keeps_project_and_old_canvas(self):
        canvas_path = self.seed_canvas()
        self.projects_path.write_text(json.dumps({"projects": [
            {"id": "default"}, {"id": "p1"},
        ]}), encoding="utf-8")
        old_canvas, old_projects = canvas_path.read_bytes(), self.projects_path.read_bytes()
        with patch.object(main, "write_json_atomic", side_effect=OSError("isolated failure")):
            result = await self.client.delete("/api/projects/p1")
        self.assertEqual(result.status_code, 500)
        self.assertEqual(canvas_path.read_bytes(), old_canvas)
        self.assertEqual(self.projects_path.read_bytes(), old_projects)

    async def test_project_delete_partial_failure_can_retry_without_losing_canvas(self):
        canvas_path = self.seed_canvas()
        self.projects_path.write_text(json.dumps({"projects": [
            {"id": "default"}, {"id": "p1"},
        ]}), encoding="utf-8")
        old_projects = self.projects_path.read_bytes()
        original_write = main.write_json_atomic

        def fail_project_write(path, value, **kwargs):
            if Path(path) == self.projects_path:
                raise OSError("isolated project write failure")
            return original_write(path, value, **kwargs)

        with patch.object(main, "write_json_atomic", side_effect=fail_project_write):
            failed = await self.client.delete("/api/projects/p1")
        self.assertEqual(failed.status_code, 500)
        self.assertEqual(self.projects_path.read_bytes(), old_projects)
        self.assertEqual(json.loads(canvas_path.read_text(encoding="utf-8"))["project"], "default")

        retried = await self.client.delete("/api/projects/p1")
        self.assertEqual(retried.status_code, 200, retried.text)
        self.assertEqual(retried.json()["moved"], 0)
        self.assertEqual([item["id"] for item in json.loads(self.projects_path.read_text(encoding="utf-8"))
                          ["projects"]], ["default"])


class RecoveryToolTests(unittest.TestCase):
    def test_atomic_json_residue_in_any_data_subdirectory_is_rejected(self):
        with tempfile.TemporaryDirectory(prefix="format-temp-residue-") as temporary:
            root = Path(temporary)
            data = root / "data" / "conversations"
            data.mkdir(parents=True)
            (root / "history.json").write_text("[]", encoding="utf-8")
            residue = data / ".conversation-user.json.interrupted.tmp"
            residue.write_text('{"incomplete":', encoding="utf-8")
            command = [sys.executable, str(ROOT / "tools" / "check-data-formats.py")]

            result = subprocess.run(
                command + ["--root", str(root)],
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertEqual(result.returncode, 1)
            self.assertIn("data/conversations/.conversation-user.json.interrupted.tmp", result.stderr)
            self.assertNotIn("incomplete", result.stderr)

    def test_corrupt_copy_restored_to_new_directory_without_overwriting_backup(self):
        with tempfile.TemporaryDirectory(prefix="format-recovery-") as temporary:
            root = Path(temporary)
            working, backup, restored = (root / part for part in ("working", "backup", "restored"))
            (working / "data" / "canvases").mkdir(parents=True)
            (working / "data" / "canvases" / "c1.json").write_text(
                '{"id":"c1","nodes":[],"connections":[]}', encoding="utf-8")
            (working / "data" / "projects.json").write_text(
                '{"projects":[{"id":"default"}]}', encoding="utf-8")
            (working / "data" / "storage_settings.json").write_text(
                '{"upload":"isolated/upload"}', encoding="utf-8")
            (working / "history.json").write_text('[]', encoding="utf-8")
            shutil.copytree(working, backup)
            command = [sys.executable, str(ROOT / "tools" / "check-data-formats.py")]

            initial = subprocess.run(command + ["--root", str(working), "--snapshot", str(backup)],
                                     capture_output=True, text=True, check=False)
            self.assertEqual(initial.returncode, 0, initial.stderr)
            interrupted = working / "data" / ".projects.json.interrupted.tmp"
            interrupted.write_text('{"incomplete":', encoding="utf-8")
            residue = subprocess.run(command + ["--root", str(working)],
                                     capture_output=True, text=True, check=False)
            self.assertEqual(residue.returncode, 1)
            interrupted.unlink()
            before_backup = (backup / "data" / "projects.json").read_bytes()
            (working / "data" / "projects.json").write_text('{broken', encoding="utf-8")
            damaged = subprocess.run(command + ["--root", str(working)],
                                     capture_output=True, text=True, check=False)
            self.assertEqual(damaged.returncode, 1)

            shutil.copytree(backup, restored)
            recovered = subprocess.run(command + ["--root", str(restored), "--snapshot", str(backup)],
                                       capture_output=True, text=True, check=False)
            self.assertEqual(recovered.returncode, 0, recovered.stderr)
            self.assertEqual((backup / "data" / "projects.json").read_bytes(), before_backup)
            self.assertEqual(json.loads((restored / "data" / "projects.json").read_text(encoding="utf-8"))
                             ["projects"][0]["id"], "default")

    def test_all_json_mode_covers_local_records_without_printing_content(self):
        with tempfile.TemporaryDirectory(prefix="format-all-json-") as temporary:
            root = Path(temporary)
            working, backup = root / "working", root / "backup"
            (working / "data" / "canvases").mkdir(parents=True)
            (working / "data" / "conversations").mkdir(parents=True)
            (working / "data" / "canvases" / "c1.json").write_text(
                '{"id":"c1","nodes":[],"connections":[]}', encoding="utf-8")
            (working / "data" / "projects.json").write_text(
                '{"projects":[{"id":"default"}]}', encoding="utf-8")
            (working / "data" / "storage_settings.json").write_text(
                '{"upload":"isolated/upload"}', encoding="utf-8")
            (working / "data" / "conversations" / "user.json").write_text(
                '{"messages":["secret fixture text"]}', encoding="utf-8")
            (working / "history.json").write_text("[]", encoding="utf-8")
            (working / "global_config.json").write_text(
                '{"theme":"dark","token":"secret fixture token"}', encoding="utf-8")
            shutil.copytree(working, backup)
            command = [sys.executable, str(ROOT / "tools" / "check-data-formats.py")]

            checked = subprocess.run(
                command + ["--root", str(working), "--snapshot", str(backup), "--all-json"],
                capture_output=True, text=True, check=False,
            )
            self.assertEqual(checked.returncode, 0, checked.stderr)
            self.assertIn("json v0", checked.stdout)
            self.assertNotIn("secret fixture", checked.stdout + checked.stderr)

            conversation = working / "data" / "conversations" / "user.json"
            conversation.write_text('{"messages":["changed"]}', encoding="utf-8")
            changed = subprocess.run(
                command + ["--root", str(working), "--snapshot", str(backup), "--all-json"],
                capture_output=True, text=True, check=False,
            )
            self.assertEqual(changed.returncode, 1)
            self.assertIn("data/conversations/user.json: 内容哈希不同", changed.stdout)
            self.assertNotIn("secret fixture", changed.stdout + changed.stderr)


if __name__ == "__main__":
    unittest.main()
