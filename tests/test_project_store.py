"""项目存储的文件所有权、兼容性和失败边界，只使用临时数据。"""
import json
import sys
import tempfile
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import RLock
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend import atomic_json
from backend.project_store import ProjectStore, ProjectReadError


class ProjectStoreTests(unittest.TestCase):
    def test_update_preserves_partial_fields_unknown_data_and_empty_patch_timestamp(self):
        self.store.save([{"id": "default", "name": "默认项目", "order": 0},
                         {"id": "p", "name": "旧名称", "order": 2, "created_at": 7,
                          "updated_at": 8, "extra": {"keep": True}}])
        renamed = self.store.update("p", name="  新名称  ")
        self.assertEqual((renamed["name"], renamed["order"], renamed["created_at"], renamed["updated_at"]),
                         ("新名称", 2, 7, 1234))
        self.assertEqual(renamed["extra"], {"keep": True})
        self.assertEqual(self.store.update("p", name="   ", order=0)["name"], "新名称")
        self.assertEqual(self.store.update("p", name="长" * 80)["name"], "长" * 60)
        self.store.now_ms = lambda: 2000
        self.assertEqual(self.store.update("p")["updated_at"], 2000)
        self.assertEqual(self.new_store().load()[1]["order"], 0)

    def test_update_missing_and_failed_save_preserve_existing_file(self):
        self.store.ensure_default()
        before = self.path.read_bytes()
        with self.assertRaises(ValueError) as caught:
            self.store.update("missing", name="不存在")
        self.assertEqual(caught.exception.status_code, 404)
        self.assertEqual(str(caught.exception), "项目不存在")
        with patch.object(atomic_json.os, "replace", side_effect=OSError("replace failed")):
            with self.assertRaises(OSError):
                self.store.update("default", name="失败改名")
        self.assertEqual(self.path.read_bytes(), before)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "项目记录.json"
        self.lock = RLock()
        self.store = self.new_store()

    def new_store(self):
        return ProjectStore(self.path, lock=self.lock, now_ms=lambda: 1234,
                            new_id=lambda: uuid.uuid4().hex, default_id="default")

    def test_missing_file_is_read_only_and_default_initialization_is_idempotent(self):
        self.assertEqual(self.store.load(), [])
        self.assertFalse(self.path.exists())
        records = self.store.ensure_default()
        before = self.path.read_bytes()
        self.assertEqual(records, [{"id": "default", "name": "默认项目", "order": 0,
                                    "created_at": 1234, "updated_at": 1234}])
        self.assertEqual(self.new_store().ensure_default(), records)
        self.assertEqual(self.path.read_bytes(), before)

    def test_legacy_array_preserves_unknown_record_fields_after_create_and_reopen(self):
        old = [{"id": "default", "name": "我的默认", "order": 0},
               {"id": "old", "order": "4", "custom": {"keep": "保留"}}, {"no_id": True}]
        self.path.write_text(json.dumps(old), encoding="utf-8")
        created = self.store.create("  中文项目  ")
        self.assertEqual(created["name"], "中文项目")
        self.assertEqual(created["order"], 5)
        self.assertEqual(created["created_at"], 1234)
        self.assertEqual(len(created["id"]), 32)
        reopened = self.new_store().load()
        self.assertEqual(reopened[:2], old[:2])
        self.assertEqual(reopened[2], created)
        self.assertEqual(json.loads(self.path.read_text(encoding="utf-8"))["format_version"], 1)

    def test_create_keeps_name_default_and_length_rules(self):
        self.assertEqual(self.store.create("  ")["name"], "新项目")
        self.assertEqual(self.store.create("中" * 80)["name"], "中" * 60)

    def test_corrupt_and_future_files_refuse_read_and_write_without_changing_bytes(self):
        for content, status in [("{broken", 500), ('{"format_version":2,"projects":[]}', 409),
                                ('{"projects":"invalid"}', 500)]:
            with self.subTest(content=content):
                self.path.write_text(content, encoding="utf-8")
                for operation in (self.store.load, lambda: self.store.save([]),
                                  self.store.ensure_default, self.store.create):
                    with self.assertRaises(ProjectReadError) as caught:
                        operation()
                    self.assertEqual(caught.exception.status_code, status)
                    self.assertEqual(self.path.read_text(encoding="utf-8"), content)

    def test_read_permission_failure_uses_public_error_without_path_or_contents(self):
        with patch("builtins.open", side_effect=PermissionError("private-path")):
            with self.assertRaises(ProjectReadError) as caught:
                self.store.load()
        self.assertEqual(str(caught.exception), "项目文件读取失败，请从备份恢复")
        self.assertEqual(caught.exception.status_code, 500)

    def test_failed_replace_does_not_claim_creation_or_replace_previous_records(self):
        self.store.ensure_default()
        before = self.path.read_bytes()
        with patch.object(atomic_json.os, "replace", side_effect=OSError("replace failed")):
            with self.assertRaisesRegex(OSError, "replace failed"):
                self.store.create("失败项目")
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(list(self.path.parent.glob(".*.tmp")), [])

    def test_invalid_serialization_preserves_previous_file(self):
        self.store.ensure_default()
        before = self.path.read_bytes()
        with self.assertRaises(TypeError):
            self.store.save([{"id": "invalid", "value": object()}])
        self.assertEqual(self.path.read_bytes(), before)

    def test_concurrent_creates_share_one_lock_across_store_instances(self):
        with ThreadPoolExecutor(max_workers=6) as pool:
            created = list(pool.map(lambda i: self.new_store().create(f"项目{i}"), range(18)))
        records = self.new_store().load()
        self.assertEqual(len(records), 19)
        self.assertEqual(sum(p["id"] == "default" for p in records), 1)
        self.assertEqual({p["id"] for p in records}, {"default", *(p["id"] for p in created)})
        self.assertEqual(sorted(p["order"] for p in created), list(range(1, 19)))


if __name__ == "__main__":
    unittest.main()
