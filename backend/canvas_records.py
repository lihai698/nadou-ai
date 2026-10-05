"""画布记录的纯规范化和 API 摘要规则。

本模块只处理传入的画布字典，不读取文件、配置或运行时状态。持久化层和
FastAPI 入口负责加载、保存及异常转换；这里集中保持列表接口使用的记录
字段、画布类型和颜色规则，避免多个入口各自拼出不同的摘要。
"""

from __future__ import annotations

from typing import Any, Dict


DEFAULT_PROJECT_ID = "default"
CANVAS_COLORS = {"", "red", "orange", "amber", "green", "teal", "blue", "violet", "pink", "slate"}


def normalize_canvas_kind(kind: Any = "classic") -> str:
    """将外部画布类型收敛为兼容的 ``classic`` 或 ``smart``。"""

    return "smart" if str(kind or "").strip().lower() == "smart" else "classic"


def normalize_canvas_color(value: Any) -> str:
    """只接受画布界面支持的颜色名，未知值回退为空。"""

    color = str(value or "").strip().lower()
    return color if color in CANVAS_COLORS else ""


def canvas_record(data: Dict[str, Any]) -> Dict[str, Any]:
    """把内部画布字典转换为列表、元数据和保存响应使用的公开摘要。"""

    try:
        node_count = len(data.get("nodes", []))
    except TypeError:
        node_count = 0
    return {
        "id": data.get("id"),
        "title": data.get("title", "未命名画布"),
        "icon": data.get("icon", "🧩"),
        "kind": normalize_canvas_kind(data.get("kind")),
        "owner": str(data.get("owner") or "")[:40],
        "color": normalize_canvas_color(data.get("color")),
        "pinned": bool(data.get("pinned") or False),
        "project": str(data.get("project") or "").strip() or DEFAULT_PROJECT_ID,
        "board_x": data.get("board_x"),
        "board_y": data.get("board_y"),
        "created_at": data.get("created_at", 0),
        "updated_at": data.get("updated_at", 0),
        "meta_revision": int(data.get("meta_revision") or 0),
        "deleted_at": data.get("deleted_at", 0),
        "node_count": node_count,
    }


__all__ = [
    "CANVAS_COLORS",
    "DEFAULT_PROJECT_ID",
    "canvas_record",
    "normalize_canvas_color",
    "normalize_canvas_kind",
]
