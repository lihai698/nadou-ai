"""按原生节点类型投影状态；分页在投影前进行，不改变保存的画布。"""
from __future__ import annotations

import re
from typing import Any

from fastapi import HTTPException
from backend.canvas_assistant_operations import audio_task_active

IDENTITY_FIELDS = ("id", "type", "title", "name")
SIZE_FIELDS = set("ratio resolution quality customRatio customSize customRatioWidth customRatioHeight customWidth customHeight".split())
LOOP_FIELDS = set("count mode showPrompt imageInput videoInput loopStart imageBatchSize videoBatchSize".split())
MS_FIELDS = set("msgenModel msWidth msHeight msCustomModel msRatio msResolution msCustomRatio msCustomSize msCustomRatioWidth msCustomRatioHeight msCustomWidth msCustomHeight count fitImage msLoraEnabled msLoraId msLoraStrength".split())
COMFY_FIELDS = set("mode comfyMode width height enhanceStrength enhanceUpscale enhanceUpscaleRes editUpscale editUpscaleRes editModel comfyWorkflow count".split()) | SIZE_FIELDS
RH_FIELDS = set("rhMode rhPayment webappId workflowId instanceType rhConfigKey rhModel model count".split()) | SIZE_FIELDS
VIDEO_FIELDS = set("apiProvider model duration aspectRatio resolution enhancePrompt enableUpsample watermark cameraFixed generateAudio useFrameRoles multimodal".split())
AUDIO_FIELDS = set("audioProvider audioModel audioVoice audioSpeed audioPitch audioVolume audioFormat audioLanguage audioInstructions audioLyrics audioManualSelection".split())


SMART_SETTINGS = SIZE_FIELDS | MS_FIELDS | COMFY_FIELDS | RH_FIELDS | VIDEO_FIELDS | set("engine apiKind provider_id model seed steps guidance strength imageStrength outpaintEnabled outpaintRatio outpaintResolution outpaintCustomWidth outpaintCustomHeight videoProvider videoModel videoDuration videoAspect videoResolution videoEnhancePrompt videoEnableUpsample videoWatermark videoCameraFixed videoGenerateAudio videoMultimodal videoUseFrameRoles videoTrustedAsset videoTrustedSource rhConfigKey rhInstanceType jimengUpscaleRes".split())
PARAMETERS = {
    "image": {"kind", "role", "mime", "width", "height", "duration"}, "prompt": set(), "promptGroup": set(),
    "audio": {"kind", "mime", "duration", "durationSeconds", "sizeBytes"},
    "loop": LOOP_FIELDS, "group": {"groupMode"}, "llm": {"llmProvider", "model", "mode", "showSystem"},
    "generator": SIZE_FIELDS | {"apiProvider", "model", "count", "outputEnabled"},
    "midjourney": set("apiProvider mode size version speed count lastAction lastImageCount outputEnabled".split()),
    "msgen": MS_FIELDS | {"outputEnabled"}, "video": VIDEO_FIELDS | {"outputEnabled"},
    "rh": RH_FIELDS | {"outputEnabled"}, "comfy": COMFY_FIELDS | {"outputEnabled"},
    "clip": set(), "output": set(), "shot-table": set(),
    "smart-image": {"engine", "apiProvider", "model"},
    "smart-prompt": set("promptSeparator promptSplitEnabled llmEnabled llmProvider llmModel llmSystemEnabled".split()),
    "smart-loop": LOOP_FIELDS, "smart-group": set(), "smart-shot-table": set(),
}
SMART_SETTINGS |= AUDIO_FIELDS
PARAMETERS['generator'] |= AUDIO_FIELDS
TEXT_BY_TYPE = {
    "prompt": ("text",), "llm": ("systemPrompt", "chatInput", "userInput", "outputText"),
    "loop": ("variablePrompt", "fixedPrompt"), "smart-loop": ("variablePrompt", "fixedPrompt"),
    "smart-prompt": ("text", "llmSystemPrompt", "llmInstruction", "outputText"),
    "smart-image": ("prompt", "promptDraftText", "promptDraftHtml", "lastPrompt", "runPrompt", "runModelPrompt"),
    "midjourney": ("lastPrompt", "mjModalPrompt"), "generator": ("viewAdjustPrompt",),
}
MEDIA_FIELDS = set("id url thumbnail thumb name kind role mime width height duration durationSeconds sizeBytes sourceNodeId nodeId imageIndex outputIndex start end trimIn trimOut".split())
SECRET_KEY = re.compile(r"api.?key|access.?key|secret|token|authorization|password|credential|cookie|headers|path|directory", re.I)
LOCAL_PATH = re.compile(r"(?:[A-Za-z]:[\\/]|\\\\|file://)")


