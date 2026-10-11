const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const classic=fs.readFileSync(path.join(__dirname,'../static/js/canvas.js'),'utf8');
const smart=fs.readFileSync(path.join(__dirname,'../static/js/smart-canvas.js'),'utf8');
function section(source,begin,end){const a=source.indexOf(begin),b=source.indexOf(end,a);assert.ok(a>=0&&b>a,begin);return source.slice(a,b);}
function editor(fields){const e=vm.createContext({window:{},structuredClone,console,...fields});const module=path.join(__dirname,'../static/js/canvas-save-recovery.js');if(fs.existsSync(module))vm.runInContext(fs.readFileSync(module,'utf8'),e);return e;}
test('classic: another page update never clears an unsaved local edit',()=>{
    const e=editor({canvas:{id:'c'},CLIENT_ID:'local',lastCanvasUpdatedAt:1,savingCanvasNow:false,saveTimer:1,
        localCanvasDirty:true,remoteSyncTimer:null,clearTimeout(){},setTimeout(){return 2;},syncRemoteCanvasNow(){},setStatus(){}});
    vm.runInContext(section(classic,'function handleCanvasUpdatedMessage(','async function clearCurrentCanvas('),e);
    vm.runInContext("handleCanvasUpdatedMessage({type:'canvas_updated',canvas_id:'c',client_id:'other',updated_at:2})",e);
    assert.equal(e.localCanvasDirty,true);
});
test('smart: an unchanged node deleted in another page stays deleted',()=>{
    const n={id:'p',type:'smart-prompt',text:'正文'};
    const e=editor({canvasBaseNodes:new Map([['p',structuredClone(n)]]),mergeSmartNode(){assert.fail('no matching pair');}});
    vm.runInContext(section(smart,'function mergeSmartNodeLists(','function mergeSmartConnections('),e);
    e.local=[structuredClone(n)];e.remote=[];
    assert.equal(vm.runInContext('mergeSmartNodeLists(local,remote).length',e),0);
});
test('smart: a locally deleted unchanged node stays deleted',()=>{
    const n={id:'p',type:'smart-prompt',text:'正文'};
    const e=editor({canvasBaseNodes:new Map([['p',structuredClone(n)]]),mergeSmartNode(){assert.fail('no matching pair');}});
    vm.runInContext(section(smart,'function mergeSmartNodeLists(','function mergeSmartConnections('),e);
    e.local=[];e.remote=[structuredClone(n)];
    assert.equal(vm.runInContext('mergeSmartNodeLists(local,remote).length',e),0);
});
test('smart: deleted connections are not restored by a merge',()=>{
    const link={from:'p',to:'q',kind:'input'};
    const e=editor({canvasBaseConnections:[structuredClone(link)]});
    vm.runInContext(section(smart,'function mergeSmartConnections(','function applyMergedServerCanvas('),e);
    e.local=[];e.remote=[link];e.ids=new Set(['p','q']);
    assert.equal(vm.runInContext('mergeSmartConnections(local,remote,ids).length',e),0);
});

function recovery(storage=new Map()){
    const e=editor({window:{sessionStorage:{setItem:(k,v)=>storage.set(k,v),getItem:k=>storage.get(k),removeItem:k=>storage.delete(k)}}});
    return e.window.CanvasSaveRecovery;
}
const documentBase=()=>({id:'c',updated_at:1,nodes:[{id:'p',type:'prompt',text:'原正文',x:0},{id:'q',type:'prompt',text:'第二正文',x:100}],connections:[{id:'pq',from:'p',to:'q'}]});
const conflictCopy=n=>({...structuredClone(n),id:n.id+'-local-copy',title:'本地冲突副本'});
test('different page edits and new nodes survive a three-way merge',()=>{
    const h=recovery(),base=documentBase(),local=structuredClone(base),remote=structuredClone(base);
    local.nodes[0].text='本页正文';local.nodes.push({id:'new',type:'loop',count:3});remote.nodes[1].text='另一页正文';remote.updated_at=2;
    const out=h.mergeDocument(base,local,remote,conflictCopy);
    assert.equal(out.canvas.nodes.find(n=>n.id==='p').text,'本页正文');assert.equal(out.canvas.nodes.find(n=>n.id==='q').text,'另一页正文');assert.equal(out.canvas.nodes.find(n=>n.id==='new').count,3);assert.equal(out.conflicts,0);
});
test('same field conflict preserves both text versions and the copy connection',()=>{
    const h=recovery(),base=documentBase(),local=structuredClone(base),remote=structuredClone(base);
    local.nodes[0].text='本地版本';remote.nodes[0].text='另一页版本';
    const out=h.mergeDocument(base,local,remote,conflictCopy);
    assert.equal(out.conflicts,1);assert.equal(out.canvas.nodes.find(n=>n.id==='p').text,'另一页版本');assert.equal(out.canvas.nodes.find(n=>n.id==='p-local-copy').text,'本地版本');
    assert.ok(out.canvas.connections.some(c=>c.from==='p-local-copy'&&c.to==='q'));
});

