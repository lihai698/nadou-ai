"""Include the real JavaScript history regressions in the existing test command."""
import os
from pathlib import Path
import shutil
import subprocess
import unittest


class SmartCanvasHistoryTests(unittest.TestCase):
    def test_javascript_history_behaviors(self):
        node = os.environ.get('NODE_BINARY') or shutil.which('node')
        self.assertTrue(node, '智能画布测试需要 Node.js 18+，可通过 NODE_BINARY 指定路径。')
        result = subprocess.run(
            [node, str(Path(__file__).with_name('smart_canvas_history.test.cjs'))],
            capture_output=True, encoding='utf-8', errors='replace', timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
