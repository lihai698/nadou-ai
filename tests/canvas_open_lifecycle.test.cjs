const {installEditorBridges}=require('./canvas_editor_bridge_test_helpers.cjs');
const {installClassicPreviewRuntime}=require('./canvas_preview_runtime_test_helpers.cjs');
const {createTaskContext}=require('./canvas_task_test_helpers.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../static/js/canvas.js'),'utf8');
function section(begin,end){const a=source.indexOf(begin),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b);}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
const record=(id,extra={})=>({id,kind:'classic',project:id,nodes:[{id:id+'-node'}],updated_at:10,...extra});
const reply=(id,extra)=>({ok:true,json:async()=>({canvas:record(id,extra)})});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(){
    const requests=[],events=[],listeners={};
    const e=createTaskContext({canvases:[],deletedCanvases:[],canvasGate:null,canvasSortMode:'recent',trashMode:false,canvas:null,canvasOpenGeneration:0,openingCanvasId:'',localCanvasDirty:false,
        classicSaveSession:{isSaving:false,queued:false},classicSaveScheduler:{pending:false},
        nodes:[],connections:[],viewport:{},selected:new Set(),classicSaveBase:{},classicConflictCopy(){},
        console:{error:error=>events.push(['error',error.message]),warn(){}},
        window:{addEventListener:(name,fn)=>{listeners[name]=fn;},location:{replace:url=>events.push(['redirect',url])},
            CanvasAudio:{migrate:n=>n},CanvasSaveRecovery:{prepareRecovery:async()=>true}},
        classicRemoteSync:{stop:()=>events.push(['stop']),start:()=>events.push(['poll']),syncNow(){}},
        fetch:url=>{if(url==='/api/canvases'||url==='/api/canvases/trash')return Promise.resolve({ok:true,json:async()=>({canvases:e.canvases})});const gate=deferred();requests.push({url,...gate});return gate.promise;},
        setStatus:s=>events.push(['status',s]),tr:s=>s,
        touchCanvasOpened:async()=>null,resetCascadeRuntimeState(){},rememberCanvasListProject:id=>events.push(['project',id]),
        openSmartCanvasPage:id=>events.push(['smart',id]),localViewportForCanvas:(id,v)=>v,
        resetTransientRunState(){},sanitizeConnections(){},rememberClassicSaveBase(){},
        restoreClassicDraft:()=>{events.push(['draft',e.canvas.id]);return false;},setClassicSaveWarning:s=>events.push(['warning',s]),
        restoreUnsavedCanvasAcceptedTasks:()=>0,restoreUnsavedCanvasUnknownWarnings:()=>0,pruneMissingComfyWorkflows(){},
        refreshMissingCanvasAssets:async()=>{},setCanvasMode(){},renderCanvasList(){},render:()=>events.push(['render',e.canvas.id]),
        resumeCanvasImageTasks:()=>events.push(['resume',e.canvas.id]),resumeCanvasAudioTasks(){},showErrorModal:s=>events.push(['modal',s]),
        startCanvasRemotePolling:()=>events.push(['poll',e.canvas.id]),canvasListUrlForProject:id=>id,requestedCanvasListProject:()=> 'default',rememberedCanvasListProject:()=> 'default'});
    installClassicPreviewRuntime(e,source);
    installEditorBridges(e,source);
    vm.runInContext(section('async function openCanvas(','function applyRemoteCanvasData('),e);
    return {e,events,requests,listeners,open:id=>e.openCanvas(id)};
}
test('slow A GET finishing after B cannot replace B or resume A tasks',async()=>{
    const h=setup(),a=h.open('a'),b=h.open('b');h.requests[1].resolve(reply('b'));await b;
    const before=h.events.length;h.requests[0].resolve(reply('a'));await a;
    assert.equal(h.e.canvas.id,'b');assert.equal(h.e.nodes[0].id,'b-node');assert.equal(h.events.length,before);
});
test('old JSON decoding cannot replace the latest canvas',async()=>{
    const h=setup(),gate=deferred(),a=h.open('a');h.requests[0].resolve({ok:true,json:()=>gate.promise});await tick();
    const b=h.open('b');h.requests[1].resolve(reply('b'));await b;gate.resolve({canvas:record('a')});await a;assert.equal(h.e.canvas.id,'b');
});
test('old touch response cannot overwrite B timestamp or redirect to a smart canvas',async()=>{
    const h=setup(),gate=deferred();h.e.touchCanvasOpened=id=>id==='a'?gate.promise:Promise.resolve(null);
    const a=h.open('a');h.requests[0].resolve(reply('a',{kind:'smart'}));await tick();
    const b=h.open('b');h.requests[1].resolve(reply('b'));await b;const before=h.events.length;
    gate.resolve({updated_at:99});await a;assert.equal(h.e.canvas.updated_at,10);assert.equal(h.events.length,before);
});
test('old draft preparation cannot restore drafts or restart tasks for the new canvas',async()=>{
    const h=setup(),gate=deferred();h.e.window.CanvasSaveRecovery.prepareRecovery=(kind,id)=>id==='a'?gate.promise:Promise.resolve(true);
    const a=h.open('a');h.requests[0].resolve(reply('a'));await tick();const b=h.open('b');h.requests[1].resolve(reply('b'));await b;
    const before=h.events.length;gate.resolve(false);await a;assert.equal(h.events.length,before);
});
test('old asset check completion cannot render or resume tasks after B opens',async()=>{
    const h=setup(),gate=deferred();h.e.refreshMissingCanvasAssets=()=>h.e.canvas.id==='a'?gate.promise:Promise.resolve();
    const a=h.open('a');h.requests[0].resolve(reply('a'));await tick();const b=h.open('b');h.requests[1].resolve(reply('b'));await b;
    const before=h.events.length;gate.resolve();await a;assert.equal(h.events.length,before);
});
test('a superseded failure cannot redirect the successful newer page',async()=>{
    const h=setup(),a=h.open('a'),b=h.open('b');h.requests[1].resolve(reply('b'));await b;
    const before=h.events.length;h.requests[0].reject(new Error('old failure'));await a;assert.equal(h.events.length,before);
});
test('latest load failure retains its error and return-to-list behavior',async()=>{
    const h=setup(),a=h.open('a');h.requests[0].resolve({ok:false});await a;
    assert.ok(h.events.some(e=>e[0]==='redirect'));assert.ok(h.events.some(e=>e[0]==='error'));
});
test('two opens of the same ID still select the latest request',async()=>{
    const h=setup(),a=h.open('a'),b=h.open('a');h.requests[1].resolve(reply('a',{title:'latest'}));await b;
    h.requests[0].resolve(reply('a',{title:'old'}));await a;assert.equal(h.e.canvas.title,'latest');
});
test('pagehide invalidates a pending open so it cannot restart polling',async()=>{
    const h=setup();vm.runInContext(section("window.addEventListener('pagehide'",'let models ='),h.e);
    const a=h.open('a');h.listeners.pagehide();const before=h.events.length;h.requests[0].resolve(reply('a'));await a;
    assert.equal(h.events.length,before);assert.equal(h.e.canvas,null);
});
test('late missing asset response cannot mark the newly opened canvas assets as missing',async()=>{
    const h=setup();h.e.missingAssetUrls=new Set();h.e.canvas=record('a');h.e.canvasLocalAssetUrls=()=>['/assets/a.png'];
    vm.runInContext(section('async function refreshMissingCanvasAssets(','async function syncRemoteCanvasNow('),h.e);
    const pending=h.e.refreshMissingCanvasAssets();h.e.canvas=record('b');h.e.missingAssetUrls.add('/assets/b.png');
    h.requests[0].resolve({json:async()=>({exists:{'/assets/a.png':false}})});await pending;
    assert.deepEqual([...h.e.missingAssetUrls],['/assets/b.png']);
});
test('persisted pages resume an interrupted initial open without accepting its old response',async()=>{
    const h=setup();vm.runInContext(section("window.addEventListener('pagehide'",'let models ='),h.e);
    const old=h.open('a');h.listeners.pagehide();h.listeners.pageshow({persisted:true});assert.equal(h.requests.length,2);
    h.requests[1].resolve(reply('a',{title:'resumed'}));await tick();h.requests[0].resolve(reply('a',{title:'old'}));await old;
    assert.equal(h.e.canvas.title,'resumed');assert.equal(h.e.openingCanvasId,'');
});
test('deleting the canvas being opened invalidates that load, including when no canvas is shown',async()=>{
    const h=setup();Object.assign(h.e,{canvases:[{id:'a'}]});
    vm.runInContext(section('async function deleteCanvas(','async function restoreCanvas('),h.e);
    const pending=h.open('a'),removing=h.e.deleteCanvas('a');h.requests[1].resolve({ok:true});await removing;
    const before=h.events.length;h.requests[0].resolve(reply('a'));await pending;
    assert.equal(h.e.canvas,null);assert.equal(h.e.openingCanvasId,'');assert.equal(h.events.length,before);
});
test('deleting a different canvas does not cancel the latest requested canvas',async()=>{
    const h=setup();Object.assign(h.e,{canvases:[{id:'a'},{id:'b'}]});
    vm.runInContext(section('async function deleteCanvas(','async function restoreCanvas('),h.e);
    const pending=h.open('b'),removing=h.e.deleteCanvas('a');h.requests[1].resolve({ok:true});await removing;
    h.requests[0].resolve(reply('b'));await pending;assert.equal(h.e.canvas.id,'b');
});
test('the real touch helper cannot update the list after its open is superseded',async()=>{
    const h=setup();
    vm.runInContext(section('async function touchCanvasOpened(','async function createCanvas('),h.e);
    const a=h.open('a');h.requests[0].resolve(reply('a'));await tick();assert.ok(h.requests[1].url.endsWith('/a/touch'));
    const b=h.open('b');h.requests[2].resolve(reply('b'));await tick();h.requests[3].resolve(reply('b'));await b;
    const before=h.events.length;h.requests[1].resolve(reply('a'));await a;
    assert.equal(h.e.canvas.id,'b');assert.equal(h.events.length,before);
    assert.deepEqual(Array.from(h.e.canvases,c=>c.id),['b']);
});
for(const state of ['dirty','saving','scheduled','queued']){
    test(`opening B waits for A when its save state is ${state}`,async()=>{
        const h=setup(),gate=deferred();h.e.canvas=record('a');let saves=0;
        h.e.localCanvasDirty=state==='dirty';h.e.classicSaveSession.isSaving=state==='saving';
        h.e.classicSaveSession.queued=state==='queued';h.e.classicSaveScheduler.pending=state==='scheduled';
        h.e.saveCanvas=()=>{saves++;return gate.promise;};
        const opening=h.open('b');assert.equal(h.requests.length,0);assert.equal(saves,1);assert.equal(h.e.canvas.id,'a');
        assert.ok(!h.events.some(e=>e[0]==='stop'),'keep current sync until saving succeeds');
        h.e.localCanvasDirty=false;h.e.classicSaveSession.isSaving=false;h.e.classicSaveSession.queued=false;h.e.classicSaveScheduler.pending=false;
        gate.resolve(true);await tick();h.requests[0].resolve(reply('b'));await opening;assert.equal(h.e.canvas.id,'b');
    });
}
test('failed save keeps A open and does not request B',async()=>{
    const h=setup();h.e.canvas=record('a');h.e.localCanvasDirty=true;h.e.saveCanvas=async()=>false;
    const opening=h.open('b');assert.equal(h.requests.length,0);await opening;assert.equal(h.e.canvas.id,'a');
    assert.ok(h.events.some(e=>e[0]==='modal'));assert.ok(!h.events.some(e=>e[0]==='stop'));assert.equal(h.e.openingCanvasId,'');
});
test('edits remaining after a successful snapshot prevent switching',async()=>{
    const h=setup();h.e.canvas=record('a');h.e.localCanvasDirty=true;h.e.saveCanvas=async()=>true;
    const opening=h.open('b');assert.equal(h.requests.length,0);await opening;assert.equal(h.e.canvas.id,'a');assert.ok(h.events.some(e=>e[0]==='modal'));
});
test('latest requested target wins while both opens are waiting for save',async()=>{
    const h=setup(),gate=deferred();h.e.canvas=record('a');h.e.localCanvasDirty=true;h.e.saveCanvas=()=>gate.promise;
    const b=h.open('b'),c=h.open('c');assert.equal(h.requests.length,0);h.e.localCanvasDirty=false;gate.resolve(true);await tick();
    assert.equal(h.requests.length,1);assert.ok(h.requests[0].url.endsWith('/c'));h.requests[0].resolve(reply('c'));await Promise.all([b,c]);assert.equal(h.e.canvas.id,'c');
});
test('editing A while B is loading must be saved before B is applied',async()=>{
    const h=setup(),gate=deferred();h.e.canvas=record('a');let saves=0;h.e.saveCanvas=()=>{saves++;return gate.promise;};
    const opening=h.open('b');h.e.localCanvasDirty=true;h.requests[0].resolve(reply('b'));await tick();
    assert.equal(h.e.canvas.id,'a');assert.equal(saves,1);h.e.localCanvasDirty=false;gate.resolve(true);await opening;assert.equal(h.e.canvas.id,'b');
});
test('failed save after B was fetched keeps A and resumes its remote polling',async()=>{
    const h=setup();h.e.canvas=record('a');h.e.saveCanvas=async()=>false;
    const opening=h.open('b');h.e.localCanvasDirty=true;h.requests[0].resolve(reply('b'));await opening;
    assert.equal(h.e.canvas.id,'a');assert.ok(h.events.some(e=>e[0]==='modal'));assert.ok(h.events.some(e=>e[0]==='poll'));
});
test('reopening A refetches after edits were saved during its first GET',async()=>{
    const h=setup();h.e.canvas=record('a');h.e.saveCanvas=async()=>{h.e.localCanvasDirty=false;return true;};
    const opening=h.open('a');h.e.localCanvasDirty=true;h.requests[0].resolve(reply('a',{title:'before-save'}));await tick();
    assert.equal(h.requests.length,2,'saved content needs a fresh GET');
    h.requests[1].resolve(reply('a',{title:'after-save'}));await opening;
    assert.equal(h.e.canvas.title,'after-save');assert.equal(h.e.openingCanvasId,'');
});
test('same-ID reopen refetches if autosave already finished while GET was pending',async()=>{
    const h=setup();h.e.canvas=record('a');const opening=h.open('a');
    h.e.canvas=record('a',{title:'saved-new',updated_at:20});h.e.localCanvasDirty=false;
    h.requests[0].resolve(reply('a',{title:'old',updated_at:10}));await tick();assert.equal(h.requests.length,2);
    h.requests[1].resolve(reply('a',{title:'saved-new',updated_at:20}));await opening;assert.equal(h.e.canvas.title,'saved-new');
});
