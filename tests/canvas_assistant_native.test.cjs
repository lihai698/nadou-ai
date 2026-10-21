const {createTaskContext}=require('./canvas_task_test_helpers.cjs');
const test=require('node:test');
const assert=require('node:assert/strict');
const native=require('../static/js/canvas-assistant-native.js');
const clipModel=require('../static/js/canvas-clip-model.js');
const shotModel=require('../static/js/canvas-video-deconstruction-model.js');
const shotHost=require('../static/js/canvas-video-deconstruction-host.js');
const fs=require('node:fs');
const vm=require('node:vm');

test('两种画布逐镜处理使用真实LLM入口并保存本次结果来源',async()=>{
 for(const smart of [false,true]){
  const node={id:'llm',type:smart?'smart-prompt':'llm',text:'',outputText:'',llmEnabled:true,llmProvider:'chosen',model:'text',llmModel:'text',llmInstruction:'处理上游',shotPromptOrigin:{tableId:'table',rowId:'one',sourceNodeId:'source'}};
  let calls=0;
  const ctx=createTaskContext({nodes:[node,{id:'source',text:'本镜素材'}],connections:[],cascadeTargetIdFromOptions:()=>'',llmInputText:()=> '本镜素材',llmInputAudios:()=>[],refreshNodes:()=>{},callCanvasLLM:async(n,input,refs,opts)=>{calls++;opts.onModelSelected({provider:'chosen',model:'text'});return '模型处理的本镜提示词';},scheduleGeneratorInputSync:()=>{},scheduleSave:()=>{},isCascadeAbortError:()=>false,alert:()=>{},promptNodeLLMInputText:()=> '本镜素材',render:()=>{},resolveChatProviderId:x=>x,resolveChatModel:x=>x,promptNodeInputMediaForLLM:()=>[],imageRefsOnly:()=>[],videoRefsOnly:()=>[],toast:()=>{},tr:x=>x,fetch:async()=>{calls++;return {ok:true,json:async()=>({text:'模型处理的本镜提示词'})};}});
  if(!smart)Object.assign(ctx,{llmInputImages:()=>[],llmInputVideos:()=>[],cascadeFetch:ctx.fetch});
  const name=smart?'runPromptLLMNode':'runLLMNode',source=fs.readFileSync(require.resolve(smart?'../static/js/smart-canvas.js':'../static/js/canvas.js'),'utf8');
  vm.runInContext(nativeFunction(source,name),ctx);
  if(smart)node.assistantNativeRun={};
  await ctx[name](node.id,{assistantNativeActionId:'shot-run',beforeSubmit:async()=>{}});
  assert.equal(calls,1);assert.equal(node.shotPromptResult.sourceText,'本镜素材');assert.equal(node.shotPromptResult.outputText,'模型处理的本镜提示词');assert.equal(node.shotPromptResult.model,'text');assert.equal(node.storyAnalysisResult,undefined);
 }
});

function setup(){
 const state={id:'canvas',updatedAt:7,kind:'classic',nodes:[],receipts:{}};
 const calls=[];
 const adapter={getState:()=>state,save:async()=>true,markReceipt:(id,value)=>state.receipts[id]=value,
  preflight:()=>true,perform:async proposal=>{calls.push(proposal.id);const n={id:'made',type:'prompt',text:'真实提示词'};state.nodes.push(n);return {nodeIds:[n.id],status:'saved'};}};
 return {state,calls,adapter,bridge:native.create(adapter),proposal:{id:'intent',canvasId:'canvas',updatedAt:7,action:'create',arguments:{type:'prompt'},chargeable:false}};
}

function smartImageRunSetup(){
 const node={id:'im',type:'smart-image',images:[],runSettings:{engine:'api',apiKind:'image',provider_id:'manual',model:'selected',count:2}};
 const s=editorSetup(node),submitted=[];let saves=0,queries=0;
 const source=fs.readFileSync(require.resolve('../static/js/smart-canvas.js'),'utf8');
 const ctx=createTaskContext({nodes:s.state.nodes,smartNodeInFlight:()=>false,smartSettingsForNode:n=>({...n.runSettings}),smartApiAudioMode:()=>false,buildPromptRequestForNode:()=>({prompt:'原生正文',refs:[{url:'/output/ref.png',kind:'image'}]}),smartLoopContext:null,cloneSmartSettings:x=>JSON.parse(JSON.stringify(x)),sizeForRun:()=> '1536x1024',API_RATIO_VALUES:{},imageRefsOnly:x=>x.filter(v=>v.kind==='image'),SMART_REFERENCE_IMAGE_MAX:8,fetch:async(url,opts)=>{submitted.push(JSON.parse(opts.body));const id='original-'+submitted.length;return {ok:true,json:async()=>({task_id:id})};},recordSmartTaskSubmission:()=>'',saveSmartAcceptedTasksBeforeQuery:async()=>{saves++;return true;},resumeSmartPendingNode:async n=>{queries++;n.images=n.pendingTasks.map(t=>({url:'/output/'+t.taskId+'.png',kind:'image'}));n.pendingTasks=[];n.pending=0;},render:()=>{},scheduleSave:()=>{},nowMs:()=>10});
 for(const name of ['runApiGeneration','runSmartAssistantNativeImage','runGeneration'])vm.runInContext(nativeFunction(source,name),ctx);
 ctx.rememberSmartAcceptedTasks=()=>true;
 s.adapter.runNode=(n,opts)=>ctx.runGeneration({...opts,assistantNativeNodeId:n.id});
 return {...s,node,submitted,ctx,saves:()=>saves,queries:()=>queries,p:{...s.proposal,nodeId:'im',action:'run',chargeable:true,arguments:{maxCalls:2},runSettings:{taskKind:'image',maxCalls:2},check:async()=>true}};
}

function smartGroupRunSetup(){
 const s=smartImageRunSetup(),events=[],source=fs.readFileSync(require.resolve('../static/js/smart-canvas.js'),'utf8');
 Object.assign(s.node,{type:'smart-group',items:['member'],images:[{url:'/assets/keep.png'}]});
 s.state.nodes.push({id:'member',type:'smart-prompt',text:'分组正文'});
 Object.assign(s.ctx,{canvasId:'canvas',pushUndo:()=>{},stripRunInputMeta:x=>x,snapshotRunMeta:()=>({}),pendingBoxSize:()=>({w:260,h:180}),nodeRect:n=>({x:n.x||0,y:n.y||0,width:220,height:180}),outgoingConnectionsFor:()=>s.state.connections,isSmartImageNode:n=>n?.type==='smart-image',MEDIA_NODE_DEFAULT_SCALE:1,nowMs:()=>10,selectedId:'',selectedImage:null,attachRunMeta:()=>{},addConnection:(from,to,kind)=>s.state.connections.push({from,to,kind}),saveCanvas:async()=>{events.push('branch-save');return true;},rememberSmartAcceptedTasks:(n,tasks)=>{events.push('backup:'+tasks[0].taskId);},saveSmartAcceptedTasksBeforeQuery:async n=>{events.push('accepted-save:'+n.pendingTasks.map(t=>t.taskId));return true;}});
 vm.runInContext(nativeFunction(source,'createPendingOutputFromSource'),s.ctx);
 s.ctx.fetch=async(url,opts)=>{events.push('post');s.submitted.push(JSON.parse(opts.body));const id='group-'+s.submitted.length;return {ok:true,json:async()=>({task_id:id})};};
 s.p={...s.p,nodeType:'smart-group',outputNodeId:'new-output',runInputHash:'a'.repeat(64),localSignature:s.editor.snapshot()};
 return {...s,events,output:()=>s.state.nodes.find(n=>n.id==='new-output')};
}

test('智能分组走原生聚合入口，先保存新分支，再受理并保留原图片',async()=>{
 const s=smartGroupRunSetup();
 // 原生 render 在选中源组时会把面板默认参数补回 runSettings，助手建分支不能改变选中项。
 s.ctx.render=()=>{if(s.ctx.selectedId==='im')s.node.runSettings={...s.node.runSettings,composerDefault:true};};
 const result=await s.editor.execute(s.p);
 assert.deepEqual(Array.from(result.nodeIds),['im','new-output']);assert.equal(s.submitted.length,2);
 assert.equal(s.events[0],'branch-save');assert.ok(s.events.indexOf('backup:group-1')<s.events.indexOf('accepted-save:group-1'),JSON.stringify(s.events));
 assert.equal(s.output().images.length,2);assert.equal(s.node.images[0].url,'/assets/keep.png');
 assert.equal(s.submitted[0].node_id,s.node.id);assert.equal(s.submitted[0].input_hash,s.p.runInputHash);
 assert.equal(s.output().assistantNativeOrigin.sourceNodeId,s.node.id);
 assert.equal(s.ctx.selectedId,'');assert.equal(s.node.runSettings.composerDefault,undefined);
 await s.editor.execute(s.p);assert.equal(s.submitted.length,2);assert.equal(s.state.nodes.length,3);
});

test('智能分组分支保存失败或最终确认期间成员编辑，均零提交且可保留已建分支',async()=>{
 for(const mode of ['save','member']){
  const s=smartGroupRunSetup();if(mode==='save')s.ctx.saveCanvas=async()=>false;
  else s.p.check=async()=>{s.state.nodes[1].text='确认后编辑';return true;};
  await assert.rejects(s.editor.execute(s.p));assert.equal(s.submitted.length,0);assert.equal(s.output().pending,0);
 }
});

test('智能分组最终异步门禁期间篡改新结果分支会拒绝提交',async()=>{
 for(const mode of ['origin','connection','media']){
  const s=smartGroupRunSetup();s.p.check=async()=>{
   if(mode==='origin')s.output().assistantNativeOrigin.actionId='foreign';
   if(mode==='connection')s.state.connections.length=0;
   if(mode==='media')s.output().images.push({url:'/output/foreign.png'});
   return true;
  };
  await assert.rejects(s.editor.execute(s.p));assert.equal(s.submitted.length,0);
 }
});

test('智能分组受理后断线或保存失败只保留原编号，不重新提交',async()=>{
 for(const mode of ['unknown','save']){
  const s=smartGroupRunSetup();let calls=0;
  s.ctx.fetch=async()=>{const index=++calls;if(mode==='unknown'&&index===2)throw new Error('断线');return {ok:true,json:async()=>({task_id:'accepted-'+index})};};
  if(mode==='save')s.ctx.saveSmartAcceptedTasksBeforeQuery=async()=>false;
  const result=await s.editor.execute(s.p);assert.ok(result.taskIds.includes('accepted-1'));
  if(mode==='unknown'){assert.equal(s.node.submissionUnknown,true);assert.equal(s.output().submissionUnknown,true);}
  else assert.equal(s.queries(),0);
  await s.editor.execute(s.p);assert.equal(calls,2);assert.equal(s.node.images[0].url,'/assets/keep.png');
 }
});

test('智能分组刷新从结果分支备份恢复源动作和未知预算，不覆盖其它动作',async()=>{
 const s=smartGroupRunSetup(),source=fs.readFileSync(require.resolve('../static/js/smart-canvas.js'),'utf8'),storage=new Map();
 Object.assign(s.ctx,{SMART_UNSAVED_ACCEPTED_TASKS_PREFIX:'accepted:',localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},smartPendingTasks:n=>n.pendingTasks||[]});
 for(const name of ['smartUnsavedAcceptedTasksKey','readSmartUnsavedAcceptedTasks','rememberSmartAcceptedTasks','clearSmartUnsavedAcceptedTasks','restoreSmartUnsavedAcceptedTasks'])vm.runInContext(nativeFunction(source,name),s.ctx);
 s.ctx.saveSmartAcceptedTasksBeforeQuery=async()=>false;await s.editor.execute(s.p);
 const entries=JSON.parse(storage.get('accepted:canvas'));assert.equal(entries[0].assistantSourceNodeId,'im');assert.equal(entries[0].assistantMaxCalls,2);
 entries.pop();storage.set('accepted:canvas',JSON.stringify(entries));delete s.node.assistantNativeRun;delete s.output().pendingTasks;
 s.ctx.restoreSmartUnsavedAcceptedTasks();assert.deepEqual(Array.from(s.node.assistantNativeRun.taskIds),['group-1']);assert.equal(s.node.assistantNativeRun.outputNodeId,'new-output');assert.equal(s.node.assistantNativeRun.unknownCount,1);assert.equal(s.output().assistantNativeRun,undefined);
 s.node.assistantNativeRun={actionId:'newer',taskIds:['other']};s.ctx.restoreSmartUnsavedAcceptedTasks();assert.equal(s.node.assistantNativeRun.actionId,'newer');
});

