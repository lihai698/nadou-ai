const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const actions=require('../static/js/smart-deferred-actions.js'),inputs=require('../static/js/smart-media-input-events.js');
function events(){const listeners=new Map();return {addEventListener(k,fn){if(!listeners.has(k))listeners.set(k,new Set());listeners.get(k).add(fn);},removeEventListener(k,fn){listeners.get(k)?.delete(fn);},fire(k){for(const fn of [...listeners.get(k)||[]])fn();},count(k){return listeners.get(k)?.size||0;}};}
function fixture(){
    const window=events(),timers=new Map(),calls={render:0,paste:0,sync:0};let serial=0;
    const deps={window,document:{activeElement:{tagName:'BODY'}},canvas:{id:'a'},nodes:[{id:'n',running:false}],runBtn:{},nodeClipboard:{nodes:[{id:'copied'}]},lastImagePasteAt:0,lastNodePasteAt:0,
        setTimeout(fn){timers.set(++serial,fn);return serial;},clearTimeout(id){timers.delete(id);},render(){calls.render++;},pasteNodes(){calls.paste++;},syncRunButtonState(){calls.sync++;},isEditableTarget:t=>t?.tagName==='INPUT'};
    const input=inputs.create(()=>deps);deps.captureCanvasContext=()=>input.capture();
    const controller=actions.create(()=>deps);controller.mount();input.mount();
    return {deps,input,controller,window,timers,calls,flush(){const callbacks=[...timers.values()];timers.clear();for(const fn of callbacks)fn();}};
}
test('node cooldown clears the live replacement after a normal save',()=>{const f=fixture();f.controller.coolNodeRunningState(f.deps.nodes[0]);f.deps.canvas={id:'a'};f.deps.nodes=[{id:'n',running:true}];f.flush();assert.equal(f.deps.nodes[0].running,false);assert.equal(f.calls.render,1);});
for(const change of ['reopen','canvas','delete','pagehide'])test(change+' prevents an obsolete cooldown callback',()=>{
    const f=fixture();f.controller.coolNodeRunningState(f.deps.nodes[0]);const callback=[...f.timers.values()][0];
    if(change==='reopen')f.input.beginOpen();
    if(change==='canvas')f.deps.canvas={id:'b'};
    if(change==='delete'){f.controller.cancelNode('n');f.deps.nodes=[];}
    if(change==='pagehide')f.window.fire('pagehide');
    f.deps.nodes=[{id:'n',running:true}];callback();assert.equal(f.deps.nodes[0].running,true);assert.equal(f.calls.render,0);
});
test('a newer cooldown cannot be cleared by its cancelled predecessor',()=>{const f=fixture();f.controller.coolNodeRunningState(f.deps.nodes[0]);const old=[...f.timers.values()][0];f.controller.coolNodeRunningState(f.deps.nodes[0]);old();assert.equal(f.deps.nodes[0].running,true);assert.equal(f.timers.size,1);f.flush();assert.equal(f.deps.nodes[0].running,false);});
test('clear node cancels its timer while preserving other node timers',()=>{const f=fixture(),other={id:'other',running:false};f.deps.nodes.push(other);f.controller.coolNodeRunningState(f.deps.nodes[0]);f.controller.coolNodeRunningState(other);f.controller.clearNodeRunningState(f.deps.nodes[0]);assert.equal(f.timers.size,1);assert.equal(f.deps.nodes[0].running,false);f.flush();assert.equal(other.running,false);});
test('button cooldown retains only the latest timer and ignores a prior open',()=>{const f=fixture();f.controller.coolRunButton();f.controller.coolRunButton();assert.equal(f.timers.size,1);assert.equal(f.calls.sync,2);f.input.beginOpen();f.flush();assert.equal(f.calls.sync,2);});
test('delayed paste runs once for the current editor',()=>{const f=fixture();f.controller.queuePaste();f.controller.queuePaste();assert.equal(f.timers.size,1);f.flush();assert.equal(f.calls.paste,1);});
for(const change of ['reopen','canvas','pagehide','blur','image-paste','node-paste','clipboard','focus','invalidate'])test(change+' prevents stale delayed paste',()=>{
    const f=fixture();f.controller.queuePaste();const callback=[...f.timers.values()][0];
    if(change==='reopen')f.input.beginOpen();if(change==='canvas')f.deps.canvas={id:'b'};
    if(change==='pagehide'||change==='blur')f.window.fire(change);
    if(change==='image-paste')f.deps.lastImagePasteAt=Date.now()+1;if(change==='node-paste')f.deps.lastNodePasteAt=Date.now()+1;
    if(change==='clipboard')f.deps.nodeClipboard={nodes:[{id:'other'}]};if(change==='focus')f.deps.document.activeElement={tagName:'INPUT'};
    if(change==='invalidate')f.controller.invalidate();callback();assert.equal(f.calls.paste,0);
});
test('pagehide removes timers and pageshow allows fresh work without duplicate listeners',()=>{const f=fixture();f.controller.coolNodeRunningState(f.deps.nodes[0]);f.controller.queuePaste();f.window.fire('pagehide');assert.equal(f.timers.size,0);f.window.fire('pageshow');f.window.fire('pageshow');f.controller.queuePaste();f.flush();assert.equal(f.calls.paste,1);assert.equal(f.window.count('blur'),1);});
test('dispose removes lifetime handlers and cannot be remounted',()=>{const f=fixture();f.controller.queuePaste();const before=f.window.count('pageshow');f.controller.dispose();f.controller.mount();f.controller.queuePaste();assert.equal(f.timers.size,0);assert.equal(f.window.count('pageshow'),before-1);assert.equal(f.window.count('blur'),0);});
test('page cache suspension clears owned cooldown before input invalidation and refreshes on return',()=>{
    const f=fixture();f.controller.coolNodeRunningState(f.deps.nodes[0]);f.window.fire('pagehide');
    assert.equal(f.deps.nodes[0].running,false);assert.equal(f.calls.render,0);
    f.window.fire('pageshow');assert.equal(f.calls.render,1);assert.equal(f.calls.sync,1);
});
test('production installs deferred suspension before input invalidates its context',()=>{
    const source=fs.readFileSync(require.resolve('../static/js/smart-canvas.js'),'utf8');
    assert.ok(source.indexOf('smartDeferredActions.mount();')<source.indexOf('smartMediaInputController.mount();'));
});
test('production shortcuts delegate delayed paste to the lifecycle owner',()=>{
    const source=fs.readFileSync(require.resolve('../static/js/smart-canvas.js'),'utf8'),start=source.indexOf("window.addEventListener('keydown', e => {"),end=source.indexOf("window.addEventListener('keyup'",start);
    let handler,queued=0;const context=vm.createContext({window:{addEventListener:(k,fn)=>handler=fn},smartDeferredActions:{queuePaste:()=>queued++},isEditableTarget:()=>false,imageEditModal:{classList:{contains:()=>false}},nodeClipboard:{nodes:[{}]}});
    vm.runInContext(source.slice(start,end),context);handler({key:'v',ctrlKey:true});assert.equal(queued,1);
});
