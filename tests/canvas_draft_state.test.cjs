const {createTaskContext}=require('./canvas_task_test_helpers.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const recoverySource=readFileSync(path.join(__dirname,'../static/js/canvas-save-recovery.js'),'utf8');
const classicSource=readFileSync(path.join(__dirname,'../static/js/canvas.js'),'utf8');
const smartSource=readFileSync(path.join(__dirname,'../static/js/smart-canvas.js'),'utf8');
function section(source,start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b);}
function helper(){const context=createTaskContext({});vm.runInContext(recoverySource,context);return context.CanvasSaveRecovery;}

test('draft snapshots retain metadata and serialized task IDs while copying connections',()=>{
    const h=helper(),canvas={id:'c',title:'中文',meta_revision:4,settings:{seed:7},logs:[{id:'log'}]};
    const nodes=[{id:'out',_pending:[{canvasTaskId:'original-task'}]}],connections=[{from:'p',to:'out',extra:{x:1}}];
    const result=h.draftSnapshot(canvas,nodes,connections);
    assert.equal(result.title,'中文');assert.equal(result.meta_revision,4);assert.equal(result.nodes,nodes);
    assert.equal(result.nodes[0]._pending[0].canvasTaskId,'original-task');
    result.connections[0].extra.x=2;assert.equal(connections[0].extra.x,1);
    assert.equal(canvas.nodes,undefined);assert.equal(result.settings,canvas.settings);
});
test('missing connections become an empty array without changing the document',()=>{
    const canvas={id:'c'};const result=helper().draftSnapshot(canvas,[],null);
    assert.equal(result.connections.length,0);assert.equal(canvas.connections,undefined);
});
test('no recovered draft produces no replacement state',()=>{
    assert.equal(helper().recoveredState(null,{x:5}),null);
});
test('recovered state preserves local viewport and remote metadata without mutating inputs',()=>{
    const h=helper(),viewport={x:7,y:8,scale:2},recovered={canvas:{id:'c',viewport:{x:99},meta_revision:3,nodes:[]},conflicts:1};
    const state=h.recoveredState(recovered,viewport);
    assert.equal(state.canvas.viewport,viewport);assert.equal(state.canvas.meta_revision,3);assert.equal(state.hasConflict,true);
    assert.match(state.message,/冲突副本/);assert.equal(recovered.canvas.viewport.x,99);
});
test('nonconflicting restore keeps the retry instruction without claiming saved',()=>{
    const state=helper().recoveredState({canvas:{nodes:[]},conflicts:0},{});
    assert.equal(state.hasConflict,false);assert.equal(state.message,'已恢复未保存的本机草稿，请检查后重试保存。');
});

function editor(kind,recovered){
    const events=[],backups=[];let text='';
    const label={set textContent(value){text=value;events.push('message');},get textContent(){return text;}};
    const e=createTaskContext({window:{},document:{getElementById:()=>({hidden:true,querySelector:()=>label}),querySelector:()=>label},
        canvas:{id:'c',nodes:[],connections:[],settings:{old:true}},canvasId:'c',nodes:[],connections:[],viewport:{x:12,y:14,scale:2},
        localCanvasDirty:false,canvasDefaultSmartSettings:{old:true},SMART_LOG_PREVIEW_NODE_ID:'preview',
        cloneNode:node=>({...node,id:node.id+'-copy'}),cloneSmartNode:node=>({...node,id:node.id+'-copy'}),
        serializableCanvasNodes:()=>e.nodes.map(node=>({...node})),
        serializableSmartNode:node=>({...node,serialized:true}),
        savePromptDraftForCurrent:()=>events.push('flush'),canvasForStorage:()=>JSON.parse(JSON.stringify(e.canvas)),
        normalizeLegacySmartNode:node=>node.id==='invalid'?null:{...node,normalized:true},
        cloneSmartSettings:settings=>JSON.parse(JSON.stringify(settings)),
        rememberServerCanvasNodes:Object.assign(()=>{},{snapshot:{id:'c',nodes:[]}}),
        setCanvasSaveError:()=>events.push('warning')});
    vm.runInContext(recoverySource,e);
    e.window.CanvasSaveRecovery.recoverDraft=(actualKind,id,base,makeCopy)=>{
        assert.equal(actualKind,kind);assert.equal(id,'c');assert.equal(typeof makeCopy,'function');return recovered;
    };
    e.window.CanvasSaveRecovery.saveDraft=(actualKind,id,base,local)=>{events.push('backup');backups.push({kind:actualKind,id,base,local});return true;};
    const code=kind==='classic'?section(classicSource,'let classicSaveBase = null;','async function saveCanvas(){'):
        section(smartSource,'function backupSmartDraft(){','function setCanvasSaveError(');
    vm.runInContext(code,e);
    return {e,events,backups,label,restore:()=>vm.runInContext(kind==='classic'?'restoreClassicDraft()':'restoreSmartDraft()',e)};
}
test('classic host restores nodes and connections, keeps tasks and backs up before warning',()=>{
    const recovered={canvas:{id:'c',nodes:[{id:'n',_pending:[{canvasTaskId:'original'}]}],connections:[{from:'a',to:'n'}]},conflicts:1};
    const h=editor('classic',recovered);assert.equal(h.restore(),true);
    assert.equal(h.e.localCanvasDirty,true);assert.equal(h.e.nodes[0]._pending[0].canvasTaskId,'original');
    assert.equal(h.e.connections[0].to,'n');assert.equal(h.e.canvas.viewport,h.e.viewport);
    assert.deepEqual(h.events,['backup','message']);assert.equal(h.backups[0].local.nodes[0]._pending[0].canvasTaskId,'original');
    assert.equal(h.e.setClassicSaveWarning.conflict,true);
});
test('smart host normalizes restored nodes/settings and omits preview from its next backup',()=>{
    const recovered={canvas:{id:'c',nodes:[{id:'n'},{id:'invalid'},{id:'preview'}],connections:[{from:'n',to:'n'}],settings:{model:'selected'}},conflicts:1};
    const h=editor('smart',recovered);assert.equal(h.restore(),true);
    assert.deepEqual(Array.from(h.e.nodes,node=>node.id),['n','preview']);assert.equal(h.e.nodes[0].normalized,true);
    assert.equal(h.e.canvasDefaultSmartSettings.model,'selected');assert.notEqual(h.e.canvasDefaultSmartSettings,recovered.canvas.settings);
    assert.deepEqual(h.events,['warning','message','flush','backup']);
    assert.deepEqual(Array.from(h.backups[0].local.nodes,node=>node.id),['n']);assert.equal(h.backups[0].local.nodes[0].serialized,true);
});
test('both hosts leave state and feedback alone when there is no draft',()=>{
    for(const kind of ['classic','smart']){const h=editor(kind,null),old=h.e.canvas;assert.equal(h.restore(),false);assert.equal(h.e.canvas,old);assert.deepEqual(h.events,[]);}
});
test('classic conflict copy removes old execution handles only from the copy',()=>{
    const h=editor('classic',null);h.e.original={id:'n',_pending:[{canvasTaskId:'old'}],_directPending:[{taskId:'old'}]};
    const copy=vm.runInContext('classicConflictCopy(original)',h.e);
    assert.equal(copy._pending,undefined);assert.equal(copy._directPending,undefined);assert.equal(h.e.original._pending[0].canvasTaskId,'old');
});
