"""图片生成供应商分发优先级回归测试。"""

import unittest

from backend.image_generation_dispatch import (
    ImageGenerationDispatchContext,
    resolve_image_generation_dispatch,
)


def context(**overrides):
    names = (
        "is_codex", "is_gemini_cli", "is_jimeng", "is_runninghub",
        "is_gemini_protocol", "is_volcengine", "is_tudou_async", "is_tudou_grok",
    )
    return ImageGenerationDispatchContext(**{
        name: (lambda value=overrides.get(name, False): value) for name in names
    })


class ImageGenerationDispatchTests(unittest.TestCase):
    def test_special_provider_precedence_is_stable(self):
        result = resolve_image_generation_dispatch(
            {"id": "modelscope"}, "model-a", context(is_codex=True)
        )
        self.assertEqual(result.route, "modelscope")
        self.assertEqual(result.model, "model-a")
        self.assertEqual(
            resolve_image_generation_dispatch(
                {"id": "custom"}, "model-b",
                context(is_runninghub=True, is_gemini_protocol=True, is_tudou_async=True),
            ).route,
            "runninghub",
        )

    def test_protocol_and_tudou_fallback_order(self):
        self.assertEqual(
            resolve_image_generation_dispatch(
                {"id": "custom"}, "image-model", context(is_gemini_protocol=True, is_volcengine=True)
            ).route,
            "gemini",
        )
        self.assertEqual(
            resolve_image_generation_dispatch(
                {"id": "tudou"}, "gpt-image-2-async",
                context(is_tudou_async=True, is_tudou_grok=True),
            ).route,
            "tudou-async",
        )
        self.assertEqual(
            resolve_image_generation_dispatch(
                {"id": "tudou"}, "grok-imagine-image", context(is_tudou_grok=True)
            ).route,
            "tudou-grok",
        )

    def test_unused_predicates_are_not_evaluated(self):
        def unexpected():
            raise AssertionError("不应检查后续协议")

        checks = context(is_runninghub=True)
        object.__setattr__(checks, "is_gemini_protocol", unexpected)
        result = resolve_image_generation_dispatch({"id": "runninghub"}, "model", checks)
        self.assertEqual(result.route, "runninghub")

    def test_unknown_provider_uses_generic_openai_route(self):
        result = resolve_image_generation_dispatch(
            {"id": "custom"}, "image-model", context()
        )
        self.assertEqual(result.route, "openai")


if __name__ == "__main__":
    unittest.main()
