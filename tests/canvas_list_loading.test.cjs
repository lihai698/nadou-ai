const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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

test('workspace uses a six-column selection panel without board pan or zoom handlers', () => {
    const root = path.join(__dirname, '..');
    const html = readFileSync(path.join(root, 'static/canvas-list.html'), 'utf8');
    const css = readFileSync(path.join(root, 'static/css/canvas-list.css'), 'utf8');
    assert.match(html, /ws-selection-panel/);
    assert.doesNotMatch(html, /id="newSmartCanvasBtn"/);
    assert.match(source, /data-kind="smart"/);
    assert.match(css, /grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
    assert.doesNotMatch(source, /viewportController|board\.addEventListener\(['"]wheel/);
});

test('workspace aligns saved, overlapping and new canvases in the same grid', async()=>{
    const page = await workspace({
        projects: initial.projects,
        canvases: response({canvases: Array.from({length: 7}, (_, index) => ({
            id: String(index), title: `画布 ${index}`, project: 'default',
            kind: index % 2 ? 'smart' : 'classic',
            board_x: index === 6 ? null : -900 + index * 9,
            board_y: index === 6 ? null : 5000,
        }))}),
    });
    const cards = visibleCards(page);
    assert.equal(cards.length, 7);
    assert.ok(cards.every(card => card.style.left === undefined && card.style.top === undefined));
});


test('initial list stays concealed until the pending API response is rendered', async()=>{
    let resolveCanvases;
    const pending = new Promise(resolve => { resolveCanvases = resolve; });
    const page = await workspace({projects: initial.projects, canvases: pending});
    assert.notEqual(page.node('workspace').style.visibility, 'visible');
    resolveCanvases(initial.canvases);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(visibleCards(page).length, 1);
    assert.equal(page.node('boardCanvasCount').textContent, '1');
    assert.equal(page.node('boardEmptyHint').classList.contains('hidden'), true);
    assert.equal(page.node('workspace').style.visibility, 'visible');
});

test('a genuine empty project appears only after a successful response', async()=>{
    const page = await workspace({projects: initial.projects, canvases: response({canvases: []})});
    assert.equal(page.node('boardCanvasCount').textContent, '0');
    assert.equal(page.node('boardEmptyHint').classList.contains('hidden'), false);
    assert.equal(page.node('workspace').style.visibility, 'visible');
});

test('initial load failure shows a retry state instead of claiming there are no canvases', async()=>{
    const page = await workspace({projects: initial.projects, canvases: response({}, 503)});
    assert.equal(page.node('boardLoadError').classList.contains('hidden'), false);
    assert.equal(page.node('boardEmptyHint').classList.contains('hidden'), true);
    assert.equal(page.node('workspace').style.visibility, 'visible');
    await page.reload(initial);
    assert.equal(page.node('boardLoadError').classList.contains('hidden'), true);
    assert.equal(visibleCards(page).length, 1);
});
