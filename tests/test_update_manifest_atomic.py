"""验证更新回滚点 manifest 使用统一原子 JSON 写入。"""

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main
from backend import atomic_json


class UpdateManifestAtomicTests(unittest.TestCase):
    def test_replace_failure_keeps_previous_manifest_and_allows_retry(self):
        with tempfile.TemporaryDirectory(prefix="update-manifest-atomic-") as directory:
            backup = Path(directory)
            main.write_update_backup_manifest(str(backup), {"state": "ready", "version": "old"})
            manifest = backup / main.UPDATE_BACKUP_MANIFEST
            before = manifest.read_bytes()

            with patch.object(atomic_json.os, "replace", side_effect=OSError("replace failed")):
                with self.assertRaises(OSError):
                    main.write_update_backup_manifest(str(backup), {"state": "ready", "version": "new"})

            self.assertEqual(manifest.read_bytes(), before)
            self.assertEqual(list(backup.glob(f".{main.UPDATE_BACKUP_MANIFEST}.*.tmp")), [])

            main.write_update_backup_manifest(str(backup), {"state": "ready", "version": "new"})
            self.assertEqual(
                json.loads(manifest.read_text(encoding="utf-8"))["version"],
                "new",
            )


if __name__ == "__main__":
    unittest.main()
