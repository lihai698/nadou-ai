const {test}=require('node:test');
const assert=require('node:assert/strict');
const api=require('../static/js/canvas-task-transport.js');

function harness(replies){
    const calls=[],delays=[];
    const request=async(url,init={})=>{
        calls.push({url,init});
        const item=replies.shift();
        assert.ok(item,'unexpected extra request');
        return {ok:item.code===200,status:item.code,json:async()=>item.data,text:async()=> 'query failed'};
    };
    return {calls,delays,deps:{
        fetch:request,cascadeFetch:request,sleep:async ms=>delays.push(ms),
        setTimeout:(fn,ms)=>{delays.push(ms);fn();},
        cascadeTargetIdFromOptions:()=>'',ensureCascadeActive:()=>{},isCascadeAbortError:()=>false,
        responseErrorMessage:async(_r,message)=>message,smartResponseErrorMessage:async(_r,message)=>message,
        findPendingTask:()=>null,tr:key=>key,actionFailed:key=>key,cascadeBackendRestartMessage:()=> 'restart',
        resultMediaUrls:value=>value?.images||[],extractUpstreamTaskId:()=>'',
        jimengPending:data=>Object.assign(new Error('pending'),data),imageTaskRecover:data=>Object.assign(new Error('recover'),data),
    }};
}

test('both video waiters refresh unknown task once without resubmitting',async()=>{
    for(const name of ['waitCanvasVideoTaskResult','pollSmartVideoCanvasTask']){
        const h=harness([{code:200,data:{status:'unknown',remote:{query_supported:true,task_id:'remote'}}},
            {code:200,data:{status:'succeeded',result:{videos:['local.mp4']}}}]);
        assert.deepEqual(await api[name](h.deps,'original'),{videos:['local.mp4']});
        assert.deepEqual(h.calls.map(x=>x.init.method||'GET'),['GET','POST']);
        assert.ok(h.calls[1].url.endsWith('/original/refresh'));
    }
});

test('classic retry delay and paused error survive extraction',async()=>{
    const h=harness(Array.from({length:4},()=>({code:503})));
    await assert.rejects(api.waitCanvasImageTaskResult(h.deps,'original'),e=>e.queryPaused===true);
    assert.deepEqual(h.delays,[1000,2000,4000]);
    assert.equal(h.calls.length,4);
});

test('smart task binding rejects a result owned by another canvas',async()=>{
    const h=harness([{code:200,data:{task_id:'original',canvas_id:'other',status:'succeeded',result:{images:['wrong.png']}}}]);
    await assert.rejects(api.waitSmartImageTask(h.deps,'original',{canvas_id:'expected'}),e=>e.queryPaused===true);
    assert.equal(h.calls.length,1);
});

test('accepted image is reused without a second submission',async()=>{
    const h=harness([]),task={task_id:'accepted'};
    assert.equal(await api.createCanvasImageTask(h.deps,{}, {acceptedTask:task}),task);
    assert.equal(h.calls.length,0);
});

test('video submission waits for durable start and acceptance callbacks',async()=>{
    const h=harness([{code:200,data:{task_id:'original'}}]),events=[];
    h.deps.canvasVideoTaskIdForPending=()=> 'original';
    await api.createCanvasVideoTask(h.deps,{}, {}, {
        persistStarted:async()=>{events.push('persist');return true;},
        onSubmitting:()=>events.push('submit'),onAccepted:async()=>events.push('accept'),
    });
    assert.deepEqual(events,['persist','submit','accept']);
    assert.equal(JSON.parse(h.calls[0].init.body).client_task_id,'original');
});
