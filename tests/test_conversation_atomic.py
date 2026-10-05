"""对话记录写入中断时，已保存的消息仍可读取。"""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main
from backend import atomic_json


class ConversationAtomicTests(unittest.TestCase):
    def test_existing_conversation_survives_replace_failure(self):
        with tempfile.TemporaryDirectory(prefix="nadou-conversation-") as directory:
            root = Path(directory) / "conversations"
            original = {"id": "example", "messages": [{"role": "user", "content": "旧消息"}]}
            revised = {"id": "example", "messages": [{"role": "user", "content": "新消息"}]}
            with patch.object(main, "CONVERSATION_DIR", str(root)):
                main.save_conversation("isolated", original)
                path = root / "isolated" / "example.json"
                before = path.read_bytes()
                with patch.object(atomic_json.os, "replace", side_effect=OSError("synthetic replace failure")):
                    with self.assertRaises(OSError):
                        main.save_conversation("isolated", revised)
                self.assertEqual(path.read_bytes(), before)
                self.assertEqual(main.load_conversation("isolated", "example"), original)
                self.assertEqual(list(path.parent.glob(".example.json.*.tmp")), [])
                main.save_conversation("isolated", revised)
                self.assertEqual(json.loads(path.read_text(encoding="utf-8")), revised)


if __name__ == "__main__":
    unittest.main()
