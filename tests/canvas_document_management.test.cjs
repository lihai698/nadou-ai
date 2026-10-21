const {installEditorBridges}=require('./canvas_editor_bridge_test_helpers.cjs');
const {installClassicPreviewRuntime}=require('./canvas_preview_runtime_test_helpers.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const {createTaskContext}=require('./canvas_task_test_helpers.cjs');
const api=require('../static/js/canvas-document-management.js');
const source=fs.readFileSync(path.join(__dirname,'../static/js/canvas.js'),'utf8');
function entry(name){const begin=source.indexOf(`function ${name}(`);assert.ok(begin>=0);return source.slice(source.slice(begin-6,begin)==='async '?begin-6:begin,source.indexOf('\n}',begin)+2);}
function control(){
    const handlers=new Map();
    return {value:'',classList:{toggle(){}},focus(){},select(){},
        addEventListener(name,fn){const list=handlers.get(name)||[];list.push(fn);handlers.set(name,list);},
        removeEventListener(name,fn){handlers.set(name,(handlers.get(name)||[]).filter(f=>f!==fn));},
        emit(name,event={}){for(const fn of handlers.get(name)||[])fn(event);},
        count(){return [...handlers.values()].reduce((n,list)=>n+list.length,0);}};
}
test('legacy gate listeners are owned, suspendable and idempotent across page restoration',()=>{
    const calls=[],listeners={},gateCreateBtn=control(),gateTitleInput=control();
    const e=createTaskContext({gateCreateBtn,gateTitleInput,gateCreateSmartBtn:null,gateBackBtn:null,gateTrashBtn:null,
        gateRefreshBtn:null,gateConfirmBtn:null,gateCancelBtn:null,canvasGate:control(),deletedCanvases:[],canvases:[],
        creatingCanvas:false,createCanvasKind:'classic',trashMode:false,gateTitleText:null,gateSubtitle:null,gateTrashCount:null,
        document:{getElementById:()=>null},tr:x=>x,setStatus:x=>calls.push(x),refreshIcons(){},
        window:{addEventListener:(name,fn)=>listeners[name]=fn},canvas:null,openingCanvasId:'',canvasOpenGeneration:0,
        classicRemoteSync:{stop(){}}});
    installClassicPreviewRuntime(e,source);
    installEditorBridges(e,source);
    const init=source.match(/const classicLegacyGateBindings = [^\n]+/);
    assert.ok(init,'production explicit gate binding initialization');
    vm.runInContext(init[0].replace('const classicLegacyGateBindings','var classicLegacyGateBindings')+'\nclassicLegacyGateBindings.resume();classicLegacyGateBindings.resume();',e);
    gateCreateBtn.emit('click');assert.equal(calls.length,1);assert.equal(e.creatingCanvas,true);
    const start=source.indexOf("window.addEventListener('pagehide'");
    vm.runInContext(source.slice(start,source.indexOf('let models =',start)),e);
    listeners.pagehide();assert.equal(gateCreateBtn.count(),0);assert.equal(gateTitleInput.count(),0);
    listeners.pageshow({persisted:true});listeners.pageshow({persisted:true});
    assert.equal(gateCreateBtn.count(),1);assert.equal(gateTitleInput.count(),1);
    gateTitleInput.emit('keydown',{key:'Escape'});assert.equal(e.creatingCanvas,false);
});
test('current editor without legacy gate elements initializes and disposes safely',()=>{
    const binding=api.createLegacyGateBindings({document:{getElementById:()=>null}});
    binding.resume();binding.resume();binding.suspend();binding.suspend();binding.resume();
});
test('real metadata entry reloads catalog after failure and keeps document nodes local',async()=>{
    const calls=[],nodes=[{id:'local-edit'}],e=createTaskContext({canvas:{id:'c',title:'old',nodes},canvases:[{id:'c'}],
        deletedCanvases:[],canvasSortMode:'recent',canvasGate:null,trashMode:false,currentCanvasTitle:{},
        tr:x=>x,setStatus(){},console:{error(){}},fetch:async(url,options)=>{
            calls.push({url,options});
            if(options?.method==='POST')return {ok:false};
            return {ok:true,json:async()=>({canvases:url.endsWith('/trash')?[]:[{id:'c',title:'server'}]})};
        }});
    vm.runInContext(entry('patchCanvasMeta'),e);
    await e.patchCanvasMeta('c',{title:'local'});
    assert.deepEqual(calls.map(c=>c.url),['/api/canvases/c/meta','/api/canvases','/api/canvases/trash']);
    assert.equal(e.canvases[0].title,'server');assert.equal(e.canvas.nodes,nodes);
    assert.deepEqual(JSON.parse(calls[0].options.body),{title:'local'});
});
