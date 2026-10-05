"""同一画布的并发 HTTP 保存只能接受一个相同基础版本的请求。"""

import asyncio
import json
import sys
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main


class CanvasConcurrentSaveTests(unittest.TestCase):
    def test_same_base_version_allows_one_save_and_rejects_the_other(self):
        with tempfile.TemporaryDirectory() as temporary:
            canvas_dir = Path(temporary)
            canvas_id = "isolated-concurrent"
            target = canvas_dir / f"{canvas_id}.json"
            original = {
                "id": canvas_id,
                "kind": "smart",
                "title": "原始画布",
                "updated_at": 2000,
                "nodes": [],
                "connections": [],
                "viewport": {"x": 0, "y": 0, "scale": 1},
            }
            target.write_text(json.dumps(original, ensure_ascii=False), encoding="utf-8")

            first_loaded = threading.Event()
            second_loaded = threading.Event()
            load_count = 0
            count_lock = threading.Lock()
            real_load_canvas = main.load_canvas

            def coordinated_load(requested_id):
                nonlocal load_count
                canvas = real_load_canvas(requested_id)
                with count_lock:
                    load_count += 1
                    call_number = load_count
                if call_number == 1:
                    first_loaded.set()
                    second_loaded.wait(timeout=1)
                elif call_number == 2:
                    second_loaded.set()
                return canvas

            async def send_save(title):
                async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=main.app),
                    base_url="http://canvas-concurrent.test",
                ) as client:
                    return await client.put(
                        f"/api/canvases/{canvas_id}",
                        json={
                            "title": title,
                            "nodes": [{"id": title, "type": "text"}],
                            "connections": [],
                            "viewport": {"x": 10, "y": 20, "scale": 1},
                            "base_updated_at": original["updated_at"],
                        },
                    )

            with (
                patch.object(main, "CANVAS_DIR", str(canvas_dir)),
                patch.object(main, "load_canvas", side_effect=coordinated_load),
                patch.object(main.manager, "broadcast_canvas_updated", new_callable=AsyncMock),
                ThreadPoolExecutor(max_workers=2) as executor,
            ):
                first = executor.submit(lambda: asyncio.run(send_save("第一个版本")))
                self.assertTrue(first_loaded.wait(timeout=3), "第一个请求未进入画布读取")
                second = executor.submit(lambda: asyncio.run(send_save("第二个版本")))
                responses = [first.result(timeout=5), second.result(timeout=5)]

            self.assertEqual(sorted(response.status_code for response in responses), [200, 409])
            accepted = next(response.json()["canvas"] for response in responses if response.status_code == 200)
            conflict = next(response.json()["detail"] for response in responses if response.status_code == 409)
            persisted = json.loads(target.read_text(encoding="utf-8"))
            self.assertEqual(persisted, accepted)
            self.assertEqual(conflict["canvas"], accepted)
            self.assertEqual(conflict["updated_at"], accepted["updated_at"])
            self.assertEqual(persisted["nodes"], [{"id": accepted["title"], "type": "text"}])
            self.assertGreater(persisted["updated_at"], original["updated_at"])


if __name__ == "__main__":
    unittest.main()
