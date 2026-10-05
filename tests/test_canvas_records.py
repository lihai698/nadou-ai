import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.canvas_records import (
    canvas_record,
    normalize_canvas_color,
    normalize_canvas_kind,
)


class CanvasRecordsTests(unittest.TestCase):
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
