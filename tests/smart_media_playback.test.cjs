const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../static/js/smart-canvas.js'),'utf8');
const inputs=require('../static/js/smart-media-input-events.js');
function target(){const events=new Map();return {events,addEventListener(k,fn,options){if(!events.has(k))events.set(k,new Map());events.get(k).set(fn,options);},removeEventListener(k,fn){events.get(k)?.delete(fn);},fire(k){for(const [fn,o] of [...events.get(k)||[]]){if(o?.once)this.removeEventListener(k,fn);fn();}},count(k){return events.get(k)?.size||0;}};}
function fixture({ready=0,audio=false,group=false}={}){
    const window=target(),frames=new Map();let next=0,plays=0;
    const nodeEl={dataset:{id:group?'g':'n'}},item={dataset:{imageIndex:'0',...(group?{refNodeId:'n',refImageIndex:'0'}:{})}};
    const media=Object.assign(target(),{tagName:audio?'AUDIO':'VIDEO',dataset:{url:'/clip.mp4'},src:'/clip.mp4',isConnected:true,readyState:ready,currentTime:0,paused:true,playbackRate:1,volume:1,muted:false,
        item,nodeEl,getAttribute(k){return this[k];},closest(s){return s==='.image-node'?this.nodeEl:this.item;},play(){plays++;return Promise.resolve();}});
    const context=vm.createContext({window,world:{querySelectorAll:()=>[media]},nodes:[{id:'n',images:[{url:'/clip.mp4'}]},...(group?[{id:'g'}]:[])],canvas:{id:'a'},
        requestAnimationFrame(fn){frames.set(++next,fn);return next;},cancelAnimationFrame(id){frames.delete(id);}});
    context.smartMediaInputController=inputs.create(()=>({window,get canvas(){return context.canvas;}}));context.smartMediaInputController.mount();
    const modern=source.includes('function smartMediaPlaybackHost(');
    if(modern)context.SmartMediaPlayback=require('../static/js/smart-media-playback.js');
    const start=source.indexOf(modern?'function smartMediaPlaybackHost(':'function captureMediaPlaybackState(');
    vm.runInContext(source.slice(start,source.indexOf('function smartRunTaskLabel(',start)),context);
    if(modern)vm.runInContext('smartMediaPlayback.mount()',context);
    context.media=media;context.state={currentTime:12,paused:false,playbackRate:1.5,muted:true,volume:.4};
    return {context,media,item,nodeEl,window,frames,plays:()=>plays,run:s=>vm.runInContext(s,context),restore(){vm.runInContext('restoreMediaPlaybackState(media,state)',context);},
        frame(){const list=[...frames.values()];frames.clear();for(const fn of list)fn();},
        transplant(){
            const oldItem={dataset:{mediaSignature:'video:/clip.mp4'},querySelector:()=>media};
            const newItem={dataset:{imageIndex:'0',mediaSignature:'video:/clip.mp4'}};
            const replacement={tagName:media.tagName,dataset:{url:'/clip.mp4'},getAttribute:k=>k==='src'?'/clip.mp4':'',replaceWith(m){m.item=newItem;newItem.querySelector=()=>m;}};
            newItem.querySelector=()=>replacement;context.oldNode={querySelectorAll:()=>[oldItem]};context.newNode={querySelectorAll:()=>[newItem]};
            vm.runInContext('transplantSmartMediaElements(oldNode,newNode)',context);
        }};
}
test('ready media restores time, rate, volume and playing state',()=>{const f=fixture({ready:1});f.restore();assert.equal(f.media.currentTime,12);assert.equal(f.media.playbackRate,1.5);assert.equal(f.media.muted,true);assert.equal(f.media.volume,.4);assert.equal(f.plays(),1);});
test('metadata readiness gates seeking and playback',()=>{const f=fixture();f.restore();assert.equal(f.plays(),0);assert.equal(f.media.count('loadedmetadata'),1);f.media.readyState=1;f.media.fire('loadedmetadata');assert.equal(f.media.currentTime,12);assert.equal(f.plays(),1);assert.equal(f.media.count('loadedmetadata'),0);});
test('repeated pending restore keeps only the latest metadata listener',()=>{const f=fixture();f.restore();f.context.state={...f.context.state,currentTime:24};f.restore();assert.equal(f.media.count('loadedmetadata'),1);f.media.readyState=1;f.media.fire('loadedmetadata');assert.equal(f.media.currentTime,24);assert.equal(f.plays(),1);});
for(const [name,change] of [
    ['same-ID reopen',f=>f.context.smartMediaInputController.beginOpen()],['canvas switch',f=>{f.context.canvas={id:'b'};}],
    ['node deletion',f=>{f.context.nodes=[];}],['model URL replacement',f=>{f.context.nodes[0].images[0]={url:'/other.mp4'};}],
    ['DOM source replacement',f=>{f.media.src='/other.mp4';}],['detached media',f=>{f.media.isConnected=false;}],
    ['group slot change',f=>{f.item.dataset.refImageIndex='1';}],
])test(name+' blocks late metadata seek and play',()=>{const f=fixture({group:true});f.restore();change(f);f.media.readyState=1;f.media.fire('loadedmetadata');assert.equal(f.media.currentTime,0);assert.equal(f.plays(),0);});
test('normal save object replacement retains valid pending audio restore',()=>{const f=fixture({audio:true});f.restore();f.context.canvas={id:'a'};f.context.nodes=[{id:'n',images:[{url:'/clip.mp4'}]}];f.media.readyState=1;f.media.fire('loadedmetadata');assert.equal(f.media.currentTime,12);assert.equal(f.plays(),1);});
test('transplant retains the media element and schedules one protected frame',()=>{const f=fixture({ready:1});f.media.currentTime=8;f.media.paused=false;f.transplant();assert.equal(f.frames.size,1);assert.equal(f.media.item.querySelector(),f.media);f.context.smartMediaInputController.beginOpen();const before=f.plays();f.frame();assert.equal(f.plays(),before);});
test('new restore supersedes a transplant frame and its previous state',()=>{const f=fixture({ready:1});f.media.currentTime=8;f.media.paused=false;f.transplant();const old=[...f.frames.values()][0];f.restore();old();assert.equal(f.media.currentTime,12);assert.equal(f.frames.size,1);f.frame();assert.equal(f.media.currentTime,12);});
test('pagehide cancels listeners and frames; pageshow permits new work once',()=>{const f=fixture();f.transplant();assert.equal(f.frames.size,1);f.window.fire('pagehide');assert.equal(f.frames.size,0);assert.equal(f.media.count('loadedmetadata'),0);f.restore();assert.equal(f.media.count('loadedmetadata'),0);f.window.fire('pageshow');f.window.fire('pageshow');f.restore();assert.equal(f.media.count('loadedmetadata'),1);});
test('dispose removes callbacks and cannot be remounted',()=>{const f=fixture();f.restore();const before=f.window.count('pageshow');f.run('smartMediaPlayback.dispose(); smartMediaPlayback.mount()');f.restore();assert.equal(f.media.count('loadedmetadata'),0);assert.equal(f.window.count('pageshow'),before-1);});
test('capture and batch restore retain per-player state and paused semantics',()=>{const f=fixture({ready:1,audio:true});f.media.currentTime=4;f.media.volume=.6;f.run('saved=captureMediaPlaybackStates()');assert.equal(f.context.saved.values().next().value.currentTime,4);f.media.currentTime=0;f.run('restoreMediaPlaybackStates(saved)');assert.equal(f.media.currentTime,4);assert.equal(f.plays(),0);});
test('render batch restore retains a final frame using the latest snapshot',()=>{const f=fixture({ready:1});f.media.currentTime=8;f.media.paused=false;f.run('saved=captureMediaPlaybackStates()');f.transplant();f.context.saved.values().next().value.currentTime=15;f.run('restoreMediaPlaybackStates(saved)');assert.equal(f.frames.size,1);f.media.currentTime=0;f.frame();assert.equal(f.media.currentTime,15);});
test('audio card without an image-index wrapper restores its first audio item',()=>{const f=fixture({audio:true});f.media.item=null;f.restore();f.media.readyState=1;f.media.fire('loadedmetadata');assert.equal(f.media.currentTime,12);assert.equal(f.plays(),1);});

