"""故事生产、原文分析与逐镜操作的数据模型；不加载画布执行模块。"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class StoryData(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)


class Asset(StoryData):
    id: str = Field(pattern=r'^[A-Za-z0-9_-]{1,40}$')
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(min_length=1, max_length=2000, description='角色固定外貌服装/场景空间光线/道具外观，或声音音色语速与用途')


class Sound(Asset):
    kind: Literal['voice', 'narration', 'effect', 'music']
    characterId: str = Field(default='', max_length=40, description='人物声音对应角色ID；旁白、音效、音乐留空')


class Beat(StoryData):
    id: str = Field(pattern=r'^[A-Za-z0-9_-]{1,40}$')
    title: str = Field(min_length=1, max_length=80)
    sourceExcerpt: str = Field(min_length=1, max_length=2000, description='从原文逐字引用的剧情依据')
    summary: str = Field(min_length=1, max_length=2000)


class Dialogue(StoryData):
    soundId: str = Field(min_length=1, max_length=40, description='voice或narration声音ID')
    text: str = Field(min_length=1, max_length=2000)


class Shot(StoryData):
    id: str = Field(pattern=r'^[A-Za-z0-9_-]{1,40}$')
    beatId: str = Field(min_length=1, max_length=40)
    title: str = Field(min_length=1, max_length=80)
    durationSeconds: float = Field(gt=0, le=120)
    sceneId: str = Field(min_length=1, max_length=40)
    characterIds: list[str] = Field(default_factory=list, max_length=30)
    propIds: list[str] = Field(default_factory=list, max_length=30)
    soundIds: list[str] = Field(default_factory=list, max_length=30, description='本镜音效与音乐ID')
    dialogue: list[Dialogue] = Field(default_factory=list, max_length=30)
    shotSize: str = Field(min_length=1, max_length=200)
    camera: str = Field(min_length=1, max_length=400, description='机位、角度、构图')
    motion: str = Field(min_length=1, max_length=400)
    visual: str = Field(min_length=1, max_length=4000)
    action: str = Field(min_length=1, max_length=2000)
    mood: str = Field(min_length=1, max_length=400)
    transition: str = Field(min_length=1, max_length=400)
    onScreenText: str = Field(default='', max_length=1000)
    imagePrompt: str = Field(min_length=1, max_length=6000)
    motionPrompt: str = Field(min_length=1, max_length=2000)


class StoryWorkflow(StoryData):
    sourceNodeId: str = Field(min_length=1, max_length=100, description='已经保存的故事文本节点真实ID')
    title: str = Field(min_length=1, max_length=80)
    style: str = Field(min_length=1, max_length=2000, description='全片一致的画面、年代、比例和叙事风格')
    beats: list[Beat] = Field(min_length=1, max_length=40)
    characters: list[Asset] = Field(default_factory=list, max_length=30)
    scenes: list[Asset] = Field(min_length=1, max_length=30)
    props: list[Asset] = Field(default_factory=list, max_length=30)
    sounds: list[Sound] = Field(default_factory=list, max_length=30)
    shots: list[Shot] = Field(min_length=1, max_length=121)


class StoryAnalysis(BaseModel):
    model_config=ConfigDict(extra='forbid',strict=True)
    sourceNodeId:str=Field(min_length=1,max_length=100)
    title:str=Field(min_length=1,max_length=80)
    style:str=Field(min_length=1,max_length=2000)


class StoryAnalysisResult(BaseModel):
    model_config=ConfigDict(extra='forbid',strict=True)
    analysisNodeId:str=Field(min_length=1,max_length=100)


class ShotPrompts(BaseModel):
    model_config=ConfigDict(extra='forbid',strict=True)
    tableId:str=Field(min_length=1,max_length=100)
    rowIds:list[str]=Field(min_length=1,max_length=30)


class ShotImages(ShotPrompts):
    newAttempt:bool=False
