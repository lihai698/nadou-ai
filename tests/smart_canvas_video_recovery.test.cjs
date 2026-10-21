const {createTaskContext}=require('./canvas_task_test_helpers.cjs');
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {readFileSync} = require('node:fs');
const path = require('node:path');

const source = readFileSync(path.join(__dirname, '../static/js/smart-canvas.js'), 'utf8');
function section(begin, end){
    const start = source.indexOf(begin);
    const stop = source.indexOf(end, start);
    assert.ok(start >= 0 && stop > start, `${begin} should precede ${end}`);
    return source.slice(start, stop);
}

function harness(error){
    const sourceNode = {id:'source', type:'smart-image', images:[{url:'/assets/input.png'}]};
    const nodes = [sourceNode];
    const canvas = {connections:[]};
    const settings = {engine:'api', apiKind:'video', videoProvider:'mock-video', videoModel:'mock-video', count:1};
    const notices = [];
    const calls = {video:0, posts:0, saves:0};
    const context = createTaskContext({
        nodes, canvas, settings, window:{}, promptInput:{innerHTML:''}, smartLoopContext:null,
        selectedId:'source', selectedIds:[], selectedImage:{nodeId:'', index:-1}, undoSuppressed:false,
        selectedNode:()=>sourceNode, smartNodeInFlight:()=>false,
        confirmSmartUnknownResubmission:()=>true,
        buildPromptRequest:()=>({prompt:'recovery prompt', displayPrompt:'recovery prompt', refs:[]}),
        cloneSmartSettings:value=>({...value}), smartSettingsForNode:()=>settings,
        smartRunNeedsPrompt:()=>true, isApiLikeEngine:engine=>engine === 'api',
        snapshotRunMeta:()=>({}), smartRunSnapshot:()=>({}), rememberRecentSmartSettings:()=>{},
        stripRunInputMeta:value=>value,
        nowMs:()=>1, isSmartGroupNode:()=>false, isSmartImageNode:()=>true,
        smartImageUsesWorkflowInput:()=>false, pushUndo:()=>{},
        pendingBoxSize:()=>({w:240, h:180}), attachRunMeta:()=>{}, coolNodeRunningState:()=>{},
        syncRunButtonState:()=>{}, render:()=>{}, scheduleSave:()=>{calls.saves++;},
        clearPromptInput:()=>{}, handleJimengPendingSignal:()=>false,
        addSmartGenerationLog:()=>{}, restoreSourceVisualState:()=>{}, restoreFromExtraction:()=>{},
        clearNodeRunningState:()=>{}, toast:message=>notices.push(String(message)),
        tr:key=>key, uid:()=> 'recovery12345678',
        createPendingOutputFromSource:sourceNodeArg=>{
            const branch = {id:'branch', type:'smart-image', images:[], pending:1, running:true};
            nodes.push(branch);
            canvas.connections.push({from:sourceNodeArg.id, to:branch.id, kind:'flow'});
            return branch;
        },
        runApiVideoGeneration:async()=>{
            calls.video++;
            const failure = Object.assign(new Error(error.message || '视频任务状态未知'), error);
            throw failure;
        },
        fetch:async()=>{ calls.posts++; throw new Error('unexpected network submission'); },
        resultMediaUrls:value=>value?.videos || [],
        escapeHtml:value=>String(value ?? ''), escapeAttr:value=>String(value ?? ''),
    });
    vm.runInContext(readFileSync(path.join(__dirname, '../static/js/canvas-audio.js'), 'utf8'),context);
    vm.runInContext(readFileSync(path.join(__dirname, '../static/js/smart-canvas-audio-host.js'), 'utf8'),context);
    vm.runInContext(
        section('function smartPendingTasks(', 'class JimengPendingSignal')
        + section('function prepareSmartVideoTask(', 'async function refreshSmartVideoCanvasTaskOnce')
        + section('async function runGeneration(', 'async function runPromptLLMNode('),
        context
    );
    vm.runInContext(section('function smartRecoverableImageTask(', 'function smartNodeToolbarImageIndex('), context);
    return {context, nodes, canvas, notices, calls};
}

function branchFrom(h){
    return h.nodes.find(node => node.id === 'branch');
}

test('query-paused video keeps a branch node, task id, and an enabled query button', async()=>{
    const h = harness({queryPaused:true, message:'查询暂停'});
    await vm.runInContext('runGeneration()', h.context);
    const branch = branchFrom(h);
    assert.ok(branch, 'branch node should remain visible');
    assert.equal(h.calls.video, 1);
    assert.equal(h.calls.posts, 0);
    assert.equal(branch.videoTaskId, 'canvas_video_recovery12345678');
    assert.equal(branch.pendingTasks[0].queryPaused, true);
    assert.equal(branch.pendingTasks[0].taskLost, false);
    assert.equal(branch.pending, 1);
    const html = vm.runInContext('imageTaskRecoverBodyHtml(nodes.find(node => node.id === "branch"), smartRecoverableImageTask(nodes.find(node => node.id === "branch")), {width:240,height:180})', h.context);
    assert.match(html, /查询结果/);
    assert.doesNotMatch(html, /disabled/);
});

