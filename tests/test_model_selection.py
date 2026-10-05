"""模型选择规则的独立回归，不读取本机配置或调用供应商。"""

import sys
import unittest
from pathlib import Path

from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.model_selection import model_list_from_values, normalize_model_list, selected_model


class ModelSelectionTests(unittest.TestCase):
    def test_selected_model_trims_requested_value_and_uses_fallback(self):
        self.assertEqual(selected_model("  image-model  ", "fallback"), "image-model")
        self.assertEqual(selected_model("", "  fallback  "), "fallback")

    def test_selected_model_rejects_empty_long_and_control_values(self):
        cases = [
            ("", "", "模型名称不能为空"),
            ("x" * 241, "fallback", "模型名称不合法：" + "x" * 241),
            ("model\nname", "fallback", "模型名称不合法：model\nname"),
        ]
        for requested, fallback, detail in cases:
            with self.subTest(requested=requested):
                with self.assertRaises(HTTPException) as raised:
                    selected_model(requested, fallback)
                self.assertEqual(raised.exception.status_code, 400)
                self.assertEqual(raised.exception.detail, detail)

    def test_model_lists_trim_and_deduplicate_without_reordering(self):
        values = [" model-a ", "model-b", "model-a", "", None, "  model-b  "]
        self.assertEqual(model_list_from_values(values), ["model-a", "model-b"])
        self.assertEqual(normalize_model_list(values), ["model-a", "model-b"])


if __name__ == "__main__":
    unittest.main()
