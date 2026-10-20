const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../static/js/smart-canvas.js'),'utf8');
const media=require('../static/js/smart-media-input-events.js');
function fixture(){
    const timers=new Map(),cancelled=[],events=new Map(),updates=[],effects=[];let next=0;
    const window={addEventListener(k,fn){if(!events.has(k))events.set(k,new Set());events.get(k).add(fn);},removeEventListener(k,fn){events.get(k)?.delete(fn);}};
    const context=vm.createContext({window,canvas:{id:'a'},nodes:[{id:'n',runPrompt:'first'}],selectedId:'n',
        setTimeout(fn,delay){const id=++next;timers.set(id,{fn,delay});return id;},clearTimeout(id){cancelled.push(id);timers.delete(id);},
        selectedNode:()=>context.nodes.find(n=>n.id===context.selectedId)||null,
        syncRunButtonState:n=>updates.push(n),smartCascadeSilentSelection:false,activeComposerSubject:null,lastComposerNodeId:'',
        composer:{classList:{toggle(){},remove(){}}},cascadeRunBtn:null,isSmartRunnableNode:n=>Boolean(n),
        savePromptDraftForCurrent:()=>effects.push('save-draft'),setPromptInputLocked(){},setPromptText:()=>effects.push('clear-prompt'),
        promptInputNodesFor:()=>[],smartSettingsForNode:n=>({promptH:n.height||124}),loadPromptDraft:n=>effects.push(['load',n.runPrompt]),
        syncCascadeRunButton(){},positionComposerForNode:n=>effects.push(['position',n.id]),promptInput:{style:{setProperty(){}}},
        renderInputThumbsRow:n=>effects.push(['thumbs',n.id]),renderInputPromptPreview(){},scheduleDynamicParamsRefresh:d=>effects.push(['params',d])});
    context.smartMediaInputController=media.create(()=>({window,get canvas(){return context.canvas;}}));
    context.smartMediaInputController.mount();
    const modern=source.includes('function smartComposerSchedulerHost(');
    if(modern)context.SmartComposerScheduler=require('../static/js/smart-composer-scheduler.js');
    const start=source.indexOf(modern?'function smartComposerSchedulerHost(':'let composerUpdateTimer = 0;');
    vm.runInContext(source.slice(start,source.indexOf('function smartInputHost(',start)),context);
    if(modern)vm.runInContext('smartComposerScheduler.mount()',context);
    return {context,timers,cancelled,events,updates,effects,run:s=>vm.runInContext(s,context),
        schedule(delay){vm.runInContext(delay===undefined?'scheduleComposerUpdate()':`scheduleComposerUpdate(${JSON.stringify(delay)})`,context);},
        fire(k){for(const fn of [...events.get(k)||[]])fn();},
        flush(){const tasks=[...timers.values()];timers.clear();for(const task of tasks)task.fn();}};
}
test('default delay and thumbnail 180ms delay debounce to one live refresh',()=>{const f=fixture();f.schedule();assert.equal([...f.timers.values()][0].delay,120);f.schedule(180);assert.equal(f.timers.size,1);assert.equal([...f.timers.values()][0].delay,180);f.flush();assert.equal(f.updates.length,1);assert.deepEqual(f.effects.at(-1),['params',140]);});
test('negative or invalid delay remains normalized to zero',()=>{const f=fixture();f.schedule(-2);assert.equal([...f.timers.values()][0].delay,0);f.schedule('bad');assert.equal([...f.timers.values()][0].delay,0);});
test('immediate refresh cancels queued work and preserves current presentation',()=>{const f=fixture();f.schedule();const late=[...f.timers.values()][0].fn;f.run('updateComposer()');assert.equal(f.timers.size,0);late();assert.equal(f.updates.length,1);assert.deepEqual(f.effects.filter(x=>Array.isArray(x)&&x[0]==='load'),[['load','first']]);});
test('normal save replacement refreshes the current node object',()=>{const f=fixture();f.schedule();f.context.canvas={id:'a'};f.context.nodes=[{id:'n',runPrompt:'saved'}];f.flush();assert.equal(f.updates[0],f.context.nodes[0]);assert.deepEqual(f.effects.filter(x=>Array.isArray(x)&&x[0]==='load'),[['load','saved']]);});
for(const [name,change] of [
    ['same-ID reopen',f=>f.context.smartMediaInputController.beginOpen()],
    ['canvas switch',f=>{f.context.canvas={id:'b'};}],
    ['deleted selected node',f=>{f.context.nodes=[];}],
    ['changed selection',f=>{f.context.nodes.push({id:'other'});f.context.selectedId='other';}],
])test(name+' prevents old scheduled presentation',()=>{const f=fixture();f.schedule();change(f);f.flush();assert.equal(f.updates.length,0);assert.equal(f.effects.length,0);});
test('stale callback cannot clear a newer pending timer',()=>{const f=fixture();f.schedule();const old=[...f.timers.values()][0].fn;f.schedule(180);const id=[...f.timers.keys()][0];old();assert.equal(f.updates.length,0);f.run('updateComposer()');assert(f.cancelled.includes(id));assert.equal(f.timers.size,0);});
test('pagehide clears queued work and blocks immediate refresh until pageshow',()=>{const f=fixture();f.schedule();const old=[...f.timers.values()][0].fn;f.fire('pagehide');assert.equal(f.timers.size,0);old();f.run('updateComposer()');f.schedule();assert.equal(f.updates.length,0);assert.equal(f.timers.size,0);f.fire('pageshow');f.fire('pageshow');assert.equal(f.updates.length,1);f.schedule();f.flush();assert.equal(f.updates.length,2);});
test('resumed schedule is unaffected by a captured pre-hide callback',()=>{const f=fixture();f.schedule();const old=[...f.timers.values()][0].fn;f.fire('pagehide');f.fire('pageshow');f.updates.length=0;f.schedule();old();f.flush();assert.equal(f.updates.length,1);});
test('no open canvas cannot schedule a refresh',()=>{const f=fixture();f.context.canvas=null;f.schedule();assert.equal(f.timers.size,0);});
test('clearing selection still performs the existing immediate cleanup',()=>{const f=fixture();f.context.selectedId='';f.run('updateComposer()');assert.equal(f.updates[0],null);assert.equal(f.context.activeComposerSubject,null);assert(f.effects.includes('clear-prompt'));});
test('dispose cancels pending work, unbinds and prevents remount',()=>{const f=fixture();const before=f.events.get('pageshow').size;f.schedule();f.run('smartComposerScheduler.dispose(); smartComposerScheduler.mount(); updateComposer(); scheduleComposerUpdate()');assert.equal(f.timers.size,0);assert.equal(f.updates.length,0);assert.equal(f.events.get('pageshow').size,before-1);});

test('pageshow refreshes current selection once after interrupted work',()=>{const f=fixture();f.schedule();f.fire('pagehide');f.context.nodes.push({id:'other',runPrompt:'after resume'});f.context.selectedId='other';f.fire('pageshow');f.fire('pageshow');assert.equal(f.updates.length,1);assert.equal(f.updates[0].id,'other');assert.equal(f.timers.size,0);});
