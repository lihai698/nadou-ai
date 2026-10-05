const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = readFileSync(path.join(__dirname, '../static/js/canvas.js'), 'utf8');
function section(begin, end){
    const start = source.indexOf(begin);
    const stop = source.indexOf(end, start);
    assert.ok(start >= 0 && stop > start, `Missing production section: ${begin}`);
    return source.slice(start, stop);
}

test('classic canvas retries a same-time metadata conflict with the server title', async()=>{
    const sent = [];
    const nodes = [{id:'edited',type:'text'}];
    const currentCanvasTitle = {textContent:'旧标题'};
    const context = vm.createContext({
        canvas:{id:'isolated',title:'旧标题',icon:'layers',updated_at:2000,meta_revision:0,logs:[]},
        nodes, connections:[], viewport:{x:0,y:0,scale:1},
        applyingRemoteCanvas:false, savingCanvasNow:false, saveCanvasAgain:false,
        localCanvasDirty:true, lastCanvasUpdatedAt:2000, saveTimer:null,
        currentCanvasTitle, currentCanvasTime:{textContent:''}, CLIENT_ID:'test',
        sanitizeConnections(){}, serializableCanvasNodes(){return nodes;},
        setStatus(){}, tr:key=>key, formatCanvasTime:()=>'',
        clearUnsavedCanvasAcceptedTasks(){}, clearUnsavedCanvasUnknownWarnings(){},
        loadCanvasList:async()=>{}, setTimeout:()=>0,
        fetch:async(_url, options)=>{
            const body = JSON.parse(options.body);
            sent.push(body);
            if(sent.length === 1) return {
                status:409, ok:false, json:async()=>({detail:{reason:'meta_conflict',canvas:{
                    id:'isolated',title:'新标题',icon:'star',updated_at:2000,meta_revision:1,
                    nodes:[{id:'original',type:'text'}],connections:[]
                }}})
            };
            return {status:200,ok:true,json:async()=>({canvas:{
                id:'isolated',title:'新标题',icon:'star',updated_at:2001,meta_revision:1,
                nodes:body.nodes,connections:body.connections
            }})};
        }
    });
    vm.runInContext(section('async function saveCanvas(){', 'async function loadConfig(){'), context);
    assert.equal(await vm.runInContext('saveCanvas()',context), false);
    assert.equal(context.canvas.title, '新标题');
    assert.equal(currentCanvasTitle.textContent, '新标题');
    assert.equal(await vm.runInContext('saveCanvas()',context), true);
    assert.equal(sent[0].base_meta_revision, 0);
    assert.equal(sent[1].base_meta_revision, 1);
    assert.equal(sent[1].title, '新标题');
    assert.deepEqual(sent[1].nodes.map(node=>node.id), ['edited']);
    assert.equal(context.canvas.title, '新标题');
});

test('classic title and icon controls write metadata without sending whole canvas', async()=>{
    const calls = [];
    const canvases = [{id:'isolated',title:'旧标题',icon:'layers',updated_at:2000}];
    const context = vm.createContext({
        canvas:{id:'isolated',title:'旧标题',icon:'layers',updated_at:2000,meta_revision:0},
        canvases,
        currentCanvasTitle:{textContent:'旧标题'},
        sortCanvasListByUpdated(){}, renderCanvasList(){}, closeCanvasMetaPopover(){},
        updateCanvasListRecord(record){Object.assign(canvases[0],record);},
        setStatus(){}, tr:key=>key, loadCanvasList:async()=>{}, console,
        fetch:async(url, options)=>{
            calls.push({url,method:options.method,body:JSON.parse(options.body)});
            const patch = JSON.parse(options.body);
            return {ok:true,json:async()=>({canvas:{id:'isolated',title:patch.title || context.canvas.title,
                icon:patch.icon || context.canvas.icon,updated_at:2000,meta_revision:calls.length}})};
        }
    });
    vm.runInContext(section('async function patchCanvasMeta(', 'function togglePinCanvas('), context);
    vm.runInContext(section('async function setCanvasIcon(', 'function startTitleEdit('), context);
    vm.runInContext(section('async function setCanvasTitle(', 'async function openCanvas('), context);
    await vm.runInContext("setCanvasTitle('isolated','新标题')",context);
    await vm.runInContext("setCanvasIcon('isolated','star')",context);
    assert.deepEqual(calls.map(call=>call.method), ['POST','POST']);
    assert.ok(calls.every(call=>call.url==='/api/canvases/isolated/meta'));
    assert.deepEqual(calls.map(call=>call.body), [{title:'新标题'},{icon:'star'}]);
    assert.equal(context.canvas.title, '新标题');
    assert.equal(context.canvas.icon, 'star');
    assert.equal(context.canvas.meta_revision, 2);
    assert.equal(context.currentCanvasTitle.textContent, '新标题');
});
