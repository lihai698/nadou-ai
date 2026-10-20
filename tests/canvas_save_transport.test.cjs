const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const context=vm.createContext({});
vm.runInContext(readFileSync(path.join(__dirname,'../static/js/canvas-save-transport.js'),'utf8'),context);
const transport=context.CanvasSaveTransport;
const response=(status,data)=>({status,ok:status>=200&&status<300,json:async()=>data});
const version=()=>({updated_at:10,meta_revision:1});

test('classic save sends its snapshot once including accepted task IDs and revisions',async()=>{
    const calls=[],payload={nodes:[{id:'n',_pending:[{canvasTaskId:'original-task'}]}],base_updated_at:10,base_meta_revision:1};
    const before=JSON.stringify(payload),saved={id:'c',nodes:payload.nodes,updated_at:11};
    const result=await transport.saveClassic({id:'c',payload,getVersion:version,
        request:async(url,init)=>{calls.push({url,init});return response(200,{canvas:saved});}});
    assert.equal(result.kind,'saved');assert.equal(result.canvas,saved);assert.equal(calls.length,1);
    assert.equal(calls[0].url,'/api/canvases/c');assert.equal(calls[0].init.method,'PUT');
    assert.equal(calls[0].init.headers['Content-Type'],'application/json');
    assert.equal(calls[0].init.body,before);assert.equal(JSON.stringify(payload),before);
});

test('classic conflict accepts both envelope shapes and same-time metadata updates without GET',async()=>{
    for(const envelope of ['detail','top']){
        const remote={nodes:[],updated_at:10,meta_revision:2};let calls=0;
        const result=await transport.saveClassic({id:'c',payload:{},getVersion:version,request:async()=>{
            calls++;return response(409,envelope==='detail'?{detail:{canvas:remote}}:{canvas:remote});}});
        assert.equal(result.kind,'conflict');assert.equal(result.canvas,remote);assert.equal(calls,1);
    }
});

test('classic rejects unavailable conflicts, HTTP failures and invalid success bodies',async()=>{
    for(const [reply,error] of [[response(409,{detail:{canvas:{nodes:[],updated_at:10,meta_revision:1}}}),'冲突版本不可用'],
                                [response(503,{}),'save failed'],[response(200,{}),'save response missing nodes']]){
        let calls=0;
        await assert.rejects(transport.saveClassic({id:'c',payload:{},getVersion:version,
            request:async()=>{calls++;return reply;}}),new RegExp(error));
        assert.equal(calls,1);
    }
});

test('classic reads current revision after conflict JSON arrives',async()=>{
    let latest=10;
    await assert.rejects(transport.saveClassic({id:'c',payload:{},getVersion:()=>({updated_at:latest}),
        request:async()=>({status:409,ok:false,json:async()=>{latest=20;return {canvas:{nodes:[],updated_at:15}};}})}),/冲突版本不可用/);
});

test('smart keeps success data for editor fallback and encodes the ID',async()=>{
    const calls=[];
    const result=await transport.saveSmart({getId:()=>'a/b',payload:{settings:{keep:true}},
        request:async(url,init)=>{calls.push({url,init});return response(200,{});},
        onConflict:()=>assert.fail('success is not a conflict'),getVersion:version});
    assert.equal(result.kind,'saved');assert.equal(JSON.stringify(result.data),'{}');
    assert.equal(calls[0].url,'/api/canvases/a%2Fb');assert.equal(calls.length,1);
});

test('smart clears old queue before JSON and GET, keeping edits queued during fallback',async()=>{
    let queued=true;const events=[];const remote={nodes:[],updated_at:11,meta_revision:1};
    const result=await transport.saveSmart({getId:()=>'c',payload:{},getVersion:version,
        onConflict(){events.push('clear');queued=false;},request:async(url,init)=>{
            if(init){events.push('PUT');return {status:409,ok:false,json:async()=>{
                assert.equal(queued,false);events.push('json');queued=true;return {};}};}
            events.push('GET');return response(200,{canvas:remote});
        }});
    assert.deepEqual(events,['PUT','clear','json','GET']);assert.equal(queued,true);
    assert.equal(result.kind,'conflict');assert.equal(result.canvas,remote);
});

test('smart valid conflict avoids GET and invalid fallback never resubmits PUT',async()=>{
    const remote={nodes:[],updated_at:10,meta_revision:2};let calls=0;
    const result=await transport.saveSmart({getId:()=>'c',payload:{},getVersion:version,onConflict(){},
        request:async()=>{calls++;return response(409,{detail:{canvas:remote}});}});
    assert.equal(result.canvas,remote);assert.equal(calls,1);
    const methods=[];
    await assert.rejects(transport.saveSmart({getId:()=>'c',payload:{},getVersion:version,onConflict(){},
        request:async(_url,init)=>{methods.push(init?.method||'GET');return init?response(409,{}):response(200,{canvas:{nodes:[],updated_at:9}});}}),/current server canvas unavailable/);
    assert.deepEqual(methods,['PUT','GET']);
});

test('smart preserves HTTP and JSON failures without retrying',async()=>{
    await assert.rejects(transport.saveSmart({getId:()=>'c',payload:{},request:async()=>response(503,{})}),/HTTP 503/);
    await assert.rejects(transport.saveSmart({getId:()=>'c',payload:{},request:async()=>({ok:true,json:async()=>{throw new Error('invalid JSON');}})}),/invalid JSON/);
});

test('smart captures conflict revision before fallback while retaining the original live ID lookup',async()=>{
    let id='first',revision=10,reads=0;const urls=[];
    const result=await transport.saveSmart({getId:()=>id,payload:{},onConflict(){},
        getVersion:()=>{reads++;return {updated_at:revision};},request:async(url,init)=>{
            urls.push(url);
            if(init) return {ok:false,status:409,json:async()=>{id='second';return {};}};
            revision=20;
            return response(200,{canvas:{nodes:[],updated_at:15}});
        }});
    assert.equal(result.kind,'conflict');assert.equal(reads,1);
    assert.deepEqual(urls,['/api/canvases/first','/api/canvases/second']);
});

test('classic handles malformed JSON as before and network rejection is never retried',async()=>{
    await assert.rejects(transport.saveClassic({id:'c',payload:{},getVersion:version,
        request:async()=>({ok:true,status:200,json:async()=>{throw new Error('bad json');}})}),/save response missing nodes/);
    const error=new Error('network failure');let calls=0;
    await assert.rejects(transport.saveSmart({getId:()=>'c',payload:{},request:async()=>{calls++;throw error;}}),e=>e===error);
    assert.equal(calls,1);
});

test('both editors load the transport before their entry script',()=>{
    for(const name of ['canvas','smart-canvas']){
        const html=readFileSync(path.join(__dirname,`../static/${name}.html`),'utf8');
        assert.ok(html.indexOf('/static/js/canvas-save-transport.js')>=0);
        assert.ok(html.indexOf('/static/js/canvas-save-transport.js')<html.indexOf(`/static/js/${name}.js`));
    }
});
