"""Codex CLI 和图片工具执行适配。

应用注入执行文件、凭据读取回调和媒体接口；模块导入不访问这些资源。
"""
import asyncio
import os
import uuid
import re
import json
import urllib.parse

def codex_timeout(default):
    try:
        return max(30, min(3600, int(os.getenv("CODEX_CLI_TIMEOUT", str(default)) or default)))
    except Exception:
        return default


def codex_model_for_exec(model='', fallback=''):
    value = str(model or fallback or "").strip()
    low = value.lower()
    if not value or low.startswith("$imagegen") or low.startswith("gpt-image"):
        return ""
    return value


def codex_decode_output(stdout, stderr):
    out_text = (stdout or b"").decode("utf-8", errors="replace").strip()
    err_text = (stderr or b"").decode("utf-8", errors="replace").strip()
    return out_text, err_text


async def run_codex_cli(prompt, model='', image_paths=None, timeout=None, output_last_message=True, *, BASE_DIR, HTTPException, OUTPUT_OUTPUT_DIR, codex_cli_executable, codex_decode_output, codex_model_for_exec, codex_timeout, safe_cli_executable_name, safe_cli_public_text, tempfile, write_diagnostic):
    exe = codex_cli_executable()
    if not exe:
        raise HTTPException(status_code=400, detail="未找到 OpenAI Codex CLI。请先运行 CLI/windows/openai/install_openai_codex_cli.bat，并完成 codex 登录。")
    image_paths = [str(path) for path in (image_paths or []) if path and os.path.isfile(str(path))]
    last_path = ""
    args = [
        exe,
        "exec",
        "--cd",
        BASE_DIR,
        "--sandbox",
        "workspace-write",
        "--skip-git-repo-check",
    ]
    exec_model = codex_model_for_exec(model)
    if exec_model:
        args.extend(["--model", exec_model])
    for path in image_paths:
        args.extend(["--image", path])
    if output_last_message:
        fd, last_path = tempfile.mkstemp(prefix="codex_last_", suffix=".txt", dir=OUTPUT_OUTPUT_DIR)
        os.close(fd)
        args.extend(["--output-last-message", last_path])
    args.append("-")
    prompt_bytes = str(prompt or "").encode("utf-8")
    try:
        proc = await asyncio.create_subprocess_exec(
            *args,
            cwd=BASE_DIR,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(input=prompt_bytes), timeout=timeout or codex_timeout())
    except asyncio.TimeoutError as exc:
        raise HTTPException(status_code=504, detail="OpenAI Codex CLI 执行超时。可设置 CODEX_CLI_TIMEOUT 增大等待时间。") from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=400, detail=f"未找到 OpenAI Codex CLI：{safe_cli_executable_name(exe) or 'codex'}") from exc
    out_text, err_text = codex_decode_output(stdout, stderr)
    last_text = ""
    if last_path and os.path.exists(last_path):
        try:
            with open(last_path, "r", encoding="utf-8-sig") as f:
                last_text = f.read().strip()
        except Exception:
            last_text = ""
        try:
            os.remove(last_path)
        except Exception:
            pass
    if proc.returncode != 0:
        message = err_text or out_text or last_text or f"exit={proc.returncode}"
        safe_message = safe_cli_public_text(message, 800)
        write_diagnostic(f"codex cli failed returncode={proc.returncode}")
        raise HTTPException(status_code=502, detail=f"OpenAI Codex CLI 调用失败：{safe_message}")
    return {"text": last_text or out_text, "_stdout": out_text, "_stderr": err_text}


def codex_output_image_files(since_time=0, *, OUTPUT_OUTPUT_DIR):
    exts = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
    root = os.path.abspath(OUTPUT_OUTPUT_DIR)
    files = []
    try:
        for name in os.listdir(root):
            path = os.path.join(root, name)
            if not os.path.isfile(path):
                continue
            ext = os.path.splitext(name)[1].lower()
            if ext not in exts:
                continue
            mtime = os.path.getmtime(path)
            if mtime + 1 < float(since_time or 0):
                continue
            files.append((mtime, path))
    except Exception:
        return []
    return [path for _mtime, path in sorted(files, reverse=True)]


