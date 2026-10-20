const {test}=require('node:test');
const assert=require('node:assert/strict');
const {runComfyNode}=require('../static/js/canvas-comfy-runner.js');

function fixture(fixedSeed=false){
    const calls=[],node={id:'generator',mode:'custom',comfyWorkflow:'custom/test.json'},out={};
    const fields=[{id:'prompt',node:'238',input:'value',type:'prompt'},{id:'image',node:'199',input:'image',type:'image'}];
    if(fixedSeed)fields.push({id:'seed',node:'129',input:'noise_seed',type:'setting'});
    const deps={nodes:[node],CLIENT_ID:'test-client',comfyWorkflows:[],cascadeTargetIdFromOptions:()=>'',
        generatorSources:()=>[{prompt:'new prompt',refs:[{url:'new.png'}]}],orderedSources:(node,sources)=>sources,
        imageRefsOnly:r=>r,videoRefsOnly:()=>[],audioRefsOnly:()=>[],comfyFields:(node,kind)=>fields.filter(f=>f.type===kind),
        comfyFieldKind:f=>f.type,outputForNode:()=>out,uid:()=> 'pending',runSnapshot:()=>({}),comfyRunLabel:()=>'',
        makePendingForRun:()=>({id:'pending'}),refreshRunNodes(){},validComfyWorkflowName:n=>n,
        ensureComfyWorkflow:async()=>({config:{fields},workflow:{'129':{class_type:'RandomNoise',inputs:{noise_seed:12}}}}),
        comfyNameForRef:async()=> 'uploaded-new.png',comfyRandomEnabled:()=>false,comfyParamValue:()=>42,
        runQueuedComfyGenerate:async payload=>{calls.push(payload);return {videos:['new.mp4']};},requestMetaFromResult:()=>({}),
        comfyResultOutputs:r=>r.videos,collectRunMeta:()=>({runMs:1}),appendOutputImages(){},mergeGeneratedOutputs(){},
        addGenerationLog(){},scheduleSave(){},tr:k=>k,noReturnedImage:()=>'',
        alert:message=>{throw new Error(message)},isCascadeAbortError:()=>false};
    return {deps,node,calls};
}

test('classic custom workflow also receives new seeds, current prompt and uploaded image',async t=>{
    let random=0;t.mock.method(Math,'random',()=>random+=0.1);
    const f=fixture();
    for(let i=0;i<2;i++)await runComfyNode(f.deps,f.node.id,{cascade:true});
    assert.equal(f.calls.length,2);
    for(const payload of f.calls){
        assert.equal(payload.params['238'].value,'new prompt');assert.equal(payload.params['199'].image,'uploaded-new.png');
    }
    assert.notEqual(f.calls[0].params['129'].noise_seed,f.calls[1].params['129'].noise_seed);
    assert.equal(f.node.runStatus,'done');
});

test('classic explicit fixed seed remains reproducible',async()=>{
    const f=fixture(true);await runComfyNode(f.deps,f.node.id,{cascade:true});
    assert.equal(f.calls[0].params['129'].noise_seed,42);
});
