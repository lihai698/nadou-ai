"""即梦命令行执行、结果落盘与原任务查询恢复。

进程发现、环境、媒体与远端任务观察接口由应用注入；不在导入时启动进程。
"""
import asyncio
import os
import uuid
import re
import urllib.parse

async def run_jimeng_cli(args, timeout=120, raw_text=False, *, BASE_DIR, HTTPException, jimeng_cli_executable, jimeng_cli_missing_message, jimeng_command, jimeng_decode_cli_output, jimeng_extract_json, jimeng_friendly_error_detail, jimeng_has_result_payload, safe_cli_executable_name, safe_cli_public_text, write_diagnostic):
    exe = jimeng_cli_executable()
    if not exe:
        raise HTTPException(status_code=400, detail=jimeng_cli_missing_message())
    clean_args = [str(arg) for arg in args if str(arg) != ""]
    command = jimeng_command(clean_args, exe)
    try:
        proc = await asyncio.create_subprocess_exec(
            *command,
            cwd=BASE_DIR,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError as exc:
        raise HTTPException(status_code=504, detail="即梦 CLI 执行超时，请稍后重试。") from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=400, detail=f"未找到即梦 CLI：{safe_cli_executable_name(exe) or 'dreamina'}") from exc
    out_text, clean_err_text = jimeng_decode_cli_output(stdout, stderr)
    if proc.returncode != 0:
        # Some Dreamina CLI versions return a non-zero code after already emitting
        # a usable task payload. Preserve that task so the canvas can continue polling.
        if out_text:
            raw = jimeng_extract_json(out_text)
            if isinstance(raw, dict) and jimeng_has_result_payload(raw):
                raw.setdefault("_stdout", out_text)
                if clean_err_text:
                    raw.setdefault("_stderr", clean_err_text)
                return raw
        message = clean_err_text or out_text or f"exit={proc.returncode}"
        safe_message = safe_cli_public_text(jimeng_friendly_error_detail(message), 800)
        write_diagnostic(f"jimeng cli failed returncode={proc.returncode}")
        raise HTTPException(status_code=502, detail=f"即梦 CLI 调用失败：{safe_message}")
    # 帮助等纯文本输出不应被 JSON 提取吞掉（如 [0.5, 8] 会被误判为结果）
    if raw_text:
        return {"_stdout": out_text, "_stderr": clean_err_text}
    raw = jimeng_extract_json(f"{out_text}\n{clean_err_text}".strip())
    if isinstance(raw, dict):
        raw.setdefault("_stdout", out_text)
        if clean_err_text:
            raw.setdefault("_stderr", clean_err_text)
    return raw


async def jimeng_cli_version(*, HTTPException, jimeng_parse_version, run_jimeng_cli):
    for flag in ("--version", "-V", "version"):
        try:
            raw = await run_jimeng_cli([flag], timeout=15)
        except HTTPException:
            continue
        text = raw if isinstance(raw, str) else (raw.get("_stdout") or raw.get("_stderr") or "" if isinstance(raw, dict) else "")
        version = jimeng_parse_version(text)
        if version:
            return version, str(text).strip()
    return None, ""


def jimeng_command(clean_args, exe=None, *, jimeng_cli_executable, jimeng_use_wsl, jimeng_wsl_base_args, shlex):
    exe = exe or jimeng_cli_executable()
    if jimeng_use_wsl():
        shell_line = (
            ". ~/.profile >/dev/null 2>&1 || true; . ~/.bashrc >/dev/null 2>&1 || true; "
            "DREAMINA_BIN=$(command -v dreamina || find \"$HOME\" -maxdepth 4 -type f -name dreamina 2>/dev/null | head -n 1); "
            "if [ -z \"$DREAMINA_BIN\" ]; then echo 'dreamina CLI not found in WSL' >&2; exit 127; fi; "
            "\"$DREAMINA_BIN\" " + " ".join(shlex.quote(arg) for arg in clean_args)
        )
        return [exe, *jimeng_wsl_base_args(exe), "-e", "sh", "-lc", shell_line]
    return [exe, *clean_args]


def jimeng_local_output_url(path, kind='image', *, OUTPUT_OUTPUT_DIR, content_type_for_path, output_path_for, output_url_for, shutil):
    path = os.path.abspath(str(path or ""))
    if not os.path.isfile(path):
        return ""
    output_root = os.path.abspath(OUTPUT_OUTPUT_DIR)
    try:
        if os.path.commonpath([output_root, path]) == output_root:
            return output_url_for(os.path.basename(path), "output")
    except Exception:
        pass
    ext = os.path.splitext(path)[1].lower()
    allowed = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".mp4", ".webm", ".mov", ".m4v", ".avi", ".mkv"}
    if ext not in allowed:
        ct = content_type_for_path(path)
        ext = ".mp4" if ct.startswith("video/") else ".png"
    prefix = "jimeng_video_" if kind == "video" else "jimeng_"
    filename = f"{prefix}{uuid.uuid4().hex[:10]}{ext}"
    dest = output_path_for(filename, "output")
    shutil.copyfile(path, dest)
    return output_url_for(filename, "output")


