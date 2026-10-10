import copy
import json
import unittest

from backend.canvas_assistant_knowledge import ProjectKnowledge
from backend.canvas_assistant_state import read_node_state


class ShotTableStateTests(unittest.TestCase):
    def test_smart_table_uses_same_public_projection_and_own_knowledge(self):
        canvas=self.canvas();canvas['kind']='smart';canvas['nodes'][0]['type']='smart-shot-table'
        before=copy.deepcopy(canvas)
        state=read_node_state(canvas,'table',array_path='shotTableData.rows',item_offset=120)
        self.assertEqual(state['capabilityStatus'],'known')
        self.assertEqual(state['membership']['shotTableData.rows'][0]['id'],'shot-121')
        self.assertEqual(canvas,before)
        card=ProjectKnowledge.read(ProjectKnowledge().snapshot(),'smart.shot_table','connections')
        self.assertIn('smart-prompt',card['content'])
        self.assertIn('smart-image',card['content'])

    def canvas(self):
        return {"kind": "classic", "nodes": [{"id": "table", "type": "shot-table", "shotTableData": {
            "version": 1, "revision": 7,
            "source": {"nodeId": "video", "resultId": "result1", "sourceUrl": "/output/video.mp4", "fingerprint": "fp", "durationSeconds": 121},
            "columns": [{"id": "visual", "label": "画面", "kind": "builtin"}, {"id": "custom-1", "label": "服装", "kind": "custom", "hint": "服装"}],
            "rows": [{"id": f"shot-{i+1}", "index": i+1, "startSeconds": i, "endSeconds": i+1, "durationSeconds": 1,
                      "keyframeUrl": "/output/frame.png", "cells": {"visual": "森林", "custom-1": "红衣"},
                      "imagePrompt": "长" * 12000, "motionPrompt": "推镜", "visionFailed": False, "carriedOver": True} for i in range(121)],
            "selectedRowIds": ["shot-121"], "analysisSettings": {"providerId": "p", "model": "vision", "speech": {"mode": "local"}},
            "generationMap": {"fp:shot-121": {"promptId": "prompt", "generatorId": "gen", "outputId": "out"}},
            "task": {"taskId": "analysis-1", "status": "idle", "phase": "等待确认", "progress": 0,
                     "quote": {"id": "quote-1", "visionCalls": 121, "framesPerShot": 3, "audioCalls": 1}},
            "speech": {"status": "ready", "segments": [{"start": 120, "end": 121, "text": "你好"}]},
        }}]}

    def test_last_shots_and_nested_cells_can_be_read_without_mutation(self):
        canvas = self.canvas()
        before = copy.deepcopy(canvas)
        result = read_node_state(canvas, "table", item_offset=120, item_limit=30, array_path="shotTableData.rows")
        self.assertEqual(result["capabilityStatus"], "known")
        self.assertEqual(result["membership"]["shotTableData.rows"][0]["id"], "shot-121")
        self.assertEqual(result["pagination"]["arrays"]["shotTableData.rows"]["total"], 121)
        cells = read_node_state(canvas, "table", array_path="shotTableData.rows.120.cells", item_offset=1, item_limit=1)
        self.assertEqual(cells["membership"]["shotTableData.rows"][0]["cells"], [{"columnId": "custom-1", "value": "红衣"}])
        self.assertEqual(canvas, before)

    def test_long_row_prompt_has_real_text_pagination(self):
        canvas = self.canvas()
        a = read_node_state(canvas, "table", text_limit=6000, array_path="shotTableData.rows", item_offset=120)
        b = read_node_state(canvas, "table", text_offset=6000, text_limit=6000, array_path="shotTableData.rows", item_offset=120)
        self.assertEqual(a["membership"]["shotTableData.rows"][0]["imagePrompt"] + b["membership"]["shotTableData.rows"][0]["imagePrompt"], "长" * 12000)
        self.assertEqual(a["pagination"]["fields"]["shotTableData.rows.120.imagePrompt"]["nextOffset"], 6000)

    def test_real_analysis_confirmation_speech_and_generation_links_are_visible(self):
        result = read_node_state(self.canvas(), "table")
        self.assertEqual(result["runtime"]["taskId"], "analysis-1")
        self.assertEqual(result["runtime"]["status"], "idle")
        self.assertEqual(result["runtime"]["shotTableTask"]["quote"]["visionCalls"], 121)
        self.assertEqual(result["membership"]["shotTableData.generationMap"][0]["generatorId"], "gen")
        self.assertEqual(result["results"]["shotTableSpeech"]["status"], "ready")
        self.assertEqual(result["results"]["shotTableSpeech"]["segments"][0]["text"], "你好")

    def test_private_unknown_fields_and_unregistered_cells_are_not_transmitted(self):
        canvas = self.canvas()
        table = canvas["nodes"][0]["shotTableData"]
        table["source"].update(api_key="credential-value", path="D:\\private\\x")
        table["analysisSettings"].update(token="credential-value", nested={"password": "credential-value"})
        table["task"]["rowSnapshots"] = {"shot-1": "credential-value"}
        table["rows"][0]["cells"].update(token="credential-value", unregistered="credential-value")
        table["rows"][0]["keyframeUrl"] = "D:\\private\\x"
        result = read_node_state(canvas, "table")
        rendered = json.dumps(result, ensure_ascii=False)
        self.assertNotIn("credential-value", rendered)
        self.assertNotIn("D:\\private", rendered)
        self.assertNotIn("rowSnapshots", rendered)
        self.assertEqual(result["parameters"]["shotTableData"]["source"]["nodeId"], "video")


class ShotTableKnowledgeTests(unittest.TestCase):
    def test_shot_table_card_is_readable_but_does_not_claim_actions(self):
        snapshot = ProjectKnowledge().snapshot()
        entry = ProjectKnowledge.read(snapshot, "classic.shot_table", "execution")
        self.assertEqual(entry["nativeType"], "shot-table")
        self.assertIn("确认", entry["content"])
        self.assertEqual(entry["coverage"]["actionable"], "pending")
