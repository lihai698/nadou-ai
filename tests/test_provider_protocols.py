"""供应商协议规则的独立回归，不读取本机配置。"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.provider_protocols import (
    effective_protocol,
    normalize_model_name_map,
    normalize_model_protocols,
    provider_protocol,
)


class ProviderProtocolTests(unittest.TestCase):
    def test_normalizes_saved_model_overrides(self):
        self.assertEqual(
            normalize_model_protocols({"  image-one  ": " GEMINI ", "chat-one": "openai", "bad": "apimart", "": "gemini"}),
            {"image-one": "gemini", "chat-one": "openai"},
        )
        self.assertEqual(normalize_model_protocols(["gemini"]), {})
        self.assertEqual(
            normalize_model_name_map({"  model-id  ": "  中文\n 展示名  ", "same": "same", "empty": " "}),
            {"model-id": "中文 展示名"},
        )
        self.assertEqual(len(normalize_model_name_map({"m": "x" * 200})["m"]), 160)

    def test_model_override_applies_only_to_supported_protocols(self):
        provider = {
            "id": "custom",
            "protocol": " APIMART ",
            "model_protocols": {"gemini-model": " GEMINI ", "other": "runninghub"},
        }
        self.assertEqual(provider_protocol(provider), "apimart")
        self.assertEqual(effective_protocol(provider, " gemini-model "), "gemini")
        self.assertEqual(effective_protocol(provider, "other"), "apimart")
        self.assertEqual(effective_protocol(provider, "missing"), "apimart")
        self.assertEqual(effective_protocol(None, "missing"), "openai")

    def test_fixed_platforms_ignore_per_model_overrides(self):
        for provider_id in ("modelscope", "volcengine", "jimeng", "runninghub"):
            with self.subTest(provider_id=provider_id):
                provider = {
                    "id": provider_id.upper(),
                    "protocol": "runninghub",
                    "model_protocols": {"model": "gemini"},
                }
                self.assertEqual(effective_protocol(provider, "model"), "runninghub")


if __name__ == "__main__":
    unittest.main()
