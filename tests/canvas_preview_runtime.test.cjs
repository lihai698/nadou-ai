const {test}=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../static/js/canvas-preview-runtime.js');

function fixture(){
    const probes=[],timers=new Map(),writes=[],listeners=new Map();let clock=0,editorOpen=false;
    const image={tagName:'IMG',dataset:{previewSrc:'/preview.png',originalSrc:'/original.png'},isConnected:true,parentElement:{},complete:false,naturalWidth:0,
        src:'/preview.png',getAttribute(name){return name==='src'?this.src:null;},
        addEventListener(type,fn){assert.ok(!listeners.has(type));listeners.set(type,fn);},
        getBoundingClientRect(){return {left:40,top:40,right:140,bottom:140};},
        replaceWith(value){writes.push(['replace',value]);},
    };
    const root={querySelectorAll(selector){return selector.includes(':not')&&image.dataset.previewFallbackBound?[]:[image];}};
    const deps={viewport:{scale:1},board:{getBoundingClientRect(){return {left:0,top:0,right:1000,bottom:1000};}},nodesEl:root,
        document:{getElementById(){return {classList:{contains(){return editorOpen;}}};},createElement(tag){assert.equal(tag,'template');return {content:{firstElementChild:{type:'video',play:()=>Promise.resolve(),parentElement:{querySelector:()=>null}}},set innerHTML(value){writes.push(['html',value]);}};}},
        Image:class{constructor(){probes.push(this);}decode(){return Promise.resolve();}},
        setTimeout(fn,delay){const id=++clock;timers.set(id,{fn,delay});return id;},clearTimeout(id){timers.delete(id);},
        canvasDisplayMediaUrl:url=>'/display'+url,canvasOriginalMediaUrl:url=>url,
        canvasVideoFallbackHtml:(url,attrs)=>`fallback:${url}:${attrs}`,canvasVideoPlayerHtml:(url,attrs)=>`player:${url}:${attrs}`,
    };
    const runtime=create(deps);for(const[name,fn]of Object.entries(runtime))deps[name]=(...args)=>fn(...args);
    function next(){const entry=timers.entries().next().value;if(!entry)return;timers.delete(entry[0]);return entry[1].fn();}
    return {runtime,deps,probes,timers,writes,listeners,image,root,next,editor(value){editorOpen=value;},async load(i=0){await probes[i].onload();}};
}

