const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=readFileSync(path.join(__dirname,'../static/js/smart-canvas.js'),'utf8');
function section(start,end){let from=source.indexOf(start);const to=source.indexOf(end,from);assert.ok(from>=0&&to>from);if(source.slice(from-6,from)==='async ')from-=6;return source.slice(from,to);}
function editor(){
    const saves=[],messages=[],button={disabled:false};
    const e=vm.createContext({canvas:{id:'test',project:'default'},canvasId:'test',sourceProjectId:'default',returningToCanvasList:false,
        window:{location:{href:'editor'}},document:{querySelector:()=>button},savePromptDraftForCurrent(){},
        canvasListUrlForProject:id=>'list/'+id,setCanvasSaveError(){},toast:message=>messages.push(message),
        saveCanvas:()=>new Promise(resolve=>saves.push(resolve))});
    vm.runInContext(section('function backToCanvasList(',"clearCurrentCanvasBtn?.addEventListener"),e);
    return {e,saves,messages,button,back:()=>vm.runInContext('backToCanvasList()',e)};
}
test('smart return waits for successful draft save and rejects duplicate navigation',async()=>{
    const h=editor();const first=h.back();const second=h.back();
    assert.equal(h.e.window.location.href,'editor');assert.equal(h.saves.length,1);assert.equal(h.button.disabled,true);
    h.saves[0](true);await Promise.all([first,second]);assert.equal(h.e.window.location.href,'list/default');
});
test('failed smart save keeps the editor and lets the user retry',async()=>{
    const h=editor();const first=h.back();assert.equal(h.saves.length,1);h.saves[0](false);await first;
    assert.equal(h.e.window.location.href,'editor');assert.equal(h.button.disabled,false);assert.ok(h.messages.length);
    const retry=h.back();assert.equal(h.saves.length,2);h.saves[1](true);await retry;assert.equal(h.e.window.location.href,'list/default');
});
test('a smart caller waits for an in-flight save and persists the newer snapshot',async()=>{
    const requests=[],releases=[];
    const e=vm.createContext({canvasId:'test',canvas:{id:'test',updated_at:1},nodes:[{id:'prompt',text:'first'}],
        canvasSyncInFlight:false,canvasSaveQueued:false,saveTimer:null,redoStack:[],redoBaseContent:'',smartClientId:'test',
        canvasDefaultSmartSettings:{},initialSmartSettings:{},viewport:{},console:{error(){}},document:{title:'',getElementById:()=>null},
        clearTimeout(){},setTimeout(){return 1;},savePromptDraftForCurrent(){},mediaItemForStorage:x=>x,stripImageGenerationMeta:x=>x,
        settingsForStorage:x=>x,canvasForStorage:()=>({id:'test',nodes:structuredClone(e.nodes),updated_at:1}),
        rememberServerCanvasNodes(){},setCanvasSaveError(){},tr:x=>x,
        fetch:async(_url,init)=>{requests.push(JSON.parse(init.body));return new Promise(resolve=>releases.push(()=>resolve({ok:true,json:async()=>({canvas:{updated_at:requests.length+1,nodes:requests.at(-1).nodes}})})));}});
    vm.runInContext(section('async function saveCanvas(){','function imageMetaFromNode('),e);
    const first=vm.runInContext('saveCanvas()',e);e.nodes[0].text='newest';
    const second=vm.runInContext('saveCanvas()',e);releases[0]();await first;await new Promise(resolve=>setImmediate(resolve));
    assert.equal(requests.length,2);assert.equal(requests[1].nodes[0].text,'newest');releases[1]();assert.equal(await second,true);
});
