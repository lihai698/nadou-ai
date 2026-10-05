const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname,'../static/js/smart-canvas.js'),'utf8');
function part(start,end){ return source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start))); }
function editor(responses){
    const node={id:'n',images:[],pending:1,pendingTasks:[{taskId:'original',kind:'image'}]};
    const calls=[], delays=[];
    const ctx=vm.createContext({nodes:[node],activeSmartTaskPolls:new Map(),
        fetch:async(url,options)=>{ calls.push({url,options}); const r=responses.shift(); if(r instanceof Error) throw r; if(!r) throw Error('extra request'); return {ok:r.code===200,status:r.code,text:async()=> 'unavailable',json:async()=>r.data}; },
        setTimeout:(fn,ms)=>{delays.push(ms);fn();},render:()=>{},scheduleSave:()=>{},toast:()=>{},tr:x=>x,
        resultMediaUrls:x=>x,nowMs:()=>1,extractUpstreamTaskId:()=>'',
        finalizeSmartPendingTask:(n,id,images)=>{n.pendingTasks=n.pendingTasks.filter(t=>t.taskId!==id);n.pending=n.pendingTasks.length;n.images.push(...images);},
        fetchImageTaskQuery:()=>{throw Error('must not query upstream');},
    });
    vm.runInContext(part('function smartPendingTasks(', 'class JimengPendingSignal')+
        part('class JimengPendingSignal', 'function extractUpstreamTaskId')+
        part('function smartRecoverableImageTask(', 'function imageTaskRecoverBodyHtml')+
        part('async function pollSmartCanvasTask(', 'function finalizeSmartPendingTask')+
        part('async function resumeSmartPendingNode(', 'function updateSelectionBox')+
        part('async function querySmartImageTaskNow(', 'function startJimengPoll'),ctx);
    return {node,calls,delays,ctx,run:()=>vm.runInContext('resumeSmartPendingNode(nodes[0])',ctx),query:()=>vm.runInContext("querySmartImageTaskNow('n','original')",ctx)};
}
const success=()=>({code:200,data:{status:'succeeded',result:{images:['result.png']}}});
test('partial results keep media and an actionable recovery control together',()=>{
    const ctx=vm.createContext({imageForDisplay:x=>x,smartPendingTasks:n=>n.pendingTasks||[],
        escapeHtml:x=>x,escapeAttr:x=>x,selectedImage:{},MEDIA_GROUP_MAX_VISIBLE_ROWS:4,
        mediaKindForItem:()=> 'image',singleMediaHtml:img=>`<img src="${img.url}">`,
        thumbMediaHtml:img=>`<img src="${img.url}">`,imageNameBadgeHtml:()=>'',imageResolutionBadgeHtml:()=>'',tr:x=>x});
    vm.runInContext(part('function nodeBodyHtml(', 'function smartNodeToolbarImageIndex('),ctx);
    for(const count of [1,2]){
        ctx.node={id:'partial',type:'smart-image',images:Array.from({length:count},(_,i)=>({url:`result-${i}.png`})),pendingTasks:[{taskId:'original',queryPaused:true}]};
        const html=vm.runInContext('nodeBodyHtml(node,{width:260,height:195,cols:2,thumb:96})',ctx);
        assert.match(html,/result-0.png/);assert.match(html,/data-image-task-query="partial"/);assert.match(html,/data-task-id="original"/);
    }
});
function batchEditor(responses,taskIds=['original'],engine='api'){
    const e=editor(responses), saved=[];
    e.node.pendingTasks=[];e.node.pending=0;
    Object.assign(e.ctx,{
        settings:{engine,apiKind:'image'},
        isApiLikeEngine:engine=>engine==='api',runningHubSelectedModel:()=>true,
        runningHubModelApiSettings:x=>x,mediaKindForUrls:()=> 'image',
        runApiGeneration:async()=>({taskIds,providerId:'mock',model:'mock'}),
        saveCanvas:async()=>saved.push(JSON.parse(JSON.stringify(e.node))),
    });
    const helper=source.includes('async function waitSmartCanvasTaskBatch(')
        ? part('async function waitSmartCanvasTaskBatch(', 'async function generateUrlsForCurrentSettings(') : '';
    vm.runInContext(helper+part('async function generateUrlsForCurrentSettings(', 'async function generateComfyUrlsWithSettings(')
        +part('function smartTaskSubmissionWarning(', 'async function runApiGeneration('),e.ctx);
    return {...e,saved,batch:()=>vm.runInContext("generateUrlsForCurrentSettings(nodes[0],'test',[])",e.ctx)};
}
test('direct chain persists accepted task before polling and recovers after query pause',async()=>{
    for(const engine of ['api','runninghub']){
        const responses=Array.from({length:4},()=>({code:503}));
        const e=batchEditor(responses,['original'],engine);
        await assert.rejects(e.batch());
        assert.equal(e.saved[0]?.pendingTasks[0]?.taskId,'original');
        assert.equal(e.node.pendingTasks[0]?.queryPaused,true);
        assert.equal(e.node.pending,1);
        responses.push(success());await e.query();
        assert.deepEqual(e.node.images,['result.png']);
        assert.equal(e.node.pending,0);
    }
});
test('direct chain success preserves old output for caller history handling',async()=>{
    const e=batchEditor([success()]);e.node.images=['old.png'];
    const result=await e.batch();
    assert.equal(result.urls[0],'result.png');assert.deepEqual(e.node.images,['old.png']);
    assert.equal(e.node.pendingTasks.length,0);assert.equal(e.node.pending,0);
    assert.equal(e.saved[0]?.pendingTasks[0]?.taskId,'original');
});
test('partial direct batch saves the accepted ID and persistent warning before querying',async()=>{
    const e=batchEditor([success()],['accepted-1']);
    e.ctx.runApiGeneration=async()=>({
        taskIds:['accepted-1'], count:2, providerId:'mock', model:'mock',
        submissionFailures:[{index:2,kind:'unknown',message:'network lost'}],
    });
    const result=await e.batch();
    assert.equal(result.urls[0],'result.png');
    assert.equal(e.saved[0].pendingTasks[0].taskId,'accepted-1');
    assert.match(e.saved[0].submissionWarning,/可能已受理/);
    assert.equal(e.node.submissionUnknown,true);
    assert.equal(e.node.pending,0);
    assert.deepEqual(e.calls.map(call=>call.url),['/api/canvas-image-tasks/accepted-1']);
});
test('mixed direct batch keeps successful output and pauses only the unavailable task',async()=>{
    const e=batchEditor([success(),...Array.from({length:4},()=>({code:503}))],['first','original']);
    await assert.rejects(e.batch());
    assert.deepEqual(e.node.images,['result.png']);
    assert.equal(e.node.pendingTasks.length,1);
    assert.equal(e.node.pendingTasks[0].taskId,'original');
    assert.equal(e.node.pendingTasks[0].queryPaused,true);
});
test('direct batch clears terminal errors but retains upstream recovery IDs',async()=>{
    for(const response of [{code:404},{code:403},{code:200,data:{status:'failed',error:'rejected'}}]){
        const e=batchEditor([response]);await assert.rejects(e.batch());
        assert.equal(e.node.pendingTasks.length,0);assert.equal(e.node.pending,0);
        assert.equal(e.calls.length,1);
    }
    const e=batchEditor([{code:200,data:{status:'failed',error:'upstream failed',upstream_task_id:'remote',provider_id:'mock'}}]);
    await assert.rejects(e.batch());
    assert.equal(e.node.pendingTasks[0].recoverTaskId,'remote');
    assert.equal(e.node.pendingTasks[0].failed,true);assert.equal(e.node.pending,1);
});
test('transient 503 and network failure keep the original task',async()=>{
    for(const failure of [{code:503},new TypeError('network')]){
        const e=editor([failure,success()]);await e.run();
        assert.deepEqual(e.node.images,['result.png']);assert.equal(e.calls.length,2);
        assert.ok(e.calls.every(c=>c.url==='/api/canvas-image-tasks/original' && !c.options));
    }
});
test('persistent query failure keeps pending and manual query recovers same task',async()=>{
    const responses=Array.from({length:4},()=>({code:503}));const e=editor(responses);
    await e.run();assert.equal(e.node.pendingTasks[0].queryPaused,true);
    assert.equal(e.node.pending,1);assert.equal(e.calls.length,4);
    assert.deepEqual(e.delays,[2000,1000,2000,4000]);
    responses.push(success());await e.query();assert.deepEqual(e.node.images,['result.png']);
    assert.equal(e.node.pendingTasks.length,0);assert.equal(e.calls.length,5);
});
test('408 and 429 retry, but permission errors terminate',async()=>{
    for(const code of [408,429]){
        const e=editor([{code},success()]);await e.run();
        assert.deepEqual(e.node.images,['result.png']);assert.equal(e.calls.length,2);
    }
    for(const code of [401,403]){
        const e=editor([{code}]);await assert.rejects(e.run());
        assert.equal(e.calls.length,1);assert.equal(e.node.pending,0);
    }
});
test('a successful running response resets consecutive failure count',async()=>{
    const failure=()=>({code:503});
    const e=editor([failure(),failure(),failure(),{code:200,data:{status:'running'}},failure(),failure(),failure(),success()]);
    await e.run();assert.deepEqual(e.node.images,['result.png']);
    assert.deepEqual(e.delays,[2000,1000,2000,4000,2000,1000,2000,4000]);
});
test('serialized paused tasks resume after reload with stale querying flag cleared',async()=>{
    const e=editor(Array.from({length:4},()=>({code:503})));
    await e.run();
    const reloaded=editor([success()]);
    Object.assign(reloaded.node,JSON.parse(JSON.stringify(e.node)));
    reloaded.node.pendingTasks[0].querying=true;
    vm.runInContext('resumeSmartPendingTasks()',reloaded.ctx);
    for(let i=0;i<30 && reloaded.node.pending;i++) await Promise.resolve();
    assert.deepEqual(reloaded.node.images,['result.png']);
    assert.equal(reloaded.calls.length,1);assert.equal(reloaded.node.pending,0);
});
test('manual query targets only the selected paused task and ignores duplicate clicks',async()=>{
    const e=editor([success()]);
    e.node.pending=2;
    e.node.pendingTasks[0].queryPaused=true;
    e.node.pendingTasks.push({taskId:'other',queryPaused:true});
    await Promise.all([e.query(),e.query()]);
    assert.equal(e.calls.length,1);assert.equal(e.node.pending,1);
    assert.equal(e.node.pendingTasks[0].taskId,'other');
    assert.deepEqual(e.node.images,['result.png']);
});
test('404 and explicit task failure are terminal without retry',async()=>{
    for(const response of [{code:404},{code:200,data:{status:'failed',error:'generation failed'}}]){
        const e=editor([response]);await assert.rejects(e.run());assert.equal(e.calls.length,1);
        assert.equal(e.node.pending,0);
    }
});
test('unknown task status keeps the local image task and does not poll again',async()=>{
    const e=editor([{code:200,data:{status:'unknown',error:'本地任务记录已失效'}}]);
    await e.run();
    assert.equal(e.calls.length,1);
    assert.equal(e.node.pending,1);
    assert.equal(e.node.pendingTasks[0].taskLost,true);
    assert.equal(e.node.pendingTasks[0].failed,true);
    assert.match(e.node.pendingTasks[0].error,/远端是否仍在生成未知/);
    await e.run();
    assert.equal(e.calls.length,1);
});
