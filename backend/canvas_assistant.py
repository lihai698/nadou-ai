"""画布助手基础对话：独立会话存储，依赖由应用入口注入。"""
from __future__ import annotations

import asyncio
import copy
import json
import re
import time
import uuid

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import StreamingResponse, JSONResponse

from backend.canvas_assistant_result_review import ResultInspectionService
from backend.canvas_assistant_store import AssistantStore, checked_id
from backend.canvas_assistant_request_schema import SessionRequest, TurnRequest, ProposalAction, CancelRequest, ContinueRequest, PlanBudgetRequest, AuthorizationRequest, NativeActionRequest
from backend.canvas_assistant_session_views import public_skill_usage, public_native, final_event
from backend.canvas_assistant_operation_schema import AssistantPlan
from backend import canvas_assistant_canvas_rules as context_rules
from backend.canvas_assistant_canvas_rules import content_hash
from backend.canvas_assistant_plan import create_plan as create_persistent_plan
from backend import canvas_assistant_plan as persistent_plan
from backend import canvas_assistant_budget_service as budget_service
from backend import canvas_assistant_session_service as canvas_assistant_session_service
from backend import canvas_assistant_agent_runtime as canvas_assistant_agent_runtime
from backend import canvas_assistant_native_actions as canvas_assistant_native_actions
from backend import canvas_assistant_turn_service as canvas_assistant_turn_service
from backend.canvas_assistant_tools import validate_tool
from backend.canvas_assistant_generation import bind_snapshot, target_signature, validate_snapshot, validate_image_request
from backend.canvas_assistant_agent import initial_agent, run_agent
from backend.canvas_assistant_skills import SkillCatalog
from backend.canvas_assistant_knowledge import ProjectKnowledge
from backend.canvas_assistant_state import canvas_overview, read_node_state
from backend.canvas_assistant_native import native_catalog, prepare_native_action, validate_native_snapshot, native_effect, native_run_result, native_task_reference, native_task_binding, public_native_task, public_workflow_fields, native_run_input_hash, native_comfy_foreign_busy, native_smart_group_foreign_busy, validate_video_run_provider
from backend.canvas_assistant_loop import loop_foreign_busy, loop_plan
from backend.canvas_assistant_lora import read_lora_catalog
from backend.canvas_assistant_autonomy import authorize as authorize_autonomy, reserve as reserve_autonomy, safe_action
from backend.diagnostics import write_diagnostic


