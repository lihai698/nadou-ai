"""阶段 11 视频取消边界回归，只使用协议纯规则和内存回包。"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.remote_task_protocol import (  # noqa: E402
    REMOTE_CANCELLED,
    REMOTE_PENDING,
    REMOTE_RUNNING,
    REMOTE_UNKNOWN,
    cancel_remote_task,
    local_stop_decision,
    provider_task_contract,
)


class CanvasVideoCancelBoundaryTests(unittest.TestCase):
    # 这些是 main.py 当前实际含有视频适配分支或查询模式的供应商标识。
    # 它们都必须先取得供应商明确的取消接口和确认回执，才能开放取消。
    CURRENT_VIDEO_PROVIDERS = (
        "openai",
        "apimart",
        "volcengine",
        "runninghub",
        "jimeng",
        "tudou",
        "agnes",
        "lingjing",
        "yuli",
        "gemini",
        "gemini-cli",
        "codex",
    )

    def test_current_video_adapters_do_not_claim_remote_cancel(self):
        for provider in self.CURRENT_VIDEO_PROVIDERS:
            with self.subTest(provider=provider):
                contract = provider_task_contract(provider, "video")
                self.assertFalse(contract.supports_cancel)

                # 即使模拟回包写着 cancelled，未声明能力也不能把它写成已取消。
                observation = cancel_remote_task(
                    contract,
                    payload={"status": "cancelled", "id": "memory-video-1"},
                    http_status=200,
                )
                self.assertEqual(observation.status, REMOTE_UNKNOWN)
                self.assertFalse(observation.remote_confirmed)

    def test_local_stop_preserves_waiting_state_and_remote_unknown_boundary(self):
        for status in (REMOTE_PENDING, REMOTE_RUNNING):
            with self.subTest(status=status):
                decision = local_stop_decision(status)
                self.assertEqual(decision.status, status)
                self.assertTrue(decision.preserve_task_id)
                self.assertFalse(decision.remote_confirmed)
                self.assertFalse(decision.should_resubmit)
                self.assertIn("未被取消", decision.error)

    def test_only_explicitly_enabled_contract_can_confirm_cancel(self):
        # 纯内存模拟未来适配器的最小能力声明，确认规则本身可用；
        # 当前项目没有任何供应商使用这个声明。
        from backend.remote_task_protocol import RemoteTaskContract

        contract = RemoteTaskContract(
            "memory-test", "memory", "video", "http_post", True, True
        )
        observation = cancel_remote_task(
            contract,
            payload={"status": "cancelled", "task_id": "memory-video-2"},
            http_status=200,
        )
        self.assertEqual(observation.status, REMOTE_CANCELLED)
        self.assertTrue(observation.remote_confirmed)


if __name__ == "__main__":
    unittest.main()