def codex_output_url_from_path(path, *, OUTPUT_OUTPUT_DIR, output_url_for):
    path = os.path.abspath(str(path or ""))
    root = os.path.abspath(OUTPUT_OUTPUT_DIR)
    try:
        if os.path.commonpath([root, path]) == root:
            return output_url_for(os.path.basename(path), "output")
    except Exception:
        return ""
    return ""


def gpt_image_2_skill_provider_args(auth_file='', *, gpt_image_2_skill_access_token, gpt_image_2_skill_api_key, gpt_image_2_skill_auth_json):
    auth_data = gpt_image_2_skill_auth_json(auth_file)
    if gpt_image_2_skill_access_token(auth_data):
        return ["--provider", "codex", "--auth-file", auth_file] if auth_file else ["--provider", "codex"], "codex"
    api_key = gpt_image_2_skill_api_key(auth_data)
    if api_key:
        return ["--provider", "openai", "--api-key", api_key], "openai"
    return (["--provider", "codex", "--auth-file", auth_file] if auth_file else ["--provider", "codex"]), "codex"


def gpt_image_2_skill_model_arg(model='', provider='openai', fallback_model='', *, CODEX_DEFAULT_CHAT_MODELS):
    value = str(model or "").strip()
    low = value.lower()
    provider = str(provider or "").strip().lower()
    if provider == "codex":
        if not value or low.startswith("$imagegen") or low.startswith("gpt-image"):
            return fallback_model or CODEX_DEFAULT_CHAT_MODELS[0]
        return value
    if not value or low.startswith("$imagegen"):
        return "gpt-image-2"
    return value


def gpt_image_2_skill_size_arg(size='', model='', prompt='', provider='openai', *, CHAT_RATIO_SIZE_OPTIONS, normalize_gpt_image_2_size):
    text = " ".join([str(size or ""), str(model or ""), str(prompt or "")]).lower()
    size_text = str(size or "").strip()
    # Both helper providers accept explicit pixels, auto, 2K and 4K; 1K is not a CLI preset.
    presets = {"auto": "auto", "1k": "1024x1024", "2k": "2K", "4k": "4K"}
    if size_text.lower() in presets:
        return presets[size_text.lower()]
    match = re.search(r"(\d{3,5})\s*[x×*]\s*(\d{3,5})", size_text, flags=re.I)
    if match:
        width = int(match.group(1))
        height = int(match.group(2))
        if width > 0 and height > 0:
            return normalize_gpt_image_2_size(f"{width}x{height}")
    ratio_match = re.fullmatch(r"\s*(\d{1,2})\s*:\s*(\d{1,2})\s*", size_text)
    if ratio_match:
        ratio = f"{int(ratio_match.group(1))}:{int(ratio_match.group(2))}"
        options = CHAT_RATIO_SIZE_OPTIONS.get(ratio)
        if options:
            if "4k" in text or "3840" in text:
                return options[-1]
            if "1k" in text or "1024" in text:
                return options[0]
            return options[1] if len(options) > 1 else options[0]
    if "4k" in text or "3840" in text:
        return "4K"
    if "1k" in text or "1024" in text:
        return "1024x1024"
    if not size_text and str(provider or "").strip().lower() == "codex" and "2k" not in text:
        return "auto"
    return "2K"


