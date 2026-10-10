"""Real video task routes/workers with isolated files and mock providers only."""
import asyncio
import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main


class CanvasVideoAssistantOwnershipTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="video-assistant-")
        self.addCleanup(self.temp.cleanup)
        for name, value in (("CANVAS_VIDEO_TASK_DIR", self.temp.name), ("CANVAS_VIDEO_TASK_VOLATILE", {})):
            fixture = patch.object(main, name, value)
            fixture.start()
            self.addCleanup(fixture.stop)
        self.providers = [{"id":"mock-provider", "enabled":True, "video_models":["mock-video"]}]
        fixture = patch.object(main, "load_api_providers", side_effect=lambda:copy.deepcopy(self.providers))
        fixture.start()
        self.addCleanup(fixture.stop)
        # Even a broken ownership check must never reach a real provider.
        self.generator = AsyncMock(return_value={"videos":["/output/mock-video.mp4"], "task_id":"mock-remote"})
        fixture = patch.object(main, "canvas_video", new=self.generator)
        fixture.start()
        self.addCleanup(fixture.stop)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://isolated")
        self.addAsyncCleanup(self.client.aclose)
        self.body = {
            "client_task_id":"canvas_video_assistant_1234567890",
            "prompt":"隔离测试正文，不发送供应商", "provider_id":"mock-provider", "model":"mock-video",
            "assistant_action_id":"action-one", "canvas_id":"canvas-one", "node_id":"node-one", "input_hash":"a" * 64,
        }

    async def wait_terminal(self):
        for _ in range(100):
            response = await self.client.get(f"/api/canvas-video-tasks/{self.body['client_task_id']}")
            if response.status_code == 200 and response.json()["status"] in {"succeeded", "failed"}:
                return response.json()
            await asyncio.sleep(0.01)
        self.fail("Isolated video worker did not reach a terminal state")

    async def test_assistant_marker_requires_complete_valid_ownership_before_worker(self):
        cases = [{key:""} for key in ("canvas_id", "node_id", "input_hash")]
        cases += [{"canvas_id":"../private"}, {"node_id":"bad node"}, {"assistant_action_id":"bad/action"}, {"input_hash":"not-a-hash"}]
        with patch.object(main, "run_canvas_video_task", new=AsyncMock()) as worker:
            for changes in cases:
                with self.subTest(changes=changes):
                    response = await self.client.post("/api/canvas-video-tasks", json={**self.body, **changes})
                    self.assertEqual(response.status_code, 422, response.text)
            worker.assert_not_awaited()
            self.generator.assert_not_awaited()
        self.assertEqual(list(Path(self.temp.name).glob("*.json")), [])

    async def test_acceptance_and_get_publish_only_fixed_ownership_and_save_no_prompt(self):
        response = await self.client.post("/api/canvas-video-tasks", json=self.body)
        self.assertEqual(response.status_code, 200, response.text)
        for key in ("canvas_id", "node_id", "assistant_action_id", "input_hash"):
            self.assertEqual(response.json().get(key), self.body[key])
        task = await self.wait_terminal()
        self.assertEqual(task["status"], "succeeded")
        for key in ("canvas_id", "node_id", "assistant_action_id", "input_hash"):
            self.assertEqual(task.get(key), self.body[key])
        self.assertNotIn("request_hash", task)
        self.assertNotIn("prompt", task)
        record = Path(main.canvas_video_task_path(self.body["client_task_id"])).read_text(encoding="utf-8")
        self.assertNotIn(self.body["prompt"], record)
        self.generator.assert_awaited_once()

    async def test_same_id_is_idempotent_but_changed_ownership_or_parameters_are_rejected(self):
        response = await self.client.post("/api/canvas-video-tasks", json=self.body)
        self.assertEqual(response.status_code, 200, response.text)
        await self.wait_terminal()
        self.assertEqual((await self.client.post("/api/canvas-video-tasks", json=self.body)).status_code, 200)
        cases = [
            {"canvas_id":"canvas-other"}, {"node_id":"node-other"}, {"assistant_action_id":"action-other"},
            {"input_hash":"b" * 64}, {"prompt":"不同正文"}, {"duration":8}, {"generate_audio":True},
            {"images":[{"url":"/assets/other.png", "role":"first_frame"}]},
            {"provider_id":"other-provider"}, {"model":"other-model"}, {"assistant_action_id":""},
        ]
        for changes in cases:
            with self.subTest(changes=changes):
                duplicate = await self.client.post("/api/canvas-video-tasks", json={**self.body, **changes})
                self.assertEqual(duplicate.status_code, 409, duplicate.text)
        self.generator.assert_awaited_once()

    async def test_assistant_cannot_claim_an_old_unbound_manual_id(self):
        manual = {key:value for key,value in self.body.items() if key not in {"canvas_id", "node_id", "assistant_action_id", "input_hash"}}
        self.assertEqual((await self.client.post("/api/canvas-video-tasks", json=manual)).status_code, 200)
        await self.wait_terminal()
        response = await self.client.post("/api/canvas-video-tasks", json=self.body)
        self.assertEqual(response.status_code, 409, response.text)
        self.generator.assert_awaited_once()

    async def test_assistant_provider_and_video_model_are_exact_enabled_and_nonempty(self):
        cases = [
            ({"provider_id":"missing"}, self.providers), ({"provider_id":""}, self.providers),
            ({"model":""}, self.providers), ({"model":"not-owned"}, self.providers),
            ({}, [{"id":"mock-provider", "enabled":False, "video_models":["mock-video"]}]),
            ({}, [{"id":"mock-provider", "enabled":True, "video_models":[], "image_models":["mock-video"]}]),
        ]
        with patch.object(main, "run_canvas_video_task", new=AsyncMock()) as worker:
            for changes, providers in cases:
                with self.subTest(changes=changes, providers=providers):
                    self.providers = providers
                    response = await self.client.post("/api/canvas-video-tasks", json={**self.body, **changes})
                    self.assertEqual(response.status_code, 409, response.text)
            worker.assert_not_awaited()
            self.generator.assert_not_awaited()

    async def test_worker_rechecks_provider_model_and_persisted_ownership_without_submission(self):
        with patch.object(main, "run_canvas_video_task", new=AsyncMock()):
            response = await self.client.post("/api/canvas-video-tasks", json=self.body)
        self.assertEqual(response.status_code, 200, response.text)
        queued = main.read_canvas_video_task(self.body["client_task_id"])
        variants = ["missing-provider", "disabled-provider", "missing-model", "foreign-node", "foreign-provider", "foreign-model", "stripped-marker", "changed-payload"]
        for variant in variants:
            with self.subTest(variant=variant):
                task = copy.deepcopy(queued)
                self.providers = [{"id":"mock-provider", "enabled":True, "video_models":["mock-video"]}]
                worker_body = dict(self.body)
                if variant == "missing-provider": self.providers = []
                if variant == "disabled-provider": self.providers[0]["enabled"] = False
                if variant == "missing-model": self.providers[0]["video_models"] = []
                if variant == "foreign-node": task["node_id"] = "other"
                if variant == "foreign-provider": task["provider_id"] = "other"
                if variant == "foreign-model": task["model"] = "other"
                if variant == "stripped-marker": worker_body["assistant_action_id"] = ""
                if variant == "changed-payload": worker_body["prompt"] = "changed"
                main.write_canvas_video_task(task)
                await main._run_canvas_video_task(self.body["client_task_id"], main.CanvasVideoTaskRequest(**worker_body))
                result = (await self.client.get(f"/api/canvas-video-tasks/{self.body['client_task_id']}")).json()
                self.assertEqual(result["status"], "failed", result)
                self.generator.assert_not_awaited()

    async def test_identical_accepted_task_remains_queryable_if_provider_is_removed(self):
        self.assertEqual((await self.client.post("/api/canvas-video-tasks", json=self.body)).status_code, 200)
        await self.wait_terminal()
        self.providers = []
        duplicate = await self.client.post("/api/canvas-video-tasks", json=self.body)
        self.assertEqual(duplicate.status_code, 200, duplicate.text)
        self.assertEqual(duplicate.json()["status"], "succeeded")
        self.generator.assert_awaited_once()

    async def test_unmarked_manual_requests_keep_existing_fallback_and_id_reuse_behavior(self):
        body = {"client_task_id":self.body["client_task_id"], "prompt":"manual", "provider_id":"old-missing-provider"}
        self.providers = []
        self.assertEqual((await self.client.post("/api/canvas-video-tasks", json=body)).status_code, 200)
        result = await self.wait_terminal()
        self.assertEqual(result["status"], "succeeded")
        self.assertNotIn("assistant_action_id", result)
        self.assertEqual((await self.client.post("/api/canvas-video-tasks", json={**body, "prompt":"changed manual"})).status_code, 200)
        self.generator.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
