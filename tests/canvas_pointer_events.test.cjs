const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createTaskContext}=require('./canvas_task_test_helpers.cjs');
class Target{
    constructor(){this.events=new Map();this.style={};this.innerHTML='';this.classes=new Set();this.classList={add:(...keys)=>keys.forEach(key=>this.classes.add(key)),remove:(...keys)=>keys.forEach(key=>this.classes.delete(key)),toggle:(key,on)=>on?this.classes.add(key):this.classes.delete(key)};}
    addEventListener(type,fn,options){const rows=this.events.get(type)||[];rows.push({fn,options});this.events.set(type,rows);}
    removeEventListener(type,fn,options){this.events.set(type,(this.events.get(type)||[]).filter(row=>row.fn!==fn||row.options!==options));}
    async emit(type,event={}){for(const {fn} of [...(this.events.get(type)||[])])await fn(event);}
    closest(){return null;}
    querySelectorAll(){return [];}
    getBoundingClientRect(){return {left:0,top:0};}
}
function fixture(){
    const calls={pan:0,selection:0,viewport:0,localViewport:0,finish:0,backup:0,centers:[],links:0};
    const board=new Target(),window=new Target(),document={activeElement:null,body:new Target()};
    const context=createTaskContext({board,window,document,world:new Target(),nodesEl:new Target(),linksEl:new Target(),minimap:new Target(),canvasArrangeBtn:new Target(),
        canvas:{id:'pointer'},nodes:[],connections:[],selected:new Set(),viewport:{x:0,y:0,scale:1},lastMouseBoard:null,
        isRKeyDown:false,zoomPreviewState:null,minimapDrag:false,dragNode:null,dragBoard:null,resizeNode:null,llmPaneDrag:null,tempLink:null,selectDrag:null,
        knifeActive:false,knifeChanged:false,knifeNeedsRender:false,knifePoint:null,knifeTrail:[],selectionBox:new Target(),selectionHub:new Target(),localCanvasDirty:false,
        startBoardPan(){calls.pan++;},startSelection(){calls.selection++;},startKnifeDrag:()=>false,
        isEditableTarget:target=>target?.tagName==='INPUT',isZoomPreviewIgnoredTarget:()=>false,
        closeCreateMenu(){},updateConnectionHoverFromMouse(){},continueKnifeDrag(){},setKnifeMode(){},setHoveredConnection(){},
        screenToWorld:(x,y)=>({x:(x-context.viewport.x)/context.viewport.scale,y:(y-context.viewport.y)/context.viewport.scale}),
        applyViewport(){calls.viewport++;},renderLinks(){calls.links++;},renderSelectionHub(){},scheduleViewportSave(){calls.localViewport++;},
        saveLocalViewport(){calls.localViewport++;},endDrag(){calls.finish++;},backupClassicDraft(){calls.backup++;},
        centerViewportOnWorldPoint:point=>calls.centers.push(point),minimapEventToWorld:e=>({x:e.clientX,y:e.clientY}),arrangeSelectedCanvasNodes(){},
        exitZoomPreviewToNode(){},exitZoomPreview(){}});
    return {context,calls,board,window,document};
}
function install(context){
    const controller=context.CanvasPointerEvents.create(()=>context.classicPointerHost());context.classicPointerController=controller;controller.mount();return controller;
}
function event(context,extra={}){return {button:0,clientX:100,clientY:50,deltaY:-1,target:context.board,preventDefault(){},stopPropagation(){},...extra};}

test('real board dispatcher keeps pan, selection modifiers and non-left-button guards',()=>{
    const {context,calls}=fixture();install(context);
    context.board.onmousedown(event(context,{button:1}));assert.equal(calls.pan,1);
    context.isRKeyDown=true;context.board.onmousedown(event(context));assert.equal(calls.selection,1);
    context.isRKeyDown=false;context.board.onmousedown(event(context,{ctrlKey:true}));assert.equal(calls.selection,2);
    context.board.onmousedown(event(context,{button:2}));assert.equal(calls.pan,1);
});

test('wheel zoom remains anchored to the pointer and requests a viewport save',()=>{
    const {context,calls}=fixture();install(context);context.board.onwheel(event(context));
    assert.equal(context.viewport.scale,1.08);assert.ok(Math.abs(context.viewport.x+8)<1e-9);assert.ok(Math.abs(context.viewport.y+4)<1e-9);
    assert.equal(calls.viewport,1);assert.equal(calls.localViewport,1);
});

test('zoom-preview guards retain capture listeners and ignore controls',()=>{
    const {context,board}=fixture();install(context);context.zoomPreviewState={};let stopped=0;
    const down=board.events.get('mousedown').find(row=>row.options===true);const click=board.events.get('click').find(row=>row.options===true);
    assert.ok(down&&click);down.fn(event(context,{preventDefault(){stopped++;}}));assert.equal(stopped,1);
    context.isZoomPreviewIgnoredTarget=()=>true;down.fn(event(context,{preventDefault(){stopped++;}}));assert.equal(stopped,1);
});