def gpt_image_2_skill_prompt_arg(prompt='', size='', provider='openai', *, gpt_image_2_skill_size_arg, math, parse_size_pair):
    prompt_text = str(prompt or "").strip()
    if str(provider or "").strip().lower() != "codex":
        return prompt_text
    size_arg = gpt_image_2_skill_size_arg(size, "", prompt, provider)
    size_text = str(size or "").strip()
    width, height = parse_size_pair(size_text)
    ratio_text = ""
    if width and height:
        divisor = math.gcd(width, height) or 1
        ratio_text = f"{width // divisor}:{height // divisor}"
    else:
        ratio_match = re.fullmatch(r"\s*(\d{1,2})\s*:\s*(\d{1,2})\s*", size_text)
        if ratio_match:
            width = int(ratio_match.group(1))
            height = int(ratio_match.group(2))
            ratio_text = f"{width}:{height}"
    if not ratio_text:
        return f"{prompt_text} 画质要求：目标输出 {size_arg} 高分辨率图片。 Image quality requirement: output a {size_arg} high-resolution image."
    orientation_zh = "横版/宽幅" if width > height else ("竖版/长幅" if height > width else "正方形")
    orientation_en = "landscape/wide" if width > height else ("portrait/tall" if height > width else "square")
    return (
        f"{prompt_text} "
        f"画质要求：目标输出 {size_arg} 高分辨率图片。"
        f"画幅要求：必须生成 {orientation_zh} 图片，宽高比 {ratio_text}。"
        f"请不要交换宽高，不要输出反向比例。"
        f" Image quality requirement: output a {size_arg} high-resolution image."
        f" Canvas requirement: generate a {orientation_en} image with aspect ratio {ratio_text}; "
        "do not swap width and height."
    )


def parse_gpt_image_2_skill_output(stdout_text='', stderr_text=''):
    items = []
    for line in (stdout_text or "").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            items.append(json.loads(line))
        except Exception:
            continue
    if not items and stdout_text:
        try:
            parsed = json.loads(stdout_text)
            items = parsed if isinstance(parsed, list) else [parsed]
        except Exception:
            pass
    paths = []
    for item in items:
        if not isinstance(item, dict):
            continue
        candidates = [
            item.get("path"),
            item.get("file"),
            item.get("output"),
            item.get("out"),
            item.get("url"),
        ]
        for image in item.get("images") or []:
            if isinstance(image, dict):
                candidates.extend([image.get("path"), image.get("file"), image.get("url")])
            else:
                candidates.append(image)
        for candidate in candidates:
            value = str(candidate or "").strip()
            if value:
                paths.append(value)
    text = stdout_text or stderr_text or ""
    pattern = r"([A-Za-z]:\\[^\r\n\"'<>]+\.(?:png|jpe?g|webp|gif)|/[^\r\n\"'<>]+\.(?:png|jpe?g|webp|gif))"
    paths.extend(re.findall(pattern, text, flags=re.I))
    return items, paths


def gpt_image_2_skill_failure_message(stdout_text='', stderr_text='', returncode=0):
    combined = "\n".join([str(stdout_text or "").strip(), str(stderr_text or "").strip()]).strip()
    if not combined:
        return f"exit={returncode}"
    objects = []
    plain_lines = []
    for line in combined.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            objects.append(json.loads(line))
        except Exception:
            plain_lines.append(line)
    if not objects:
        try:
            parsed = json.loads(combined)
            objects = parsed if isinstance(parsed, list) else [parsed]
            plain_lines = []
        except Exception:
            pass
    messages = []
    progress = []
    for item in objects:
        if not isinstance(item, dict):
            continue
        error = item.get("error")
        if isinstance(error, dict):
            msg = error.get("message") or error.get("detail") or error.get("code")
            if msg:
                messages.append(str(msg))
            detail = error.get("detail")
            if detail and str(detail) != str(msg):
                messages.append(str(detail))
        elif isinstance(error, str) and error.strip():
            messages.append(error.strip())
        if item.get("ok") is False:
            msg = item.get("message") or item.get("detail")
            if msg:
                messages.append(str(msg))
        data = item.get("data")
        if isinstance(data, dict):
            msg = data.get("error") or data.get("message") or data.get("status")
            event_type = str(item.get("type") or data.get("phase") or "").strip()
            if msg and event_type not in {"request.started", "request_started"}:
                progress.append(f"{event_type}: {msg}" if event_type else str(msg))
    if messages:
        return "；".join(dict.fromkeys(messages))[:1600]
    if plain_lines:
        return "\n".join(plain_lines)[:1600]
    if progress:
        return ("只收到了进度事件，没有收到最终错误详情：" + "；".join(dict.fromkeys(progress)))[:1600]
    return combined[:1600]


