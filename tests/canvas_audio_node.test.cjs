const {test}=require('node:test');
const assert=require('node:assert/strict');
const Audio=require('../static/js/canvas-audio.js');
const fs=require('node:fs'),vm=require('node:vm');
function productionFunction(file,start,end){
    const source=fs.readFileSync(require('node:path').join(__dirname,'../static/js',file),'utf8');
    const from=source.indexOf(start),to=source.indexOf(end,from);
    assert.ok(from>=0&&to>from);return source.slice(from,to);
}
const providers=[{id:'p',name:'P',enabled:true,audio_models:['asr'],audio_generation_models:['tts']}];
test('audio connections keep the downstream node generic until an audio model is chosen',()=>{
    const node={apiProvider:'image-p',model:'image-model',resolution:'2k'};
    assert.equal(Audio.mode(node,[{refs:[{kind:'audio',url:'/assets/a.wav'}]}]),false);
    assert.equal(Audio.mode(node,[{refs:[{kind:'image',url:'/assets/a.png'}]}]),false);
    assert.deepEqual(node,{apiProvider:'image-p',model:'image-model',resolution:'2k'});
    node.audioManualSelection=true;assert.equal(Audio.mode(node,[]),true);
});

test('audio downstream model catalog includes every configured text model on the selected platform',()=>{
    const context=vm.createContext({
        apiProviders:[{id:'p',image_models:['image-a'],chat_models:['chat-a'],video_models:['video-a'],audio_models:['asr-a'],audio_generation_models:['tts-a']}],
        uniqueModels:list=>[...new Set(list.map(value=>String(value||'').trim()).filter(Boolean))]
    });
    vm.runInContext(productionFunction('canvas.js','function providerAudioAnalysisModels(','function imageModelOptions('),context);
    assert.deepEqual(Array.from(vm.runInContext("providerAudioAnalysisModels('p')",context)),['chat-a']);
});
test('smart API audio analysis sends audio to the LLM endpoint',async()=>{
    const calls=[];
    const context=vm.createContext({
        fetch:async (url,options)=>{calls.push([url,JSON.parse(options.body)]);return {ok:true,json:async()=>({text:'音频摘要'})};},
        audioRefsOnly:refs=>(refs||[]).filter(ref=>ref?.url && ref.kind==='audio'),
        providerChatModels:()=>['text-model'],
        isApiLikeEngine:engine=>engine==='api',
        smartApiAudioMode:()=>{throw new Error('audio analysis must not enter audio generation branch');}
    });
    vm.runInContext(productionFunction('smart-canvas.js','async function generateUrlsForCurrentSettings','async function runCascadeStepIntoNode'),context);
    const result=await vm.runInContext(`generateUrlsForCurrentSettings({},'',[{url:'/assets/sample.wav',kind:'audio'}],{engine:'api',apiKind:'image',provider_id:'p',model:'text-model'})`,context);
    assert.equal(result.kind,'text');
    assert.equal(result.text,'音频摘要');
    assert.equal(result.urls.length,0);
    assert.equal(calls[0][0],'/api/canvas-llm');
    assert.deepEqual(calls[0][1].audios,['/assets/sample.wav']);
    assert.equal(calls[0][1].model,'text-model');
});
test('recognition and generation share model dropdown but show different parameters',()=>{
    assert.equal(Audio.operation({audioProvider:'p',audioModel:'asr'},providers),'recognition');
    const asr=Audio.parameterHtml({audioProvider:'p',audioModel:'asr'},providers);
    assert.ok(!asr.includes('data-audio-param="audioVoice"'));
    assert.ok(!asr.includes('data-audio-param="audioFormat"'));
    const tts=Audio.parameterHtml({audioProvider:'p',audioModel:'tts'},providers);
    assert.ok(tts.includes('data-audio-param="audioVoice"'));
});
test('copy detaches task identity while retaining model and material',()=>{
    const node={id:'copied',audioTaskId:'old',audioStatus:'running',running:true,audioModel:'asr',url:'/assets/a.wav'};
    Audio.detachTask(node);
    assert.equal(node.audioTaskId,undefined);assert.equal(node.running,false);
    assert.equal(node.audioModel,'asr');assert.equal(node.url,'/assets/a.wav');
});
test('copied API audio outputs remain references after task identity is detached',()=>{
    const node={type:'generator',audioTaskId:'old',generatedOutputs:[{url:'/output/copied.wav',kind:'audio'}]};
    Audio.detachTask(node);
    const context=vm.createContext({outputUrlValue:item=>item.url,mediaKindForOutputItem:item=>item.kind,outputImageName:()=>'',node});
    vm.runInContext(productionFunction('canvas.js','function generatedImageRefs(','function mediaRefsFromNode('),context);
    assert.equal(vm.runInContext('generatedImageRefs(node).length',context),1);
});
test('successful smart media completion clears earlier recognition text',()=>{
    const node={audioOutputText:'old text',images:[],pending:1};
    const context=vm.createContext({node,smartPendingTasks:()=>[],resultMediaUrls:x=>x,cleanHistoryImages:x=>x,stripImageGenerationMeta:x=>x,copyMediaSizeFields:(_x,result)=>result,nowMs:()=>10,mediaNodeDefaultScale:()=>1,MEDIA_NODE_DEFAULT_SCALE:1});
    vm.runInContext(productionFunction('smart-canvas.js','function finalizeSmartPendingTask(','async function resumeSmartPendingNode('),context);
    vm.runInContext("finalizeSmartPendingTask(node,'task',[{url:'/output/image.png',kind:'image'}])",context);
    assert.equal(node.audioOutputText,undefined);
    assert.equal(node.images[0].url,'/output/image.png');
});
test('smart audio logs retain the original audio task ID and selected model',()=>{
    const context=vm.createContext({run:{kind:'audio',settings:{engine:'api',model:'image-model'},audioRequest:{task_id:'canvas_audio_original',model:'tts',provider_id:'p'}}});
    vm.runInContext(productionFunction('smart-canvas.js','function smartRunRequestMeta(','function smartRunSnapshot('),context);
    assert.equal(vm.runInContext('smartRunRequestMeta(run).task_id',context),'canvas_audio_original');
    assert.equal(vm.runInContext('smartRunRequestMeta(run).model',context),'tts');
});
test('smart audio retry failure retains playable material and shows recovery state',()=>{
    const context=vm.createContext({window:{CanvasAudio:Audio},mediaKindForItem:item=>item.kind,node:{images:[{url:'/output/old.wav',kind:'audio'}],audioTaskId:'original',audioStatus:'unknown',audioError:'状态未知'}});
    vm.runInContext(productionFunction('smart-canvas-audio-host.js','function smartAudioBodyHtml(','function bindSmartAudioMedia('),context);
    const html=vm.runInContext('smartAudioBodyHtml(node)',context);
    assert.ok(html.includes('/output/old.wav'));assert.ok(html.includes('查询原任务'));assert.ok(html.includes('状态未知'));
});
test('smart API keeps original task query after audio source disconnects',()=>{
    const context=vm.createContext({window:{CanvasAudio:Audio},settings:{engine:'api',apiKind:'image'},smartAudioSources:()=>[],node:{audioTaskId:'original',audioStatus:'query-paused'}});
    vm.runInContext(productionFunction('smart-canvas-audio-host.js','function smartApiAudioMode(','function renderSmartApiAudioParams('),context);
    assert.equal(vm.runInContext('smartApiAudioMode(node)',context),true);
    assert.equal(vm.runInContext('smartApiAudioMode(null)',context),false);
});
test('completed smart audio task does not hide a later native media group',()=>{
    const context=vm.createContext({window:{CanvasAudio:Audio},node:{images:[{url:'/output/a.wav',kind:'audio'},{url:'/output/b.png',kind:'image'}],audioTaskId:'completed',audioStatus:'done'}});
    vm.runInContext(productionFunction('smart-canvas-audio-host.js','function smartAudioBodyHtml(','function bindSmartAudioMedia('),context);
    assert.equal(vm.runInContext('smartAudioBodyHtml(node)',context),'');
});
test('save exceptions stop submission and clear running state',async()=>{
    const node={};let submitted=0;const previousFetch=global.fetch;global.fetch=async()=>{submitted++;throw new Error('unexpected POST');};
    try{await assert.rejects(Audio.submit(node,'配音',[],{audioProvider:'p',audioModel:'tts'},{providers,render(){},save(){},persist:async()=>{throw new Error('disk');}}),/画布保存失败/);assert.equal(submitted,0);assert.equal(node.running,false);assert.equal(node.audioStatus,'failed');}
    finally{global.fetch=previousFetch;}
});
test('text-only audio generation can return to existing image controls',()=>{
    assert.ok(Audio.parameterHtml({audioManualSelection:true},providers,{allowImageReturn:true}).includes('value="__image__"'));
    assert.ok(!Audio.parameterHtml({},providers).includes('value="__image__"'));
});
test('active task keeps original query available after disconnect',()=>{
    assert.equal(Audio.mode({audioTaskId:'accepted',audioStatus:'query-paused'},[]),true);
    assert.equal(Audio.mode({audioTaskId:'accepted',audioStatus:'done'},[]),false);
});
test('returning to a saved canvas polls with its new node identity',async()=>{
    const oldNode={audioTaskId:'shared',audioStatus:'running'},newNode={...oldNode};let oldLive=true,done=0,resolveOld;
    const previousFetch=global.fetch;let calls=0;
    global.fetch=async()=>{calls++;if(calls===1)await new Promise(r=>{resolveOld=r;});return {ok:true,json:async()=>({status:'succeeded',result:{kind:'text',text:'结果'}})};};
    const host=()=>({live:()=>true,render(){},save(){},done(){done++;}});
    try{const oldJob=Audio.poll(oldNode,{...host(),live:()=>oldLive});oldLive=false;const newJob=Audio.poll(newNode,host());resolveOld();await Promise.all([oldJob,newJob]);assert.equal(done,1);assert.equal(newNode.audioStatus,'done');assert.equal(calls,2);}
    finally{global.fetch=previousFetch;}
});
test('lost submit response retains original ID and only queries thereafter',async()=>{
    const node={},calls=[];const previousFetch=global.fetch;
    global.fetch=async(url,options={})=>{calls.push([url,options.method || 'GET']);if(options.method==='POST')throw new Error('lost response');return {ok:true,json:async()=>({status:'unknown',error:'状态未知'})};};
    const host={providers,live:()=>true,render(){},save(){},persist:async()=>true,done(){throw new Error('must not succeed');}};
    try{await assert.rejects(Audio.submit(node,'配音',[],{audioProvider:'p',audioModel:'tts'},host),/lost response/);const id=node.audioTaskId;assert.equal(node.audioStatus,'query-paused');await assert.rejects(Audio.poll(node,host),/状态未知/);assert.equal(node.audioTaskId,id);assert.equal(node.audioStatus,'unknown');assert.deepEqual(calls.map(c=>c[1]),['POST','GET']);await assert.rejects(Audio.submit(node,'配音',[],{audioProvider:'p',audioModel:'tts'},host),/原音频任务/);assert.equal(calls.length,2);}
    finally{global.fetch=previousFetch;}
});
