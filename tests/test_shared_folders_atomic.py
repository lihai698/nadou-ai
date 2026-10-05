"""共享文件夹索引的原子保存、损坏保护和隔离恢复边界。"""

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


class SharedFoldersAtomicTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="shared-folders-atomic-")
        self.addAsyncCleanup(self._close_client)
        self.addCleanup(temporary.cleanup)
        self._temporary = temporary
        self.root = Path(temporary.name)
        self.data = self.root / "data"
        self.shared = self.root / "shared"
        self.data.mkdir()
        self.shared.mkdir()
        self.index = self.data / "shared_folders.json"
        self.patches = [
            patch.object(main, "BASE_DIR", str(self.root)),
            patch.object(main, "DATA_DIR", str(self.data)),
            patch.object(main, "SHARED_FOLDERS_FILE", str(self.index)),
        ]
        for active_patch in self.patches:
            active_patch.start()
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app, raise_app_exceptions=False),
            base_url="http://shared-folders-atomic.test",
        )

    async def _close_client(self):
        if hasattr(self, "client"):
            await self.client.aclose()
        for active_patch in reversed(getattr(self, "patches", [])):
            active_patch.stop()

    def assert_no_temporary_index(self):
        self.assertEqual(list(self.data.glob(".shared_folders.json.*.tmp")), [])

    async def test_register_writes_json_atomically_and_can_reload(self):
        response = await self.client.post(
            "/api/shared-folders",
            json={"path": str(self.shared), "name": "测试共享"},
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["folder"]["name"], "测试共享")
        saved = json.loads(self.index.read_text(encoding="utf-8"))
        self.assertEqual(saved["folders"][0]["name"], "测试共享")
        listed = await self.client.get("/api/shared-folders")
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertEqual(listed.json()["folders"][0]["name"], "测试共享")
        self.assert_no_temporary_index()

    async def test_replace_failure_preserves_old_index_and_cleans_temp(self):
        created = await self.client.post(
            "/api/shared-folders",
            json={"path": str(self.shared), "name": "旧名称"},
        )
        self.assertEqual(created.status_code, 200, created.text)
        before = self.index.read_bytes()

        with patch.object(atomic_json.os, "replace", side_effect=OSError("replace failed")):
            failed = await self.client.post(
                "/api/shared-folders",
                json={"path": str(self.shared), "name": "新名称"},
            )
        self.assertEqual(failed.status_code, 500, failed.text)
        self.assertIn("已保留原文件", failed.text)
        self.assertEqual(self.index.read_bytes(), before)
        self.assertEqual(main.shared_folders_load()["folders"][0]["name"], "旧名称")
        self.assert_no_temporary_index()

        recovered = await self.client.post(
            "/api/shared-folders",
            json={"path": str(self.shared), "name": "恢复名称"},
        )
        self.assertEqual(recovered.status_code, 200, recovered.text)
        self.assertEqual(recovered.json()["folder"]["name"], "恢复名称")
        self.assert_no_temporary_index()

    async def test_corrupt_existing_index_is_not_overwritten(self):
        before = b'{"folders": [broken]}'
        self.index.write_bytes(before)

        failed = await self.client.post(
            "/api/shared-folders",
            json={"path": str(self.shared), "name": "不应覆盖"},
        )
        self.assertEqual(failed.status_code, 500, failed.text)
        self.assertIn("已保留原文件", failed.text)
        self.assertEqual(self.index.read_bytes(), before)
        self.assert_no_temporary_index()


if __name__ == "__main__":
    unittest.main()