test('unknown video with a refreshable remote task keeps the branch and enables remote refresh', async()=>{
    for(const error of [
        {videoTaskUnknown:true, queryPaused:true, taskLost:false, remoteRefreshable:true, message:'远端状态未知'},
        {taskLost:true, remoteRefreshable:true, message:'远端状态未知'},
    ]){
        const h = harness(error);
        await vm.runInContext('runGeneration()', h.context);
        const branch = branchFrom(h);
        assert.ok(branch, 'branch node should remain visible');
        assert.equal(h.calls.video, 1);
        assert.equal(h.calls.posts, 0);
        assert.equal(branch.pendingTasks[0].taskId, branch.videoTaskId);
        assert.equal(branch.pendingTasks[0].taskLost, Boolean(error.taskLost));
        assert.equal(branch.pendingTasks[0].remoteRefreshable, true);
        assert.equal(branch.pending, 1);
        const html = vm.runInContext('imageTaskRecoverBodyHtml(nodes.find(node => node.id === "branch"), smartRecoverableImageTask(nodes.find(node => node.id === "branch")), {width:240,height:180})', h.context);
        assert.match(html, /刷新远端结果/);
        assert.doesNotMatch(html, /disabled/);
    }
});

for(const stage of ['image','video'])test(`shot ${stage}: rejected retry restores its result binding and dependent video input`,async()=>{
    const h=harness({message:'本次请求被拒绝'}),sourceNode=h.nodes[0];
    sourceNode.shotTableOrigin={tableId:'table',rowId:'shot',sourceFingerprint:'fp',stage,imageNodeId:'input'};
    const input={id:'input',type:'smart-image',images:[{url:'/assets/current.png',kind:'image'}]},video={id:'video',type:'smart-image',shotTableOrigin:{imageNodeId:'source'}};
    const mapping=stage==='video'?{generatorId:'input',outputId:'input',video:{generatorId:'source',outputId:'source'}}:{generatorId:'source',outputId:'source',video:{generatorId:'video',outputId:'video'}};
    h.nodes.push(input,video,{id:'table',type:'smart-shot-table',shotTableData:{generationMap:{'fp:shot':mapping}}});
    h.canvas.connections.push({from:'source',to:'video',kind:'input'});
    h.context.imageRefsOnly=refs=>refs.filter(r=>r.kind==='image');
    h.context.buildPromptRequest=()=>({prompt:'本镜提示词',displayPrompt:'本镜提示词',refs:[{url:'/assets/current.png',kind:'image'}]});
    await vm.runInContext('runGeneration()',h.context);
    const slot=stage==='video'?mapping.video:mapping;
    assert.equal(h.calls.video,1);assert.equal(h.context.nodes.some(n=>n.id==='branch'),false);assert.equal(slot.outputId,'source');assert.equal(sourceNode.images[0].url,'/assets/input.png');
    if(stage==='image'){assert.ok(h.canvas.connections.some(c=>c.from==='source'&&c.to==='video'&&c.kind==='input'));assert.equal(video.shotTableOrigin.imageNodeId,'source');}
    assert.ok(h.calls.saves>0);
});

test('shot video: an uncertain retry keeps its new branch mapping for querying the original task',async()=>{
    const h=harness({queryPaused:true,message:'等待查询原任务'}),sourceNode=h.nodes[0];
    sourceNode.shotTableOrigin={tableId:'table',rowId:'shot',sourceFingerprint:'fp',stage:'video',imageNodeId:'input'};
    const mapping={generatorId:'input',outputId:'input',video:{generatorId:'source',outputId:'source'}};
    h.nodes.push({id:'input',type:'smart-image',images:[{url:'/assets/current.png',kind:'image'}]},{id:'table',shotTableData:{generationMap:{'fp:shot':mapping}}});
    h.context.imageRefsOnly=refs=>refs;
    h.context.buildPromptRequest=()=>({prompt:'本镜提示词',displayPrompt:'本镜提示词',refs:[{url:'/assets/current.png',kind:'image'}]});
    await vm.runInContext('runGeneration()',h.context);
    assert.equal(mapping.video.outputId,'branch');assert.ok(h.context.nodes.some(n=>n.id==='branch'));assert.equal(h.calls.video,1);
});
