const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createTaskContext}=require('./canvas_task_test_helpers.cjs');
class Target{
    constructor(){this.events=new Map();}
    addEventListener(type,fn){const rows=this.events.get(type)||[];rows.push(fn);this.events.set(type,rows);}
    removeEventListener(type,fn){this.events.set(type,(this.events.get(type)||[]).filter(row=>row!==fn));}
    emit(type,event={}){for(const fn of [...(this.events.get(type)||[])])fn(event);}
    getSelection(){return {toString:()=>''};}
}
function fixture(){
    const window=new Target(),timers=new Map(),calls={paste:0,copy:0,undo:0,zoom:0,end:0,knife:[]};let serial=0;
    const classes={contains:()=>false,remove:()=>{}};
    const context=createTaskContext({window,document:{activeElement:{tagName:'BODY'},getElementById:()=>({classList:classes}),body:{classList:classes}},
        canvas:{id:'a'},canvasOpenGeneration:1,nodes:[],selected:new Set(),isRKeyDown:false,lastImagePasteAt:0,Date:{now:()=>1000},
        outputLightbox:{classList:classes},promptTemplateModal:{classList:classes},assetManagerModal:{classList:classes},workflowTransferModal:{classList:classes},logModal:{classList:classes},
        selectDrag:null,dragNode:null,resizeNode:null,llmPaneDrag:null,dragBoard:null,minimapDrag:false,knifeActive:false,
        selectionBox:{style:{display:'none'}},setCanvasMouseMove:()=>{},setCanvasMouseUp:()=>{},
        isEditableTarget:target=>['INPUT','TEXTAREA'].includes(target?.tagName)||Boolean(target?.isContentEditable),
        setKnifeMode:value=>calls.knife.push(value),toggleZoomPreview:()=>calls.zoom++,clipboardNodeCount:()=>2,
        pasteNodes:()=>calls.paste++,copySelectedNodes:()=>calls.copy++,performUndo:()=>calls.undo++,endDrag:()=>calls.end++,
        groupSelectedImages:()=>{},deleteSelectedNodes:()=>{},closeImageEditor:()=>{},closePromptTemplateModal:()=>{},closeOutputLightbox:()=>{},navigateOutputLightbox:()=>false,
        setTimeout:fn=>{const id=serial++;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id)});
    const controller=context.CanvasKeyboardEvents.create(context.classicKeyboardHost);controller.mount();
    function key(value,extra={}){window.emit('keydown',{key:value,target:context.document.activeElement,preventDefault(){},stopPropagation(){},...extra});}
    function flush(){const pending=[...timers.values()];timers.clear();for(const fn of pending)fn();}
    return {context,window,timers,calls,key,flush,controller};
}
test('production keyboard keeps normal delayed node paste and native editable guards',()=>{
    const f=fixture();f.key('v',{ctrlKey:true});assert.equal(f.calls.paste,0);f.flush();assert.equal(f.calls.paste,1);
    f.context.document.activeElement={tagName:'TEXTAREA'};f.key('c',{ctrlKey:true});f.key('v',{ctrlKey:true});f.key('z',{ctrlKey:true});f.flush();
    assert.equal(f.calls.copy,0);assert.equal(f.calls.undo,0);assert.equal(f.calls.paste,1);
});
test('clipboard media arriving after Ctrl+V suppresses duplicate node paste',()=>{
    const f=fixture();f.key('v',{ctrlKey:true});f.context.lastImagePasteAt=1000;f.flush();assert.equal(f.calls.paste,0);
});
test('delayed paste cannot target a replacement canvas',()=>{
    const f=fixture();f.key('v',{ctrlKey:true});f.context.canvas={id:'b'};f.flush();assert.equal(f.calls.paste,0);
});
test('pagehide cancels scheduled paste before its callback can run',()=>{
    const f=fixture();f.key('v',{ctrlKey:true});f.window.emit('pagehide');f.flush();assert.equal(f.calls.paste,0);
});
test('blur cancels pending paste and preserves the existing selection and drag cleanup',()=>{
    const f=fixture();f.context.selectDrag={};f.context.dragNode={};f.context.isRKeyDown=true;
    f.key('v',{ctrlKey:true});f.window.emit('blur');f.flush();assert.equal(f.calls.paste,0);
    assert.equal(f.context.selectDrag,null);assert.equal(f.context.isRKeyDown,false);assert.equal(f.calls.end,1);assert.equal(f.calls.knife.at(-1),false);
});
test('keydown keeps view-adjust protection, zoom repeat guard and keyup mode reset',()=>{
    const f=fixture();f.context.window.CanvasViewAdjust={isOpen:()=>true};f.key('z');assert.equal(f.calls.zoom,0);
    f.context.window.CanvasViewAdjust.isOpen=()=>false;f.key('z',{repeat:true});assert.equal(f.calls.zoom,0);f.key('z');assert.equal(f.calls.zoom,1);
    f.key('r');assert.equal(f.context.isRKeyDown,true);f.window.emit('keyup',{key:'r'});assert.equal(f.context.isRKeyDown,false);
    f.window.emit('keyup',{key:'Shift'});assert.equal(f.calls.knife.at(-1),false);
});

test('keyboard mount and pageshow are idempotent and dispose prevents future shortcuts',()=>{
    const f=fixture();f.controller.mount();assert.equal(f.window.events.get('keydown').length,1);
    f.window.emit('pagehide');assert.equal(f.window.events.get('keydown').length,0);
    f.window.emit('pageshow',{persisted:true});f.controller.mount();assert.equal(f.window.events.get('keydown').length,1);
    f.controller.dispose();f.window.emit('pageshow');f.key('c',{ctrlKey:true});assert.equal(f.calls.copy,0);
    assert.equal(f.window.events.get('keydown').length,0);assert.equal(f.window.events.get('pageshow').length,0);
});

test('stale callbacks cannot paste after suspend and resume even if cancellation races',()=>{
    const f=fixture();f.key('v',{ctrlKey:true});const late=[...f.timers.values()][0];
    f.window.emit('pagehide');f.window.emit('pageshow');late();assert.equal(f.calls.paste,0);
    f.key('v',{ctrlKey:true});f.flush();assert.equal(f.calls.paste,1);
    f.key('v',{ctrlKey:true});const disposedLate=[...f.timers.values()][0];f.controller.dispose();disposedLate();assert.equal(f.calls.paste,1);
});

test('reopening the same canvas id or changing the active id cannot inherit a delayed paste',()=>{
    const f=fixture();f.key('v',{ctrlKey:true});f.context.canvasOpenGeneration++;f.context.canvas={id:'a'};f.flush();assert.equal(f.calls.paste,0);
    f.key('v',{ctrlKey:true});f.context.canvas.id='b';f.flush();assert.equal(f.calls.paste,0);
});

test('an ordinary autosave response replacing the canvas object keeps the pending paste valid',()=>{
    const f=fixture();f.key('v',{ctrlKey:true});f.context.canvas={id:'a',updated_at:2000};f.flush();assert.equal(f.calls.paste,1);
});
