"""原生魔搭/MJ入队、实际请求分流及保存回执；供应商全部模拟。"""
import asyncio
import copy
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from fastapi import HTTPException
import main
from backend.canvas_assistant_native import prepare_native_action, native_run_input_hash, native_run_result, catalog_image_inputs


class CatalogImageTests(unittest.IsolatedAsyncioTestCase):
    async def test_non_image_inputs_are_rejected_like_native_media_classification(self):
        refs=[{'url':'/files/video.mp4'},{'url':'/files/audio.wav'}, {'url':'/opaque','mediaKind':'video'}, {'url':'/opaque','mediaKind':'audio'}, {'url':'/api/media-preview?url=%2Ffiles%2Fa.mp4'}, {'url':'/files/a.txt'}]
        for source_type in ['image','output']:
            for ref in refs:
                source={'id':'s','type':source_type,**ref} if source_type=='image' else {'id':'s','type':'output','images':[ref]}
                canvas={'nodes':[source],'connections':[{'from':'s','to':'n'}]}
                with self.subTest(source_type=source_type,ref=ref),self.assertRaises(HTTPException):catalog_image_inputs(canvas,{'id':'n'})
        for source in [{'id':'s','type':'output','images':['/files/a.mp4']},{'id':'s','type':'output','mediaKind':'audio','images':['/opaque']}]:
            with self.assertRaises(HTTPException):catalog_image_inputs({'nodes':[source],'connections':[{'from':'s','to':'n'}]},{'id':'n'})
        for url in ['/output/image.png','/opaque']:
            inputs=catalog_image_inputs({'nodes':[{'id':'s','type':'image','url':url}],'connections':[{'from':'s','to':'n'}]},{'id':'n'})
            self.assertEqual(inputs['reference_images'],[{'url':url,'kind':'image'}])

    def canvas(self,kind):
        n={'id':'n','type':kind,'count':1,'outputEnabled':True,'msgenModel':'custom','msCustomModel':'manual','msRatio':'landscape','msResolution':'2k','apiProvider':'mj','mode':'imagine','version':'7','size':'16:9','speed':'relax'}
        c={'id':'c','updated_at':1,'nodes':[n,{'id':'p','type':'prompt','text':'已保存私有正文'},{'id':'o','type':'output','images':[{'url':'/output/old.png'}]}],'connections':[{'from':'p','to':'n'},{'from':'n','to':'o'}]}
        providers=[{'id':'modelscope','enabled':True,'image_models':['manual']},{'id':'mj','enabled':True,'protocol':'apimart'}]
        p=prepare_native_action(c,{'action':'run','nodeId':'n','maxCalls':1},'a',providers=providers)
        n['assistantNativeRun']={'actionId':'a','taskKind':'image','taskIds':[],'submissionStarted':True,'outputNodeId':'o','inputHash':p['runInputHash']}
        return c,providers,p

    async def test_atomic_enqueue_keeps_original_model_binding_and_server_inputs(self):
        request=SimpleNamespace(state=SimpleNamespace(trace_id='',request_id=''))
        for kind in ['msgen','midjourney']:
            c,providers,p=self.canvas(kind)
            payload=main.OnlineImageRequest(prompt='客户端伪造',native_node_type=kind,native_configuration_hash=p['configurationHash'],provider_id=p['runSettings']['provider'],model=p['runSettings']['model'],canvas_id='c',node_id='n',assistant_action_id='a',input_hash=p['runInputHash'],size='64x64')
            worker=AsyncMock()
            with tempfile.TemporaryDirectory() as folder,patch.object(main,'CANVAS_TASK_DIR',folder),patch.object(main,'CANVAS_TASKS',{}),patch.object(main,'run_canvas_image_task',worker),patch.object(main,'load_canvas',return_value=c),patch.object(main,'canvas_assistant_providers',return_value=providers):
                first=await main.enqueue_canvas_image_task(payload,request);second=await main.enqueue_canvas_image_task(payload,request)
                await asyncio.sleep(0);self.assertEqual(worker.await_count,1);self.assertEqual(first['task_id'],second['task_id'])
                self.assertEqual(payload.prompt,'已保存私有正文')
                if kind=='msgen':self.assertEqual(payload.size,'2048x1360')
                text=next(Path(folder).glob('*.json')).read_text(encoding='utf8');self.assertNotIn('已保存私有正文',text);self.assertNotIn('native_config',text)
                main.CANVAS_TASKS.clear();task=await main.get_canvas_image_task(first['task_id'])
                for key,value in [('canvas_id','c'),('node_id','n'),('assistant_action_id','a'),('input_hash',p['runInputHash'])]:self.assertEqual(task[key],value)
                c['nodes'][1]['text']='已编辑'
                with self.assertRaises(HTTPException):await main.enqueue_canvas_image_task(payload,request)
                self.assertEqual(worker.await_count,1)

    async def test_receipt_requires_owned_task_and_bound_output_not_old_images(self):
        for kind in ['msgen','midjourney']:
            c,providers,p=self.canvas(kind);n=c['nodes'][0];n['assistantNativeRun']['taskIds']=['original']
            task={'task_id':'original','status':'succeeded','canvas_id':'c','node_id':'n','assistant_action_id':'a','input_hash':p['runInputHash'],'provider_id':p['runSettings']['provider'],'model':p['runSettings']['model'],'result':{'images':['/output/new.png']}}
            if kind=='midjourney':
                task['result']['native_remote_task_id']='remote-original';n.update(lastTaskId='remote-original',lastAction='imagine',lastTaskStatus='SUCCESS',lastImageCount=1,lastPrompt='已保存私有正文')
                self.assertEqual(native_run_input_hash(c,'n'),p['runInputHash'])
            n['generatedOutputs']=[{'url':'/output/new.png'}]
            self.assertEqual(native_run_result(c,p,[task])['state'],'accepted')
            c['nodes'][2]['images'].append({'url':'/output/new.png'});self.assertEqual(native_run_result(c,p,[task])['state'],'completed')
            with self.assertRaises(HTTPException):native_run_result(c,p,[{**task,'assistant_action_id':'foreign'}])
            c['connections'].pop()
            with self.assertRaises(HTTPException):native_run_result(c,p,[task])

    async def test_worker_reuses_original_ms_endpoint_and_mj_original_task_only(self):
        for key,method in [('zimage','generate_cloud'),('qwen_edit','generate_angle_cloud'),('custom','ms_generate'),('klein_edit','ms_generate')]:
            from backend.canvas_assistant_msgen import prepare_msgen_run_config
            n={'type':'msgen','msgenModel':key,'msCustomModel':'manual','count':1}
            config=prepare_msgen_run_config(n,[{'id':'modelscope','image_models':['manual']}],image_count=1)
            p=main.OnlineImageRequest(prompt='原文',native_node_type='msgen',native_config=config,reference_images=[main.AIReference(url='/output/ref.png')])
            worker=AsyncMock(return_value={'url':'/output/result.png'})
            with patch.object(main,method,worker):
                result=await main.build_native_catalog_image_result(p)
                self.assertEqual(result['images'],['/output/result.png']);self.assertEqual(worker.await_count,1)
                self.assertEqual(worker.call_args.args[0].prompt,'原文')
        c,_,proposal=self.canvas('midjourney');p=main.OnlineImageRequest(prompt='原文',native_node_type='midjourney',native_config=proposal['nativeImageConfig'])
        submit=AsyncMock(return_value={'task_id':'mj-original'});query=AsyncMock(return_value={'status':'succeeded','images':['/output/mj.png']});accepted=AsyncMock()
        with patch.object(main,'submit_midjourney',submit),patch.object(main,'query_native_catalog_image_task',query):
            await main.build_native_catalog_image_result(p,on_remote_accept=accepted)
            self.assertEqual(submit.await_count,1);accepted.assert_awaited_once_with('mj-original',query_mode='midjourney');query.assert_awaited_once_with('midjourney','mj','mj-original')

if __name__=='__main__':unittest.main()
