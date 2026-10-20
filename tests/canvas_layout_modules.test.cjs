const test=require('node:test'),assert=require('node:assert/strict');
const classic=require('../static/js/canvas-layout.js'),smart=require('../static/js/smart-layout.js'),interaction=require('../static/js/canvas-interaction.js');
const pointer=require('../static/js/canvas-pointer-events.js');
test('classic coordinates and rectangles honor viewport and measured DOM',()=>{
 const d={viewport:{x:20,y:40,scale:2},board:{getBoundingClientRect:()=>({left:10,top:15})},nodesEl:{querySelector:()=>({offsetWidth:300,offsetHeight:200})}};
 assert.deepEqual(classic.screenToWorld(d,70,95),{x:20,y:20});
 assert.deepEqual(classic.nodeRect(d,{x:10,y:20,w:999,h:999}),{x:10,y:20,w:300,h:200,cx:160,cy:120});
});
test('classic group translation moves nested and overlapping members only once',()=>{
 const child={id:'c',type:'prompt',x:10,y:20},nested={id:'n',type:'group',x:0,y:0,items:['c']},group={id:'g',type:'group',x:0,y:0,items:['n','c']};
 classic.translateCanvasNodeWithMembers({nodes:[group,nested,child]},group,5,7);
 assert.deepEqual([child.x,child.y],[15,27]);assert.deepEqual([nested.x,nested.y],[5,7]);
});
test('smart recursive group movement preserves member offsets',()=>{
 const child={id:'c',type:'smart-prompt',x:10,y:20},group={id:'g',type:'smart-group',x:0,y:0,items:['c']};
 smart.translateSmartNodeWithMembers({isSmartGroupNode:n=>n.type==='smart-group',smartGroupMembers:()=>[child]},group,5,7);
 assert.deepEqual([child.x,child.y],[15,27]);
});
test('smart media layout retains explicit dimensions, aspect and compact audio',()=>{
 const d={isAudioMediaItem:i=>i.kind==='audio'};
 assert.deepEqual(smart.mediaLayoutSize(d,{natural_w:640,natural_h:320,width:1,height:1}),{width:640,height:320});
 const fitted=smart.singleImageLayout(d,{width:640,height:320},{},1);assert.equal(fitted.width,260);assert.equal(fitted.height,130);
 const explicit=smart.singleImageLayout(d,{width:640,height:320},{w:123,h:234},1);assert.equal(explicit.width,123);assert.equal(explicit.height,234);
 const audio=smart.singleImageLayout(d,{kind:'audio'},{},1);assert.equal(audio.width,288);assert.equal(audio.height,150);
});
test('classic drag callbacks retain dependency binding and save content only on release',()=>{
 let saves=0,selectionEnds=0;const node={id:'n',type:'prompt',x:10,y:20};const d={nodes:[node],selected:new Set(),viewport:{scale:2},window:{},document:{body:{classList:{add(){},remove(){}}}},nodesEl:{querySelector:()=>null},startKnifeDrag:()=>false,dragNode:null,dragBoard:null,resizeNode:null,llmPaneDrag:null,knifeChanged:false,tempLink:null,minimapDrag:null,knifeNeedsRender:false,endTextSelection(){selectionEnds++;},workflowTransferModal:null,
 scheduleLinksRender(){},renderSelectionHub(){},scheduleMinimapRender(){},updateGroupMembership(){},setKnifeMode(){},scheduleSave:()=>saves++,scheduleViewportSave:()=>{throw Error('unexpected viewport save');}};
 const owner=pointer.create(()=>d);d.setCanvasMouseMove=owner.setMouseMove;d.setCanvasMouseUp=owner.setMouseUp;
 interaction.startNodeDrag(d,{button:0,clientX:0,clientY:0,preventDefault(){},stopPropagation(){}},node);
 d.window.onmousemove({clientX:20,clientY:30});assert.deepEqual([node.x,node.y],[20,35]);assert.equal(saves,0);
 d.window.onmouseup({shiftKey:false});assert.equal(d.dragNode,null);assert.equal(d.window.onmousemove,null);assert.equal(saves,1);assert.equal(selectionEnds,1);
});
test('classic resizing clamps clip dimensions and preserves per-node minimum rules',()=>{
 const node={id:'clip',type:'clip'},element={style:{},classList:{add(){}}};
 const d={resizeNode:{node,sx:0,sy:0,sw:760,sh:196},viewport:{scale:2},nodesEl:{querySelector:()=>element},defaultNodeSize:()=>({w:760,h:196}),scheduleLinksRender(){},renderSelectionHub(){},scheduleMinimapRender(){}};
 interaction.onNodeResize(d,{clientX:2000,clientY:2000});assert.equal(node.w,960);assert.equal(node.h,260);
 interaction.onNodeResize(d,{clientX:-2000,clientY:-2000});assert.equal(node.w,560);assert.equal(node.h,188);assert.equal(element.style.width,'560px');
});