def codex_postprocess_image_to_requested_size(path='', requested_size='', provider='', *, Image, ImageOps, parse_size_pair, write_diagnostic):
    provider_text = str(provider or "").strip().lower()
    if provider_text not in {"codex", "gemini-cli"}:
        return ""
    width, height = parse_size_pair(requested_size)
    if not width or not height or not path or not os.path.isfile(path):
        return ""
    try:
        with Image.open(path) as img:
            img.load()
            if img.width == width and img.height == height:
                return ""
            resample = getattr(Image, "Resampling", Image).LANCZOS
            oriented = ImageOps.exif_transpose(img)
            converted = oriented.convert("RGBA") if oriented.mode in ("RGBA", "LA", "P") else oriented.convert("RGB")
            resized = ImageOps.fit(converted, (width, height), method=resample, centering=(0.5, 0.5))
            base, _ext = os.path.splitext(path)
            upscaled_path = f"{base}_upscaled_{width}x{height}.png"
            resized.save(upscaled_path, format="PNG")
            return upscaled_path
    except Exception as exc:
        label = "Gemini CLI" if provider_text == "gemini-cli" else "Codex GPT Image 2"
        write_diagnostic(f"image resize postprocess failed provider={provider_text or 'unknown'} error={type(exc).__name__}")
        return ""


