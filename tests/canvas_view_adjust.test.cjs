const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const rules=require('../static/js/canvas-view-adjust.js');
const classic=fs.readFileSync(path.join(__dirname,'../static/js/canvas.js'),'utf8');
const smart=fs.readFileSync(path.join(__dirname,'../static/js/smart-canvas.js'),'utf8');
const shared=fs.readFileSync(path.join(__dirname,'../static/js/canvas-view-adjust.js'),'utf8');
function section(source,start,end){const first=source.indexOf(start),last=source.indexOf(end,first);assert.ok(first>=0&&last>first);return source.slice(first,last);}
const compiled=kind=>({...rules.build(kind,{}),kind});
function dialogSubmitHarness(kind,onSubmit){
    const createButton={disabled:false,matches:()=>false},closeButton={disabled:false,matches:()=>true},description={disabled:false};
    const context=vm.createContext({kind,options:{isAlive:()=>true,onSubmit},models:[],modelSelect:{value:''},createButton,status:{textContent:''},p:{smartMode:true},busy:false,submitted:false,imageReady:true,isAngle:kind==='angle',sync:()=>compiled(kind)});
    context.el={querySelectorAll:()=>[createButton,closeButton],querySelector:()=>description,remove:()=>{context.removed=true;}};
    context.dialog=context.el;
    vm.runInContext(section(shared,'function close(){','function dragParams('),context);
    vm.runInContext(section(shared,'createButton.onclick=async()=>{','sync();root.lucide?.createIcons();el.querySelector'),context);
    return context;
}
test('both adjustment dialogs close after saved creation and reject duplicate clicks during submission',async()=>{
    for(const kind of ['angle','lighting']){
        let finish,submissions=0;
        const pending=new Promise(resolve=>{finish=resolve;});
        const context=dialogSubmitHarness(kind,()=>{submissions++;return pending;});
        const first=context.createButton.onclick();
        await context.createButton.onclick();
        assert.equal(submissions,1);assert.equal(context.removed,undefined);
        finish({saved:true,nodeId:'created'});await first;
        assert.equal(context.removed,true);assert.equal(context.dialog,null);assert.equal(context.submitted,true);
        await context.createButton.onclick();assert.equal(submissions,1);
    }
});
test('failed canvas save keeps its warning without creating again; submission errors allow retry',async()=>{
    let submissions=0;
    const failedSave=dialogSubmitHarness('angle',async()=>{submissions++;return {saved:false,message:'节点已创建，请重试保存'};});
    await failedSave.createButton.onclick();await failedSave.createButton.onclick();
    assert.equal(submissions,1);assert.equal(failedSave.removed,undefined);assert.equal(failedSave.createButton.disabled,true);
    assert.match(failedSave.status.textContent,/重试保存/);
    let attempt=0;
    const rejected=dialogSubmitHarness('lighting',async()=>{if(!attempt++)throw new Error('原图已改变');return {saved:true};});
    await rejected.createButton.onclick();assert.equal(rejected.removed,undefined);assert.equal(rejected.createButton.disabled,false);
    assert.match(rejected.status.textContent,/原图已改变/);
    await rejected.createButton.onclick();assert.equal(rejected.removed,true);
});
test('classic submit selects and centers an offscreen API card before saving',async()=>{
    const source={id:'source',type:'image',url:'original.png'},target={id:'api',x:50000,y:60000,w:380,h:508};
    let panel,focusPoint,saveCount=0;
    const context=vm.createContext({nodes:[source],canvas:{id:'canvas'},CanvasViewAdjust:{configuredModels:()=>[],open:options=>{panel=options;}},imageApiProviders:()=>[],mediaKindForNode:()=> 'image',canvasDisplayMediaUrl:x=>x,createCanvasViewAdjustApiNode:()=>target,closeImageEditor:()=>{},nodeRect:n=>n,board:{getBoundingClientRect:()=>({width:1000,height:700})},viewport:{scale:4},safeViewportScale:n=>n,centerViewportOnWorldPoint:point=>{focusPoint=point;},scheduleViewportSave:()=>{},saveCanvas:async()=>{saveCount++;return true;},fetch:()=>assert.fail('must not generate')});
    vm.runInContext(section(classic,'function openCanvasViewAdjustment(','function clampCrop('),context);
    vm.runInContext("openCanvasViewAdjustment('source','angle')",context);
    const result=await panel.onSubmit(compiled('angle'));
    assert.equal(result.saved,true);assert.equal(result.nodeId,'api');assert.equal(saveCount,1);
    assert.equal(focusPoint.x,50190);assert.equal(focusPoint.y,60254);
    assert.ok(context.viewport.scale<=1 && target.h*context.viewport.scale<=580);
});
test('smart submit centers the new API card and propagates a save failure',async()=>{
    const source={id:'source',images:[{url:'original.png'}]},target={id:'api',x:50000,y:60000,width:316,height:194};
    let panel,focusPoint;
    const context=vm.createContext({nodes:[source],canvasId:'canvas',CanvasViewAdjust:{configuredModels:()=>[],open:options=>{panel=options;}},smartNodeToolbarImageIndex:()=>0,imageForDisplay:x=>x,mediaKindForItem:()=> 'image',imageProviders:()=>[],createSmartViewAdjustApiNode:()=>target,nodeRect:n=>n,shell:{clientWidth:1000,clientHeight:700},composer:{offsetHeight:300,offsetWidth:540},viewport:{scale:.1},safeScale:n=>n,centerViewportOnWorldPoint:point=>{focusPoint=point;},saveCanvas:async()=>false,fetch:()=>assert.fail('must not generate')});
    vm.runInContext(section(smart,'function openSmartViewAdjustment(','function duplicateSmartNodeMediaToCanvas('),context);
    vm.runInContext("openSmartViewAdjustment('source','lighting')",context);
    const result=await panel.onSubmit(compiled('lighting'));
    assert.equal(result.saved,false);assert.equal(result.nodeId,'api');assert.match(result.message,/无需再次创建/);
    assert.equal(focusPoint.x,50158);assert.equal(focusPoint.y,60254);assert.equal(context.viewport.scale,.65);
});
test('angle prompt changes viewpoint while requiring stable subject and material, not a perspective warp',()=>{
    const p=rules.build('angle',{horizontalAngle:-90,pitchAngle:60,cameraDistance:2,wideAngle:true});
    assert.match(p.prompt,/向左旋转 90/);assert.match(p.prompt,/俯视 60/);assert.match(p.prompt,/广角/);
    assert.match(p.prompt,/保持主体、颜色、材质/);assert.match(p.prompt,/不要只做透视变形/);
    assert.equal(rules.normalize('angle',{horizontalAngle:Infinity,pitchAngle:200}).pitchAngle,60);
});
test('lighting compiles parameters and preset without adding physical lighting equipment or changing identity',()=>{
    const p=rules.build('lighting',{azimuth:270,elevation:0,brightness:20,rimLight:true,lightColor:'#ffddaa',stylePreset:'rembrandt',description:'温暖的窗光'});
    for(const content of ['left side','low-key','rim light','#ffddaa','Rembrandt','温暖的窗光','preserve identity','do not add any lamp'])assert.ok(p.prompt.includes(content),content);
    assert.equal(rules.normalize('lighting',{lightColor:'<invalid>',stylePreset:'bad'}).lightColor,'#ffffff');
});
test('lighting smart-mode gating, exact exposure thresholds and editable template preserve consistency',()=>{
    const off=rules.build('lighting',{smartMode:false,description:'不应加入这段文字',brightness:50});
    assert.ok(!off.prompt.includes('不应加入这段文字'));assert.ok(!off.prompt.includes('exposure'));
    assert.match(rules.build('lighting',{brightness:75}).prompt,/high-key/);
    assert.match(rules.build('lighting',{brightness:25}).prompt,/low-key/);
    assert.match(rules.build('lighting',{brightness:51}).prompt,/slightly brighter/);
    assert.match(rules.build('lighting',{brightness:49}).prompt,/slightly darker/);
    const custom=rules.build('lighting',{description:'窗光',promptTemplate:'自定义 {{smartDesc}}, {{lightDirectionPrompt}}, {{lightingMeta}}, {{unknown}}'});
    assert.match(custom.prompt,/自定义 窗光/);assert.match(custom.prompt,/preserve identity/);
    assert.match(custom.prompt,/azimuth:0°/);assert.ok(!custom.prompt.includes('{{'));
    assert.equal(rules.build('lighting',{previewMode:'front'}).prompt,rules.build('lighting',{}).prompt);
});
test('scene dragging respects camera/skybox opposite pitch, bounds and wrapped light azimuth',()=>{
    assert.equal(rules.dragParams('angle',rules.normalize('angle',{}),0,22).pitchAngle,-10);
    assert.equal(rules.dragParams('angle',rules.normalize('angle',{previewMode:'skybox'}),0,22).pitchAngle,10);
    assert.equal(rules.dragParams('angle',rules.normalize('angle',{}),10000,-10000).horizontalAngle,180);
    const light=rules.dragParams('lighting',rules.normalize('lighting',{azimuth:350}),20,-200);
    assert.equal(light.azimuth,20);assert.equal(light.elevation,90);
});
test('smart workflow import/copy remaps selected-image exclusions onto the new source node',()=>{
    const context=vm.createContext({});
    vm.runInContext(section(smart,'function remapSmartViewAdjustRefs(','function createSmartViewAdjustApiNode('),context);
    context.node={viewAdjust:{sourceNodeId:'original'},blockedInputRefs:['original|0','original|2']};
    context.idMap=new Map([['original','copied']]);
    vm.runInContext('remapSmartViewAdjustRefs(node,idMap)',context);
    assert.equal(context.node.viewAdjust.sourceNodeId,'copied');
    assert.deepEqual([...context.node.blockedInputRefs],['copied|0','copied|2']);
});
test('smart native request builder sends the selected image and edited prompt, excluding other images in the source node',()=>{
    const selectedPrompt='仅调整指定图片的光照，保留主体';
    const images=['first.png','selected.png','third.png'].map((url,imageIndex)=>({url,imageIndex,nodeId:'source',kind:'image'}));
    const context=vm.createContext({settings:{engine:'api'},smartLoopContext:null,SMART_REFERENCE_IMAGE_MAX:20,
        collectPromptParts:()=>[{type:'text',text:selectedPrompt}],originalPromptTextFromParts:()=>selectedPrompt,
        defaultReferenceImagesFor:()=>images,uniqueReferenceImages:x=>x,isSmartGroupNode:()=>false,inputPromptTextFor:()=>'',mediaKindForItem:()=> 'image'});
    vm.runInContext(section(smart,'function inputRefKey(','function manualReferenceImagesFor('),context);
    vm.runInContext(section(smart,'function buildPromptRequest(','function outgoingConnectionsFor('),context);
    context.node={blockedInputRefs:['source|0','source|2']};
    const request=vm.runInContext('buildPromptRequest(node)',context);
    assert.equal(request.prompt,selectedPrompt);
    assert.deepEqual([...request.refs].map(ref=>ref.url),['selected.png']);
});
test('view adjustment produces model-independent parameters and prompts',()=>{
    assert.equal(rules.build('angle',{model:'reference-project-model'}).prompt,rules.build('angle',{}).prompt);
    assert.equal(rules.build('lighting',{}).model,undefined);
});
test('model selector takes only configured native API entries, including custom names and empty configuration',()=>{
    const providers=[{id:'one',name:'自有平台',image_models:['custom-image']},{id:'two',name:'另一平台',image_models:['private-model']}];
    assert.deepEqual(rules.configuredModels(providers,p=>p.image_models),[
        {providerId:'one',model:'custom-image',label:'自有平台 · custom-image'},
        {providerId:'two',model:'private-model',label:'另一平台 · private-model'}
    ]);
    assert.deepEqual(rules.configuredModels([],()=>assert.fail('no configured providers')),[]);
});
test('smart adjustment uses the native Jimeng image-edit exclusions for each provider',()=>{
    const context=vm.createContext({settings:{provider_id:'another'},jimengImageEditMode:()=>false,isJimengProviderId:id=>id==='jimeng',JIMENG_IMAGE2IMAGE_UNSUPPORTED:['3.0','3.1']});
    vm.runInContext(section(smart,'function filterJimengImageModels(','let _jimengLastEditMode'),context);
    assert.deepEqual([...vm.runInContext("filterJimengImageModels(['3.0','3.1','4.0'],'jimeng',true)",context)],['4.0']);
    assert.deepEqual([...vm.runInContext("filterJimengImageModels(['3.0','4.0'],'another',true)",context)],['3.0','4.0']);
});
test('classic creates one native API node with editable prompt and original image connection, no generation request',()=>{
    const source={id:'source',type:'image',url:'original.png',x:20,y:50};
    let undo=0;
    const context=vm.createContext({nodes:[source],connections:[],selected:new Set(),uid:prefix=>prefix+'-new',pushUndo:()=>undo++,render:()=>{},scheduleSave:()=>{},defaultApiImageResolution:()=> 'auto',imageApiProviders:()=>[{id:'own-api'}],allImageModels:()=>['own-editor-model'],nodeRect:n=>({x:n.x||0,y:n.y||0,w:320,h:440}),fetch:()=>assert.fail('must not submit a model request')});
    vm.runInContext(section(classic,'function createCanvasViewAdjustApiNode(','function openCanvasViewAdjustment('),context);
    for(const kind of ['angle','lighting']){
        context.compiled=compiled(kind);context.source=source;
        const node=vm.runInContext('createCanvasViewAdjustApiNode(source,compiled)',context);
        assert.equal(node.type,'generator');assert.equal(node.model,'own-editor-model');assert.equal(node.count,1);
        assert.equal(node.viewAdjustPrompt,context.compiled.prompt);assert.equal(node.ratio,'source');
        assert.ok(context.connections.some(c=>c.from===source.id&&c.to===node.id));
    }
    assert.equal(undo,2);assert.equal(source.url,'original.png');assert.equal(context.nodes.filter(n=>n.type==='prompt').length,0);
    context.compiled={...compiled('lighting'),selection:{providerId:'selected-api',model:'selected-custom-model'}};
    const selected=vm.runInContext('createCanvasViewAdjustApiNode(source,compiled)',context);
    assert.equal(selected.apiProvider,'selected-api');assert.equal(selected.model,'selected-custom-model');
    assert.ok(selected.y>context.nodes[1].y,'repeated creation must not overlap earlier API nodes');
});
test('classic existing generation input uses the inline edited prompt and original image, and survives serialization',()=>{
    const source={id:'source',type:'image',url:'original.png',name:'原图'},target={id:'api',type:'generator',viewAdjustPrompt:compiled('angle').prompt};
    const context=vm.createContext({nodes:[source,target],connections:[{from:'source',to:'api'}],CANVAS_MEDIA_OUTPUT_TYPES:[],mediaKindForNode:()=> 'image'});
    vm.runInContext(section(classic,'function generatorSources(','function orderedSources('),context);
    context.target=JSON.parse(JSON.stringify(target));context.target.viewAdjustPrompt='编辑后的新角度提示词';
    const inputs=vm.runInContext('generatorSources(target)',context);
    assert.equal(inputs[0].prompt,'编辑后的新角度提示词');assert.equal(inputs[1].refs[0].url,'original.png');
    const plain={id:'unmodified',type:'generator'};context.target=plain;assert.equal(vm.runInContext('generatorSources(target).length',context),0);
});
test('smart creates a native API image node with selected source image, prompt draft, editable settings and no task',()=>{
    const source={id:'source',type:'smart-image',images:[{url:'first.png'},{url:'selected.png'},{url:'third.png'}]};
    const context=vm.createContext({nodes:[source],pushUndo:()=>{},nodeRect:()=>({x:0,y:0,width:300,height:200}),imageForDisplay:x=>x,cloneSmartSettings:x=>({...x}),smartSettingsForNode:()=>({engine:'api',apiKind:'video',provider_id:'own-api',model:'own-editor-model',videoModel:'old-video'}),nextOutputPositionForSource:()=>({x:520,y:0}),EMPTY_UPLOAD_NODE_WIDTH:316,EMPTY_UPLOAD_NODE_HEIGHT:194,savePromptDraftForCurrent:()=>{},render:()=>{},scheduleSave:()=>{},selectedId:'source',selectedIds:[],selectedImage:{},activeComposerSubject:source,lastComposerNodeId:'source',fetch:()=>assert.fail('must not generate')});
    context.createImageNodeAt=()=>{const node={id:'api',type:'smart-image',images:[]};context.nodes.push(node);return node;};
    context.connectInputNode=(from,to)=>{context.connection={from,to,kind:'input'};return true;};
    context.setPromptDraftForNode=(node,text)=>{node.promptDraftText=text;node.promptDraftHtml=text;};
    vm.runInContext(section(smart,'function createSmartViewAdjustApiNode(','function openSmartViewAdjustment('),context);
    context.source=source;context.compiled=compiled('lighting');
    const node=vm.runInContext('createSmartViewAdjustApiNode(source,1,compiled)',context);
    assert.equal(node.runSettings.engine,'api');assert.equal(node.runSettings.apiKind,'image');assert.equal(node.runSettings.count,1);
    assert.equal(node.runSettings.provider_id,'own-api');assert.equal(node.promptDraftText,context.compiled.prompt);
    assert.deepEqual([...node.blockedInputRefs],['source|0','source|2']);assert.equal(node.viewAdjust.sourceUrl,'selected.png');
    assert.equal(context.connection.from,source.id);assert.equal(node.pendingTasks,undefined);
    const restored=JSON.parse(JSON.stringify(node));assert.equal(restored.runSettings.model,'own-editor-model');assert.equal(restored.promptDraftText,node.promptDraftText);
    context.compiled={...compiled('angle'),selection:{providerId:'selected-api',model:'selected-custom-model'}};
    const selected=vm.runInContext('createSmartViewAdjustApiNode(source,1,compiled)',context);
    assert.equal(selected.runSettings.provider_id,'selected-api');assert.equal(selected.runSettings.model,'selected-custom-model');
});
