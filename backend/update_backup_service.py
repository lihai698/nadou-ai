"""应用更新恢复点清单、保留策略与本地回滚协调。

不在导入时执行操作。配置、路径、共享锁、文件写入和进程接口由应用显式注入。
"""

def update_backup_root(*, DATA_DIR, os):
    return os.path.abspath(os.path.join(DATA_DIR, "update_backups"))


def next_update_backup_dir(prefix='', *, os, time, update_backup_root):
    root = update_backup_root()
    os.makedirs(root, exist_ok=True)
    base = f"{prefix}{time.strftime('%Y%m%d-%H%M%S')}"
    candidate = os.path.join(root, base)
    suffix = 2
    while os.path.exists(candidate):
        candidate = os.path.join(root, f"{base}-{suffix}")
        suffix += 1
    return candidate


def update_backup_manifest_path(backup_dir, *, UPDATE_BACKUP_MANIFEST, os):
    return os.path.join(backup_dir, UPDATE_BACKUP_MANIFEST)


def read_update_backup_manifest(backup_dir, *, json, update_backup_manifest_path):
    try:
        with open(update_backup_manifest_path(backup_dir), "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def write_update_backup_manifest(backup_dir, payload, *, update_backup_manifest_path, write_json_atomic):
    path = update_backup_manifest_path(backup_dir)
    write_json_atomic(path, payload, ensure_ascii=False, indent=2)


def count_regular_files(path, *, os):
    return sum(len(files) for _, _, files in os.walk(path)) if os.path.isdir(path) else 0


def prune_update_backups(keep_names=None, *, List, UPDATE_BACKUP_RETENTION, list_update_backups, os, shutil, update_backup_root, write_diagnostic):
    """Keep the newest restore points while never deleting an active protected point."""
    keep_names = {str(name) for name in (keep_names or set()) if str(name)}
    backups = sorted(list_update_backups(), key=lambda item: float(item.get("created_at") or 0), reverse=True)
    selected_names = []
    for item in backups:
        name = str(item.get("name") or "")
        if name in keep_names and name not in selected_names:
            selected_names.append(name)
    for item in backups:
        name = str(item.get("name") or "")
        if len(selected_names) >= UPDATE_BACKUP_RETENTION:
            break
        if name and name not in selected_names:
            selected_names.append(name)
    selected = set(selected_names)
    removed: List[str] = []
    for item in backups:
        name = str(item.get("name") or "")
        if name in selected:
            continue
        path = os.path.join(update_backup_root(), name)
        try:
            shutil.rmtree(path)
            removed.append(name)
        except OSError as exc:
            write_diagnostic(f"update backup cleanup failed error={type(exc).__name__}")
    return removed


def create_update_backup(backup_dir, root_files, static_files, *, kind, source='', target_version='', parent_backup='', update_notes=None, Any, Dict, UPDATE_BACKUP_FORMAT, count_regular_files, current_app_version, os, safe_static_dir, safe_update_notes, safe_update_target, shutil, time, update_allowed_file, update_backup_root, write_update_backup_manifest):
    """Create a complete, self-describing restore point before replacing update payloads."""
    backup_root_abs = update_backup_root()
    backup_dir = os.path.abspath(backup_dir)
    if os.path.commonpath([backup_root_abs, backup_dir]) != backup_root_abs:
        raise ValueError("备份路径不安全")
    if os.path.exists(backup_dir):
        raise FileExistsError("备份目录已存在")
    clean_root_files = sorted({str(item or "").replace("\\", "/") for item in root_files if update_allowed_file(item) and not str(item).startswith("static/")})
    clean_static_files = sorted({str(item or "").replace("\\", "/") for item in static_files if str(item).startswith("static/") and update_allowed_file(item)})
    manifest: Dict[str, Any] = {
        "format": UPDATE_BACKUP_FORMAT,
        "state": "creating",
        "kind": kind,
        "created_at": time.time(),
        "from_version": current_app_version(),
        "target_version": str(target_version or "").strip(),
        "source": str(source or "").strip(),
        "parent_backup": str(parent_backup or "").strip(),
        "update_notes": safe_update_notes(update_notes or {}, str(target_version or "").strip()),
        "root_files": {},
        "static_snapshot": {"exists": False, "file_count": 0},
        "affected_files": clean_root_files + clean_static_files,
    }
    try:
        os.makedirs(backup_dir, exist_ok=False)
        write_update_backup_manifest(backup_dir, manifest)
        for rel in clean_root_files:
            target = safe_update_target(rel)
            existed = os.path.isfile(target)
            manifest["root_files"][rel] = {"existed": existed}
            if existed:
                backup_path = os.path.join(backup_dir, *rel.split("/"))
                os.makedirs(os.path.dirname(backup_path), exist_ok=True)
                shutil.copy2(target, backup_path)
        static_dir = safe_static_dir()
        if os.path.isdir(static_dir):
            backup_static_dir = os.path.join(backup_dir, "static")
            shutil.copytree(static_dir, backup_static_dir)
            manifest["static_snapshot"] = {
                "exists": True,
                "file_count": count_regular_files(backup_static_dir),
            }
        manifest["state"] = "ready"
        write_update_backup_manifest(backup_dir, manifest)
        return manifest
    except Exception:
        if os.path.isdir(backup_dir):
            shutil.rmtree(backup_dir, ignore_errors=True)
        raise


def list_update_backups(*, count_regular_files, json, os, read_update_backup_manifest, update_backup_root):
    root = update_backup_root()
    if not os.path.isdir(root):
        return []
    items = []
    for name in sorted(os.listdir(root), reverse=True):
        bp = os.path.join(root, name)
        if not os.path.isdir(bp):
            continue
        full_record_path = os.path.join(bp, "full-update-backup.json")
        if os.path.isfile(full_record_path):
            try:
                with open(full_record_path, "r", encoding="utf-8-sig") as stream:
                    full_record = json.load(stream)
                if not isinstance(full_record.get("existing"), dict):
                    continue
                items.append({
                    "name": name, "file_count": count_regular_files(bp) - 1,
                    "created_at": os.path.getmtime(bp), "kind": "full_update",
                    "from_version": full_record.get("from_version") or "",
                    "target_version": full_record.get("version") or "",
                    "affected_file_count": len(full_record["existing"]),
                    "affected_files": list(full_record["existing"])[:30],
                })
            except (OSError, ValueError, TypeError):
                continue
            continue
        manifest = read_update_backup_manifest(bp)
        if manifest and manifest.get("state") != "ready":
            continue
        file_count = count_regular_files(bp) - (1 if manifest else 0)
        try:
            created_at = float(manifest.get("created_at") or os.path.getmtime(bp))
        except OSError:
            created_at = 0.0
        items.append({
            "name": name,
            "file_count": max(0, file_count),
            "created_at": created_at,
            "format": manifest.get("format") if manifest else 1,
            "kind": manifest.get("kind") if manifest else "legacy",
            "from_version": manifest.get("from_version") if manifest else "",
            "target_version": manifest.get("target_version") if manifest else "",
            "source": manifest.get("source") if manifest else "",
            "update_notes": manifest.get("update_notes") if manifest else {},
            "affected_file_count": len(manifest.get("affected_files") or []) if manifest else file_count,
            "affected_files": list(manifest.get("affected_files") or [])[:30] if manifest else [],
        })
    return sorted(items, key=lambda item: float(item.get("created_at") or 0), reverse=True)


def get_update_backups(*, list_update_backups):
    return {"backups": list_update_backups()}


def rollback_update(req, *, DATA_DIR, HTTPException, UPDATE_LOCK, create_update_backup, current_app_version, json, next_update_backup_dir, os, prune_update_backups, read_update_backup_manifest, safe_static_dir, safe_update_target, schedule_full_update_rollback, schedule_self_restart, shutil, update_allowed_file, write_diagnostic):
    if not req.name:
        raise HTTPException(status_code=400, detail="缺少备份名称")
    if not UPDATE_LOCK.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="正在更新中，请稍后再试")
    try:
        backup_root_abs = os.path.abspath(os.path.join(DATA_DIR, "update_backups"))
        backup_dir = os.path.abspath(os.path.join(backup_root_abs, req.name))
        if os.path.commonpath([backup_root_abs, backup_dir]) != backup_root_abs:
            raise HTTPException(status_code=400, detail="备份路径不安全")
        if not os.path.isdir(backup_dir):
            raise HTTPException(status_code=404, detail="备份不存在")
        full_record_path = os.path.join(backup_dir, "full-update-backup.json")
        if os.path.isfile(full_record_path):
            if os.name != "nt":
                raise HTTPException(status_code=409, detail="完整版本恢复仅支持 Windows")
            try:
                with open(full_record_path, "r", encoding="utf-8-sig") as stream:
                    return schedule_full_update_rollback(backup_dir, json.load(stream))
            except Exception as exc:
                write_diagnostic(f"full update rollback failed error={type(exc).__name__}")
                raise HTTPException(status_code=500, detail="无法启动完整版本恢复，请检查恢复点") from exc
        manifest = read_update_backup_manifest(backup_dir)
        if manifest and manifest.get("state") != "ready":
            raise HTTPException(status_code=409, detail="备份尚未完整创建，不能还原")
        manifest_roots = manifest.get("root_files") if isinstance(manifest.get("root_files"), dict) else {}
        root_files = sorted(manifest_roots.keys()) if manifest_roots else ["main.py", "VERSION"]
        # Restoring is itself a risky operation. Preserve the live version first so
        # the user can roll forward again if the selected historical build is worse.
        rollback_backup_dir = next_update_backup_dir("rollback-")
        rollback_backup = create_update_backup(
            rollback_backup_dir,
            root_files,
            [],
            kind="rollback_safety",
            source="local-rollback",
            target_version=str(manifest.get("from_version") or "").strip(),
            parent_backup=req.name,
            update_notes={
                "version": current_app_version(),
                "items": [{"type": "rollback", "text": f"还原恢复点 {req.name}"}],
            },
        )
        restored = []
        skipped = []
        removed = []
        backup_static_dir = os.path.join(backup_dir, "static")
        if os.path.isdir(backup_static_dir):
            static_dir = safe_static_dir()
            if os.path.isdir(static_dir):
                shutil.rmtree(static_dir)
            try:
                shutil.copytree(backup_static_dir, static_dir)
            except Exception:
                if os.path.isdir(static_dir):
                    shutil.rmtree(static_dir, ignore_errors=True)
                raise
            for dirpath, _, filenames in os.walk(backup_static_dir):
                for fn in filenames:
                    src = os.path.join(dirpath, fn)
                    restored.append(os.path.relpath(src, backup_dir).replace("\\", "/"))
        elif manifest and isinstance(manifest.get("static_snapshot"), dict) and not manifest["static_snapshot"].get("exists"):
            static_dir = safe_static_dir()
            if os.path.isdir(static_dir):
                shutil.rmtree(static_dir)
                removed.append("static/")
        for dirpath, _, filenames in os.walk(backup_dir):
            for fn in filenames:
                src = os.path.join(dirpath, fn)
                rel = os.path.relpath(src, backup_dir).replace("\\", "/")
                if rel.startswith("static/"):
                    continue
                if not update_allowed_file(rel):
                    skipped.append(rel)
                    continue
                try:
                    target = safe_update_target(rel)
                except ValueError:
                    skipped.append(rel)
                    continue
                os.makedirs(os.path.dirname(target), exist_ok=True)
                temp_path = f"{target}.rollback_tmp"
                with open(src, "rb") as fin, open(temp_path, "wb") as fout:
                    shutil.copyfileobj(fin, fout)
                os.replace(temp_path, target)
                restored.append(rel)
        for rel, info in manifest_roots.items():
            if not update_allowed_file(rel) or str(rel).startswith("static/"):
                continue
            if bool((info or {}).get("existed")):
                continue
            target = safe_update_target(rel)
            if os.path.isfile(target):
                os.remove(target)
                removed.append(rel)
        restart_scheduled = False
        if req.auto_restart and restored:
            restart_scheduled = schedule_self_restart(req.restart_delay)
        pruned_backups = prune_update_backups({req.name, os.path.basename(rollback_backup_dir)})
        return {
            "ok": True,
            "restored": restored,
            "skipped": skipped,
            "removed": removed,
            "count": len(restored),
            "rollback_backup_dir": rollback_backup_dir,
            "rollback_backup": rollback_backup,
            "pruned_backups": pruned_backups,
            "restart_required": True,
            "restart_scheduled": restart_scheduled,
        }
    except HTTPException:
        raise
    except Exception as exc:
        write_diagnostic(f"rollback failed error={type(exc).__name__}")
        raise HTTPException(status_code=500, detail="回滚失败，请检查诊断日志和备份后重试。") from exc
    finally:
        UPDATE_LOCK.release()


