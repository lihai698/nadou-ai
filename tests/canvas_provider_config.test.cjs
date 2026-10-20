const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createTaskContext}=require('./canvas_task_test_helpers.cjs');
const source=readFileSync(path.join(__dirname,'../static/js/canvas.js'),'utf8');
const smartSource=readFileSync(path.join(__dirname,'../static/js/smart-canvas.js'),'utf8');
function entries(e,names,code=source){
    for(const name of names){
        let start=code.indexOf(`function ${name}(`);assert.ok(start>=0);
        if(code.slice(start-6,start)==='async ') start-=6;
        vm.runInContext(code.slice(start,code.indexOf('\n}',start)+2),e);
    }
}
function setup(extra={}){
    return createTaskContext({apiProviders:[],imageModels:['mock-image'],chatModels:['mock-chat'],videoModels:[],
        DEFAULT_VIDEO_MODELS:['mock-video'],models:{},localChatModels:[],localImageModels:[],
        hasManagedChatModels:false,hasManagedImageModels:false,managedProviderId:'mock',...extra});
}
test('provider models never borrow a video list from a different platform',()=>{
    const e=setup({apiProviders:[{id:'a',video_models:['a-video','a-video']},{id:'b',video_models:['b-video']}]});
    entries(e,['providerVideoModels']);
    assert.deepEqual([...e.providerVideoModels('a')],['a-video']);
    assert.deepEqual([...e.providerVideoModels('missing')],[]);
});

test('smart provider replacement updates chat fallback without borrowing image models',()=>{
    const e=setup({apiProviders:[{id:'a',chat_models:['a-chat'],image_models:['a-image']} ]});
    entries(e,['resolveChatProviderId','providerImageModels'],smartSource);
    assert.equal(e.resolveChatProviderId('a'),'a');
    e.apiProviders=[{id:'b',chat_models:['b-chat'],image_models:['b-image']}];
    assert.equal(e.resolveChatProviderId('a'),'b');
    assert.deepEqual([...e.providerImageModels('a')],[]);
    assert.deepEqual([...e.providerImageModels('b')],['b-image']);
});

test('smart provider sanitization mutates the current settings and clears only platform binding when leaving Volcengine',()=>{
    const settings={engine:'volcengine',apiKind:'video',videoProvider:'old',videoModel:'removed'};
    const e=setup({settings,apiProviders:[{id:'volcengine',video_models:['mock-video']} ]});
    entries(e,['sanitizeSmartApiSelection','clearVolcengineSelectionOutsideVolcengine'],smartSource);
    assert.equal(e.sanitizeSmartApiSelection(),settings);
    assert.equal(settings.videoProvider,'volcengine');assert.equal(settings.videoModel,'mock-video');
    settings.engine='api';e.clearVolcengineSelectionOutsideVolcengine();
    assert.equal(settings.videoProvider,'');assert.equal(settings.videoModel,'mock-video');
});

test('smart config publishes provider state before workflow loading completes',async()=>{
    const events=[];let finishWorkflow;
    const workflow=new Promise(resolve=>{finishWorkflow=resolve;});
    const e=setup({settings:{engine:'volcengine',apiKind:'video'},comfyInstanceCount:1,comfyWorkflows:[],
        runningHubWorkflowCache:{old:true},lastConfigRefreshAt:0,
        fetch:async url=>({json:async()=>url==='/api/config'?{
            api_providers:[{id:'volcengine',video_models:['fresh-video']}],comfy_instances:[{},{}]
        }:workflow}),updateProviderModels:()=>events.push(e.settings.videoModel),
        toast:()=>assert.fail('unexpected config failure'),tr:key=>key});
    entries(e,['loadConfig'],smartSource);
    const pending=e.loadConfig();await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(events,['fresh-video']);assert.equal(e.comfyInstanceCount,2);
    finishWorkflow({workflows:[{name:'fresh-workflow'}]});await pending;
    assert.deepEqual(events,['fresh-video','fresh-video']);assert.equal(e.comfyWorkflows[0].name,'fresh-workflow');
    assert.equal(Object.keys(e.runningHubWorkflowCache).length,0);assert.ok(e.lastConfigRefreshAt>0);
});
test('replacing provider configuration is observed by the real host and node sanitization',()=>{
    const e=setup({apiProviders:[{id:'a',enabled:true,video_models:['a-video']}]});
    entries(e,['resolveVideoProviderId','sanitizeVideoNodeProviderModel']);
    assert.equal(e.resolveVideoProviderId('a'),'a');
    e.apiProviders=[{id:'b',enabled:true,video_models:['b-video']}];
    const node={type:'video',apiProvider:'a',model:'a-video'};e.sanitizeVideoNodeProviderModel(node);
    assert.equal(node.apiProvider,'b');assert.equal(node.model,'b-video');
});
test('configuration loading writes new lists, workflow cache and model aliases into shared state',async()=>{
    const requests=[];
    const e=setup({CUSTOM_IMAGE_MODELS_KEY:'custom',MANAGED_IMAGE_MODELS_KEY:'images',MANAGED_CHAT_MODELS_KEY:'chat',
        localStorage:{getItem:()=>null},msChatModels:[],comfyBackendCount:1,comfyWorkflows:[],
        runningHubWorkflowCache:{old:true},fetch:async url=>{requests.push(url);return {json:async()=>url==='/api/config'?{
            image_models:['nano-mock','mock-image'],chat_models:['mock-chat'],video_models:['mock-video'],ms_chat_models:['mock-ms'],
            comfy_instances:[{},{}],api_providers:[{id:'mock',enabled:true,image_models:['mock-image']}]
        }:{workflows:[{name:'mock-workflow'}]}};}});
    entries(e,['loadConfig']);await e.loadConfig();
    assert.deepEqual(requests,['/api/config','/api/workflows']);
    assert.equal(e.apiProviders[0].id,'mock');assert.equal(e.comfyBackendCount,2);
    assert.equal(e.comfyWorkflows[0].name,'mock-workflow');assert.equal(Object.keys(e.runningHubWorkflowCache).length,0);
    assert.equal(e.models.nano,'nano-mock');assert.equal(e.models.gpt,'mock-image');
    assert.deepEqual([...e.msChatModels],['mock-ms']);
});
