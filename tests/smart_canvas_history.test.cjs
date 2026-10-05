// Execute the production history functions and keyboard handler, without a DOM
// or network. Browser rendering and persistence are checked separately in UI.
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

const source = readFileSync(path.join(__dirname, '../static/js/smart-canvas.js'), 'utf8');
function section(start, end) {
    const first = source.indexOf(start);
    const last = source.indexOf(end, first);
    assert.ok(first >= 0 && last > first, `Production section missing: ${start}`);
    return source.slice(first, last);
}
function editor() {
    const context = vm.createContext({});
    vm.runInContext(`
        let nodes = [{id:'prompt', type:'smart-prompt', text:'中文'}];
        let canvas = {connections:[]};
        let selectedId = 'prompt', selectedIds = [], selectedImage = {nodeId:'', index:-1};
        let activeComposerSubject = null, lastComposerNodeId = '', saveTimer = null;
        const imageEditModal = {classList:{contains:() => false}};
        const handlers = {};
        const window = {addEventListener:(name, fn) => {handlers[name] = fn;}};
        const isEditableTarget = target => Boolean(target?.editable);
        const notices = [];
        const toast = text => notices.push(text);
        const tr = key => key;
        const render = () => {};
        const canvasId = 'test', canvasDefaultSmartSettings = {}, initialSmartSettings = {};
        const viewport = {}, smartClientId = 'test';
        let canvasSyncInFlight = false;
        let canvasSaveQueued = false;
        const savePromptDraftForCurrent = () => {};
        const stripImageGenerationMeta = value => value;
        const mediaItemForStorage = value => value;
        const settingsForStorage = value => value;
        const canvasForStorage = () => canvas;
        function rememberServerCanvasNodes() {}
        const saveError = {hidden:true};
        const document = {getElementById:id => id === 'canvasSaveError' ? saveError : null};
        let fetch = async () => ({ok:true,json:async () => ({})});
        const clearTimeout = () => {};
        const setTimeout = () => 1;
    `, context);
    vm.runInContext(section('const UNDO_LIMIT =', 'let comfyWorkflowCache ='), context);
    vm.runInContext(section('function scheduleSave(){', 'async function saveCanvas(){'), context);
    vm.runInContext(section('async function saveCanvas(){', 'function imageMetaFromNode('), context);
    vm.runInContext(section("window.addEventListener('keydown', e => {", "window.addEventListener('keyup',"), context);
    return {
        context,
        run: code => vm.runInContext(code, context),
        state: () => JSON.parse(vm.runInContext('JSON.stringify(snapshotForUndo())', context)),
        key: (shift = false, editable = false, meta = false) => vm.runInContext(`
            handlers.keydown({key:'z',ctrlKey:${!meta},metaKey:${meta},shiftKey:${shift},
                target:{editable:${editable}},preventDefault(){}});
        `, context),
    };
}
function mergeEditor() {
    const e = editor();
    e.run(`
        let canvasBaseNodes = new Map();
        const smartNodeHasCompletedResult = () => false;
        const smartNodeInFlight = () => false;
        const completeSmartNodeWithImages = (node, images) => ({...node, images});
        const smartNodeHasDisplayResult = () => false;
        const smartPendingTasks = () => [];
        const clearCompletedNodeBusyStates = () => false;
        const recoverStuckLoopOutputsFromLogs = () => false;
        const scheduleConnectionLayerRefresh = () => {};
        const resumeSmartPendingTasks = () => {};
        const resumeJimengPendingNodes = () => {};
        const normalizeLegacySmartNode = node => node;
        const uid = prefix => prefix + '_conflict_copy';
    `);
    const context = e.context;
    vm.runInContext(section('function mergeSmartImageLists(', 'function smartNodeInFlight('), context);
    vm.runInContext(section('function mergeSmartNode(', 'async function mergeReloadCanvasNow()'), context);
    return e;
}