async def jimeng_store_output_value(value, kind='image', *, jimeng_local_output_url, jimeng_use_wsl, save_ai_image_to_output, save_remote_video_to_output, wsl_path_to_windows):
    text = str(value or "").strip()
    if not text:
        return ""
    if text.startswith("/output/") or text.startswith("/assets/"):
        return text
    if text.startswith("file://"):
        text = urllib.parse.unquote(urllib.parse.urlparse(text).path)
        if os.name == "nt" and re.match(r"^/[A-Za-z]:/", text):
            text = text[1:]
    if jimeng_use_wsl() and text.startswith("/mnt/"):
        text = wsl_path_to_windows(text)
    if text.startswith(("http://", "https://")):
        if kind == "video":
            return await save_remote_video_to_output(text, prefix="jimeng_video_")
        return await save_ai_image_to_output({"type": "url", "value": text}, prefix="jimeng_")
    if os.path.isfile(text):
        return jimeng_local_output_url(text, kind)
    return ""


async def jimeng_query_result(submit_id, kind='image', *, OUTPUT_OUTPUT_DIR, jimeng_cli_path_arg, jimeng_poll_seconds, run_jimeng_cli):
    args = [
        "query_result",
        f"--submit_id={submit_id}",
        f"--download_dir={jimeng_cli_path_arg(OUTPUT_OUTPUT_DIR)}",
    ]
    return await run_jimeng_cli(args, timeout=min(300, jimeng_poll_seconds() + 60))


async def jimeng_store_outputs(raw, kind='image', allow_query=True, *, HTTPException, JimengPendingError, jimeng_failure_reason, jimeng_output_values, jimeng_query_result, jimeng_queue_info, jimeng_store_output_value, jimeng_store_outputs, jimeng_submit_id, provider_error_summary):
    failure = jimeng_failure_reason(raw)
    if failure:
        raise HTTPException(status_code=502, detail=f"即梦生成失败：{failure}")
    values = jimeng_output_values(raw)
    urls = []
    for value in values:
        local_url = await jimeng_store_output_value(value, kind)
        if local_url and local_url not in urls:
            urls.append(local_url)
    if urls:
        return urls
    submit_id = jimeng_submit_id(raw)
    if submit_id and allow_query:
        queried = await jimeng_query_result(submit_id, kind)
        try:
            return await jimeng_store_outputs(queried, kind, allow_query=False)
        except HTTPException as exc:
            if getattr(exc, "status_code", None) == 502:
                reason = jimeng_failure_reason(queried) or provider_error_summary(queried, fallback="未返回可用媒体")
                raise HTTPException(status_code=502, detail=f"即梦任务已返回但没有下载到媒体：{reason}") from exc
            raise
    if submit_id:
        raise JimengPendingError(submit_id, kind, jimeng_queue_info(raw), raw)
    reason = provider_error_summary(raw, fallback="请检查 CLI 登录状态及输出目录")
    raise HTTPException(status_code=502, detail=f"即梦 CLI 未返回可用媒体结果：{reason}")


async def jimeng_prepare_local_media(ref_url, kind='image', *, HTTPException, base64, httpx, mimetypes, output_file_from_url, tempfile):
    text = str(ref_url or "").strip()
    if not text:
        return "", []
    if text.startswith("/output/") or text.startswith("/assets/"):
        path = output_file_from_url(text)
        if path:
            return path, []
        raise HTTPException(status_code=404, detail="即梦参考素材不存在，请重新选择文件。")
    if text.startswith("file://"):
        path = urllib.parse.unquote(urllib.parse.urlparse(text).path)
        if os.name == "nt" and re.match(r"^/[A-Za-z]:/", path):
            path = path[1:]
        if os.path.isfile(path):
            return path, []
    if os.path.isfile(text):
        return text, []
    suffix = ".mp4" if kind == "video" else (".mp3" if kind == "audio" else ".png")
    temp_paths = []
    if text.startswith("data:"):
        if ";base64," not in text:
            raise HTTPException(status_code=400, detail="即梦参考素材 data URL 缺少 base64 数据")
        header, encoded = text.split(";base64,", 1)
        mime = header.split(":", 1)[1].split(";", 1)[0] if ":" in header else ""
        suffix = mimetypes.guess_extension(mime) or suffix
        fd, path = tempfile.mkstemp(prefix="jimeng_ref_", suffix=suffix)
        with os.fdopen(fd, "wb") as f:
            f.write(base64.b64decode(encoded))
        temp_paths.append(path)
        return path, temp_paths
    if text.startswith(("http://", "https://")):
        async with httpx.AsyncClient(timeout=httpx.Timeout(connect=20.0, read=300.0, write=60.0, pool=20.0), follow_redirects=True) as client:
            response = await client.get(text)
            response.raise_for_status()
            clean_path = urllib.parse.urlparse(text).path
            suffix = os.path.splitext(clean_path)[1] or mimetypes.guess_extension(response.headers.get("content-type", "")) or suffix
            fd, path = tempfile.mkstemp(prefix="jimeng_ref_", suffix=suffix)
            with os.fdopen(fd, "wb") as f:
                f.write(response.content)
            temp_paths.append(path)
            return path, temp_paths
    raise HTTPException(status_code=400, detail="即梦 CLI 只支持本地文件参考素材，请选择本地文件。")


