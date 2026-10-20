"""Exercise asset file migration with disposable directories only."""
import hashlib
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend import asset_library_files as files

class AssetLibraryFilesTests(unittest.TestCase):
    def test_fingerprint_reads_current_bytes(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'a.png';p.write_bytes(b'first')
            self.assertEqual(files.asset_library_file_fingerprint(p),(5,hashlib.sha256(b'first').hexdigest()))
            p.write_bytes(b'other')
            self.assertEqual(files.asset_library_file_fingerprint(p),(5,hashlib.sha256(b'other').hexdigest()))

    def test_directory_name_checks_index_and_disk(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d)/'角色_2').mkdir()
            self.assertEqual(files.unique_asset_category_dir({'categories':[{'dir':'角色'}]},'角色',sanitize_asset_name=lambda name,fallback:name,ASSET_LIBRARY_DIR=d),'角色_3')

    def test_directory_migration_is_repeatable(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/'image.png').write_bytes(b'fixture')
            item={'url':'/assets/library/image.png'}
            lib={'libraries':[{'categories':[{'name':'角色','items':[item]}]}]};saved=[];logs=[]
            deps=dict(load_asset_library=lambda:lib,write_diagnostic=logs.append,unique_asset_category_dir=lambda *_:'角色',ASSET_LIBRARY_DIR=d,save_asset_library=lambda x:saved.append(x))
            files._migrate_asset_library_into_dirs_locked(**deps)
            self.assertEqual((root/'角色/image.png').read_bytes(),b'fixture')
            self.assertFalse((root/'image.png').exists())
            self.assertEqual(item['url'],'/assets/library/%E8%A7%92%E8%89%B2/image.png')
            files._migrate_asset_library_into_dirs_locked(**deps)
            self.assertEqual(len(saved),1);self.assertEqual(logs,[])

    def test_copy_failure_removes_partial_destination(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);source=root/'source.png';source.write_bytes(b'fixture');dest=root/'library';dest.mkdir()
            def fail(src,target):
                Path(target).write_bytes(b'partial')
                raise OSError('synthetic failure')
            with patch.object(files.shutil,'copy2',side_effect=fail):
                with self.assertRaises(OSError):
                    files.make_asset_library_item(str(source),asset_library_media_kind=lambda _:'image',asset_library_safe_extension=lambda *_:'.png',sanitize_asset_name=lambda name,_:name,ASSET_LIBRARY_DIR=str(dest),asset_library_file_fingerprint=files.asset_library_file_fingerprint,now_ms=lambda:1)
            self.assertEqual(list(dest.iterdir()),[])
            self.assertEqual(source.read_bytes(),b'fixture')

if __name__=='__main__':
    unittest.main()
