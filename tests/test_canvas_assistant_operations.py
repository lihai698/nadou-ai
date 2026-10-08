import asyncio
import copy
import json
import tempfile
import threading
import unittest

import httpx
from fastapi import FastAPI, HTTPException

from backend.canvas_assistant import create_assistant_router
from backend.canvas_assistant_operations import AssistantPlan, parse_plan, prepare_operations, receipt_key


def plan(*operations):
    return AssistantPlan.model_validate({"reply": "准备好了。", "operations": list(operations)})


def create(ref, type="prompt", content="清晨的咖啡"):
    return {"op": "create", "operationId": "create_" + ref, "ref": ref, "type": type, "title": "咖啡海报", "content": content}


def connect(a, b, operation_id="edge_1"):
    return {"op": "connect", "operationId": operation_id, "from": a, "to": b}


class OperationTests(unittest.TestCase):
    def setUp(self):
        self.canvas = {"id": "canvas-a", "kind": "classic", "updated_at": 20, "nodes": [], "connections": [], "settings": {}, "logs": [{"text": "原日志"}]}
        self.providers = [{"id": "mock", "enabled": True, "image_models": ["image-user"], "video_models": ["video-user"]}]
        self.settings = {"engine": "api", "provider_id": "mock", "model": "image-user", "ratio": "portrait", "resolution": "4k", "quality": "high", "videoProvider": "mock", "videoModel": "video-user"}

    def apply(self, request_id="request-a", **changes):
        return prepare_operations(self.canvas, self.plan.operations, request_id=request_id, user="user-a", expected_updated_at=20, creation_settings=self.settings, providers=self.providers, **changes)

    def test_classic_native_nodes_connections_and_model_choice(self):
        self.plan = plan(create("p"), create("g", "image_generator", ""), connect("p", "g"))
        candidate, receipt = self.apply()
        self.assertEqual([n["type"] for n in candidate["nodes"]], ["prompt", "generator"])
        generator = candidate["nodes"][1]
        self.assertEqual((generator["apiProvider"], generator["model"], generator["ratio"], generator["resolution"]), ("mock", "image-user", "portrait", "4k"))
        self.assertEqual(generator["quality"], "high")
        self.assertEqual(candidate["connections"][0]["from"], candidate["nodes"][0]["id"])
        self.assertEqual(len(receipt["createdNodeIds"]), 2)
        self.assertEqual(len(receipt["createdEdgeIds"]), 1)
        self.assertEqual(self.canvas["nodes"], [])
        self.assertEqual(candidate["logs"], self.canvas["logs"])
        self.assertNotIn("running", generator)

    def test_smart_input_relations_and_drafts_are_native(self):
        self.canvas["kind"] = "smart"
        self.plan = plan(create("p"), create("g", "image_generator", "柔和光线"), connect("p", "g"))
        candidate, _ = self.apply()
        prompt, loop = candidate["nodes"]
        self.assertEqual((prompt["type"], loop["type"]), ("smart-prompt", "smart-loop"))
        self.assertEqual(loop["inputNodeIds"], [prompt["id"]])
        self.assertTrue(loop["showPrompt"])
        self.assertEqual(loop["promptDraftText"], "柔和光线")
        self.assertEqual(loop["runSettings"]["model"], "image-user")
        self.assertEqual(candidate["connections"][0]["kind"], "input")

    def test_video_nodes_retain_user_configuration_without_tasks(self):
        self.plan = plan(create("v", "video_generator", ""))
        candidate, _ = self.apply()
        self.assertEqual(candidate["nodes"][0]["model"], "video-user")
        self.canvas["kind"] = "smart"
        candidate, _ = self.apply()
        self.assertEqual(candidate["nodes"][0]["runSettings"]["apiKind"], "video")
        self.assertEqual(candidate["nodes"][0]["runSettings"]["videoModel"], "video-user")
        self.assertEqual(candidate["nodes"][0]["images"], [])
        self.assertNotIn("pendingTasks", candidate["nodes"][0])

    def test_batch_rejection_preserves_all_original_data(self):
        self.plan = plan(create("p"), connect("p", "missing"))
        before = copy.deepcopy(self.canvas)
        with self.assertRaises(HTTPException):
            self.apply()
        self.assertEqual(self.canvas, before)

    def test_receipt_replay_is_idempotent_and_user_scoped(self):
        self.plan = plan(create("p"))
        candidate, receipt = self.apply()
        candidate["updated_at"] = 21
        self.canvas = candidate
        replay, repeated = self.apply()
        self.assertIsNone(replay)
        self.assertEqual(repeated, receipt)
        self.assertNotEqual(receipt_key("user-a", "request-a"), receipt_key("user-b", "request-a"))
        self.plan = plan(create("p", content="不同内容"))
        with self.assertRaises(HTTPException):
            self.apply()

    def test_duplicate_operations_refs_and_self_edges_are_rejected(self):
        for ops in ((create("p"), create("p")), (create("p"), connect("p", "p"))):
            self.plan = plan(*ops)
            with self.assertRaises(HTTPException):
                self.apply()
        self.canvas["nodes"] = [{"id": "existing", "type": "prompt", "text": "保留"}]
        self.plan = plan(create("existing"))
        with self.assertRaises(HTTPException):
            self.apply()

    def test_invalid_types_cycles_and_duplicate_edges(self):
        self.canvas["nodes"] = [{"id": "a", "type": "generator"}, {"id": "b", "type": "video"}]
        self.canvas["connections"] = [{"from": "a", "to": "b"}]
        self.plan = plan(connect("b", "a"))
        with self.assertRaises(HTTPException):
            self.apply()
        self.plan = plan(connect("a", "b"))
        candidate, receipt = self.apply()
        self.assertEqual(len(candidate["connections"]), 1)
        self.assertEqual(receipt["createdEdgeIds"], [])
        self.canvas["nodes"] = [{"id": "a", "type": "text"}, {"id": "b", "type": "prompt"}]
        with self.assertRaises(HTTPException):
            self.apply()

    def test_update_whitelist_preserves_media_and_escapes_html(self):
        self.canvas.update(kind="smart", nodes=[{"id": "image", "type": "smart-image", "images": [{"url": "/assets/original.png"}], "runPrompt": "已提交提示词", "taskId": "original"}])
        self.plan = plan({"op": "update", "operationId": "u1", "nodeId": "image", "content": "<img src=x onerror=alert(1)>"})
        candidate, receipt = self.apply()
        node = candidate["nodes"][0]
        self.assertIn("&lt;img", node["promptDraftHtml"])
        self.assertEqual(node["images"], self.canvas["nodes"][0]["images"])
        self.assertEqual(node["runPrompt"], "已提交提示词")
        self.assertEqual(node["taskId"], "original")
        self.assertEqual(receipt["updatedNodeIds"], ["image"])
        self.assertEqual(receipt["nodePatches"][0]["fields"]["promptDraftText"]["after"], node["promptDraftText"])
        for field in ("running", "pending", "pendingTasks"):
            self.canvas["nodes"][0][field] = True
            with self.assertRaises(HTTPException):
                self.apply()
            del self.canvas["nodes"][0][field]
        self.canvas["nodes"][0]["depthCapture"] = {"status": "running"}
        with self.assertRaises(HTTPException):
            self.apply()

    def test_version_provider_and_unsupported_engine_fail_closed(self):
        self.plan = plan(create("g", "image_generator", ""))
        self.canvas["updated_at"] = 21
        with self.assertRaises(HTTPException):
            self.apply()
        self.canvas["updated_at"] = 20
        for value in ({"model": "unknown"}, {"engine": "comfy"}, {"videoDuration": -1}):
            original = self.settings.copy()
            self.settings.update(value)
            with self.assertRaises(HTTPException):
                self.apply()
            self.settings = original

    def test_parser_does_not_accept_raw_fields_tasks_or_unknown_actions(self):
        for operation in ({**create("p"), "url": "https://example.test/private.png"}, {**create("p"), "taskId": "task"}, {"op": "delete", "operationId": "d1", "nodeId": "p"}):
            with self.assertRaises(HTTPException):
                parse_plan(json.dumps({"reply": "测试", "operations": [operation]}))
        plain = parse_plan("可以使用暖色。")
        self.assertEqual(plain.operations, [])
        self.assertIn("未执行", plain.reply)


class OperationRouteTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.canvas = {"id": "canvas-a", "kind": "classic", "title": "测试", "updated_at": 20, "nodes": [], "connections": [], "settings": {}}
        self.plan = plan(create("p"), create("g", "image_generator", ""), connect("p", "g"))
        self.gate = None
        self.started = asyncio.Event()
        self.writer_started = threading.Event()
        self.writer_gate = None
        self.writes = 0
        self.fail_save = False
        self.stale = False
        self.notify = []
        def load(cid):
            if cid != self.canvas["id"]:
                raise HTTPException(404, "画布不存在")
            return self.canvas
        async def model(fields):
            self.started.set()
            if self.gate:
                await self.gate.wait()
            if self.stale:
                self.canvas["updated_at"] += 1
            return {"text": self.plan.model_dump_json(by_alias=True)}
        def apply(user, payload, operations):
            self.writer_started.set()
            if self.writer_gate:
                self.writer_gate.wait(3)
            candidate, receipt = prepare_operations(self.canvas, operations, request_id=payload.requestId, user=user, expected_updated_at=payload.expectedUpdatedAt, creation_settings=payload.creationSettings, providers=[])
            if self.fail_save:
                raise OSError("private-file-error")
            if candidate:
                candidate["updated_at"] += 1
                receipt["updatedAtAfter"] = candidate["updated_at"]
                self.canvas = candidate
                self.writes += 1
            return receipt
        async def notify(cid):
            self.notify.append(cid)
        app = FastAPI()
        app.include_router(create_assistant_router(root=lambda: self.temp.name, load_canvas=load, providers=lambda: [{"id": "mock", "has_key": True, "chat_models": ["chat"]}], user_id=lambda header, request: header, call_model=model, apply_operations=apply, notify_changed=notify))
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"X-User-Id": "user-a"})
        self.session = (await self.client.post("/api/canvas-assistant/sessions", json={"canvasId": "canvas-a"})).json()["session"]["id"]
        self.payload = {"canvasId": "canvas-a", "sessionId": self.session, "requestId": "turn-a", "message": "创建咖啡海报提示词与生成节点并连线，不运行", "provider": "mock", "model": "chat", "expectedUpdatedAt": 20}

    async def asyncTearDown(self):
        if self.writer_gate:
            self.writer_gate.set()
        await self.client.aclose()
        self.temp.cleanup()

    async def history(self):
        response = await self.client.get("/api/canvas-assistant/history", params={"canvasId": "canvas-a", "sessionId": self.session})
        return response.json()["session"]

    async def test_real_route_receipt_history_and_read_only_context(self):
        response = await self.client.post("/api/canvas-assistant/chat", json=self.payload)
        event = json.loads(response.text.splitlines()[-1])
        self.assertEqual(event["state"], "completed")
        self.assertEqual(len(event["change"]["createdNodeIds"]), 2)
        self.assertEqual(self.writes, 1)
        self.assertEqual(self.notify, ["canvas-a"])
        self.assertEqual((await self.history())["turns"][0]["change"], event["change"])
        self.canvas["nodes"][0]["api_key"] = "private-do-not-send"
        context = await self.client.get("/api/canvas-assistant/canvas", params={"canvasId": "canvas-a"})
        self.assertNotIn("private-do-not-send", context.text)
        duplicate = await self.client.post("/api/canvas-assistant/chat", json=self.payload)
        self.assertEqual(duplicate.status_code, 409)
        self.assertEqual(self.writes, 1)

    async def test_concurrent_edit_and_save_failure_do_not_claim_success(self):
        for stale, fail_save in ((True, False), (False, True)):
            self.stale, self.fail_save = stale, fail_save
            self.canvas["updated_at"] = 20
            response = await self.client.post("/api/canvas-assistant/chat", json={**self.payload, "requestId": "stale" if stale else "failed"})
            self.assertEqual(json.loads(response.text.splitlines()[-1])["state"], "failed")
            self.assertNotIn("private-file-error", response.text)
            self.assertEqual(self.canvas["nodes"], [])
            self.assertEqual(self.writes, 0)

    async def test_cancel_before_model_finishes_prevents_canvas_write(self):
        self.gate = asyncio.Event()
        task = asyncio.create_task(self.client.post("/api/canvas-assistant/chat", json=self.payload))
        await asyncio.wait_for(self.started.wait(), 3)
        cancelled = await self.client.post("/api/canvas-assistant/cancel", json={k: self.payload[k] for k in ("canvasId", "sessionId", "requestId")})
        self.assertEqual(cancelled.json()["state"], "cancelled")
        response = await asyncio.wait_for(task, 3)
        self.assertEqual(json.loads(response.text.splitlines()[-1])["state"], "cancelled")
        self.assertEqual(self.writes, 0)

    async def test_cancel_after_atomic_write_starts_returns_actual_completed_state(self):
        self.writer_gate = threading.Event()
        task = asyncio.create_task(self.client.post("/api/canvas-assistant/chat", json=self.payload))
        self.assertTrue(await asyncio.to_thread(self.writer_started.wait, 3))
        cancelled = asyncio.create_task(self.client.post("/api/canvas-assistant/cancel", json={k: self.payload[k] for k in ("canvasId", "sessionId", "requestId")}))
        self.writer_gate.set()
        self.assertEqual((await asyncio.wait_for(cancelled, 3)).json()["state"], "completed")
        response = await asyncio.wait_for(task, 3)
        self.assertEqual(json.loads(response.text.splitlines()[-1])["state"], "completed")
        self.assertEqual(self.writes, 1)

    async def test_history_recovers_receipt_after_interrupted_response(self):
        await self.client.post("/api/canvas-assistant/chat", json=self.payload)
        from backend.canvas_assistant import AssistantStore
        store = AssistantStore(lambda: self.temp.name)
        def interrupt(doc):
            turn = doc["sessions"][self.session]["turns"][0]
            turn.pop("change")
            turn.update(state="interrupted", reply="", error="中断")
        store.transact("user-a", "canvas-a", interrupt)
        turn = (await self.history())["turns"][0]
        self.assertEqual(turn["state"], "completed")
        self.assertEqual(len(turn["change"]["createdNodeIds"]), 2)
        self.assertEqual(self.writes, 1)


if __name__ == "__main__":
    unittest.main()
