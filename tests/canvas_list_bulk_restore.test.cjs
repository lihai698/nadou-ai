const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const viewportSource = readFileSync(path.join(root, 'static/js/canvas-list-viewport.js'), 'utf8');
const workspaceSource = readFileSync(path.join(root, 'static/js/canvas-list.js'), 'utf8');

function element(){
    const classes = new Set();
    const queries = new Map();
    const node = {
        children: [], dataset: {}, listeners: new Map(), style: {},
        className: '', textContent: '', checked: false, disabled: false,
        clientWidth: 1200, clientHeight: 700, offsetWidth: 248, offsetHeight: 150,
        classList: {
            add(name){ classes.add(name); },
            remove(name){ classes.delete(name); },
            contains(name){ return classes.has(name); },
            toggle(name, force){
                if(force === undefined ? !classes.has(name) : force) classes.add(name);
                else classes.delete(name);
            },
        },
        addEventListener(name, listener){ this.listeners.set(name, listener); },
        appendChild(child){ this.children.push(child); return child; },
        querySelector(selector){
            if(!queries.has(selector)) queries.set(selector, element());
            return queries.get(selector);
        },
        querySelectorAll(){ return []; },
        getBoundingClientRect(){ return {left: 0, top: 0}; },
        setAttribute(){},
    };
    Object.defineProperty(node, 'innerHTML', {
        get(){ return this._html || ''; },
        set(value){ this._html = value; this.children = []; queries.clear(); },
    });
    return node;
}

function response(body, status = 200){
    return {ok: status >= 200 && status < 300, status, json: async()=>body};
}

async function workspace({failedIds = [], beforeRestore = async()=>{}, failTrashRefresh = false, removeFailed = false} = {}){
    const nodes = new Map();
    const document = {
        getElementById(id){
            if(!nodes.has(id)) nodes.set(id, element());
            return nodes.get(id);
        },
        createElement: element,
        querySelector(){ return null; }, querySelectorAll(){ return []; }, addEventListener(){},
    };
    const trash = [
        {id:'a', title:'第一块', project:'default'},
        {id:'b', title:'第二块', project:'default'},
    ];
    const canvases = [];
    const restoreCalls = [];
    const fetch = async (url, options = {}) => {
        if(url === '/api/projects') return response({projects:[{id:'default', name:'默认项目'}]});
        if(url === '/api/canvases') return response({canvases});
        if(url === '/api/canvases/trash') return failTrashRefresh && restoreCalls.length
            ? response({}, 503) : response({canvases:trash.slice()});
        const match = /^\/api\/canvases\/([^/]+)\/restore$/.exec(url);
        if(match && options.method === 'POST'){
            const id = decodeURIComponent(match[1]);
            restoreCalls.push(id);
            await beforeRestore(id);
            if(failedIds.includes(id)){
                if(removeFailed){
                    const index = trash.findIndex(canvas => canvas.id === id);
                    if(index >= 0) trash.splice(index, 1);
                }
                return response({}, 503);
            }
            const index = trash.findIndex(canvas => canvas.id === id);
            if(index >= 0) canvases.push(trash.splice(index, 1)[0]);
            return response({ok:true});
        }
        throw new Error(`Unexpected request: ${url}`);
    };
    const StudioI18n = {lang:()=> 'zh', apply(){}, t:key => key};
    const context = vm.createContext({
        document, fetch, StudioI18n, URLSearchParams,
        localStorage:{getItem(){ return null; }, setItem(){}},
        location:{origin:'http://localhost'},
        window:{innerWidth:1200, location:{search:''}, StudioI18n, document, addEventListener(){}},
        setTimeout(){ return 1; }, clearTimeout(){}, console:{error(){}},
    });
    vm.runInContext(viewportSource, context);
    vm.runInContext(workspaceSource, context);
    await new Promise(resolve => setImmediate(resolve));
    await vm.runInContext('loadTrash()', context);
    return {node:id => document.getElementById(id), trash, restoreCalls};
}

test('selected trash canvases restore through the existing endpoint and update the board', async()=>{
    const page = await workspace();
    assert.equal(page.node('trashRestoreSelected').disabled, true);
    const firstCard = page.node('trashList').children[0];
    firstCard.querySelector('.ws-trash-select input').onchange({target:{checked:true}});
    assert.equal(page.node('trashRestoreSelectedLabel').textContent, '恢复所选 (1)');
    assert.equal(page.node('trashSelectAll').indeterminate, true);
    page.node('trashSelectAll').checked = true;
    page.node('trashSelectAll').listeners.get('change')();
    assert.equal(page.node('trashRestoreSelected').disabled, false);
    assert.equal(page.node('trashRestoreSelectedLabel').textContent, '恢复所选 (2)');

    await page.node('trashRestoreSelected').listeners.get('click')();
    assert.deepEqual(page.restoreCalls, ['a', 'b']);
    assert.equal(page.trash.length, 0);
    assert.equal(page.node('trashRestoreSelected').disabled, true);
    assert.equal(page.node('trashBadge').textContent, '0');
    assert.equal(page.node('boardCanvasCount').textContent, '2');
    assert.equal(page.node('boardStatus').textContent, '已恢复 2 个画布');
});

test('partial failure keeps only the failed canvas selected and blocks duplicate submissions', async()=>{
    let releaseFirst;
    const firstPending = new Promise(resolve => { releaseFirst = resolve; });
    const page = await workspace({failedIds:['b'], beforeRestore:id => id === 'a' ? firstPending : Promise.resolve()});
    page.node('trashSelectAll').checked = true;
    page.node('trashSelectAll').listeners.get('change')();

    const first = page.node('trashRestoreSelected').listeners.get('click')();
    assert.equal(page.node('trashRestoreSelected').disabled, true);
    await page.node('trashRestoreSelected').listeners.get('click')();
    assert.deepEqual(page.restoreCalls, ['a']);
    releaseFirst();
    await first;

    assert.deepEqual(page.restoreCalls, ['a', 'b']);
    assert.deepEqual(page.trash.map(canvas => canvas.id), ['b']);
    assert.equal(page.node('trashRestoreSelectedLabel').textContent, '恢复所选 (1)');
    assert.equal(page.node('trashRestoreSelected').disabled, false);
    assert.equal(page.node('boardStatus').textContent, '已恢复 1 个，失败 1 个；可重试剩余项');
});

test('a failed list refresh is reported after confirmed restores', async()=>{
    const page = await workspace({failTrashRefresh:true});
    page.node('trashSelectAll').checked = true;
    page.node('trashSelectAll').listeners.get('change')();
    await page.node('trashRestoreSelected').listeners.get('click')();
    assert.deepEqual(page.restoreCalls, ['a', 'b']);
    assert.equal(page.node('boardStatus').textContent, '已恢复 2 个，失败 0 个；列表刷新失败，请手动刷新');
});

test('removed items are not offered for retry after a failed restore request', async()=>{
    const page = await workspace({failedIds:['b'], removeFailed:true});
    page.node('trashSelectAll').checked = true;
    page.node('trashSelectAll').listeners.get('change')();
    await page.node('trashRestoreSelected').listeners.get('click')();
    assert.equal(page.node('trashRestoreSelected').disabled, true);
    assert.equal(page.node('boardStatus').textContent, '已恢复 1 个，失败 1 个；请检查结果');
});
