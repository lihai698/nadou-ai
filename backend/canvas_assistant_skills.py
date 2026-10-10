"""内置画布 Skill：目录白名单、每轮快照与按需正文，不执行脚本。"""
from __future__ import annotations

import hashlib
from pathlib import Path

from fastapi import HTTPException

BUILTINS = ("poster-layout", "reference-edit", "prompt-polish")


class SkillCatalog:
    def __init__(self, root=None):
        self.root = Path(root) if root else Path(__file__).resolve().parents[1] / "skills" / "canvas-assistant"

    def snapshot(self):
        result = []
        for skill_id in BUILTINS:
            base = (self.root / skill_id).resolve()
            files = {}
            candidates = [base / "SKILL.md", *(base / "references").glob("*.md")]
            for path in candidates:
                resolved = path.resolve()
                if not resolved.is_relative_to(base) or not resolved.is_relative_to(self.root.resolve()):
                    raise HTTPException(422, "内置 Skill 路径无效")
                try:
                    if resolved.stat().st_size > 24000:
                        raise HTTPException(422, "内置 Skill 文件过大")
                    files[path.relative_to(base).as_posix()] = resolved.read_text(encoding="utf-8")
                except OSError as exc:
                    raise HTTPException(503, "内置 Skill 文件缺失，请检查安装文件") from exc
            content = files["SKILL.md"]
            sections = content.split("---", 2)
            if len(sections) != 3 or sections[0].strip():
                raise HTTPException(422, "内置 Skill 格式无效")
            metadata = dict(line.split(":", 1) for line in sections[1].splitlines() if ":" in line)
            name = metadata.get("name", "").strip()
            description = metadata.get("description", "").strip()
            if not name or not description:
                raise HTTPException(422, "内置 Skill 缺少名称或说明")
            version = hashlib.sha256(repr(sorted(files.items())).encode("utf-8")).hexdigest()
            result.append({"id": skill_id, "name": name, "description": description,
                           "category": metadata.get("category", "创作").strip() or "创作", "version": version,
                           "files": {**files, "SKILL.md": sections[2].strip()}})
        return result

    def index(self):
        return [{k: s[k] for k in ("id", "name", "description", "category", "version")} for s in self.snapshot()]

    @staticmethod
    def read(snapshot, skill_id, file="SKILL.md"):
        skill = next((item for item in snapshot if item["id"] == skill_id), None)
        if not skill or file not in skill["files"] or ".." in file or "\\" in file:
            raise HTTPException(422, "只能读取本轮内置 Skill 及其引用文档")
        return {"id": skill_id, "name": skill["name"], "version": skill["version"], "file": file, "content": skill["files"][file]}
