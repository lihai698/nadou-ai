"""主入口委托合同；由 check-core 在公开代码沙箱运行。"""
from pathlib import Path
import sys
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main
from backend.runninghub_openapi import RunningHubOpenAPIAdapter, RunningHubOpenAPIError


class EntryTests(unittest.IsolatedAsyncioTestCase):
    async def test_image_entry_delegates_standard_api(self):
        result = ({'type': 'url', 'value': '/output/image.png'}, {})
        with patch.object(main, 'runninghub_entry_config_from_model', return_value=None), \
             patch.object(RunningHubOpenAPIAdapter, 'generate_image', new_callable=AsyncMock, return_value=result) as generate:
            self.assertEqual(await main.generate_runninghub_provider_image('p', '1:1', 'm', [], {}), result)
            generate.assert_awaited_once_with('p', '1:1', 'm', [], {}, on_remote_accept=None)

    async def test_workflow_entry_keeps_original_dispatch(self):
        entry = {'entry': 'test'}
        with patch.object(main, 'runninghub_entry_config_from_model', return_value=entry), \
             patch.object(main, 'generate_runninghub_entry_image', new_callable=AsyncMock, return_value='workflow') as workflow, \
             patch.object(RunningHubOpenAPIAdapter, 'generate_image', new_callable=AsyncMock) as standard:
            self.assertEqual(await main.generate_runninghub_provider_image('p', '1:1', 'm', [], {}), 'workflow')
            workflow.assert_awaited_once_with('p', '1:1', 'm', [], {}, entry, on_remote_accept=None)
            standard.assert_not_called()

    async def test_video_entry_delegates_and_preserves_http_error(self):
        payload, provider = object(), {}
        with patch.object(RunningHubOpenAPIAdapter, 'generate_video', new_callable=AsyncMock,
                          side_effect=RunningHubOpenAPIError(400, 'required reference')) as generate:
            with self.assertRaises(main.HTTPException) as caught:
                await main.generate_runninghub_video(payload, provider)
            self.assertEqual((caught.exception.status_code, caught.exception.detail), (400, 'required reference'))
            generate.assert_awaited_once_with(payload, provider, on_remote_accept=None)


if __name__ == '__main__':
    unittest.main()
