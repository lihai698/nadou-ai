"""更新来源、版本与说明查询及连通性探测。

不在导入时执行操作。配置、路径、共享锁、文件写入和进程接口由应用显式注入。
"""

def update_notes_path(*, STATIC_DIR, os):
    return os.path.join(STATIC_DIR, "update-notes.json")


def safe_update_notes(payload, version=''):
    if not isinstance(payload, dict):
        return {}
    items = payload.get("items")
    if not isinstance(items, list):
        items = []
    clean_items = []
    for item in items[:30]:
        if isinstance(item, dict):
            text = str(item.get("text") or item.get("title") or "").strip()
            if not text:
                continue
            clean_items.append({
                "type": str(item.get("type") or "update").strip()[:32],
                "text": text[:500],
            })
        else:
            text = str(item or "").strip()
            if text:
                clean_items.append({"type": "update", "text": text[:500]})
    notes_version = str(payload.get("version") or version or "").strip()
    history = payload.get("history")
    selected_history = {}
    if version and isinstance(history, list):
        for entry in history:
            if isinstance(entry, dict) and str(entry.get("version") or "").strip() == version:
                selected_history = safe_update_notes(entry, version)
                break
    if selected_history:
        return selected_history
    update_mode = str(payload.get("update_mode") or "").strip()
    return {
        "version": notes_version,
        "updated_at": str(payload.get("updated_at") or payload.get("date") or "").strip(),
        "update_mode": update_mode if update_mode in {"in_app", "full_install"} else "full_install",
        "items": clean_items,
    }


def read_local_update_notes(version='', *, current_app_version, json, os, safe_update_notes, update_notes_path):
    try:
        path = update_notes_path()
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                return safe_update_notes(json.load(f), version)
    except Exception:
        pass
    return {"version": version or current_app_version(), "updated_at": "", "update_mode": "full_install", "items": []}


def fetch_remote_update_notes(url, version='', timeout=5.0, *, Any, Dict, json, requests, safe_update_notes, time, urllib, write_diagnostic):
    info: Dict[str, Any] = {"ok": False, "error": "", "url": url, "version": version, "items": []}
    if not url:
        info["error"] = "missing url"
        return info
    try:
        resp = requests.get(
            f"{url}{'&' if '?' in url else '?'}t={int(time.time())}",
            headers={"User-Agent": "nadou-ai-updater"},
            timeout=timeout,
            proxies=urllib.request.getproxies() or None,
        )
        if 200 <= resp.status_code < 400:
            payload = json.loads(resp.content.decode("utf-8", errors="replace"))
            notes = safe_update_notes(payload, version)
            info.update(notes)
            info["ok"] = True
        else:
            info["error"] = f"HTTP {resp.status_code}"
    except Exception as exc:
        write_diagnostic(f"update notes request failed error={type(exc).__name__}")
        info["error"] = "网络请求失败，请稍后重试"
    return info


def app_info(*, GITHUB_REPO_URL, GITHUB_TREE_URL, GITHUB_UPDATE_NOTES_URL, GITHUB_VERSION_URL, current_app_version, read_local_update_notes):
    version = current_app_version()
    return {
        "version": version,
        "repo_url": GITHUB_REPO_URL,
        "version_url": GITHUB_VERSION_URL,
        "tree_url": GITHUB_TREE_URL,
        "sources": {
            "github": {
                "label": "GitHub",
                "repo_url": GITHUB_REPO_URL,
                "version_url": GITHUB_VERSION_URL,
                "tree_url": GITHUB_TREE_URL,
                "update_notes_url": GITHUB_UPDATE_NOTES_URL,
            },
        },
        "update_notes": read_local_update_notes(version),
    }


def connectivity_probe(name, url, timeout=5.0, *, requests, time, urllib, write_diagnostic):
    started = time.time()
    item = {
        "name": name,
        "url": url,
        "ok": False,
        "status": 0,
        "elapsed_ms": 0,
        "error": "",
        "timed_out": False,
    }
    try:
        response = requests.get(
            url,
            headers={"User-Agent": "nadou-ai-updater"},
            timeout=timeout,
            stream=True,
            proxies=urllib.request.getproxies() or None,
        )
        item["status"] = response.status_code
        item["ok"] = 200 <= response.status_code < 400
        if not item["ok"]:
            item["error"] = f"HTTP {response.status_code} {response.reason}"
        response.close()
    except requests.Timeout:
        item["timed_out"] = True
        item["error"] = f"连接超时（超过 {timeout:g}s）"
    except requests.RequestException as exc:
        write_diagnostic(f"update connectivity probe failed error={type(exc).__name__}")
        item["error"] = "网络请求失败，请稍后重试"
    finally:
        item["elapsed_ms"] = int((time.time() - started) * 1000)
    return item


