"""阶段 12：扩展合同、停用边界和内置媒体识别示例。"""

import base64
import asyncio
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main
from backend.extensions import ExtensionDescriptor, ExtensionRegistry
from backend.local_media_extension import LOCAL_MEDIA_EXTENSION


class ExtensionRegistryTests(unittest.TestCase):
    def test_descriptor_and_result_contract(self):
        registry = ExtensionRegistry((LOCAL_MEDIA_EXTENSION,))
        listed = registry.public_descriptors()
        self.assertEqual(listed[0]["id"], "local-media-metadata")
        self.assertEqual(listed[0]["version"], "1.0.0")
        self.assertEqual(listed[0]["license"], "MIT")
        result = registry.run(
            "local-media-metadata",
            {"filename": "up_0123456789ab_photo.png", "content_type": "image/png", "head": b"\x89PNG\r\n\x1a\n"},
        )
        self.assertEqual(result.public()["status"], "succeeded")
        self.assertEqual(result.public()["output"]["kind"], "image")
        self.assertEqual(result.public()["output"]["detected_extension"], ".png")

    def test_disable_and_missing_dependency_are_explicit(self):
        registry = ExtensionRegistry((LOCAL_MEDIA_EXTENSION,))
        registry.disable("local-media-metadata")
        self.assertEqual(registry.run("local-media-metadata", {}).public()["status"], "disabled")
        missing = ExtensionDescriptor(
            id="missing-dependency",
            name="缺少依赖示例",
            version="1.0.0",
            license="MIT",
            source="isolated test",
            input_schema={},
            output_schema={},
            dependencies=("package_that_does_not_exist_9f6b",),
        )
        registry = ExtensionRegistry((missing,))
        self.assertEqual(registry.public_descriptors()[0]["missing_dependencies"], list(missing.dependencies))
        self.assertEqual(registry.run(missing.id, {}).public()["status"], "unavailable")

    def test_invalid_input_has_controlled_error(self):
        registry = ExtensionRegistry((LOCAL_MEDIA_EXTENSION,))
        result = registry.run("local-media-metadata", {"filename": "x.unsupported"})
        self.assertEqual(result.public()["status"], "failed")
        self.assertNotIn("x.unsupported", result.public().get("error", ""))


class ExtensionHttpTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app), base_url="http://test"
        )
        self.addAsyncCleanup(self.client.aclose)

    async def test_list_and_run_extension_route(self):
        listed = await self.client.get("/api/extensions")
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertEqual(listed.json()["extensions"][0]["id"], "local-media-metadata")
        ran = await self.client.post(
            "/api/extensions/local-media-metadata/run",
            json={
                "filename": "demo.jpg",
                "content_type": "image/jpeg",
                "head_base64": base64.b64encode(b"\xff\xd8\xff").decode("ascii"),
            },
        )
        self.assertEqual(ran.status_code, 200, ran.text)
        self.assertEqual(ran.json()["status"], "succeeded")
        self.assertEqual(ran.json()["output"]["detected_extension"], ".jpg")

    async def test_invalid_head_and_unknown_extension_are_safe(self):
        invalid = await self.client.post(
            "/api/extensions/local-media-metadata/run",
            json={"filename": "demo.png", "head_base64": "%%%"},
        )
        self.assertEqual(invalid.status_code, 422)
        unknown = await self.client.post(
            "/api/extensions/unknown/run",
            json={"filename": "demo.png"},
        )
        self.assertEqual(unknown.status_code, 200)
        self.assertEqual(unknown.json()["status"], "failed")


if __name__ == "__main__":
    unittest.main()
