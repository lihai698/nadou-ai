import asyncio
import json
import tempfile
import time
import unittest
from backend.canvas_storyboard_analysis import selected_rules, analysis_prompt, parse_selected, validate_text_source, plan_text
from backend.canvas_video_deconstruction import VideoDeconstructionManager


class StoryboardTests(unittest.TestCase):
    def test_upstream_images_llm_output_and_unlink(self):
        document = {'nodes': [{'id':'t','type':'shot-table','shotTableData':{'source':{'kind':'text','nodeId':'p'}}},
            {'id':'p','type':'prompt','text':'原始提示词'}, {'id':'l','type':'llm','text':'不能当输出','outputText':'LLM 输出'},
            {'id':'i','type':'image','url':'/assets/ref.png'}, {'id':'unused','type':'prompt','text':'未连接'}],
            'connections':[{'from':'p','to':'l'},{'from':'l','to':'t'},{'from':'i','to':'t'}]}
        load=lambda _:document
        value=validate_text_source({'table_id':'t'},'owner',load_canvas=load)
        self.assertEqual(value['source_text'],'LLM 输出')
        self.assertEqual(value['images'],['/assets/ref.png'])
        document['nodes'][2]['outputText']=''
        self.assertEqual(validate_text_source({'table_id':'t'},'owner',load_canvas=load)['source_text'],'')
        document['connections']=[]
        with self.assertRaises(ValueError):validate_text_source({'table_id':'t'},'owner',load_canvas=load)

    def test_image_only_analysis_passes_images_and_rejects_changed_input(self):
        calls=[]
        class Manager:
            changed=False
            def providers(self):return [{'id':'p','chat_models':['m']}]
            def validate_source(self,c,u):return {'source_text':'','images':['/assets/changed.png' if self.changed and calls else '/assets/ref.png']}
            async def call_vision(self,fields):
                calls.append(fields)
                return {'text':'{"shots":[{"visual":"参考图片内容"}]}'}
        manager=Manager()
        options={'providerId':'p','model':'m','enabledFields':['visual']}
        result=asyncio.run(plan_text(manager,{},'owner',options))
        self.assertEqual(calls[0]['images'],['/assets/ref.png'])
        self.assertEqual(result['rows'][0]['cells'],{'visual':'参考图片内容'})
        calls.clear();manager.changed=True
        with self.assertRaisesRegex(ValueError,'上游素材已修改'):asyncio.run(plan_text(manager,{},'owner',options))

    def test_scope_compiles_only_selected_rules(self):
        rules = selected_rules({'columns':[{'id':'props','label':'道具'}], 'enabledFields':['visual','props']})
        prompt = analysis_prompt(rules)
        self.assertEqual(list(rules), ['visual','props'])
        self.assertNotIn('motionPrompt',prompt)
        self.assertNotIn('dialogue',prompt)
        self.assertEqual(parse_selected('{"visual":"画面","props":"","dialogue":"忽略"}',rules), {'visual':'画面','props':''})
        for fields in [[], ['invalid'], 'visual']:
            with self.assertRaises(ValueError): selected_rules({'enabledFields':fields})
        with self.assertRaises(ValueError): selected_rules({'enabledFields':['visual'],'skillId':'missing'})

    def test_text_source_comes_from_saved_graph_not_payload(self):
        document = {'nodes':[{'id':'t','type':'shot-table','shotTableData':{'revision':3}},
                    {'id':'p','type':'prompt','text':'小孩跑进花园。'}], 'connections':[{'from':'p','to':'t'}]}
        context = {'table_id':'t','table_revision':3,'source_text':'不能信任客户端替代文本'}
        source = validate_text_source(context,'owner',load_canvas=lambda _:document)
        self.assertEqual(source['source_text'],'小孩跑进花园。')
        with self.assertRaises(ValueError): validate_text_source({**context,'table_revision':2},'owner',load_canvas=lambda _:document)
        document['readOnly']=True
        with self.assertRaises(ValueError): validate_text_source(context,'owner',load_canvas=lambda _:document)

    def test_text_model_decides_row_count_and_only_selected_data_returns(self):
        calls=[]
        class Manager:
            def providers(self): return [{'id':'p','chat_models':['m']}]
            def validate_source(self,c,u): return {'source_text':'原文'}
            async def call_vision(self,fields):
                calls.append(fields)
                return {'text':json.dumps({'shots':[{'visual':'镜头一','dialogue':'丢弃'},{'visual':'镜头二','durationSeconds':3}]})}
        result=asyncio.run(plan_text(Manager(),{},'owner',{'providerId':'p','model':'m','enabledFields':['visual']}))
        self.assertEqual(len(result['rows']),2)
        self.assertEqual(result['rows'][1]['startSeconds'],5)
        self.assertEqual(result['rows'][0]['cells'],{'visual':'镜头一'})
        self.assertEqual(calls[0]['provider'],'p')
        self.assertNotIn('dialogue',calls[0]['system_prompt'])
        with self.assertRaises(ValueError): asyncio.run(plan_text(Manager(),{},'owner',{'providerId':'p','model':'removed','enabledFields':['visual']}))
        self.assertEqual(len(calls),1)

    def test_video_automatically_uses_selected_model_and_skips_unselected_audio(self):
        calls=[]
        class Media:
            def fingerprint(self,c):return 'fp'
            def detect(self,c,**kw):return {'durationSeconds':3,'cuts':[]}
            def extract_audio(self,*args,**kw):raise AssertionError('不应提取未选对白')
            def extract_frames(self,c,seconds,**kw):return {'frames':[{'url':'/output/f.jpg'} for _ in seconds],'failures':[]}
        async def vision(fields):calls.append(fields);return {'text':'{"visual":"实际画面"}'}
        with tempfile.TemporaryDirectory() as root:
            manager=VideoDeconstructionManager(root,lambda c,u:c,lambda c:Media(),lambda:[{'id':'p','chat_models':['m']}],vision,None)
            try:
                task=manager.prepare({'operation_id':'one','storyboard_inputs':{'source_text':'上游人物设定','images':['/assets/reference.png']}},'owner','table',{'providerId':'p','model':'m','enabledFields':['visual']})
                end=time.monotonic()+5
                while time.monotonic()<end:
                    result=manager.get(task['id'],'owner')
                    if result['status'] in {'ready','failed'}:break
                    time.sleep(.01)
                self.assertEqual(result['status'],'ready',result)
                self.assertEqual(result['enabledFields'],['visual'])
                self.assertEqual(result['quote']['audioCalls'],0)
                self.assertEqual(len(calls),1)
                self.assertEqual(calls[0]['model'],'m')
                self.assertEqual(calls[0]['images'][-1],'/assets/reference.png')
                self.assertIn('上游人物设定',calls[0]['message'])
                self.assertNotIn('imagePrompt',calls[0]['system_prompt'])
                self.assertEqual(result['rows'][0]['cells']['visual'],'实际画面')
            finally:manager.close()


if __name__=='__main__':unittest.main()
