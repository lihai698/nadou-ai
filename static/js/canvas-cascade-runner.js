/* Classic cascade runner. Host supplies instance state and effects. */
(function(root){
    'use strict';

    function runCascadeNodeByType(deps, node, opts={}){
        const runOpts = {cascade:true, ...opts};
        if(deps.cascadeContextFromOptions(runOpts)?.submissionIncomplete){
            throw deps.cascadeAbortError('本次一键运行有任务未完整受理，已停止后续提交');
        }
        if(node.type === 'generator') return deps.runGenerator(node.id, runOpts);
        if(node.type === 'midjourney') return deps.runMidjourneyNode(node.id, runOpts);
        if(node.type === 'msgen') return deps.runMsGenNode(node.id, runOpts);
        if(node.type === 'comfy') return deps.runComfyNode(node.id, runOpts);
    
        if(node.type === 'llm') return deps.runLLMNode(node.id, runOpts);
        if(node.type === 'video') return deps.runVideoNode(node.id, runOpts);
        if(node.type === 'rh') return deps.runRhNode(node.id, runOpts);
    
        return Promise.resolve();
    }

    async function runCascadeNodeWithLoopContext(deps, node, ctx, opts={}){
        const previous = deps.loopContext;
        const previousNodeCtx = node ? node._activeLoopCtx : null;
        deps.loopContext = ctx || null;
        if(node) node._activeLoopCtx = ctx || null;
        try {
            return await runCascadeNodeByType(deps, node, opts);
        } finally {
            deps.loopContext = previous;
            if(node){
                if(previousNodeCtx) node._activeLoopCtx = previousNodeCtx;
                else delete node._activeLoopCtx;
            }
        }
    }

    function cascadeParallelLimit(deps, order, totalRounds){
        const hasComfy = order.some(id => ['comfy'].includes(deps.nodes.find(n => n.id === id)?.type));
        if(hasComfy) return Math.max(1, Math.min(totalRounds, deps.comfyBackendCount || 1));
        return Math.max(1, Math.min(totalRounds, 6));
    }

    async function runLimitedCascadeRounds(deps, rounds, limit, runner){
        let next = 0;
        const workers = Array.from({length:Math.max(1, Math.min(limit, rounds.length))}, async () => {
            while(next < rounds.length){
                const round = rounds[next++];
                await runner(round);
            }
        });
        return Promise.allSettled(workers);
    }

    async function runCanvasGenerate(deps, nodeId){
        const node = deps.nodes.find(n => n.id === nodeId);
        if(!node || node.running || deps.cascadeRunningIds.has(nodeId)) return;
        if(!deps.confirmOrphanUnknownCanvasSubmission()) return;
        return runCascadeNodeByType(deps, node, {cascade:false});
    }

    async function runNodeCascade(deps, nodeId){
        const target = deps.nodes.find(n => n.id === nodeId);
        if(!target) return;
        if(!deps.confirmOrphanUnknownCanvasSubmission()) return;
        if(target.running){ deps.alert('当前节点正在运行'); return; }
        const order = deps.computeCascadeOrder(nodeId);
        if(!order.length){ deps.alert('没有可运行的生成节点'); return; }
        const loop = deps.resolveCascadeLoop(nodeId);
        const totalRounds = loop?.count || 1;
        const startIdx = Math.max(1, Number(loop?.node?.loopStart) || 1);
        const loopImageStride = loop?.node?.imageInput ? Math.max(1, Math.min(100, Number(loop?.node?.imageBatchSize) || 1)) : 0;
        const loopBatchSize = Math.max(1, loopImageStride);
        const endIdx = startIdx + (totalRounds - 1) * loopBatchSize;
        const ctx = deps.beginCascade(nodeId, order, {serial:true, mode:loop?.mode || 'serial'});
        deps.refreshNodes(deps.cascadeUiNodeIds(nodeId, order));
        order.forEach(id => {
            const n = deps.nodes.find(x => x.id === id);
            if(n) n.generatedOutputs = [];
        });
        if(loop?.mode === 'parallel' && totalRounds > 1){
            order.forEach(id => {
                const n = deps.nodes.find(x => x.id === id);
                if(n){ n.runStatus = 'queued'; n.runError = ''; n._cascadeFailed = false; n._cascadeIdx = `0/${totalRounds}`; }
            });
            deps.refreshNodes(deps.cascadeUiNodeIds(nodeId, order));
            let done = 0;
            const rounds = Array.from({length:totalRounds}, (_, idx) => ({idx, index:startIdx + idx * loopBatchSize}));
            const limit = cascadeParallelLimit(deps, order, totalRounds);
            const results = await runLimitedCascadeRounds(deps, rounds, limit, async ({index}) => {
                deps.ensureCascadeActive(nodeId, ctx.message);
                const loopCtx = {index, total:endIdx, nodeId:loop.node.id};
                for(let i = 0; i < order.length; i++){
                    deps.ensureCascadeActive(nodeId, ctx.message);
                    const id = order[i];
                    const node = deps.nodes.find(n => n.id === id);
                    if(!node) continue;
                    ctx.currentNodeId = id;
                    ctx.currentRoundLabel = `${index}/${endIdx}`;
                    node.runStatus = 'running';
                    node._cascadeIdx = `${order.indexOf(id)+1}/${order.length} · ${index}/${endIdx}`;
                    deps.refreshNodes([id]);
                    await runCascadeNodeWithLoopContext(deps, node, loopCtx, {cascadeTargetId:nodeId});
                    deps.ensureCascadeActive(nodeId, ctx.message);
                    node.runStatus = 'done';
                    deps.refreshNodes([id]);
                }
                done += 1;
                order.forEach(id => {
                    const n = deps.nodes.find(x => x.id === id);
                    if(n) n._cascadeIdx = `${done}/${totalRounds}`;
                });
                deps.refreshNodes(order);
            });
            deps.loopContext = null;
            const failed = results.find(r => r.status === 'rejected');
            if(failed){
                const err = failed.reason || new Error('parallel loop failed');
                if(deps.isCascadeAbortError(err)){
                    deps.finalizeCascade(nodeId, 'stopped', {order});
                    return;
                }
                const node = deps.nodes.find(n => n.id === ctx.currentNodeId) || deps.nodes.find(n => n.id === nodeId) || target;
                node.runStatus = 'failed';
                node.runError = err.message || String(err);
                node._cascadeFailed = true;
                deps.finalizeCascade(nodeId, 'failed', {order});
                return;
            }
            deps.finalizeCascade(nodeId, 'done', {order});
            return;
        }
        deps.refreshNodes(deps.cascadeUiNodeIds(nodeId, order));
        for(let round = 1; round <= totalRounds; round++){
            deps.ensureCascadeActive(nodeId, ctx.message);
            const loopIndex = startIdx + (round - 1) * loopBatchSize;
            deps.loopContext = loop ? {index:loopIndex, total:endIdx, nodeId:loop.node.id} : null;
            order.forEach(id => {
                const n = deps.nodes.find(x => x.id === id);
                if(n){ n.runStatus = 'queued'; n.runError = ''; n._cascadeFailed = false; n._cascadeIdx = `${order.indexOf(id)+1}/${order.length}${totalRounds > 1 ? ` · ${loopIndex}/${endIdx}` : ''}`; }
            });
            deps.refreshNodes(deps.cascadeUiNodeIds(nodeId, order));
            for(let i = 0; i < order.length; i++){
                const id = order[i];
                const node = deps.nodes.find(n => n.id === id);
                if(!node) continue;
                ctx.currentNodeId = id;
                ctx.currentRoundLabel = totalRounds > 1 ? `${loopIndex}/${endIdx}` : '';
                node.runStatus = 'running';
                deps.refreshNodes([id]);
                try {
                    await runCascadeNodeWithLoopContext(deps, node, deps.loopContext, {cascadeTargetId:nodeId});
                    deps.ensureCascadeActive(nodeId, ctx.message);
                    node.runStatus = 'done';
                    deps.refreshNodes([id]);
                } catch(err){
                    deps.loopContext = null;
                    if(deps.isCascadeAbortError(err)){
                        deps.finalizeCascade(nodeId, 'stopped', {order});
                        return;
                    }
                    node.runStatus = 'failed';
                    node.runError = `${totalRounds > 1 ? `${deps.tr('canvas.loopRound')} ${round}/${totalRounds}: ` : ''}${err.message || String(err)}`;
                    node._cascadeFailed = true;
                    for(let j = i + 1; j < order.length; j++){
                        const n2 = deps.nodes.find(x => x.id === order[j]);
                        if(n2){ n2.runStatus = ''; n2._cascadeIdx = ''; }
                    }
                    deps.finalizeCascade(nodeId, 'failed', {order});
                    return;
                }
            }
        }
        deps.loopContext = null;
        deps.finalizeCascade(nodeId, 'done', {order});
    }

    async function runOneCascadePass(deps, order, options={}){
        const targetId = deps.cascadeTargetIdFromOptions(options);
        order.forEach(id => {
            const n = deps.nodes.find(x => x.id === id);
            if(n){ n.runStatus = 'queued'; n.runError = ''; n._cascadeFailed = false; n._cascadeIdx = ''; }
        });
        deps.refreshNodes(order);
        for(let i = 0; i < order.length; i++){
            if(targetId) deps.ensureCascadeActive(targetId);
            const id = order[i];
            const node = deps.nodes.find(n => n.id === id);
            if(!node) continue;
            const ctx = deps.cascadeContextFor(targetId);
            if(ctx) ctx.currentNodeId = id;
            node.runStatus = 'running';
            deps.refreshNodes([id]);
            try {
                if(node.type === 'generator') await deps.runGenerator(id, {cascade:true, cascadeTargetId:targetId});
                else if(node.type === 'midjourney') await deps.runMidjourneyNode(id, {cascade:true, cascadeTargetId:targetId});
                else if(node.type === 'msgen') await deps.runMsGenNode(id, {cascade:true, cascadeTargetId:targetId});
                else if(node.type === 'comfy') await deps.runComfyNode(id, {cascade:true, cascadeTargetId:targetId});
                else if(node.type === 'llm') await deps.runLLMNode(id, {cascade:true, cascadeTargetId:targetId});
                else if(node.type === 'video') await deps.runVideoNode(id, {cascade:true, cascadeTargetId:targetId});
                else if(node.type === 'rh') await deps.runRhNode(id, {cascade:true, cascadeTargetId:targetId});
                else
                if(targetId) deps.ensureCascadeActive(targetId);
                node.runStatus = 'done';
                deps.refreshNodes([id]);
            } catch(err) {
                node.runStatus = 'failed';
                node.runError = err.message || String(err);
                node._cascadeFailed = true;
                throw err;
            }
        }
    }

    async function retryNodeAndDownstream(deps, nodeId){
        const target = deps.nodes.find(n => n.id === nodeId);
        if(!target) return;
        if(deps.isCascadeActive(nodeId)) return;
        const order = deps.computeCascadeOrder(nodeId);
        // 只重跑从该节点开始的剩余链
        const idx = order.indexOf(nodeId);
        const remain = idx >= 0 ? order.slice(idx) : [nodeId];
        deps.beginCascade(nodeId, remain, {serial:true, mode:'retry'});
        try {
            await runOneCascadePass(deps, remain, {cascadeTargetId:nodeId});
            deps.finalizeCascade(nodeId, 'done', {order:remain});
        } catch(err) {
            if(deps.isCascadeAbortError(err)){
                deps.finalizeCascade(nodeId, 'stopped', {order:remain});
                return;
            }
            deps.finalizeCascade(nodeId, 'failed', {order:remain});
            deps.refreshNodes(remain);
        }
    }

    const api={runCascadeNodeByType, runCascadeNodeWithLoopContext, cascadeParallelLimit, runLimitedCascadeRounds, runCanvasGenerate, runNodeCascade, runOneCascadePass, retryNodeAndDownstream};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.CanvasCascadeRunner=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
