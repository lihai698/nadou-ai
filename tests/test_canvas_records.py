import unittest
import copy
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.canvas_records import (
    canvas_record,
    normalize_canvas_color,
    normalize_canvas_kind,
)
from backend import canvas_records


class CanvasRecordsTests(unittest.TestCase):
    def test_sort_active_records_preserves_priority_fallback_and_stability(self):
        records = [
            {"id": "recent", "updated_at": 90},
            {"id": "pinned-old", "pinned": True, "updated_at": 10},
            {"id": "created", "updated_at": 0, "created_at": 80},
            {"id": "same-a", "updated_at": "80"},
            {"id": "same-b", "created_at": 80},
            {"id": "pinned-new", "pinned": True, "updated_at": 20},
            {"id": "no-time"},
        ]
        before = copy.deepcopy(records)
        result = canvas_records.sort_canvas_records(records)
        self.assertEqual([r["id"] for r in result],
                         ["pinned-new", "pinned-old", "recent", "created", "same-a", "same-b", "no-time"])
        self.assertEqual(records, before)
        self.assertIsNot(result, records)
        self.assertTrue(all(any(item is original for original in records) for item in result))

    def test_sort_deleted_records_only_uses_deleted_time(self):
        records = [{"id": "old", "deleted_at": 10, "pinned": True},
                   {"id": "new-a", "deleted_at": 20},
                   {"id": "new-b", "deleted_at": 20}]
        before = copy.deepcopy(records)
        result = canvas_records.sort_canvas_records(records, include_deleted=True)
        self.assertEqual([r["id"] for r in result], ["new-a", "new-b", "old"])
        self.assertEqual(records, before)
        self.assertIsNot(result, records)

    def test_sort_empty_and_invalid_fields_keep_existing_contract(self):
        self.assertEqual(canvas_records.sort_canvas_records([]), [])
        self.assertEqual(canvas_records.sort_canvas_records([], include_deleted=True), [])
        with self.assertRaises(ValueError):
            canvas_records.sort_canvas_records([{"updated_at": "invalid"}])
        with self.assertRaises(KeyError):
            canvas_records.sort_canvas_records([{}], include_deleted=True)

    def test_normalize_kind_and_color_keep_public_values_bounded(self):
        self.assertEqual(normalize_canvas_kind(" SMART "), "smart")
        self.assertEqual(normalize_canvas_kind("unknown"), "classic")
        self.assertEqual(normalize_canvas_color(" Blue "), "blue")
        self.assertEqual(normalize_canvas_color("#fff"), "")

    def test_canvas_record_preserves_public_fields_and_limits_owner(self):
        record = canvas_record(
            {
                "id": "c1",
                "title": "测试画布",
                "kind": "SMART",
                "owner": "x" * 60,
                "color": "violet",
                "pinned": 1,
                "nodes": [{"id": 1}, {"id": 2}],
                "project": " project-a ",
                "created_at": 10,
                "updated_at": 20,
            }
        )
        self.assertEqual(record["kind"], "smart")
        self.assertEqual(record["color"], "violet")
        self.assertEqual(record["owner"], "x" * 40)
        self.assertTrue(record["pinned"])
        self.assertEqual(record["project"], "project-a")
        self.assertEqual(record["node_count"], 2)

    def test_canvas_record_defaults_match_existing_api_shape(self):
        record = canvas_record({"id": "c2", "nodes": None})
        self.assertEqual(record["icon"], "🧩")
        self.assertEqual(record["kind"], "classic")
        self.assertEqual(record["project"], "default")
        self.assertEqual(record["color"], "")
        self.assertEqual(record["node_count"], 0)


if __name__ == "__main__":
    unittest.main()
