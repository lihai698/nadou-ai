const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createTaskContext}=require('./canvas_task_test_helpers.cjs');
const source=fs.readFileSync(path.join(__dirname,'../static/js/canvas.js'),'utf8');
const names=['segmentsIntersect','segmentIntersectsRect','knifeHitsConnection','applyKnifeCut','setKnifeMode','startKnifeDrag','continueKnifeDrag','isEditableTarget','startBoardPan'];
function fixture(){
    let undo=0,saves=0,ended=0;
    const classes=new Set();const context=createTaskContext({
        canvas:{id:'fixture'},nodes:[{id:'a',x:50,y:0,w:20,h:20},{id:'b',x:150,y:0,w:20,h:20}],
        connections:[{from:'a',to:'b'},{from:'c',to:'d'}],selected:new Set(['a']),viewport:{x:10,y:20,scale:1},
        knifeActive:false,knifeChanged:false,knifeNeedsRender:false,knifePoint:null,knifeTrail:[],dragBoard:null,
        window:{},document:{body:{classList:{add:key=>classes.add(key),toggle:(key,on)=>on?classes.add(key):classes.delete(key)}},activeElement:null},
        selectionHub:{innerHTML:'',classList:{remove(){}}},
        nodesEl:{querySelector:()=>({})},nodeRect:node=>node,portPoint:id=>({x:id==='c'?500:700,y:0}),
        screenToWorld:(x,y)=>({x,y}),pushUndo(){undo++;},scheduleSave(){saves++;},
        syncGeneratorInputs(){},refreshGeneratorInputViews(){},renderLinks(){},renderSelectionHub(){},closeCreateMenu(){},applyViewport(){},
        endDrag(){ended++;},cubicPoint:(a,b,t)=>context.CanvasConnectionLayer.cubicPoint({},a,b,t),
        pointSegmentDistance:(p,a,b)=>context.CanvasConnectionLayer.pointSegmentDistance({},p,a,b)});
    for(const name of names){
        const fn=source.match(new RegExp(`function ${name}\\([^\\n]*\\)\\{[\\s\\S]*?\\n\\}`));assert.ok(fn,name);vm.runInContext(fn[0],context);
    }
    return {context,undo:()=>undo,saves:()=>saves,ended:()=>ended,classes};
}
const event=overrides=>({button:0,shiftKey:true,altKey:false,clientX:1,clientY:2,target:{tagName:'DIV',closest:()=>null},preventDefault(){},stopPropagation(){},...overrides});

test('knife geometry retains crossings, collinear overlap and rectangle corner touches',()=>{
    const {context}=fixture();
    assert.equal(context.segmentsIntersect({x:0,y:0},{x:10,y:10},{x:0,y:10},{x:10,y:0}),true);
    assert.equal(context.segmentsIntersect({x:0,y:0},{x:10,y:0},{x:5,y:0},{x:20,y:0}),true);
    assert.equal(context.segmentIntersectsRect({x:0,y:0},{x:10,y:10},{x:10,y:10,w:20,h:20}),true);
    assert.equal(context.segmentIntersectsRect({x:0,y:0},{x:5,y:5},{x:10,y:10,w:20,h:20}),false);
});

test('knife replaces live connections and records one undo across a continuous cut',()=>{
    const ui=fixture(),ctx=ui.context;
    ctx.applyKnifeCut({x:40,y:10},{x:80,y:10});
    assert.equal(ctx.connections.length,1);assert.equal(ctx.connections[0].from,'c');
    ctx.applyKnifeCut({x:590,y:-20},{x:590,y:20});
    assert.equal(ctx.connections.length,0);assert.equal(ui.undo(),1);assert.equal(ui.saves(),2);
    assert.equal(ctx.knifeChanged,true);assert.equal(ctx.knifeNeedsRender,true);
});

test('knife ignores text inputs and resets transient mode when Shift is released',()=>{
    const ui=fixture(),ctx=ui.context;
    assert.equal(ctx.startKnifeDrag(event({target:{tagName:'TEXTAREA'}})),false);
    assert.equal(ctx.startKnifeDrag(event({shiftKey:false})),false);
    assert.equal(ctx.startKnifeDrag(event()),true);assert.equal(ctx.knifeActive,true);assert.equal(typeof ctx.window.onmousemove,'function');
    ctx.continueKnifeDrag(event({shiftKey:false}));assert.equal(ctx.knifeActive,false);assert.equal(ctx.knifeTrail.length,0);assert.equal(ui.classes.has('canvas-knife'),false);
});

test('board pan preserves selection while moving the actual viewport and delegates finish once',()=>{
    const ui=fixture(),ctx=ui.context;
    assert.equal(ctx.startBoardPan(event({target:{tagName:'INPUT'}})),false);
    assert.equal(ctx.startBoardPan(event({clientX:100,clientY:80}),{clearSelectionOnClick:true}),true);
    ctx.window.onmousemove(event({clientX:145,clientY:110}));
    assert.deepEqual({...ctx.viewport},{x:55,y:50,scale:1});assert.equal(ctx.dragBoard.moved,true);
    ctx.window.onmouseup(event());assert.equal(ui.ended(),1);assert.equal(ctx.selected.has('a'),true);
});
