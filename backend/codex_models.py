"""Read the signed-in Codex CLI model catalog through its stdio app server."""

import asyncio
import json


async def list_codex_models(executable, *, cwd, timeout=30):
    proc = await asyncio.create_subprocess_exec(
        # Model discovery must match the ChatGPT account used by the image helper.
        # This process-only override leaves the user's own CLI relay configuration intact.
        executable, 'app-server', '--stdio', '-c', 'model_provider="openai"', cwd=cwd,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    # Drain diagnostics so the CLI cannot block on a full stderr pipe. Never expose credentials.
    diagnostics = asyncio.create_task(proc.stderr.read())

    async def send(message):
        proc.stdin.write((json.dumps(message) + '\n').encode('utf-8'))
        await proc.stdin.drain()

    async def receive(request_id):
        while True:
            line = await proc.stdout.readline()
            if not line:
                raise RuntimeError('Codex 模型目录进程提前退出，请检查 CLI 版本和登录状态。')
            try:
                message = json.loads(line)
            except (ValueError, UnicodeError) as exc:
                raise RuntimeError('Codex 模型目录返回格式错误，请更新 CLI 后重试。') from exc
            if not isinstance(message, dict) or message.get('id') != request_id:
                continue
            if 'error' in message:
                raise RuntimeError('Codex 无法读取模型目录，请检查 CLI 版本、网络和登录状态。')
            result = message.get('result')
            if not isinstance(result, dict):
                raise RuntimeError('Codex 模型目录没有返回有效结果。')
            return result

    async def query():
        await send({'id': 1, 'method': 'initialize', 'params': {
            'clientInfo': {'name': 'nadou_ai', 'version': '1.0'},
        }})
        await receive(1)
        await send({'method': 'initialized', 'params': {}})
        models = []
        cursors = set()
        cursor = None
        for request_id in range(2, 22):
            params = {'includeHidden': False, 'limit': 100}
            if cursor:
                params['cursor'] = cursor
            await send({'id': request_id, 'method': 'model/list', 'params': params})
            page = await receive(request_id)
            for item in page.get('data') or []:
                if not isinstance(item, dict) or item.get('hidden'):
                    continue
                model = item.get('model') or item.get('id')
                if isinstance(model, str) and model.strip() and model.strip() not in models:
                    models.append(model.strip())
            cursor = page.get('nextCursor')
            if not cursor:
                if not models:
                    raise RuntimeError('Codex 没有返回可见模型，请完成登录后重试。')
                return models
            if not isinstance(cursor, str) or cursor in cursors:
                raise RuntimeError('Codex 模型目录分页异常，请更新 CLI 后重试。')
            cursors.add(cursor)
        raise RuntimeError('Codex 模型目录分页超出限制，请更新 CLI 后重试。')

    try:
        return await asyncio.wait_for(query(), timeout=timeout)
    finally:
        if proc.returncode is None:
            try:
                proc.kill()
            except ProcessLookupError:
                pass
        await proc.wait()
        await diagnostics