def update_connectivity_targets(*, GITHUB_TREE_URL, GITHUB_VERSION_URL):
    return [
        ("GitHub 更新列表", GITHUB_TREE_URL, "github", True),
        ("GitHub 版本文件", GITHUB_VERSION_URL, "github", True),
        ("GitHub 主页", "https://github.com/", "github", False),
    ]


def update_connectivity_probe(name, *, HTTPException, connectivity_probe, update_connectivity_targets):
    """实时检测：只探测单个目标，前端可并发调用并逐条刷新。"""
    for t_name, url, source, required in update_connectivity_targets():
        if t_name == name:
            item = connectivity_probe(t_name, url)
            item["source"] = source
            item["required"] = required
            return item
    raise HTTPException(status_code=404, detail="未知的连通性检测目标")


def update_connectivity(*, connectivity_probe, update_connectivity_targets):
    targets = update_connectivity_targets()
    results = []
    for name, url, source, required in targets:
        item = connectivity_probe(name, url)
        item["source"] = source
        item["required"] = required
        results.append(item)
    source_required = [item for item in results if item.get("required")]
    sources = {"github": {
        "ok": all(item["ok"] for item in source_required),
        "required": [item["name"] for item in source_required],
    }}
    return {
        "ok": sources["github"]["ok"],
        "results": results,
        "sources": sources,
        "required": sources["github"]["required"],
        "optional": ["GitHub 主页"],
    }


def fetch_remote_version(url, timeout=5.0, *, Any, Dict, re, requests, time, urllib, write_diagnostic):
    info: Dict[str, Any] = {"version": "", "ok": False, "error": "", "url": url}
    if not url:
        info["error"] = "missing url"
        return info
    try:
        resp = requests.get(
            f"{url}{'&' if '?' in url else '?'}t={int(time.time())}",
            headers={"User-Agent": "nadou-ai-updater"},
            timeout=timeout,
            proxies=urllib.request.getproxies() or None,
        )
        if 200 <= resp.status_code < 400:
            text = resp.content.decode("utf-8", errors="replace").strip()
            version = text.splitlines()[0].strip() if text else ""
            # 防御：raw 网页/错误页会返回 HTML 或 JSON，必须长得像版本号（含数字、无尖括号/花括号）
            if version and "<" not in version and "{" not in version and re.search(r"\d", version):
                info["version"] = version
                info["ok"] = True
            elif not version:
                info["error"] = "空版本文件"
            else:
                info["error"] = "版本文件格式异常"
        else:
            info["error"] = f"HTTP {resp.status_code}"
    except requests.RequestException as exc:
        write_diagnostic(f"remote version request failed error={type(exc).__name__}")
        info["error"] = "网络请求失败，请稍后重试"
    return info


def check_update(*, Any, Dict, GITHUB_UPDATE_NOTES_URL, GITHUB_VERSION_URL, current_app_version, fetch_remote_update_notes, fetch_remote_version, version_gt):
    """服务端检测维护者 GitHub 仓库的远端版本。"""
    current = current_app_version()
    github = fetch_remote_version(GITHUB_VERSION_URL, timeout=5.0)
    github["source"] = "github"
    best = {"source": "github", "version": github["version"]} if github["ok"] and github["version"] else {}
    update_available = bool(best and version_gt(best["version"], current))
    notes_by_source: Dict[str, Any] = {}
    if best and best.get("version"):
        notes = fetch_remote_update_notes(GITHUB_UPDATE_NOTES_URL, best["version"], timeout=3.0)
        notes["source"] = "github"
        notes_by_source["github"] = notes
        best["update_notes"] = notes if notes.get("ok") else {"version": best["version"], "items": []}
    return {
        "current": current,
        "github": github,
        "latest": best,
        "update_notes": best.get("update_notes") if best else {},
        "update_notes_sources": notes_by_source,
        "update_available": update_available,
        "reachable": bool(github["ok"]),
    }


def github_get(url, headers=None, timeout=30, *, requests, urllib, write_diagnostic):
    try:
        response = requests.get(
            url,
            headers=headers or {},
            timeout=timeout,
            proxies=urllib.request.getproxies() or None,
        )
    except requests.RequestException as exc:
        write_diagnostic(f"GitHub request failed error={type(exc).__name__}")
        raise urllib.error.URLError("GitHub 更新请求失败") from exc
    if response.status_code >= 400 or response.status_code == 304:
        raise urllib.error.HTTPError(url, response.status_code, response.reason, response.headers, None)
    return response


def github_json(url, *, github_get, json):
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "nadou-ai-updater",
    }
    resp = github_get(url, headers=headers, timeout=30)
    return json.loads(resp.content.decode("utf-8", errors="replace"))


def github_bytes(url, *, github_get):
    resp = github_get(url, headers={"User-Agent": "nadou-ai-updater"}, timeout=60)
    return resp.content


