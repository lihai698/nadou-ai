import unittest

from fastapi import HTTPException

from backend.canvas_assistant_state import canvas_overview, read_node_state


class CanvasAssistantStateTests(unittest.TestCase):
    def test_audio_material_and_paused_task_are_read_without_private_settings(self):
        canvas = {'kind':'classic','nodes':[
            {'id':'audio','type':'audio','url':'/assets/input/test.wav','durationSeconds':3,'sizeBytes':2048},
            {'id':'gen','type':'generator','audioTaskId':'original-audio',
             'audioStatus':'query-paused','audioError':'查询暂停','running':False,
             'audioOutputText':'识别正文','audioModel':'voice-model','audioProvider':'voice','audioLyrics':'原歌词',
             'audioRunSnapshot':{'prompt':'私有未公开字段','api_key':'PRIVATE'}}]}
        audio = read_node_state(canvas,'audio')
        self.assertEqual(audio['capabilityStatus'],'known')
        self.assertEqual(audio['results']['url'],'/assets/input/test.wav')
        self.assertEqual(audio['parameters']['durationSeconds'],3)
        self.assertEqual(audio['parameters']['sizeBytes'],2048)
        generator = read_node_state(canvas,'gen')
        self.assertEqual(generator['runtime']['taskId'],'original-audio')
        self.assertEqual(generator['runtime']['status'],'query-paused')
        self.assertTrue(generator['runtime']['busy'])
        self.assertEqual(generator['content']['audioOutputText'],'识别正文')
        self.assertEqual(generator['parameters']['audioLyrics'],'原歌词')
        self.assertNotIn('PRIVATE',repr(generator))
        self.assertNotIn('audioRunSnapshot',repr(generator))

    def test_smart_loop_fields_keep_multiline_boundaries_and_nested_text_pages(self):
        values = ['首行\n同一个字段第二行', '', '尾字段' + '甲' * 24001]
        canvas = {'kind': 'smart', 'nodes': [{'id': 's', 'type': 'smart-loop', 'variablePrompts': values, 'variablePrompt': '\n'.join(filter(None, values))}]}
        first = read_node_state(canvas, 's', item_limit=2, array_path='variablePrompts')
        self.assertEqual(first['membership']['variablePrompts'], values[:2])
        self.assertEqual(first['pagination']['arrays']['variablePrompts']['nextOffset'], 2)
        tail = read_node_state(canvas, 's', item_offset=2, item_limit=1, text_offset=24000, text_limit=100, array_path='variablePrompts')
        self.assertEqual(tail['membership']['variablePrompts'], [values[2][24000:]])
        self.assertEqual(tail['pagination']['fields']['variablePrompts.2']['total'], len(values[2]))
        self.assertEqual(canvas['nodes'][0]['variablePrompts'], values)

    def test_clip_excluded_sources_page_preserves_native_key_and_hides_paths(self):
        import json
        keys = [json.dumps(['source', 'result-' + str(i)]) for i in range(105)]
        keys.append(json.dumps(['source', 'C:/private/movie.mp4']))
        canvas = {'kind': 'classic', 'nodes': [{'id': 'c', 'type': 'clip', 'clipData': {'clips': [], 'excludedSources': keys}}]}
        result = read_node_state(canvas, 'c', item_offset=100, item_limit=6, array_path='clipData.excludedSources')
        self.assertEqual(result['membership']['clipData.excludedSources'][:5], keys[100:105])
        self.assertEqual(result['pagination']['arrays']['clipData.excludedSources']['total'], 106)
        self.assertNotIn('private', repr(result))
        self.assertEqual(canvas['nodes'][0]['clipData']['excludedSources'], keys)

    def test_depth_pair_runtime_uses_original_task_and_role_not_static_media_status(self):
        for kind, node_type in [('classic', 'image'), ('smart', 'smart-image')]:
            capture = {'operationId': 'op', 'taskId': 'depth-1', 'sourceId': 'src', 'sourceIndex': 2, 'sourceUrl': '/assets/video.mp4', 'role': 'pose', 'status': 'running', 'stage': 'pose', 'progress': 30, 'error': '', 'pose_data_url': '/output/pose.json', 'token': 'PRIVATE'}
            canvas = {'kind': kind, 'nodes': [{'id': 'd', 'type': node_type, 'depthCapture': capture}]}
            result = read_node_state(canvas, 'd')
            self.assertEqual(result['runtime']['taskId'], 'depth-1')
            self.assertTrue(result['runtime']['running'])
            self.assertEqual(result['runtime']['depthCapture']['sourceIndex'], 2)
            self.assertEqual(result['runtime']['depthCapture']['role'], 'pose')
            self.assertEqual(result['results']['depthCapture']['pose_data_url'], '/output/pose.json')
            self.assertNotIn('PRIVATE', repr(result))

    def canvas(self):
        return {
            "id": "c", "kind": "classic", "updated_at": 12,
            "nodes": [
                {"id": "p", "type": "prompt", "title": "P", "text": "x" * 30001},
                {"id": "g", "type": "group", "items": ["p"], "settings": {"api_key": "secret"}},
                {"id": "loop", "type": "loop", "count": 3, "mode": "serial", "variablePrompt": "{x}"},
            ],
            "connections": [{"id": "e", "from": "p", "to": "loop", "kind": "input", "role": "prompt"}],
        }

    def test_long_text_can_be_read_in_pages(self):
        canvas = self.canvas()
        first = read_node_state(canvas, "p", text_offset=0, text_limit=12000)
        second = read_node_state(canvas, "p", text_offset=12000, text_limit=12000)
        third = read_node_state(canvas, "p", text_offset=24000, text_limit=12000)
        self.assertEqual(first["content"]["text"] + second["content"]["text"] + third["content"]["text"], "x" * 30001)
        self.assertEqual(first["pagination"]["text"]["nextOffset"], 12000)

    def test_large_canvas_reports_total_and_next_offset(self):
        canvas = self.canvas()
        canvas["nodes"].extend({"id": f"n{i}", "type": "text", "text": str(i)} for i in range(130))
        page = canvas_overview(canvas, offset=0, limit=50)
        self.assertEqual(page["page"]["total"], 133)
        self.assertEqual(page["page"]["nextOffset"], 50)
        self.assertIn("p", [node["id"] for node in page["nodes"]])

    def test_members_and_connection_roles_survive_projection(self):
        result = read_node_state(self.canvas(), "g")
        self.assertEqual(result["membership"]["items"], ["p"])
        loop = read_node_state(self.canvas(), "loop")
        self.assertEqual(loop["connections"]["incoming"][0]["role"], "prompt")

    def test_nested_credentials_and_local_paths_are_not_exposed(self):
        canvas = self.canvas()
        canvas["nodes"][1]["settings"] = {"api_key": "secret", "local_path": "D:\\private\\file.png"}
        result = read_node_state(canvas, "g")
        rendered = repr(result)
        self.assertNotIn("secret", rendered)
        self.assertNotIn("api_key", rendered)
        self.assertNotIn("D:\\private", rendered)

    def test_current_canvas_only_and_missing_node_rejected(self):
        with self.assertRaises(HTTPException):
            read_node_state(self.canvas(), "other")

    def test_unknown_type_is_reported_without_claiming_semantics(self):
        canvas = {"id": "c", "updated_at": 1, "nodes": [{"id": "u", "type": "future-node", "text": "x"}], "connections": []}
        result = read_node_state(canvas, "u")
        self.assertEqual(result["type"], "future-node")
        self.assertEqual(result["capabilityStatus"], "unknown")

    def test_draft_submitted_input_and_result_are_distinct(self):
        canvas = {"id": "c", "updated_at": 1, "nodes": [{"id": "i", "type": "smart-image", "promptDraftText": "draft", "lastTaskId": "t1", "images": [{"url": "/assets/result.png"}]}], "connections": []}
        result = read_node_state(canvas, "i")
        self.assertEqual(result["content"]["promptDraftText"], "draft")
        self.assertEqual(result["runtime"]["taskId"], "t1")
        self.assertEqual(result["results"]["images"][0]["url"], "/assets/result.png")

    def test_members_and_results_after_first_hundred_can_be_read(self):
        canvas = {"kind": "classic", "nodes": [{"id": "g", "type": "group", "items": list(map(str, range(205)))}]}
        result = read_node_state(canvas, "g", item_offset=100, item_limit=100)
        self.assertEqual(result["membership"]["items"], list(map(str, range(100, 200))))
        self.assertEqual(result["pagination"]["arrays"]["items"]["nextOffset"], 200)
        canvas["nodes"] = [{"id": "o", "type": "output", "images": [f"/output/{i}.png" for i in range(205)]}]
        result = read_node_state(canvas, "o", item_offset=200, item_limit=100)
        self.assertEqual(len(result["results"]["images"]), 5)
        self.assertEqual(result["pagination"]["arrays"]["images"]["total"], 205)

    def test_type_whitelists_and_unknown_node_do_not_expose_arbitrary_config(self):
        for node_type in ("prompt", "future-node"):
            canvas = {"kind": "classic", "nodes": [{"id": "p", "type": node_type, "settings": {"unlisted": "private"}, "workflow": "private", "count": 30}]}
            self.assertEqual(read_node_state(canvas, "p")["parameters"], {})

    def test_native_workflow_and_run_fields_are_read_without_credentials(self):
        canvas = {"kind": "classic", "nodes": [{"id": "r", "type": "rh", "rhParams": {"steps": 12, "enabled": True, "apiKey": "private", "nested": {"arbitrary": "private"}, "file": "C:\\private\\x"}, "runStatus": "failed", "runError": "failure", "running": False}]}
        result = read_node_state(canvas, "r")
        self.assertEqual(result["parameters"]["rhParams"], {"steps": 12, "enabled": True})
        self.assertEqual(result["runtime"]["status"], "failed")
        self.assertEqual(result["runtime"]["error"], "failure")
        self.assertNotIn("private", repr(result))

    def test_missing_type_only_infers_smart_image_on_smart_canvas(self):
        canvas = {"kind": "classic", "nodes": [{"id": "u"}]}
        self.assertEqual(read_node_state(canvas, "u")["capabilityStatus"], "unknown")
        canvas["kind"] = "smart"
        self.assertEqual(read_node_state(canvas, "u")["type"], "smart-image")

    def test_selection_reads_exact_requested_nodes_in_order(self):
        canvas = {"nodes": [{"id": str(i), "type": "prompt"} for i in range(130)]}
        result = canvas_overview(canvas, node_ids=["129", "1"])
        self.assertEqual([n["id"] for n in result["nodes"]], ["129", "1"])
        self.assertEqual(result["page"]["total"], 2)
        with self.assertRaises(HTTPException):
            canvas_overview(canvas, node_ids=["missing"])

    def test_native_task_batches_and_smart_defaults_are_read(self):
        canvas = {"kind": "smart", "settings": {"engine": "comfy", "comfyMode": "edit", "videoDuration": 8, "api_key": "private"}, "nodes": [{"id": "s", "type": "smart-image", "pendingTasks": [{"taskId": "t1", "kind": "image", "querying": False, "queryPaused": True, "headers": {"Authorization": "private"}}], "runSettings": {"apiKind": "video", "videoModel": "v1", "videoDuration": 8}}]}
        result = read_node_state(canvas, "s")
        self.assertEqual(result["runtime"]["pendingTasks"][0]["taskId"], "t1")
        self.assertTrue(result["runtime"]["pendingTasks"][0]["queryPaused"])
        self.assertEqual(result["parameters"]["runSettings"]["apiKind"], "video")
        self.assertEqual(result["parameters"]["canvasDefaults"]["comfyMode"], "edit")
        self.assertNotIn("private", repr(result))

    def test_runninghub_value_and_schema_are_projected(self):
        canvas = {"kind": "classic", "nodes": [{"id": "r", "type": "rh", "rhParams": {"12:steps": {"value": 10, "sourceFromUpstream": False, "headers": {"token": "private"}}}, "rhAppInfo": {"nodeInfoList": [{"nodeId": "12", "fieldName": "steps", "type": "number", "min": 1, "max": 30, "default": 10, "api_key": "private"}]}}]}
        result = read_node_state(canvas, "r")
        self.assertFalse(result["parameters"]["rhParams"]["12:steps"]["sourceFromUpstream"])
        self.assertEqual(result["membership"]["rhAppInfo.nodeInfoList"][0]["max"], 30)


    def test_workflow_random_state_survives_read(self):
        for node_type, prefix in (("rh", "rh"), ("comfy", "comfy")):
            canvas = {"kind": "classic", "nodes": [{"id": "r", "type": node_type, prefix + "RandomActive": {"seed": False}, prefix + "RandomValues": {"seed": 123}}]}
            result = read_node_state(canvas, "r")
            self.assertFalse(result["parameters"][prefix + "RandomActive"]["seed"])
            self.assertEqual(result["parameters"][prefix + "RandomValues"]["seed"], 123)


    def test_runninghub_schema_credentials_are_hidden_by_field_identity(self):
        canvas = {"kind": "classic", "nodes": [{"id": "r", "type": "rh", "rhAppInfo": {"nodeInfoList": [{"nodeId": "1", "fieldName": "api_key", "fieldValue": "TEST_ONLY_FAKE_SECRET", "default": "TEST_ONLY_FAKE_SECRET", "options": ["TEST_ONLY_FAKE_SECRET"]}, {"nodeId": "2", "fieldName": "param", "label": "Access Token", "fieldValue": "TEST_ONLY_FAKE_SECRET"}]}}]}
        self.assertNotIn("TEST_ONLY_FAKE_SECRET", repr(read_node_state(canvas, "r")))

    def test_workflow_group_mode_is_read_alongside_member_ids(self):
        canvas = {"kind": "classic", "nodes": [{"id": "g", "type": "group", "groupMode": "workflow", "items": ["generator", "prompt"]}]}
        result = read_node_state(canvas, "g")
        self.assertEqual(result["parameters"]["groupMode"], "workflow")
        self.assertEqual(result["membership"]["items"], ["generator", "prompt"])

    def test_smart_submitted_prompt_refs_and_video_task_are_distinct_from_draft(self):
        canvas = {"kind": "smart", "nodes": [{"id": "s", "promptDraftText": "new draft", "runPrompt": "submitted display", "runModelPrompt": "original request", "runAt": 123, "sourceNodeId": "upstream", "runPromptRefs": [{"url": "/assets/ref.png", "imageIndex": 2}], "runInputRefs": [{"url": "/assets/ref.png"}], "videoTaskId": "video-1", "videoTaskStatus": "query-paused", "videoTaskError": "remote unknown", "taskFailureNotice": "do not resubmit"}]}
        result = read_node_state(canvas, "s")
        self.assertEqual(result["content"]["runModelPrompt"], "original request")
        self.assertEqual(result["content"]["promptDraftText"], "new draft")
        self.assertEqual(result["membership"]["runPromptRefs"][0]["imageIndex"], 2)
        self.assertEqual(result["membership"]["runInputRefs"][0]["url"], "/assets/ref.png")
        self.assertEqual(result["runtime"]["runAt"], 123)
        self.assertEqual(result["runtime"]["sourceNodeId"], "upstream")
        self.assertEqual(result["runtime"]["taskId"], "video-1")
        self.assertEqual(result["runtime"]["status"], "query-paused")
        self.assertEqual(result["runtime"]["error"], "remote unknown")
        self.assertEqual(result["runtime"]["taskFailureNotice"], "do not resubmit")

    def test_llm_history_content_obeys_text_paging(self):
        canvas = {"kind": "classic", "nodes": [{"id": "l", "type": "llm", "messages": [{"role": "user", "content": "x" * 30001}]}]}
        first = read_node_state(canvas, "l", text_limit=100, item_limit=1)
        self.assertEqual(len(first["membership"]["messages"][0]["content"]), 100)
        self.assertEqual(first["pagination"]["fields"]["messages.0.content"]["total"], 30001)
        second = read_node_state(canvas, "l", text_offset=30000, text_limit=100, item_limit=1)
        self.assertEqual(second["membership"]["messages"][0]["content"], "x")

    def test_runninghub_model_and_schema_aliases_and_mj_modal_are_readable(self):
        canvas = {"kind": "classic", "nodes": [{"id": "r", "type": "rh", "rhMode": "model", "rhConfigKey": "model:m", "rhModel": "m", "model": "m", "ratio": "wide", "rhAppInfo": {"nodeInfoList": [{"nodeId": "1", "fieldName": "sampler", "random_enabled": True, "fieldValue": "euler", "fieldData": ["euler", "dpm"]}]}}, {"id": "mj", "type": "midjourney", "mjModalTaskId": "modal-1"}]}
        rh = read_node_state(canvas, "r")
        self.assertEqual(rh["parameters"]["rhConfigKey"], "model:m")
        self.assertEqual(rh["parameters"]["model"], "m")
        self.assertEqual(rh["parameters"]["ratio"], "wide")
        field = rh["membership"]["rhAppInfo.nodeInfoList"][0]
        self.assertTrue(field["random_enabled"])
        self.assertEqual(field["fieldData"], ["euler", "dpm"])
        self.assertEqual(read_node_state(canvas, "mj")["runtime"]["mjModalTaskId"], "modal-1")


if __name__ == "__main__":
    unittest.main()
