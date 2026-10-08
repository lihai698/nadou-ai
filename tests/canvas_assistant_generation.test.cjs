const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
function section(file,start,end){const s=fs.readFileSync(path.join(__dirname,'../static/js',file),'utf8');const a=s.indexOf(start),b=s.indexOf(end,a);assert.ok(a>=0&&b>a);return s.slice(a,b);}

test('classic native submission consumes the accepted assistant task without posting another task',async()=>{
    let posts=0;
    const c=vm.createContext({cascadeFetch:async()=>{posts++;throw Error('unexpected POST');},responseErrorMessage:async()=>'',tr:x=>x});
    vm.runInContext(section('canvas.js','async function createCanvasImageTask(','async function submitCanvasImageTaskBatch('),c);
    const result=await c.createCanvasImageTask({prompt:'test'},{acceptedTask:{task_id:'accepted-image',status:'queued'}});
    assert.equal(result.task_id,'accepted-image');assert.equal(posts,0);
});

test('smart native submission consumes one accepted task while retaining provider and model',async()=>{
    let posts=0;
    const c=vm.createContext({settings:{},fetch:async()=>{posts++;throw Error('unexpected POST');},sizeForRun:()=> '1024x1024',API_RATIO_VALUES:{square:'1:1'},SMART_REFERENCE_IMAGE_MAX:8,imageRefsOnly:r=>r,tr:x=>x});
    vm.runInContext(section('smart-canvas.js','async function runApiGeneration(','function smartCompactJson('),c);
    const result=await c.runApiGeneration('test',[],{provider_id:'user',model:'image',count:8},{acceptedTask:{task_id:'accepted-smart'}});
    assert.deepEqual(Array.from(result.taskIds),['accepted-smart']);assert.equal(result.count,1);assert.equal(result.providerId,'user');assert.equal(result.model,'image');assert.equal(posts,0);
});

test('ordinary smart image generation still posts through the existing task endpoint',async()=>{
    const calls=[];
    const c=vm.createContext({settings:{},fetch:async(url,options)=>{calls.push([url,JSON.parse(options.body)]);return {ok:true,json:async()=>({task_id:'native-image'})};},sizeForRun:()=> '2048x2048',API_RATIO_VALUES:{square:'1:1'},SMART_REFERENCE_IMAGE_MAX:8,imageRefsOnly:r=>r,tr:x=>x});
    vm.runInContext(section('smart-canvas.js','async function runApiGeneration(','function smartCompactJson('),c);
    const result=await c.runApiGeneration('test',[],{provider_id:'user',model:'image',count:1});
    assert.deepEqual(Array.from(result.taskIds),['native-image']);assert.equal(calls[0][0],'/api/canvas-image-tasks');assert.equal(calls[0][1].size,'2048x2048');
});

test('classic completed assistant task remains consumed after reload removes transient runStatus',async()=>{
    let runs=0;
    const c=vm.createContext({canvas:{id:'canvas-a'},nodes:[{id:'node-a',type:'generator',assistantTaskId:'task-a',assistantCompletedTaskId:'task-a'}],runGenerator:async()=>{runs++;},saveCanvas:async()=>true});
    vm.runInContext(section('canvas.js','async function canvasAssistantGenerateImage(','window.onload ='),c);
    await c.canvasAssistantGenerateImage({canvasId:'canvas-a',nodeId:'node-a'},{task_id:'task-a'});
    assert.equal(runs,0,'reopening history must not duplicate a completed output');
});

test('assistant task cannot execute in a different canvas',async()=>{
    let runs=0;
    const c=vm.createContext({canvas:{id:'other'},nodes:[{id:'node-a',type:'generator'}],runGenerator:async()=>{runs++;}});
    vm.runInContext(section('canvas.js','async function canvasAssistantGenerateImage(','window.onload ='),c);
    await assert.rejects(c.canvasAssistantGenerateImage({canvasId:'canvas-a',nodeId:'node-a'},{task_id:'task-a'}),/画布/);
    assert.equal(runs,0);
});

test('smart assistant run metadata uses its confirmed prompt rather than the unrelated bottom composer',async()=>{
    let metadata;
    const c=vm.createContext({nodes:[{id:'image-a',type:'smart-image'}],settings:{engine:'api'},smartNodeInFlight:()=>false,
        confirmSmartUnknownResubmission:()=>true,cloneSmartSettings:s=>({...s}),smartSettingsForNode:()=>({engine:'api',model:'image'}),
        smartRunNeedsPrompt:()=>true,isApiLikeEngine:()=>true,snapshotRunMeta:()=>metadata={promptText:'unrelated composer',promptHtml:'wrong'},
        escapeHtml:s=>s.replaceAll('<','&lt;'),smartRunSnapshot:()=>({}),rememberRecentSmartSettings:()=>{throw Error('stop before generation');}});
    vm.runInContext(section('smart-canvas.js','async function runGeneration(','async function runPromptLLMNode('),c);
    await assert.rejects(c.runGeneration({assistantProposal:{nodeId:'image-a',prompt:'confirmed <prompt>',referenceImages:[]},acceptedTask:{task_id:'task-a'}}),/stop before generation/);
    assert.equal(metadata.promptText,'confirmed <prompt>');assert.equal(metadata.promptHtml,'confirmed &lt;prompt>');
});

test('smart confirmation refuses a node with an unresolved original task before building a new image request',async()=>{
    const c=vm.createContext({canvas:{id:'canvas-a'},canvasId:'canvas-a',nodes:[{id:'image-a',type:'smart-image'}],smartNodeInFlight:()=>true,smartSettingsForNode:()=>{throw Error('must not prepare a new request');}});
    vm.runInContext(section('smart-canvas.js','async function smartAssistantImageRequest(','async function smartAssistantGenerateImage('),c);
    await assert.rejects(c.smartAssistantImageRequest({canvasId:'canvas-a',nodeId:'image-a'}),/原任务/);
});
