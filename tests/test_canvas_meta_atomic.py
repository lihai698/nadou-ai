"""画布元数据路由的隔离落盘与更新时间回归。"""

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


class CanvasMetaAtomicTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.canvas_dir = Path(self.temporary.name) / "canvases"
        self.canvas_dir.mkdir()
        canvas_dir_patch = patch.object(main, "CANVAS_DIR", str(self.canvas_dir))
        canvas_dir_patch.start()
        self.addCleanup(canvas_dir_patch.stop)
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app, raise_app_exceptions=False),
            base_url="http://canvas-meta.test",
        )
        self.addAsyncCleanup(self.client.aclose)

    def seed_canvas(self):
        canvas = {
            "id": "isolated-meta",
            "title": "原标题",
            "kind": "classic",
            "updated_at": 2000,
            "nodes": [],
            "connections": [],
        }
        target = self.canvas_dir / "isolated-meta.json"
        target.write_text(json.dumps(canvas, ensure_ascii=False, indent=2), encoding="utf-8")
        return target

    async def test_route_saves_meta_without_refreshing_canvas_updated_at(self):
        target = self.seed_canvas()
        response = await self.client.post(
            "/api/canvases/isolated-meta/meta",
            json={"title": "新标题", "pinned": True},
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(set(response.json()), {"canvas"})
        self.assertEqual(response.json()["canvas"]["updated_at"], 2000)
        self.assertEqual(response.json()["canvas"]["title"], "新标题")
        self.assertTrue(response.json()["canvas"]["pinned"])
        self.assertEqual(json.loads(target.read_text(encoding="utf-8"))["updated_at"], 2000)
        self.assertEqual(list(self.canvas_dir.glob(".isolated-meta.json.*.tmp")), [])

        with patch.object(main, "now_ms", return_value=1000):
            touched = await self.client.post("/api/canvases/isolated-meta/touch")
        self.assertEqual(touched.status_code, 200, touched.text)
        self.assertEqual(touched.json()["updated_at"], 2001)
        self.assertEqual(json.loads(target.read_text(encoding="utf-8"))["updated_at"], 2001)

    async def test_replace_failure_preserves_old_canvas_and_cleans_temporary(self):
        target = self.seed_canvas()
        before = target.read_bytes()
        with patch.object(atomic_json.os, "replace", side_effect=OSError("replace failed")):
            response = await self.client.post(
                "/api/canvases/isolated-meta/meta", json={"title": "不可落盘"}
            )
        self.assertEqual(response.status_code, 500)
        self.assertEqual(target.read_bytes(), before)
        self.assertEqual(list(self.canvas_dir.glob(".isolated-meta.json.*.tmp")), [])


if __name__ == "__main__":
    unittest.main()