test('multiple conflict copies remain below the existing layout and each other',()=>{
    const h=recovery(),base=documentBase();base.nodes.push({id:'group',type:'group',y:100,h:600,items:['p','q']});
    const local=structuredClone(base),remote=structuredClone(base);
    local.nodes[0].text='本地一';local.nodes[1].text='本地二';remote.nodes[0].text='远程一';remote.nodes[1].text='远程二';
    const out=h.mergeDocument(base,local,remote,conflictCopy).canvas;
    const first=out.nodes.find(n=>n.id==='p-local-copy'),second=out.nodes.find(n=>n.id==='q-local-copy');
    assert.ok(first.y>700);assert.ok(second.y>first.y+260);
    assert.equal(out.nodes.find(n=>n.id==='group').y,100);assert.equal(out.nodes.find(n=>n.id==='p').x,0);
});
test('remote deletion removes an unchanged node, its group reference, and incident links',()=>{
    const h=recovery(),base=documentBase();base.nodes.push({id:'g',type:'group',items:['p','q']});
    const local=structuredClone(base),remote=structuredClone(base);remote.nodes=remote.nodes.filter(n=>n.id!=='p');remote.nodes.find(n=>n.id==='g').items=['q'];remote.connections=[];
    const out=h.mergeDocument(base,local,remote,conflictCopy).canvas;
    assert.ok(!out.nodes.some(n=>n.id==='p'));assert.deepEqual(Array.from(out.nodes.find(n=>n.id==='g').items),['q']);assert.equal(out.connections.length,0);
});
test('an edited node survives deletion in another page',()=>{
    const h=recovery(),base=documentBase(),local=structuredClone(base),remote=structuredClone(base);
    local.nodes[0].text='还需保留的正文';remote.nodes=remote.nodes.filter(n=>n.id!=='p');remote.connections=[];
    assert.equal(h.mergeDocument(base,local,remote,conflictCopy).canvas.nodes.find(n=>n.id==='p').text,'还需保留的正文');
});
test('failed-save draft survives refresh and merges a newer server version',()=>{
    const storage=new Map(),before=recovery(storage),base=documentBase(),local=structuredClone(base),remote=structuredClone(base);
    local.nodes[0].text='保存失败的中文草稿';remote.nodes[1].text='刷新前另一页保存';remote.updated_at=2;
    assert.equal(before.saveDraft('classic','c',base,local),true);
    const after=recovery(storage),out=after.recoverDraft('classic','c',remote,conflictCopy).canvas;
    assert.equal(out.nodes.find(n=>n.id==='p').text,'保存失败的中文草稿');assert.equal(out.nodes.find(n=>n.id==='q').text,'刷新前另一页保存');
});
test('a committed save with a lost acknowledgement does not create a duplicate on refresh',()=>{
    const h=recovery(),base=documentBase(),local=structuredClone(base);local.nodes[0].text='已经落盘';h.saveDraft('smart','c',base,local);
    assert.equal(h.recoverDraft('smart','c',{...local,updated_at:2},conflictCopy),null);assert.equal(h.readDraft('smart','c'),null);
});
test('drafts stay isolated by canvas, editor kind, and browser page storage',()=>{
    const a=recovery(),b=recovery(),base=documentBase(),local=structuredClone(base);local.nodes[0].text='本页';a.saveDraft('classic','c',base,local);
    assert.ok(a.readDraft('classic','c'));assert.equal(a.readDraft('classic','other'),null);assert.equal(a.readDraft('smart','c'),null);assert.equal(b.readDraft('classic','c'),null);
});
test('full or unavailable browser storage reports a failed backup',()=>{
    const e=editor({window:{sessionStorage:{setItem(){throw Error('quota');}}}}),h=e.window.CanvasSaveRecovery;
    assert.equal(h.saveDraft('classic','c',documentBase(),documentBase()),false);
});
