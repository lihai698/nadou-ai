const {test}=require('node:test');
const assert=require('node:assert/strict');
const state=require('../static/js/canvas-cascade-state.js');
const runner=require('../static/js/canvas-cascade-runner.js');

function host(){
    const h={nodes:[{id:'a',type:'generator'},{id:'b',type:'generator'}],cascadeRunningIds:new Set(),cascadeStopIds:new Set(),cascadeSerialIds:new Set(),cascadeContexts:new Map(),loopContext:null,
        nowMs:()=>1,langIsEn:()=>false,tr:x=>x,refreshNodes:()=>{},computeCascadeOrder:()=>['a','b'],resolveCascadeLoop:()=>null,
        setTimeout:fn=>{h.cleanup=fn;return 1;},clearTimeout:()=>{h.cleanup=null;},confirmOrphanUnknownCanvasSubmission:()=>true,alert:message=>{throw new Error(message);}};
    for(const [name,fn] of Object.entries(state))h[name]=(...args)=>fn(h,...args);
    return h;
}

test('stop aborts pending request and releases request controller',async()=>{
    const h=host();state.beginCascade(h,'b',['a','b'],{serial:true});
    h.fetch=(_url,options)=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Object.assign(new Error('abort'),{name:'AbortError'}))));
    const pending=state.cascadeFetch(h,'/fixture',{}, {cascadeTargetId:'b'});
    assert.equal(h.cascadeContexts.get('b').controllers.size,1);
    state.requestCascadeStop(h,'b');
    await assert.rejects(pending,e=>e.isCascadeAbort===true);
    assert.equal(h.cascadeContexts.get('b').controllers.size,0);
    state.finalizeCascade(h,'b','stopped');
    assert.equal(h.cascadeRunningIds.size,0);assert.equal(h.cascadeContexts.size,0);
});

test('reset clears registered cleanup timer and loop context',()=>{
    const h=host();state.beginCascade(h,'b',['a','b']);state.finalizeCascade(h,'b','done');
    h.loopContext={index:2};assert.equal(typeof h.cleanup,'function');
    state.resetCascadeRuntimeState(h);assert.equal(h.cleanup,null);assert.equal(h.loopContext,null);assert.equal(h.cascadeContexts.size,0);
});

test('serial loop executes each upstream node before the tail on every round',async()=>{
    const h=host(),calls=[];h.resolveCascadeLoop=()=>({node:{id:'loop',loopStart:1},count:2,mode:'serial'});
    h.runGenerator=async id=>calls.push([id,h.loopContext.index]);
    await runner.runNodeCascade(h,'b');
    assert.deepEqual(calls,[['a',1],['b',1],['a',2],['b',2]]);
    assert.equal(h.loopContext,null);assert.equal(h.cascadeRunningIds.size,0);
});

test('stop after an accepted node prevents the next node from starting',async()=>{
    const h=host(),calls=[];h.runGenerator=async id=>{calls.push(id);state.requestCascadeStop(h,'b');};
    await runner.runNodeCascade(h,'b');assert.deepEqual(calls,['a']);assert.equal(h.cascadeContexts.size,0);
});

test('loop context is restored even when a node fails',async()=>{
    const h=host(),node=h.nodes[0],previous={index:9};h.loopContext=previous;
    h.runGenerator=async()=>{throw new Error('fixture failure');};
    await assert.rejects(runner.runCascadeNodeWithLoopContext(h,node,{index:1}),/fixture failure/);
    assert.equal(h.loopContext,previous);assert.equal(node._activeLoopCtx,undefined);
});

test('parallel workers respect configured limit and retain rejected worker result',async()=>{
    let active=0,peak=0;
    const results=await runner.runLimitedCascadeRounds({},[1,2,3,4],2,async n=>{
        active++;peak=Math.max(peak,active);await new Promise(resolve=>setImmediate(resolve));active--;
        if(n===3)throw new Error('fixture failure');
    });
    assert.equal(peak,2);assert.ok(results.some(r=>r.status==='rejected'));
});
