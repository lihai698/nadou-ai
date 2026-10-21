"""ComfyUI 后端探测与接入选择；实例列表、负载字典和锁由原 host 提供，配置读取保持实时。"""
import re

MEDIA_INPUT_KEYS = ("image", "video", "audio", "mask", "filename", "file")

MEDIA_INPUT_EXT_RE = re.compile(r"\.(png|jpe?g|webp|gif|bmp|tiff?|mp4|webm|mov|m4v|avi|mkv|mp3|wav|m4a|aac|ogg|flac)(?:\?|$)", re.I)



def check_images_exist(backend_addr, images, *, urllib, requests):
    if not images: return True
    for img in images:
        try:
            url = f"http://{backend_addr}/view?filename={urllib.parse.quote(img)}&type=input"
            r = requests.get(url, stream=True, timeout=0.5)
            r.close()
            if r.status_code != 200: return False
        except: return False
    return True


def is_comfy_input_media_value(input_name, value):
    if not isinstance(value, str) or not value.strip():
        return False
    key = str(input_name or "").lower()
    if any(token in key for token in MEDIA_INPUT_KEYS):
        return True
    return bool(MEDIA_INPUT_EXT_RE.search(value))


def collect_required_comfy_media(params, *, is_comfy_input_media_value):
    required = []
    for node_inputs in (params or {}).values():
        if not isinstance(node_inputs, dict):
            continue
        scan_inputs = node_inputs.get("inputs") if isinstance(node_inputs.get("inputs"), dict) else node_inputs
        for input_name, value in scan_inputs.items():
            if is_comfy_input_media_value(input_name, value):
                required.append(value)
    return list(dict.fromkeys(required))


def get_best_backend(required_images=None, *, get_instances, get_backend_load, urllib, json, LOAD_LOCK, check_images_exist, write_diagnostic):
    best_backend = get_instances()[0]
    min_queue_size = float('inf')
    backend_stats = {}

    for addr in get_instances():
        try:
            with urllib.request.urlopen(f"http://{addr}/queue", timeout=1) as response:
                data = json.loads(response.read())
                remote_load = len(data.get('queue_running', [])) + len(data.get('queue_pending', []))
                with LOAD_LOCK:
                    local_load = get_backend_load().get(addr, 0)
                effective_load = max(remote_load, local_load)
                has_images = check_images_exist(addr, required_images)
                backend_stats[addr] = {"load": effective_load, "has_images": has_images}
        except Exception as e:
            write_diagnostic(
                f"comfy backend unreachable error={type(e).__name__}"
            )
            continue

    if not backend_stats:
        return get_instances()[0]

    for addr, stats in backend_stats.items():
        load = stats["load"]
        if load < min_queue_size or (load == min_queue_size and stats.get("has_images") and not backend_stats.get(best_backend, {}).get("has_images")):
            min_queue_size = load
            best_backend = addr

    return best_backend


def reserve_best_backend(required_images=None, *, get_instances, get_backend_load, urllib, json, LOAD_LOCK, check_images_exist, write_diagnostic):
    backend_stats = {}
    for addr in get_instances():
        try:
            with urllib.request.urlopen(f"http://{addr}/queue", timeout=1) as response:
                data = json.loads(response.read())
                remote_load = len(data.get('queue_running', [])) + len(data.get('queue_pending', []))
                has_images = check_images_exist(addr, required_images)
                backend_stats[addr] = {"remote_load": remote_load, "has_images": has_images}
        except Exception as e:
            write_diagnostic(
                f"comfy backend reservation unavailable error={type(e).__name__}"
            )
            continue
    with LOAD_LOCK:
        best_backend = get_instances()[0]
        min_load = float('inf')
        if backend_stats:
            for addr, stats in backend_stats.items():
                load = max(stats["remote_load"], get_backend_load().get(addr, 0))
                if load < min_load or (load == min_load and stats.get("has_images") and not backend_stats.get(best_backend, {}).get("has_images")):
                    min_load = load
                    best_backend = addr
        get_backend_load()[best_backend] = get_backend_load().get(best_backend, 0) + 1
        return best_backend
