const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createTaskContext}=require('./canvas_task_test_helpers.cjs');

function load(context,file,names){
    const source=fs.readFileSync(path.join(__dirname,'../static/js',file),'utf8');
    for(const name of names){
        const match=source.match(new RegExp(`(?:async )?function ${name}\\([^\\n]*\\)\\{[\\s\\S]*?\\n\\}`));
        assert.ok(match,`${file}: ${name}`);vm.runInContext(match[0],context);
    }
}
function classic(response){
    let counter=0,saves=0;
    const context=createTaskContext({canvas:{id:'a'},canvasOpenGeneration:1,nodes:[{id:'source',type:'image',url:'/output/old.png',x:10,y:20}],
        connections:[{id:'a',from:'upstream',to:'source'},{id:'b',from:'source',to:'downstream'}],
        selected:new Set(['source']),ensureCanvas:()=>true,pushUndo(){},render(){},scheduleSave(){saves++;},
        CANVAS_UPLOAD_MAX:50,CANVAS_UPLOAD_MAX_FILE_BYTES:100*1024*1024,CANVAS_UPLOAD_MAX_BATCH_BYTES:500*1024*1024,
        FormData:class{append(){}},fetch:async()=>response,langIsEn:()=>false,uid:prefix=>prefix+(++counter),
        nodeBounds:()=>({x:0,y:0,w:500,h:300}),canConnect:()=>true,defaultPoint:()=>({x:0,y:0}),
        window:{CanvasAudio:{migrate(node){if(node.mediaKind==='audio')node.type='audio';}}}});
    load(context,'canvas.js',['mediaKindForUpload','layoutUploadedMediaNodes','createGroupForUploadedNodes',
        'uploadMediaFiles','uploadImages','uploadImageGroup','fillImageNode','createImageCardsFromLocalPaths']);
    return {context,saves:()=>saves};
}

test('classic partial upload preserves source, connections and saved state',async()=>{
    const ui=classic({ok:true,json:async()=>({files:[{url:'/output/one.png'}]})});
    await assert.rejects(vm.runInContext("fillImageNode('source',[{name:'a.png'},{name:'b.png'}],{group:true})",ui.context),/上传不完整/);
    assert.equal(ui.context.nodes.length,1);assert.equal(ui.context.nodes[0].url,'/output/old.png');
    assert.equal(ui.context.connections.length,2);assert.equal(ui.saves(),0);
});

test('classic group replacement removes old source and reconnects both directions once',async()=>{
    const ui=classic({ok:true,json:async()=>({files:[{url:'/output/one.png'},{url:'/output/two.png'}]})});
    await vm.runInContext("fillImageNode('source',[{name:'a.png'},{name:'b.png'}],{group:true})",ui.context);
    const group=ui.context.nodes.find(node=>node.type==='group');
    assert.ok(group);assert.equal(ui.context.nodes.some(node=>node.id==='source'),false);
    assert.equal(group.items.length,2);assert.equal(ui.context.connections.length,2);
    assert.ok(ui.context.connections.some(link=>link.from===group.id&&link.to==='downstream'));
    assert.ok(ui.context.connections.some(link=>link.from==='upstream'&&link.to===group.id));
    assert.equal(ui.context.selected.has('source'),false);
});

for(const file of ['canvas.js','smart-canvas.js'])test(`${file}: folder drop reads every batch and filters unsupported files`,async()=>{
    const context=createTaskContext({});
    load(context,file,['isSupportedUploadFile','dataTransferItemEntry','filesFromEntry','uploadFilesFromDataTransfer']);
    const image={name:'a.png',type:'image/png'},audio={name:'b.wav',type:'audio/wav'},text={name:'notes.exe',type:''};
    const entry=file=>({isFile:true,file:done=>done(file)});
    const batches=[[entry(image)],[entry(audio),entry(text)],[]];
    context.drop={items:[{webkitGetAsEntry:()=>({isDirectory:true,createReader:()=>({readEntries:done=>done(batches.shift())})})}]};
    const files=await vm.runInContext('uploadFilesFromDataTransfer(drop)',context);
    assert.deepEqual(Array.from(files),[image,audio]);assert.equal(batches.length,0);
});

function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
const success=()=>({ok:true,json:async()=>({files:[{url:'/output/new.png',name:'new.png'}]})});
test('classic late upload cannot add media to a different canvas',async()=>{
    const gate=deferred(),ui=classic(gate.promise);const pending=vm.runInContext("uploadImages([{name:'a.png'}],{x:0,y:0})",ui.context);
    ui.context.canvas={id:'b'};ui.context.canvasOpenGeneration++;ui.context.nodes=[];ui.context.connections=[];
    gate.resolve(success());await pending;assert.equal(ui.context.nodes.length,0);assert.equal(ui.saves(),0);
});
test('classic late replacement cannot overwrite a same-id node in a reopened canvas',async()=>{
    const gate=deferred(),ui=classic(gate.promise);const pending=vm.runInContext("fillImageNode('source',[{name:'a.png'}])",ui.context);
    ui.context.canvasOpenGeneration++;ui.context.nodes=[{id:'source',type:'image',url:'/output/reopened.png'}];
    gate.resolve(success());await pending;assert.equal(ui.context.nodes[0].url,'/output/reopened.png');assert.equal(ui.saves(),0);
});
test('classic local-path import cannot mutate the canvas opened while it was waiting',async()=>{
    const gate=deferred(),ui=classic(gate.promise);ui.context.setStatus=()=>{};
    const pending=vm.runInContext("createImageCardsFromLocalPaths(['self-made.png'],{x:0,y:0})",ui.context);
    ui.context.canvas={id:'b'};ui.context.canvasOpenGeneration++;ui.context.nodes=[];
    gate.resolve(success());await pending;assert.equal(ui.context.nodes.length,0);assert.equal(ui.saves(),0);
});

test('classic upload survives an ordinary autosave object replacement for the same open canvas',async()=>{
    const gate=deferred(),ui=classic(gate.promise);const pending=vm.runInContext("uploadImages([{name:'a.png'}],{x:0,y:0})",ui.context);
    ui.context.canvas={id:'a',updated_at:2000};gate.resolve(success());await pending;assert.equal(ui.context.nodes.length,2);assert.equal(ui.saves(),1);
});

test('classic upload completed after media controller suspension leaves the draft unchanged',async()=>{
    const gate=deferred(),ui=classic(gate.promise);ui.context.dropOverlay={classList:{remove(){}}};
    const pending=vm.runInContext("uploadImages([{name:'a.png'}],{x:0,y:0})",ui.context);
    ui.context.classicMediaInputController.suspend();gate.resolve(success());await pending;assert.equal(ui.context.nodes.length,1);assert.equal(ui.saves(),0);
});
