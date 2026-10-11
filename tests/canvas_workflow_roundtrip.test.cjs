const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
function section(file,start,end){
    const source=readFileSync(path.join(__dirname,'../static/js',file),'utf8');
    const from=source.indexOf(start),to=source.indexOf(end,from);
    assert.ok(from>=0&&to>from);return source.slice(from,to);
}
function editor(smart){
    let serial=0;
    const context=vm.createContext({canvas:{id:'isolated',connections:[]},nodes:[],connections:[],selected:new Set(),
        selectedIds:[],selectedId:'',selectedImage:{},activeComposerSubject:null,lastMouseBoard:{x:100,y:100},lastMouseWorld:{x:100,y:100},
        document:{activeElement:null},window:{},uid:prefix=>`${prefix}-${++serial}`,pushUndo(){},render(){},scheduleSave(){},toast(){},setStatus(){},
        defaultPoint:()=>({x:0,y:0}),viewportCenter:()=>({x:0,y:0}),serializableCanvasNode:n=>({...n}),serializableSmartNode:n=>structuredClone(n),
        normalizeLegacySmartNode:n=>n,remapCanvasDepthCopies(){},remapSmartDepthCopies(){},remapSmartViewAdjustRefs(){},
        sanitizeConnections(){},syncGeneratorInputs(){},isEditableTarget:()=>false,selectedNodeIds:()=>context.selectedIds,
        clearSmartNodeTransientRunState:n=>{delete n.pendingTasks;delete n.inputNodeIds;n.pending=0;n.running=false;},
        mediaItemForStorage:n=>n,stripImageGenerationMeta:n=>n,settingsForStorage:n=>n});
    vm.runInContext(readFileSync(path.join(__dirname,'../static/js/canvas-audio.js'),'utf8'),context);
    if(smart){
        vm.runInContext(section('smart-canvas.js','function serializableSmartNode(','function selectedSmartWorkflowPayload('),context);
        vm.runInContext(section('smart-canvas.js','function cloneSmartNode(','// 跨页"素材库'),context);
        vm.runInContext(section('smart-canvas.js','function insertSmartWorkflowIntoCanvas(','async function importSmartWorkflowFile('),context);
    }else{
        const source=readFileSync(path.join(__dirname,'../static/js/canvas.js'),'utf8');
        vm.runInContext(source.match(/^const CANVAS_(?:GENERATOR|MEDIA_OUTPUT)_TYPES =.*$/gm).join('\n'),context);
        vm.runInContext(section('canvas.js','function wouldCreateGeneratorCycle(','function endDrag('),context);
        vm.runInContext(section('canvas.js','function insertWorkflowIntoCanvas(','async function importWorkflowFile('),context);
    }
    return context;
}
test('classic imported group keeps the imported children and internal links without borrowing existing IDs',()=>{
    const e=editor(false);e.nodes.push({id:'external',type:'image'});
    e.imported={nodes:[{id:'group',type:'group',x:0,y:0,items:['audio','prompt','missing']},
        {id:'audio',type:'audio',x:20,y:20,url:'/assets/tone.mp3'}, {id:'prompt',type:'prompt',x:20,y:80,text:'中文'},
        {id:'generator',type:'generator',x:400,y:80}],
        connections:[{id:'link',from:'audio',to:'generator'},{id:'invalid',from:'audio',to:'prompt'}]};
    vm.runInContext('insertWorkflowIntoCanvas(imported)',e);
    const group=e.nodes.find(n=>n.type==='group'),audio=e.nodes.find(n=>n.type==='audio'),prompt=e.nodes.find(n=>n.type==='prompt');
    assert.deepEqual(Array.from(group.items),[audio.id,prompt.id]);
    assert.equal(e.connections.length,1);assert.equal(e.connections[0].from,audio.id);
    assert.equal(e.connections[0].to,e.nodes.find(n=>n.type==='generator').id);
    assert.equal(audio.url,'/assets/tone.mp3');assert.equal(prompt.text,'中文');
    assert.deepEqual(e.imported.nodes[0].items,['audio','prompt','missing']);
});
test('smart workflow import remaps group members and detaches the original audio task',()=>{
    const e=editor(true);
    e.imported={nodes:[{id:'group',type:'smart-group',x:0,y:0,items:['prompt','missing']},
        {id:'prompt',type:'smart-prompt',x:20,y:10,text:'中文分组成员'},
        {id:'audio',type:'smart-image',x:20,y:30,images:[{url:'/assets/tone.ogg',kind:'audio'}],audioTaskId:'original',audioStatus:'unknown',audioRunSnapshot:{prompt:'original'},pending:1,running:true}],
        connections:[{from:'audio',to:'group'}]};
    vm.runInContext('insertSmartWorkflowIntoCanvas(imported)',e);
    const group=e.nodes.find(n=>n.type==='smart-group'),audio=e.nodes.find(n=>n.type==='smart-image'),prompt=e.nodes.find(n=>n.type==='smart-prompt');
    assert.deepEqual(Array.from(group.items),[prompt.id]);
    assert.equal(e.canvas.connections[0].from,audio.id);assert.equal(e.canvas.connections[0].to,group.id);
    assert.equal(audio.audioTaskId,undefined);assert.equal(audio.audioStatus,undefined);assert.equal(audio.pending,0);assert.equal(audio.running,false);
    assert.equal(audio.images[0].url,'/assets/tone.ogg');assert.equal(e.imported.nodes[2].audioTaskId,'original');
});
test('smart copy and paste makes the copied group own the copied children',()=>{
    const e=editor(true);
    e.nodes.push({id:'group',type:'smart-group',x:0,y:0,items:['prompt']},{id:'prompt',type:'smart-prompt',x:20,y:10,text:'中文分组成员'},{id:'audio',type:'smart-image',x:20,y:30,images:[{url:'/assets/tone.flac',kind:'audio'}],audioTaskId:'original',audioStatus:'unknown'});
    e.canvas.connections=[{from:'audio',to:'group'}];e.selectedIds=['group','prompt','audio'];
    vm.runInContext('copySelectedNodes(); pasteNodes()',e);
    const group=e.nodes[3],prompt=e.nodes[4],audio=e.nodes[5];
    assert.deepEqual(Array.from(group.items),[prompt.id]);
    assert.equal(e.canvas.connections[1].from,audio.id);assert.equal(e.canvas.connections[1].to,group.id);
    assert.equal(audio.audioTaskId,undefined);assert.equal(e.nodes[2].audioTaskId,'original');
    assert.deepEqual(e.nodes[0].items,['prompt']);
});
