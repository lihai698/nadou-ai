"""维护命令在非中文终端及输出重定向时仍应输出可读 UTF-8。"""

import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
TOOLS = ('backup-restore.py', 'check-data-formats.py',
         'cleanup-task-records.py', 'prepare-release.py')


class MaintenanceCliEncodingTests(unittest.TestCase):
    def run_tool(self, name, arguments):
        env = {**os.environ, 'PYTHONUTF8': '0', 'PYTHONIOENCODING': 'cp1252:strict'}
        return subprocess.run(
            [sys.executable, str(ROOT / 'tools' / name), *arguments],
            env=env, capture_output=True, encoding='utf-8', errors='strict',
            timeout=60, check=False,
        )

    def test_help_is_readable_with_legacy_terminal_encoding(self):
        for name in TOOLS:
            with self.subTest(tool=name):
                result = self.run_tool(name, ['--help'])
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertTrue(any('\u4e00' <= c <= '\u9fff' for c in result.stdout))
                self.assertNotIn('UnicodeEncodeError', result.stderr)

    def test_backup_success_and_error_keep_exit_status_and_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / '中文源目录'
            source.mkdir()
            (source / '说明.txt').write_text('自制内容', encoding='utf-8')
            snapshot = root / '快照'
            result = self.run_tool('backup-restore.py', [
                'create', '--source', str(source), '--snapshot', str(snapshot)])
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('快照操作通过', result.stdout)
            self.assertEqual((snapshot / '说明.txt').read_text(encoding='utf-8'), '自制内容')
            failed = self.run_tool('backup-restore.py', [
                'create', '--source', str(source), '--snapshot', str(snapshot)])
            self.assertEqual(failed.returncode, 1)
            self.assertIn('快照操作失败', failed.stderr)
            self.assertNotIn('UnicodeEncodeError', failed.stderr)

    def test_format_success_and_error_are_readable(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            result = self.run_tool('check-data-formats.py', ['--root', str(root)])
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('格式检查通过', result.stdout)
            failed = self.run_tool('check-data-formats.py', ['--root', str(root / '不存在')])
            self.assertEqual(failed.returncode, 1)
            self.assertIn('格式检查失败', failed.stderr)

    def test_cleanup_preview_and_error_do_not_delete_records(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            record = root / 'canvas_img_encoding.json'
            content = b'{"id":"canvas_img_encoding","status":"succeeded","updated_at":0}'
            record.write_bytes(content)
            result = self.run_tool('cleanup-task-records.py', ['--root', str(root)])
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('只读预览', result.stdout)
            failed = self.run_tool('cleanup-task-records.py', [
                '--root', str(root), '--ttl-days', '-1'])
            self.assertEqual(failed.returncode, 2)
            self.assertIn('清理未执行', failed.stderr)
            self.assertEqual(record.read_bytes(), content)


if __name__ == '__main__':
    unittest.main()
