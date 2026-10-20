const {createTaskContext}=require('./canvas_task_test_helpers.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const native=require('../static/js/canvas-assistant-native.js');
const source=fs.readFileSync(require.resolve('../static/js/smart-canvas.js'),'utf8');
function load(ctx,name){const match=source.match(new RegExp('(?:async )?function '+name+'\\([^\\n]*\\).*?\\n\\}','s'));assert.ok(match,name);vm.runInContext(match[0],ctx);}
function setup(rounds=3,mode='serial'){
 const loop={id:'loop',type:'smart-loop',count:rounds,loopStart:2,mode},root={id:'root',type:'smart-image',images:[{url:'/assets/original.png'}],runSettings:{engine:'api',apiKind:'image',provider_id:'user',model:'manual',count:8}};
 const canvas={connections:[{from:'loop',to:'root',kind:'input'}],settings:{}},state={id:'canvas',updatedAt:1,nodes:[loop,root],connections:canvas.connections};
 const steps=Array.from({length:rounds},(_,i)=>({key:i+':'+i,roundIndex:2+i,roundOffset:i,sourceNodeId:'loop',templateNodeId:'root',requestNodeId:'root',kind:'generate',provider:'user',model:'manual',outputNodeId:'slot-'+i}));
 const plan={version:1,rounds,startIndex:2,batchSize:1,endIndex:rounds+1,mode,direct:true,rootNodeId:'root',scopeNodeIds:['loop','root'],steps,maxCalls:rounds};
 const events=[],storage=new Map();let submits=0,queries=0;
 const ctx=createTaskContext({nodes:state.nodes,canvas,canvasId:'canvas',localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
  cloneSmartSettings:v=>JSON.parse(JSON.stringify(v||{})),pushUndo:()=>{},render:()=>{},smartCascadeRuns:new Map(),syncSmartCascadeLegacyState:()=>{},smartCascadeIsLoopRunning:()=>false,
  createLoopOutputSlot:(t,index,offset,o)=>{const slot={id:o.outputNodeId,type:'smart-image',images:[],loopSourceId:o.loopNode.id,loopRootId:t.id,loopRoundIndex:index};state.nodes.push(slot);canvas.connections.push({from:t.id,to:slot.id,kind:'flow'});return slot;},
  saveCanvas:async()=>{events.push('save');state.updatedAt++;return true;},saveSmartAcceptedTasksBeforeQuery:async()=>{events.push('accepted-save');return true;},
  smartSettingsForNode:n=>n.runSettings,smartApiAudioMode:()=>false,defaultReferenceImagesFor:()=>[],outputImagesForNode:()=>[],selfReferenceImagesForNode:()=>[],relayLoopPromptNodesForEdge:()=>[],
  buildPromptRequestForNode:(_n,_refs,c)=>({prompt:'原提示词 '+c.index,displayPrompt:'第'+c.index+'轮',refs:[]}),
  smartPendingTasks:n=>n.pendingTasks||[],rememberRoundOutputs:(c,n,outputs)=>c.roundOutputs.set(n.id,outputs),
  resumeSmartPendingNode:async slot=>{queries++;const pending=slot.pendingTasks[0];ctx.validateSmartLoopPendingOutput(slot,pending);events.push('query');slot.images=[{url:'/output/'+pending.taskId+'.png'}];slot.pendingTasks=[];slot.pending=0;},
  rememberSmartAcceptedTasks:(n,tasks)=>{events.push('backup');storage.set(tasks[0].taskId,{nodeId:n.id,...tasks[0]});},
  sizeForRun:()=> '1024x1024',API_RATIO_VALUES:{square:'1:1'},imageRefsOnly:x=>x,SMART_REFERENCE_IMAGE_MAX:8,
  fetch:async(_url,opts)=>{submits++;const payload=JSON.parse(opts.body);events.push('post');assert.equal(payload.node_id,'loop');assert.equal(payload.assistant_action_id,'action');assert.equal(payload.model,'manual');return {ok:true,json:async()=>({task_id:'original-'+submits})};},
  smartCascadeAbortError:()=>Object.assign(new Error('已停止'),{smartCascadeStopped:true}),smartUnknownResubmissionNotice:()=> '受理未知'});
 for(const name of ['smartLoopRoundSettings','throwIfSmartCascadeStopRequested','runSmartCascadeRoundsWithLimit','smartAssistantLoopInputSignature','validateSmartAssistantLoopSlots','validateSmartLoopPendingOutput','runSmartAssistantNativeLoop','runApiGeneration'])load(ctx,name);
 ctx.isApiLikeEngine=e=>e==='api';
 const adapter={getState:()=>state,getSnapshot:()=>({nodes:state.nodes,connections:canvas.connections,settings:canvas.settings}),save:()=>ctx.saveCanvas(),render:()=>{},check:p=>p.check(),validateLoopSlots:(n,p)=>ctx.validateSmartAssistantLoopSlots(n,p),runNode:(n,o)=>ctx.runSmartAssistantNativeLoop(n,o)};
 const editor=native.createEditor(adapter),p={id:'action',canvasId:'canvas',updatedAt:1,nodeId:'loop',nodeType:'smart-loop',chargeable:true,action:'run',arguments:{nodeId:'loop',maxCalls:rounds},runSettings:{taskKind:'image',maxCalls:rounds},runInputHash:'input',loopPlan:plan,check:async()=>true};
 return {ctx,editor,p,state,loop,root,steps,events,storage,submits:()=>submits,queries:()=>queries};
}

test('循环真实入口逐轮1任务、先保存轮槽与受理编号，原模板和手选模型保留',async()=>{
 const s=setup(),original=JSON.stringify(s.root);await s.editor.execute(s.p);
 assert.equal(s.submits(),3);assert.equal(s.queries(),3);assert.equal(JSON.stringify(s.root),original);
 assert.equal(s.loop.assistantNativeRun.status,'succeeded');assert.deepEqual(Array.from(s.loop.assistantNativeRun.taskIds),['original-1','original-2','original-3']);
 for(let i=0;i<s.events.length;i++)if(s.events[i]==='post'){assert.equal(s.events[i-1],'save');assert.ok(s.events.slice(i+1).indexOf('accepted-save')>=0);}
 await s.editor.execute(s.p);assert.equal(s.submits(),3);
});

test('循环输入和轮槽在最终异步确认期间编辑均零提交',async()=>{
 for(const mode of ['prompt','connection','origin','foreign-image','readonly']){
  const s=setup();s.p.localSignature=s.editor.snapshot();s.p.check=async()=>{await Promise.resolve();if(s.state.nodes.length>2){if(mode==='prompt')s.root.promptDraftText='edited';if(mode==='connection')s.state.connections.pop();if(mode==='origin')s.state.nodes[2].assistantNativeOrigin.actionId='other';if(mode==='foreign-image')s.state.nodes[2].images=[{url:'/output/foreign.png'}];if(mode==='readonly')s.state.readOnly=true;}return true;};
  await assert.rejects(s.editor.execute(s.p));assert.equal(s.submits(),0);
 }
});

test('循环停止保留完成轮槽，明确继续只执行未提交项',async()=>{
 const s=setup();const query=s.ctx.resumeSmartPendingNode;
 s.ctx.resumeSmartPendingNode=async slot=>{await query(slot);s.ctx.smartCascadeRuns.get('loop').stopRequested=true;};
 await s.editor.execute(s.p);assert.equal(s.submits(),1);assert.equal(s.loop.assistantNativeRun.slots['0:0'].status,'succeeded');
 s.ctx.resumeSmartPendingNode=query;
 await s.editor.resumeLoop(s.p);assert.equal(s.submits(),3);assert.equal(s.queries(),3);assert.equal(s.loop.assistantNativeRun.status,'succeeded');
});

test('循环断线未知禁止恢复提交；任务受理后的保存失败保留编号',async()=>{
 for(const mode of ['unknown','save']){
  const s=setup();if(mode==='unknown')s.ctx.fetch=async()=>{s.events.push('unknown-post');throw new Error('断线');};
  else s.ctx.saveSmartAcceptedTasksBeforeQuery=async slot=>{slot.pendingTasks[0].savePending=true;return false;};
  if(mode==='unknown')await assert.rejects(s.editor.execute(s.p));else await s.editor.execute(s.p);
  const count=s.submits();if(mode==='unknown')await assert.rejects(s.editor.resumeLoop(s.p));else await s.editor.resumeLoop(s.p);assert.equal(s.submits(),count);assert.equal(s.queries(),0);
  if(mode==='unknown'){assert.equal(s.loop.assistantNativeRun.unknownCount,1);assert.equal(s.loop.submissionUnknown,true);}
  else assert.deepEqual(Array.from(s.loop.assistantNativeRun.taskIds),['original-1']);
 }
});

test('循环并行模式隔离每轮上下文，在受理保存后并行查询',async()=>{
 const s=setup(3,'parallel');let active=0,max=0;const query=s.ctx.resumeSmartPendingNode;
 s.ctx.resumeSmartPendingNode=async slot=>{active++;max=Math.max(max,active);await new Promise(resolve=>setTimeout(resolve,10));await query(slot);active--;};
 await s.editor.execute(s.p);assert.equal(s.submits(),3);assert.ok(max>1);assert.equal(s.loop.assistantNativeRun.unknownCount,0);
 assert.deepEqual(s.state.nodes.slice(2).map(n=>n.runModelPrompt),['原提示词 2','原提示词 3','原提示词 4']);
});

test('循环DAG复制分支不提交，下一层使用本轮原生成结果',async()=>{
 const s=setup(1);s.p.loopPlan.direct=false;s.state.nodes.push({id:'other',type:'smart-image',runSettings:{...s.root.runSettings}});
 s.p.loopPlan.scopeNodeIds.push('other');s.p.loopPlan.steps[0].sourceNodeId='root';
 s.p.loopPlan.steps.push({key:'0:copy',roundIndex:2,roundOffset:0,sourceNodeId:'root',templateNodeId:'other',requestNodeId:'root',kind:'copy',copyFromKey:'0:0',outputNodeId:'copy-slot'});
 await s.editor.execute(s.p);assert.equal(s.submits(),1);assert.equal(s.loop.assistantNativeRun.slots['0:copy'].status,'succeeded');
 assert.deepEqual(Array.from(s.state.nodes.find(n=>n.id==='copy-slot').images,i=>i.url),Array.from(s.state.nodes.find(n=>n.id==='slot-0').images,i=>i.url));
});

test('最后生成后停止，续行仅完成原复制槽且不重复提交',async()=>{
 const s=setup(1);s.p.loopPlan.direct=false;s.state.nodes.push({id:'other',type:'smart-image',runSettings:{...s.root.runSettings}});
 s.p.loopPlan.scopeNodeIds.push('other');s.p.loopPlan.steps[0].sourceNodeId='root';
 s.p.loopPlan.steps.push({key:'0:copy',roundIndex:2,roundOffset:0,sourceNodeId:'root',templateNodeId:'other',requestNodeId:'root',kind:'copy',copyFromKey:'0:0',outputNodeId:'copy-slot'});
 const query=s.ctx.resumeSmartPendingNode;s.ctx.resumeSmartPendingNode=async slot=>{await query(slot);s.ctx.smartCascadeRuns.get('loop').stopRequested=true;};
 await s.editor.execute(s.p);assert.equal(s.submits(),1);assert.equal(s.loop.assistantNativeRun.slots['0:copy'].status,'ready');
 s.ctx.resumeSmartPendingNode=query;await s.editor.resumeLoop(s.p);
 assert.equal(s.submits(),1);assert.equal(s.queries(),1);assert.equal(s.loop.assistantNativeRun.slots['0:copy'].status,'succeeded');assert.equal(s.loop.assistantNativeRun.status,'succeeded');
});

test('循环备份恢复本轮原编号，不把未提交剩余轮数推断为未知受理',async()=>{
 const s=setup();await s.editor.execute(s.p);const run=s.loop.assistantNativeRun,entry=run.slots['0:0'],slot=s.state.nodes.find(n=>n.id===entry.outputNodeId);
 run.taskIds=[];run.unknownCount=1;run.slots['0:0']={outputNodeId:slot.id,taskIds:[],status:'submitting'};slot.pendingTasks=[];slot.images=[];
 const backup=s.storage.get('original-1');Object.assign(s.ctx,{SMART_UNSAVED_ACCEPTED_TASKS_PREFIX:'accepted:',localStorage:{getItem:()=>JSON.stringify([backup]),setItem:()=>{},removeItem:()=>{}},nowMs:()=>0});
 load(s.ctx,'restoreSmartUnsavedAcceptedTasks');assert.equal(s.ctx.restoreSmartUnsavedAcceptedTasks(),1);
 assert.equal(run.unknownCount,0);assert.deepEqual(Array.from(run.slots['0:0'].taskIds),['original-1']);assert.equal(slot.pendingTasks[0].assistantLoopStepKey,'0:0');
 run.actionId='new';slot.pendingTasks=[];assert.equal(s.ctx.restoreSmartUnsavedAcceptedTasks(),0);assert.equal(slot.pendingTasks.length,0);
});
