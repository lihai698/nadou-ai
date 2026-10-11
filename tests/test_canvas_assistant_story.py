import copy
import unittest
from fastapi import HTTPException

from backend.canvas_assistant_operations import AssistantPlan, prepare_operations
from backend.canvas_assistant_state import read_node_state


def story_fixture():
    return dict(sourceNodeId='story',title='雨夜',style='暖色电影风格',
        beats=[dict(id='b1',title='相遇',sourceExcerpt='女孩走进书店。',summary='女孩入店找到旧信')],
        characters=[dict(id='girl',name='女孩',description='黑发、蓝色外套')],
        scenes=[dict(id='shop',name='书店',description='木书架，暖黄台灯')],
        props=[dict(id='letter',name='旧信',description='泛黄信封')],
        sounds=[dict(id='voice',name='女孩声音',description='轻柔，语速舒缓',kind='voice',characterId='girl'),
                dict(id='rain',name='雨声',description='窗外轻雨',kind='effect',characterId='')],
        shots=[dict(id=f's{i}',beatId='b1',title='读信',durationSeconds=3.0,sceneId='shop',characterIds=['girl'],propIds=['letter'],soundIds=['rain'],
                    dialogue=[dict(soundId='voice',text='谢谢你。')],shotSize='中景',camera='平视',motion='缓慢推进',visual='女孩打开信封',action='打开旧信',
                    mood='温暖',transition='淡入',onScreenText='',imagePrompt='女孩读旧信',motionPrompt='手指缓慢打开信封') for i in range(1,3)])


class StoryWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.canvas=dict(id='canvas',kind='smart',updated_at=1,nodes=[dict(id='story',type='smart-prompt',text='女孩走进书店。她读着旧信。',x=0,y=0)],connections=[])
        self.kw=dict(request_id='turn',user='u',expected_updated_at=1,creation_settings=dict(provider_id='custom',model='custom-image'),
                     providers=[dict(id='custom',image_models=['custom-image'])],image_model_confirmed=True)

    def prepare(self, data=None, canvas=None):
        plan=AssistantPlan.model_validate(dict(reply='保存',operations=[dict(op='story_workflow',operationId='wf',**(data or story_fixture()))]))
        return prepare_operations(canvas or self.canvas,plan.operations,**self.kw)

    def test_complete_native_chain_and_source_sound_bindings(self):
        before=copy.deepcopy(self.canvas)
        canvas,receipt=self.prepare()
        self.assertEqual(self.canvas,before)
        self.assertEqual(len(canvas['nodes']),12)
        self.assertEqual(len(canvas['connections']),15)
        table=next(n for n in canvas['nodes'] if n['type']=='smart-shot-table')
        d=table['shotTableData']
        self.assertEqual(d['source']['kind'],'text')
        self.assertEqual(d['source']['nodeId'],'story')
        self.assertEqual(d['source']['durationSeconds'],6)
        self.assertIn('voice',d['rows'][0]['cells']['voice'])
        self.assertIn('letter',d['rows'][0]['cells']['props'])
        ids={n['id']:n for n in canvas['nodes']}
        for row in d['rows']:
            link=d['generationMap'][d['source']['fingerprint']+':'+row['id']]
            self.assertEqual(ids[link['promptId']]['text'],row['imagePrompt'])
            image=ids[link['generatorId']]
            self.assertEqual(image['runSettings']['model'],'custom-image')
            self.assertEqual(image['runSettings']['provider_id'],'custom')
            self.assertEqual(image['images'],[])
            self.assertEqual(image['shotTableOrigin']['rowId'],row['id'])
            self.assertIn('黑发、蓝色外套',row['imagePrompt'])
        self.assertEqual(receipt['storyWorkflows'][0]['shotCount'],2)
        state=read_node_state(canvas,table['id'])
        self.assertEqual(state['parameters']['shotTableData']['source']['kind'],'text')
        self.assertEqual(len(state['membership']['shotTableData.documentNodes']),6)
        self.assertTrue(d['rows'][0]['imagePrompt'].startswith('分镜 1 · 读信\n本镜画面：'))
        self.assertTrue(d['rows'][1]['imagePrompt'].startswith('分镜 2 · 读信\n本镜画面：'))
        self.assertLess(d['rows'][0]['imagePrompt'].index('本镜画面：'), d['rows'][0]['imagePrompt'].index('统一风格：'))

    def test_edit_managed_prompt_syncs_table_image_draft_and_keeps_model_results(self):
        canvas, _ = self.prepare()
        table = next(n for n in canvas['nodes'] if n['type'] == 'smart-shot-table')
        data = table['shotTableData']
        chain = next(iter(data['generationMap'].values()))
        image = next(n for n in canvas['nodes'] if n['id'] == chain['generatorId'])
        image['images'] = [{'url': '/output/previous.png'}]
        before = copy.deepcopy(canvas)
        plan = AssistantPlan.model_validate({'reply': '修改提示词', 'operations': [{'op': 'update', 'operationId': 'edit', 'nodeId': chain['promptId'], 'content': '分镜1 · 推门\n雨中的女孩推开书店木门'}]})
        updated, receipt = prepare_operations(canvas, plan.operations, **{**self.kw, 'request_id': 'edit'})
        self.assertEqual(canvas, before)
        by_id = {n['id']: n for n in updated['nodes']}
        text = by_id[chain['promptId']]['text']
        self.assertEqual(by_id[table['id']]['shotTableData']['rows'][0]['imagePrompt'], text)
        self.assertEqual(by_id[table['id']]['shotTableData']['productionData']['shots'][0]['imagePrompt'], text)
        self.assertEqual(by_id[chain['generatorId']]['promptDraftText'], text)
        self.assertEqual(by_id[chain['generatorId']]['images'], image['images'])
        self.assertEqual(by_id[chain['generatorId']]['runSettings'], image['runSettings'])
        self.assertEqual(by_id[table['id']]['shotTableData']['rows'][1], data['rows'][1])
        self.assertNotIn('workflowHash', by_id[table['id']]['shotTableData']['productionData'])
        self.assertEqual(set(receipt['updatedNodeIds']), {table['id'], chain['promptId'], chain['generatorId']})
        self.assertTrue(any('shotTableData' in p['fields'] for p in receipt['nodePatches']))

    def test_edit_managed_prompt_refuses_broken_or_busy_chain_atomically(self):
        for broken in (True, False):
            canvas, _ = self.prepare()
            table = next(n for n in canvas['nodes'] if n['type'] == 'smart-shot-table')
            chain = next(iter(table['shotTableData']['generationMap'].values()))
            if broken:
                canvas['connections'] = []
            else:
                next(n for n in canvas['nodes'] if n['id'] == chain['generatorId'])['running'] = True
            before = copy.deepcopy(canvas)
            plan = AssistantPlan.model_validate({'reply': '修改提示词', 'operations': [{'op': 'update', 'operationId': 'edit', 'nodeId': chain['promptId'], 'content': '新镜头'}]})
            with self.assertRaises(HTTPException):
                prepare_operations(canvas, plan.operations, **{**self.kw, 'request_id': 'edit'})
            self.assertEqual(canvas, before)

    def test_invalid_asset_voice_or_source_reference_is_atomic(self):
        for field in ('scene','voice','source','beat','duplicate'):
            data=story_fixture()
            if field=='scene':data['shots'][0]['sceneId']='missing'
            if field=='voice':data['shots'][0]['characterIds']=[]
            if field=='source':data['beats'][0]['sourceExcerpt']='原文没有此内容'
            if field=='beat':data['beats'].append(dict(id='unused',title='遗漏',sourceExcerpt='她读着旧信。',summary='遗漏'))
            if field=='duplicate':data['shots'][1]['id']='s1'
            before=copy.deepcopy(self.canvas)
            with self.assertRaises(HTTPException):self.prepare(data)
            self.assertEqual(self.canvas,before)

    def test_semantic_errors_are_reported_together_without_partial_writes(self):
        data = story_fixture()
        data['beats'][0]['sourceExcerpt'] = '原文没有此内容'
        data['shots'][0]['sceneId'] = 'missing-scene'
        data['shots'][0]['characterIds'] = []
        data['shots'][1]['dialogue'][0]['soundId'] = 'missing-voice'
        data['beats'].append(dict(id='unused', title='遗漏', sourceExcerpt='她读着旧信。', summary='遗漏'))
        before = copy.deepcopy(self.canvas)
        with self.assertRaises(HTTPException) as raised:
            self.prepare(data)
        errors = raised.exception.detail
        for message in ('原文引用与故事节点不一致', '不存在的 scenes', '对白与人物声音不对应', '不存在的 sounds', '不能遗漏剧情'):
            self.assertIn(message, errors)
        self.assertEqual(raised.exception.status_code, 422)
        self.assertEqual(self.canvas, before)

    def test_long_source_workflow_has_complete_acyclic_saved_dependencies(self):
        import json
        from backend.canvas_assistant_operations import would_cycle
        for length in (1000, 2000, 3000, 4000, 5000):
            with self.subTest(length=length):
                original = copy.deepcopy(self.canvas)
                original['nodes'][0]['text'] += '雨' * (length-len(original['nodes'][0]['text']))
                canvas, receipt = self.prepare(canvas=original)
                loaded = json.loads(json.dumps(canvas, ensure_ascii=False))
                table = next(n for n in loaded['nodes'] if n['type'] == 'smart-shot-table')
                data = table['shotTableData']; docs = data['productionData']['documentNodeIds']
                expected = {('story', docs['beats']), ('story', docs['overview']), (docs['beats'], table['id'])}
                for category in ('characters', 'scenes', 'props', 'sounds'):
                    expected.update(((docs['beats'], docs[category]), (docs[category], table['id'])))
                for chain in data['generationMap'].values():
                    expected.update(((table['id'], chain['promptId']), (chain['promptId'], chain['generatorId'])))
                actual = {(e['from'], e['to']) for e in loaded['connections']}
                self.assertEqual(actual, expected)
                self.assertEqual(len(receipt['createdEdgeIds']), len(expected))
                for edge in loaded['connections']:
                    others = [e for e in loaded['connections'] if e['id'] != edge['id']]
                    self.assertFalse(would_cycle(others, edge['from'], edge['to']))
                    target = next(n for n in loaded['nodes'] if n['id'] == edge['to'])
                    self.assertEqual(edge['kind'], 'input' if target['type'] == 'smart-image' else 'story')
                reached = {'story'}
                while True:
                    after = reached | {e['to'] for e in loaded['connections'] if e['from'] in reached}
                    if after == reached:
                        break
                    reached = after
                self.assertEqual(reached, {n['id'] for n in loaded['nodes']})
                self.assertEqual(len(loaded['nodes'][0]['text']), length)
                self.assertEqual(len(read_node_state(loaded, table['id'])['connections']['outgoing']), 2)

    def test_retry_reuses_saved_receipt_without_duplicate_nodes(self):
        canvas,receipt=self.prepare()
        canvas['updated_at']=2
        candidate,replayed=self.prepare(canvas=canvas)
        self.assertIsNone(candidate)
        self.assertEqual(receipt,replayed)

    def test_repeated_tool_step_reuses_workflow_after_different_read_steps(self):
        canvas,_=self.prepare()
        self.kw.update(request_id='turn-next-step')
        updated,receipt=self.prepare(canvas=canvas)
        self.assertEqual(len(updated['nodes']),12)
        self.assertEqual(len(updated['connections']),15)
        self.assertEqual(receipt['createdNodeIds'],[])
        self.assertTrue(receipt['storyWorkflows'][0]['reused'])

    def test_model_choice_is_required_and_never_fixed(self):
        self.kw['image_model_confirmed']=False
        with self.assertRaises(HTTPException):self.prepare()
        self.kw['image_model_confirmed']=True
        self.kw['creation_settings']['model']='unconfigured'
        with self.assertRaises(HTTPException):self.prepare()
