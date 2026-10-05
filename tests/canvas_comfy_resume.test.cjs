const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {readFileSync} = require('node:fs');
const path = require('node:path');

const classicSource = readFileSync(path.join(__dirname, '../static/js/canvas.js'), 'utf8');
const smartSource = readFileSync(path.join(__dirname, '../static/js/smart-canvas.js'), 'utf8');
function section(source, start, end){
    const a = source.indexOf(start), b = source.indexOf(end, a);
    assert.ok(a >= 0 && b > a, `${start} section exists`);
    return source.slice(a, b);
}
const clone = value => JSON.parse(JSON.stringify(value));

function classicEditor(saved, replies, saveOk=true){
    const calls = [];
    const nodes = saved ? clone(saved.nodes) : [
        {id:'generator', type:'comfy', generatedOutputs:[]},
        {id:'output', type:'output', images:[], _pending:[{id:'pending', startedAt:1, run:{node:{id:'generator'}, refs:[]}}]},
    ];
    let disk = saved ? clone(saved) : null;
    const context = vm.createContext({
        nodes, activeCanvasComfyTaskPolls:new Set(),
        cascadeFetch:async url=>{
            calls.push(url);
            if(url === '/api/canvas-comfy-tasks') return {ok:true, status:200, json:async()=>({task_id:'accepted'})};
            const reply = replies.shift();
            assert.ok(reply, 'GET has a queued response');
            if(reply instanceof Error) throw reply;
            return {ok:reply.status === 200, status:reply.status, json:async()=>reply.data || {}, text:async()=>reply.message || ''};
        },
        pendingById:(out, id)=>(out?._pending || []).find(item=>item.id === id),
        findPendingTask:id=>{
            const out = nodes[1], pending = (out?._pending || []).find(item=>item.canvasTaskId === id);
            return pending ? {out, pending} : null;
        },
        refreshRunNodes:()=>{}, rememberUnsavedCanvasAcceptedTasks:()=>true,
        saveCanvas:async()=>{if(!saveOk) return false; disk = {nodes:clone(nodes)}; return true;},
        scheduleSave:()=>{if(saveOk) disk = {nodes:clone(nodes)};},
        pauseCanvasAcceptedTasksUntilSaved:(_source, tasks)=>{
            tasks.forEach(task=>{task.queryPaused=true;task.savePending=true;});
            return new Error('画布尚未保存，请先重试保存，再查询原任务');
        },
        cascadeTargetIdFromOptions:()=>'', ensureCascadeActive:()=>{},
        isCascadeAbortError:error=>error.name === 'CascadeAbort',
        responseErrorMessage:async()=> '暂时无法查询',
        actionFailed:()=> '生成失败', cascadeBackendRestartMessage:()=> '后端已重启或任务过期',
        sleep:async()=>{}, resultMediaUrls:result=>Array.isArray(result) ? result : result.images || [],
        noReturnedImage:()=> '没有输出', requestMetaFromResult:()=>({}),
        nowMs:()=>2, appendOutputImages:(out, images)=>out.images.push(...images),
        mergeGeneratedOutputs:(node, images)=>node.generatedOutputs.push(...images),
        addGenerationLog:()=>{}, tr:x=>x,
    });
    vm.runInContext(section(classicSource, 'async function createCanvasComfyTask(', 'function extractUpstreamTaskId('), context);
    return {
        context, nodes, calls, saved:()=>disk,
        submit:()=>vm.runInContext("runQueuedComfyGenerate({workflow_json:'test.json'}, {out:nodes[1], pendingId:'pending'})", context),
        resume:()=>vm.runInContext("pollCanvasComfyTask('accepted')", context),
    };
}

test('classic: accepted ComfyUI ID survives reload and resumes only GET', async()=>{
    const initial = classicEditor(null, [{status:503},{status:503},{status:503},{status:503}]);
    await assert.rejects(initial.submit(), /暂时无法查询/);
    assert.equal(initial.saved().nodes[1]._pending[0].canvasTaskId, 'accepted');
    assert.equal(initial.saved().nodes[1]._pending[0].canvasTaskType, 'comfy');
    const reloaded = classicEditor(initial.saved(), [{status:200, data:{status:'succeeded', result:{images:['done.png']}}}]);
    await reloaded.resume();
    assert.deepEqual(reloaded.calls, ['/api/canvas-comfy-tasks/accepted']);
    assert.deepEqual(reloaded.nodes[1].images, ['done.png']);
    assert.equal(reloaded.nodes[1]._pending.length, 0);
});

