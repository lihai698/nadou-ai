import copy
import json
import tempfile
import unittest

from fastapi import HTTPException

from backend import canvas_assistant_plan as plans
from backend.canvas_assistant import AssistantStore


class PersistentPlanTests(unittest.TestCase):
    def test_sync_llm_evidence_completes_one_reserved_call_and_survives_restore(self):
        plan=self.claim(self.plan(steps=[{'id':'llm','description':'改写'},{'id':'image','description':'图片','dependsOn':['llm']}]))
        plan=plans.start_step(plan,'llm',execution_id='exec1',service_calls=1,confirmed=True)
        receipt={'id':'action','state':'completed','nodeIds':['llm-node'],'tasks':[],
                 'synchronousEvidence':{'kind':'llm','actionId':'action','nodeId':'llm-node','outputHash':'a'*64}}
        done=plans.record_step(plan,'llm',receipt,execution_id='exec1')
        self.assertEqual(plans.next_steps(json.loads(json.dumps(done))),['image'])
        self.assertEqual(plans.claim_plan(done,canvas_id='canvas1',session_id='session1',execution_id='exec1'),done)
        for evidence in [{'kind':'image'},{'outputHash':'not-hash'},{'actionId':'foreign'},{'nodeId':'foreign'}]:
            with self.subTest(evidence=evidence),self.assertRaises(HTTPException):
                plans.record_step(plan,'llm',{**receipt,'synchronousEvidence':{**receipt['synchronousEvidence'],**evidence}},execution_id='exec1')
        wrong=plans.start_step(self.claim(self.plan(steps=[{'id':'llm','description':'改写'}])),'llm',execution_id='exec1',service_calls=2,confirmed=True)
        with self.assertRaises(HTTPException):plans.record_step(wrong,'llm',receipt,execution_id='exec1')

    def plan(self, **changes):
        args = dict(plan_id='p1', canvas_id='canvas1', session_id='session1',
                    goal='保留商品并生成海报', preserve=['商品外观'], requirements=['一张图片'],
                    steps=[{'id': 'read', 'description': '读取实际输入', 'dependsOn': []},
                           {'id': 'run', 'description': '运行原生节点', 'dependsOn': ['read']}],
                    limits={'modelCalls': 6, 'toolCalls': 8, 'serviceCalls': 2, 'activeSeconds': 900})
        args.update(changes)
        return plans.create_plan(**args)

    def claim(self, plan=None, execution='exec1'):
        return plans.claim_plan(plan or self.plan(), canvas_id='canvas1', session_id='session1', execution_id=execution)

    def done_read(self):
        plan = plans.start_step(self.claim(), 'read', execution_id='exec1')
        return plans.record_step(plan, 'read', {'id': 'receipt-read', 'state': 'completed', 'nodeIds': ['input1'], 'tasks': []}, execution_id='exec1')

    def started_run(self):
        return plans.start_step(self.done_read(), 'run', execution_id='exec1', service_calls=2, confirmed=True)

    def accepted(self):
        return plans.record_step(self.started_run(), 'run', {'id': 'receipt-run', 'state': 'accepted', 'nodeIds': ['g1'],
            'tasks': [{'kind': 'comfy', 'id': 'original-task1'}, {'kind': 'comfy', 'id': 'original-task2'}]}, execution_id='exec1')

    def assert_http(self, status, operation):
        with self.assertRaises(HTTPException) as raised:
            operation()
        self.assertEqual(raised.exception.status_code, status)

    def test_goal_requirements_and_original_spec_survive_json(self):
        plan = self.plan()
        restored = json.loads(json.dumps(plan, ensure_ascii=False))
        self.assertEqual(restored['goal'], '保留商品并生成海报')
        self.assertEqual(restored['preserve'], ['商品外观'])
        self.assertEqual(restored['requirements'], ['一张图片'])
        self.assertEqual(plans.next_steps(restored), ['read'])

    def test_missing_duplicate_and_cyclic_dependencies_are_rejected(self):
        for steps in ([{'id': 'a', 'description': 'A', 'dependsOn': ['missing']}],
                      [{'id': 'a', 'description': 'A'}, {'id': 'a', 'description': 'B'}],
                      [{'id': 'a', 'description': 'A', 'dependsOn': ['b']}, {'id': 'b', 'description': 'B', 'dependsOn': ['a']}],
                      [{'id': 'a', 'description': 'A', 'dependsOn': ['a']}]):
            with self.subTest(steps=steps):
                self.assert_http(422, lambda: self.plan(steps=steps))

    def test_step_cannot_smuggle_results_or_executable_arguments(self):
        for field in ('state', 'taskId', 'receipt', 'script', 'model'):
            self.assert_http(422, lambda: self.plan(steps=[{'id': 'a', 'description': 'A', field: 'untrusted'}]))

    def test_limits_reject_negative_boolean_nan_and_unknown_keys(self):
        for limits in ({'modelCalls': -1}, {'modelCalls': True}, {'activeSeconds': float('nan')}, {'money': 100}):
            self.assert_http(422, lambda: self.plan(limits=limits))

    def test_default_limits_preserve_existing_round_budget_and_no_service_permission(self):
        plan = self.plan(limits=None)
        self.assertEqual(plan['budget']['limit'], {'modelCalls': 6, 'toolCalls': 8, 'serviceCalls': 0, 'activeSeconds': 900})

    def set_limit(self, plan, total, *, canvas='canvas1', session='session1'):
        return plans.set_service_limit(plan, total, canvas_id=canvas, session_id=session)

    def test_user_service_limit_changes_only_limit_and_is_an_independent_idempotent_copy(self):
        plan = self.done_read()
        before = copy.deepcopy(plan)
        changed = self.set_limit(plan, 4)
        expected = copy.deepcopy(plan)
        expected['budget']['limit']['serviceCalls'] = 4
        self.assertEqual(changed, expected)
        self.assertEqual(plan, before)
        self.assertEqual(self.set_limit(changed, 4), changed)
        self.assertEqual(plans.next_steps(changed), ['run'])
        changed['steps'][0]['receipt']['nodeIds'].append('other')
        self.assertEqual(plan, before)

    def test_user_service_limit_requires_strict_integer_and_accepts_zero_and_one_hundred(self):
        for total in (-1, 101, True, False, None, '2', 2.0, float('nan'), 10 ** 400):
            with self.subTest(total=str(total)):
                self.assert_http(422, lambda: self.set_limit(self.plan(), total))
        for total in (0, 100):
            with self.subTest(total=total):
                changed = self.set_limit(self.plan(), total)
                self.assertEqual(changed['budget']['limit']['serviceCalls'], total)

    def test_user_service_limit_rejects_foreign_canvas_or_session_and_invalid_plan(self):
        plan = self.plan()
        for canvas, session in [('other', 'session1'), ('canvas1', 'other')]:
            self.assert_http(409, lambda: self.set_limit(plan, 2, canvas=canvas, session=session))
        plan['budget']['used']['serviceCalls'] = 1
        before = copy.deepcopy(plan)
        self.assert_http(409, lambda: self.set_limit(plan, 2))
        self.assertEqual(plan, before)

    def test_user_service_limit_rejects_completed_and_cancelled_plans(self):
        completed = plans.start_step(self.done_read(), 'run', execution_id='exec1')
        completed = plans.record_step(completed, 'run', {'id': 'run-complete', 'state': 'completed'}, execution_id='exec1')
        cancelled = plans.stop_plan(self.done_read(), execution_id='exec1', reason='cancelled')
        for plan in (completed, cancelled):
            with self.subTest(state=plan['state']):
                self.assert_http(409, lambda: self.set_limit(plan, 4))

    def test_user_service_limit_rejects_running_waiting_result_and_unknown_steps(self):
        unknown = plans.stop_plan(self.started_run(), execution_id='exec1')
        for plan in (self.started_run(), self.accepted(), unknown):
            with self.subTest(state=plan['steps'][1]['state']):
                before = copy.deepcopy(plan)
                self.assert_http(409, lambda: self.set_limit(plan, 4))
                self.assertEqual(plan, before)

    def test_user_service_limit_may_be_set_while_waiting_confirmation_but_does_not_confirm(self):
        plan = self.done_read()
        plan['budget']['limit']['serviceCalls'] = 0
        waiting = plans.start_step(plan, 'run', execution_id='exec1', service_calls=2)
        changed = self.set_limit(waiting, 2)
        self.assertEqual(changed['steps'][1]['state'], 'waiting_confirmation')
        self.assertEqual(changed['budget']['used']['serviceCalls'], 0)
        self.assertEqual(changed['budget']['events'], {})
        self.assertIsNone(changed['steps'][1]['receipt'])
        smaller = self.set_limit(changed, 1)
        before = copy.deepcopy(smaller)
        self.assert_http(409, lambda: plans.start_step(smaller, 'run', execution_id='exec1', service_calls=2, confirmed=True))
        self.assertEqual(smaller, before)
        started = plans.start_step(changed, 'run', execution_id='exec1', service_calls=2, confirmed=True)
        self.assertEqual(started['budget']['used']['serviceCalls'], 2)

    def test_user_service_limit_cannot_drop_below_spent_calls_or_rewrite_events(self):
        plan = self.accepted()
        receipt = copy.deepcopy(plan['steps'][1]['receipt'])
        receipt.update(state='failed', error='原任务失败')
        plan = plans.record_step(plan, 'run', receipt, execution_id='exec1')
        before = copy.deepcopy(plan)
        self.assert_http(409, lambda: self.set_limit(plan, 1))
        self.assertEqual(plan, before)
        enlarged = self.set_limit(plan, 4)
        self.assertEqual(enlarged['budget']['used'], before['budget']['used'])
        self.assertEqual(enlarged['budget']['events'], before['budget']['events'])
        self.assertEqual(enlarged['steps'], before['steps'])
        self.assertEqual(self.set_limit(enlarged, 2), before)

    def test_user_service_limit_preserves_paused_plan_without_claiming_an_executor(self):
        plan = plans.stop_plan(self.done_read(), execution_id='exec1', reason='paused')
        changed = self.set_limit(plan, 3)
        self.assertEqual(changed['state'], 'paused')
        self.assertEqual(changed['executionId'], '')
        self.assertEqual(changed['stopReason'], 'paused')
        self.assertEqual(plans.next_steps(changed), [])

    def test_cross_canvas_session_and_parallel_claims_are_rejected(self):
        plan = self.claim()
        for canvas, session in [('other', 'session1'), ('canvas1', 'other')]:
            self.assert_http(409, lambda: plans.claim_plan(plan, canvas_id=canvas, session_id=session, execution_id='exec2'))
        self.assert_http(409, lambda: self.claim(plan, 'exec2'))
        self.assertEqual(self.claim(plan), plan)

    def test_dependency_must_complete_before_next_step(self):
        self.assert_http(409, lambda: plans.start_step(self.claim(), 'run', execution_id='exec1'))
        plan = self.done_read()
        self.assertEqual(plans.next_steps(plan), ['run'])
        self.assertEqual(plans.start_step(plan, 'read', execution_id='exec1'), plan)

    def test_waiting_confirmation_does_not_spend_budget(self):
        plan = plans.start_step(self.done_read(), 'run', execution_id='exec1', service_calls=2)
        self.assertEqual(plan['steps'][1]['state'], 'waiting_confirmation')
        self.assertEqual(plan['budget']['used']['serviceCalls'], 0)
        plan = plans.start_step(plan, 'run', execution_id='exec1', service_calls=2, confirmed=True)
        self.assertEqual(plan['budget']['used']['serviceCalls'], 2)
        self.assertEqual(plans.start_step(plan, 'run', execution_id='exec1', service_calls=2, confirmed=True), plan)

    def test_charge_is_idempotent_but_changed_event_is_rejected(self):
        plan = plans.charge_budget(self.claim(), 'model1', {'modelCalls': 1}, execution_id='exec1')
        self.assertEqual(plans.charge_budget(plan, 'model1', {'modelCalls': 1}, execution_id='exec1'), plan)
        self.assert_http(409, lambda: plans.charge_budget(plan, 'model1', {'modelCalls': 2}, execution_id='exec1'))
        self.assertEqual(plan['budget']['used']['modelCalls'], 1)

    def test_budget_overrun_changes_neither_source_nor_prior_spending(self):
        plan = plans.charge_budget(self.claim(), 'model1', {'modelCalls': 6}, execution_id='exec1')
        original = copy.deepcopy(plan)
        self.assert_http(409, lambda: plans.charge_budget(plan, 'model2', {'modelCalls': 1}, execution_id='exec1'))
        self.assertEqual(plan, original)
        self.assert_http(409, lambda: plans.start_step(self.done_read(), 'run', execution_id='exec1', service_calls=3, confirmed=True))

    def test_accepted_tasks_keep_original_ids_and_block_reexecution(self):
        plan = self.accepted()
        self.assertEqual(plan['steps'][1]['state'], 'waiting_result')
        self.assertEqual(plan['steps'][1]['receipt']['tasks'][0]['id'], 'original-task1')
        self.assertEqual(plans.start_step(plan, 'run', execution_id='exec1', service_calls=2, confirmed=True), plan)
        self.assertEqual(plan['budget']['used']['serviceCalls'], 2)

    def test_disconnect_resume_preserves_tasks_budget_and_invalidates_old_executor(self):
        plan = plans.stop_plan(self.accepted(), execution_id='exec1', reason='interrupted')
        restored = self.claim(json.loads(json.dumps(plan)), 'exec2')
        self.assertEqual(restored['steps'][1]['state'], 'waiting_result')
        self.assertEqual(restored['budget']['used']['serviceCalls'], 2)
        self.assert_http(409, lambda: plans.charge_budget(restored, 'old', {'modelCalls': 1}, execution_id='exec1'))
        self.assertEqual(plans.start_step(restored, 'run', execution_id='exec2', service_calls=2, confirmed=True), restored)

    def test_lost_acceptance_response_is_unknown_and_never_automatically_retried(self):
        plan = plans.stop_plan(self.started_run(), execution_id='exec1', reason='interrupted')
        plan = self.claim(plan, 'exec2')
        self.assertEqual(plan['steps'][1]['state'], 'unknown')
        self.assert_http(409, lambda: plans.start_step(plan, 'run', execution_id='exec2', service_calls=2, confirmed=True))
        self.assertEqual(plan['budget']['used']['serviceCalls'], 2)

    def test_user_stop_preserves_progress_and_cannot_be_resumed(self):
        plan = plans.stop_plan(self.accepted(), execution_id='exec1', reason='cancelled')
        self.assertEqual(plan['steps'][0]['state'], 'completed')
        self.assertEqual(plan['steps'][1]['receipt']['tasks'][1]['id'], 'original-task2')
        self.assert_http(409, lambda: self.claim(plan, 'exec2'))
        self.assert_http(409, lambda: plans.start_step(plan, 'run', execution_id='exec1'))

    def test_receipts_cannot_replace_tasks_or_fake_completed_from_unstarted_step(self):
        self.assert_http(409, lambda: plans.record_step(self.claim(), 'read', {'id': 'fake', 'state': 'completed'}, execution_id='exec1'))
        plan = self.accepted()
        receipt = copy.deepcopy(plan['steps'][1]['receipt'])
        receipt['tasks'][0]['id'] = 'replacement'
        self.assert_http(409, lambda: plans.record_step(plan, 'run', receipt, execution_id='exec1'))
        self.assert_http(422, lambda: plans.record_step(plan, 'run', {'id': 'x', 'state': 'completed', 'token': 'secret'}, execution_id='exec1'))

    def test_actual_receipt_completion_unlocks_dependencies_and_is_idempotent(self):
        plan = self.accepted()
        receipt = copy.deepcopy(plan['steps'][1]['receipt'])
        receipt['state'] = 'completed'
        plan = plans.record_step(plan, 'run', receipt, execution_id='exec1')
        self.assertEqual(plan['state'], 'completed')
        self.assertEqual(plans.next_steps(plan), [])
        self.assertEqual(plans.record_step(plan, 'run', receipt, execution_id='exec1'), plan)
        self.assertEqual(plan['budget']['used']['serviceCalls'], 2)

    def test_failed_task_does_not_refund_budget_or_allow_automatic_retry(self):
        plan = self.accepted()
        receipt = copy.deepcopy(plan['steps'][1]['receipt'])
        receipt.update(state='failed', error='原任务失败')
        plan = plans.record_step(plan, 'run', receipt, execution_id='exec1')
        self.assertEqual(plan['budget']['used']['serviceCalls'], 2)
        self.assert_http(409, lambda: plans.start_step(plan, 'run', execution_id='exec1', service_calls=2, confirmed=True))

    def test_real_assistant_store_round_trip_restores_original_tasks_without_a_new_queue(self):
        with tempfile.TemporaryDirectory() as root:
            store = AssistantStore(lambda: root, owner='owner1')
            session = store.create('user1', 'canvas1', '持久计划')
            plan = self.plan(session_id=session['id'])
            plan = plans.claim_plan(plan, canvas_id='canvas1', session_id=session['id'], execution_id='exec1')
            plan = plans.start_step(plan, 'read', execution_id='exec1')
            plan = plans.record_step(plan, 'read', {'id': 'read-receipt', 'state': 'completed'}, execution_id='exec1')
            plan = plans.start_step(plan, 'run', execution_id='exec1', service_calls=2, confirmed=True)
            plan = plans.record_step(plan, 'run', {'id': 'run-receipt', 'state': 'accepted', 'tasks': [{'kind': 'comfy', 'id': 'original1'}]}, execution_id='exec1')
            plan = plans.stop_plan(plan, execution_id='exec1', reason='interrupted')
            def save(doc):
                doc['sessions'][session['id']]['turns'].append({'id': 'turn1', 'state': 'interrupted', 'agent': {'plan': plan}})
            store.transact('user1', 'canvas1', save)
            disk = json.loads(store.path('user1', 'canvas1').read_text(encoding='utf-8'))
            restored = AssistantStore(lambda: root, owner='owner2').transact('user1', 'canvas1')
            self.assertEqual(disk, restored)
            plan = plans.claim_plan(restored['sessions'][session['id']]['turns'][0]['agent']['plan'],
                                    canvas_id='canvas1', session_id=session['id'], execution_id='exec2')
            self.assertEqual(plan['steps'][1]['receipt']['tasks'], [{'kind': 'comfy', 'id': 'original1'}])
            self.assertEqual(plan['budget']['used']['serviceCalls'], 2)

    def test_damaged_or_future_saved_plan_is_rejected_without_overwriting_source(self):
        for changed in ('missing-budget', 'future', 'bad-state', 'bad-used', 'bad-event'):
            plan = self.plan()
            if changed == 'missing-budget':
                del plan['budget']
            elif changed == 'future':
                plan['version'] = 2
            elif changed == 'bad-state':
                plan['steps'][0]['state'] = 'invented'
            elif changed == 'bad-used':
                plan['budget']['used']['serviceCalls'] = -2
            else:
                plan['budget']['events'] = {'fake': {'modelCalls': 1}}
            before = copy.deepcopy(plan)
            with self.subTest(changed=changed):
                self.assert_http(409, lambda: self.claim(plan))
                self.assertEqual(plan, before)

    def test_service_receipt_cannot_exceed_reserved_calls_or_omit_original_tasks(self):
        plan = self.started_run()
        for receipt in ({'id': 'r', 'state': 'completed'},
                        {'id': 'r', 'state': 'accepted', 'tasks': [{'kind': 'comfy', 'id': f't{i}'} for i in range(3)]}):
            self.assert_http(409, lambda: plans.record_step(plan, 'run', receipt, execution_id='exec1'))

    def test_reconcile_unknown_step_with_actual_saved_receipt_does_not_spend_again(self):
        plan = plans.stop_plan(self.started_run(), execution_id='exec1')
        plan = self.claim(plan, 'exec2')
        receipt = {'id': 'recovered', 'state': 'accepted', 'tasks': [{'kind': 'comfy', 'id': 'original-task1'}]}
        recovered = plans.record_step(plan, 'run', receipt, execution_id='exec2')
        self.assertEqual(recovered['steps'][1]['state'], 'waiting_result')
        self.assertEqual(recovered['budget']['used']['serviceCalls'], 2)
        self.assertEqual(plan['steps'][1]['state'], 'unknown')

    def test_actual_receipt_cannot_be_reused_to_complete_another_step(self):
        plan = self.done_read()
        plan = plans.start_step(plan, 'run', execution_id='exec1')
        self.assert_http(409, lambda: plans.record_step(plan, 'run', plan['steps'][0]['receipt'], execution_id='exec1'))

    def test_corrupted_step_state_cannot_replay_an_already_accepted_task(self):
        plan = self.accepted()
        plan['steps'][1]['state'] = 'pending'
        original = copy.deepcopy(plan)
        self.assert_http(409, lambda: plans.start_step(plan, 'run', execution_id='exec1', service_calls=2, confirmed=True))
        self.assertEqual(plan, original)

    def test_restore_rejects_completed_without_receipt_and_unreserved_running_service(self):
        for kind in ('no-receipt', 'no-reservation', 'unfinished-dependency'):
            plan = self.claim()
            if kind == 'no-receipt':
                plan['steps'][0]['state'] = 'completed'
            elif kind == 'no-reservation':
                plan['steps'][0].update(state='running', serviceCalls=2)
            else:
                plan['steps'][1]['state'] = 'running'
            self.assert_http(409, lambda: self.claim(plan))

    def test_enormous_numbers_are_rejected_cleanly(self):
        self.assert_http(422, lambda: self.plan(limits={'modelCalls': 10 ** 400}))
        plan = self.plan()
        plan['budget']['limit']['modelCalls'] = 10 ** 400
        self.assert_http(409, lambda: self.claim(plan))


if __name__ == '__main__':
    unittest.main()