test('智能分组原分支验证拒绝移除连接、篡改归属和切画布',async()=>{
 const source=fs.readFileSync(require.resolve('../static/js/smart-canvas.js'),'utf8');
 for(const mode of ['connection','owner','canvas']){
  const s=smartGroupRunSetup();await s.editor.execute(s.p);s.ctx.canvas={connections:s.state.connections};
  vm.runInContext(nativeFunction(source,'validateSmartGroupPendingOutput'),s.ctx);
  const task={taskId:'group-1',assistantNativeActionId:s.p.id,assistantSourceNodeId:'im',assistantInputHash:s.p.runInputHash,assistantBinding:{canvas_id:'canvas'}};
  s.ctx.validateSmartGroupPendingOutput(s.output(),task);
  if(mode==='connection')s.ctx.canvas.connections=[];if(mode==='owner')s.output().assistantNativeOrigin.sourceNodeId='other';if(mode==='canvas')s.ctx.canvasId='other';
  assert.throws(()=>s.ctx.validateSmartGroupPendingOutput(s.output(),task),/归属/);
 }
});

test('智能图片原生 API 执行保存每个受理编号，重复动作不重提且保留手选模型',async()=>{
 const s=smartImageRunSetup();const result=await s.editor.execute(s.p);
 assert.equal(result.state,'accepted');assert.deepEqual(Array.from(result.taskIds),['original-1','original-2']);assert.equal(s.submitted.length,2);
 assert.equal(s.submitted[0].prompt,'原生正文');assert.equal(s.submitted[0].size,'1536x1024');assert.equal(s.submitted[0].model,'selected');assert.equal(s.node.runSettings.model,'selected');assert.equal(s.saves(),1);assert.equal(s.queries(),1);
 await s.editor.execute(s.p);assert.equal(s.submitted.length,2);
});

test('智能图片真实提示词编译保留输入连接的默认参考图和节点草稿',async()=>{
 const s=smartImageRunSetup(),source=fs.readFileSync(require.resolve('../static/js/smart-canvas.js'),'utf8');
 const input={innerHTML:'原面板',get childNodes(){return [{nodeType:3,textContent:this.innerHTML}];}};
 Object.assign(s.ctx,{Node:{TEXT_NODE:3,ELEMENT_NODE:1},promptInput:input,loadNodePromptDraftToInput:()=>input.innerHTML='节点草稿',blockedInputRefKeys:()=>new Set(),defaultReferenceImagesFor:()=>[{url:'/assets/reference.png',kind:'image'}],inputRefKey:ref=>ref.url,uniqueReferenceImages:x=>x,isSmartGroupNode:()=>false,inputPromptTextFor:()=> '上游正文',settings:{engine:'api'}});
 for(const name of ['buildPromptRequest','buildPromptRequestForNode'])vm.runInContext(nativeFunction(source,name),s.ctx);
 await s.editor.execute(s.p);
 assert.equal(input.innerHTML,'原面板');assert.equal(s.submitted[0].prompt,'上游正文\n\n节点草稿');
 assert.equal(s.submitted[0].reference_images[0]?.url,'/assets/reference.png');
});

test('智能图片最终预检变化、只读或音视频分支拒绝且零提交',async()=>{
 for(const mode of ['changed','readonly','audio','existing']){
  const s=smartImageRunSetup();if(mode==='changed')s.p.check=async()=>{s.node.runSettings.model='changed';return true;};
  if(mode==='readonly')s.p.check=async()=>{s.state.readOnly=true;return true;};
  if(mode==='audio')s.ctx.smartApiAudioMode=()=>true;
  if(mode==='existing')s.node.images=[{url:'/output/keep.png'}];
  await assert.rejects(s.editor.execute(s.p));assert.equal(s.submitted.length,0);assert.equal(s.saves(),0);
 }
});

test('智能图片部分受理和断线保留原编号与未知标志；保存失败不轮询不重提',async()=>{
 for(const mode of ['unknown','save']){
  const s=smartImageRunSetup();let calls=0;
  s.ctx.fetch=async()=>{calls++;const id='accepted-'+calls;if(calls===2&&mode==='unknown')throw new Error('断线');return {ok:true,json:async()=>({task_id:id})};};
  if(mode==='save')s.ctx.saveSmartAcceptedTasksBeforeQuery=async()=>false;
  const result=await s.editor.execute(s.p);assert.ok(result.taskIds.includes('accepted-1'));
  if(mode==='unknown'){assert.equal(s.node.assistantNativeRun.unknownCount,1);assert.equal(s.node.submissionUnknown,true);}
  else assert.equal(s.queries(),0);
  await s.editor.execute(s.p);assert.equal(calls,2);
 }
});

test('智能图片一项受理而其它请求未结束时立即备份，刷新恢复原动作编号并阻止重提',async()=>{
 const s=smartImageRunSetup(),source=fs.readFileSync(require.resolve('../static/js/smart-canvas.js'),'utf8'),storage=new Map();
 let release;const waiting=new Promise(resolve=>release=resolve);let calls=0;
 Object.assign(s.ctx,{canvasId:'canvas',SMART_UNSAVED_ACCEPTED_TASKS_PREFIX:'accepted:',localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},smartPendingTasks:n=>n.pendingTasks||[]});
 for(const name of ['smartUnsavedAcceptedTasksKey','readSmartUnsavedAcceptedTasks','rememberSmartAcceptedTasks','clearSmartUnsavedAcceptedTasks','restoreSmartUnsavedAcceptedTasks'])vm.runInContext(nativeFunction(source,name),s.ctx);
 s.ctx.fetch=async()=>{const index=++calls;if(index===2)await waiting;return {ok:true,json:async()=>({task_id:'paid-'+index})};};
 const flight=s.editor.execute(s.p);
 for(let i=0;i<25&&!s.node.assistantNativeRun?.taskIds.length;i++)await new Promise(resolve=>setImmediate(resolve));
 try{
  const entries=JSON.parse(storage.get('accepted:canvas')||'[]');assert.equal(entries[0]?.taskId,'paid-1');assert.equal(s.queries(),0);
  s.ctx.rememberSmartAcceptedTasks(s.node,[{taskId:'paid-1',kind:'image'}]);
  assert.equal(JSON.parse(storage.get('accepted:canvas'))[0].assistantNativeActionId,s.p.id);
  const reopened=JSON.parse(JSON.stringify(s.node));delete reopened.assistantNativeRun;delete reopened.pendingTasks;reopened.running=false;s.ctx.nodes=[reopened];
  assert.equal(s.ctx.restoreSmartUnsavedAcceptedTasks(),1);assert.equal(reopened.assistantNativeRun.actionId,s.p.id);assert.deepEqual(Array.from(reopened.assistantNativeRun.taskIds),['paid-1']);assert.equal(reopened.assistantNativeRun.unknownCount,1);assert.equal(reopened.submissionUnknown,true);
 }finally{release();await flight;}
});
test('原生工厂动作保存后重复回执不再次创建',async()=>{const s=setup();const a=await s.bridge.execute(s.proposal);const b=await s.bridge.execute(s.proposal);assert.deepEqual(a.nodeIds,['made']);assert.deepEqual(a,b);assert.equal(s.calls.length,1);assert.equal(s.state.nodes.length,1);});
test('工作流导出保存范围回执，重复执行不再次下载',async()=>{
 const anchor={id:'g',type:'generator'},prompt={id:'p',type:'prompt',text:'正文'};const s=editorSetup(anchor);s.state.nodes.push(prompt);s.state.connections.push({id:'edge-1',from:'p',to:'g'});let downloads=0;
 s.adapter.exportWorkflow=async options=>{await options.beforeDownload();downloads++;assert.deepEqual(options.nodeIds,['p','g']);return {receipt:{actionId:options.actionId,status:'download_started',format:'json',nodeIds:['p','g'],connectionIds:['edge-1'],scopeHash:'scope',bytes:128,archiveMagic:'',downloadedAt:1}};};
 const p={...s.proposal,action:'export',nodeId:'g',localSignature:s.editor.snapshot(),arguments:{nodeIds:['p','g'],connectionIds:['edge-1'],includeResources:false,exportScopeHash:'scope'}};
 const a=await s.editor.execute(p),b=await s.editor.execute(p);assert.equal(a.state,'completed');assert.equal(a.exportReceipt.format,'json');assert.deepEqual(anchor.assistantExportReceipts,[a.exportReceipt]);assert.deepEqual(a,b);assert.equal(downloads,1);
});
test('打包期间切换画布或修改内容会在下载前拒绝，且不写成功回执',async()=>{
 for(const change of [s=>s.state.id='other',s=>s.state.nodes[0].text='修改正文']){
  const s=editorSetup({id:'p',type:'prompt',text:'原文'});let downloads=0;
  s.adapter.exportWorkflow=async options=>{await Promise.resolve();change(s);await options.beforeDownload();downloads++;};
  const p={...s.proposal,action:'export',nodeId:'p',arguments:{nodeIds:['p'],includeResources:true}};
  await assert.rejects(s.editor.execute(p),/变化/);assert.equal(downloads,0);assert.equal(s.state.nodes[0].assistantExportReceipts,undefined);
 }
});
test('打包期间停止确认会在下载前拒绝，不保存成功回执',async()=>{
 const s=editorSetup({id:'p',type:'prompt',text:'原文'});let checks=0,downloads=0;
 s.adapter.exportWorkflow=async options=>{await Promise.resolve();await options.beforeDownload();downloads++;};
 const p={...s.proposal,action:'export',nodeId:'p',arguments:{nodeIds:['p'],includeResources:true},check:async()=>{checks++;return false;}};
 await assert.rejects(s.editor.execute(p),/停止/);assert.equal(checks,1);assert.equal(downloads,0);assert.equal(s.state.nodes[0].assistantExportReceipts,undefined);
});
test('两种画布实际导出入口校验 JSON ZIP 和资源失败，不包含历史下载回执',async()=>{
 for(const [file,name] of [['canvas.js','canvasAssistantExportWorkflow'],['smart-canvas.js','smartCanvasAssistantExportWorkflow']]){
  const source=fs.readFileSync(require.resolve('../static/js/'+file),'utf8');
  const nodes=[{id:'p',text:'中文正文',assistantExportReceipts:[{actionId:'old'}]},{id:'im',url:'/static/icon.png'},{id:'other'}],connections=[{id:'e',from:'p',to:'im'},{id:'outside',from:'p',to:'other'}];
  const downloads=[];let requests=0,checks=0,fail=false;
  const ctx=createTaskContext({canvas:{id:'c',title:'workflow'},connections,serializableCanvasNodes:()=>nodes,canvasForStorage:()=>({nodes,connections}),workflowFilename:ext=>'workflow.'+ext,smartWorkflowFilename:ext=>'workflow.'+ext,Blob,Uint8Array,fetch:async(url,options)=>{requests++;const body=JSON.parse(options.body);assert.equal(body.nodes.length,2);assert.equal(body.connections.length,1);return fail?{ok:false}:{ok:true,headers:{get:()=> 'application/zip'},blob:async()=>new Blob(['PKarchive'])};},responseErrorMessage:async()=> '本地资源缺失',downloadBlob:(blob,filename)=>downloads.push({blob,filename})});
  vm.runInContext(nativeFunction(source,name),ctx);
  const options={actionId:'export',nodeId:'p',nodeIds:['im','p'],connectionIds:['e'],includeResources:false,scopeHash:'scope',beforeDownload:()=>checks++};
  const json=await ctx[name](options);const payload=JSON.parse(await downloads[0].blob.text());
  assert.deepEqual(payload.nodes.map(n=>n.id),['im','p']);assert.equal(payload.nodes[1].assistantExportReceipts,undefined);assert.equal(payload.nodes[1].text,'中文正文');assert.equal(requests,0);assert.equal(json.receipt.status,'download_started');
  const zip=await ctx[name]({...options,includeResources:true});assert.equal(requests,1);assert.equal(zip.receipt.archiveMagic,'PK');assert.equal(checks,2);
  fail=true;await assert.rejects(ctx[name]({...options,includeResources:true}),/资源缺失/);assert.equal(downloads.length,2);
  fail=false;await assert.rejects(ctx[name]({...options,includeResources:true,beforeDownload:()=>{throw new Error('内容变化');}}),/内容变化/);assert.equal(downloads.length,2);
 }
});
test('只读、画布切换与保存版本改变均拒绝写入',async()=>{for(const patch of [{readOnly:true},{id:'other'},{updatedAt:8}]){const s=setup();Object.assign(s.state,patch);await assert.rejects(s.bridge.execute(s.proposal));assert.equal(s.calls.length,0);}});
test('原生保存失败不得返回成功，保留失败回执且不重放',async()=>{const s=setup();let saves=0;s.adapter.save=async()=>++saves===1;await assert.rejects(s.bridge.execute(s.proposal),/保存/);const result=await s.bridge.execute(s.proposal);assert.equal(result.state,'failed');assert.equal(s.calls.length,1);});
test('原生处理器异常保留真实错误，不重复执行',async()=>{const s=setup();s.adapter.perform=async()=>{throw new Error('原生参数不适用');};await assert.rejects(s.bridge.execute(s.proposal),/原生参数不适用/);assert.equal(s.state.receipts.intent.state,'failed');});
test('运行前保存受理保护，断线后只能查原任务',async()=>{const s=setup();s.proposal.action='run';s.proposal.chargeable=true;s.adapter.perform=async()=>{throw new Error('连接断开');};await assert.rejects(s.bridge.execute(s.proposal),/连接断开/);assert.equal(s.state.receipts.intent.state,'submission_unknown');const r=await s.bridge.execute(s.proposal);assert.equal(r.state,'submission_unknown');});
test('相同编号不同动作拒绝而不覆盖原回执',async()=>{const s=setup();await s.bridge.execute(s.proposal);await assert.rejects(s.bridge.execute({...s.proposal,action:'run'}),/不同/);assert.equal(s.calls.length,1);});

