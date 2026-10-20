"""视频 HTTP 提交、候选端点、轮询与安全错误转换。"""
import re

async def generate_http_video(payload, provider, base_url, requested_model, *, HTTPException, VIDEO_POLL_TIMEOUT, _safe_upstream_text, api_headers, extract_task_id, httpx, log_net_error, looks_like_html_response, public_video_generation_result, redact_url_for_log, safe_upstream_http_detail, safe_upstream_transport_detail, save_remote_video_to_output, video_output_urls, wait_for_video_task, video_submit_url_candidates, build_video_request):
    submit_urls = video_submit_url_candidates(provider, base_url)
    submit_url = submit_urls[0]
    try:
        async with httpx.AsyncClient(timeout=VIDEO_POLL_TIMEOUT) as client:
            body = await build_video_request(client, payload, provider, base_url, requested_model)
            # --- 发起视频生成请求 ---
            raw = None
            html_response = None
            last_response = None
            last_json_error = None
            total_candidates = len(submit_urls)
            for idx, candidate_url in enumerate(submit_urls):
                submit_url = candidate_url
                is_last = idx == total_candidates - 1
                response = await client.post(submit_url, headers=api_headers(provider=provider), json=body)
                last_response = response
                if response.status_code >= 400:
                    # 404/405（或直接返回网页 HTML）通常表示该平台不支持这个端点路径——
                    # 例如有的站点只实现了统一格式的 /v2/videos/generations，而我们先试了 /v1。
                    # 这种情况要继续尝试下一个候选端点（关键修复：以前在这里直接 raise_for_status，
                    # 第一个 /v1 报错就抛出，永远轮不到 /v2，表现为“接口错误”）。
                    # 其它错误（模型不支持/时长/额度等请求被拒）说明端点是存在的，直接抛出交给外层友好提示。
                    endpoint_missing = response.status_code in (404, 405) or looks_like_html_response(response.text)
                    if endpoint_missing and not is_last:
                        continue
                    response.raise_for_status()
                try:
                    raw = response.json()
                    break
                except Exception as exc:
                    last_json_error = exc
                    if looks_like_html_response(response.text):
                        html_response = response
                        continue
                    if not is_last:
                        continue
                    raise HTTPException(status_code=502, detail=f"上游视频接口返回非 JSON 响应（状态 {response.status_code}）")
            if raw is None:
                resp = html_response or last_response
                status_code = getattr(resp, "status_code", 200)
                raise HTTPException(
                    status_code=502,
                    detail=(
                        f"上游视频接口返回了网页 HTML，而不是 JSON（状态 {status_code}）。\n\n"
                        f"这通常表示 API 设置里的 Base URL 指到了第三方聚合平台的管理后台/网页入口，"
                        f"或该平台不支持当前视频接口路径。请确认 Base URL 是接口地址，例如以 /v1 结尾的 OpenAI 兼容地址，"
                        f"并确认该平台实际支持视频生成端点。"
                    )
                ) from last_json_error
            task_id = extract_task_id(raw) or raw.get("task_id") or raw.get("id")
            result = raw
            if task_id and not video_output_urls(raw):
                result = await wait_for_video_task(client, provider, task_id, submit_url)
            urls = video_output_urls(result)
            if not urls:
                raise HTTPException(status_code=502, detail="视频生成成功但没有返回视频地址")
            local_urls = [await save_remote_video_to_output(url) for url in urls]
            return public_video_generation_result({"videos": local_urls, "task_id": task_id, "raw": result})
    except httpx.HTTPStatusError as exc:
        text = exc.response.text
        try:
            requested_model = body.get("model", "") or payload.model or ""
        except NameError:
            requested_model = payload.model or ""
        provider_name = _safe_upstream_text(provider.get('name') or provider['id'], 100)
        requested_model = _safe_upstream_text(requested_model, 100)
        # 1) 模型名不在上游支持范围 → 从错误信息里抽取合法列表展示
        valid_models_match = re.search(r"not in\s*\[([^\]]+)\]", text)
        if valid_models_match:
            valid_models = [
                m.strip() for m in valid_models_match.group(1).split(",")
                if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}", m.strip())
            ]
        if valid_models_match and valid_models:
            sample = valid_models[:30]
            more = f"（共 {len(valid_models)} 个，仅显示前 {len(sample)} 个）" if len(valid_models) > len(sample) else ""
            hint = (
                f"上游「{provider_name}」不识别模型「{requested_model}」。\n\n"
                f"上游支持的视频模型清单{more}：\n  {', '.join(sample)}\n\n"
                f"请到「API 设置」里把视频模型改成上面列表中的一个。"
            )
            raise HTTPException(status_code=exc.response.status_code, detail=hint) from exc
        # 2) 模型名合法但账号没开通通道
        if "channel not found" in text or "model_not_found" in text:
            hint = (
                f"上游「{provider_name}」识别了模型「{requested_model}」，但你的 API Key 账号下**没有该模型的可用通道**。\n\n"
                f"原因：你的账号没开通这个模型的访问权限（付费/订阅相关）。\n\n"
                f"解决方法：\n"
                f"  1. 登录 {redact_url_for_log(provider.get('base_url')) if provider.get('base_url') else '上游平台'} 控制台，开通该模型 / 充值；\n"
                f"  2. 或在「API 设置」里把视频模型改成你账号已开通的型号（如 veo3-fast / veo2-fast / sora-2 等）。"
            )
            raise HTTPException(status_code=exc.response.status_code, detail=hint) from exc
        if "text.duration" in text or "specified duration is not supported" in text:
            hint = (
                f"上游「{provider_name}」模型「{requested_model}」不支持当前时长参数。\n\n"
                f"不同视频模型支持的时长不一样；如果选择了模型不支持的时长，上游可能报错，"
                f"也可能自动按平台默认时长生成，例如 5 秒。\n\n"
                f"请把视频时长切回该模型支持的值，或改用支持更长时长的视频模型。"
            )
            raise HTTPException(status_code=exc.response.status_code, detail=hint) from exc
        if "audio duration" in text.lower():
            too_long = "less than or equal" in text.lower() or "15.2" in text
            bound_hint = "太长（超过 15.2 秒）" if too_long else "太短（不足 1.8 秒）"
            hint = (
                f"上游「{provider_name}」模型「{requested_model}」拒绝了参考音频：时长{bound_hint}。\n\n"
                f"方舟 Seedance 的参考音频时长必须在 1.8 ~ 15.2 秒之间，"
                f"请把音频裁剪到这个区间后再作为参考音频输入。"
            )
            raise HTTPException(status_code=exc.response.status_code, detail=hint) from exc
        if "inputimagesensitivecontentdetected" in text.lower() or "privacyinformation" in text.lower() or "may contain real person" in text.lower():
            hint = (
                f"上游「{provider_name}」拦截了输入参考图，原因是图片里可能包含真人身份/隐私信息。\n\n"
                f"这不是代码协议错误，而是火山视频模型的内容安全策略。\n\n"
                f"建议你这样处理：\n"
                f"  1. 改用非真人参考图，例如插画、AI 头像、商品图、场景图；\n"
                f"  2. 先把真人脸做模糊、遮挡、裁掉，或转成明显的二次元/插画风；\n"
                f"  3. 如果只是想做文生视频，先去掉参考图只保留文字提示词测试。"
            )
            raise HTTPException(status_code=exc.response.status_code, detail=hint) from exc
        raise HTTPException(status_code=exc.response.status_code, detail=safe_upstream_http_detail(exc.response, "上游视频接口错误")) from exc
    except httpx.HTTPError as exc:
        log_net_error(f"视频 网络/TLS错误 provider={provider.get('id')} model={payload.model}", exc)
        raise HTTPException(status_code=502, detail=safe_upstream_transport_detail(exc, "请求上游视频接口失败")) from exc
