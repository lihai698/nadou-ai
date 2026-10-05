const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {readFileSync} = require('node:fs');
const path = require('node:path');

const source = readFileSync(path.join(__dirname, '../static/js/smart-canvas.js'), 'utf8');
function section(begin, end){
    const start = source.indexOf(begin);
    const stop = source.indexOf(end, start);
    assert.ok(start >= 0 && stop > start, `${begin} should be present`);
    return source.slice(start, stop);
}

function harness(replies){
    const node = {id:'video-node', type:'smart-image', images:[], videoTaskId:'canvas_video_test_smart_123456'};
    const settings = {videoProvider:'test-only-video', videoModel:'mock-video'};
    const runState = {submissionUnknown:false};
    const calls = [];
    let disk = null;
    const context = vm.createContext({
        node, settings, runState, nodes:[node], transientSmartCloudLinks:[],
        render:()=>{}, scheduleSave:()=>{disk = JSON.parse(JSON.stringify(node));},
        saveCanvas:async()=>{calls.push('PUT'); disk = JSON.parse(JSON.stringify(node)); return true;},
        fetch:async(url, init={})=>{
            calls.push(`${init.method || 'GET'} ${url}`);
            if(url === '/api/canvas-video-tasks'){
                assert.equal(JSON.parse(init.body).client_task_id, node.videoTaskId);
                return {ok:true, status:200, json:async()=>({task_id:node.videoTaskId, status:'queued'})};
            }
            const reply = replies.shift();
            assert.ok(reply, `unexpected video query ${url}`);
            return {ok:reply.status === 200, status:reply.status, clone(){return this;}, json:async()=>reply.body, text:async()=>JSON.stringify(reply.body)};
        },
        responseErrorMessage:async(_response, fallback)=>fallback,
        applyUploadedUrlsToSmartRefs:refs=>refs,
        imageRefsOnly:()=>[], videoRefsOnly:()=>[], audioRefsOnly:()=>[],
        videoProviderPlatform:()=>'', toast:()=>{}, tr:key=>key,
        resultMediaUrls:result=>result.videos || [],
        JimengPendingSignal:class JimengPendingSignal extends Error {},
        smartPendingTasks:n=>n.pendingTasks || [],
        uid:()=> 'ignored',
        setTimeout:(fn)=>{fn(); return 1;},
        nowMs:()=>1,
    });
    vm.runInContext(
        section('function restoreSmartVideoSubmissionWarning(', 'async function runModelscopeGeneration(')
        + section('function prepareSmartVideoTask(', 'function finalizeSmartPendingTask'), context);
    return {node, runState, calls, get disk(){return disk;},
        run:()=>vm.runInContext('runApiVideoGeneration("隔离视频",[],settings,node,runState)', context),
        poll:()=>vm.runInContext('pollSmartVideoCanvasTask(node.videoTaskId)', context)};
}

test('smart canvas uses one durable local video task and queries its result', async()=>{
    const h = harness([{status:200, body:{status:'succeeded', result:{videos:['/assets/output/smart.mp4']}}}]);
    const urls = await h.run();
    assert.deepEqual(Array.from(urls), ['/assets/output/smart.mp4']);
    assert.deepEqual(h.calls, ['PUT', 'POST /api/canvas-video-tasks', 'GET /api/canvas-video-tasks/canvas_video_test_smart_123456']);
    assert.equal(h.node.videoTaskId, undefined);
    assert.equal(h.disk.videoTaskId, undefined);
});

test('smart canvas refreshes an unknown durable video task before giving up', async()=>{
    const h = harness([
        {status:200, body:{status:'unknown', error:'服务刚刚重启', remote:{query_supported:true, task_id:'rh-refresh-1'}}},
        {status:200, body:{status:'succeeded', result:{videos:['/assets/output/refreshed.mp4']}}},
    ]);
    const urls = await h.run();
    assert.deepEqual(Array.from(urls), ['/assets/output/refreshed.mp4']);
    assert.deepEqual(h.calls, [
        'PUT',
        'POST /api/canvas-video-tasks',
        'GET /api/canvas-video-tasks/canvas_video_test_smart_123456',
        'POST /api/canvas-video-tasks/canvas_video_test_smart_123456/refresh',
    ]);
    assert.equal(h.node.videoTaskId, undefined);
});

test('smart canvas keeps a refreshable video task when the remote state is still unknown', async()=>{
    const h = harness([
        {status:200, body:{status:'unknown', error:'服务刚刚重启', remote:{query_supported:true, task_id:'rh-refresh-1'}}},
        {status:200, body:{status:'unknown', error:'远端暂时无结果', remote:{query_supported:true, task_id:'rh-refresh-1'}}},
    ]);
    await assert.rejects(h.run(), /远端暂时无结果/);
    assert.deepEqual(h.calls, [
        'PUT',
        'POST /api/canvas-video-tasks',
        'GET /api/canvas-video-tasks/canvas_video_test_smart_123456',
        'POST /api/canvas-video-tasks/canvas_video_test_smart_123456/refresh',
    ]);
    assert.equal(h.node.videoTaskId, 'canvas_video_test_smart_123456');
    assert.equal(h.node.videoTaskStatus, 'running');
});

test('smart canvas keeps the same local task after a lost query', async()=>{
    const h = harness([{status:503, body:{detail:'query unavailable'}}]);
    await assert.rejects(h.run());
    assert.equal(h.calls.filter(call=>call === 'POST /api/canvas-video-tasks').length, 1);
    assert.equal(h.node.videoTaskId, 'canvas_video_test_smart_123456');
    assert.equal(h.node.submissionUnknown, true);
    assert.equal(h.disk.videoTaskId, 'canvas_video_test_smart_123456');
});

test('smart canvas pauses a durable video task after a persistent query outage', async()=>{
    const h = harness([
        {status:503, body:{detail:'query unavailable'}},
        {status:503, body:{detail:'query unavailable'}},
        {status:503, body:{detail:'query unavailable'}},
        {status:503, body:{detail:'query unavailable'}},
    ]);
    await assert.rejects(h.poll(), error=>{
        assert.equal(error.queryPaused, true);
        assert.equal(error.taskLost, false);
        return true;
    });
    assert.equal(h.calls.filter(call=>call.startsWith('GET /api/canvas-video-tasks/')).length, 4);
});

test('smart canvas retries a temporary video query outage without resubmitting', async()=>{
    const h = harness([
        {status:503, body:{detail:'query unavailable'}},
        {status:200, body:{status:'succeeded', result:{videos:['/assets/output/smart-retry.mp4']}}},
    ]);
    const urls = await h.run();
    assert.deepEqual(Array.from(urls), ['/assets/output/smart-retry.mp4']);
    assert.equal(h.calls.filter(call => call === 'POST /api/canvas-video-tasks').length, 1);
    assert.equal(h.calls.filter(call => call === 'GET /api/canvas-video-tasks/canvas_video_test_smart_123456').length, 2);
});
