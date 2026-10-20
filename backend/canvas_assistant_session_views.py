"""助手公开回合、原生动作和流结束事件的纯数据投影。"""
import copy


def public_skill_usage(turn):
    """仅公开该回合保存的实际 Skill 记录，不暴露正文或客户端当前选择。"""
    used = (turn.get("agent") or {}).get("skillsUsed") or []
    return [{key: str(item.get(key, ""))[:300] for key in ("id", "name", "version")}
            for item in used if isinstance(item, dict) and item.get("id") and item.get("name")]


def public_native(proposal):
    return {k:copy.deepcopy(v) for k,v in proposal.items() if k not in {'beforeClipData','baselineNodeIds','baselineGenerationMap','mediaExportPlan'}}


def final_event(final, request_id):
    return {"type": "turn_end", "state": final["state"], "error": final.get("error", ""),
            "turnId": request_id, "change": final.get("change"), "proposals": final.get("proposals") or [],
            "media": final.get("media") or [], "reply": final.get("reply", ""), "steps": final.get("steps", []),
            "skillsUsed": public_skill_usage(final)}
