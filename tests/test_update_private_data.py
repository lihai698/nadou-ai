"""Exercise update and rollback against disposable private data."""
import hashlib
import os
import sys
import tempfile
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main


class UpdatePrivateDataTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.root = Path(self.stack.enter_context(tempfile.TemporaryDirectory()))
        self.private = {
            'API/.env': b'SAMPLE=isolated\n',
            'data/asset_library.json': b'{"items":["sample"]}',
            'data/canvases/sample.json': b'{"nodes":[{"id":"sample"}]}',
            'data/conversations/sample.json': b'{"messages":["sample"]}',
            'data/storage_settings.json': b'{"mode":"local"}',
            'assets/sample.png': b'isolated-image',
            'output/sample.png': b'isolated-output',
            'history.json': b'[{"id":"sample"}]',
            'global_config.json': b'{"theme":"dark"}',
        }
        initial = {
            'main.py': b'APP_VERSION = "before"\n',
            'VERSION': b'2026.08.28\n',
            'static/index.html': b'<title>before</title>',
            **self.private,
        }
        for relative, content in initial.items():
            target = self.root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
        for name, relative in {
            'BASE_DIR': '.', 'STATIC_DIR': 'static', 'DATA_DIR': 'data',
        }.items():
            self.stack.enter_context(patch.object(main, name, str(self.root / relative)))

    def private_hashes(self):
        return {
            relative: hashlib.sha256((self.root / relative).read_bytes()).hexdigest()
            for relative in self.private
        }

    def test_update_check_uses_maintainer_repository_only(self):
        info = main.app_info()
        self.assertEqual(info['repo_url'], 'https://github.com/lihai698/nadou-ai')
        self.assertEqual(set(info['sources']), {'github'})
        with patch.object(main, 'fetch_remote_version', return_value={
            'ok': True, 'version': '2026.10.03', 'url': main.GITHUB_VERSION_URL,
        }) as get_version, patch.object(main, 'fetch_remote_update_notes', return_value={
            'ok': True, 'version': '2026.10.03', 'update_mode': 'in_app', 'items': [],
        }):
            result = main.check_update()
        get_version.assert_called_once_with(main.GITHUB_VERSION_URL, timeout=5.0)
        self.assertTrue(result['update_available'])
        self.assertEqual(result['latest']['source'], 'github')
        self.assertNotIn('modelscope', result)

    @unittest.skipUnless(os.name == 'nt', 'Windows restart launcher')
    def test_auto_restart_uses_current_run_script(self):
        with patch.object(main.subprocess, 'Popen') as launch:
            self.assertTrue(main.schedule_self_restart(3))
        script = (self.root / '_self_restart.bat').read_text(encoding='utf-8')
        self.assertIn('run.bat', script)
        self.assertIn('--no-browser', script)
        self.assertIn('nadou ai', script)
        launch.assert_called_once()

    def test_update_and_rollback_preserve_private_files(self):
        before = self.private_hashes()

        def stage_sample_update(staging_root):
            staging = Path(staging_root)
            for relative, content in {
                'main.py': b'APP_VERSION = "after"\n',
                'VERSION': b'2026.10.03\n',
                'static/index.html': b'<title>after</title>',
                'static/update-notes.json': b'{"version":"2026.10.03","update_mode":"in_app","items":[]}',
                # An update source may contain private paths; they must be ignored.
                'API/.env': b'SAMPLE=should-not-be-installed\n',
                'data/asset_library.json': b'{"items":[]}',
            }.items():
                target = staging / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(content)
            return main.staged_update_file_list(staging_root)

        with patch.object(main, 'stage_update_from_github', stage_sample_update), \
             patch.object(main, 'schedule_self_restart', return_value=True) as restart:
            updated = main.update_from_github(main.UpdateRequest(auto_restart=True))
        restart.assert_called_once_with(3)
        self.assertTrue(updated['restart_scheduled'])
        self.assertTrue(updated['ok'])
        self.assertEqual(set(updated['updated']), {'main.py', 'VERSION', 'static/index.html', 'static/update-notes.json'})
        self.assertEqual((self.root / 'VERSION').read_text(), '2026.10.03\n')
        self.assertEqual(self.private_hashes(), before)
        self.assertEqual(updated['backup']['state'], 'ready')

        restored = main.rollback_update(main.RollbackRequest(name=Path(updated['backup_dir']).name, auto_restart=False))
        self.assertTrue(restored['ok'])
        self.assertEqual((self.root / 'VERSION').read_text(), '2026.08.28\n')
        self.assertEqual((self.root / 'main.py').read_text(), 'APP_VERSION = "before"\n')
        self.assertEqual((self.root / 'static/index.html').read_bytes(), b'<title>before</title>')
        self.assertEqual(self.private_hashes(), before)

    def test_full_install_release_does_not_replace_live_files(self):
        before = self.private_hashes()

        def stage_full_install(staging_root):
            staging = Path(staging_root)
            for relative, content in {
                'main.py': b'APP_VERSION = "after"\n',
                'VERSION': b'2026.10.03\n',
                'static/index.html': b'<title>after</title>',
                'static/update-notes.json': b'{"version":"2026.10.03","update_mode":"full_install","items":[]}',
            }.items():
                target = staging / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(content)
            return main.staged_update_file_list(staging_root)

        with patch.object(main, 'stage_update_from_github', stage_full_install):
            with self.assertRaises(main.HTTPException) as raised:
                main.update_from_github(main.UpdateRequest(auto_restart=False))
        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual((self.root / 'VERSION').read_text(), '2026.08.28\n')
        self.assertEqual((self.root / 'main.py').read_bytes(), b'APP_VERSION = "before"\n')
        self.assertEqual(self.private_hashes(), before)


if __name__ == '__main__':
    unittest.main()
