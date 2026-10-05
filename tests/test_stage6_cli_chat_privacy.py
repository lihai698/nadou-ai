"""验证 CLI 对话成功回包不把 stdout/stderr 原样持久化或返回页面。"""

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main


class Stage6CliChatPrivacyTests(unittest.IsolatedAsyncioTestCase):
    async def test_codex_chat_message_omits_cli_raw(self):
        payload = SimpleNamespace(provider="codex", model="", message="hello", images=[], reference_images=[], system_prompt="")
        raw = {"text": "reply", "_stdout": "secret local path C:\\Users\\private\\answer", "_stderr": "token=private"}
        with patch.object(main, "get_api_provider", return_value={"id": "codex", "protocol": "codex", "chat_models": ["gpt"]}), patch.object(
            main, "codex_chat_text", new=AsyncMock(return_value=("reply", raw))
        ):
            result = await main.build_chat_text_reply(payload, {"messages": []})
        self.assertEqual(result["content"], "reply")
        self.assertNotIn("raw", result)
        self.assertNotIn("private", str(result))

    async def test_gemini_chat_message_omits_cli_raw(self):
        payload = SimpleNamespace(provider="gemini-cli", model="", message="hello", images=[], reference_images=[], system_prompt="")
        raw = {"text": "reply", "_stdout": "secret local path C:\\Users\\private\\answer", "_stderr": "token=private"}
        with patch.object(main, "get_api_provider", return_value={"id": "gemini-cli", "protocol": "gemini-cli", "chat_models": ["auto"]}), patch.object(
            main, "gemini_cli_chat_text", new=AsyncMock(return_value=("reply", raw))
        ):
            result = await main.build_chat_text_reply(payload, {"messages": []})
        self.assertEqual(result["content"], "reply")
        self.assertNotIn("raw", result)
        self.assertNotIn("private", str(result))

    async def test_canvas_llm_cli_result_omits_cli_raw(self):
        payload = SimpleNamespace(provider="codex", model="", message="hello", messages=[], system_prompt="", ms_model="")
        raw = {"text": "reply", "_stdout": "secret local path C:\\Users\\private\\answer", "_stderr": "token=private"}
        with patch.object(main, "get_api_provider", return_value={"id": "codex", "protocol": "codex", "chat_models": ["gpt"]}), patch.object(
            main, "codex_chat_text", new=AsyncMock(return_value=("reply", raw))
        ):
            result = await main.canvas_llm(payload)
        self.assertEqual(result["text"], "reply")
        self.assertNotIn("raw", result)
        self.assertNotIn("private", str(result))


if __name__ == "__main__":
    unittest.main()
