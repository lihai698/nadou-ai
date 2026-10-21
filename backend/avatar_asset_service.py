"""素材平台注册协议、状态归一化和注册记录协调。

索引、文件、锁和供应商调用由应用显式注入，保留现有提交/清理顺序。
"""
import json
import urllib.parse

def apimart_avatar_asset_type(kind):
    return {"video": "Video", "audio": "Audio"}.get(str(kind or "").lower(), "Image")


def extract_apimart_avatar_asset_uri(payload, *, extract_apimart_avatar_asset_uri):
    """从 /v1/tasks 审核结果里取出 asset://<id> 形式的可信素材 URI。"""
    if isinstance(payload, list):
        for item in payload:
            found = extract_apimart_avatar_asset_uri(item)
            if found:
                return found
        return ""
    if not isinstance(payload, dict):
        return ""
    for key in ("asset_url", "assetUrl", "uri", "url"):
        value = str(payload.get(key) or "").strip()
        if value.startswith("asset://"):
            return value
    for key in ("usable_assets", "assets", "result", "data"):
        found = extract_apimart_avatar_asset_uri(payload.get(key))
        if found:
            return found
    asset_id = str(payload.get("asset_id") or payload.get("assetId") or "").strip()
    if asset_id:
        return f"asset://{asset_id}"
    return ""


async def submit_apimart_avatar_asset(provider, public_url, name, kind, project_name='default', group_name='', *, HTTPException, api_headers, apimart_avatar_asset_type, httpx, upstream_response_error_summary, video_api_root):
    """把一个公网可访问的素材提交到 APIMart private-avatar 审核，立即返回任务 ID（不阻塞轮询）。"""
    base_url = video_api_root(provider)
    if not base_url:
        raise HTTPException(status_code=400, detail=f"{provider.get('name') or provider['id']} 未配置 Base URL")
    register_url = f"{base_url}/v1/seedance2/private-avatar"
    body = {
        "project_name": str(project_name or "default").strip() or "default",
        "asset_type": apimart_avatar_asset_type(kind),
        "group": {"name": (group_name or name or "数字人素材")[:60]},
        "assets": [{"url": public_url, "name": (name or "asset")[:60]}],
    }
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(register_url, headers=api_headers(provider=provider), json=body, timeout=120)
        if resp.status_code not in (200, 201):
            raise HTTPException(status_code=502, detail=f"APIMart 数字人注册失败（{resp.status_code}）：{upstream_response_error_summary(resp)}")
        try:
            data = resp.json()
        except ValueError as exc:
            raise HTTPException(status_code=502, detail="APIMart 数字人注册没有返回有效 JSON") from exc
        task = data.get("data") if isinstance(data.get("data"), dict) else data
        task_id = str(task.get("id") or task.get("task_id") or "").strip()
        if not task_id:
            raise HTTPException(status_code=502, detail="APIMart 数字人注册返回中未找到任务 ID")
        return task_id


async def check_apimart_avatar_task(provider, task_id, *, AVATAR_TASK_DONE_STATUSES, AVATAR_TASK_FAIL_STATUSES, HTTPException, api_headers, extract_apimart_avatar_asset_uri, httpx, upstream_response_error_summary, video_api_root):
    """查询一次 APIMart 审核任务。返回 {status: Active/Processing/Failed, asset_uri, detail}。"""
    base_url = video_api_root(provider)
    if not base_url:
        raise HTTPException(status_code=400, detail=f"{provider.get('name') or provider['id']} 未配置 Base URL")
    task_url = f"{base_url}/v1/tasks/{task_id}"
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.get(task_url, headers=api_headers(provider=provider), timeout=60)
        if resp.status_code not in (200, 201):
            raise HTTPException(status_code=502, detail=f"查询审核状态失败（{resp.status_code}）：{upstream_response_error_summary(resp, limit=200)}")
        try:
            payload = resp.json()
        except ValueError as exc:
            raise HTTPException(status_code=502, detail="APIMart 审核状态没有返回有效 JSON") from exc
    node = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    status = str(node.get("status") or "").strip().lower()
    if status in AVATAR_TASK_DONE_STATUSES:
        asset_uri = extract_apimart_avatar_asset_uri(payload)
        if not asset_uri:
            return {"status": "Failed", "asset_uri": "", "detail": "审核完成，但未返回可用的 asset:// 地址（可能部分素材被拒）。"}
        return {"status": "Active", "asset_uri": asset_uri, "detail": ""}
    if status in AVATAR_TASK_FAIL_STATUSES:
        return {"status": "Failed", "asset_uri": "", "detail": f"审核未通过（{status}）。"}
    return {"status": "Processing", "asset_uri": "", "detail": "审核中"}