async def generate_jimeng_provider_image(prompt, size, model, reference_images=None, provider=None, *, jimeng_cli_path_arg, jimeng_image_model_version, jimeng_image_resolution, jimeng_poll_seconds, jimeng_prepare_local_media, jimeng_ratio_from_size, jimeng_store_outputs, run_jimeng_cli):
    refs = [ref for ref in (reference_images or []) if ref.get("url")]
    temp_paths = []
    try:
        args = []
        if refs:
            image_paths = []
            for ref in refs[:10]:
                image_path, created = await jimeng_prepare_local_media(ref.get("url"), "image")
                image_paths.append(jimeng_cli_path_arg(image_path))
                temp_paths.extend(created)
            model_version = jimeng_image_model_version(model, "image2image")
            args = [
                "image2image",
                f"--images={','.join(image_paths)}",
                f"--prompt={prompt}",
                f"--resolution_type={jimeng_image_resolution(model, size, 'image2image')}",
                f"--poll={jimeng_poll_seconds()}",
            ]
            if model_version:
                args.append(f"--model_version={model_version}")
        else:
            model_version = jimeng_image_model_version(model, "text2image")
            args = [
                "text2image",
                f"--prompt={prompt}",
                f"--ratio={jimeng_ratio_from_size(size)}",
                f"--resolution_type={jimeng_image_resolution(model, size, 'text2image')}",
                f"--poll={jimeng_poll_seconds()}",
            ]
            if model_version:
                args.append(f"--model_version={model_version}")
        raw = await run_jimeng_cli(args, timeout=jimeng_poll_seconds() + 120)
        urls = await jimeng_store_outputs(raw, "image")
        return {"type": "url", "value": urls[0]}, raw
    finally:
        for path in temp_paths:
            try:
                os.remove(path)
            except Exception:
                pass


async def generate_jimeng_upscale_image(reference_images, resolution_type, *, HTTPException, jimeng_cli_path_arg, jimeng_normalize_upscale_resolution, jimeng_poll_seconds, jimeng_prepare_local_media, jimeng_store_outputs, run_jimeng_cli):
    refs = [ref for ref in (reference_images or []) if ref.get("url")]
    if not refs:
        raise HTTPException(status_code=400, detail="请先选择要放大的图片")
    temp_paths = []
    try:
        image_path, created = await jimeng_prepare_local_media(refs[0]["url"], "image")
        temp_paths.extend(created)
        raw = await run_jimeng_cli([
            "image_upscale",
            f"--image={jimeng_cli_path_arg(image_path)}",
            f"--resolution_type={jimeng_normalize_upscale_resolution(resolution_type)}",
            f"--poll={jimeng_poll_seconds()}",
        ], timeout=jimeng_poll_seconds() + 120)
        urls = await jimeng_store_outputs(raw, "image")
        return {"type": "url", "value": urls[0]}, raw
    finally:
        for path in temp_paths:
            try:
                os.remove(path)
            except Exception:
                pass


