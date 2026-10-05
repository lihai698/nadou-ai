const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {createServer} = require('node:http');
const {readFileSync} = require('node:fs');
const path = require('node:path');

const source = readFileSync(path.join(__dirname, '../static/js/smart-canvas.js'), 'utf8');
function section(begin, end){
    const start=source.indexOf(begin);
    const stop=source.indexOf(end,start);
    assert.ok(start>=0 && stop>start, `${begin} should precede ${end}`);
    return source.slice(start,stop);
}

function smartHarness(base, approve=()=>false){
    const node={id:'source',type:'smart-image',images:[]};
    const nodes=[node];
    const canvas={connections:[]};
    const notices=[];
    let confirmations=0, snapshots=0, saved=0, posts=0;
    const settings={engine:'api',provider_id:'mock',model:'mock-image',count:1,ratio:'square',resolution:'1k'};
    const context=vm.createContext({
        nodes,canvas,settings,smartLoopContext:null,undoSuppressed:false,
        selectedNode:()=>node,smartNodeInFlight:()=>false,
        window:{confirm:message=>{confirmations++;assert.match(message,/可能已受理.*重复计费/);return approve();}},
        buildPromptRequest:()=>({prompt:'隔离测试',displayPrompt:'隔离测试',refs:[]}),
        cloneSmartSettings:value=>({...value}),smartSettingsForNode:()=>settings,
        smartRunNeedsPrompt:()=>true,isApiLikeEngine:engine=>engine==='api',
        snapshotRunMeta:()=>({}),smartRunSnapshot:()=>({}),rememberRecentSmartSettings:()=>{},
        nowMs:()=>1,isSmartGroupNode:()=>false,isSmartImageNode:()=>true,
        smartImageUsesWorkflowInput:()=>false,pushUndo:()=>{snapshots++;},
        pendingBoxSize:()=>({w:240,h:180}),attachRunMeta:()=>{},
        coolNodeRunningState:()=>{},syncRunButtonState:()=>{},render:()=>{},
        runningHubSelectedModel:()=>null,saveCanvas:async()=>true,
        resumeSmartPendingNode:async pending=>{
            pending.images=[{url:'local-result.png'}];
            pending.pendingTasks=[];
            pending.pending=0;
        },
        smartRecoverableImageTask:()=>null,clearPromptInput:()=>{},
        handleJimengPendingSignal:()=>false,addSmartGenerationLog:()=>{},
        scheduleSave:()=>{saved++;},toast:message=>notices.push(message),
        tr:key=>key,sizeForRun:()=> '1024x1024',API_RATIO_VALUES:{square:'1:1'},
        imageRefsOnly:refs=>refs,SMART_REFERENCE_IMAGE_MAX:8,
        fetch:(url,init)=>{posts++;return fetch(base+url,init);},
    });
    vm.runInContext(section('function smartUnknownSubmissionForNode(', 'function smartTaskSubmissionWarning('),context);
    vm.runInContext(section('function smartTaskSubmissionWarning(', 'async function runApiGeneration('),context);
    vm.runInContext(section('async function runApiGeneration(', 'function smartCompactJson('),context);
    vm.runInContext(section('async function runGeneration(', 'async function runPromptLLMNode('),context);
    return {node,nodes,canvas,context,notices,
        get confirmations(){return confirmations;},get snapshots(){return snapshots;},get saved(){return saved;},get posts(){return posts;},
        run:()=>vm.runInContext('runGeneration()',context)};
}

test('manual smart image retry uses one explicit confirmation and preserves an earlier unknown warning',async()=>{
    for(const first of [
        {status:408,body:{detail:'isolated timeout'}},
        {status:200,body:{status:'queued'}},
    ]){
        const calls=[];
        const server=createServer((request,response)=>{
            calls.push({method:request.method,path:request.url});
            const answer=calls.length===1 ? first : {status:202,body:{task_id:'known-after-confirm'}};
            response.writeHead(answer.status,{'Content-Type':'application/json'});
            response.end(JSON.stringify(answer.body));
        });
        try {
            await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
            let approved=false;
            const h=smartHarness(`http://127.0.0.1:${server.address().port}`,()=>approved);
            await h.run();
            assert.equal(calls.length,1);
            assert.equal(h.node.submissionUnknown,true);
            assert.match(h.node.submissionWarning,/可能已受理/);
            const oldWarning=h.node.submissionWarning;
            const snapshots=h.snapshots;
            await h.run();
            assert.equal(h.confirmations,1);
            assert.equal(calls.length,1);
            assert.equal(h.snapshots,snapshots);
            approved=true;
            await h.run();
            assert.equal(h.confirmations,2);
            assert.equal(calls.length,2);
            assert.deepEqual(calls.map(call=>[call.method,call.path]),[
                ['POST','/api/canvas-image-tasks'],['POST','/api/canvas-image-tasks'],
            ]);
            assert.equal(h.node.submissionUnknown,true);
            assert.equal(h.node.submissionWarning,oldWarning);
            assert.equal(h.node.images[0]?.url,'local-result.png',JSON.stringify(h.notices));
        } finally {
            await new Promise(resolve=>server.close(resolve));
        }
    }
});

test('the manual entry checks unknown warnings on a connected output branch',async()=>{
    const h=smartHarness('http://127.0.0.1:1');
    const branch={id:'branch',type:'smart-image',submissionUnknown:true,submissionWarning:'可能已受理'};
    h.nodes.push(branch);
    h.canvas.connections.push({from:'source',to:'branch',kind:'flow'});
    assert.equal(h.context.smartUnknownSubmissionForNode(h.node),branch);
    await h.run();
    assert.equal(h.confirmations,1);
    assert.equal(h.posts,0);
    assert.equal(h.snapshots,0);
});

