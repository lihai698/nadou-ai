"""画布素材引用规则：只用自制节点值验证，不访问真实画布和素材目录。"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main
from backend import canvas_asset_rules as rules


class CanvasAssetRuleTests(unittest.TestCase):
    def test_main_uses_the_extracted_public_rules(self):
        for name in rules.__all__:
            self.assertIs(getattr(main, name), getattr(rules, name))

    def test_url_value_and_downloadable_prefixes_keep_legacy_boundary(self):
        self.assertEqual(rules.canvas_asset_url_value("  /assets/a b.png  "), "/assets/a b.png")
        self.assertEqual(
            rules.canvas_asset_url_value({"src": "", "outputUrl": "https://example.test/x.webp"}),
            "https://example.test/x.webp",
        )
        for value in ("/assets/a.png", "/output/a.mp4", "http://example.test/a", "https://example.test/a"):
            self.assertEqual(rules.canvas_asset_downloadable_url(value), value)
        for value in ("blob:https://example.test/x", "data:image/png;base64,abc", "relative.png", ""):
            self.assertEqual(rules.canvas_asset_downloadable_url(value), "")

    def test_kind_prefers_explicit_media_kind_then_url_extension(self):
        self.assertEqual(rules.canvas_asset_kind({"type": "video"}, "/assets/a.png"), "video")
        self.assertEqual(rules.canvas_asset_kind({"mediaKind": "audio"}, "/assets/a.png"), "audio")
        self.assertEqual(rules.canvas_asset_kind({"kind": "text"}, "/assets/a.png"), "text")
        self.assertEqual(rules.canvas_asset_kind({"type": "workflow"}, "/assets/a.png"), "workflow")
        self.assertEqual(rules.canvas_asset_kind({}, "/assets/a.mp4"), "video")
        self.assertEqual(rules.canvas_asset_kind({}, "/assets/a.mp3"), "audio")

    def test_name_rules_keep_safe_filename_and_fallback_behavior(self):
        self.assertEqual(rules.sanitize_asset_name('  a:/b*?c  ', "asset"), "a_b_c")
        self.assertEqual(rules.sanitize_asset_name("", "默认"), "默认")
        self.assertEqual(
            rules.filename_from_media_url(
                "https://example.test/path/%E4%B8%AD%E6%96%87%20a.png?token=secret", "fallback.bin"
            ),
            "中文 a.png",
        )
        self.assertEqual(rules.filename_from_media_url("https://example.test/", "fallback.bin"), "fallback.bin")
        self.assertEqual(rules.sanitize_export_filename("../a:b.png", "fallback"), "a_b.png")
        self.assertEqual(
            rules.canvas_asset_name({"filename": "图像:一.png"}, "/assets/ignored.png", "fallback"),
            "图像_一.png",
        )
        self.assertEqual(
            rules.canvas_asset_name({}, "https://example.test/result.png", "fallback"),
            "result.png",
        )

    def test_recursive_scan_skips_runtime_fields_and_preserves_paths(self):
        node = {
            "input": {"url": "/assets/one.png", "name": "一"},
            "items": ["/output/two.mp4", {"uri": "https://example.test/three.wav"}],
            "prompt": {"url": "/assets/ignored.png"},
            "metadata": {"nested": "/assets/ignored-2.png"},
            "relative": "three.png",
        }
        found = list(rules.iter_canvas_asset_values(node))
        self.assertEqual(
            [(path, url) for path, _raw, url in found],
            [
                ("input", "/assets/one.png"),
                ("input.url", "/assets/one.png"),
                ("items[0]", "/output/two.mp4"),
                ("items[1]", "https://example.test/three.wav"),
                ("items[1].uri", "https://example.test/three.wav"),
            ],
        )


if __name__ == "__main__":
    unittest.main()
