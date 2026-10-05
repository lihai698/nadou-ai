"""画布与项目 JSON 的可回退格式版本规则。

版本 0 是没有 ``format_version`` 的旧文件；版本 1 只增加该整数标记，
原有字段和容器形状不变。读到未知版本时由入口拒绝写入，避免旧代码覆盖
未来版本的数据。这里不执行文件迁移，也不读取用户目录。
"""

from __future__ import annotations

from typing import Any


CURRENT_FORMAT_VERSION = 1
FORMAT_VERSION_KEY = "format_version"


class InvalidDataFormat(ValueError):
    """JSON 的基本形状或版本标记无效。"""


class UnsupportedDataFormat(InvalidDataFormat):
    """文件由更新版本的程序写入，需要先升级程序或恢复备份。"""


def document_version(document: Any, name: str) -> int:
    """读取同一对象容器中的版本；缺少标记表示旧格式 0。"""
    if not isinstance(document, dict):
        raise InvalidDataFormat(f"{name}必须是 JSON 对象")
    version = document.get(FORMAT_VERSION_KEY, 0)
    if isinstance(version, bool) or not isinstance(version, int) or version < 0:
        raise InvalidDataFormat(f"{name}格式版本无效")
    if version > CURRENT_FORMAT_VERSION:
        raise UnsupportedDataFormat(f"{name}格式版本较新，请升级程序或从备份恢复")
    return version


def canvas_version(document: Any) -> int:
    """确认画布可由当前版本读取；不改变旧画布内容。"""
    version = document_version(document, "画布")
    if not isinstance(document.get("id"), str) or not document["id"]:
        raise InvalidDataFormat("画布缺少有效 ID")
    return version


def projects_and_version(document: Any) -> tuple[list[dict], int]:
    """读入旧顶层数组或当前对象包装；保持原有无 ID 项过滤行为。"""
    if isinstance(document, list):
        projects, version = document, 0
    else:
        version = document_version(document, "项目文件")
        projects = document.get("projects")
    if not isinstance(projects, list):
        raise InvalidDataFormat("项目文件缺少 projects 数组")
    return [item for item in projects if isinstance(item, dict) and item.get("id")], version


def mark_current(document: dict, name: str) -> None:
    """写入前在原对象上标记版本；未知版本绝不降级。"""
    document_version(document, name)
    document[FORMAT_VERSION_KEY] = CURRENT_FORMAT_VERSION
