const {createTaskContext}=require('./canvas_task_test_helpers.cjs');
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');
const {attachSaveState}=require('./canvas_save_test_helpers.cjs');
const source = readFileSync(require('node:path').join(__dirname, '../static/js/canvas.js'), 'utf8');
function section(begin, end){
    const start = source.indexOf(begin), stop = source.indexOf(end, start);
    assert.ok(start >= 0 && stop > start);
    return source.slice(start, stop);
}
function savingEditor(){
    const requests = [], releases = [];
    const context = createTaskContext({
        canvas:{id:'demo', title:'test', updated_at:1}, nodes:[], connections:[],
        viewport:{x:0,y:0,scale:1}, applyingRemoteCanvas:false,
         localCanvasDirty:true, lastCanvasUpdatedAt:1,
         CLIENT_ID:'test', currentCanvasTitle:null, currentCanvasTime:null,
        sanitizeConnections(){}, setStatus(){}, clearUnsavedCanvasAcceptedTasks(){},
        clearUnsavedCanvasUnknownWarnings(){}, gateCanvasList:null, loadCanvasList(){},
        setTimeout(){return 1;}, clearTimeout(){}, console,
        fetch:async(url, init)=>{
            const body = JSON.parse(init.body);
            requests.push({url, body});
            return new Promise(resolve=>releases.push(ok=>resolve({
                ok, status:ok ? 200 : 503,
                json:async()=>({canvas:{id:'demo',updated_at:requests.length+1,nodes:body.nodes}})
            })));
        }
    });
    attachSaveState(context,'classic');
    vm.runInContext(readFileSync(require('node:path').join(__dirname,'../static/js/canvas-save-transport.js'),'utf8'),context);
    vm.runInContext(section('function serializableCanvasNode(', 'async function loadConfig('), context);
    return {context, requests, releases, save:()=>vm.runInContext('saveCanvas()',context)};
}

