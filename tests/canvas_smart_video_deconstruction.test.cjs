const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const smart=fs.readFileSync(path.join(__dirname,'../static/js/smart-canvas.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../static/smart-canvas.html'),'utf8');
const host=fs.readFileSync(path.join(__dirname,'../static/js/canvas-video-deconstruction-host.js'),'utf8');
const model=fs.readFileSync(path.join(__dirname,'../static/js/canvas-video-deconstruction-model.js'),'utf8');
const modelApi=require('../static/js/canvas-video-deconstruction-model.js');
const ui=fs.readFileSync(path.join(__dirname,'../static/js/canvas-video-deconstruction-ui.js'),'utf8');
const vm=require('node:vm');
function runtime(){
  let undo=0,serial=0;
  const source={id:'v',type:'smart-image',x:10,y:20,w:316,images:[{id:'result',url:'/assets/v.mp4',kind:'video'}]};
  const state={window:{CanvasVideoDeconstructionHost:require('../static/js/canvas-video-deconstruction-host.js'),CanvasVideoDeconstructionModel:modelApi,CanvasVideoDeconstructionUI:{closeAll(){}}},nodes:[source],canvasId:'A',canvas:{id:'A',connections:[]},viewport:{scale:1},uid:p=>`${p}-${++serial}`,pushUndo:()=>undo++,saveCanvas:async()=>true,render(){},imageForDisplay:v=>v,mediaKindForItem:v=>v.kind,nodeRect:n=>({x:n.x,y:n.y,width:n.w||316}),syncSelectionUi(){},imageProviders:()=>[{id:'p',enabled:true}],providerImageModels:()=>['m'],cloneSmartSettings:v=>({...v}),initialSmartSettings:{},SIZE_MAP:{square:{}},API_RATIO_VALUES:{square:'1:1'},selectedId:'',selectedIds:[],selectedImage:{},runGeneration:async options=>{state.runs.push({id:state.selectedId,options});},runs:[],toast(){},Date,setTimeout};
  vm.createContext(state);
  vm.runInContext(smart.slice(smart.indexOf('function invalidateSmartVideoDeconstruction(){'),smart.indexOf('window.onload = async')),state);
  state.initSmartVideoDeconstructionBridge();
  state.host=state.window.CanvasVideoDeconstructionBridge;
  state.source=state.host.sourceFor('v',0,'/assets/v.mp4','视频');
  state.undo=()=>undo;
  return state;
}

test('智能画布加载视频拆解共用模块并提供入口扩展',()=>{
  for(const file of ['canvas-video-deconstruction-model.js','canvas-video-deconstruction-host.js','canvas-video-deconstruction-ui.js']) assert.match(html,new RegExp(file.replaceAll('.','\\.')));
  assert.match(smart,/initSmartVideoDeconstructionBridge/);
  assert.match(smart,/onOpenCuts/);
  assert.match(smart,/onOpenTable/);
  assert.match(smart,/smart-shot-table/);
});

test('智能画布镜头表使用专用节点类型和原生生图链适配器',()=>{
  assert.match(host,/adapter\.tableType\|\|'shot-table'/);
  assert.match(host,/adapter\.createGenerationChain/);
  assert.match(smart,/tableType:'smart-shot-table'/);
  assert.match(smart,/type:'smart-prompt'/);
  assert.match(smart,/shotTableOrigin/);
});

test('复制映射识别普通与智能镜头表',()=>{
  assert.match(model,/\['shot-table','smart-shot-table'\]/);
  assert.match(ui,/\.shot-table-node,\.smart-shot-table-node/);
});

test('智能画布复制镜头表调用真实归属重映，清除失效生成归属并中断任务',()=>{
  assert.match(smart,/window\.CanvasVideoDeconstructionModel\?\.remapCopies\(copies, idMap\)/g);
  const table=modelApi.createTable({nodeId:'source',resultId:'result',sourceUrl:'/output/v.mp4'});
  table.rows=modelApi.buildShotRows([],2);
  table.generationMap={'fp:shot-1':{promptId:'p',generatorId:'g',outputId:'o'}};
  table.task={status:'running',taskId:'analysis'};
  const copies=[{id:'table-copy',type:'smart-shot-table',shotTableData:table},{id:'p2',type:'smart-prompt'},{id:'g2',type:'smart-image',shotTableOrigin:{tableId:'table-copy'}}];
  modelApi.remapCopies(copies,new Map([['source','source-copy'],['p','p2'],['g','g2'],['o','o2'],['table-copy','table-copy-2']]));
  assert.equal(copies[0].shotTableData.source.nodeId,'source-copy');
  assert.equal(copies[0].shotTableData.task.status,'interrupted');
  assert.equal(copies[0].shotTableData.generationMap['fp:shot-1'].generatorId,'g2');
  assert.equal(copies[2].shotTableOrigin.tableId,'table-copy-2');
});