def _scalar(value: Any) -> Any:
    if isinstance(value, (str, int, float, bool)) or value is None:
        return "[本机路径已隐藏]" if isinstance(value, str) and LOCAL_PATH.search(value) else value
    return None


def _project(value: Any, fields: set) -> dict:
    return {k: _scalar(v) for k, v in value.items() if k in fields and not SECRET_KEY.search(k)
            and (v is None or isinstance(v, (str, int, float, bool)))} if isinstance(value, dict) else {}


def _dynamic(value: Any) -> dict:
    # 动态参数只允许标量，以及原生 RunningHub 的 {value: 标量}，不透传任意嵌套对象。
    result = {}
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str) or SECRET_KEY.search(key):
                continue
            wrapped = isinstance(item, dict) and "value" in item
            scalar = item.get("value") if wrapped else item
            if isinstance(scalar, (str, int, float, bool)) and not (isinstance(scalar, str) and LOCAL_PATH.search(scalar)):
                result[key] = {"value": scalar} if wrapped else scalar
                if wrapped and type(item.get("sourceFromUpstream")) is bool:
                    result[key]["sourceFromUpstream"] = item["sourceFromUpstream"]
    return result


def _media(value: Any) -> Any:
    return _project(value, MEDIA_FIELDS) if isinstance(value, dict) else _scalar(value)


def _validate_page(offset: int, limit: int, maximum: int) -> None:
    if type(offset) is not int or type(limit) is not int or offset < 0 or not 1 <= limit <= maximum:
        raise HTTPException(422, "状态读取分页参数超出范围")


def _page(value: Any, offset: int, limit: int) -> tuple[Any, dict]:
    chunk = value[offset:offset + limit]
    end = offset + len(chunk)
    return chunk, {"total": len(value), "offset": offset, "returned": len(chunk), "nextOffset": end if end < len(value) else None}


def _type(canvas: dict, node: dict) -> str:
    value = node.get("type") or ""
    if canvas.get("kind") == "smart" and value in ("", "smart-container"):
        return "smart-image"
    return value


