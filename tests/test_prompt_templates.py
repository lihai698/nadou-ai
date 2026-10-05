"""内置提示词模板解析规则及真实智能画布入口回归。"""

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main
from backend.prompt_templates import (
    extract_prompt_template_section,
    parse_prompt_template_markdown,
    prompt_template_category,
)


MARKDOWN = """# 内置模板

## 预设 1：电影灯光
### 适用场景
夜景电影级灯光

### 正向提示词
```text
cinematic night lighting
```

### 负向提示词
低清晰度

### 平台参数建议
- **尺寸**：1024x1024
- **风格**：电影感

## 预设 2：空模板
### 适用场景
只用于检查缺少正向提示词
"""


class PromptTemplateRulesTests(unittest.TestCase):
    def test_parser_keeps_template_fields_and_fenced_content(self):
        parsed = parse_prompt_template_markdown(
            MARKDOWN,
            {"电影灯光": {"name": "Cinematic Light", "scene": "Night scene"}},
        )
        self.assertEqual(len(parsed), 1)
        self.assertEqual(parsed[0], {
            "id": "builtin_md_1",
            "number": "1",
            "name": "电影灯光",
            "name_en": "Cinematic Light",
            "category": "lighting",
            "scene": "夜景电影级灯光",
            "scene_en": "Night scene",
            "positive": "cinematic night lighting",
            "negative": "低清晰度",
            "params": {"尺寸": "1024x1024", "风格": "电影感"},
            "builtin": True,
        })

    def test_category_and_section_keep_legacy_fallbacks(self):
        self.assertEqual(prompt_template_category("产品展示", "白底"), "product")
        self.assertEqual(prompt_template_category("普通场景", "镜头俯拍"), "view")
        self.assertEqual(prompt_template_category("普通场景", "角色表情"), "character")
        self.assertEqual(prompt_template_category("普通场景", "日常"), "storyboard")
        self.assertEqual(
            extract_prompt_template_section("### 适用场景\n普通正文", "适用场景"),
            "普通正文",
        )
        self.assertEqual(extract_prompt_template_section("", "适用场景"), "")

    def test_module_has_no_main_dependency(self):
        source = Path(__file__).resolve().parents[1] / "backend" / "prompt_templates.py"
        self.assertNotIn("import main", source.read_text(encoding="utf-8"))


class PromptTemplateEntryTests(unittest.IsolatedAsyncioTestCase):
    async def test_smart_canvas_endpoint_uses_module_parser(self):
        with tempfile.TemporaryDirectory(
            prefix="prompt-template-entry-",
            dir=Path(__file__).resolve().parents[1],
        ) as directory:
            path = Path(directory) / "templates.md"
            path.write_text(MARKDOWN, encoding="utf-8")
            with patch.object(main, "PROMPT_TEMPLATE_PATHS", [str(path)]), patch.object(
                main, "PROMPT_TEMPLATE_EN", {"电影灯光": {"name": "Cinematic Light", "scene": "Night scene"}}
            ):
                async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=main.app),
                    base_url="http://prompt-template.test",
                ) as client:
                    response = await client.get("/api/smart-canvas/prompt-templates")
            self.assertEqual(response.status_code, 200, response.text)
            payload = response.json()
            self.assertEqual(payload["templates"][0]["name_en"], "Cinematic Light")
            self.assertEqual(payload["templates"][0]["params"]["尺寸"], "1024x1024")
            self.assertTrue(payload["source"].endswith("templates.md"))

    def test_main_compatibility_parser_keeps_translation_map(self):
        with patch.object(main, "PROMPT_TEMPLATE_EN", {"电影灯光": {"name": "Cinematic Light"}}):
            self.assertEqual(
                main.parse_prompt_template_markdown(MARKDOWN)[0]["name_en"],
                "Cinematic Light",
            )


if __name__ == "__main__":
    unittest.main()
