const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const {createTaskContext}=require('./canvas_task_test_helpers.cjs');
function setup(file,names,state){
    const e=createTaskContext(state),source=fs.readFileSync(path.join(__dirname,'../static/js/'+file),'utf8');
    for(const name of names){const start=source.indexOf(`function ${name}(`);assert.ok(start>=0);vm.runInContext(source.slice(start,source.indexOf('\n}',start)+2),e);}
    return e;
}
const text=value=>({nodeType:3,textContent:value});
const token=(url,name)=>({nodeType:1,tagName:'SPAN',classList:{contains:n=>n==='mention-image-token'},dataset:{url,name,kind:'image',assetUris:'{"test":"uri"}'}});
const promptNames=['collectPromptParts','originalPromptTextFromParts','buildPromptRequest','buildPromptRequestForNode'];
function promptState(extra={}){return {Node:{TEXT_NODE:3,ELEMENT_NODE:1},smartLoopContext:null,
    SMART_REFERENCE_IMAGE_MAX:3,settings:{engine:'api'},blockedInputRefKeys:()=>new Set(),
    inputRefKey:r=>r.url,uniqueReferenceImages:refs=>refs,defaultReferenceImagesFor:()=>[],
    isSmartGroupNode:()=>false,inputPromptTextFor:()=>'',mediaKindForItem:()=> 'image',tr:key=>key,...extra};}
test('real prompt entry preserves reference order, blocked mentions, numbering and loop context',()=>{
    const ctx={round:2},seen=[],a={url:'a',name:'默认A'},b={url:'b',name:'默认B'};
    const e=setup('smart-canvas.js',promptNames,promptState({smartLoopContext:ctx,
        promptInput:{childNodes:[text('使用'),token('b','提及B'),text('和'),token('blocked','隐藏C'),token('extra','新增D')]},
        blockedInputRefKeys:()=>new Set(['blocked']),
        defaultReferenceImagesFor:(node,consume,context)=>{seen.push([node.id,consume,context]);return [a,b,{url:'blocked'}];},
        inputPromptTextFor:(_node,context)=>{assert.equal(context,ctx);return '上游';}}));
    const result=e.buildPromptRequest({id:'n'},null,true);
    assert.deepEqual(seen,[['n',true,ctx]]);
    assert.deepEqual(Array.from(result.refs,r=>[r.url,r.role]),[['a','image_1'],['b','image_2'],['extra','image_3']]);
    assert.ok(result.prompt.includes('上游\n\n使用图2和@隐藏C图3'));assert.equal(result.mentioned,true);
    assert.equal(result.displayPrompt,'使用@提及B和@隐藏C@新增D');
    assert.equal(result.refs[2].asset_uris.test,'uri');
});
test('target draft compilation restores the editor after success and failure, with override inputs',()=>{
    const input={innerHTML:'面板',get childNodes(){return [text(this.innerHTML)];}},ctx={round:5};let fail=false;
    const e=setup('smart-canvas.js',promptNames,promptState({promptInput:input,
        loadNodePromptDraftToInput:n=>{input.innerHTML=n.draft;},
        inputPromptTextFor:(_n,c)=>{assert.equal(c,ctx);if(fail)throw Error('fixture');return '';},
        defaultReferenceImagesFor:()=>{throw Error('must use explicit refs');}}));
    const result=e.buildPromptRequestForNode({draft:'目标'},[{url:'chosen'}],ctx);
    assert.equal(result.prompt,'目标');assert.equal(result.refs[0].url,'chosen');assert.equal(input.innerHTML,'面板');
    fail=true;assert.throws(()=>e.buildPromptRequestForNode({draft:'失败目标'},[],ctx),/fixture/);
    assert.equal(input.innerHTML,'面板');
});
const reorderNames=['reorderInputThumb','reorderInputSourceNodes','movedBeforeAfterIds','sameOrderedIds','reorderManualInputRefs','renderInputThumbsRow'];
test('source thumbnail reorder changes only matching connection slots and preserves explicit extras',()=>{
    const a={id:'a',x:10},b={id:'b',x:20},node={id:'n',inputNodeIds:['a','b','unrelated']};
    const c1={from:'a',to:'n',kind:'input'},keep={from:'a',to:'other'},c2={from:'b',to:'n',kind:'flow'};let saved=0,undo=0;
    const e=setup('smart-canvas.js',reorderNames,{nodes:[a,b,node],canvas:{connections:[c1,keep,c2]},inputThumbsRow:null,
        smartLoopContext:null,smartImageUsesWorkflowInput:()=>false,inputNodesFor:()=>[a,b],isSmartGroupNode:()=>false,
        pushUndo:()=>undo++,render(){},scheduleSave:()=>saved++});
    e.reorderInputThumb(node,[{nodeId:'a'},{nodeId:'b'}],1,0);
    assert.deepEqual(Array.from(node.inputNodeIds),['b','a','unrelated']);
    assert.deepEqual(Array.from(e.canvas.connections),[c2,keep,c1]);assert.equal(a.x,10);assert.equal(b.x,20);
    assert.equal(saved,1);assert.equal(undo,1);
});
test('group and manual thumbnails preserve explicit ordering through the real wrappers',()=>{
    const group={id:'g',items:['a','b','c']};let saved=0;
    const e=setup('smart-canvas.js',reorderNames,{nodes:[],inputThumbsRow:null,isSmartGroupNode:()=>true,
        inputRefKey:r=>r.url,pushUndo(){},render(){},scheduleSave:()=>saved++});
    e.reorderInputThumb(group,[{nodeId:'a'},{nodeId:'c'}],1,0);
    assert.deepEqual(Array.from(group.items),['c','a','b']);
    const node={manualInputRefs:[{url:'a'},{url:'b'},{url:'c'}]};
    assert.equal(e.reorderManualInputRefs(node,'a','c','after'),true);
    assert.deepEqual(Array.from(node.manualInputRefs,r=>r.url),['b','c','a']);assert.equal(saved,2);
});
test('classic input list caches unchanged markup and routes drag ordering through its live host',()=>{
    const children=[],calls=[],list={dataset:{},appendChild:item=>children.push(item)};
    const e=setup('canvas.js',['canvasInputListNeedsRender','renderImageInputList'],{
        document:{createElement:()=>({dataset:{}})},tr:x=>x,escapeHtml:x=>x,internalDrag:false,
        isMissingAssetUrl:()=>false,canvasPreviewImgHtml:url=>`<img src="${url}">`,refreshIcons(){},bindCanvasPreviewImageFallbacks(){},
        reorderInput:(...args)=>calls.push(args)});
    const node={id:'g'},inputs=[{id:'a',preview:'a.png',label:'A'}];e.renderImageInputList(list,node,inputs);e.renderImageInputList(list,node,inputs);
    assert.equal(children.length,1);let payload='';
    const event={stopPropagation(){},preventDefault(){},dataTransfer:{setData:(_type,value)=>payload=value,getData:()=>payload}};
    children[0].ondragstart(event);assert.equal(e.internalDrag,true);children[0].ondrop(event);
    assert.equal(e.internalDrag,false);assert.deepEqual(calls,[[node,'a','a']]);
});
