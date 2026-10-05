"""验证请求、追踪和画布任务之间的标识关联。"""

import asyncio
import contextlib
import io
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main
from backend import tracing


class TracingModuleTests(unittest.TestCase):
    def test_invalid_external_ids_are_replaced(self):
        trace_id, request_id = tracing.request_context({
            "X-Trace-ID": "bad value\nwith-newline",
            "X-Request-ID": "also too long " + ("x" * 200),
        })
        self.assertTrue(tracing.IDENTIFIER_RE.fullmatch(trace_id))
        self.assertTrue(tracing.IDENTIFIER_RE.fullmatch(request_id))
        self.assertNotIn("\n", trace_id + request_id)

    def test_context_is_restored_after_binding(self):
        self.assertEqual(tracing.current_trace_id(), "")
        tokens = tracing.bind_context("trace-test", "request-test")
        try:
            self.assertEqual(tracing.format_context(), "trace_id=trace-test request_id=request-test")
        finally:
            tracing.reset_context(tokens)
        self.assertEqual(tracing.current_trace_id(), "")
        self.assertEqual(tracing.current_request_id(), "")


class RequestTracingIntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tasks_patch = patch.object(main, "CANVAS_TASKS", {})
        self.tasks_patch.start()
        self.addCleanup(self.tasks_patch.stop)
        self.task_dir = tempfile.TemporaryDirectory()
        self.task_dir_patch = patch.object(main, "CANVAS_TASK_DIR", self.task_dir.name)
        self.task_dir_patch.start()
        self.addCleanup(self.task_dir_patch.stop)
        self.addCleanup(self.task_dir.cleanup)
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app), base_url="http://trace-test"
        )
        self.addAsyncCleanup(self.client.aclose)

    async def test_response_headers_echo_valid_ids_and_replace_invalid_ids(self):
        response = await self.client.get(
            "/route-that-does-not-exist",
            headers={"X-Trace-ID": "trace-ui-01", "X-Request-ID": "request-ui-01"},
        )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.headers["x-trace-id"], "trace-ui-01")
        self.assertEqual(response.headers["x-request-id"], "request-ui-01")

        invalid = await self.client.get(
            "/route-that-does-not-exist",
            headers={"X-Trace-ID": "bad id with spaces", "X-Request-ID": "bad\nrequest"},
        )
        self.assertEqual(invalid.status_code, 404)
        self.assertNotIn(" ", invalid.headers["x-trace-id"])
        self.assertNotIn("\n", invalid.headers["x-request-id"])
        self.assertNotEqual(invalid.headers["x-trace-id"], "bad id with spaces")

    async def test_validation_error_body_contains_request_context(self):
        response = await self.client.post(
            "/api/canvas-image-tasks",
            headers={"X-Trace-ID": "trace-validation", "X-Request-ID": "request-validation"},
            json={"provider_id": "test-only"},
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["trace_id"], "trace-validation")
        self.assertEqual(response.json()["request_id"], "request-validation")

    async def test_canvas_task_keeps_submission_context(self):
        async def fake_result(payload):
            return {"images": ["/assets/output/trace-test.png"], "prompt": payload.prompt}

        with patch.object(main, "build_online_image_result", side_effect=fake_result):
            response = await self.client.post(
                "/api/canvas-image-tasks",
                headers={"X-Trace-ID": "trace-task", "X-Request-ID": "request-task"},
                json={"prompt": "追踪标识测试", "provider_id": "test-only"},
            )
            self.assertEqual(response.status_code, 200)
            submitted = response.json()
            self.assertEqual(submitted["trace_id"], "trace-task")
            self.assertEqual(submitted["request_id"], "request-task")
            await asyncio.sleep(0)
            task = await self.client.get(f"/api/canvas-image-tasks/{submitted['task_id']}")

        self.assertEqual(task.status_code, 200)
        self.assertEqual(task.json()["trace_id"], "trace-task")
        self.assertEqual(task.json()["request_id"], "request-task")
        self.assertEqual(task.headers["x-trace-id"], tracing.normalize_identifier(task.headers["x-trace-id"]))

    async def test_network_log_includes_current_context_without_secrets(self):
        tokens = tracing.bind_context("trace-net", "request-net")
        output = io.StringIO()
        diagnostics = []
        try:
            with patch.object(main, "write_diagnostic", side_effect=diagnostics.append), contextlib.redirect_stdout(output):
                main.log_net_error(
                    "网络失败 token=fake-token",
                    httpx.ConnectError("connect failed token=fake-token"),
                    "https://example.test/jobs?api_key=fake-key",
                )
        finally:
            tracing.reset_context(tokens)
        self.assertEqual(output.getvalue(), "")
        text = " ".join(diagnostics)
        self.assertIn("trace_id=trace-net request_id=request-net", text)
        self.assertNotIn("fake-token", text)
        self.assertNotIn("fake-key", text)

    async def test_canvas_worker_inherits_submission_context(self):
        output = io.StringIO()
        diagnostics = []

        async def fake_result(_payload):
            main.log_net_error(
                "后台任务失败 token=fake-token",
                httpx.ConnectError("worker token=fake-token"),
                "https://example.test/task?token=fake-token",
            )
            raise RuntimeError("模拟任务失败")

        with patch.object(main, "build_online_image_result", side_effect=fake_result):
            with patch.object(main, "write_diagnostic", side_effect=diagnostics.append), contextlib.redirect_stdout(output):
                response = await self.client.post(
                    "/api/canvas-image-tasks",
                    headers={"X-Trace-ID": "trace-worker", "X-Request-ID": "request-worker"},
                    json={"prompt": "后台上下文测试", "provider_id": "test-only"},
                )
                self.assertEqual(response.status_code, 200)
                await asyncio.sleep(0)

        self.assertEqual(output.getvalue(), "")
        text = " ".join(diagnostics)
        self.assertIn("trace_id=trace-worker request_id=request-worker", text)
        self.assertNotIn("fake-token", text)


if __name__ == "__main__":
    unittest.main()

