"""画布列表通过真实路由接入存储与纯排序模块，保持读取和回收站行为。"""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main
from backend import canvas_records


class CanvasListRouteTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.addCleanup(self.temp.cleanup)
        self.now = 1800000000000
        for target, value in (("CANVAS_DIR", str(self.root)), ("now_ms", lambda: self.now)):
            patcher = patch.object(main, target, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def write(self, identity, **fields):
        record = {"id": identity, "title": identity, "nodes": [], "connections": [], **fields}
        (self.root / (identity + ".json")).write_text(json.dumps(record), encoding="utf-8")

    async def test_active_route_delegates_sort_and_keeps_filtering_and_cleanup(self):
        self.write("classic", kind="classic", updated_at=10)
        self.write("smart", kind="smart", updated_at=20)
        self.write("pinned", pinned=True, updated_at=1)
        self.write("trash", deleted_at=self.now - 1000)
        self.write("expired", deleted_at=self.now - 31 * 86400000)
        self.write("future", format_version=999)
        (self.root / "broken.json").write_text("{broken", encoding="utf-8")
        with patch.object(main, "sort_canvas_records", wraps=canvas_records.sort_canvas_records) as sort:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
                response = await client.get("/api/canvases")
        self.assertEqual(response.status_code, 200)
        records = response.json()["canvases"]
        self.assertEqual([item["id"] for item in records], ["pinned", "smart", "classic"])
        self.assertEqual([item["kind"] for item in records], ["classic", "smart", "classic"])
        sort.assert_called_once()
        self.assertFalse(sort.call_args.kwargs.get("include_deleted", False))
        self.assertFalse((self.root / "expired.json").exists())
        for name in ("trash", "future", "broken"):
            self.assertTrue((self.root / (name + ".json")).is_file())

    async def test_trash_route_delegates_sort_and_preserves_retention(self):
        self.write("active", updated_at=30)
        self.write("old", deleted_at=self.now - 2000, pinned=True)
        self.write("recent", deleted_at=self.now - 1000, kind="smart")
        self.write("expired", deleted_at=self.now - 31 * 86400000)
        with patch.object(main, "sort_canvas_records", wraps=canvas_records.sort_canvas_records) as sort:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
                response = await client.get("/api/canvases/trash")
        self.assertEqual(response.status_code, 200)
        self.assertEqual([item["id"] for item in response.json()["canvases"]], ["recent", "old"])
        self.assertEqual(response.json()["retention_days"], 30)
        sort.assert_called_once()
        self.assertTrue(sort.call_args.kwargs["include_deleted"])
        self.assertFalse((self.root / "expired.json").exists())
        self.assertTrue((self.root / "active.json").exists())


if __name__ == "__main__":
    unittest.main()