test('保护保存期间目标变化必须再次预检，不调用原生动作',async()=>{
 const s=setup();let checks=0;s.adapter.preflight=()=>{checks++;return s.state.updatedAt===7;};
 s.adapter.save=async()=>{s.state.updatedAt=8;return true;};
 await assert.rejects(s.bridge.execute(s.proposal),/变化/);
 assert.equal(s.calls.length,0);assert.equal(checks,2);
});
test('同id同动作并发只执行一次，异步首次预检不会放过第二个执行器',async()=>{
 const s=setup();s.adapter.preflight=async()=>true;
 const [a,b]=await Promise.all([s.bridge.execute(s.proposal),s.bridge.execute(s.proposal)]);
 assert.equal(s.calls.length,1);assert.deepEqual(a,b);
});
test('同id不同动作并发拒绝，保留第一个动作占用',async()=>{
 const s=setup();s.adapter.preflight=async()=>true;
 const result=await Promise.allSettled([s.bridge.execute(s.proposal),s.bridge.execute({...s.proposal,arguments:{type:'loop'}})]);
 assert.equal(result[0].status,'fulfilled');assert.equal(result[1].status,'rejected');assert.equal(s.calls.length,1);
});
test('运行必须在原生提交边界复核输入，保存原编号且不把未执行返回当成功',async()=>{
 const node={id:'g',type:'generator',apiProvider:'p',model:'user',count:1};const s=editorSetup(node);
 const p={...s.proposal,action:'run',chargeable:true,arguments:{maxCalls:1},runSettings:{taskKind:'image'},check:async()=>true};
 let calls=0;s.adapter.runNode=async(n,options)=>{await options.beforeSubmit();calls++;n.assistantNativeRun.taskIds=['original'];};
 const result=await s.editor.execute(p);assert.equal(result.state,'accepted');assert.deepEqual(result.taskIds,['original']);assert.equal(calls,1);
 await s.editor.execute(p);assert.equal(calls,1);
 const changed=editorSetup({id:'g',type:'generator',model:'user'});let submitted=0;
 changed.adapter.runNode=async(n,options)=>{n.model='other';await options.beforeSubmit();submitted++;};
 await assert.rejects(changed.editor.execute({...p,localSignature:changed.editor.snapshot()}),/输入/);assert.equal(submitted,0);
 const empty=editorSetup({id:'g',type:'generator'});empty.adapter.runNode=async()=>undefined;
 await assert.rejects(empty.editor.execute({...p,localSignature:empty.editor.snapshot()}),/受理编号/);
});
test('普通画布 LLM 原生运行只调用一次并保存完成回执',async()=>{
 const node={id:'llm',type:'llm',llmProvider:'codex',model:'gpt-6.1-sol',userInput:'改写成图片提示词'};
 const s=editorSetup(node);let calls=0,checks=0;
 s.adapter.runLLMNode=async(n,options)=>{await options.beforeSubmit();calls++;n.outputText='一条真实的图片提示词';n.assistantNativeRun.status='succeeded';};
 const p={...s.proposal,action:'run',chargeable:true,arguments:{maxCalls:1},runSettings:{provider:'codex',model:'gpt-6.1-sol',maxCalls:1,taskKind:'llm'},check:async()=>{checks++;return true;}};
 const first=await s.editor.execute(p);
 assert.equal(calls,1);assert.equal(checks,1);assert.equal(first.state,'succeeded');assert.deepEqual(first.taskIds,[]);assert.equal(node.outputText,'一条真实的图片提示词');
 const second=await s.editor.execute(p);assert.deepEqual(second,first);assert.equal(calls,1);
});

test('普通LLM空响应或报错保留原正文，成功才替换并刷新下游输入',async()=>{
 const source=fs.readFileSync(require.resolve('../static/js/canvas.js'),'utf8');
 for(const mode of ['empty','error','success']){
  const node={id:'llm',type:'llm',outputText:'原有正文',userInput:'输入',llmProvider:'chosen',model:'selected',storyAnalysisOrigin:{sourceNodeId:'story'}};
  const refreshed=[];let calls=0,inputSyncs=0;
  const ctx=createTaskContext({nodes:[node,{id:'story',text:'实际原文'}],connections:[{from:'llm',to:'g'}],cascadeTargetIdFromOptions:()=>'',llmInputText:()=> '已确认输入',llmInputAudios:()=>[],refreshNodes:ids=>refreshed.push([...ids]),
   resolveChatProviderId:x=>x,resolveChatModel:x=>x,llmInputImages:()=>[],llmInputVideos:()=>[],cascadeFetch:async()=>{calls++;if(mode==='error')throw new Error('模拟失败');if(mode==='success')node.model='changed-during-request';return {ok:true,json:async()=>({text:mode==='empty'?'':'新正文'})};},scheduleGeneratorInputSync:()=>inputSyncs++,scheduleSave:()=>{},isCascadeAbortError:()=>false,alert:()=>{}});
  vm.runInContext(nativeFunction(source,'runLLMNode'),ctx);
  await ctx.runLLMNode(node.id,{assistantNativeActionId:'a',beforeSubmit:async()=>{}});
  assert.equal(calls,1);
  assert.equal(node.outputText,mode==='success'?'新正文':'原有正文',mode);
  assert.equal(node.assistantNativeRun.status,mode==='success'?'succeeded':'failed',mode);
  assert.equal(inputSyncs,mode==='success'?1:0,'成功后复用原生输入预览同步');
  if(mode==='success'){assert.equal(node.storyAnalysisResult.sourceText,'实际原文');assert.equal(node.storyAnalysisResult.outputText,'新正文');assert.equal(node.storyAnalysisResult.model,'selected','记录提交时模型，不能记录请求期间更换后的模型');}
 }
});
test('最终异步确认等待期间上游改变或切画布均阻止提交',async()=>{
 for(const change of ['prompt','canvas']){
  const s=editorSetup({id:'g',type:'generator',model:'user'});const prompt={id:'p',type:'prompt',text:'已确认'};
  s.state.nodes.push(prompt);s.state.connections.push({from:'p',to:'g'});let submits=0;
  s.adapter.runNode=async(node,opts)=>{await opts.beforeSubmit();submits++;node.assistantNativeRun.taskIds=['original'];};
  const p={...s.proposal,localSignature:s.editor.snapshot(),action:'run',chargeable:true,arguments:{maxCalls:1},runSettings:{taskKind:'image'},check:async()=>{await Promise.resolve();if(change==='prompt')prompt.text='等待时改变';else s.state.id='other';return true;}};
  await assert.rejects(s.editor.execute(p));assert.equal(submits,0);
 }
});
test('真实runGenerator保存原受理编号和原参数，不再次运行上游',async()=>{
 const source=fs.readFileSync(require.resolve('../static/js/canvas.js'),'utf8');
 const gen={id:'g',type:'generator',apiProvider:'manual',model:'user',count:2,assistantNativeRun:{actionId:'a',taskKind:'image',taskIds:[],submissionStarted:true}};let submitted;
 const ctx=createTaskContext({nodes:[gen],canvasApiAudioMode:()=>false,audioRefsOnly:s=>s.filter(r=>r.kind==='audio'),cascadeTargetIdFromOptions:()=>'',orderedSources:(_n,s)=>s,generatorSources:()=>[{prompt:'原生正文',refs:[]}],imageRefsOnly:s=>s,confirmCanvasUnknownResubmission:()=>true,outputForNode:()=>null,runSnapshot:()=>({}),resolveImageProviderId:v=>v,resolveImageModel:v=>v,generatorSizeForRun:async()=> '1536x1024',normalizedImageQuality:()=>'',CANVAS_REFERENCE_IMAGE_MAX:8,nowMs:()=>0,refreshRunNodes:()=>{},setTimeout:()=>{},rememberCanvasSubmissionWarning:()=>{},submitCanvasImageTaskBatch:async(count,payload,opts)=>{submitted={count,payload,opts};return {taskInfos:[{task_id:'first'},{task_id:'second'}],warning:'',unknownCount:0};},waitCanvasDirectTasks:async()=>['/output/real.png'],mergeGeneratedOutputs:(n,outputs)=>n.generatedOutputs=outputs,addGenerationLog:()=>{},scheduleSave:()=>{}});
 vm.runInContext(nativeFunction(source,'runGenerator'),ctx);await ctx.runGenerator('g',{assistantNativeActionId:'a'});
 assert.equal(gen.runStatus,'done');assert.deepEqual(Array.from(gen.assistantNativeRun.taskIds),['first','second']);assert.equal(submitted.count,2);
 assert.equal(submitted.payload.provider_id,'manual');assert.equal(submitted.payload.model,'user');assert.equal(submitted.payload.prompt,'原生正文');assert.equal(submitted.payload.size,'1536x1024');assert.equal(submitted.opts.assistantNativeActionId,'a');
 let audioCalls=0;
 Object.assign(ctx,{canvasApiAudioMode:()=>true,runCanvasApiAudio:async()=>{audioCalls++;},runAudioAnalysisGenerator:async()=>{audioCalls++;},providerChatModels:()=>['user'],generatorSources:()=>[{prompt:'新音频正文',refs:[{url:'/output/audio.wav',kind:'audio'}]}]});
 for(const branch of [true,false]){
  ctx.canvasApiAudioMode=()=>branch;submitted=null;
  await ctx.runGenerator('g',{assistantProposal:{prompt:'原确认正文',referenceImages:[]},acceptedTask:{task_id:'original-image'}});
  assert.equal(audioCalls,0);assert.equal(submitted.count,1);assert.equal(submitted.opts.acceptedTask.task_id,'original-image');assert.equal(submitted.payload.prompt,'原确认正文');
 }
});
test('来源比例编译使用副本且真实提交边界仍允许两项，预检拒绝表示零受理',async()=>{
 const source=fs.readFileSync(require.resolve('../static/js/canvas.js'),'utf8');
 const node={id:'g',type:'generator',apiProvider:'manual',model:'user',count:2,ratio:'source'};const s=editorSetup(node);let posts=0,checks=0;
 const ctx=createTaskContext({nodes:s.state.nodes,canvasApiAudioMode:()=>false,audioRefsOnly:s=>s.filter(r=>r.kind==='audio'),cascadeTargetIdFromOptions:()=>'',cascadeContextFor:()=>null,generatorSources:()=>[{id:'ref',prompt:'正文',refs:[{url:'/output/ref.png'}]}],imageRefsOnly:s=>s,confirmCanvasUnknownResubmission:()=>true,outputForNode:()=>null,runSnapshot:()=>({}),resolveImageProviderId:v=>v,resolveImageModel:v=>v,normalizedImageQuality:()=>'',CANVAS_REFERENCE_IMAGE_MAX:8,nowMs:()=>0,refreshRunNodes:()=>{},setTimeout:()=>{},rememberCanvasSubmissionWarning:(n,_w,unknown)=>n.submissionUnknown=!!unknown,cascadeFetch:async(_url,options)=>{posts++;assert.equal(JSON.parse(options.body).size,'4:3');return {ok:true,json:async()=>({task_id:'original-'+posts})};},getImageDimensions:async()=>({width:400,height:300}),ratioPartsFromDimensions:()=>({width:4,height:3}),apiImageSize:(_ratio,_res,custom)=>custom,defaultApiImageResolution:()=> '4k',waitCanvasDirectTasks:async()=>['/output/real.png'],mergeGeneratedOutputs:(n,images)=>n.generatedOutputs=images,addGenerationLog:()=>{},scheduleSave:()=>{}});
 Object.assign(ctx,{isCascadeAbortError:()=>false,showErrorModal:()=>{},tr:x=>x});
 for(const name of ['isGptImageAutoSizeModel','orderedSources','generatorSizeForRun','createCanvasImageTask','submitCanvasImageTaskBatch','runGenerator'])vm.runInContext(nativeFunction(source,name),ctx);
 s.adapter.runNode=(n,opts)=>ctx.runGenerator(n.id,opts);
 const p={...s.proposal,action:'run',chargeable:true,arguments:{maxCalls:2},runSettings:{taskKind:'image'},check:async()=>{checks++;return true;}};
 const receipt=await s.editor.execute(p);assert.equal(posts,2);assert.equal(checks,2);assert.equal(receipt.taskIds.length,2);assert.equal(node.customRatio,undefined);assert.equal(node.inputs,undefined);
 await assert.rejects(ctx.submitCanvasImageTaskBatch(2,{}, {beforeSubmit:()=>{throw new Error('停止');}}),e=>e.submissionKnownRejected===true&&e.submissionUnknown===false);assert.equal(posts,2);
});
test('真实API图片提交在请求前复核，已受理恢复跳过新提交，批量任务保留明确拒绝与未知',async()=>{
 const source=fs.readFileSync(require.resolve('../static/js/canvas.js'),'utf8');let checked=0,submitted=0;
 const ctx=createTaskContext({cascadeFetch:async()=>{submitted++;return {ok:true,json:async()=>({task_id:'original'})};},cascadeTargetIdFromOptions:()=>'',cascadeContextFor:()=>null,tr:x=>x});
 for(const name of ['createCanvasImageTask','submitCanvasImageTaskBatch'])vm.runInContext(nativeFunction(source,name),ctx);
 const first=await ctx.createCanvasImageTask({model:'user'},{beforeSubmit:async()=>checked++});assert.equal(first.task_id,'original');assert.equal(checked,1);assert.equal(submitted,1);
 await ctx.createCanvasImageTask({}, {acceptedTask:{task_id:'original'},beforeSubmit:()=>{throw new Error('不应重提交');}});assert.equal(submitted,1);
 await assert.rejects(ctx.createCanvasImageTask({}, {beforeSubmit:()=>{throw new Error('已停止');}}),/停止/);assert.equal(submitted,1);
 ctx.responseErrorMessage=async()=> '拒绝';ctx.cascadeFetch=async()=>({ok:false,status:400});
 await assert.rejects(ctx.submitCanvasImageTaskBatch(1,{}),e=>e.submissionUnknown===false);
 ctx.cascadeFetch=async()=>{throw new Error('断线');};
 await assert.rejects(ctx.submitCanvasImageTaskBatch(1,{}),e=>e.submissionUnknown===true);
});
test('两画布原生复制不继承助手动作与原任务受理归属',()=>{
 for(const kind of ['classic','smart']){
  const source=fs.readFileSync(require.resolve(kind==='classic'?'../static/js/canvas.js':'../static/js/smart-canvas.js'),'utf8');
  const name=kind==='classic'?'remapCanvasDepthCopies':'remapSmartDepthCopies';
  const ctx=createTaskContext({window:{CanvasVideoDeconstructionModel:{remapCopies:()=>{}}}});vm.runInContext(nativeFunction(source,name),ctx);
  const node={id:'copy',type:'generator',model:'user',assistantNativeRun:{actionId:'old',taskIds:['original']},assistantNativeActionId:'old-create',assistantMediaExportReceipts:[{actionId:'original-download'}]};
  ctx[name]([node],new Map());assert.equal(node.model,'user');assert.equal(node.assistantNativeRun,undefined);assert.equal(node.assistantNativeActionId,undefined);
  assert.equal(node.assistantMediaExportReceipts,undefined);
 }
});

