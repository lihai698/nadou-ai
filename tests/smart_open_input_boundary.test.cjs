const test=require('node:test');
const assert=require('node:assert/strict');
const open=require('../static/js/smart-open-coordinator.js');
const {create}=require('../static/js/smart-media-input-events.js');
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
const response=title=>({ok:true,json:async()=>({canvas:{id:'a',title,nodes:[],connections:[]}})});
function setup(){
    const requests=[],effects=[];const noop=()=>{};let controller;
    const deps={canvas:{id:'a'},canvasId:'a',nodes:[],settings:{},viewport:{},
        beginMediaInputLoad:()=>controller.beginOpen(),smartRemoteSync:{stop:noop},invalidateSmartVideoDeconstruction:noop,
        fetch:()=>{const gate=deferred();requests.push(gate);return gate.promise;},document:{getElementById:()=>({}),querySelector:()=>({})},window:{},
        rememberCanvasListProject:noop,rememberServerCanvasNodes:noop,normalizeLegacySmartNode:n=>n,migrateSmartGroupImageMembers:noop,
        clearCompletedNodeBusyStates:()=>false,recoverStuckLoopOutputsFromLogs:()=>false,hideCompletedRunTimers:()=>false,cleanupDetachedRunInputRefs:()=>false,
        safeScale:x=>x||1,normalizeSmartVideoModeSettings:noop,cloneSmartSettings:x=>({...x}),loadRecentSmartSettings:noop,restoreSmartDraft:()=>false,
        restoreSmartUnsavedAcceptedTasks:noop,updateProviderModels:noop,applyViewport:noop,render:()=>effects.push('render'),scheduleSave:noop,
        resumeSmartPendingTasks:()=>effects.push('resume'),resumeSmartAudioTasks:noop,resumeJimengPendingNodes:noop,startCanvasMetaPoll:()=>effects.push('poll'),
        toast:text=>effects.push(text),tr:x=>x,setCanvasSaveError:noop,pendingGroupUploadPoint:null,uploadTargetId:''};
    controller=create(()=>deps);
    return {deps,controller,requests,effects};
}
test('smart actual open invalidates prior input and completes the normal load path',async()=>{
    const ui=setup(),old=ui.controller.capture(),pending=open.loadCanvas(ui.deps);assert.equal(old(),false);
    ui.requests[0].resolve(response('loaded'));await pending;assert.equal(ui.deps.canvas.title,'loaded');assert.deepEqual(ui.effects,['render','resume','poll']);
});
test('smart older same-id open response cannot overwrite a newer load',async()=>{
    const ui=setup(),first=open.loadCanvas(ui.deps),second=open.loadCanvas(ui.deps);
    ui.requests[1].resolve(response('newest'));await second;ui.requests[0].resolve(response('obsolete'));await first;
    assert.equal(ui.deps.canvas.title,'newest');assert.deepEqual(ui.effects,['render','resume','poll']);
});
test('smart JSON decoding from an obsolete open is discarded',async()=>{
    const ui=setup(),json=deferred(),first=open.loadCanvas(ui.deps);ui.requests[0].resolve({ok:true,json:()=>json.promise});await Promise.resolve();
    const second=open.loadCanvas(ui.deps);ui.requests[1].resolve(response('newest'));await second;json.resolve({canvas:{id:'a',title:'old-json'}});await first;
    assert.equal(ui.deps.canvas.title,'newest');assert.deepEqual(ui.effects,['render','resume','poll']);
});
test('smart recovery completing after suspension cannot render or resume old tasks',async()=>{
    const ui=setup(),recovery=deferred();ui.deps.window.CanvasSaveRecovery={prepareRecovery:()=>recovery.promise};
    const pending=open.loadCanvas(ui.deps);ui.requests[0].resolve(response('loaded'));await new Promise(done=>setImmediate(done));
    ui.controller.suspend();recovery.resolve(true);await pending;assert.deepEqual(ui.effects,[]);
});
