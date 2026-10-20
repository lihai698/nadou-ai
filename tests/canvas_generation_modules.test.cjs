const {test}=require('node:test');
const assert=require('node:assert/strict');
const media=require('../static/js/canvas-media-runner.js');
const queue=require('../static/js/canvas-direct-tasks.js');
const comfy=require('../static/js/canvas-comfy-runner.js');
const llm=require('../static/js/canvas-llm-runner.js');
const mj=require('../static/js/canvas-midjourney-runner.js');

test('assistant image confirmation cannot submit an audio branch',async()=>{
    const host={nodes:[{id:'node',type:'generator'}],canvasApiAudioMode:()=>true};
    await assert.rejects(media.runGenerator(host,'node',{assistantNativeActionId:'action'}),e=>e.submissionKnownRejected===true);
});

test('LLM request preserves disabled system prompt and multimodal inputs',async()=>{
    let call;
    const host={resolveChatProviderId:x=>x,resolveChatModel:x=>x,llmInputImages:()=>['image.png'],llmInputVideos:()=>['video.mp4'],llmInputAudios:()=>['audio.wav'],
        cascadeFetch:async(url,options)=>{call={url,body:JSON.parse(options.body)};return {ok:true,json:async()=>({text:'answer'})};}};
    assert.equal(await llm.callCanvasLLM(host,{llmProvider:'fixture',model:'chosen',showSystem:false,systemPrompt:'unused'},'question',[{role:'user',content:'previous'}]),'answer');
    assert.equal(call.url,'/api/canvas-llm');assert.equal(call.body.system_prompt,'');
    assert.deepEqual(call.body.audios,['audio.wav']);assert.equal(call.body.model,'chosen');assert.equal(call.body.messages.length,1);
});

test('Comfy acceptance is backed up before save failure and never polled',async()=>{
    const pending={id:'p',run:{node:{id:'node'}}},node={id:'node'},out={_pending:[pending]},events=[];
    const host={nodes:[node,out],pendingById:()=>pending,createCanvasComfyTask:async()=>{events.push('submit');return {task_id:'accepted'};},
        rememberUnsavedCanvasAcceptedTasks:()=>events.push('backup'),refreshRunNodes:()=>{},saveCanvas:async()=>{events.push('save');return false;},
        pauseCanvasAcceptedTasksUntilSaved:()=>new Error('save failed'),waitCanvasComfyTaskResult:()=>{throw new Error('must not poll');}};
    await assert.rejects(queue.runQueuedComfyGenerate(host,{}, {out,pendingId:'p'}),e=>e.comfyTaskPaused===true);
    assert.deepEqual(events,['submit','backup','save']);assert.equal(pending.canvasTaskId,'accepted');
});

test('pre-submit rejection does not call Comfy submission',async()=>{
    let submits=0;
    await assert.rejects(queue.runQueuedComfyGenerate({nodes:[],pendingById:()=>null,createCanvasComfyTask:()=>submits++},{},{beforeSubmit:()=>{throw new Error('stopped');}}),/stopped/);
    assert.equal(submits,0);
});

test('upscale preserves workflow mapping and selected resolution',async()=>{
    let payload;
    const host={CLIENT_ID:'fixture',uploadCanvasUrlToComfy:async()=> 'uploaded.png',runQueuedComfyGenerate:async body=>{payload=body;return {images:['result.png']};}};
    assert.deepEqual(await comfy.runComfyUpscale(host,'input.png',4096),['result.png']);
    assert.equal(payload.workflow_json,'upscale.json');assert.equal(payload.params['172'].resolution,4096);assert.equal(payload.params['15'].image,'uploaded.png');
});

test('Midjourney query escapes identifiers and only queries original task',async()=>{
    const calls=[];
    const host={cascadeTargetIdFromOptions:()=>'',cascadeFetch:async(url,init)=>{calls.push({url,init});return {ok:true,json:async()=>({status:'succeeded',images:['image.png']})};}};
    await mj.waitMidjourneyTask(host,'provider one','task/id');
    assert.equal(calls[0].url,'/api/midjourney/tasks/task%2Fid?provider_id=provider%20one');assert.equal(calls.length,1);
});
