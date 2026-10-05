"""本机模拟火山资产、RunningHub 模型注册表和即梦 CLI 的失败出口。"""

import json
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

import httpx

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import main


SECRET = "fake-private-token-456"
PRIVATE_URL = f"https://provider.test/login?token={SECRET}"
ERROR_BODY = {"error": {"message": "gateway unavailable", "debug": SECRET}, "raw": {"url": PRIVATE_URL}}


class Stage6ProviderErrorExitsTests(unittest.IsolatedAsyncioTestCase):
    def assert_private_absent(self, value):
        rendered = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
        self.assertNotIn(SECRET, rendered)
        self.assertNotIn(PRIVATE_URL, rendered)
        self.assertNotIn('"debug"', rendered)

    async def run_with_transport(self, handler, operation):
        client_type = httpx.AsyncClient
        transport = httpx.MockTransport(handler)

        def client_factory(*_args, **kwargs):
            return client_type(transport=transport, timeout=kwargs.get("timeout"))

        with patch.object(main.httpx, "AsyncClient", side_effect=client_factory):
            return await operation()

    async def test_volcengine_asset_errors_exclude_body_and_keep_success_result(self):
        client = type("Client", (), {"post": AsyncMock()})()
        with patch.object(main, "volcengine_access_key_value", return_value="fake-ak"), patch.object(
            main, "volcengine_secret_key_value", return_value="fake-sk"
        ), patch.object(main, "volcengine_sign_v4_headers", return_value={}):
            client.post.return_value = httpx.Response(502, text=f"<html><body>{SECRET}</body></html>")
            with self.assertRaises(main.HTTPException) as caught:
                await main.volcengine_ark_asset_call(client, "CreateAsset", {})
            self.assertIn("非 JSON", caught.exception.detail)
            self.assert_private_absent(caught.exception.detail)

            client.post.return_value = httpx.Response(200, json={
                "ResponseMetadata": {"Error": {"Code": "QuotaExceeded", "Message": f"quota token={SECRET}"}},
                "debug": SECRET,
            })
            with self.assertRaises(main.HTTPException) as caught:
                await main.volcengine_ark_asset_call(client, "CreateAsset", {})
            self.assertIn("QuotaExceeded", caught.exception.detail)
            self.assert_private_absent(caught.exception.detail)

            client.post.return_value = httpx.Response(503, json=ERROR_BODY)
            with self.assertRaises(main.HTTPException) as caught:
                await main.volcengine_ark_asset_call(client, "CreateAsset", {})
            self.assertIn("gateway unavailable", caught.exception.detail)
            self.assert_private_absent(caught.exception.detail)

            client.post.return_value = httpx.Response(200, json={"Result": {"Id": "asset-123"}})
            self.assertEqual(await main.volcengine_ark_asset_call(client, "CreateAsset", {}), {"Id": "asset-123"})

    async def test_runninghub_registry_meta_and_exception_hide_url_and_raw(self):
        def handler(_request):
            return httpx.Response(502, json=ERROR_BODY)

        with tempfile.TemporaryDirectory() as directory, patch.object(
            main, "runninghub_api_headers", return_value={}
        ), patch.object(main, "runninghub_openapi_url", return_value=f"https://openapi.test/models?token={SECRET}"), patch.object(
            main, "RUNNINGHUB_MODEL_REGISTRY_URL", f"https://github.test/models?token={SECRET}"
        ), patch.object(main, "RUNNINGHUB_LLM_MODELS_URLS", [f"https://llm.test/v1/models?token={SECRET}"]), patch.object(
            main, "STATIC_RUNNINGHUB_MODEL_REGISTRY_FILE", str(pathlib.Path(directory) / "missing.json")
        ):
            items, meta = await self.run_with_transport(
                handler, lambda: main.fetch_runninghub_model_registry(include_fallback=True, include_meta=True)
            )
            self.assertTrue(items)
            self.assertEqual(meta["source"], "fallback")
            self.assertEqual(len(meta["errors"]), 3)
            self.assertIn("gateway unavailable", json.dumps(meta["errors"]))
            self.assert_private_absent(meta)

            with self.assertRaises(main.HTTPException) as caught:
                await self.run_with_transport(
                    handler, lambda: main.fetch_runninghub_model_registry(include_fallback=False)
                )
            self.assert_private_absent(caught.exception.detail)

    async def test_runninghub_llm_success_source_omits_query_credentials(self):
        with patch.object(main, "runninghub_api_headers", return_value={}), patch.object(
            main, "RUNNINGHUB_LLM_MODELS_URLS", [f"https://llm.test/v1/models?token={SECRET}"]
        ):
            items, meta = await self.run_with_transport(
                lambda _request: httpx.Response(200, json={"data": [{"id": "gpt-5.5"}]}),
                main.fetch_runninghub_llm_models,
            )
        self.assertEqual(items[0]["name_en"], "gpt-5.5")
        self.assertEqual(meta["source"], "https://llm.test/v1/models")
        self.assert_private_absent(meta)

    async def test_runninghub_submit_and_query_omit_success_raw(self):
        responses = iter([
            httpx.Response(200, json={"code": 0, "data": {"taskId": "task-safe"}, "debug": SECRET}),
            httpx.Response(200, json={"code": 804, "data": {}, "debug": SECRET}),
        ])

        def handler(_request):
            return next(responses)

        provider = {"id": "runninghub", "base_url": "https://runninghub.test"}
        with patch.object(main, "runninghub_provider", return_value=provider), patch.object(
            main, "runninghub_api_key", return_value="fake-key"
        ), patch.object(main, "runninghub_endpoint_url", side_effect=lambda _provider, path: f"https://runninghub.test{path}"), patch.object(
            main, "runninghub_app_headers", return_value={}
        ):
            submitted = await self.run_with_transport(
                handler,
                lambda: main.runninghub_submit(main.RunningHubSubmitRequest(webappId="app-safe", nodeInfoList=[])),
            )
            queried = await self.run_with_transport(handler, lambda: main.runninghub_query("task-safe"))

        self.assertEqual(submitted["data"], {"taskId": "task-safe"})
        self.assertNotIn("raw", submitted["data"])
        self.assertNotIn("raw", queried["data"])
        self.assert_private_absent(submitted)
        self.assert_private_absent(queried)

    async def test_runninghub_workflow_fetch_returns_parsed_fields_without_raw(self):
        response = httpx.Response(
            200,
            json={
                "code": 0,
                "data": {"prompt": '{"node-1": {"inputs": {"text": "demo"}}}'},
                "debug": SECRET,
            },
        )
        provider = {"id": "runninghub", "base_url": "https://runninghub.test"}
        with patch.object(main, "runninghub_provider", return_value=provider), patch.object(
            main, "runninghub_api_key", return_value="fake-key"
        ), patch.object(main, "runninghub_endpoint_url", side_effect=lambda _provider, path: f"https://runninghub.test{path}"), patch.object(
            main, "runninghub_app_headers", return_value={}
        ):
            result = await self.run_with_transport(
                lambda _request: response,
                lambda: main.fetch_runninghub_workflow(main.RunningHubWorkflowConfig(workflowId="wf-safe")),
            )

        self.assertIn("workflowJson", result["data"])
        self.assertNotIn("raw", result["data"])
        self.assert_private_absent(result)

    async def test_jimeng_failed_and_missing_media_do_not_serialize_raw(self):
        raw = {
            "gen_status": "failed",
            "fail_reason": f"invalid param token={SECRET} at {PRIVATE_URL}",
            "debug": SECRET,
        }
        with self.assertRaises(main.HTTPException) as caught:
            await main.jimeng_store_outputs(raw, allow_query=False)
        self.assertIn("invalid param", caught.exception.detail)
        self.assert_private_absent(caught.exception.detail)

        with self.assertRaises(main.HTTPException) as caught:
            await main.jimeng_store_outputs({"debug": SECRET}, allow_query=False)
        self.assertIn("未返回可用媒体结果", caught.exception.detail)
        self.assert_private_absent(caught.exception.detail)

        with patch.object(main, "jimeng_query_result", new=AsyncMock(return_value={"debug": SECRET})):
            with self.assertRaises(main.HTTPException) as caught:
                await main.jimeng_store_outputs({"submit_id": "safe-task"}, allow_query=True)
        self.assertIn("没有下载到媒体", caught.exception.detail)
        self.assert_private_absent(caught.exception.detail)

    async def test_jimeng_cli_nonzero_exit_returns_bounded_safe_reason(self):
        process = type("Process", (), {"returncode": 1, "communicate": AsyncMock(return_value=(b"", f"invalid param token={SECRET} {PRIVATE_URL}".encode()))})()
        with patch.object(main, "jimeng_cli_executable", return_value="dreamina"), patch.object(
            main, "jimeng_command", return_value=["dreamina", "query_result"]
        ), patch.object(main.asyncio, "create_subprocess_exec", new=AsyncMock(return_value=process)):
            with self.assertRaises(main.HTTPException) as caught:
                await main.run_jimeng_cli(["query_result"])
        self.assertEqual(caught.exception.status_code, 502)
        self.assertIn("invalid param", caught.exception.detail)
        self.assert_private_absent(caught.exception.detail)


if __name__ == "__main__":
    unittest.main()
