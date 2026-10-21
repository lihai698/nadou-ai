const {test}=require('node:test'),assert=require('node:assert/strict');
const interaction=require('../static/js/canvas-interaction.js');
const layer=require('../static/js/canvas-connection-layer.js');
const smart=require('../static/js/smart-connection-edit.js');
const smartPointer=require('../static/js/smart-pointer-events.js');
function fixture(){
 const d={nodes:[{id:'p',type:'prompt'},{id:'t',type:'shot-table'}],connections:[],CANVAS_GENERATOR_TYPES:[],tempLink:null,stats:{full:0,temp:0,saves:0},
  portPoint:()=>({x:10,y:20}),screenToWorld:(x,y)=>({x:x/2,y:y/2}),canConnect:(a,b)=>a!==b,
  setCanvasMouseMove:fn=>d.move=fn,setCanvasMouseUp:fn=>d.up=fn,renderLinks:()=>d.stats.full++,renderTempLink:()=>d.stats.temp++,
  render(){},pushUndo(){},uid:()=> 'edge',syncLatestGeneratedOutputToConnection(){},syncGeneratorInputs(){},scheduleSave:()=>d.stats.saves++,
  openLinkCreateMenu(){throw Error('unexpected create menu');}};
 const node={dataset:{id:'t'},querySelector:()=>port};
 const port={closest:()=>node,getBoundingClientRect:()=>({left:100,top:100,width:8,height:8})};
 d.document={elementFromPoint:()=>({closest:s=>s==='.node'?node:null})};
 d.nodesEl={querySelectorAll:()=>[port]};
 return d;
}
const down={preventDefault(){},stopPropagation(){}};
test('classic dragging updates only the temporary path and accepts dropping on the node body',()=>{
 const d=fixture();interaction.startLink(d,down,'p','out');
 for(let i=0;i<50;i++) d.move({buttons:1,clientX:200+i,clientY:200});
 assert.deepEqual([d.tempLink.x2,d.tempLink.y2],[124.5,100]);assert.equal(d.stats.full,0);
 d.up({clientX:200,clientY:200});assert.equal(d.connections[0].to,'t');assert.equal(d.tempLink,null);assert.equal(d.move,null);
});
test('release errors and a missing mouseup never leave a dangling classic path',()=>{
 const d=fixture();interaction.startLink(d,down,'p','out');
 d.syncGeneratorInputs=()=>{throw Error('sync failure');};
 assert.throws(()=>d.up({clientX:200,clientY:200}),/sync failure/);
 assert.equal(d.tempLink,null);assert.equal(d.move,null);assert.equal(d.up,null);
 interaction.startLink(d,down,'p','out');d.move({buttons:0});
 assert.equal(d.tempLink,null);assert.equal(d.stats.saves,0);
});
test('temporary SVG path is reused and reverses endpoints when dragging from input',()=>{
 let current=null,writes=0;
 const d={tempLink:{originKind:'in',x1:10,y1:20,x2:300,y2:40},document:{createElementNS:()=>({attrs:{},setAttribute(k,v){this.attrs[k]=v;},remove(){current=null;}})},
 linksEl:{querySelector:()=>current,appendChild:p=>{current=p;writes++;}}};
 layer.renderTempLink(d);const original=current;
 d.tempLink.x2=350;layer.renderTempLink(d);assert.equal(current,original);assert.equal(writes,1);assert.match(current.attrs.d,/^M 350 40 /);
 d.tempLink=null;layer.renderTempLink(d);assert.equal(current,null);
});
test('smart table references persist as inputs, deduplicate and reject a reverse cycle',()=>{
 const d={nodes:[{id:'p',type:'smart-prompt'},{id:'t',type:'smart-shot-table'}],canvas:{connections:[]}};
 assert.equal(smart.connectInputNode(d,'p','t'),true);assert.equal(smart.connectInputNode(d,'p','t'),true);
 assert.deepEqual(d.nodes[1].inputNodeIds,['p']);assert.equal(d.canvas.connections.length,1);
 assert.equal(smart.connectInputNode(d,'t','p'),false);assert.equal(smart.connectInputNode(d,'t','t'),false);
});

test('smart lost mouseup cancels the pending connection without saving or committing',()=>{
 let cleared=0,discarded=0;
 const d={portDragState:{fromId:'s'},screenToWorld:()=>({x:0,y:0}),shell:{classList:{remove(){}}},
 clearPortDragVisual:()=>cleared++,discardPendingUndo:()=>discarded++};
 smartPointer.pointerMove(d,{buttons:0});assert.equal(d.portDragState,null);
 assert.equal(cleared,1);assert.equal(discarded,1);
 smartPointer.cancelPortDrag(d);assert.equal(discarded,1);
});