function editorSetup(node){
 const state={id:'canvas',updatedAt:7,nodes:[node],connections:[]};let saves=0,undo=0;
 const source=fs.readFileSync(require.resolve('../static/js/smart-canvas.js'),'utf8');
 const setter=source.slice(source.indexOf('function setSmartLoopPromptFieldValues('),source.indexOf('function smartLoopPromptFieldText('));
 const context=createTaskContext({});vm.runInContext(setter,context);
 const adapter={getState:()=>state,getSnapshot:()=>({nodes:state.nodes,connections:state.connections}),save:async()=>{saves++;state.updatedAt++;return true;},pushUndo:()=>undo++,render:()=>{},setLoopPrompts:context.setSmartLoopPromptFieldValues,clipModel};
 const editor=native.createEditor(adapter);
 const proposal={id:'edit',canvasId:'canvas',updatedAt:7,nodeId:node.id,chargeable:false,localSignature:editor.snapshot()};
 return {state,adapter,editor,proposal,saves:()=>saves,undo:()=>undo};
}
function nativeFunction(source,name){const match=source.match(new RegExp('(?:async )?function '+name+'\\([^\\n]*\\).*?\\n\\}','s'));assert.ok(match,name);return match[0];}

test('上游图片完成先同步下游输入顺序，随后助手复用不被自身渲染误拒绝',async()=>{
 const source=fs.readFileSync(require.resolve('../static/js/canvas.js'),'utf8');
 const generator={id:'first',type:'generator'},out={id:'out',type:'output',images:[],_pending:[{id:'pending',canvasTaskId:'original',run:{node:{id:'first'}}}]};
 const next={id:'next',type:'generator',inputs:[]};const s=editorSetup(next);s.state.nodes.push(generator,out);s.state.connections.push({from:'out',to:'next'});
 let previews=0;
 const ctx=createTaskContext({nodes:s.state.nodes,connections:s.state.connections,CANVAS_GENERATOR_TYPES:['generator'],CANVAS_MEDIA_OUTPUT_TYPES:['generator'],
  findPendingTask:()=>({out,pending:out._pending[0]}),nowMs:()=>10,requestMetaFromResult:()=>({}),appendOutputImages:(n,images)=>n.images.push(...images),
  mergeGeneratedOutputs:()=>{},addGenerationLog:()=>{},refreshRunNodes:()=>{},refreshGeneratorInputViews:()=>previews++,scheduleSave:()=>{},
  outputUrlValue:item=>typeof item==='string'?item:item.url,mediaKindForOutputItem:()=> 'image',outputNodesForSource:()=>[out],generatedImageRefs:()=>[]});
 for(const name of ['generatorSources','orderedSources','syncGeneratorInputs','completeCanvasImageTask'])vm.runInContext(nativeFunction(source,name),ctx);
 ctx.completeCanvasImageTask('original',{images:['/output/original.png']});
 assert.deepEqual(Array.from(next.inputs),['out'],'完成回执前保存真实输入顺序');assert.equal(previews,1);
 let submissions=0;s.adapter.runNode=async(n,opts)=>{ctx.orderedSources(n,ctx.generatorSources(n));await opts.beforeSubmit();submissions++;n.assistantNativeRun.taskIds=['reuse-task'];};
 const result=await s.editor.execute({...s.proposal,localSignature:s.editor.snapshot(),action:'run',chargeable:true,arguments:{maxCalls:1},runSettings:{taskKind:'image',maxCalls:1},check:async()=>true});
 assert.equal(result.state,'accepted');assert.equal(submissions,1);
});

test('媒体导出先持久交付保护，再调用原生入口；刷新不重复下载',async()=>{
 for(const destination of ['canvas','download']){
  const node={id:'clip',type:'clip'},s=editorSetup(node),events=[];
  const save=s.adapter.save;s.adapter.save=async()=>{events.push('save');return save();};
  s.adapter.deliverMediaExport=async(n,results,d)=>{events.push('deliver');assert.equal(n.assistantMediaExportReceipts[0].status,'delivery_started');assert.equal(d,destination);};
  const p={...s.proposal,action:'media_export',arguments:{destination},mediaExportSummary:{rangeHash:'range',requestId:'request'},receipt:{mediaExport:{status:'succeeded',results:[{url:'/output/export.mp4'}]}},check:async()=>true};
  const receipt=await s.editor.execute(p);assert.equal(receipt.state,'completed');assert.equal(node.assistantMediaExportReceipts[0].status,destination==='canvas'?'saved_to_canvas':'download_started');
  assert.deepEqual(events,['save','save','deliver','save']);
  const restored=native.createEditor(s.adapter);await assert.rejects(restored.execute({...p,updatedAt:s.state.updatedAt,localSignature:restored.snapshot()}));assert.equal(events.filter(e=>e==='deliver').length,1);
 }
});

test('媒体导出保存保护失败时不交付，下载失败保留保护且不重放',async()=>{
 for(const mode of ['save','download']){
  const node={id:'clip',type:'clip'},s=editorSetup(node);let calls=0,saves=0;
  if(mode==='save')s.adapter.save=async()=>++saves!==2;
  s.adapter.deliverMediaExport=async()=>{calls++;throw new Error('下载失败');};
  const p={...s.proposal,action:'media_export',arguments:{destination:'download'},mediaExportSummary:{rangeHash:'range',requestId:'request'},receipt:{mediaExport:{status:'succeeded',results:[{url:'/output/export.mp4'}]}},check:async()=>true};
  await assert.rejects(s.editor.execute(p));assert.equal(calls,mode==='save'?0:1);
  assert.equal(node.assistantMediaExportReceipts[0].status,'delivery_started');
  const restored=native.createEditor(s.adapter);await assert.rejects(restored.execute({...p,updatedAt:s.state.updatedAt,localSignature:restored.snapshot()}));assert.equal(calls,mode==='save'?0:1);
 }
});

test('LoRA确认写入所选编号和默认强度，关闭保留选择，模型变化拒绝',async()=>{
 const node={id:'ms',type:'msgen',msgenModel:'custom',msCustomModel:'manual',msLoraEnabled:false,msLoraId:'old',msLoraStrength:0.4,images:[{url:'/output/keep.png'}]};
 const s=editorSetup(node);const p={...s.proposal,action:'lora_parameters',arguments:{nodeId:'ms',patch:{msLoraEnabled:true,msLoraId:'chosen'}},loraModel:'manual',effectFields:{msLoraEnabled:true,msLoraId:'chosen',msLoraStrength:0.8}};
 await s.editor.execute(p);assert.equal(node.msLoraId,'chosen');assert.equal(node.msLoraStrength,0.8);assert.equal(node.images[0].url,'/output/keep.png');
 const off={...p,id:'off',updatedAt:s.state.updatedAt,localSignature:s.editor.snapshot(),arguments:{nodeId:'ms',patch:{msLoraEnabled:false}},effectFields:{msLoraEnabled:false}};
 await s.editor.execute(off);assert.equal(node.msLoraEnabled,false);assert.equal(node.msLoraId,'chosen');
 node.msCustomModel='foreign';await assert.rejects(s.editor.execute({...p,id:'foreign',updatedAt:s.state.updatedAt,localSignature:s.editor.snapshot()}),/模型/);
});






test('魔搭及MJ真实原生助手入口先保存受理编号，保存失败保留备份且不重提',async()=>{
 const source=fs.readFileSync(require.resolve('../static/js/canvas.js'),'utf8');
 for(const type of ['msgen','midjourney']){
  const node={id:'n',type,count:1,outputEnabled:true,assistantNativeRun:{actionId:'a',taskKind:'image',taskIds:[]}},out={id:'o',type:'output',images:[]};let posts=0,saves=0,polls=0,backups=0;
  const ctx=createTaskContext({nodes:[node,out],canvas:{id:'c'},connections:[{from:'n',to:'o'}],orderedSources:(_n,s)=>s,generatorSources:()=>[{prompt:'原文',refs:[]}],imageRefsOnly:x=>x,runSnapshot:()=>({node:{id:'n'}}),makePendingForRun:(id,run,_node,_opts,extra)=>({id,run,...extra}),uid:()=> 'pending',saveCanvas:async()=>++saves!==2,createCanvasImageTask:async p=>{posts++;assert.equal(p.native_node_type,type);assert.equal(p.input_hash,'hash');return {task_id:'original'};},rememberUnsavedCanvasAcceptedTasks:()=>backups++,pauseCanvasAcceptedTasksUntilSaved:()=>new Error('原编号尚未保存'),refreshRunNodes:()=>{},pollCanvasImageTask:async()=>polls++});
  vm.runInContext(nativeFunction(source,'runCanvasAssistantCatalogImage'),ctx);
  await assert.rejects(ctx.runCanvasAssistantCatalogImage('n',{assistantNativeActionId:'a',assistantCanvasId:'c',assistantOutputNodeId:'o',assistantRunInputHash:'hash',assistantImageConfig:{provider:'manual',model:'selected',configurationHash:'config'},beforeSubmit:async()=>{node.assistantNativeRun.submissionStarted=true;}}),/原编号尚未保存/);
  assert.equal(posts,1);assert.equal(polls,0);assert.equal(backups,1);assert.deepEqual(Array.from(node.assistantNativeRun.taskIds),['original']);assert.equal(out._pending[0].canvasTaskId,'original');
 }
});



