const test=require('node:test');
const assert=require('node:assert/strict');
const {create}=require('../static/js/smart-media-input-events.js');
function target(){
    const handlers=new Map();return {value:'',files:[],handlers,
        addEventListener(type,fn){if(!handlers.has(type))handlers.set(type,new Set());handlers.get(type).add(fn);},
        removeEventListener(type,fn){handlers.get(type)?.delete(fn);},
        fire(type,event={}){return Promise.all([...(handlers.get(type)||[])].map(fn=>fn({target:this,preventDefault(){},stopPropagation(){},...event})));},
        count(type){return handlers.get(type)?.size||0;}};
}
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
function setup(){
    const window=target(),shell=target(),fileInput=target(),workflowInput=target(),inputs=[],calls=[];
    const deps={window,shell,fileInput,workflowInput,canvas:{id:'a'},nodes:[{id:'one'},{id:'two'}],selectedId:'one',nodeClipboard:null,pendingGroupUploadPoint:null,uploadTargetId:'',
        document:{createElement(){const input={style:{},files:[],click(){},remove(){this.removed=true;}};inputs.push(input);return input;},body:{appendChild(){}}},
        handleFiles:(...args)=>calls.push(['files',...args]),handleSmartImageDropPayload:(...args)=>calls.push(['drop',...args]),
        importSmartWorkflowFile:file=>calls.push(['workflow',file]),resolveSmartImageDropPayload:async()=>({type:'files',files:[{name:'self-made.png'}]}),
        screenToWorld:()=>({x:10,y:20}),setSmartDropCopyEffect(){},isSupportedUploadFile:()=>true,isEditableTarget:()=>false,pasteAssetsFromInbox:()=>false,pasteNodes(){},
        pushUndo(){},createImageNodeAt(){},assetNodeImageFromItem:x=>x};
    const controller=create(()=>deps);return {deps,controller,window,shell,fileInput,workflowInput,inputs,calls};
}
test('smart media listeners mount once, pause, resume once and dispose completely',async()=>{
    const ui=setup();ui.controller.mount();ui.controller.mount();assert.equal(ui.shell.count('drop'),1);assert.equal(ui.window.count('paste'),1);
    const old=ui.controller.capture();await ui.window.fire('pagehide');assert.equal(old(),false);assert.equal(ui.shell.count('drop'),0);
    await ui.window.fire('pageshow');await ui.window.fire('pageshow');assert.equal(old(),false);assert.equal(ui.shell.count('drop'),1);assert.equal(ui.controller.capture()(),true);
    ui.controller.dispose();ui.controller.mount();assert.equal(ui.shell.count('drop'),0);assert.equal(ui.window.count('pageshow'),0);assert.equal(ui.window.count('pagehide'),0);assert.equal(ui.controller.capture()(),false);
});
test('smart open generation rejects previous work and ordinary autosave remains valid',()=>{
    const ui=setup(),old=ui.controller.capture(),first=ui.controller.beginOpen();assert.equal(old(),false);assert.equal(first(),true);
    const next=ui.controller.beginOpen();assert.equal(first(),false);assert.equal(next(),true);
    const current=ui.controller.capture();ui.deps.canvas={id:'a',updated_at:20};assert.equal(current(),true);
});
for(const where of ['board','node'])test(`smart ${where} directory parsing cannot survive pause and resume`,async()=>{
    const ui=setup(),gate=deferred();ui.deps.resolveSmartImageDropPayload=()=>gate.promise;ui.controller.mount();
    const event={target:{closest:()=>null},dataTransfer:{getData:()=>''},preventDefault(){},stopPropagation(){}};
    const pending=where==='board'?ui.shell.fire('drop',event):ui.controller.dropOnNode(event,'one');
    await ui.window.fire('pagehide');await ui.window.fire('pageshow');gate.resolve({type:'files',files:[{}]});await pending;assert.equal(ui.calls.length,0);
});
test('smart node drop validates the target after directory parsing',async()=>{
    const ui=setup(),gate=deferred();ui.deps.resolveSmartImageDropPayload=()=>gate.promise;
    const pending=ui.controller.dropOnNode({dataTransfer:{},preventDefault(){},stopPropagation(){}},'one');ui.deps.nodes.splice(0,1);gate.resolve({type:'files',files:[{}]});await pending;assert.equal(ui.calls.length,0);
});
test('smart dynamic picker is one-shot and keeps its original node',()=>{
    const ui=setup();ui.controller.pick('one');const input=ui.inputs[0],change=input.onchange;input.files=[{name:'fixture.png'}];ui.deps.selectedId='two';change();change();
    assert.equal(ui.calls.length,1);assert.equal(ui.calls[0][2],'one');assert.equal(input.onchange,null);assert.equal(input.oncancel,null);assert.equal(input.removed,true);
});
test('smart obsolete picker is removed and cannot upload after reopening',()=>{
    const ui=setup();ui.controller.pick('one');const input=ui.inputs[0],change=input.onchange;input.files=[{}];ui.controller.beginOpen();change();assert.equal(ui.calls.length,0);assert.equal(input.removed,true);
});
test('smart picker cancel cleans its callbacks without uploading',()=>{
    const ui=setup();ui.controller.pick('one');const input=ui.inputs[0];input.oncancel();assert.equal(input.onchange,null);assert.equal(input.removed,true);assert.equal(ui.calls.length,0);
});
test('smart shared picker retains its original selection and ignores a later old change',async()=>{
    const ui=setup();ui.controller.mount();await ui.fileInput.fire('click');ui.deps.selectedId='two';ui.fileInput.files=[{}];await ui.fileInput.fire('change');assert.equal(ui.calls[0][2],'one');
    await ui.fileInput.fire('click');ui.controller.beginOpen();await ui.fileInput.fire('change');assert.equal(ui.calls.length,1);
});
test('smart shared picker opened without a target must create a new node despite a later selection',async()=>{
    const ui=setup();ui.deps.selectedId='';ui.controller.mount();await ui.fileInput.fire('click');ui.deps.selectedId='two';ui.fileInput.files=[{}];await ui.fileInput.fire('change');
    assert.equal(ui.calls[0][2],'');assert.equal(ui.calls[0][3].forceNew,true);
});
test('smart shared group-point picker must create at the captured point',async()=>{
    const ui=setup();ui.deps.pendingGroupUploadPoint={x:10,y:20};ui.controller.mount();await ui.fileInput.fire('click');ui.deps.pendingGroupUploadPoint={x:90,y:80};ui.fileInput.files=[{}];await ui.fileInput.fire('change');
    assert.equal(ui.calls[0][2],'');assert.deepEqual(ui.calls[0][3],{point:{x:10,y:20},forceNew:true});
});
test('smart workflow picker and clipboard are inactive while suspended',async()=>{
    const ui=setup();ui.controller.mount();await ui.workflowInput.fire('click');ui.workflowInput.files=[{}];ui.controller.suspend();ui.controller.mount();await ui.workflowInput.fire('change');assert.equal(ui.calls.length,0);
    ui.controller.suspend();await ui.window.fire('paste',{clipboardData:{files:[{}]}});assert.equal(ui.calls.length,0);
});
