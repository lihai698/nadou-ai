"""阶段 11 远端任务协议的本地纯规则回归，不连接任何供应商。"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.remote_task_protocol import (
    IMAGE_TASK_FAILED_STATUSES,
    IMAGE_TASK_SUCCESS_STATUSES,
    REMOTE_CANCELLED,
    REMOTE_FAILED,
    REMOTE_PENDING,
    REMOTE_RUNNING,
    REMOTE_SUCCEEDED,
    REMOTE_UNKNOWN,
    RemoteTaskContract,
    cancel_remote_task,
    local_stop_decision,
    normalize_remote_status,
    observe_remote_task,
    provider_task_contract,
    remote_status_from_payload,
    remote_task_decision,
    submission_summary,
    image_task_data,
    image_task_status,
)


class RemoteTaskProtocolTests(unittest.TestCase):
    def test_image_task_status_parser_preserves_legacy_shapes(self):
        self.assertEqual(image_task_data({"data": {"status": "queued"}})["status"], "queued")
        self.assertEqual(image_task_data({"status": "running"})["status"], "running")
        self.assertEqual(image_task_data([]), {})
        self.assertEqual(image_task_status({"data": {"task_status": "processing"}}), "PROCESSING")
        self.assertEqual(image_task_status({"data": {"status": "provider-new-state"}}), "PROVIDER-NEW-STATE")
        self.assertEqual(image_task_status({}), "")
        self.assertIn("SUCCEEDED", IMAGE_TASK_SUCCESS_STATUSES)
        self.assertIn("FAILED", IMAGE_TASK_FAILED_STATUSES)

    def test_normalizes_common_image_video_and_comfy_statuses(self):
        for value, expected in {
            "queued": REMOTE_PENDING,
            "PROCESSING": REMOTE_RUNNING,
            "completed": REMOTE_SUCCEEDED,
            "failure": REMOTE_FAILED,
            "CANCELLED": REMOTE_CANCELLED,
            "provider-new-state": REMOTE_UNKNOWN,
        }.items():
            with self.subTest(value=value):
                self.assertEqual(normalize_remote_status(value), expected)
        self.assertEqual(remote_status_from_payload({"data": {"task_status": "done"}}), REMOTE_SUCCEEDED)
        self.assertEqual(remote_status_from_payload({"videos": ["/local/test.mp4"]}), REMOTE_SUCCEEDED)
        self.assertEqual(remote_status_from_payload({"data": {"message": "still working"}}), REMOTE_UNKNOWN)

    def test_submission_extracts_only_id_and_defaults_to_pending(self):
        summary = submission_summary(
            {"id": "mock", "protocol": "openai"},
            "video",
            {"data": {"taskId": "remote-local-1", "prompt": "不应保存"}},
        )
        self.assertEqual(summary["remote_task_id"], "remote-local-1")
        self.assertEqual(summary["status"], REMOTE_PENDING)
        self.assertFalse(summary["raw_persisted"])
        self.assertNotIn("prompt", summary)
        with self.assertRaises(ValueError):
            submission_summary("mock", "image", {"data": {"status": "accepted"}})

    def test_transport_and_query_404_remain_unknown_without_resubmit(self):
        for observation in (
            observe_remote_task(operation="query", transport_error=True),
            observe_remote_task(operation="query", http_status=503),
            observe_remote_task(operation="query", http_status=404),
        ):
            self.assertEqual(observation.status, REMOTE_UNKNOWN)
            decision = remote_task_decision(REMOTE_RUNNING, observation)
            self.assertEqual(decision.status, REMOTE_UNKNOWN)
            self.assertFalse(decision.should_resubmit)
            self.assertTrue(decision.preserve_task_id)

    def test_submit_4xx_is_explicit_failure_but_submit_5xx_is_unknown(self):
        rejected = observe_remote_task(operation="submit", http_status=400)
        self.assertEqual(rejected.status, REMOTE_FAILED)
        self.assertTrue(rejected.remote_confirmed)
        uncertain = observe_remote_task(operation="submit", http_status=502)
        self.assertEqual(uncertain.status, REMOTE_UNKNOWN)
        self.assertFalse(uncertain.remote_confirmed)

    def test_terminal_result_cannot_be_erased_by_later_query_failure(self):
        success = remote_task_decision(
            REMOTE_RUNNING,
            observe_remote_task({"status": "success", "id": "r1"}),
        )
        self.assertEqual(success.status, REMOTE_SUCCEEDED)
        retained = remote_task_decision(
            success.status,
            observe_remote_task(operation="query", http_status=503),
        )
        self.assertEqual(retained.status, REMOTE_SUCCEEDED)
        self.assertTrue(retained.remote_confirmed)

    def test_local_simulated_submit_query_success_closes_without_resubmit(self):
        # 用内存中的三次回包模拟供应商，不启动 HTTP 服务，也不调用任何外部平台。
        local_responses = [
            {"id": "local-video-1", "status": "queued"},
            {"id": "local-video-1", "status": "processing"},
            {"id": "local-video-1", "status": "completed", "videos": ["memory://video"]},
        ]
        current = REMOTE_PENDING
        for index, payload in enumerate(local_responses):
            operation = "submit" if index == 0 else "query"
            observation = observe_remote_task(payload, operation=operation, http_status=200)
            decision = remote_task_decision(current, observation)
            self.assertEqual(decision.preserve_task_id, True)
            self.assertFalse(decision.should_resubmit)
            self.assertEqual(decision.status, (REMOTE_PENDING, REMOTE_RUNNING, REMOTE_SUCCEEDED)[index])
            current = decision.status
        self.assertEqual(current, REMOTE_SUCCEEDED)

    def test_contracts_are_conservative_about_query_and_cancel(self):
        self.assertTrue(provider_task_contract("apimart", "image").supports_query)
        self.assertEqual(provider_task_contract("runninghub", "video").query_mode, "http_post")
        self.assertEqual(provider_task_contract("jimeng", "image").query_mode, "adapter")
        comfy = provider_task_contract({"id": "comfy", "protocol": "runninghub"}, "comfy")
        self.assertFalse(comfy.supports_query)
        for provider in ("openai", "apimart", "runninghub", "jimeng", "volcengine"):
            self.assertFalse(provider_task_contract(provider, "video").supports_cancel)

    def test_local_stop_keeps_id_and_never_claims_remote_cancel(self):
        stopped = local_stop_decision(REMOTE_RUNNING)
        self.assertEqual(stopped.status, REMOTE_RUNNING)
        self.assertFalse(stopped.remote_confirmed)
        self.assertFalse(stopped.should_resubmit)
        self.assertIn("未被取消", stopped.error)

    def test_only_explicit_cancel_response_can_confirm_cancel(self):
        unsupported = cancel_remote_task(provider_task_contract("openai", "video"), http_status=200)
        self.assertEqual(unsupported.status, REMOTE_UNKNOWN)
        cancellable = RemoteTaskContract("local-test", "local", "video", "http_get", True, True)
        confirmed = cancel_remote_task(cancellable, payload={"status": "cancelled", "id": "local-1"}, http_status=200)
        self.assertEqual(confirmed.status, REMOTE_CANCELLED)
        self.assertTrue(confirmed.remote_confirmed)
        unconfirmed = cancel_remote_task(cancellable, http_status=200, payload={"message": "accepted"})
        self.assertEqual(unconfirmed.status, REMOTE_UNKNOWN)
        self.assertFalse(unconfirmed.remote_confirmed)


if __name__ == "__main__":
    unittest.main()
