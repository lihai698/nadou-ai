"""验证阶段 6 的参考素材、工作流解析和 ComfyUI 错误边界。"""

import json
import pathlib
import sys
import unittest
from unittest.mock import patch

import httpx

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import main


SECRET = "stage6-error-private-token-456"
PRIVATE_PATH = r"C:\Users\PrivateUser\AppData\Local\private-workflow.json"


class Stage6ErrorBoundaryTests(unittest.IsolatedAsyncioTestCase):
    def assert_private_absent(self, value):
        rendered = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
        self.assertNotIn(SECRET, rendered)
        self.assertNotIn("PrivateUser", rendered)

    async def test_reference_media_errors_do_not_echo_paths(self):
        with self.assertRaises(main.HTTPException) as caught:
            await main.codex_prepare_local_media(PRIVATE_PATH)
        self.assertEqual(caught.exception.status_code, 400)
        self.assert_private_absent(caught.exception.detail)

        with self.assertRaises(main.HTTPException) as caught:
            await main.jimeng_prepare_local_media(PRIVATE_PATH)
        self.assertEqual(caught.exception.status_code, 400)
        self.assert_private_absent(caught.exception.detail)

        with patch.object(main, "output_file_from_url", return_value=""):
            with self.assertRaises(main.HTTPException) as caught:
                await main.codex_prepare_local_media("/assets/input/private-workflow.json")
        self.assert_private_absent(caught.exception.detail)

    async def test_runninghub_workflow_parse_errors_are_position_only(self):
        malformed = '{"private": '
        client_type = httpx.AsyncClient

        def client_factory(*_args, **kwargs):
            transport = httpx.MockTransport(
                lambda _request: httpx.Response(
                    200,
                    json={"code": 0, "data": {"prompt": malformed}},
                )
            )
            return client_type(transport=transport, timeout=kwargs.get("timeout"))

        patches = [
            patch.object(main, "runninghub_provider", return_value={"id": "runninghub"}),
            patch.object(main, "runninghub_api_key", return_value="test-key"),
            patch.object(main, "runninghub_endpoint_url", side_effect=lambda _provider, path: f"https://runninghub.test{path}"),
            patch.object(main, "runninghub_app_headers", return_value={}),
            patch.object(main.httpx, "AsyncClient", side_effect=client_factory),
        ]
        with patches[0], patches[1], patches[2], patches[3], patches[4]:
            with self.assertRaises(main.HTTPException) as caught:
                await main.runninghub_workflow_info(workflowId="wf-safe")
        self.assertEqual(caught.exception.status_code, 502)
        self.assertIn("第 1 行", caught.exception.detail)
        self.assert_private_absent(caught.exception.detail)

    def test_comfyui_error_response_redacts_internal_details(self):
        with patch.object(
            main,
            "reserve_best_backend",
            side_effect=RuntimeError(f"读取 {PRIVATE_PATH} 失败 token={SECRET}"),
        ):
            result = main.generate(main.GenerateRequest(workflow_json="private-workflow.json"))
        self.assertEqual(result["images"], [])
        self.assert_private_absent(result["error"])

        detail = main.comfy_prompt_error_message(
            400,
            json.dumps({"error": {"message": f"bad path={PRIVATE_PATH} token={SECRET}"}}),
        )
        self.assert_private_absent(detail)

        generic = main.public_error_detail(
            {"message": f"上传失败 path={PRIVATE_PATH} token={SECRET}"},
            fallback="上传失败",
        )
        self.assert_private_absent(generic)
        preview = main.invalid_video_image_preview(
            f"https://provider.test/reference.png?token={SECRET}"
        )
        self.assert_private_absent(preview)


if __name__ == "__main__":
    unittest.main()
