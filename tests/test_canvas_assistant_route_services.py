"""Independent assistant application services with explicit state and capability ports."""
import asyncio
import copy
import inspect
import json
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock,Mock

from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from backend import canvas_assistant_session_service as session
from backend import canvas_assistant_agent_runtime as agent
from backend import canvas_assistant_native_actions as native
from backend import canvas_assistant_turn_service as turn


def deps(fn,**overrides):
    values={p.name:Mock(side_effect=AssertionError('unexpected capability '+p.name)) for p in inspect.signature(fn).parameters.values() if p.kind==p.KEYWORD_ONLY}
    values.update(overrides);return values


class AssistantRouteServiceTests(unittest.IsolatedAsyncioTestCase):
    def test_identity_validates_id_before_loading_and_rejects_mismatch(self):
        calls=[]
        ports=deps(session.identity,checked_id=lambda value:calls.append(['check',value]),load_canvas=lambda value:(calls.append(['load',value]) or {'id':value}),user_id=lambda header,request:(calls.append(['user',header,request]) or 'owner'),HTTPException=HTTPException)
        self.assertEqual(session.identity('request','header','canvas',**ports),('owner',{'id':'canvas'}))
        self.assertEqual(calls,[['check','canvas'],['load','canvas'],['user','header','request']])
        ports['load_canvas']=lambda _: {'id':'foreign'}
        with self.assertRaises(HTTPException) as raised:session.identity(None,'','canvas',**ports)
        self.assertEqual(raised.exception.status_code,400)

    async def test_status_catalog_preserves_enabled_and_local_protocol_readiness(self):
        providers=[{'id':'normal','chat_models':['text'],'has_key':False},{'id':'local','protocol':'codex','chat_models':['code']},{'id':'off','enabled':False,'chat_models':['hidden']}]
        result=await session.status(**deps(session.status,providers=lambda:providers,apply_operations=False,HTTPException=HTTPException))
        self.assertEqual(result['stage'],'conversation');self.assertEqual([p['id'] for p in result['providers']],['normal','local'])
        self.assertEqual([p['ready'] for p in result['providers']],[False,True]);self.assertEqual(result['skills'],[])

    async def test_status_keeps_unavailable_knowledge_error_without_claiming_coverage(self):
        result=await session.status(**deps(session.status,providers=lambda:[],apply_operations=True,knowledge=SimpleNamespace(snapshot=Mock(side_effect=HTTPException(409,'stale'))),skills=SimpleNamespace(index=lambda:[{'id':'skill'}]),HTTPException=HTTPException))
        self.assertEqual(result['knowledge']['available'],False);self.assertEqual(result['knowledge']['coverage'],{});self.assertEqual(result['knowledge']['error'],'stale')
        self.assertEqual(result['skills'],[{'id':'skill'}])

    async def test_reference_assets_projects_only_allowed_fields_in_original_order(self):
        canvas={'id':'canvas'};ports=deps(session.reference_assets,identity=lambda *args:('user',canvas),asyncio=asyncio,
            load_reference_assets=lambda:[{'id':'external','url':'/assets/a.png','secret':'hidden'}],context_rules=SimpleNamespace(node_reference_assets=lambda _:[{'id':'node','url':'/assets/b.png','private':'hidden'}],reference_kind=lambda _:True))
        result=await session.reference_assets('canvas',None,'',**ports)
        self.assertEqual([x['id'] for x in result['items']],['node','external']);self.assertEqual(len(result['items'][0]),11)
        self.assertNotIn('secret',str(result));self.assertNotIn('private',str(result))

    async def test_sessions_reconcile_receipts_before_listing_in_reverse_order(self):
        calls=[];doc={'activeSessionId':'new','sessions':{'old':{'id':'old','title':'旧','createdAt':1},'new':{'id':'new','title':'新','createdAt':2}}}
        store=SimpleNamespace(reconcile=lambda *args:calls.append(['reconcile',*args]),transact=lambda *args:(calls.append(['transact',*args]) or doc))
        result=await session.sessions('canvas',None,'',**deps(session.sessions,identity=lambda *args:('user',{'assistant_receipts':{'receipt':1}}),store=store,asyncio=asyncio))
        self.assertEqual([r['id'] for r in result['sessions']],['new','old']);self.assertEqual([r[0] for r in calls],['reconcile','transact'])

    async def test_history_applies_public_projection_without_exposing_raw_action_plan(self):
        events=[];saved={'turns':[{'nativeActions':[{'id':'action','secret':'private'}]}]}
        result=await session.history('canvas','session',None,'',**deps(session.history,identity=lambda *args:('user',{}),asyncio=asyncio,
            store=SimpleNamespace(reconcile=lambda *args:events.append('reconcile'),history=lambda *args:copy.deepcopy(saved)),
            public_native=lambda action:{'id':action['id']},public_skill_usage=lambda _:[]))
        self.assertEqual(result,{'session':{'turns':[{'nativeActions':[{'id':'action'}],'skillsUsed':[]}]}})
        self.assertIn('secret',saved['turns'][0]['nativeActions'][0]);self.assertEqual(events,['reconcile'])

    async def test_cancel_only_cancels_owned_live_task_after_store_stop(self):
        events=[];task=SimpleNamespace(done=lambda:False,cancel=lambda:events.append('cancel'))
        payload=SimpleNamespace(canvasId='canvas',sessionId='session',requestId='request')
        for state in ('cancelled','completed'):
            events.clear();ports=deps(session.cancel,identity=lambda *args:('user',{}),checked_id=lambda _:None,asyncio=asyncio,
                store=SimpleNamespace(stop=lambda *args:(events.append('stop') or {'state':state})),running={('user','canvas','session','request'):task})
            self.assertEqual(await session.cancel(payload,None,'',**ports),{'state':state})
            self.assertEqual(events,['stop','cancel'] if state=='cancelled' else ['stop'])

    def test_workflow_fields_reads_only_existing_workflow_nodes(self):
        reader=Mock(return_value=['field']);canvas={'nodes':[{'id':'one','type':'prompt'},{'id':'two','type':'comfy'}]}
        ports=deps(native.current_workflow_fields,workflow_fields=reader)
        self.assertIsNone(native.current_workflow_fields(canvas,'one',**ports));self.assertIsNone(native.current_workflow_fields(canvas,'missing',**ports))
        self.assertEqual(native.current_workflow_fields(canvas,'two',**ports),['field']);reader.assert_called_once_with(canvas['nodes'][1])

    async def test_completed_agent_plan_checkpoints_without_model_or_tool_calls(self):
        checkpoint=Mock();payload=SimpleNamespace();state={'plan':{'state':'completed'}}
        result=await agent.drive_agent('user',payload,[],state,asyncio.Queue(),**deps(agent.drive_agent,store=SimpleNamespace(checkpoint=checkpoint),asyncio=asyncio))
        self.assertEqual(result['state'],'completed');checkpoint.assert_called_once_with('user',payload,state)

    async def test_completed_results_reads_only_original_tasks_and_local_result_media(self):
        query=AsyncMock(return_value={'status':'succeeded','result':{'images':['https://untrusted.invalid/a.png',{'url':'/output/result.png'},'/api/storage-files/local/a.png']}})
        state={'agent':{'consumedTasks':['used']},'proposals':[{'id':'one','taskId':'used','state':'submitted'},{'id':'two','taskId':'task','state':'submitted'}]}
        result=await turn.completed_results(state,**deps(turn.completed_results,query_image=query,HTTPException=HTTPException))
        self.assertEqual(result,[{'proposalId':'two','taskId':'task','images':['/output/result.png','/api/storage-files/local/a.png'],'status':'succeeded'}]);query.assert_awaited_once_with('task')

    async def test_completed_results_refuses_pending_failed_or_nonlocal_outputs(self):
        for task in ({'status':'running'},{'status':'failed'},{'status':'succeeded','result':{'images':['https://example.invalid/a.png']}}):
            query=AsyncMock(return_value=task)
            with self.subTest(task=task),self.assertRaises(HTTPException) as raised:
                await turn.completed_results({'agent':{'consumedTasks':[]},'proposals':[{'id':'p','taskId':'t','state':'submitted'}]},**deps(turn.completed_results,query_image=query,HTTPException=HTTPException))
            self.assertIn(raised.exception.status_code,(409,422))

    def test_change_proposal_mutates_only_requested_turn_inside_store_transaction(self):
        doc={'turns':[{'id':'turn','proposals':[{'id':'proposal','state':'pending'}]}]};calls=[]
        store=SimpleNamespace(session=lambda current,sid:current,transact=lambda user,cid,fn:(calls.append((user,cid)) or fn(doc)))
        payload=SimpleNamespace(canvasId='canvas',sessionId='session',turnId='turn',proposalId='proposal')
        result=turn.change_proposal('user',payload,lambda p,t:(p.update(state='dismissed') or p['state']),**deps(turn.change_proposal,store=store,HTTPException=HTTPException))
        self.assertEqual(result,'dismissed');self.assertEqual(calls,[('user','canvas')]);payload.proposalId='other'
        with self.assertRaises(HTTPException) as raised:turn.change_proposal('user',payload,Mock(),**deps(turn.change_proposal,store=store,HTTPException=HTTPException))
        self.assertEqual(raised.exception.status_code,404)

    async def test_stream_emits_ndjson_and_finishes_original_task(self):
        queue=asyncio.Queue();await queue.put({'type':'text_delta','text':'中文'});await queue.put({'type':'turn_end','state':'completed'})
        task=asyncio.create_task(asyncio.sleep(0));await task
        response=turn.stream_response(queue,task,**deps(turn.stream_response,asyncio=asyncio,json=json,StreamingResponse=StreamingResponse))
        result=[json.loads(row) async for row in response.body_iterator]
        self.assertEqual([x['type'] for x in result],['lifecycle','text_delta','turn_end']);self.assertEqual(response.headers['cache-control'],'no-store')

    async def test_stream_disconnect_waits_for_original_task_cleanup(self):
        stopped=[]
        async def worker():
            try:await asyncio.Event().wait()
            finally:stopped.append('saved')
        task=asyncio.create_task(worker());await asyncio.sleep(0)
        response=turn.stream_response(asyncio.Queue(),task,**deps(turn.stream_response,asyncio=asyncio,json=json,StreamingResponse=StreamingResponse))
        self.assertEqual(json.loads(await response.body_iterator.__anext__())['state'],'running')
        await response.body_iterator.aclose();self.assertTrue(task.done());self.assertEqual(stopped,['saved'])


if __name__=='__main__':unittest.main()
