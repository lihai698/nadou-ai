const {test}=require('node:test');
const assert=require('node:assert/strict');
const selection=require('../static/js/smart-selection.js');
const events=require('../static/js/smart-pointer-events.js');

function fixture(){
    let frame=null;
    const deps={nodes:[{id:'a',x:10,y:20,w:100,h:80},{id:'b',x:300,y:200,w:120,h:90}],
        selectedIds:['a','b'],selectedId:'',selectedImage:{nodeId:'',index:-1},
        nodeRect:n=>({x:n.x,y:n.y,width:n.w,height:n.h}),savePromptDraftForCurrent(){},
        world:{querySelector:()=>frame,prepend:el=>{frame=el},ownerDocument:{createElement:()=>({style:{},setAttribute(){},remove(){frame=null}})}}};
    deps.render=()=>selection.syncSelectionGroup(deps);
    return {deps,frame:()=>frame};
}

test('multi-selection keeps a visible frame without modifying member coordinates',()=>{
    const f=fixture(),before=structuredClone(f.deps.nodes);
    selection.syncSelectionGroup(f.deps);
    assert.equal(f.frame().className,'smart-selection-group');
    assert.deepEqual(f.frame().style,{left:'-14px',top:'-4px',width:'458px',height:'318px'});
    assert.deepEqual(f.deps.nodes,before);
    const original=f.frame();
    selection.syncSelectionGroup(f.deps);
    assert.equal(f.frame(),original);
});

test('the retained frame follows group movement and resized members',()=>{
    const f=fixture();selection.syncSelectionGroup(f.deps);
    f.deps.nodes.forEach(n=>{n.x+=50;n.y+=30});selection.syncSelectionGroup(f.deps);
    assert.equal(f.frame().style.left,'36px');assert.equal(f.frame().style.top,'26px');
    f.deps.nodes[1].w+=60;selection.syncSelectionGroup(f.deps);
    assert.equal(f.frame().style.width,'518px');
});

test('marquee release retains group selection; background click removes the temporary group',()=>{
    const f=fixture(),d=f.deps;
    d.selectionState={startWorld:{x:0,y:0}};d.screenToWorld=e=>({x:e.clientX,y:e.clientY});d.selectionBox={style:{}};d.setTimeout=()=>{};
    selection.finishSelection(d,{clientX:500,clientY:400});
    assert.ok(f.frame());assert.equal(d.selectionBox.style.display,'none');
    d.selectionJustFinished=false;d.didPan=false;d.closeCreateMenu=()=>{};d.document={getElementById:()=>null};
    d.clearSelection=()=>selection.clearSelection(d);
    events.backgroundClick(d,{target:{closest:()=>null}});
    assert.equal(f.frame(),null);assert.deepEqual(d.selectedIds,[]);
});

test('removing a selected member removes a frame with fewer than two surviving nodes',()=>{
    const f=fixture();selection.syncSelectionGroup(f.deps);f.deps.nodes.pop();selection.syncSelectionGroup(f.deps);
    assert.equal(f.frame(),null);
});
