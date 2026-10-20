"""项目文件的唯一业务读写入口；路径、可重入锁、时钟和 ID 由应用注入。

只管理项目记录，不读取画布、不迁移画布归属，也不处理 HTTP 响应。
调用方的跨画布操作仍须持有同一把锁。此边界不提供跨进程事务。
"""
from __future__ import annotations

import json
from os import PathLike
from typing import Callable

from backend.atomic_json import write_json_atomic
from backend.data_formats import (
    InvalidDataFormat, UnsupportedDataFormat, mark_current, projects_and_version,
)
from backend.project_records import next_project_order


class ProjectOperationError(ValueError):
    """可公开的项目操作错误，由应用入口转换为原有 HTTP 错误。"""

    def __init__(self, message: str, *, status_code: int = 500):
        super().__init__(message)
        self.status_code = status_code


class ProjectReadError(ProjectOperationError):
    """保留项目读取失败的专用异常类型。"""


class ProjectStore:
    def __init__(self, path: str | PathLike[str], *, lock,
                 now_ms: Callable[[], int], new_id: Callable[[], str], default_id: str):
        self.path = path
        self.lock = lock
        self.now_ms = now_ms
        self.new_id = new_id
        self.default_id = default_id

    def load(self):
        try:
            with open(self.path, "r", encoding="utf-8") as source:
                document = json.load(source)
        except FileNotFoundError:
            return []
        except (OSError, ValueError) as exc:
            raise ProjectReadError("项目文件读取失败，请从备份恢复") from exc
        try:
            projects, _ = projects_and_version(document)
            return projects
        except UnsupportedDataFormat as exc:
            raise ProjectReadError(str(exc), status_code=409) from exc
        except InvalidDataFormat as exc:
            raise ProjectReadError(str(exc)) from exc

    def save(self, projects):
        with self.lock:
            self.load()  # 损坏文件和未来版本不可被新记录覆盖。
            document = {"projects": projects}
            projects_and_version(document)
            mark_current(document, "项目文件")
            write_json_atomic(self.path, document, ensure_ascii=False, indent=2)

    def ensure_default(self):
        """幂等初始化默认项目；不修改画布或现有默认项目内容。"""
        with self.lock:
            projects = self.load()
            if not any(project.get("id") == self.default_id for project in projects):
                timestamp = self.now_ms()
                projects.insert(0, {"id": self.default_id, "name": "默认项目", "order": 0,
                                    "created_at": timestamp, "updated_at": timestamp})
                self.save(projects)
            return projects

    def create(self, name="新项目"):
        with self.lock:
            projects = self.ensure_default()
            timestamp = self.now_ms()
            clean = (str(name or "").strip() or "新项目")[:60]
            order = next_project_order(projects)
            project = {"id": self.new_id(), "name": clean, "order": order,
                       "created_at": timestamp, "updated_at": timestamp}
            projects.append(project)
            self.save(projects)
            return project

    def update(self, project_id, *, name=None, order=None):
        with self.lock:
            projects = self.ensure_default()
            target = next((project for project in projects if project.get("id") == project_id), None)
            if not target:
                raise ProjectOperationError("项目不存在", status_code=404)
            if name is not None:
                target["name"] = (str(name).strip() or target.get("name") or "未命名项目")[:60]
            if order is not None:
                target["order"] = int(order)
            target["updated_at"] = self.now_ms()
            self.save(projects)
            return target
