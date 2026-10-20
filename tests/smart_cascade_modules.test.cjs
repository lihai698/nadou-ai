const {test}=require('node:test');
const assert=require('node:assert/strict');
const state=require('../static/js/smart-cascade-state.js');
const runner=require('../static/js/smart-cascade-runner.js');
const steps=require('../static/js/smart-cascade-steps.js');

function host(){
    const h={smartCascadeRuns:new Map(),smartCascadeRunning:false,smartCascadeActiveLoopId:'',smartCascadeStopRequested:false,smartCascadeRunPath:null,
        toast:()=>{},render:()=>{},smartUnknownResubmissionNotice:()=> 'unknown acceptance'};
    for(const [name,fn] of Object.entries(state))h[name]=(...args)=>fn(h,...args);
    return h;
}

test('stopping one loop leaves another loop runnable',()=>{
    const h=host(),a={runKey:'a',stopRequested:false},b={runKey:'b',stopRequested:false};h.smartCascadeRuns.set('a',a);h.smartCascadeRuns.set('b',b);
    state.syncSmartCascadeLegacyState(h,'b');state.requestSmartCascadeStop(h,'a');
    assert.equal(a.stopRequested,true);assert.equal(b.stopRequested,false);
    assert.throws(()=>state.throwIfSmartCascadeStopRequested(h,a),e=>e.smartCascadeStopped);
    assert.doesNotThrow(()=>state.throwIfSmartCascadeStopRequested(h,b));
    h.smartCascadeRuns.delete('a');state.syncSmartCascadeLegacyState(h);
    assert.equal(h.smartCascadeActiveLoopId,'b');assert.equal(h.smartCascadeStopRequested,false);
});

test('edge status uses the owning run and explicit context',()=>{
    const h=host(),a={runPath:{states:{edge:'active'}}},b={runPath:{states:{other:'done'}}};
    h.smartCascadeRuns.set('a',a);h.smartCascadeRuns.set('b',b);
    assert.equal(state.smartCascadeEdgeState(h,'edge'),'active');assert.equal(state.smartCascadePathForCtx(h,{runState:b}),b.runPath);
});

test('parallel rounds stop claiming work after unknown acceptance',async()=>{
    const h=host(),runState={},calls=[];
    await assert.rejects(runner.runSmartCascadeRoundsWithLimit(h,[1,2,3],2,async value=>{calls.push(value);runState.submissionUnknown=true;},runState),/unknown acceptance/);
    assert.deepEqual(calls,[1]);
});

test('parallel round failures are surfaced and limit remains bounded',async()=>{
    const h=host();let active=0,peak=0;
    await assert.rejects(runner.runSmartCascadeRoundsWithLimit(h,[1,2,3],2,async value=>{
        active++;peak=Math.max(peak,active);await new Promise(resolve=>setImmediate(resolve));active--;
        if(value===2)throw new Error('fixture failure');
    },{}),/fixture failure/);
    assert.equal(peak,2);
});

test('failed loop execution releases its run and restores selection/settings',async()=>{
    const h=host(),tail={id:'tail'},loop={id:'loop'},slot={id:'slot'},previous={engine:'fixture'};
    Object.assign(h,{settings:previous,selectedId:'selected',selectedIds:[],selectedImage:{},smartLoopContext:null,
        promptInput:{innerHTML:'original'},runBtn:{disabled:false},cascadeRunBtn:{disabled:false},
        selectedNode:()=>tail,canRunSmartCascade:()=>true,savePromptDraftForCurrent:()=>{},
        smartCascadeGraphForTail:()=>({path:[tail],edges:[],children:new Map()}),resolveSmartCascadeLoop:()=>({node:loop,count:1,mode:'serial'}),
        isDirectLoopTargetRun:()=>true,smartUnknownSubmissionForNode:()=>false,cloneSmartSettings:x=>({...x}),pushUndo:()=>{},
        loopOutputSlotForRound:()=>slot,tagLoopOutputSlot:x=>x,refsForDirectLoopRound:()=>[],showDirectLoopRoundPreview:()=>{},
        runLoopRoundIntoSlot:async()=>{throw new Error('fixture failure');},syncRunButtonState:()=>{h.runBtn.disabled=false;},
        finishLoopTargetPreviewState:()=>{},scheduleSave:()=>{},tr:x=>x});
    await runner.runSmartCascade(h,tail);
    assert.equal(h.smartCascadeRuns.size,0);assert.equal(h.smartCascadeRunning,false);assert.equal(h.smartCascadeSilentSelection,false);
    assert.equal(h.selectedId,'selected');assert.deepEqual(h.settings,previous);assert.equal(h.promptInput.innerHTML,'original');assert.equal(h.runBtn.disabled,false);
});

test('missing prompt restores shared settings before reporting failure',async()=>{
    const h={settings:{engine:'original'},smartSettingsForNode:()=>({engine:'fixture'}),smartUnknownSubmissionForNode:()=>false,
        smartHasAudioAnalysisInput:()=>false,smartApiAudioMode:()=>false,cloneSmartSettings:x=>({...x}),smartLoopRoundSettings:x=>x,
        validOutpaintSize:()=>null,selfReferenceImagesForNode:()=>[],defaultReferenceImagesFor:()=>[],buildPromptRequestForNode:()=>({prompt:'',displayPrompt:'',refs:[]}),smartRunNeedsPrompt:()=>true};
    await assert.rejects(steps.runCascadeStepIntoNode(h,{id:'source'},{id:'target'},[],{}),/缺少提示词/);
    assert.deepEqual(h.settings,{engine:'original'});
});
