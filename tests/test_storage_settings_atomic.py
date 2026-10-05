"""存储目录设置的隔离写入、路径兼容和同进程并发回归。"""

import json
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Event
from unittest.mock import patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main
from backend import atomic_json


class StorageSettingsAtomicTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="storage-settings-atomic-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.settings = self.root / "data" / "storage_settings.json"
        defaults = {
            "upload": str(self.root / "defaults" / "upload"),
            "generated": str(self.root / "defaults" / "generated"),
            "local": str(self.root / "defaults" / "local"),
        }
        for name, value in (
            ("BASE_DIR", str(self.root)),
            ("DATA_DIR", str(self.settings.parent)),
            ("STORAGE_SETTINGS_FILE", str(self.settings)),
            ("DEFAULT_STORAGE_DIRS", defaults),
            ("OUTPUT_INPUT_DIR", defaults["upload"]),
            ("OUTPUT_OUTPUT_DIR", defaults["generated"]),
            ("LOCAL_UPLOAD_DIR", defaults["local"]),
        ):
            context = patch.object(main, name, value)
            context.start()
            self.addCleanup(context.stop)
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app, raise_app_exceptions=False),
            base_url="http://storage-settings.test",
        )
        self.addAsyncCleanup(self.client.aclose)

    def assert_no_temporary_settings(self):
        self.assertEqual(list(self.settings.parent.glob(".storage_settings.json.*.tmp")), [])

    async def test_patch_keeps_flat_format_paths_and_old_bytes_on_replace_failure(self):
        seed = await self.client.patch("/api/storage-settings", json={
            "upload": "uploads/原图",
            "generated": "generated",
            "local": "local",
        })
        self.assertEqual(seed.status_code, 200, seed.text)
        before = self.settings.read_bytes()
        active = (main.OUTPUT_INPUT_DIR, main.OUTPUT_OUTPUT_DIR, main.LOCAL_UPLOAD_DIR)
        self.assertEqual(json.loads(before), seed.json()["dirs"])
        self.assertEqual(set(json.loads(before)), {"upload", "generated", "local"})
        self.assertEqual(seed.json()["dirs"]["upload"], str(self.root / "uploads" / "原图"))

        with patch.object(atomic_json.os, "replace", side_effect=OSError("replace failed")):
            failed = await self.client.patch("/api/storage-settings", json={"upload": "different"})
        self.assertEqual(failed.status_code, 500)
        self.assertEqual(self.settings.read_bytes(), before)
        self.assertEqual((main.OUTPUT_INPUT_DIR, main.OUTPUT_OUTPUT_DIR, main.LOCAL_UPLOAD_DIR), active)
        self.assert_no_temporary_settings()

        saved = await self.client.patch("/api/storage-settings", json={"local": "new-local"})
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(saved.json()["dirs"]["upload"], active[0])
        self.assertEqual(saved.json()["dirs"]["generated"], active[1])
        self.assertEqual(saved.json()["dirs"]["local"], str(self.root / "new-local"))
        loaded = await self.client.get("/api/storage-settings")
        self.assertEqual(loaded.status_code, 200, loaded.text)
        self.assertEqual(loaded.json()["dirs"], saved.json()["dirs"])
        self.assertEqual(json.loads(self.settings.read_text(encoding="utf-8")), saved.json()["dirs"])
        self.assert_no_temporary_settings()

    async def test_corrupt_or_unreadable_existing_settings_cannot_be_overwritten(self):
        self.settings.parent.mkdir(parents=True)
        before = b'{"upload": "old", invalid}'
        self.settings.write_bytes(before)
        active = (main.OUTPUT_INPUT_DIR, main.OUTPUT_OUTPUT_DIR, main.LOCAL_UPLOAD_DIR)

        with patch.object(main, "write_diagnostic") as report:
            fallback = await self.client.get("/api/storage-settings")
        report.assert_called_once_with("storage settings load failed error=JSONDecodeError")
        self.assertEqual(fallback.status_code, 200, fallback.text)
        self.assertEqual(fallback.json()["dirs"], main.DEFAULT_STORAGE_DIRS)
        invalid = await self.client.patch("/api/storage-settings", json={"upload": "new"})
        self.assertEqual(invalid.status_code, 500)
        self.assertEqual(self.settings.read_bytes(), before)

        with patch.object(main, "_read_storage_settings_raw", side_effect=PermissionError("private path")):
            unreadable = await self.client.patch("/api/storage-settings", json={"local": "new"})
        self.assertEqual(unreadable.status_code, 500)
        self.assertEqual(self.settings.read_bytes(), before)
        self.assertEqual((main.OUTPUT_INPUT_DIR, main.OUTPUT_OUTPUT_DIR, main.LOCAL_UPLOAD_DIR), active)
        self.assert_no_temporary_settings()

    def test_concurrent_partial_changes_keep_both_fields(self):
        first_in_write = Event()
        release_first = Event()
        second_started = Event()
        second_done = Event()
        original_write = main.write_json_atomic

        def held_write(*args, **kwargs):
            if not first_in_write.is_set():
                first_in_write.set()
                if not release_first.wait(3):
                    raise AssertionError("first write did not resume")
            return original_write(*args, **kwargs)

        def save_second():
            second_started.set()
            try:
                return main.save_storage_settings({"local": "second-local"})
            finally:
                second_done.set()

        with patch.object(main, "write_json_atomic", side_effect=held_write):
            with ThreadPoolExecutor(max_workers=2) as pool:
                first = pool.submit(main.save_storage_settings, {"upload": "first-upload"})
                try:
                    self.assertTrue(first_in_write.wait(2))
                    second = pool.submit(save_second)
                    self.assertTrue(second_started.wait(2))
                    self.assertFalse(second_done.wait(0.2))
                finally:
                    release_first.set()
                first.result(timeout=3)
                second.result(timeout=3)

        loaded = main.load_storage_settings()["dirs"]
        self.assertEqual(loaded["upload"], str(self.root / "first-upload"))
        self.assertEqual(loaded["local"], str(self.root / "second-local"))
        self.assertEqual(loaded["generated"], main.DEFAULT_STORAGE_DIRS["generated"])
        self.assertEqual(json.loads(self.settings.read_text(encoding="utf-8")), loaded)
        self.assert_no_temporary_settings()


if __name__ == "__main__":
    unittest.main()
