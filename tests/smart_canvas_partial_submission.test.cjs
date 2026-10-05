const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {readFileSync} = require('node:fs');
const path = require('node:path');

const source = readFileSync(path.join(__dirname, '../static/js/smart-canvas.js'), 'utf8');
const start = source.indexOf('async function runApiGeneration(');
const end = source.indexOf('function smartCompactJson(', start);
assert.ok(start >= 0 && end > start);

function submission(responses){
    const calls = [];
    const context = vm.createContext({
        settings:{provider_id:'mock',model:'mock-image',count:responses.length,ratio:'square',resolution:'1k'},
        tr:key=>key,
        sizeForRun:()=> '1024x1024',
        API_RATIO_VALUES:{square:'1:1'},
        imageRefsOnly:refs=>refs,
        SMART_REFERENCE_IMAGE_MAX:8,
        fetch:async (url, options) => {
            calls.push({url,options});
            const response = responses[calls.length - 1];
            if(response instanceof Error) throw response;
            return response;
        },
    });
    vm.runInContext(source.slice(start,end),context);
    return {calls, run:()=>vm.runInContext("runApiGeneration('测试提示词', [])",context)};
}

const accepted = id => ({ok:true,json:async()=>({task_id:id})});
const rejected = {ok:false,status:400,text:async()=> '模拟明确拒绝'};

test('partial submission keeps the accepted task ID when another POST is rejected', async()=>{
    const e=submission([accepted('accepted-1'),rejected]);
    const result=await e.run();
    assert.deepEqual(Array.from(result.taskIds),['accepted-1']);
    assert.equal(result.submissionFailures.length,1);
    assert.equal(result.submissionFailures[0].kind,'rejected');
    assert.equal(e.calls.length,2);
});

test('lost submit response is reported as unknown without discarding a known task', async()=>{
    const e=submission([accepted('accepted-1'),new TypeError('network lost')]);
    const result=await e.run();
    assert.deepEqual(Array.from(result.taskIds),['accepted-1']);
    assert.equal(result.submissionFailures[0].kind,'unknown');
    assert.equal(e.calls.length,2);
});

test('server error and missing task ID leave acceptance unknown', async()=>{
    for(const response of [
        {ok:false,status:503,text:async()=> 'server unavailable'},
        {ok:true,json:async()=> ({status:'queued'})},
    ]){
        const e=submission([accepted('accepted-1'),response]);
        const result=await e.run();
        assert.deepEqual(Array.from(result.taskIds),['accepted-1']);
        assert.equal(result.submissionFailures[0].kind,'unknown');
        assert.equal(e.calls.length,2);
    }
});

test('zero known IDs still reports unknown acceptance without retrying', async()=>{
    const e=submission([new TypeError('network lost')]);
    const result=await e.run();
    assert.deepEqual(Array.from(result.taskIds),[]);
    assert.equal(result.submissionFailures[0].kind,'unknown');
    assert.equal(e.calls.length,1);
});

function taskState(saveResult){
    const node={id:'output',pendingTasks:[]};
    const notices=[];
    let saves=0, renders=0, scheduled=0, queries=0;
    const context=vm.createContext({
        saveCanvas:async()=>{saves++;return saveResult;},
        smartPendingTasks:node=>(node.pendingTasks || []).filter(task=>task.taskId),
        render:()=>{renders++;}, scheduleSave:()=>{scheduled++;},
        toast:message=>notices.push(message),
        pollSmartCanvasTask:async()=>{queries++;return {images:['image.png']};},
        resultMediaUrls:value=>Array.isArray(value) ? value : (value?.images || []),
        finalizeSmartPendingTask:(node,taskId)=>{node.pendingTasks=node.pendingTasks.filter(task=>task.taskId!==taskId);},
    });
    const begin=source.indexOf('async function waitSmartCanvasTaskBatch(');
    const finish=source.indexOf('async function generateUrlsForCurrentSettings(',begin);
    assert.ok(begin>=0 && finish>begin);
    vm.runInContext(source.slice(begin,finish),context);
    const warningStart=source.indexOf('function smartTaskSubmissionWarning(');
    const warningEnd=source.indexOf('async function runApiGeneration(',warningStart);
    assert.ok(warningStart>=0 && warningEnd>warningStart);
    vm.runInContext(source.slice(warningStart,warningEnd),context);
    context.node=node;
    return {node,notices,context,get saves(){return saves;},get renders(){return renders;},
        get scheduled(){return scheduled;},get queries(){return queries;},
        run:code=>vm.runInContext(code,context)};
}

