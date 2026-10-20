const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const {createTaskContext}=require('./canvas_task_test_helpers.cjs');

function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
function response(){return {ok:true,json:async()=>({nodes:[{id:'old',type:'prompt',text:'imported'}],connections:[]})};}
function setup(request){
    const effects={undo:0,saves:0,renders:0,closes:0,errors:[]},calls=[];let serial=0;
    const scope=createTaskContext({Blob,File,FormData,canvas:{id:'a'},canvasOpenGeneration:1,nodes:[],connections:[],
        selected:new Set(),lastMouseBoard:{x:0,y:0},missingAssetUrls:new Set(),
        window:{CanvasAudio:{detachTask(){},migrate(){}}},
        workflowTransferModal:{classList:{remove(){effects.closes++;}}},workflowTransferToggle:null,workflowImportDropZone:null,
        fetch:async(...args)=>{calls.push(args);return request(...args);},
        showErrorModal:message=>effects.errors.push(message),canvasLocalAssetUrls:()=>[],pushUndo(){effects.undo++;},
        uid:()=>String(++serial),serializableCanvasNode:n=>n,remapCanvasDepthCopies(){},sanitizeConnections(){},syncGeneratorInputs(){},
        render(){effects.renders++;},scheduleSave(){effects.saves++;},setStatus(){},refreshMissingCanvasAssets:async()=>{},
        dropOverlay:{classList:{remove(){}}},console:{warn(){}}});
    return {scope,effects,calls,file:new File(['{}'],'self-made.json',{type:'application/json'})};
}
function start(ui){ui.scope.file=ui.file;return vm.runInContext('CanvasWorkflowTransfer.importWorkflowFile(classicWorkflowTransferHost(),file)',ui.scope);}
function changeCanvas(ui,reopen=false){ui.scope.canvas={id:reopen?'a':'b'};ui.scope.canvasOpenGeneration++;ui.scope.nodes=[];ui.scope.connections=[];}
function untouched(ui){assert.equal(ui.scope.nodes.length,0);assert.equal(ui.effects.undo,0);assert.equal(ui.effects.saves,0);assert.equal(ui.effects.renders,0);assert.equal(ui.effects.closes,0);assert.deepEqual(ui.effects.errors,[]);}

for(const reopen of [false,true])test(`classic workflow import ignores a late response after ${reopen?'same-id reopen':'canvas switch'}`,async()=>{
    const gate=deferred(),ui=setup(()=>gate.promise),pending=start(ui);
    changeCanvas(ui,reopen);gate.resolve(response());await pending;untouched(ui);
});
test('classic workflow import survives an ordinary autosave canvas replacement',async()=>{
    const gate=deferred(),ui=setup(()=>gate.promise),pending=start(ui);
    ui.scope.canvas={id:'a',updated_at:200};gate.resolve(response());await pending;
    assert.equal(ui.scope.nodes[0].text,'imported');assert.equal(ui.effects.undo,1);assert.equal(ui.effects.saves,1);assert.equal(ui.effects.closes,1);assert.deepEqual(ui.effects.errors,[]);
});
test('classic workflow import ignores a response after controller suspension',async()=>{
    const gate=deferred(),ui=setup(()=>gate.promise),pending=start(ui);
    ui.scope.classicMediaInputController.suspend();gate.resolve(response());await pending;untouched(ui);
});
test('classic workflow asset download cannot start an import for another canvas',async()=>{
    const gate=deferred(),ui=setup(()=>gate.promise);
    const pending=vm.runInContext("CanvasWorkflowTransfer.importWorkflowAssetUrl(classicWorkflowTransferHost(),'/assets/self-made.json')",ui.scope);
    changeCanvas(ui);gate.resolve({ok:true,blob:async()=>new Blob(['{}'])});await pending;
    assert.equal(ui.calls.length,1);untouched(ui);
});
test('classic workflow import suppresses an obsolete error while decoding its response',async()=>{
    const gate=deferred(),ui=setup(async()=>({ok:false}));
    ui.scope.responseErrorMessage=()=>gate.promise;const pending=start(ui);await Promise.resolve();await Promise.resolve();
    changeCanvas(ui);gate.resolve('old import error');await pending;untouched(ui);
});
test('classic workflow post-import checks cannot close or warn on the reopened canvas',async()=>{
    const gate=deferred(),ui=setup(async()=>response());ui.scope.refreshMissingCanvasAssets=()=>gate.promise;
    const pending=start(ui);await new Promise(done=>setImmediate(done));
    assert.equal(ui.scope.nodes.length,1);const renders=ui.effects.renders;
    changeCanvas(ui,true);ui.scope.missingAssetUrls.add('/assets/missing.png');gate.resolve();await pending;
    assert.equal(ui.effects.renders,renders);assert.equal(ui.effects.closes,0);assert.deepEqual(ui.effects.errors,[]);
});

function loadAssetCheck(ui){
    const source=readFileSync(path.join(__dirname,'../static/js/canvas.js'),'utf8');
    const start=source.indexOf('async function refreshMissingCanvasAssets(');
    vm.runInContext(source.slice(start,source.indexOf('\n}',start)+2),ui.scope);
    ui.scope.canvasLocalAssetUrls=()=>['/assets/missing.png'];
}
test('classic missing-asset check survives autosave without comparing canvas object identity',async()=>{
    const gate=deferred(),ui=setup(()=>gate.promise);loadAssetCheck(ui);
    const pending=vm.runInContext('refreshMissingCanvasAssets()',ui.scope);
    ui.scope.canvas={id:'a',updated_at:200};gate.resolve({json:async()=>({exists:{'/assets/missing.png':false}})});await pending;
    assert.equal(ui.scope.missingAssetUrls.has('/assets/missing.png'),true);
});
test('classic missing-asset check discards a result after controller suspension',async()=>{
    const gate=deferred(),ui=setup(()=>gate.promise);loadAssetCheck(ui);
    const pending=vm.runInContext('refreshMissingCanvasAssets()',ui.scope);
    ui.scope.classicMediaInputController.suspend();gate.resolve({json:async()=>({exists:{'/assets/missing.png':false}})});await pending;
    assert.equal(ui.scope.missingAssetUrls.size,0);
});
