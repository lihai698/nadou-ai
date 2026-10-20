const test=require('node:test'),assert=require('node:assert/strict');
const classic=require('../static/js/canvas-node-edit.js'),smart=require('../static/js/smart-node-edit.js'),groups=require('../static/js/smart-group-edit.js'),links=require('../static/js/smart-connection-edit.js');
function host(){let serial=0;return {canvas:{connections:[]},nodes:[],connections:[],selected:new Set(),selectedId:'',selectedIds:[],selectedImage:{nodeId:'',index:-1},cancelNodeCooldown(){},pushUndo(){},render(){},scheduleSave(){},uid:()=>`new-${++serial}`,ensureCanvas:()=>true,defaultPoint:()=>({x:0,y:0}),window:{CanvasAudio:{detachTask:n=>{delete n.audioTaskId;}}},serializableCanvasNode:n=>structuredClone(n),clearSmartNodeTransientRunState:n=>{n.running=false;n.pending=0;delete n.pendingTasks;},isHistoryGroupNode:n=>!!n.historyFor,isSmartGroupNode:n=>n?.type==='smart-group',isSmartImageNode:n=>n?.type==='smart-image',tr:k=>k,historyGroupForNode:()=>null};}
test('classic deletion clears incident links and group membership without deleting members',()=>{
 const d=host();d.nodes=[{id:'g',type:'group',items:['a','b']},{id:'a',type:'prompt'},{id:'b',type:'prompt'}];d.connections=[{id:'c',from:'a',to:'b'}];d.selected.add('a');
 classic.deleteNode(d,'a');assert.deepEqual(d.nodes[0].items,['b']);assert.equal(d.nodes.length,2);assert.deepEqual(d.connections,[]);assert.equal(d.selected.size,0);
 classic.deleteNode(d,'g');assert.deepEqual(d.nodes.map(n=>n.id),['b']);
});
test('classic selected group deletion includes nested members, preserves outside nodes',()=>{
 const d=host();d.nodes=[{id:'g',type:'group',items:['nested']},{id:'nested',type:'group',items:['a']},{id:'a',type:'prompt'},{id:'outside',type:'prompt'}];d.selected.add('g');d.connections=[{from:'a',to:'outside'}];
 classic.deleteSelectedNodes(d);assert.deepEqual(d.nodes.map(n=>n.id),['outside']);assert.deepEqual(d.connections,[]);
});
test('both clones detach original audio acceptance and leave originals unchanged',()=>{
 const d=host();const source={id:'old',type:'audio',x:10,y:20,audioTaskId:'accepted',running:true};
 const copy=classic.cloneNode(d,source,2,3);assert.equal(copy.audioTaskId,undefined);assert.equal(copy.x,12);assert.equal(source.audioTaskId,'accepted');
 const smartSource={...source,type:'smart-image',pending:2,pendingTasks:[{taskId:'old'}]};const other=smart.cloneSmartNode(d,smartSource,2,3);assert.equal(other.audioTaskId,undefined);assert.equal(other.pending,0);assert.equal(other.pendingTasks,undefined);assert.equal(smartSource.pending,2);
});
test('smart deletion removes attached history and input references',()=>{
 const d=host();d.nodes=[{id:'a',type:'smart-image'},{id:'h',historyFor:'a'},{id:'g',type:'smart-group',items:['a','h']},{id:'b',inputNodeIds:['a','h']}];d.canvas.connections=[{from:'a',to:'b'},{from:'a',to:'h'}];d.selectedId='a';d.selectedIds=['a','h'];d.selectedImage={nodeId:'h',index:0};
 smart.deleteNode(d,'a');assert.deepEqual(d.nodes.map(n=>n.id),['g','b']);assert.deepEqual(d.nodes[0].items,[]);assert.deepEqual(d.nodes[1].inputNodeIds,[]);assert.deepEqual(d.canvas.connections,[]);assert.equal(d.selectedImage.nodeId,'');
});
test('smart connection import opens loop prompt input and deduplicates links',()=>{
 const d=host();d.nodes=[{id:'p',type:'smart-prompt'},{id:'l',type:'smart-loop',showPrompt:false,inputNodeIds:[]}];let fits=0;d.fitSmartLoopNode=()=>fits++;
 assert.equal(links.connectInputNode(d,'p','l'),true);assert.equal(d.nodes[1].showPrompt,true);assert.equal(fits,1);links.connectInputNode(d,'p','l');assert.equal(d.canvas.connections.length,1);assert.deepEqual(d.nodes[1].inputNodeIds,['p']);
 d.clearDetachedRunInputRefs=()=>{};links.disconnectConnections(d,'0,0,999');assert.deepEqual(d.canvas.connections,[]);assert.deepEqual(d.nodes[1].inputNodeIds,[]);
});
test('smart absorption reroutes links without self edges or duplicate references',()=>{
 const d=host();const group={id:'g',type:'smart-group',items:[],w:300,h:200},image={id:'i',type:'smart-image',images:[{url:'/assets/test.png'}]};d.nodes=[group,image,{id:'out',inputNodeIds:['i','g']}];d.canvas.connections=[{from:'i',to:'out'},{from:'g',to:'out'},{from:'i',to:'g'}];d.stripImageGenerationMeta=n=>n;
 assert.equal(groups.absorbImageNodeIntoSmartGroup(d,group,image),true);assert.equal(d.nodes.some(n=>n.id==='i'),false);assert.deepEqual(d.canvas.connections,[{from:'g',to:'out'}]);assert.deepEqual(d.nodes.find(n=>n.id==='out').inputNodeIds,['g']);assert.equal(group.images[0].url,'/assets/test.png');assert.equal(group.w,undefined);
});
