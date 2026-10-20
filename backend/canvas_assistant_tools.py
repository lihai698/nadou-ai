"""模型、参数校验与界面共享的有限画布工具协议。"""
from __future__ import annotations

import json
import re
from typing import Literal

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from backend.canvas_assistant_operation_schema import AssistantPlan, parse_plan
from backend.canvas_assistant_story_schema import StoryWorkflow, StoryAnalysis, StoryAnalysisResult, ShotPrompts, ShotImages


class StrictArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ReadCanvas(StrictArgs):
    nodeIds: list[str] = Field(default_factory=list, max_length=30)
    offset: int = Field(default=0, ge=0)
    limit: int = Field(default=50, ge=1, le=100)


class ReadProjectKnowledge(StrictArgs):
    capabilityId: str = Field(min_length=1, max_length=120)
    section: str = Field(default="overview", max_length=40)


class ReadNodeState(StrictArgs):
    nodeId: str = Field(min_length=1, max_length=100)
    textOffset: int = Field(default=0, ge=0)
    textLimit: int = Field(default=12000, ge=1, le=24000)
    itemOffset: int = Field(default=0, ge=0)
    itemLimit: int = Field(default=30, ge=1, le=100)
    arrayPath: str = Field(default="", max_length=180, description="补读嵌套数组时填 pagination.arrays 返回的字段路径，如 segments.0.refs.image")


OperationList = AssistantPlan.model_fields["operations"].annotation


class Operations(StrictArgs):
    operations: OperationList = Field(min_length=1, max_length=20)


class ProposeImage(StrictArgs):
    title: str = Field(default="", max_length=80)
    prompt: str = Field(min_length=1, max_length=12000)


class ReadTask(StrictArgs):
    proposalId: str = Field(min_length=1, max_length=100)


class InspectResult(StrictArgs):
    assetIds: list[str] = Field(default_factory=list, max_length=8, description='当前画布真实图片或视频素材编号；最多2段视频，每段最多3帧，总视觉输入不超过8张')
    proposalId: str = Field(default="", max_length=100, description='本轮已确认图片方案或已受理的原生视频 run 动作编号，核对原任务与确认要求')


class RecordResultReview(StrictArgs):
    inspectionId: str = Field(min_length=1, max_length=180)
    status: Literal['passed', 'needs_changes', 'unknown']
    findings: list[str] = Field(min_length=1, max_length=12)
    limitations: list[str] = Field(default_factory=list, max_length=12)


class ReadSkill(StrictArgs):
    skillId: Literal["poster-layout", "reference-edit", "prompt-polish"]
    file: str = Field(default="SKILL.md", max_length=160)


class ReadNativeCapabilities(StrictArgs):
    nodeId: str = Field(default='',max_length=100)
    offset: int = Field(default=0,ge=0)
    limit: int = Field(default=50,ge=1,le=100)


class ReadNativeTask(StrictArgs):
    nodeId: str = Field(min_length=1,max_length=100)
    taskKind: Literal['depth','image','video','comfy']
    taskId: str = Field(min_length=1,max_length=240)


class ProposeNativeAction(StrictArgs):
    action: str = Field(min_length=1, max_length=40)
    nodeId: str = Field(default='', max_length=100)
    type: str = Field(default='', max_length=40)
    patch: dict = Field(default_factory=dict, max_length=30)
    taskKind: Literal['depth','image','video','comfy'] | None = None
    taskId: str | None = Field(default=None,min_length=1,max_length=240)
    values: list[str] | None = Field(default=None, max_length=100)
    memberIds: list[str] | None = Field(default=None, max_length=100)
    sourceId: str | None = Field(default=None,max_length=100)
    maxCalls: int | None = Field(default=None,ge=1,le=100)
    segmentId: str | None = Field(default=None, max_length=100)
    track: Literal['segments','audioSegments'] | None = None
    changes: list[dict] | None = Field(default=None,min_length=1,max_length=100)
    rowId: str | None = Field(default=None,max_length=100)
    columnId: str | None = Field(default=None,max_length=160)
    value: str | None = Field(default=None,max_length=12000)
    columnAction: Literal['add','rename','delete'] | None = None
    label: str | None = Field(default=None,max_length=60)
    selectedRowIds: list[str] | None = Field(default=None,max_length=121)
    clipId: str | None = Field(default=None, max_length=100)
    clipAction: str | None = Field(default=None, max_length=40)
    startFrame: int | None = Field(default=None, ge=0)
    endFrame: int | None = Field(default=None, ge=0)
    nodeIds: list[str] | None = Field(default=None, min_length=1, max_length=100, description='export 的当前画布节点范围，包含 nodeId；省略时仅导出锚点')
    includeResources: bool | None = Field(default=None, description='export 必填：false 导出 JSON 资源引用，true 导出含本地资源 ZIP；仅发起浏览器下载')
    scope: Literal['full','segments','selected'] | None = None
    destination: Literal['canvas','download'] | None = None
    exportMuted: bool | None = None


