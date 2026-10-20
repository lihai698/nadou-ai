"""助手 HTTP 输入模型；只描述字段和校验，复用内置 Skill 编号常量。"""
from __future__ import annotations

import re

from pydantic import BaseModel, Field, PrivateAttr

from backend.canvas_assistant_skills import BUILTINS


class SessionRequest(BaseModel):
    canvasId: str
    title: str = Field(default="新对话", max_length=80)


class TurnRequest(BaseModel):
    _execution_id: str = PrivateAttr(default="")
    canvasId: str
    sessionId: str
    requestId: str
    message: str = Field(min_length=1, max_length=12000)
    provider: str
    model: str
    selectedNodeIds: list[str] = Field(default_factory=list, max_length=30)
    referencedNodeIds: list[str] = Field(default_factory=list, max_length=20)
    referencedAssetIds: list[str] = Field(default_factory=list, max_length=20)
    expectedUpdatedAt: int
    creationSettings: dict[str, str | int | float | bool] = Field(default_factory=dict, max_length=30)
    imageModelConfirmed: bool = False
    skillId: str = Field(default="auto", pattern=rf"^(auto|{'|'.join(re.escape(value) for value in BUILTINS)})$")


class ProposalAction(BaseModel):
    canvasId: str
    sessionId: str
    turnId: str
    proposalId: str
    action: str = Field(pattern=r"^(confirm|dismiss|retry|query)$")
    expectedUpdatedAt: int = 0
    imageProvider: str = ""
    imageModel: str = ""
    imageRequest: dict = Field(default_factory=dict)
    automatic: bool = False


class CancelRequest(BaseModel):
    canvasId: str
    sessionId: str
    requestId: str


class ContinueRequest(CancelRequest):
    wait: bool = False


class PlanBudgetRequest(CancelRequest):
    model_config = {'extra':'forbid'}
    total: int = Field(strict=True,ge=0,le=100)


class AuthorizationModel(BaseModel):
    model_config={'extra':'forbid'}
    provider:str=Field(min_length=1,max_length=200)
    model:str=Field(min_length=1,max_length=200)


class AuthorizationRequest(CancelRequest):
    model_config={'extra':'forbid'}
    total:int=Field(strict=True,ge=1,le=100)
    models:list[AuthorizationModel]=Field(min_length=1,max_length=8)


class NativeActionRequest(BaseModel):
    canvasId: str
    sessionId: str
    turnId: str
    actionId: str
    action: str = Field(pattern=r'^(confirm|check|query|finish|retry|resume|dismiss|abandon)$')
    expectedUpdatedAt: int | None = None
    automatic: bool = False
