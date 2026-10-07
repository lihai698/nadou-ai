"""上游空回复不能成为成功的画布、对话或图片说明结果。"""

import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main


class ChatEmptyResponseTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = patch.object(main, "CONVERSATION_DIR", self.temp.name)
        self.directory.start()
        self.addCleanup(self.directory.stop)
        self.real_client = httpx.AsyncClient

    def provider_patches(self, response):
        def client_factory(*args, **kwargs):
            return self.real_client(
                transport=httpx.MockTransport(
                    lambda request: httpx.Response(200, json=response)
                )
            )

        return (
            patch.object(main, "get_api_provider", return_value={"id": "test"}),
            patch.object(main, "resolve_chat_provider", return_value=("https://provider.test/v1", {}, "model")),
            patch.object(main.httpx, "AsyncClient", side_effect=client_factory),
        )

    async def test_canvas_empty_response_fails_and_nonempty_response_succeeds(self):
        payload = main.CanvasLLMRequest(message="测试", provider="test", model="model")
        patches = self.provider_patches({"choices": [{"message": {"content": "  "}}]})
        with patches[0], patches[1], patches[2]:
            with self.assertRaises(main.HTTPException) as caught:
                await main.canvas_llm(payload)
        self.assertEqual(caught.exception.status_code, 502)
        self.assertIn("空回复", caught.exception.detail)

        patches = self.provider_patches({"data": {"choices": [{"message": {"content": "正常回复"}}]}})
        with patches[0], patches[1], patches[2]:
            result = await main.canvas_llm(payload)
        self.assertEqual(result["text"], "正常回复")

    async def test_canvas_http_route_returns_error_for_empty_upstream_reply(self):
        async with self.real_client(
            transport=httpx.ASGITransport(app=main.app), base_url="http://test"
        ) as client:
            patches = self.provider_patches({"choices": []})
            with patches[0], patches[1], patches[2]:
                response = await client.post(
                    "/api/canvas-llm",
                    json={"message": "测试", "provider": "test", "model": "model"},
                )
        self.assertEqual(response.status_code, 502)
        self.assertIn("空回复", response.json()["detail"])

    async def test_chat_empty_response_keeps_user_message_without_assistant(self):
        payload = main.ChatRequest(message="测试", provider="test", model="model")
        patches = self.provider_patches({"choices": []})
        with patches[0], patches[1], patches[2]:
            with self.assertRaises(main.HTTPException) as caught:
                await main.chat(payload, SimpleNamespace(client=None), x_user_id="test")
        self.assertEqual(caught.exception.status_code, 502)
        files = list(Path(self.temp.name).rglob("*.json"))
        self.assertEqual(len(files), 1)
        messages = json.loads(files[0].read_text(encoding="utf-8"))["messages"]
        self.assertEqual([message["role"] for message in messages], ["user"])

    async def test_agent_and_caption_empty_responses_fail(self):
        payload = main.ChatRequest(message="测试", provider="test", model="model")
        patches = self.provider_patches({"choices": [{"message": {"content": None}}]})
        with patches[0], patches[1], patches[2]:
            with self.assertRaises(main.HTTPException) as caught:
                await main.build_chat_text_reply(payload, {"messages": []})
        self.assertEqual(caught.exception.status_code, 502)

        patches = self.provider_patches({"choices": []})
        with patches[0], patches[1], patches[2], patch.object(main, "image_path_to_data_url", return_value="data:image/png;base64,AA=="):
            with self.assertRaises(main.HTTPException) as caught:
                await main.caption_image_with_provider("sample.png", "描述图片", "test", "model")
        self.assertEqual(caught.exception.status_code, 502)

    async def test_stream_empty_response_emits_error_without_done_or_assistant(self):
        payload = main.ChatRequest(message="测试", provider="test", model="model")
        patches = self.provider_patches({"choices": []})
        with patches[0], patches[1], patches[2]:
            response = await main.chat_stream(payload, SimpleNamespace(client=None), x_user_id="test")
            chunks = [chunk async for chunk in response.body_iterator]
        events = [json.loads(line[5:]) for chunk in chunks for line in chunk.splitlines() if line.startswith("data:")]
        self.assertEqual([event["type"] for event in events], ["meta", "error"])
        self.assertIn("空回复", events[-1]["detail"])
        files = list(Path(self.temp.name).rglob("*.json"))
        messages = json.loads(files[0].read_text(encoding="utf-8"))["messages"]
        self.assertEqual([message["role"] for message in messages], ["user"])


if __name__ == "__main__":
    unittest.main()