async def generate_jimeng_video(payload, provider, *, HTTPException, _notify_canvas_video_remote_accept, jimeng_append_model_resolution_args, jimeng_cli_path_arg, jimeng_multiframe_resolution, jimeng_multiframe_transition_prompts, jimeng_poll_seconds, jimeng_prepare_local_media, jimeng_store_outputs, jimeng_submit_id, jimeng_transition_duration, jimeng_video_duration, jimeng_video_model_for_command, jimeng_video_ratio, jimeng_video_ref_role, jimeng_video_ref_url, jimeng_video_submit_poll_seconds, run_jimeng_cli):
    image_refs = [ref for ref in (payload.images or []) if jimeng_video_ref_url(ref)]
    video_refs = [url for url in (payload.videos or []) if str(url or "").strip()]
    audio_refs = [url for url in (payload.audios or []) if str(url or "").strip()][:3]
    temp_paths = []
    try:
        if payload.multimodal or video_refs or audio_refs:
            if not image_refs and not video_refs:
                raise HTTPException(status_code=400, detail="即梦全能参考至少需要一张图片或一个视频，音频不能单独生成视频。")
            model_version = jimeng_video_model_for_command(payload.model, "multimodal2video")
            duration = jimeng_video_duration(payload.duration, model_version, "multimodal2video")
            image_paths = []
            video_paths = []
            audio_paths = []
            for ref in image_refs[:9]:
                image_path, created = await jimeng_prepare_local_media(jimeng_video_ref_url(ref), "image")
                temp_paths.extend(created)
                image_paths.append(image_path)
            for ref_url in video_refs[:3]:
                video_path, created = await jimeng_prepare_local_media(ref_url, "video")
                temp_paths.extend(created)
                video_paths.append(video_path)
            for ref_url in audio_refs:
                audio_path, created = await jimeng_prepare_local_media(ref_url, "audio")
                temp_paths.extend(created)
                audio_paths.append(audio_path)
            args = [
                "multimodal2video",
                f"--prompt={payload.prompt}",
                f"--duration={duration}",
                f"--poll={jimeng_poll_seconds()}",
            ]
            args.append(f"--ratio={jimeng_video_ratio(payload.aspect_ratio)}")
            jimeng_append_model_resolution_args(args, payload, model_version)
            for image_path in image_paths:
                args.append(f"--image={jimeng_cli_path_arg(image_path)}")
            for video_path in video_paths:
                args.append(f"--video={jimeng_cli_path_arg(video_path)}")
            for audio_path in audio_paths:
                args.append(f"--audio={jimeng_cli_path_arg(audio_path)}")
        elif len(image_refs) >= 2:
            if len(image_refs) > 20:
                raise HTTPException(status_code=400, detail="即梦多帧视频最多支持 20 张图片。")
            first_frame = next((ref for ref in image_refs if jimeng_video_ref_role(ref) == "first_frame"), None)
            last_frame = next((ref for ref in image_refs if jimeng_video_ref_role(ref) == "last_frame"), None)
            if first_frame and last_frame:
                model_version = jimeng_video_model_for_command(payload.model, "frames2video")
                duration = jimeng_video_duration(payload.duration, model_version, "frames2video")
                first_path, created = await jimeng_prepare_local_media(jimeng_video_ref_url(first_frame), "image")
                temp_paths.extend(created)
                last_path, created = await jimeng_prepare_local_media(jimeng_video_ref_url(last_frame), "image")
                temp_paths.extend(created)
                args = [
                    "frames2video",
                    f"--first={jimeng_cli_path_arg(first_path)}",
                    f"--last={jimeng_cli_path_arg(last_path)}",
                    f"--prompt={payload.prompt}",
                    f"--duration={duration}",
                    f"--poll={jimeng_poll_seconds()}",
                ]
                jimeng_append_model_resolution_args(args, payload, model_version)
            else:
                image_paths = []
                for ref in image_refs:
                    image_path, created = await jimeng_prepare_local_media(jimeng_video_ref_url(ref), "image")
                    temp_paths.extend(created)
                    image_paths.append(image_path)
                args = [
                    "multiframe2video",
                    f"--images={','.join(jimeng_cli_path_arg(path) for path in image_paths)}",
                    f"--poll={jimeng_poll_seconds()}",
                ]
                # multiframe2video has its own transition arguments and does not
                # accept model_version. The CLI requires an explicit resolution.
                args.append(f"--video_resolution={jimeng_multiframe_resolution(payload.resolution)}")
                segments = max(1, len(image_paths) - 1)
                segment_duration = jimeng_transition_duration(payload.duration, segments)
                if len(image_paths) <= 2:
                    if str(payload.prompt or "").strip():
                        args.append(f"--prompt={payload.prompt}")
                    args.append(f"--duration={segment_duration}")
                else:
                    for segment_prompt in jimeng_multiframe_transition_prompts(payload.prompt, segments):
                        args.append(f"--transition-prompt={segment_prompt}")
                    for _ in range(segments):
                        args.append(f"--transition-duration={segment_duration}")
        elif image_refs:
            model_version = jimeng_video_model_for_command(payload.model, "image2video")
            duration = jimeng_video_duration(payload.duration, model_version, "image2video")
            image_path, created = await jimeng_prepare_local_media(jimeng_video_ref_url(image_refs[0]), "image")
            temp_paths.extend(created)
            args = [
                "image2video",
                f"--image={jimeng_cli_path_arg(image_path)}",
                f"--prompt={payload.prompt}",
                f"--duration={duration}",
                f"--poll={jimeng_poll_seconds()}",
            ]
            jimeng_append_model_resolution_args(args, payload, model_version)
        else:
            model_version = jimeng_video_model_for_command(payload.model, "text2video")
            duration = jimeng_video_duration(payload.duration, model_version, "text2video")
            args = [
                "text2video",
                f"--prompt={payload.prompt}",
                f"--duration={duration}",
                f"--ratio={jimeng_video_ratio(payload.aspect_ratio)}",
                f"--poll={jimeng_poll_seconds()}",
            ]
            jimeng_append_model_resolution_args(args, payload, model_version)
        # Do not hold the canvas request open for the full cloud generation.
        # A pending result carries submit_id and is resumed by the existing UI poller.
        submit_poll = jimeng_video_submit_poll_seconds()
        args = [f"--poll={submit_poll}" if str(arg).startswith("--poll=") else arg for arg in args]
        raw = await run_jimeng_cli(args, timeout=submit_poll + 180)
        # CLI 可能只返回已受理的 submit_id，随后由 query_result 继续等待。
        # 持久视频任务必须先把这个编号写入本地记录，避免查询阶段断线后
        # 只能重新提交并产生重复计费。同步 /api/canvas-video 调用下该通知
        # 没有回调，因此保持为空操作。
        submit_id = jimeng_submit_id(raw)
        if submit_id:
            await _notify_canvas_video_remote_accept(
                submit_id,
                query_mode="jimeng_cli",
            )
        urls = await jimeng_store_outputs(raw, "video")
        return {"videos": urls, "task_id": submit_id or None, "raw": raw}
    finally:
        for path in temp_paths:
            try:
                os.remove(path)
            except Exception:
                pass


