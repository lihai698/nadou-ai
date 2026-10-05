"""ComfyUI 工作流上传和配置文件的原子保存边界。"""

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


class ComfyWorkflowAtomicTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="comfy-workflow-atomic-")
        self._temporary = temporary
        self.root = Path(temporary.name)
        self.workflow_dir = self.root / "workflows"
        self.patches = [patch.object(main, "WORKFLOW_DIR", str(self.workflow_dir))]
        for active_patch in self.patches:
            active_patch.start()
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app, raise_app_exceptions=False),
            base_url="http://comfy-workflow-atomic.test",
        )

    async def asyncTearDown(self):
        await self.client.aclose()
        for active_patch in reversed(self.patches):
            active_patch.stop()
        self._temporary.cleanup()

    @property
    def workflow_path(self):
        return self.workflow_dir / "custom" / "demo.json"

    @property
    def config_path(self):
        return self.workflow_dir / "custom" / "demo.config.json"

    @staticmethod
    def workflow_payload(label="Synthetic"):
        return {"1": {"class_type": label, "inputs": {}}}

    async def upload(self, label="Synthetic"):
        return await self.client.post(
            "/api/workflows",
            json={"name": "demo.json", "workflow": self.workflow_payload(label)},
        )

    async def save_config(self, title="测试工作流"):
        return await self.client.put(
            "/api/workflows/custom/demo.json/config",
            json={
                "title": title,
                "fields": [{"id": "1::text", "node": "1", "input": "text"}],
                "mini_cards": {"1": {"title": "测试"}},
            },
        )

    def assert_no_temporary_json(self):
        if self.workflow_dir.exists():
            self.assertEqual(list(self.workflow_dir.rglob("*.tmp")), [])

    async def test_upload_is_atomic_and_reloadable(self):
        response = await self.upload()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {"name": "custom/demo.json"})
        self.assertEqual(
            json.loads(self.workflow_path.read_text(encoding="utf-8")),
            self.workflow_payload(),
        )
        self.assert_no_temporary_json()

    async def test_upload_replace_failure_preserves_old_file_and_can_retry(self):
        created = await self.upload("旧工作流")
        self.assertEqual(created.status_code, 200, created.text)
        before = self.workflow_path.read_bytes()

        with patch.object(atomic_json.os, "replace", side_effect=OSError("replace failed")):
            failed = await self.upload("新工作流")
        self.assertEqual(failed.status_code, 500, failed.text)
        self.assertIn("已保留原文件", failed.text)
        self.assertEqual(self.workflow_path.read_bytes(), before)
        self.assert_no_temporary_json()

        recovered = await self.upload("恢复工作流")
        self.assertEqual(recovered.status_code, 200, recovered.text)
        self.assertEqual(
            json.loads(self.workflow_path.read_text(encoding="utf-8"))["1"]["class_type"],
            "恢复工作流",
        )

    async def test_corrupt_existing_upload_is_not_overwritten(self):
        self.workflow_path.parent.mkdir(parents=True)
        before = b'{"1": [broken]'
        self.workflow_path.write_bytes(before)

        failed = await self.upload("不应覆盖")
        self.assertEqual(failed.status_code, 500, failed.text)
        self.assertIn("工作流文件损坏", failed.text)
        self.assertEqual(self.workflow_path.read_bytes(), before)
        self.assert_no_temporary_json()

    async def test_config_is_atomic_and_corrupt_existing_config_is_protected(self):
        uploaded = await self.upload()
        self.assertEqual(uploaded.status_code, 200, uploaded.text)

        saved = await self.save_config()
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(json.loads(self.config_path.read_text(encoding="utf-8"))["title"], "测试工作流")
        before = self.config_path.read_bytes()

        with patch.object(atomic_json.os, "replace", side_effect=OSError("replace failed")):
            failed = await self.save_config("不应替换")
        self.assertEqual(failed.status_code, 500, failed.text)
        self.assertIn("工作流配置文件无法保存", failed.text)
        self.assertEqual(self.config_path.read_bytes(), before)
        self.assert_no_temporary_json()

        self.config_path.write_bytes(b"[broken]")
        failed_corrupt = await self.save_config("损坏不可覆盖")
        self.assertEqual(failed_corrupt.status_code, 500, failed_corrupt.text)
        self.assertIn("工作流配置文件损坏", failed_corrupt.text)
        self.assertEqual(self.config_path.read_bytes(), b"[broken]")
        self.assert_no_temporary_json()


if __name__ == "__main__":
    unittest.main()
