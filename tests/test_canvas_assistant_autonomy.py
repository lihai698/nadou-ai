import unittest
from fastapi import HTTPException
from backend.canvas_assistant_autonomy import authorize, reserve, safe_action


class AutonomyTests(unittest.TestCase):
    def test_safe_edits_and_manual_boundaries(self):
        self.assertTrue(safe_action({'action':'shot_edit','chargeable':False}))
        for p in [{'action':'run','chargeable':True},{'action':'export','chargeable':False},{'action':'shot_column','arguments':{'columnAction':'delete'}}]:
            self.assertFalse(safe_action(p))

    def test_scope_budget_idempotency_and_stop(self):
        turn={'state':'waiting_confirmation','provider':'text','model':'chat','nativeActions':[{'action':'run','state':'pending','runSettings':{'provider':'image','model':'draw'}}]}
        models=[{'provider':'text','model':'chat'},{'provider':'image','model':'draw'}]
        authorize(turn,2,models)
        reserve(turn,'first','text','chat',1)
        reserve(turn,'first','text','chat',1)
        self.assertEqual(turn['authorization']['used'],1)
        with self.assertRaises(HTTPException):reserve(turn,'other-model','image','different',1)
        reserve(turn,'second','image','draw',1)
        with self.assertRaises(HTTPException):reserve(turn,'over-budget','image','draw',1)
        authorize(turn,3,models)
        self.assertEqual(turn['authorization']['used'],2)
        turn['state']='cancelled'
        with self.assertRaises(HTTPException):reserve(turn,'stopped','image','draw',1)
        with self.assertRaises(HTTPException):authorize(turn,4,models)

    def test_cannot_authorize_unselected_model_or_unknown_task(self):
        turn={'state':'waiting_confirmation','provider':'text','model':'chat','nativeActions':[{'state':'submission_unknown'}]}
        with self.assertRaises(HTTPException):authorize(turn,2,[{'provider':'unselected','model':'model'}])
        authorize(turn,2,[{'provider':'text','model':'chat'}])
        with self.assertRaises(HTTPException):reserve(turn,'unknown','text','chat',1)
