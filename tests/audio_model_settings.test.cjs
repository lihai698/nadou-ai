const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Audio=require('../static/js/canvas-audio.js');
const source=fs.readFileSync(require.resolve('../static/js/api-settings.js'),'utf8');
function fn(name){const start=source.indexOf('function '+name+'(');let end=source.indexOf('\nfunction ',start+1);const asyncEnd=source.indexOf('\nasync function ',start+1);if(asyncEnd>=0)end=Math.min(end<0?source.length:end,asyncEnd);return source.slice(start,end<0?undefined:end);}
test('picker imports selected audio through the existing lists and preserves saved selections',()=>{
 const item={image_models:['image'],chat_models:['chat'],video_models:['video'],audio_models:['saved-asr','shared-audio'],audio_generation_models:['saved-tts','shared-audio'],audio_timestamp_models:['saved-asr']};
 const elements=new Proxy({}, {get:(obj,key)=>obj[key] ||= {style:{},value:'',classList:{toggle(){}},querySelector:()=>({})}});
 const context=vm.createContext({item,provider:()=>item,audioTimestampModelsInput:elements.timestamps,document:{getElementById:id=>elements[id],querySelectorAll:()=>[],querySelector:()=>null},alert(){},modelDisplayName:id=>id,renderModels(){},renderMsLoras(){},setStatus(){},MODEL_KINDS:{image:'image_models',chat:'chat_models',video:'video_models',audio:'audio_models',audioGeneration:'audio_generation_models'},MODEL_LABELS:{image:'生图',chat:'LLM',video:'视频',audio:'音频识别',audioGeneration:'音频生成'}});
 vm.runInContext('let lastFetchedAll=[],lastFetchedSuggestion=null,lastFetchedModelNames={},pickerState={};'+fn('setFetchedModelState')+fn('openModelPicker')+fn('pickerCategories')+fn('applyModelPicker')+'\nfunction renderModelPicker(){} function closeModelPicker(){}',context);
 vm.runInContext("setFetchedModelState({all:['whisper-1','tts-1'],audio_models:['whisper-1'],audio_generation_models:['tts-1']});openModelPicker()",context);
 assert.equal(vm.runInContext("pickerState.category['tts-1']",context),'audioGeneration');
 assert.equal(vm.runInContext("pickerState.category['whisper-1']",context),'audio');
 assert.equal(vm.runInContext("pickerState.selected['tts-1']",context),false);
 vm.runInContext("pickerState.selected['tts-1']=true;pickerState.selected['whisper-1']=true;applyModelPicker()",context);
 assert.deepEqual(Array.from(item.audio_models),['whisper-1','saved-asr','shared-audio']);assert.deepEqual(Array.from(item.audio_generation_models),['tts-1','shared-audio','saved-tts']);
 assert.deepEqual(Array.from(item.image_models),['image']);assert.deepEqual(Array.from(item.audio_timestamp_models),['saved-asr']);
});
test('unconfigured audio has no misleading voice, format or advanced controls',()=>{
 const html=Audio.parameterHtml({},[]);
 assert.ok(!html.includes('data-audio-param="audioVoice"'));assert.ok(!html.includes('audio-advanced-toggle'));
 assert.ok(html.includes('API 设置'));assert.equal(Audio.ready({},[]),false);
});
test('configured generation displays Chinese labels and hides empty more parameters',()=>{
 const providers=[{id:'p',audio_generation_models:['tts-1']}];
 const html=Audio.parameterHtml({audioProvider:'p',audioModel:'tts-1'},providers);
 assert.ok(html.includes('默认音色（alloy）'));assert.ok(html.includes('格式：MP3'));assert.ok(html.includes('语速：1倍'));
 assert.ok(!html.includes('audio-advanced-toggle'));assert.ok(html.includes('value="alloy"'));
 assert.equal(Audio.ready({audioProvider:'p',audioModel:'tts-1'},providers),true);
 assert.equal(Audio.ready({audioProvider:'p',audioModel:'gone'},providers),false);
});
test('editing and deleting ASR models migrates timestamp and display name references',()=>{
 const item={audio_models:['old-asr'],audio_timestamp_models:['old-asr'],model_names:{'old-asr':'识别模型'}};
 const input={value:''};
 const context=vm.createContext({provider:()=>item,audioTimestampModelsInput:input,MODEL_KINDS:{image:'image_models',chat:'chat_models',video:'video_models',audio:'audio_models',audioGeneration:'audio_generation_models'},renderModels(){},renderMsLoras(){}});
 vm.runInContext(fn('modelProtocolStillUsed')+fn('updateModel')+fn('removeModel'),context);
 vm.runInContext("updateModel('audio',0,'renamed-asr')",context);
 assert.deepEqual(Array.from(item.audio_timestamp_models),['renamed-asr']);assert.equal(item.model_names['renamed-asr'],'识别模型');
 assert.equal(input.value,'renamed-asr');assert.equal(item.model_names['old-asr'],undefined);
 vm.runInContext("removeModel('audio',0)",context);
 assert.deepEqual(Array.from(item.audio_timestamp_models),[]);assert.equal(input.value,'');assert.equal(item.model_names['renamed-asr'],undefined);
});
test('more parameters only appear for an enabled protocol capability',()=>{
 for(const protocol of ['minimax-speech','minimax-music']){
  const html=Audio.parameterHtml({audioProvider:'p',audioModel:'generated'},[{id:'p',audio_generation_models:['generated'],audio_generation_protocol:protocol}]);
  assert.ok(html.includes('更多参数'));assert.ok(html.includes(protocol==='minimax-music'?'歌词':'音调'));
 }
 const html=Audio.parameterHtml({audioProvider:'p',audioModel:'generated'},[{id:'p',audio_generation_models:['generated'],audio_generation_instructions:true}]);
 assert.ok(html.includes('声音指令'));
});