async def query_jimeng_video_task_once(remote_task_id, kind='video', *, HTTPException, JimengPendingError, jimeng_failure_reason, jimeng_has_explicit_failure, jimeng_query_result, jimeng_store_outputs, observe_remote_task, public_error_detail):
    """通过即梦 CLI 对已有 submit_id 查询一次，不重新提交任务。

    ``query_result`` 的输出仍由现有 ``jimeng_store_outputs`` 负责解析和落盘，
    这里只把结果转换成统一的远端观察状态，供持久视频任务刷新入口复用。
    CLI、登录状态或本地输出目录异常都只能得到 ``unknown``，保留编号等待
    后续人工/再次查询；只有即梦明确返回失败状态时才确认 ``failed``。
    """

    remote_id = str(remote_task_id or "").strip()
    if (
        not remote_id
        or len(remote_id) > 240
        or any(ord(char) < 0x20 for char in remote_id)
        or any(char in remote_id for char in "?#")
    ):
        raise HTTPException(status_code=400, detail="远端视频任务编号无效")
    query_kind = str(kind or "video").strip().lower()
    if query_kind not in {"image", "video", "audio"}:
        query_kind = "video"

    try:
        raw = await jimeng_query_result(remote_id, query_kind)
    except HTTPException as exc:
        # run_jimeng_cli 的启动、登录和超时错误没有明确远端终态。
        detail = public_error_detail(
            getattr(exc, "detail", "") or exc,
            fallback="即梦任务查询失败",
            limit=600,
        )
        return (
            observe_remote_task(
                {
                    "status": "UNKNOWN",
                    "task_id": remote_id,
                    "error": detail,
                },
                operation="query",
            ),
            [],
        )
    except (OSError, ValueError, TypeError) as exc:
        return (
            observe_remote_task(
                {
                    "status": "UNKNOWN",
                    "task_id": remote_id,
                    "error": f"即梦任务查询失败：{type(exc).__name__}",
                },
                operation="query",
            ),
            [],
        )

    if not isinstance(raw, (dict, list)):
        return (
            observe_remote_task(
                {
                    "status": "UNKNOWN",
                    "task_id": remote_id,
                    "error": "即梦任务查询返回格式无效",
                },
                operation="query",
            ),
            [],
        )

    failure = jimeng_failure_reason(raw)
    if failure or jimeng_has_explicit_failure(raw):
        return (
            observe_remote_task(
                {
                    "status": "FAILED",
                    "task_id": remote_id,
                    "error": failure or "即梦任务失败",
                },
                operation="query",
            ),
            [],
        )

    try:
        local_urls = await jimeng_store_outputs(raw, query_kind, allow_query=False)
    except JimengPendingError:
        return (
            observe_remote_task(
                {"status": "PENDING", "task_id": remote_id},
                operation="query",
            ),
            [],
        )
    except HTTPException:
        # 没有媒体但也没有明确失败状态，不能把 CLI/下载异常误报成远端失败。
        return (
            observe_remote_task(
                {
                    "status": "UNKNOWN",
                    "task_id": remote_id,
                    "error": "即梦任务查询未返回可用媒体",
                },
                operation="query",
            ),
            [],
        )
    except (OSError, ValueError, TypeError):
        return (
            observe_remote_task(
                {
                    "status": "UNKNOWN",
                    "task_id": remote_id,
                    "error": "即梦任务输出保存失败",
                },
                operation="query",
            ),
            [],
        )

    urls = [
        str(value).strip()
        for value in (local_urls or [])
        if str(value or "").strip().startswith(("/output/", "/assets/"))
    ][:16]
    if not urls:
        return (
            observe_remote_task(
                {
                    "status": "UNKNOWN",
                    "task_id": remote_id,
                    "error": "即梦任务查询未返回可用媒体",
                },
                operation="query",
            ),
            [],
        )
    return (
        observe_remote_task(
            {"status": "COMPLETED", "task_id": remote_id, "videos": urls},
            operation="query",
        ),
        urls,
    )


