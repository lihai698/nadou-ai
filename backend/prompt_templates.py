"""内置提示词模板 Markdown 的解析规则。

本模块只处理调用方传入的 Markdown 文本和可选的名称翻译映射，不读取模板
文件、不访问项目配置，也不依赖 FastAPI 或 ``main.py``。模板文件定位、读取
和 HTTP 错误边界仍由入口层负责。
"""

from __future__ import annotations

import re
from typing import Any, Mapping


def prompt_template_category(name: str, scene: str) -> str:
    """按现有模板规则返回稳定的分类标识。"""

    text = f"{name} {scene}"
    if any(keyword in text for keyword in ["光影", "灯光", "光效", "电影级"]):
        return "lighting"
    if any(keyword in text for keyword in ["视角", "全景", "VR", "镜头", "俯拍", "仰拍", "景别", "构图", "透视"]):
        return "view"
    if any(keyword in text for keyword in ["角色", "脸部", "表情", "Actor", "服装"]):
        return "character"
    if any(keyword in name for keyword in ["产品", "电商", "工业"]):
        return "product"
    return "storyboard"


def extract_prompt_template_section(block: str, title: str) -> str:
    """从一个模板块中提取指定三级标题下的正文或代码围栏内容。"""

    pattern = rf"###\s*{re.escape(title)}\s*\n(?P<body>.*?)(?=\n###\s+|\Z)"
    match = re.search(pattern, block, re.S)
    if not match:
        return ""
    body = match.group("body").strip()
    fence = re.search(r"```(?:\w+)?\s*\n(?P<code>.*?)\n```", body, re.S)
    return (fence.group("code") if fence else body).strip()


def parse_prompt_template_markdown(
    text: str, translations: Mapping[str, Mapping[str, Any]] | None = None
) -> list[dict[str, Any]]:
    """解析内置提示词模板，保持旧接口字段和筛选规则。

    ``translations`` 由入口层传入，避免本模块反向读取主程序中的全局配置。
    没有正向提示词的模板继续被忽略；参数只接受 ``**键**：值`` 形式。
    """

    translation_map = translations or {}
    templates: list[dict[str, Any]] = []
    matches = list(re.finditer(r"^##\s*预设\s*(\d+)\s*[：:]\s*(.+?)\s*$", text, re.M))
    for index, match in enumerate(matches):
        number = match.group(1).strip()
        name = match.group(2).strip()
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        block = text[start:end]
        scene = extract_prompt_template_section(block, "适用场景")
        positive = extract_prompt_template_section(block, "正向提示词")
        negative = extract_prompt_template_section(block, "负向提示词")
        params_raw = extract_prompt_template_section(block, "平台参数建议")
        params: dict[str, str] = {}
        for line in params_raw.splitlines():
            item = re.match(r"[-*]\s*\*\*(.+?)\*\*\s*[：:]\s*(.+)", line.strip())
            if item:
                params[item.group(1).strip()] = item.group(2).strip()
        if not positive:
            continue
        translation = translation_map.get(name) or {}
        templates.append(
            {
                "id": f"builtin_md_{number}",
                "number": number,
                "name": name,
                "name_en": translation.get("name", name),
                "category": prompt_template_category(name, scene),
                "scene": scene,
                "scene_en": translation.get("scene", scene),
                "positive": positive,
                "negative": negative,
                "params": params,
                "builtin": True,
            }
        )
    return templates


__all__ = [
    "extract_prompt_template_section",
    "parse_prompt_template_markdown",
    "prompt_template_category",
]