class PlanStep(StrictArgs):
    id: str = Field(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")
    description: str = Field(min_length=1, max_length=240)
    dependsOn: list[str] = Field(default_factory=list, max_length=40)


class CreatePlan(StrictArgs):
    goal: str = Field(min_length=1, max_length=12000)
    steps: list[PlanStep] = Field(min_length=1, max_length=40)
    preserve: list[str] = Field(default_factory=list, max_length=40)
    requirements: list[str] = Field(default_factory=list, max_length=40)


class ExecutePlanStep(StrictArgs):
    stepId: str = Field(min_length=1, max_length=80)
    tool: Literal['read_canvas', 'read_project_knowledge', 'read_node_state', 'read_skill',
                  'read_native_capabilities', 'read_native_task', 'apply_canvas_operations',
                  'propose_native_action', 'inspect_result', 'record_result_review', 'create_story_workflow', 'create_story_analysis', 'import_story_analysis', 'create_shot_prompts', 'create_shot_images']
    arguments: dict = Field(default_factory=dict)


TOOLS = {
    'create_shot_images': ('创建逐镜配图节点','读取指定镜头真实LLM结果，连接原生图片节点并绑定用户所选图片模型；只创建不提交。重复调用复用同一节点，newAttempt仅在用户明确要求重做同镜时使用，原图保留。',ShotImages),
    'create_shot_prompts': ('创建逐镜提示词处理','为指定镜头建立素材到原生LLM的输入连接，绑定用户所选文本模型；不运行模型、不生成图片。修改单镜后可仅刷新该镜素材。',ShotPrompts),
    'create_story_analysis': ('创建模型分析流程','为已保存原文创建真实原生LLM分析节点，绑定用户已选文本模型；不运行、不需要图片模型',StoryAnalysis),
    'import_story_analysis': ('导入分析分镜','读取已运行分析节点的真实JSON结果，校验原文及模型后生成或更新原生分镜表；不调用模型',StoryAnalysisResult),
    'create_story_workflow': ('保存故事分镜结果图', '保存助手已写好的故事拆解、资产、原生分镜表与配图链；这是内容结果图，没有阶段性模型执行节点', StoryWorkflow),
    'execute_plan_step': ('执行计划步骤', '按依赖领取一个步骤，调用已开放工具；完成状态由真实回执决定', ExecutePlanStep),
    'create_plan': ('保存创作计划', '保存带依赖的创作计划；预算由后端提供，不能由模型扩大', CreatePlan),
    'read_native_task': ('查询节点原任务','只查询当前节点持久保存的深度/图片/视频/ComfyUI任务，不提交或重试',ReadNativeTask),
    'read_native_capabilities': ('读取原生动作', '核对当前画布原生编辑合同和尚未开放的动作；节点坐标移动另由apply_canvas_operations的update.x/y支持', ReadNativeCapabilities),
    'propose_native_action': ('原生动作方案', '保存待确认原生动作，不调用服务、不更换模型、不修改历史结果', ProposeNativeAction),
    "read_canvas": ("读取画布", "读取当前画布或指定原生节点，回读操作结果", ReadCanvas),
    "read_project_knowledge": ("读取项目规则", "读取当前版本已登记的节点使用规则和验收状态", ReadProjectKnowledge),
    "read_node_state": ("读取节点状态", "读取当前画布指定节点的白名单参数、输入输出、任务和结果", ReadNodeState),
    "apply_canvas_operations": ("操作节点", "整批创建/修改/连接原生节点；不删除、不生成、不更换模型", Operations),
    "propose_image": ("图片方案", "使用用户已勾选图片模型创建待确认方案；不提交生成", ProposeImage),
    "read_image_task": ("查询原任务", "只查询本轮已有生成方案的原任务", ReadTask),
    "inspect_result": ("读取作品", "读取当前画布真实图片或视频素材，视频仅有限时间戳关键帧供下次视觉评价；不能推断全片或音频语义", InspectResult),
    'record_result_review': ('保存作品核验', '登记刚读取的作品检查与视觉结论；硬条件优先，旧检查或未实际输入图片/视频帧不能判通过', RecordResultReview),
    "read_skill": ("读取 Skill", "按需读取本轮内置 Skill 正文或白名单引用文档", ReadSkill),
}


def tool_catalog():
    return [{"name": name, "label": label, "description": description, "parameters": schema.model_json_schema()}
            for name, (label, description, schema) in TOOLS.items()]


def validate_tool(name, arguments):
    if name not in TOOLS:
        raise HTTPException(422, "模型请求了未开放的工具，请仅使用列出的画布工具")
    try:
        args = TOOLS[name][2].model_validate(arguments)
        if name == "apply_canvas_operations" and any(op.op == "propose_image" for op in args.operations):
            raise HTTPException(422, "图片方案请使用 propose_image 工具")
        return args.model_dump(by_alias=True, exclude_none=True) if name == 'propose_native_action' else args.model_dump(by_alias=True)
    except ValidationError as exc:
        fields = ", ".join(".".join(map(str, error["loc"])) for error in exc.errors()[:3])
        raise HTTPException(422, f"工具参数无效，请按 schema 修正字段：{fields}") from exc


class Decision(StrictArgs):
    reply: str = Field(default="", max_length=24000)
    tool: str | None = Field(default=None, max_length=80)
    arguments: dict = Field(default_factory=dict)
    # 旧结构化响应只用于兼容已有平台模板；不在新提示协议中公开。
    legacy: bool = Field(default=False, exclude=True)


def _parse_dsml(text):
    """兼容 DeepSeek 文本中的单次工具调用；仍走原有白名单与参数校验。"""
    marker = r'[｜|]{1,2}DSML[｜|]{1,2}\s*'
    tag = lambda body: r'<' + marker + body + r'>'
    close = lambda name: r'</' + marker + name + r'\s*>'
    try:
        call = re.fullmatch(tag(r'calls') + r'\s*' +
                            tag(r'invoke\s+name="([A-Za-z_][A-Za-z0-9_]*)"') +
                            r'(.*?)' + close('invoke') + r'\s*' + close('calls'), text, re.S)
        if not call:
            raise ValueError('single complete call required')
        name, body = call.groups()
        parameter = re.compile(tag(r'parameter\s+name="([A-Za-z_][A-Za-z0-9_]*)"\s+string="(true|false)"') +
                               r'(.*?)' + close('parameter'), re.S)
        values, end = {}, 0
        for match in parameter.finditer(body):
            key, is_string, raw = match.groups()
            if body[end:match.start()].strip() or key in values or re.search(marker, raw):
                raise ValueError('ambiguous parameters')
            values[key] = raw if is_string == 'true' else json.loads(raw)
            end = match.end()
        if body[end:].strip():
            raise ValueError('unparsed parameters')
        if 'arguments' in values:
            if set(values) - {'arguments', 'tool'} or values.get('tool', name) != name:
                raise ValueError('mismatched wrapper')
            arguments = values['arguments']
        else:
            arguments = values
        if not isinstance(arguments, dict):
            raise ValueError('arguments must be an object')
        return Decision(tool=name, arguments=arguments)
    except (ValueError, ValidationError) as exc:
        raise HTTPException(422, '模型工具调用格式无效，请返回单个 JSON 工具调用；本次未执行操作') from exc


def parse_decision(text):
    text = str(text or "").strip()
    if len(text) > 64000:
        raise HTTPException(422, "模型响应过大，请缩短回复与工具参数")
    if not text:
        raise HTTPException(422, "模型返回空内容")
    candidate = text
    if candidate.startswith("```") and candidate.endswith("```"):
        candidate = candidate.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    if not candidate.startswith("{"):
        if re.search(r'</?[｜|]{1,2}DSML', candidate):
            return _parse_dsml(candidate)
        # 部分模型在单个 JSON 指令前加一句说明，不能误当成已完成的正文。
        # 仅剥离说明；完整 JSON 校验仍拒绝多次调用、尾随文字和残缺结构。
        if re.search(r'"(?:tool|arguments|operations)"\s*:', candidate):
            start = candidate.find('{')
            if start < 0:
                raise HTTPException(422, '模型工具调用缺少完整 JSON，本次未执行操作')
            candidate = candidate[start:]
        else:
            return Decision(reply=text)
    try:
        value = json.loads(candidate)
        if isinstance(value, dict) and "operations" in value:
            plan = parse_plan(candidate)
            return Decision(reply=plan.reply, tool="legacy_operations" if plan.operations else None,
                            arguments={"operations": [op.model_dump(by_alias=True) for op in plan.operations]}, legacy=True)
        if isinstance(value, dict) and "legacy" in value:
            raise ValueError("private field")
        result = Decision.model_validate(value)
        if not result.tool and result.arguments:
            raise ValueError("arguments without tool")
        if not result.tool and not result.reply.strip():
            raise ValueError("empty finish")
        return result
    except (ValueError, ValidationError) as exc:
        raise HTTPException(422, '模型协议无效，请返回 {"reply":"说明","tool":null,"arguments":{}} 或列出的工具调用') from exc


def decision_diagnostic(text):
    """只记录协议形状和解析位置，不记录模型正文、参数或未知字段内容。"""
    value = str(text or '').strip()
    result = {'length':len(value), 'dsmlCalls':len(re.findall(r'invoke\s+name=',value))}
    start=value.find('{')
    if start < 0:
        result['format']='dsml' if 'DSML' in value else 'text'
        return result
    try:
        parsed,end=json.JSONDecoder().raw_decode(value[start:])
        result.update(format='json',prefixLength=start,suffixLength=len(value[start+end:].strip()))
        if isinstance(parsed,dict):
            known={'reply','tool','arguments','operations','legacy'}
            result['fields']=sorted(set(parsed)&known)
            result['unknownFieldCount']=len(set(parsed)-known)
    except ValueError as exc:
        result.update(format='invalid_json',reason=getattr(exc,'msg','invalid'),position=getattr(exc,'pos',0))
    return result