test('accepted IDs stay in a recovery card and are not queried when saving fails or is queued',async()=>{
    for(const saveResult of [false,undefined]){
        const h=taskState(saveResult);
        h.context.result={taskIds:['accepted-1'],providerId:'mock',model:'mock-image'};
        await assert.rejects(h.run('waitSmartCanvasTaskBatch(node,result)'),/画布尚未保存/);
        assert.equal(h.saves,1);
        assert.equal(h.queries,0);
        assert.equal(h.node.pendingTasks[0].taskId,'accepted-1');
        assert.equal(h.node.pendingTasks[0].queryPaused,true);
        assert.equal(h.node.pendingTasks[0].savePending,true);
        assert.equal(h.node.pendingTasks[0].querying,false);
        assert.ok(h.scheduled>0);
    }
});

test('accepted IDs are queried only after a confirmed save',async()=>{
    const h=taskState(true);
    h.context.result={taskIds:['accepted-1'],providerId:'mock',model:'mock-image'};
    assert.deepEqual(Array.from(await h.run('waitSmartCanvasTaskBatch(node,result)')),['image.png']);
    assert.equal(h.saves,1);
    assert.equal(h.queries,1);
});

test('an unknown earlier submission remains visible after a later successful batch',()=>{
    const h=taskState(true);
    h.context.unknown={count:2,taskIds:['accepted-1'],submissionFailures:[{kind:'unknown'}]};
    h.context.success={count:1,taskIds:['accepted-2'],submissionFailures:[]};
    h.run('recordSmartTaskSubmission(node,unknown)');
    const first=h.node.submissionWarning;
    h.run('recordSmartTaskSubmission(node,success)');
    assert.equal(h.node.submissionWarning,first);
    assert.equal(h.node.submissionUnknown,true);
    assert.match(first,/可能已受理/);
});

test('warning from a failed output branch can be retained on its visible source node',()=>{
    const h=taskState(true);
    h.context.source={id:'source'};
    h.context.branch={id:'branch',submissionWarning:'仅取得 1 个任务编号；1 项被明确拒绝',submissionUnknown:false};
    h.run('rememberSmartTaskSubmissionWarning(source,branch.submissionWarning,branch.submissionUnknown)');
    assert.equal(h.context.source.submissionWarning,h.context.branch.submissionWarning);
    assert.equal(h.context.source.submissionUnknown,false);
});

test('an all-rejected batch with no accepted IDs gives a retryable explanation',()=>{
    const h=taskState(true);
    h.context.rejected={count:2,taskIds:[],submissionFailures:[{kind:'rejected'},{kind:'rejected'}]};
    const warning=h.run('recordSmartTaskSubmission(node,rejected)');
    assert.match(warning,/请检查失败原因后重试/);
    assert.doesNotMatch(warning,/请勿直接重试整批/);
});

test('manual query waits for a successful save when a task ID is not yet persisted',async()=>{
    const task={taskId:'accepted-1',queryPaused:true,savePending:true};
    const node={id:'output',pendingTasks:[task]};
    let saved=false, queried=0, saves=0;
    const context=vm.createContext({
        nodes:[node], smartPendingTasks:node=>node.pendingTasks,
        smartRecoverableImageTask:()=>task,
        saveCanvas:async()=>{saves++;return saved;},
        resumeSmartPendingNode:async()=>{queried++;},
        scheduleSave:()=>{}, toast:()=>{}, tr:key=>key,
    });
    const begin=source.indexOf('async function querySmartImageTaskNow(');
    const end=source.indexOf('function startJimengPoll(',begin);
    assert.ok(begin>=0 && end>begin);
    vm.runInContext(source.slice(begin,end),context);
    await vm.runInContext("querySmartImageTaskNow('output','accepted-1')",context);
    assert.equal(saves,1);
    assert.equal(queried,0);
    assert.equal(task.savePending,true);
    saved=true;
    await vm.runInContext("querySmartImageTaskNow('output','accepted-1')",context);
    assert.equal(saves,2);
    assert.equal(queried,1);
    assert.equal(task.savePending,undefined);
});