def read_node_state(canvas: dict, node_id: str, *, text_offset: int = 0, text_limit: int = 12000, item_offset: int = 0, item_limit: int = 30, array_path: str = "") -> dict:
    _validate_page(text_offset, text_limit, 24000)
    _validate_page(item_offset, item_limit, 100)
    if not isinstance(array_path, str) or len(array_path) > 180 or (array_path and not re.fullmatch(r"[A-Za-z0-9_.]+", array_path)):
        raise HTTPException(422, "数组路径只能使用返回的 pagination.arrays 字段路径")
    node = next((n for n in canvas.get("nodes", []) if isinstance(n, dict) and n.get("id") == node_id), None)
    if node is None:
        raise HTTPException(404, "当前画布找不到指定节点")
    node_type = _type(canvas, node)
    known = node_type in PARAMETERS
    content, text_pages, arrays, membership, results = {}, {}, {}, {}, {}

    def bounded_text(value, path):
        if isinstance(value, str):
            chunk, text_pages[path] = _page(_scalar(value), text_offset, text_limit)
            return chunk
        return _scalar(value)

    def bounded_array(values, path, project):
        offset, limit = item_offset, item_limit
        if array_path and array_path != path:
            offset = 0
            if array_path.startswith(path + "."):
                parent_index = array_path[len(path)+1:].split(".", 1)[0]
                if parent_index.isdigit():
                    offset, limit = int(parent_index), 1
        chunk, arrays[path] = _page(values, offset, limit)
        return [project(v, f"{path}.{offset+i}") for i, v in enumerate(chunk)]

    def media(value, path):
        result = _media(value)
        if isinstance(value, dict) and isinstance(value.get("run"), dict):
            run = value["run"]
            result["run"] = _project(run, SIZE_FIELDS | VIDEO_FIELDS | set("id nodeId nodeType taskLabel provider providerId model createdAt".split()))
            if "prompt" in run:
                result["run"]["prompt"] = bounded_text(run["prompt"], path + ".run.prompt")
            if isinstance(run.get("node"), dict):
                submitted = run["node"]
                submitted_type = run.get("nodeType") or submitted.get("type")
                result["run"]["node"] = _project(submitted, PARAMETERS.get(submitted_type, set()))
                for dynamic in ("rhParams", "comfyParams"):
                    if dynamic in submitted and submitted_type in {"rh", "comfy"}:
                        result["run"]["node"][dynamic] = _dynamic(submitted[dynamic])
            if isinstance(run.get("refs"), list):
                result["run"]["refs"] = bounded_array(run["refs"], path + ".run.refs", lambda v, p: _media(v))
        return result

    for field in TEXT_BY_TYPE.get(node_type, ("text",)):
        if isinstance(node.get(field), str):
            content[field], text_pages[field] = _page(_scalar(node[field]), text_offset, text_limit)
    if known and isinstance(node.get("audioOutputText"), str):
        content['audioOutputText'] = bounded_text(node['audioOutputText'], 'audioOutputText')
    parameters = _project(node, PARAMETERS.get(node_type, set()))
    for field in ("settings", "runSettings") if node_type == "smart-image" else ():
        if isinstance(node.get(field), dict):
            parameters[field] = _project(node[field], SMART_SETTINGS)
            for dynamic in ("rhParams", "comfyParams"):
                if dynamic in node[field]:
                    parameters[field][dynamic] = _dynamic(node[field][dynamic])
    if node_type == "smart-image" and isinstance(canvas.get("settings"), dict):
        parameters["canvasDefaults"] = _project(canvas["settings"], SMART_SETTINGS)
    for field in ("rhParams",) if node_type == "rh" else ("comfyParams",) if node_type == "comfy" else ():
        if field in node:
            parameters[field] = _dynamic(node[field])
    prefixes = ("rh",) if node_type == "rh" else ("comfy",) if node_type == "comfy" else ()
    for prefix in prefixes:
        for suffix in ("RandomActive", "RandomValues"):
            key = prefix + suffix
            if key in node:
                parameters[key] = _dynamic(node[key])
    def scalar_item(value, path):
        return _scalar(value)

    def message(value, path):
        result = _project(value, {"role"})
        if isinstance(value, dict) and "content" in value:
            result["content"] = bounded_text(value["content"], path + ".content")
        return result

    array_fields = {"inputs": scalar_item, "inputNodeIds": scalar_item} if known else {}
    if node_type in {"group", "promptGroup", "smart-group"}:
        array_fields["items"] = scalar_item
    if node_type == "smart-image":
        array_fields.update(runPromptRefs=media, runInputRefs=media)
    if node_type == "smart-loop":
        array_fields['variablePrompts'] = bounded_text


    if node_type == "llm":
        array_fields["messages"] = message
    for field, project in array_fields.items():
        if isinstance(node.get(field), list):
            membership[field] = bounded_array(node[field], field, project)
    for field in ("rhAppInfo", "rhWorkflowInfo") if node_type == "rh" else ():
        values = (node.get(field) or {}).get("nodeInfoList", []) if isinstance(node.get(field), dict) else []
        schema_fields = set("nodeId fieldName fieldType type label description default min max step required imageOrder role random_enabled fieldValue".split())
        def schema(value, path):
            if not isinstance(value, dict):
                return {}
            if any(SECRET_KEY.search(str(value.get(key, ""))) for key in ("fieldName", "label")):
                return _project(value, {"nodeId", "fieldName", "fieldType", "type", "label", "required"})
            projected = _project(value, schema_fields)
            for option_field in ("options", "choices", "fieldData", "list", "values", "enum", "items", "selectOptions", "dropdown"):
                if isinstance(value.get(option_field), list):
                    projected[option_field] = bounded_array(value[option_field], path + "." + option_field, lambda v, path: _project(v, {"label", "value"}) if isinstance(v, dict) else _scalar(v))
            return projected
        membership[field + ".nodeInfoList"] = bounded_array(values, field + ".nodeInfoList", schema)
    if known:
        for field in ("images", "videos", "generatedImages", "generatedOutputs"):
            if isinstance(node.get(field), list):
                results[field] = bounded_array(node[field], field, media)
        for field in ("url", "result", "lastResult"):
            if field in node:
                results[field] = _media(node[field])
    if node_type == "clip" and isinstance(node.get("clipData"), dict):
        clip = node["clipData"]
        parameters["clipData"] = _project(clip, {"version", "fps", "selectedClipId", "exportMuted"})
        if isinstance(clip.get("clips"), list):
            fields = MEDIA_FIELDS | set("posterUrl sourceResultId sourceDurationFrames sourceOffsetFrames startFrame endFrame durationUnconfirmed".split())
            membership["clipData.clips"] = bounded_array(clip['clips'], 'clipData.clips', lambda v, p: _project(v, fields))
        if isinstance(clip.get('excludedSources'), list):
            membership['clipData.excludedSources'] = bounded_array(clip['excludedSources'], 'clipData.excludedSources', scalar_item)
    shot_table = node.get("shotTableData") if node_type in {"shot-table", "smart-shot-table"} else None
    shot_task = {}
    if isinstance(shot_table, dict):
        parameters["shotTableData"] = _project(shot_table, {"version", "revision"})
        parameters["shotTableData"]["source"] = _project(shot_table.get("source"), set("nodeId resultId sourceUrl title fingerprint durationSeconds".split()))
        selection = shot_table.get("analysisSettings") or {}
        parameters["shotTableData"]["analysisSettings"] = _project(selection, {"providerId", "model"})
        if isinstance(selection, dict) and isinstance(selection.get("speech"), dict):
            parameters["shotTableData"]["analysisSettings"]["speech"] = _project(selection["speech"], {"mode", "providerId", "model"})
        columns = shot_table.get("columns") if isinstance(shot_table.get("columns"), list) else []
        column_ids = {c.get("id") for c in columns if isinstance(c, dict) and isinstance(c.get("id"), str) and not SECRET_KEY.search(c["id"]) and not SECRET_KEY.search(str(c.get("label", "")))}

        def shot_row(value, path):
            result = _project(value, set("id index startSeconds endSeconds durationSeconds keyframeUrl carriedOver visionFailed".split()))
            if not isinstance(value, dict):
                return result
            for field in ("imagePrompt", "motionPrompt", "failureReason"):
                if field in value:
                    result[field] = bounded_text(value[field], path + "." + field)
            cells = value.get("cells") if isinstance(value.get("cells"), dict) else {}
            values = [{"columnId": k, "value": v} for k, v in cells.items() if k in column_ids and isinstance(v, str)]
            result["cells"] = bounded_array(values, path + ".cells", lambda v, p: {"columnId": v["columnId"], "value": bounded_text(v["value"], p + ".value")})
            return result

        for field, project in (("rows", shot_row), ("columns", lambda v, p: _project(v, {"id", "label", "kind", "hint"})), ("selectedRowIds", scalar_item)):
            if isinstance(shot_table.get(field), list):
                membership["shotTableData." + field] = bounded_array(shot_table[field], "shotTableData." + field, project)
        if isinstance(shot_table.get("generationMap"), dict):
            links = [{"key": k, **_project(v, {"promptId", "generatorId", "outputId"})} for k, v in shot_table["generationMap"].items() if isinstance(k, str)]
            membership["shotTableData.generationMap"] = bounded_array(links, "shotTableData.generationMap", lambda v, p: _project(v, {"key", "promptId", "generatorId", "outputId"}))
        task = shot_table.get("task") or {}
        shot_task = _project(task, set("taskId status phase progress progressDetail error failureKind".split()))
        if isinstance(task, dict):
            shot_task["quote"] = _project(task.get("quote"), set("id sourceFingerprint tableRevision visionCalls audioCalls framesPerShot expiresAt".split()))
            shot_task["coverage"] = _project(task.get("coverage"), set("capped detectedCuts keptCuts".split()))
        speech = shot_table.get("speech")
        if isinstance(speech, dict):
            results["shotTableSpeech"] = _project(speech, {"status", "error", "language"})
            if isinstance(speech.get("segments"), list):
                def speech_segment(value, path):
                    result = _project(value, {"start", "end"})
                    if isinstance(value, dict) and "text" in value:
                        result["text"] = bounded_text(value["text"], path + ".text")
                    return result
                results["shotTableSpeech"]["segments"] = bounded_array(speech["segments"], "shotTableData.speech.segments", speech_segment)
    connections = {"incoming": [], "outgoing": []}
    for edge in canvas.get("connections", []) or []:
        if not isinstance(edge, dict):
            continue
        projected = _project(edge, set("id from to kind role port fromPort toPort".split()))
        if edge.get("to") == node_id:
            connections["incoming"].append(projected)
        if edge.get("from") == node_id:
            connections["outgoing"].append(projected)
    video_task = node_type == "smart-image" and node.get("videoTaskId")
    status = (node.get("videoTaskStatus") if video_task else None) or node.get("lastTaskStatus") or node.get("runStatus") or node.get("status") or "unknown"
    runtime = {"taskId": _scalar(video_task or node.get("lastTaskId") or node.get("taskId") or ""), "status": _scalar(status),
               "error": _scalar((node.get("videoTaskError") if video_task else None) or node.get("runError") or node.get("error") or ""), "running": bool(node.get("running"))}
    if isinstance(shot_table, dict):
        runtime.update(taskId=shot_task.get("taskId", ""), status=shot_task.get("status", "unknown"), error=shot_task.get("error", ""), running=shot_task.get("status") == "running", shotTableTask=shot_task)
    if node_type in {'image', 'smart-image'} and isinstance(node.get('depthCapture'), dict):
        capture = _project(node['depthCapture'], set('operationId taskId sourceId sourceIndex sourceUrl role status stage progress error createdAt'.split()))
        runtime.update(taskId=capture.get('taskId', ''), status=capture.get('status', 'unknown'), error=capture.get('error', ''), running=capture.get('status') in {'queued', 'running'}, depthCapture=capture)
        results['depthCapture'] = _project(node['depthCapture'], {'result_url', 'pose_url', 'pose_data_url'})
    if known:
        if node.get('audioTaskId'):
            runtime.update(_project(node, {'audioTaskId', 'audioStatus', 'audioError', 'audioTaskOperation'}))
            runtime.update(taskId=_scalar(node['audioTaskId']), status=_scalar(node.get('audioStatus') or 'unknown'),
                           error=_scalar(node.get('audioError') or ''), busy=audio_task_active(node))
        runtime.update(_project(node, set("assistantTaskId assistantCompletedTaskId pending querying queryPaused submissionUnknown submissionWarning".split())))
        if isinstance(node.get('assistantNativeRun'),dict):runtime['assistantNativeRun']=_project(node['assistantNativeRun'],set('actionId taskKind taskIds unknownCount warning error knownRejected submissionStarted outputNodeId inputHash'.split()))
        if node_type == "smart-image":
            runtime.update(_project(node, set("runAt sourceNodeId videoTaskId videoTaskStatus videoTaskError taskFailureNotice".split())))
        if node_type == "midjourney":
            runtime.update(_project(node, {"mjModalTaskId", "lastAction", "lastImageCount"}))
        for field in ("pendingTasks", "_pending", "_directPending"):
            if isinstance(node.get(field), list):
                chunk, arrays[field] = _page(node[field], item_offset, item_limit)
                task_fields = set("id taskId canvasTaskId canvasTaskType upstreamTaskId status error kind providerId model querying queryPaused remoteRefreshable segmentId failed taskLost".split())
                runtime[field] = [_project(v, task_fields) for v in chunk]
    text_page = text_pages.get("text") or next(iter(text_pages.values()), _page("", text_offset, text_limit)[1])
    item_page = next(iter(arrays.values()), _page([], item_offset, item_limit)[1])
    if array_path and array_path not in arrays:
        raise HTTPException(422, "数组路径不在该节点的白名单分页字段中")
    return {"nodeId": node_id, "type": node_type, "kind": canvas.get("kind"), "identity": _project(node, set(IDENTITY_FIELDS)),
            "capabilityStatus": "known" if known else "unknown", "updatedAt": canvas.get("updated_at", 0),
            "parameters": parameters, "content": content, "membership": membership, "connections": connections,
            "runtime": runtime, "results": results,
            "pagination": {"text": text_page, "fields": text_pages, "items": item_page, "arrays": arrays}}


def canvas_overview(canvas: dict, *, node_ids: list[str] | None = None, offset: int = 0, limit: int = 50) -> dict:
    _validate_page(offset, limit, 100)
    all_nodes = [n for n in canvas.get("nodes", []) if isinstance(n, dict)]
    nodes = all_nodes
    if node_ids:
        by_id = {n.get("id"): n for n in nodes}
        if not set(node_ids).issubset(by_id):
            raise HTTPException(409, "选中的节点已变化，请刷新后重试")
        nodes = [by_id[i] for i in dict.fromkeys(node_ids)]
    chunk, page = _page(nodes, offset, limit)
    summaries = [dict(_project(n, set(IDENTITY_FIELDS)), type=_type(canvas, n)) for n in chunk]
    return {"nodes": summaries, "page": page, "canvasTotal": len(all_nodes), "selectedNodeIds": list(dict.fromkeys(node_ids or []))}