test('智能提示词真实 LLM 入口确认后只调用一次，保留文本模型与保存正文',async()=>{
 const source=fs.readFileSync(require.resolve('../static/js/smart-canvas.js'),'utf8');
 const node={id:'p',type:'smart-prompt',llmEnabled:true,llmProvider:'codex',llmModel:'gpt-6.1-sol',text:'原文',llmInstruction:'按原文改写'};
 const s=editorSetup(node);let calls=0;const requests=[];
 node.storyAnalysisOrigin={sourceNodeId:'story'};s.state.nodes.push({id:'story',type:'smart-prompt',text:'实际原文'});s.proposal.localSignature=s.editor.snapshot();
 const ctx=createTaskContext({nodes:s.state.nodes,promptNodeLLMInputText:n=>n.text+'\n'+n.llmInstruction,render:()=>{},resolveChatProviderId:x=>x,resolveChatModel:x=>x,promptNodeInputMediaForLLM:()=>[{url:'/output/ref.png',kind:'image'}],imageRefsOnly:items=>items.filter(i=>i.kind==='image'),videoRefsOnly:()=>[],scheduleSave:()=>{},toast:()=>{},tr:x=>x,fetch:async(url,options)=>{calls++;requests.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>({text:'已完成智能改写'})};}});
 vm.runInContext(nativeFunction(source,'runPromptLLMNode'),ctx);
 s.adapter.runLLMNode=(n,options)=>ctx.runPromptLLMNode(n.id,options);
 const p={...s.proposal,action:'run',chargeable:true,arguments:{maxCalls:1},runSettings:{taskKind:'llm',provider:'codex',model:'gpt-6.1-sol'},check:async()=>true};
 const receipt=await s.editor.execute(p);await s.editor.execute(p);
 assert.equal(calls,1);assert.equal(node.text,'已完成智能改写');assert.equal(node.llmModel,'gpt-6.1-sol');assert.equal(receipt.outputText,node.text);assert.equal(receipt.state,'succeeded');
 assert.deepEqual(requests[0].body.images,['/output/ref.png']);assert.equal(requests[0].body.provider,'codex');assert.equal(requests[0].body.model,'gpt-6.1-sol');
 assert.equal(node.storyAnalysisResult.sourceText,'实际原文');assert.equal(node.storyAnalysisResult.outputText,'已完成智能改写');
});






test('智能提示词异步确认拒绝、空返回和网络失败均保留原文且不重放',async()=>{
 const source=fs.readFileSync(require.resolve('../static/js/smart-canvas.js'),'utf8');
 for(const failure of ['check','empty','network']){
  const node={id:'p',type:'smart-prompt',llmEnabled:true,llmProvider:'codex',llmModel:'gpt-6.1-sol',text:'保留原文'},s=editorSetup(node);let calls=0;
  const ctx=createTaskContext({nodes:s.state.nodes,promptNodeLLMInputText:n=>n.text,render:()=>{},resolveChatProviderId:x=>x,resolveChatModel:x=>x,promptNodeInputMediaForLLM:()=>[],imageRefsOnly:()=>[],videoRefsOnly:()=>[],scheduleSave:()=>{},toast:()=>{},tr:x=>x,fetch:async()=>{calls++;if(failure==='network')throw new TypeError('断线');return {ok:true,json:async()=>({text:''})};}});
  vm.runInContext(nativeFunction(source,'runPromptLLMNode'),ctx);s.adapter.runLLMNode=(n,opts)=>ctx.runPromptLLMNode(n.id,opts);
  const p={...s.proposal,action:'run',chargeable:true,arguments:{maxCalls:1},runSettings:{taskKind:'llm'},check:async()=>failure!=='check'};
  await assert.rejects(s.editor.execute(p));await s.editor.execute(p);
  assert.equal(calls,failure==='check'?0:1);assert.equal(node.text,'保留原文');assert.equal(!!node.running,false);
 }
});
test('原任务回填复用两画布深度处理器，保留原编号/来源并清除忙碌，不重新提交',async()=>{
 for(const kind of ['classic','smart']){
  const name=kind==='classic'?'updateCanvasDepthCapture':'updateSmartDepthCapture';
  const source=fs.readFileSync(require.resolve(kind==='classic'?'../static/js/canvas.js':'../static/js/smart-canvas.js'),'utf8');
  const node={id:'depth',type:kind==='classic'?'image':'smart-image',pending:1,running:true,depthCapture:{taskId:'old',operationId:'operation',sourceUrl:'/output/source.mp4',status:'running',role:'depth'}};
  const s=editorSetup(node);const ctx=createTaskContext({refreshNodes:()=>{},render:()=>{},CanvasDepthCapture:{update:()=>{}},scheduleSave:()=>{}});
  vm.runInContext(nativeFunction(source,name),ctx);
  s.adapter.applyTask=(n,task,taskKind)=>{assert.equal(taskKind,'depth');ctx[name]([n],task,n.depthCapture.operationId);};
  const p={canvasId:'canvas',nodeId:'depth',arguments:{taskId:'old',taskKind:'depth'},receipt:{task:{id:'old',status:'cancelled',operation_id:'operation',source_url:'/output/source.mp4'}}};
  await s.editor.syncTask(p);
  assert.equal(node.depthCapture.status,'cancelled');assert.equal(node.depthCapture.taskId,'old');assert.equal(node.depthCapture.sourceUrl,'/output/source.mp4');
  if(kind==='smart'){assert.equal(node.pending,0);assert.equal(node.running,false);}
  assert.equal(s.saves(),1);
  await assert.rejects(s.editor.syncTask({...p,receipt:{task:{...p.receipt.task,id:'foreign'}}}),/编号/);
  await assert.rejects(s.editor.syncTask({...p,receipt:{task:{...p.receipt.task,source_url:'/output/other.mp4'}}}),/来源/);
 }
});
test('普通画布真实挂载和完成函数回填直接任务，空处理不得成功',async()=>{
 const source=fs.readFileSync(require.resolve('../static/js/canvas.js'),'utf8');
 const node={id:'g',type:'generator',x:0,y:0,_directPending:[{id:'p',canvasTaskId:'original',canvasTaskType:'online-image',run:{node:{id:'g'}}}]};
 const s=editorSetup(node);let mounted,seq=0;
 const ctx=createTaskContext({nodes:s.state.nodes,connections:s.state.connections,window:{CanvasAssistantNative:{createEditor:a=>{mounted=a;}}},setCanvasGroupMembers:()=>{},setCanvasWorkflowParameters:()=>{},resultMediaUrls:t=>t.images||[],uid:()=> 'new-'+(++seq),render:()=>{},scheduleSave:()=>{},nowMs:()=>0,requestMetaFromResult:()=>({}),appendOutputImages:(out,images)=>out.images.push(...images),mergeGeneratedOutputs:(n,images)=>n.generatedOutputs=images,addGenerationLog:()=>{},refreshRunNodes:()=>{}});
 Object.assign(ctx,{syncGeneratorInputs:()=>{},refreshGeneratorInputViews:()=>{},outputUrlValue:x=>typeof x==='string'?x:x.url,mediaKindForOutputItem:()=> 'image',outputNodesForSource:()=>s.state.nodes.filter(n=>n.type==='output'),CANVAS_MEDIA_OUTPUT_TYPES:['generator']});
 for(const name of ['findPendingTask','materializeCanvasDirectTasks','completeCanvasImageTask'])vm.runInContext(nativeFunction(source,name),ctx);
 const start=source.lastIndexOf('const nativeEditor=window.CanvasAssistantNative');vm.runInContext(source.slice(start,source.indexOf('window.CanvasAssistant?.mount',start)),ctx);
 s.adapter.applyTask=mounted.applyTask;
 const p={canvasId:'canvas',nodeId:'g',arguments:{taskId:'original',taskKind:'image'},receipt:{task:{task_id:'original',status:'succeeded',images:['/output/real.png']}}};
 assert.equal(await s.editor.syncTask(p),true);assert.equal(node._directPending?.length||0,0);assert.deepEqual(Array.from(node.generatedOutputs),['/output/real.png']);assert.equal(s.state.nodes.find(n=>n.type==='output').images[0].url,'/output/real.png');
 assert.equal(await s.editor.syncTask(p),false);assert.equal(s.state.nodes.length,2);
 const empty=editorSetup({id:'empty',type:'output',_pending:[{canvasTaskId:'original'}]});empty.adapter.applyTask=()=>false;
 await assert.rejects(empty.editor.syncTask({...p,nodeId:'empty'}),/回填/);assert.equal(empty.saves(),0);
});
test('助手图片运行遇到原生音频分支时拒绝提交',async()=>{
 const source=fs.readFileSync(require.resolve('../static/js/canvas.js'),'utf8');let audioCalls=0;
 const ctx=createTaskContext({nodes:[{id:'g',type:'generator'}],canvasApiAudioMode:()=>true,runCanvasApiAudio:async()=>{audioCalls++;}});
 vm.runInContext(nativeFunction(source,'runGenerator'),ctx);
 for(const opts of [{assistantNativeActionId:'confirmed-image'},{assistantProposal:{prompt:'图片',referenceImages:[]}}])await assert.rejects(ctx.runGenerator('g',opts),error=>error.submissionKnownRejected===true && /音频/.test(error.message));
 assert.equal(audioCalls,0);
 await ctx.runGenerator('g',{});assert.equal(audioCalls,1);
});
test('助手图片确认也拒绝上游音频转文字分支，手动执行保留',async()=>{
 const source=fs.readFileSync(require.resolve('../static/js/canvas.js'),'utf8');let audioCalls=0;
 const ctx=createTaskContext({nodes:[{id:'g',type:'generator',apiProvider:'manual',model:'chat'}],canvasApiAudioMode:()=>false,audioRefsOnly:s=>s.filter(r=>r.kind==='audio'),cascadeTargetIdFromOptions:()=>'',orderedSources:(_n,s)=>s,generatorSources:()=>[{prompt:'识别',refs:[{url:'/output/voice.wav',kind:'audio'}]}],audioRefsOnly:s=>s.filter(r=>r.kind==='audio'),providerChatModels:()=>['chat'],runAudioAnalysisGenerator:async()=>{audioCalls++;}});
 vm.runInContext(nativeFunction(source,'runGenerator'),ctx);
 for(const opts of [{assistantNativeActionId:'confirmed-image'},{assistantProposal:{prompt:'图片',referenceImages:[]}}])await assert.rejects(ctx.runGenerator('g',opts),error=>error.submissionKnownRejected===true && /音频/.test(error.message));
 assert.equal(audioCalls,0);await ctx.runGenerator('g',{});assert.equal(audioCalls,1);
});
test('ComfyUI真实执行编译使用新参数和上游正文，提交边界拦截',async()=>{
 const source=fs.readFileSync(require.resolve('../static/js/canvas.js'),'utf8');
 const fields=[{id:'steps',node:'1',input:'steps',type:'number',default:20},{id:'enabled',node:'1',input:'enabled',type:'boolean',default:false},{id:'prompt',node:'1',input:'prompt',type:'textarea'}];
 const node={id:'workflow',type:'comfy',mode:'custom',comfyWorkflow:'public.json',model:'user-model',count:8},requests=[];
 const ctx=createTaskContext({nodes:[node],cascadeTargetIdFromOptions:()=>null,generatorSources:()=>[{prompt:'原生上游正文'}],orderedSources:(_n,s)=>s,imageRefsOnly:()=>[],videoRefsOnly:()=>[],audioRefsOnly:()=>[],currentComfyWorkflow:()=>({config:{fields}}),outputForNode:()=>null,uid:()=> 'pending',runSnapshot:()=>({}),comfyRunLabel:()=> 'public',refreshRunNodes:()=>{},validComfyWorkflowName:x=>x,ensureComfyWorkflow:async()=>({config:{fields}}),comfyWorkflows:[],CLIENT_ID:'local-test',runQueuedComfyGenerate:async request=>{requests.push(JSON.parse(JSON.stringify(request)));return {images:['/output/fixture.png']};},requestMetaFromResult:()=>({}),comfyResultOutputs:r=>r.images,collectRunMeta:()=>({}),appendOutputImages:()=>{},mergeGeneratedOutputs:()=>{},addGenerationLog:()=>{},scheduleSave:()=>{},isCascadeAbortError:()=>false});
 for(const name of ['comfyFieldKind','comfyFields','comfyParamValue','comfyRandomEnabled','comfyRandomActive','setCanvasWorkflowParameters','runComfyNode'])vm.runInContext(nativeFunction(source,name),ctx);
 ctx.setCanvasWorkflowParameters(node,{steps:12,enabled:true});
 await ctx.runComfyNode(node.id,{cascade:true});
 assert.equal(requests.length,1);assert.deepEqual(requests[0].params,{'1':{steps:12,enabled:true,prompt:'原生上游正文'}});assert.equal(requests[0].workflow_json,'public.json');assert.equal(node.model,'user-model');assert.equal(node.runStatus,'done');
});
test('工作流动作使用原生参数setter并保留已有字段及上游来源标志',async()=>{
 for(const type of ['rh','comfy']){
  const node={id:'workflow',type,model:'user-model',rhParams:{'12::steps':{value:'20',sourceFromUpstream:false},keep:{value:'old'}},comfyParams:{keep:'old'}};
  const s=editorSetup(node);const source=fs.readFileSync(require.resolve('../static/js/canvas.js'),'utf8');
  const context=createTaskContext({});vm.runInContext(nativeFunction(source,'setCanvasWorkflowParameters'),context);
  s.adapter.setWorkflowParameters=context.setCanvasWorkflowParameters;
  await s.editor.execute({...s.proposal,action:'workflow_parameters',arguments:{patch:{[type==='rh'?'12::steps':'steps']:12}}});
  if(type==='rh'){assert.equal(node.rhParams['12::steps'].value,'12');assert.equal(node.rhParams['12::steps'].sourceFromUpstream,false);assert.equal(node.rhParams.keep.value,'old');}
  else{assert.equal(node.comfyParams.steps,12);assert.equal(node.comfyParams.keep,'old');}
  assert.equal(node.model,'user-model');assert.equal(s.undo(),1);assert.equal(s.saves(),2);
 }
});
test('助手 Comfy 随机参数在编译副本中派生，提交校验不被自身随机值破坏',async()=>{
 const source=fs.readFileSync(require.resolve('../static/js/canvas.js'),'utf8');
 const node={id:'wf',type:'comfy',mode:'custom',comfyWorkflow:'public.json',comfyParams:{seed:20}};
 const fields=[{id:'seed',node:'1',input:'seed',type:'number',default:20,random_enabled:true}];
 const s=editorSetup(node);const requests=[];
 const ctx=createTaskContext({nodes:s.state.nodes,cascadeTargetIdFromOptions:()=>null,generatorSources:()=>[],orderedSources:(_n,items)=>items,imageRefsOnly:()=>[],videoRefsOnly:()=>[],audioRefsOnly:()=>[],currentComfyWorkflow:()=>({config:{fields}}),outputForNode:()=>null,uid:()=> 'pending',runSnapshot:()=>({}),comfyRunLabel:()=> 'public',refreshRunNodes:()=>{},validComfyWorkflowName:x=>x,ensureComfyWorkflow:async()=>({config:{fields}}),comfyWorkflows:[],CLIENT_ID:'local',comfyRandomValue:()=>50,runQueuedComfyGenerate:async(request,opts)=>{await opts.beforeSubmit();requests.push(request);opts.onAccepted('accepted');return {images:['/output/random.png']};},requestMetaFromResult:()=>({}),comfyResultOutputs:r=>r.images,collectRunMeta:()=>({}),appendOutputImages:()=>{},mergeGeneratedOutputs:(n,images)=>n.generatedOutputs=images,addGenerationLog:()=>{},scheduleSave:()=>{},isCascadeAbortError:()=>false});
 for(const name of ['comfyFieldKind','comfyFields','comfyParamValue','comfyRandomEnabled','comfyRandomActive','runComfyNode'])vm.runInContext(nativeFunction(source,name),ctx);
 s.adapter.runNode=(n,opts)=>ctx.runComfyNode(n.id,{...opts,cascade:true});
 const result=await s.editor.execute({...s.proposal,nodeId:'wf',action:'run',chargeable:true,arguments:{maxCalls:1},runSettings:{taskKind:'comfy'},check:async()=>true});
 assert.equal(requests.length,1);assert.equal(requests[0].params['1'].seed,50);assert.equal(node.comfyParams.seed,20);assert.deepEqual(Array.from(result.taskIds),['accepted']);
});
test('分组动作复用画布成员处理器，保存且拒绝无处理器时假成功',async()=>{
 const node={id:'group',type:'group',items:[]};const s=editorSetup(node);s.state.nodes.push({id:'m',type:'image'});
 s.adapter.setGroupMembers=(group,ids)=>{group.items=[...ids];};
 const p={...s.proposal,action:'group_members',arguments:{memberIds:['m']},localSignature:s.editor.snapshot()};
 await s.editor.execute(p);assert.deepEqual(node.items,['m']);assert.equal(s.state.nodes.length,2);
 const other=editorSetup({id:'g',type:'group',items:[]});await assert.rejects(other.editor.execute({...other.proposal,action:'group_members',arguments:{memberIds:[]}}));
});
test('连接动作调用原生输入处理器并保存，智能循环复用原生自动打开输入开关',async()=>{
 const s=editorSetup({id:'loop',type:'smart-loop',imageInput:false,showPrompt:false});
 s.state.nodes.push({id:'p',type:'smart-prompt',text:'正文'});
 const source=fs.readFileSync(require.resolve('../static/js/smart-canvas.js'),'utf8');
 const ctx=createTaskContext({nodes:s.state.nodes,canvas:{connections:s.state.connections},isSmartGroupNode:()=>false,isSmartImageNode:n=>n.type==='smart-image',fitSmartLoopNode:()=>{}});
 for(const name of ['addConnection','connectInputNode'])vm.runInContext(nativeFunction(source,name),ctx);
 s.adapter.connectNodes=ctx.connectInputNode;
 await s.editor.execute({...s.proposal,action:'connect',arguments:{sourceId:'p'},localSignature:s.editor.snapshot()});
 assert.equal(s.state.nodes[0].showPrompt,true);assert.deepEqual(JSON.parse(JSON.stringify(s.state.connections)),[{from:'p',to:'loop',kind:'input'}]);
 const bad=editorSetup({id:'target',type:'smart-image'});bad.adapter.connectNodes=()=>false;
 await assert.rejects(bad.editor.execute({...bad.proposal,action:'connect',arguments:{sourceId:'source'}}),/连接/);
});
test('两画布真实分组处理器保留节点并复用原生输入移交和成员缩放',()=>{
 const classic=fs.readFileSync(require.resolve('../static/js/canvas.js'),'utf8');
 const group={id:'g',type:'group',items:[]},prompt={id:'p',type:'prompt'},gen={id:'gen',type:'generator'};
 const ctx=createTaskContext({nodes:[group,prompt,gen],connections:[{id:'c',from:'p',to:'gen'}],nodeBounds:()=>({x:100,y:100,w:300,h:200}),CANVAS_GENERATOR_TYPES:['generator'],canConnect:()=>true,uid:()=> 'new-c',syncGeneratorInputs:()=>{},refreshGeneratorInputViews:()=>{}});
 for(const name of ['handoffExistingInputsToGroup','setCanvasGroupMembers'])vm.runInContext(nativeFunction(classic,name),ctx);
 ctx.setCanvasGroupMembers(group,['p']);assert.equal(ctx.nodes.length,3);assert.deepEqual(JSON.parse(JSON.stringify(ctx.connections)),[{id:'new-c',from:'g',to:'gen'}]);assert.equal(group.x,76);assert.equal(group.y,12);
 const smart=fs.readFileSync(require.resolve('../static/js/smart-canvas.js'),'utf8'),sg={id:'sg',type:'smart-group',items:[],images:[{url:'/output/original.png'}]},sp={id:'sp',type:'smart-prompt'},image={id:'im',type:'smart-image',images:[{url:'/output/keep.png'}]};let scaled=0;
 let arranged=0;
 const sc=createTaskContext({nodes:[sg,sp,image],isSmartGroupNode:n=>n?.type==='smart-group',isSmartImageNode:n=>n?.type==='smart-image',smartGroupZoom:()=>1,scaleSmartGroupMemberToZoom:()=>scaled++,arrangeSmartGroupMembers:()=>arranged++});
 for(const name of ['addNodeToSmartGroup','setSmartGroupMemberIds'])vm.runInContext(nativeFunction(smart,name),sc);
 sc.setSmartGroupMemberIds(sg,['sp']);assert.deepEqual(JSON.parse(JSON.stringify(sg.items)),['sp']);assert.equal(scaled,1);assert.equal(arranged,1);assert.throws(()=>sc.setSmartGroupMemberIds(sg,['im']));assert.equal(sc.nodes.length,3);assert.equal(sg.images[0].url,'/output/original.png');assert.equal(image.images[0].url,'/output/keep.png');
});

