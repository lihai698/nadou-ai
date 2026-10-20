const {test}=require('node:test');
const assert=require('node:assert/strict');
const shared=require('../static/js/canvas-image-params.js');
const classic=require('../static/js/canvas-node-params.js');
const smart=require('../static/js/smart-node-params.js');
const online=require('../static/js/online-image-size-rules.js');

function host(mode='classic'){
    const h={resolveImageModel:x=>x,parseSizeValue:online.parseSizeValue};
    for(const [name,fn] of Object.entries(shared))if(typeof fn==='function')h[name]=(...args)=>fn(h,...args);
    h.parseRatioValue=value=>(mode==='classic'?classic:smart).parseRatioValue(h,value);
    return h;
}

test('shared size calculation preserves custom pixel limits and auto',()=>{
    const h=host();assert.equal(shared.apiImageSize(h,'custom','1k','16:9'),'1536x864');
    assert.equal(shared.apiImageSize(h,'square','auto'),'auto');
    assert.equal(shared.apiImageSize(h,'','custom','',' 777x555 '),'777x555');
    assert.deepEqual(online.parseSizeValue('640 * 360'),{width:'640',height:'360'});
});

test('classic and smart retain their different accepted ratio syntax',()=>{
    assert.equal(classic.parseRatioValue({},'1.5'),1.5);assert.equal(smart.parseRatioValue({},'1.5'),0);
    assert.equal(smart.parseRatioValue({},'3x2'),1.5);assert.equal(classic.parseRatioValue({},'3x2'),null);
});

test('explicit custom dimensions survive model defaults and preset clears stale dimensions',()=>{
    const h=host(),node={model:'gpt-image-2',ratio:'square',resolution:'4k'};
    classic.setCanvasGeneratorSizeFields(h,node,{customWidth:512,customHeight:768});
    assert.equal(node.customSize,'512x768');assert.equal(node.resolution,'custom');assert.equal(node._apiResolutionUserSet,true);
    classic.setCanvasGeneratorSizeFields(h,node,{resolution:'2k'});
    assert.equal(node.customSize,'');assert.equal(node.customWidth,'');assert.equal(node.ratio,'square');
});

test('source ratio is derived through injected image dimensions',async()=>{
    const h=host();h.getImageDimensions=async()=>({width:640,height:960});const node={ratio:'source',resolution:'1k'};
    assert.equal(await classic.generatorSizeForRun(h,node,[{url:'fixture.png'}]),'1024x1536');assert.equal(node.customRatio,'2:3');
});

test('smart video frame mode and explicit user multimodal choice are preserved',()=>{
    const frame={videoUseFrameRoles:true,videoMultimodal:true};smart.normalizeSmartVideoModeSettings({},frame,true);assert.equal(frame.videoMultimodal,false);
    const explicit={videoUseFrameRoles:false,videoMultimodal:false,_videoMultimodalUserSet:true};smart.normalizeSmartVideoModeSettings({},explicit,true);assert.equal(explicit.videoMultimodal,false);
});

test('legacy smart container converts data without mutating original object',()=>{
    const original={id:'old',type:'smart-container',inputImage:{url:'fixture.png'},steps:[1],extra:'keep'};
    const h={stripImageGenerationMeta:x=>x,mediaKindForItem:()=> 'image',tr:x=>x};const result=smart.normalizeLegacySmartNode(h,original);
    assert.equal(result.type,'smart-image');assert.equal(result.images[0].url,'fixture.png');assert.equal(result.extra,'keep');assert.equal(result.steps,undefined);assert.deepEqual(original.steps,[1]);
});

test('smart loop count normalization copies image settings and retains video count',()=>{
    const original={engine:'api',apiKind:'image',count:8};const result=smart.smartLoopRoundSettings({},original,{nodeId:'loop'});
    assert.equal(result.count,1);assert.equal(original.count,8);
    assert.equal(smart.smartLoopRoundSettings({}, {...original,apiKind:'video'},{nodeId:'loop'}).count,8);
});