async def volcengine_ark_asset_call(client, action, body, *, HTTPException, VOLCENGINE_ARK_ASSET_HOST, VOLCENGINE_ARK_ASSET_VERSION, provider_error_summary, upstream_response_error_summary, volcengine_access_key_value, volcengine_secret_key_value, volcengine_sign_v4_headers):
    """调用一次火山 Ark Assets OpenAPI，返回 Result 内容；出错抛 HTTPException。"""
    ak = volcengine_access_key_value()
    sk = volcengine_secret_key_value()
    if not ak or not sk:
        raise HTTPException(status_code=400, detail="未配置火山引擎 AK/SK，请在 API 设置中填写 Access Key ID / Secret Access Key。")
    body_str = json.dumps(body, ensure_ascii=False)
    headers = volcengine_sign_v4_headers(ak, sk, action, body_str)
    url = f"https://{VOLCENGINE_ARK_ASSET_HOST}/?Action={urllib.parse.quote(action, safe='')}&Version={urllib.parse.quote(VOLCENGINE_ARK_ASSET_VERSION, safe='')}"
    resp = await client.post(url, headers=headers, content=body_str.encode("utf-8"), timeout=120)
    try:
        payload = resp.json()
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=f"火山 {action} 返回非 JSON（{resp.status_code}），请检查资产 API 地址") from exc
    meta = payload.get("ResponseMetadata") if isinstance(payload, dict) else None
    if isinstance(meta, dict) and isinstance(meta.get("Error"), dict):
        err = meta["Error"]
        code = err.get("Code") or err.get("CodeN") or ""
        msg = err.get("Message") or ""
        summary = provider_error_summary({"code": code, "message": msg}, fallback="资产 API 返回错误")
        raise HTTPException(status_code=502, detail=f"火山 {action} 失败：{summary}")
    if resp.status_code not in (200, 201):
        raise HTTPException(status_code=502, detail=f"火山 {action} 失败（{resp.status_code}）：{upstream_response_error_summary(resp)}")
    result = payload.get("Result") if isinstance(payload, dict) and isinstance(payload.get("Result"), dict) else None
    return result if result is not None else (payload if isinstance(payload, dict) else {})


async def volcengine_ensure_asset_group(client, project_name, group_name, *, HTTPException, volcengine_ark_asset_call):
    """复用同名素材组合，没有则新建。返回 GroupId。"""
    name = (group_name or "可信素材").strip()[:60] or "可信素材"
    project_name = (project_name or "default").strip() or "default"
    # 先按 Name 模糊查找复用
    try:
        listed = await volcengine_ark_asset_call(client, "ListAssetGroups", {
            "Filter": {"Name": name, "GroupType": "AIGC"},
            "PageNumber": 1, "PageSize": 10, "ProjectName": project_name,
        })
        for item in (listed.get("Items") or []):
            if str(item.get("Name") or "").strip() == name and str(item.get("ProjectName") or "default") == project_name:
                gid = str(item.get("Id") or "").strip()
                if gid:
                    return gid
    except HTTPException:
        pass  # 查询失败不致命，继续走新建
    created = await volcengine_ark_asset_call(client, "CreateAssetGroup", {
        "Name": name, "Description": name, "ProjectName": project_name,
    })
    gid = str(created.get("Id") or "").strip()
    if not gid:
        raise HTTPException(status_code=502, detail="火山 CreateAssetGroup 未返回 GroupId")
    return gid


async def submit_volcengine_avatar_asset(public_url, name, kind, project_name='default', group_name='', *, HTTPException, apimart_avatar_asset_type, httpx, volcengine_ark_asset_call, volcengine_ensure_asset_group):
    """把公网可访问素材提交到火山 Ark 私域素材库（异步）。返回 Asset Id 作为任务 ID。"""
    async with httpx.AsyncClient(timeout=120) as client:
        group_id = await volcengine_ensure_asset_group(client, project_name, group_name)
        created = await volcengine_ark_asset_call(client, "CreateAsset", {
            "GroupId": group_id,
            "URL": public_url,
            "AssetType": apimart_avatar_asset_type(kind),
            "Name": (name or "asset")[:60],
            "ProjectName": (project_name or "default").strip() or "default",
        })
    asset_id = str(created.get("Id") or "").strip()
    if not asset_id:
        raise HTTPException(status_code=502, detail="火山 CreateAsset 未返回 Asset Id")
    return asset_id


