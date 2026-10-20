"""Gemini/Antigravity CLI 执行协议与请求适配。

执行文件发现、媒体和诊断接口由应用注入；模块导入不访问登录或凭据。
"""
import asyncio
import os
import time
import re
import json

def is_antigravity_cli(exe):
    text = str(exe or "").lower()
    return os.path.basename(text).startswith("agy") or "antigravity" in text


def gemini_cli_display_name(exe=None, *, gemini_cli_executable, is_antigravity_cli):
    return "Antigravity CLI" if is_antigravity_cli(exe or gemini_cli_executable()) else "Gemini CLI"


def gemini_cli_timeout(default):
    try:
        return max(30, min(3600, int(os.getenv("GEMINI_CLI_TIMEOUT", str(default)) or default)))
    except Exception:
        return default


def gemini_cli_image_timeout():
    raw = os.getenv("ANTIGRAVITY_IMAGE_TIMEOUT") or os.getenv("GEMINI_CLI_IMAGE_TIMEOUT") or "300"
    try:
        return max(60, min(1800, int(raw)))
    except Exception:
        return 300


def gemini_cli_model(model='', fallback=''):
    value = str(model or fallback or "").strip()
    return value or "auto"


def gemini_cli_text_from_raw(raw, fallback_text='', *, gemini_cli_text_from_raw):
    if isinstance(raw, str):
        return raw.strip()
    if isinstance(raw, dict):
        for key in ("response", "text", "content", "message", "output"):
            value = raw.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        candidates = []
        for value in raw.values():
            if isinstance(value, str) and value.strip():
                candidates.append(value.strip())
            elif isinstance(value, list):
                for item in value:
                    if isinstance(item, dict):
                        text = gemini_cli_text_from_raw(item)
                        if text:
                            candidates.append(text)
                    elif isinstance(item, str) and item.strip():
                        candidates.append(item.strip())
        if candidates:
            return "\n".join(candidates).strip()
    if isinstance(raw, list):
        parts = [gemini_cli_text_from_raw(item) for item in raw]
        return "\n".join(part for part in parts if part).strip()
    return str(fallback_text or "").strip()


def gemini_cli_parse_stdout(out_text, *, gemini_cli_text_from_raw, jimeng_extract_json):
    text = str(out_text or "").strip()
    if not text:
        return {}, ""
    try:
        raw = json.loads(text)
        return raw, gemini_cli_text_from_raw(raw, text)
    except Exception:
        pass
    parsed = jimeng_extract_json(text)
    if isinstance(parsed, (dict, list)) and parsed != {"text": text}:
        return parsed, gemini_cli_text_from_raw(parsed, text)
    return {"text": text}, text


async def run_gemini_cli(prompt, model='', timeout=None, allow_tools=False, *, BASE_DIR, HTTPException, codex_decode_output, gemini_cli_display_name, gemini_cli_executable, gemini_cli_model, gemini_cli_parse_stdout, gemini_cli_timeout, is_antigravity_cli, safe_cli_executable_name, safe_cli_public_text, write_diagnostic):
    exe = gemini_cli_executable()
    if not exe:
        raise HTTPException(status_code=400, detail="未找到 Antigravity CLI。请先安装 Google Antigravity CLI，并完成 agy 登录。")
    timeout_seconds = timeout or gemini_cli_timeout()
    if is_antigravity_cli(exe):
        args = [exe, "--print-timeout", f"{int(timeout_seconds)}s"]
        selected = gemini_cli_model(model)
        if selected and selected != "auto":
            args.extend(["--model", selected])
        if allow_tools:
            args.append("--dangerously-skip-permissions")
        args.extend(["-p", str(prompt or "")])
    else:
        args = [
            exe,
            "--model",
            gemini_cli_model(model),
            "--output-format",
            "json",
            "--skip-trust",
        ]
        if allow_tools:
            args.extend(["--approval-mode", "yolo"])
        args.extend(["--prompt", str(prompt or "")])
    proc = None
    try:
        proc = await asyncio.create_subprocess_exec(
            *args,
            cwd=BASE_DIR,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout_seconds)
    except asyncio.TimeoutError as exc:
        if proc and proc.returncode is None:
            try:
                proc.kill()
                await proc.wait()
            except Exception:
                pass
        raise HTTPException(status_code=504, detail=f"{gemini_cli_display_name(exe)} 执行超时。可设置 GEMINI_CLI_TIMEOUT 增大等待时间。") from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=400, detail=f"未找到 {gemini_cli_display_name(exe)}：{safe_cli_executable_name(exe) or 'agy'}") from exc
    out_text, err_text = codex_decode_output(stdout, stderr)
    raw, text = gemini_cli_parse_stdout(out_text)
    if proc.returncode != 0:
        message = err_text or out_text or f"exit={proc.returncode}"
        safe_message = safe_cli_public_text(message, 800)
        write_diagnostic(f"gemini cli failed returncode={proc.returncode}")
        raise HTTPException(status_code=502, detail=f"{gemini_cli_display_name(exe)} 调用失败：{safe_message}")
    return {"text": text or out_text, "raw": raw, "_stdout": out_text, "_stderr": err_text}


