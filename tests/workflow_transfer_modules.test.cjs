const test=require('node:test');
const assert=require('node:assert/strict');
const classic=require('../static/js/canvas-workflow-transfer.js');
const smart=require('../static/js/smart-workflow-transfer.js');
for(const [label,api,method] of [['classic',classic,'canvasAssistantExportWorkflow'],['smart',smart,'smartCanvasAssistantExportWorkflow']]){
 function setup(){
  const records=[],stored=[{id:'a',type:'prompt',text:'中文',assistantExportReceipts:{old:true}},{id:'b',type:'image'}];
  const deps={canvas:{title:'fixture',connections:[{id:'edge',from:'a',to:'b'}]},connections:[{id:'edge',from:'a',to:'b'}],
   serializableCanvasNodes:()=>stored,canvasForStorage:()=>({nodes:stored,connections:[{id:'edge',from:'a',to:'b'}]}),
   downloadBlob:(blob,filename)=>records.push({blob,filename})};
  return {deps,records,stored,args:{actionId:'action',nodeIds:['a','b'],connectionIds:['edge'],scopeHash:'scope',beforeDownload:async()=>{}}};
 }
 test(`${label}: assistant export keeps scope, strips receipts, waits for revalidation`,async()=>{
  const {deps,records,stored,args}=setup();let checked=false;
  args.beforeDownload=async()=>{assert.equal(records.length,0);checked=true;};
  const result=await api[method](deps,args);
  assert.ok(checked);assert.equal(records.length,1);
  const payload=JSON.parse(await records[0].blob.text());
  assert.equal(payload.nodes[0].text,'中文');assert.equal(payload.nodes[0].assistantExportReceipts,undefined);
  assert.deepEqual(stored[0].assistantExportReceipts,{old:true});
  assert.deepEqual(payload.connections,[{id:'edge',from:'a',to:'b'}]);
  assert.equal(result.receipt.status,'download_started');assert.equal(result.receipt.scopeHash,'scope');
 });
 test(`${label}: changed scope or rejected revalidation never downloads`,async()=>{
  const {deps,records,args}=setup();
  await assert.rejects(api[method](deps,{...args,nodeIds:['missing']}),/节点范围已变化/);
  await assert.rejects(api[method](deps,{...args,connectionIds:[]}),/连线范围已变化/);
  await assert.rejects(api[method](deps,{...args,beforeDownload:async()=>{throw Error('changed');}}),/changed/);
  assert.equal(records.length,0);
 });
 test(`${label}: invalid archive never reaches download`,async()=>{
  const {deps,records,args}=setup();const calls=[];
  deps.fetch=async(url,init)=>{calls.push([url,JSON.parse(init.body)]);return {ok:true,blob:async()=>new Blob(['invalid']),headers:{get:()=> 'application/zip'}};};
  await assert.rejects(api[method](deps,{...args,includeResources:true}),/ZIP 文件无效/);
  assert.equal(calls[0][0],'/api/canvas-workflows/export');assert.equal(calls[0][1].include_resources,true);assert.equal(records.length,0);
 });
}
test('import normalization retains editor-specific legacy array support',()=>{
 const nodes=[{id:'a'}];
 assert.deepEqual(classic.normalizeImportedWorkflow({},nodes),{nodes:[],connections:[]});
 assert.deepEqual(smart.normalizeImportedSmartWorkflow({},nodes),{nodes,connections:[]});
 for(const [api,name] of [[classic,'normalizeImportedWorkflow'],[smart,'normalizeImportedSmartWorkflow']]){
  assert.deepEqual(api[name]({}, {workflow:{nodes,connections:[{from:'a',to:'a'}]}}),{nodes,connections:[{from:'a',to:'a'}]});
 }
 assert.deepEqual(smart.importedSmartLocalAssetUrls({}, {a:'/assets/x.png',nested:['/assets/x.png','/output/y.mp4','https://example.invalid/z']}),['/assets/x.png','/output/y.mp4']);
});
test('classic real host supports File construction when importing an asset URL',async()=>{
 const vm=require('node:vm');const {createTaskContext}=require('./canvas_task_test_helpers.cjs');
 const calls=[],errors=[];let serial=0;
 const context=createTaskContext({Blob,File,FormData,canvas:{id:'fixture'},canvasOpenGeneration:0,nodes:[],connections:[],selected:new Set(),lastMouseBoard:{x:0,y:0},missingAssetUrls:new Set(),
  window:{CanvasAudio:{detachTask(){},migrate(){}}},workflowTransferModal:null,workflowTransferToggle:null,workflowImportDropZone:null,
  fetch:async(url,init)=>{calls.push(url);if(url==='/assets/workflow.json')return {ok:true,blob:async()=>new Blob(['{}'],{type:'application/json'})};
   const file=init.body.get('file');assert.equal(file.name,'workflow.json');assert.equal(file.type,'application/json');
   return {ok:true,json:async()=>({nodes:[{id:'old',type:'prompt',text:'asset import'}],connections:[]})};},
  showErrorModal:message=>errors.push(message),canvasLocalAssetUrls:()=>[],pushUndo(){},uid:()=>String(++serial),serializableCanvasNode:n=>n,remapCanvasDepthCopies(){},sanitizeConnections(){},syncGeneratorInputs(){},render(){},scheduleSave(){},setStatus(){},refreshMissingCanvasAssets:async()=>{}});
 await vm.runInContext("CanvasWorkflowTransfer.importWorkflowAssetUrl(classicWorkflowTransferHost(), '/assets/workflow.json', 'workflow.json')",context);
 assert.deepEqual(errors,[]);assert.deepEqual(calls,['/assets/workflow.json','/api/canvas-workflows/import']);assert.equal(context.nodes[0].text,'asset import');
});