test('one-click smart cascade stops before any submit when its path has an unknown branch',async()=>{
    const h=smartHarness('http://127.0.0.1:1');
    const branch={id:'branch',type:'smart-image',submissionUnknown:true,submissionWarning:'可能已受理'};
    h.nodes.push(branch);
    h.canvas.connections.push({from:'source',to:'branch',kind:'flow'});
    Object.assign(h.context,{
        canRunSmartCascade:()=>true,savePromptDraftForCurrent:()=>{},
        smartCascadeGraphForTail:()=>({path:[h.node],edges:[{source:h.node,target:branch}],root:h.node}),
        resolveSmartCascadeLoop:()=>null,smartCascadeAnyRunning:()=>false,
    });
    vm.runInContext(section('async function runSmartCascade(', 'function runSmartCascadeFromLoop('),h.context);
    await vm.runInContext('runSmartCascade()',h.context);
    assert.equal(h.confirmations,0);
    assert.equal(h.snapshots,0);
    assert.match(h.notices.at(-1),/一键运行已停止/);
});

test('cascade steps stop if an unknown status appears after the initial preflight',async()=>{
    const h=smartHarness('http://127.0.0.1:1');
    const target={id:'target',type:'smart-image',submissionUnknown:true};
    h.nodes.push(target);
    const stepStart=source.indexOf('async function runCascadeStepIntoNode(');
    const stepEnd=source.indexOf('    const requestNode =',stepStart);
    assert.ok(stepStart>=0 && stepEnd>stepStart);
    vm.runInContext(source.slice(stepStart,stepEnd)+'    return [];\n}',h.context);
    h.context.target=target;
    await assert.rejects(vm.runInContext('runCascadeStepIntoNode(nodes[0],target,[])',h.context),/一键运行已停止/);

    const loopStart=source.indexOf('async function runLoopRoundIntoSlot(');
    const loopEnd=source.indexOf('    const previousSettings =',loopStart);
    assert.ok(loopStart>=0 && loopEnd>loopStart);
    h.context.liveSmartNode=node=>node;
    vm.runInContext(source.slice(loopStart,loopEnd)+'    return [];\n}',h.context);
    await assert.rejects(vm.runInContext('runLoopRoundIntoSlot({id:"loop"},nodes[0],target,1,{})',h.context),/一键运行已停止/);
});

test('a partially accepted batch marks the shared cascade state as unknown',()=>{
    const h=smartHarness('http://127.0.0.1:1');
    h.context.runState={submissionUnknown:false};
    h.context.partial={
        count:2,taskIds:['accepted'],providerId:'mock',model:'mock-image',
        submissionFailures:[{kind:'unknown',message:'lost response'}],
    };
    vm.runInContext('recordSmartTaskSubmission(nodes[0],partial,runState)',h.context);
    assert.equal(h.context.runState.submissionUnknown,true);
    assert.equal(h.node.submissionUnknown,true);
});

test('a partial HTTP batch propagates the unknown state through cascade image generation',async()=>{
    const replies=[
        {status:202,body:{task_id:'accepted'}},
        {status:408,body:{detail:'timeout after acceptance is uncertain'}},
    ];
    const server=createServer((request,response)=>{
        const answer=replies.shift();
        assert.equal(request.url,'/api/canvas-image-tasks');
        response.writeHead(answer.status,{'Content-Type':'application/json'});
        response.end(JSON.stringify(answer.body));
    });
    try {
        await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
        const h=smartHarness(`http://127.0.0.1:${server.address().port}`);
        h.context.settings.count=2;
        h.context.waitSmartCanvasTaskBatch=async()=>['known-result.png'];
        h.context.mediaKindForUrls=()=> 'image';
        h.context.runState={submissionUnknown:false};
        vm.runInContext(section('async function generateUrlsForCurrentSettings(', 'async function generateComfyUrlsWithSettings('),h.context);
        const result=await vm.runInContext("generateUrlsForCurrentSettings(nodes[0],'prompt',[],settings,{runState})",h.context);
        assert.equal(h.posts,2);
        assert.equal(h.context.runState.submissionUnknown,true);
        assert.equal(h.node.submissionUnknown,true);
        assert.deepEqual(Array.from(result.urls),['known-result.png']);
    } finally {
        await new Promise(resolve=>server.close(resolve));
    }
});

test('parallel cascade workers do not claim another round after one submission becomes unknown',async()=>{
    const context=vm.createContext({smartUnknownResubmissionNotice:()=> '受理状态未知，一键运行已停止'});
    vm.runInContext(section('async function runSmartCascadeRoundsWithLimit(', 'async function runSmartCascade('),context);
    const started=[],completed=[];
    const runState={submissionUnknown:false};
    let secondStarted;
    const waitForSecond=new Promise(resolve=>{secondStarted=resolve;});
    const runner=async round=>{
        started.push(round);
        if(round===1){
            await waitForSecond;
            runState.submissionUnknown=true;
        } else if(round===2){
            secondStarted();
            await new Promise(resolve=>setTimeout(resolve,20));
        }
        completed.push(round);
    };
    context.rounds=[1,2,3,4,5];
    context.runner=runner;
    context.runState=runState;
    await assert.rejects(vm.runInContext('runSmartCascadeRoundsWithLimit(rounds,2,runner,runState)',context),/受理状态未知/);
    assert.deepEqual(started,[1,2]);
    assert.deepEqual(completed,[1,2]);
});