async def check_volcengine_avatar_task(asset_id, project_name='default', *, httpx, volcengine_ark_asset_call):
    """查询一次火山素材状态。返回 {status: Active/Processing/Failed, asset_uri, detail}。"""
    async with httpx.AsyncClient(timeout=60) as client:
        info = await volcengine_ark_asset_call(client, "GetAsset", {
            "Id": asset_id,
            "ProjectName": (project_name or "default").strip() or "default",
        })
    status = str(info.get("Status") or "").strip()
    if status == "Active":
        return {"status": "Active", "asset_uri": f"asset://{asset_id}", "detail": ""}
    if status == "Failed":
        return {"status": "Failed", "asset_uri": "", "detail": "火山素材处理失败，无法用于推理。"}
    return {"status": "Processing", "asset_uri": "", "detail": "火山素材处理中"}


def volcengine_public_asset_url(url, *, local_asset_public_url):
    """火山 CreateAsset 要求 URL 公网可访问；本地文件需 PUBLIC_BASE_URL，否则返回 ERR:。"""
    text = str(url or "").strip()
    if text.startswith("http://") or text.startswith("https://"):
        return text
    public = local_asset_public_url(text)
    if public:
        return public
    return "ERR:火山要求素材是公网可访问的 http/https URL；本地画布文件需配置 PUBLIC_BASE_URL/PUBLIC_MEDIA_BASE_URL 暴露为公网地址。"


async def register_asset_library_avatar(item_id, payload, *, AVATAR_SUPPORTED_PLATFORMS, HTTPException, VIDEO_POLL_TIMEOUT, VOLCENGINE_DEFAULT_PROJECT_NAME, asset_library_index_lock, avatar_platform_for_provider, find_asset_item_in_library, get_api_provider, httpx, load_asset_library, now_ms, save_asset_library, submit_apimart_avatar_asset, submit_volcengine_avatar_asset, upload_media_for_apimart, valid_apimart_video_image_input, volcengine_public_asset_url):
    lib = load_asset_library()
    target_item = find_asset_item_in_library(lib, item_id, payload.library_id)
    if not target_item:
        raise HTTPException(status_code=404, detail="资产不存在")
    provider = get_api_provider(payload.provider_id)
    platform = avatar_platform_for_provider(provider)
    if platform not in AVATAR_SUPPORTED_PLATFORMS:
        name = (provider or {}).get("name") or (provider or {}).get("id") or "该平台"
        raise HTTPException(status_code=400, detail=f"「{name}」暂不支持数字人/真人认证（目前仅 APIMart 可用，火山等平台待接入官方资产 API）。")
    kind = str(target_item.get("kind") or "image").lower()
    if kind not in ("image", "video", "audio"):
        kind = "image"
    if platform == "apimart":
        project_name = str(payload.project_name or "default").strip() or "default"
        async with httpx.AsyncClient(timeout=VIDEO_POLL_TIMEOUT) as client:
            public_url = await upload_media_for_apimart(client, provider, target_item.get("url") or "", kind)
        if not valid_apimart_video_image_input(public_url):
            reason = public_url[4:] if isinstance(public_url, str) and public_url.startswith("ERR:") else "无法获取公网可访问地址"
            raise HTTPException(status_code=400, detail=f"素材无法提交到 APIMart：{reason}\n请配置 PUBLIC_BASE_URL，或确认本地文件存在。")
        task_id = await submit_apimart_avatar_asset(
            provider, public_url, target_item.get("name") or "asset", kind,
            project_name=project_name, group_name=payload.group_name,
        )
    elif platform == "volcengine":
        # 火山以 API 设置里配置的 ProjectName 为准（必须与视频生成 key 的项目一致）
        project_name = str(provider.get("volcengine_project_name") or VOLCENGINE_DEFAULT_PROJECT_NAME).strip() or VOLCENGINE_DEFAULT_PROJECT_NAME
        public_url = volcengine_public_asset_url(target_item.get("url") or "")
        if public_url.startswith("ERR:"):
            raise HTTPException(status_code=400, detail=public_url[4:])
        task_id = await submit_volcengine_avatar_asset(
            public_url, target_item.get("name") or "asset", kind,
            project_name=project_name, group_name=payload.group_name or "",
        )
    else:
        raise HTTPException(status_code=400, detail="该平台的认证后端尚未接入。")
    with asset_library_index_lock():
        lib = load_asset_library()
        target_item = find_asset_item_in_library(lib, item_id, payload.library_id)
        if not target_item:
            raise HTTPException(status_code=404, detail="资产不存在")
        regs = target_item.get("registrations")
        if not isinstance(regs, dict):
            regs = {}
        regs[platform] = {
            "provider_id": provider["id"],
            "project_name": project_name,
            "task_id": task_id,
            "status": "Processing",
            "detail": "已提交，审核中",
            "asset_uri": "",
            "asset_id": "",
            "registered_at": now_ms(),
        }
        target_item["registrations"] = regs
        save_asset_library(lib)
    return {"library": lib, "item": target_item}


