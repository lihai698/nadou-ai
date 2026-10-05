"""Project record rules and the public project API, using temporary storage only."""

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main
from backend.project_records import (
    next_project_order,
    project_record,
    project_sort_key,
)


class ProjectRecordRulesTests(unittest.TestCase):
    def test_public_record_keeps_existing_fields_and_defaults(self):
        self.assertEqual(project_record({"id": "p1"}), {
            "id": "p1",
            "name": "未命名项目",
            "order": 0,
            "created_at": 0,
            "updated_at": 0,
        })
        self.assertEqual(project_record({
            "id": "p2", "name": "长" * 70, "order": "4",
            "created_at": 12, "updated_at": 34, "private": "hidden",
        }), {
            "id": "p2",
            "name": "长" * 60,
            "order": 4,
            "created_at": 12,
            "updated_at": 34,
        })

    def test_sort_and_next_order_keep_legacy_conversion(self):
        projects = [
            {"id": "later", "order": "2", "created_at": 30},
            {"id": "earlier", "order": "2", "created_at": 10},
            {"id": "first", "order": None, "created_at": 50},
        ]
        self.assertEqual([p["id"] for p in sorted(projects, key=project_sort_key)],
                         ["first", "earlier", "later"])
        self.assertEqual(next_project_order(projects), 3)
        self.assertEqual(next_project_order([]), 1)

    def test_main_keeps_compatible_project_record_entry(self):
        self.assertIs(main.project_record, project_record)


class ProjectRecordApiTests(unittest.IsolatedAsyncioTestCase):
    async def test_create_list_update_use_same_public_record(self):
        with tempfile.TemporaryDirectory(prefix="project-records-") as temp:
            root = Path(temp)
            canvas_dir = root / "canvases"
            canvas_dir.mkdir()
            with patch.object(main, "PROJECTS_PATH", str(root / "projects.json")), \
                    patch.object(main, "CANVAS_DIR", str(canvas_dir)):
                async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=main.app),
                    base_url="http://project-records.test",
                ) as client:
                    created = await client.post("/api/projects", json={"name": "  中文项目  "})
                    self.assertEqual(created.status_code, 200, created.text)
                    project = created.json()["project"]
                    self.assertEqual(project["name"], "中文项目")
                    self.assertEqual(project["order"], 1)
                    self.assertEqual(set(project), {
                        "id", "name", "order", "created_at", "updated_at",
                    })

                    listed = await client.get("/api/projects")
                    self.assertEqual(listed.status_code, 200, listed.text)
                    records = listed.json()["projects"]
                    self.assertEqual([p["id"] for p in records], ["default", project["id"]])
                    self.assertEqual(records[1]["canvas_count"], 0)

                    updated = await client.post(
                        "/api/projects/" + project["id"],
                        json={"name": "  新名字  ", "order": 3},
                    )
                    self.assertEqual(updated.status_code, 200, updated.text)
                    self.assertEqual(updated.json()["project"]["name"], "新名字")
                    self.assertEqual(updated.json()["project"]["order"], 3)


if __name__ == "__main__":
    unittest.main()