def jimeng_use_wsl(*, jimeng_env_value):
    value = str(jimeng_env_value("JIMENG_USE_WSL") or "").strip().lower()
    return value in {"1", "true", "yes", "on", "wsl"}


def jimeng_cli_executable(*, jimeng_env_value, jimeng_use_wsl, shutil):
    if jimeng_use_wsl():
        return shutil.which("wsl.exe") or shutil.which("wsl") or "wsl.exe"
    configured = str(
        jimeng_env_value("JIMENG_BIN")
        or jimeng_env_value("DREAMINA_BIN")
        or ""
    ).strip()
    if configured:
        return configured
    return shutil.which("dreamina") or shutil.which("dreamina.exe") or shutil.which("dreamina.cmd") or ""


def jimeng_cli_missing_message(*, BASE_DIR, decode_wsl_output, os, re, shutil, subprocess):
    """给 Windows 用户说明即梦 CLI 缺失时真正需要补齐的运行环境。"""
    if os.name == "nt":
        wsl = shutil.which("wsl.exe") or shutil.which("wsl")
        if wsl:
            try:
                proc = subprocess.run(
                    [wsl, "-l", "-q"],
                    cwd=BASE_DIR,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.DEVNULL,
                    timeout=5,
                    check=False,
                )
                names = [
                    line.replace("\x00", "").strip().lstrip("*").strip()
                    for line in decode_wsl_output(proc.stdout).splitlines()
                    if line.replace("\x00", "").strip()
                ]
                if not any(re.match(r"^Ubuntu($|-)", name) for name in names):
                    return "未找到 dreamina CLI。Windows 版需要先安装并初始化 WSL Ubuntu，再运行即梦 CLI 安装脚本。"
            except Exception:
                pass
    return "未找到 dreamina CLI。请先安装即梦 CLI，并完成 dreamina login。"


def jimeng_wsl_base_args(exe='wsl.exe', *, BASE_DIR, decode_wsl_output, jimeng_env_value, re, subprocess, write_diagnostic):
    configured = str(jimeng_env_value("JIMENG_WSL_DISTRO") or "").strip()
    names = []
    try:
        proc = subprocess.run(
            [exe, "-l", "-q"],
            cwd=BASE_DIR,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=5,
            check=False,
        )
        names = [
            line.replace("\x00", "").strip().lstrip("*").strip()
            for line in decode_wsl_output(proc.stdout).splitlines()
            if line.replace("\x00", "").strip()
        ]
    except Exception:
        names = []
    if configured and (not names or configured in names):
        return ["-d", configured]
    if configured and names:
        # 发行版名称来自本机配置/WSL，不能把配置值和完整清单直接写到 stdout。
        # 只保留是否配置及候选数量，便于定位回退原因；实际选择仍按原规则执行。
        write_diagnostic(
            "jimeng wsl distro unavailable; fallback=auto "
            f"configured_present={bool(configured)} available_count={len(names)}"
        )
    try:
        ubuntu = next((name for name in names if re.match(r"^Ubuntu($|-)", name)), "")
        if ubuntu:
            return ["-d", ubuntu]
    except Exception:
        pass
    return []


def jimeng_poll_seconds(default=None, *, os):
    try:
        return max(1, min(3600, int(os.getenv("JIMENG_POLL_SECONDS", str(default)) or default)))
    except Exception:
        return default


