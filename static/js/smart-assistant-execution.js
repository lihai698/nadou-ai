/* Smart assistant execution: smart-assistant-execution. Host supplies live state and effects. */
(function(root){
    'use strict';

function smartAssistantLoopInputSignature(deps, loop,plan){
    const ids=new Set(plan.scopeNodeIds),runtime=new Set(['assistantNativeRun','running','runStatus','runError','submissionUnknown','submissionWarning']);
    return JSON.stringify({nodes:deps.nodes.filter(n=>ids.has(n.id)).map(n=>{const copy=deps.cloneSmartSettings(n);if(n.id===loop.id)for(const key of runtime)delete copy[key];return copy;}),connections:(deps.canvas.connections||[]).filter(c=>ids.has(c.from)&&ids.has(c.to)),settings:deps.canvas.settings});
}

function validateSmartAssistantLoopSlots(deps, loop, proposal){
    const run=loop?.assistantNativeRun,plan=proposal.loopPlan;
    if(!run || run.actionId!==proposal.id || run.inputHash!==proposal.runInputHash || !plan || !run.slots || run.inputSignature!==smartAssistantLoopInputSignature(deps, loop,plan))return false;
    return plan.steps.every(step=>{
        const slot=deps.nodes.find(n=>n.id===step.outputNodeId),entry=run.slots[step.key],origin=slot?.assistantNativeOrigin;
        const incoming=(deps.canvas.connections||[]).filter(c=>c.to===step.outputNodeId);
        return slot?.type==='smart-image' && entry?.outputNodeId===slot.id && origin?.kind==='loop' && origin.actionId===proposal.id && origin.sourceNodeId===loop.id && origin.inputHash===proposal.runInputHash && origin.stepKey===step.key
            && slot.loopSourceId===loop.id && slot.loopRootId===step.templateNodeId && slot.loopRoundIndex===step.roundIndex && incoming.length===1 && incoming[0].from===step.templateNodeId && incoming[0].kind==='flow'
            && !slot.submissionUnknown && (entry.status!=='ready'||!slot.images?.length) && (entry.status!=='succeeded'||JSON.stringify((slot.images||[]).map(i=>i.url).sort())===JSON.stringify((entry.resultUrls||[]).slice().sort()))
            && (slot.pendingTasks||[]).every(t=>t.assistantNativeActionId===proposal.id && t.assistantLoopStepKey===step.key && entry.taskIds?.includes(t.taskId) && run.taskIds.includes(t.taskId));
    });
}

function validateSmartLoopPendingOutput(deps, slot, task){
    const loop=deps.nodes.find(n=>n.id===task.assistantSourceNodeId&&n.type==='smart-loop'),run=loop?.assistantNativeRun,entry=run?.slots?.[task.assistantLoopStepKey],origin=slot.assistantNativeOrigin;
    const incoming=(deps.canvas.connections||[]).filter(c=>c.to===slot.id);
    if(deps.canvasId!==task.assistantBinding?.canvas_id || !deps.nodes.includes(slot) || run?.actionId!==task.assistantNativeActionId || !entry?.taskIds?.includes(task.taskId) || !run.taskIds.includes(task.taskId) || run.inputSignature!==smartAssistantLoopInputSignature(deps, loop,run.loopPlan)
        || entry.outputNodeId!==slot.id || origin?.kind!=='loop' || origin.actionId!==run.actionId || origin.sourceNodeId!==loop.id || origin.inputHash!==task.assistantInputHash || origin.stepKey!==task.assistantLoopStepKey
        || incoming.length!==1 || incoming[0].from!==slot.loopRootId || incoming[0].kind!=='flow'){
        const error=new Error('循环原轮槽或任务归属已变化，只保留原编号，不回填其它节点');error.queryPaused=true;throw error;
    }
}

async function runSmartAssistantNativeLoop(deps, loop, options){
    const plan=options.assistantLoopPlan,run=loop?.assistantNativeRun;
    const reject=message=>{const error=new Error(message);error.submissionKnownRejected=true;throw error;};
    if(!plan || loop?.type!=='smart-loop' || run?.actionId!==options.assistantNativeActionId || plan.maxCalls!==options.assistantMaxCalls)reject('循环原方案或预算不可用');
    if(run.unknownCount || loop.submissionUnknown || Object.values(run.slots||{}).some(s=>s.status==='submitting'||s.status==='unknown'))reject('循环有受理未知轮槽，只查询原编号，不重新提交');
    const ownerCanvas=options.assistantCanvasId;
    const current=()=>deps.canvasId===ownerCanvas && deps.nodes.includes(loop) && loop.assistantNativeRun===run;
    const proposal={id:options.assistantNativeActionId,nodeId:loop.id,runInputHash:options.assistantRunInputHash,loopPlan:plan};
    if(!run.slots){
        if(plan.steps.some(s=>deps.nodes.some(n=>n.id===s.outputNodeId)))reject('循环新轮槽编号已存在，未提交');
        deps.pushUndo();run.slots={};run.inputHash=options.assistantRunInputHash;run.loopPlan=deps.cloneSmartSettings(plan);run.inputSignature=smartAssistantLoopInputSignature(deps, loop,plan);
        for(const step of plan.steps){
            const template=deps.nodes.find(n=>n.id===step.templateNodeId);
            if(!template)reject('循环原图片模板已移除');
            const slot=deps.createLoopOutputSlot(template,step.roundIndex,step.roundOffset,{loopNode:loop,slotIndex:step.roundOffset,outputNodeId:step.outputNodeId});
            delete slot.assistantNativeRun;delete slot.assistantNativeActionId;
            slot.assistantNativeOrigin={kind:'loop',actionId:run.actionId,sourceNodeId:loop.id,inputHash:run.inputHash,stepKey:step.key};
            run.slots[step.key]={outputNodeId:slot.id,taskIds:[],status:'ready'};
        }
        deps.render();if(!await deps.saveCanvas()){run.knownRejected=true;reject('循环轮槽尚未保存，未提交任务');}
    }
    if(!current() || !validateSmartAssistantLoopSlots(deps, loop,proposal))reject('循环原轮槽或连接已变化');
    const runState={runKey:loop.id,loopId:loop.id,stopRequested:false,runPath:{states:{}}};
    if(deps.smartCascadeIsLoopRunning(loop.id))reject('循环仍在执行，请查询原任务');
    deps.smartCascadeRuns.set(loop.id,runState);deps.syncSmartCascadeLegacyState(loop.id);
    // 每项受理编号保存后才放行下一次提交；原任务查询可按轮次并行。
    let submissionTail=Promise.resolve();
    const acquireSubmission=async()=>{let release;const held=new Promise(resolve=>release=resolve),previous=submissionTail;submissionTail=previous.then(()=>held);await previous;return release;};
    const pendingFor=(step,taskId)=>({taskId,kind:'image',providerId:step.provider,model:step.model,assistantNativeActionId:run.actionId,assistantMaxCalls:plan.maxCalls,
        assistantSourceNodeId:loop.id,assistantInputHash:run.inputHash,assistantLoopStepKey:step.key,
        assistantBinding:{canvas_id:ownerCanvas,node_id:loop.id,assistant_action_id:run.actionId,input_hash:run.inputHash,provider_id:step.provider,model:step.model}});
    const processRound=async offset=>{
        const ctx={index:plan.startIndex+offset*plan.batchSize,total:plan.endIndex,nodeId:loop.id,forceWorkflow:!plan.direct,runState,roundOutputs:new Map()};
        for(const step of plan.steps.filter(s=>s.roundOffset===offset)){
            deps.throwIfSmartCascadeStopRequested(runState);
            if(!current() || !validateSmartAssistantLoopSlots(deps, loop,proposal))throw new Error('循环画布、输入轮槽或连接已变化，停止后续提交');
            const entry=run.slots[step.key],slot=deps.nodes.find(n=>n.id===entry.outputNodeId);
            if(entry.status==='succeeded'){
                if(!slot.images?.length)throw new Error('已完成轮槽的原结果已移除，不能重放生成');
                deps.rememberRoundOutputs(ctx,{id:step.templateNodeId},slot.images);continue;
            }
            if(step.kind==='copy'){
                const original=deps.nodes.find(n=>n.id===run.slots[step.copyFromKey]?.outputNodeId);
                if(!original?.images?.length)throw new Error('循环复制分支的原结果尚未保存');
                slot.images=original.images.map(img=>({...img}));slot.pending=0;slot.running=false;entry.status='succeeded';entry.resultUrls=slot.images.map(i=>i.url);
                deps.rememberRoundOutputs(ctx,{id:step.templateNodeId},slot.images);deps.render();if(!await deps.saveCanvas())throw new Error('复制轮槽尚未保存');continue;
            }
            const source=deps.nodes.find(n=>n.id===step.sourceNodeId),requestNode=deps.nodes.find(n=>n.id===step.requestNodeId);
            const selected=requestNode?.runSettings||{},runSettings=deps.smartLoopRoundSettings(deps.cloneSmartSettings(deps.smartSettingsForNode(requestNode)),ctx);
            if(selected.engine!=='api'||selected.provider_id!==step.provider||selected.model!==step.model||runSettings.engine!=='api'||runSettings.apiKind==='video'||deps.smartApiAudioMode(requestNode,runSettings))reject('循环原节点引擎或模型已变化');
            let taskId=entry.taskIds[0];
            if(!taskId){
                if(entry.status!=='ready' || slot.images?.length)reject('轮槽已有结果或提交记录，只查询原任务');
                const refs=plan.direct ? deps.outputImagesForNode(loop,true,ctx) : deps.selfReferenceImagesForNode(source,false,ctx);
                const defaults=refs.length ? refs : deps.defaultReferenceImagesFor(requestNode,false,ctx);
                const relayLoops=plan.direct?[]:deps.relayLoopPromptNodesForEdge(source,deps.nodes.find(n=>n.id===step.templateNodeId));
                const request=deps.buildPromptRequestForNode(requestNode,defaults.length?defaults:null,{...ctx,relayPromptNodeIds:relayLoops.map(n=>n.id)});
                if(!request.prompt?.trim() || (request.refs||[]).some(r=>r.kind&&r.kind!=='image'))reject('循环当前轮正文为空或包含音视频输入');
                slot.runPrompt=request.displayPrompt||request.prompt;slot.runModelPrompt=request.prompt;slot.runInputRefs=deps.cloneSmartSettings(request.refs||[]);
                let releaseSubmission,result;
                try{result=await deps.runApiGeneration(request.prompt.trim(),request.refs||[],runSettings,{...options,assistantNativeNodeId:loop.id,assistantLoopStepKey:step.key,
                    beforeSubmit:async()=>{
                        releaseSubmission=await acquireSubmission();
                        deps.throwIfSmartCascadeStopRequested(runState);
                        if(!current()||entry.status!=='ready'||slot.images?.length)reject('循环轮槽已变化');
                        // 串行保存提交边界；刷新遇到 submitting 只能查询，不猜测零受理。
                        await options.beforeSubmit();
                        if(!current()||runState.stopRequested||entry.status!=='ready'||slot.images?.length||!validateSmartAssistantLoopSlots(deps, loop,proposal))reject('循环提交门禁等待期间状态变化');
                        entry.status='submitting';run.unknownCount=(run.unknownCount||0)+1;
                        if(!await deps.saveCanvas()){entry.status='ready';run.unknownCount--;reject('提交保护未保存，未调用服务');}
                        if(!current()||runState.stopRequested){entry.status='ready';run.unknownCount--;reject('循环已停止，未调用服务');}
                    },
                    onAccepted:async id=>{
                        entry.taskIds=[id];entry.status='accepted';run.unknownCount=Math.max(0,(run.unknownCount||0)-1);if(!run.taskIds.includes(id))run.taskIds.push(id);
                        const pending=pendingFor(step,id);
                        deps.rememberSmartAcceptedTasks(slot,[pending],ownerCanvas);
                        slot.pendingTasks=[pending];slot.pending=1;
                        if(!current())return;
                        if(!await deps.saveSmartAcceptedTasksBeforeQuery(slot,[id])){runState.stopRequested=true;throw new Error('原任务已受理，编号尚未保存；只重试保存和查询');}
                        releaseSubmission?.();releaseSubmission=null;
                    }
                });
                taskId=entry.taskIds[0];
                if(!taskId){
                    const unknown=(result.submissionFailures||[]).some(f=>f.kind==='unknown');
                    entry.status=unknown?'unknown':'ready';
                    if(!unknown && run.unknownCount)run.unknownCount--;run.knownRejected=!unknown&&!run.taskIds.length;
                    if(unknown){loop.submissionUnknown=true;slot.submissionUnknown=true;runState.submissionUnknown=true;}
                    throw new Error(result.submissionWarning||'循环轮槽未取得原任务编号，不自动重提');
                }
                }finally{releaseSubmission?.();}
            }
            if(slot.pendingTasks?.some(t=>t.savePending) || !await deps.saveSmartAcceptedTasksBeforeQuery(slot,[taskId]))throw new Error('原任务编号尚未保存，只重试保存和查询');
            await deps.resumeSmartPendingNode(slot);
            if(!current() || !validateSmartAssistantLoopSlots(deps, loop,proposal))throw new Error('循环原归属已变化，保留成果');
            if(deps.smartPendingTasks(slot).length || !slot.images?.length)throw new Error('循环原任务尚未成功，请查询原编号');
            entry.status='succeeded';entry.resultUrls=slot.images.map(i=>i.url);deps.rememberRoundOutputs(ctx,{id:step.templateNodeId},slot.images);
            deps.render();if(!await deps.saveCanvas())throw new Error('循环原结果尚未保存，停止后续轮次');
        }
    };
    try{
        const offsets=Array.from({length:plan.rounds},(_,i)=>i);
        if(plan.mode==='parallel'&&plan.rounds>1)await deps.runSmartCascadeRoundsWithLimit(offsets,6,processRound,runState);
        else for(const offset of offsets)await processRound(offset);
        run.status='succeeded';run.knownRejected=false;
    }catch(error){
        run.error=error.message||'循环运行暂停';run.status=run.unknownCount?'unknown':'paused';
        if(!run.taskIds.length && run.submissionStarted===false)run.knownRejected=true;
        if(!run.taskIds.length)throw error;
    }finally{
        run.stopped=runState.stopRequested;deps.smartCascadeRuns.delete(loop.id);deps.syncSmartCascadeLegacyState();
        if(current()){deps.render();await deps.saveCanvas();}
    }
}

async function runSmartAssistantNativeImage(deps, node, options){
    if(node?.shotPromptOrigin)deps.CanvasVideoDeconstructionModel.validateShotImage(deps.nodes,deps.canvas.connections||[],node);
    const reject=message=>{const error=new Error(message);error.submissionKnownRejected=true;throw error;};
    const group=node?.type==='smart-group';
    if(!node || !['smart-image','smart-group'].includes(node.type) || deps.smartNodeInFlight(node) || node.submissionUnknown || (!group&&(node.images||[]).length) || node.outpaintSize)
        reject('此确认入口仅支持无原任务的空智能图片节点；已有结果请使用原入口');
    const selected=node.runSettings||{};
    const runSettings=deps.cloneSmartSettings(deps.smartSettingsForNode(node));
    if(selected.engine!=='api'||runSettings.engine!=='api'||runSettings.apiKind==='video'||deps.smartApiAudioMode(node,runSettings)
       ||!selected.provider_id||!selected.model||runSettings.provider_id!==selected.provider_id||runSettings.model!==selected.model)
        reject('智能图片引擎或手选模型已变化，未提交调用');
    const count=runSettings.count??1;
    if(!Number.isInteger(count)||count<1||count>8||count!==options.assistantMaxCalls)reject('智能图片确认数量已变化，未提交调用');
    const request=deps.buildPromptRequestForNode(node,null,deps.smartLoopContext);
    if(!request.prompt?.trim() || (request.refs||[]).some(ref=>ref.kind && ref.kind!=='image'))reject('图片正文为空或包含音视频输入，未提交调用');
    const run=node.assistantNativeRun;
    let output=node;
    if(group){
        if(!options.assistantOutputNodeId || !options.assistantRunInputHash || deps.nodes.some(n=>n.id===options.assistantOutputNodeId))reject('智能分组的新结果分支编号无效或已存在，未提交调用');
        const memberIds=new Set(node.items||[]);
        if(deps.nodes.some(n=>memberIds.has(n.id)&&(n.type==='smart-loop'||deps.smartNodeInFlight(n))))reject('分组循环或成员原任务尚未结束，请先核对原任务');
        deps.pushUndo();
        output=deps.createPendingOutputFromSource(node,count,deps.stripRunInputMeta(deps.snapshotRunMeta(request.prompt,node.id,request.displayPrompt,request.refs)),{connectSource:false,selectOutput:true,preserveSelection:true,refs:request.refs,outputNodeId:options.assistantOutputNodeId});
        output.assistantNativeOrigin={actionId:options.assistantNativeActionId,sourceNodeId:node.id,inputHash:options.assistantRunInputHash};
        output.runSettings=deps.cloneSmartSettings(runSettings);
        run.outputNodeId=output.id;run.inputHash=options.assistantRunInputHash;
        deps.render();
        if(!await deps.saveCanvas()){
            output.pending=0;run.knownRejected=true;
            reject('分组结果分支尚未保存，未提交调用；请先重试保存');
        }
    }
    const pendingTask=taskId=>({taskId,kind:'image',providerId:runSettings.provider_id,model:runSettings.model,
        ...(group?{assistantNativeActionId:options.assistantNativeActionId,assistantMaxCalls:options.assistantMaxCalls,assistantSourceNodeId:node.id,assistantInputHash:options.assistantRunInputHash,
            assistantBinding:{canvas_id:options.assistantCanvasId,node_id:node.id,assistant_action_id:options.assistantNativeActionId,input_hash:options.assistantRunInputHash,provider_id:runSettings.provider_id,model:runSettings.model}}: {})});
    node.running=true;deps.render();
    try{
        // 提交前不改变画布、全局设置或原输入，让原确认门禁核对真实的原状态。
        const result=await deps.runApiGeneration(request.prompt.trim(),request.refs||[],runSettings,{
            ...options,onAccepted:async taskId=>{
                if(!run.taskIds.includes(taskId))run.taskIds.push(taskId);
                // 每项收到编号就用原生本地恢复备份保存，不等待同批其它响应。
                deps.rememberSmartAcceptedTasks(output,[{...pendingTask(taskId),
                    assistantNativeActionId:options.assistantNativeActionId,assistantMaxCalls:options.assistantMaxCalls}],options.assistantCanvasId);
                if(group){
                    output.pendingTasks=run.taskIds.map(pendingTask);output.pending=run.taskIds.length;
                    if(deps.canvasId!==options.assistantCanvasId || !deps.nodes.includes(node) || !deps.nodes.includes(output) || node.assistantNativeRun!==run)return;
                    await deps.saveSmartAcceptedTasksBeforeQuery(output,[taskId]);
                }
            }
        });
        run.unknownCount=result.submissionFailures.filter(item=>item.kind==='unknown').length;
        run.warning=deps.recordSmartTaskSubmission(node,result);
        if(run.unknownCount)node.submissionUnknown=true;
        if(!run.taskIds.length){
            const error=new Error(run.warning||'未取得原任务编号，请查询；不自动重新提交');
            error.submissionKnownRejected=!run.unknownCount;throw error;
        }
        if(group&&(deps.canvasId!==options.assistantCanvasId || !deps.nodes.includes(node) || !deps.nodes.includes(output) || node.assistantNativeRun!==run))return;
        output.pendingTasks=run.taskIds.map(pendingTask);
        output.pending=run.taskIds.length;node.running=false;output.runStartedAt=deps.nowMs();output.runTimerHidden=false;
        output.runPrompt=request.displayPrompt||request.prompt;output.runModelPrompt=request.prompt;
        output.runInputRefs=deps.cloneSmartSettings(request.refs||[]);output.runPromptRefs=deps.cloneSmartSettings(request.refs||[]);
        if(group&&run.unknownCount)output.submissionUnknown=true;
        deps.render();
        if(!await deps.saveSmartAcceptedTasksBeforeQuery(output,run.taskIds))return;
        await deps.resumeSmartPendingNode(output);
    }catch(error){
        run.error=error.message||'智能图片运行失败';run.knownRejected=!!error.submissionKnownRejected||run.submissionStarted===false;
        deps.scheduleSave();
        if(!run.taskIds.length)throw error;
        // 已有编号后只保留原生恢复入口，禁止用轮询/保存错误重放提交。
    }finally{
        if(group&&!run.taskIds.length&&!run.unknownCount&&run.knownRejected){output.pending=0;output.running=false;}
        node.running=false;deps.render();
    }
    deps.scheduleSave();
}

    const api={smartAssistantLoopInputSignature, validateSmartAssistantLoopSlots, validateSmartLoopPendingOutput, runSmartAssistantNativeLoop, runSmartAssistantNativeImage};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.SmartAssistantExecution=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