test('a stale save merges different edits to the same node', async () => {
    const e = mergeEditor();
    e.run(`
        canvas.updated_at = 10;
        nodes[0].x = 0;
        nodes[0].text = '原文';
        const originalNode = JSON.parse(JSON.stringify(nodes[0]));
        rememberServerCanvasNodes({nodes:[originalNode]});
        nodes[0].text = '本地文字';
        let sent = [];
        fetch = async (_url, options) => {
            sent.push(JSON.parse(options.body));
            if(sent.length === 1) return {ok:false,status:409,json:async () => ({detail:{canvas:{updated_at:11,title:'画布',nodes:[{...originalNode,x:100}],connections:[]}}})};
            return {ok:true,json:async () => ({canvas:{updated_at:12}})};
        };
    `);
    assert.equal(await e.run('saveCanvas()'), false);
    assert.equal(e.run('nodes[0].text'), '本地文字');
    assert.equal(e.run('nodes[0].x'), 100);
    assert.equal(await e.run('saveCanvas()'), true);
    assert.equal(e.run('sent[1].nodes[0].text'), '本地文字');
});

test('a metadata conflict at the same updated_at keeps local nodes and adopts the new title', async () => {
    const e = mergeEditor();
    e.run(`
        canvas.id = 'test';
        canvas.updated_at = 10;
        canvas.meta_revision = 0;
        canvas.title = '旧标题';
        canvas.icon = 'layers';
        let sent = [];
        fetch = async (_url, options) => {
            sent.push(JSON.parse(options.body));
            if(sent.length === 1) return {ok:false,status:409,json:async () => ({detail:{
                reason:'meta_conflict',
                canvas:{id:'test',updated_at:10,meta_revision:1,title:'新标题',icon:'star',
                    nodes:[{id:'prompt',type:'smart-prompt',text:'中文'}],connections:[]}
            }})};
            return {ok:true,json:async () => ({canvas:{updated_at:11,meta_revision:1,
                title:'新标题',icon:'star',nodes:sent[1].nodes}})};
        };
    `);
    assert.equal(await e.run('saveCanvas()'), false);
    assert.equal(e.run('canvas.title'), '新标题');
    assert.equal(e.run('canvas.icon'), 'star');
    assert.equal(e.run('canvas.meta_revision'), 1);
    assert.equal(await e.run('saveCanvas()'), true);
    assert.equal(e.run('sent[0].base_meta_revision'), 0);
    assert.equal(e.run('sent[1].base_meta_revision'), 1);
    assert.equal(e.run('sent[1].title'), '新标题');
    assert.equal(e.run('sent[1].nodes[0].id'), 'prompt');
});

test('a stale save keeps both versions when the same node field changed twice', async () => {
    const e = mergeEditor();
    e.run(`
        canvas.updated_at = 10;
        nodes[0].x = 0;
        nodes[0].text = '原文';
        rememberServerCanvasNodes({nodes});
        nodes[0].text = '本地文字';
        let sent = [];
        fetch = async (_url, options) => {
            sent.push(JSON.parse(options.body));
            if(sent.length === 1) return {ok:false,status:409,json:async () => ({detail:{canvas:{updated_at:11,title:'画布',nodes:[{id:'prompt',type:'smart-prompt',text:'服务端文字',x:0}],connections:[]}}})};
            return {ok:true,json:async () => ({canvas:{updated_at:12}})};
        };
    `);
    await e.run('saveCanvas()');
    assert.equal(e.run('nodes.length'), 2);
    assert.equal(e.run('nodes[0].text'), '服务端文字');
    assert.equal(e.run('nodes[1].text'), '本地文字');
    assert.match(e.run('nodes[1].title'), /冲突副本/);
    assert.ok(Math.abs(e.run('nodes[1].x - nodes[0].x')) >= 316);
    assert.match(e.run('notices.at(-1)'), /冲突副本/);
    await e.run('saveCanvas()');
    assert.deepEqual(Array.from(e.run('sent[1].nodes'), node => node.text), ['服务端文字', '本地文字']);
    assert.equal(e.run('sent[1].base_updated_at'), 11);
});

