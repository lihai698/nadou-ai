"""RunningHub 回包解析规则的独立回归。"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.runninghub_protocol import runninghub_extract_task_id, runninghub_query_status


class RunningHubProtocolTests(unittest.TestCase):
    def test_query_status_keeps_root_then_nested_priority(self):
        self.assertEqual(runninghub_query_status({"status": "RUNNING", "data": {"status": "DONE"}}), "running")
        self.assertEqual(runninghub_query_status({"data": {"taskStatus": "QUEUED"}}), "queued")
        self.assertEqual(runninghub_query_status({"state": 3}), "3")
        self.assertEqual(runninghub_query_status({"status": None, "data": {"status": ""}}), "")
        self.assertEqual(runninghub_query_status([]), "")

    def test_extract_task_id_keeps_root_then_nested_priority(self):
        self.assertEqual(runninghub_extract_task_id({"taskId": "root-1", "data": {"taskId": "nested-1"}}), "root-1")
        self.assertEqual(runninghub_extract_task_id({"data": {"task_id": "nested-2"}}), "nested-2")
        self.assertEqual(runninghub_extract_task_id({"id": 123}), "123")
        self.assertEqual(runninghub_extract_task_id({"data": {"id": ""}}), "")
        self.assertEqual(runninghub_extract_task_id(None), "")


if __name__ == "__main__":
    unittest.main()
