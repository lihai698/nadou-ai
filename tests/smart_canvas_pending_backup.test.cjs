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

function harness(saveResult=false){
    const values = new Map();
    const node = {id:'node-1', pendingTasks:[]};
    const context = vm.createContext({
        canvasId:'canvas-1',
        SMART_UNSAVED_ACCEPTED_TASKS_PREFIX:'smart_canvas_unsaved_accepted_tasks:',
        nodes:[node],
        localStorage:{
            getItem:key => values.has(key) ? values.get(key) : null,
            setItem:(key, value) => values.set(key, String(value)),
            removeItem:key => values.delete(key),
        },
        nowMs:() => 123,
        render:() => {},
        scheduleSave:() => {},
        toast:() => {},
        saveCanvas:async() => saveResult,
    });
    vm.runInContext(section('function smartPendingTasks(', 'class JimengPendingSignal'), context);
    vm.runInContext(section('async function saveSmartAcceptedTasksBeforeQuery(', 'async function runApiGeneration('), context);
    return {context, node, values};
}

test('smart canvas backs up accepted task IDs when canvas save fails and clears them after retry', async()=>{
    const h = harness(false);
    h.node.pendingTasks = [{taskId:'task-1', kind:'image', providerId:'mock', model:'mock-model'}];
    const paused = await h.context.saveSmartAcceptedTasksBeforeQuery(h.node, ['task-1']);
    assert.equal(paused, false);
    assert.equal(h.node.pendingTasks[0].savePending, true);
    assert.deepEqual(JSON.parse(h.values.get('smart_canvas_unsaved_accepted_tasks:canvas-1')), [{
        taskId:'task-1', nodeId:'node-1', kind:'image', providerId:'mock', model:'mock-model', segmentId:'', startedAt:123,
    }]);

    h.context.saveCanvas = async() => true;
    const saved = await h.context.saveSmartAcceptedTasksBeforeQuery(h.node, ['task-1']);
    assert.equal(saved, true);
    assert.equal(h.values.has('smart_canvas_unsaved_accepted_tasks:canvas-1'), false);
});

test('smart canvas restores an accepted task ID into the existing node after reload', ()=>{
    const h = harness(true);
    h.values.set('smart_canvas_unsaved_accepted_tasks:canvas-1', JSON.stringify([{
        taskId:'task-2', nodeId:'node-1', kind:'comfy', providerId:'mock', model:'workflow', segmentId:'seg-1', startedAt:456,
    }]));
    const restored = h.context.restoreSmartUnsavedAcceptedTasks();
    assert.equal(restored, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(h.node.pendingTasks)), [{
        taskId:'task-2', kind:'comfy', providerId:'mock', model:'workflow', segmentId:'seg-1', startedAt:456,
        querying:false, queryPaused:true, savePending:true, queryRecoverable:true,
        error:'画布尚未保存，请先重试保存，再查询原任务',
    }]);
    assert.equal(h.node.pending, 1);
    assert.equal(h.node.running, false);
});

test('smart canvas drops a backup when the server already contains the task', ()=>{
    const h = harness(true);
    h.node.pendingTasks = [{taskId:'task-3', kind:'image'}];
    h.values.set('smart_canvas_unsaved_accepted_tasks:canvas-1', JSON.stringify([
        {taskId:'task-3', nodeId:'node-1', kind:'image', startedAt:789},
    ]));
    assert.equal(h.context.restoreSmartUnsavedAcceptedTasks(), 0);
    assert.equal(h.values.has('smart_canvas_unsaved_accepted_tasks:canvas-1'), false);
    assert.equal(h.node.pendingTasks[0].savePending, undefined);
});
