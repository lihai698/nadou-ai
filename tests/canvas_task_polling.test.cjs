const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const source = readFileSync(path.join(__dirname,'../static/js/canvas.js'),'utf8');
const start = source.indexOf('async function pollCanvasImageTask(');
const end = source.indexOf('async function waitCanvasImageTaskResult(',start);
assert.ok(start >= 0 && end > start);
function editor(responses){
    const pending = {id:'p',canvasTaskId:'same-id',run:{node:{id:'gen'}}};
    const out = {_pending:[pending]};
    const gen = {id:'gen',running:true};
    const calls=[], delays=[], completed=[], failed=[];
    const context = vm.createContext({
        activeCanvasTaskPolls:new Set(),nodes:[gen,out],
        findPendingTask:()=>out._pending.length ? {out,pending} : null,
        cascadeFetch:async (url,init)=>{calls.push({url,init}); const r=responses.shift(); if(r instanceof Error) throw r; if(!r) throw new Error('Unexpected extra request'); return {ok:r.status===200,status:r.status,json:async()=>r.data};},
        sleep:async ms=>delays.push(ms),ensureCascadeActive:()=>{},
        cascadeBackendRestartMessage:()=> 'backend restarted',
        responseErrorMessage:async()=> 'query unavailable',tr:k=>k,
        normalizeCanvasTaskError:e=>e.message,isCascadeAbortError:e=>e.name==='CascadeAbort',
        completeCanvasImageTask:(id,result)=>{completed.push(result);out._pending=[];},
        failCanvasImageTask:(id,message)=>{failed.push(message);out._pending=[];},
        refreshRunNodes:()=>{},scheduleSave:()=>{},
    });
    vm.runInContext(source.slice(start,end),context);
    return {pending,out,gen,calls,delays,completed,failed,run:()=>vm.runInContext("pollCanvasImageTask('same-id')",context)};
}
const success=()=>({status:200,data:{status:'succeeded',result:{images:['test.png']}}});

function directBatch(results){
    const gen={id:'gen',type:'generator',x:100,y:100},next={id:'next',type:'generator'};
    const nodes=[gen,next],connections=[{from:'gen',to:'next'}],saved=[],completed=[];
    let serial=0;
    const ctx=vm.createContext({nodes,connections,
        uid:prefix=>prefix+(++serial),makePendingForRun:(id,run,node,options,task)=>({id,run,...task}),
        saveCanvas:async()=>saved.push(JSON.parse(JSON.stringify(nodes))),scheduleSave:()=>{},render:()=>{},refreshRunNodes:()=>{},
        isCascadeAbortError:e=>e.name==='CascadeAbort',tr:x=>x,
        addGenerationLog:()=>{},nowMs:()=>1,requestMetaFromResult:()=>({}),extractUpstreamTaskId:()=>'',
        completeCanvasImageTask:(id,result)=>{completed.push(...result.images);for(const n of nodes)n._pending=(n._pending||[]).filter(p=>p.canvasTaskId!==id);},
        failCanvasImageTask:(id)=>{for(const n of nodes)n._pending=(n._pending||[]).filter(p=>p.canvasTaskId!==id);},
    });
    const begin=source.indexOf('function materializeCanvasDirectTasks(');
    if(begin>=0) vm.runInContext(source.slice(begin,source.indexOf('function completeCanvasImageTask(',begin)),ctx);
    ctx.waitCanvasImageTaskResult=async id=>{const result=results[id];if(result instanceof Error)throw result;return result;};
    return {gen,nodes,connections,saved,completed,ctx,
        run:ids=>{ctx.ids=ids;return vm.runInContext("waitCanvasDirectTasks(nodes[0],ids.map(task_id=>({task_id})),{node:{id:'gen'}},{providerId:'mock'})",ctx);}};
}
test('direct accepted tasks are saved before waiting without adding output on success',async()=>{
    const e=directBatch({one:{images:['one.png']}});
    assert.deepEqual(Array.from(await e.run(['one'])),['one.png']);
    assert.equal(e.saved[0][0]._directPending[0].canvasTaskId,'one');
    assert.equal(e.gen._directPending?.length || 0,0);assert.equal(e.nodes.length,2);
});
test('direct outage materializes a recoverable output with the original task',async()=>{
    const error=Object.assign(new Error('offline'),{queryPaused:true});
    const e=directBatch({one:error});await assert.rejects(e.run(['one']));
    const out=e.nodes.find(n=>n.type==='output');
    assert.equal(out._pending[0].canvasTaskId,'one');assert.equal(out._pending[0].queryPaused,true);
    assert.equal(out._pending[0].cascadeTargetId,'');assert.equal(e.gen._directPending?.length || 0,0);
    assert.ok(e.connections.some(c=>c.from==='gen'&&c.to==='next'));
});
test('direct mixed batch retains completed output while preserving paused sibling',async()=>{
    const error=Object.assign(new Error('offline'),{queryPaused:true});
    const e=directBatch({one:{images:['one.png']},two:error});await assert.rejects(e.run(['one','two']));
    assert.deepEqual(e.completed,['one.png']);
    assert.equal(e.nodes.find(n=>n.type==='output')._pending[0].canvasTaskId,'two');
});
test('reload materializes saved direct tasks once and clears old cascade ownership',()=>{
    const e=directBatch({});e.gen._directPending=[{id:'p',canvasTaskId:'one',cascadeTargetId:'old'}];
    vm.runInContext('materializeCanvasDirectTasks(nodes[0],nodes[0]._directPending)',e.ctx);
    vm.runInContext('materializeCanvasDirectTasks(nodes[0],nodes[0]._directPending || [])',e.ctx);
    assert.equal(e.nodes.filter(n=>n.type==='output').length,1);
    assert.equal(e.nodes.find(n=>n.type==='output')._pending.length,1);
    assert.equal(e.nodes.find(n=>n.type==='output')._pending[0].cascadeTargetId,'');
});
test('a terminal-only direct batch clears its saved records without creating a recovery card',async()=>{
    const e=directBatch({one:new Error('backend restarted')});
    await assert.rejects(e.run(['one']),/backend restarted/);
    assert.equal(e.nodes.length,2);assert.equal(e.gen._directPending?.length || 0,0);
});
test('upstream recovery switches a direct recovery card away from local-query pause',()=>{
    const pending={id:'p',queryPaused:true,run:{node:{id:'gen'}}};
    const gen={id:'gen'},out={_pending:[pending]};
    const ctx=vm.createContext({nodes:[gen,out],findPendingTask:()=>({out,pending}),
        nowMs:()=>1,extractUpstreamTaskId:()=>'',providerIdForPending:()=> 'mock',
        addGenerationLog:()=>{},refreshRunNodes:()=>{},scheduleSave:()=>{},tr:x=>x});
    const begin=source.indexOf('function failCanvasImageTask(');
    vm.runInContext(source.slice(begin,source.indexOf('function resumeCanvasImageTasks(',begin)),ctx);
    vm.runInContext("failCanvasImageTask('one','failed',{upstream_task_id:'remote'})",ctx);
    assert.equal(pending.failed,true);assert.equal(pending.recoverTaskId,'remote');
    assert.equal(Boolean(pending.queryPaused),false);
});