test('classic: 404 after reload keeps a visible lost-record explanation', async()=>{
    const reloaded = classicEditor({nodes:[{id:'generator',type:'comfy'},{id:'output',type:'output',images:[],_pending:[{id:'pending',canvasTaskId:'accepted',canvasTaskType:'comfy',run:{node:{id:'generator'}}}]}]}, [{status:404}]);
    await reloaded.resume();
    assert.deepEqual(reloaded.calls, ['/api/canvas-comfy-tasks/accepted']);
    assert.equal(reloaded.nodes[1]._pending[0].taskLost, true);
    assert.match(reloaded.nodes[1]._pending[0].error, /远端是否仍在生成未知/);
});

test('classic: unknown status keeps the accepted record without another query', async()=>{
    const reloaded = classicEditor({nodes:[{id:'generator',type:'comfy'},{id:'output',type:'output',images:[],_pending:[{id:'pending',canvasTaskId:'accepted',canvasTaskType:'comfy',run:{node:{id:'generator'}}}]}]}, [{status:200, data:{status:'unknown', error:'本地任务记录已失效'}}]);
    await reloaded.resume();
    assert.deepEqual(reloaded.calls, ['/api/canvas-comfy-tasks/accepted']);
    assert.equal(reloaded.nodes[1]._pending[0].taskLost, true);
    assert.equal(reloaded.nodes[1]._pending[0].failed, true);
    assert.match(reloaded.nodes[1]._pending[0].error, /远端是否仍在生成未知/);
});

test('classic: failed canvas save retains the ID and performs no GET', async()=>{
    const editor = classicEditor(null, [], false);
    await assert.rejects(editor.submit(), /画布尚未保存/);
    assert.deepEqual(editor.calls, ['/api/canvas-comfy-tasks']);
    assert.equal(editor.nodes[1]._pending[0].canvasTaskId, 'accepted');
    assert.equal(editor.nodes[1]._pending[0].savePending, true);
});

test('classic: stopping page wait keeps the accepted ID without claiming remote cancellation', async()=>{
    const stopped = new Error('页面停止等待'); stopped.name = 'CascadeAbort';
    const editor = classicEditor(null, [stopped]);
    await assert.rejects(editor.submit(), /页面停止等待/);
    assert.deepEqual(editor.calls, ['/api/canvas-comfy-tasks', '/api/canvas-comfy-tasks/accepted']);
    assert.equal(editor.nodes[1]._pending[0].queryPaused, true);
    assert.match(editor.nodes[1]._pending[0].error, /远端任务状态未知/);
});

function smartEditor(saved, replies, saveOk=true){
    const calls = [];
    const nodes = saved ? clone(saved.nodes) : [{id:'output',type:'smart-image',images:[]}];
    let disk = saved ? clone(saved) : null;
    const context = vm.createContext({
        nodes, activeSmartComfyTaskPolls:new Set(),
        fetch:async url=>{
            calls.push(url);
            if(url === '/api/canvas-comfy-tasks') return {ok:true, status:200, json:async()=>({task_id:'accepted'})};
            const reply = replies.shift();
            assert.ok(reply, 'GET has a queued response');
            return {ok:reply.status === 200, status:reply.status, json:async()=>reply.data || {}, text:async()=>reply.message || ''};
        },
        smartPendingTasks:node=>(node?.pendingTasks || []).filter(item=>item?.taskId),
        saveSmartAcceptedTasksBeforeQuery:async(node)=>{
            if(!saveOk){node.pendingTasks[0].savePending = true; return false;}
            disk = {nodes:clone(nodes)};
            return true;
        },
        render:()=>{}, scheduleSave:()=>{if(saveOk) disk = {nodes:clone(nodes)};},
        smartResponseErrorMessage:async()=> '暂时无法查询',
        tr:x=>x === 'smart.comfyTaskRestart' ? '后端已重启或任务过期' : x,
        resultMediaUrls:result=>Array.isArray(result) ? result : result.images || [],
        mediaKindForUrls:()=> 'image',
        smartMinimaxSelectedSegment:()=>null,
        sleep:async()=>{}, nowMs:()=>2, toast:()=>{},
        finalizeSmartPendingTask:(node, id, images)=>{
            node.pendingTasks = (node.pendingTasks || []).filter(item=>item.taskId !== id);
            node.pending = node.pendingTasks.length;
            node.images.push(...images);
        },
        pollSmartCanvasTask:()=>{throw Error('image GET must not run');},
    });
    vm.runInContext(section(smartSource, 'async function createSmartComfyTask(', 'function comfyParamsFromWorkflowValues(')
        +section(smartSource, 'async function resumeSmartPendingNode(', 'function updateSelectionBox('), context);
    return {
        context, nodes, calls, saved:()=>disk,
        submit:()=>vm.runInContext("runQueuedSmartComfyGenerate({workflow_json:'test.json'}, nodes[0])", context),
        resume:()=>vm.runInContext('resumeSmartPendingTasks()', context),
    };
}

