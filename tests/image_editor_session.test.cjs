const test=require('node:test'),assert=require('node:assert/strict');
const {capture}=require('../static/js/image-editor-session.js');
function setup(){
    let generation=1;const d={canvas:{id:'a'},cropState:{nodeId:'node'},imageEditMode:'crop',gridOperationMode:'split',nodes:[{id:'node',url:'old.png'}],
        get editSourceKey(){return this.nodes.find(n=>n.id===this.cropState?.nodeId)?.url||'';},
        captureCanvasContext(){const id=this.canvas.id,epoch=generation;return ()=>this.canvas.id===id&&epoch===generation;}};
    return {d,invalidate(){generation++;}};
}
test('editor capture survives normal canvas/node object replacement',()=>{const {d}=setup(),current=capture(d);d.canvas={id:'a',updated_at:20};d.nodes=[{id:'node',url:'old.png'}];assert.equal(current(),true);});
test('closed or reopened same-node editor cannot accept an old result',()=>{const {d}=setup(),current=capture(d);d.cropState=null;assert.equal(current(),false);d.cropState={nodeId:'node'};assert.equal(current(),false);});
test('canvas reopen, target deletion and source replacement invalidate editor work',()=>{for(const change of [ui=>ui.invalidate(),ui=>{ui.d.nodes=[];},ui=>{ui.d.nodes[0].url='new.png';},ui=>{ui.d.canvas={id:'b'};}]){const ui=setup(),current=capture(ui.d);change(ui);assert.equal(current(),false);}});
test('operation mode changes cancel processing while image-load callbacks may follow the same session',()=>{const {d}=setup(),operation=capture(d),imageLoad=capture(d,{ignoreMode:true});d.imageEditMode='brush';assert.equal(operation(),false);assert.equal(imageLoad(),true);d.cropState={nodeId:'node'};assert.equal(imageLoad(),false);});