test('dimension probes skip empty, data and blob URLs',async()=>{
    const f=fixture();for(const value of ['',null,'data:image/png;base64,eA==','blob:fixture'])assert.equal(await f.runtime.loadCanvasOriginalImageDimensions(value),null);assert.equal(f.probes.length,0);
});
test('dimension probes report natural dimensions and preserve failure results',async()=>{
    const f=fixture(),first=f.runtime.loadCanvasOriginalImageDimensions('/a.png');f.probes[0].naturalWidth=64;f.probes[0].naturalHeight=32;f.probes[0].onload();assert.deepEqual(await first,{w:64,h:32});
    const second=f.runtime.loadCanvasOriginalImageDimensions('/b.png');f.probes[1].onerror();assert.equal(await second,null);
});
test('preloading reuses one pending probe and retains successful cache entries',async()=>{
    const f=fixture(),a=f.runtime.preloadCanvasSelectedHighRes('/a.png'),b=f.runtime.preloadCanvasSelectedHighRes('/a.png');assert.equal(a,b);assert.equal(f.probes.length,1);await f.load();assert.equal(await a,true);assert.equal(await f.runtime.preloadCanvasSelectedHighRes('/a.png'),true);assert.equal(f.probes.length,1);
});
test('failed preloads leave the cache retryable',async()=>{
    const f=fixture(),a=f.runtime.preloadCanvasSelectedHighRes('/a.png');f.probes[0].onerror();assert.equal(await a,false);const b=f.runtime.preloadCanvasSelectedHighRes('/a.png');assert.equal(f.probes.length,2);await f.load(1);assert.equal(await b,true);
});
test('decode failure preserves the original successful-load result',async()=>{
    const f=fixture(),a=f.runtime.preloadCanvasSelectedHighRes('/a.png');f.probes[0].decode=()=>Promise.reject(Error('decode'));await f.load();assert.equal(await a,true);
});
test('controllers have independent caches and keep implementation state private',async()=>{
    const a=fixture(),b=fixture(),pending=a.runtime.preloadCanvasSelectedHighRes('/a.png');await a.load();await pending;const other=b.runtime.preloadCanvasSelectedHighRes('/a.png');assert.equal(b.probes.length,1);await b.load();await other;
    for(const key of ['canvasSelectedHighResLoaded','canvasSelectedHighResLoading','canvasSelectedHighResTimer'])assert.ok(!(key in a.runtime));
});
test('high resolution is delayed until a visible image probe finishes',async()=>{
    const f=fixture();f.runtime.syncCanvasSelectedImageResolution();assert.equal([...f.timers.values()][0].delay,320);const pending=f.next();assert.equal(f.image.src,'/preview.png');assert.equal(f.probes[0].src,'/display/original.png');await f.load();await pending;assert.equal(f.image.src,'/display/original.png');
});
test('zooming out restores previews and avoids image probes',()=>{
    const f=fixture();f.deps.viewport.scale=0.5;f.image.src='/display/original.png';f.runtime.syncCanvasSelectedImageResolution();assert.equal(f.image.src,'/preview.png');assert.equal(f.timers.size,0);assert.equal(f.probes.length,0);
});
test('offscreen and detached images do not promote to high resolution',()=>{
    const f=fixture();f.image.getBoundingClientRect=()=>({left:1500,top:1500,right:1600,bottom:1600});f.runtime.syncCanvasSelectedImageResolution();assert.equal(f.timers.size,0);f.image.isConnected=false;assert.equal(f.runtime.canvasImageNearViewport(f.image),false);
});
test('an open image editor prevents high-resolution scheduling',()=>{
    const f=fixture();f.editor(true);f.runtime.syncCanvasSelectedImageResolution();assert.equal(f.timers.size,0);assert.equal(f.probes.length,0);
});
test('opening the editor while a probe loads blocks its DOM write',async()=>{
    const f=fixture();f.runtime.syncCanvasSelectedImageResolution();const pending=f.next();f.editor(true);await f.load();await pending;assert.equal(f.image.src,'/preview.png');
});
test('detaching an image while loading blocks its DOM write',async()=>{
    const f=fixture();f.runtime.syncCanvasSelectedImageResolution();const pending=f.next();f.image.isConnected=false;await f.load();await pending;assert.equal(f.image.src,'/preview.png');
});
test('a later sync invalidates the earlier high-resolution completion',async()=>{
    const f=fixture();f.runtime.syncCanvasSelectedImageResolution();const pending=f.next();f.deps.viewport.scale=0.5;f.runtime.syncCanvasSelectedImageResolution();await f.load();await pending;assert.equal(f.image.src,'/preview.png');
});
test('scheduled sync coalesces timers and bounds negative delays',()=>{
    const f=fixture();f.runtime.scheduleCanvasImageResolutionSync(f.root,500);f.runtime.scheduleCanvasImageResolutionSync(f.root,-5);assert.equal(f.timers.size,1);assert.equal([...f.timers.values()][0].delay,0);f.next();assert.equal([...f.timers.values()][0].delay,320);
});
test('suspend cancels both timer classes and invalidates pending DOM writes',async()=>{
    const f=fixture();f.runtime.syncCanvasSelectedImageResolution();const pending=f.next();f.runtime.scheduleCanvasImageResolutionSync();f.runtime.suspend();assert.equal(f.timers.size,0);await f.load();await pending;assert.equal(f.image.src,'/preview.png');
    f.runtime.scheduleCanvasImageResolutionSync();f.next();assert.equal(f.image.src,'/display/original.png');
});
test('preview error binding is unique and reads the current original source',()=>{
    const f=fixture();f.runtime.bindCanvasPreviewImageFallbacks(f.root);f.runtime.bindCanvasPreviewImageFallbacks(f.root);assert.equal(f.listeners.size,1);f.image.dataset.originalSrc='/new.png';f.listeners.get('error')();assert.equal(f.image.src,'/new.png');
});
test('already failed previews immediately fall back and detached images remain untouched',()=>{
    const f=fixture();f.image.complete=true;f.runtime.bindCanvasPreviewImageFallbacks(f.root);assert.equal(f.image.src,'/original.png');f.image.parentElement=null;f.image.src='/preview.png';f.listeners.get('error')();assert.equal(f.image.src,'/preview.png');
});
test('failed video posters become fallback players',()=>{
    const f=fixture();f.image.dataset.previewKind='video';f.image.dataset.videoFallbackAttrs='controls';f.runtime.bindCanvasPreviewImageFallbacks(f.root);f.listeners.get('error')();assert.equal(f.writes[0][1],'fallback:/original.png:controls');assert.equal(f.writes[1][0],'replace');
});
test('video activation uses original media and player markup',()=>{
    const f=fixture();f.image.matches=()=>true;f.image.dataset.videoPlayerAttrs='autoplay';assert.equal(f.runtime.canvasActivateVideoPreview(f.image),true);assert.equal(f.writes[0][1],'player:/original.png:autoplay');assert.equal(f.writes[1][0],'replace');
});
test('existing fallback videos are activated with controls and sound',async()=>{
    const f=fixture(),video={matches:selector=>selector==='video[data-url]',play:()=>Promise.reject(Error('blocked'))};assert.equal(f.runtime.canvasActivateVideoPreview(video),true);assert.equal(video.controls,true);assert.equal(video.muted,false);assert.equal(f.runtime.canvasActivateVideoPreview(null),false);await Promise.resolve();
});
