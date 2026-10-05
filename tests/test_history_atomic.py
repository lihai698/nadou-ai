"""历史记录三处写入口的隔离原子写入回归。"""

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


class HistoryAtomicTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="history-atomic-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.history = self.root / "history.json"
        self.assets = self.root / "assets"
        self.generated = self.assets / "output"
        self.generated.mkdir(parents=True)
        for name, path in (
            ("HISTORY_FILE", self.history),
            ("ASSETS_DIR", self.assets),
            ("OUTPUT_OUTPUT_DIR", self.generated),
            ("OUTPUT_DIR", self.root / "output"),
        ):
            context = patch.object(main, name, str(path))
            context.start()
            self.addCleanup(context.stop)

    def assert_no_temporary_history(self):
        self.assertEqual(list(self.root.glob(".history.json.*.tmp")), [])

    def test_save_failure_keeps_previous_history_then_retry_succeeds(self):
        old = '[{"timestamp": 1, "images": ["旧素材"]}]'
        self.history.write_text(old, encoding="utf-8")

        with patch.object(atomic_json.os, "replace", side_effect=OSError("replace failed")):
            with self.assertRaisesRegex(OSError, "replace failed"):
                main.save_to_history({"timestamp": 2, "images": ["新素材"]})

        self.assertEqual(self.history.read_text(encoding="utf-8"), old)
        self.assert_no_temporary_history()
        main.save_to_history({"timestamp": 2, "images": ["新素材"]})
        self.assertEqual([item["timestamp"] for item in json.loads(
            self.history.read_text(encoding="utf-8"))], [2, 1])

    def test_prune_failure_keeps_previous_history(self):
        media = self.generated / "clip.png"
        media.write_bytes(b"synthetic")
        old = '[{"timestamp": 1, "images": ["/assets/output/clip.png"]}]'
        self.history.write_text(old, encoding="utf-8")

        with patch.object(atomic_json.os, "replace", side_effect=OSError("replace failed")):
            with self.assertRaises(main.HistoryPruneError):
                main.prune_generation_history_for_media([str(media)])

        self.assertEqual(self.history.read_text(encoding="utf-8"), old)
        self.assert_no_temporary_history()

    async def test_delete_route_preserves_old_history_on_failure_and_recovers(self):
        records = [
            {"timestamp": 1, "images": ["https://example.test/old.png"]},
            {"timestamp": 2, "images": ["https://example.test/keep.png"]},
        ]
        old = json.dumps(records, ensure_ascii=False)
        self.history.write_text(old, encoding="utf-8")
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app),
            base_url="http://history-atomic.test",
        ) as client:
            with patch.object(atomic_json.os, "replace", side_effect=OSError("replace failed")):
                failed = await client.post("/api/history/delete", json={"timestamp": 1})
            self.assertEqual(failed.status_code, 200, failed.text)
            self.assertFalse(failed.json()["success"])
            self.assertEqual(self.history.read_text(encoding="utf-8"), old)
            self.assert_no_temporary_history()

            deleted = await client.post("/api/history/delete", json={"timestamp": 1})
            self.assertEqual(deleted.status_code, 200, deleted.text)
            self.assertEqual(deleted.json(), {"success": True})
            remaining = await client.get("/api/history")
            self.assertEqual(remaining.status_code, 200, remaining.text)
            self.assertEqual([item["timestamp"] for item in remaining.json()], [2])
            self.assertEqual(json.loads(self.history.read_text(encoding="utf-8")), records[1:])
            self.assert_no_temporary_history()


if __name__ == "__main__":
    unittest.main()
