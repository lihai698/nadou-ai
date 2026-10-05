"""The current WebSocket contract, without user files or generation services."""

import asyncio
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from main import ConnectionManager
from backend.realtime import (
    ConnectionManager as BackendConnectionManager,
    get_global_loop,
    schedule_coroutine,
    set_global_loop,
)


class FakeWebSocket:
    def __init__(self, fail_send=False):
        self.accepted = False
        self.messages = []
        self.fail_send = fail_send

    async def accept(self):
        self.accepted = True

    async def send_text(self, value):
        if self.fail_send:
            raise ConnectionError("socket closed")
        self.messages.append(json.loads(value))


class RealtimeContractTests(unittest.IsolatedAsyncioTestCase):
    async def test_main_compatibility_entry_and_loop_scheduler(self):
        import main
        self.assertIs(main.ConnectionManager, BackendConnectionManager)

        previous_loop = get_global_loop()
        set_global_loop(asyncio.get_running_loop())
        events = []

        async def marker():
            events.append("ran")

        try:
            future = schedule_coroutine(marker())
            self.assertIsNotNone(future)
            await asyncio.to_thread(future.result, 1)
            self.assertEqual(events, ["ran"])
        finally:
            set_global_loop(previous_loop)

    async def test_online_count_excludes_canvas_clients_and_disconnect_updates_stats(self):
        manager = ConnectionManager()
        page = FakeWebSocket()
        canvas = FakeWebSocket()
        second_page = FakeWebSocket()

        await manager.connect(page, "page-1")
        await manager.connect(canvas, "canvas_1")
        await manager.connect(second_page, "page-1")
        self.assertTrue(all(sock.accepted for sock in (page, canvas, second_page)))
        self.assertEqual(manager.online_count(), 1)
        self.assertEqual([msg["online_count"] for msg in page.messages], [1, 1, 1])
        self.assertEqual(canvas.messages[0], {"type": "stats", "online_count": 1})

        await manager.disconnect(canvas, "canvas_1")
        self.assertEqual(page.messages[-1], {"type": "stats", "online_count": 1})
        await manager.disconnect(second_page, "page-1")
        self.assertEqual(manager.online_count(), 1)
        await manager.disconnect(page, "page-1")
        self.assertEqual(manager.online_count(), 0)

    async def test_public_notification_messages_keep_their_json_contract(self):
        manager = ConnectionManager()
        page = FakeWebSocket()
        await manager.connect(page, "page-1")

        image = {"type": "zimage", "url": "/assets/output/example.png"}
        await manager.broadcast_new_image(image)
        await manager.broadcast_canvas_updated("canvas-1", 123, "page-1")
        await manager.broadcast_asset_library_updated(456)
        await manager.send_personal_message({"type": "cloud_status", "status": "SUCCEED"}, "page-1")

        self.assertEqual(page.messages[1:], [
            {"type": "new_image", "data": image},
            {"type": "canvas_updated", "canvas_id": "canvas-1", "updated_at": 123, "client_id": "page-1"},
            {"type": "asset_library_updated", "updated_at": 456},
            {"type": "cloud_status", "status": "SUCCEED"},
        ])

    async def test_failed_broadcast_does_not_block_other_clients(self):
        manager = ConnectionManager()
        failed = FakeWebSocket()
        healthy = FakeWebSocket()
        await manager.connect(failed, "page-1")
        await manager.connect(healthy, "page-2")
        failed.fail_send = True

        await manager.broadcast_canvas_updated("canvas-1", 123)
        self.assertEqual(healthy.messages[-1], {
            "type": "canvas_updated", "canvas_id": "canvas-1", "updated_at": 123, "client_id": "",
        })
        self.assertNotIn(failed, manager.active_connections)


if __name__ == "__main__":
    unittest.main()
