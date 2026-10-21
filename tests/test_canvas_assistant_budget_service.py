"""额度/授权事务服务可独立运行；不加载路由、真实存储或执行供应商任务。"""
import asyncio
import copy
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

from fastapi import HTTPException
from backend import canvas_assistant_budget_service as service
from backend import canvas_assistant_plan as plan
from backend.canvas_assistant_autonomy import authorize


class Store:
    def __init__(self, turn):
        self.doc={'sessions':{'session-a':{'turns':[turn]}}}
        self.calls=[]

    def session(self, doc, session_id):
        if session_id not in doc['sessions']:
            raise HTTPException(404,'missing fixture session')
        return doc['sessions'][session_id]

    def transact(self, user, canvas_id, change):
        self.calls.append((user,canvas_id))
        candidate=copy.deepcopy(self.doc)
        result=change(candidate)
        self.doc=candidate
        return result


class BudgetServiceTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        current=plan.create_plan(plan_id='plan-a',canvas_id='canvas-a',session_id='session-a',goal='读取画布后等待',
            steps=[{'id':'step-a','description':'读取画布'}])
        self.store=Store({'id':'turn-a','state':'waiting_confirmation','provider':'mock','model':'chat','agent':{'plan':current}})
        self.identity=Mock(return_value=('fixture-user',{'id':'canvas-a'}))
        self.request=object()

    def turn(self):return self.store.doc['sessions']['session-a']['turns'][0]

    def payload(self,total=2):
        return SimpleNamespace(canvasId='canvas-a',sessionId='session-a',requestId='turn-a',total=total,
            models=[SimpleNamespace(model_dump=lambda:{'provider':'mock','model':'chat'})])

    def used_plan(self,calls):
        current=plan.set_service_limit(self.turn()['agent']['plan'],calls+3,canvas_id='canvas-a',session_id='session-a')
        current=plan.claim_plan(current,canvas_id='canvas-a',session_id='session-a',execution_id='execution-a')
        current=plan.charge_budget(current,'fixture-prior',{'serviceCalls':calls},execution_id='execution-a')
        return plan.stop_plan(current,execution_id='execution-a',reason='paused')

    async def budget(self,payload=None):
        return await service.plan_budget(payload or self.payload(),self.request,'fixture-header',identity=self.identity,
            store=self.store,persistent_plan=plan,copy=copy,time=SimpleNamespace(time=lambda:12.5),asyncio=asyncio,HTTPException=HTTPException)

    async def authorization(self,payload=None,policy=authorize):
        return await service.authorization(payload or self.payload(),self.request,'fixture-header',identity=self.identity,
            store=self.store,authorize_autonomy=policy,persistent_plan=plan,copy=copy,asyncio=asyncio,HTTPException=HTTPException)

    async def test_budget_changes_only_limit_and_records_user_setting(self):
        before=copy.deepcopy(self.turn()['agent']['plan'])
        result=await self.budget()
        self.assertEqual(result['plan']['budget']['limit']['serviceCalls'],2)
        self.assertEqual(result['plan']['budget']['used'],before['budget']['used'])
        self.assertEqual(result['plan']['steps'],before['steps'])
        self.assertEqual(self.turn()['serviceBudgetAuthorizations'],[{'total':2,'at':12500}])
        self.assertEqual(self.store.calls,[('fixture-user','canvas-a')])
        self.identity.assert_called_once_with(self.request,'fixture-header','canvas-a')

    async def test_repeated_budget_does_not_append_authorization(self):
        first=await self.budget();second=await self.budget()
        self.assertEqual(first,second)
        self.assertEqual(len(self.turn()['serviceBudgetAuthorizations']),1)

    async def test_budget_response_is_a_copy_of_stored_plan(self):
        result=await self.budget();result['plan']['steps'][0]['description']='changed'
        self.assertEqual(self.turn()['agent']['plan']['steps'][0]['description'],'读取画布')

    async def test_missing_turn_or_plan_keeps_404(self):
        self.turn().pop('agent')
        with self.assertRaises(HTTPException) as missing_plan:await self.budget()
        self.assertEqual(missing_plan.exception.status_code,404)
        payload=self.payload();payload.requestId='missing'
        with self.assertRaises(HTTPException) as missing_turn:await self.budget(payload)
        self.assertEqual(missing_turn.exception.status_code,404)

    async def test_running_cancelled_completed_turns_cannot_change_budget(self):
        for state in ('running','cancelled','completed'):
            with self.subTest(state=state):
                self.turn()['state']=state
                before=copy.deepcopy(self.store.doc)
                with self.assertRaises(HTTPException) as caught:await self.budget()
                self.assertEqual(caught.exception.status_code,409);self.assertEqual(self.store.doc,before)

    async def test_history_cap_blocks_new_setting(self):
        self.turn()['serviceBudgetAuthorizations']=[{'total':0,'at':1}]*100
        before=copy.deepcopy(self.store.doc)
        with self.assertRaises(HTTPException) as caught:await self.budget()
        self.assertEqual(caught.exception.status_code,409);self.assertEqual(self.store.doc,before)

    async def test_last_allowed_setting_and_idempotence_at_history_cap(self):
        self.turn()['serviceBudgetAuthorizations']=[{'total':0,'at':1}]*99
        await self.budget();await self.budget()
        self.assertEqual(len(self.turn()['serviceBudgetAuthorizations']),100)

    async def test_budget_below_used_service_calls_is_rejected(self):
        self.turn()['agent']['plan']=self.used_plan(3)
        with self.assertRaises(HTTPException) as caught:await self.budget()
        self.assertEqual(caught.exception.status_code,409)
        self.assertIn('已经使用',caught.exception.detail)

    async def test_identity_failure_prevents_any_transaction(self):
        self.identity.side_effect=HTTPException(400,'fixture canvas mismatch')
        with self.assertRaises(HTTPException):await self.budget()
        self.assertEqual(self.store.calls,[])

    async def test_authorization_without_plan_does_not_create_plan(self):
        self.turn().pop('agent')
        result=await self.authorization()
        self.assertEqual(result['authorization'],{'limit':2,'used':0,'models':[{'provider':'mock','model':'chat'}],'reservations':{}})
        self.assertNotIn('agent',self.turn())
        result['authorization']['models'][0]['model']='changed'
        self.assertEqual(self.turn()['authorization']['models'][0]['model'],'chat')

    async def test_authorization_updates_only_remaining_plan_allowance(self):
        self.turn()['agent']['plan']=self.used_plan(2)
        self.turn()['authorization']={'limit':2,'used':1,'models':[{'provider':'mock','model':'chat'}],'reservations':{'prior':{'provider':'mock','model':'chat','calls':1}}}
        result=await self.authorization(self.payload(3))
        self.assertEqual(result['authorization']['used'],1)
        self.assertEqual(self.turn()['agent']['plan']['budget']['limit']['serviceCalls'],4)
        self.assertEqual(self.turn()['agent']['plan']['budget']['used']['serviceCalls'],2)
        self.assertEqual(result['authorization']['reservations']['prior']['calls'],1)

    async def test_authorization_missing_turn_keeps_404(self):
        payload=self.payload();payload.requestId='missing'
        with self.assertRaises(HTTPException) as caught:await self.authorization(payload)
        self.assertEqual(caught.exception.status_code,404)

    async def test_unselected_model_or_cancelled_turn_keeps_rejection(self):
        payload=self.payload();payload.models=[SimpleNamespace(model_dump=lambda:{'provider':'other','model':'chat'})]
        with self.assertRaises(HTTPException) as unselected:await self.authorization(payload)
        self.assertEqual(unselected.exception.status_code,409)
        self.turn()['state']='cancelled'
        with self.assertRaises(HTTPException) as cancelled:await self.authorization()
        self.assertEqual(cancelled.exception.status_code,409)

    async def test_existing_policy_callback_receives_original_payload(self):
        policy=Mock(wraps=authorize)
        await self.authorization(policy=policy)
        policy.assert_called_once()
        turn,total,models=policy.call_args.args
        self.assertEqual((turn['id'],total,models),('turn-a',2,[{'provider':'mock','model':'chat'}]))


if __name__=='__main__':unittest.main()
