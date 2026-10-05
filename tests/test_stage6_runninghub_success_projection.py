"""RunningHub 应用成功回包只公开画布需要的参数，不透传调试整包。"""

import json
import pathlib
import sys
import unittest
from unittest.mock import patch

import httpx

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import main


SECRET = "fake-runninghub-private-token-321"


class RunningHubSuccessProjectionTests(unittest.IsolatedAsyncioTestCase):
    async def test_app_info_keeps_fields_and_hides_upstream_debug(self):
        raw = {
            "code": 0,
            "data": {
                "nodeInfoList": [
                    {
                        "nodeId": "12",
                        "fieldName": "prompt",
                        "fieldValue": "一只猫",
                        "fieldType": "TEXT",
                        "options": [{"value": "square", "label": "方形", "debugInfo": SECRET, "clientSecret": SECRET}],
                        "debug": {"request": SECRET},
                        "apiKey": SECRET,
                    },
                    {"nodeId": "14", "fieldName": "caption", "fieldValue": f"token={SECRET}"},
                    {"nodeId": "15", "fieldName": "note", "fieldValue": f"private upstream echo: {SECRET}"},
                    {"nodeId": "13", "fieldName": "apiKey", "fieldValue": SECRET},
                    {"nodeId": "19", "fieldName": "APIKey", "fieldValue": SECRET},
                    {"nodeId": "16", "fieldName": "clientSecret", "fieldValue": SECRET},
                    {"nodeId": "17", "fieldName": "sessionKey", "fieldValue": SECRET},
                    {"nodeId": "18", "fieldName": "authToken", "fieldValue": SECRET},
                ],
                "debug": {"apiKey": SECRET},
                "debugInfo": {"sessionKey": SECRET},
                "request": {"url": f"https://upstream.test?token={SECRET}"},
                "userInfo": {"credential": SECRET},
            },
        }
        client_type = httpx.AsyncClient

        def client_factory(*_args, **kwargs):
            transport = httpx.MockTransport(lambda _request: httpx.Response(200, json=raw))
            return client_type(transport=transport, timeout=kwargs.get("timeout"))

        with patch.object(main, "runninghub_provider", return_value={"id": "runninghub"}), patch.object(
            main, "runninghub_api_key", return_value=SECRET
        ), patch.object(main, "runninghub_endpoint_url", side_effect=lambda _provider, path: f"https://runninghub.test{path}"), patch.object(
            main, "runninghub_app_headers", return_value={}
        ), patch.object(main.httpx, "AsyncClient", side_effect=client_factory):
            result = await main.runninghub_app_info(webappId="app-123")

        self.assertTrue(result["success"])
        self.assertEqual(set(result["data"]), {"nodeInfoList"})
        self.assertEqual(len(result["data"]["nodeInfoList"]), 3)
        field = result["data"]["nodeInfoList"][0]
        self.assertEqual(field["fieldName"], "prompt")
        self.assertEqual(field["fieldValue"], "一只猫")
        self.assertEqual(field["options"][0], {"value": "square", "label": "方形"})
        self.assertEqual(result["data"]["nodeInfoList"][1]["fieldValue"], "token=<redacted>")
        self.assertEqual(result["data"]["nodeInfoList"][2]["fieldValue"], "private upstream echo: <redacted>")
        self.assertNotIn(SECRET, json.dumps(result, ensure_ascii=False))
        self.assertNotIn("debug", json.dumps(result, ensure_ascii=False))

    def test_alternate_app_field_shape_still_supports_editor_and_canvas(self):
        result = main.public_runninghub_app_info({
            "webapp": {"inputs": {"prompt": "中文提示词", "size": "1024x1024"}},
            "debug": {"token": SECRET},
        })
        self.assertEqual(result["nodeInfoList"], [
            {"fieldName": "prompt", "fieldValue": "中文提示词"},
            {"fieldName": "size", "fieldValue": "1024x1024"},
        ])

    def test_camel_case_private_keys_are_recursively_filtered(self):
        self.assertEqual(main.public_runninghub_app_info({
            "nodeInfoList": [{
                "fieldName": "prompt",
                "fieldValue": {"text": "保留参数", "authToken": SECRET, "sessionKey": SECRET},
                "fieldData": [{"value": "safe", "debugInfo": SECRET, "clientSecret": SECRET}],
            }],
        }), {"nodeInfoList": [{
            "fieldName": "prompt",
            "fieldValue": {"text": "保留参数"},
            "fieldData": [{"value": "safe"}],
        }]})


if __name__ == "__main__":
    unittest.main()