function attachOpenEntry(e){
    const c=e.context,put=c.fetch,gets=[];
    Object.assign(c,{canvasOpenGeneration:0,openingCanvasId:'',selected:new Set(),
        window:{CanvasAudio:{migrate:n=>n}},classicRemoteSync:{stop(){}},
        fetch:(url,init)=>{
            if(init?.method==='PUT') return put(url,init);
            gets.push(url);return Promise.resolve({ok:true,json:async()=>({canvas:{id:'next',nodes:[],updated_at:20}})});
        },
        touchCanvasOpened:async()=>null,resetCascadeRuntimeState(){},rememberCanvasListProject(){},
        localViewportForCanvas:(id,v)=>v,resetTransientRunState(){},restoreClassicDraft:()=>false,
        restoreUnsavedCanvasAcceptedTasks:()=>0,restoreUnsavedCanvasUnknownWarnings:()=>0,
        pruneMissingComfyWorkflows(){},refreshMissingCanvasAssets:async()=>{},setCanvasMode(){},renderCanvasList(){},render(){},
        resumeCanvasImageTasks(){},resumeCanvasAudioTasks(){},startCanvasRemotePolling(){},showErrorModal(){}});
    vm.runInContext(section('async function openCanvas(','function applyRemoteCanvasData('),c);
    vm.runInContext(section('function scheduleSave(){','function scheduleViewportSave(){'),c);
    return gets;
}
test('real save queue persists newer A edits before openCanvas can load B',async()=>{
    const e=savingEditor(),gets=attachOpenEntry(e),saving=e.save();
    const opening=e.context.openCanvas('next');assert.equal(gets.length,0);assert.equal(e.context.canvas.id,'demo');
    e.context.nodes.push({id:'latest',type:'prompt',text:'保存中新增'});e.context.scheduleSave();
    e.releases[0](true);await saving;await new Promise(resolve=>setImmediate(resolve));
    assert.equal(gets.length,0);assert.equal(e.requests.length,2);
    assert.equal(e.requests[1].body.nodes[0].text,'保存中新增');assert.equal(e.requests[1].url,'/api/canvases/demo');
    e.releases[1](true);await opening;assert.equal(e.context.canvas.id,'next');assert.deepEqual(gets,['/api/canvases/next']);
});
test('real failed save prevents a new canvas GET and preserves dirty A',async()=>{
    const e=savingEditor(),gets=attachOpenEntry(e),opening=e.context.openCanvas('next');
    e.releases[0](false);await opening;assert.equal(gets.length,0);assert.equal(e.context.canvas.id,'demo');assert.equal(e.context.localCanvasDirty,true);
});
test('return waits for pending save and prevents duplicate navigation', async()=>{
    assert.equal((source.match(/async function returnToCanvasManager\(/g)||[]).length,1);
    let finish;
    const button={disabled:false}, location={href:'editor'}, errors=[];
    const context=createTaskContext({backToManagerBtn:button,canvas:{project:'current'},
        localCanvasDirty:true,
        saveCanvas:()=>new Promise(resolve=>{finish=()=>{context.localCanvasDirty=false;resolve(true);};}),
        canvasListUrlForProject:p=>`list?project=${p}`,requestedCanvasListProject:()=>'',rememberedCanvasListProject:()=>'',
        window:{location},showErrorModal:m=>errors.push(m)});
    attachSaveState(context,'classic');
    vm.runInContext(section('async function returnToCanvasManager(', 'clearCurrentCanvasBtn?.addEventListener'),context);
    const leaving=vm.runInContext('returnToCanvasManager()',context);
    assert.equal(location.href,'editor');assert.equal(button.disabled,true);
    await vm.runInContext('returnToCanvasManager()',context);
    assert.equal(location.href,'editor');
    finish();await leaving;
    assert.equal(location.href,'list?project=current');assert.equal(button.disabled,false);assert.deepEqual(errors,[]);
});
test('return stays on editor and reports failed saving', async()=>{
    const button={disabled:false}, location={href:'editor'}, errors=[];
    const context=createTaskContext({backToManagerBtn:button,canvas:{project:'current'},
        localCanvasDirty:true,
        saveCanvas:async()=>false,window:{location},showErrorModal:m=>errors.push(m)});
    attachSaveState(context,'classic');
    vm.runInContext(section('async function returnToCanvasManager(', 'clearCurrentCanvasBtn?.addEventListener'),context);
    await vm.runInContext('returnToCanvasManager()',context);
    assert.equal(location.href,'editor');assert.equal(button.disabled,false);assert.equal(errors.length,1);
});
test('standalone editor save does not refresh removed manager list', async()=>{
    const e=savingEditor();let listCalls=0;
    e.context.loadCanvasList=()=>{listCalls++;};
    const saving=e.save();e.releases[0](true);assert.equal(await saving,true);assert.equal(listCalls,0);
    e.context.gateCanvasList={};const legacy=e.save();e.releases[1](true);
    assert.equal(await legacy,true);assert.equal(listCalls,1);
});

test('returning after a completed autosave does not send another PUT for an expired timer',async()=>{
    const e=savingEditor();let fire;
    e.context.setTimeout=callback=>{fire=callback;return 7;};
    e.context.backToManagerBtn={disabled:false};
    e.context.window={location:{href:'editor'}};
    e.context.canvasListUrlForProject=()=> 'list';
    e.context.requestedCanvasListProject=()=>'';
    e.context.rememberedCanvasListProject=()=>'';
    e.context.showErrorModal=()=>assert.fail('clean canvas must leave');
    vm.runInContext(section('function scheduleSave(){','function scheduleViewportSave(){'),e.context);
    vm.runInContext(section('async function returnToCanvasManager(','clearCurrentCanvasBtn?.addEventListener'),e.context);
    vm.runInContext('scheduleSave()',e.context);
    const saving=fire();e.releases[0](true);assert.equal(await saving,true);
    const leaving=vm.runInContext('returnToCanvasManager()',e.context);
    assert.equal(e.requests.length,1);
    await leaving;assert.equal(e.context.window.location.href,'list');
});
test('accepted task waits for an earlier autosave and persists its own snapshot', async()=>{
    const e = savingEditor();
    const earlier = e.save();
    e.context.nodes.push({id:'out',type:'output',_pending:[{canvasTaskId:'original-task'}]});
    let settled = false;
    const accepted = e.save().then(result=>{settled=true; return result;});
    await Promise.resolve();
    assert.equal(settled, false);
    assert.equal(e.requests.length, 1);
    e.releases[0](true);
    assert.equal(await earlier, true);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(e.requests.length, 2);
    assert.equal(e.requests[1].body.nodes[0]._pending[0].canvasTaskId, 'original-task');
    e.releases[1](true);
    assert.equal(await accepted, true);
});
test('an accepted-task save failure still reports failure after waiting', async()=>{
    const e = savingEditor();
    e.context.console = {error(){}};
    const earlier=e.save(), accepted=e.save();
    e.releases[0](true);
    await earlier;
    await new Promise(resolve=>setImmediate(resolve));
    e.releases[1](false);
    assert.equal(await accepted, false);
});

test('classic keeps the newer draft while a save is queued and clears it only after the next success',async()=>{
    const e=savingEditor(),drafts=[],clears=[];
    e.context.document={getElementById:()=>null};
    e.context.window={};
    vm.runInContext(readFileSync(require('node:path').join(__dirname,'../static/js/canvas-save-recovery.js'),'utf8'),e.context);
    Object.assign(e.context.window.CanvasSaveRecovery,{
        saveDraft:(kind,id,base,local)=>drafts.push(JSON.parse(JSON.stringify(local))),
        clearDraft:(kind,id)=>clears.push([kind,id])
    });
    vm.runInContext(section('function scheduleSave(){','function scheduleViewportSave(){'),e.context);
    const first=e.save();
    e.context.nodes.push({id:'out',type:'output',_pending:[{canvasTaskId:'accepted-new'}]});
    vm.runInContext('scheduleSave()',e.context);
    e.releases[0](true);assert.equal(await first,true);
    assert.equal(e.context.localCanvasDirty,true);assert.deepEqual(clears,[]);
    assert.equal(drafts.at(-1).nodes[0]._pending[0].canvasTaskId,'accepted-new');
    const next=e.save();e.releases[1](true);assert.equal(await next,true);
    assert.equal(e.requests[1].body.nodes[0]._pending[0].canvasTaskId,'accepted-new');
    assert.deepEqual(clears,[['classic','demo']]);assert.equal(e.context.localCanvasDirty,false);
});
test('two simultaneous accepted tasks both survive queued saves', async()=>{
    const e=savingEditor();
    const earlier=e.save();
    e.context.nodes.push({id:'out',_pending:[{canvasTaskId:'first-task'}]});
    const first=e.save();
    e.context.nodes[0]._pending.push({canvasTaskId:'second-task'});
    const second=e.save();
    e.releases[0](true);
    await earlier;
    await new Promise(resolve=>setImmediate(resolve));
    e.releases[1](true);
    await first;
    await new Promise(resolve=>setImmediate(resolve));
    e.releases[2](true);
    assert.equal(await second,true);
    assert.deepEqual(e.requests[2].body.nodes[0]._pending.map(p=>p.canvasTaskId),['first-task','second-task']);
});
test('image recovery button uses the durable original ID and never the legacy submission API', async()=>{
    const pending={id:'pending',canvasTaskId:'original-task',canvasTaskType:'online-image',savePending:true,queryPaused:true};
    const node={id:'output',_pending:[pending]}, calls=[], button={};
    const wrap={dataset:{pendingId:'pending'},querySelector:selector=>selector==='.output-recover-query' ? button : null,addEventListener(){}};
    const context=createTaskContext({
        pendingById:()=>pending, findOutputByPendingId:()=>node,
        saveCanvas:async()=>{calls.push('save');return true;}, scheduleSave(){},
        pollCanvasImageTask:async id=>{calls.push(`query:${id}`);return 'succeeded';},
        fetch:()=>assert.fail('must not submit or query a different task'),
        showErrorModal:()=>assert.fail('original durable ID is available'),tr:x=>x,
        wrap,node
    });
    vm.runInContext(section('function bindOutputWrap(', 'function outputDomKeyForItem('),context);
    vm.runInContext(section('async function queryRecoverPendingOutput(', 'async function pollCanvasImageTask('),context);
    vm.runInContext('bindOutputWrap(wrap,node)',context);
    button.onclick({preventDefault(){},stopPropagation(){}});
    await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(calls,['save','query:original-task']);
    assert.equal(pending.savePending,undefined);
});
