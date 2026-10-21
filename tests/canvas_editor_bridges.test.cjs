const {test}=require('node:test');
const assert=require('node:assert/strict');
const {create}=require('../static/js/canvas-editor-bridges.js');

function fixture(){
 const events=[],timers=new Map(),probes=[],calls=[];let serial=0;
 const h={window:{CanvasClipHost:{create:a=>({...a,getContext:a.getState}),mediaForNode:n=>n?.media||[]},CanvasVideoDeconstructionHost:{create:a=>({...a,begin(){calls.push('begin');}})},CanvasClipNode:{}},
  nodes:[],canvas:{id:'A',connections:[]},canvasId:'A',connections:[],viewport:{scale:1},selected:new Set(),selectedId:'',selectedIds:[],selectedImage:{},
  document:{addEventListener:(...a)=>events.push(['add',...a]),removeEventListener:(...a)=>events.push(['remove',...a]),createElement(){const video={duration:4,removeAttribute:n=>calls.push(['remove',n]),load:()=>calls.push('load')};probes.push(video);return video;}},
  setTimeout:(fn,ms)=>{const id=++serial;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),uid:prefix=>prefix+(++serial),pushUndo:()=>calls.push('undo'),scheduleSave:()=>calls.push('save'),saveCanvas:async()=>true,render:()=>calls.push('render'),
  setStatus:x=>calls.push(['status',x]),toast:x=>calls.push(['toast',x]),nodesEl:{querySelectorAll:()=>[]},deleteNode(){},refreshIcons(){},downloadUrl(){},loadCanvasAssetLibrary:async()=>true,canvasAssetLibraries:()=>[],localCanvasAssetLibrary:{items:[]},mediaKindForUpload:f=>f.kind,
  FormData:class{constructor(){this.rows=[];}append(...r){this.rows.push(r);}},fetch:async()=>({ok:true,json:async()=>({files:[{url:'/assets/new.mp4',name:'新视频',duration:4}]})}),
  mediaKindForOutputItem:x=>x.kind||'image',outputImageName:url=>url.split('/').pop(),refreshSelectionVisuals(){},canvasAssistantCreationSettings:()=>({provider_id:'p'}),nodeRect:n=>({x:n.x||0,y:n.y||0,w:316,width:316}),defaultNodeSize:()=>({w:316}),videoApiProviders:()=>[{id:'v',enabled:true,video_models:['vm']}],imageApiProviders:()=>[{id:'p',enabled:true,image_models:['m']}],CanvasViewport:{fitAllNodesViewport(){}},classicViewportHost:()=>h,runNodeCascade:async id=>calls.push(['run',id]),
  imageForDisplay:x=>typeof x==='string'?{url:x}:x,mediaKindForItem:x=>x?.kind,SmartViewport:{fitAllNodesViewport(){}},smartViewportHost:()=>h,smartSettingsForNode:()=>({engine:'api',apiKind:'image'}),providerVideoModels:()=>['vm'],setPromptDraftForNode:(n,text)=>n.promptDraftText=text,cloneSmartSettings:x=>({...x}),initialSmartSettings:{},escapeHtml:x=>String(x),imageProviders:()=>[{id:'p',enabled:true}],providerImageModels:()=>['m'],runGeneration:async()=>calls.push(['run',h.selectedId]),syncSelectionUi(){},
 };
 h.window.CanvasClipNode={reconcile:()=>calls.push('reconcile'),closeAll:()=>calls.push('close')};
 const api=create(h);return {h,api,events,timers,probes,calls};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('classic storyboard errors show a visible alert as well as the existing status',()=>{
 const f=fixture(),alerts=[];f.h.window.alert=text=>alerts.push(text);
 f.api.initCanvasVideoDeconstructionBridge();
 const text='镜头 1 缺少画面或生图提示词，请先填写';
 f.h.window.CanvasVideoDeconstructionBridge.onError(new Error(text));
 assert.deepEqual(alerts,[text]);assert.deepEqual(f.calls.at(-1),['status',text]);
});
test('missing host modules and repeated initialization preserve original guards',()=>{
 const api=create({window:{}});assert.equal(api.initCanvasClipBridge(),undefined);assert.equal(api.initCanvasVideoDeconstructionBridge(),undefined);assert.equal(api.initSmartVideoDeconstructionBridge(),undefined);
 const f=fixture();f.api.initCanvasClipBridge();const first=f.h.window.CanvasClipBridge;f.api.initCanvasClipBridge();assert.equal(f.h.window.CanvasClipBridge,first);assert.equal(f.events.length,1);
});
test('owned pointer listener suspends, resumes once and disposes permanently',()=>{
 const f=fixture();f.api.initCanvasClipBridge();const [_,type,handler,capture]=f.events[0];assert.equal(type,'pointerdown');assert.equal(capture,true);
 handler({target:{closest:()=>null}});assert.equal(f.calls.at(-1),'close');
 f.api.suspend();f.api.suspend();assert.equal(f.events.length,2);assert.equal(f.events[1][2],handler);
 f.api.resume();f.api.resume();assert.equal(f.events.length,3);assert.equal(f.events[2][2],handler);
 f.api.dispose();f.api.resume();f.api.initCanvasClipBridge();assert.equal(f.events.length,4);
});
test('initialization while suspended defers listener registration until resume',()=>{
 const f=fixture();f.api.suspend();f.api.initCanvasClipBridge();assert.equal(f.events.length,0);f.api.resume();assert.equal(f.events.length,1);
});
test('separate bridge owners have independent duration promises and caches',async()=>{
 const a=fixture(),b=fixture();a.api.initCanvasClipBridge();b.api.initCanvasClipBridge();
 const p=a.h.window.CanvasClipBridge.probeDuration('/a.mp4');assert.equal(p,a.h.window.CanvasClipBridge.probeDuration('/a.mp4'));const q=b.h.window.CanvasClipBridge.probeDuration('/a.mp4');assert.notEqual(p,q);
 a.probes[0].onloadedmetadata();b.probes[0].onloadedmetadata();assert.equal(await p,4);assert.equal(await q,4);assert.equal(a.timers.size,0);assert.equal(a.probes[0].onerror,null);
});
test('duration error and timeout settle once and release temporary media resources',async()=>{
 for(const mode of ['error','timeout','invalid']){
  const f=fixture();f.api.initCanvasClipBridge();const p=f.h.window.CanvasClipBridge.probeDuration('/bad.mp4'),video=f.probes[0];
  if(mode==='error')video.onerror();else if(mode==='timeout')[...f.timers.values()][0].fn();else{video.duration=Infinity;video.onloadedmetadata();}
  assert.equal(await p,undefined);assert.equal(f.timers.size,0);assert.equal(video.onloadedmetadata,null);assert.equal(video.onerror,null);assert.ok(f.calls.includes('load'));
 }
});
test('clip media list keeps current-canvas priority, identity and original defaults',()=>{
 const f=fixture(),node={id:'n',media:[{url:'/a.png',kind:'image',name:'画布'}]};
 const rows=f.api.canvasClipMediaItems([node],[{url:'/a.png',name:'资产库'},{url:'/b.mp4',kind:'video',duration:7},{url:'/c.wav',kind:'audio'}],[{renderUrl:'/d.png',thumbnail:'/thumb.png',id:'d'}]);
 assert.deepEqual(rows.map(x=>x.url),['/a.png','/b.mp4','/d.png']);assert.equal(rows[0].name,'画布');assert.equal(rows[1].durationSeconds,7);assert.equal(rows[2].sourceResultId,'d');assert.equal(rows[2].posterUrl,'/thumb.png');
});
test('asset library failure is surfaced instead of returning an incomplete media list',async()=>{
 const f=fixture();f.h.loadCanvasAssetLibrary=async()=>false;f.api.initCanvasClipBridge();await assert.rejects(f.h.window.CanvasClipBridge.listMedia(),/资产库加载失败/);
});
test('clip uploads keep kind validation, multipart request and returned media identity',async()=>{
 const f=fixture(),requests=[];f.h.fetch=async(...args)=>{requests.push(args);return {ok:true,json:async()=>({files:[{url:'/assets/new.mp4',id:'media',duration:4}]})};};f.api.initCanvasClipBridge();const b=f.h.window.CanvasClipBridge;
 await assert.rejects(b.upload({name:'audio',kind:'audio'}),/只接收图片和视频/);assert.equal(requests.length,0);
 const file={name:'视频.mp4',kind:'video'},row=await b.upload(file);assert.equal(row.sourceResultId,'media');assert.equal(row.durationSeconds,4);assert.equal(row.name,file.name);assert.equal(requests[0][0],'/api/local-assets/upload');assert.deepEqual(requests[0][1].body.rows,[['files',file,file.name]]);
});
test('clip upload preserves backend error and missing result errors',async()=>{
 const f=fixture();f.api.initCanvasClipBridge();const b=f.h.window.CanvasClipBridge;
 f.h.fetch=async()=>({ok:false,json:async()=>({detail:'fixture failure'})});await assert.rejects(b.upload({kind:'video'}),/fixture failure/);
 f.h.fetch=async()=>({ok:true,json:async()=>({files:[]})});await assert.rejects(b.upload({kind:'image'}),/上传未返回有效素材/);
});
test('classic callbacks always read current host nodes, canvas and selection',()=>{
 const f=fixture();f.api.initCanvasVideoDeconstructionBridge();const b=f.h.window.CanvasVideoDeconstructionBridge;
 const replacement={id:'B'};f.h.canvas=replacement;f.h.nodes=[{id:'new',media:[{kind:'video',url:'/new.mp4',sourceResultId:'r'}]}];assert.equal(b.getState().canvas,replacement);assert.equal(b.getState().nodes,f.h.nodes);
 assert.equal(b.sourceFor('new','/new.mp4').canvasId,'B');b.select(['new']);assert.deepEqual([...f.h.selected],['new']);f.h.nodes=[];assert.equal(b.readSource({nodeId:'new',sourceUrl:'/new.mp4',resultId:'r'}),null);
});
test('classic generation invalidation stops remaining generators after an in-flight await',async()=>{
 const f=fixture();let release;const calls=[];f.h.runNodeCascade=id=>{calls.push(id);return new Promise(r=>release=r);};f.api.initCanvasVideoDeconstructionBridge();const b=f.h.window.CanvasVideoDeconstructionBridge;
 const p=b.runGenerators(['one','two']);await tick();b.begin();release();await p;assert.deepEqual(calls,['one']);assert.equal(b.getState().generation,1);
});
test('smart bridge selects through live host setters and deduplicates landed frames',()=>{
 const f=fixture();f.api.initSmartVideoDeconstructionBridge();const b=f.h.window.CanvasVideoDeconstructionBridge;b.select(['a','b']);assert.deepEqual(f.h.selectedIds,['a','b']);assert.equal(f.h.selectedId,'');
 const ctx={sourceNode:{id:'source'},source:{title:'视频'}},result={id:'op',frames:[{url:'/f.png',index:1,seconds:2}]};f.h.window.CanvasVideoDeconstructionModel={formatTime:x=>String(x)};
 assert.equal(b.landFrames(ctx,result).length,1);assert.equal(f.h.nodes[0].type,'smart-group');assert.equal(f.h.nodes[0].frameGroupOperationId,'op');assert.equal(f.h.selectedId,f.h.nodes[0].id);assert.deepEqual(b.landFrames(ctx,result),[]);
});
test('smart source lookup checks result identity even if the media index moves',()=>{
 const f=fixture();f.h.nodes=[{id:'v',images:[{id:'r',kind:'video',url:'/v.mp4'}]}];f.api.initSmartVideoDeconstructionBridge();const b=f.h.window.CanvasVideoDeconstructionBridge,source=b.sourceFor('v',0,'/v.mp4');assert.equal(source.resultId,'r');
 f.h.nodes[0].images.unshift({id:'other',url:'/other.mp4',kind:'video'});assert.equal(b.readSource(source).resultId,'r');f.h.nodes[0].images[1].id='changed';assert.equal(b.readSource(source),null);
});
test('smart generation stops after canvas ownership changes during an await',async()=>{
 const f=fixture();f.h.nodes=[{id:'one'},{id:'two'}];const calls=[];f.h.runGeneration=async()=>{calls.push(f.h.selectedId);f.h.canvasId='B';};f.api.initSmartVideoDeconstructionBridge();await f.h.window.CanvasVideoDeconstructionBridge.runGenerators(['one','two']);assert.deepEqual(calls,['one']);
});
test('smart saveNow retains eight attempts and seven-or-eight retry waits',async()=>{
 const f=fixture();let attempts=0,waits=0;f.h.saveCanvas=async()=>++attempts===3;f.h.setTimeout=fn=>{waits++;fn();};f.api.initSmartVideoDeconstructionBridge();const b=f.h.window.CanvasVideoDeconstructionBridge;
 assert.equal(await b.saveNow(),true);assert.equal(attempts,3);assert.equal(waits,2);attempts=0;waits=0;f.h.saveCanvas=async()=>{attempts++;return false;};assert.equal(await b.saveNow(),false);assert.equal(attempts,8);assert.equal(waits,8);
});
test('disposed owner cannot create any new bridge or document listener',()=>{
 const f=fixture();f.api.dispose();f.api.initCanvasClipBridge();f.api.initCanvasVideoDeconstructionBridge();f.api.initSmartVideoDeconstructionBridge();assert.equal(f.h.window.CanvasClipBridge,undefined);assert.equal(f.h.window.CanvasVideoDeconstructionBridge,undefined);assert.deepEqual(f.events,[]);
});
