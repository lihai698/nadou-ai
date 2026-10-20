const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../static/js/smart-canvas.js'),'utf8');
const view=require('../static/js/smart-node-view.js');
function element(){return {style:{setProperty(name,value){this[name]=value;}},querySelector(){return null;},querySelectorAll(){return [];}};}
function fixture(){
    const frames=new Map(),listeners=new Map(),els=new Map(),calls=[];let next=0,epoch=0;
    const context=vm.createContext({SmartNodeView:view,CSS:{escape:x=>x},nodes:[],dragState:null,canvas:{id:'a'},
        window:{addEventListener(k,fn){if(!listeners.has(k))listeners.set(k,new Set());listeners.get(k).add(fn);},removeEventListener(k,fn){listeners.get(k)?.delete(fn);}},
        requestAnimationFrame(fn){frames.set(++next,fn);return next;},cancelAnimationFrame(id){calls.push(['cancel',id]);},
        world:{querySelector(selector){return els.get(selector.match(/data-id="([^"]+)"/)[1])||null;}},
        smartMediaInputController:{capture(){const generation=epoch,id=context.canvas.id;return ()=>epoch===generation&&context.canvas.id===id;}},
        selectedNode:()=>context.nodes.find(n=>n.id===context.selectedId),positionComposerForNode:n=>calls.push(['composer',n.id]),
        refreshConnectionLayer:()=>calls.push(['connections']),renderMinimap:()=>calls.push(['minimap']),render:()=>calls.push(['render']),
        isSmartGroupNode:n=>n.type==='smart-group',smartGroupImageRefs:n=>(n.images||[]).map(item=>({item})),
        smartGroupCompactMembers:n=>n.members||[],nodeScale:()=>1,imageLayout:()=>({width:200,height:160,thumb:40,cols:2,rows:4,visibleRows:4}),
        SMART_GROUP_MAX_VISIBLE_ROWS:3,MEDIA_GROUP_MAX_VISIBLE_ROWS:2,applyThumbDisplaySizeToElement:(el,img,size)=>calls.push(['thumb',img?.url,size])});
    const start=source.indexOf('function smartInteractionViewHost(');
    if(start>=0){
        vm.runInContext(source.slice(start,source.indexOf('function isVideoMediaItem(',start)),context);
        vm.runInContext('smartInteractionView.mount()',context);
    }else{
        const start=source.indexOf('let interactionLayerRaf = 0;');
        vm.runInContext(source.slice(start,source.indexOf('function isVideoMediaItem(',start)),context);
    }
    return {context,frames,calls,els,listeners,epoch(){epoch++;},run(code){return vm.runInContext(code,context);},fire(k){for(const fn of listeners.get(k)||[])fn();}};
}
test('drag updates live node elements and selected composer, batching connections then minimap',()=>{
    const f=fixture(),el=element();f.els.set('a',el);f.context.nodes=[{id:'a',x:25,y:40}];f.context.selectedId='a';f.context.dragState={id:'a'};
    f.run('moveNodeElementsDuringDrag(); moveNodeElementsDuringDrag()');assert.equal(el.style.left,'25px');assert.equal(el.style.top,'40px');assert.equal(f.frames.size,1);
    f.frames.get(1)();assert.deepEqual(f.calls.slice(-2),[['connections'],['minimap']]);assert.equal(f.calls.filter(x=>x[0]==='composer').length,2);
});
test('resize retains media nodes, grid limits, skeleton dimensions and composer placement',()=>{
    const f=fixture(),el=element(),body=element(),grid=element(),single=element(),skeleton=element(),wrap=element(),media=element();
    const parts={'.loading-cell.single':single,'.loading-skeleton':skeleton,'.thumb-grid':grid,'.image-wrap':wrap,'.node-img':media};body.querySelector=s=>parts[s];grid.querySelectorAll=()=>[element(),element()];el.querySelector=()=>body;f.els.set('a',el);
    f.context.nodes=[{id:'a',pending:5,images:[{url:'one'},{url:'two'}]}];f.context.selectedId='a';f.run('updateNodeElementDuringResize(nodes[0])');
    assert.equal(el.style.width,'200px');assert.equal(single.style.height,'160px');assert.equal(skeleton.style.gridTemplateColumns,'repeat(3, 1fr)');assert.equal(skeleton.style.gridTemplateRows,'repeat(2, 1fr)');assert.equal(grid.style['--thumb-max-height'],'88px');assert.equal(media.style.width,'200px');assert.equal(wrap.style['--node-img-h'],'160px');assert.equal(f.calls.filter(x=>x[0]==='thumb').length,2);assert.equal(f.frames.size,1);
});
test('group resize keeps inner padding and compact-member visible rows',()=>{
    const f=fixture(),el=element(),body=element(),grid=element(),wrap=element(),media=element();body.querySelector=s=>({'.thumb-grid':grid,'.image-wrap':wrap,'.node-img':media})[s];el.querySelector=()=>body;f.els.set('g',el);
    f.context.nodes=[{id:'g',type:'smart-group',members:[{id:'m'}],images:[]}];f.run('updateNodeElementDuringResize(nodes[0])');assert.equal(wrap.style['--node-img-w'],'168px');assert.equal(media.style.height,'100px');assert.equal(grid.style['--thumb-max-height'],'184px');
});
test('missing element requests full render; empty drag and non-group sync are inert',()=>{
    const f=fixture();f.run('moveNodeElementsDuringDrag(); updateNodeElementDuringResize(null); syncSmartGroupMemberElements({})');assert.deepEqual(f.calls,[]);
    f.run('updateNodeElementDuringResize({id:"absent"})');assert.deepEqual(f.calls,[['render']]);assert.equal(f.frames.size,0);
});
test('group members synchronize position and dimensions without replacing DOM',()=>{
    const f=fixture(),el=element();f.els.set('m',el);f.context.group={type:'smart-group',members:[{id:'m',x:10,y:20,images:[]}]};f.run('syncSmartGroupMemberElements(group)');assert.equal(el.style.left,'10px');assert.equal(el.style.top,'20px');assert.equal(el.style.width,'200px');assert.equal(f.frames.size,1);
});
test('pagehide cancels pending refresh and ignores a late callback',()=>{
    const f=fixture();f.run('scheduleInteractionLayerRefresh()');const late=f.frames.get(1);f.fire('pagehide');late();assert.deepEqual(f.calls,[['cancel',1]]);
});
test('old open epoch cannot refresh a different or same-ID reopened canvas',()=>{
    const f=fixture();f.run('scheduleInteractionLayerRefresh()');f.epoch();f.frames.get(1)();assert.deepEqual(f.calls,[]);
});
test('new open can schedule immediately; late old frame cannot clear the new frame',()=>{
    const f=fixture();f.run('scheduleInteractionLayerRefresh()');f.epoch();f.run('scheduleInteractionLayerRefresh()');assert.equal(f.frames.size,2);f.frames.get(1)();f.run('scheduleInteractionLayerRefresh()');assert.equal(f.frames.size,2);f.frames.get(2)();assert.deepEqual(f.calls.slice(-2),[['connections'],['minimap']]);
});
test('normal save object replacement retains pending view refresh',()=>{
    const f=fixture();f.run('scheduleInteractionLayerRefresh()');f.context.canvas={id:'a'};f.frames.get(1)();assert.deepEqual(f.calls,[['connections'],['minimap']]);
});
test('mount is idempotent, pageshow restores and dispose prevents remount or late effects',()=>{
    const f=fixture();f.run('smartInteractionView.mount(); smartInteractionView.mount()');assert.equal(f.listeners.get('pagehide').size,1);f.fire('pagehide');f.run('scheduleInteractionLayerRefresh()');assert.equal(f.frames.size,0);f.fire('pageshow');f.run('scheduleInteractionLayerRefresh()');assert.equal(f.frames.size,1);f.run('smartInteractionView.dispose(); smartInteractionView.mount()');f.frames.get(1)();assert.equal(f.listeners.get('pagehide').size,0);assert.equal(f.listeners.get('pageshow').size,0);assert.deepEqual(f.calls,[['cancel',1]]);
});
