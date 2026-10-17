"""真实文件保存与助手 HTTP 入口的跨画布文本/中断续行回归。"""

import json
from pathlib import Path
import sys
import tempfile
import unittest
import shutil
import subprocess

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main
from tests.creative_flow_fixture import CreativeFlowFixture


class CreativeFlowRegressionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='creative-flow-regression-')
        self.fixture = CreativeFlowFixture(main, self.directory.name)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=self.fixture.app), base_url='http://test')

    async def asyncTearDown(self):
        await self.client.aclose()
        self.fixture.close()
        self.directory.cleanup()

    async def exercise(self, kind, scenario):
        case = self.fixture.create(kind, scenario)
        cid = case['id']
        created = await self.client.post('/api/canvas-assistant/sessions', json={'canvasId': cid})
        self.assertEqual(created.status_code, 200, created.text)
        sid = created.json()['session']['id']
        body = {'canvasId': cid, 'sessionId': sid, 'requestId': 'flow-turn', 'message': case['message'],
                'provider': 'flow-mock', 'model': 'flow-text', 'skillId': 'auto',
                'expectedUpdatedAt': main.load_canvas(cid)['updated_at']}
        response = await self.client.post('/api/canvas-assistant/chat', json=body)
        self.assertEqual(response.status_code, 200, response.text)
        native_ids = []
        for index in range(1 if scenario == 'text' else 2):
            history = await self.client.get('/api/canvas-assistant/history', params={'canvasId': cid, 'sessionId': sid})
            turn = history.json()['session']['turns'][0]
            proposal = turn['nativeActions'][-1]
            native_ids.append(proposal['id'])
            action = {'canvasId': cid, 'sessionId': sid, 'turnId': 'flow-turn',
                      'actionId': proposal['id'], 'automatic': True}
            confirm = await self.client.post('/api/canvas-assistant/native/action', json={**action, 'action': 'confirm'})
            self.assertEqual(confirm.status_code, 200, confirm.text)
            self.assertTrue(confirm.json()['canExecute'])
            canvas = main.load_canvas(cid)
            canvas['nodes'][0]['text'] = proposal['arguments']['patch']['text']
            saved = await self.client.put(f'/api/canvases/{cid}', json={
                'nodes': canvas['nodes'], 'connections': canvas['connections'],
                'settings': canvas['settings'], 'base_updated_at': canvas['updated_at']})
            self.assertEqual(saved.status_code, 200, saved.text)
            finish = await self.client.post('/api/canvas-assistant/native/action', json={**action, 'action': 'finish'})
            self.assertEqual(finish.status_code, 200, finish.text)
            self.assertEqual(finish.json()['proposal']['state'], 'completed')
            resume = {'canvasId': cid, 'sessionId': sid, 'requestId': 'flow-turn'}
            continued = await self.client.post('/api/canvas-assistant/continue', json=resume)
            if scenario == 'recovery' and index == 0:
                self.assertEqual(continued.status_code, 503)
                self.assertEqual(main.load_canvas(cid)['nodes'][0]['text'], '第一步已保存')
                continued = await self.client.post('/api/canvas-assistant/continue', json=resume)
            self.assertEqual(continued.status_code, 200, continued.text)
        turn = (await self.client.get('/api/canvas-assistant/history', params={'canvasId': cid, 'sessionId': sid})).json()['session']['turns'][0]
        self.assertEqual(turn['state'], 'completed')
        self.assertEqual(len(set(native_ids)), len(native_ids))
        self.assertEqual(len(turn['nativeActions']), 1 if scenario == 'text' else 2)
        reopened = (await self.client.get(f'/api/canvases/{cid}')).json()['canvas']
        self.assertEqual(reopened['nodes'][0]['text'], '第二步已保存' if scenario == 'recovery' else '已整理：女孩走进书店，读到一封旧信。')
        self.assertEqual(len(reopened['nodes']), 1)
        self.assertFalse([c for c in self.fixture.calls if c['kind'] in {'image', 'llm'}])

    async def test_text_edit_is_persisted_on_both_canvases(self):
        for kind in ('classic', 'smart'):
            with self.subTest(kind=kind):
                await self.exercise(kind, 'text')

    async def test_failure_resumes_without_repeating_saved_step_on_both_canvases(self):
        for kind in ('classic', 'smart'):
            with self.subTest(kind=kind):
                await self.exercise(kind, 'recovery')

    async def test_shot_samples_follow_real_frontend_table_contract(self):
        model = Path(main.__file__).parent / 'static/js/canvas-video-deconstruction-model.js'
        for kind in ('classic', 'smart'):
            with self.subTest(kind=kind):
                case = self.fixture.create(kind, 'shot')
                table = next(n for n in main.load_canvas(case['id'])['nodes'] if n['id'] == 'table')
                result = subprocess.run([shutil.which('node'), '-e',
                    'const fs=require("fs");const m=require(process.argv[1]);const d=m.normalizeTable(JSON.parse(fs.readFileSync(0,"utf8")));if(d.rows.length!==2)process.exit(1);',
                    str(model)], input=json.dumps(table['shotTableData']), capture_output=True,
                    encoding='utf-8', check=False, timeout=30)
                self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__':
    unittest.main()
