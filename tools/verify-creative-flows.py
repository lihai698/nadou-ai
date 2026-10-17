"""启动两种画布的八项本地模拟验收；不读取私人配置、不调用真实供应商。"""

import argparse
import importlib
import json
from pathlib import Path
import runpy
import socket
import sys
import urllib.request


ROOT = Path(__file__).resolve().parents[1]


def verify(evidence):
    cases = evidence['cases']
    expected = {(kind, scenario) for kind in ('classic', 'smart')
                for scenario in ('text', 'story', 'shot', 'recovery')}
    assert len(cases) == 8 and {(c['kind'], c['scenario']) for c in cases} == expected, '缺少八项案例'
    checked = []
    for case in cases:
        canvas = evidence['canvases'][case['id']]
        nodes = canvas['nodes']
        source = next(n for n in nodes if n['id'] == 'story')
        scenario = case['scenario']
        turns = evidence['turns'][case['id']]
        assert len(turns) == 1 and turns[0]['state'] == 'completed', '原回合尚未完成或发生重复回合'
        assert all(a['state'] == 'completed' for a in turns[0]['actions']), '存在未完成或重复的原生动作'
        if scenario in {'story', 'shot'}:
            authorization = turns[0]['authorization'] or {}
            expected_runs = 1 if scenario == 'story' else 2
            assert authorization.get('limit') == authorization.get('used') == expected_runs, '节点调用授权次数异常'
        if scenario == 'text':
            assert source['text'] == '已整理：女孩走进书店，读到一封旧信。' and len(nodes) == 1, '文本未正确保存'
        elif scenario == 'recovery':
            assert source['text'] == '第二步已保存' and len(nodes) == 1, '中断后未正确续行'
            assert case['id'] in evidence['failedOnce'], '缺少真实故障注入'
        elif scenario == 'story':
            assert source['text'] == '女孩走进书店。她读着旧信。', '原故事被改写'
            table = next(n for n in nodes if n['type'] in {'shot-table', 'smart-shot-table'})
            assert len(table['shotTableData']['rows']) == 2, '分镜结果不完整'
            analysis = next(n for n in nodes if n.get('storyAnalysisOrigin'))
            assert analysis.get('storyAnalysisResult', {}).get('outputText'), '缺少原生模型结果证明'
        elif scenario == 'shot':
            table = next(n for n in nodes if n['id'] == 'table')['shotTableData']
            assert table['rows'][0]['cells']['visual'] == '女孩在雨窗前读信', '第一镜未修改'
            assert table['rows'][1]['cells']['visual'] == '女孩离开书店', '其他镜头被改写'
            old_image = next(n for n in nodes if n['id'] == 'old-image')
            assert '/assets/output/creative-flow-old.png' in json.dumps(old_image), '旧图被替换'
            processor = next(n for n in nodes if n.get('shotPromptOrigin') and n['type'] in {'llm', 'smart-prompt'})
            assert processor.get('shotPromptResult', {}).get('outputText'), '缺少逐镜模型结果证明'
            assert '女孩在雨窗前读信' in processor['shotPromptResult']['sourceText'], '未使用修改后的单镜输入'
            generator = next(n for n in nodes if n.get('shotTableOrigin') and n['type'] in {'generator', 'smart-image'})
            run = generator.get('assistantNativeRun', {})
            assert run.get('taskIds') and all(evidence['tasks'].get(tid, {}).get('status') == 'succeeded'
                for tid in run['taskIds']), '配图任务未完成'
            assert '/assets/output/creative-flow-result.png' in json.dumps(nodes), '图片结果未保存'
            assert any(c.get('from') == processor['id'] and c.get('to') == generator['id'] for c in canvas['connections']), '配图未连接模型结果'
            assert any(c['kind'] == 'image' and c['payload']['prompt'] == processor['shotPromptResult']['outputText']
                       for c in evidence['calls']), '最终图片请求未使用模型结果'
        agent_calls = [c for c in evidence['calls'] if c['kind'] == 'agent' and c['canvasId'] == case['id']]
        effects = [c['tool'] for c in agent_calls if c['tool'] != 'read_canvas']
        expected_tools = {'text': ['propose_native_action', None],
            'recovery': ['propose_native_action', 'propose_native_action', None],
            'story': ['create_story_analysis', 'propose_native_action', 'import_story_analysis', None],
            'shot': ['propose_native_action', 'create_shot_prompts', 'propose_native_action',
                     'create_shot_images', 'propose_native_action', None]}[scenario]
        assert effects == expected_tools, '重复执行或未完成原回合'
        checked.append(f'{case["kind"]}/{scenario}')
    assert len([c for c in evidence['calls'] if c['kind'] == 'llm']) == 4, '文本节点调用次数异常'
    assert len([c for c in evidence['calls'] if c['kind'] == 'image']) == 2, '图片调用次数异常'
    return checked


