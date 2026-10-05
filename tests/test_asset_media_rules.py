"""素材识别规则保持原有优先级和回退行为。"""

import base64
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main
from backend import asset_media_rules as rules


class AssetMediaRulesTests(unittest.TestCase):
    def test_main_uses_the_extracted_rules(self):
        for name in rules.__all__:
            self.assertIs(getattr(main, name), getattr(rules, name))

    def test_library_kind_prioritizes_workflow_suffix_and_media_types(self):
        self.assertEqual(rules.asset_library_media_kind("设计.JSON", "video/mp4"), "workflow")
        self.assertEqual(rules.asset_library_media_kind("demo.mp4", "audio/mpeg"), "video")
        self.assertEqual(rules.asset_library_media_kind("voice.mp3", "video/mp4"), "video")
        self.assertEqual(rules.asset_library_media_kind("unknown", "audio/wav"), "audio")
        self.assertEqual(rules.asset_library_media_kind("unknown.bin"), "image")

    def test_library_extension_keeps_allowed_format_or_uses_kind_default(self):
        self.assertEqual(rules.asset_library_safe_extension("clip.MKV", "video"), ".mkv")
        self.assertEqual(rules.asset_library_safe_extension("clip.flv", "video"), ".mp4")
        self.assertEqual(rules.asset_library_safe_extension("audio.png", "audio"), ".mp3")
        self.assertEqual(rules.asset_library_safe_extension("flow", "workflow"), ".zip")
        self.assertEqual(rules.asset_library_safe_extension("unknown", "other"), ".png")

    def test_upload_kind_prefers_video_then_audio_then_image(self):
        self.assertEqual(rules._local_upload_kind_ext("clip.FLv", "audio/wav"), ("video", ".flv"))
        self.assertEqual(rules._local_upload_kind_ext("voice.mp3", "image/jpeg"), ("audio", ".mp3"))
        self.assertEqual(rules._local_upload_kind_ext("image.webp", "video/webm"), ("video", ".webm"))
        self.assertEqual(rules._local_upload_kind_ext("odd.bin", "image/jpeg"), ("image", ".jpg"))
        self.assertEqual(rules._local_upload_kind_ext("odd.MKV", ""), (None, ".mkv"))

    def test_upload_display_name_strips_only_generated_lowercase_prefix(self):
        self.assertEqual(rules._local_upload_display_name(
            "folder/up_012345abcdef_中文素材.png"), "中文素材.png")
        self.assertEqual(rules._local_upload_display_name(
            "up_012345ABCDEf_原名.png"), "up_012345ABCDEf_原名.png")
        self.assertEqual(rules._local_upload_display_name("普通素材.png"), "普通素材.png")

    def test_image_header_recognizes_known_formats_and_unknown(self):
        self.assertEqual(rules._sniff_image_ext_bytes(b"\x89PNG\r\n\x1a\nrest"), ".png")
        self.assertEqual(rules._sniff_image_ext_bytes(b"\xff\xd8\xffrest"), ".jpg")
        self.assertEqual(rules._sniff_image_ext_bytes(b"RIFF\x00\x00\x00\x00WEBPrest"), ".webp")
        self.assertIsNone(rules._sniff_image_ext_bytes(b"RIFF\x00\x00\x00\x00WAVErest"))
        self.assertIsNone(rules._sniff_image_ext_bytes(b""))


class AssetMediaRouteTests(unittest.IsolatedAsyncioTestCase):
    async def test_inline_import_uses_real_webp_header_and_display_name(self):
        content = b"RIFF\x00\x00\x00\x00WEBPrest"
        with tempfile.TemporaryDirectory(prefix="asset-media-rules-") as temp:
            with patch.object(main, "LOCAL_UPLOAD_DIR", temp):
                async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=main.app),
                    base_url="http://asset-media-rules.test",
                ) as client:
                    response = await client.post("/api/local-assets/import-urls", json={
                        "items": [{
                            "url": "https://example.test/old.png",
                            "name": "中文素材.png",
                            "data": base64.b64encode(content).decode("ascii"),
                            "content_type": "image/png",
                        }],
                        "classify": False,
                    })
                self.assertEqual(response.status_code, 200, response.text)
                payload = response.json()
                self.assertEqual(payload["count"], 1)
                item = payload["files"][0]
                self.assertEqual(item["name"], "中文素材.webp")
                self.assertEqual(item["kind"], "image")
                self.assertEqual(Path(temp, item["file"]).read_bytes(), content)


if __name__ == "__main__":
    unittest.main()