def create_assistant_router(*, root, load_canvas, providers, user_id, call_model, apply_operations=None, notify_changed=None, load_reference_assets=None, submit_image=None, query_image=None, query_native_task=None, control_native_task=None, workflow_fields=None, skill_catalog=None, resolve_result_file=None, result_roots=None, media_export_prepare=None, media_export_control=None, public_error=None):
    def current_workflow_fields(canvas, node_id):
        return canvas_assistant_native_actions.current_workflow_fields(canvas, node_id, workflow_fields=workflow_fields)

    router = APIRouter(prefix="/api/canvas-assistant")
    store = AssistantStore(root)
    result_inspection = ResultInspectionService(
        load_canvas=load_canvas, providers=providers, resolve_result_file=resolve_result_file,
        result_roots=result_roots, query_image=query_image, query_native_task=query_native_task)
    running = {}
    skills = skill_catalog or SkillCatalog()
    knowledge = ProjectKnowledge()

    def identity(request, header, canvas_id):
        return canvas_assistant_session_service.identity(request, header, canvas_id, HTTPException=HTTPException, checked_id=checked_id, load_canvas=load_canvas, user_id=user_id)

    @router.post('/plan/budget')
    async def plan_budget(payload:PlanBudgetRequest,request:Request,x_user_id:str=Header(default='')):
        return await budget_service.plan_budget(payload, request, x_user_id, identity=identity, store=store, persistent_plan=persistent_plan, copy=copy, time=time, asyncio=asyncio, HTTPException=HTTPException)

    @router.post('/authorization')
    async def authorization(payload:AuthorizationRequest,request:Request,x_user_id:str=Header(default='')):
        return await budget_service.authorization(payload, request, x_user_id, identity=identity, store=store, authorize_autonomy=authorize_autonomy, persistent_plan=persistent_plan, copy=copy, asyncio=asyncio, HTTPException=HTTPException)

    @router.get("/status")
    async def status():
        return await canvas_assistant_session_service.status(HTTPException=HTTPException, apply_operations=apply_operations, knowledge=knowledge, providers=providers, skills=skills)

    @router.get("/canvas")
    async def get_canvas(canvasId: str, request: Request, x_user_id: str = Header(default="")):
        return await canvas_assistant_session_service.get_canvas(canvasId, request, x_user_id, canvas_overview=canvas_overview, context_rules=context_rules, identity=identity)

    @router.get("/reference-assets")
    async def reference_assets(canvasId: str, request: Request, x_user_id: str = Header(default="")):
        return await canvas_assistant_session_service.reference_assets(canvasId, request, x_user_id, asyncio=asyncio, context_rules=context_rules, identity=identity, load_reference_assets=load_reference_assets)

    @router.get("/sessions")
    async def sessions(canvasId: str, request: Request, x_user_id: str = Header(default="")):
        return await canvas_assistant_session_service.sessions(canvasId, request, x_user_id, asyncio=asyncio, identity=identity, store=store)

    @router.post("/sessions")
    async def create(payload: SessionRequest, request: Request, x_user_id: str = Header(default="")):
        return await canvas_assistant_session_service.create(payload, request, x_user_id, asyncio=asyncio, identity=identity, store=store)

    @router.get("/history")
    async def history(canvasId: str, sessionId: str, request: Request, x_user_id: str = Header(default="")):
        return await canvas_assistant_session_service.history(canvasId, sessionId, request, x_user_id, asyncio=asyncio, identity=identity, public_native=public_native, public_skill_usage=public_skill_usage, store=store)

    @router.post("/cancel")
    async def cancel(payload: CancelRequest, request: Request, x_user_id: str = Header(default="")):
        return await canvas_assistant_session_service.cancel(payload, request, x_user_id, asyncio=asyncio, checked_id=checked_id, identity=identity, running=running, store=store)

    async def drive_agent(user, payload, previous, agent, queue):
        return await canvas_assistant_agent_runtime.drive_agent(user, payload, previous, agent, queue, AssistantPlan=AssistantPlan, HTTPException=HTTPException, ProjectKnowledge=ProjectKnowledge, SkillCatalog=SkillCatalog, apply_operations=apply_operations, asyncio=asyncio, call_model=call_model, canvas_overview=canvas_overview, context_rules=context_rules, control_native_task=control_native_task, copy=copy, create_persistent_plan=create_persistent_plan, current_workflow_fields=current_workflow_fields, load_canvas=load_canvas, load_reference_assets=load_reference_assets, media_export_control=media_export_control, media_export_prepare=media_export_prepare, native_catalog=native_catalog, native_task_reference=native_task_reference, notify_changed=notify_changed, persistent_plan=persistent_plan, prepare_native_action=prepare_native_action, providers=providers, public_native=public_native, public_native_task=public_native_task, public_workflow_fields=public_workflow_fields, query_image=query_image, query_native_task=query_native_task, read_lora_catalog=read_lora_catalog, read_node_state=read_node_state, result_inspection=result_inspection, run_agent=run_agent, store=store, validate_tool=validate_tool)

    @router.post('/native/action')
    async def native_action(payload: NativeActionRequest, request: Request, x_user_id: str = Header(default='')):
        return await canvas_assistant_native_actions.native_action(payload, request, x_user_id, HTTPException=HTTPException, ProjectKnowledge=ProjectKnowledge, asyncio=asyncio, content_hash=content_hash, control_native_task=control_native_task, copy=copy, current_workflow_fields=current_workflow_fields, identity=identity, load_canvas=load_canvas, loop_foreign_busy=loop_foreign_busy, loop_plan=loop_plan, media_export_control=media_export_control, media_export_prepare=media_export_prepare, native_comfy_foreign_busy=native_comfy_foreign_busy, native_effect=native_effect, native_run_input_hash=native_run_input_hash, native_run_result=native_run_result, native_smart_group_foreign_busy=native_smart_group_foreign_busy, native_task_binding=native_task_binding, native_task_reference=native_task_reference, persistent_plan=persistent_plan, prepare_native_action=prepare_native_action, providers=providers, public_native=public_native, public_native_task=public_native_task, query_native_task=query_native_task, read_node_state=read_node_state, reserve_autonomy=reserve_autonomy, safe_action=safe_action, store=store, time=time, uuid=uuid, validate_native_snapshot=validate_native_snapshot, validate_video_run_provider=validate_video_run_provider)

    def stream_response(queue, task):
        return canvas_assistant_turn_service.stream_response(queue, task, StreamingResponse=StreamingResponse, asyncio=asyncio, json=json)

    async def completed_results(turn):
        return await canvas_assistant_turn_service.completed_results(turn, HTTPException=HTTPException, query_image=query_image)

    @router.post("/continue")
    async def continue_turn(payload: ContinueRequest, request: Request, x_user_id: str = Header(default="")):
        return await canvas_assistant_turn_service.continue_turn(payload, request, x_user_id, HTTPException=HTTPException, TurnRequest=TurnRequest, asyncio=asyncio, checked_id=checked_id, completed_results=completed_results, context_rules=context_rules, copy=copy, drive_agent=drive_agent, final_event=final_event, identity=identity, load_canvas=load_canvas, load_reference_assets=load_reference_assets, persistent_plan=persistent_plan, providers=providers, public_error=public_error, running=running, store=store, stream_response=stream_response, time=time, write_diagnostic=write_diagnostic)

    def change_proposal(user, payload, change):
        return canvas_assistant_turn_service.change_proposal(user, payload, change, HTTPException=HTTPException, store=store)

    @router.post("/proposals/action")
    async def proposal_action(payload: ProposalAction, request: Request, x_user_id: str = Header(default="")):
        return await canvas_assistant_turn_service.proposal_action(payload, request, x_user_id, HTTPException=HTTPException, JSONResponse=JSONResponse, asyncio=asyncio, bind_snapshot=bind_snapshot, change_proposal=change_proposal, copy=copy, identity=identity, load_canvas=load_canvas, load_reference_assets=load_reference_assets, providers=providers, query_image=query_image, re=re, reserve_autonomy=reserve_autonomy, submit_image=submit_image, target_signature=target_signature, uuid=uuid, validate_image_request=validate_image_request, validate_snapshot=validate_snapshot)

    @router.post("/chat")
    async def chat(payload: TurnRequest, request: Request, x_user_id: str = Header(default="")):
        return await canvas_assistant_turn_service.chat(payload, request, x_user_id, HTTPException=HTTPException, apply_operations=apply_operations, asyncio=asyncio, call_model=call_model, context_rules=context_rules, drive_agent=drive_agent, final_event=final_event, identity=identity, initial_agent=initial_agent, json=json, knowledge=knowledge, load_reference_assets=load_reference_assets, persistent_plan=persistent_plan, providers=providers, public_error=public_error, running=running, skills=skills, store=store, stream_response=stream_response, write_diagnostic=write_diagnostic)

    return router
