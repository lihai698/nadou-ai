import asyncio
import json
import tempfile
import unittest
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException

from backend.canvas_assistant import AssistantStore, create_assistant_router


class AssistantTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.canvas = {"id": "canvas-a", "title": "测试画布", "kind": "smart", "updated_at": 20,
                       "nodes": [{"id": "prompt", "type": "smart-prompt", "text": "清晨小屋", "api_key": "private-do-not-send"},
                                 {"id": "image", "type": "smart-image", "images": [{"url": "/assets/fixture.png"}]}], "connections": []}
        self.calls = []
        self.gate = None
        self.started = asyncio.Event()
        self.fail = False
        self.provider = [{"id": "mock", "name": "测试平台", "enabled": True, "has_key": True, "key_preview": "private", "chat_models": ["chat-test"]}]
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=self.make_app()), base_url="http://test", headers={"X-User-Id": "user-a"})

    def make_app(self):
        def load(canvas_id):
            if canvas_id != self.canvas["id"]:
                raise HTTPException(404, "画布不存在")
            return self.canvas
        async def model(fields):
            self.calls.append(fields)
            self.started.set()
            if self.gate:
                await self.gate.wait()
            if self.fail:
                raise RuntimeError("private-secret")
            return {"text": "可以先整理提示词。"}
        app = FastAPI()
        app.include_router(create_assistant_router(root=lambda: self.temp.name, load_canvas=load, providers=lambda: self.provider, user_id=lambda header, request: header or "anonymous", call_model=model))
        return app

    async def asyncTearDown(self):
        await self.client.aclose()
        self.temp.cleanup()

    async def create(self):
        response = await self.client.post("/api/canvas-assistant/sessions", json={"canvasId": "canvas-a"})
        self.assertEqual(response.status_code, 200)
        return response.json()["session"]["id"]

    def payload(self, session_id, **overrides):
        return {"canvasId": "canvas-a", "sessionId": session_id, "requestId": "request-a", "message": "分析选中的节点", "provider": "mock", "model": "chat-test", "expectedUpdatedAt": 20, "selectedNodeIds": ["prompt"], "referencedNodeIds": ["image"], **overrides}

    async def history(self, session):
        response = await self.client.get("/api/canvas-assistant/history", params={"canvasId": "canvas-a", "sessionId": session})
        self.assertEqual(response.status_code, 200)
        return response.json()["session"]

    async def test_context_history_and_reopen(self):
        session = await self.create()
        response = await self.client.post("/api/canvas-assistant/chat", json=self.payload(session))
        events = [json.loads(line) for line in response.text.splitlines()]
        self.assertEqual(events[-1]["state"], "completed")
        self.assertEqual(events[-2]["text"], "可以先整理提示词。")
        self.assertEqual(self.calls[0]["images"], ["/assets/fixture.png"])
        self.assertNotIn("private-do-not-send", self.calls[0]["system_prompt"])
        saved = await self.history(session)
        self.assertEqual(saved["turns"][0]["reply"], "可以先整理提示词。")
        self.assertEqual(saved["title"], "分析选中的节点")
        # 新进程服务从同一目录读取已经结束的对话。
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=self.make_app()), base_url="http://test", headers={"X-User-Id": "user-a"}) as reopened:
            data = (await reopened.get("/api/canvas-assistant/history", params={"canvasId": "canvas-a", "sessionId": session})).json()
        self.assertEqual(data["session"]["turns"][0]["state"], "completed")

    async def test_previous_completed_turns_are_sent(self):
        session = await self.create()
        await self.client.post("/api/canvas-assistant/chat", json=self.payload(session))
        await self.client.post("/api/canvas-assistant/chat", json=self.payload(session, requestId="request-b", message="继续"))
        self.assertEqual([m["role"] for m in self.calls[1]["messages"]], ["user", "assistant"])

    async def test_selected_nodes_are_included_on_large_canvas(self):
        self.canvas["nodes"] = [{"id": f"node-{i}", "text": f"说明{i}"} for i in range(120)]
        session = await self.create()
        response = await self.client.post("/api/canvas-assistant/chat", json=self.payload(
            session, selectedNodeIds=["node-119"], referencedNodeIds=[]))
        self.assertEqual(response.status_code, 200)
        context = json.loads(self.calls[0]["system_prompt"].split("\n", 1)[1])
        self.assertEqual(context["nodes"][0]["id"], "node-119")
        self.assertEqual(len(context["nodes"]), 100)

    async def test_duplicate_and_stale_version_do_not_call_model(self):
        session = await self.create()
        stale = await self.client.post("/api/canvas-assistant/chat", json=self.payload(session, expectedUpdatedAt=19))
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(self.calls, [])
        await self.client.post("/api/canvas-assistant/chat", json=self.payload(session))
        duplicate = await self.client.post("/api/canvas-assistant/chat", json=self.payload(session))
        self.assertEqual(duplicate.status_code, 409)
        self.assertEqual(len(self.calls), 1)

    async def test_invalid_models_and_foreign_references_rejected(self):
        session = await self.create()
        for changes in ({"model": "unconfigured"}, {"referencedNodeIds": ["other-canvas-image"]}, {"selectedNodeIds": ["missing"]}):
            response = await self.client.post("/api/canvas-assistant/chat", json=self.payload(session, **changes))
            self.assertEqual(response.status_code, 409)
        self.assertEqual(self.calls, [])

    async def test_sessions_are_scoped_to_user_and_canvas(self):
        session = await self.create()
        response = await self.client.get("/api/canvas-assistant/history", params={"canvasId": "canvas-a", "sessionId": session}, headers={"X-User-Id": "user-b"})
        self.assertEqual(response.status_code, 404)
        response = await self.client.post("/api/canvas-assistant/chat", json=self.payload(session, canvasId="canvas-b"))
        self.assertEqual(response.status_code, 404)

    async def test_cancel_and_busy_guard(self):
        session = await self.create()
        self.gate = asyncio.Event()
        pending = asyncio.create_task(self.client.post("/api/canvas-assistant/chat", json=self.payload(session)))
        await asyncio.wait_for(self.started.wait(), 3)
        duplicate = await self.client.post("/api/canvas-assistant/chat", json=self.payload(session, requestId="request-b"))
        self.assertEqual(duplicate.status_code, 409)
        stopped = await self.client.post("/api/canvas-assistant/cancel", json={"canvasId": "canvas-a", "sessionId": session, "requestId": "request-a"})
        self.assertEqual(stopped.json()["state"], "cancelled")
        response = await asyncio.wait_for(pending, 3)
        self.assertEqual(json.loads(response.text.splitlines()[-1])["state"], "cancelled")
        saved = await self.history(session)
        self.assertEqual(saved["turns"][0]["state"], "cancelled")
        self.assertEqual(saved["turns"][0]["reply"], "")

    async def test_failure_keeps_message_and_hides_raw_error(self):
        session = await self.create()
        self.fail = True
        response = await self.client.post("/api/canvas-assistant/chat", json=self.payload(session))
        self.assertNotIn("private-secret", response.text)
        self.assertEqual(json.loads(response.text.splitlines()[-1])["state"], "failed")
        saved = await self.history(session)
        self.assertEqual(saved["turns"][0]["message"], "分析选中的节点")
        self.assertEqual(saved["turns"][0]["state"], "failed")

    async def test_status_contains_only_model_choices(self):
        response = await self.client.get("/api/canvas-assistant/status")
        self.assertNotIn("key_preview", response.text)
        self.assertNotIn("private", response.text)
        self.assertEqual(response.json()["providers"][0]["models"], ["chat-test"])

    async def test_corrupt_history_is_not_overwritten(self):
        store = AssistantStore(lambda: self.temp.name)
        path = store.path("user-a", "canvas-a")
        path.parent.mkdir(parents=True)
        path.write_text("broken", encoding="utf-8")
        response = await self.client.post("/api/canvas-assistant/sessions", json={"canvasId": "canvas-a"})
        self.assertEqual(response.status_code, 500)
        self.assertEqual(path.read_text(), "broken")

    async def test_invalid_id_cannot_write_outside_store(self):
        response = await self.client.post("/api/canvas-assistant/sessions", json={"canvasId": "../canvas-a"})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(list(Path(self.temp.name).rglob("*.json")), [])

    async def test_interrupted_turn_recovers_after_restart(self):
        session = await self.create()
        store = AssistantStore(lambda: self.temp.name, owner="old-process")
        from backend.canvas_assistant import TurnRequest
        store.start("user-a", TurnRequest(**self.payload(session)))
        saved = await self.history(session)
        self.assertEqual(saved["turns"][0]["state"], "interrupted")
        self.assertIn("重启", saved["turns"][0]["error"])


if __name__ == "__main__":
    unittest.main()
