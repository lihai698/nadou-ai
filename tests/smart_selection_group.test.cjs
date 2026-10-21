const {test}=require('node:test');
const assert=require('node:assert/strict');
const selection=require('../static/js/smart-selection.js');
const events=require('../static/js/smart-pointer-events.js');
function fixture(){
 let renders=0;
 const deps={nodes:[{id:'a',x:10,y:20,w:100,h:80},{id:'b',x:300,y:200,w:120,h:90}],selectedIds:['a','b'],selectedId:'',selectedImage:{nodeId:'',index:-1},nodeRect:n=>({x:n.x,y:n.y,width:n.w,height:n.h}),savePromptDraftForCurrent(){},renderWorkgroups(){renders++;}};
 deps.render=()=>selection.syncSelectionGroup(deps);
 return {deps,renders:()=>renders};
}
test('selection delegates its retained controls to the shared workgroup renderer without moving members',()=>{
 const f=fixture(),before=structuredClone(f.deps.nodes);selection.syncSelectionGroup(f.deps);assert.equal(f.renders(),1);assert.deepEqual(f.deps.nodes,before);
});
test('Ctrl marquee preserves IDs and background click only clears temporary selection',()=>{
 const f=fixture(),d=f.deps;d.selectionState={startWorld:{x:0,y:0}};d.screenToWorld=e=>({x:e.clientX,y:e.clientY});d.selectionBox={style:{}};d.setTimeout=()=>{};
 selection.finishSelection(d,{clientX:500,clientY:400});assert.deepEqual(d.selectedIds,['a','b']);assert.equal(d.selectionBox.style.display,'none');assert.equal(f.renders(),1);
 d.selectionJustFinished=false;d.didPan=false;d.closeCreateMenu=()=>{};d.document={getElementById:()=>null};d.clearSelection=()=>selection.clearSelection(d);events.backgroundClick(d,{target:{closest:()=>null}});assert.deepEqual(d.selectedIds,[]);assert.equal(f.renders(),3);assert.equal(d.nodes.length,2);
});
