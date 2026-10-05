"""阶段 8：存储设置与本地媒体路径规则的无状态专项。"""

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.storage_paths import (
    UnknownStorageKind,
    UnsafeStoragePath,
    normalize_storage_path,
    normalize_storage_relative_path,
    output_file_from_url,
    output_url_for,
    resolve_storage_dirs,
    storage_file_path,
    storage_kind_root,
)


class StoragePathRuleTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="storage-path-rules-"))
        self.addCleanup(lambda: __import__("shutil").rmtree(self.root, ignore_errors=True))
        self.defaults = {
            "upload": str(self.root / "assets" / "input"),
            "generated": str(self.root / "assets" / "output"),
            "local": str(self.root / "assets" / "uploads"),
        }

    def test_normalize_and_resolve_dirs_keep_relative_and_empty_compatibility(self):
        with patch.dict(os.environ, {"STORAGE_PATH_RULE_TEST": "outside"}, clear=False):
            self.assertEqual(
                normalize_storage_path(
                    "$STORAGE_PATH_RULE_TEST/generated", "fallback", str(self.root)
                ),
                str(self.root / "outside" / "generated"),
            )
        self.assertEqual(
            normalize_storage_path("", self.defaults["upload"], str(self.root)),
            self.defaults["upload"],
        )
        resolved = resolve_storage_dirs(
            {"upload": "custom/input", "local": ""}, self.defaults, str(self.root)
        )
        self.assertEqual(resolved["upload"], str(self.root / "custom" / "input"))
        self.assertEqual(resolved["generated"], self.defaults["generated"])
        self.assertEqual(resolved["local"], self.defaults["local"])

    def test_kind_mapping_and_relative_path_reject_traversal(self):
        dirs = resolve_storage_dirs({}, self.defaults, str(self.root))
        self.assertEqual(storage_kind_root("GENERATED", dirs), dirs["generated"])
        with self.assertRaises(UnknownStorageKind):
            storage_kind_root("cache", dirs)
        # URL 路径可能以斜杠开头，沿用旧入口的 lstrip('/') 兼容语义；
        # Windows 驱动器路径仍然属于绝对路径并必须拒绝。
        for rel in ("", ".", "..", "../outside.txt", "C:/outside.txt"):
            with self.subTest(rel=rel), self.assertRaises(UnsafeStoragePath):
                normalize_storage_relative_path(rel)
        self.assertEqual(normalize_storage_relative_path(r"folder\image.png"), "folder/image.png")

    def test_storage_file_path_checks_root_and_existence(self):
        dirs = resolve_storage_dirs({}, self.defaults, str(self.root))
        generated = Path(dirs["generated"])
        generated.mkdir(parents=True)
        file_path = generated / "nested" / "result.png"
        file_path.parent.mkdir()
        file_path.write_bytes(b"self-made")
        self.assertEqual(
            storage_file_path("generated", "nested/result.png", dirs), str(file_path)
        )
        self.assertIsNone(storage_file_path("generated", "missing.png", dirs))
        with self.assertRaises(UnsafeStoragePath):
            storage_file_path("generated", "../outside.png", dirs)

    def test_output_urls_preserve_assets_and_external_storage_forms(self):
        dirs = resolve_storage_dirs({}, self.defaults, str(self.root))
        assets_dir = str(self.root / "assets")
        self.assertEqual(
            output_url_for("nested/result.png", "output", dirs, assets_dir),
            "/assets/output/nested/result.png",
        )
        external = dict(dirs, generated=str(self.root / "external-output"))
        self.assertEqual(
            output_url_for("nested/result.png", "output", external, assets_dir),
            "/api/storage-files/generated/nested/result.png",
        )

    def test_output_file_url_supports_query_and_legacy_output_fallback(self):
        dirs = resolve_storage_dirs({}, self.defaults, str(self.root))
        assets_dir = Path(self.root / "assets")
        generated = Path(dirs["generated"])
        generated.mkdir(parents=True)
        target = generated / "result file.png"
        target.write_bytes(b"self-made")
        self.assertEqual(
            output_file_from_url(
                "/api/storage-files/generated/result%20file.png?cache=1",
                dirs,
                str(assets_dir),
                str(self.root / "output"),
            ),
            str(target),
        )

        legacy = self.root / "output" / "legacy.png"
        legacy.parent.mkdir(parents=True)
        legacy.write_bytes(b"legacy")
        self.assertEqual(
            output_file_from_url(
                "/output/legacy.png", dirs, str(assets_dir), str(self.root / "output")
            ),
            str(legacy),
        )
        self.assertIsNone(
            output_file_from_url(
                "/assets/../private.png", dirs, str(assets_dir), str(self.root / "output")
            )
        )


if __name__ == "__main__":
    unittest.main()