test('smart: accepted ComfyUI ID survives reload and resumes only GET', async()=>{
    const initial = smartEditor(null, [{status:503},{status:503},{status:503},{status:503}]);
    await assert.rejects(initial.submit(), /暂时无法查询/);
    assert.equal(initial.saved().nodes[0].pendingTasks[0].taskId, 'accepted');
    assert.equal(initial.saved().nodes[0].pendingTasks[0].kind, 'comfy');
    const reloaded = smartEditor(initial.saved(), [{status:200, data:{status:'succeeded', result:{images:['done.png']}}}]);
    reloaded.resume();
    for(let i=0;i<20 && reloaded.nodes[0].pending;i++) await Promise.resolve();
    assert.deepEqual(reloaded.calls, ['/api/canvas-comfy-tasks/accepted']);
    assert.deepEqual(reloaded.nodes[0].images, ['done.png']);
    assert.equal(reloaded.nodes[0].pending, 0);
});

test('smart: 404 marks the local record lost without a new POST', async()=>{
    const reloaded = smartEditor({nodes:[{id:'output',type:'smart-image',images:[],pending:1,pendingTasks:[{taskId:'accepted',kind:'comfy'}]}]}, [{status:404}]);
    reloaded.resume();
    for(let i=0;i<20 && reloaded.nodes[0].pending;i++) await Promise.resolve();
    assert.deepEqual(reloaded.calls, ['/api/canvas-comfy-tasks/accepted']);
    assert.equal(reloaded.nodes[0].pending, 0);
    assert.match(reloaded.nodes[0].taskFailureNotice, /远端是否仍在生成未知/);
});

test('smart: unknown status keeps the accepted ComfyUI record without another query', async()=>{
    const reloaded = smartEditor({nodes:[{id:'output',type:'smart-image',images:[],pending:1,pendingTasks:[{taskId:'accepted',kind:'comfy'}]}]}, [{status:200, data:{status:'unknown', error:'本地任务记录已失效'}}]);
    reloaded.resume();
    for(let i=0;i<20 && !reloaded.nodes[0].pendingTasks?.[0]?.taskLost;i++) await Promise.resolve();
    assert.deepEqual(reloaded.calls, ['/api/canvas-comfy-tasks/accepted']);
    assert.equal(reloaded.nodes[0].pending, 1);
    assert.equal(reloaded.nodes[0].pendingTasks[0].taskLost, true);
    assert.equal(reloaded.nodes[0].pendingTasks[0].failed, true);
    assert.match(reloaded.nodes[0].pendingTasks[0].error, /远端是否仍在生成未知/);
});

test('smart: failed canvas save pauses the accepted ComfyUI ID before any GET', async()=>{
    const editor = smartEditor(null, [], false);
    await assert.rejects(editor.submit(), /画布尚未保存/);
    assert.deepEqual(editor.calls, ['/api/canvas-comfy-tasks']);
    assert.equal(editor.nodes[0].pendingTasks[0].taskId, 'accepted');
    assert.equal(editor.nodes[0].pendingTasks[0].savePending, true);
});
