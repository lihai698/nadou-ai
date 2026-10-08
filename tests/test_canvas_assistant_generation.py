import asyncio
import copy
import json
import tempfile
import unittest

import httpx
from fastapi import FastAPI, HTTPException

from backend.canvas_assistant import create_assistant_router
from backend.canvas_assistant_operations import parse_plan, prepare_operations


class ImageProposalTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.canvas = {"id": "canvas-a", "kind": "classic", "updated_at": 20, "nodes": [], "connections": [], "settings": {}}
        self.providers = [{"id": "mock", "name": "测试平台", "has_key": True, "enabled": True, "protocol": "openai", "chat_models": ["chat"], "image_models": ["image-user"]}]
        self.tasks = {}
        self.assets = []
        self.submissions = 0
        self.submit_error = None
        self.settings = {"engine": "api", "provider_id": "mock", "model": "image-user", "ratio": "square", "resolution": "1k", "quality": "auto"}
        async def model(fields):
            return {"text": json.dumps({"reply": "已整理海报方案，确认后生成。", "operations": [{"op": "propose_image", "operationId": "image1", "title": "咖啡海报", "prompt": "温暖的咖啡海报"}]}, ensure_ascii=False)}
        def apply(user, payload, operations):
            candidate, receipt = prepare_operations(self.canvas, operations, request_id=payload.requestId, user=user,
                expected_updated_at=payload.expectedUpdatedAt, creation_settings=payload.creationSettings,
                providers=self.providers, image_model_confirmed=payload.imageModelConfirmed,
                reference_images=[a['url'] for a in self.assets if a['id'] in payload.referencedAssetIds])
            for proposal in receipt.get('proposals', []):
                proposal['referenceAssetSnapshot'] = [{'id':a['id'],'url':a['url']} for a in self.assets if a['id'] in payload.referencedAssetIds]
            if candidate:
                candidate["updated_at"] += 1
                receipt["updatedAtAfter"] = candidate["updated_at"]
                self.canvas = candidate
            return receipt
        async def submit(proposal, image_request, request):
            if self.submit_error:
                raise self.submit_error
            await asyncio.sleep(0)
            if proposal["taskId"] not in self.tasks:
                self.submissions += 1
                self.tasks[proposal["taskId"]] = {"task_id": proposal["taskId"], "status": "queued", "result": None}
            return self.tasks[proposal["taskId"]]
        async def query(task_id):
            if task_id not in self.tasks:
                raise HTTPException(404, "任务不存在")
            return self.tasks[task_id]
        app = FastAPI()
        app.include_router(create_assistant_router(root=lambda: self.temp.name, load_canvas=lambda cid: self.canvas,
            providers=lambda: self.providers, user_id=lambda header, request: header, call_model=model,
            apply_operations=apply, submit_image=submit, query_image=query, load_reference_assets=lambda:self.assets))
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"X-User-Id": "user-a"})
        self.session = (await self.client.post("/api/canvas-assistant/sessions", json={"canvasId": "canvas-a"})).json()["session"]["id"]
        self.payload = {"canvasId": "canvas-a", "sessionId": self.session, "requestId": "turn-a", "provider": "mock", "model": "chat",
                        "message": "帮我生成咖啡海报", "expectedUpdatedAt": 20, "creationSettings": self.settings, "imageModelConfirmed": True}

    async def asyncTearDown(self):
        await self.client.aclose()
        self.temp.cleanup()

    async def propose(self):
        response = await self.client.post("/api/canvas-assistant/chat", json=self.payload)
        event = json.loads(response.text.splitlines()[-1])
        self.assertEqual(event["state"], "completed", event)
        self.assertEqual(self.submissions, 0)
        self.proposal = event["proposals"][0]
        self.action = {"canvasId": "canvas-a", "sessionId": self.session, "turnId": "turn-a", "proposalId": self.proposal["id"],
                       "action": "confirm", "expectedUpdatedAt": self.canvas["updated_at"], "imageProvider": "mock", "imageModel": "image-user",
                       "imageRequest": {"provider_id": "mock", "model": "image-user", "prompt": "温暖的咖啡海报", "size": "1024x1024", "n": 1, "reference_images": [], "quality": "auto"}}
        return self.proposal

    async def act(self, **changes):
        return await self.client.post("/api/canvas-assistant/proposals/action", json={**self.action, **changes})

    async def test_proposal_creates_native_nodes_without_submitting_and_keeps_selected_model(self):
        proposal = await self.propose()
        self.assertEqual(proposal["model"], "image-user")
        self.assertEqual(proposal["state"], "pending")
        self.assertEqual([n["type"] for n in self.canvas["nodes"]], ["prompt", "generator"])
        self.assertEqual(len(self.canvas["connections"]), 1)

    async def test_smart_proposal_has_runnable_image_node(self):
        self.canvas["kind"] = "smart"
        await self.propose()
        prompt, target = self.canvas["nodes"]
        self.assertEqual((prompt["type"], target["type"]), ("smart-prompt", "smart-image"))
        self.assertEqual(target["runSettings"]["model"], "image-user")
        self.assertEqual(target["runSettings"]["count"], 1)

    async def test_native_smart_save_adds_empty_images_without_invalidating_confirmation(self):
        self.canvas['kind'] = 'smart'
        await self.propose()
        for node in self.canvas['nodes']:
            node.setdefault('images', [])
        response = await self.act()
        self.assertEqual(response.status_code, 200, response.text)

    async def test_repeated_and_concurrent_confirmation_reuses_task_after_history_reopen(self):
        await self.propose()
        first = await self.act()
        self.assertEqual(first.status_code, 200, first.text)
        results = await asyncio.gather(self.act(), self.act())
        self.assertTrue(all(r.status_code == 200 for r in results))
        self.assertEqual(self.submissions, 1)
        self.assertEqual(first.json()["task"]["task_id"], self.proposal["taskId"])
        history = (await self.client.get("/api/canvas-assistant/history", params={"canvasId": "canvas-a", "sessionId": self.session})).json()
        self.assertEqual(history["session"]["turns"][0]["proposals"][0]["state"], "submitted")

    async def test_changed_canvas_selection_provider_or_request_is_rejected_before_submission(self):
        await self.propose()
        original = copy.deepcopy(self.canvas)
        self.canvas["nodes"][0]["text"] = "用户修改"
        self.assertEqual((await self.act()).status_code, 409)
        self.canvas = original
        self.assertEqual((await self.act(imageModel="other")).status_code, 409)
        self.assertEqual((await self.act(imageRequest={**self.action["imageRequest"], "prompt": "篡改"})).status_code, 409)
        self.assertEqual((await self.act(imageRequest={**self.action["imageRequest"], "n": 9})).status_code, 422)
        self.assertEqual((await self.act(imageRequest={**self.action['imageRequest'], 'size':'4096x4096'})).status_code, 409)
        self.assertEqual((await self.act(imageRequest={**self.action['imageRequest'], 'resolution':'4k'})).status_code, 409)
        self.providers[0]["image_models"] = []
        self.assertEqual((await self.act()).status_code, 409)
        self.assertEqual(self.submissions, 0)

    async def test_unconfirmed_model_and_foreign_user_cannot_generate(self):
        self.payload["imageModelConfirmed"] = False
        response = await self.client.post("/api/canvas-assistant/chat", json=self.payload)
        self.assertEqual(json.loads(response.text.splitlines()[-1])["state"], "failed")
        self.assertEqual(self.canvas["nodes"], [])
        self.payload.update(requestId="turn-b", imageModelConfirmed=True)
        await self.propose()
        self.action["turnId"] = "turn-b"
        response = await self.client.post("/api/canvas-assistant/proposals/action", json=self.action, headers={"X-User-Id": "user-b"})
        self.assertEqual(response.status_code, 404)
        self.assertEqual(self.submissions, 0)

    async def test_dismiss_cannot_be_confirmed_and_unknown_submission_cannot_be_retried(self):
        await self.propose()
        self.assertEqual((await self.act(action="dismiss")).status_code, 200)
        self.assertEqual((await self.act()).status_code, 409)
        self.assertEqual(self.submissions, 0)

    async def test_retry_requires_failed_task_and_creates_fresh_confirmation(self):
        await self.propose()
        accepted = (await self.act()).json()["task"]
        self.assertEqual((await self.act(action="retry")).status_code, 409)
        self.tasks[accepted["task_id"]]["status"] = "failed"
        response = await self.act(action="retry")
        self.assertEqual(response.status_code, 200, response.text)
        retry = response.json()["proposal"]
        self.assertNotEqual(retry["id"], self.proposal["id"])
        self.assertEqual(retry["state"], "pending")
        self.assertEqual(self.submissions, 1)

    async def test_simultaneous_pending_confirmations_submit_only_once(self):
        await self.propose()
        results = await asyncio.gather(self.act(), self.act(), self.act())
        self.assertIn(200, [r.status_code for r in results])
        self.assertTrue(all(r.status_code in {200, 409} for r in results))
        self.assertEqual(self.submissions, 1)
        self.assertEqual((await self.act(action='query')).json()['task']['task_id'], self.proposal['taskId'])

    async def test_unknown_acceptance_blocks_retry_and_query_uses_durable_id(self):
        await self.propose()
        await self.act()
        saved = self.tasks.pop(self.proposal['taskId'])
        self.assertEqual((await self.act(action='retry')).status_code, 409)
        self.assertEqual((await self.act()).status_code, 409)
        self.assertEqual(self.submissions, 1)
        # 真实任务查询返回 id 字段；确认接口仍要给原生画布 task_id。
        self.tasks[self.proposal['taskId']] = {'id': saved['task_id'], 'status':'succeeded'}
        restored = (await self.act(action='query')).json()
        self.assertEqual(restored['task']['task_id'], self.proposal['taskId'])

    async def test_external_reference_is_copied_as_native_input_and_rechecked_before_confirmation(self):
        self.assets = [{'id':'asset:test:1','url':'/assets/test.png','kind':'image','source':'asset','name':'参考图'}]
        self.payload['referencedAssetIds'] = ['asset:test:1']
        await self.propose()
        self.assertEqual(self.proposal['referenceImages'], ['/assets/test.png'])
        self.assertEqual(self.canvas['nodes'][-1]['type'], 'image')
        self.action['imageRequest']['reference_images'] = [{'url':'/assets/test.png'}]
        self.assets.clear()
        response = await self.act()
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(self.submissions, 0)

    async def test_recoverable_remote_failure_cannot_be_retried_as_another_task(self):
        await self.propose()
        await self.act()
        self.tasks[self.proposal['taskId']].update(status='failed', upstream_task_id='remote-running')
        response = await self.act(action='retry')
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(self.submissions, 1)

    async def test_known_local_persistence_rejection_can_be_confirmed_after_disk_recovers(self):
        await self.propose()
        error = HTTPException(503, '本地记录无法保存，本次请求未提交')
        error.submission_known_rejected = True
        self.submit_error = error
        self.assertEqual((await self.act()).status_code, 503)
        self.submit_error = None
        response = await self.act()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.submissions, 1)

    async def test_unknown_submission_error_keeps_original_id_without_retry(self):
        await self.propose()
        self.submit_error = HTTPException(502, '响应未知')
        self.assertEqual((await self.act()).status_code, 502)
        self.submit_error = None
        self.assertEqual((await self.act()).status_code, 409)
        self.assertEqual((await self.act(action='retry')).status_code, 409)
        self.assertEqual(self.submissions, 0)

    async def test_retry_rejects_disconnected_inputs_and_confirmation_rejects_changed_input_order(self):
        await self.propose()
        target = next(n for n in self.canvas['nodes'] if n['id'] == self.proposal['nodeId'])
        original_inputs = target['inputs'][:]
        target['inputs'] = []
        self.assertEqual((await self.act()).status_code, 409)
        target['inputs'] = original_inputs
        await self.act()
        self.tasks[self.proposal['taskId']]['status'] = 'failed'
        self.canvas['connections'].clear()
        self.assertEqual((await self.act(action='retry')).status_code, 409)
        self.assertEqual(self.submissions, 1)

    async def test_classic_retry_ignores_native_created_downstream_output(self):
        await self.propose()
        await self.act()
        self.tasks[self.proposal['taskId']]['status'] = 'failed'
        self.canvas['nodes'].append({'id':'output-a', 'type':'output', 'images':[]})
        self.canvas['connections'].append({'id':'output-edge', 'from':self.proposal['nodeId'], 'to':'output-a'})
        response = await self.act(action='retry')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.submissions, 1)