test('智能真实桥接抽帧使用原生组图库，部分成功与重复响应保持所有帧',()=>{
  const e=runtime(),ctx=e.host.context(e.source);
  const frames=Array.from({length:5},(_,index)=>({index,seconds:index,url:`/output/${index}.jpg`}));
  e.host.landFrames(ctx,{operationId:'frames',frames:frames.slice(0,2)});
  e.host.landFrames(ctx,{operationId:'frames',frames});
  const group=e.nodes.find(n=>n.frameGroupOperationId==='frames');
  assert.equal(group.type,'smart-group');assert.equal(group.x,422);
  assert.equal(group.images.length,5);assert.equal(group.w,1184);assert.equal(e.nodes.length,2);
  e.host.landFrames(ctx,{operationId:'frames',frames});assert.equal(group.images.length,5);assert.equal(e.undo(),2);
});

test('智能镜头表原生链只连提示词，重复生成不重建且保留手改提示',async()=>{
  const e=runtime(),table=e.host.ensureTable(e.source);
  table.shotTableData.rows=modelApi.buildShotRows([],2);
  table.shotTableData.rows[0].imagePrompt='初始提示';
  const a=e.host.materializeRows(table.id,['shot-1'],{providerId:'p',model:'m'});
  const prompt=e.nodes.find(n=>n.type==='smart-prompt'),image=e.nodes.find(n=>n.id===a.generatorIds[0]);
  prompt.text='手工修改';
  const b=e.host.materializeRows(table.id,['shot-1'],{providerId:'p',model:'m'});
  assert.equal(b.createdIds.length,0);assert.equal(prompt.text,'手工修改');assert.equal(image.runSettings.provider_id,'p');
  assert.equal(e.canvas.connections.filter(c=>c.to===image.id).length,1);assert.equal(e.canvas.connections.find(c=>c.to===image.id).from,prompt.id);
  await e.host.runGenerators(a.generatorIds);
  assert.equal(e.runs[0].id,image.id);assert.equal(e.runs[0].options.shotTableRun,true);
  assert.equal(e.host.ratioOptions[0].label,'1:1');
});

test('智能撤销或切画布使旧抽帧上下文失效',()=>{
  const e=runtime(),ctx=e.host.context(e.source);
  e.invalidateSmartVideoDeconstruction();
  assert.equal(e.host.landFrames(ctx,{operationId:'old',frames:[{index:0,url:'/output/old.jpg'}]}),false);
  assert.equal(e.nodes.length,1);
});

test('智能缩放接入传递宿主，首屏桥未初始化时不阻断加载',()=>{
  const e=runtime();let scaled;
  Object.assign(e,{world:{style:{},classList:{toggle(){}}},shell:{style:{}},renderMinimap(){},scheduleSmartImageResolutionSync(){}});
  e.window.CanvasVideoDeconstructionUI.updateScale=host=>{scaled=host.scale();};
  vm.runInContext(smart.slice(smart.indexOf('function applyViewport(){'),smart.indexOf('function screenToWorld(')),e);
  e.viewport.scale=.3;e.applyViewport();assert.equal(scaled,.3);
  delete e.window.CanvasVideoDeconstructionBridge;e.applyViewport();
});

test('智能批量生成不读取其他选中节点的编辑器草稿',async()=>{
  const node={id:'generator'},state={nodes:[node],selectedNode:()=>node,smartNodeInFlight:()=>false,confirmSmartUnknownResubmission:()=>true,smartLoopContext:null,buildPromptRequest:()=>{throw Error('错误读取当前编辑器');},buildPromptRequestForNode:(target,refs)=>{assert.equal(target,node);assert.equal(refs.length,0);throw Error('已读取目标节点草稿');}};
  vm.createContext(state);
  vm.runInContext(smart.slice(smart.indexOf('async function runGeneration(options={}){'),smart.indexOf('\nasync function ',smart.indexOf('async function runGeneration(options={}){')+20)),state);
  await assert.rejects(state.runGeneration({shotTableRun:true}),/已读取目标节点草稿/);
});
