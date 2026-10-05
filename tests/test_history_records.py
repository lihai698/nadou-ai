"""历史记录读取和公开列表规则的隔离测试。"""

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main
from backend.history_records import (
    history_record_timestamp,
    history_records_for_api,
    read_history_records,
)


class HistoryRecordRulesTests(unittest.TestCase):
    def test_public_history_filters_type_and_empty_images(self):
        records = [
            {"timestamp": 1, "images": ["old"], "type": "zimage"},
            {"timestamp": 4, "images": [], "type": "zimage"},
            {"timestamp": 3, "images": ["video"], "type": "video"},
            {"timestamp": 2, "images": ["default"]},
        ]
        self.assertEqual(
            [item["timestamp"] for item in history_records_for_api(records)],
            [3, 2, 1],
        )
        self.assertEqual(
            [item["timestamp"] for item in history_records_for_api(records, "video")],
            [3],
        )
        self.assertEqual(records[0]["timestamp"], 1)

    def test_sort_timestamp_keeps_non_numeric_values_at_zero(self):
        self.assertEqual(history_record_timestamp({"timestamp": "later"}), 0)
        self.assertEqual(history_record_timestamp({"timestamp": 2}), 2.0)
        self.assertEqual(
            [item["id"] for item in history_records_for_api([
                {"id": "text", "timestamp": "bad", "images": ["x"]},
                {"id": "zero", "timestamp": 0, "images": ["x"]},
                {"id": "new", "timestamp": 8, "images": ["x"]},
            ])],
            ["new", "text", "zero"],
        )

    def test_read_history_uses_explicit_path_and_missing_is_empty(self):
        with tempfile.TemporaryDirectory(prefix="history-records-") as directory:
            path = Path(directory) / "history.json"
            self.assertEqual(read_history_records(path), [])
            path.write_text(json.dumps([{"images": ["自制"]}], ensure_ascii=False), encoding="utf-8")
            self.assertEqual(read_history_records(path)[0]["images"], ["自制"])


class HistoryRecordApiTests(unittest.IsolatedAsyncioTestCase):
    async def test_history_route_uses_shared_rules_with_isolated_file(self):
        with tempfile.TemporaryDirectory(prefix="history-record-api-") as directory:
            path = Path(directory) / "history.json"
            path.write_text(json.dumps([
                {"timestamp": 1, "images": ["old"], "type": "zimage"},
                {"timestamp": 4, "images": [], "type": "zimage"},
                {"timestamp": 3, "images": ["video"], "type": "video"},
            ], ensure_ascii=False), encoding="utf-8")
            with patch.object(main, "HISTORY_FILE", str(path)):
                async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=main.app),
                    base_url="http://history-records.test",
                ) as client:
                    response = await client.get("/api/history", params={"type": "video"})
                    self.assertEqual(response.status_code, 200, response.text)
                    self.assertEqual([item["timestamp"] for item in response.json()], [3])


if __name__ == "__main__":
    unittest.main()
