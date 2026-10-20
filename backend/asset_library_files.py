"""素材库文件复制、指纹去重、目录整理及受引用保护的清理。

路径、锁和跨索引引用检查由应用注入；不导入应用主程序。
"""
import hashlib
import json
import os
import re
import shutil
import urllib.parse
import uuid

def unique_asset_category_dir(library, base_name, *, sanitize_asset_name, ASSET_LIBRARY_DIR):
    """为资产库分组生成一个唯一、文件系统安全的子文件夹名（library/<dir>/）。
    以分组名为基础（保留中文），与同库其它分组的 dir 及磁盘上已存在的文件夹去重。"""
    base = sanitize_asset_name(base_name, "分组").strip(" .") or "分组"
    existing = {
        str(c.get("dir")) for c in (library.get("categories") or [])
        if isinstance(c, dict) and c.get("dir")
    }
    candidate = base
    i = 2
    while candidate in existing or os.path.exists(os.path.join(ASSET_LIBRARY_DIR, candidate)):
        candidate = f"{base}_{i}"
        i += 1
    return candidate


def remove_asset_library_file(item, *, local_media_path_from_url, ASSET_LIBRARY_DIR, CANVAS_LOCK, HISTORY_LOCK, CONVERSATION_LOCK, HISTORY_FILE, json_references_media_path, ASSET_LIBRARY_LOCK, persisted_json_references_media_path, write_diagnostic):
    """只清理不再被持久化内容引用的素材库副本。"""
    try:
        url = item.get("url") if isinstance(item, dict) else ""
        if not isinstance(url, str) or not url.startswith("/assets/library/"):
            return
        path = local_media_path_from_url(url)
        if not path or not os.path.isfile(path):
            return
        path = os.path.realpath(path)
        root = os.path.realpath(ASSET_LIBRARY_DIR)
        if os.path.commonpath([root, path]) != root:
            return
        # Callers save the changed library index first. Match canvas cleanup's
        # lock order so a concurrent canvas/history write cannot race this check.
        with CANVAS_LOCK:
            with HISTORY_LOCK:
                with CONVERSATION_LOCK:
                    if os.path.isfile(HISTORY_FILE):
                        try:
                            with open(HISTORY_FILE, "r", encoding="utf-8-sig") as handle:
                                history = json.load(handle)
                        except (OSError, UnicodeError, json.JSONDecodeError):
                            return
                        if json_references_media_path(history, path):
                            return
                    # Lock the index until the reference check and deletion finish.
                    with ASSET_LIBRARY_LOCK:
                        if persisted_json_references_media_path(path):
                            return
                        os.remove(path)
    except Exception as exc:
        write_diagnostic(f"asset file delete failed error={type(exc).__name__}")


def make_asset_library_item(src, name="", subdir="", *, asset_library_media_kind, asset_library_safe_extension, sanitize_asset_name, ASSET_LIBRARY_DIR, asset_library_file_fingerprint, now_ms):
    kind = asset_library_media_kind(src)
    ext = asset_library_safe_extension(src, kind)
    safe_name = sanitize_asset_name(name or os.path.basename(src), "asset")
    if not os.path.splitext(safe_name)[1]:
        safe_name += ext
    dest_name = f"lib_{uuid.uuid4().hex[:12]}_{safe_name}"
    subdir = str(subdir or "").strip("/").strip()
    if subdir:
        dest_dir = os.path.join(ASSET_LIBRARY_DIR, subdir)
        os.makedirs(dest_dir, exist_ok=True)
        dest_path = os.path.join(dest_dir, dest_name)
        rel = f"{subdir}/{dest_name}"
    else:
        dest_path = os.path.join(ASSET_LIBRARY_DIR, dest_name)
        rel = dest_name
    try:
        shutil.copy2(src, dest_path)
        content_size, content_sha256 = asset_library_file_fingerprint(dest_path)
    except BaseException:
        try:
            os.remove(dest_path)
        except OSError:
            pass
        raise
    item = {
        "id": f"asset_{uuid.uuid4().hex[:12]}",
        "name": os.path.splitext(safe_name)[0][:120],
        "url": "/assets/library/" + urllib.parse.quote(rel, safe="/"),
        "kind": kind,
        "content_size": content_size,
        "content_sha256": content_sha256,
        "created_at": now_ms(),
    }
    return dest_name, item


