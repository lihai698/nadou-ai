const {test}=require('node:test');
const assert=require('node:assert/strict');
const api=require('../static/js/canvas-task-results.js');
const runtime=require('../static/js/canvas-task-runtime.js');

function classic(){
    const source={id:'source',type:'generator',running:true},out={id:'out',type:'output',images:[],_pending:[{id:'p',canvasTaskId:'task',startedAt:1,run:{node:{id:'source'},refs:[]}}]};
    const logs=[];
    const host={nodes:[source,out],connections:[{from:'source',to:'out'}],canvas:{id:'canvas'},
        CANVAS_MEDIA_OUTPUT_TYPES:['generator','video','rh'],
        outputUrlValue:x=>typeof x==='string'?x:x?.url||'',mediaKindForOutputItem:x=>x?.kind||'image',isVideoUrl:x=>x.endsWith('.mp4'),
        outputNodesForSource:()=>[out],nowMs:()=>10,requestMetaFromResult:()=>({}),
        addGenerationLog:x=>logs.push(x),refreshRunNodes:()=>{},syncGeneratorInputs:()=>{},refreshGeneratorInputViews:()=>{},scheduleSave:()=>{},
        resultMediaUrls:x=>x.images||x.videos||[],extractUpstreamTaskId:()=>'',providerIdForPending:()=> 'fixture',tr:x=>x,
    };
    return {host,source,out,logs};
}

test('classic image completion updates source and output once and removes accepted placeholder',()=>{
    const {host,source,out,logs}=classic();
    api.completeCanvasImageTask(host,'task',{images:['image.png']});
    assert.deepEqual(source.generatedOutputs,['image.png']);assert.equal(source.running,false);
    assert.equal(out.images.length,1);assert.equal(out.images[0].url,'image.png');assert.equal(out._pending.length,0);assert.equal(logs.length,1);
    api.completeCanvasImageTask(host,'task',{images:['image.png']});assert.equal(logs.length,1);
});

test('video late fallback cannot write to a removed source',()=>{
    const {host,source,out,logs}=classic();const pending=out._pending[0];out._pending=[];host.nodes=[out];
    assert.equal(api.completeCanvasVideoTask(host,'task',{videos:['video.mp4']},{node:source,out,pending}),false);
    assert.equal(out.images.length,0);assert.equal(logs.length,0);
});

test('image failure with upstream ID retains recovery placeholder',()=>{
    const {host,source,out}=classic();api.failCanvasImageTask(host,'task','failed',{upstream_task_id:'remote'});
    assert.equal(source.runStatus,'failed');assert.equal(out._pending[0].recoverTaskId,'remote');
    assert.equal(out._pending[0].failed,true);
});

test('smart finalization deduplicates media and clears terminal video state',()=>{
    const node={pending:1,pendingTasks:[{taskId:'task'}],images:[{url:'same.mp4',kind:'video'}],videoTaskId:'task',submissionUnknown:true};
    const host={smartPendingTasks:n=>n.pendingTasks||[],resultMediaUrls:x=>x,cleanHistoryImages:x=>x,
        stripImageGenerationMeta:x=>x,copyMediaSizeFields:(_item,value)=>value,nowMs:()=>10,
        MEDIA_NODE_DEFAULT_SCALE:1,MEDIA_GROUP_PREVIOUS_DEFAULT_SCALE:1,MEDIA_GROUP_DEFAULT_SCALE:.7,mediaNodeDefaultScale:()=>1};
    api.finalizeSmartPendingTask(host,node,'task',[{url:'same.mp4',kind:'video'},{url:'new.mp4',kind:'video'}],'video');
    assert.equal(node.images.length,2);assert.equal(node.pending,0);assert.equal(node.pendingTasks,undefined);
    assert.equal(node.videoTaskId,undefined);assert.equal(node.submissionUnknown,undefined);
});

test('append mode uses injected URL reader and keeps existing outputs unique',()=>{
    const {host,source,out}=classic();source.generatedOutputs=['old.png'];
    api.mergeGeneratedOutputs(host,source,['old.png','new.png'],true);
    assert.deepEqual(source.generatedOutputs,['old.png','new.png']);
    assert.equal(out.images[0].url,'new.png');
});

test('classic restored image queries the real local route and never posts',async()=>{
    const {host,out}=classic();const calls=[];
    Object.assign(host,{activeCanvasTaskPolls:new Set(),findPendingTask:id=>api.findPendingTask(host,id),
        cascadeFetch:async(url,options)=>{calls.push({url,options});return {ok:true,status:200,json:async()=>({status:'succeeded',result:{images:['image.png']}})};},
        completeCanvasImageTask:(id,result)=>api.completeCanvasImageTask(host,id,result),
        normalizeCanvasTaskError:e=>e.message,isCascadeAbortError:()=>false});
    assert.equal(await runtime.pollCanvasImageTask(host,'task'),'succeeded');
    assert.deepEqual(calls,[{url:'/api/canvas-image-tasks/task',options:{}}]);
    assert.equal(out.images.length,1);assert.equal(host.activeCanvasTaskPolls.size,0);
});
