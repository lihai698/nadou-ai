"""隔离 HTTP 回归：元数据写入不能被旧画布快照覆盖。"""

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main


class CanvasMetaRevisionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.canvas_dir = Path(self.temporary.name)
        canvas_dir_patch = patch.object(main, "CANVAS_DIR", str(self.canvas_dir))
        canvas_dir_patch.start()
        self.addCleanup(canvas_dir_patch.stop)
        broadcast_patch = patch.object(main.manager, "broadcast_canvas_updated", new_callable=AsyncMock)
        broadcast_patch.start()
        self.addCleanup(broadcast_patch.stop)
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app),
            base_url="http://canvas-meta-revision.test",
        )
        self.addAsyncCleanup(self.client.aclose)

    def seed(self, kind):
        canvas_id = f"isolated-{kind}"
        canvas = {
            "id": canvas_id,
            "title": "旧标题",
            "icon": "layers",
            "kind": kind,
            "updated_at": 2000,
            "nodes": [{"id": "original", "type": "text"}],
            "connections": [],
            "viewport": {"x": 0, "y": 0, "scale": 1},
        }
        target = self.canvas_dir / f"{canvas_id}.json"
        target.write_text(json.dumps(canvas, ensure_ascii=False), encoding="utf-8")
        return canvas, target

    async def test_stale_meta_version_rejected_without_changing_sort_time_or_disk(self):
        for kind in ("classic", "smart"):
            with self.subTest(kind=kind):
                old, target = self.seed(kind)
                endpoint = f"/api/canvases/{old['id']}"
                meta = await self.client.post(endpoint + "/meta", json={"title": "新标题", "icon": "star"})
                self.assertEqual(meta.status_code, 200, meta.text)
                self.assertEqual(meta.json()["canvas"]["updated_at"], 2000)
                self.assertEqual(meta.json()["canvas"]["meta_revision"], 1)
                self.assertEqual((await self.client.get(endpoint + "/meta")).json()["meta_revision"], 1)
                listed = (await self.client.get("/api/canvases")).json()["canvases"]
                self.assertEqual(next(item for item in listed if item["id"] == old["id"])["updated_at"], 2000)

                stale = dict(title=old["title"], icon=old["icon"],
                             nodes=[{"id": "edited", "type": "text"}], connections=[],
                             base_updated_at=2000, base_meta_revision=0)
                before = target.read_bytes()
                conflict = await self.client.put(endpoint, json=stale)
                self.assertEqual(conflict.status_code, 409, conflict.text)
                self.assertEqual(conflict.json()["detail"]["reason"], "meta_conflict")
                self.assertEqual(conflict.json()["detail"]["canvas"]["title"], "新标题")
                self.assertEqual(target.read_bytes(), before)

                old_client = dict(stale)
                old_client.pop("base_meta_revision")
                conflict = await self.client.put(endpoint, json=old_client)
                self.assertEqual(conflict.status_code, 409, conflict.text)
                self.assertEqual(target.read_bytes(), before)

                latest = (await self.client.get(endpoint)).json()["canvas"]
                accepted = dict(stale, title=latest["title"], icon=latest["icon"],
                                base_meta_revision=latest["meta_revision"])
                saved = await self.client.put(endpoint, json=accepted)
                self.assertEqual(saved.status_code, 200, saved.text)
                self.assertEqual(saved.json()["canvas"]["nodes"], accepted["nodes"])
                self.assertEqual(saved.json()["canvas"]["title"], "新标题")
                self.assertEqual(saved.json()["canvas"]["icon"], "star")
                self.assertGreater(saved.json()["canvas"]["updated_at"], 2000)
                self.assertEqual(json.loads(target.read_text(encoding="utf-8")), saved.json()["canvas"])

    async def test_legacy_client_can_save_content_when_metadata_matches(self):
        old, target = self.seed("classic")
        endpoint = f"/api/canvases/{old['id']}"
        meta = await self.client.post(endpoint + "/meta", json={"title": "新标题", "pinned": True})
        self.assertEqual(meta.status_code, 200)
        self.assertEqual(meta.json()["canvas"]["meta_revision"], 1)
        saved = await self.client.put(endpoint, json={
            "title": "新标题",
            "nodes": [{"id": "legacy-content", "type": "text"}],
            "connections": [], "base_updated_at": 2000,
        })
        self.assertEqual(saved.status_code, 200, saved.text)
        persisted = json.loads(target.read_text(encoding="utf-8"))
        self.assertEqual(persisted["nodes"][0]["id"], "legacy-content")
        self.assertEqual(persisted["title"], "新标题")
        self.assertEqual(persisted["icon"], old["icon"])

    async def test_old_canvas_without_icon_uses_existing_default_after_meta_change(self):
        old, target = self.seed("smart")
        stored = json.loads(target.read_text(encoding="utf-8"))
        stored.pop("icon")
        target.write_text(json.dumps(stored, ensure_ascii=False), encoding="utf-8")
        endpoint = f"/api/canvases/{old['id']}"
        self.assertEqual((await self.client.post(endpoint + "/meta", json={"title": "新标题"})).status_code, 200)
        saved = await self.client.put(endpoint, json={
            "title": "新标题", "icon": "layers", "nodes": [{"id": "edited"}],
            "connections": [], "base_updated_at": old["updated_at"], "base_meta_revision": 1,
        })
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(saved.json()["canvas"]["icon"], "layers")


if __name__ == "__main__":
    unittest.main()
