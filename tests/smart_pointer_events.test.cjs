const test=require('node:test'),assert=require('node:assert/strict');
const events=require('../static/js/smart-pointer-events.js');
const editorEvents=require('../static/js/smart-image-editor-events.js');
function host(){const stats={saves:0,commits:0,discards:0};const classes={add(){},remove(){}};const d={stats,zoomPreviewState:null,didPan:false,connectionEraseState:null,isRKeyDown:false,selectionState:null,smartMinimapDrag:false,portDragState:null,promptResizeState:null,previewCompareDrag:false,panoramaState:{drag:null},previewPanDrag:null,imageEditPanDrag:null,cropDrag:null,cropState:null,resizeState:null,llmInstructionResizeState:null,promptSplitResizeState:null,thumbDragState:null,panState:null,dragState:null,assetLibraryOpen:false,selectedId:'',selectedIds:[],selectedImage:{nodeId:'',index:-1},nodes:[],viewport:{x:10,y:20,scale:2},shell:{classList:classes},document:{body:{classList:classes},elementFromPoint:()=>null,getElementById:()=>null},closeCreateMenu(){},screenToWorld:e=>({x:e.clientX,y:e.clientY}),applyViewport(){},scheduleSave:()=>stats.saves++,setTimeout:fn=>fn(),nodeRect:n=>({x:n.x,y:n.y,width:100,height:80}),setDropHighlight(){},clearDropHighlight(){},moveNodeElementsDuringDrag(){},updateLoopInsertPreview(){},smartGroupTargetForDraggedNode:()=>null,pruneSmartGroupMembershipsForNode:()=>false,commitPendingUndo:()=>stats.commits++,discardPendingUndo:()=>stats.discards++,scheduleConnectionLayerRefresh(){},render(){},isSmartGroupNode:n=>n?.type==='smart-group'};d.handleImageEditorPointerMove=e=>editorEvents.pointerMove(d,e);d.handleImageEditorPointerUp=e=>editorEvents.pointerUp(d,e);return d;}
function event(patch={}){return {button:0,clientX:100,clientY:100,target:{closest:()=>null},preventDefault(){},stopPropagation(){},...patch};}
test('pan lifecycle updates viewport and clears state only on release',()=>{
 const d=host();events.pointerDown(d,event());assert.deepEqual(d.panState,{button:0,startX:100,startY:100,ox:10,oy:20});
 events.pointerMove(d,event({clientX:150,clientY:130}));assert.deepEqual(d.viewport,{x:60,y:50,scale:2});assert.equal(d.didPan,true);assert.equal(d.stats.saves,0);
 events.pointerUp(d,event());assert.equal(d.panState,null);assert.equal(d.didPan,false);assert.equal(d.stats.saves,1);
});
test('selection and erase modes take precedence over panning',()=>{
 const d=host();let selection=0,trail=0;d.updateSelectionBox=()=>selection++;d.updateConnectionEraseTrail=()=>trail++;d.eraseConnectionsAtPoint=()=>{};
 events.pointerDown(d,event({ctrlKey:true}));assert.equal(selection,1);assert.equal(d.panState,null);
 d.selectionState=null;events.pointerDown(d,event({shiftKey:true,ctrlKey:true}));assert.equal(trail,1);assert.ok(d.connectionEraseState);assert.equal(d.selectionState,null);
 d.finishConnectionErase=()=>true;d.clearConnectionEraseTrail=()=>{};events.pointerUp(d,event());assert.equal(d.connectionEraseState,null);assert.equal(d.stats.saves,1);
});
test('node drag uses canvas scale, commits changed position and releases input state',()=>{
 const d=host(),node={id:'n',type:'smart-prompt',x:10,y:20};d.nodes=[node];d.dragState={id:'n',startX:100,startY:100,ox:10,oy:20};
 events.pointerMove(d,event({clientX:140,clientY:160}));assert.deepEqual([node.x,node.y],[30,50]);assert.equal(d.stats.saves,0);
 events.pointerUp(d,event());assert.equal(d.stats.commits,1);assert.equal(d.stats.discards,0);assert.equal(d.stats.saves,1);assert.equal(d.dragState,null);assert.ok(d.suppressNodeClickUntil>Date.now());
});
test('unchanged node drag discards pending undo',()=>{
 const d=host();d.nodes=[{id:'n',type:'smart-prompt',x:10,y:20}];d.dragState={id:'n',startX:100,startY:100,ox:10,oy:20};
 events.pointerUp(d,event());assert.equal(d.stats.commits,0);assert.equal(d.stats.discards,1);assert.equal(d.dragState,null);
});
test('port release passes the captured drag before clearing visual state',()=>{
 const d=host(),drag={fromId:'a',fromPort:'out'};d.portDragState=drag;let passed;
 d.clearPortDragVisual=()=>{};d.handlePortDrop=(value,e)=>{assert.equal(d.portDragState,null);passed=value;};
 events.pointerUp(d,event());assert.equal(passed,drag);assert.equal(d.stats.saves,0);
});
test('panorama drag clamps pitch without moving canvas',()=>{
 const d=host();d.panoramaState={drag:{clientX:0,clientY:0,yaw:20,pitch:0}};events.pointerMove(d,event({clientX:100,clientY:1000}));assert.equal(d.panoramaState.yaw,2);assert.equal(d.panoramaState.pitch,85);assert.deepEqual(d.viewport,{x:10,y:20,scale:2});
 events.pointerUp(d,event());assert.equal(d.panoramaState.drag,null);
});
test('real shell and window assignments use live host state across the full pan gesture',()=>{
 const fs=require('node:fs'),vm=require('node:vm');const {createTaskContext}=require('./canvas_task_test_helpers.cjs');const source=fs.readFileSync(require.resolve('../static/js/smart-canvas.js'),'utf8');const d=host();d.window={};const ctx=createTaskContext(d);
 for(const target of ['shell.onmousedown','window.onmousemove','window.onmouseup']){const line=source.split('\n').find(line=>line.startsWith(target+' ='));assert.ok(line);vm.runInContext(line,ctx);}
 ctx.shell.onmousedown(event());ctx.window.onmousemove(event({clientX:150,clientY:130}));ctx.window.onmouseup(event());assert.deepEqual(d.viewport,{x:60,y:50,scale:2});assert.equal(d.panState,null);assert.equal(d.stats.saves,1);
});
test('resize commits only changed dimensions, then clears its gesture state',()=>{
 const d=host(),node={id:'n',type:'smart-prompt',x:0,y:0,w:316,h:240};d.nodes=[node];d.resizeState={id:'n',startX:100,startY:100,startW:316,startH:240};d.updateNodeElementDuringResize=()=>{};d.nodeRect=n=>({x:n.x,y:n.y,width:n.w,height:n.h});
 events.pointerMove(d,event({clientX:140,clientY:160}));assert.deepEqual([node.w,node.h],[336,270]);events.pointerUp(d,event());assert.equal(d.resizeState,null);assert.equal(d.stats.commits,1);assert.equal(d.stats.saves,1);
});
test('asset-panel drop hands off media and restores original node position',()=>{
 const d=host(),node={id:'n',type:'smart-image',x:50,y:60,images:[{url:'/assets/test.png',name:'fixture'}]};d.nodes=[node];d.dragState={id:'n',ox:10,oy:20};d.assetLibraryOpen=true;d.document.elementFromPoint=()=>({});d.assetPanel={contains:()=>true};d.setAssetDragOver=()=>{};const sent=[];d.addUrlToAssetLibrary=(url,name)=>sent.push({url,name});
 events.pointerUp(d,event());assert.deepEqual(sent,[{url:'/assets/test.png',name:'fixture'}]);assert.deepEqual([node.x,node.y],[10,20]);assert.equal(d.dragState,null);assert.equal(d.stats.discards,1);assert.equal(d.stats.saves,1);
});