async def generate_codex_provider_image_via_gpt_image_2_skill(prompt, size, model, ref_paths=None, *, BASE_DIR, HTTPException, OUTPUT_OUTPUT_DIR, codex_cli_executable, codex_decode_output, codex_output_url_from_path, codex_postprocess_image_to_requested_size, codex_timeout, gpt_image_2_skill_api_key, gpt_image_2_skill_auth_file, gpt_image_2_skill_auth_json, gpt_image_2_skill_environment, gpt_image_2_skill_executable, gpt_image_2_skill_failure_message, gpt_image_2_skill_model_arg, gpt_image_2_skill_prompt_arg, gpt_image_2_skill_provider_args, gpt_image_2_skill_size_arg, list_codex_models, parse_gpt_image_2_skill_output, safe_cli_public_text):
    exe = gpt_image_2_skill_executable()
    if not exe:
        return None
    ref_paths = [str(path) for path in (ref_paths or []) if path and os.path.isfile(str(path))]
    auth_file = gpt_image_2_skill_auth_file()
    auth_data = gpt_image_2_skill_auth_json(auth_file)
    provider_args, tool_provider = gpt_image_2_skill_provider_args(auth_file)
    attempts = [(provider_args, tool_provider)]
    fallback_api_key = gpt_image_2_skill_api_key(auth_data)
    if tool_provider == "codex" and fallback_api_key:
        attempts.append((["--provider", "openai", "--api-key", fallback_api_key], "openai"))
    last_message = ""
    for attempt_index, (attempt_provider_args, attempt_provider) in enumerate(attempts):
        fallback_model = ""
        if attempt_provider == "codex" and (not model or str(model).lower().startswith(("gpt-image", "$imagegen"))):
            try:
                models = await list_codex_models(codex_cli_executable(), cwd=BASE_DIR)
            except asyncio.TimeoutError as exc:
                raise HTTPException(status_code=504, detail="读取 Codex 生图调度模型超时，请检查网络和登录状态。") from exc
            except (OSError, RuntimeError) as exc:
                raise HTTPException(status_code=502, detail=safe_cli_public_text(str(exc))) from exc
            fallback_model = models[0]
        out_path = os.path.join(OUTPUT_OUTPUT_DIR, f"gpt_image_2_{uuid.uuid4().hex}.png")
        mode = "edit" if ref_paths else "generate"
        args = [
            exe,
            "--json",
        ]
        args.extend(attempt_provider_args)
        args.extend([
            "images",
            mode,
            "--prompt",
            gpt_image_2_skill_prompt_arg(prompt, size, attempt_provider),
            "--out",
            out_path,
            "--model",
            gpt_image_2_skill_model_arg(model, attempt_provider, fallback_model),
            "--format",
            "png",
            "--size",
            gpt_image_2_skill_size_arg(size, model, prompt, attempt_provider),
            "--quality",
            "high",
        ])
        for path in ref_paths:
            args.extend(["--ref-image", path])
        if ref_paths and attempt_provider == "openai":
            args.extend(["--input-fidelity", "high"])
        try:
            proc = await asyncio.create_subprocess_exec(
                *args,
                cwd=BASE_DIR,
                env=gpt_image_2_skill_environment(),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=codex_timeout())
        except asyncio.TimeoutError as exc:
            try:
                proc.kill()
                await proc.wait()
            except Exception:
                pass
            raise HTTPException(status_code=504, detail="GPT Image 2 Skill 执行超时。可设置 CODEX_CLI_TIMEOUT 增大等待时间。") from exc
        except FileNotFoundError:
            return None
        out_text, err_text = codex_decode_output(stdout, stderr)
        if proc.returncode != 0:
            message = gpt_image_2_skill_failure_message(out_text, err_text, proc.returncode)
            last_message = f"{attempt_provider}: {message}"
            auth_failed = bool(re.search(r"\b401\b|unauthori[sz]ed|access[_ -]?token|api[_ -]?key", message, re.I))
            if attempt_provider == "codex" and attempt_index + 1 < len(attempts) and auth_failed:
                continue
            if auth_failed:
                return None
            raise HTTPException(status_code=502, detail=f"GPT Image 2 Skill 调用失败：{safe_cli_public_text(last_message, 800)}")
        parsed, reported_paths = parse_gpt_image_2_skill_output(out_text, err_text)
        candidate_paths = []
        if os.path.isfile(out_path):
            candidate_paths.append(out_path)
        candidate_paths.extend([path for path in reported_paths if path and os.path.isfile(path)])
        urls = []
        for path in candidate_paths:
            processed_path = codex_postprocess_image_to_requested_size(path, size, attempt_provider)
            url = codex_output_url_from_path(processed_path or path)
            if url:
                urls.append(url)
        if not urls:
            status_text = safe_cli_public_text(out_text or err_text or "", 800)
            raise HTTPException(status_code=502, detail=f"GPT Image 2 Skill 已返回，但没有在输出目录发现图片：{status_text}")
        return {"type": "url", "value": urls[0]}, {
            "images": urls,
            "text": out_text,
            "provider": "codex",
            "tool": "gpt-image-2-skill",
            "tool_provider": attempt_provider,
            "raw": parsed or {"stdout": out_text, "stderr": err_text},
        }
    raise HTTPException(status_code=502, detail=f"GPT Image 2 Skill 调用失败：{safe_cli_public_text(last_message, 800)}")


