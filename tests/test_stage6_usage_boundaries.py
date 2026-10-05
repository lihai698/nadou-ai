"""上游用量统计只保留有限数值，旧记录读取也不公开调试数据。"""

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main


class UsageBoundaryTests(unittest.IsolatedAsyncioTestCase):
    def test_public_usage_keeps_only_numeric_counts_and_cost(self):
        usage = {
            "prompt_tokens": 12,
            "completion_tokens": 4,
            "total_cost": 0.01,
            "output_tokens": "7",
            "cached_tokens": True,
            "debug": {"token": "private-debug-token"},
        }
        self.assertEqual(main.public_usage(usage), {
            "prompt_tokens": 12, "completion_tokens": 4, "total_cost": 0.01,
        })

    async def test_history_and_conversation_storage_and_reads_sanitize_usage(self):
        usage = {"prompt_tokens": 12, "debug": {"token": "private-debug-token"}}
        with tempfile.TemporaryDirectory(prefix="usage-boundary-") as temporary:
            root = Path(temporary)
            history = root / "history.json"
            history.write_text("[]", encoding="utf-8")
            conversations = root / "conversations"
            with patch.object(main, "HISTORY_FILE", str(history)), patch.object(
                main, "CONVERSATION_DIR", str(conversations)
            ):
                main.save_to_history({"images": ["/output/safe.png"], "raw_usage": usage})
                persisted_history = json.loads(history.read_text(encoding="utf-8"))
                self.assertEqual(persisted_history[0]["raw_usage"], {"prompt_tokens": 12})

                conversation = {"id": "safe", "messages": [{"role": "assistant", "raw_usage": usage}]}
                main.save_conversation("user", conversation)
                saved = main.load_conversation("user", "safe")
                self.assertEqual(saved["messages"][0]["raw_usage"], {"prompt_tokens": 12})
                self.assertNotIn("private-debug-token", json.dumps(saved))

                legacy = {"id": "legacy", "messages": [{"role": "assistant", "raw_usage": usage}]}
                path = Path(main.conversation_path("user", "legacy"))
                path.write_text(json.dumps(legacy), encoding="utf-8")
                self.assertEqual(main.load_conversation("user", "legacy")["messages"][0]["raw_usage"], {"prompt_tokens": 12})
                self.assertIn("private-debug-token", path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