function duplicateFixture({sameNode=false,group=false,audio=false}={}){
    const playback=require('../static/js/smart-media-playback.js'),window=target(),frames=new Map();let next=0;
    const nodes=[{id:'n',images:[{url:'/same.mp4'},...(sameNode?[{url:'/same.mp4'}]:[])]},...(sameNode?[]:[{id:'other',images:[{url:'/same.mp4'}]}]),...(group?[{id:'g',images:[]}]:[])];
    const media=[3,15].map((time,index)=>{
        const nodeId=sameNode?'n':index?'other':'n',slot=sameNode?index:0;
        const nodeEl={dataset:{id:group?'g':nodeId}},item={dataset:{imageIndex:String(slot),...(group?{refNodeId:nodeId,refImageIndex:String(slot)}:{})}};
        return Object.assign(target(),{tagName:audio?'AUDIO':'VIDEO',dataset:{url:'/same.mp4'},src:'/same.mp4',isConnected:true,readyState:1,currentTime:time,paused:true,playbackRate:index+1,volume:index?.8:.2,muted:!index,
            nodeEl,item,getAttribute(k){return this[k];},closest(s){return s==='.image-node'?this.nodeEl:this.item;}});
    });
    const controller=playback.create(()=>({window,nodes,world:{querySelectorAll:()=>media},captureCanvasContext:()=>()=>true,
        requestAnimationFrame(fn){frames.set(++next,fn);return next;},cancelAnimationFrame(id){frames.delete(id);}}));controller.mount();
    return {controller,media,frames};
}
for(const options of [{},{sameNode:true},{group:true},{sameNode:true,audio:true}]){
    test('same URL preserves separate playback instances '+JSON.stringify(options),()=>{
        const f=duplicateFixture(options),saved=f.controller.captureMediaPlaybackStates();
        assert.equal(saved.size,2);
        f.media.forEach(m=>{m.currentTime=0;m.playbackRate=1;m.volume=1;m.muted=false;});
        f.controller.restoreMediaPlaybackStates(saved);
        assert.deepEqual(f.media.map(m=>[m.currentTime,m.playbackRate,m.volume,m.muted]),[[3,1,.2,true],[15,2,.8,false]]);
    });
}
test('transplant assigns duplicate URLs to distinct matching slots',()=>{
    const f=duplicateFixture({sameNode:true});
    function itemFor(media,index){const item={dataset:{imageIndex:String(index),mediaSignature:'video:/same.mp4'},media,querySelector(){return this.media;}};media.item=item;media.replaceWith=function(next){this.item.media=next;next.item=this.item;};return item;}
    const oldItems=f.media.map(itemFor),newItems=f.media.map((m,i)=>itemFor({...m,currentTime:0},i));
    const oldNode={querySelectorAll:()=>oldItems},newNode={querySelectorAll:()=>newItems};
    f.controller.transplantSmartMediaElements(oldNode,newNode);
    assert.equal(newItems[0].media,f.media[0]);assert.equal(newItems[1].media,f.media[1]);
    assert.equal(newItems[0].media.currentTime,3);assert.equal(newItems[1].media.currentTime,15);
});
