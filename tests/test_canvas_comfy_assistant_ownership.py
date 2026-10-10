import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import httpx
import main


class ComfyOwnershipTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        for name,value in [('CANVAS_TASK_DIR',self.temp.name),('CANVAS_TASKS',{})]:
            p=patch.object(main,name,value);p.start();self.addCleanup(p.stop)
        self.client=httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app),base_url='http://isolated');self.addAsyncCleanup(self.client.aclose)
        self.body={'prompt':'private prompt','workflow_json':'public-workflow.json','params':{'129':{'noise_seed':12}},'assistant_action_id':'action','canvas_id':'canvas','node_id':'node','input_hash':'a'*64,'segment_id':'seg2'}

    async def test_assistant_binding_is_persisted_without_prompt_or_private_hash(self):
        with patch.object(main,'generate',return_value={'videos':['/output/mock.mp4']}) as generator:
            response=await self.client.post('/api/canvas-comfy-tasks',json=self.body);self.assertEqual(response.status_code,200,response.text)
            task_id=response.json()['task_id']
            for _ in range(100):
                task=(await self.client.get('/api/canvas-comfy-tasks/'+task_id)).json()
                if task['status'] in {'succeeded','failed'}:break
                await asyncio.sleep(.01)
            self.assertEqual(task['status'],'succeeded');self.assertEqual(generator.call_count,1)
            for field in ['canvas_id','node_id','assistant_action_id','input_hash','segment_id']:
                self.assertEqual(task[field],self.body[field]);self.assertEqual(response.json()[field],self.body[field])
            self.assertEqual(task['provider_id'],'comfyui');self.assertEqual(task['model'],'public-workflow.json')
            self.assertNotIn('request_hash',task)
            records=list(Path(self.temp.name).glob('*.json'));self.assertTrue(records)
            self.assertNotIn('private prompt',records[0].read_text(encoding='utf8'))

    async def test_incomplete_ownership_rejected_before_worker(self):
        with patch.object(main,'generate') as generator:
            for field in ['canvas_id','node_id','input_hash']:
                with self.subTest(field=field):
                    response=await self.client.post('/api/canvas-comfy-tasks',json={**self.body,field:''});self.assertEqual(response.status_code,422)
            self.assertEqual(generator.call_count,0)
            self.assertEqual(list(Path(self.temp.name).glob('*.json')),[])


if __name__=='__main__':unittest.main()
