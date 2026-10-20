const test=require('node:test'),assert=require('node:assert/strict');
const classic=require('../static/js/canvas-viewport.js'),smart=require('../static/js/smart-viewport.js');
function host(){const classes={add(){},remove(){},toggle(){}};let saved='';return {canvas:{id:'c'},nodes:[],viewport:{x:20,y:30,scale:2},zoomPreviewState:null,world:{style:{},classList:classes},shell:{clientWidth:1000,clientHeight:600,style:{},classList:classes},board:{getBoundingClientRect:()=>({width:1000,height:600})},document:{body:{classList:classes}},window:{},minimapContent:null,minimapViewport:null,minimapRenderQueued:false,requestAnimationFrame:fn=>fn(),renderLinks(){},renderSelectionHub(){},scheduleCanvasImageResolutionSync(){},scheduleSmartImageResolutionSync(){},scheduleSave(){},closeCreateMenu(){},closeLinkCreateMenu(){},nodesEl:{querySelector:()=>null},defaultNodeSize:()=>({w:100,h:80}),CSS:{escape:s=>s},canvasSessionViewportFallback:{},CANVAS_SESSION_VIEWPORTS_KEY:'views',sessionStorage:{getItem:()=>saved,setItem:(_k,v)=>saved=v},safeScale:v=>v>0?v:1,ZOOM_PREVIEW_NODE_MAX_SCALE:2,ZOOM_PREVIEW_NODE_DEFAULT_SCALE:1,nodeRect:n=>({x:n.x,y:n.y,width:n.w,height:n.h})};}
for(const [label,api] of [['classic',classic],['smart',smart]]){
 test(`${label}: overview preserves and restores the original viewport`,()=>{
  const d=host();api.enterZoomPreview(d);assert.deepEqual(d.zoomPreviewState,{x:20,y:30,scale:2});assert.equal(d.viewport.scale,0.45);
  assert.equal(api.exitZoomPreview(d),true);assert.deepEqual(d.viewport,{x:20,y:30,scale:2});assert.equal(d.zoomPreviewState,null);assert.equal(api.exitZoomPreview(d),false);
 });
 test(`${label}: exiting overview onto a node centers it at readable scale`,()=>{
  const d=host();d.nodes=[{id:'n',x:100,y:200,w:100,h:80}];d.zoomPreviewState={x:0,y:0,scale:0.5};
  assert.equal(api.exitZoomPreviewToNode(d,'n'),true);assert.equal(d.viewport.scale,2);assert.equal(d.viewport.x,200);assert.equal(d.viewport.y,-180);
 });
}
test('classic viewport persistence remains per canvas and bounds invalid scales',()=>{
 const d=host();classic.saveLocalViewport(d);assert.deepEqual(classic.localViewportForCanvas(d,'c'),{x:20,y:30,scale:2});assert.deepEqual(classic.localViewportForCanvas(d,'missing',{x:1,y:2,scale:3}),{x:1,y:2,scale:3});
 d.sessionStorage.getItem=()=>JSON.stringify({c:{x:'bad',y:'12',scale:100}});assert.deepEqual(classic.localViewportForCanvas(d,'c',{x:5,y:6,scale:1}),{x:5,y:12,scale:8});
 d.sessionStorage.getItem=()=>{throw Error('storage unavailable');};assert.deepEqual(classic.localViewportForCanvas(d,'c'),{x:20,y:30,scale:2});
});
test('minimap pointer conversion preserves editor coordinate conventions',()=>{
 const d=host();d.minimapContent={getBoundingClientRect:()=>({left:10,top:20})};d.minimapState={bounds:{x:-100,y:-200},ox:5,oy:10,scale:0.5};
 assert.deepEqual(classic.minimapEventToWorld(d,{clientX:65,clientY:80}),{x:0,y:-100});
 d.smartMinimapState={minX:-100,minY:-200,offsetX:5,offsetY:10,scale:0.5};assert.deepEqual(smart.minimapEventToWorld(d,{clientX:65,clientY:80}),{x:0,y:-100});
});
