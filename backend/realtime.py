"""WebSocket 实时通知的状态和事件循环边界。

这个模块只管理内存中的 WebSocket 连接，不读取配置、用户文件或供应商状态。
应用入口负责注册路由并把运行中的事件循环交给 :func:`set_global_loop`；后台
线程需要推送通知时通过 :func:`schedule_coroutine` 投递到该循环。
"""

import asyncio
import json
import time
from typing import Any, Awaitable, Callable, Dict, List, Optional

from .diagnostics import write_diagnostic


def _default_now_ms() -> int:
    return int(time.time() * 1000)


# 只由本模块拥有。main.py 不再直接读写事件循环状态。
GLOBAL_LOOP: Optional[asyncio.AbstractEventLoop] = None


def set_global_loop(loop: Optional[asyncio.AbstractEventLoop]) -> None:
    """记录应用当前的事件循环，供后台线程安全投递协程。"""

    global GLOBAL_LOOP
    GLOBAL_LOOP = loop


def get_global_loop() -> Optional[asyncio.AbstractEventLoop]:
    """返回当前事件循环；没有启动应用时返回 ``None``。"""

    return GLOBAL_LOOP


def schedule_coroutine(coro: Awaitable[Any]):
    """把后台通知协程投递到应用循环。

    返回 ``concurrent.futures.Future`` 或 ``None``。应用尚未启动、循环已关闭
    或投递失败时会关闭尚未执行的协程，避免产生 ``was never awaited`` 警告。
    通知本身是尽力而为的，调用方不需要因为实时连接不可用而中断业务流程。
    """

    loop = GLOBAL_LOOP
    if loop is None or loop.is_closed():
        close = getattr(coro, "close", None)
        if close:
            close()
        return None
    try:
        return asyncio.run_coroutine_threadsafe(coro, loop)
    except RuntimeError:
        close = getattr(coro, "close", None)
        if close:
            close()
        return None


class ConnectionManager:
    """维护实时连接并广播与页面兼容的通知 JSON。

    连接、用户映射和统计规则保持原入口行为：``canvas_`` 客户端不计入在线
    人数；发送失败只移除失败连接，不阻断其他连接的广播。
    """

    def __init__(self, now_ms: Optional[Callable[[], int]] = None):
        self.active_connections: List[Any] = []
        self.user_connections: Dict[str, Any] = {}
        self.connection_clients: Dict[Any, str] = {}
        self._now_ms = now_ms or _default_now_ms

    async def connect(self, websocket, client_id: str = None):
        await websocket.accept()
        self.active_connections.append(websocket)
        self.connection_clients[websocket] = client_id or f"anon-{id(websocket)}"
        if client_id:
            self.user_connections[client_id] = websocket
        write_diagnostic(
            f"realtime connected total={len(self.active_connections)} online={self.online_count()}"
        )
        await self.broadcast_count()

    async def disconnect(self, websocket, client_id: str = None):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        self.connection_clients.pop(websocket, None)
        if client_id and self.user_connections.get(client_id) is websocket:
            del self.user_connections[client_id]
        write_diagnostic(
            f"realtime disconnected total={len(self.active_connections)} online={self.online_count()}"
        )
        await self.broadcast_count()

    def online_count(self):
        visible_clients = {
            client_id for client_id in self.connection_clients.values()
            if client_id and not str(client_id).startswith("canvas_")
        }
        return len(visible_clients)

    async def broadcast_count(self):
        count = self.online_count()
        data = json.dumps({"type": "stats", "online_count": count})
        for connection in self.active_connections[:]:
            try:
                await connection.send_text(data)
            except Exception as e:
                write_diagnostic(
                    f"realtime broadcast failed channel=stats error={type(e).__name__}"
                )
                self.active_connections.remove(connection)

    async def broadcast_new_image(self, image_data: dict):
        data = json.dumps({"type": "new_image", "data": image_data})
        for connection in self.active_connections[:]:
            try:
                await connection.send_text(data)
            except Exception as e:
                write_diagnostic(
                    f"realtime broadcast failed channel=image error={type(e).__name__}"
                )
                self.active_connections.remove(connection)

    async def broadcast_canvas_updated(self, canvas_id: str, updated_at: int, client_id: str = ""):
        data = json.dumps({
            "type": "canvas_updated",
            "canvas_id": canvas_id,
            "updated_at": updated_at,
            "client_id": client_id or "",
        })
        for connection in self.active_connections[:]:
            try:
                await connection.send_text(data)
            except Exception as e:
                write_diagnostic(
                    f"realtime broadcast failed channel=canvas error={type(e).__name__}"
                )
                self.active_connections.remove(connection)

    async def broadcast_asset_library_updated(self, updated_at: int = 0):
        data = json.dumps({
            "type": "asset_library_updated",
            "updated_at": updated_at or self._now_ms(),
        })
        for connection in self.active_connections[:]:
            try:
                await connection.send_text(data)
            except Exception as e:
                write_diagnostic(
                    f"realtime broadcast failed channel=asset_library error={type(e).__name__}"
                )
                self.active_connections.remove(connection)

    async def send_personal_message(self, message: dict, client_id: str):
        ws = self.user_connections.get(client_id)
        if ws:
            try:
                await ws.send_text(json.dumps(message))
            except Exception as e:
                write_diagnostic(
                    f"realtime personal_message failed error={type(e).__name__}"
                )


manager = ConnectionManager()


__all__ = [
    "ConnectionManager",
    "GLOBAL_LOOP",
    "get_global_loop",
    "manager",
    "schedule_coroutine",
    "set_global_loop",
]
