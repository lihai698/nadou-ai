"""项目公开摘要及排序所用的纯规则。

只处理调用方传入的项目字典；项目文件读写、默认项目创建和 API 路由仍由
调用方负责。
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, Tuple


def project_order(project: Dict[str, Any]) -> int:
    return int(project.get("order") or 0)


def project_record(project: Dict[str, Any]) -> Dict[str, Any]:
    """生成项目列表、创建和更新接口共用的公开摘要。"""

    return {
        "id": project.get("id"),
        "name": (project.get("name") or "未命名项目")[:60],
        "order": project_order(project),
        "created_at": project.get("created_at", 0),
        "updated_at": project.get("updated_at", 0),
    }


def project_sort_key(project: Dict[str, Any]) -> Tuple[int, Any]:
    return project_order(project), project.get("created_at") or 0


def next_project_order(projects: Iterable[Dict[str, Any]]) -> int:
    return max((project_order(project) for project in projects), default=0) + 1


__all__ = ["project_order", "project_record", "project_sort_key", "next_project_order"]
