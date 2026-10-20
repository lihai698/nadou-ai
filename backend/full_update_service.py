"""完整安装包校验、进度记录及安装与回滚进程协调。

不在导入时执行操作。配置、路径、共享锁、文件写入和进程接口由应用显式注入。
"""

def full_update_path(value, *, FULL_UPDATE_PUBLIC_DIRS, FULL_UPDATE_PUBLIC_ROOTS, re):
    rel = str(value or "")
    parts = rel.split("/")
    if (not rel or "\\" in rel or ":" in rel or any(p in {"", ".", ".."} for p in parts)
            or any(p.endswith((" ", ".")) or re.fullmatch(r"(?i)(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?", p) for p in parts)):
        raise ValueError("发布包包含不安全路径")
    if len(parts) == 1:
        allowed = rel in FULL_UPDATE_PUBLIC_ROOTS
    elif parts[0] == "API":
        allowed = rel == "API/.env.example"
    else:
        allowed = parts[0] in FULL_UPDATE_PUBLIC_DIRS and not any(p.startswith(".") for p in parts[1:])
    if not allowed:
        raise ValueError(f"发布包包含非程序文件：{rel}")
    return rel


def full_update_status_path(job_id, *, DATA_DIR, os, re):
    if not re.fullmatch(r"[0-9a-f]{32}", job_id):
        raise ValueError("更新任务编号无效")
    return os.path.join(DATA_DIR, "update_jobs", f"{job_id}.json")


def write_full_update_status(_callbacks, /, job_id, **changes):
    full_update_status_path = _callbacks['full_update_status_path']
    json = _callbacks['json']
    os = _callbacks['os']
    write_json_atomic = _callbacks['write_json_atomic']
    path = full_update_status_path(job_id)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    try:
        with open(path, "r", encoding="utf-8") as stream:
            state = json.load(stream)
    except (OSError, ValueError):
        state = {"job_id": job_id}
    state.update(changes)
    write_json_atomic(path, state, ensure_ascii=False, indent=2)


def verify_full_update_zip(archive_path, stage_dir, expected_version, *, FULL_UPDATE_MAX_BYTES, FULL_UPDATE_MAX_FILES, full_update_path, hashlib, json, os, re, zipfile):
    """Validate every ZIP member and hash before exposing any file to the installer."""
    with zipfile.ZipFile(archive_path) as bundle:
        entries = bundle.infolist()
        if len(entries) > FULL_UPDATE_MAX_FILES or sum(item.file_size for item in entries) > FULL_UPDATE_MAX_BYTES:
            raise ValueError("发布包超出安全大小限制")
        names = [item.filename for item in entries]
        if len(names) != len({name.casefold() for name in names}) or "RELEASE_FILES.json" not in names:
            raise ValueError("发布包清单缺失或包含重复路径")
        manifest = json.loads(bundle.read("RELEASE_FILES.json"))
        files = manifest.get("files") if isinstance(manifest, dict) else None
        if not isinstance(manifest, dict) or manifest.get("version") != expected_version or not isinstance(files, dict):
            raise ValueError("发布包版本或清单不匹配")
        if not {"main.py", "VERSION", "static/index.html", "run.bat"}.issubset(files):
            raise ValueError("发布包缺少启动所需文件")
        if set(names) != set(files) | {"RELEASE_FILES.json"}:
            raise ValueError("发布包文件与清单不一致")
        os.makedirs(stage_dir, exist_ok=True)
        for item in entries:
            if item.is_dir() or ((item.external_attr >> 16) & 0o170000) == 0o120000:
                raise ValueError("发布包不能包含目录项或符号链接")
            rel = full_update_path(item.filename) if item.filename != "RELEASE_FILES.json" else item.filename
            expected = files.get(rel)
            if rel != "RELEASE_FILES.json" and not re.fullmatch(r"[0-9a-f]{64}", str(expected or "")):
                raise ValueError("发布包哈希格式无效")
            target = os.path.join(stage_dir, *rel.split("/"))
            os.makedirs(os.path.dirname(target), exist_ok=True)
            digest = hashlib.sha256()
            with bundle.open(item) as source, open(target, "wb") as output:
                for chunk in iter(lambda: source.read(1024 * 1024), b""):
                    digest.update(chunk)
                    output.write(chunk)
            if rel != "RELEASE_FILES.json" and digest.hexdigest() != expected:
                raise ValueError(f"发布包文件校验失败：{rel}")
        with open(os.path.join(stage_dir, "VERSION"), encoding="utf-8") as source:
            staged_version = source.read().strip()
        if staged_version != expected_version:
            raise ValueError("发布包 VERSION 不匹配")
        with open(os.path.join(stage_dir, "main.py"), "rb") as source:
            compile(source.read(), "main.py", "exec")
        return sorted(files)


