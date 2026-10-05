"""ModelScope 任务进度只写入受控诊断摘要，不直接打印上游标识。"""

import pathlib
import sys
import unittest
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import HTTPException

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import main


class FakeClient:
    def __init__(self, submitted=None, polled=None):
        self.submitted = submitted
        self.polled = polled

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def post(self, *args, **kwargs):
        return self.submitted

    async def get(self, *args, **kwargs):
        return self.polled


class ModelScopeDiagnosticLoggingTests(unittest.IsolatedAsyncioTestCase):
    async def test_modelscope_task_progress_uses_redacted_diagnostic_records(self):
        submitted = httpx.Response(
            200,
            json={"task_id": "task?token=top-secret"},
            request=httpx.Request("POST", "https://provider.test/v1/images/generations"),
        )
        failed = httpx.Response(200, json={
            "task_status": "FAILED",
            "error_info": "invalid parameter",
        }, request=httpx.Request("GET", "https://provider.test/v1/tasks/task"))
        calls = []

        def capture(message, *args, **kwargs):
            calls.append(str(message))

        entries = (
            lambda: main.poll_angle_cloud(
                main.CloudPollRequest(task_id="resume?token=top-secret", api_key="fake-token")
            ),
            lambda: main.generate_angle_cloud(main.CloudGenRequest(prompt="a cat")),
            lambda: main.generate_cloud(main.CloudGenRequest(prompt="a cat")),
            lambda: main.ms_generate(main.MsGenerateRequest(prompt="a cat", model="model")),
        )
        with patch.object(main, "modelscope_api_key", return_value="fake-token"), patch.object(
            main, "modelscope_image_api_root", return_value="https://provider.test/v1"
        ), patch.object(main.httpx, "AsyncClient", return_value=FakeClient(submitted, failed)), patch.object(
            main.asyncio, "sleep", new=AsyncMock()
        ), patch.object(main, "write_diagnostic", side_effect=capture):
            for entry in entries:
                with self.subTest(entry=entry):
                    with self.assertRaises(HTTPException):
                        await entry()

        text = "\n".join(calls)
        self.assertIn("ModelScope 角度任务恢复轮询", text)
        self.assertIn("ModelScope 角度任务已提交", text)
        self.assertIn("ModelScope Z-Image 任务已提交", text)
        self.assertIn("ModelScope 通用生图任务已提交", text)
        self.assertIn("ModelScope Z-Image 任务轮询", text)
        self.assertIn("ModelScope 通用生图任务轮询", text)
        self.assertNotIn("top-secret", text)

    async def test_modelscope_download_failure_is_redacted_and_diagnostic_only(self):
        submitted = httpx.Response(
            200,
            json={"task_id": "task-1"},
            request=httpx.Request("POST", "https://provider.test/v1/images/generations"),
        )
        completed = httpx.Response(200, json={
            "task_status": "SUCCEED",
            "output_images": ["https://provider.test/image.png?token=top-secret"],
        }, request=httpx.Request("GET", "https://provider.test/v1/tasks/task-1"))
        calls = []

        class DownloadFailureClient(FakeClient):
            def __init__(self):
                super().__init__(submitted, completed)
                self.get_count = 0

            async def get(self, *args, **kwargs):
                self.get_count += 1
                if self.get_count == 1:
                    return self.polled
                raise httpx.ConnectError(
                    "download failed https://provider.test/image.png?token=top-secret"
                )

        with patch.object(main, "modelscope_api_key", return_value="fake-token"), patch.object(
            main, "modelscope_image_api_root", return_value="https://provider.test/v1"
        ), patch.object(main.httpx, "AsyncClient", return_value=DownloadFailureClient()), patch.object(
            main.asyncio, "sleep", new=AsyncMock()
        ), patch.object(main, "write_diagnostic", side_effect=lambda message, *a, **k: calls.append(str(message))), patch.object(
            main, "save_to_history"
        ), patch.object(main, "output_path_for", return_value=str(pathlib.Path.cwd() / "output" / "stage6-test.png")), patch.object(
            main, "output_url_for", return_value="/output/stage6-test.png"
        ), patch.object(main.manager, "broadcast_new_image", new=AsyncMock()):
            result = await main.generate_cloud(main.CloudGenRequest(prompt="a cat"))

        self.assertEqual(result["url"], "https://provider.test/image.png?token=top-secret")
        text = "\n".join(calls)
        self.assertIn("ModelScope 图片下载失败", text)
        self.assertNotIn("top-secret", text)


if __name__ == "__main__":
    unittest.main()