test('a 409 without a usable server canvas stops retrying and keeps local edits', async () => {
    const e = mergeEditor();
    e.run(`
        canvas.updated_at = 10;
        nodes[0].text = '本地文字';
        let putCount = 0;
        let getCount = 0;
        fetch = async (_url, options) => {
            if(!options){ getCount++; return {ok:false,status:503}; }
            putCount++;
            return {ok:false,status:409,json:async () => ({detail:{updated_at:11}})};
        };
    `);
    await e.run('saveCanvas()');
    assert.equal(e.run('saveError.hidden'), false);
    assert.equal(e.run('nodes[0].text'), '本地文字');
    assert.equal(e.run('canvas.updated_at'), 10);
    assert.equal(e.run('canvasSaveQueued'), false);
    assert.equal(e.run('putCount'), 1);
    assert.equal(e.run('getCount'), 1);
});
function addLoop(e) {
    e.run("pushUndo(); nodes.push({id:'loop',type:'smart-loop',count:3}); selectedId='loop'; scheduleSave();");
}
function connect(e) {
    e.run("pushUndo(); canvas.connections.push({from:'prompt',to:'loop'}); scheduleSave();");
}

test('Ctrl+Shift+Z restores the undone link instead of removing the loop', () => {
    const e = editor();
    addLoop(e);
    connect(e);
    const complete = e.state();
    e.key();
    assert.equal(e.state().connections.length, 0);
    assert.equal(e.state().nodes.length, 2);
    e.key(true);
    assert.deepEqual(e.state(), complete);
    e.key();
    assert.equal(e.state().connections.length, 0);
    assert.equal(e.state().nodes.length, 2);
});

test('redo with no redo history leaves the canvas and undo history intact', () => {
    const e = editor();
    addLoop(e);
    const before = e.state();
    e.key(true);
    assert.deepEqual(e.state(), before);
    e.key();
    assert.equal(e.state().nodes.length, 1);
});

test('a new edit after undo invalidates the old redo branch', () => {
    const e = editor();
    addLoop(e);
    e.key();
    e.run("pushUndo(); nodes[0].text='新分支'; scheduleSave();");
    const edited = e.state();
    e.key(true);
    assert.deepEqual(e.state(), edited);
});

test('a committed drag after undo invalidates redo', () => {
    const e = editor();
    addLoop(e);
    e.key();
    e.run('capturePendingUndo(); nodes[0].x=150; commitPendingUndo(); scheduleSave();');
    const moved = e.state();
    e.key(true);
    assert.deepEqual(e.state(), moved);
    e.key();
    assert.equal(e.state().nodes[0].x, undefined);
});

test('a cancelled gesture preserves redo', () => {
    const e = editor();
    addLoop(e);
    e.key();
    e.run('capturePendingUndo(); discardPendingUndo(); scheduleSave();');
    e.key(true);
    assert.equal(e.state().nodes.length, 2);
});

test('saving a field edit without an undo checkpoint cannot replay stale redo', () => {
    const e = editor();
    addLoop(e);
    e.key();
    e.run("nodes[0].text='撤销后输入的新文字'; scheduleSave();");
    const edited = e.state();
    e.key(true);
    assert.deepEqual(e.state(), edited);
});

test('saving viewport and selection changes preserves redo', () => {
    const e = editor();
    addLoop(e);
    e.key();
    e.run("canvas.viewport={x:120,y:60,scale:0.8}; selectedId=''; selectedIds=[]; scheduleSave();");
    e.key(true);
    assert.equal(e.state().nodes.length, 2);
    assert.equal(e.run('canvas.viewport.scale'), 0.8);
});

