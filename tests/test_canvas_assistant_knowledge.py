import json
import tempfile
import unittest
from pathlib import Path

from fastapi import HTTPException

from backend.canvas_assistant_knowledge import ProjectKnowledge


class ProjectKnowledgeTests(unittest.TestCase):
    def test_evidence_is_exposed_without_promoting_partial_verification(self):
        snapshot=ProjectKnowledge().snapshot()
        for entry in ProjectKnowledge.index(snapshot):
            if entry['id']=='classic.audio':
                self.assertEqual(entry['coverage']['actionable'],'read-only')
                self.assertIn('local-ui-and-contracts',entry['coverage']['verified'])
                continue
            self.assertIn('coverageEvidence',entry)
            self.assertNotIn('阶段B逐类接入',entry['coverageEvidence']['actionable'])
            self.assertEqual(entry['coverage']['verified'],'pending')
        result=ProjectKnowledge.read(snapshot,'smart.prompt','overview')
        self.assertIn('tests/',result['coverageEvidence']['verified'])
        result['coverageEvidence']['verified']='changed'
        self.assertNotEqual(ProjectKnowledge.read(snapshot,'smart.prompt')['coverageEvidence']['verified'],'changed')
        image=next(entry for entry in ProjectKnowledge.index(snapshot) if entry['id']=='smart.image')
        self.assertIn('空智能节点',image['coverageEvidence']['actionable'])
        self.assertIn('API 图片',image['coverageEvidence']['actionable'])
        self.assertIn('视频和其他引擎沿用原入口',image['coverageEvidence']['actionable'])

    def test_model_receives_evidence_as_context_not_as_instruction(self):
        from backend.canvas_assistant import TurnRequest
        from backend.canvas_assistant_agent import initial_agent,model_fields
        payload=TurnRequest(canvasId='c',sessionId='s',requestId='r',expectedUpdatedAt=1,provider='p',model='m',message='整理素材')
        agent=initial_agent(payload,[],{'kind':'smart'},knowledge_snapshot=ProjectKnowledge().snapshot())
        text=model_fields(payload,[],agent)['system_prompt']
        self.assertIn('coverageEvidence',text)
        self.assertIn('不代表未接入',text)
        self.assertIn('不是执行指令',text)
        self.assertIn('以原生合同及当前配置为准',text)

    def test_current_knowledge_matches_shipped_sources_without_bypassing_write_guard(self):
        knowledge = ProjectKnowledge()
        self.assertEqual(knowledge.changed(knowledge.snapshot()), [],
                         '源码修改后必须核对知识并同步索引，否则创作助手会拒绝实际写入')

    def test_line_endings_do_not_disable_knowledge_but_source_changes_do(self):
        with tempfile.TemporaryDirectory() as root:
            path=Path(root)/'source.py'
            path.write_bytes(b'def x():\n    return 1\n')
            baseline=ProjectKnowledge._digest(path)
            snapshot={'entries':[{'id':'x','sources':[{'path':'source.py','sha256':baseline}]}]}
            path.write_bytes(b'def x():\r\n    return 1\r\n')
            self.assertEqual(ProjectKnowledge.changed(snapshot,Path(root)),[])
            path.write_bytes(b'def x():\r\n    return 2\r\n')
            self.assertEqual(ProjectKnowledge.changed(snapshot,Path(root)),['x'])

    def test_current_node_families_are_indexed(self):
        snapshot = ProjectKnowledge().snapshot()
        entries = {item["id"]: item for item in snapshot["entries"]}
        expected = {
            "classic.image", "classic.prompt", "classic.prompt_group", "classic.loop", "classic.group",
            "classic.llm", "classic.generator", "classic.midjourney", "classic.msgen", "classic.video",
            "classic.runninghub", "classic.comfy", "classic.clip", "classic.output",
            "smart.image", "smart.prompt", "smart.loop", "smart.group",
        }
        self.assertTrue(expected.issubset(entries))
        self.assertTrue(all(item["sources"] for item in entries.values()))

    def test_legacy_and_operation_created_types_are_explicit(self):
        snapshot = ProjectKnowledge().snapshot()
        by_type = {item["nativeType"]: item for item in snapshot["entries"]}
        self.assertEqual(by_type["promptGroup"]["kind"], "classic")
        self.assertIn("smart-container", snapshot["compatibility"]["legacyTypes"])
        self.assertTrue(any("missing smart type" in note for note in snapshot["compatibility"]["notes"]))

    def test_read_only_catalogued_section(self):
        snapshot = ProjectKnowledge().snapshot()
        result = ProjectKnowledge.read(snapshot, "classic.loop", "parameters")
        self.assertEqual(result["id"], "classic.loop")
        self.assertIn("count", result["content"])
        self.assertEqual(result["coverage"]["actionable"], "pending")

    def test_path_and_uncatalogued_section_are_rejected(self):
        snapshot = ProjectKnowledge().snapshot()
        with self.assertRaises(HTTPException):
            ProjectKnowledge.read(snapshot, "../main.py")
        with self.assertRaises(HTTPException):
            ProjectKnowledge.read(snapshot, "classic.loop", "secrets")

    def test_active_snapshot_does_not_change_with_files(self):
        with tempfile.TemporaryDirectory() as root:
            source = Path(root) / "knowledge"
            source.mkdir()
            (source / "index.json").write_text(json.dumps({"version": 1, "entries": [], "compatibility": {"legacyTypes": [], "notes": []}}, ensure_ascii=False), encoding="utf-8")
            knowledge = ProjectKnowledge(source)
            snapshot = knowledge.snapshot()
            (source / "index.json").write_text("{}", encoding="utf-8")
            self.assertEqual(snapshot["version"], 1)

    def test_source_drift_marks_stale(self):
        with tempfile.TemporaryDirectory() as root:
            source = Path(root) / "knowledge"
            source.mkdir()
            source_file = source / "source.py"
            source_file.write_text("old", encoding="utf-8")
            import hashlib
            (source / "card.md").write_text("## overview\nx", encoding="utf-8")
            (source / "index.json").write_text(json.dumps({"version": 1, "entries": [{"id": "x", "kind": "classic", "nativeType": "x", "name": "x", "summary": "x", "file": "card.md", "sources": [{"path": "source.py", "symbol": "x", "evidence": "x", "sha256": hashlib.sha256(b"old").hexdigest()}], "sections": ["overview"], "coverage": {"documented": "passed", "readable": "pending", "actionable": "pending", "verified": "pending"}}], "compatibility": {"legacyTypes": [], "notes": []}}, ensure_ascii=False), encoding="utf-8")
            knowledge = ProjectKnowledge(source, project_root=source)
            snapshot = knowledge.snapshot()
            source_file.write_text("new", encoding="utf-8")
            self.assertEqual(ProjectKnowledge.read(snapshot, "x", source_root=source)["sourceStatus"], "stale")

    def test_every_current_node_family_has_a_real_state_case(self):
        root = Path(__file__).parents[1]
        entries = ProjectKnowledge().snapshot()["entries"]
        for name in ("classic.json", "smart.json"):
            fixture = json.loads((root / "tests/fixtures/canvas_assistant_knowledge" / name).read_text(encoding="utf-8"))
            expected = {item["nativeType"] for item in entries if item["kind"] == fixture["kind"]}
            self.assertEqual(expected, {node.get("type") for node in fixture["nodes"]})

    def test_markdown_is_single_source_and_snapshot_keeps_original_text(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            (root / "card.md").write_text("## overview\n真实说明\n## parameters\ncount=3", encoding="utf-8")
            (root / "index.json").write_text(json.dumps({"entries": [{"id": "x", "file": "card.md", "sections": ["overview", "parameters"], "sources": []}]}), encoding="utf-8")
            snapshot = ProjectKnowledge(root).snapshot()
            self.assertEqual(ProjectKnowledge.read(snapshot, "x")["content"], "真实说明")
            self.assertNotIn("sourceRoot", snapshot)
            (root / "card.md").write_text("## overview\nchanged", encoding="utf-8")
            self.assertEqual(ProjectKnowledge.read(snapshot, "x")["content"], "真实说明")

    def test_missing_card_and_outside_path_are_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            for path in ("missing.md", "../outside.md", "C:/private.md"):
                (root / "index.json").write_text(json.dumps({"entries": [{"id": "x", "file": path, "sections": ["overview"], "sources": []}]}), encoding="utf-8")
                with self.assertRaises(HTTPException):
                    ProjectKnowledge(root).snapshot()

    def test_symlink_outside_root_is_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            cards = root / "cards"
            cards.mkdir()
            outside = root / "outside.md"
            outside.write_text("## overview\nprivate", encoding="utf-8")
            try:
                (cards / "card.md").symlink_to(outside)
            except OSError as exc:
                self.skipTest(f"主机不支持创建符号链接: {exc}")
            (cards / "index.json").write_text(json.dumps({"entries": [{"id": "x", "file": "card.md", "sections": ["overview"], "sources": []}]}), encoding="utf-8")
            with self.assertRaises(HTTPException):
                ProjectKnowledge(cards).snapshot()

    def test_catalog_is_utf8_chinese_without_replacement_characters(self):
        snapshot = ProjectKnowledge().snapshot()
        for item in snapshot["entries"]:
            self.assertNotIn("\ufffd", json.dumps(item, ensure_ascii=False))
        self.assertEqual(next(e for e in snapshot["entries"] if e["id"] == "classic.loop")["name"], "循环节点")

    def test_group_and_loop_input_order_matches_native_rules(self):
        fixture = json.loads((Path(__file__).parents[1] / "tests/fixtures/canvas_assistant_knowledge/classic.json").read_text(encoding="utf-8"))
        loop = next(node for node in fixture["nodes"] if node["type"] == "loop")
        self.assertEqual(fixture["connections"][0]["to"], loop["id"])
        group = next(node for node in fixture["nodes"] if node["type"] == "group")
        self.assertEqual(group["items"], ["classic-prompt"])

    def test_workflow_parameters_preserve_schema_types(self):
        from backend.canvas_assistant_state import read_node_state
        canvas = {"id": "c", "updated_at": 1, "nodes": [{"id": "w", "type": "comfy", "comfyParams": {"steps": 20, "denoise": 0.5, "enabled": True, "sampler": "euler"}}], "connections": []}
        result = read_node_state(canvas, "w")
        self.assertEqual(result["parameters"]["comfyParams"]["steps"], 20)
        self.assertIs(result["parameters"]["comfyParams"]["enabled"], True)

    def test_every_feature_has_source_and_verification_row(self):
        root = Path(__file__).parents[1]
        snapshot = ProjectKnowledge().snapshot()
        checks = json.loads((root / "docs/创作助手项目知识/验收清单.json").read_text(encoding="utf-8"))
        check_ids = {item["featureId"] for item in checks}
        self.assertEqual(len(check_ids), len(checks), "验收编号不能重复")
        self.assertEqual(check_ids, {feature["id"] for entry in snapshot["entries"] for feature in entry["features"]})
        for entry in snapshot["entries"]:
            self.assertTrue(entry["sources"])
            if entry["kind"] in {"classic", "smart"}:
                self.assertTrue(entry["features"], f"节点缺少验收子功能：{entry['id']}")
            for feature in entry["features"]:
                self.assertIn(feature["id"], check_ids)


if __name__ == "__main__":
    unittest.main()