async def check_asset_library_avatar(item_id, payload, *, AVATAR_SUPPORTED_PLATFORMS, HTTPException, VOLCENGINE_DEFAULT_PROJECT_NAME, asset_library_index_lock, avatar_platform_for_provider, check_apimart_avatar_task, check_volcengine_avatar_task, find_asset_item_in_library, get_api_provider, load_asset_library, save_asset_library):
    lib = load_asset_library()
    target_item = find_asset_item_in_library(lib, item_id, payload.library_id)
    if not target_item:
        raise HTTPException(status_code=404, detail="资产不存在")
    regs = target_item.get("registrations") if isinstance(target_item.get("registrations"), dict) else {}
    provider = get_api_provider(payload.provider_id or "")
    platform = avatar_platform_for_provider(provider)
    if platform not in AVATAR_SUPPORTED_PLATFORMS:
        raise HTTPException(status_code=400, detail="该平台暂不支持数字人/真人认证审核。")
    reg = regs.get(platform) if isinstance(regs.get(platform), dict) else {}
    task_id = str(reg.get("task_id") or "").strip()
    if not task_id:
        raise HTTPException(status_code=400, detail="该素材还没有提交到这个平台的认证审核。")
    if platform == "apimart":
        result = await check_apimart_avatar_task(provider, task_id)
    elif platform == "volcengine":
        result = await check_volcengine_avatar_task(
            task_id, str(reg.get("project_name") or VOLCENGINE_DEFAULT_PROJECT_NAME).strip() or VOLCENGINE_DEFAULT_PROJECT_NAME,
        )
    else:
        raise HTTPException(status_code=400, detail="该平台的认证后端尚未接入。")
    with asset_library_index_lock():
        lib = load_asset_library()
        target_item = find_asset_item_in_library(lib, item_id, payload.library_id)
        if not target_item:
            raise HTTPException(status_code=404, detail="资产不存在")
        regs = target_item.get("registrations") if isinstance(target_item.get("registrations"), dict) else {}
        reg = regs.get(platform) if isinstance(regs.get(platform), dict) else {}
        if str(reg.get("task_id") or "").strip() != task_id:
            raise HTTPException(status_code=409, detail="资产认证任务已更新，请刷新后重试")
        reg["status"] = result["status"]
        reg["detail"] = result.get("detail") or ""
        if result["status"] == "Active" and result.get("asset_uri"):
            reg["asset_uri"] = result["asset_uri"]
            reg["asset_id"] = result["asset_uri"].replace("asset://", "")
        regs[platform] = reg
        target_item["registrations"] = regs
        save_asset_library(lib)
    return {"library": lib, "item": target_item}


def _volc_hmac(key: bytes, msg: str, *, hmac, hashlib):
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()


def volcengine_sign_v4_headers(ak: str, sk: str, action: str, body_str: str, service: str, region: str, version: str, host: str, *, datetime, hashlib, urllib, _volc_hmac, hmac):
    """火山引擎 OpenAPI 签名 V4（POST + JSON body）。返回需随请求发送的鉴权头。"""
    method = "POST"
    content_type = "application/json"
    now = datetime.datetime.now(datetime.timezone.utc)
    x_date = now.strftime("%Y%m%dT%H%M%SZ")
    short_date = x_date[:8]
    payload_hash = hashlib.sha256(body_str.encode("utf-8")).hexdigest()
    # 查询串按键排序：Action < Version
    canonical_query = f"Action={urllib.parse.quote(action, safe='')}&Version={urllib.parse.quote(version, safe='')}"
    canonical_headers = (
        f"content-type:{content_type}\n"
        f"host:{host}\n"
        f"x-content-sha256:{payload_hash}\n"
        f"x-date:{x_date}\n"
    )
    signed_headers = "content-type;host;x-content-sha256;x-date"
    canonical_request = "\n".join([method, "/", canonical_query, canonical_headers, signed_headers, payload_hash])
    algorithm = "HMAC-SHA256"
    credential_scope = f"{short_date}/{region}/{service}/request"
    string_to_sign = "\n".join([
        algorithm, x_date, credential_scope,
        hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
    ])
    k_date = _volc_hmac(sk.encode("utf-8"), short_date)
    k_region = _volc_hmac(k_date, region)
    k_service = _volc_hmac(k_region, service)
    k_signing = _volc_hmac(k_service, "request")
    signature = hmac.new(k_signing, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()
    authorization = (
        f"{algorithm} Credential={ak}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )
    return {
        "Content-Type": content_type,
        "Host": host,
        "X-Date": x_date,
        "X-Content-Sha256": payload_hash,
        "Authorization": authorization,
    }
