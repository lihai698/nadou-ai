"""API 平台配置保存失败时保留旧文件，损坏配置不能被默认值覆盖。"""

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main
from backend import atomic_json


class ApiProviderAtomicTests(unittest.TestCase):
    def test_replace_failure_preserves_existing_configuration(self):
        with tempfile.TemporaryDirectory(prefix="nadou-provider-") as directory:
            path = Path(directory) / "api_providers.json"
            before = [{"id": "old", "name": "旧平台"}]
            path.write_text(json.dumps(before, ensure_ascii=False), encoding="utf-8")
            original_bytes = path.read_bytes()
            with patch.object(main, "DATA_DIR", directory), patch.object(
                main, "API_PROVIDERS_FILE", str(path)
            ), patch.object(atomic_json.os, "replace", side_effect=OSError("synthetic replace failure")):
                with self.assertRaises(OSError):
                    main.save_api_providers([{"id": "new", "name": "新平台"}])
            self.assertEqual(path.read_bytes(), original_bytes)
            self.assertEqual(list(path.parent.glob(".api_providers.json.*.tmp")), [])

    def test_invalid_existing_file_is_not_overwritten(self):
        with tempfile.TemporaryDirectory(prefix="nadou-provider-") as directory:
            path = Path(directory) / "api_providers.json"
            path.write_bytes(b"{broken json")
            original_bytes = path.read_bytes()
            with patch.object(main, "DATA_DIR", directory), patch.object(
                main, "API_PROVIDERS_FILE", str(path)
            ):
                with self.assertRaises(HTTPException) as caught:
                    main.save_api_providers([{"id": "default"}])
            self.assertEqual(caught.exception.status_code, 500)
            self.assertEqual(path.read_bytes(), original_bytes)

    def test_static_runninghub_template_replace_failure_preserves_old_file(self):
        with tempfile.TemporaryDirectory(prefix="nadou-runninghub-template-") as directory:
            path = Path(directory) / "api_providers.json"
            before = [{"id": "runninghub", "rh_workflows": []}]
            path.write_text(json.dumps(before, ensure_ascii=False), encoding="utf-8")
            original_bytes = path.read_bytes()
            with patch.object(main, "STATIC_RUNNINGHUB_DIR", directory), patch.object(
                main, "STATIC_RUNNINGHUB_API_PROVIDERS_FILE", str(path)
            ), patch.object(atomic_json.os, "replace", side_effect=OSError("synthetic replace failure")):
                with self.assertRaises(OSError):
                    main.mutate_static_runninghub_provider(lambda provider: provider.update({"changed": True}))
            self.assertEqual(path.read_bytes(), original_bytes)
            self.assertEqual(list(path.parent.glob(".api_providers.json.*.tmp")), [])


if __name__ == "__main__":
    unittest.main()