test('automatic save normalization after undo preserves redo during later viewport saves', async () => {
    const e = editor();
    addLoop(e);
    e.key();
    assert.equal(e.state().nodes[0].images, undefined);
    await e.run('saveCanvas()');
    assert.deepEqual(e.state().nodes[0].images, []);
    e.run('canvas.viewport={scale:0.7}; scheduleSave();');
    e.key(true);
    assert.equal(e.state().nodes.length, 2);
});

test('automatic save does not accept a content edit as the redo baseline', async () => {
    const e = editor();
    addLoop(e);
    e.key();
    e.run("nodes[0].text='新编辑';");
    await e.run('saveCanvas()');
    e.run('scheduleSave();');
    e.key(true);
    assert.equal(e.state().nodes.length, 1);
    assert.equal(e.state().nodes[0].text, '新编辑');
});

test('HTTP save failure stays visible until a successful retry', async () => {
    const e = editor();
    e.run('fetch = async () => ({ok:false,status:503})');
    assert.equal(await e.run('saveCanvas()'), false);
    assert.equal(e.run('saveError.hidden'), false);
    e.run('fetch = async () => ({ok:true,json:async () => ({canvas:{updated_at:123}})})');
    assert.equal(await e.run('saveCanvas()'), true);
    assert.equal(e.run('saveError.hidden'), true);
});

test('network save failure is visible and keeps the local edit', async () => {
    const e = editor();
    e.run("nodes[0].text='尚未保存的中文内容'; fetch = async () => {throw new Error('offline')}");
    await e.run('saveCanvas()');
    assert.equal(e.run('saveError.hidden'), false);
    assert.equal(e.state().nodes[0].text, '尚未保存的中文内容');
});

test('an edit during saving waits and sends the newest content after the first response', async () => {
    const e = editor();
    e.run(`
        let completeFirst;
        let sent = [];
        fetch = (_url, options) => {
            sent.push(JSON.parse(options.body));
            return new Promise(resolve => {completeFirst = resolve});
        };
    `);
    const first = e.run('saveCanvas()');
    e.run("nodes[0].text='保存期间的新编辑'; scheduleSave(); saveCanvas();");
    assert.equal(e.run('sent.length'), 1);
    e.run('completeFirst({ok:true,json:async () => ({canvas:{updated_at:123}})})');
    await first;
    e.run('fetch = (_url, options) => {sent.push(JSON.parse(options.body)); return Promise.resolve({ok:true,json:async () => ({})})}');
    await e.run('saveCanvas()');
    assert.equal(e.run('sent[1].nodes[0].text'), '保存期间的新编辑');
    assert.equal(e.run('sent[1].base_updated_at'), 123);
});

test('editable text fields keep their native undo and redo shortcuts', () => {
    const e = editor();
    addLoop(e);
    const before = e.state();
    e.key(false, true);
    e.key(true, true);
    assert.deepEqual(e.state(), before);
});

test('Command+Shift+Z restores nested fields and selection without aliasing history', () => {
    const e = editor();
    e.run("pushUndo(); nodes[0].settings={nested:{count:7}}; selectedIds=['prompt']; selectedImage={nodeId:'prompt',index:2}; scheduleSave();");
    const changed = e.state();
    e.key(false, false, true);
    e.key(true, false, true);
    assert.deepEqual(e.state(), changed);
    e.key(false, false, true);
    e.key(true, false, true);
    assert.deepEqual(e.state(), changed);
});

test('undo and redo respect the existing 40 step history limit', () => {
    const e = editor();
    e.run('for(let i=1;i<=45;i++){pushUndo();nodes[0].x=i;scheduleSave();}');
    for(let i=0;i<45;i++) e.key();
    assert.equal(e.state().nodes[0].x, 5);
    for(let i=0;i<45;i++) e.key(true);
    assert.equal(e.state().nodes[0].x, 45);
});