def gemini_cli_models_payload(raw=None, *, GEMINI_CLI_DEFAULT_CHAT_MODELS, GEMINI_CLI_DEFAULT_IMAGE_MODELS, model_list_from_values, safe_cli_public_raw):
    all_models = [*GEMINI_CLI_DEFAULT_IMAGE_MODELS, *GEMINI_CLI_DEFAULT_CHAT_MODELS]
    all_models = model_list_from_values(all_models)
    return {
        "ok": True,
        "protocol": "gemini-cli",
        "status": 200,
        "message": "Antigravity CLI 可用，模型列表使用 auto 默认模型。",
        "model_count": len(all_models),
        "total": len(all_models),
        "image_models": GEMINI_CLI_DEFAULT_IMAGE_MODELS,
        "chat_models": GEMINI_CLI_DEFAULT_CHAT_MODELS,
        "video_models": [],
        "all": all_models,
        # 管理页只需要受控诊断摘要；CLI 原始 stdout/stderr 可能含本机路径或凭据。
        "raw": safe_cli_public_raw(raw or {}),
    }


def gemini_cli_reference_note(reference_images=None, *, ONLINE_IMAGE_REFERENCE_MAX):
    refs = []
    temp_paths = []
    for ref in (reference_images or [])[:ONLINE_IMAGE_REFERENCE_MAX]:
        url = ref.get("url") if isinstance(ref, dict) else getattr(ref, "url", "")
        if not url:
            continue
        refs.append(url)
    return refs, temp_paths


async def gemini_cli_reference_paths(reference_images=None, *, codex_reference_paths):
    return await codex_reference_paths(reference_images)


def gemini_cli_image_size_instruction(size='', model=''):
    size_text = str(size or "").strip()
    model_text = str(model or "").strip()
    match = re.match(r"^\s*(\d{2,5})\s*[xX*]\s*(\d{2,5})\s*$", size_text)
    if match:
        width, height = int(match.group(1)), int(match.group(2))
        if width > 0 and height > 0:
            orientation = "正方形" if width == height else ("横版" if width > height else "竖版")
            return (
                f"目标输出分辨率：{width}x{height} 像素（宽 x 高），画面方向：{orientation}。"
                f"最终保存到输出目录的图片文件实际像素必须是 {width}x{height}。"
                "如果生成器先得到较小图片，请在保存前放大或导出到目标尺寸，不要返回 1024px 小图。"
            )
    combined = f"{size_text} {model_text}".lower()
    if "4k" in combined:
        return "目标输出为 4K 高分辨率图片；最终保存文件需要达到当前画幅对应的 4K 像素尺寸，不要默认输出 1024px 小图。"
    if "2k" in combined:
        return "目标输出为 2K 高分辨率图片；最终保存文件需要达到当前画幅对应的 2K 像素尺寸，不要默认输出 1024px 小图。"
    return f"尺寸/比例参考：{size_text or 'auto'}。如果可以指定分辨率，请优先输出高分辨率图片。"


