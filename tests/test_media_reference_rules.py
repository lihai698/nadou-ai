"""素材删除前的引用匹配规则；只使用自制值和显式路径解析器。"""

import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main
from backend import media_reference_rules as rules


class MediaReferenceRuleTests(unittest.TestCase):
    def test_local_url_collection_keeps_order_and_skips_remote_values(self):
        value = {
            "first": " /assets/a.png ",
            "nested": ["https://example.test/b.png", "/api/storage-files/generated/c.mp4?x=1"],
            "tuple": ("/output/d.wav", "relative.txt"),
        }
        self.assertEqual(
            rules.collect_local_media_urls(value),
            ["/assets/a.png", "/api/storage-files/generated/c.mp4?x=1", "/output/d.wav"],
        )
        self.assertIs(main.collect_local_media_urls, rules.collect_local_media_urls)

    def test_reference_match_uses_explicit_resolver_and_normalized_paths(self):
        target = os.path.abspath("C:/temp/media/result.png")
        aliases = {
            "/assets/result.png": target,
            "/output/result.png": os.path.join(os.path.dirname(target), ".", "result.png"),
        }

        def resolve(value):
            return aliases.get(value)

        self.assertTrue(rules.json_value_references_media_path(
            {"nodes": [{"url": "/assets/result.png"}]}, target, resolve
        ))
        self.assertTrue(rules.json_value_references_media_path(
            ["ignore", ("/output/result.png",)], target, resolve
        ))
        self.assertFalse(rules.json_value_references_media_path(
            {"url": "/assets/other.png"}, target, resolve
        ))
        self.assertFalse(rules.json_value_references_media_path(
            {"url": "/assets/result.png"}, target, lambda _value: (_ for _ in ()).throw(OSError("self-made"))
        ))

    def test_main_compatibility_wrapper_passes_application_resolver(self):
        target = os.path.abspath("C:/temp/media/result.png")
        with patch.object(main, "local_media_path_from_url", return_value=target) as resolver:
            self.assertTrue(main.json_references_media_path({"url": "/assets/result.png"}, target))
            resolver.assert_called_once_with("/assets/result.png")


if __name__ == "__main__":
    unittest.main()
