"""界面内更新的公开文件筛选、暂存校验与替换协调。

不在导入时执行操作。配置、路径、共享锁、文件写入和进程接口由应用显式注入。
"""

def update_allowed_file(path):
    path = str(path or "").replace("\\", "/").lstrip("/")
    if not path or any(part in {"", ".", ".."} for part in path.split("/")):
        return False
    return path in {"main.py", "VERSION"} or path.startswith("static/")


def download_github_update_files(files, staging_root, commit_sha, *, GITHUB_RAW_ROOT, github_bytes, os, safe_update_target, urllib):
    staging_root_abs = os.path.abspath(staging_root)
    for rel in files:
        safe_update_target(rel)
        raw_url = f"{GITHUB_RAW_ROOT.rsplit('/', 1)[0]}/{commit_sha}/{urllib.parse.quote(rel, safe='/')}"
        data = github_bytes(raw_url)
        stage_path = os.path.abspath(os.path.join(staging_root_abs, *rel.split("/")))
        if os.path.commonpath([staging_root_abs, stage_path]) != staging_root_abs:
            raise ValueError(f"更新暂存路径不安全：{rel}")
        os.makedirs(os.path.dirname(stage_path), exist_ok=True)
        with open(stage_path, "wb") as f:
            f.write(data)


def safe_update_target(path, *, BASE_DIR, os, update_allowed_file):
    rel = str(path or "").replace("\\", "/").lstrip("/")
    if not update_allowed_file(rel):
        raise ValueError(f"更新文件不在允许范围：{rel}")
    target = os.path.abspath(os.path.join(BASE_DIR, *rel.split("/")))
    base = os.path.abspath(BASE_DIR)
    if os.path.commonpath([base, target]) != base:
        raise ValueError(f"更新路径不安全：{rel}")
    return target


def safe_static_dir(*, BASE_DIR, STATIC_DIR, os):
    target = os.path.abspath(STATIC_DIR)
    expected = os.path.abspath(os.path.join(BASE_DIR, "static"))
    base = os.path.abspath(BASE_DIR)
    if target != expected or os.path.commonpath([base, target]) != base:
        raise RuntimeError(f"static 路径不安全：{target}")
    return target


def github_update_file_list(*, GITHUB_COMMIT_URL, GITHUB_REPO_SLUG, github_json, re, update_allowed_file):
    commit_sha = str(github_json(GITHUB_COMMIT_URL).get("sha") or "")
    if not re.fullmatch(r"[0-9a-f]{40}", commit_sha):
        raise RuntimeError("GitHub 未返回有效的版本编号")
    tree_url = f"https://api.github.com/repos/{GITHUB_REPO_SLUG}/git/trees/{commit_sha}?recursive=1"
    tree_data = github_json(tree_url)
    if tree_data.get("truncated"):
        raise RuntimeError("GitHub 更新文件列表不完整")
    entries = tree_data.get("tree") or []
    static_files = []
    root_files = []
    for entry in entries:
        path = str(entry.get("path") or "").replace("\\", "/")
        if entry.get("type") == "blob" and update_allowed_file(path):
            if path.startswith("static/"):
                static_files.append(path)
            else:
                root_files.append(path)
    if "main.py" not in root_files:
        root_files.append("main.py")
    if "VERSION" not in root_files:
        root_files.append("VERSION")
    static_files = sorted(set(static_files))
    root_files = sorted(set(root_files))
    files = root_files + static_files
    if not static_files:
        raise RuntimeError("GitHub 未返回 static 文件，已取消更新")
    return root_files, static_files, files, commit_sha


def staged_update_file_list(staging_root, *, os, update_allowed_file):
    root_files = []
    static_files = []
    for root_dir, _, names in os.walk(staging_root):
        for name in names:
            path = os.path.abspath(os.path.join(root_dir, name))
            rel = os.path.relpath(path, staging_root).replace("\\", "/")
            if not update_allowed_file(rel):
                continue
            if rel.startswith("static/"):
                static_files.append(rel)
            else:
                root_files.append(rel)
    if "main.py" not in root_files or "VERSION" not in root_files:
        raise RuntimeError("更新源缺少 main.py 或 VERSION")
    if not static_files:
        raise RuntimeError("更新源未返回 static 文件，已取消更新")
    root_files = sorted(set(root_files))
    static_files = sorted(set(static_files))
    return root_files, static_files, root_files + static_files


def stage_update_from_github(staging_root, *, download_github_update_files, github_update_file_list):
    """下载维护者仓库的更新文件到暂存目录。"""
    root_files, static_files, files, commit_sha = github_update_file_list()
    download_github_update_files(files, staging_root, commit_sha)
    return root_files, static_files, files


def validate_staged_update(staging_root, root_files, static_files, *, current_app_version, os, safe_update_target, version_gt):
    """Reject incomplete or syntactically invalid downloads before touching live code."""
    main_path = os.path.join(staging_root, "main.py")
    version_path = os.path.join(staging_root, "VERSION")
    if not os.path.isfile(main_path) or not os.path.isfile(version_path):
        raise RuntimeError("更新暂存缺少 main.py 或 VERSION")
    with open(main_path, "rb") as f:
        compile(f.read(), main_path, "exec")
    with open(version_path, "r", encoding="utf-8") as f:
        version = (f.read().strip().splitlines() or [""])[0].strip()
    if not version or len(version) > 80 or any(ch in version for ch in "<>\r\n"):
        raise RuntimeError("更新暂存的 VERSION 格式异常")
    if not version_gt(version, current_app_version()):
        raise RuntimeError(f"更新源版本 {version} 不高于当前版本 {current_app_version()}")
    for rel in list(root_files or []) + list(static_files or []):
        safe_update_target(rel)
        staged_path = os.path.join(staging_root, *str(rel).replace("\\", "/").split("/"))
        if not os.path.isfile(staged_path):
            raise RuntimeError(f"更新暂存缺少文件：{rel}")


