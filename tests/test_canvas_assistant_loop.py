import copy
import unittest

from fastapi import HTTPException

from backend.canvas_assistant_loop import loop_plan, loop_input_hash, loop_slots, loop_receipt, loop_foreign_busy
from backend.canvas_assistant_native import prepare_native_action, native_run_result, native_catalog


class LoopContractTests(unittest.TestCase):
    def canvas(self,rounds=2,dag=False):
        selected={'engine':'api','apiKind':'image','provider_id':'p','model':'manual','count':8}
        c={'id':'canvas','kind':'smart','updated_at':1,'nodes':[{'id':'loop','type':'smart-loop','count':rounds,'mode':'serial','loopStart':3,'imageInput':False,'showPrompt':True,'fixedPrompt':'第[计数]轮'},
          {'id':'root','type':'smart-image','x':100,'images':[{'url':'/assets/original.png'}],'runSettings':selected,'promptDraftText':'原正文'}],
          'connections':[{'from':'loop','to':'root','kind':'input'}],'settings':{}}
        if dag:
            c['nodes'] += [{'id':'a','type':'smart-image','x':200,'runSettings':copy.deepcopy(selected)}, {'id':'b','type':'smart-image','x':300,'runSettings':copy.deepcopy(selected)}]
            c['connections'] += [{'from':'root','to':'a','kind':'flow'},{'from':'root','to':'b','kind':'flow'}]
        return c

    def started(self,c):
        plan=loop_plan(c,'loop',allocate=False)
        p=prepare_native_action(c,{'action':'run','nodeId':'loop','maxCalls':plan['maxCalls']},'action')
        run={'actionId':'action','taskKind':'image','inputHash':p['runInputHash'],'taskIds':[],'slots':{},'submissionStarted':True}
        c['nodes'][0]['assistantNativeRun']=run
        for s in p['loopPlan']['steps']:
            n={'id':s['outputNodeId'],'type':'smart-image','images':[],'loopSourceId':'loop','loopRootId':s['templateNodeId'],'loopRoundIndex':s['roundIndex'],
              'assistantNativeOrigin':{'kind':'loop','actionId':'action','sourceNodeId':'loop','inputHash':p['runInputHash'],'stepKey':s['key']}}
            c['nodes'].append(n);c['connections'].append({'from':s['templateNodeId'],'to':n['id'],'kind':'flow'})
            run['slots'][s['key']]={'outputNodeId':n['id'],'taskIds':[],'status':'ready'}
        return p,run

    def completed(self,c,p,run):
        outputs=loop_slots(c,p);tasks=[]
        for i,s in enumerate(p['loopPlan']['steps']):
            entry=run['slots'][s['key']]
            if s['kind']=='copy':outputs[s['key']]['images']=copy.deepcopy(outputs[s['copyFromKey']]['images'])
            else:
                task_id='original-'+str(i);url='/output/'+task_id+'.png'
                entry['taskIds']=[task_id];run['taskIds'].append(task_id);outputs[s['key']]['images']=[{'url':url}]
                tasks.append({'task_id':task_id,'status':'succeeded','canvas_id':'canvas','node_id':'loop','assistant_action_id':'action','input_hash':p['runInputHash'],'provider_id':s['provider'],'model':s['model'],'result':{'images':[url]}})
            entry['status']='succeeded'
        return tasks

    def test_direct_budget_uses_real_count_one_not_node_count_eight(self):
        c=self.canvas(12);p=loop_plan(c,'loop')
        self.assertEqual(p['maxCalls'],12);self.assertEqual(len(p['steps']),12)
        self.assertEqual([s['roundIndex'] for s in p['steps']],list(range(3,15)))
        self.assertIn('run',next(n for n in native_catalog('smart') if n['type']=='smart-loop')['availableActions'])
        with self.assertRaises(HTTPException):prepare_native_action(c,{'action':'run','nodeId':'loop','maxCalls':96},'bad')

    def test_dag_branch_prompt_selects_one_target_per_round(self):
        c=self.canvas(dag=True);p=loop_plan(c,'loop')
        self.assertEqual(p['maxCalls'],2)
        self.assertEqual([s['templateNodeId'] for s in p['steps']],['a','b'])

    def test_dag_sibling_copy_has_no_model_call(self):
        c=self.canvas(dag=True);c['nodes'][0]['showPrompt']=False;p=loop_plan(c,'loop')
        self.assertEqual(p['maxCalls'],2);self.assertEqual([s['kind'] for s in p['steps']],['generate','copy','generate','copy'])
        c['nodes'].append({'id':'leaf','type':'smart-image','x':400})
        c['connections'].append({'from':'a','to':'leaf','kind':'flow'})
        self.assertEqual(loop_plan(c,'loop')['maxCalls'],4)

    def test_input_hash_retains_dag_model_prompt_original_images_and_connections(self):
        c=self.canvas(dag=True);p,run=self.started(c)
        self.assertEqual(loop_input_hash(c,'loop'),p['runInputHash'])
        for field,value in [('promptDraftText','edited'),('images',[]),('runSettings',{'engine':'api','provider_id':'p','model':'other'})]:
            other=copy.deepcopy(c);other['nodes'][1][field]=value
            self.assertNotEqual(loop_input_hash(other,'loop'),p['runInputHash'])
        run['taskIds']=['task'];run['slots']={};run['unknownCount']=1
        self.assertEqual(loop_input_hash(c,'loop'),p['runInputHash'])

    def test_completed_requires_each_original_task_bound_to_exact_slot(self):
        c=self.canvas();p,run=self.started(c);tasks=self.completed(c,p,run)
        self.assertEqual(native_run_result(c,p,tasks)['state'],'completed')
        outputs=loop_slots(c,p);outputs[p['loopPlan']['steps'][0]['key']]['images'].append({'url':'/output/foreign.png'})
        self.assertEqual(native_run_result(c,p,tasks)['state'],'accepted')
        for field in ['canvas_id','node_id','assistant_action_id','input_hash','model','provider_id']:
            other=copy.deepcopy(tasks);other[0][field]='foreign'
            with self.subTest(field=field),self.assertRaises(HTTPException):native_run_result(c,p,other)

    def test_copy_branch_exact_saved_results_and_persisted_status(self):
        c=self.canvas(dag=True);c['nodes'][0]['showPrompt']=False;p,run=self.started(c);tasks=self.completed(c,p,run)
        self.assertEqual(native_run_result(c,p,tasks)['state'],'completed')
        copy_step=next(s for s in p['loopPlan']['steps'] if s['kind']=='copy');run['slots'][copy_step['key']]['status']='ready'
        self.assertEqual(native_run_result(c,p,tasks)['state'],'accepted')

    def test_slot_origin_connection_and_round_cannot_be_replaced(self):
        for mode in ['origin','connection','round','missing']:
            c=self.canvas();p,run=self.started(c);slot=loop_slots(c,p)[p['loopPlan']['steps'][0]['key']]
            if mode=='origin':slot['assistantNativeOrigin']['actionId']='foreign'
            elif mode=='connection':c['connections'][-2]['from']='foreign'
            elif mode=='round':slot['loopRoundIndex']=99
            else:c['nodes'].remove(slot)
            if mode=='missing':
                with self.assertRaises(HTTPException):loop_receipt(c,p)
            else:
                with self.assertRaises(HTTPException):loop_slots(c,p)

    def test_unknown_incomplete_and_duplicate_ledger_do_not_complete(self):
        c=self.canvas();p,run=self.started(c)
        self.assertEqual(loop_receipt(c,p)['unsubmittedSlots'],2)
        run['slots'][p['loopPlan']['steps'][0]['key']]['status']='submitting'
        self.assertEqual(loop_receipt(c,p)['state'],'submission_unknown')
        self.assertEqual(native_run_result(c,p,[])['state'],'submission_unknown')
        run['taskIds']=['unknown']
        with self.assertRaises(HTTPException):loop_receipt(c,p)

    def test_foreign_pending_and_invalid_model_budget_rejected(self):
        c=self.canvas();p,run=self.started(c);outputs=loop_slots(c,p)
        self.assertFalse(loop_foreign_busy(c,p))
        next(iter(outputs.values()))['pendingTasks']=[{'taskId':'foreign','kind':'image'}]
        self.assertTrue(loop_foreign_busy(c,p))
        for malformed in [[None], ['broken'], {'taskId':'foreign'}]:
            next(iter(outputs.values()))['pendingTasks']=malformed
            self.assertTrue(loop_foreign_busy(c,p))
        for rounds in [0,101,True]:
            with self.subTest(rounds=rounds),self.assertRaises(HTTPException):loop_plan(self.canvas(rounds),'loop')
        with self.assertRaises(HTTPException):loop_plan(self.canvas(),'loop',providers=[{'id':'p','image_models':['other']}])


if __name__=='__main__':unittest.main()
