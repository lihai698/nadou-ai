"""仅测试使用：真实画布/助手入口，模型和图片供应商使用可计数的本地模拟。"""

import copy
import asyncio
import json
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image

from backend.canvas_assistant import create_assistant_router
from backend.canvas_assistant_operations import AssistantPlan, prepare_operations
from tests.test_canvas_assistant_story import story_fixture


PROVIDER = {'id': 'flow-mock', 'name': '本地验收模拟', 'enabled': True,
            'has_key': True, 'protocol': 'openai', 'chat_models': ['flow-text'],
            'image_models': ['flow-image'], 'video_models': []}
STORY = '女孩走进书店。她读着旧信。'


class CreativeFlowFixture:
    def __init__(self, main, root):
        self.main, self.root = main, Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.calls = []
        self.cases = {}
        self.positions = {}
        self.read_versions = {}
        self.failed_once = set()
        self.patches = []
        for name, value in {
            'DATA_DIR': str(self.root), 'CANVAS_DIR': str(self.root / 'canvases'),
            'CANVAS_TASK_DIR': str(self.root / 'tasks'), 'CANVAS_TASKS': {},
            'PROJECTS_PATH': str(self.root / 'projects.json'),
            'API_PROVIDERS_FILE': str(self.root / 'api_providers.json'),
            'ASSET_LIBRARY_PATH': str(self.root / 'asset_library.json'),
            'ASSETS_DIR': str(self.root / 'media'), 'OUTPUT_DIR': str(self.root / 'media' / 'output'),
            'public_api_providers': lambda: [copy.deepcopy(PROVIDER)],
            'canvas_assistant_providers': lambda: [copy.deepcopy(PROVIDER)],
            'build_online_image_result': self.image,
        }.items():
            item = patch.object(main, name, value)
            item.start()
            self.patches.append(item)
        self.app = FastAPI()
        self.app.router.routes.extend(r for r in main.app.routes
            if not getattr(r, 'path', '').startswith('/api/canvas-assistant')
            and getattr(r, 'path', '') not in {'/api/canvas-llm', '/assets', '/output'})
        self.app.include_router(create_assistant_router(
            root=lambda: str(self.root / 'assistant'), load_canvas=main.load_canvas,
            providers=lambda: [copy.deepcopy(PROVIDER)], user_id=main.safe_user_id,
            call_model=self.agent, apply_operations=main.apply_canvas_assistant_operations,
            load_reference_assets=lambda: [], query_native_task=main.query_canvas_assistant_native_task))
        self.app.post('/api/canvas-llm')(self.llm)
        self.app.get('/creative-flow-evidence')(self.evidence)

        @self.app.middleware('http')
        async def guard(request, call_next):
            path = request.url.path
            allowed = ('/api/canvases', '/api/canvas-assistant/', '/api/canvas-image-tasks')
            if request.method not in {'GET', 'HEAD'} and not (
                    path.startswith(allowed) or path == '/api/canvas-llm'):
                return JSONResponse({'detail': '隔离验收禁止其他写入和服务调用'}, status_code=451)
            if path == '/api/canvas-assistant/continue':
                body = await request.json()
                cid = body.get('canvasId')
                case = self.cases.get(cid, {})
                if case.get('scenario') == 'recovery' and cid not in self.failed_once:
                    self.failed_once.add(cid)
                    return JSONResponse({'detail': '隔离模拟：第二步连接中断'}, status_code=503)
            return await call_next(request)

    def close(self):
        for item in reversed(self.patches):
            item.stop()

    def create(self, kind, scenario):
        main = self.main
        canvas = main.new_canvas(title=f'验收-{kind}-{scenario}', kind=kind)
        canvas['settings'] = {'engine': 'api', 'apiKind': 'image', 'provider_id': 'flow-mock',
                              'model': 'flow-image', 'ratio': 'square', 'resolution': '1k', 'count': 1}
        canvas['nodes'] = [{'id': 'story', 'type': 'smart-prompt' if kind == 'smart' else 'prompt',
                            'title': '自制故事', 'text': STORY, 'x': 40, 'y': 50, 'w': 320, 'h': 240}]
        canvas['connections'] = []
        if scenario == 'shot':
            canvas['nodes'].append({'id': 'table', 'type': 'smart-shot-table' if kind == 'smart' else 'shot-table',
                'title': '自制分镜表', 'x': 430, 'y': 50, 'w': 760, 'h': 400,
                'shotTableData': {'version': 1, 'revision': 0, 'source': {'fingerprint': 'fixture-story', 'kind': 'text', 'nodeId': 'story'},
                    'task': {'status': 'ready'}, 'selectedRowIds': [],
                    'columns': [{'id': 'visual', 'kind': 'builtin', 'label': '画面'}],
                    'rows': [{'id': 's1', 'index': 1, 'startSeconds': 0, 'endSeconds': 3, 'durationSeconds': 3,
                              'cells': {'visual': '女孩读信'}, 'imagePrompt': '旧信'},
                             {'id': 's2', 'index': 2, 'startSeconds': 3, 'endSeconds': 6, 'durationSeconds': 3,
                              'cells': {'visual': '女孩离开书店'}, 'imagePrompt': '书店门口'}],
                    'productionData': {'style': '暖色电影'}, 'generationMap': {}}})
            canvas['nodes'].append({'id': 'old-image', 'type': 'image' if kind == 'classic' else 'smart-image',
                'title': '必须保留的旧图', 'x': 40, 'y': 420, 'w': 240, 'h': 200,
                **({'url': '/assets/output/creative-flow-old.png'} if kind == 'classic' else {'images': [{'url': '/assets/output/creative-flow-old.png'}]})})
        main.save_canvas(canvas)
        self.cases[canvas['id']] = {'id': canvas['id'], 'kind': kind, 'scenario': scenario,
            'message': f'流程验收 {canvas["id"]}', 'initial': copy.deepcopy(canvas)}
        self.positions[canvas['id']] = 0
        return self.cases[canvas['id']]

    def decide(self, canvas, scenario, index):
        def action(tool, **arguments):
            return {'reply': '', 'tool': tool, 'arguments': arguments}
        if scenario in {'text', 'recovery'}:
            values = ['已整理：女孩走进书店，读到一封旧信。'] if scenario == 'text' else ['第一步已保存', '第二步已保存']
            text = next(n['text'] for n in canvas['nodes'] if n['id'] == 'story')
            next_index = values.index(text) + 1 if text in values else 0
            if next_index < len(values):
                return action('propose_native_action', action='update', nodeId='story', patch={'text': values[next_index]})
        elif scenario == 'story':
            analysis = next((n for n in canvas['nodes'] if n.get('storyAnalysisOrigin')), None)
            if not analysis:
                return action('create_story_analysis', sourceNodeId='story', title='雨夜', style='暖色电影')
            if not analysis.get('storyAnalysisResult'):
                return action('propose_native_action', action='run', nodeId=analysis['id'], maxCalls=1)
            if not any(n['type'] in {'shot-table', 'smart-shot-table'} for n in canvas['nodes']):
                return action('import_story_analysis', analysisNodeId=analysis['id'])
        elif scenario == 'shot':
            table = next(n for n in canvas['nodes'] if n['id'] == 'table')['shotTableData']
            if table['rows'][0]['cells']['visual'] != '女孩在雨窗前读信':
                return action('propose_native_action', action='shot_edit', nodeId='table',
                              rowId='s1', columnId='visual', value='女孩在雨窗前读信')
            processor = next((n for n in canvas['nodes'] if n.get('shotPromptOrigin') and n['type'] in {'llm', 'smart-prompt'}), None)
            if not processor:
                return action('create_shot_prompts', tableId='table', rowIds=['s1'])
            if not processor.get('shotPromptResult'):
                return action('propose_native_action', action='run', nodeId=processor['id'], maxCalls=1)
            generator = next((n for n in canvas['nodes'] if n.get('shotTableOrigin') and n['type'] in {'generator', 'smart-image'}), None)
            if not generator:
                return action('create_shot_images', tableId='table', rowIds=['s1'])
            outputs = [n for n in canvas['nodes'] if n['id'] == generator['id'] or
                       any(c.get('from') == generator['id'] and c.get('to') == n['id'] for c in canvas['connections'])]
            if not any('/assets/output/creative-flow-result.png' in json.dumps(n.get('images', [])) for n in outputs):
                return action('propose_native_action', action='run', nodeId=generator['id'], maxCalls=1)
        return {'reply': '本地模拟验收完成，结果已保存。', 'tool': None, 'arguments': {}}

    async def agent(self, fields):
        await asyncio.sleep(0.1)
        serialized = json.dumps(fields, ensure_ascii=False)
        ids = [cid for cid in self.cases if f'流程验收 {cid}' in serialized]
        if len(ids) != 1:
            raise HTTPException(422, '验收必须明确对应唯一测试画布')
        cid = ids[0]
        assert (fields['provider'], fields['model']) == ('flow-mock', 'flow-text')
        index = self.positions[cid]
        canvas = self.main.load_canvas(cid)
        if self.read_versions.get(cid) != canvas['updated_at']:
            self.read_versions[cid] = canvas['updated_at']
            decision = {'reply': '', 'tool': 'read_canvas', 'arguments': {}}
        else:
            decision = self.decide(canvas, self.cases[cid]['scenario'], index)
        self.positions[cid] += 1
        self.calls.append({'kind': 'agent', 'canvasId': cid, 'index': index, 'tool': decision['tool']})
        return {'text': json.dumps(decision, ensure_ascii=False)}

    async def llm(self, payload: dict):
        # 只替换模型边界：节点输入及输出证明仍由真实前端适配器保存。
        assert (payload['provider'], payload['model']) == ('flow-mock', 'flow-text')
        self.calls.append({'kind': 'llm', 'payload': copy.deepcopy(payload)})
        text = json.dumps(story_fixture(), ensure_ascii=False) if 'JSON Schema' in payload.get('system_prompt', '') else '暖色电影画面，女孩在雨窗前读旧信，木书架和台灯，雨滴映光。'
        return {'text': text, 'model': 'flow-text'}

    async def image(self, payload):
        assert (payload.provider_id, payload.model) == ('flow-mock', 'flow-image')
        self.calls.append({'kind': 'image', 'payload': payload.model_dump()})
        return {'images': ['/assets/output/creative-flow-result.png']}

    async def evidence(self):
        return {'cases': [{k: v for k, v in c.items() if k != 'initial'} for c in self.cases.values()],
                'calls': self.calls, 'failedOnce': sorted(self.failed_once),
                'tasks': {tid: {'status': t['status']} for tid, t in self.main.CANVAS_TASKS.items()},
                'canvases': {cid: self.main.load_canvas(cid) for cid in self.cases}}

    def seed_images(self):
        media = self.root / 'media'
        (media / 'output').mkdir(parents=True, exist_ok=True)
        for name, color in [('old', '#b0c4de'), ('result', '#deb887')]:
            path = media / 'output' / f'creative-flow-{name}.png'
            Image.new('RGB', (320, 240), color).save(path)
        self.app.mount('/assets', StaticFiles(directory=media), name='flow-assets')
