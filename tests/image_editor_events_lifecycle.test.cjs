const test=require('node:test'),assert=require('node:assert/strict');
function element(id=''){
    const listeners=new Map(),captured=new Set();
    return {id,dataset:{},style:{},scrollLeft:20,scrollTop:30,clientWidth:100,clientHeight:100,scrollWidth:300,scrollHeight:300,
        classList:{add(){},remove(){},toggle(){},contains:()=>false},closest:()=>null,getBoundingClientRect:()=>({left:0,top:0,width:100,height:100}),
        setPointerCapture:id=>captured.add(id),hasPointerCapture:id=>captured.has(id),releasePointerCapture:id=>captured.delete(id),captured,
        addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},removeEventListener(type,fn){listeners.get(type)?.delete(fn);},
        fire(type,patch={}){const event={target:this,currentTarget:this,pointerId:1,button:0,clientX:50,clientY:40,deltaY:-1,preventDefault(){},stopPropagation(){},...patch};for(const fn of [...(listeners.get(type)||[])])fn.call(this,event);},
        count:type=>listeners.get(type)?.size||0};
}
function setup(kind){
    const nodes=new Map(),window=element('window'),calls=[];const get=id=>{if(!nodes.has(id))nodes.set(id,element(id));return nodes.get(id);};
    const selectors=new Map();for(const [selector,key,value] of [['[data-crop-handle]','cropHandle','nw'],['[data-crop-ratio]','cropRatio','16:9'],['[data-outpaint-handle]','outpaintHandle','left'],['[data-image-edit-mode]','imageEditMode','resize'],['[data-panorama-ratio]','panoramaRatio','wide']]){const el=element(selector);el.dataset[key]=value;selectors.set(selector,[el]);}
    const deps={window,document:{getElementById:get,querySelectorAll:s=>selectors.get(s)||[]},cropState:{x:0,y:0},cropDrag:null,imageEditMode:'crop',imageEditZoom:1,
        brushTool:'paint',editDrawState:null,editTextDrag:null,gridCustomDrag:null,gridJoinDrag:null,gridOperationMode:'split',
        previewCompareDrag:false,previewCompareOn:false,previewCompareIndex:-1,previewPanDrag:null,imageEditPanDrag:null,previewPan:{x:0,y:0},previewZoom:1,panoramaState:{enabled:false,drag:null,fov:60},imageEditModal:get('imageEditModal'),
        cropDragModeFromPointer:()=> 'move',beginCropDrag:(e,mode)=>calls.push(['crop',mode]),setCropAspectPreset:p=>calls.push(['ratio',p]),setImageEditMode:(...args)=>calls.push(['mode',...args]),
        beginEditDraw:e=>{deps.editDrawState={};e.currentTarget.setPointerCapture(e.pointerId);},moveEditDraw(){},endEditDraw:()=>{deps.editDrawState=null;deps.gridCustomDrag=null;},
        beginEditText(){},moveEditText(){},endEditText:()=>{deps.editTextDrag=null;},beginGridJoinDrag(){},moveGridJoinDrag(){},endGridJoinDrag:()=>{deps.gridJoinDrag=null;},
        hitEditTextItem:()=>null,editTextPoint:e=>e,setSelectedEditTextItem(){},beginEditTextInline(){},syncSelectedEditTextStyleFromBrush(){},syncGridGapValue(){},refreshGridSplitPreview:()=>calls.push(['grid']),setImageResizeScale:x=>calls.push(['resize',x]),
        applyImageEditZoom:()=>calls.push(['zoom']),syncImageEditOverflow:()=>calls.push(['overflow']),setPreviewComparePos:x=>calls.push(['compare',x]),applyPreviewTransform:()=>calls.push(['preview']),
        applyPanoramaRatio(){},refreshPanoramaControls(){},resizePanoramaViewer(){},seekPreviewVideoFrames:()=>false,updateZoomLabel(){},resizeOutpaintFromDrag(){},resizeCropFromDrag(){},clampCrop(){},renderCropBox(){},
        closeImageEditor:()=>{calls.push(['close']);deps.cropState=null;}};
    const api=require('../static/js/'+(kind==='classic'?'canvas':'smart')+'-image-editor-events.js'),controller=api.create(()=>deps);
    return {deps,controller,window,get,selectors,calls};
}
for(const kind of ['classic','smart']){
    test(`${kind} editor listeners mount once, suspend, restore once and dispose`,()=>{
        const ui=setup(kind);ui.controller.mount();ui.controller.mount();ui.get('cropBox').fire('mousedown');assert.deepEqual(ui.calls,[['crop','move']]);
        const old=ui.controller.capture();ui.window.fire('pagehide');assert.equal(old(),false);assert.equal(ui.get('cropBox').count('mousedown'),0);assert.equal(ui.calls.filter(x=>x[0]==='close').length,1);
        ui.window.fire('pageshow');ui.window.fire('pageshow');assert.equal(ui.get('cropBox').count('mousedown'),1);assert.equal(old(),false);
        ui.controller.dispose();ui.controller.mount();assert.equal(ui.get('cropBox').count('mousedown'),0);assert.equal(ui.window.count('pageshow'),0);assert.equal(ui.window.count('resize'),0);
    });
    test(`${kind} editor preserves crop handle, ratio and explicit mode routing`,()=>{
        const ui=setup(kind);ui.controller.mount();ui.selectors.get('[data-crop-handle]')[0].fire('mousedown');ui.selectors.get('[data-crop-ratio]')[0].fire('click');ui.selectors.get('[data-image-edit-mode]')[0].fire('click');
        assert.deepEqual(ui.calls,[['crop','crop-nw'],['ratio','16:9'],['mode','resize',true]]);
    });
    test(`${kind} editor blur releases pointers and gestures without closing or invalidating the session`,()=>{
        const ui=setup(kind);ui.controller.mount();const current=ui.controller.capture();ui.get('editDrawCanvas').fire('pointerdown',{pointerId:9});ui.deps.cropDrag={};ui.window.fire('blur');
        assert.equal(ui.get('editDrawCanvas').captured.size,0);assert.equal(ui.deps.cropDrag,null);assert.equal(ui.deps.editDrawState,null);assert.equal(current(),true);assert.equal(ui.calls.some(x=>x[0]==='close'),false);
    });
    test(`${kind} editing wheel keeps its focal point and excludes the board`,()=>{
        const ui=setup(kind);ui.controller.mount();let stopped=0;const stage=ui.get('imageEditStage');stage.fire('wheel',{stopPropagation(){stopped++;}});
        assert.equal(ui.deps.imageEditZoom,1.12);assert.ok(Math.abs(stage.scrollLeft-28.4)<1e-8);assert.ok(Math.abs(stage.scrollTop-38.4)<1e-8);assert.equal(stopped,1);assert.equal(ui.calls[0][0],'zoom');
    });
}
test('smart preview wheel seeks video before changing image zoom',()=>{const ui=setup('smart');ui.controller.mount();ui.deps.imageEditMode='preview';ui.deps.seekPreviewVideoFrames=()=>true;ui.get('imageEditStage').fire('wheel');assert.equal(ui.deps.previewZoom,1);assert.equal(ui.calls.length,0);});
test('smart panorama and grid-join wheel keep their separate branches',()=>{
    const ui=setup('smart');ui.controller.mount();ui.deps.imageEditMode='preview';ui.deps.panoramaState.enabled=true;ui.get('imageEditStage').fire('wheel');assert.equal(ui.deps.panoramaState.fov,55.2);assert.equal(ui.deps.imageEditZoom,1);
    ui.deps.imageEditMode='grid';ui.deps.gridOperationMode='join';ui.get('imageEditStage').fire('wheel');assert.deepEqual(ui.calls,[['grid'],['overflow']]);
});
