"""阶段 11：本进程任务并发闸门的隔离验证。"""

import asyncio
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.task_concurrency import (
    DEFAULT_TASK_LIMITS,
    TaskConcurrencyGate,
    configured_task_limits,
    parse_task_limit,
)


class TaskConcurrencyRulesTests(unittest.TestCase):
    def test_invalid_limits_fall_back_without_exposing_values(self):
        self.assertEqual(parse_task_limit("2", 1), 2)
        self.assertEqual(parse_task_limit("0", 1), 1)
        self.assertEqual(parse_task_limit("999", 1), 1)
        self.assertEqual(parse_task_limit("not-a-number", 1), 1)
        limits = configured_task_limits({
            "NADOU_IMAGE_TASK_CONCURRENCY": "3",
            "NADOU_COMFY_TASK_CONCURRENCY": "-2",
            "NADOU_VIDEO_TASK_CONCURRENCY": "bad",
        })
        self.assertEqual(limits, {"image": 3, "comfy": 1, "video": 1})
        self.assertEqual(DEFAULT_TASK_LIMITS, {"image": 2, "comfy": 1, "video": 1})


class TaskConcurrencyGateTests(unittest.IsolatedAsyncioTestCase):
    async def test_gate_blocks_second_worker_and_reports_counts(self):
        gate = TaskConcurrencyGate(1, name="isolated")
        entered = asyncio.Event()
        release = asyncio.Event()

        async def first():
            async with gate:
                entered.set()
                await release.wait()

        async def second():
            async with gate:
                return "entered"

        first_task = asyncio.create_task(first())
        await asyncio.wait_for(entered.wait(), 1)
        second_task = asyncio.create_task(second())
        await asyncio.sleep(0)
        self.assertEqual(gate.status()["active"], 1)
        self.assertEqual(gate.status()["waiting"], 1)
        self.assertFalse(second_task.done())

        release.set()
        await asyncio.wait_for(first_task, 1)
        self.assertEqual(await asyncio.wait_for(second_task, 1), "entered")
        self.assertEqual(gate.status()["active"], 0)
        self.assertEqual(gate.status()["waiting"], 0)

    async def test_cancelled_waiter_is_removed(self):
        gate = TaskConcurrencyGate(1, name="isolated")
        async with gate:
            waiting = asyncio.create_task(gate.acquire())
            await asyncio.sleep(0)
            self.assertEqual(gate.status()["waiting"], 1)
            waiting.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await waiting
            self.assertEqual(gate.status()["waiting"], 0)


if __name__ == "__main__":
    unittest.main()
