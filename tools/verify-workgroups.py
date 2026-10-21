"""Serve isolated real workgroup canvases with local mock generation only."""
import argparse
import importlib
import json
from pathlib import Path
import runpy
import sys
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace', type=Path, required=True)
    parser.add_argument('--port', type=int, default=3067)
    args = parser.parse_args()
    if args.workspace.exists():
        parser.error('Use a new directory to preserve existing verification data')
    source = args.workspace.resolve() / 'source'
    source.mkdir(parents=True)
    runpy.run_path(str(ROOT / 'tools/check-core.py'))['prepare_python_sandbox'](source)
    sys.path.insert(0, str(source))
    app_main = importlib.import_module('main')
    from tests.creative_flow_fixture import CreativeFlowFixture
    fixture = CreativeFlowFixture(app_main, args.workspace.resolve() / 'data')
    fixture.seed_images()
    # All paths point to this disposable public-code sandbox, never the user's data.
    for name, path in {'ASSET_LIBRARY_DIR':'library','OUTPUT_INPUT_DIR':'input',
                       'OUTPUT_OUTPUT_DIR':'output','LOCAL_UPLOAD_DIR':'uploads'}.items():
        value = fixture.root / 'media' / path
        value.mkdir(parents=True, exist_ok=True)
        item = patch.object(app_main, name, str(value))
        item.start()
        fixture.patches.append(item)
    fixture.app.user_middleware.clear()
    from fastapi.responses import JSONResponse
    @fixture.app.middleware('http')
    async def guard(request, call_next):
        path = request.url.path
        allowed = ('/api/canvases', '/api/canvas-image-tasks', '/api/canvas-workflows/',
                   '/api/asset-library', '/api/local-assets/upload')
        if request.method not in {'GET','HEAD'} and not (
            path.startswith(allowed) or path in {'/api/canvas-llm','/api/canvas-assets/download'}):
            return JSONResponse({'detail':'Only isolated workgroup verification is enabled'}, status_code=451)
        return await call_next(request)
    cases = []
    for kind in ('classic','smart'):
        case = fixture.create(kind, 'text')
        canvas = app_main.load_canvas(case['id'])
        smart = kind == 'smart'
        canvas['nodes'] = [
            {'id':'p','type':'smart-prompt' if smart else 'prompt','x':120,'y':160,
             'w':260,'h':200,'title':'人物提示词','text':'女孩站在书店门前，暖色电影灯光','nodeTag':'人物'},
            {'id':'i','type':'smart-image' if smart else 'image','x':450,'y':160,
             'w':260,'h':200,'title':'参考画面',**({'images':[{'url':'/assets/output/creative-flow-old.png'}]} if smart else {'url':'/assets/output/creative-flow-old.png'})},
            {'id':'p2','type':'smart-prompt' if smart else 'prompt','x':120,'y':440,
             'w':280,'h':180,'title':'运动提示词','text':'镜头缓缓推近，人物抬头微笑'},
            {'id':'i2','type':'smart-image' if smart else 'image','x':450,'y':440,
             'w':220,'h':210,'title':'场景',**({'images':[{'url':'/assets/output/creative-flow-result.png'}]} if smart else {'url':'/assets/output/creative-flow-result.png'})},
        ]
        canvas['viewport']={'x':30,'y':30,'scale':0.8}
        canvas['connections']=[]
        app_main.save_canvas(canvas)
        cases.append({'id':case['id'],'kind':kind,'url':f'http://127.0.0.1:{args.port}/static/{"smart-canvas" if smart else "canvas"}.html?id={case["id"]}'})
    (args.workspace / 'cases.json').write_text(json.dumps(cases,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(cases,ensure_ascii=True),flush=True)
    import uvicorn
    try:
        uvicorn.run(fixture.app,host='127.0.0.1',port=args.port,ws_ping_interval=None)
    finally:
        fixture.close()

if __name__ == '__main__':
    main()
