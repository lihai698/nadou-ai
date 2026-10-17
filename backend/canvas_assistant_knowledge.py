"""读取受控 Markdown 知识，按回合保存正文快照和已核对的来源摘要。"""
from __future__ import annotations

import copy
import hashlib
import json
import re
from pathlib import Path, PureWindowsPath

from fastapi import HTTPException

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SECTIONS = {"overview", "controls", "parameters", "inputs_outputs", "connections", "execution", "results", "errors_recovery", "persistence", "examples", "limitations"}


def _inside(root: Path, relative: str) -> Path:
    if not isinstance(relative, str) or not relative or Path(relative).is_absolute() or PureWindowsPath(relative).is_absolute() or PureWindowsPath(relative).drive or ".." in PureWindowsPath(relative).parts:
        raise HTTPException(503, "项目知识路径无效")
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()):
        raise HTTPException(503, "项目知识路径超出允许目录")
    return path


class ProjectKnowledge:
    def __init__(self, root: Path | str | None = None, *, project_root: Path | str | None = None):
        self.root = (Path(root) if root else PROJECT_ROOT / "skills/canvas-assistant/project-knowledge").resolve()
        self.project_root = Path(project_root or PROJECT_ROOT).resolve()

    @staticmethod
    def _digest(path: Path) -> str | None:
        try:
            # Git checkout may convert LF to CRLF; only source content changes invalidate knowledge.
            return hashlib.sha256(path.read_bytes().replace(b"\r\n", b"\n")).hexdigest()
        except OSError:
            return None

    def _load(self) -> dict:
        try:
            data = json.loads(_inside(self.root, "index.json").read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise HTTPException(503, "项目知识索引不可用，请检查安装文件") from exc
        if not isinstance(data, dict) or not isinstance(data.get("entries"), list):
            raise HTTPException(503, "项目知识索引格式无效")
        return data

    def _sections(self, entry: dict) -> dict:
        try:
            path = _inside(self.root, entry.get("file"))
            raw = path.read_bytes()
            if len(raw) > 65536:
                raise HTTPException(503, "项目知识卡片超过 64 KiB 限制")
            body = raw.decode("utf-8")
        except (OSError, UnicodeError) as exc:
            raise HTTPException(503, "项目知识卡片缺失或编码无效") from exc
        registered = entry.get("sections")
        if not isinstance(registered, list) or "overview" not in registered or any(s not in SECTIONS for s in registered):
            raise HTTPException(503, "项目知识章节登记无效")
        sections = {}
        headings = list(re.finditer(r"^## ([a-z_]+)\s*$", body, re.M))
        for i, heading in enumerate(headings):
            name = heading.group(1)
            if name in sections or name not in registered:
                raise HTTPException(503, "项目知识存在重复或未登记章节")
            text = body[heading.end():headings[i + 1].start() if i + 1 < len(headings) else len(body)].strip()
            if not text or len(text.encode("utf-8")) > 24576:
                raise HTTPException(503, "项目知识章节为空或超过 24 KiB 限制")
            sections[name] = text
        if set(sections) != set(registered):
            raise HTTPException(503, "项目知识卡片与章节索引不一致")
        return sections

    def snapshot(self) -> dict:
        data = self._load()
        entries, ids, source_hashes = [], set(), {}
        for raw in data["entries"]:
            if not isinstance(raw, dict) or not isinstance(raw.get("id"), str) or not re.fullmatch(r"[a-z][a-z0-9_.-]*", raw["id"]) or raw["id"] in ids:
                raise HTTPException(503, "项目知识索引存在重复或无效编号")
            ids.add(raw["id"])
            entry = copy.deepcopy(raw)
            entry["sections"] = self._sections(entry)
            if not isinstance(entry.get("sources", []), list):
                raise HTTPException(503, "项目知识来源登记无效")
            for source in entry.get("sources", []):
                if not isinstance(source, dict):
                    raise HTTPException(503, "项目知识来源登记无效")
                path = _inside(self.project_root, source.get("path"))
                baseline = source.get("sha256")
                if baseline is not None and not re.fullmatch(r"[0-9a-f]{64}", baseline):
                    raise HTTPException(503, "项目知识来源摘要无效")
                # 无基线的旧资料保留可读性，但不能声称来源已复核。
                source_hashes[source["path"]] = baseline
                if path.exists() and not path.is_file():
                    raise HTTPException(503, "项目知识来源不是文件")
            entries.append(entry)
        snapshot = {"version": data.get("version", 1), "entries": entries,
                    "compatibility": copy.deepcopy(data.get("compatibility") or {"legacyTypes": [], "notes": []}),
                    "sourceHashes": source_hashes}
        snapshot["knowledgeVersion"] = hashlib.sha256(json.dumps(snapshot, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()
        for entry in entries:
            entry["sourceStatus"] = self._source_status(snapshot, entry, self.project_root)
        return snapshot

    @staticmethod
    def index(snapshot: dict, kind: str = "all", native_types: list[str] | None = None) -> list[dict]:
        return [{k: copy.deepcopy(e.get(k)) for k in ("id", "kind", "nativeType", "name", "summary", "coverage", "coverageEvidence", "sourceStatus")}
                for e in snapshot.get("entries", []) if kind in {"all", e.get("kind")} and (not native_types or e.get("nativeType") in native_types)]

    @staticmethod
    def _source_status(snapshot: dict, entry: dict, root: Path | None = None) -> str:
        stale = False
        for source in entry.get("sources", []):
            try:
                current = ProjectKnowledge._digest(_inside(Path(root or PROJECT_ROOT), source["path"]))
            except HTTPException:
                return "unavailable"
            if current is None:
                return "unavailable"
            if current != source.get("sha256", snapshot.get("sourceHashes", {}).get(source["path"])):
                stale = True
        return "stale" if stale else "current"

    @staticmethod
    def changed(snapshot: dict, root: Path | None = None) -> list[str]:
        return [e["id"] for e in snapshot.get("entries", []) if ProjectKnowledge._source_status(snapshot, e, root) != "current"]

    @staticmethod
    def read(snapshot: dict, capability_id: str, section: str = "overview", *, source_root: Path | None = None) -> dict:
        if not isinstance(capability_id, str) or not re.fullmatch(r"[a-z][a-z0-9_.-]*", capability_id) or section not in SECTIONS:
            raise HTTPException(422, "只能读取已登记的项目知识编号和章节")
        entry = next((e for e in snapshot.get("entries", []) if e.get("id") == capability_id), None)
        if not entry or section not in entry.get("sections", {}):
            raise HTTPException(404, "找不到指定的项目知识章节")
        return {"id": entry["id"], "kind": entry.get("kind"), "nativeType": entry.get("nativeType"),
                "section": section, "content": entry["sections"][section], "version": snapshot.get("knowledgeVersion", ""),
                "sourceStatus": ProjectKnowledge._source_status(snapshot, entry, source_root),
                "coverage": copy.deepcopy(entry.get("coverage") or {}), "coverageEvidence": copy.deepcopy(entry.get("coverageEvidence") or {}),
                "sources": copy.deepcopy(entry.get("sources") or [])}
