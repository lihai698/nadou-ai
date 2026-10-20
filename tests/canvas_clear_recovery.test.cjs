const {createTaskContext}=require('./canvas_task_test_helpers.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const transportSource=fs.readFileSync(path.join(__dirname,'../static/js/canvas-save-transport.js'),'utf8');
const ctx=createTaskContext({});vm.runInContext(transportSource,ctx);
const empty=()=>({id:'c',updated_at:20,nodes:[],connections:[],logs:[],settings:{}});
const response=(status,data)=>({status,ok:status>=200&&status<300,json:async()=>data});
const message='画布已清空，但历史记录未能安全核对，媒体文件已保留。';
function requestSequence(replies,calls=[]){return async(url,init)=>{calls.push({url,init});const value=replies.shift();if(value instanceof Error)throw value;assert.ok(value,'unexpected request');return value;};}
test('clear success does not perform a recovery read',async()=>{
    const calls=[],data={canvas:empty(),removed_files:[]};
    const result=await ctx.CanvasSaveTransport.clearCanvas({id:'c',payload:{base_updated_at:10},request:requestSequence([response(200,data)],calls)});
    assert.equal(result,data);assert.equal(calls.length,1);assert.equal(calls[0].init.method,'POST');
});
test('partial clear failure reads a newer empty canvas once without repeating destructive POST',async()=>{
    const calls=[];const result=await ctx.CanvasSaveTransport.clearCanvas({id:'c',payload:{base_updated_at:10},request:requestSequence([response(500,{detail:message}),response(200,{canvas:empty()})],calls)});
    assert.equal(result.canvas.id,'c');assert.ok(result.warning.includes(message));
    assert.deepEqual(calls.map(c=>c.init?.method||'GET'),['POST','GET']);assert.equal(calls[1].url,'/api/canvases/c');
});
test('recovery rejects missing, wrong-ID, unchanged or nonempty server snapshots',async()=>{
    for(const candidate of [null,{...empty(),id:'other'},{...empty(),updated_at:10},{...empty(),nodes:[{id:'n'}]},{...empty(),connections:[{}]},{...empty(),logs:[{}]},{...empty(),settings:{quality:'high'}},{...empty(),nodes:undefined}]){
        await assert.rejects(ctx.CanvasSaveTransport.clearCanvas({id:'c',payload:{base_updated_at:10},request:requestSequence([response(500,{detail:message}),response(200,{canvas:candidate})])}),new RegExp(message));
    }
});
test('failed readback preserves the original error; 409 is never treated as a cleared canvas',async()=>{
    await assert.rejects(ctx.CanvasSaveTransport.clearCanvas({id:'c',payload:{base_updated_at:10},request:requestSequence([response(500,{detail:message}),response(503,{})])}),new RegExp(message));
    const calls=[],remote={id:'c',nodes:[{}]};
    await assert.rejects(ctx.CanvasSaveTransport.clearCanvas({id:'c',payload:{base_updated_at:10},request:requestSequence([response(409,{detail:{message:'conflict',canvas:remote}})],calls)}),error=>error.status===409&&error.canvas===remote);
    assert.equal(calls.length,1);
});
test('lost POST response can be reconciled only by a confirmed newer empty server document',async()=>{
    const result=await ctx.CanvasSaveTransport.clearCanvas({id:'c',payload:{base_updated_at:10},request:requestSequence([new Error('connection lost'),response(200,{canvas:empty()})])});
    assert.equal(result.canvas.id,'c');assert.ok(result.warning);
});

function editor(kind,replies){
    const events=[],calls=[],old={id:'c',updated_at:10,nodes:[{id:'old'}],connections:[{}],logs:[{}]};
    const e=createTaskContext({canvas:old,canvasId:'c',nodes:old.nodes,connections:old.connections,viewport:{x:0,y:0,scale:1},
        clearCurrentCanvasBtn:{disabled:false},classicSaveSession:{isSaving:false,clearQueue:()=>events.push('queue-cleared')},smartSaveSession:{isSaving:false,clearQueue:()=>events.push('queue-cleared')},
        classicSaveScheduler:{cancel(){}},smartSaveScheduler:{cancel(){}},localCanvasDirty:true,lastCanvasUpdatedAt:10,CLIENT_ID:'local',smartClientId:'local',
        window:{confirm:()=>true,CanvasSaveRecovery:{clearDraft:(kind,id)=>events.push(['draft-cleared',kind,id])}},
        fetch:requestSequence(replies,calls),console:{error(){}},resetCascadeRuntimeState(){},outputTimer:null,
        localStorage:{removeItem(){}},unsavedCanvasAcceptedTasksKey:()=> 'tasks',unknownCanvasSubmissionKey:()=> 'unknown',selected:new Set(['old']),
        localViewportForCanvas:(id,v)=>v,render:()=>events.push('render'),currentCanvasTime:{},formatCanvasTime:String,
        setStatus:text=>events.push(['message',text]),toast:text=>events.push(['message',text]),showErrorModal:text=>events.push(['visible-warning',text]),loadCanvasList:async()=>{},
        rememberClassicSaveBase:doc=>events.push(['base',doc.id,doc.nodes.length]),setClassicSaveWarning:()=>{},
        smartCascadeAnyRunning:()=>false,activeSmartTaskPolls:new Set(),activeSmartComfyTaskPolls:new Set(),resetDeferredActions:()=>{},smartCascadeRuns:new Map(),
        syncSmartCascadeLegacyState(){},runTimerInterval:null,SMART_UNSAVED_ACCEPTED_TASKS_PREFIX:'smart:',invalidateSmartVideoDeconstruction(){},
        cloneSmartSettings:s=>({...s}),initialSmartSettings:{},undoStack:[{}],redoStack:[{}],
        setCanvasSaveError(){},renderDynamicParams(){},rememberServerCanvasNodes:doc=>events.push(['base',doc.id,doc.nodes.length]),
        applyRemoteCanvasData:doc=>events.push(['conflict',doc.id])});
    vm.runInContext(transportSource,e);
    const source=fs.readFileSync(path.join(__dirname,kind==='classic'?'../static/js/canvas.js':'../static/js/smart-canvas.js'),'utf8');
    const begin=kind==='classic'?'async function clearCurrentCanvas(':'async function clearCurrentSmartCanvas(';
    const end=kind==='classic'?'function requestDeleteCanvas(':'function promptPlainText(';
    vm.runInContext(source.slice(source.indexOf(begin),source.indexOf(end,source.indexOf(begin))),e);
    return {e,events,calls,clear:()=>kind==='classic'?e.clearCurrentCanvas():e.clearCurrentSmartCanvas()};
}
for(const kind of ['classic','smart']){
    test(`${kind}: confirmed partial clear empties UI and removes obsolete local draft`,async()=>{
        const h=editor(kind,[response(500,{detail:message}),response(200,{canvas:empty()})]);await h.clear();
        assert.equal(h.e.nodes.length,0);assert.equal(h.e.canvas.nodes.length,0);assert.equal(h.e.clearCurrentCanvasBtn.disabled,false);
        assert.ok(h.events.some(e=>Array.isArray(e)&&e[0]==='draft-cleared'&&e[1]===kind));
        assert.ok(h.events.some(e=>Array.isArray(e)&&e[0]==='base'&&e[2]===0));
        assert.ok(h.events.some(e=>Array.isArray(e)&&['visible-warning','message'].includes(e[0])&&e[1].includes(message)));
    });
    test(`${kind}: unconfirmed failure retains nodes and draft`,async()=>{
        const h=editor(kind,[response(500,{detail:'failed'}),response(200,{canvas:{...empty(),nodes:[{id:'old'}]}})]);await h.clear();
        assert.equal(h.e.nodes[0].id,'old');assert.ok(!h.events.some(e=>Array.isArray(e)&&e[0]==='draft-cleared'));
    });
    test(`${kind}: normal successful clear also resets recovery baseline and draft`,async()=>{
        const h=editor(kind,[response(200,{canvas:empty()})]);await h.clear();
        assert.equal(h.e.nodes.length,0);assert.ok(h.events.some(e=>Array.isArray(e)&&e[0]==='draft-cleared'));
        assert.ok(h.events.some(e=>Array.isArray(e)&&e[0]==='base'&&e[2]===0));
    });
}
