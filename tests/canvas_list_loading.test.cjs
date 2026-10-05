const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const viewportSource = readFileSync(path.join(__dirname, '..', 'static/js/canvas-list-viewport.js'), 'utf8');
const source = readFileSync(path.join(__dirname, '..', 'static/js/canvas-list.js'), 'utf8');

function element(){
    const classes = new Set();
    const node = {
        children: [],
        className: '',
        dataset: {},
        listeners: new Map(),
        style: {},
        textContent: '',
        title: '',
        clientWidth: 1200,
        clientHeight: 700,
        offsetWidth: 248,
        offsetHeight: 150,
        classList: {
            add(name){ classes.add(name); },
            remove(name){ classes.delete(name); },
            contains(name){ return classes.has(name); },
            toggle(name, force){
                if(force === undefined ? !classes.has(name) : force) classes.add(name);
                else classes.delete(name);
            },
        },
        addEventListener(name, callback){ this.listeners.set(name, callback); },
        appendChild(child){ this.children.push(child); return child; },
        querySelector(){ return element(); },
        querySelectorAll(selector){
            return selector === '.ws-card'
                ? this.children.filter(child => child.className.includes('ws-card'))
                : [];
        },
        getBoundingClientRect(){ return {left: 0, top: 0}; },
        setAttribute(){},
    };
    Object.defineProperty(node, 'innerHTML', {
        get(){ return this._html || ''; },
        set(value){ this._html = value; this.children = []; },
    });
    return node;
}

function response(body, status = 200){
    return {ok: status >= 200 && status < 300, status, json: async()=>body};
}

async function workspace(initial){
    const nodes = new Map();
    const document = {
        getElementById(id){
            if(!nodes.has(id)) nodes.set(id, element());
            return nodes.get(id);
        },
        createElement: element,
        querySelector(){ return null; },
        querySelectorAll(){ return []; },
        addEventListener(){},
    };
    let api = initial;
    const fetch = async url => {
        if(url === '/api/projects') return api.projects;
        if(url === '/api/canvases') return api.canvases;
        if(url === '/api/canvases/trash') return response({canvases: []});
        throw new Error(`Unexpected request: ${url}`);
    };
    const StudioI18n = {
        lang: () => 'zh',
        apply(){},
        t: key => key === 'workspace.defaultProject' ? '默认项目' : key,
    };
    const context = vm.createContext({
        document,
        fetch,
        localStorage: {getItem(){ return null; }, setItem(){}},
        location: {origin: 'http://localhost'},
        window: {
            innerWidth: 1200,
            location: {search: ''},
            addEventListener(){},
            StudioI18n,
            document,
        },
        StudioI18n,
        URLSearchParams,
        setTimeout(){ return 1; },
        clearTimeout(){},
        console: {error(){}},
    });
    vm.runInContext(viewportSource, context, {filename: 'canvas-list-viewport.js'});
    vm.runInContext(source, context, {filename: 'canvas-list.js'});
    // The page calls loadAll() during boot. Let its response and rendering settle.
    await new Promise(resolve => setImmediate(resolve));
    return {
        node: id => document.getElementById(id),
        async reload(next){
            api = next;
            await document.getElementById('boardRefresh').listeners.get('click')();
        },
    };
}

const initial = {
    projects: response({projects: [{id: 'default', name: '默认项目', order: 0}]}),
    canvases: response({canvases: [{
        id: 'old', title: '旧画布', project: 'default', board_x: 40, board_y: 40,
    }]}),
};

function visibleCards(page){
    return page.node('boardWorld').querySelectorAll('.ws-card');
}

test('workspace keeps existing cards and shows a Chinese error when either API fails', async()=>{
    const page = await workspace(initial);
    assert.equal(visibleCards(page).length, 1);
    assert.match(visibleCards(page)[0].innerHTML, /旧画布/);
    assert.equal(page.node('boardCanvasCount').textContent, '1');

    for(const failed of ['projects', 'canvases']){
        await page.reload({
            projects: failed === 'projects' ? response({}, 503) : response({projects: []}),
            canvases: failed === 'canvases' ? response({}, 503) : response({canvases: []}),
        });
        assert.equal(visibleCards(page).length, 1);
        assert.match(visibleCards(page)[0].innerHTML, /旧画布/);
        assert.equal(page.node('boardCanvasCount').textContent, '1');
        assert.equal(page.node('boardEmptyHint').classList.contains('hidden'), true);
        assert.equal(page.node('boardStatus').textContent, '加载失败');
        assert.equal(page.node('boardStatus').classList.contains('show'), true);
    }
});

test('workspace rejects malformed data, then renders new cards after a successful refresh', async()=>{
    const page = await workspace(initial);
    await page.reload({
        projects: response({projects: []}),
        canvases: response({canvases: null}),
    });
    assert.equal(visibleCards(page).length, 1);
    assert.equal(page.node('boardStatus').textContent, '加载失败');

    await page.reload({
        projects: response({projects: [{id: 'default', name: '默认项目', order: 0}]}),
        canvases: response({canvases: [{
            id: 'new', title: '新画布', project: 'default', board_x: 80, board_y: 80,
        }]}),
    });
    assert.equal(visibleCards(page).length, 1);
    assert.match(visibleCards(page)[0].innerHTML, /新画布/);
    assert.doesNotMatch(visibleCards(page)[0].innerHTML, /旧画布/);
    assert.equal(page.node('boardCanvasCount').textContent, '1');
});

test('workspace loads the viewport module before the entry and keeps one listener owner', () => {
    const root = path.join(__dirname, '..');
    const html = readFileSync(path.join(root, 'static/canvas-list.html'), 'utf8');
    const moduleIndex = html.indexOf('/static/js/canvas-list-viewport.js');
    const entryIndex = html.indexOf('/static/js/canvas-list.js');
    const entry = readFileSync(path.join(root, 'static/js/canvas-list.js'), 'utf8');
    assert.ok(moduleIndex >= 0);
    assert.ok(entryIndex > moduleIndex);
    assert.doesNotMatch(entry, /function\s+onBoardPan(?:Start|Move|End)|function\s+onBoardWheel/);
    assert.doesNotMatch(entry, /board\.addEventListener\(['"]mousedown['"],\s*onBoardPanStart/);
    assert.match(entry, /viewportController\.bind\(\)/);
});