def full_update_release(version, *, GITHUB_REPO_SLUG, github_json, re):
    if not re.fullmatch(r"[0-9]+(?:\.[0-9]+){2,4}", version):
        raise ValueError("版本号格式无效")
    release = github_json(f"https://api.github.com/repos/{GITHUB_REPO_SLUG}/releases/tags/v{version}")
    name = f"nadou-ai-{version}.zip"
    for asset in release.get("assets") or []:
        url = str(asset.get("browser_download_url") or "")
        if asset.get("name") == name and url == f"https://github.com/{GITHUB_REPO_SLUG}/releases/download/v{version}/{name}":
            return url, name
    raise RuntimeError("该版本尚无完整安装包，请稍后重试")


def download_full_update(job_id, version, archive_path, *, FULL_UPDATE_MAX_BYTES, full_update_release, requests, time, urllib, write_full_update_status):
    url, _ = full_update_release(version)
    print(f"[更新] 开始下载 nadou ai {version} 完整安装包", flush=True)
    with requests.get(url, headers={"User-Agent": "nadou-ai-updater"}, stream=True,
                      timeout=(15, 60), proxies=urllib.request.getproxies() or None) as response:
        response.raise_for_status()
        total = int(response.headers.get("Content-Length") or 0)
        if total > FULL_UPDATE_MAX_BYTES:
            raise ValueError("下载文件超过安全大小限制")
        received = 0
        last_report = 0.0
        last_console_percent = -5
        last_console_bytes = 0
        with open(archive_path, "wb") as output:
            for chunk in response.iter_content(chunk_size=256 * 1024):
                if not chunk:
                    continue
                received += len(chunk)
                if received > FULL_UPDATE_MAX_BYTES:
                    raise ValueError("下载文件超过安全大小限制")
                output.write(chunk)
                if time.monotonic() - last_report >= 0.2:
                    write_full_update_status(job_id, phase="downloading", downloaded=received, total=total)
                    last_report = time.monotonic()
                percent = int(received * 100 / total) if total else 0
                if (total and percent >= last_console_percent + 5) or (not total and received - last_console_bytes >= 5 * 1024 * 1024):
                    print(f"[更新] 下载进度 {percent}% · {received / 1048576:.1f} / {total / 1048576:.1f} MB" if total
                          else f"[更新] 已下载 {received / 1048576:.1f} MB", flush=True)
                    last_console_percent = percent
                    last_console_bytes = received
        if total and received != total:
            raise ValueError("下载不完整")
        write_full_update_status(job_id, phase="verifying", downloaded=received, total=total)
        print("[更新] 下载完成，正在校验发布文件", flush=True)


def run_full_update(job_id, version, *, BASE_DIR, DATA_DIR, STATIC_DIR, UPDATE_LOCK, current_app_version, download_full_update, full_update_path, full_update_status_path, json, next_update_backup_dir, os, shutil, subprocess, verify_full_update_zip, write_diagnostic, write_full_update_status, write_json_atomic):
    staging = os.path.join(DATA_DIR, "update_staging", job_id)
    try:
        os.makedirs(staging, exist_ok=False)
        archive = os.path.join(staging, "release.zip")
        download_full_update(job_id, version, archive)
        extracted = os.path.join(staging, "release")
        files = verify_full_update_zip(archive, extracted, version)
        print(f"[更新] {len(files)} 个文件校验通过，正在准备备份和安装", flush=True)
        old_manifest = os.path.join(BASE_DIR, "RELEASE_FILES.json")
        old_files = set()
        if os.path.isfile(old_manifest):
            with open(old_manifest, "r", encoding="utf-8") as stream:
                old_data = json.load(stream)
            old_files = {full_update_path(item) for item in old_data.get("files", {})}
        backup = next_update_backup_dir("full-")
        os.makedirs(backup, exist_ok=False)
        plan = {
            "base": BASE_DIR, "source": extracted, "backup": backup,
            "status": full_update_status_path(job_id), "pid": os.getpid(),
            "files": files + ["RELEASE_FILES.json"],
            "remove": sorted(old_files - set(files)),
            "version": version, "from_version": current_app_version(), "restart": True,
        }
        plan_path = os.path.join(staging, "plan.json")
        write_json_atomic(plan_path, plan, ensure_ascii=False, indent=2)
        helper = os.path.join(STATIC_DIR, "update-helper.ps1")
        if not os.path.isfile(helper):
            raise RuntimeError("缺少更新安装脚本")
        staged_helper = os.path.join(staging, "update-helper.ps1")
        shutil.copy2(helper, staged_helper)
        write_full_update_status(job_id, phase="installing", downloaded=os.path.getsize(archive))
        print("[更新] 安装过程将在新的黑色命令窗口继续，完成后自动重启项目", flush=True)
        subprocess.Popen(
            ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", staged_helper, "-PlanPath", plan_path],
            creationflags=subprocess.CREATE_NEW_CONSOLE | subprocess.CREATE_NEW_PROCESS_GROUP,
            close_fds=True,
        )
        UPDATE_LOCK.release()
    except Exception as exc:
        write_diagnostic(f"full update failed error={type(exc).__name__}: {exc}")
        print(f"[更新] 失败：{exc}", flush=True)
        write_full_update_status(job_id, phase="failed", error=str(exc)[:300])
        if os.path.isdir(staging):
            shutil.rmtree(staging, ignore_errors=True)
        UPDATE_LOCK.release()


