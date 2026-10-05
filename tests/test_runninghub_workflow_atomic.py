"""RunningHub 工作流索引的原子保存与损坏恢复边界。"""

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main
from backend import atomic_json


class RunningHubWorkflowAtomicTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="runninghub-workflow-atomic-")
        self._temporary = temporary
        self.root = Path(temporary.name)
        self.data = self.root / "data"
        self.data.mkdir()
        self.index = self.data / "runninghub_workflows.json"
        self.patches = [
            patch.object(main, "DATA_DIR", str(self.data)),
            patch.object(main, "RUNNINGHUB_WORKFLOW_STORE_FILE", str(self.index)),
        ]
        for active_patch in self.patches:
            active_patch.start()
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app, raise_app_exceptions=False),
            base_url="http://runninghub-workflow-atomic.test",
        )

    async def asyncTearDown(self):
        await self.client.aclose()
        for active_patch in reversed(self.patches):
            active_patch.stop()
        self._temporary.cleanup()

    def assert_no_temporary_index(self):
        self.assertEqual(list(self.data.glob(".runninghub_workflows.json.*.tmp")), [])

    async def put_workflow(self, title):
        with patch.object(main, "sync_runninghub_workflow_to_provider"):
            return await self.client.put(
                "/api/runninghub/workflows/rh_test_001",
                json={
                    "workflowId": "rh_test_001",
                    "title": title,
                    "description": "隔离工作流",
                    "workflowJson": {"1": {"class_type": "Synthetic"}},
                },
            )

    async def test_put_writes_workflow_store_and_can_reload(self):
        response = await self.put_workflow("测试工作流")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["workflow"]["title"], "测试工作流")
        saved = json.loads(self.index.read_text(encoding="utf-8"))
        self.assertEqual(saved["rh_test_001"]["title"], "测试工作流")
        self.assertEqual(main.load_runninghub_workflow_store()["rh_test_001"]["title"], "测试工作流")
        self.assert_no_temporary_index()

    async def test_replace_failure_preserves_old_store_and_allows_retry(self):
        created = await self.put_workflow("旧标题")
        self.assertEqual(created.status_code, 200, created.text)
        before = self.index.read_bytes()

        with patch.object(atomic_json.os, "replace", side_effect=OSError("replace failed")):
            failed = await self.put_workflow("新标题")
        self.assertEqual(failed.status_code, 500, failed.text)
        self.assertIn("已保留原文件", failed.text)
        self.assertEqual(self.index.read_bytes(), before)
        self.assertEqual(main.load_runninghub_workflow_store()["rh_test_001"]["title"], "旧标题")
        self.assert_no_temporary_index()

        recovered = await self.put_workflow("恢复标题")
        self.assertEqual(recovered.status_code, 200, recovered.text)
        self.assertEqual(recovered.json()["workflow"]["title"], "恢复标题")
        self.assert_no_temporary_index()

    async def test_corrupt_existing_store_is_not_overwritten(self):
        before = b'{"rh_test_001": [broken]}'
        self.index.write_bytes(before)

        failed = await self.put_workflow("不应覆盖")
        self.assertEqual(failed.status_code, 500, failed.text)
        self.assertIn("已保留原文件", failed.text)
        self.assertEqual(self.index.read_bytes(), before)
        self.assert_no_temporary_index()

    async def test_legacy_raw_workflow_is_readable_and_new_save_drops_raw(self):
        workflow = {"1": {"class_type": "Synthetic"}}
        legacy = {
            "workflowId": "rh_test_001",
            "title": "旧工作流",
            "fields": [],
            "raw": {"data": {"prompt": json.dumps(workflow)}, "debug": "private-debug-token"},
        }
        self.index.write_text(json.dumps({"rh_test_001": legacy}), encoding="utf-8")
        with patch.object(main, "runninghub_provider_workflow_config", return_value=None), patch.object(
            main, "runninghub_static_workflow_config", return_value=None
        ):
            loaded = await self.client.get("/api/runninghub/workflows/rh_test_001")
        self.assertEqual(loaded.status_code, 200, loaded.text)
        self.assertEqual(loaded.json()["workflow"]["workflowJson"], workflow)
        self.assertNotIn("raw", loaded.json()["workflow"])
        self.assertNotIn("private-debug-token", loaded.text)

        with patch.object(main, "sync_runninghub_workflow_to_provider"):
            saved = await self.client.put("/api/runninghub/workflows/rh_test_001", json=legacy)
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(saved.json()["workflow"]["workflowJson"], workflow)
        self.assertNotIn("raw", saved.json()["workflow"])
        persisted = json.loads(self.index.read_text(encoding="utf-8"))["rh_test_001"]
        self.assertEqual(persisted["workflowJson"], workflow)
        self.assertNotIn("raw", persisted)

    def test_public_provider_omits_runninghub_entry_raw(self):
        provider = {
            "id": "runninghub", "rh_apps": [{"id": "app1", "raw": {"debug": "private-debug-token"}}],
            "rh_workflows": [{"id": "wf1", "raw": {"data": {"prompt": '{"1":{"class_type":"Synthetic"}}'}, "debug": "private-debug-token"}}],
        }
        with patch.object(main, "runninghub_provider_with_workflow_store", return_value=provider), patch.object(
            main, "provider_env_key_value", return_value=""
        ), patch.object(main, "runninghub_wallet_key_value", return_value=""):
            public = main.public_provider(provider)
        self.assertNotIn("private-debug-token", json.dumps(public))
        self.assertNotIn("raw", public["rh_apps"][0])
        self.assertEqual(public["rh_workflows"][0]["workflowJson"], {"1": {"class_type": "Synthetic"}})


if __name__ == "__main__":
    unittest.main()
