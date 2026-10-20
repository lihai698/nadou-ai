const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createTaskContext}=require('./canvas_task_test_helpers.cjs');
class Target{
    constructor(){this.events=new Map();this.classes=new Set();this.classList={add:key=>this.classes.add(key),remove:key=>this.classes.delete(key)};}
    addEventListener(type,fn){const rows=this.events.get(type)||[];rows.push(fn);this.events.set(type,rows);}
    removeEventListener(type,fn){this.events.set(type,(this.events.get(type)||[]).filter(row=>row!==fn));}
    async emit(type,event={}){for(const fn of [...(this.events.get(type)||[])])await fn(event);}
    closest(){return null;}
    contains(){return false;}
}
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {resolve,promise};}
function fixture(){
    const board=new Target(),window=new Target(),dropOverlay=new Target(),calls={apply:0,output:0,asset:0,workflow:0,fill:[],group:0,upload:0,error:0};
    const context=createTaskContext({board,window,dropOverlay,canvas:{id:'a'},canvasOpenGeneration:1,internalDrag:false,lastImagePasteAt:0,
        nodes:[{id:'blank',type:'image',url:''}],selected:new Set(['blank']),isCanvasInputDrag:()=>false,hasImageDropData:()=>true,hasOutputImageDrag:()=>false,
        resolveImageDropPayload:async()=>({type:'url',url:'/assets/self-made.png'}),applyImageDropPayloadToBoard:async()=>calls.apply++,
        screenToWorld:(x,y)=>({x,y}),createImageCardFromOutput:()=>calls.output++,createImageCardFromUrl:()=>calls.asset++,importWorkflowAssetUrl:async()=>calls.workflow++,
        fillImageNode:async(id,files)=>calls.fill.push({id,files}),uploadImageGroup:()=>calls.group++,uploadImages:()=>calls.upload++,setStatus:()=>{},langIsEn:()=>false,showErrorModal:()=>calls.error++});
    const controller=context.CanvasMediaInputEvents.create(context.classicMediaInputHost);context.classicMediaInputController=controller;controller.mount();
    const event=(extra={})=>({target:board,relatedTarget:null,clientX:100,clientY:50,dataTransfer:{types:[],getData:()=>''},preventDefault(){},...extra});
    return {context,board,window,dropOverlay,calls,controller,event};
}
test('media drag routing keeps image-node and internal-input exclusions and copy overlay',async()=>{
    const f=fixture();const event=f.event();await f.board.emit('dragover',event);assert.equal(event.dataTransfer.dropEffect,'copy');assert.equal(f.dropOverlay.classes.has('active'),true);
    await f.board.emit('dragover',f.event({target:{closest:()=>({})}}));assert.equal(f.dropOverlay.classes.has('active'),false);
    f.context.isCanvasInputDrag=()=>true;await f.board.emit('dragover',f.event());assert.equal(f.dropOverlay.classes.has('active'),false);
});
test('output and asset drops retain their original priority ahead of media resolution',async()=>{
    const f=fixture();f.context.hasOutputImageDrag=()=>true;await f.board.emit('drop',f.event());assert.equal(f.calls.output,1);assert.equal(f.calls.apply,0);
    f.context.hasOutputImageDrag=()=>false;await f.board.emit('drop',f.event({dataTransfer:{types:['application/x-canvas-asset'],getData:()=>JSON.stringify({url:'/assets/a.png'})}}));
    assert.equal(f.calls.asset,1);assert.equal(f.calls.apply,0);
    await f.board.emit('drop',f.event({dataTransfer:{types:['application/x-canvas-asset'],getData:()=>JSON.stringify({url:'/assets/self-made.json',kind:'workflow'})}}));assert.equal(f.calls.workflow,1);
});
test('asynchronous drop resolution cannot apply to a canvas reopened while waiting',async()=>{
    const f=fixture(),gate=deferred();f.context.resolveImageDropPayload=()=>gate.promise;const pending=f.board.emit('drop',f.event());
    f.context.canvasOpenGeneration++;gate.resolve({type:'url',url:'/assets/self-made.png'});await pending;assert.equal(f.calls.apply,0);assert.equal(f.calls.error,0);
});
test('media clipboard keeps selected blank replacement, grouped upload and ordinary upload routes',async()=>{
    const f=fixture(),file={name:'self-made.wav'},item={kind:'file',type:'audio/wav',getAsFile:()=>file};let prevented=0;
    await f.window.emit('paste',{clipboardData:{items:[item]},preventDefault(){prevented++;}});assert.equal(f.calls.fill[0].id,'blank');assert.equal(f.calls.fill[0].files[0],file);
    f.context.selected.clear();await f.window.emit('paste',{clipboardData:{items:[item,item]},preventDefault(){prevented++;}});assert.equal(f.calls.group,1);
    await f.window.emit('paste',{clipboardData:{items:[item]},preventDefault(){prevented++;}});assert.equal(f.calls.upload,1);assert.equal(prevented,3);
});
test('media lifecycle releases listeners and invalidates old work across pageshow and dispose',async()=>{
    const f=fixture();f.controller.mount();const isCurrent=f.controller.capture();assert.equal(f.board.events.get('drop').length,1);
    f.context.internalDrag=true;f.dropOverlay.classList.add('active');await f.window.emit('pagehide');assert.equal(isCurrent(),false);
    assert.equal(f.context.internalDrag,false);assert.equal(f.dropOverlay.classes.has('active'),false);assert.equal(f.board.events.get('drop').length,0);
    await f.window.emit('pageshow');assert.equal(f.board.events.get('drop').length,1);assert.equal(isCurrent(),false);const restored=f.controller.capture();assert.equal(restored(),true);
    f.controller.dispose();f.controller.mount();assert.equal(restored(),false);assert.equal(f.board.events.get('drop').length,0);assert.equal(f.window.events.get('pageshow').length,0);
});
test('media picker cannot start an upload after its original canvas has been reopened',async()=>{
    const f=fixture(),input={click(){}};f.context.document={createElement:()=>input};
    f.context.CanvasUploadCoordination.pickMediaForNode(f.context.classicUploadHost(),'blank');f.context.canvasOpenGeneration++;
    input.files=[{name:'self-made.png',type:'image/png'}];await input.onchange();assert.equal(f.calls.fill.length,0);assert.equal(input.onchange,null);
});

test('discarding a late node drop clears only its captured highlight after suspension',async()=>{
    const f=fixture(),gate=deferred(),highlight=new Target();highlight.classList.add('drag-over');
    f.context.resolveImageDropPayload=()=>gate.promise;
    const pending=f.context.CanvasUploadCoordination.handleImageNodeDropEvent(f.context.classicUploadHost(),f.event(),'blank',highlight);
    f.controller.suspend();f.dropOverlay.classList.add('active');gate.resolve({type:'url',url:'/assets/self-made.png'});await pending;
    assert.equal(highlight.classes.has('drag-over'),false);assert.equal(f.dropOverlay.classes.has('active'),true);
    assert.equal(f.context.nodes[0].url,'');
});
