const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {readFileSync} = require('node:fs');
const path = require('node:path');

const source = readFileSync(path.join(__dirname, '../static/js/smart-canvas.js'), 'utf8');
const begin = source.indexOf('function restoreSmartVideoSubmissionWarning(');
const end = source.indexOf('async function runModelscopeGeneration(', begin);
assert.ok(begin >= 0 && end > begin);
const videoCode = source.slice(begin, end);

function harness(reply, saveAllowed=true){
    const node = {id:'video-node', type:'smart-image', images:[]};
    const settings = {videoProvider:'test-only-video', videoModel:'mock-video'};
    const runState = {submissionUnknown:false};
    const calls = [];
    let disk = null;
    const persist = () => {disk = JSON.parse(JSON.stringify(node));};
    const context = vm.createContext({
        node, settings, runState, transientSmartCloudLinks:[],
        render:()=>{}, scheduleSave:persist,
        saveCanvas:async()=>{calls.push('PUT'); if(saveAllowed) persist(); return saveAllowed;},
        fetch:async(url)=>{
            calls.push(`POST ${url}`);
            assert.equal(node.submissionUnknown,true);
            assert.equal(disk.submissionUnknown,true, 'warning must reach disk before POST');
            if(reply instanceof Error) throw reply;
            return {ok:reply.status===200, status:reply.status, json:async()=>reply.body};
        },
        applyUploadedUrlsToSmartRefs:refs=>refs,
        imageRefsOnly:()=>[], videoRefsOnly:()=>[], audioRefsOnly:()=>[],
        videoProviderPlatform:()=>'', toast:()=>{}, tr:key=>key,
        smartResponseErrorMessage:async response=>`HTTP ${response.status}`,
        resultMediaUrls:result=>result.videos || [],
        JimengPendingSignal:class JimengPendingSignal extends Error {},
    });
    vm.runInContext(videoCode, context);
    return {node, runState, calls, get disk(){return disk;},
        run:()=>vm.runInContext('runApiVideoGeneration("自制视频提示",[],settings,node,runState)',context)};
}

test('video POST waits for a durable unknown-state warning', async()=>{
    const h = harness({status:503, body:{detail:'synthetic failure'}});
    await assert.rejects(h.run(), /HTTP 503/);
    assert.deepEqual(h.calls, ['PUT','POST /api/canvas-video']);
    assert.equal(h.node.submissionUnknown,true);
    assert.equal(h.disk.submissionUnknown,true);
    assert.equal(h.runState.submissionUnknown,true);
    assert.match(h.disk.submissionWarning,/重复计费/);
});

test('failed preflight save prevents video submission', async()=>{
    const h = harness({status:200, body:{videos:['local.mp4']}}, false);
    await assert.rejects(h.run(), /画布尚未保存.*未提交/);
    assert.deepEqual(h.calls, ['PUT']);
    assert.equal(h.node.submissionUnknown,undefined);
});

test('network loss and empty success keep the warning for manual review', async()=>{
    for(const reply of [new TypeError('connection lost'), {status:408,body:{detail:'timeout'}}, {status:200,body:{videos:[]}}]){
        const h = harness(reply);
        if(reply instanceof Error) await assert.rejects(h.run(), /connection lost/);
        else if(reply.status===408) await assert.rejects(h.run(), /HTTP 408/);
        else assert.deepEqual(Array.from(await h.run()), []);
        assert.equal(h.disk.submissionUnknown,true);
        assert.equal(h.runState.submissionUnknown,true);
    }
});

test('definite rejection and completed video restore the previous warning state', async()=>{
    for(const reply of [
        {status:400,body:{detail:'invalid model'}},
        {status:200,body:{videos:['/assets/output/mock.mp4']}},
    ]){
        const h = harness(reply);
        if(reply.status===400) await assert.rejects(h.run(), /HTTP 400/);
        else assert.deepEqual(Array.from(await h.run()), ['/assets/output/mock.mp4']);
        assert.deepEqual(h.calls, ['PUT','POST /api/canvas-video']);
        assert.equal(h.node.submissionUnknown,undefined);
        assert.equal(h.disk.submissionUnknown,undefined);
        assert.equal(h.runState.submissionUnknown,false);
    }
});

test('a video timeout stops a parallel cascade before it claims later rounds', async()=>{
    const h = harness({status:503, body:{detail:'synthetic timeout'}});
    const start = source.indexOf('async function runSmartCascadeRoundsWithLimit(');
    const stop = source.indexOf('async function runSmartCascade(', start);
    assert.ok(start >= 0 && stop > start);
    const context = vm.createContext({smartUnknownResubmissionNotice:()=> '状态未知，一键运行已停止'});
    vm.runInContext(source.slice(start, stop), context);
    const started = [];
    let releaseSecond;
    const secondCanFinish = new Promise(resolve=>{releaseSecond=resolve;});
    context.rounds = [1,2,3,4];
    context.runState = h.runState;
    context.runner = async round=>{
        started.push(round);
        if(round===1){
            try {await h.run();} finally {releaseSecond();}
        } else {
            await secondCanFinish;
        }
    };
    await assert.rejects(vm.runInContext('runSmartCascadeRoundsWithLimit(rounds,2,runner,runState)',context),/一键运行已停止/);
    assert.deepEqual(started,[1,2]);
    assert.equal(h.calls.filter(call=>call==='POST /api/canvas-video').length,1);
});

test('a reloaded video warning requires confirmation before another manual run', async()=>{
    const h = harness({status:503, body:{detail:'synthetic timeout'}});
    await assert.rejects(h.run(), /HTTP 503/);
    const refreshed = JSON.parse(JSON.stringify(h.disk));
    let confirmations = 0;
    const context = vm.createContext({
        nodes:[refreshed], canvas:{connections:[]},
        window:{confirm:()=>{confirmations++;return false;}}
    });
    const start = source.indexOf('function smartUnknownSubmissionForNode(');
    const stop = source.indexOf('function smartTaskSubmissionWarning(', start);
    assert.ok(start >= 0 && stop > start);
    vm.runInContext(source.slice(start, stop), context);
    context.refreshed = refreshed;
    assert.equal(vm.runInContext('confirmSmartUnknownResubmission(refreshed)',context),false);
    assert.equal(confirmations,1);
    assert.equal(h.calls.filter(call=>call==='POST /api/canvas-video').length,1);
});

test('a second ambiguous video request retains an earlier warning', async()=>{
    const h = harness({status:503, body:{detail:'synthetic timeout'}});
    h.node.submissionWarning = '之前的任务状态未知';
    h.node.submissionUnknown = true;
    await assert.rejects(h.run(), /HTTP 503/);
    assert.match(h.disk.submissionWarning,/之前的任务状态未知/);
    assert.match(h.disk.submissionWarning,/视频请求可能已被受理/);
    assert.equal(h.disk.submissionUnknown,true);
});
