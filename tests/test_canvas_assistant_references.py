import unittest
import asyncio
import ast
import json
import tempfile
from pathlib import Path
from types import SimpleNamespace

import httpx
from fastapi import FastAPI, HTTPException
from backend.canvas_assistant import canvas_context, create_assistant_router, node_reference_assets


class ReferenceTests(unittest.TestCase):
    def payload(self, *ids):
        return SimpleNamespace(selectedNodeIds=[], referencedNodeIds=[], referencedAssetIds=list(ids))

    def test_canvas_image_selection_is_precise(self):
        canvas = {"nodes": [{"id": "n", "images": [{"url": "/assets/a.png"}, {"url": "/assets/b.png"}]}]}
        asset_id = node_reference_assets(canvas)[1]["id"]
        _, images, _ = canvas_context(canvas, self.payload(asset_id))
        self.assertEqual(images, ["/assets/b.png"])
        selected = self.payload(asset_id)
        selected.selectedNodeIds = ["n"]
        self.assertEqual(canvas_context(canvas, selected)[1], images)

    def test_replaced_canvas_media_is_rejected(self):
        canvas = {"nodes": [{"id": "n", "images": [{"url": "/assets/original.png"}]}]}
        asset_id = node_reference_assets(canvas)[0]["id"]
        canvas["nodes"][0]["images"][0]["url"] = "/assets/replacement.png"
        with self.assertRaises(HTTPException):
            canvas_context(canvas, self.payload(asset_id))

    def test_data_image_is_sent_when_explicitly_referenced(self):
        canvas = {"nodes": [{"id": "n", "url": "data:image/png;base64,fixture"}]}
        asset_id = node_reference_assets(canvas)[0]["id"]
        self.assertEqual(canvas_context(canvas, self.payload(asset_id))[1], [canvas["nodes"][0]["url"]])

    def test_local_and_library_references_resolve_from_index(self):
        assets = [{"id": "local:a", "kind": "image", "url": "/api/storage-files/local/a.png"}, {"id": "asset:l:b", "kind": "image", "url": "/assets/b.png"}]
        _, images, _ = canvas_context({}, self.payload("local:a", "asset:l:b"), assets)
        self.assertEqual(images, [assets[0]["url"], assets[1]["url"]])

    def test_missing_or_non_media_asset_is_rejected(self):
        for assets in ([], [{"id": "local:a", "kind": "audio", "url": "/assets/a.mp3"}]):
            with self.assertRaises(HTTPException):
                canvas_context({}, self.payload("local:a"), assets)

    def test_limit_is_explicit_instead_of_silent_truncation(self):
        assets = [{"id": f"local:{i}", "kind": "image", "url": f"/assets/{i}.png"} for i in range(9)]
        with self.assertRaises(HTTPException):
            canvas_context({}, self.payload(*(item["id"] for item in assets)), assets)


class ReferenceRouteTests(unittest.IsolatedAsyncioTestCase):
    async def test_candidates_and_chat_use_same_index_and_preserve_history(self):
        with tempfile.TemporaryDirectory() as root:
            canvas = {"id": "canvas-a", "updated_at": 1, "nodes": [{"id": "n", "url": "/assets/a.png"}]}
            assets = [{"id": "local:a", "source": "local", "kind": "image", "url": "/api/storage-files/local/a.png", "name": "本地测试", "api_key": "private"}, {"id": "asset:l:b", "source": "asset", "kind": "image", "url": "/assets/b.png"}]
            calls = []
            async def model(fields):
                calls.append(fields)
                return {"text": "测试完成"}
            app = FastAPI()
            app.include_router(create_assistant_router(root=lambda: root, load_canvas=lambda _: canvas, providers=lambda: [{"id": "mock", "chat_models": ["chat"]}], user_id=lambda *_: "test", call_model=model, load_reference_assets=lambda: assets))
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                candidates = (await client.get("/api/canvas-assistant/reference-assets", params={"canvasId": "canvas-a"})).json()
                self.assertEqual([x["source"] for x in candidates["items"]], ["canvas", "local", "asset"])
                self.assertNotIn("private", json.dumps(candidates))
                session = (await client.post("/api/canvas-assistant/sessions", json={"canvasId": "canvas-a"})).json()["session"]["id"]
                payload = {"canvasId": "canvas-a", "sessionId": session, "requestId": "r-a", "message": "看引用图片", "provider": "mock", "model": "chat", "expectedUpdatedAt": 1, "referencedAssetIds": ["local:a", "asset:l:b"]}
                response = await client.post("/api/canvas-assistant/chat", json=payload)
                self.assertEqual(json.loads(response.text.splitlines()[-1])["state"], "completed")
                self.assertEqual(calls[0]["images"], [assets[0]["url"], assets[1]["url"]])
                history = (await client.get("/api/canvas-assistant/history", params={"canvasId": "canvas-a", "sessionId": session})).json()
                self.assertEqual(history["session"]["turns"][0]["referencedAssetIds"], payload["referencedAssetIds"])
                assets.clear()
                response = await client.post("/api/canvas-assistant/chat", json={**payload, "requestId": "r-b"})
                self.assertEqual(response.status_code, 409)
                self.assertEqual(len(calls), 1)

    async def test_real_model_bridge_converts_local_storage_url(self):
        tree = ast.parse(Path("main.py").read_text(encoding="utf-8"))
        fn = next(item for item in tree.body if isinstance(item, ast.AsyncFunctionDef) and item.name == "call_canvas_assistant_model")
        received = []
        async def model(payload):
            received.append(payload)
            return {"text": "ok"}
        scope = {"asyncio": asyncio, "HTTPException": HTTPException, "CanvasLLMRequest": lambda **fields: fields, "canvas_llm": model, "output_file_from_url": lambda _: "fixture.png", "reference_to_data_url": lambda ref, size: "data:image/png;base64,fixture"}
        exec(compile(ast.Module(body=[fn], type_ignores=[]), "main.py", "exec"), scope)
        await scope["call_canvas_assistant_model"]({"images": ["/api/storage-files/local/a.png"]})
        self.assertEqual(received[0]["images"], ["data:image/png;base64,fixture"])
        scope["output_file_from_url"] = lambda _: None
        with self.assertRaises(HTTPException):
            await scope["call_canvas_assistant_model"]({"images": ["/api/storage-files/local/missing.png"]})
