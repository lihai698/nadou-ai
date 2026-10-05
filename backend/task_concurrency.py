"""本进程内的后台任务并发上限。

任务提交和远端供应商限制仍由应用入口决定；本模块只提供可测试的异步闸门，
避免同一服务进程无限创建本地图片、ComfyUI 或视频 worker。不同进程各自计数，
因此不能把它当成跨实例的全局队列。
"""

from __future__ import annotations

import asyncio
import os
from typing import Mapping, Optional
import weakref


MAX_TASK_CONCURRENCY = 32
DEFAULT_TASK_LIMITS = {
    "image": 2,
    "comfy": 1,
    "video": 1,
}


def parse_task_limit(value: object, fallback: int) -> int:
    """把环境变量转换为 1..32 的整数；非法值回退且不抛出。"""

    try:
        number = int(str(value).strip())
    except (TypeError, ValueError, OverflowError):
        return int(fallback)
    if number < 1 or number > MAX_TASK_CONCURRENCY:
        return int(fallback)
    return number


def configured_task_limits(environ: Optional[Mapping[str, str]] = None) -> dict[str, int]:
    """读取本进程任务上限；未配置时使用保守默认值。"""

    values = os.environ if environ is None else environ
    names = {
        "image": "NADOU_IMAGE_TASK_CONCURRENCY",
        "comfy": "NADOU_COMFY_TASK_CONCURRENCY",
        "video": "NADOU_VIDEO_TASK_CONCURRENCY",
    }
    return {
        kind: parse_task_limit(values.get(name), DEFAULT_TASK_LIMITS[kind])
        for kind, name in names.items()
    }


class TaskConcurrencyGate:
    """绑定到当前事件循环的异步并发闸门。"""

    def __init__(self, limit: int, *, name: str = "task") -> None:
        self.limit = parse_task_limit(limit, DEFAULT_TASK_LIMITS.get(name, 1))
        self.name = str(name or "task")[:32]
        self._states: weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, dict] = weakref.WeakKeyDictionary()

    def _state(self) -> dict:
        loop = asyncio.get_running_loop()
        state = self._states.get(loop)
        if state is None:
            state = {
                "semaphore": asyncio.Semaphore(self.limit),
                "active": 0,
                "waiting": 0,
            }
            self._states[loop] = state
        return state

    async def acquire(self) -> None:
        state = self._state()
        state["waiting"] += 1
        try:
            await state["semaphore"].acquire()
        except BaseException:
            state["waiting"] -= 1
            raise
        state["waiting"] -= 1
        state["active"] += 1

    def release(self) -> None:
        state = self._state()
        if state["active"] <= 0:
            raise RuntimeError("任务并发闸门未持有")
        state["active"] -= 1
        state["semaphore"].release()

    async def __aenter__(self) -> "TaskConcurrencyGate":
        await self.acquire()
        return self

    async def __aexit__(self, exc_type, exc, traceback) -> None:
        self.release()

    def status(self) -> dict[str, int | str]:
        """返回不含任务内容的当前计数。"""

        active = sum(int(state["active"]) for state in self._states.values())
        waiting = sum(int(state["waiting"]) for state in self._states.values())
        return {"name": self.name, "limit": self.limit, "active": active, "waiting": waiting}


__all__ = [
    "DEFAULT_TASK_LIMITS",
    "MAX_TASK_CONCURRENCY",
    "TaskConcurrencyGate",
    "configured_task_limits",
    "parse_task_limit",
]
