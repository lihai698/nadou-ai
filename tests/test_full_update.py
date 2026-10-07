"""Exercise complete-release validation and the detached Windows installer."""

import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main


class FullUpdateTests(unittest.TestCase):
    def test_release_zip_is_verified_before_install(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            files = {
                'main.py': b'print("ok")\n',
                'VERSION': b'2026.10.08\n',
                'static/index.html': b'<title>new</title>',
                'run.bat': b'@echo off\n',
            }
            archive = root / 'release.zip'
            manifest = {'version': '2026.10.08', 'files': {
                name: hashlib.sha256(content).hexdigest() for name, content in files.items()
            }}
            with zipfile.ZipFile(archive, 'w') as bundle:
                for name, content in files.items():
                    bundle.writestr(name, content)
                bundle.writestr('RELEASE_FILES.json', json.dumps(manifest))
            extracted = root / 'staged'
            self.assertEqual(main.verify_full_update_zip(str(archive), str(extracted), '2026.10.08'), sorted(files))
            self.assertEqual((extracted / 'main.py').read_bytes(), files['main.py'])
            with zipfile.ZipFile(archive, 'a') as bundle:
                bundle.writestr('data/private.json', b'private')
            with self.assertRaises(ValueError):
                main.verify_full_update_zip(str(archive), str(root / 'rejected'), '2026.10.08')
            self.assertFalse((root / 'rejected' / 'data' / 'private.json').exists())

    def test_download_reports_received_bytes(self):
        class FakeResponse:
            status_code = 200
            headers = {'Content-Length': '6'}
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def raise_for_status(self): pass
            def iter_content(self, chunk_size): return iter((b'abc', b'def'))

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'release.zip'
            states = []
            with patch.object(main, 'full_update_release', return_value=('https://example.test/file', 'file')), \
                 patch.object(main.requests, 'get', return_value=FakeResponse()), \
                 patch.object(main, 'write_full_update_status', side_effect=lambda _id, **value: states.append(value)):
                main.download_full_update('sample', '2026.10.08', str(path))
            self.assertEqual(path.read_bytes(), b'abcdef')
            self.assertEqual(states[-1], {'phase': 'verifying', 'downloaded': 6, 'total': 6})

    @unittest.skipUnless(os.name == 'nt', 'Windows installer')
    def test_full_backup_is_listed_and_restored_by_detached_helper(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            backup = root / 'data' / 'update_backups' / 'full-test'
            backup.mkdir(parents=True)
            (root / 'static').mkdir()
            (root / 'static' / 'update-helper.ps1').write_bytes(
                (Path(__file__).resolve().parents[1] / 'static' / 'update-helper.ps1').read_bytes()
            )
            for relative in ('main.py', 'VERSION'):
                (backup / relative).write_text('old', encoding='utf-8')
            (backup / 'full-update-backup.json').write_text(json.dumps({
                'version': '2026.10.08', 'from_version': '2026.10.07',
                'existing': {'main.py': True, 'VERSION': True, 'backend/new.py': False},
            }), encoding='utf-8')
            with patch.object(main, 'BASE_DIR', str(root)), \
                 patch.object(main, 'DATA_DIR', str(root / 'data')), \
                 patch.object(main, 'STATIC_DIR', str(root / 'static')), \
                 patch.object(main.subprocess, 'Popen') as launch:
                listed = main.list_update_backups()
                self.assertEqual(listed[0]['kind'], 'full_update')
                self.assertEqual(listed[0]['from_version'], '2026.10.07')
                result = main.rollback_update(main.RollbackRequest(name='full-test', auto_restart=True))
            self.assertTrue(result['restart_scheduled'])
            self.assertEqual(result['version'], '2026.10.07')
            launch.assert_called_once()
            plans = list((root / 'data' / 'update_staging').glob('*/plan.json'))
            self.assertEqual(len(plans), 1)
            plan = json.loads(plans[0].read_text(encoding='utf-8'))
            self.assertEqual(plan['files'], ['VERSION', 'main.py'])
            self.assertEqual(plan['remove'], ['backend/new.py'])

    @unittest.skipUnless(os.name == 'nt', 'Windows installer')
    def test_installer_preserves_private_files_and_rolls_back_failure(self):
        helper = Path(__file__).resolve().parents[1] / 'static' / 'update-helper.ps1'
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            app = root / 'app'
            stage = root / 'stage'
            backup = app / 'data' / 'update_backups' / 'full-test'
            app.mkdir()
            stage.mkdir()
            for relative, content in {
                'main.py': b'old', 'VERSION': b'old',
                'data/canvas.json': b'private', 'API/.env': b'private-key',
            }.items():
                target = app / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(content)
            for relative, content in {'main.py': b'new', 'VERSION': b'new'}.items():
                (stage / relative).write_bytes(content)
            status = root / 'status.json'
            status.write_text('{"phase":"installing"}', encoding='utf-8')
            plan = root / 'plan.json'
            payload = {
                'base': str(app), 'source': str(stage), 'backup': str(backup),
                'status': str(status), 'pid': 0, 'files': ['main.py', 'VERSION'],
                'remove': [], 'version': 'new', 'restart': False,
            }
            plan.write_text(json.dumps(payload), encoding='utf-8')
            command = ['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(helper), '-PlanPath', str(plan)]
            result = subprocess.run(command, capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr + status.read_text(encoding='utf-8-sig'))
            self.assertEqual((app / 'main.py').read_bytes(), b'new')
            self.assertEqual((app / 'data/canvas.json').read_bytes(), b'private')
            self.assertEqual((app / 'API/.env').read_bytes(), b'private-key')
            self.assertEqual(json.loads(status.read_text(encoding='utf-8-sig'))['phase'], 'complete')

            # A later missing staged file must restore files already replaced.
            (stage / 'VERSION').unlink()
            backup2 = app / 'data' / 'update_backups' / 'full-failed'
            payload['backup'] = str(backup2)
            status.write_text('{"phase":"installing"}', encoding='utf-8')
            plan.write_text(json.dumps(payload), encoding='utf-8')
            result = subprocess.run(command, capture_output=True, text=True, timeout=30)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual((app / 'main.py').read_bytes(), b'new')
            self.assertEqual((app / 'VERSION').read_bytes(), b'new')
            self.assertEqual((app / 'data/canvas.json').read_bytes(), b'private')
            self.assertEqual(json.loads(status.read_text(encoding='utf-8-sig'))['phase'], 'failed')


if __name__ == '__main__':
    unittest.main()