test('智能原生setter及真实请求包装器使用新草稿，保留原提交和已有mention',()=>{
 const source=fs.readFileSync(require.resolve('../static/js/smart-canvas.js'),'utf8');
 const node={id:'result',type:'smart-image',runPrompt:'旧提交',runModelPrompt:'旧模型请求',runPromptRefs:[{url:'/output/ref.png'}],images:[{url:'/output/result.png'}],promptDraftHtml:'旧草稿',promptDraftText:'旧草稿'};
 const promptInput={innerHTML:'面板原内容',textContent:'面板原内容',dataset:{},get childNodes(){return [{nodeType:3,textContent:this.innerHTML}];}};
 const context=createTaskContext({promptInput,isSmartRunnableNode:()=>true,activeSettingsSubject:()=>node,escapeHtml:t=>String(t).replace(/</g,'&lt;'),promptHtmlWithMentionTokens:t=>t,setPromptText:t=>promptInput.innerHTML=t,smartLoopContext:null,Node:{TEXT_NODE:3,ELEMENT_NODE:1},blockedInputRefKeys:()=>new Set(),inputRefKey:r=>r.url,uniqueReferenceImages:x=>x,isSmartGroupNode:()=>false,inputPromptTextFor:()=>'',settings:{engine:'api'}});
 for(const name of ['setPromptDraftForNode','loadPromptDraft','loadNodePromptDraftToInput','buildPromptRequestForNode'])vm.runInContext(nativeFunction(source,name),context);
 context.setPromptDraftForNode(node,'新的中文草稿');
 const saved=JSON.parse(JSON.stringify(node));const request=context.buildPromptRequestForNode(saved,[]);
 assert.equal(request.prompt,'新的中文草稿');assert.equal(promptInput.innerHTML,'面板原内容');
 assert.equal(saved.runPrompt,'旧提交');assert.equal(saved.runModelPrompt,'旧模型请求');assert.equal(saved.images[0].url,'/output/result.png');
 saved.promptDraftHtml='<span class="mention-image-token">图片1</span> 新草稿';
 assert.equal(context.buildPromptRequestForNode(saved,[]).prompt,saved.promptDraftHtml);
 context.setPromptDraftForNode(node,'');assert.equal(context.buildPromptRequestForNode(node,[]).prompt,'');
});
test('普通图片自定义尺寸setter同步原生关联字段并进入真实尺寸请求',async()=>{
 const source=fs.readFileSync(require.resolve('../static/js/canvas.js'),'utf8');
 const context=createTaskContext({resolveImageModel:m=>m,isGptImageAutoSizeModel:()=>true,defaultApiImageResolution:()=> '4k',apiImageSize:(ratio,resolution,customRatio,customSize)=>resolution==='custom'?customSize:customRatio, getImageDimensions:async()=>({width:4,height:3})});
 for(const name of ['normalizeApiNodeSizeChoice','setCanvasGeneratorSizeFields','generatorSizeForRun'])vm.runInContext(nativeFunction(source,name),context);
 const node={type:'generator',model:'gpt-image-2',ratio:'story',resolution:'4k',customRatioWidth:'9',customRatioHeight:'16'};
 context.setCanvasGeneratorSizeFields(node,{customWidth:'1536',customHeight:'1024'});
 assert.equal(node.customSize,'1536x1024');assert.equal(node.ratio,'');assert.equal(node.resolution,'custom');assert.equal(node._apiResolutionUserSet,true);
 assert.equal(await context.generatorSizeForRun(JSON.parse(JSON.stringify(node)),[]),'1536x1024');
 context.setCanvasGeneratorSizeFields(node,{customRatioWidth:'4',customRatioHeight:'3',resolution:'2k'});
 assert.equal(node.customRatio,'4:3');assert.equal(node.ratio,'custom');assert.equal(node.resolution,'2k');
 assert.equal(await context.generatorSizeForRun(JSON.parse(JSON.stringify(node)),[]),'4:3');
 assert.equal(node.model,'gpt-image-2');
});
test('Modelscope尺寸setter同步原生字段，保存重开后尺寸请求使用新值',()=>{
 const source=fs.readFileSync(require.resolve('../static/js/canvas.js'),'utf8');
 const context=createTaskContext({});vm.runInContext(nativeFunction(source,'setCanvasMsSizeFields'),context);
 const node={type:'msgen',msgenModel:'zimage',msRatio:'story',msResolution:'4k',msCustomSize:'2048x2048'};
 context.setCanvasMsSizeFields(node,{msCustomWidth:'1536',msCustomHeight:'1024'});
 const saved=JSON.parse(JSON.stringify(node));
 assert.equal(saved.msCustomSize,'1536x1024');assert.equal(saved.msResolution,'custom');assert.equal(saved.msRatio,'');assert.equal(saved.msgenModel,'zimage');
 context.setCanvasMsSizeFields(node,{msResolution:'2k',msCustomRatioWidth:'4',msCustomRatioHeight:'3'});
 assert.equal(node.msCustomSize,'');assert.equal(node.msCustomRatio,'4:3');assert.equal(node.msRatio,'custom');assert.equal(node.msResolution,'2k');
});
test('真实智能循环setter保存数组、内部换行、空字段及兼容正文',async()=>{
 const s=editorSetup({id:'loop',type:'smart-loop'});
 await s.editor.execute({...s.proposal,action:'loop_prompts',arguments:{values:['  内部\n换行  ','','尾字段']}});
 assert.deepEqual(s.state.nodes[0].variablePrompts,['内部\n换行','','尾字段']);
 assert.equal(s.state.nodes[0].variablePrompt,'内部\n换行\n尾字段');assert.equal(s.saves(),2);
});
test('真实剪辑remove保存排除键，重开和上游同步不会将素材重新导入',async()=>{
 const media={kind:'video',url:'/output/video.mp4',sourceNodeId:'video',sourceResultId:'original',durationSeconds:3};
 const data=clipModel.addMedia(clipModel.createData(),media);
 const s=editorSetup({id:'clip',type:'clip',clipData:data});
 await s.editor.execute({...s.proposal,action:'clip_edit',arguments:{clipId:data.clips[0].id,clipAction:'remove'}});
 const saved=JSON.parse(JSON.stringify(s.state.nodes[0].clipData));
 assert.deepEqual(saved.excludedSources,['["video","original"]']);
 assert.equal(clipModel.syncSources(saved,[media]).clips.length,0);
 assert.equal(clipModel.addMedia(saved,media,{manual:true}).clips.length,1);
});
test('剪辑真实模型会夹取的范围在修改前拒绝，原时间线和撤销栈保持',async()=>{
 const data=clipModel.createData();data.clips=[{id:'a',kind:'video',startFrame:0,endFrame:90,sourceOffsetFrames:0,sourceDurationFrames:120},{id:'b',kind:'image',startFrame:90,endFrame:180}];
 for(const args of [{clipId:'b',clipAction:'move',startFrame:0},{clipId:'a',clipAction:'trim',startFrame:10,endFrame:200}]){
  const s=editorSetup({id:'clip',type:'clip',clipData:JSON.parse(JSON.stringify(data))});
  await assert.rejects(s.editor.execute({...s.proposal,action:'clip_edit',arguments:args}),/边界/);
  assert.deepEqual(s.state.nodes[0].clipData,data);assert.equal(s.undo(),0);
 }
});
for(const tableType of ['shot-table','smart-shot-table'])test(`${tableType}镜头正文、列与选择复用原生host/model，保留来源、时间和生成归属`,async()=>{
 const data=shotModel.createTable({nodeId:'video',sourceUrl:'/output/source.mp4'});data.rows=shotModel.buildShotRows([],2);data.generationMap={'original':{generatorId:'g'}};
 const s=editorSetup({id:'table',type:tableType,shotTableData:data});
 const host=shotHost.create({tableType,getState:()=>({canvas:{id:'canvas'},nodes:s.state.nodes,connections:s.state.connections}),model:shotModel,pushUndo:s.adapter.pushUndo,save:()=>{},render:()=>{}});
 s.adapter.shotModel=shotModel;s.adapter.shotHost=()=>host;
 let serial=0;const execute=async(action,args)=>s.editor.execute({...s.proposal,id:'shot-'+(++serial),updatedAt:s.state.updatedAt,localSignature:s.editor.snapshot(),action,arguments:args});
 const row=data.rows[0].id;
 await execute('shot_edit',{rowId:row,columnId:'motion',value:'轻缓推镜'});
 assert.equal(s.state.nodes[0].shotTableData.rows[0].cells.motion,'轻缓推镜');
 assert.equal(s.state.nodes[0].shotTableData.rows[0].motionPrompt,'');
 await execute('shot_column',{columnAction:'add',columnId:'custom-test',label:'商品细节'});
 await execute('shot_edit',{rowId:row,columnId:'custom-test',value:'包装文字'});
 await execute('shot_column',{columnAction:'rename',columnId:'custom-test',label:'包装细节'});
 let saved=JSON.parse(JSON.stringify(s.state.nodes[0].shotTableData));assert.equal(saved.columns.at(-1).hint,'商品细节');assert.equal(saved.rows[0].cells['custom-test'],'包装文字');
 await execute('shot_select',{selectedRowIds:[row]});
 saved=JSON.parse(JSON.stringify(s.state.nodes[0].shotTableData));assert.deepEqual(saved.selectedRowIds,[row]);assert.deepEqual(saved.source,data.source);assert.equal(saved.rows[0].endSeconds,2);assert.deepEqual(saved.generationMap,data.generationMap);
});
test('镜头生成链使用原生host、用户模型、保存保护，重复请求复用且不生成',async()=>{
 const data=shotModel.createTable({sourceUrl:'/output/source.mp4'});data.rows=shotModel.buildShotRows([],2);data.rows[0].imagePrompt='商品';
 const s=editorSetup({id:'table',type:'shot-table',x:10,y:10,shotTableData:data});let seq=0,hostSaves=0,runs=0;
 s.adapter.shotHost=()=>host;
 const host=shotHost.create({getState:()=>({canvas:{id:'canvas'},nodes:s.state.nodes,connections:s.state.connections}),pushUndo:s.adapter.pushUndo,save:()=>hostSaves++,render:()=>{},select:()=>{},uid:prefix=>prefix+(++seq),runGenerators:()=>runs++});
 const p={...s.proposal,action:'shot_materialize',arguments:{nodeId:'table',selectedRowIds:[data.rows[0].id]},creationSettings:{provider_id:'manual',model:'user-model',ratio:'story',resolution:'2k',quality:'high'}};
 await s.editor.execute(p);
 const gen=s.state.nodes.find(n=>n.type==='generator');assert.equal(gen.model,'user-model');assert.equal(gen.apiProvider,'manual');assert.equal(gen.ratio,'story');assert.equal(hostSaves,0);assert.equal(runs,0);assert.equal(s.state.nodes.length,4);
 await s.editor.execute({...p,id:'second',updatedAt:s.state.updatedAt,localSignature:s.editor.snapshot()});assert.equal(s.state.nodes.length,4);assert.equal(runs,0);
});
test('编辑器保存只递增版本可执行，保存期间正文变化或停止会拒绝',async()=>{
 for(const changed of ['text','stop']){
  const s=editorSetup({id:'p',type:'prompt',text:'before'});let stopped=false;
  s.adapter.check=async()=>!stopped;
  s.adapter.save=async()=>{s.state.updatedAt++;if(changed==='text')s.state.nodes[0].text='用户编辑';else stopped=true;return true;};
  await assert.rejects(s.editor.execute({...s.proposal,action:'update',editableFields:['text'],arguments:{patch:{text:'after'}}}));
  assert.equal(s.undo(),0);
 }
});
test('智能画布实际挂载适配器读取canvas.connections，不依赖普通画布变量',()=>{
 const source=fs.readFileSync(require.resolve('../static/js/smart-canvas.js'),'utf8');
 const start=source.lastIndexOf('const nativeEditor=window.CanvasAssistantNative');
 const adapterBlock=source.slice(start,source.indexOf('window.CanvasAssistant?.mount',start));
 const canvas={nodes:[{id:'p'}],connections:[{from:'a',to:'p'}]};let captured;
 const context=createTaskContext({window:{CanvasAssistantNative:{createEditor:a=>{captured=a;return {};}}},canvas,canvasId:'canvas',nodes:canvas.nodes,canvasForStorage:()=>canvas,setSmartLoopPromptFieldValues:()=>{},connectInputNode:()=>{}});
 vm.runInContext(nativeFunction(source,'setSmartGroupMemberIds'),context);
 vm.runInContext(adapterBlock,context);
 assert.deepEqual(JSON.parse(JSON.stringify(captured.getSnapshot())),{nodes:canvas.nodes,connections:canvas.connections});
});

