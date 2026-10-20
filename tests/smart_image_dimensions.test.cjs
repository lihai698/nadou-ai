const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../static/js/smart-canvas.js'),'utf8');
const view=require('../static/js/smart-node-view.js');
function target(){
    const events=new Map();return {events,isConnected:true,dataset:{},tagName:'IMG',complete:false,naturalWidth:80,naturalHeight:40,
        addEventListener(k,fn,options){if(!events.has(k))events.set(k,[]);events.get(k).push({fn,options});},
        removeEventListener(k,fn){events.set(k,(events.get(k)||[]).filter(x=>x.fn!==fn));},
        fire(k){for(const {fn,options} of [...events.get(k)||[]]){if(options?.once)this.removeEventListener(k,fn);fn();}},
        count(k){return (events.get(k)||[]).length;}};
}
function fixture({preview=false,video=false,group=false}={}){
    const img=target(),item={dataset:{imageIndex:'0'},clientWidth:80,clientHeight:40},nodeEl={dataset:{id:group?'g':'n'}},window=target(),calls=[],probes=[];
    if(group){item.dataset.refNodeId='n';item.dataset.refImageIndex='0';}
    if(video)img.tagName='VIDEO';
    img.dataset.originalSrc='/original.png';img.closest=s=>s==='.image-node'?nodeEl:item;
    let epoch=0;
    class ImageProbe{constructor(){probes.push(this);}set src(v){this.url=v;}}
    const context=vm.createContext({SmartNodeView:view,Image:ImageProbe,window,nodes:[{id:'n',images:[{url:'/original.png'}]},...(group?[{id:'g',type:'smart-group'}]:[])],
        canvas:{id:'canvas-a'},world:{querySelectorAll:()=>[img]},displayMediaUrl:x=>x.url,smartOriginalMediaUrl:x=>x,
        smartMediaInputController:{capture(){const id=context.canvas.id,generation=epoch;return ()=>id===context.canvas.id&&generation===epoch;}},
        bindImageProxyFallback(){calls.push('proxy');},isSmartPreviewImage:()=>preview,
        applyThumbDisplaySizeToElement:(_e,image)=>calls.push(['thumb',image]),updateImageResolutionBadgeElement:(_e,image)=>calls.push(['badge',image]),
        isSmartGroupNode:n=>n.type==='smart-group',singleImageLayout:image=>({width:2*(image.natural_w||image.layout_w),height:2*(image.natural_h||image.layout_h)}),mediaNodeDefaultScale:()=>1,
        updateNodeElementDuringResize:n=>calls.push(['resize',n]),isNodeSelected:()=>true,updateComposer:()=>calls.push('composer'),scheduleSave:()=>calls.push('save')});
    if(source.includes('function smartImageDimensionsHost(')){
        context.SmartImageDimensions=require('../static/js/smart-image-dimensions.js');
        const start=source.indexOf('function smartImageDimensionsHost('),end=source.indexOf('function smartVideoPreviewHtml(',start);
        vm.runInContext(source.slice(start,end),context);vm.runInContext('smartImageDimensions.mount()',context);
    }else{
        const start=source.indexOf('function loadSmartOriginalImageDimensions(');vm.runInContext(source.slice(start,source.indexOf('\n}',start)+2),context);
        context.smartNodeViewHost=()=>context;
    }
    const start=source.indexOf('function measureSmartNodeImages(');vm.runInContext(source.slice(start,source.indexOf('\n}',start)+2),context);
    // Initial mount can bind current DOM; reset observations, not controller state.
    calls.length=0;
    return {context,img,item,nodeEl,window,calls,probes,measure(){vm.runInContext('measureSmartNodeImages()',context);},epoch(){epoch++;},run:s=>vm.runInContext(s,context),
        async completeProbe(i=0){const p=probes[i];p.naturalWidth=640;p.naturalHeight=320;p.onload?.();await Promise.resolve();await Promise.resolve();},
        image(){return context.nodes[0].images[0];}};
}
test('original metadata updates dimensions, badge, current node layout and save',()=>{
    const f=fixture();f.measure();f.img.fire('load');assert.equal(f.image().natural_w,80);assert.equal(f.context.nodes[0].w,160);assert.equal(f.calls.filter(x=>x==='save').length,1);assert.equal(f.calls.at(-1),'save');
});
test('preview dimensions stay temporary until original dimensions arrive',async()=>{
    const f=fixture({preview:true});f.measure();f.img.fire('load');assert.equal(f.image().layout_w,80);assert.equal(f.image().natural_w,undefined);await f.completeProbe();assert.equal(f.image().natural_w,640);assert.equal(f.image().layout_w,undefined);assert.equal(f.calls.filter(x=>x==='save').length,2);
});
test('video metadata remains a valid size source',()=>{
    const f=fixture({video:true});f.img.naturalWidth=0;f.img.naturalHeight=0;f.img.videoWidth=1920;f.img.videoHeight=1080;f.measure();f.img.fire('loadedmetadata');assert.equal(f.image().natural_w,1920);assert.equal(f.image().natural_h,1080);
});
test('group references resize both live member and containing group',()=>{
    const f=fixture({group:true});f.measure();f.img.fire('load');assert.deepEqual(f.calls.filter(x=>Array.isArray(x)&&x[0]==='resize').map(x=>x[1].id),['n','g']);
});
test('normal save replacement receives late original dimensions on the live image',async()=>{
    const f=fixture({preview:true});f.measure();const old=f.image();f.context.nodes=[{id:'n',images:[{url:'/original.png'}]}];f.context.canvas={id:'canvas-a'};await f.completeProbe();assert.equal(f.image().natural_w,640);assert.equal(old.natural_w,undefined);
});
test('normal save replacement receives DOM metadata on the live image',()=>{
    const f=fixture();f.measure();const old=f.image();f.context.nodes=[{id:'n',images:[{url:'/original.png'}]}];f.img.fire('load');assert.equal(f.image().natural_w,80);assert.equal(old.natural_w,undefined);
});
test('same-ID reopen invalidates old original load and does not save',async()=>{
    const f=fixture({preview:true});f.measure();f.epoch();await f.completeProbe();assert.equal(f.image().natural_w,undefined);assert.equal(f.calls.includes('save'),false);
});
test('canvas change invalidates queued DOM metadata',()=>{
    const f=fixture();f.measure();f.context.canvas={id:'canvas-b'};f.img.fire('load');assert.equal(f.image().natural_w,undefined);assert.equal(f.calls.includes('save'),false);
});
test('changed image URL cannot receive prior image dimensions',async()=>{
    const f=fixture({preview:true});f.measure();const old=f.image();f.context.nodes[0].images[0]={url:'/other.png'};await f.completeProbe();assert.equal(old.natural_w,undefined);assert.equal(f.image().natural_w,undefined);assert.equal(f.calls.includes('save'),false);
});
test('removed target cannot trigger sizing or saves',async()=>{
    const f=fixture({preview:true});f.measure();const old=f.image();f.context.nodes=[];await f.completeProbe();assert.equal(old.natural_w,undefined);assert.equal(f.calls.includes('save'),false);
});
test('detached media cannot mutate its former node',()=>{
    const f=fixture();f.measure();f.img.isConnected=false;f.img.fire('load');assert.equal(f.image().natural_w,undefined);assert.equal(f.calls.includes('save'),false);
});
test('repeated measurement binds once and releases listeners after dimensions settle',()=>{
    const f=fixture();f.measure();f.measure();assert.equal(f.img.count('load'),1);assert.equal(f.img.count('loadedmetadata'),1);f.img.fire('load');assert.equal(f.img.count('loadedmetadata'),0);
});
test('pagehide releases probe and DOM callbacks; pageshow restores exactly once',async()=>{
    const f=fixture({preview:true});f.measure();const late=f.probes[0].onload;f.window.fire('pagehide');assert.equal(f.img.count('load'),0);assert.equal(f.probes[0].onload,null);late();await Promise.resolve();assert.equal(f.calls.includes('save'),false);f.window.fire('pageshow');f.window.fire('pageshow');assert.equal(f.img.count('load'),1);assert.equal(f.probes.length,2);await f.completeProbe(1);assert.equal(f.image().natural_w,640);
});
test('dispose clears subscriptions and prevents measurement after remount',()=>{
    const f=fixture();f.measure();f.run('smartImageDimensions.dispose(); smartImageDimensions.mount(); measureSmartNodeImages()');assert.equal(f.img.count('load'),0);assert.equal(f.window.count('pageshow'),0);
});
test('known size and failed original load do not invent dimensions',async()=>{
    const f=fixture({preview:true});f.measure();f.probes[0].onerror();await Promise.resolve();assert.equal(f.image().natural_w,undefined);assert.equal(f.calls.includes('save'),false);f.img.naturalWidth=0;f.img.naturalHeight=0;f.img.fire('load');assert.equal(f.calls.includes('save'),false);
});
