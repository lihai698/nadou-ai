const test=require('node:test');
const assert=require('node:assert/strict');
const classic=require('../static/js/canvas-workflow-params.js');
const smart=require('../static/js/smart-workflow-params.js');
for(const [label,api] of [['classic',classic],['smart',smart]]){
 test(`${label}: workflow source selection and field defaults preserve false/zero`,()=>{
  const source={'1':{inputs:{seed:0}}};
  assert.equal(api.rhWorkflowJsonFromSources({},null,{},source),source);
  assert.equal(api.rhDefaultValue({}, {fieldValue:false}),'false');
  assert.equal(api.rhDefaultValue({}, {fieldValue:[0,2]}),'0');
  assert.equal(api.rhFieldKind({}, {fieldType:'FLOAT'}),'number');
  assert.equal(api.rhRandomEnabled({}, {fieldType:'INT',random_enabled:true}),true);
  assert.equal(api.rhIsWorkflowLinkValue({},['1',0]),true);
  assert.equal(api.rhIsWorkflowLinkValue({},[1,0]),false);
 });
 test(`${label}: media upload retains wallet and errors; remote filename is not reuploaded`,async()=>{
  const calls=[];
  const deps={fetch:async(url,init)=>{calls.push([url,JSON.parse(init.body)]);return {ok:true,json:async()=>({data:{fileName:'uploaded.png'}})};}};
  assert.equal(await api.rhUploadValueIfNeeded(deps,'/assets/test.png',{rhPayment:'wallet'}),'uploaded.png');
  assert.deepEqual(calls,[['/api/runninghub/upload-asset',{url:'/assets/test.png',useWallet:true}]]);
  assert.equal(await api.rhUploadValueIfNeeded(deps,'uploaded.png',{}),'uploaded.png');
  assert.equal(calls.length,1);
  deps.fetch=async()=>({ok:false,json:async()=>({detail:'fixture upload failed'})});
  await assert.rejects(api.rhUploadValueIfNeeded(deps,'/output/test.png',{}),/fixture upload failed/);
 });
 test(`${label}: workflow pruning leaves original untouched and disconnects removed node`,()=>{
  const original={'1':{inputs:{image:'old.png'}},'2':{inputs:{image:['1',0],seed:42}}};
  const result=api.rhPruneWorkflowForMissingFields({},original,[{nodeId:'1',fieldName:'image'}]);
  assert.deepEqual(result,{'2':{inputs:{seed:42}}});
  assert.equal(original['1'].inputs.image,'old.png');
  assert.deepEqual(original['2'].inputs.image,['1',0]);
 });
 test(`${label}: Comfy seed bounds and decimal precision`,()=>{
  const fn=api.comfyRandomValue||api.smartComfyRandomValue;
  for(let i=0;i<100;i++){
   const seed=fn({}, {input:'seed',max:1e15});
   assert.ok(Number.isInteger(seed)&&seed>=1&&seed<4294967295);
   const value=fn({}, {input:'strength',min:0,max:1,step:0.01});
   assert.ok(value>=0&&value<=1);
   assert.equal(Number(value.toFixed(2)),value);
  }
 });
}
test('editor option-list and link-only pruning differences stay explicit',()=>{
 const field={fieldType:'LIST',fieldValue:['first','second']},deps={RH_KNOWN_FIELD_OPTIONS:{}};
 assert.deepEqual(classic.rhExtractFieldOptions(deps,field),['first','second']);
 assert.equal(smart.rhExtractFieldOptions(deps,field),null);
 const workflow={'1':{inputs:{image:'old',latent:['3',0]}}};
 assert.deepEqual(classic.rhPruneWorkflowForMissingFields({},workflow,[{nodeId:'1',fieldName:'image'}]),{});
 assert.deepEqual(smart.rhPruneWorkflowForMissingFields({},workflow,[{nodeId:'1',fieldName:'image'}]),{'1':{inputs:{latent:['3',0]}}});
});
test('smart workflow updates only declared inputs; Comfy values preserve numeric conversion',()=>{
 const original={'1':{inputs:{seed:1}}};
 assert.deepEqual(smart.rhApplyNodeInfoListToWorkflow({},original,[{nodeId:'1',fieldName:'seed',fieldValue:7},{nodeId:'1',fieldName:'unknown',fieldValue:9}]),{'1':{inputs:{seed:7}}});
 assert.equal(original['1'].inputs.seed,1);
 const fields=[{id:'a',node:'1',input:'steps',type:'number',default:2},{id:'b',node:'1',input:'strength',type:'slider',step:0.01},{id:'c',node:'1',input:'choice',type:'dropdown'}];
 assert.deepEqual(smart.comfyParamsFromWorkflowValues({}, {fields},{a:'3.6',b:'0.35',c:'1e3'}),{'1':{steps:4,strength:0.35,choice:1000}});
});
