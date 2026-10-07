"""依赖安装标记必须随清单或 Python 版本变化而失效。"""

import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("dependency_marker", ROOT / "tools" / "dependency_marker.py")
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class DependencyMarkerTests(unittest.TestCase):
    def make_root(self):
        temp = tempfile.TemporaryDirectory()
        root = Path(temp.name)
        (root / "requirements.lock").write_text("fastapi==1\n", encoding="utf-8")
        return temp, root

    def test_write_and_match(self):
        temp, root = self.make_root()
        try:
            MODULE.write_marker(root)
            self.assertTrue(MODULE.marker_matches(root))
        finally:
            temp.cleanup()

    def test_lock_change_invalidates_marker(self):
        temp, root = self.make_root()
        try:
            MODULE.write_marker(root)
            (root / "requirements.lock").write_text("fastapi==2\n", encoding="utf-8")
            self.assertFalse(MODULE.marker_matches(root))
        finally:
            temp.cleanup()

    def test_python_version_change_invalidates_marker(self):
        temp, root = self.make_root()
        try:
            value = MODULE.marker_value(root, "3.10.11")
            MODULE.marker_path(root).write_text(value + "\n", encoding="utf-8")
            self.assertFalse(MODULE.marker_matches(root, "3.11.0"))
        finally:
            temp.cleanup()

    def test_missing_or_corrupt_marker_is_not_valid(self):
        temp, root = self.make_root()
        try:
            self.assertFalse(MODULE.marker_matches(root))
            MODULE.marker_path(root).write_text("installed\n", encoding="utf-8")
            self.assertFalse(MODULE.marker_matches(root))
        finally:
            temp.cleanup()

    def test_dependencies_match_checks_locked_versions_and_imports(self):
        temp, root = self.make_root()
        try:
            (root / "requirements.lock").write_text(
                "fastapi==1\npython-multipart==2\n", encoding="utf-8"
            )
            with mock.patch.object(
                MODULE.importlib.metadata,
                "version",
                side_effect=lambda name: {"fastapi": "1", "python-multipart": "2"}[name],
            ), mock.patch.object(MODULE.importlib.util, "find_spec", return_value=object()):
                self.assertTrue(MODULE.dependencies_match(root))
        finally:
            temp.cleanup()

    def test_dependencies_match_rejects_missing_distribution(self):
        temp, root = self.make_root()
        try:
            with mock.patch.object(
                MODULE.importlib.metadata,
                "version",
                side_effect=MODULE.importlib.metadata.PackageNotFoundError,
            ):
                self.assertFalse(MODULE.dependencies_match(root))
        finally:
            temp.cleanup()

    def test_dependencies_match_rejects_wrong_version_or_missing_module(self):
        temp, root = self.make_root()
        try:
            with mock.patch.object(MODULE.importlib.metadata, "version", return_value="2"):
                self.assertFalse(MODULE.dependencies_match(root))
            with mock.patch.object(MODULE.importlib.metadata, "version", return_value="1"), mock.patch.object(
                MODULE.importlib.util, "find_spec", return_value=None
            ):
                self.assertFalse(MODULE.dependencies_match(root))
        finally:
            temp.cleanup()

    def test_dependencies_match_rejects_unlocked_or_empty_manifest(self):
        temp, root = self.make_root()
        try:
            for manifest in ("fastapi>=1\n", "# no dependencies\n"):
                (root / "requirements.lock").write_text(manifest, encoding="utf-8")
                self.assertFalse(MODULE.dependencies_match(root))
        finally:
            temp.cleanup()


if __name__ == "__main__":
    unittest.main()
