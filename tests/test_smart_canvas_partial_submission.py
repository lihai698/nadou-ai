"""Run the production JavaScript submission regression in the Python suite."""
import os
from pathlib import Path
import shutil
import subprocess
import unittest


class SmartCanvasPartialSubmissionTests(unittest.TestCase):
    def test_partial_submission(self):
        node = os.environ.get('NODE_BINARY') or shutil.which('node')
        self.assertTrue(node, '智能画布测试需要 Node.js 18+，可通过 NODE_BINARY 指定路径。')
        result = subprocess.run(
            [node, str(Path(__file__).with_name('smart_canvas_partial_submission.test.cjs'))],
            capture_output=True, encoding='utf-8', errors='replace', timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
