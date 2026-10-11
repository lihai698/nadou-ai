const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../static/js/canvas-save-recovery.js'),'utf8');
const base=()=>({id:'c',nodes:[{id:'p',text:'原正文',x:10,y:20}],connections:[],settings:{},logs:[]});
const copy=n=>({...structuredClone(n),id:n.id+'-copy'});
const drain=async()=>{for(let i=0;i<12;i++)await new Promise(setImmediate);};

// Models committed transactions and document lifetime; browser acceptance uses real IndexedDB.
function environment(){
    const records=new Map(),held=new Set(),lockQueues=new Map();
    let failWrites=false;
    const database={transaction(_name,mode){
        const tx={error:null},jobs=[],working=new Map(records);
        const request=fn=>{const req={};jobs.push(()=>{req.result=structuredClone(fn());req.onsuccess?.();});return req;};
        const store={put:value=>request(()=>{working.set(value.key,structuredClone(value));return value.key;}),
            delete:key=>request(()=>working.delete(key)),get:key=>request(()=>working.get(key)),
            index:()=>({getAll:([kind,id])=>request(()=>[...working.values()].filter(r=>r.kind===kind&&r.id===id))})};
        tx.objectStore=()=>store;tx.abort=()=>{tx.error=Error('aborted');tx.onabort?.();};
        setImmediate(()=>{
            if(mode==='readwrite'&&failWrites){tx.error=Error('quota');tx.onabort?.();return;}
            while(jobs.length)jobs.shift()();
            if(mode==='readwrite'){records.clear();working.forEach((v,k)=>records.set(k,v));}
            tx.oncomplete?.();
        });return tx;
    }};
    const indexedDB={open(){const req={};setImmediate(()=>{req.result=database;req.onsuccess?.();});return req;}};
    const locks={query:async()=>({held:[...held].map(name=>({name}))}),request(name,fn){
        if(name.includes('.owner.')){held.add(name);return Promise.resolve().then(fn);}
        const task=(lockQueues.get(name)||Promise.resolve()).then(fn);lockQueues.set(name,task.catch(()=>{}));return task;
    }};
    function page(owner,{session=new Map(),unavailable=false,quota=false}={}){
        const listeners={},messages=[],label={},button={},warning={hidden:true,dataset:{},querySelector:selector=>selector==='[data-draft-status]'?label:selector==='[data-draft-export]'?button:{}};
        const window={crypto:{randomUUID:()=>owner},indexedDB:unavailable?undefined:indexedDB,navigator:{locks},
            sessionStorage:{getItem:k=>session.get(k),setItem(k,v){if(quota)throw Error('session quota');session.set(k,v);},removeItem:k=>session.delete(k)},
            console:{warn:(...args)=>messages.push(args)},document:{getElementById:()=>warning},addEventListener:(name,fn)=>listeners[name]=fn};
        vm.runInNewContext(source,{window});
        return {h:window.CanvasSaveRecovery,session,listeners,warning,label,messages,close:()=>held.delete(`nadou.canvas-draft.owner.${owner}`)};
    }
    return {records,page,failWrites:value=>{failWrites=value;}};
}

test('a closed page draft is recovered without its session storage',async()=>{
    const e=environment(),a=e.page('a'),local=base();local.nodes[0].text='关闭前的中文正文';
    a.h.saveDraft('classic','c',base(),local);await drain();a.close();
    const b=e.page('b');await b.h.prepareRecovery('classic','c',base(),copy);
    assert.equal(b.h.recoverDraft('classic','c',base(),copy).canvas.nodes[0].text,local.nodes[0].text);
    assert.equal(e.records.size,1);assert.equal([...e.records.values()][0].owner,'b');
});
test('opening another live page cannot consume or clear its neighbours draft',async()=>{
    const e=environment(),a=e.page('a'),local=base();local.nodes[0].text='另一页还在编辑';
    a.h.saveDraft('classic','c',base(),local);await drain();
    const b=e.page('b');await b.h.prepareRecovery('classic','c',base(),copy);b.h.clearDraft('classic','c');await drain();
    assert.equal(b.h.recoverDraft('classic','c',base(),copy),null);assert.equal([...e.records.values()][0].owner,'a');
});
test('two closed pages keep both conflicting versions and isolate other canvases',async()=>{
    const e=environment(),a=e.page('a'),b=e.page('b'),left=base(),right=base();left.nodes[0].text='版本甲';right.nodes[0].text='版本乙';
    a.h.saveDraft('classic','c',base(),left);await drain();b.h.saveDraft('classic','c',base(),right);await drain();
    a.h.saveDraft('smart','other',{...base(),id:'other'},{...base(),id:'other'});await drain();a.close();b.close();
    const c=e.page('c');await c.h.prepareRecovery('classic','c',base(),copy);
    const recovered=c.h.recoverDraft('classic','c',base(),copy),texts=recovered.canvas.nodes.map(n=>n.text);
    assert.equal(recovered.conflicts,1);
    assert.ok(texts.includes('版本甲'));assert.ok(texts.includes('版本乙'));assert.ok([...e.records.values()].some(r=>r.id==='other'));
});
test('a late cleanup never deletes an edit made after the successful save',async()=>{
    const e=environment(),a=e.page('a'),first=base(),latest=base();first.nodes[0].text='已保存';latest.nodes[0].text='保存途中又修改';
    a.h.saveDraft('classic','c',base(),first);await drain();a.h.clearDraft('classic','c');a.h.saveDraft('classic','c',first,latest);await drain();
    assert.equal([...e.records.values()][0].local.nodes[0].text,latest.nodes[0].text);
});
test('a lost server acknowledgement removes a matching draft without making copies',async()=>{
    const e=environment(),a=e.page('a'),local=base();local.nodes[0].text='实际上已经保存';
    a.h.saveDraft('classic','c',base(),local);await drain();a.close();
    const b=e.page('b');await b.h.prepareRecovery('classic','c',local,copy);
    assert.equal(b.h.recoverDraft('classic','c',local,copy),null);assert.equal(e.records.size,0);
});
test('session storage quota still permits a durable backup',async()=>{
    const e=environment(),a=e.page('a',{quota:true}),local=base();local.nodes[0].text='大草稿';
    assert.equal(a.h.saveDraft('classic','c',base(),local),false);await drain();
    assert.equal(e.records.size,1);assert.match(a.label.textContent,/已备份本机/);
});
test('a failed transfer leaves the original durable record and a recoverable in-memory draft',async()=>{
    const e=environment(),a=e.page('a'),local=base();local.nodes[0].text='不可丢失';a.h.saveDraft('classic','c',base(),local);await drain();a.close();e.failWrites(true);
    const b=e.page('b');await b.h.prepareRecovery('classic','c',base(),copy);
    assert.equal([...e.records.values()][0].owner,'a');assert.equal(b.h.recoverDraft('classic','c',base(),copy).canvas.nodes[0].text,'不可丢失');assert.match(b.label.textContent,/备份失败/);
});
test('backup failure is visible and leaving is guarded until server save succeeds',async()=>{
    const e=environment(),a=e.page('a',{unavailable:true}),local=base();local.nodes[0].text='尚未保存';a.h.saveDraft('classic','c',base(),local);await drain();
    assert.equal(a.warning.hidden,false);assert.match(a.label.textContent,/备份失败/);
    let blocked=0;const event={preventDefault(){blocked++;}};a.listeners.beforeunload(event);assert.equal(blocked,1);assert.equal(event.returnValue,'');
    a.h.clearDraft('classic','c');a.listeners.beforeunload(event);assert.equal(blocked,1);
});
