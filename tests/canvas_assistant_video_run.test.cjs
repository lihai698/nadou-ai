const {createTaskContext}=require('./canvas_task_test_helpers.cjs');
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const native=require('../static/js/canvas-assistant-native.js');
const source=fs.readFileSync(require.resolve('../static/js/canvas.js'),'utf8');
function load(ctx,name){const match=source.match(new RegExp('(?:async )?function '+name+'\\([^\\n]*\\).*?\\n\\}','s'));assert.ok(match,name);vm.runInContext(match[0],ctx);}
function setup(){
 const node={id:'video',type:'video',apiProvider:'manual',model:'user-video',outputEnabled:true,duration:5,aspectRatio:'16:9'};
 const out={id:'out',type:'output',images:[]},prompt={id:'prompt',type:'prompt',text:'原生视频正文'};
 const state={id:'canvas',updatedAt:7,nodes:[node,out,prompt],connections:[{from:'prompt',to:'video'},{from:'video',to:'out'}]};
 const submissions=[],storage=new Map();let serial=0,saves=0,polls=0;let saveHook=()=>true;
 const ctx=createTaskContext({nodes:state.nodes,connections:state.connections,canvas:{id:'canvas'},outputNodesForSource:()=>state.connections.filter(c=>c.from===node.id).map(c=>state.nodes.find(n=>n.id===c.to)).filter(n=>n?.type==='output'),CANVAS_MEDIA_OUTPUT_TYPES:['video'],mediaKindForOutputItem:x=>x?.kind||'video',isVideoUrl:()=>true,apiProviders:[{id:'manual',video_models:['user-video'],enabled:true}],uid:p=>p+'12345678'+(++serial),nowMs:()=>10,
  cascadeTargetIdFromOptions:()=>'',orderedSources:(_,s)=>s,generatorSources:()=>[{prompt:prompt.text,refs:[]}],applyUploadedUrlToRefs:x=>x,mediaKindForRef:x=>x.kind,imageRefsOnly:x=>x.filter(v=>v.kind==='image'),videoRefsOnly:x=>x.filter(v=>v.kind==='video'),audioRefsOnly:x=>x.filter(v=>v.kind==='audio'),manualVideoUrlForNode:()=>'',tempShUploadedUrlForNode:(_,u)=>u,
  outputForNode:()=>out,runSnapshot:(n,p,refs)=>({node:{id:n.id},prompt:p,refs}),makePendingForRun:(id,run)=>({id,run,startedAt:10}),refreshRunNodes:()=>{},resolveVideoProviderId:x=>x,
  saveCanvas:async()=>{saves++;state.updatedAt++;return saveHook(saves);},scheduleSave:()=>{},fetch:async(url,opts)=>{const body=JSON.parse(opts.body);submissions.push(body);return {ok:true,json:async()=>({task_id:body.client_task_id,provider_id:body.provider_id,model:body.model,canvas_id:body.canvas_id,node_id:body.node_id,assistant_action_id:body.assistant_action_id,input_hash:body.input_hash,status:'queued'})};},responseErrorMessage:async()=> '拒绝',
  waitCanvasVideoTaskResult:async()=>{polls++;return {videos:['/output/video.mp4']};},resultMediaUrls:r=>r.videos||[],outputUrlValue:x=>typeof x==='string'?x:x?.url,collectRunMeta:()=>({runMs:1}),requestMetaFromResult:()=>({}),appendOutputImages:(o,items)=>o.images.push(...items),mergeGeneratedOutputs:(n,items)=>n.generatedOutputs=items,addGenerationLog:()=>{},tr:x=>x,alert:()=>{},isCascadeAbortError:()=>false,
  rememberUnsavedCanvasAcceptedTasks:(n,t,o)=>{storage.set('backup',JSON.parse(JSON.stringify({run:n.assistantNativeRun,tasks:t,out:o.id})));return true;},pauseCanvasAcceptedTasksUntilSaved:(_,tasks)=>tasks.forEach(t=>{t.savePending=true;t.queryPaused=true;}),
 });
 ctx.findPendingTask=id=>{const pending=(out._pending||[]).find(p=>p.canvasTaskId===id);return pending?{out,pending}:null;};
 for(const name of ['outputHasUrl','appendOutputImagesWithoutDuplicates','canvasVideoTaskIdForPending','createCanvasVideoTask','completeCanvasVideoTask','runVideoNode'])load(ctx,name);
 const adapter={getState:()=>state,getSnapshot:()=>({nodes:state.nodes,connections:state.connections}),save:async()=>{state.updatedAt++;return true;},check:p=>p.check(),runNode:(n,o)=>ctx.runVideoNode(n.id,o)};
 const editor=native.createEditor(adapter);
 const proposal={id:'video-action',canvasId:'canvas',updatedAt:7,nodeId:node.id,nodeType:'video',action:'run',arguments:{nodeId:node.id,maxCalls:1},chargeable:true,runInputHash:'a'.repeat(64),outputNodeId:'out',runSettings:{provider:'manual',model:'user-video',taskKind:'video',maxCalls:1},check:async()=>true};
 return {node,out,prompt,state,ctx,adapter,editor,proposal,submissions,storage,polls:()=>polls,setSaveHook:fn=>saveHook=fn};
}
test('视频原生运行提交一次并绑定原模型输入动作；受理先备份保存再轮询',async()=>{
 const s=setup();const r=await s.editor.execute(s.proposal);await s.editor.execute(s.proposal);
 assert.equal(s.submissions.length,1);assert.equal(s.polls(),1);
 const body=s.submissions[0];assert.equal(body.assistant_action_id,'video-action');assert.equal(body.canvas_id,'canvas');assert.equal(body.node_id,'video');assert.equal(body.input_hash,'a'.repeat(64));assert.equal(body.model,'user-video');assert.equal(body.prompt,'原生视频正文');
 assert.deepEqual(r.taskIds,[body.client_task_id]);assert.equal(s.storage.get('backup').run.taskIds[0],body.client_task_id);assert.equal(s.out.images[0].kind,'video');
});
test('视频提交前异步确认和保存期间输入、停止、只读或输出变化全部零提交',async()=>{
 for(const mode of ['prompt','stop','readonly','output','replace','save-input','save-stop','provider']){
  const s=setup();let checks=0,stopped=false;
  s.proposal.check=async()=>{checks++;if(checks===3){if(mode==='prompt')s.prompt.text='已变';if(mode==='stop')stopped=true;if(mode==='readonly')s.state.readOnly=true;if(mode==='output')s.state.connections.pop();if(mode==='replace')s.state.nodes[1]={...s.out};if(mode==='provider')s.ctx.apiProviders=[];}return !stopped;};
  s.setSaveHook(index=>{if(index===2){if(mode==='save-input')s.prompt.text='已变';if(mode==='save-stop')stopped=true;}return true;});
  await assert.rejects(s.editor.execute(s.proposal),undefined,mode);assert.equal(s.submissions.length,0,mode);assert.equal(s.node.assistantNativeRun.knownRejected,true,mode);
 }
});
test('视频预保存失败不提交；受理保存失败不轮询且重复确认不重提',async()=>{
 for(const failAt of [1,3]){
  const s=setup();s.setSaveHook(index=>index!==failAt);
  if(failAt===1){await assert.rejects(s.editor.execute(s.proposal));assert.equal(s.submissions.length,0);assert.equal(s.node.assistantNativeRun.knownRejected,true);}
  else{const r=await s.editor.execute(s.proposal);assert.equal(r.taskIds.length,1);await s.editor.execute(s.proposal);assert.equal(s.submissions.length,1);assert.equal(s.out._pending[0].savePending,true);}
  assert.equal(s.polls(),0);
 }
});
test('视频响应丢失或编号错误只保留预分配ID；刷新查询不能重放POST',async()=>{
 for(const mode of ['lost','wrong-id']){
  const s=setup();s.ctx.fetch=async(_,opts)=>{const body=JSON.parse(opts.body);s.submissions.push(body);if(mode==='lost')throw new Error('响应丢失');return {ok:true,json:async()=>({task_id:'foreign'})};};
  await assert.rejects(s.editor.execute(s.proposal));assert.equal(s.submissions.length,1);assert.equal(s.polls(),0);assert.equal(s.node.assistantNativeRun.submissionStarted,true);assert.deepEqual(s.node.assistantNativeRun.taskIds,[]);assert.equal(s.node.assistantNativeRun.plannedTaskId,s.submissions[0].client_task_id);assert.equal(s.node.submissionUnknown,true);
  await s.editor.execute(s.proposal);assert.equal(s.submissions.length,1);
 }
});
test('视频运行查询回填只允许原输出和严格归属，保存后补已受理编号',async()=>{
 const s=setup();const id='canvas_video_query123';s.node.assistantNativeRun={actionId:s.proposal.id,taskKind:'video',taskIds:[],plannedTaskId:id,submissionStarted:true};s.node.submissionUnknown=true;
 s.out._pending=[{canvasTaskId:id,canvasTaskType:'video',assistantNativeActionId:s.proposal.id,run:{node:{id:s.node.id}}}];
 const task={task_id:id,status:'succeeded',canvas_id:'canvas',node_id:'video',assistant_action_id:s.proposal.id,input_hash:s.proposal.runInputHash,provider_id:'manual',model:'user-video',result:{videos:['/output/video.mp4']}};
 let applied=0;s.adapter.applyTask=(n,t,k)=>{applied++;assert.equal(k,'video');s.out.images=[{url:t.result.videos[0],kind:'video'}];return true;};
 for(const field of ['canvas_id','node_id','assistant_action_id','input_hash','provider_id','model'])await assert.rejects(s.editor.syncTask({...s.proposal,receipt:{tasks:[{...task,[field]:'foreign'}]}}));
 assert.equal(applied,0);
 assert.equal(await s.editor.syncTask({...s.proposal,receipt:{tasks:[task]}}),true);assert.equal(applied,1);assert.deepEqual(s.node.assistantNativeRun.taskIds,[id]);assert.equal(s.node.submissionUnknown,false);
 s.state.connections.pop();await assert.rejects(s.editor.syncTask({...s.proposal,receipt:{tasks:[task]}}));assert.equal(applied,1);
});
test('视频原生查询核对实际服务归属，回填拒绝已断开或替换的原输出',async()=>{
 const s=setup(),id='canvas_video_bound123';
 s.node.assistantNativeRun={actionId:s.proposal.id,taskKind:'video',taskIds:[],plannedTaskId:id,outputNodeId:'out',inputHash:s.proposal.runInputHash};
 const pending={id:'pending',canvasTaskId:id,canvasTaskType:'video',assistantNativeActionId:s.proposal.id,assistantCanvasId:'canvas',assistantInputHash:s.proposal.runInputHash,providerId:'manual',model:'user-video',run:{node:{id:'video'},refs:[]}};s.out._pending=[pending];
 Object.assign(s.ctx,{findPendingTask:taskId=>taskId===id&&s.out._pending.includes(pending)?{out:s.out,pending}:null,cascadeFetch:async()=>({ok:true,status:200,json:async()=>({task_id:id,status:'succeeded',canvas_id:'canvas',node_id:'video',assistant_action_id:s.proposal.id,input_hash:s.proposal.runInputHash,provider_id:'manual',model:'user-video',result:{videos:['/output/video.mp4']}})}),sleep:async()=>{}});
 load(s.ctx,'waitCanvasVideoTaskResult');load(s.ctx,'completeCanvasVideoTask');
 const result=await s.ctx.waitCanvasVideoTaskResult(id);assert.equal(result.videos[0],'/output/video.mp4');
 s.ctx.cascadeFetch=async()=>({ok:true,status:200,json:async()=>({task_id:id,status:'succeeded',result:{videos:['/output/foreign.mp4']}})});
 await assert.rejects(s.ctx.waitCanvasVideoTaskResult(id),/归属/);
 s.state.connections.pop();assert.throws(()=>s.ctx.completeCanvasVideoTask(id,result),/输出/);assert.equal(s.out.images.length,0);
 s.state.connections.push({from:'video',to:'out'});assert.equal(s.ctx.completeCanvasVideoTask(id,result),true);assert.deepEqual(Array.from(s.node.assistantNativeRun.taskIds),[id]);assert.equal(s.out.images[0].kind,'video');
 s.out._pending=[pending];assert.equal(s.ctx.completeCanvasVideoTask(id,result),true);assert.equal(s.out.images.length,1);
});
test('视频受理备份重开保留video种类与归属，不给失去原输出的助手任务另建输出',()=>{
 const s=setup(),id='canvas_video_backup123',storage=new Map();s.node.assistantNativeRun={actionId:s.proposal.id,taskKind:'video',taskIds:[id],plannedTaskId:id,inputHash:s.proposal.runInputHash,outputNodeId:'out',startedAt:10};
 Object.assign(s.ctx,{CANVAS_UNSAVED_ACCEPTED_TASKS_PREFIX:'backup:',localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},findPendingTask:()=>null});
 for(const name of ['unsavedCanvasAcceptedTasksKey','readUnsavedCanvasAcceptedTasks','rememberUnsavedCanvasAcceptedTasks','restoreUnsavedCanvasAcceptedTasks'])load(s.ctx,name);
 s.ctx.rememberUnsavedCanvasAcceptedTasks(s.node,[{canvasTaskId:id,canvasTaskType:'video',providerId:'manual',model:'user-video'}],s.out);
 delete s.node.assistantNativeRun;s.ctx.restoreUnsavedCanvasAcceptedTasks();
 assert.equal(s.node.assistantNativeRun.taskKind,'video');assert.equal(s.node.assistantNativeRun.inputHash,s.proposal.runInputHash);assert.equal(s.out._pending[0].canvasTaskType,'video');assert.equal(s.out._pending[0].assistantNativeActionId,s.proposal.id);
 s.state.nodes.splice(1,1);s.ctx.restoreUnsavedCanvasAcceptedTasks();assert.equal(s.state.nodes.some(n=>n.type==='output'),false);
});
test('普通手动视频关闭输出时仍保留原生节点结果，助手限制不破坏手动入口',async()=>{
 const s=setup();s.node.outputEnabled=false;s.ctx.outputForNode=()=>null;
 await s.ctx.runVideoNode(s.node.id);
 assert.equal(s.submissions.length,1);assert.equal(s.polls(),1);assert.equal(s.node.generatedOutputs?.[0]?.url,'/output/video.mp4');assert.equal(s.node.runStatus,'done');
});
for(const outcome of ['success','failure']){
 test(`手动视频${outcome}晚于清空时不回填旧输出、日志或触发保存`,async()=>{
  const s=setup(),effects=[];let resolve,reject;
  const waiting=new Promise((a,b)=>{resolve=a;reject=b;});s.ctx.waitCanvasVideoTaskResult=()=>waiting;
  s.ctx.addGenerationLog=()=>effects.push('log');s.ctx.scheduleSave=()=>effects.push('save');s.ctx.refreshRunNodes=()=>effects.push('render');s.ctx.alert=()=>effects.push('alert');
  load(s.ctx,'findPendingTask');const running=s.ctx.runVideoNode(s.node.id);await new Promise(r=>setImmediate(r));
  assert.equal(s.submissions.length,1);s.state.nodes.length=0;effects.length=0;
  if(outcome==='success')resolve({videos:['/output/late.mp4']});else reject(new Error('late failure'));
  await running;assert.deepEqual(effects,[]);assert.equal(s.out.images.length,0);
 });
}
test('关闭输出的旧视频回包不能写入重建的同ID节点',async()=>{
 const s=setup();s.ctx.outputForNode=()=>null;let release;
 s.ctx.waitCanvasVideoTaskResult=()=>new Promise(resolve=>{release=resolve;});load(s.ctx,'findPendingTask');
 const running=s.ctx.runVideoNode(s.node.id);await new Promise(r=>setImmediate(r));
 const replacement={id:s.node.id,type:'video'};s.state.nodes.splice(0,s.state.nodes.length,replacement);
 release({videos:['/output/late.mp4']});await running;assert.equal(replacement.generatedOutputs,undefined);
});
test('提交前保存等待期间删除视频节点时不调用生成服务',async()=>{
 const s=setup();let release;s.ctx.saveCanvas=()=>new Promise(resolve=>{release=resolve;});
 const running=s.ctx.runVideoNode(s.node.id);s.state.nodes.length=0;release(true);await running;assert.equal(s.submissions.length,0);
});
