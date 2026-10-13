import copy
import unittest
from fastapi import HTTPException
from backend.canvas_assistant_operations import AssistantPlan, prepare_operations
from tests.test_canvas_assistant_story import story_fixture
import json


class StoryAnalysisTests(unittest.TestCase):
    def prepare(self, canvas, operation, request='analysis'):
        plan=AssistantPlan.model_validate({'reply':'分析流程','operations':[operation]})
        return prepare_operations(canvas,plan.operations,request_id=request,user='u',expected_updated_at=1,
            creation_settings={'textProvider':'chosen','textModel':'chosen-text'},
            providers=[{'id':'chosen','chat_models':['chosen-text']}])

    def test_two_canvases_create_real_model_node_without_image_model(self):
        for kind,source_type in [('classic','prompt'),('smart','smart-prompt')]:
            canvas={'id':'c','kind':kind,'updated_at':1,'nodes':[{'id':'story','type':source_type,'text':'女孩走进书店。她读着旧信。'}],'connections':[]}
            result,receipt=self.prepare(canvas,{'op':'story_analysis','operationId':'analysis','sourceNodeId':'story','title':'雨夜','style':'电影'})
            analysis=next(n for n in result['nodes'] if n['id']!='story')
            self.assertEqual(analysis['type'],'llm' if kind=='classic' else 'smart-prompt')
            self.assertEqual(analysis['llmProvider'],'chosen')
            self.assertEqual(analysis['model' if kind=='classic' else 'llmModel'],'chosen-text')
            self.assertTrue(any(c['from']=='story' and c['to']==analysis['id'] and c['kind']=='input' for c in result['connections']))
            self.assertEqual(canvas['nodes'][0]['text'],result['nodes'][0]['text'])
            self.assertEqual(receipt['storyAnalyses'][0]['analysisNodeId'],analysis['id'])
            self.assertNotIn('storyAnalysisResult',analysis)
            self.assertNotIn('running',analysis,'原生保存会移除运行时字段，创建时不写入以免确认快照变化')
            if kind=='smart':self.assertEqual(analysis['images'],[],'智能画布会补齐空素材数组，创建时使用同一格式')
            from backend.canvas_assistant_native import prepare_native_action
            prepare_native_action(result,{'action':'run','nodeId':analysis['id'],'maxCalls':1},'run-analysis',providers=[{'id':'chosen','chat_models':['chosen-text']}])
            disconnected=copy.deepcopy(result);disconnected['connections']=[]
            with self.assertRaises(HTTPException):prepare_native_action(disconnected,{'action':'run','nodeId':analysis['id'],'maxCalls':1},'missing-input',providers=[])

    def test_import_valid_result_and_reject_stale_or_invalid_output(self):
        for kind,source_type in [('classic','prompt'),('smart','smart-prompt')]:
            canvas={'id':'c','kind':kind,'updated_at':1,'nodes':[{'id':'story','type':source_type,'text':'女孩走进书店。她读着旧信。'}],'connections':[]}
            result,_=self.prepare(canvas,{'op':'story_analysis','operationId':'analysis','sourceNodeId':'story','title':'雨夜','style':'电影'})
            n=result['nodes'][1]; output=json.dumps(story_fixture(),ensure_ascii=False)
            n['text' if kind=='smart' else 'outputText']=output
            n['storyAnalysisResult']={'sourceText':result['nodes'][0]['text'],'outputText':output,'provider':'chosen','model':'chosen-text'}
            op={'op':'story_analysis_result','operationId':'table','analysisNodeId':n['id']}
            saved,receipt=self.prepare(result,op,'table')
            table=next(t for t in saved['nodes'] if t['type'] in {'shot-table','smart-shot-table'})
            self.assertEqual(len(table['shotTableData']['rows']),2)
            self.assertFalse(any(t['type'] in {'generator','smart-image'} for t in saved['nodes']))
            self.assertTrue(any(c['from']==n['id'] and c['to']==table['id'] for c in saved['connections']))
            again,_=self.prepare(saved,op,'again'); self.assertEqual(len(again['nodes']),len(saved['nodes']))
            stale=copy.deepcopy(result);stale['nodes'][0]['text']+='新剧情。'
            with self.assertRaises(HTTPException):self.prepare(stale,op,'stale')
            rerun=copy.deepcopy(saved);rerun['nodes'][0]['text']+='新剧情。'
            rerun_analysis=next(n for n in rerun['nodes'] if n['id']==op['analysisNodeId'])
            data=story_fixture();data['shots'][0]['visual']='重新分析后的画面'
            fresh=json.dumps(data,ensure_ascii=False)
            rerun_analysis['text' if kind=='smart' else 'outputText']=fresh
            rerun_analysis['storyAnalysisResult'].update(sourceText=rerun['nodes'][0]['text'],outputText=fresh)
            refreshed,_=self.prepare(rerun,op,'rerun')
            self.assertEqual(len(refreshed['nodes']),len(saved['nodes']))
            self.assertEqual(next(n for n in refreshed['nodes'] if n['id']==table['id'])['shotTableData']['rows'][0]['cells']['visual'],'重新分析后的画面')
            protected=copy.deepcopy(saved);next(n for n in protected['nodes'] if n['id']==table['id'])['shotTableData']['revision']=1
            with self.assertRaises(HTTPException):self.prepare(protected,op,'edited-table')
            invalid=copy.deepcopy(result);invalid['nodes'][1]['storyAnalysisResult']['outputText']='不是JSON';invalid['nodes'][1]['text' if kind=='smart' else 'outputText']='不是JSON'
            with self.assertRaises(HTTPException):self.prepare(invalid,op,'invalid')
