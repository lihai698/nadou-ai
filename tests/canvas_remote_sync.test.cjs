const {installEditorBridges}=require('./canvas_editor_bridge_test_helpers.cjs');
const {installClassicPreviewRuntime}=require('./canvas_preview_runtime_test_helpers.cjs');
const {createTaskContext}=require('./canvas_task_test_helpers.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const context=vm.createContext({});
vm.runInContext(readFileSync(path.join(__dirname,'../static/js/canvas-remote-sync.js'),'utf8'),context);
function harness(kind){
    const state={id:'c',hasCanvas:true,clientId:'local',updatedAt:10,metaRevision:1,isSaving:false,hasEdits:false,applying:false,hidden:false,dragging:false,selecting:false};
    const timers=[],polls=[],cleared=[],events=[],requests=[];let customRequest=null,responseStatus=200,reply={canvas:{id:'c',nodes:[],updated_at:11}};
    const api=context.CanvasRemoteSync[kind==='classic'?'createClassic':'createSmart']({
        getState:()=>({...state}),request:async url=>{requests.push(url);if(customRequest)return customRequest(url);return {ok:responseStatus>=200&&responseStatus<300,json:async()=>reply};},
        merge:remote=>{events.push(['merge',remote]);return true;},apply:remote=>events.push(['apply',remote]),
        scheduleSave:()=>events.push(['save']),status:text=>events.push(['status',text]),error:error=>events.push(['error',error.message]),openError:()=> 'open failed',
        setTimer:(fn,delay)=>{timers.push({fn,delay});return timers.length;},clearTimer:id=>cleared.push(['timer',id]),
        setPoll:(fn,delay)=>{polls.push({fn,delay});return polls.length;},clearPoll:id=>cleared.push(['poll',id])
    });
    return {api,state,timers,polls,cleared,events,requests,setRequest:value=>{customRequest=value;},setReply:value=>{reply=value;},setResponseStatus:value=>{responseStatus=value;}};
}
const notice=(extra={})=>({type:'canvas_updated',canvas_id:'c',client_id:'other',updated_at:11,...extra});
test('classic filters irrelevant/self/stale notifications and schedules accepted ones',()=>{
    const h=harness('classic');
    for(const event of [null,{},notice({client_id:'local'}),notice({canvas_id:'other'}),notice({updated_at:10})])h.api.handleMessage(event);
    assert.equal(h.timers.length,0);h.api.handleMessage(notice());assert.equal(h.timers[0].delay,120);
    assert.deepEqual(h.events,[['status','Syncing...']]);
});
test('classic assistant notifications stay quiet and saving postpones fetch application',async()=>{
    const h=harness('classic');h.state.isSaving=true;h.api.handleMessage(notice({client_id:'canvas-assistant'}));
    assert.equal(h.timers[0].delay,700);assert.deepEqual(h.events,[]);
    await h.api.syncNow();assert.equal(h.timers.at(-1).delay,700);assert.deepEqual(h.events,[]);
});
test('classic dirty state merges and schedules save instead of replacing local data',async()=>{
    const h=harness('classic');h.state.hasEdits=true;await h.api.syncNow();
    assert.deepEqual(h.events.map(e=>e[0]),['merge','save']);assert.equal(h.state.hasEdits,true);
});
test('classic applies equal or newer clean data and ignores older data',async()=>{
    const h=harness('classic');h.setReply({canvas:{nodes:[],updated_at:9}});await h.api.syncNow();assert.equal(h.events.length,0);
    h.setReply({canvas:{nodes:[],updated_at:10}});await h.api.syncNow();assert.equal(h.events[0][0],'apply');
});
test('classic poll is serialized, respects hidden/applying state and restarts at 2500ms',async()=>{
    const h=harness('classic');h.api.start();h.api.start();assert.equal(h.polls[0].delay,2500);assert.ok(h.cleared.some(e=>e[0]==='poll'&&e[1]===1));
    h.state.hidden=true;await h.polls[1].fn();h.state.hidden=false;h.state.applying=true;await h.polls[1].fn();assert.equal(h.requests.length,0);
    h.state.applying=false;h.setReply({updated_at:10,meta_revision:1});
    const first=h.polls[1].fn(),second=h.polls[1].fn();await Promise.all([first,second]);assert.equal(h.requests.length,1);
});
test('classic metadata revision change triggers a full GET',async()=>{
    const h=harness('classic');h.setReply({updated_at:10,meta_revision:2});h.api.start();await h.polls[0].fn();
    assert.deepEqual(h.requests,['/api/canvases/c/meta','/api/canvases/c']);
});
test('classic full-fetch errors are visible while polling errors stay quiet',async()=>{
    const h=harness('classic');h.setReply(null);await h.api.syncNow();assert.equal(h.events[0][0],'error');
    h.events.length=0;h.api.start();await h.polls[0].fn();assert.equal(h.events.length,0);
});
test('classic non-success HTTP reports the original open error, but meta failures remain quiet',async()=>{
    const h=harness('classic');h.setResponseStatus(503);await h.api.syncNow();assert.deepEqual(h.events,[['error','open failed']]);
    h.events.length=0;h.api.start();await h.polls[0].fn();assert.deepEqual(h.events,[]);
});
test('smart ignores notifications during save and accepts newer remote notices',()=>{
    const h=harness('smart');h.state.isSaving=true;h.api.handleMessage(notice());assert.equal(h.timers.length,0);
    h.state.isSaving=false;for(const event of [notice({client_id:'local'}),notice({updated_at:10}),notice({canvas_id:'x'})])h.api.handleMessage(event);
    assert.equal(h.timers.length,0);h.api.handleMessage(notice());assert.equal(h.timers[0].delay,200);
});
test('smart interaction postpones sync by 600ms without fetching',async()=>{
    const h=harness('smart');h.state.dragging=true;await h.api.syncNow();assert.equal(h.timers[0].delay,600);assert.equal(h.requests.length,0);
    h.state.dragging=false;h.state.selecting=true;await h.api.syncNow();assert.equal(h.timers[1].delay,600);
});
test('smart applies complete fetched canvases and ignores missing responses',async()=>{
    const h=harness('smart');h.state.id='a/b';await h.api.syncNow();assert.equal(h.requests[0],'/api/canvases/a%2Fb');assert.equal(h.events[0][0],'apply');
    h.setReply(null);h.events.length=0;await h.api.syncNow();assert.equal(h.events.length,0);
});
test('smart non-success HTTP never applies data or creates an automatic retry loop',async()=>{
    const h=harness('smart');h.setResponseStatus(503);await h.api.syncNow();
    assert.equal(h.requests.length,1);assert.equal(h.events.length,0);assert.equal(h.timers.length,0);
});
test('smart poll starts once at 8000ms and skips busy or absent canvas states',async()=>{
    const h=harness('smart');h.api.start();h.api.start();assert.equal(h.polls.length,1);assert.equal(h.polls[0].delay,8000);
    for(const key of ['isSaving','dragging','selecting']){h.state[key]=true;await h.polls[0].fn();h.state[key]=false;}
    h.state.hasCanvas=false;await h.polls[0].fn();assert.equal(h.requests.length,0);
});
test('smart metadata revision change launches the full fetch',async()=>{
    const h=harness('smart');h.setReply({updated_at:10,meta_revision:2});h.api.start();await h.polls[0].fn();
    await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(h.requests,['/api/canvases/c/meta','/api/canvases/c']);
});
test('both editors load remote sync before their entry script',()=>{
    for(const name of ['canvas','smart-canvas']){const html=readFileSync(path.join(__dirname,`../static/${name}.html`),'utf8');const i=html.indexOf('/static/js/canvas-remote-sync.js');assert.ok(i>=0&&i<html.indexOf(`/static/js/${name}.js`));}
});

function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
const response=()=>({ok:true,json:async()=>({canvas:{id:'c',updated_at:20},updated_at:20})});
for(const kind of ['classic','smart']){
    test(`${kind}: a full response for an old canvas has no effects`,async()=>{
        const h=harness(kind),gate=deferred();h.setRequest(()=>gate.promise);
        const pending=h.api.syncNow();h.state.id='other';gate.resolve(response());await pending;
        assert.deepEqual(h.events,[]);assert.equal(h.timers.length,0);
    });
    test(`${kind}: a metadata response cannot fetch a different canvas`,async()=>{
        const h=harness(kind),gate=deferred();h.setRequest(()=>gate.promise);h.api.start();
        const pending=h.polls[0].fn();h.state.id='other';gate.resolve(response());await pending;
        await new Promise(resolve=>setImmediate(resolve));assert.equal(h.requests.length,1);
    });
    test(`${kind}: an old scheduled callback cannot sync a different canvas`,async()=>{
        const h=harness(kind);h.api.handleMessage(notice());h.state.id='other';await h.timers[0].fn();
        assert.equal(h.requests.length,0);
    });
    test(`${kind}: stop invalidates queued callbacks, polls and direct sync`,async()=>{
        const h=harness(kind);h.api.start();h.api.handleMessage(notice());h.api.stop();h.events.length=0;
        await h.timers[0].fn();await h.polls[0].fn();await h.api.syncNow();h.api.handleMessage(notice());
        assert.equal(h.requests.length,0);assert.deepEqual(h.events,[]);assert.equal(h.timers.length,1);
        assert.ok(h.cleared.some(e=>e[0]==='timer'&&e[1]===1));assert.ok(h.cleared.some(e=>e[0]==='poll'&&e[1]===1));
    });
    test(`${kind}: stop and restart on the same ID rejects the earlier response`,async()=>{
        const h=harness(kind),gate=deferred();h.setRequest(()=>gate.promise);
        const pending=h.api.syncNow();h.api.stop();h.api.start();gate.resolve(response());await pending;
        assert.deepEqual(h.events,[]);h.setRequest(null);await h.api.syncNow();assert.equal(h.events[0][0],'apply');
    });
    test(`${kind}: stopping during JSON decoding prevents application`,async()=>{
        const h=harness(kind),gate=deferred(),decoding=deferred();
        h.setRequest(async()=>({ok:true,json:()=>{decoding.resolve();return gate.promise;}}));
        const pending=h.api.syncNow();await decoding.promise;h.api.stop();gate.resolve({canvas:{id:'c',updated_at:20}});await pending;
        assert.deepEqual(h.events,[]);
    });
    test(`${kind}: replaced timeout callbacks cannot issue duplicate requests`,async()=>{
        const h=harness(kind);h.api.handleMessage(notice());h.api.handleMessage(notice());
        await h.timers[0].fn();assert.equal(h.requests.length,0);await h.timers[1].fn();assert.equal(h.requests.length,1);
    });
}
test('classic: a failed request after switching canvases does not show a stale error',async()=>{
    const h=harness('classic'),gate=deferred();h.setRequest(()=>gate.promise);
    const pending=h.api.syncNow();h.state.id='other';gate.reject(new Error('old failure'));await pending;assert.deepEqual(h.events,[]);
});
test('classic: an old poll completion cannot unlock the new session poll',async()=>{
    const h=harness('classic'),old=deferred(),current=deferred();h.api.start();h.setRequest(()=>old.promise);
    const first=h.polls[0].fn();h.api.stop();h.api.start();h.setRequest(()=>current.promise);
    const second=h.polls[1].fn();old.resolve(response());await first;await h.polls[1].fn();
    assert.equal(h.requests.length,2);current.resolve({ok:true,json:async()=>({updated_at:10,meta_revision:1})});await second;
});
test('classic: restarting polling while a poll is pending keeps serialization',async()=>{
    const h=harness('classic'),gate=deferred();h.api.start();h.setRequest(()=>gate.promise);
    const pending=h.polls[0].fn();h.api.start();const repeated=h.polls[1].fn();assert.equal(h.requests.length,1);
    gate.resolve({ok:true,json:async()=>({updated_at:10,meta_revision:1})});await Promise.all([pending,repeated]);
    h.setRequest(null);h.setReply({updated_at:10,meta_revision:1});await h.polls[1].fn();assert.equal(h.requests.length,2);
});
for(const kind of ['classic','smart']){
    const name=kind==='classic'?'canvas':'smart-canvas';
    const source=readFileSync(path.join(__dirname,`../static/js/${name}.js`),'utf8');
    test(`${kind}: the real load entry stops sync before requesting a canvas`,()=>{
        const begin=kind==='classic'?'async function openCanvas(':'async function loadCanvas(';
        const end=kind==='classic'?'function applyRemoteCanvasData(':'function scheduleSave(';
        const events=[];
        const e=vm.createContext({window:{},canvas:null,canvasId:'c',canvasOpenGeneration:0,openingCanvasId:'',setStatus(){},invalidateSmartVideoDeconstruction(){},
            [kind+'RemoteSync']:{stop:()=>events.push('stop')},fetch:()=>{events.push('fetch');return new Promise(()=>{});}});
        const moduleName=kind==='classic'?'canvas-open-coordinator':'smart-open-coordinator';
        const host=kind==='classic'?'classicOpenCoordinatorHost':'smartOpenCoordinatorHost';
        const start=source.indexOf(`function ${host}(`);
        vm.runInContext(readFileSync(path.join(__dirname,`../static/js/${moduleName}.js`),'utf8')+'\n'+source.slice(start,source.indexOf('\n}',start)+2),e);
        if(kind==='smart'){
            const mediaStart=source.indexOf('function smartMediaInputHost(');
            vm.runInContext(readFileSync(path.join(__dirname,'../static/js/smart-media-input-events.js'),'utf8')+'\n'+source.slice(mediaStart,source.indexOf('\n}',mediaStart)+2)+'\nvar smartMediaInputController=SmartMediaInputEvents.create(smartMediaInputHost);',e);
            const deferredStart=source.indexOf('function smartDeferredActionsHost(');
            vm.runInContext(readFileSync(path.join(__dirname,'../static/js/smart-deferred-actions.js'),'utf8')+'\n'+source.slice(deferredStart,source.indexOf('\n}',deferredStart)+2)+'\nvar smartDeferredActions=SmartDeferredActions.create(smartDeferredActionsHost);',e);
        }
        vm.runInContext(source.slice(source.indexOf(begin),source.indexOf(end,source.indexOf(begin))),e);
        vm.runInContext(kind==='classic'?"openCanvas('c')":"loadCanvas()",e);
        assert.deepEqual(events,['stop','fetch']);
    });
    test(`${kind}: actual page events stop old responses and resume persisted pages`,async()=>{
        const h=harness(kind),gate=deferred(),listeners={};h.setRequest(()=>gate.promise);h.api.start();
        const begin=source.indexOf("window.addEventListener('pagehide'");assert.ok(begin>=0,'page lifecycle listeners exist');
        const end=source.indexOf(kind==='classic'?'let models =':'function connectAssetLibrarySyncSocket(',begin);
        const e=createTaskContext({window:{addEventListener:(name,fn)=>{listeners[name]=fn;}},canvasOpenGeneration:0,openingCanvasId:'',canvas:{id:'c'},[kind+'RemoteSync']:h.api});
        if(kind==='classic')installClassicPreviewRuntime(e,source);
        installEditorBridges(e,source,kind);
        vm.runInContext(source.slice(begin,end),e);
        const pending=h.api.syncNow();listeners.pagehide();gate.resolve(response());await pending;assert.deepEqual(h.events,[]);
        h.setRequest(null);listeners.pageshow({persisted:false});assert.equal(h.polls.length,1);
        listeners.pageshow({persisted:true});await new Promise(resolve=>setImmediate(resolve));
        assert.equal(h.polls.length,2);assert.equal(h.events[0][0],'apply');
    });
}
