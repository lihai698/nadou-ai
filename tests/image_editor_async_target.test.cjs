const test=require('node:test'),assert=require('node:assert/strict');
const classic=require('../static/js/canvas-image-editor.js'),smart=require('../static/js/smart-image-editor.js');
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
function setup(kind,mode,{encodingGate=false}={}){
    const gate=deferred(),effects={uploads:0,renders:0,saves:0,errors:[]},elements=new Map();let valid=true;
    function element(id){if(!elements.has(id))elements.set(id,{style:{},dataset:{},value:'0',width:100,height:50,getContext:()=>context,classList:{add(){},remove(){},toggle(){},contains:()=>true},removeAttribute(){},getAttribute:()=>'',querySelectorAll:()=>[],pause(){},load(){},naturalWidth:100,naturalHeight:50,clientWidth:100,clientHeight:50});return elements.get(id);}
    const context={drawImage(){},fillRect(){},getImageData:()=>({data:new Uint8ClampedArray([0,0,0,255])}),createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData(){}};
    const d={document:{getElementById:element,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({width:0,height:0,getContext:()=>context,toBlob:done=>encodingGate?gate.promise.then(done):done(new Blob(['self-made']))})},
        nodes:kind==='classic'?[{id:'a',url:'old-a.png',name:'a.png'},{id:'b',url:'old-b.png',name:'b.png'}]:[{id:'a',images:[{url:'old-a.png',name:'a.png',role:'reference'}]},{id:'b',images:[{url:'old-b.png',name:'b.png'}]}],
        cropState:{nodeId:'a',imageIndex:0,x:0,y:0,w:100,h:50},imageEditMode:mode,imageResizeScale:.5,imageEditZoom:1,imageEditBaseW:100,imageEditBaseH:50,
        captureImageEditContext:()=>()=>valid,uploadCroppedBlob:async()=>{effects.uploads++;return encodingGate?{url:'edited.png',name:'edited.png'}:gate.promise;},
        render:()=>effects.renders++,scheduleSave:()=>effects.saves++,alert:text=>effects.errors.push(text),toast:text=>effects.errors.push(text),
        imageForDisplay:x=>x,mediaKindForItem:()=> 'image',isSmartImageNode:()=>false,setPromptDraftForNode(){},safeExportFileName:x=>x,downloadNameForMediaItem:x=>x.name,imageEditModal:element('modal'),window:{innerWidth:1200,innerHeight:900},promptInput:element('prompt')};
    for(const name of ['clearEditDrawing','resetEditDrawingHistory','removeEditTextInlineEditor','syncTextToolState','syncBrushToolButtons','syncEditDrawingHistoryButtons','_syncGridCustomCursor','_syncGridCustomUndoBtn','_updateZoomLabel','cleanupSmartLogPreviewNode','disposePanoramaPreview','resetPreviewTransform','updatePreviewNavButtons'])d[name]=()=>{};
    d.editTextCanvas=()=>element('text');
    d.editTextHasContent=()=>true;d.currentEditImage=()=>smart.currentEditImage(d);d.replaceEditedImage=(...args)=>smart.replaceEditedImage(d,...args);d.closeImageEditor=()=>{d.cropState=null;};
    d.uploadImageBlobs=async()=>{effects.uploads++;return gate.promise;};d.gridCustomMode=false;d.gridOperationMode='split';d.gridJoinGroupId='';
    d.nodeScale=()=>1;d.imageLayout=()=>({width:100});d.nodeRect=()=>({x:0,y:0,width:100,height:50});
    return {d,effects,gate,invalidate(){valid=false;d.cropState={nodeId:'b',imageIndex:0,x:0,y:0,w:100,h:50};}};
}
for(const kind of ['classic','smart']){
    const draw=require('../static/js/'+(kind==='classic'?'canvas':'smart')+'-editor-draw.js'),grid=require('../static/js/'+(kind==='classic'?'canvas':'smart')+'-editor-grid.js');
    for(const [mode,api,method] of [['mask',draw,'applyImageMask'],['brush',draw,'applyImageBrush'],['grid',grid,'applyImageGridSplit'],...(kind==='smart'?[['join',grid,'applyImageGridJoin']]:[])]){
        test(`${kind} ${mode}: late result is discarded before creating or replacing outputs`,async()=>{
            const ui=setup(kind,mode);
            if(mode==='join'){
                ui.d.gridOperationMode='join';ui.d.nodes[0].images.push({url:'second.png',natural_w:100,natural_h:50});
                ui.d.gridJoinImageCache=new Map([0,1].map(i=>[i,{complete:true,naturalWidth:100,naturalHeight:50}]));
                ui.d.gridJoinLayout={items:[{index:0,x:0,y:0,w:100,h:50},{index:1,x:100,y:0,w:100,h:50}]};ui.d.gridJoinOutputSize=256;
            }
            const pending=api[method](ui.d);await new Promise(done=>setImmediate(done));assert.equal(ui.effects.uploads,1);
            const before=JSON.stringify(ui.d.nodes);ui.invalidate();ui.gate.resolve(mode==='grid'?[{url:'edited.png',name:'edited.png'}]:{url:'edited.png',name:'edited.png'});await pending;
            assert.equal(JSON.stringify(ui.d.nodes),before);assert.equal(ui.d.cropState.nodeId,'b');assert.equal(ui.effects.saves,0);assert.equal(ui.effects.renders,0);
        });
    }
    test(`${kind} resize commits to the current same-id node after normal object replacement`,async()=>{
        const ui=setup(kind,'resize'),api=kind==='classic'?classic:smart,pending=api.applyImageResize(ui.d);await new Promise(done=>setImmediate(done));
        ui.d.nodes=JSON.parse(JSON.stringify(ui.d.nodes));ui.gate.resolve({url:'edited.png',name:'edited.png'});await pending;
        assert.equal(kind==='classic'?ui.d.nodes[0].url:ui.d.nodes[0].images[0].url,'edited.png');assert.equal(ui.effects.saves,1);
    });
}
for(const [kind,api] of [['classic',classic],['smart',smart]]){
    for(const [mode,method] of [['crop','applyImageCrop'],['outpaint','applyImageOutpaint'],['resize','applyImageResize']]){
        test(`${kind} ${mode}: obsolete upload cannot mutate either image or close the new editor`,async()=>{
            const ui=setup(kind,mode),pending=api[method](ui.d);await new Promise(done=>setImmediate(done));assert.equal(ui.effects.uploads,1);
            const before=JSON.stringify(ui.d.nodes);ui.invalidate();ui.gate.resolve({url:'edited.png',name:'edited.png'});await pending;
            assert.equal(JSON.stringify(ui.d.nodes),before);assert.equal(ui.d.cropState.nodeId,'b');assert.equal(ui.effects.saves,0);assert.equal(ui.effects.renders,0);
        });
    }
    test(`${kind}: obsolete image encoding cannot begin an upload`,async()=>{
        const ui=setup(kind,'crop',{encodingGate:true}),pending=api.applyImageCrop(ui.d);ui.invalidate();ui.gate.resolve(new Blob(['self-made']));await pending;assert.equal(ui.effects.uploads,0);assert.equal(ui.effects.saves,0);
    });
}