function rhNativeRunSetup(){
 const node={id:'rh',type:'rh',rhMode:'model',rhConfigKey:'model:selected',rhModel:'selected',model:'selected',apiProvider:'runninghub',count:1,outputEnabled:true};
 const s=editorSetup(node),out={id:'out',type:'output',images:[]};s.state.nodes.push(out);s.state.connections.push({from:'rh',to:'out'});
 let submissions=0,queries=0;const backups=[],payloads=[];
 const source=fs.readFileSync(require.resolve('../static/js/canvas.js'),'utf8');
 const ctx=createTaskContext({nodes:s.state.nodes,connections:s.state.connections,canvas:{id:'fixture'},CANVAS_UNSAVED_ACCEPTED_TASKS_PREFIX:'accepted:',localStorage:{getItem:()=>null,setItem:()=>{}},rhSelectedEntryRef:()=>({kind:'model',id:'selected'}),cascadeTargetIdFromOptions:()=>'',rhMediaSources:()=>({prompt:'原生中文',refs:[{url:'/output/ref.png',kind:'image'}]}),imageRefsOnly:x=>x,confirmCanvasUnknownResubmission:()=>true,outputForNode:()=>out,runSnapshot:n=>({node:{id:n.id}}),generatorSizeForRun:async n=>{n.ratio='derived';return '1024x1024';},normalizedImageQuality:()=>'',CANVAS_REFERENCE_IMAGE_MAX:8,nowMs:()=>10,refreshRunNodes:()=>{},setTimeout:()=>{},rememberCanvasSubmissionWarning:()=>{},cascadeContextFor:()=>null,cascadeFetch:async(url,opts)=>{submissions++;payloads.push(JSON.parse(opts.body));return {ok:true,json:async()=>({task_id:'rh-original'})};},tr:x=>x,uid:()=> 'pending',makePendingForRun:(id,run,n,opts,extra)=>({id,run,...extra}),rememberUnsavedCanvasAcceptedTasks:(n,tasks)=>{backups.push(JSON.parse(JSON.stringify({run:n.assistantNativeRun,tasks})));return true;},scheduleSave:()=>{},saveCanvas:async()=>true,pollCanvasImageTask:async id=>{queries++;out.images=[{url:'/output/rh.png'}];out._pending=[];return 'succeeded';},pendingById:(o,id)=>o?._pending?.find(p=>p.id===id),showErrorModal:()=>{},isCascadeAbortError:()=>false});
 for(const name of ['createCanvasImageTask','submitCanvasImageTaskBatch','pauseCanvasAcceptedTasksUntilSaved','runRhModelNode'])vm.runInContext(nativeFunction(source,name),ctx);
 s.adapter.runNode=(n,opts)=>ctx.runRhModelNode(n,opts);
 const p={...s.proposal,localSignature:undefined,nodeId:'rh',action:'run',chargeable:true,arguments:{maxCalls:1},runSettings:{taskKind:'image',maxCalls:1},check:async()=>true};
 return {...s,node,out,ctx,p,backups,payloads,submissions:()=>submissions,queries:()=>queries};
}
test('RH 模型确认单次原生提交并立即备份原动作编号，重复不重提',async()=>{
 const s=rhNativeRunSetup();const receipt=await s.editor.execute(s.p);await s.editor.execute(s.p);
 assert.equal(s.submissions(),1);assert.equal(s.queries(),1);assert.equal(receipt.taskIds[0],'rh-original');
 assert.equal(s.payloads[0].model,'selected');assert.equal(s.payloads[0].provider_id,'runninghub');assert.equal(s.node.ratio,undefined);
 assert.equal(s.backups[0].run.actionId,s.p.id);assert.equal(s.backups[0].tasks[0].canvasTaskId,'rh-original');
});
test('RH 最终确认变化、配置失配与保存失败均不重提；保存失败保留原编号',async()=>{
 for(const mode of ['changed','config','save']){
  const s=rhNativeRunSetup();if(mode==='changed')s.p.check=async()=>{s.node.rhModel='changed';return true;};
  if(mode==='config')s.ctx.rhSelectedEntryRef=()=>({kind:'model',id:'other'});
  if(mode==='save')s.ctx.saveCanvas=async()=>false;
  if(mode==='save'){const receipt=await s.editor.execute(s.p);assert.equal(receipt.taskIds[0],'rh-original');assert.equal(s.submissions(),1);assert.equal(s.queries(),0);}
  else{await assert.rejects(s.editor.execute(s.p));assert.equal(s.submissions(),0);}
 }
});

