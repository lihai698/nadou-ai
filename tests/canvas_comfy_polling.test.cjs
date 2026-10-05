const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {readFileSync} = require('node:fs');
const path = require('node:path');

function pollingFunction(file, name, nextName){
    const source = readFileSync(path.join(__dirname, '..', 'static', 'js', file), 'utf8');
    const start = source.indexOf(`async function ${name}(`);
    const end = source.indexOf(`async function ${nextName}(`, start);
    assert.ok(start >= 0 && end > start);
    return source.slice(start, end);
}

const functions = {
    classic: pollingFunction('canvas.js', 'waitCanvasComfyTaskResult', 'runQueuedComfyGenerate'),
    smart: pollingFunction('smart-canvas.js', 'waitSmartComfyTaskResult', 'runQueuedSmartComfyGenerate'),
};

function scenario(kind, responses){
    const calls = [], delays = [];
    async function request(url){
        calls.push(url);
        const next = responses.shift();
        if(next instanceof Error) throw next;
        if(!next) throw new Error('unexpected extra query');
        return {
            ok:next.status === 200, status:next.status,
            json:async()=>next.data,
        };
    }
    const context = vm.createContext({
        cascadeFetch:request, fetch:request,
        cascadeTargetIdFromOptions:()=>'', ensureCascadeActive:()=>{},
        isCascadeAbortError:error=>error.name === 'CascadeAbort',
        cascadeBackendRestartMessage:()=> '后端已重启',
        responseErrorMessage:async()=> '查询暂不可用',
        smartResponseErrorMessage:async()=> '查询暂不可用',
        actionFailed:()=> '生成失败',
        tr:key=>key === 'smart.comfyTaskRestart' ? '后端已重启' : '生成失败',
        resultMediaUrls:value=>value.images || [],
        sleep:async ms=>{delays.push(ms);},
    });
    vm.runInContext(functions[kind], context);
    const call = kind === 'classic'
        ? "waitCanvasComfyTaskResult('original')"
        : "waitSmartComfyTaskResult('original')";
    return {calls, delays, run:()=>vm.runInContext(call, context)};
}

for(const kind of ['classic', 'smart']){
    test(`${kind}: temporary 503 or lost connection retries only the accepted task`, async()=>{
        for(const failure of [{status:503}, new TypeError('network disconnected')]){
            const flow = scenario(kind, [failure, {status:200, data:{status:'succeeded', result:{images:['done.png']}}}]);
            assert.deepEqual((await flow.run()).images, ['done.png']);
            assert.equal(flow.calls.length, 2);
            assert.ok(flow.calls.every(url=>url === '/api/canvas-comfy-tasks/original'));
            assert.deepEqual(flow.delays, [1000]);
        }
    });

    test(`${kind}: persistent query outage stops retrying without a new POST`, async()=>{
        const flow = scenario(kind, Array.from({length:4}, ()=>({status:503})));
        await assert.rejects(flow.run(), /查询暂不可用/);
        assert.equal(flow.calls.length, 4);
        assert.deepEqual(flow.delays, [1000, 2000, 4000]);
        assert.ok(flow.calls.every(url=>url === '/api/canvas-comfy-tasks/original'));
    });

    test(`${kind}: restart 404 and confirmed generation failure are terminal`, async()=>{
        const missing = scenario(kind, [{status:404}]);
        await assert.rejects(missing.run(), /重启/);
        assert.equal(missing.calls.length, 1);
        assert.deepEqual(missing.delays, []);
        const failed = scenario(kind, [{status:200, data:{status:'failed', error:'模拟生成报错'}}]);
        await assert.rejects(failed.run(), /模拟生成报错/);
        assert.equal(failed.calls.length, 1);
    });

    test(`${kind}: unknown task status is terminal and never submits again`, async()=>{
        const flow = scenario(kind, [{status:200, data:{status:'unknown', error:'本地任务记录已失效'}}]);
        await assert.rejects(flow.run(), error=>{
            assert.equal(error.restartLost, true);
            assert.equal(error.taskLost, true);
            return true;
        });
        assert.equal(flow.calls.length, 1);
        assert.deepEqual(flow.delays, []);
    });
}