def main():
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, 'reconfigure'):
            stream.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace', type=Path, required=True, help='必须是不存在的新目录')
    parser.add_argument('--port', type=int, default=3063)
    parser.add_argument('--verify', action='store_true', help='只读核对正在运行的八项案例，并保存证据')
    args = parser.parse_args()
    if args.verify:
        if not (args.workspace / 'cases.json').is_file():
            parser.error('验收目录缺少 cases.json，不能写入其他目录')
        with urllib.request.urlopen(f'http://127.0.0.1:{args.port}/creative-flow-evidence', timeout=15) as response:
            evidence = json.load(response)
        saved_cases = json.loads((args.workspace / 'cases.json').read_text(encoding='utf-8'))
        assert {c['id'] for c in saved_cases} == {c['id'] for c in evidence['cases']}, '服务与验收目录不匹配'
        evidence['turns'] = {}
        for path in (args.workspace / 'data' / 'assistant').rglob('*.json'):
            if path.stem not in evidence['canvases']:
                continue
            document = json.loads(path.read_text(encoding='utf-8'))
            evidence['turns'][path.stem] = [
                {'id': turn['id'], 'state': turn['state'], 'authorization': turn.get('authorization'),
                 'actions': [{'id': action['id'], 'action': action['action'], 'state': action['state']}
                             for action in turn.get('nativeActions', [])]}
                for session in document['sessions'].values() for turn in session.get('turns', [])]
        checked = verify(evidence)
        target = args.workspace / 'verified.json'
        target.write_text(json.dumps({'passed': checked, 'evidence': evidence}, ensure_ascii=False, indent=2), encoding='utf-8')
        print(f'八项本地模拟验收通过：{target}')
        return
    if args.workspace.exists():
        parser.error('验收目录已存在，请指定新目录以保留已有成果')
    if not 1024 <= args.port <= 65535:
        parser.error('端口必须在 1024–65535 之间')
    with socket.socket() as probe:
        if sys.platform == 'win32':
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        probe.bind(('127.0.0.1', args.port))
    workspace = args.workspace.resolve()
    source = workspace / 'source'
    source.mkdir(parents=True)
    check = runpy.run_path(str(ROOT / 'tools' / 'check-core.py'))
    check['prepare_python_sandbox'](source)
    sys.path.insert(0, str(source))
    main_module = importlib.import_module('main')
    from tests.creative_flow_fixture import CreativeFlowFixture
    fixture = CreativeFlowFixture(main_module, workspace / 'data')
    fixture.seed_images()
    cases = []
    for kind in ('classic', 'smart'):
        for scenario in ('text', 'story', 'shot', 'recovery'):
            case = fixture.create(kind, scenario)
            case = {k: v for k, v in case.items() if k != 'initial'}
            case['url'] = f'http://127.0.0.1:{args.port}/static/{"smart-canvas" if kind == "smart" else "canvas"}.html?id={case["id"]}'
            cases.append(case)
    (workspace / 'cases.json').write_text(json.dumps(cases, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'八项验收案例：{workspace / "cases.json"}', flush=True)
    print(f'只读证据：http://127.0.0.1:{args.port}/creative-flow-evidence', flush=True)
    import uvicorn
    try:
        uvicorn.run(fixture.app, host='127.0.0.1', port=args.port, ws_ping_interval=None)
    finally:
        fixture.close()


if __name__ == '__main__':
    main()
