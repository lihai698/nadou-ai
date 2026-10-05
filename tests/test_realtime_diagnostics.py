"""WebSocket diagnostics stay out of stdout and omit client/error text."""

import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend import realtime


class FakeWebSocket:
    def __init__(self, error=None):
        self.error = error
        self.messages = []

    async def accept(self):
        return None

    async def send_text(self, value):
        if self.error is not None:
            raise self.error
        self.messages.append(json.loads(value))


class RealtimeDiagnosticsTests(unittest.IsolatedAsyncioTestCase):
    async def test_startup_migrations_log_only_exception_types(self):
        import main

        private_error = RuntimeError("token=private-value")
        with patch.object(main, "set_global_loop"), patch.object(
            main, "configure_diagnostics"
        ), patch.object(main, "sync_static_html_versions"), patch.object(
            main,
            "migrate_asset_library_into_dirs",
            side_effect=private_error,
        ), patch.object(
            main,
            "migrate_double_extension_uploads",
            side_effect=private_error,
        ), patch.object(
            main,
            "migrate_mislabeled_image_extensions",
            side_effect=private_error,
        ), patch.object(main, "write_diagnostic") as write, patch(
            "builtins.print"
        ) as print_mock:
            await main.startup_event()

        messages = [call.args[0] for call in write.call_args_list]
        self.assertEqual(messages, [
            "startup asset library migration failed error=RuntimeError",
            "startup duplicate extension migration failed error=RuntimeError",
            "startup mislabeled extension migration failed error=RuntimeError",
        ])
        self.assertTrue(all("token=private-value" not in message for message in messages))
        print_mock.assert_not_called()

    async def test_main_websocket_endpoint_logs_only_exception_type(self):
        import main

        class EndpointManager:
            def __init__(self):
                self.disconnected = []

            async def connect(self, websocket, client_id):
                return None

            async def disconnect(self, websocket, client_id):
                self.disconnected.append((websocket, client_id))

        class BrokenWebSocket:
            async def receive_text(self):
                raise RuntimeError("authorization=private-value")

        socket = BrokenWebSocket()
        fake_manager = EndpointManager()
        with patch.object(main, "manager", fake_manager), patch.object(
            main, "write_diagnostic"
        ) as write, patch("builtins.print") as print_mock:
            await main.websocket_endpoint(socket, "client-1")

        self.assertEqual(fake_manager.disconnected, [(socket, "client-1")])
        write.assert_called_once_with("realtime websocket failed error=RuntimeError")
        print_mock.assert_not_called()

    async def test_connection_events_use_diagnostic_writer(self):
        manager = realtime.ConnectionManager()
        socket = FakeWebSocket()

        with patch.object(realtime, "write_diagnostic") as write:
            await manager.connect(socket, "client-with-private-context")
            await manager.disconnect(socket, "client-with-private-context")

        messages = [call.args[0] for call in write.call_args_list]
        self.assertTrue(any("realtime connected" in message for message in messages))
        self.assertTrue(any("realtime disconnected" in message for message in messages))
        self.assertTrue(all("client-with-private-context" not in message for message in messages))

    async def test_failures_log_exception_type_without_exception_text(self):
        manager = realtime.ConnectionManager()
        socket = FakeWebSocket()

        with patch.object(realtime, "write_diagnostic") as write:
            await manager.connect(socket, "client-1")
            write.reset_mock()
            socket.error = ValueError("token=private-value")
            await manager.broadcast_canvas_updated("canvas-1", 123)
            await manager.send_personal_message({"type": "notice"}, "client-1")

        messages = [call.args[0] for call in write.call_args_list]
        self.assertTrue(any("channel=canvas" in message for message in messages))
        self.assertTrue(any("personal_message failed" in message for message in messages))
        self.assertTrue(all("ValueError" in message for message in messages))
        self.assertTrue(all("token=private-value" not in message for message in messages))
        self.assertNotIn(socket, manager.active_connections)


if __name__ == "__main__":
    unittest.main()
