"""助手素材目录的读取顺序、公开投影和来源策略回归。"""
import ast
import copy
import unittest
from pathlib import Path
from unittest.mock import Mock

from backend.canvas_assistant_reference_service import read_reference_assets


class ReferenceServiceTests(unittest.TestCase):
    def library(self, items, **category):
        return {"libraries": [{"id": 7, "categories": [{"id": 8, "items": items, **category}]}]}

    def read(self, library=None, local=(), media_kind=lambda _: "image"):
        return read_reference_assets(load_asset_library=lambda: library or {},
                                     load_local_tree_and_items=lambda: ({}, local),
                                     media_kind=media_kind)

    def test_library_defaults_ids_and_only_public_fields(self):
        result = self.read(self.library([{"id": 9, "url": "/assets/a.png", "private": "fixture-only"}]))
        self.assertEqual(result, [{"id": "asset:7:9", "url": "/assets/a.png", "thumbnail": "",
            "name": "图片资产", "kind": "image", "source": "asset", "libraryId": "7",
            "categoryId": "8", "libraryName": "资产库", "categoryName": ""}])

    def test_thumbnail_precedence_and_names(self):
        items = [{"id": str(i), "url": "/assets/a.png", "name": "中文图", **fields}
                 for i, fields in enumerate([{"thumbnail": "first", "thumb": "second", "preview": "third"},
                    {"thumbnail": "", "thumb": "second", "preview": "third"}, {"preview": "third"}])]
        library = self.library(items)
        library["libraries"][0].update(name="中文资产库")
        library["libraries"][0]["categories"][0].update(name="分组")
        result = self.read(library)
        self.assertEqual([r["thumbnail"] for r in result], ["first", "second", "third"])
        self.assertTrue(all((r["name"], r["libraryName"], r["categoryName"]) == ("中文图", "中文资产库", "分组") for r in result))

    def test_workflow_category_is_not_traversed(self):
        kind = Mock(side_effect=AssertionError("workflow must not be projected"))
        self.assertEqual(self.read(self.library(None, type="workflow"), media_kind=kind), [])
        kind.assert_not_called()

    def test_library_ignores_non_dict_items_and_invalid_media(self):
        items = [None, "bad", 42, [], {}, {"id": "", "url": "/assets/a.png"},
                 {"id": "audio", "url": "/assets/a.mp3", "kind": "audio"},
                 {"id": "bad-url", "url": 5}, {"id": "relative", "url": "a.png"},
                 {"id": "data", "url": "data:image/png;base64,fixture"},
                 {"id": "valid", "url": "/assets/a.png", "kind": "image"}]
        self.assertEqual([r["id"] for r in self.read(self.library(items))], ["asset:7:valid"])

    def test_library_allows_external_urls_and_uses_exact_prefixes(self):
        urls = ["/assets/a.png", "/output/a.mp4", "/api/storage-files/local/a.png",
                "https://example.invalid/a.png", "http://example.invalid/a.mp4"]
        result = self.read(self.library([{"id": str(i), "url": url} for i, url in enumerate(urls)]))
        self.assertEqual([r["url"] for r in result], urls)
        from backend.canvas_assistant_canvas_rules import reference_kind
        self.assertEqual([bool(reference_kind(r)) for r in result], [True, True, True, False, False])

    def test_media_kind_inference_and_explicit_kind_short_circuit(self):
        kind = Mock(return_value="video")
        result = self.read(self.library([{"id": "explicit", "url": "/output/a", "kind": "image"},
                                        {"id": "inferred", "url": "/output/b.mp4"}]), media_kind=kind)
        self.assertEqual([r["kind"] for r in result], ["image", "video"])
        kind.assert_called_once_with("/output/b.mp4")

    def test_local_filter_defaults_and_folder_projection(self):
        local = [{"id": 12, "kind": "image", "url": "/api/storage-files/local/a.png", "private": "fixture-only"},
                 {"id": "v", "kind": "video", "url": "/api/storage-files/local/中文/v.mp4", "folder": "中文", "name": "视频"},
                 {"id": "external", "kind": "image", "url": "https://example.invalid/a.png"},
                 {"id": "asset", "kind": "image", "url": "/assets/a.png"},
                 {"id": "audio", "kind": "audio", "url": "/api/storage-files/local/a.wav"},
                 {"id": "bad", "kind": "image", "url": None}, {"kind": "image", "url": "/api/storage-files/local/a.png"}]
        result = self.read(local=local)
        self.assertEqual(result[0], {"id": "local:12", "url": local[0]["url"], "thumbnail": "", "name": "本地素材",
            "kind": "image", "source": "local", "libraryId": "local", "categoryId": "", "libraryName": "本地素材", "categoryName": "全部上传"})
        self.assertEqual(len(result), 2)
        self.assertEqual((result[1]["categoryId"], result[1]["categoryName"], result[1]["name"]), ("中文", "中文", "视频"))

    def test_order_duplicates_and_inputs_are_preserved(self):
        item = {"id": "duplicate", "url": "/assets/a.png"}
        library = self.library([item, item])
        library["libraries"].append({"id": "second", "categories": [{"items": [{"id": "v", "url": "/output/v.mp4"}]}]})
        local = [{"id": "last", "url": "/api/storage-files/local/z.png", "kind": "image"}]
        before = copy.deepcopy((library, local))
        self.assertEqual([r["id"] for r in self.read(library, local)], ["asset:7:duplicate", "asset:7:duplicate", "asset:second:v", "local:last"])
        self.assertEqual((library, local), before)

    def test_entire_library_is_projected_before_local_tree_read(self):
        events = []
        class Item(dict):
            def get(self, key, *default):
                events.append(key)
                return super().get(key, *default)
        item = Item(id="a", url="/assets/a.png")
        def library():
            events.append("library")
            return self.library([item])
        def local():
            self.assertEqual(events[-1], "name")
            events.append("local")
            return {}, []
        result = read_reference_assets(load_asset_library=library, load_local_tree_and_items=local, media_kind=lambda _: "image")
        self.assertEqual(result[0]["id"], "asset:7:a")
        self.assertEqual((events[0], events[-1]), ("library", "local"))

    def test_library_read_error_does_not_read_local(self):
        local = Mock()
        error = OSError("fixture-library-error")
        with self.assertRaises(OSError) as caught:
            read_reference_assets(load_asset_library=Mock(side_effect=error), load_local_tree_and_items=local, media_kind=lambda _: "image")
        self.assertIs(caught.exception, error)
        local.assert_not_called()

    def test_projection_error_does_not_read_local(self):
        local = Mock()
        error = RuntimeError("fixture-kind-error")
        with self.assertRaises(RuntimeError) as caught:
            read_reference_assets(load_asset_library=lambda: self.library([{"id": "a", "url": "/assets/a.png"}]),
                                  load_local_tree_and_items=local, media_kind=Mock(side_effect=error))
        self.assertIs(caught.exception, error)
        local.assert_not_called()

    def test_local_read_error_follows_library_projection(self):
        kind = Mock(return_value="image")
        error = OSError("fixture-local-error")
        def local():
            kind.assert_called_once_with("/assets/a.png")
            raise error
        with self.assertRaises(OSError) as caught:
            read_reference_assets(load_asset_library=lambda: self.library([{"id": "a", "url": "/assets/a.png"}]),
                                  load_local_tree_and_items=local, media_kind=kind)
        self.assertIs(caught.exception, error)

    def test_malformed_source_containers_keep_existing_errors(self):
        for library, local, error in [({"libraries": None}, [], TypeError),
                ({"libraries": [None]}, [], AttributeError), ({}, [None], AttributeError)]:
            with self.subTest(library=library, local=local), self.assertRaises(error):
                self.read(library, local)

    def test_main_bridge_reads_current_ports_on_every_call(self):
        tree = ast.parse(Path("main.py").read_text(encoding="utf8"))
        node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "canvas_assistant_reference_assets")
        import backend.canvas_assistant_reference_service as service
        scope = {"canvas_assistant_reference_service": service, "load_asset_library": lambda: self.library([{"id": "a", "url": "/assets/a.png"}]),
                 "_local_upload_tree_and_items": lambda: ({}, []), "asset_library_media_kind": lambda _: "image"}
        exec(compile(ast.Module(body=[node], type_ignores=[]), "main.py", "exec"), scope)
        self.assertEqual(scope["canvas_assistant_reference_assets"]()[0]["id"], "asset:7:a")
        scope["load_asset_library"] = lambda: {}
        scope["_local_upload_tree_and_items"] = lambda: ({}, [{"id": "new", "url": "/api/storage-files/local/new.png", "kind": "image"}])
        self.assertEqual(scope["canvas_assistant_reference_assets"]()[0]["id"], "local:new")
