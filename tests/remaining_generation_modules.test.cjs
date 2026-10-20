const {test}=require('node:test');
const assert=require('node:assert/strict');
const classic=require('../static/js/canvas-provider-runner.js');
const api=require('../static/js/smart-api-runner.js');
const provider=require('../static/js/smart-provider-runner.js');
const comfy=require('../static/js/smart-comfy-runner.js');
const generation=require('../static/js/smart-generation-runner.js');

test('classic Modelscope assistant entry keeps native catalog confirmation path',async()=>{
    const calls=[];await classic.runMsGenNode({runCanvasAssistantCatalogImage:(...args)=>calls.push(args)},'node',{assistantNativeActionId:'confirmed'});
    assert.equal(calls.length,1);assert.equal(calls[0][0],'node');
});

test('classic RH model mismatch rejects before any submission',async()=>{
    const h={cascadeTargetIdFromOptions:()=>'',rhSelectedEntryRef:()=>({kind:'model',id:'changed'})};
    await assert.rejects(classic.runRhModelNode(h,{rhModel:'original'},{assistantNativeActionId:'confirmed'}),e=>e.submissionKnownRejected===true);
});

test('smart API batch keeps accepted ID and explicit rejection separately',async()=>{
    const responses=[{ok:true,json:async()=>({task_id:'accepted'})},{ok:false,status:400,text:async()=> 'rejected'}],calls=[];
    const h={API_RATIO_VALUES:{square:'1:1'},SMART_REFERENCE_IMAGE_MAX:8,sizeForRun:()=> '1024x1024',imageRefsOnly:x=>x,
        fetch:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return responses.shift();}};
    const result=await api.runApiGeneration(h,'prompt',[],{provider_id:'fixture',model:'selected',count:2,ratio:'square'});
    assert.deepEqual(result.taskIds,['accepted']);assert.equal(result.submissionFailures[0].kind,'rejected');assert.equal(calls.length,2);
    assert.ok(calls.every(call=>call.url==='/api/canvas-image-tasks'&&call.body.n===1));
});

test('smart accepted replay performs no new request',async()=>{
    const h={API_RATIO_VALUES:{},SMART_REFERENCE_IMAGE_MAX:8,sizeForRun:()=> '1024x1024',imageRefsOnly:x=>x,fetch:()=>assert.fail('must not submit')};
    const result=await api.runApiGeneration(h,'prompt',[],{provider_id:'fixture',model:'selected',count:8},{acceptedTask:{task_id:'original'}});
    assert.deepEqual(result.taskIds,['original']);assert.equal(result.count,1);
});

test('smart Modelscope custom mapping preserves resolution and output fallback',async()=>{
    let submitted;
    const h={MS_GEN_MODELS:{custom:{endpoint:'/api/modelscope/generate'}},SMART_REFERENCE_IMAGE_MAX:8,imageRefsOnly:x=>x,
        apiImageSize:()=> '1280x720',parseSizeValue:()=>({width:1280,height:720}),fetch:async(url,options)=>{submitted={url,body:JSON.parse(options.body)};return {ok:true,json:async()=>({images:['result.png']})};}};
    assert.deepEqual(await provider.runModelscopeGeneration(h,'prompt',[],{msgenModel:'custom',msCustomModel:'selected',count:1}),['result.png']);
    assert.equal(submitted.body.model,'selected');assert.equal(submitted.body.width,1280);assert.equal(submitted.body.size,'1280x720');
});

test('smart RunningHub app retains payment mode and queries accepted task ID',async()=>{
    const calls=[],settings={rhPayment:'wallet'};
    const h={selectedRunningHubRef:()=>({kind:'app',id:'fixture'}),rhActiveFields:()=>[{}],rhMediaForRun:()=>({}),
        rhBuildNodeInfoList:async()=>[{nodeId:'1',fieldName:'prompt',fieldValue:'test'}],sleep:async()=>{},resultMediaUrls:x=>x,
        fetch:async(url,options)=>{calls.push({url,options});const data=calls.length===1?{success:true,data:{taskId:'task/id'}}:{success:true,data:{status:'SUCCESS',urls:['result.png']}};
            return {ok:true,clone(){return this;},json:async()=>data};}};
    assert.deepEqual(await provider.runRunningHubGeneration(h,'test',[],settings),['result.png']);
    assert.equal(calls[0].url,'/api/runninghub/submit');assert.equal(JSON.parse(calls[0].options.body).useWallet,true);
    assert.equal(calls[1].url,'/api/runninghub/query?taskId=task%2Fid&useWallet=1');assert.equal(settings.rhTaskId,'task/id');
});

