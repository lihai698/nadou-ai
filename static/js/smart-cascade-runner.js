/* Smart cascade runner. Host supplies instance state and effects. */
(function(root){
    'use strict';

    function smartCascadeParallelLimit(deps, chain=[]){
        const hasComfy = (chain || []).some(node => deps.smartSettingsForNode(node)?.engine === 'comfy');
        return hasComfy ? Math.max(1, Math.min(6, Number(deps.comfyInstanceCount) || 1)) : 6;
    }

    async function runSmartCascadeRoundsWithLimit(deps, roundIndexes, limit, runner, runState=null){
        let next = 0;
        const workerCount = Math.max(1, Math.min(Number(limit) || 1, roundIndexes.length));
        const workers = Array.from({length:workerCount}, async () => {
            while(next < roundIndexes.length){
                if(runState?.submissionUnknown || runState?.stopRequested || (!runState && deps.smartCascadeStopRequested)) break;
                const roundOffset = next++;
                const current = roundIndexes[roundOffset];
                try {
                    await runner(current, roundOffset);
                } catch(e) {
                    if(e?.smartCascadeStopped || runState?.submissionUnknown) break;
                    throw e;
                }
            }
        });
        const settled = await Promise.allSettled(workers);
        if(runState?.submissionUnknown) throw new Error(deps.smartUnknownResubmissionNotice(true));
        const failed = settled.find(item => item.status === 'rejected');
        if(failed) throw failed.reason;
    }

    async function runSmartCascade(deps, targetNode=null){
        const tail = targetNode || deps.selectedNode();
        if(!deps.canRunSmartCascade(tail)){ deps.toast('请选择链路结尾图片节点'); return; }
        deps.savePromptDraftForCurrent();
        const graph = deps.smartCascadeGraphForTail(tail);
        const chain = graph.path;
        const loop = deps.resolveSmartCascadeLoop(tail.id);
        const loopId = loop?.node?.id || '';
        if(loopId && deps.smartCascadeIsLoopRunning(loopId)){ deps.requestSmartCascadeStop(loopId); return; }
        if(!loopId && deps.smartCascadeAnyRunning()){ deps.requestSmartCascadeStop(); return; }
        const directLoopTargetRun = Boolean(loop && deps.isDirectLoopTargetRun(loop, tail, graph));
        const singleNodeLoopRun = Boolean(loop && (chain.length === 1 || directLoopTargetRun));
        if(!graph.edges.length && !singleNodeLoopRun){ deps.toast(deps.tr('smart.loopNoChain')); return; }
        const runNodes = [...chain, ...graph.edges.flatMap(edge => [edge.source, edge.target])];
        if(runNodes.some(node => deps.smartUnknownSubmissionForNode(node))){
            deps.toast(deps.smartUnknownResubmissionNotice(true));
            return;
        }
        const originalSelected = deps.selectedId;
        const originalSettings = deps.cloneSmartSettings(deps.settings);
        const originalPromptHtml = deps.promptInput.innerHTML;
        const runKey = loopId || `cascade-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const runState = {runKey, loopId, stopRequested:false, runPath:null};
        deps.smartCascadeRuns.set(runKey, runState);
        deps.syncSmartCascadeLegacyState(runKey);
        deps.smartCascadeSilentSelection = true;
        deps.runBtn.disabled = true;
        deps.cascadeRunBtn.disabled = false;
        deps.pushUndo();
        const totalRounds = loop?.count || 1;
        const startIndex = Math.max(1, Number(loop?.node?.loopStart) || 1);
        const batchSize = loop?.node?.imageInput ? Math.max(1, Math.min(100, Number(loop.node.imageBatchSize) || 1)) : 1;
        const endIndex = startIndex + (totalRounds - 1) * batchSize;
        const loopMode = loop?.mode === 'parallel' ? 'parallel' : 'serial';
        const parallelLimit = loopMode === 'parallel' && totalRounds > 1 ? smartCascadeParallelLimit(deps, chain) : 1;
        const precreateSingleSlots = singleNodeLoopRun && loopMode === 'parallel' && totalRounds > 1 && parallelLimit > 1;
        let singleLoopSlots = [];
        if(singleNodeLoopRun){
            runState.runPath = {states:{}};
            deps.smartCascadeRunPath = runState.runPath;
        }
        if(singleNodeLoopRun){
            singleLoopSlots = Array.from({length:totalRounds}, (_, round) => {
                const loopIndex = startIndex + round * batchSize;
                const slot = deps.loopOutputSlotForRound(tail, loop.node, loopIndex, round);
                return slot ? deps.tagLoopOutputSlot(slot, tail, loop.node, loopIndex, round) : null;
            });
            singleLoopSlots.filter(Boolean).forEach(slot => { runState.runPath.states[`${tail.id}->${slot.id}`] = 'wait'; });
            if(precreateSingleSlots){
                for(let slotOffset = 0; slotOffset < totalRounds; slotOffset++){
                    if(singleLoopSlots[slotOffset]) continue;
                    const loopIndex = startIndex + slotOffset * batchSize;
                    singleLoopSlots[slotOffset] = deps.createLoopOutputSlot(tail, loopIndex, slotOffset, {queued:true, loopNode:loop.node, slotIndex:slotOffset, runState});
                }
            }
            deps.render();
        }
        if(!singleNodeLoopRun){
            const runStates = {};
            if(loop?.node?.id && graph.root?.id) runStates[`${loop.node.id}->${graph.root.id}`] = 'wait';
            graph.edges.forEach(edge => { runStates[edge.key] = 'wait'; });
            runState.runPath = {states:runStates};
            deps.smartCascadeRunPath = runState.runPath;
            deps.scheduleConnectionLayerRefresh();
            deps.updateComposer();
        }
        try {
            const runRound = async (loopIndex=startIndex, options={}) => {
                deps.throwIfSmartCascadeStopRequested(runState);
                const ctx = loop
                    ? {index:loopIndex, total:endIndex, nodeId:loop.node.id, forceWorkflow:chain.length > 1 && !singleNodeLoopRun, runState, roundOutputs:new Map()}
                    : {runState, roundOutputs:new Map()};
                if(parallelLimit === 1) deps.smartLoopContext = ctx;
                if(singleNodeLoopRun){
                    const refs = deps.refsForDirectLoopRound(loop.node, loopIndex, endIndex);
                    if(directLoopTargetRun && parallelLimit === 1) deps.showDirectLoopRoundPreview(loop.node, tail, refs, loopIndex, endIndex);
                    const slotIndex = Math.max(0, Math.floor((loopIndex - startIndex) / batchSize));
                    const outputTarget = deps.tagLoopOutputSlot(
                        options.outputTarget || singleLoopSlots[slotIndex] || deps.loopOutputSlotForRound(tail, loop.node, loopIndex, slotIndex) || deps.createLoopOutputSlot(tail, loopIndex, slotIndex, {loopNode:loop.node, slotIndex, runState}),
                        tail,
                        loop.node,
                        loopIndex,
                        slotIndex
                    );
                    singleLoopSlots[slotIndex] = outputTarget;
                    await deps.runLoopRoundIntoSlot(loop.node, tail, outputTarget, loopIndex, ctx);
                    return;
                }
                const producedRefs = new Map();
                const runBranch = async (source, incomingRefs=[]) => {
                    deps.throwIfSmartCascadeStopRequested(runState);
                    let targets = graph.children.get(source.id) || [];
                    const loopPrompts = deps.isSmartImageNode(source) ? deps.upstreamLoopPromptNodesFor(source) : [];
                    const sourceLoopPrompts = deps.isSmartImageNode(source) ? deps.relayLoopPromptNodesForTarget(source) : [];
                    if(runState.runPath && sourceLoopPrompts.length && source?.id){
                        sourceLoopPrompts.forEach(loopNode => {
                            runState.runPath.states[`${loopNode.id}->${source.id}`] = 'done';
                        });
                        deps.scheduleConnectionLayerRefresh();
                    }
                    if(loopPrompts.length && targets.length > 1){
                        const firstLoop = loopPrompts[0];
                        const startBase = Math.max(1, Number(firstLoop.loopStart) || 1);
                        const currentIndex = Math.max(1, Number(ctx?.index || startBase) || startBase);
                        const selectedTarget = targets[(currentIndex - 1) % targets.length];
                        if(runState.runPath && firstLoop?.id && source?.id){
                            runState.runPath.states[`${firstLoop.id}->${source.id}`] = 'done';
                            deps.scheduleConnectionLayerRefresh();
                        }
                        targets = [selectedTarget].filter(Boolean);
                    }
                    let sharedRefs = incomingRefs;
                    for(let index = 0; index < targets.length; index++){
                        deps.throwIfSmartCascadeStopRequested(runState);
                        const target = targets[index];
                        const edgeKey = `${source.id}->${target.id}`;
                        let outputs = [];
                        const targetChildren = (graph.children.get(target.id) || []).filter(child => child && child.type !== 'smart-loop');
                        const targetIsLeaf = target.type !== 'smart-loop' && targetChildren.length === 0;
                        const relayLoops = deps.isSmartImageNode(source) && deps.isSmartImageNode(target)
                            ? deps.relayLoopPromptNodesForEdge(source, target)
                            : [];
                        const stepCtx = relayLoops.length && deps.isSmartImageNode(target)
                            ? {...(ctx || {}), appendLoopOutputs:Boolean(ctx?.nodeId && targetIsLeaf), relayPromptNodeIds:[...new Set([...(ctx?.relayPromptNodeIds || []), ...relayLoops.map(n => n.id)])]}
                            : {...(ctx || {}), appendLoopOutputs:Boolean(ctx?.nodeId && targetIsLeaf)};
                        try {
                            if(runState.runPath && relayLoops.length && source?.id && deps.isSmartImageNode(target)){
                                relayLoops.forEach(loopNode => {
                                    runState.runPath.states[`${loopNode.id}->${source.id}`] = 'done';
                                });
                                deps.scheduleConnectionLayerRefresh();
                            }
                            if(runState.runPath){
                                runState.runPath.states[edgeKey] = 'active';
                                deps.scheduleConnectionLayerRefresh();
                            }
                            if(target.type === 'smart-loop'){
                                outputs = deps.outputImagesForNode(source, true, ctx).filter(img => img?.url);
                                sharedRefs = deps.cascadeRefsFromOutputs(outputs, source);
                            } else if(index === 0){
                                outputs = await deps.runCascadeStepIntoNode(source, target, incomingRefs, stepCtx);
                                sharedRefs = deps.cascadeRefsFromOutputs(outputs, target);
                            } else {
                                outputs = deps.appendCascadeRefsToReceiver(target, sharedRefs, stepCtx);
                            }
                        } catch(err) {
                            if(/缺少提示词|需要输入文本|need prompt/i.test(err.message || '') && incomingRefs.length){
                                outputs = deps.appendCascadeRefsToReceiver(target, incomingRefs, stepCtx);
                                if(index === 0){
                                    sharedRefs = deps.cascadeRefsFromOutputs(outputs, target);
                                }
                            } else {
                                throw err;
                            }
                        }
                        if(runState.runPath){
                            runState.runPath.states[edgeKey] = 'done';
                            deps.scheduleConnectionLayerRefresh();
                        }
                        const refs = target.type === 'smart-loop' ? sharedRefs : (index === 0 ? sharedRefs : deps.cascadeRefsFromOutputs(outputs, target));
                        producedRefs.set(target.id, refs);
                        deps.throwIfSmartCascadeStopRequested(runState);
                        await runBranch(target, refs);
                    }
                };
                const rootRefs = deps.defaultReferenceImagesFor(graph.root, true, ctx).filter(img => img?.url);
                producedRefs.set(graph.root.id, rootRefs);
                await runBranch(graph.root, rootRefs);
            };
            const roundIndexes = Array.from({length:totalRounds}, (_, round) => startIndex + round * batchSize);
            if(loopMode === 'parallel' && totalRounds > 1){
                const parallelTargets = singleNodeLoopRun
                    ? singleLoopSlots
                    : [];
                if(parallelTargets.length) deps.render();
                await runSmartCascadeRoundsWithLimit(deps, roundIndexes, parallelLimit, (loopIndex, roundOffset) => {
                    const outputTarget = parallelTargets[roundOffset] || null;
                    return runRound(loopIndex, {outputTarget});
                }, runState);
            } else {
                for(const loopIndex of roundIndexes){
                    deps.throwIfSmartCascadeStopRequested(runState);
                    await runRound(loopIndex);
                }
            }
            deps.throwIfSmartCascadeStopRequested(runState);
            if(parallelLimit === 1) deps.smartLoopContext = null;
            deps.selectedId = '';
            deps.selectedIds = [];
            deps.selectedImage = {nodeId:'', index:-1};
            deps.activeComposerSubject = null;
            deps.lastComposerNodeId = '';
            deps.composer.classList.remove('open');
            deps.settings = originalSettings;
            deps.promptInput.innerHTML = originalPromptHtml;
            deps.scheduleSave();
            deps.toast(totalRounds > 1
                ? deps.trf(loopMode === 'parallel' ? 'smart.loopParallelRoundsDone' : 'smart.loopRunRoundsDone', {n:totalRounds})
                : deps.tr('smart.loopRunDone'));
        } catch(e) {
            if(parallelLimit === 1) deps.smartLoopContext = null;
            deps.selectedId = originalSelected;
            deps.settings = originalSettings;
            deps.promptInput.innerHTML = originalPromptHtml;
            deps.toast(e?.smartCascadeStopped ? '已停止一键运行' : (e.message || deps.tr('smart.errRunFailed')).slice(0, 160));
        } finally {
            deps.smartCascadeRuns.delete(runKey);
            deps.syncSmartCascadeLegacyState();
            deps.smartCascadeSilentSelection = false;
            deps.syncRunButtonState();
            deps.cascadeRunBtn.disabled = false;
            if(directLoopTargetRun) deps.finishLoopTargetPreviewState(tail);
            deps.scheduleSave();
            deps.render();
        }
    }

    function runSmartCascadeFromLoop(deps, loopId){
        const loop = deps.nodes.find(n => n.id === loopId && n.type === 'smart-loop');
        if(!loop){ deps.toast('没有找到循环节点'); return; }
        const tail = deps.cascadeTailForLoop(loop.id);
        if(!tail){ deps.toast('请把循环节点连接到下游图片链路'); return; }
        deps.selectedId = tail.id;
        deps.selectedIds = [];
        deps.selectedImage = {nodeId:'', index:-1};
        runSmartCascade(deps, tail);
    }

    const api={smartCascadeParallelLimit, runSmartCascadeRoundsWithLimit, runSmartCascade, runSmartCascadeFromLoop};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.SmartCascadeRunner=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
