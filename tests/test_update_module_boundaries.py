"""更新模块拆分必须保持的锁、路径、状态字段和公开错误边界。"""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main


class UpdateModuleBoundaryTests(unittest.TestCase):
    def test_status_fields_named_like_dependencies_are_preserved(self):
        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(main, "DATA_DIR", tmp):
                job = "a" * 32
                main.write_full_update_status(job, phase="preparing", full_update_status_path="user-field", write_json_atomic="also-user-field")
                main.write_full_update_status(job, phase="verifying")
                state = json.loads(Path(main.full_update_status_path(job)).read_text(encoding="utf-8"))
        self.assertEqual(state, {"job_id": job, "phase": "verifying", "full_update_status_path": "user-field", "write_json_atomic": "also-user-field"})

    def test_full_update_paths_reject_private_and_unsafe_values(self):
        for value in ("../main.py", "backend/../main.py", "API/.env", "data/private.json", "static/CON.txt", "static/a.", "C:/main.py", "static\\a.js"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                main.full_update_path(value)
        self.assertEqual(main.full_update_path("API/.env.example"), "API/.env.example")
        self.assertEqual(main.full_update_path("backend/service.py"), "backend/service.py")

    def test_update_lock_conflict_never_starts_download(self):
        self.assertTrue(main.UPDATE_LOCK.acquire(blocking=False))
        try:
            with patch.object(main, "stage_update_from_github") as stage, self.assertRaises(main.HTTPException) as caught:
                main.update_from_github(main.UpdateRequest())
            self.assertEqual(caught.exception.status_code, 409)
            stage.assert_not_called()
        finally:
            main.UPDATE_LOCK.release()

    def test_notes_select_requested_version_and_bound_items(self):
        notes = main.safe_update_notes({"version": "new", "history": [{"version": "old", "update_mode": "in_app", "items": ["entry"]}]}, "old")
        self.assertEqual(notes["version"], "old")
        self.assertEqual(notes["items"], [{"type": "update", "text": "entry"}])
        self.assertEqual(len(main.safe_update_notes({"items": ["x"] * 40})["items"]), 30)


if __name__ == "__main__":
    unittest.main()
