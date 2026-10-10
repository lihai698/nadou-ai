(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CanvasAssistantNative=api;})(typeof window!=='undefined'?window:globalThis,function(){
 'use strict';
 const clone=v=>JSON.parse(JSON.stringify(v));
 const signature=p=>JSON.stringify([p.canvasId,p.action,p.arguments]);
 function create(adapter){
  const flights=new Map();
  async function execute(proposal){
   const hash=signature(proposal),flight=flights.get(proposal.id);
   if(flight){if(flight.signature!==hash)throw new Error('相同动作编号已有不同执行');return flight.promise;}
   const state=adapter.getState(),prior=state.receipts?.[proposal.id];
   if(prior){if(prior.signature!==hash)throw new Error('相同动作编号已有不同回执');return clone(prior);}
   const work=Promise.resolve().then(async()=>{
    const fresh=adapter.getState();
    if(fresh.readOnly||fresh.readonly||fresh.id!==proposal.canvasId||fresh.updatedAt!==proposal.updatedAt)throw new Error('画布或版本变化，未执行动作');
    if(!await adapter.preflight(proposal))throw new Error('原生动作预检失败');
    let record={id:proposal.id,signature:hash,state:'executing',nodeIds:[],taskIds:[]};
    adapter.markReceipt(proposal.id,record);
    if(!await adapter.save()){record={...record,state:'failed',error:'执行保护尚未保存，未调用原生动作'};adapter.markReceipt(proposal.id,record);throw new Error(record.error);}
    try{
     if(adapter.getState().id!==proposal.canvasId || !await adapter.preflight(proposal))throw new Error('画布或输入已变化，未调用原生动作');
     const result=await adapter.perform(proposal);
     record={...record,...result,state:proposal.chargeable?(result?.taskIds?.length?'accepted':result?.status==='succeeded'?'succeeded':'submission_unknown'):'completed'};
     adapter.markReceipt(proposal.id,record);
     if(!await adapter.save())throw new Error('原生动作已执行但保存失败，请保留页面并重试保存；不重新执行');
     return clone(record);
    }catch(error){
     record={...record,state:proposal.chargeable&&!error.submissionKnownRejected?'submission_unknown':'failed',error:error.message||'原生动作失败'};
     adapter.markReceipt(proposal.id,record);
     if(adapter.getState().id===proposal.canvasId)await adapter.save().catch(()=>false);
     throw error;
    }
   });
   flights.set(proposal.id,{signature:hash,promise:work});
   try{return await work;}finally{flights.delete(proposal.id);}
  }
  return {execute};
 }
 function createEditor(adapter){
  const receipts=new Map();
  const ownerReceipts=()=>{const id=adapter.getState().id;if(!receipts.has(id))receipts.set(id,{});return receipts.get(id);};
  const snapshot=()=>JSON.stringify(adapter.getSnapshot());
  function runInputs(nodeId,loopPlan){
   const data=adapter.getSnapshot(),ids=new Set([nodeId,...(loopPlan?.scopeNodeIds||[])]);let changed=true;
   while(changed){changed=false;for(const c of data.connections||[])if(ids.has(c.to)&&!ids.has(c.from)){ids.add(c.from);changed=true;}
    for(const n of data.nodes||[])if(ids.has(n.id))for(const id of [...(n.items||[]),...(n.inputNodeIds||[])])if(!ids.has(id)){ids.add(id);changed=true;}}
    const targetRuntime=['running','runStatus','runError','assistantNativeRun','generatedOutputs','submissionWarning','submissionUnknown'];
    if(data.nodes.find(n=>n.id===nodeId)?.type==='midjourney')targetRuntime.push('lastTaskId','lastTaskStatus','lastAction','lastImageCount','lastPrompt');

   const video=['video'].includes(data.nodes.find(n=>n.id===nodeId)?.type),outputs=new Set(video?data.nodes.filter(n=>n.type==='output').map(n=>n.id):[]);
   return JSON.stringify({nodes:data.nodes.filter(n=>ids.has(n.id)).map(n=>{const raw={...n};const copy=clone(raw);if(n.id===nodeId){targetRuntime.forEach(k=>delete copy[k]);}return copy;}),connections:(data.connections||[]).filter(c=>ids.has(c.from)&&(ids.has(c.to)||video&&c.from===nodeId&&outputs.has(c.to))),...(loopPlan?{settings:data.settings}:{})});
  }
  const bridge=create({
   getState:()=>({...adapter.getState(),receipts:ownerReceipts()}),
   markReceipt:(id,value)=>{ownerReceipts()[id]=value;},save:()=>adapter.save(),
   preflight:async proposal=>{
    if(proposal.localSignature && snapshot()!==proposal.localSignature)return false;
    if(adapter.check && !await adapter.check(proposal))return false;
    return !proposal.localSignature || snapshot()===proposal.localSignature;
   },
   perform:async proposal=>{
    const args=proposal.arguments,state=adapter.getState(),node=state.nodes.find(n=>n.id===proposal.nodeId);
    if(proposal.action==='create'){
     const made=adapter.createNode(args.type);
     if(!made?.id)throw new Error('原生工厂未创建节点');
     made.assistantNativeActionId=proposal.id;
     return {nodeIds:[made.id]};
    }
    if(!node)throw new Error('目标准生节点已不存在');
    if(proposal.action==='media_export'){
     const media=proposal.receipt?.mediaExport,summary=proposal.mediaExportSummary;
     if(!media?.results?.length||!['succeeded','available'].includes(media.status)||!adapter.deliverMediaExport)throw new Error('原媒体文件尚未就绪');
     if((node.assistantMediaExportReceipts||[]).some(r=>r.actionId===proposal.id))throw new Error('此导出已登记交付，不重复下载或写入；请查询保存结果');
     if(!await proposal.check())throw new Error('导出确认已停止或原素材变化');
     const receipt={actionId:proposal.id,rangeHash:summary.rangeHash,requestId:summary.requestId,destination:args.destination,urls:media.results.map(r=>r.url),status:'delivery_started'};
     node.assistantMediaExportReceipts=[...(node.assistantMediaExportReceipts||[]),receipt].slice(-20);
     if(!await adapter.save())throw new Error('交付保护未保存，没有发起下载或写入输出');
     if(adapter.getState().id!==proposal.canvasId||!await proposal.check())throw new Error('导出交付已停止，请核对原文件；不重新交付');
     await adapter.deliverMediaExport(node,clone(media.results),args.destination);
     if(adapter.getState().id!==proposal.canvasId)throw new Error('画布已切换，交付回执未完成；不重复下载');
     receipt.status=args.destination==='canvas'?'saved_to_canvas':'download_started';
     adapter.render();return {nodeIds:[node.id],taskIds:[],exportReceipt:clone(receipt)};
    }
    if(proposal.action==='export'){
     if(!adapter.exportWorkflow)throw new Error('原生工作流导出入口不可用');
     const ids=Array.isArray(args.nodeIds)&&args.nodeIds.length?args.nodeIds:[node.id];
     const inputs=snapshot();
     const unchanged=()=>{const current=adapter.getState();if(current.id!==proposal.canvasId||current.readOnly||current.readonly||snapshot()!==inputs)throw new Error('画布或导出内容已变化，未发起下载，请重新规划');};
     const beforeDownload=async()=>{unchanged();if(proposal.check&&!await proposal.check())throw new Error('导出确认已停止，未发起下载');unchanged();};
     const result=await adapter.exportWorkflow({actionId:proposal.id,nodeId:node.id,nodeIds:ids,connectionIds:args.connectionIds||[],includeResources:args.includeResources===true,scopeHash:args.exportScopeHash,beforeDownload});
     const receipt=result?.receipt;
     if(!receipt||receipt.status!=='download_started')throw new Error('导出未取得可保存回执');
     unchanged();
     node.assistantExportReceipts=[...(node.assistantExportReceipts||[]).filter(item=>item?.actionId!==proposal.id),clone(receipt)].slice(-20);
     adapter.render();return {nodeIds:ids,taskIds:[],exportReceipt:clone(receipt),exportFormat:receipt.format};
    }
    if(proposal.action==='run'){
     if(!proposal.runSettings)throw new Error('原生运行回执处理器未开放');
     const inputs=runInputs(node.id,proposal.loopPlan);
     node.assistantNativeRun={previousActionId:node.assistantNativeRun?.actionId||'',actionId:proposal.id,taskKind:proposal.runSettings.taskKind,taskIds:[],submissionStarted:false};
     const runOptions={
      assistantNativeActionId:proposal.id,
      assistantMaxCalls:proposal.runSettings.maxCalls,
      assistantRunInputHash:proposal.runInputHash,
      assistantCanvasId:proposal.canvasId,
      assistantOutputNodeId:proposal.outputNodeId,
      assistantWorkflow:proposal.runSettings.model,
      assistantImageConfig:proposal.nativeImageConfig,
      assistantLoopPlan:proposal.loopPlan,
      beforeSubmit:async()=>{
       const unchanged=()=>{
        const current=adapter.getState();
        if(current.id!==proposal.canvasId||current.readOnly||current.readonly||runInputs(node.id,proposal.loopPlan)!==inputs)return false;
        if(node.type==='smart-loop' && (!adapter.validateLoopSlots || !adapter.validateLoopSlots(node,proposal)))return false;
        if(node.type==='smart-group'){
         const output=current.nodes.find(n=>n.id===proposal.outputNodeId&&n.type==='smart-image'),origin=output?.assistantNativeOrigin,run=node.assistantNativeRun;
         const incoming=(adapter.getSnapshot().connections||[]).filter(c=>c.to===proposal.outputNodeId);
         if(!output||origin?.actionId!==proposal.id||origin.sourceNodeId!==node.id||origin.inputHash!==proposal.runInputHash||run?.actionId!==proposal.id||run.outputNodeId!==output.id
           ||incoming.length!==1||incoming[0].from!==node.id||incoming[0].kind!=='flow'||output.images?.length||output.submissionUnknown)return false;
         if((output.pendingTasks||[]).some(p=>p.assistantNativeActionId!==proposal.id||!run.taskIds?.includes(p.taskId)))return false;
        }
        return true;
       };
       if(!unchanged()||!await proposal.check()||!unchanged())throw new Error('运行输入或确认已变化，未提交新任务');
       node.assistantNativeRun.submissionStarted=true;
      }
     };
      if(['llm','smart-prompt'].includes(node.type)){
      if(!adapter.runLLMNode)throw new Error('原生 LLM 运行处理器未开放');
      await adapter.runLLMNode(node,runOptions);
      const run=node.assistantNativeRun;
       const output=node.type==='smart-prompt'?node.text:node.outputText;
       if(run.actionId!==proposal.id||run.status!=='succeeded'||typeof output!=='string'||!output.trim()){
       const error=new Error(run.error||'未取得原生 LLM 完成回执，请查询保存结果');
       error.submissionKnownRejected=!!run.knownRejected||run.submissionStarted===false;
       throw error;
      }
       return {nodeIds:[node.id],taskIds:[],taskKind:'llm',status:'succeeded',outputText:output};
     }
     if(!adapter.runNode||!['generator','msgen','midjourney','comfy','smart-image','smart-group','smart-loop','rh','video'].includes(node.type))throw new Error('原生运行回执处理器未开放');
     await adapter.runNode(node,runOptions);
     const run=node.assistantNativeRun;
     if(run.actionId!==proposal.id||!run.taskIds?.length){const error=new Error(run.error||'未取得原生服务受理编号，请查询；不自动重新提交');error.submissionKnownRejected=!!run.knownRejected||run.submissionStarted===false;throw error;}
     return {nodeIds:[node.id,...(node.type==='smart-group'?[run.outputNodeId]:node.type==='smart-loop'?proposal.loopPlan.steps.map(s=>s.outputNodeId):[])],taskIds:clone(run.taskIds),taskKind:run.taskKind};
   }else if(proposal.action==='update'){
     const fields=proposal.editableFields||[];
     if(Object.keys(args.patch).some(key=>!fields.includes(key)||/model|provider|outputText|lastPrompt|runPrompt|runModelPrompt|lastAction|lastImageCount|task|url|secret|token|password/i.test(key)))throw new Error('不能修改历史结果、模型或未开放字段');
     adapter.pushUndo();if(adapter.applyFields)adapter.applyFields(node,clone(args.patch));else Object.assign(node,clone(args.patch));
   }else if(proposal.action==='lora_parameters'){
     const fields=proposal.effectFields;
     if(node.type!=='msgen'||node.msgenModel!=='custom'||node.msCustomModel!==proposal.loraModel||!fields||Object.keys(fields).some(k=>!['msLoraEnabled','msLoraId','msLoraStrength'].includes(k)))throw new Error('原LoRA模型或参数合同已变化');
     adapter.pushUndo();Object.assign(node,clone(fields));
   }else if(proposal.action==='workflow_parameters'){
     if(!['rh','comfy'].includes(node.type)||!adapter.setWorkflowParameters)throw new Error('原生工作流参数处理器不可用');
     adapter.pushUndo();adapter.setWorkflowParameters(node,clone(args.patch));
    }else if(proposal.action==='connect'){
     if(!adapter.connectNodes)throw new Error('原生连接处理器不可用');
     adapter.pushUndo();if(!adapter.connectNodes(args.sourceId,node.id))throw new Error('原生输入连接被拒绝');
     adapter.render();return {nodeIds:[args.sourceId,node.id]};
    }else if(proposal.action==='group_members'){
     if(!['group','smart-group'].includes(node.type)||!adapter.setGroupMembers)throw new Error('原生分组成员处理器不可用');
     adapter.pushUndo();adapter.setGroupMembers(node,clone(args.memberIds));
    }else if(proposal.action==='loop_prompts'){
     if(node.type!=='smart-loop' || !Array.isArray(args.values))throw new Error('循环字段格式无效');
     adapter.pushUndo();adapter.setLoopPrompts(node,args.values);
    }else if(proposal.action==='clip_edit'){
     const model=adapter.clipModel;
     if(node.type!=='clip'||!model)throw new Error('原生剪辑模块不可用');
     let next;
     if(args.clipAction==='remove')next=model.remove(node.clipData,args.clipId);
     else if(args.clipAction==='move')next=model.move(node.clipData,args.clipId,args.startFrame,{disableSnap:true});
     else if(args.clipAction==='trim'){
      let data=model.trim(node.clipData,args.clipId,'left',args.startFrame);
      next=model.trim(data,args.clipId,'right',args.endFrame);
     }else throw new Error('该剪辑动作未开放');
     const edited=next.clips.find(c=>c.id===args.clipId);
     if(args.clipAction!=='remove' && (!edited || edited.startFrame!==args.startFrame || args.clipAction==='trim' && edited.endFrame!==args.endFrame))throw new Error('剪辑范围超出原生边界，未保存部分修改');
     adapter.pushUndo();node.clipData=next;
    }else if(proposal.action==='shot_materialize'){
     const host=adapter.shotHost?.(),settings=proposal.creationSettings;
     if(!['shot-table','smart-shot-table'].includes(node.type)||!host||!settings?.provider_id||!settings?.model)throw new Error('原生镜头表处理器或用户图片模型不可用');
     const result=host.materializeRows(node.id,args.selectedRowIds,{...clone(settings),providerId:settings.provider_id},{deferSave:true});
     if(!result.generatorIds.length)throw new Error('原生处理器没有创建或复用镜头生成链');
     adapter.render();return {nodeIds:[node.id,...result.createdIds,...result.reusedIds]};
    }else if(['shot_edit','shot_column','shot_select'].includes(proposal.action)){
     const host=adapter.shotHost?.(),model=adapter.shotModel;
     if(!['shot-table','smart-shot-table'].includes(node.type)||!host||!model)throw new Error('原生镜头表处理器不可用');
     host.editTable(node.id,data=>proposal.action==='shot_edit'?model.editCell(data,args.rowId,args.columnId,args.value):proposal.action==='shot_column'?model.editColumn(data,args.columnAction,{id:args.columnId,label:args.label}):{...data,revision:(Number(data.revision)||0)+1,selectedRowIds:clone(args.selectedRowIds)},{deferSave:true});
    }else if(!['query','preview'].includes(proposal.action))throw new Error('该原生动作尚未接入');
    adapter.render();return {nodeIds:[node.id]};
   }
  });
  async function syncTask(proposal){

   if(proposal.action==='run'&&(proposal.runSettings?.taskKind==='video'||['msgen','midjourney'].includes(proposal.nodeType))){
    const kind=proposal.runSettings.taskKind;
    const state=adapter.getState(),node=state.nodes.find(n=>n.id===proposal.nodeId),run=node?.assistantNativeRun,tasks=proposal.receipt?.tasks;
    if(state.id!==proposal.canvasId||state.readOnly||state.readonly||!node||run?.actionId!==proposal.id||run.taskKind!==kind||!Array.isArray(tasks)||tasks.length!==1||!adapter.applyTask)throw new Error('原任务回填归属或处理器不可用');
    const output=state.nodes.find(n=>n.id===proposal.outputNodeId&&n.type==='output');
    if(!output||!adapter.getSnapshot().connections.some(c=>c.from===node.id&&c.to===output.id))throw new Error('原视频输出连接已变化，不能回填到其它节点');
    const task=tasks[0],id=task?.task_id||task?.id;
    if(!(run.taskIds||[]).includes(id)&&run.plannedTaskId!==id)throw new Error('原视频任务编号不匹配');
    const binding={canvas_id:proposal.canvasId,node_id:node.id,assistant_action_id:proposal.id,input_hash:proposal.runInputHash,provider_id:proposal.runSettings.provider,model:proposal.runSettings.model};
    if(proposal.segmentId)binding.segment_id=proposal.segmentId;
    if(Object.entries(binding).some(([k,v])=>task[k]!==v))throw new Error('原视频任务的归属、输入或模型不匹配');
    if(!['succeeded','failed','cancelled','canceled'].includes(task.status))return false;
    if(!(output._pending||[]).some(p=>p.canvasTaskId===id&&p.canvasTaskType===(kind==='image'?'online-image':kind)&&p.assistantNativeActionId===proposal.id&&p.run?.node?.id===node.id))return false;
    const applied=await adapter.applyTask(node,clone(task),kind);
    if(applied===false){if(!await adapter.save())throw new Error('原任务成果尚未保存，请只重试保存和查询');return false;}
    if(adapter.getState().id!==proposal.canvasId)throw new Error('画布已切换，未保存原视频');
    node.assistantNativeRun={...run,taskIds:[id],unknownCount:0,warning:''};node.submissionUnknown=false;node.submissionWarning='';
    if(!await adapter.save())throw new Error('原视频回填尚未保存，请只重试保存和查询');
    return true;
   }
   const state=adapter.getState(),args=proposal.arguments,task=proposal.receipt?.task;
   if(state.id!==proposal.canvasId||state.readOnly||state.readonly)throw new Error('画布已切换或只读，未回填原任务');
   const node=state.nodes.find(n=>n.id===proposal.nodeId);
   if(!node||!task||!adapter.applyTask)throw new Error('原任务回填处理器不可用');
   if((task.task_id||task.id)!==args.taskId)throw new Error('原任务编号不匹配');
   if(args.taskKind==='depth'){
    const capture=node.depthCapture;
    if(!capture||capture.taskId!==args.taskId||task.operation_id&&task.operation_id!==capture.operationId||task.source_url&&task.source_url!==capture.sourceUrl)throw new Error('原深度任务编号或来源已变化');
   }else{
    const pending=['pendingTasks','_pending','_directPending'].flatMap(key=>Array.isArray(node[key])?node[key]:[]);
    if(!pending.some(p=>(p.canvasTaskId||p.taskId)===args.taskId)||!['image','video'].includes(args.taskKind))return false;
   }
   if(await adapter.applyTask(node,clone(task),args.taskKind)===false)throw new Error('原任务尚未实际回填，请恢复原任务后重试同步');
   if(adapter.getState().id!==proposal.canvasId)throw new Error('画布已切换，未保存原任务回填');
   if(!await adapter.save())throw new Error('原任务结果已回填但尚未保存，请重试同步；不会重新提交');
   return true;
  }
  async function resumeLoop(proposal){
   const state=adapter.getState(),node=state.nodes.find(n=>n.id===proposal.nodeId);
   if(state.id!==proposal.canvasId||state.readOnly||state.readonly||proposal.nodeType!=='smart-loop'||node?.assistantNativeRun?.actionId!==proposal.id||!adapter.runNode)throw new Error('循环原动作不可恢复');
   const inputs=runInputs(node.id,proposal.loopPlan);
   const unchanged=()=>{const s=adapter.getState();return s.id===proposal.canvasId&&!s.readOnly&&!s.readonly&&runInputs(node.id,proposal.loopPlan)===inputs&&adapter.validateLoopSlots?.(node,proposal);};
   await adapter.runNode(node,{assistantNativeActionId:proposal.id,assistantCanvasId:proposal.canvasId,assistantRunInputHash:proposal.runInputHash,assistantMaxCalls:proposal.runSettings.maxCalls,assistantLoopPlan:proposal.loopPlan,
    beforeSubmit:async()=>{if(!unchanged()||!await proposal.check()||!unchanged())throw new Error('循环原输入或确认已停止，未提交后续轮次');node.assistantNativeRun.submissionStarted=true;}});
   if(adapter.getState().id!==proposal.canvasId||!await adapter.save())throw new Error('循环恢复结果尚未保存，只重试保存和查询');
  }
  return {execute:bridge.execute,snapshot,syncTask,resumeLoop};
 }
 return {create,createEditor};
});