def update_from_github(req=None, *, Any, DATA_DIR, Dict, HTTPException, UPDATE_LOCK, create_update_backup, json, next_update_backup_dir, os, prune_update_backups, safe_static_dir, safe_update_notes, safe_update_target, schedule_self_restart, shutil, stage_update_from_github, time, validate_staged_update, write_diagnostic):
    if not UPDATE_LOCK.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="正在更新中，请稍后再试")
    staging_root = ""
    try:
        backup_root = ""
        backup_manifest: Dict[str, Any] = {}
        staging_root = os.path.join(
            DATA_DIR, "update_staging",
            f"{time.strftime('%Y%m%d-%H%M%S')}-{os.getpid()}-github",
        )
        try:
            root_files, static_files, files = stage_update_from_github(staging_root)
        except Exception as exc:
            write_diagnostic(f"update staging failed error={type(exc).__name__}")
            raise HTTPException(status_code=502, detail="GitHub 更新下载失败，请检查网络连接后重试。") from exc
        write_diagnostic(f"update download staged files={len(files)}")

        validate_staged_update(staging_root, root_files, static_files)

        new_version = ""
        try:
            with open(os.path.join(staging_root, "VERSION"), "r", encoding="utf-8") as f:
                new_version = (f.read().strip().splitlines() or [""])[0].strip()
        except Exception:
            pass
        notes_file = os.path.join(staging_root, "static", "update-notes.json")
        update_notes: Dict[str, Any] = {}
        try:
            if os.path.exists(notes_file):
                with open(notes_file, "r", encoding="utf-8") as f:
                    update_notes = safe_update_notes(json.load(f), new_version)
        except Exception:
            update_notes = {}
        if update_notes.get("version") != new_version or update_notes.get("update_mode") != "in_app":
            raise HTTPException(status_code=409, detail="此版本需要完整安装包，不能使用界面内更新")
        # A restore point must be complete before any live file is replaced.
        backup_root = next_update_backup_dir()
        backup_manifest = create_update_backup(
            backup_root,
            root_files,
            static_files,
            kind="update",
            source="github",
            target_version=new_version,
            update_notes=update_notes,
        )
        updated = []

        staged_static_dir = os.path.join(staging_root, "static")
        if not os.path.isdir(staged_static_dir):
            raise RuntimeError("GitHub static 暂存目录不存在，已取消更新")
        static_dir = safe_static_dir()
        backup_static_dir = os.path.join(backup_root, "static")
        if os.path.isdir(static_dir):
            shutil.rmtree(static_dir)
        try:
            shutil.copytree(staged_static_dir, static_dir)
        except Exception:
            if os.path.isdir(static_dir):
                shutil.rmtree(static_dir, ignore_errors=True)
            if os.path.isdir(backup_static_dir):
                shutil.copytree(backup_static_dir, static_dir)
            raise
        updated.extend(static_files)

        replaced_root_files = []
        try:
            for rel in root_files:
                target = safe_update_target(rel)
                os.makedirs(os.path.dirname(target), exist_ok=True)
                temp_path = f"{target}.update_tmp"
                shutil.copy2(os.path.join(staging_root, *rel.split("/")), temp_path)
                os.replace(temp_path, target)
                replaced_root_files.append(rel)
                updated.append(rel)
        except Exception:
            for rel in reversed(replaced_root_files):
                backup_path = os.path.join(backup_root, *rel.split("/"))
                target = safe_update_target(rel)
                if os.path.exists(backup_path):
                    temp_path = f"{target}.rollback_tmp"
                    shutil.copy2(backup_path, temp_path)
                    os.replace(temp_path, target)
                elif not bool((backup_manifest.get("root_files") or {}).get(rel, {}).get("existed")) and os.path.exists(target):
                    os.remove(target)
            if os.path.isdir(static_dir):
                shutil.rmtree(static_dir, ignore_errors=True)
            if os.path.isdir(backup_static_dir):
                shutil.copytree(backup_static_dir, static_dir)
            raise

        restart_scheduled = False
        if req.auto_restart and updated:
            restart_scheduled = schedule_self_restart(req.restart_delay)
        pruned_backups = prune_update_backups({os.path.basename(backup_root)})
        return {
            "ok": True,
            "source": "github",
            "source_label": "GitHub",
            "updated": updated,
            "count": len(updated),
            "version": new_version,
            "update_notes": update_notes,
            "backup_dir": backup_root,
            "backup": backup_manifest,
            "pruned_backups": pruned_backups,
            "restart_required": True,
            "restart_scheduled": restart_scheduled,
        }
    except HTTPException:
        raise
    except Exception as exc:
        write_diagnostic(f"update failed error={type(exc).__name__}")
        raise HTTPException(status_code=500, detail="更新失败，原文件已保留；请检查诊断日志后重试。") from exc
    finally:
        if staging_root and os.path.isdir(staging_root):
            shutil.rmtree(staging_root, ignore_errors=True)
        UPDATE_LOCK.release()


