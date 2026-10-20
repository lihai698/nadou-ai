const {test}=require('node:test');
const assert=require('node:assert/strict');
const api=require('../static/js/canvas-accepted-task-recovery.js');

function harness(){
    const data=new Map();let id=0;
    const host={canvas:{id:'first'},canvasId:'first',nodes:[],connections:[],canvasOrphanUnknownSubmissionCount:0,
        CANVAS_UNSAVED_ACCEPTED_TASKS_PREFIX:'classic:',CANVAS_UNKNOWN_SUBMISSION_PREFIX:'unknown:',SMART_UNSAVED_ACCEPTED_TASKS_PREFIX:'smart:',
        storage:{getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)},
        uid:kind=>kind+(++id),nowMs:()=>100,scheduleSave:()=>{},render:()=>{},showErrorModal:()=>{},tr:x=>x,
        findPendingTask:taskId=>{for(const out of host.nodes){const pending=out._pending?.find(x=>x.canvasTaskId===taskId);if(pending)return {out,pending};}return null;},
        smartPendingTasks:node=>node.pendingTasks||[],confirm:()=>true,cascadeAbortError:message=>new Error(message),
    };
    return {host,data};
}

test('classic restores accepted ID as paused and clears only confirmed saved IDs',()=>{
    const {host,data}=harness(),node={id:'source',x:20,y:30};host.nodes.push(node);
    assert.equal(api.rememberUnsavedCanvasAcceptedTasks(host,node,[{canvasTaskId:'accepted'}]),true);
    assert.equal(api.restoreUnsavedCanvasAcceptedTasks(host),1);
    const output=host.nodes.find(n=>n.type==='output');
    assert.equal(output._pending[0].canvasTaskId,'accepted');
    assert.equal(output._pending[0].savePending,true);
    api.clearUnsavedCanvasAcceptedTasks(host,'first',[]);assert.ok(data.has('classic:first'));
    api.clearUnsavedCanvasAcceptedTasks(host,'first',[output]);assert.equal(data.has('classic:first'),false);
});

test('smart explicit owner survives canvas switch and restores without submission',()=>{
    const {host,data}=harness(),node={id:'source'};host.nodes.push(node);
    host.canvasId='second';
    api.rememberSmartAcceptedTasks(host,node,[{taskId:'accepted',kind:'image'}],'first');
    assert.ok(data.has('smart:first'));assert.equal(data.has('smart:second'),false);
    assert.equal(api.restoreSmartUnsavedAcceptedTasks(host),0);
    host.canvasId='first';assert.equal(api.restoreSmartUnsavedAcceptedTasks(host),1);
    assert.equal(node.pendingTasks[0].taskId,'accepted');assert.equal(node.pendingTasks[0].queryPaused,true);
});

test('backup quota failure preserves pending task and explicit warning',()=>{
    const {host}=harness();host.storage.setItem=()=>{throw new Error('quota');};
    const titles=[];host.showErrorModal=(_message,title)=>titles.push(title);
    const node={id:'source',running:true},task={canvasTaskId:'accepted'};
    const error=api.pauseCanvasAcceptedTasksUntilSaved(host,node,[task]);
    assert.equal(error.queryPaused,true);assert.match(error.message,/无法备份/);
    assert.equal(task.canvasTaskId,'accepted');assert.equal(task.savePending,true);assert.equal(node.running,false);
    assert.deepEqual(titles,['canvas.apiFailed']);
});

test('unknown warning for missing node is counted without inventing a source',()=>{
    const {host,data}=harness();data.set('unknown:first',JSON.stringify([{nodeId:'missing',warning:'unknown'}]));
    assert.equal(api.restoreUnsavedCanvasUnknownWarnings(host),1);
    assert.equal(host.canvasOrphanUnknownSubmissionCount,1);assert.deepEqual(host.nodes,[]);
});
