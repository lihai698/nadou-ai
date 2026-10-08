const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../static/js/smart-canvas.js'), 'utf8');
function part(start, end) {
    const a = source.indexOf(start), b = source.indexOf(end, a);
    assert.ok(a >= 0 && b > a, `Missing source section: ${start}`);
    return source.slice(a, b);
}

test('a saved image task queried after backend restart ends without false output or resubmission', async () => {
    const node = {
        id:'restart-probe', type:'smart-image',
        images:[{url:'/assets/output/previous.png'}],
        pending:1,
        pendingTasks:[{taskId:'canvas_img_before_restart', kind:'image', querying:true}],
    };
    const requests = [], notices = [], saves = [];
    const ctx = vm.createContext({
        nodes:[node], activeSmartTaskPolls:new Map(),
        fetch:async(url, options) => {
            requests.push({url, method:options?.method || 'GET'});
            return {ok:false, status:404,
                text:async() => JSON.stringify({detail:'画布任务不存在，可能服务已重启或任务已过期'})};
        },
        setTimeout:fn => fn(),
        render:()=>{}, scheduleSave:()=>saves.push(true), toast:message=>notices.push(message),
        tr:key=>key, nowMs:()=>1,
        watchSmartDepthCapture:()=>{throw Error('unexpected depth capture');},
    });
    vm.runInContext(
        part('function smartPendingTasks(', 'class JimengPendingSignal') +
        part('function smartRecoverableImageTask(', 'function imageTaskRecoverBodyHtml') +
        part('async function pollSmartCanvasTask(', 'function finalizeSmartPendingTask') +
        part('async function resumeSmartPendingNode(', 'function updateSelectionBox') +
        part('function resumeSmartDepthCaptureTasks(', 'async function runJimengUpscale('),
        ctx,
    );
    vm.runInContext('resumeSmartPendingTasks()', ctx);
    for(let i=0; i<10 && node.pendingTasks?.length; i++) {
        await new Promise(resolve => setImmediate(resolve));
    }
    assert.equal(node.pending, 0);
    assert.equal(node.pendingTasks, undefined);
    assert.match(node.taskFailureNotice, /服务已重启/);
    assert.match(JSON.parse(JSON.stringify(node)).taskFailureNotice, /请勿直接重复提交/);
    assert.deepEqual(node.images, [{url:'/assets/output/previous.png'}]);
    assert.deepEqual(requests, [{url:'/api/canvas-image-tasks/canvas_img_before_restart', method:'GET'}]);
    assert.ok(notices.some(message => message.includes('重启')));
    assert.ok(saves.length > 0);
    assert.equal(vm.runInContext('smartRecoverableImageTask(nodes[0])', ctx), null);
});