test('smart Comfy text route uses requested dimensions and task coordinator',async()=>{
    let submitted;
    const h={smartClientId:'fixture',imageRefsOnly:x=>x,runQueuedSmartComfyGenerate:async body=>{submitted=body;return {images:['result.png']};},resultMediaUrls:r=>r.images,mediaKindForUrls:()=> 'image'};
    assert.deepEqual(await comfy.generateComfyUrlsWithSettings(h,{comfyMode:'text',width:640,height:360},'prompt',[],{}),{urls:['result.png'],kind:'image'});
    assert.equal(submitted.workflow_json,'Z-Image.json');assert.equal(submitted.width,640);assert.equal(submitted.height,360);
});

test('both smart custom workflow routes submit fresh noise and current prompt and image',async t=>{
    const workflowParams=require('../static/js/smart-workflow-params.js');
    let random=0;
    t.mock.method(Math,'random',()=>random+=0.1);
    for(const direct of [false,true]){
        const calls=[];
        const config={fields:[{id:'prompt',node:'238',input:'value',type:'textarea'},{id:'image',node:'199',input:'image',type:'image'}]};
        const settings={comfyMode:'custom',comfyWorkflow:'custom/test.json'};
        const h={settings,smartClientId:'fixture',comfyWorkflows:[],
            imageRefsOnly:refs=>refs.filter(ref=>ref.kind==='image'),videoRefsOnly:()=>[],audioRefsOnly:()=>[],
            fetch:async()=>({ok:true,json:async()=>({config,workflow:{'129':{class_type:'RandomNoise',inputs:{noise_seed:12}}}})}),
            comfyFieldKind:f=>workflowParams.comfyFieldKind({},f),comfyNameForRef:async()=> 'new-upload.png',
            comfyParamsFromWorkflowValues:(cfg,values)=>workflowParams.comfyParamsFromWorkflowValues({},cfg,values),
            runQueuedSmartComfyGenerate:async body=>{calls.push(body);return {videos:['new-video.mp4']};},
            resultMediaUrls:r=>r.videos,mediaKindForUrls:()=> 'video',finalizePendingNode(){},clearPromptInput(){},scheduleSave(){}};
        for(let i=0;i<2;i++){
            if(direct)await comfy.runComfyGeneration(h,{},'new prompt',[{kind:'image',url:'new.png'}],{},{});
            else await comfy.generateComfyUrlsWithSettings(h,settings,'new prompt',[{kind:'image',url:'new.png'}],{});
        }
        assert.equal(calls.length,2);
        for(const call of calls){
            assert.equal(call.params['238'].value,'new prompt');
            assert.equal(call.params['199'].image,'new-upload.png');
            assert.ok(Number.isInteger(call.params['129'].noise_seed));
        }
        assert.notEqual(calls[0].params['129'].noise_seed,calls[1].params['129'].noise_seed);
    }
});

test('a custom workflow explicit seed field keeps its fixed value',async()=>{
    let submitted;
    const h={smartClientId:'fixture',imageRefsOnly:x=>x,videoRefsOnly:()=>[],audioRefsOnly:()=>[],
        fetch:async()=>({ok:true,json:async()=>({config:{fields:[]},workflow:{noise:{class_type:'RandomNoise',inputs:{noise_seed:12}}}})}),
        comfyParamsFromWorkflowValues:()=>({noise:{noise_seed:42}}),
        runQueuedSmartComfyGenerate:async body=>{submitted=body;return {videos:['result.mp4']};},resultMediaUrls:r=>r.videos,mediaKindForUrls:()=> 'video'};
    await comfy.generateComfyUrlsWithSettings(h,{comfyMode:'custom',comfyWorkflow:'custom/test.json'},'prompt',[],{});
    assert.equal(submitted.params.noise.noise_seed,42);
});

test('smart audio-analysis dispatch uses text route with no system prompt',async()=>{
    let submitted;
    const h={audioRefsOnly:x=>x,isApiLikeEngine:()=>true,providerChatModels:()=>['chosen'],fetch:async(url,options)=>{submitted={url,body:JSON.parse(options.body)};return {ok:true,json:async()=>({text:' answer '})};}};
    const result=await generation.generateUrlsForCurrentSettings(h,{},'question',[{url:'audio.wav'}],{engine:'api',apiKind:'image',provider_id:'fixture',model:'chosen'});
    assert.equal(result.text,'answer');assert.equal(result.kind,'text');assert.equal(submitted.url,'/api/canvas-llm');assert.equal(submitted.body.system_prompt,'');
});
