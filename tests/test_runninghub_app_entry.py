"""实际HTTP入口接入应用服务；仅在公开代码沙箱导入main。"""
from pathlib import Path
import sys
import unittest
from unittest.mock import AsyncMock, patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main
from backend.runninghub_app_service import RunningHubAppService, RunningHubAppError


class EntryTests(unittest.IsolatedAsyncioTestCase):
    async def test_http_routes_delegate_to_service(self):
        cases = [
            ('GET', '/api/runninghub/app-info?webappId=fixture', None, 'app_info'),
            ('POST', '/api/runninghub/submit', {'webappId': 'fixture'}, 'submit'),
            ('POST', '/api/runninghub/workflow-submit', {'workflowId': 'fixture'}, 'submit_workflow'),
            ('GET', '/api/runninghub/workflow-info?workflowId=fixture', None, 'workflow_info'),
            ('POST', '/api/runninghub/workflows/fetch', {'workflowId': 'fixture'}, 'fetch_workflow'),
            ('GET', '/api/runninghub/query?taskId=fixture', None, 'query'),
            ('POST', '/api/runninghub/upload-asset', {'url': 'https://fixture.test/image.png'}, 'upload_asset'),
        ]
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url='http://local.test') as client:
            for method, url, body, name in cases:
                with self.subTest(name=name), patch.object(RunningHubAppService, name, new_callable=AsyncMock, return_value={'success': True}) as call:
                    response = await client.request(method, url, json=body)
                    self.assertEqual(response.status_code, 200, response.text)
                    call.assert_awaited_once()

    async def test_image_entry_maps_domain_error_to_existing_http_error(self):
        with patch.object(RunningHubAppService, 'generate_image', new_callable=AsyncMock,
                          side_effect=RunningHubAppError(504, 'timeout')) as call:
            with self.assertRaises(main.HTTPException) as caught:
                await main.generate_runninghub_entry_image('p', '1:1', 'app:x', [], {}, {'kind': 'app', 'id': 'x'})
            self.assertEqual((caught.exception.status_code, caught.exception.detail), (504, 'timeout'))
            call.assert_awaited_once()


if __name__ == '__main__':
    unittest.main()