test('minimap drag installs temporary move handling and clears it on release',async()=>{
    const {context,calls}=fixture();install(context);await context.minimap.emit('mousedown',event(context));
    assert.equal(context.minimapDrag,true);context.window.onmousemove(event(context,{clientX:200}));
    assert.equal(calls.centers.length,2);context.window.onmouseup();
    assert.equal(context.minimapDrag,false);assert.equal(context.window.onmousemove,null);assert.equal(context.window.onmouseup,null);assert.equal(calls.localViewport,1);
});

test('pointer listeners mount once and restore prior board properties on suspension',async()=>{
    const {context,board,window}=fixture();const previous=()=>{};board.onwheel=previous;
    const controller=install(context);controller.mount();assert.equal(board.events.get('mousemove').length,1);assert.notEqual(board.onwheel,previous);
    await window.emit('pagehide');assert.equal(board.events.get('mousemove').length,0);assert.equal(board.onwheel,previous);
    await window.emit('pageshow',{persisted:true});controller.mount();assert.equal(board.events.get('mousemove').length,1);
    const replacement=()=>{};board.onwheel=replacement;controller.dispose();assert.equal(board.onwheel,replacement);assert.equal(window.events.get('pageshow').length,0);
});

test('inactive pointer suspension preserves mouse properties owned by another editor',async()=>{
    const {context,window}=fixture();const move=()=>{},up=()=>{};window.onmousemove=move;window.onmouseup=up;
    install(context);await window.emit('pagehide');assert.equal(window.onmousemove,move);assert.equal(window.onmouseup,up);
});

test('pagehide cancels uncommitted links and selection without completing or saving them',async()=>{
    const {context,calls,window}=fixture();context.tempLink={from:'a'};context.selectDrag={sx:0,sy:0};context.knifeActive=true;context.isRKeyDown=true;
    context.selectionBox.style.display='block';const controller=install(context);controller.setMouseMove(()=>{});controller.setMouseUp(()=>{});
    await window.emit('pagehide');
    assert.equal(context.tempLink,null);assert.equal(context.selectDrag,null);assert.equal(context.knifeActive,false);assert.equal(context.isRKeyDown,false);
    assert.equal(context.selectionBox.style.display,'none');assert.equal(window.onmousemove,null);assert.equal(window.onmouseup,null);
    assert.equal(calls.finish,0);assert.equal(calls.backup,0);assert.equal(context.connections.length,0);
});

test('pagehide finalizes viewport drag and persists its existing position synchronously',async()=>{
    const {context,calls,window}=fixture();context.dragBoard={sx:0,sy:0};context.viewport={x:140,y:90,scale:2};
    const controller=install(context);controller.setMouseMove(()=>{});controller.setMouseUp(()=>{});await window.emit('pagehide');
    assert.equal(calls.finish,1);assert.equal(calls.localViewport,1);assert.equal(context.dragBoard,null);assert.equal(window.onmousemove,null);
    assert.deepEqual({...context.viewport},{x:140,y:90,scale:2});
});

test('failed drag finalization still preserves a draft and releases the owned handlers',async()=>{
    const {context,calls,window,board}=fixture();const node={id:'a',x:10,y:20};context.nodes=[node];context.dragNode={node};
    context.endDrag=()=>{throw Error('synthetic finish failure');};const controller=install(context);controller.setMouseMove(()=>{});
    await assert.rejects(window.emit('pagehide'),/synthetic finish failure/);
    assert.equal(calls.backup,1);assert.equal(context.localCanvasDirty,true);assert.equal(context.dragNode,null);assert.equal(window.onmousemove,null);
    assert.equal(board.events.get('mousemove').length,0);assert.deepEqual(node,{id:'a',x:10,y:20});
});

test('leaving after Shift release still clears mouse handlers started by the real knife entry',async()=>{
    const {context,window,board}=fixture();install(context);
    context.startKnifeDrag=e=>context.CanvasInteraction.startKnifeDrag(context.classicLayoutHost(),e);
    board.onmousedown(event(context,{shiftKey:true,altKey:false}));assert.equal(typeof window.onmousemove,'function');
    context.CanvasInteraction.setKnifeMode(context.classicLayoutHost(),false);assert.equal(context.knifeActive,false);
    await window.emit('pagehide');assert.equal(window.onmousemove,null);assert.equal(window.onmouseup,null);
});

test('a replacement mouse owner survives cleanup and disposed controllers cannot reclaim it',()=>{
    const {context,window}=fixture();const controller=install(context);controller.setMouseMove(()=>{});
    const replacement=()=>{};window.onmousemove=replacement;controller.dispose();
    assert.equal(window.onmousemove,replacement);controller.setMouseMove(()=>{});assert.equal(window.onmousemove,replacement);
});

test('window blur releases owned mouse callbacks while board listeners and replacement owners remain',async()=>{
    const {context,window,board}=fixture();const controller=install(context);
    controller.setMouseMove(()=>{});controller.setMouseUp(()=>{});await window.emit('blur');
    assert.equal(window.onmousemove,null);assert.equal(window.onmouseup,null);assert.equal(board.events.get('mousemove').length,1);
    controller.setMouseMove(()=>{});const replacement=()=>{};window.onmousemove=replacement;
    await window.emit('blur');assert.equal(window.onmousemove,replacement);assert.equal(board.events.get('mousemove').length,1);
});
