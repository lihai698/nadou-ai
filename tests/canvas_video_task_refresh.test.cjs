const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {readFileSync} = require('node:fs');
const path = require('node:path');

const source = readFileSync(path.join(__dirname, '../static/js/canvas.js'), 'utf8');
const begin = source.indexOf('async function refreshCanvasVideoTaskOnce(');
const end = source.indexOf('async function pollCanvasVideoTask(', begin);
assert.ok(begin >= 0 && end > begin, 'canvas video query helpers should be present');
const videoQueryCode = source.slice(begin, end);

function harness(replies){
    const calls = [];
    const delays = [];
    const context = vm.createContext({
        cascadeTargetIdFromOptions:options => options?.cascadeTargetId || '',
        cascadeFetch:async (url, init={}) => {
            calls.push({url, init});
            const reply = replies.shift();
            assert.ok(reply, `unexpected video request ${url}`);
            return {
                ok:reply.status === 200,
                status:reply.status,
                json:async()=>reply.body,
                clone(){ return this; },
                text:async()=>JSON.stringify(reply.body),
            };
        },
        ensureCascadeActive:()=>{},
        isCascadeAbortError:error => error?.name === 'CascadeAbort',
        responseErrorMessage:async(_response, fallback)=>fallback,
        sleep:async ms=>delays.push(ms),
    });
    vm.runInContext(videoQueryCode, context);
    return {
        calls,
        delays,
        wait:()=>vm.runInContext("waitCanvasVideoTaskResult('canvas_video_refresh_12345678')", context),
    };
}

test('classic canvas refreshes an unknown video task once and accepts the remote result', async()=>{
    const h = harness([
        {status:200, body:{status:'unknown', error:'服务刚刚重启', remote:{query_supported:true, task_id:'rh-refresh-1'}}},
        {status:200, body:{status:'succeeded', result:{videos:['/output/refreshed.mp4']}}},
    ]);
    const result = await h.wait();
    assert.deepEqual(result, {videos:['/output/refreshed.mp4']});
    assert.deepEqual(h.calls.map(call=>({url:call.url, method:call.init.method || 'GET'})), [
        {url:'/api/canvas-video-tasks/canvas_video_refresh_12345678', method:'GET'},
        {url:'/api/canvas-video-tasks/canvas_video_refresh_12345678/refresh', method:'POST'},
    ]);
});

test('classic canvas keeps an unknown remote video task queryable after an inconclusive refresh', async()=>{
    const h = harness([
        {status:200, body:{status:'unknown', error:'服务刚刚重启', remote:{query_supported:true, task_id:'rh-refresh-1'}}},
        {status:200, body:{status:'unknown', error:'远端暂时无结果', remote:{query_supported:true, task_id:'rh-refresh-1'}}},
    ]);
    await assert.rejects(h.wait(), error=>{
        assert.equal(error.videoTaskUnknown, true);
        assert.equal(error.taskLost, false);
        assert.equal(error.queryPaused, true);
        assert.match(error.message, /远端暂时无结果/);
        return true;
    });
    assert.equal(h.calls.length, 2);
});

test('classic canvas treats an unavailable remote refresh as a lost task', async()=>{
    const h = harness([
        {status:200, body:{status:'unknown', error:'服务刚刚重启', remote:{query_supported:true, task_id:'rh-refresh-1'}}},
        {status:409, body:{detail:'当前视频供应商暂不支持远端刷新'}},
    ]);
    await assert.rejects(h.wait(), error=>{
        assert.equal(error.taskLost, true);
        assert.equal(error.videoTaskRefreshUnavailable, true);
        return true;
    });
    assert.equal(h.calls.length, 2);
});

test('classic canvas does not refresh an unknown task without a queryable remote ID', async()=>{
    const h = harness([
        {status:200, body:{status:'unknown', error:'本地任务记录已失效', remote:{query_supported:false, task_id:''}}},
    ]);
    await assert.rejects(h.wait(), error=>{
        assert.equal(error.taskLost, true);
        assert.equal(error.remoteRefreshable, false);
        return true;
    });
    assert.equal(h.calls.length, 1);
});
