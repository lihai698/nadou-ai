"""候选模型切换规则的独立回归，不读取配置或调用网络。"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.model_candidates import can_try_next_model, candidate_models, classify_model_failure


class ModelCandidateTests(unittest.TestCase):
    def test_candidates_keep_configured_order_and_explicit_selection(self):
        self.assertEqual(
            candidate_models("", [" first ", "second", "first"], "fallback"),
            ["first", "second"],
        )
        self.assertEqual(candidate_models(" selected ", ["first", "second"], "fallback"), ["selected"])
        self.assertEqual(candidate_models("", [], " fallback "), ["fallback"])

    def test_only_unaccepted_model_or_transport_failures_are_retryable(self):
        self.assertEqual(classify_model_failure(404, "model not found"), "retryable_model_unavailable")
        self.assertEqual(classify_model_failure(503, "gateway unavailable"), "retryable_transport")
        self.assertTrue(can_try_next_model(408, "timeout"))
        self.assertEqual(classify_model_failure(401, "invalid api key"), "terminal_auth")
        self.assertEqual(classify_model_failure(402, "quota exceeded"), "terminal_quota")
        self.assertEqual(classify_model_failure(400, "invalid parameter"), "terminal_request")
        self.assertEqual(classify_model_failure(503, "gateway", remote_task_id="task-1"), "accepted")
        self.assertFalse(can_try_next_model(503, "gateway", accepted=True))


if __name__ == "__main__":
    unittest.main()
