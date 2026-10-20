const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createTaskContext}=require('./canvas_task_test_helpers.cjs');

function entry(context,file,name){
    const source=readFileSync(path.join(__dirname,'../static/js',file),'utf8');
    const start=source.indexOf(`function ${name}(`);
    assert.ok(start>=0);
    vm.runInContext(source.slice(start,source.indexOf('\n}',start)+2),context);
}
function classic(){
    const events=[];
    const e=createTaskContext({canvas:{id:'c'},nodes:[],connections:[],viewport:{x:12,y:23,scale:2},
        selected:new Set(['keep','gone']),localCanvasDirty:false,applyingRemoteCanvas:false,
        classicSaveScheduler:{pending:false},classicSaveSession:{isSaving:false,queued:false},
        classicRemoteSync:{schedule:delay=>events.push(['defer',delay])},
        window:{CanvasAudio:{migrate:n=>n}},currentCanvasTitle:{},currentCanvasTime:{},
        resetCascadeRuntimeState(){},localViewportForCanvas:(id,v)=>v,rememberClassicSaveBase(){},
        sanitizeConnections(){},pruneMissingComfyWorkflows(){},refreshMissingCanvasAssets:async()=>{},
        render:()=>events.push(['render',e.applyingRemoteCanvas]),resumeCanvasImageTasks(){},resumeCanvasAudioTasks(){},
        formatCanvasTime:String,tr:x=>x,setStatus:value=>events.push(['status',value])});
    entry(e,'canvas.js','applyRemoteCanvasData');
    return {e,events};
}
test('classic remote application ignores another canvas and defers while edits are pending',()=>{
    const {e,events}=classic();
    e.applyRemoteCanvasData({id:'other'});assert.equal(events.length,0);
    e.localCanvasDirty=true;e.applyRemoteCanvasData({id:'c'});
    assert.deepEqual(events,[['defer',1000]]);assert.equal(e.canvas.id,'c');
});
test('classic remote application preserves viewport and surviving selections while resetting run state',async()=>{
    const {e,events}=classic();const viewport=e.viewport;
    e.applyRemoteCanvasData({id:'c',title:'remote',nodes:[{id:'keep',running:true,runError:'old'}],updated_at:42});
    assert.equal(e.viewport,viewport);assert.deepEqual([...e.selected],['keep']);
    assert.equal(e.nodes[0].running,false);assert.equal(e.nodes[0].runError,'');
    assert.equal(e.lastCanvasUpdatedAt,42);assert.equal(e.currentCanvasTitle.textContent,'remote');
    assert.equal(e.applyingRemoteCanvas,false);assert.ok(events.some(x=>x[0]==='render'&&x[1]===true));
    await Promise.resolve();assert.ok(events.some(x=>x[0]==='render'&&x[1]===false));
});
test('classic remote application releases its applying flag if rendering fails',()=>{
    const {e}=classic();e.render=()=>{throw Error('render failed');};
    // Keep the asynchronous asset refresh pending to isolate the synchronous failure.
    e.refreshMissingCanvasAssets=()=>new Promise(()=>{});
    assert.throws(()=>e.applyRemoteCanvasData({id:'c',nodes:[]}),/render failed/);
    assert.equal(e.applyingRemoteCanvas,false);
});
function smart(){
    const events=[],label={};const warning=()=>{};
    const group={id:'g',type:'group',items:['keep','removed']};
    const copy={id:'copy',_conflictSourceId:'keep'};
    const e=createTaskContext({canvas:{id:'c',title:'old',connections:[{id:'edge',from:'keep',to:'g'}]},
        nodes:[{id:'keep'},group],canvasBaseNodes:new Map(),setCanvasSaveError:warning,
        document:{title:'old',getElementById:()=>label,querySelector:()=>label},window:{CanvasSaveRecovery:{}},
        invalidateSmartVideoDeconstruction(){},normalizeLegacySmartNode:n=>n,
        mergeSmartNodeLists:(local,remote,base,copies)=>{copies.push(copy);return [{id:'keep'},group,copy];},
        mergeSmartConnections:local=>local.slice(),isSmartGroupNode:n=>n.type==='group',
        clearCompletedNodeBusyStates:()=>false,recoverStuckLoopOutputsFromLogs:()=>false,
        rememberServerCanvasNodes:doc=>events.push(['base',doc.updated_at]),render(){},backupSmartDraft(){},
        toast:value=>events.push(['toast',value]),scheduleSave:()=>events.push(['save']),
        resumeSmartPendingTasks:()=>events.push(['resume']),resumeSmartAudioTasks(){},resumeJimengPendingNodes(){}});
    entry(e,'smart-canvas.js','applyMergedServerCanvas');return {e,events,label,warning};
}
test('smart remote application keeps conflict edges, prunes group members and writes the real warning property',()=>{
    const {e,events,label,warning}=smart();
    assert.equal(e.applyMergedServerCanvas({title:'remote',nodes:[],updated_at:55,meta_revision:3}),true);
    assert.equal(e.nodes[1].items.join(','),'keep');
    assert.ok(e.canvas.connections.some(edge=>edge.from==='copy'&&edge.to==='g'));
    assert.equal(warning.conflict,true);assert.match(label.textContent,/冲突副本/);
    assert.equal(e.canvas.meta_revision,3);assert.equal(e.document.title,'remote');
    assert.deepEqual(events.filter(x=>x[0]==='base'),[['base',55]]);
    assert.equal(events.filter(x=>x[0]==='save').length,1);assert.ok(events.some(x=>x[0]==='resume'));
});
test('smart remote application ignores missing state without resetting anything',()=>{
    const {e,events}=smart();assert.equal(e.applyMergedServerCanvas(null),false);
    e.canvas=null;assert.equal(e.applyMergedServerCanvas({}),false);assert.equal(events.length,0);
});
