"""OpenAI 视频代理和 Responses 图片工具的请求协议。"""
import os

async def post_video_proxy_image(client, provider, model, prompt, size, image_refs, base_url, *, api_headers, content_type_for_path, httpx_request_with_transient_retries, openai_video_proxy_local_image_path, openai_video_proxy_public_reference_url, runninghub_aspect_from_size):
    body = {
        "model": model,
        "prompt": prompt,
        "aspect_ratio": runninghub_aspect_from_size(size, "1:1"),
    }
    video_url = f"{base_url}/videos" if base_url.endswith("/v1") else f"{base_url}/v1/videos"
    refs_for_proxy = image_refs[:6]
    local_image_paths = [openai_video_proxy_local_image_path(ref) for ref in refs_for_proxy]
    has_local_images = any(local_image_paths)
    if has_local_images:
        form_data = [(key, value) for key, value in body.items()]
        for ref, local_path in zip(refs_for_proxy, local_image_paths):
            if local_path:
                continue
            url = await openai_video_proxy_public_reference_url(ref)
            if url:
                form_data.append(("images", url))
        files = []
        opened = []
        try:
            for local_path in local_image_paths:
                if not local_path:
                    continue
                fh = open(local_path, "rb")
                opened.append(fh)
                files.append(("images", (os.path.basename(local_path), fh, content_type_for_path(local_path))))
            response = await client.post(
                video_url,
                headers=api_headers(json_body=False, provider=provider, model=model),
                # HTTPX AsyncClient requires an async-compatible multipart stream.
                # Encode repeated text fields as multipart parts, including images.
                files=[(key, (None, str(value))) for key, value in form_data] + files,
            )
        finally:
            for fh in opened:
                fh.close()
    else:
        if refs_for_proxy:
            body["images"] = [await openai_video_proxy_public_reference_url(ref) for ref in refs_for_proxy]
        response = await httpx_request_with_transient_retries(
            client,
            "POST",
            video_url,
            attempts=2,
            headers=api_headers(provider=provider, model=model),
            json=body,
        )
    return response


async def post_responses_image(client, provider, model, prompt, size, quality, image_refs, base_url, *, ONLINE_IMAGE_REFERENCE_MAX, api_headers, locked_recommended_provider_rule, post_openai_responses, provider_endpoint_url, responses_image_size_instruction, responses_input_image_url, responses_proxy_tool_size):
    tool = {"type": "image_generation"}
    tool["action"] = "edit" if image_refs else "generate"
    if size and str(size).strip().lower() != "auto":
        tool["size"] = responses_proxy_tool_size(size)
    if quality:
        tool["quality"] = quality
    size_instruction = responses_image_size_instruction(size)
    input_text = f"{size_instruction}\n\n{prompt}" if size_instruction else prompt
    content = [{"type": "input_text", "text": input_text}]
    force_public_refs = bool(locked_recommended_provider_rule(provider.get("id"), provider.get("name"), base_url))
    for ref in image_refs[:ONLINE_IMAGE_REFERENCE_MAX]:
        image_url = await responses_input_image_url(ref, require_public_url=force_public_refs)
        if image_url:
            content.append({"type": "input_image", "image_url": image_url})
    body = {
        "model": model,
        "input": [{"role": "user", "content": content}],
        "tools": [tool],
        "tool_choice": {"type": "image_generation"},
    }
    responses_url = provider_endpoint_url(provider, "image_generation_endpoint", "/v1/responses")
    response = await post_openai_responses(client, responses_url, api_headers(provider=provider, model=model), body)
    return response