async def generate_gemini_cli_provider_image(prompt, size, model, reference_images=None, provider=None, *, GEMINI_CLI_DEFAULT_IMAGE_MODELS, HTTPException, OUTPUT_OUTPUT_DIR, codex_output_image_files, codex_output_url_from_path, codex_postprocess_image_to_requested_size, gemini_cli_display_name, gemini_cli_executable, gemini_cli_image_size_instruction, gemini_cli_image_timeout, gemini_cli_reference_paths, gemini_cli_timeout, is_antigravity_cli, run_gemini_cli, safe_cli_public_text):
    ref_paths, temp_paths = await gemini_cli_reference_paths(reference_images)
    since = time.time()
    try:
        ref_text = ""
        if ref_paths:
            ref_text = "\n参考图片本地路径：\n" + "\n".join(ref_paths)
        size_context = f"{model or ''} {prompt or ''}"
        image_prompt = (
            f"你正在为 Infinite Canvas 生成图片。\n"
            f"任务：{prompt}\n\n"
            f"{gemini_cli_image_size_instruction(size, size_context)}\n"
            f"{ref_text}\n\n"
            f"如果当前 Antigravity CLI/模型支持图片生成或图片编辑，请把最终图片保存到这个本地目录：{OUTPUT_OUTPUT_DIR}\n"
            "文件格式优先 png 或 jpg。只输出最终文件路径和一句简短说明；不要修改项目代码，不要创建额外文档。\n"
            "如果你无法真正创建图片文件，请在 60 秒内直接回复“无法生成图片文件”，不要只写计划，也不要持续尝试。"
        )
        raw = await run_gemini_cli(
            image_prompt,
            model=model or GEMINI_CLI_DEFAULT_IMAGE_MODELS[0],
            timeout=gemini_cli_image_timeout() if is_antigravity_cli(gemini_cli_executable()) else gemini_cli_timeout(),
            allow_tools=True,
        )
        files = codex_output_image_files(since)
        urls = []
        for path in files:
            processed_path = codex_postprocess_image_to_requested_size(path, size, "gemini-cli")
            url = codex_output_url_from_path(processed_path or path)
            if url and url not in urls:
                urls.append(url)
        if not urls:
            text = f"{raw.get('text') or raw.get('_stdout') or ''}\n{raw.get('_stderr') or ''}"
            pattern = r"([A-Za-z]:\\[^\r\n\"'<>]+\.(?:png|jpe?g|webp|gif)|/[^\r\n\"'<>]+\.(?:png|jpe?g|webp|gif))"
            for match in re.findall(pattern, text, flags=re.I):
                match_path = match.strip()
                processed_path = codex_postprocess_image_to_requested_size(match_path, size, "gemini-cli")
                url = codex_output_url_from_path(processed_path or match_path)
                if url and url not in urls:
                    urls.append(url)
        if not urls:
            status_text = safe_cli_public_text(raw.get("text") or raw.get("_stdout") or raw.get("_stderr") or "", 800)
            raise HTTPException(status_code=502, detail=f"{gemini_cli_display_name()} 已返回，但没有在输出目录发现图片：{status_text}")
        return {"type": "url", "value": urls[0]}, {"images": urls, "text": raw.get("text"), "provider": "gemini-cli", "raw": raw.get("raw")}
    finally:
        for path in temp_paths:
            try:
                os.remove(path)
            except Exception:
                pass


def gemini_cli_chat_prompt(payload, history_messages=None, *, MAX_HISTORY_MESSAGES, model_dump_compat):
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
    image_values = []
    if hasattr(payload, "images"):
        image_values.extend([{"url": item} for item in (getattr(payload, "images", None) or []) if item])
    if hasattr(payload, "reference_images"):
        image_values.extend([model_dump_compat(ref) for ref in (getattr(payload, "reference_images", None) or []) if getattr(ref, "url", "")])
    refs = []
    temp_paths = []
    return "\n\n".join(part for part in parts if part).strip(), image_values


