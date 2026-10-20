"""画布存储独立合同：不导入应用、不读取私人数据。"""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from threading import RLock
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.canvas_store import CanvasStore, CanvasStoreError


class CanvasStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.now = 1000
        self.store = CanvasStore(self.root, lock=RLock(), now_ms=lambda: self.now,
                                 new_id=lambda: 'created', default_project='default', retention_ms=100)

    def seed(self, identity='c', **fields):
        value = {'id': identity, 'title': '原名', 'icon': 'layers', 'kind': 'classic',
                 'nodes': [], 'connections': [], 'updated_at': 10, **fields}
        (self.root / f'{identity}.json').write_text(json.dumps(value), encoding='utf-8')
        return value

    def test_create_preserves_defaults_normalization_and_monotonic_save(self):
        doc = self.store.create('', '', ' SMART ', 'p', 1, 2)
        self.assertEqual((doc['title'], doc['icon'], doc['kind']), ('智能画布', 'sparkles', 'smart'))
        self.assertEqual(doc['board_x'], 1.0)
        self.assertEqual(doc['created_at'], 1000)
        self.assertEqual(doc['updated_at'], 1001)
        self.assertEqual(self.store.load('created'), doc)
        self.now = 1
        self.store.save(doc)
        self.assertEqual(doc['updated_at'], 1002)

    def test_path_and_deleted_read_boundaries(self):
        self.assertEqual(Path(self.store.path('../c')), self.root / 'c.json')
        with self.assertRaises(CanvasStoreError) as error:
            self.store.path('...')
        self.assertEqual(error.exception.status_code, 400)
        self.seed(deleted_at=900)
        with self.assertRaises(CanvasStoreError) as error:
            self.store.load('c')
        self.assertEqual(error.exception.status_code, 404)
        self.assertEqual(self.store.load_any('c')['deleted_at'], 900)

    def test_write_preserves_unknown_fields_and_rejects_future_disk_version(self):
        doc = self.seed(extra={'unknown': True})
        self.store.save(doc)
        self.assertEqual(self.store.load('c')['extra'], {'unknown': True})
        self.seed(format_version=999)
        before = (self.root / 'c.json').read_bytes()
        with self.assertRaises(CanvasStoreError) as error:
            self.store.save(doc)
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual((self.root / 'c.json').read_bytes(), before)

    def test_atomic_writer_failure_preserves_existing_bytes(self):
        doc = self.seed()
        before = (self.root / 'c.json').read_bytes()
        with patch.object(self.store, 'writer', side_effect=OSError('isolated failure')):
            with self.assertRaises(OSError):
                self.store.save(doc)
        self.assertEqual((self.root / 'c.json').read_bytes(), before)

    def test_records_keep_cleanup_cutoff_and_skip_bad_future_files(self):
        self.seed('active')
        self.seed('boundary', deleted_at=900)
        self.seed('expired', deleted_at=899)
        self.seed('future', format_version=999, deleted_at=1)
        (self.root / 'broken.json').write_text('{bad', encoding='utf-8')
        self.assertEqual([r['id'] for r in self.store.records()], ['active'])
        self.assertEqual([r['id'] for r in self.store.records(True)], ['boundary'])
        self.assertFalse((self.root / 'expired.json').exists())
        self.assertTrue((self.root / 'future.json').exists())
        self.assertTrue((self.root / 'broken.json').exists())

    def test_metadata_does_not_touch_content_timestamp(self):
        self.seed()
        doc = self.store.update_meta('c', {'title': '新标题', 'color': 'invalid', 'owner': '  user  ', 'pinned': True})
        self.assertEqual(doc['updated_at'], 10)
        self.assertEqual(doc['meta_revision'], 1)
        self.assertEqual((doc['color'], doc['owner']), ('', 'user'))
        doc = self.store.update_meta('c', {'pinned': False})
        self.assertEqual(doc['meta_revision'], 1)
        self.assertEqual(self.store.meta('c')['title'], '新标题')

    def test_content_update_preserves_classic_viewport_and_checks_both_conflicts(self):
        self.seed(viewport={'x': 5}, meta_revision=1)
        payload = {'nodes': [{'id': 'n'}], 'connections': [], 'viewport': {'x': 99},
                   'logs': list(range(501)), 'settings': {}, 'base_updated_at': 10,
                   'base_meta_revision': 1, 'title': 'new', 'icon': 'layers'}
        doc = self.store.update_content('c', payload, fields=set(payload))
        self.assertEqual(doc['viewport'], {'x': 5})
        self.assertEqual(len(doc['logs']), 500)
        with self.assertRaises(CanvasStoreError) as error:
            self.store.update_content('c', payload, fields=set(payload))
        self.assertEqual(error.exception.status_code, 409)
        payload['base_updated_at'] = doc['updated_at']
        payload['base_meta_revision'] = 0
        payload['title'] = 'stale title'
        with self.assertRaises(CanvasStoreError) as error:
            self.store.update_content('c', payload, fields=set(payload))
        self.assertEqual(error.exception.detail['reason'], 'meta_conflict')

    def test_smart_content_uses_viewport_and_omitted_title_keeps_current(self):
        self.seed(kind='smart', meta_revision=2)
        doc = self.store.update_content('c', {'nodes': [], 'connections': [], 'viewport': {'x': 8},
                                       'logs': [], 'settings': {}, 'base_updated_at': 10}, fields={'nodes'})
        self.assertEqual(doc['title'], '原名')
        self.assertEqual(doc['viewport'], {'x': 8})

    def test_touch_trash_restore_and_idempotent_purge(self):
        self.seed()
        self.assertGreater(self.store.touch('c')['updated_at'], 10)
        self.store.delete('c')
        deleted = self.store.load_any('c')
        self.store.delete('c')
        self.assertEqual(self.store.load_any('c'), deleted)
        restored = self.store.restore('c')
        self.assertNotIn('deleted_at', restored)
        self.store.purge('c')
        self.store.purge('c')
        self.assertFalse((self.root / 'c.json').exists())

    def test_project_scan_rejects_mismatched_filename_before_moving(self):
        self.seed(project='p')
        self.assertEqual(len(self.store.for_project('p')), 1)
        (self.root / 'c.json').rename(self.root / 'wrong.json')
        with self.assertRaises(CanvasStoreError) as error:
            self.store.for_project('p')
        self.assertIn('文件名', str(error.exception))


if __name__ == '__main__':
    unittest.main()