async def codex_prepare_local_media(ref_url, *, HTTPException, base64, httpx, mimetypes, output_file_from_url, tempfile):
    text = str(ref_url or "").strip()
    if not text:
        return "", []
    if text.startswith(("/output/", "/assets/")):
        path = output_file_from_url(text)
        if path:
            return path, []
        raise HTTPException(status_code=404, detail="OpenAI CLI 参考素材不存在，请重新选择文件。")
    if text.startswith("file://"):
        path = urllib.parse.unquote(urllib.parse.urlparse(text).path)
        if os.name == "nt" and re.match(r"^/[A-Za-z]:/", path):
            path = path[1:]
        if os.path.isfile(path):
            return path, []
    if os.path.isfile(text):
        return text, []
    temp_paths = []
    suffix = ".png"
    if text.startswith("data:"):
        if ";base64," not in text:
            raise HTTPException(status_code=400, detail="OpenAI CLI 参考素材 data URL 缺少 base64 数据")
        header, encoded = text.split(";base64,", 1)
        mime = header.split(":", 1)[1].split(";", 1)[0] if ":" in header else ""
        suffix = mimetypes.guess_extension(mime) or suffix
        fd, path = tempfile.mkstemp(prefix="codex_ref_", suffix=suffix)
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
            fd, path = tempfile.mkstemp(prefix="codex_ref_", suffix=suffix)
            with os.fdopen(fd, "wb") as f:
                f.write(response.content)
            temp_paths.append(path)
            return path, temp_paths
    raise HTTPException(status_code=400, detail="OpenAI CLI 无法读取参考素材，请确认文件存在且格式受支持。")


async def codex_reference_paths(reference_images=None, *, ONLINE_IMAGE_REFERENCE_MAX, codex_prepare_local_media):
    paths = []
    temp_paths = []
    try:
        for ref in (reference_images or [])[:ONLINE_IMAGE_REFERENCE_MAX]:
            url = ref.get("url") if isinstance(ref, dict) else getattr(ref, "url", "")
            if not url:
                continue
            path, created = await codex_prepare_local_media(url)
            if path:
                paths.append(path)
            temp_paths.extend(created)
        return paths, temp_paths
    except Exception:
        for path in temp_paths:
            try:
                os.remove(path)
            except Exception:
                pass
        raise


def codex_models_payload(raw=None, chat_models=None, *, CODEX_DEFAULT_IMAGE_MODELS, safe_cli_public_raw):
    chat_models = list(chat_models or [])
    all_models = [*CODEX_DEFAULT_IMAGE_MODELS, *chat_models]
    return {
        "ok": True,
        "protocol": "codex",
        "status": 200,
        "message": "模型列表来自本机 Codex CLI；生图模型由 GPT Image 2 helper 提供。" if chat_models else "请先安装并登录 Codex CLI。",
        "model_source": "codex-cli",
        "model_count": len(all_models),
        "total": len(all_models),
        "image_models": CODEX_DEFAULT_IMAGE_MODELS,
        "chat_models": chat_models,
        "video_models": [],
        "all": all_models,
        # 管理页只需要受控诊断摘要；CLI 原始 stdout/stderr 可能含本机路径或凭据。
        "raw": safe_cli_public_raw(raw or {}),
    }


async def fetch_codex_models_payload(status=None, *, BASE_DIR, HTTPException, codex_cli_executable, codex_models_payload, codex_status, list_codex_models, safe_cli_public_text):
    status = status if status is not None else await codex_status()
    if not status.get("installed"):
        payload = codex_models_payload(raw={"status": status}, chat_models=[])
        payload.update(ok=False, status=0, message=safe_cli_public_text(status.get("message") or "未找到 Codex CLI。"))
        return payload
    try:
        models = await list_codex_models(codex_cli_executable(), cwd=BASE_DIR)
    except asyncio.TimeoutError as exc:
        raise HTTPException(status_code=504, detail="读取 Codex 模型目录超时，请检查网络和 CLI 登录状态后重试。") from exc
    except (OSError, RuntimeError) as exc:
        raise HTTPException(status_code=502, detail=safe_cli_public_text(str(exc))) from exc
    return codex_models_payload(raw={"status": status}, chat_models=models)


