const test=require('node:test'),assert=require('node:assert/strict');
const classic=require('../static/js/canvas-workflow-config.js'),smart=require('../static/js/smart-workflow-config.js');
for(const [label,api] of [['classic',classic],['smart',smart]]){
 test(`${label}: RH cache uses encoded ID and reuses successful response`,async()=>{
  const calls=[],value={fields:[{nodeId:'1'}]};const deps={runningHubWorkflowCache:{},fetch:async url=>{calls.push(url);return {ok:true,json:async()=>({workflow:value})};}};
  assert.equal(await api.ensureRunningHubWorkflow(deps,' a/b '),value);
  assert.equal(await api.ensureRunningHubWorkflow(deps,'a/b'),value);
  assert.deepEqual(calls,['/api/runninghub/workflows/a%2Fb']);
  assert.equal(await api.ensureRunningHubWorkflow(deps,''),null);
 });
 test(`${label}: missing RH workflow does not fetch remote without explicit option`,async()=>{
  const calls=[];const deps={runningHubWorkflowCache:{},fetch:async(url,options)=>{calls.push([url,options]);return {ok:false};}};
  assert.equal(await api.ensureRunningHubWorkflow(deps,'gone'),null);
  assert.deepEqual(calls,[['/api/runninghub/workflows/gone',undefined]]);
  assert.equal(deps.runningHubWorkflowCache.gone,undefined);
 });
 test(`${label}: Comfy cache reads encoded filename once`,async()=>{
  const calls=[],data={config:{fields:[{id:'seed'}]}};
  const deps={comfyWorkflows:[{name:'中文 workflow.json'}],comfyWorkflowCache:{},fetch:async url=>{calls.push(url);return {ok:true,json:async()=>data};}};
  assert.equal(await api.ensureComfyWorkflow(deps,'中文 workflow.json'),data);
  assert.equal(await api.ensureComfyWorkflow(deps,'中文 workflow.json'),data);
  assert.deepEqual(calls,['/api/workflows/'+encodeURIComponent('中文 workflow.json')]);
 });
}
test('classic removed Comfy workflows clear only affected nodes and cache',()=>{
 let saves=0;const deps={comfyWorkflows:[{name:'keep'}],comfyWorkflowCache:{gone:{},keep:{}},nodes:[{type:'comfy',comfyWorkflow:'gone'},{type:'comfy',comfyWorkflow:'keep'},{type:'prompt',comfyWorkflow:'gone'}],scheduleSave:()=>saves++};
 classic.pruneMissingComfyWorkflows(deps);assert.equal(saves,1);assert.equal(deps.nodes[0].comfyWorkflow,'');assert.equal(deps.nodes[1].comfyWorkflow,'keep');assert.equal(deps.nodes[2].comfyWorkflow,'gone');assert.equal(deps.comfyWorkflowCache.gone,undefined);
 classic.pruneMissingComfyWorkflows(deps);assert.equal(saves,1);
});
test('smart explicit remote fallback uses saved title and optional input mode',async()=>{
 const calls=[];const deps={apiProviders:[{id:'runninghub',rh_workflows:[{id:'w',title:'Saved',note:'note',optionalImageMode:'keep'}]}],runningHubWorkflowCache:{},fetch:async(url,options)=>{calls.push([url,options]);return options?{ok:true,json:async()=>({data:{fields:[],workflowJson:{'1':{inputs:{seed:3}}}}})}:{ok:false};}};
 const result=await smart.ensureRunningHubWorkflow(deps,'w',{fetchRemote:true});
 assert.deepEqual(JSON.parse(calls[1][1].body),{workflowId:'w',title:'Saved',description:'note'});assert.equal(result.optionalImageMode,'keep');assert.equal(result.title,'Saved');assert.deepEqual(result.workflowJson,{'1':{inputs:{seed:3}}});
});
test('selection differences and explicit run settings remain intact',()=>{
 const provider={id:'runninghub',rh_apps:[{appId:'first'},{appId:'hidden',hidden:true},{appId:'off',enabled:false}]};
 const deps={apiProviders:[provider],uniqueModels:items=>[...new Set(items)],settings:{rhConfigKey:'app:missing'}};
 assert.deepEqual(classic.runningHubAllEntries(deps).map(x=>x.id),['first']);
 assert.equal(classic.rhSelectedEntryRef(deps,{rhConfigKey:'app:missing'}),null);
 assert.equal(smart.selectedRunningHubRef(deps).id,'first');assert.equal(deps.settings.rhConfigKey,'app:first');
 const other={rhConfigKey:'app:missing'};assert.equal(smart.selectedRunningHubRef(deps,other).id,'first');assert.equal(other.rhConfigKey,'app:missing');
 provider.enabled=false;assert.ok(classic.runningHubProvider(deps));assert.equal(smart.runningHubProvider(deps),null);
});
test('classic saved fields win while cached workflow JSON wins',()=>{
 const entry={workflowId:'w',fields:[{nodeId:'saved'}],title:'Saved',workflowJson:{saved:true},optionalImageMode:'keep'};
 const cached={fields:[{nodeId:'cached'}],title:'Cached',workflowJson:{cached:true}};
 const deps={apiProviders:[{id:'runninghub',rh_workflows:[entry]}],runningHubWorkflowCache:{w:cached},rhCurrentKind:()=> 'workflow',rhEntryFields:e=>e.fields||[],rhWorkflowJsonFromSources:(...items)=>items.find(x=>x&&Object.keys(x).length)||{}};
 const result=classic.currentRunningHubWorkflowConfig(deps,{workflowId:'w'});
 assert.equal(result.title,'Saved');assert.equal(result.fields,entry.fields);assert.equal(result.workflowJson,cached.workflowJson);assert.equal(result.optionalImageMode,'keep');
});
test('smart per-run fields avoid fetching and retain per-run workflow JSON',async()=>{
 const entry={workflowId:'w',fields:[{nodeId:'saved'}],workflowJson:{saved:true}};
 const source={rhConfigKey:'workflow:w',rhFields:[{nodeId:'run'}],rhWorkflowJson:{run:true},rhOptionalImageMode:'keep'};
 const deps={settings:{},apiProviders:[{id:'runninghub',rh_workflows:[entry]}],runningHubWorkflowCache:{},rhWorkflowJsonFromSources:(...items)=>items.find(x=>x&&Object.keys(x).length)||{},fetch:()=>{throw Error('unexpected request');}};
 const result=await smart.currentRunningHubWorkflowConfig(deps,source);
 assert.equal(result.fields,source.rhFields);assert.equal(result.workflowJson,source.rhWorkflowJson);assert.equal(result.optionalImageMode,'keep');assert.deepEqual(deps.settings,{});
});
test('classic app field refresh preserves explicit values and always clears busy state',async()=>{
 const node={id:'n',webappId:' a/b ',rhParams:{'1::seed':{value:'explicit'}},runError:'old'};let saves=0;const calls=[],alerts=[];
 const deps={nodes:[node],refreshNodes(){},scheduleSave:()=>saves++,rhParamKey:(a,b)=>a+'::'+b,rhDefaultValue:f=>String(f.fieldValue),tr:key=>key,alert:value=>alerts.push(value),fetch:async url=>{calls.push(url);return {ok:true,json:async()=>({data:{nodeInfoList:[{nodeId:'1',fieldName:'seed',fieldValue:5},{nodeId:'2',fieldName:'steps',fieldValue:12}]}})};}};
 assert.equal(await classic.rhFetchAppInfo(deps,'n'),true);assert.equal(node.rhFetching,false);assert.equal(node.rhParams['1::seed'].value,'explicit');assert.equal(node.rhParams['2::steps'].value,'12');assert.equal(node.runError,'');assert.equal(saves,1);assert.equal(calls[0],'/api/runninghub/app-info?webappId=a%2Fb');
 deps.fetch=async()=>{throw Error('fixture failure');};assert.equal(await classic.rhFetchAppInfo(deps,'n',false),false);assert.equal(node.rhFetching,false);assert.equal(saves,1);assert.deepEqual(alerts,[]);
});