test('RH 受理后保存失败刷新用本地备份重建原动作，重复备份不丢归属',()=>{
 const source=fs.readFileSync(require.resolve('../static/js/canvas.js'),'utf8');let storage='[]';
 const node={id:'rh',type:'rh',assistantNativeRun:{actionId:'action',taskKind:'image',taskIds:['original']}};
 const out={id:'out',type:'output',images:[]};const nodes=[node,out],connections=[{from:'rh',to:'out'}];
 const ctx=createTaskContext({nodes,connections,canvas:{id:'fixture'},CANVAS_UNSAVED_ACCEPTED_TASKS_PREFIX:'accepted:',localStorage:{getItem:()=>storage,setItem:(_k,v)=>storage=v},nowMs:()=>10,findPendingTask:id=>{const pending=out._pending?.find(p=>p.canvasTaskId===id);return pending?{out,pending}:null;},uid:()=> 'pending',scheduleSave:()=>{}});
 for(const name of ['rememberUnsavedCanvasAcceptedTasks','restoreUnsavedCanvasAcceptedTasks'])vm.runInContext(nativeFunction(source,name),ctx);
 const task={canvasTaskId:'original',canvasTaskType:'online-image',providerId:'runninghub',model:'selected'};
 assert.equal(ctx.rememberUnsavedCanvasAcceptedTasks(node,[task],out),true);
 delete node.assistantNativeRun;
 ctx.rememberUnsavedCanvasAcceptedTasks(node,[task],out);
 assert.equal(ctx.restoreUnsavedCanvasAcceptedTasks(),1);
 assert.equal(node.assistantNativeRun.actionId,'action');assert.deepEqual(Array.from(node.assistantNativeRun.taskIds),['original']);
 assert.equal(out._pending[0].savePending,true);assert.equal(out._pending[0].queryRecoverable,true);
 delete node.assistantNativeRun;
 assert.equal(ctx.restoreUnsavedCanvasAcceptedTasks(),1);assert.equal(node.assistantNativeRun.actionId,'action');assert.equal(out._pending.length,1);
});

test('RH 最终异步确认期间断开或替换输出拒绝且零提交',async()=>{
 for(const mode of ['disconnect','delete','replace']){
  const s=rhNativeRunSetup();s.p.check=async()=>{if(mode==='disconnect')s.state.connections.splice(0);else if(mode==='delete')s.state.nodes.splice(1,1);else s.state.nodes[1]={...s.out};return true;};
  await assert.rejects(s.editor.execute(s.p));assert.equal(s.submissions(),0);assert.equal(s.queries(),0);
 }
});

test('RH 新受理备份恢复覆盖旧完成动作但不覆盖时间更新的其它动作',()=>{
 const source=fs.readFileSync(require.resolve('../static/js/canvas.js'),'utf8');
 for(const newer of [false,true]){
  const node={id:'rh',type:'rh',runStatus:'done',assistantNativeRun:{actionId:'old',taskKind:'image',taskIds:['old-task'],...(newer?{startedAt:30}:{})}};
  const out={id:'out',type:'output',images:[]};const ctx=createTaskContext({nodes:[node,out],connections:[{from:'rh',to:'out'}],canvas:{id:'fixture'},CANVAS_UNSAVED_ACCEPTED_TASKS_PREFIX:'accepted:',localStorage:{getItem:()=>JSON.stringify([{taskId:'new-task',nodeId:'rh',outputId:'out',taskType:'online-image',assistantNativeActionId:'new',assistantPreviousActionId:'old',assistantTaskKind:'image',assistantRunStartedAt:20,startedAt:20}])},findPendingTask:()=>null,uid:()=> 'pending',scheduleSave:()=>{},nowMs:()=>40});
  vm.runInContext(nativeFunction(source,'restoreUnsavedCanvasAcceptedTasks'),ctx);ctx.restoreUnsavedCanvasAcceptedTasks();
  assert.equal(node.assistantNativeRun.actionId,newer?'old':'new');assert.equal(out._pending[0].canvasTaskId,'new-task');
 }
});

test('RH 真实保存删除运行状态后，备份以明确前序动作绑定恢复新动作',()=>{
 const source=fs.readFileSync(require.resolve('../static/js/canvas.js'),'utf8');const ctx=createTaskContext({});
 vm.runInContext(nativeFunction(source,'serializableCanvasNode'),ctx);
 const node=ctx.serializableCanvasNode({id:'rh',type:'rh',runStatus:'done',assistantNativeRun:{actionId:'old',taskKind:'image',taskIds:['old-task']}});
 assert.equal(node.runStatus,undefined);
 const out={id:'out',type:'output',images:[]};Object.assign(ctx,{nodes:[node,out],connections:[{from:'rh',to:'out'}],canvas:{id:'fixture'},CANVAS_UNSAVED_ACCEPTED_TASKS_PREFIX:'accepted:',localStorage:{getItem:()=>JSON.stringify([{taskId:'new-task',nodeId:'rh',outputId:'out',taskType:'online-image',assistantNativeActionId:'new',assistantPreviousActionId:'old',assistantTaskKind:'image',assistantRunStartedAt:20}])},findPendingTask:()=>null,uid:()=> 'pending',scheduleSave:()=>{},nowMs:()=>40});
 vm.runInContext(nativeFunction(source,'restoreUnsavedCanvasAcceptedTasks'),ctx);ctx.restoreUnsavedCanvasAcceptedTasks();
 assert.equal(node.assistantNativeRun.actionId,'new');assert.deepEqual(Array.from(node.assistantNativeRun.taskIds),['new-task']);
 const s=rhNativeRunSetup();s.node.assistantNativeRun={actionId:'previous',taskKind:'image',taskIds:['old']};
 return s.editor.execute(s.p).then(()=>assert.equal(s.backups[0].run.previousActionId,'previous'));
});

test('RH workflow/app 确认后只提交一次并保存原任务后查询',async()=>{
 for(const mode of ['workflow','app']){
  const id=mode==='workflow'?'wf-user':'app-user';
  const node={id:'rh',type:'rh',rhMode:mode,rhConfigKey:`${mode}:${id}`,workflowId:mode==='workflow'?id:'',webappId:mode==='app'?id:'',apiProvider:'runninghub',count:1,outputEnabled:true,rhParams:{'12::steps':{value:'20'}},assistantNativeRun:{actionId:`action-${mode}`,taskKind:'runninghub',taskIds:[],submissionStarted:false}};
  const out={id:'out',type:'output',images:[]},nodes=[node,out],connections=[{from:'rh',to:'out'}];
  let submits=0,queries=0,saves=0,checks=0;const backups=[];
  const source=fs.readFileSync(require.resolve('../static/js/canvas.js'),'utf8');
  const ctx=createTaskContext({nodes,connections,canvas:{id:'canvas'},cascadeTargetIdFromOptions:()=>'',ensureRhNodeSelection:()=>{},rhCurrentKind:()=>mode,rhSelectedEntryRef:()=>({kind:mode,id,entry:{id}}),ensureRunningHubWorkflowConfigForNode:async()=>{},rhActiveFields:()=>[{nodeId:'12',fieldName:'steps'}],rhMediaSources:()=>({prompt:'原生中文',refs:[]}),outputForNode:()=>out,uid:x=>x+'-1',runSnapshot:n=>({node:{id:n.id}}),makePendingForRun:(pid,run,n,opts)=>({id:pid,run,startedAt:1,...opts}),refreshRunNodes:()=>{},rhBuildNodeInfoList:async()=>[{nodeId:'12',fieldName:'steps',fieldValue:20}],rhBuildWorkflowRequestExtras:async()=>({}),rhUseWallet:()=>false,cascadeFetch:async(url,opts)=>{if(url.includes('/query')){queries++;return {ok:true,json:async()=>({success:true,data:{status:'SUCCESS',urls:['/output/rh.png']}})}}submits++;return {ok:true,json:async()=>({success:true,data:{taskId:'rh-original'}})};},sleep:async()=>{},collectRunMeta:()=>({runMs:1}),appendOutputImages:(o,urls)=>o.images.push(...urls.map(url=>({url}))),mergeGeneratedOutputs:(n,urls)=>n.generatedOutputs=urls,addGenerationLog:()=>{},scheduleSave:()=>{},rememberUnsavedCanvasAcceptedTasks:(n,tasks)=>{backups.push(JSON.parse(JSON.stringify({run:n.assistantNativeRun,tasks})));return true;},saveCanvas:async()=>{saves++;return true;},pendingById:(o,pid)=>o._pending.find(p=>p.id===pid),pauseCanvasAcceptedTasksUntilSaved:()=>new Error('save failed'),isCascadeAbortError:()=>false,alert:()=>{},tr:x=>x});
  vm.runInContext(nativeFunction(source,'runRhNode'),ctx);
  await ctx.runRhNode('rh',{assistantNativeActionId:`action-${mode}`,assistantCanvasId:'canvas',assistantOutputNodeId:'out',assistantRunInputHash:'a'.repeat(64),beforeSubmit:async()=>checks++});
  assert.equal(submits,1,mode);assert.equal(queries,1,mode);assert.equal(checks,1,mode);assert.ok(saves>=1,mode);
  assert.deepEqual(Array.from(node.assistantNativeRun.taskIds),['rh-original']);assert.equal(node.assistantNativeRun.taskKind,'runninghub');assert.deepEqual(Array.from(node.assistantNativeRun.resultUrls),['/output/rh.png']);
  assert.equal(backups[0].tasks[0].canvasTaskId,'rh-original');assert.equal(out.images[0].url,'/output/rh.png');assert.equal(out._pending.length,0);
 }
});

test('RH workflow/app 刷新后只恢复查询原任务，不重新提交',async()=>{
 const source=fs.readFileSync(require.resolve('../static/js/canvas.js'),'utf8');
 const calls=[];const pending={canvasTaskId:'rh-original',canvasTaskType:'runninghub',useWallet:true,savePending:false};
 const ctx=createTaskContext({pollCanvasComfyTask:()=>calls.push('comfy'),pollCanvasVideoTask:()=>calls.push('video'),pollCanvasImageTask:()=>calls.push('image'),pollCanvasRunningHubTask:(id,opts)=>{calls.push(['runninghub',id,opts.useWallet]);return 'running';},saveCanvas:async()=>true,scheduleSave:()=>{},showErrorModal:()=>{},tr:x=>x});
 vm.runInContext(nativeFunction(source,'saveAndQueryCanvasPendingTask'),ctx);
 assert.equal(await ctx.saveAndQueryCanvasPendingTask(pending),'running');
 assert.deepEqual(calls,[['runninghub','rh-original',true]]);
});

test('RH 原编号恢复保存本轮结果，旧动作轮询不覆盖新动作回执',async()=>{
 const source=fs.readFileSync(require.resolve('../static/js/canvas.js'),'utf8');
 for(const currentAction of ['original-action','new-action']){
  const node={id:'rh',assistantNativeRun:{actionId:currentAction,taskIds:['rh-original'],inputHash:'input',outputNodeId:'out'}};
  const pending={id:'p',run:{node:{id:'rh'}},assistantNativeActionId:'original-action',assistantInputHash:'input'};
  const out={id:'out',images:[{url:'/output/old.png'}],_pending:[pending]};let queries=0;
  const ctx=createTaskContext({nodes:[node,out],activeCanvasTaskPolls:new Set(),findPendingTask:()=>({pending,out}),fetch:async()=>{queries++;return {ok:true,json:async()=>({success:true,data:{status:'SUCCESS',urls:['/output/current.png']}})}},collectRunMeta:()=>({runMs:1}),appendOutputImages:(o,urls)=>o.images.push(...urls.map(url=>({url}))),mergeGeneratedOutputs:()=>{},addGenerationLog:()=>{},refreshRunNodes:()=>{},scheduleSave:()=>{},tr:x=>x});
  vm.runInContext(nativeFunction(source,'pollCanvasRunningHubTask'),ctx);
  assert.equal(await ctx.pollCanvasRunningHubTask('rh-original'),'succeeded');assert.equal(queries,1);assert.equal(out.images[1].url,'/output/current.png');
  if(currentAction==='original-action'){assert.deepEqual(Array.from(node.assistantNativeRun.resultUrls),['/output/current.png']);assert.equal(node.assistantNativeRun.status,'succeeded');}
  else{assert.equal(node.assistantNativeRun.resultUrls,undefined);assert.equal(node.assistantNativeRun.status,undefined);}
 }
});