def asset_library_file_fingerprint(path):
    """流式读取实际文件内容，避免信任可能过期的索引摘要。"""
    stat = os.stat(path)
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return stat.st_size, digest.hexdigest()


def find_duplicate_asset_library_item(category, candidate, *, ASSET_LIBRARY_DIR, asset_library_media_kind, local_media_path_from_url, asset_library_file_fingerprint):
    """只复用目标分类中仍存在的素材库副本，旧索引无摘要时按文件内容比较。"""
    expected_size = candidate.get("content_size")
    expected_digest = candidate.get("content_sha256")
    if not isinstance(expected_size, int) or not isinstance(expected_digest, str):
        return None
    root = os.path.realpath(ASSET_LIBRARY_DIR)
    for item in category.get("items") or []:
        if not isinstance(item, dict) or not item.get("id"):
            continue
        url = item.get("url")
        if not isinstance(url, str) or not url.startswith("/assets/library/"):
            continue
        if (item.get("kind") or asset_library_media_kind(url)) != candidate.get("kind"):
            continue
        path = local_media_path_from_url(url)
        if not path:
            continue
        path = os.path.realpath(path)
        try:
            if os.path.commonpath([root, path]) != root:
                continue
            stat = os.stat(path)
            if not os.path.isfile(path) or stat.st_size != expected_size:
                continue
            _, digest = asset_library_file_fingerprint(path)
            if digest == expected_digest:
                return item
        except (OSError, ValueError):
            continue
    return None


def _migrate_asset_library_into_dirs_locked(*, load_asset_library, write_diagnostic, unique_asset_category_dir, ASSET_LIBRARY_DIR, save_asset_library):
    """一次性整理：给所有图片分组（含默认的角色/场景）补上真实文件夹，并把仍在 library/ 根目录的
    素材文件搬进各自分组的文件夹、同步更新 URL。幂等：已经在子文件夹里的不动；可安全反复执行。"""
    try:
        lib = load_asset_library()
    except Exception as exc:
        write_diagnostic(f"asset library migration load failed error={type(exc).__name__}")
        return
    changed = False
    for library in lib.get("libraries", []) or []:
        for cat in library.get("categories", []) or []:
            if (cat.get("type") or "image") != "image":
                continue
            if not cat.get("dir"):
                cat["dir"] = unique_asset_category_dir(library, cat.get("name") or "分组")
                changed = True
            cat_dir = str(cat.get("dir") or "").strip("/").strip()
            if not cat_dir:
                continue
            try:
                os.makedirs(os.path.join(ASSET_LIBRARY_DIR, cat_dir), exist_ok=True)
            except Exception as exc:
                write_diagnostic(f"asset library migration mkdir failed error={type(exc).__name__}")
                continue
            for item in (cat.get("items") or []):
                raw_url = urllib.parse.unquote(str(item.get("url") or "").split("?", 1)[0])
                m = re.match(r"^/assets/library/([^/]+)$", raw_url)  # 仅匹配仍在根目录的文件
                if not m:
                    continue
                fname = m.group(1)
                src = os.path.join(ASSET_LIBRARY_DIR, fname)
                if not os.path.isfile(src):
                    continue
                dst = os.path.join(ASSET_LIBRARY_DIR, cat_dir, fname)
                try:
                    if not os.path.exists(dst):
                        shutil.move(src, dst)
                    item["url"] = "/assets/library/" + urllib.parse.quote(f"{cat_dir}/{fname}", safe="/")
                    changed = True
                except Exception as exc:
                    write_diagnostic(f"asset library migration move failed error={type(exc).__name__}")
    if changed:
        try:
            save_asset_library(lib)
        except Exception as exc:
            write_diagnostic(f"asset library migration save failed error={type(exc).__name__}")