def start_full_update(*, HTTPException, Thread, UPDATE_LOCK, check_update, os, run_full_update, uuid, write_full_update_status):
    if os.name != "nt":
        raise HTTPException(status_code=409, detail="当前仅支持 Windows 界面内完整更新")
    if not UPDATE_LOCK.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="正在更新中，请稍后再试")
    try:
        available = check_update()
        if not available.get("update_available"):
            raise HTTPException(status_code=409, detail="没有可安装的新版本")
        version = str((available.get("latest") or {}).get("version") or "")
        job_id = uuid.uuid4().hex
        write_full_update_status(job_id, phase="preparing", version=version, downloaded=0, total=0)
        Thread(target=run_full_update, args=(job_id, version), daemon=True).start()
        return {"job_id": job_id, "version": version}
    except Exception:
        UPDATE_LOCK.release()
        raise


def get_full_update_status(job_id, *, HTTPException, full_update_status_path, json):
    try:
        with open(full_update_status_path(job_id), "r", encoding="utf-8") as stream:
            return json.load(stream)
    except (OSError, ValueError):
        raise HTTPException(status_code=404, detail="更新任务不存在")


def schedule_full_update_rollback(backup_dir, record, *, BASE_DIR, DATA_DIR, STATIC_DIR, current_app_version, full_update_path, full_update_status_path, next_update_backup_dir, os, shutil, subprocess, uuid, write_full_update_status, write_json_atomic):
    original = record.get("existing")
    if not isinstance(original, dict) or not original:
        raise ValueError("完整更新恢复点无效")
    files = sorted(full_update_path(rel) for rel, existed in original.items() if existed)
    removed = sorted(full_update_path(rel) for rel, existed in original.items() if not existed)
    if "main.py" not in files or "VERSION" not in files:
        raise ValueError("恢复点缺少核心程序文件")
    job_id = uuid.uuid4().hex
    staging = os.path.join(DATA_DIR, "update_staging", job_id)
    os.makedirs(staging, exist_ok=False)
    helper = os.path.join(STATIC_DIR, "update-helper.ps1")
    staged_helper = os.path.join(staging, "update-helper.ps1")
    shutil.copy2(helper, staged_helper)
    plan = {
        "base": BASE_DIR, "source": backup_dir,
        "backup": next_update_backup_dir("rollback-full-"),
        "status": full_update_status_path(job_id), "pid": os.getpid(),
        "files": files, "remove": removed,
        "version": str(record.get("from_version") or ""),
        "from_version": current_app_version(), "restart": True,
    }
    write_json_atomic(os.path.join(staging, "plan.json"), plan, ensure_ascii=False, indent=2)
    write_full_update_status(job_id, phase="installing", version=plan["version"])
    subprocess.Popen(
        ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", staged_helper,
         "-PlanPath", os.path.join(staging, "plan.json")],
        creationflags=subprocess.CREATE_NEW_CONSOLE | subprocess.CREATE_NEW_PROCESS_GROUP,
        close_fds=True,
    )
    return {"ok": True, "count": len(files) + len(removed), "restart_scheduled": True,
            "restart_required": True, "version": plan["version"], "job_id": job_id}