def jimeng_video_submit_poll_seconds(*, os):
    """Keep the HTTP submission short; pending jobs continue through query_result polling."""
    try:
        return max(0, min(30, int(os.getenv("JIMENG_VIDEO_SUBMIT_POLL", "12") or 12)))
    except Exception:
        return 12


def jimeng_login_text(*, JIMENG_LOGIN_SESSION):
    parts = []
    for key in ("stdout", "stderr"):
        value = str(JIMENG_LOGIN_SESSION.get(key) or "").strip()
        if value:
            parts.append(value)
    return "\n".join(parts).strip()


def jimeng_login_qr_from_text(text, *, re):
    text = str(text or "")
    candidates = []
    patterns = [
        r"(https?://[^\s\"'<>]+)",
        r"(dreamina://[^\s\"'<>]+)",
        r"(data:image/[^\s\"'<>]+)",
    ]
    for pattern in patterns:
        candidates.extend(re.findall(pattern, text))
    for value in candidates:
        if "login" in value.lower() or "qr" in value.lower() or value.startswith(("data:image", "dreamina://")):
            return value
    return candidates[0] if candidates else ""


async def jimeng_login_reader(proc, *, JIMENG_LOGIN_SESSION, asyncio, decode_wsl_output, jimeng_clean_wsl_stderr, jimeng_use_wsl):
    async def read_stream(stream, key):
        while True:
            chunk = await stream.readline()
            if not chunk:
                break
            text = (decode_wsl_output(chunk) if jimeng_use_wsl() else chunk.decode("utf-8", errors="replace"))
            if key == "stderr":
                text = jimeng_clean_wsl_stderr(text)
            if text:
                JIMENG_LOGIN_SESSION[key] = str(JIMENG_LOGIN_SESSION.get(key) or "") + text
    await asyncio.gather(read_stream(proc.stdout, "stdout"), read_stream(proc.stderr, "stderr"))


async def jimeng_status(*, HTTPException, JIMENG_MIN_CLI_VERSION, jimeng_cli_executable, jimeng_cli_missing_message, jimeng_cli_version, public_error_detail, public_jimeng_credit, run_jimeng_cli):
    exe = jimeng_cli_executable()
    if not exe:
        return {"installed": False, "logged_in": False, "message": jimeng_cli_missing_message()}
    version, version_text = await jimeng_cli_version()
    version_str = ".".join(str(part) for part in version) if version else None
    version_ok = version >= JIMENG_MIN_CLI_VERSION if version else None
    min_version_str = ".".join(str(part) for part in JIMENG_MIN_CLI_VERSION)
    try:
        raw = await run_jimeng_cli(["user_credit"], timeout=30)
        return {
            "installed": True,
            "logged_in": True,
            "credit": public_jimeng_credit(raw),
            "cli_version": version_str,
            "version_ok": version_ok,
            "min_version": min_version_str,
        }
    except HTTPException as exc:
        return {
            "installed": True,
            "logged_in": False,
            "message": public_error_detail(exc.detail, fallback="即梦 CLI 登录状态不可用"),
            "cli_version": version_str,
            "version_ok": version_ok,
            "min_version": min_version_str,
        }


async def jimeng_credit(*, public_jimeng_credit, run_jimeng_cli):
    raw = await run_jimeng_cli(["user_credit"], timeout=30)
    return {"success": True, "credit": public_jimeng_credit(raw)}


async def jimeng_logout(*, run_jimeng_cli, safe_cli_public_text):
    raw = await run_jimeng_cli(["logout"], timeout=30)
    text = raw if isinstance(raw, str) else ""
    if isinstance(raw, dict):
        text = raw.get("_stdout") or raw.get("_stderr") or raw.get("message") or ""
    return {"success": True, "message": safe_cli_public_text(text, 800)}


