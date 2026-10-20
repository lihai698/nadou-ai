const test=require('node:test'),assert=require('node:assert/strict');const classic=require('../static/js/canvas-editor-grid.js'),smart=require('../static/js/smart-editor-grid.js');
function splitHost(){const fields={gridHorizontalLines:{value:'1'},gridVerticalLines:{value:'1'},gridGapSize:{value:'0'},gridGapValue:{textContent:''}};return {gridCustomMode:false,gridOperationMode:'split',document:{getElementById:id=>fields[id]||null}};}
for(const [label,api] of [['classic',classic],['smart',smart]]){
 test(`${label}: odd-size grid covers every pixel without gaps`,()=>{const rects=api.gridSplitRects(splitHost(),101,51);assert.equal(rects.length,4);assert.equal(rects.reduce((n,r)=>n+r.w*r.h,0),101*51);assert.deepEqual(rects.map(r=>[r.row,r.col,r.x,r.y]),[[0,0,0,0],[0,1,51,0],[1,0,0,26],[1,1,51,26]]);});
 test(`${label}: duplicate custom cuts do not create duplicate tiles`,()=>{const d=splitHost();d.gridCustomMode=true;d.gridCustomLines=[{type:'h',pos:.5},{type:'h',pos:.5},{type:'v',pos:.5}];const rects=api.gridSplitRects(d,100,60);assert.equal(rects.length,4);assert.ok(rects.every(r=>r.w===50&&r.h===30));});
}
test('join layout keeps visual order and uses real item dimensions',()=>{const images=[{url:'a',natural_w:200,natural_h:100},{url:'b',natural_w:200,natural_h:100}];const d={gridJoinGroupId:'',currentEditImage:()=>({node:{images}}),imageForDisplay:x=>x,mediaKindForItem:()=> 'image',gridJoinImageCache:new Map(),gridJoinLayout:{items:[{index:1,x:0,y:0},{index:0,x:200,y:0}]},document:{getElementById:()=>({value:'0'})}};const layout=smart.ensureGridJoinLayout(d,1,2);assert.deepEqual(layout.items.map(x=>x.index),[1,0]);assert.deepEqual(smart.gridJoinCanvasSize(d,layout),{w:400,h:100});});
test('cover drawing crops source centrally instead of stretching',()=>{let args;const img={naturalWidth:400,naturalHeight:200};smart.drawImageCover({}, {drawImage:(...values)=>args=values},img,10,20,100,100);assert.deepEqual(args.slice(1),[100,0,200,200,10,20,100,100]);});
test('join image loading reuses successful cache and preserves Image constructor',async()=>{let created=0;class FakeImage{constructor(){created++;this.dataset={};}set src(value){this.complete=true;this.naturalWidth=200;this.naturalHeight=100;this.onload();}}const d={gridJoinImageCache:new Map(),Image:FakeImage,displayMediaUrl:x=>x.url};const entry={index:0,item:{url:'fixture.png'}};const first=await smart.loadGridJoinImage(d,entry);assert.equal(await smart.loadGridJoinImage(d,entry),first);assert.equal(created,1);});
test('obsolete join image load never populates a newly opened editor cache',async()=>{
 let image;class FakeImage{constructor(){image=this;this.dataset={};}set src(value){this.source=value;}}
 const d={gridJoinImageCache:new Map(),Image:FakeImage,displayMediaUrl:x=>x.url};const pending=smart.loadGridJoinImage(d,{index:0,item:{url:'old.png'}});
 d.gridJoinImageCache=new Map();image.onload();await pending;assert.equal(d.gridJoinImageCache.size,0);
});
test('obsolete join image error does not launch a fallback for the new editor',async()=>{
 let image,fallbacks=0;class FakeImage{constructor(){image=this;this.dataset={};}set src(value){this.source=value;}}
 const d={gridJoinImageCache:new Map(),Image:FakeImage,displayMediaUrl:x=>x.url,proxiedMediaUrl:()=>{fallbacks++;return '';}};
 const pending=smart.loadGridJoinImage(d,{index:0,item:{url:'old.png'}});d.gridJoinImageCache=new Map();image.onerror();await assert.rejects(pending,/图片加载失败/);assert.equal(fallbacks,0);
});
function previewHost(){
 const created=[],elements=new Map();let fallbacks=0;
 const el=()=>({style:{},dataset:{},appendChild(){},getAttribute(){return this.src;}});
 const images=prefix=>[0,1].map(i=>({url:prefix+i+'.png',natural_w:100,natural_h:100}));
 const d={nodes:[{id:'node',images:images('A')}],cropState:{nodeId:'node'},imageEditMode:'grid',gridOperationMode:'join',imageEditZoom:1,gridJoinOutputSize:2048,gridJoinGroupId:'',gridJoinImageCache:new Map(),gridJoinLayout:null,
  currentEditImage(){return {node:this.nodes[0]};},imageForDisplay:x=>x,mediaKindForItem:()=> 'image',displayMediaUrl:x=>x.url,proxiedMediaUrl:()=>{fallbacks++;return 'fallback.png';},
  get editSourceKey(){return JSON.stringify(this.nodes[0].images.map(x=>x.url));},captureCanvasContext:()=>()=>true,
  document:{getElementById(id){if(!elements.has(id))elements.set(id,el());return elements.get(id);},createElement(tag){const value=el();if(tag==='img')created.push(value);return value;}},
  Image:class{constructor(){this.dataset={};}set src(value){this.loadedUrl=value;this.complete=true;this.naturalWidth=100;this.naturalHeight=100;this.onload();}}};
 d.captureImageEditContext=options=>require('../static/js/image-editor-session.js').capture(d,options);
 return {d,created,fallbacks:()=>fallbacks,reopen(){d.nodes=[{id:'node',images:images('B')}];d.cropState={nodeId:'node'};d.gridJoinImageCache=new Map();d.gridJoinLayout=null;}};
}
test('obsolete grid preview cannot poison the new editor export cache or retry its source',async()=>{
 const ui=previewHost();smart.renderGridJoinPreview(ui.d);const [old,error]=ui.created;ui.reopen();smart.renderGridJoinPreview(ui.d);
 Object.assign(old,{complete:true,naturalWidth:100,naturalHeight:100});old.onload();error.onerror();
 assert.equal(ui.d.gridJoinImageCache.has(0),false);assert.equal(ui.fallbacks(),0);
 const loaded=await smart.loadGridJoinImage(ui.d,{index:0,item:ui.d.nodes[0].images[0]});assert.notEqual(loaded,old);assert.equal(loaded.loadedUrl,'B0.png');
});
test('current grid preview records dimensions on the current same-source object after autosave replacement',()=>{
 const ui=previewHost();ui.d.nodes[0].images.forEach(x=>{x.natural_w=0;x.natural_h=0;});smart.renderGridJoinPreview(ui.d);const oldSource=ui.d.nodes[0].images[0],image=ui.created[0];ui.d.nodes=JSON.parse(JSON.stringify(ui.d.nodes));
 Object.assign(image,{complete:true,naturalWidth:160,naturalHeight:90});image.onload();assert.equal(ui.d.gridJoinImageCache.get(0),image);assert.equal(ui.d.nodes[0].images[0].natural_w,160);assert.equal(oldSource.natural_w,0);
});