async def generate_codex_provider_image(prompt, size, model, reference_images=None, provider=None, *, HTTPException, codex_reference_paths, generate_codex_provider_image_via_gpt_image_2_skill):
    ref_paths, temp_paths = await codex_reference_paths(reference_images)
    try:
        skill_result = await generate_codex_provider_image_via_gpt_image_2_skill(prompt, size, model, ref_paths)
        if skill_result:
            return skill_result
        raise HTTPException(status_code=400, detail="未找到 GPT Image 2 helper，OpenAI CLI 生图已禁用 $imagegen 回退。请先安装 gpt-image-2-skill 后再生成图片。")
    finally:
        for path in temp_paths:
            try:
                os.remove(path)
            except Exception:
                pass


def codex_chat_prompt(payload, history_messages=None, *, MAX_HISTORY_MESSAGES):
    parts = []
    system_prompt = str(getattr(payload, "system_prompt", "") or "").strip()
    if system_prompt:
        parts.append(f"系统要求：\n{system_prompt}")
    for item in (history_messages or [])[-MAX_HISTORY_MESSAGES:]:
        role = str(item.get("role") or "").strip()
        content = item.get("content")
        if role in {"user", "assistant"} and content:
            label = "用户" if role == "user" else "助手"
            parts.append(f"{label}：\n{content}")
    message = str(getattr(payload, "message", "") or "").strip()
    parts.append(f"用户：\n{message}")
    parts.append("请直接回答用户，输出纯文本，不要修改项目文件。")
    return "\n\n".join(part for part in parts if part).strip()


async def codex_chat_text(payload, history_messages=None, *, CODEX_DEFAULT_CHAT_MODELS, codex_chat_prompt, codex_reference_paths, codex_timeout, model_dump_compat, run_codex_cli):
    image_paths = []
    temp_paths = []
    try:
        image_values = []
        if hasattr(payload, "images"):
            image_values.extend([{"url": item} for item in (getattr(payload, "images", None) or []) if item])
        if hasattr(payload, "reference_images"):
            image_values.extend([model_dump_compat(ref) for ref in (getattr(payload, "reference_images", None) or []) if getattr(ref, "url", "")])
        image_paths, temp_paths = await codex_reference_paths(image_values)
        raw = await run_codex_cli(
            codex_chat_prompt(payload, history_messages),
            model=getattr(payload, "model", "") or CODEX_DEFAULT_CHAT_MODELS[0],
            image_paths=image_paths,
            timeout=codex_timeout(),
            output_last_message=True,
        )
        text = str(raw.get("text") or "").strip()
        return text or "Codex CLI 返回了空回复。", raw
    finally:
        for path in temp_paths:
            try:
                os.remove(path)
            except Exception:
                pass


def _windows_codex_install_candidates(*, glob, os):
    """返回官方 Windows 安装器和 npm 全局安装的常见 Codex 路径。"""
    if os.name != "nt":
        return []
    local_appdata = str(os.getenv("LOCALAPPDATA", "") or "").strip()
    appdata = str(os.getenv("APPDATA", "") or "").strip()
    candidates = []
    if local_appdata:
        for install_root in (
            os.path.join(local_appdata, "OpenAI", "Codex", "bin"),
            os.path.join(local_appdata, "Programs", "OpenAI", "Codex", "bin"),
        ):
            try:
                versioned_paths = glob.glob(os.path.join(install_root, "*", "codex.exe"))
            except OSError:
                versioned_paths = []
            candidates.extend(versioned_paths)
        candidates.sort(key=lambda path: os.path.getmtime(path) if os.path.isfile(path) else 0, reverse=True)
    if appdata:
        candidates.extend([
            os.path.join(appdata, "npm", "codex.cmd"),
            os.path.join(appdata, "npm", "codex.exe"),
        ])
    return list(dict.fromkeys(candidates))


