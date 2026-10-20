const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {createTaskContext}=require('./canvas_task_test_helpers.cjs');
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
const uploaded=()=>({ok:true,json:async()=>({files:[{url:'/assets/new.png',kind:'image'}]})});
const workflow=()=>({ok:true,json:async()=>({nodes:[{id:'old',type:'smart-prompt',text:'self-made',images:[]}],connections:[]})});
function setup(request){
    const effects={saves:0,undo:0,renders:0,closes:0,toasts:[]},calls=[];let serial=0;
    const scope=createTaskContext({File,FormData,canvasId:'a',canvas:{id:'a',connections:[]},nodes:[{id:'one',type:'smart-image',images:[]},{id:'two',type:'smart-image',images:[]}],selectedId:'one',selectedIds:[],selectedImage:{nodeId:'',index:-1},activeComposerSubject:null,undoSuppressed:false,
        SMART_UPLOAD_MAX:20,SMART_UPLOAD_MAX_FILE_BYTES:100e6,SMART_UPLOAD_MAX_BATCH_BYTES:500e6,
        window:{},isSupportedUploadFile:()=>true,mediaKindForFile:()=> 'image',mediaKindForItem:()=> 'image',
        selectedNode:()=>scope.nodes.find(n=>n.id===scope.selectedId),isSmartImageNode:n=>n?.type==='smart-image',isSmartGroupNode:n=>n?.type==='smart-group',
        viewportCenter:()=>({x:0,y:0}),nodeRect:()=>({x:0,y:0,width:300,height:200}),nodeScale:()=>1,
        createImageNodeAt:point=>{const n={id:'new'+(++serial),type:'smart-image',images:[],...point};scope.nodes.push(n);return n;},addNodeToSmartGroup(){},
        pushUndo(){effects.undo++;},render(){effects.renders++;},scheduleSave(){effects.saves++;},toast:text=>effects.toasts.push(text),tr:x=>x,
        fetch:async(...args)=>{calls.push(args);return request(...args);},smartImageNameFromUrl:()=> 'fixture',
        smartWorkflowTransferSub:null,smartWorkflowTransferModal:{classList:{remove(){effects.closes++;},contains:()=>false}},smartWorkflowToggle:null,smartWorkflowImportDropZone:null,
        uid:()=>String(++serial),serializableSmartNode:n=>JSON.parse(JSON.stringify(n)),normalizeLegacySmartNode:n=>n,remapSmartViewAdjustRefs(){},remapSmartDepthCopies(){},responseErrorMessage:async()=> 'fixture error'});
    return {scope,effects,calls};
}
function upload(ui,target=''){ui.scope.file=new File(['self-made'],'fixture.png',{type:'image/png'});ui.scope.target=target;return vm.runInContext('SmartUploadCoordination.handleFiles(smartUploadHost(),[file],target)',ui.scope);}
function switchCanvas(ui){ui.scope.canvas={id:'b',connections:[]};ui.scope.nodes=[{id:'one',type:'smart-image',images:[]}];}
function untouched(ui){assert.equal(ui.scope.nodes[0].images.length,0);assert.equal(ui.effects.undo,0);assert.equal(ui.effects.saves,0);assert.equal(ui.effects.renders,0);assert.deepEqual(ui.effects.toasts,[]);}
test('smart late upload cannot mutate another canvas',async()=>{const g=deferred(),ui=setup(()=>g.promise),p=upload(ui,'one');switchCanvas(ui);g.resolve(uploaded());await p;untouched(ui);});
test('smart upload retains the node selected before awaiting',async()=>{const g=deferred(),ui=setup(()=>g.promise),p=upload(ui);ui.scope.selectedId='two';g.resolve(uploaded());await p;assert.equal(ui.scope.nodes[0].images.length,1);assert.equal(ui.scope.nodes[1].images.length,0);});
test('smart deleted upload target does not fall back to a later selection',async()=>{const g=deferred(),ui=setup(()=>g.promise),p=upload(ui,'one');ui.scope.nodes.splice(0,1);ui.scope.selectedId='two';g.resolve(uploaded());await p;untouched(ui);});
test('smart ordinary autosave replacement keeps the pending upload valid',async()=>{const g=deferred(),ui=setup(()=>g.promise),p=upload(ui,'one');ui.scope.canvas={id:'a',updated_at:100};g.resolve(uploaded());await p;assert.equal(ui.scope.nodes[0].images.length,1);assert.equal(ui.effects.saves,1);});
test('smart same-id reopen invalidates an upload even when the target id remains',async()=>{const g=deferred(),ui=setup(()=>g.promise),p=upload(ui,'one');ui.scope.smartMediaInputController.beginOpen();ui.scope.canvas={id:'a'};g.resolve(uploaded());await p;untouched(ui);});
test('smart upload stays invalid after suspension',async()=>{const g=deferred(),ui=setup(()=>g.promise),p=upload(ui,'one');ui.scope.smartMediaInputController.suspend();g.resolve(uploaded());await p;untouched(ui);});
test('smart initially unselected upload never changes a later selected image',async()=>{const g=deferred(),ui=setup(()=>g.promise);ui.scope.selectedId='';const p=upload(ui);ui.scope.selectedId='two';g.resolve(uploaded());await p;assert.equal(ui.scope.nodes[1].images.length,0);assert.equal(ui.scope.nodes.length,3);assert.equal(ui.scope.nodes[2].images.length,1);});
test('smart local-path import waits before recording undo and discards a late result',async()=>{const g=deferred(),ui=setup(()=>g.promise);const p=vm.runInContext("SmartUploadCoordination.handleSmartImageDropPayload(smartUploadHost(),{type:'localPaths',localPaths:['self-made.png']},'one')",ui.scope);assert.equal(ui.effects.undo,0);switchCanvas(ui);g.resolve(uploaded());await p;untouched(ui);});
test('smart late upload failure cannot show an error on another canvas',async()=>{const g=deferred(),ui=setup(()=>g.promise),p=upload(ui,'one');switchCanvas(ui);g.resolve({ok:false,clone:()=>({json:async()=>({detail:'old failure'})}),text:async()=>''});await p;untouched(ui);});
test('smart workflow import discards late nodes and modal changes',async()=>{const g=deferred(),ui=setup(()=>g.promise);ui.scope.file=new File(['{}'],'workflow.json');const p=vm.runInContext('SmartWorkflowTransfer.importSmartWorkflowFile(smartWorkflowTransferHost(),file)',ui.scope);switchCanvas(ui);g.resolve(workflow());await p;assert.equal(ui.scope.nodes.length,1);assert.equal(ui.effects.closes,0);untouched(ui);});
test('smart workflow late asset-check warning does not reach another canvas',async()=>{const check=deferred(),ui=setup(url=>url==='/api/canvas-workflows/import'?{ok:true,json:async()=>({nodes:[{id:'old',type:'smart-image',images:[{url:'/assets/missing.png'}]}]})}:check.promise);ui.scope.file=new File(['{}'],'workflow.json');const p=vm.runInContext('SmartWorkflowTransfer.importSmartWorkflowFile(smartWorkflowTransferHost(),file)',ui.scope);await new Promise(done=>setImmediate(done));switchCanvas(ui);ui.effects.toasts.length=0;check.resolve({ok:true,json:async()=>({exists:{'/assets/missing.png':false}})});await p;assert.deepEqual(ui.effects.toasts,[]);});
