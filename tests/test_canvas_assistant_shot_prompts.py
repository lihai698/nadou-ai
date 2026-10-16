import copy
import unittest

from fastapi import HTTPException
from backend.canvas_assistant_operations import AssistantPlan, prepare_operations


class ShotPromptTests(unittest.TestCase):
    def test_changed_single_shot_rebuilds_only_its_image_branch_and_preserves_old_images(self):
        from backend.canvas_assistant_native import prepare_native_action
        for kind in ['classic','smart']:
            canvas={'id':'single-shot','kind':kind,'updated_at':1,'nodes':[{'id':'table','type':'smart-shot-table' if kind=='smart' else 'shot-table','shotTableData':{
                'source':{'fingerprint':'story'},'rows':[{'id':'a','index':1,'cells':{'visual':'女孩进书店'},'imagePrompt':'暖光书店'},
                    {'id':'b','index':2,'cells':{'visual':'女孩读旧信'},'imagePrompt':'信纸特写'}],
                'productionData':{'style':'暖色电影'},'generationMap':{}}}],'connections':[]}
            canvas,_=self.prepare(canvas,['a','b'])
            table=canvas['nodes'][0]['shotTableData'];mapping=table['shotPromptMap']
            def complete(row_id,text):
                source=next(n for n in canvas['nodes'] if n['id']==mapping[row_id]['sourceNodeId'])
                processor=next(n for n in canvas['nodes'] if n['id']==mapping[row_id]['processorId'])
                processor['text' if kind=='smart' else 'outputText']=text
                processor['llmOutputStale']=False
                processor['shotPromptResult']={'sourceText':source['text'],'outputText':text,'provider':'chosen','model':'text'}
            def images(rows,request):
                plan=AssistantPlan.model_validate({'reply':'配图','operations':[{'op':'shot_images','operationId':'images','tableId':'table','rowIds':rows}]})
                return prepare_operations(canvas,plan.operations,request_id=request,user='u',expected_updated_at=1,
                    creation_settings={'provider_id':'chosen','model':'image'},image_model_confirmed=True,providers=[{'id':'chosen','image_models':['image']}])
            complete('a','镜头A模型结果');complete('b','镜头B模型结果')
            canvas,receipt=images(['a','b'],'first')
            old_a,old_b=receipt['shotImages'][0]['generatorIds']
            for row_id,gid in [('a',old_a),('b',old_b)]:
                gen=next(n for n in canvas['nodes'] if n['id']==gid)
                target=gen if kind=='smart' else next(n for n in canvas['nodes'] if n['id']==gid+'_output')
                target['images']=[{'url':'/mock/'+row_id+'.png'}]
            protected_ids={mapping['b']['sourceNodeId'],mapping['b']['processorId'],old_b,old_b+'_output'}
            untouched={n['id']:copy.deepcopy(n) for n in canvas['nodes'] if n['id'] in protected_ids}
            old_outputs={n['id']:copy.deepcopy(n.get('images')) for n in canvas['nodes'] if n.get('images')}
            canvas['nodes'][0]['shotTableData']['rows'][0]['cells']['visual']='女孩在门口收伞'
            canvas,_=self.prepare(canvas,['a'],'refresh-only-a')
            with self.assertRaises(HTTPException):images(['a'],'must-rerun')
            complete('a','更新后的镜头A模型结果')
            canvas,receipt=images(['a'],'new-a-result')
            new_a=receipt['shotImages'][0]['generatorIds'][0]
            self.assertNotEqual(new_a,old_a)
            remaining_ids={n['id'] for n in canvas['nodes']}
            self.assertTrue(set(untouched)<=remaining_ids)
            self.assertTrue(set(old_outputs)<=remaining_ids)
            for n in canvas['nodes']:
                if n['id'] in untouched:self.assertEqual(n,untouched[n['id']])
                if n['id'] in old_outputs:self.assertEqual(n['images'],old_outputs[n['id']])
            with self.assertRaises(HTTPException):
                prepare_native_action(canvas,{'action':'run','nodeId':old_a,'maxCalls':1},'old-stale',providers=[{'id':'chosen','image_models':['image']}])
            prepare_native_action(canvas,{'action':'run','nodeId':new_a,'maxCalls':1},'new-valid',providers=[{'id':'chosen','image_models':['image']}])

    def prepare(self, canvas, rows, request='shots'):
        plan=AssistantPlan.model_validate({'reply':'逐镜处理','operations':[{'op':'shot_prompts','operationId':'shots','tableId':'table','rowIds':rows}]})
        return prepare_operations(canvas,plan.operations,request_id=request,user='u',expected_updated_at=1,
            creation_settings={'textProvider':'chosen','textModel':'text'},providers=[{'id':'chosen','chat_models':['text']}])

    def test_two_canvases_real_llm_and_single_row_refresh(self):
        for kind in ['classic','smart']:
            canvas={'id':'c','kind':kind,'updated_at':1,'nodes':[{'id':'table','type':'smart-shot-table' if kind=='smart' else 'shot-table','shotTableData':{
                'rows':[{'id':'a','index':1,'cells':{'visual':'女孩走进书店'},'imagePrompt':'雨夜书店'},
                        {'id':'b','index':2,'cells':{'visual':'打开旧信'},'imagePrompt':'信纸特写'}],
                'productionData':{'style':'电影'},'generationMap':{}}}],'connections':[]}
            result,receipt=self.prepare(canvas,['a','b'])
            mapping=result['nodes'][0]['shotTableData']['shotPromptMap']
            self.assertEqual(set(mapping),{'a','b'})
            self.assertEqual(len(receipt['shotPrompts'][0]['processorIds']),2)
            for row in ['a','b']:
                source=next(n for n in result['nodes'] if n['id']==mapping[row]['sourceNodeId'])
                if kind=='smart':
                    self.assertFalse(source['llmEnabled'])
                    self.assertEqual((source['llmProvider'],source['llmModel']),('chosen','text'))
                processor=next(n for n in result['nodes'] if n['id']==mapping[row]['processorId'])
                self.assertEqual(processor['type'],'llm' if kind=='classic' else 'smart-prompt')
                self.assertEqual(processor['llmProvider'],'chosen')
                self.assertNotIn('storyAnalysisOrigin',processor)
                if kind=='smart':
                    self.assertIn('cells是当前用户编辑的镜头内容',processor['llmInstruction'])
                    self.assertFalse(processor['llmSystemEnabled'])
                    self.assertEqual(processor['llmSystemPrompt'],'')
                    self.assertEqual(processor['text'],'')
                self.assertEqual(processor['shotPromptOrigin']['rowId'],row)
                self.assertTrue(any(c['from']==source['id'] and c['to']==processor['id'] and c['kind']=='input' for c in result['connections']))
            before=copy.deepcopy(result)
            result['nodes'][0]['shotTableData']['rows'][0]['cells']['visual']='女孩走出书店'
            refreshed,_=self.prepare(result,['a'],'refresh')
            self.assertEqual(len(refreshed['nodes']),len(result['nodes']))
            a=mapping['a'];b=mapping['b']
            self.assertIn('女孩走出书店',next(n for n in refreshed['nodes'] if n['id']==a['sourceNodeId'])['text'])
            for nid in b.values():
                self.assertEqual(next(n for n in before['nodes'] if n['id']==nid),next(n for n in refreshed['nodes'] if n['id']==nid))
            with self.assertRaises(HTTPException):self.prepare(refreshed,['missing'],'missing')

    def test_images_require_actual_result_reuse_and_preserve_old_output(self):
        for kind in ['classic','smart']:
            canvas={'id':'c','kind':kind,'updated_at':1,'nodes':[{'id':'table','type':'smart-shot-table' if kind=='smart' else 'shot-table','shotTableData':{
                'source':{'fingerprint':'story'},'rows':[{'id':'a','index':1,'cells':{'visual':'书店'},'imagePrompt':'雨夜'}],
                'productionData':{'style':'电影'},'generationMap':{}}}],'connections':[]}
            canvas,_=self.prepare(canvas,['a'])
            def images(c,request='images',again=False,ratio='square'):
                plan=AssistantPlan.model_validate({'reply':'配图','operations':[{'op':'shot_images','operationId':'images','tableId':'table','rowIds':['a'],'newAttempt':again}]})
                return prepare_operations(c,plan.operations,request_id=request,user='u',expected_updated_at=1,
                    creation_settings={'provider_id':'chosen','model':'image','quality':'high','ratio':ratio},image_model_confirmed=True,
                    providers=[{'id':'chosen','image_models':['image']}])
            with self.assertRaises(HTTPException):images(canvas)
            mapping=canvas['nodes'][0]['shotTableData']['shotPromptMap']['a']
            source=next(n for n in canvas['nodes'] if n['id']==mapping['sourceNodeId'])
            processor=next(n for n in canvas['nodes'] if n['id']==mapping['processorId'])
            processor['text' if kind=='smart' else 'outputText']='电影灯光，雨夜书店中的女孩'
            processor['shotPromptResult']={'sourceText':source['text'],'outputText':'电影灯光，雨夜书店中的女孩','provider':'chosen','model':'text'}
            saved,receipt=images(canvas)
            if kind=='smart':
                processor['llmOutputStale']=True
                with self.assertRaises(HTTPException):images(canvas,'changed-rules')
                processor['llmOutputStale']=False
            gid=receipt['shotImages'][0]['generatorIds'][0]
            gen=next(n for n in saved['nodes'] if n['id']==gid)
            self.assertEqual(gen['type'],'smart-image' if kind=='smart' else 'generator')
            self.assertTrue(any(c['from']==processor['id'] and c['to']==gid for c in saved['connections']))
            self.assertEqual(gen['runSettings']['model'] if kind=='smart' else gen['model'],'image')
            from backend.canvas_assistant_native import prepare_native_action
            prepare_native_action(saved,{'action':'run','nodeId':gid,'maxCalls':1},'run-shot',providers=[{'id':'chosen','image_models':['image']}])
            same,reused=images(saved,'reuse');self.assertEqual(len(same['nodes']),len(saved['nodes']))
            self.assertEqual(reused['shotImages'][0]['reusedIds'],[gid])
            resized,changed=images(saved,'change-ratio',ratio='16:9')
            self.assertNotEqual(changed['shotImages'][0]['generatorIds'][0],gid)
            new_gen=next(n for n in resized['nodes'] if n['id']==changed['shotImages'][0]['generatorIds'][0])
            self.assertEqual(new_gen['runSettings']['ratio'] if kind=='smart' else new_gen['ratio'],'16:9')
            gen['images']=[{'url':'/assets/existing.png'}]
            gen['submissionUnknown']=True
            with self.assertRaises(HTTPException):images(saved,'unknown',True)
            del gen['submissionUnknown']
            new,receipt=images(saved,'explicit-retry',True)
            self.assertNotEqual(receipt['shotImages'][0]['generatorIds'][0],gid)
            self.assertEqual(next(n for n in new['nodes'] if n['id']==gid)['images'],[{'url':'/assets/existing.png'}])
            stale=copy.deepcopy(saved);stale['nodes'][0]['shotTableData']['rows'][0]['cells']['visual']='新画面'
            from backend.canvas_assistant_shot_prompts import validate_shot_image
            with self.assertRaises(HTTPException):validate_shot_image(stale,gen)
            with self.assertRaises(HTTPException):prepare_native_action(stale,{'action':'run','nodeId':gid,'maxCalls':1},'stale-run',providers=[{'id':'chosen','image_models':['image']}])
            with self.assertRaises(HTTPException):images(stale,'stale')
