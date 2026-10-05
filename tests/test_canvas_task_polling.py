"""Run the production-JavaScript task polling regressions."""
import os
from pathlib import Path
import shutil
import subprocess
import unittest


class CanvasTaskPollingTests(unittest.TestCase):
    def test_javascript_task_polling(self):
        node = os.environ.get('NODE_BINARY') or shutil.which('node')
        self.assertTrue(node, '查询回归测试需要 Node.js 18+ 或 NODE_BINARY。')
        result = subprocess.run(
            [node, str(Path(__file__).with_name('canvas_task_polling.test.cjs'))],
            capture_output=True, encoding='utf-8', errors='replace', timeout=30)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