def codex_cli_executable(*, _windows_codex_install_candidates, codex_env_value, os, shutil):
    configured = str(codex_env_value("CODEX_BIN") or "").strip()
    if configured:
        return configured
    executable = shutil.which("codex") or shutil.which("codex.exe") or shutil.which("codex.cmd")
    if executable:
        return executable
    for candidate in _windows_codex_install_candidates():
        if os.path.isfile(candidate):
            return candidate
    return ""


async def codex_status(*, BASE_DIR, asyncio, codex_cli_executable, codex_decode_output, gpt_image_2_skill_executable, safe_cli_executable_name, safe_cli_public_raw, safe_cli_public_text):
    exe = codex_cli_executable()
    image2_exe = gpt_image_2_skill_executable()
    if not exe:
        return {
            "installed": False,
            "logged_in": False,
            "image2_helper_installed": bool(image2_exe),
            "image2_helper_path": safe_cli_executable_name(image2_exe),
            "message": "未找到 OpenAI Codex CLI，请先安装。",
        }
    try:
        proc = await asyncio.create_subprocess_exec(
            exe,
            "--version",
            cwd=BASE_DIR,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=10)
        out_text, err_text = codex_decode_output(stdout, stderr)
        ok = proc.returncode == 0
        helper_message = "GPT Image 2 helper 已安装，OpenAI CLI 生图会使用 GPT Image 2。" if image2_exe else "未找到 GPT Image 2 helper，OpenAI CLI 生图不可用；已禁用 Codex 内置 $imagegen 回退。"
        safe_version = safe_cli_public_text(out_text or err_text, 2000)
        safe_error = safe_cli_public_text(err_text or out_text or "Codex CLI 检测失败", 1200)
        return {
            "installed": ok,
            "logged_in": None,
            "version": safe_version,
            "path": safe_cli_executable_name(exe),
            "image2_helper_installed": bool(image2_exe),
            "image2_helper_path": safe_cli_executable_name(image2_exe),
            "message": f"OpenAI Codex CLI 已安装。{helper_message} 登录状态会在首次执行 codex exec 时由 CLI 校验。" if ok else safe_error,
            "raw": safe_cli_public_raw({"stdout": out_text, "stderr": err_text, "returncode": proc.returncode}),
        }
    except Exception as exc:
        return {
            "installed": False,
            "logged_in": False,
            "path": safe_cli_executable_name(exe),
            "image2_helper_installed": bool(image2_exe),
            "image2_helper_path": safe_cli_executable_name(image2_exe),
            "message": f"Codex CLI 检测失败：{safe_cli_public_text(exc, 1200)}",
        }


async def codex_help(payload, *, BASE_DIR, CLI_PUBLIC_TEXT_LIMIT, HTTPException, asyncio, codex_cli_executable, codex_decode_output, safe_cli_public_raw, safe_cli_public_text):
    exe = codex_cli_executable()
    if not exe:
        raise HTTPException(status_code=400, detail="未找到 OpenAI Codex CLI。")
    allowed = {"", "exec", "login", "logout", "doctor", "mcp", "app", "update"}
    command = str(payload.command or "").strip()
    if command not in allowed:
        raise HTTPException(status_code=400, detail="不允许的 Codex CLI 命令")
    args = [exe]
    if command:
        args.append(command)
    args.append("--help")
    proc = await asyncio.create_subprocess_exec(
        *args,
        cwd=BASE_DIR,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=20)
    out_text, err_text = codex_decode_output(stdout, stderr)
    if proc.returncode != 0:
        raise HTTPException(status_code=502, detail=safe_cli_public_text(err_text or out_text or f"exit={proc.returncode}", 1000))
    safe_stdout = safe_cli_public_text(out_text, CLI_PUBLIC_TEXT_LIMIT)
    safe_stderr = safe_cli_public_text(err_text, CLI_PUBLIC_TEXT_LIMIT)
    return {"text": safe_stdout or safe_stderr, "raw": safe_cli_public_raw({"stdout": out_text, "stderr": err_text})}