async def jimeng_login_start(*, BASE_DIR, HTTPException, JIMENG_LOGIN_SESSION, asyncio, jimeng_cli_executable, jimeng_command, jimeng_login_qr_from_text, jimeng_login_reader, jimeng_login_text, safe_cli_public_text, time):
    old_proc = JIMENG_LOGIN_SESSION.get("proc")
    if old_proc and getattr(old_proc, "returncode", None) is None:
        try:
            old_proc.terminate()
        except Exception:
            pass
    exe = jimeng_cli_executable()
    if not exe:
        raise HTTPException(status_code=400, detail="未找到 dreamina CLI")
    JIMENG_LOGIN_SESSION.update({"proc": None, "stdout": "", "stderr": "", "started_at": time.time()})
    args = ["login", "--headless"]
    command = jimeng_command(args, exe)
    try:
        proc = await asyncio.create_subprocess_exec(
            *command,
            cwd=BASE_DIR,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=400, detail=f"未找到即梦 CLI：{exe}") from exc
    JIMENG_LOGIN_SESSION["proc"] = proc
    asyncio.create_task(jimeng_login_reader(proc))
    await asyncio.sleep(2)
    text = jimeng_login_text()
    qr_url = jimeng_login_qr_from_text(text)
    if proc.returncode not in (None, 0) and ("unknown" in text.lower() or "no such option" in text.lower()):
        # 旧版 CLI 可能没有 --headless，退回 debug 输出。
        JIMENG_LOGIN_SESSION.update({"proc": None, "stdout": "", "stderr": "", "started_at": time.time()})
        proc = await asyncio.create_subprocess_exec(
            *jimeng_command(["login", "--debug"], exe),
            cwd=BASE_DIR,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        JIMENG_LOGIN_SESSION["proc"] = proc
        asyncio.create_task(jimeng_login_reader(proc))
        await asyncio.sleep(2)
        text = jimeng_login_text()
        qr_url = jimeng_login_qr_from_text(text)
    return {
        "success": True,
        "running": JIMENG_LOGIN_SESSION.get("proc") is not None and JIMENG_LOGIN_SESSION["proc"].returncode is None,
        "text": safe_cli_public_text(text),
        # 二维码 URL 是扫码登录所必需的短期授权地址，保留原值供 <img> 使用；
        # 同一 URL 在 text 字段中已脱敏，避免重复展示查询令牌。
        "qr_url": qr_url,
        "started_at": JIMENG_LOGIN_SESSION.get("started_at") or 0,
    }


async def jimeng_login_status(*, HTTPException, JIMENG_LOGIN_SESSION, jimeng_login_qr_from_text, jimeng_login_text, public_jimeng_credit, run_jimeng_cli, safe_cli_public_text):
    proc = JIMENG_LOGIN_SESSION.get("proc")
    text = jimeng_login_text()
    running = proc is not None and getattr(proc, "returncode", None) is None
    logged_in = False
    credit_raw = None
    if not running:
        try:
            credit_raw = await run_jimeng_cli(["user_credit"], timeout=20)
            logged_in = True
        except HTTPException:
            logged_in = False
    return {
        "success": True,
        "running": running,
        "logged_in": logged_in,
        "text": safe_cli_public_text(text),
        "qr_url": jimeng_login_qr_from_text(text),
        "credit": public_jimeng_credit(credit_raw),
    }


async def jimeng_help(payload, *, HTTPException, run_jimeng_cli, safe_cli_public_text):
    command = str(payload.command or "").strip()
    allowed = {"", "login", "logout", "user_credit", "text2image", "image2image", "image_upscale", "text2video", "image2video", "multimodal2video", "frames2video", "multiframe2video", "list_task", "query_result"}
    if command not in allowed:
        raise HTTPException(status_code=400, detail="不支持的帮助命令")
    args = [command, "-h"] if command else ["-h"]
    raw = await run_jimeng_cli(args, timeout=30, raw_text=True)
    text = raw.get("_stdout") or ""
    if raw.get("_stderr"):
        text = f"{text}\n{raw.get('_stderr')}".strip()
    return {"success": True, "command": command, "text": safe_cli_public_text(text)}


async def jimeng_query_media(payload, *, HTTPException, JimengPendingError, jimeng_pending_payload, jimeng_public_queue_info, jimeng_query_result, jimeng_store_outputs, public_error_detail):
    """按 submit_id 续查即梦任务：出图返回 succeeded+urls；仍排队返回 pending+queue_info；失败返回 failed。
    供画布「排队中」卡片自动轮询与手动查询复用。"""
    submit_id = str(payload.submit_id or "").strip()
    if not submit_id:
        raise HTTPException(status_code=400, detail="缺少 submit_id")
    kind = str(payload.kind or "image").strip().lower()
    if kind not in ("image", "video", "audio"):
        kind = "image"
    queried = await jimeng_query_result(submit_id, kind)
    try:
        urls = await jimeng_store_outputs(queried, kind, allow_query=False)
        return {"status": "succeeded", "submit_id": submit_id, "kind": kind, "urls": urls}
    except JimengPendingError as exc:
        return {"status": "pending", "submit_id": submit_id, "kind": kind, "queue_info": jimeng_public_queue_info(exc.queue_info), "message": jimeng_pending_payload(exc)["message"]}
    except HTTPException as exc:
        return {
            "status": "failed",
            "submit_id": submit_id,
            "kind": kind,
            "error": public_error_detail(getattr(exc, "detail", "") or exc, fallback="即梦任务失败"),
        }