function directWait(responses){
    const calls=[],delays=[];
    let cancelled=false;
    const context=vm.createContext({
        cascadeTargetIdFromOptions:o=>o.cascadeTargetId || '',
        ensureCascadeActive:()=>{if(cancelled){const error=new Error('cancelled');error.name='CascadeAbort';throw error;}},
        isCascadeAbortError:e=>e.name==='CascadeAbort',
        cascadeBackendRestartMessage:()=> 'backend restarted',
        responseErrorMessage:async()=> 'query unavailable',tr:k=>k,
        sleep:async ms=>delays.push(ms),
        cascadeFetch:async(url,init)=>{calls.push({url,init});const r=responses.shift();if(r instanceof Error)throw r;if(!r)throw Error('Unexpected extra request');return {ok:r.status===200,status:r.status,json:async()=>r.data};},
    });
    vm.runInContext(source.slice(end,source.indexOf('function completeCanvasImageTask(',end)),context);
    return {calls,delays,context,cancel:()=>{cancelled=true;},run:()=>vm.runInContext("waitCanvasImageTaskResult('same-id',{cascadeTargetId:'chain'})",context)};
}
test('direct chain wait retries temporary query errors on the original task',async()=>{
    for(const failure of [{status:503},{status:408},{status:429},new TypeError('network')]){
        const e=directWait([failure,success()]);
        assert.equal((await e.run()).images[0],'test.png');
        assert.equal(e.calls.length,2);assert.deepEqual(e.delays,[1000]);
        assert.ok(e.calls.every(c=>c.url==='/api/canvas-image-tasks/same-id' && !c.init.method));
    }
});
test('direct wait bounds retries and resets the budget after a running response',async()=>{
    const e=directWait(Array.from({length:4},()=>({status:503})));
    await assert.rejects(e.run(),/query unavailable/);
    assert.equal(e.calls.length,4);assert.deepEqual(e.delays,[1000,2000,4000]);
    const resumed=directWait([{status:503},{status:200,data:{status:'running'}},{status:503},success()]);
    await resumed.run();assert.deepEqual(resumed.delays,[1000,1800,1000]);
});
test('direct wait keeps terminal failures and cancellation separate from retry',async()=>{
    for(const response of [{status:404},{status:403},{status:200,data:{status:'failed',error:'provider rejected'}}]){
        const e=directWait([response]);await assert.rejects(e.run());
        assert.equal(e.calls.length,1);assert.deepEqual(e.delays,[]);
    }
    const e=directWait([{status:503},success()]);
    e.context.sleep=async ms=>{e.delays.push(ms);e.cancel();};
    await assert.rejects(e.run(),/cancelled/);assert.equal(e.calls.length,1);
});
test('direct wait marks unknown task status as restart-lost without retry',async()=>{
    const e=directWait([{status:200,data:{status:'unknown',error:'本地任务记录已失效'}}]);
    await assert.rejects(e.run(),error=>{
        assert.equal(error.restartLost,true);
        assert.equal(error.taskLost,true);
        return true;
    });
    assert.equal(e.calls.length,1);
    assert.deepEqual(e.delays,[]);
});
test('one query 503 retries the same task and accepts its success',async()=>{
    const e=editor([{status:503},success()]);
    assert.equal(await e.run(),'succeeded');
    assert.equal(e.failed.length,0); assert.equal(e.completed.length,1);
    assert.equal(e.calls.length,2); assert.equal(new Set(e.calls.map(x=>x.url)).size,1);
    assert.ok(e.calls.every(x=>!x.init.method || x.init.method==='GET'));
});
test('network failure retries without submitting a generation',async()=>{
    const e=editor([new TypeError('Failed to fetch'),success()]);
    assert.equal(await e.run(),'succeeded'); assert.equal(e.calls.length,2);
});
test('persistent outage pauses without discarding pending; manual query can recover',async()=>{
    const responses=Array.from({length:4},()=>({status:503}));
    const e=editor(responses);
    assert.equal(await e.run(),'paused');
    assert.equal(e.out._pending.length,1); assert.equal(e.pending.queryPaused,true);
    assert.equal(e.pending.queryRecoverable,true);
    assert.equal(e.failed.length,0); assert.equal(e.gen.running,false);
    assert.deepEqual(e.delays,[1000,2000,4000]);
    responses.push(success());
    assert.equal(await e.run(),'succeeded'); assert.equal(e.completed.length,1);
});
test('a resumed query remains protected from the older batch catch cleanup',()=>{
    const filters=source.match(/remainingPending\.filter\(p => [^\n]+/g);
    assert.equal(filters.length,2);
    for(const filter of filters){
        const context=vm.createContext({remainingPending:[
            {id:'resume',canvasTaskId:'accepted',queryPaused:false,queryRecoverable:true},
            {id:'ordinary'},
        ]});
        assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext(filter,context))),['ordinary']);
    }
});
test('404 remains a terminal restart failure without retry',async()=>{
    const e=editor([{status:404}]); assert.equal(await e.run(),'failed');
    assert.deepEqual(e.failed,['backend restarted']); assert.equal(e.calls.length,1);
});
test('unknown task status keeps the accepted record and stops polling',async()=>{
    const e=editor([{status:200,data:{status:'unknown',error:'本地任务记录已失效'}}]);
    assert.equal(await e.run(),'failed');
    assert.equal(e.calls.length,1);
    assert.deepEqual(e.delays,[]);
    assert.equal(e.out._pending.length,1);
    assert.equal(e.pending.failed,true);
    assert.equal(e.pending.taskLost,true);
    assert.equal(e.pending.queryRecoverable,true);
    assert.match(e.pending.error,/远端是否仍在生成未知/);
    assert.equal(e.gen.runStatus,'task-lost');
});
test('confirmed generation failure is not a query outage',async()=>{
    const e=editor([{status:200,data:{status:'failed',error:'provider rejected'}}]);
    assert.equal(await e.run(),'failed'); assert.deepEqual(e.failed,['provider rejected']);
    assert.equal(e.calls.length,1);
});
test('rate limit retries; a permission error remains terminal',async()=>{
    const limited=editor([{status:429},success()]);
    assert.equal(await limited.run(),'succeeded');
    const denied=editor([{status:403}]);
    assert.equal(await denied.run(),'failed'); assert.equal(denied.calls.length,1);
});
test('explicit cascade cancellation is never retried or converted to failure',async()=>{
    const error=new Error('cancelled'); error.name='CascadeAbort';
    const e=editor([error]);
    assert.equal(await e.run(),'aborted'); assert.equal(e.calls.length,1);
    assert.equal(e.failed.length,0);
});