async def gemini_cli_chat_text(payload, history_messages=None, *, GEMINI_CLI_DEFAULT_CHAT_MODELS, gemini_cli_chat_prompt, gemini_cli_display_name, gemini_cli_reference_paths, gemini_cli_timeout, run_gemini_cli):
    temp_paths = []
    try:
        prompt, image_values = gemini_cli_chat_prompt(payload, history_messages)
        image_paths, temp_paths = await gemini_cli_reference_paths(image_values)
        if image_paths:
            prompt = f"{prompt}\n\n可参考的本地图片路径：\n" + "\n".join(image_paths)
        prompt = f"{prompt}\n\n请直接回答用户，输出纯文本，不要修改项目文件。"
        raw = await run_gemini_cli(
            prompt,
            model=getattr(payload, "model", "") or GEMINI_CLI_DEFAULT_CHAT_MODELS[0],
            timeout=gemini_cli_timeout(),
            allow_tools=False,
        )
        text = str(raw.get("text") or "").strip()
        return text or f"{gemini_cli_display_name()} 返回了空回复。", raw
    finally:
        for path in temp_paths:
            try:
                os.remove(path)
            except Exception:
                pass


def antigravity_cli_winget_candidates(*, glob, os):
    patterns = [
        os.path.join(os.path.expanduser("~"), "AppData", "Local", "Microsoft", "WinGet", "Packages", "Google.AntigravityCLI_*", "agy.exe"),
        os.path.join(os.getenv("LOCALAPPDATA", ""), "Microsoft", "WinGet", "Packages", "Google.AntigravityCLI_*", "agy.exe"),
    ]
    candidates = []
    for pattern in patterns:
        if not pattern:
            continue
        candidates.extend(glob.glob(pattern))
    return sorted(dict.fromkeys(path for path in candidates if os.path.exists(path)), reverse=True)


def gemini_cli_executable(*, antigravity_cli_winget_candidates, gemini_cli_env_value, shutil):
    for key in ("ANTIGRAVITY_BIN", "AGY_BIN", "GEMINI_BIN"):
        configured = str(gemini_cli_env_value(key) or "").strip().strip('"')
        if configured:
            return configured
    for name in ("agy", "agy.exe"):
        found = shutil.which(name)
        if found:
            return found
    for candidate in antigravity_cli_winget_candidates():
        return candidate
    return shutil.which("gemini") or shutil.which("gemini.exe") or shutil.which("gemini.cmd") or ""


async def gemini_cli_status(*, BASE_DIR, asyncio, codex_decode_output, gemini_cli_display_name, gemini_cli_executable, is_antigravity_cli, safe_cli_executable_name, safe_cli_public_raw, safe_cli_public_text):
    exe = gemini_cli_executable()
    display_name = gemini_cli_display_name(exe)
    if not exe:
        return {
            "installed": False,
            "logged_in": False,
            "provider": "antigravity",
            "message": "未找到 Antigravity CLI，请先安装。",
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
        is_agy = is_antigravity_cli(exe)
        safe_version = safe_cli_public_text(out_text or err_text, 2000)
        safe_error = safe_cli_public_text(err_text or out_text or f"{display_name} 检测失败", 1200)
        return {
            "installed": ok,
            "logged_in": None,
            "version": safe_version,
            "path": safe_cli_executable_name(exe),
            "provider": "antigravity" if is_agy else "gemini",
            "message": f"{display_name} 已安装。登录状态会在首次执行 {'agy' if is_agy else 'gemini'} 时由 CLI 校验。" if ok else safe_error,
            "raw": safe_cli_public_raw({"stdout": out_text, "stderr": err_text, "returncode": proc.returncode}),
        }
    except Exception as exc:
        return {
            "installed": False,
            "logged_in": False,
            "path": safe_cli_executable_name(exe),
            "provider": "antigravity" if is_antigravity_cli(exe) else "gemini",
            "message": f"{display_name} 检测失败：{safe_cli_public_text(exc, 1200)}",
        }


async def gemini_cli_help(payload, *, BASE_DIR, CLI_PUBLIC_TEXT_LIMIT, HTTPException, asyncio, codex_decode_output, gemini_cli_display_name, gemini_cli_executable, is_antigravity_cli, safe_cli_public_raw, safe_cli_public_text):
    exe = gemini_cli_executable()
    if not exe:
        raise HTTPException(status_code=400, detail="未找到 Antigravity CLI。")
    is_agy = is_antigravity_cli(exe)
    allowed = {"", "help", "install", "models", "plugin", "plugins", "update", "changelog"} if is_agy else {"", "help", "mcp", "extensions"}
    command = str(payload.command or "").strip()
    if command not in allowed:
        raise HTTPException(status_code=400, detail=f"不允许的 {gemini_cli_display_name(exe)} 命令")
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


