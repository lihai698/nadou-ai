const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../static/js/smart-canvas.js'),'utf8');
function eventTarget(){
    const events=new Map();return {addEventListener(k,fn){if(!events.has(k))events.set(k,new Set());events.get(k).add(fn);},
        removeEventListener(k,fn){events.get(k)?.delete(fn);},fire(k){for(const fn of [...events.get(k)||[]])fn();},count(k){return events.get(k)?.size||0;}};
}
function fixture(){
    const window=eventTarget(),probes=[],timers=new Map();let epoch=0,next=0;
    const item={dataset:{imageIndex:'0'}},nodeEl={dataset:{id:'n'}};
    const img=Object.assign(eventTarget(),{isConnected:true,dataset:{previewSrc:'/preview.png',originalSrc:'/original.png'},src:'/preview.png',
        getAttribute(k){return this[k];},closest(s){return s==='.image-node'?nodeEl:item;},getBoundingClientRect:()=>({left:10,right:90,top:10,bottom:90})});
    const world={querySelectorAll:()=>[img]},canvas={id:'a'};
    class ImageProbe{constructor(){probes.push(this);}set src(v){this.url=v;}decode(){return Promise.resolve();}}
    const context=vm.createContext({SmartImageResolution:fs.existsSync(require.resolve('../static/js/smart-canvas.js').replace('smart-canvas.js','smart-image-resolution.js'))?require('../static/js/smart-image-resolution.js'):undefined,window,Image:ImageProbe,world,canvas,nodes:[{id:'n',images:[{url:'/original.png'}]}],viewport:{scale:1},
        shell:{getBoundingClientRect:()=>({left:0,right:500,top:0,bottom:500})},imageEditModal:{classList:{contains:()=>false}},selectedNodeIds:()=>['n'],
        displayMediaUrl:x=>x.url,smartOriginalMediaUrl:x=>typeof x==='object'?x.url:x,proxiedMediaUrl:x=>'/proxy?url='+encodeURIComponent(typeof x==='object'?x.url:x),
        setTimeout(fn,delay){const id=++next;timers.set(id,{fn,delay});return id;},clearTimeout(id){timers.delete(id);},
        smartMediaInputController:{capture(){const generation=epoch,id=context.canvas.id;return ()=>generation===epoch&&id===context.canvas.id;}}});
    const modern=source.includes('function smartImageResolutionHost(');
    const start=source.indexOf(modern?'function smartImageResolutionHost(':'const SMART_SELECTED_HIGH_RES_DELAY');
    vm.runInContext(source.slice(start,source.indexOf('function cloneSmartSettings(',start)),context);
    const proxy=source.indexOf('function bindImageProxyFallback(');
    vm.runInContext(source.slice(proxy,source.indexOf('\n}',proxy)+2),context);
    if(modern)vm.runInContext('smartImageResolution.mount()',context);
    return {context,img,item,nodeEl,window,probes,timers,epoch(){epoch++;},run:s=>vm.runInContext(s,context),
        sync(){vm.runInContext('syncSmartSelectedImageResolution(world)',context);},
        flush(){const tasks=[...timers.values()];timers.clear();for(const task of tasks)task.fn();},
        async load(i=0){await probes[i].onload?.();for(let n=0;n<8;n++)await Promise.resolve();}};
}
// The fixture executes the production host and delegates, without importing the application.
test('nearby image upgrades after delay and returns to preview when zoomed out',async()=>{const f=fixture();f.sync();assert.equal([...f.timers.values()][0].delay,320);f.flush();await f.load();assert.equal(f.img.src,'/original.png');f.context.viewport.scale=.5;f.sync();assert.equal(f.img.src,'/preview.png');});
test('repeated sync shares a pending original request',async()=>{const f=fixture();f.sync();f.flush();f.sync();f.flush();assert.equal(f.probes.length,1);await f.load();assert.equal(f.img.src,'/original.png');});
test('normal save replacement keeps the current target valid',async()=>{const f=fixture();f.sync();f.flush();f.context.canvas={id:'a'};f.context.nodes=[{id:'n',images:[{url:'/original.png'}]}];await f.load();assert.equal(f.img.src,'/original.png');});
for(const [name,change] of [
    ['same-ID reopen',f=>f.epoch()],['different canvas',f=>{f.context.canvas={id:'b'};}],
    ['removed node',f=>{f.context.nodes=[];}],['changed media slot',f=>{f.context.nodes[0].images[0]={url:'/new.png'};}],
    ['reused DOM source',f=>{f.img.dataset.originalSrc='/new.png';}],['detached DOM',f=>{f.img.isConnected=false;}],
])test(name+' rejects an old high-resolution completion',async()=>{const f=fixture();f.sync();f.flush();change(f);await f.load();assert.equal(f.img.src,'/preview.png');});
test('scheduled sync belongs to the captured open generation',()=>{const f=fixture();f.run('scheduleSmartImageResolutionSync(world,120)');f.epoch();f.flush();f.flush();assert.equal(f.probes.length,0);});
test('pagehide clears timers and callbacks; pageshow resumes once',async()=>{const f=fixture();f.sync();f.flush();const late=f.probes[0].onload;f.window.fire('pagehide');assert.equal(f.probes[0].onload,null);await late();assert.equal(f.img.src,'/preview.png');f.window.fire('pageshow');f.window.fire('pageshow');f.flush();assert.equal(f.probes.length,2);await f.load(1);assert.equal(f.img.src,'/original.png');});
test('proxy binding is unique and follows a replaced media source',()=>{const f=fixture();f.run('bindImageProxyFallback(world.querySelectorAll()[0],nodes[0].images[0])');f.run('bindImageProxyFallback(world.querySelectorAll()[0],nodes[0].images[0])');assert.equal(f.img.count('error'),1);f.context.nodes[0].images[0]={url:'/new.png'};f.img.dataset.originalSrc='/new.png';f.run('bindImageProxyFallback(world.querySelectorAll()[0],nodes[0].images[0])');f.img.fire('error');assert.equal(f.img.src,'/proxy?url=%2Fnew.png');});
test('proxy callback from a prior opening cannot change the image',()=>{const f=fixture();f.run('bindImageProxyFallback(world.querySelectorAll()[0],nodes[0].images[0])');f.epoch();f.img.fire('error');assert.equal(f.img.src,'/preview.png');});
test('dispose removes proxy listeners and prevents future schedules',()=>{const f=fixture();f.run('bindImageProxyFallback(world.querySelectorAll()[0],nodes[0].images[0])');f.run('smartImageResolution.dispose(); smartImageResolution.mount(); scheduleSmartImageResolutionSync()');assert.equal(f.timers.size,0);assert.equal(f.img.count('error'),0);assert.equal(f.window.count('pageshow'),0);});
test('decode completion after suspend cannot settle a newer probe for the same URL',async()=>{const f=fixture();f.sync();f.flush();let finish;f.probes[0].decode=()=>new Promise(resolve=>{finish=resolve;});const old=f.probes[0].onload();f.window.fire('pagehide');f.window.fire('pageshow');f.flush();finish();await old;assert.equal(f.img.src,'/preview.png');await f.load(1);assert.equal(f.img.src,'/original.png');});
test('failed probe can retry without leaving the preview',async()=>{const f=fixture();f.sync();f.flush();f.probes[0].onerror();await Promise.resolve();assert.equal(f.img.src,'/preview.png');f.sync();f.flush();assert.equal(f.probes.length,2);await f.load(1);assert.equal(f.img.src,'/original.png');});
test('video thumbnails and editor-open previews do not start high-res loads',()=>{const f=fixture();f.img.dataset.previewKind='video';f.sync();f.flush();assert.equal(f.probes.length,0);delete f.img.dataset.previewKind;f.context.imageEditModal.classList.contains=()=>true;f.sync();f.flush();assert.equal(f.probes.length,0);});
test('group reference resolves the live member and rejects a moved slot',async()=>{const f=fixture();f.context.nodes.push({id:'g'});f.nodeEl.dataset.id='g';f.item.dataset.refNodeId='n';f.item.dataset.refImageIndex='0';f.sync();f.flush();f.item.dataset.refImageIndex='1';await f.load();assert.equal(f.img.src,'/preview.png');f.item.dataset.refImageIndex='0';f.sync();assert.equal(f.img.src,'/original.png');});
test('stale queued timer cannot consume the current scheduled sync',()=>{const f=fixture();f.run('scheduleSmartImageResolutionSync(world,120)');const old=[...f.timers.values()].at(-1).fn;f.run('scheduleSmartImageResolutionSync(world,120)');old();f.flush();f.flush();assert.equal(f.probes.length,1);});
