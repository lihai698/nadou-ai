"""素材规则及存储边界：仅操作自制字典和临时目录。"""
import ast
import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from threading import RLock
from unittest.mock import Mock, patch

import main
from backend import asset_media_rules, canvas_asset_rules, local_asset_service
from backend.canvas_store import CanvasStore


class AssetBusinessBoundaryTests(unittest.TestCase):
    def test_pure_rules_import_without_application_or_storage(self):
        code = '''import builtins,sys
original=builtins.__import__
def guarded(name,*args,**kwargs):
    if name in ('main','fastapi','backend.canvas_store','backend.local_asset_service'):
        raise AssertionError(name)
    return original(name,*args,**kwargs)
builtins.__import__=guarded
from backend.asset_media_rules import normalize_asset_classification
from backend.canvas_asset_rules import extract_canvas_assets,summarize_canvas_assets
assert normalize_asset_classification({},now_ms=lambda:1)['updated_at']==1
assert summarize_canvas_assets([])['items']==[]
assert 'main' not in sys.modules
'''
        result = subprocess.run([sys.executable, "-B", "-c", code], cwd=Path(main.__file__).parent,
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_classification_clock_is_injected_once_after_normalization(self):
        raw = {"summary": "  中文分类  ", "categories": {"STYLE": ["#写实", "写实", "电影感"]},
               "tags": ["＃产品", "产品"], "updated_at": 1}
        before = copy.deepcopy(raw)
        clock = Mock(return_value=1234)
        result = asset_media_rules.normalize_asset_classification(raw, now_ms=clock)
        self.assertEqual(result["updated_at"], 1234)
        self.assertEqual(result["categories"], {"style": ["写实", "电影感"]})
        self.assertEqual(result["tags"], ["产品"])
        self.assertEqual(result["summary"], "中文分类")
        clock.assert_called_once_with()
        self.assertEqual(raw, before)

    def test_classification_limits_and_parse_failure_boundary(self):
        raw = {"summary": "长" * 300, "categories": {"Style": ["x" * 40] + list(map(str, range(20)))},
               "tags": list(map(str, range(30)))}
        result = asset_media_rules.normalize_asset_classification(raw, now_ms=lambda: 9)
        self.assertEqual(len(result["summary"]), 240)
        self.assertEqual(len(result["categories"]["style"]), 8)
        self.assertEqual(len(result["categories"]["style"][0]), 24)
        self.assertEqual(len(result["tags"]), 20)
        parse = asset_media_rules.parse_asset_classification_text
        self.assertEqual(parse('```JSON\n{"tags":["#标签"]}\n```', now_ms=lambda: 10)["tags"], ["标签"])
        self.assertEqual(parse('前缀 {"summary":"中文"} 后缀', now_ms=lambda: 10)["summary"], "中文")
        self.assertEqual(parse("not json", now_ms=lambda: 10)["categories"], {})
        with self.assertRaises(json.JSONDecodeError):
            parse("{broken}", now_ms=lambda: 10)

    def test_local_sidecar_service_uses_rules_and_current_clock(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "image.classification.json"
            path.write_text('{"tags":["#旧标签"],"updated_at":1}', encoding="utf8")
            result = local_asset_service._read_local_upload_classification(
                "image.png", _local_upload_classification_path=lambda _: str(path), now_ms=lambda: 77)
            self.assertEqual(result["updated_at"], 77)
            writer = Mock()
            local_asset_service._write_local_upload_classification(
                "image.png", result, _local_upload_classification_path=lambda _: str(path),
                now_ms=lambda: 88, write_json_atomic=writer)
            self.assertEqual(writer.call_args.args[1]["updated_at"], 88)
            path.write_text("{broken}", encoding="utf8")
            self.assertIsNone(local_asset_service._read_local_upload_classification(
                "image.png", _local_upload_classification_path=lambda _: str(path), now_ms=lambda: 99))
            self.assertEqual(path.read_text(), "{broken}")

    def test_extract_preserves_first_reference_and_does_not_mutate_canvas(self):
        canvas = {"id": "c", "title": "自制画布", "kind": "smart", "updated_at": 3,
                  "nodes": [None, {"id": "n", "title": "输出", "type": "smart-output",
                                    "images": [{"url": "/assets/a.png", "width": 31}, "/assets/a.png"],
                                    "prompt": "/assets/ignored.png"}]}
        before = copy.deepcopy(canvas)
        items = canvas_asset_rules.extract_canvas_assets(canvas)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["node_id"], "n")
        self.assertEqual(items[0]["source_path"], "images[0]")
        self.assertEqual(items[0]["width"], 31)
        self.assertEqual(items[0]["canvas_kind"], "smart")
        self.assertEqual(canvas, before)

    def test_summary_preserves_pinned_order_counts_and_duplicate_scope(self):
        def canvas(ident, kind, pinned, updated):
            return {"id": ident, "kind": kind, "pinned": pinned, "updated_at": updated,
                    "nodes": [{"images": ["/assets/shared.png", "/assets/shared.png"]}]}
        result = canvas_asset_rules.summarize_canvas_assets(iter([
            canvas("c", "classic", True, 2), canvas("s", "smart", False, 9)]))
        self.assertEqual([c["id"] for c in result["canvases"]], ["c", "s"])
        self.assertEqual([i["canvas_id"] for i in result["items"]], ["s", "c"])
        self.assertEqual([i["count"] for i in result["categories"]], [2, 1, 1])

    def test_storage_asset_scan_preserves_legacy_validation_and_trash_boundary(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            docs = {"active": {"id": "a", "format_version": 999, "nodes": []},
                    "deleted": {"id": "d", "deleted_at": 95},
                    "expired": {"id": "e", "deleted_at": 1}}
            for name, value in docs.items():
                (root / (name + ".json")).write_text(json.dumps(value), encoding="utf8")
            (root / "broken.json").write_text("{broken}", encoding="utf8")
            store = CanvasStore(folder, lock=RLock(), now_ms=lambda: 100, new_id=lambda: "id",
                                default_project="default", retention_ms=50)
            self.assertEqual(list(store.asset_documents()), [docs["active"]])
            self.assertFalse((root / "expired.json").exists())
            self.assertTrue((root / "deleted.json").exists())
            self.assertEqual((root / "broken.json").read_text(), "{broken}")

    def test_main_keeps_only_asset_index_composition(self):
        tree = ast.parse(Path(main.__file__).read_text(encoding="utf8"))
        names = {n.name for n in tree.body if isinstance(n, ast.FunctionDef)}
        self.assertTrue({"normalize_asset_classification", "parse_asset_classification_text",
                         "extract_canvas_assets", "canvas_node_title", "_safe_asset_tag"}.isdisjoint(names))
        with patch.object(main, "CANVAS_DIR", tempfile.mkdtemp()) as folder:
            self.addCleanup(Path(folder).rmdir)
            with patch.object(CanvasStore, "asset_documents", return_value=iter([])) as reader:
                self.assertEqual(main.canvas_assets_index()["items"], [])
            reader.assert_called_once_with()

    def test_successfully_parsed_non_object_keeps_existing_error(self):
        with tempfile.TemporaryDirectory() as folder:
            (Path(folder) / "array.json").write_text("[]", encoding="utf8")
            with patch.object(main, "CANVAS_DIR", folder):
                with self.assertRaises(AttributeError):
                    main.canvas_assets_index()


if __name__ == "__main__":
    unittest.main()
