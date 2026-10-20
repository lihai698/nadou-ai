"""画布文本、多模态及 ModelScope 真实入口的隔离行为基线。"""
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

import httpx
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main


class RemainingModelExecutionTests(unittest.IsolatedAsyncioTestCase):
    async def test_canvas_multimodal_history_and_apimart_parameters(self):
        requests = []
        client_type = httpx.AsyncClient
        def respond(request):
            requests.append(json.loads(request.content))
            return httpx.Response(200, json={"choices": [{"message": {"content": "reply"}}],
                                           "usage": {"total_tokens": 3, "debug": "private"}})
        def factory(**kwargs):
            return client_type(transport=httpx.MockTransport(respond))
        payload = main.CanvasLLMRequest(message="inspect", provider="apimart", model="chat", system_prompt="system",
            messages=[{"role": "tool", "content": "ignore"}, {"role": "assistant", "content": "history"}],
            images=["/output/a.png"], videos=["/output/a.mp4"], audios=["/output/a.wav"], temperature=.2, max_tokens=42)
        with patch.object(main, "get_api_provider", return_value={"id": "apimart", "protocol": "apimart"}), patch.object(
            main, "resolve_chat_provider", return_value=("https://api.test/v1", {}, "chat")
        ), patch.object(main.httpx, "AsyncClient", side_effect=factory), patch.object(
            main, "is_image_reference_value", return_value=True
        ), patch.object(main, "is_video_reference_value", return_value=True), patch.object(
            main, "media_reference_to_url", side_effect=lambda value, **kw: "converted:" + value
        ), patch.object(main, "video_reference_to_frame_data_urls", new=AsyncMock(return_value=["data:image/png;base64,AA=="])):
            result = await main.canvas_llm(payload)
        body = requests[0]
        self.assertFalse(body["stream"])
        self.assertEqual((body["temperature"], body["max_tokens"]), (.2, 42))
        self.assertEqual([item["role"] for item in body["messages"]], ["system", "assistant", "user"])
        parts = body["messages"][-1]["content"]
        self.assertEqual([item["type"] for item in parts], ["text", "image_url", "text", "image_url", "audio_url"])
        self.assertEqual(parts[-1]["audio_url"]["url"], "converted:/output/a.wav")
        self.assertEqual(result, {"text": "reply", "model": "chat", "raw_usage": {"total_tokens": 3}})

    async def test_canvas_video_without_frames_keeps_video_reference(self):
        client_type = httpx.AsyncClient
        captured = []
        def respond(request):
            captured.append(json.loads(request.content))
            return httpx.Response(200, json={"choices": [{"message": {"content": "reply"}}]})
        with patch.object(main, "get_api_provider", return_value={"id": "test"}), patch.object(
            main, "resolve_chat_provider", return_value=("https://api.test/v1", {}, "chat")
        ), patch.object(main.httpx, "AsyncClient", side_effect=lambda **kw: client_type(transport=httpx.MockTransport(respond))), patch.object(
            main, "is_video_reference_value", return_value=True
        ), patch.object(main, "media_reference_to_url", return_value="https://cdn.test/v.mp4"), patch.object(
            main, "video_reference_to_frame_data_urls", new=AsyncMock(return_value=[])
        ):
            await main.canvas_llm(main.CanvasLLMRequest(message="inspect", provider="test", videos=["/output/v.mp4"]))
        self.assertEqual(captured[0]["messages"][-1]["content"][-1],
                         {"type": "video_url", "video_url": {"url": "https://cdn.test/v.mp4"}})

    async def test_modelscope_success_paths_save_history_and_keep_acceptance(self):
        cases = [
            (main.poll_angle_cloud, main.CloudPollRequest(task_id="original-42", client_id="test"), False),
            (main.generate_angle_cloud, main.CloudGenRequest(prompt="demo", client_id="test"), True),
            (main.generate_cloud, main.CloudGenRequest(prompt="demo"), True),
            (main.ms_generate, main.MsGenerateRequest(prompt="demo", model="mock/model"), True),
        ]
        client_type = httpx.AsyncClient
        for execute, payload, submits in cases:
            with self.subTest(execute=execute.__name__), tempfile.TemporaryDirectory() as tmp:
                methods, history = [], []
                def respond(request):
                    methods.append((request.method, request.url.path))
                    if request.method == "POST":
                        return httpx.Response(200, json={"task_id": "original-42"})
                    if "/tasks/" in request.url.path:
                        return httpx.Response(200, json={"task_status": "SUCCEED", "output_images": ["https://cdn.test/a.png"]})
                    return httpx.Response(200, content=b"self-made-image")
                accept = AsyncMock()
                token = main.CANVAS_IMAGE_REMOTE_ACCEPT_CALLBACK.set(accept)
                try:
                    with patch.object(main, "modelscope_api_key", return_value="synthetic"), patch.object(
                        main, "modelscope_image_api_root", return_value="https://ms.test/v1"
                    ), patch.object(main.httpx, "AsyncClient", side_effect=lambda **kw: client_type(transport=httpx.MockTransport(respond))), patch.object(
                        main.asyncio, "sleep", new=AsyncMock()
                    ), patch.object(main, "output_path_for", side_effect=lambda name, category: str(Path(tmp) / name)), patch.object(
                        main, "output_url_for", side_effect=lambda name, category: "/output/" + name
                    ), patch.object(main, "save_to_history", side_effect=history.append), patch.object(
                        main, "manager", SimpleNamespace(send_personal_message=AsyncMock(), broadcast_new_image=AsyncMock())
                    ), patch.object(main, "schedule_coroutine", side_effect=lambda coro: coro.close()):
                        result = await execute(payload)
                finally:
                    main.CANVAS_IMAGE_REMOTE_ACCEPT_CALLBACK.reset(token)
                self.assertTrue(result["url"].startswith("/output/"))
                self.assertEqual((Path(tmp) / result["url"].split("/")[-1]).read_bytes(), b"self-made-image")
                self.assertEqual(len(history), 1)
                self.assertEqual(sum(method == "POST" for method, _ in methods), int(submits))
                if submits:
                    accept.assert_awaited_once_with("original-42", query_mode="modelscope")
                else:
                    accept.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
