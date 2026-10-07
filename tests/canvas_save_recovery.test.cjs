const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');
const source = readFileSync(require('node:path').join(__dirname, '../static/js/canvas.js'), 'utf8');
function section(begin, end){
    const start = source.indexOf(begin), stop = source.indexOf(end, start);
    assert.ok(start >= 0 && stop > start);
    return source.slice(start, stop);
}
function savingEditor(){
    const requests = [], releases = [];
    const context = vm.createContext({
        canvas:{id:'demo', title:'test', updated_at:1}, nodes:[], connections:[],
        viewport:{x:0,y:0,scale:1}, applyingRemoteCanvas:false, savingCanvasNow:false,
        saveCanvasAgain:false, localCanvasDirty:true, lastCanvasUpdatedAt:1,
        saveTimer:null, CLIENT_ID:'test', currentCanvasTitle:null, currentCanvasTime:null,
        sanitizeConnections(){}, setStatus(){}, clearUnsavedCanvasAcceptedTasks(){},
        clearUnsavedCanvasUnknownWarnings(){}, loadCanvasList(){},
        setTimeout(){return 1;}, clearTimeout(){}, console,
        fetch:async(url, init)=>{
            const body = JSON.parse(init.body);
            requests.push({url, body});
            return new Promise(resolve=>releases.push(ok=>resolve({
                ok, status:ok ? 200 : 503,
                json:async()=>({canvas:{id:'demo',updated_at:requests.length+1,nodes:body.nodes}})
            })));
        }
    });
    vm.runInContext(section('function serializableCanvasNode(', 'async function loadConfig('), context);
    return {context, requests, releases, save:()=>vm.runInContext('saveCanvas()',context)};
}
test('accepted task waits for an earlier autosave and persists its own snapshot', async()=>{
    const e = savingEditor();
    const earlier = e.save();
    e.context.nodes.push({id:'out',type:'output',_pending:[{canvasTaskId:'original-task'}]});
    let settled = false;
    const accepted = e.save().then(result=>{settled=true; return result;});
    await Promise.resolve();
    assert.equal(settled, false);
    assert.equal(e.requests.length, 1);
    e.releases[0](true);
    assert.equal(await earlier, true);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(e.requests.length, 2);
    assert.equal(e.requests[1].body.nodes[0]._pending[0].canvasTaskId, 'original-task');
    e.releases[1](true);
    assert.equal(await accepted, true);
});
test('an accepted-task save failure still reports failure after waiting', async()=>{
    const e = savingEditor();
    e.context.console = {error(){}};
    const earlier=e.save(), accepted=e.save();
    e.releases[0](true);
    await earlier;
    await new Promise(resolve=>setImmediate(resolve));
    e.releases[1](false);
    assert.equal(await accepted, false);
});
test('two simultaneous accepted tasks both survive queued saves', async()=>{
    const e=savingEditor();
    const earlier=e.save();
    e.context.nodes.push({id:'out',_pending:[{canvasTaskId:'first-task'}]});
    const first=e.save();
    e.context.nodes[0]._pending.push({canvasTaskId:'second-task'});
    const second=e.save();
    e.releases[0](true);
    await earlier;
    await new Promise(resolve=>setImmediate(resolve));
    e.releases[1](true);
    await first;
    await new Promise(resolve=>setImmediate(resolve));
    e.releases[2](true);
    assert.equal(await second,true);
    assert.deepEqual(e.requests[2].body.nodes[0]._pending.map(p=>p.canvasTaskId),['first-task','second-task']);
});
test('image recovery button uses the durable original ID and never the legacy submission API', async()=>{
    const pending={id:'pending',canvasTaskId:'original-task',canvasTaskType:'online-image',savePending:true,queryPaused:true};
    const node={id:'output',_pending:[pending]}, calls=[], button={};
    const wrap={dataset:{pendingId:'pending'},querySelector:selector=>selector==='.output-recover-query' ? button : null,addEventListener(){}};
    const context=vm.createContext({
        pendingById:()=>pending, findOutputByPendingId:()=>node,
        saveCanvas:async()=>{calls.push('save');return true;}, scheduleSave(){},
        pollCanvasImageTask:async id=>{calls.push(`query:${id}`);return 'succeeded';},
        fetch:()=>assert.fail('must not submit or query a different task'),
        showErrorModal:()=>assert.fail('original durable ID is available'),tr:x=>x,
        wrap,node
    });
    vm.runInContext(section('function bindOutputWrap(', 'function outputDomKeyForItem('),context);
    vm.runInContext(section('async function queryRecoverPendingOutput(', 'async function pollCanvasImageTask('),context);
    vm.runInContext('bindOutputWrap(wrap,node)',context);
    button.onclick({preventDefault(){},stopPropagation(){}});
    await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(calls,['save','query:original-task']);
    assert.equal(pending.savePending,undefined);
});
