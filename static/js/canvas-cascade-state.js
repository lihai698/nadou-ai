/* Classic cascade state. Host supplies instance state and effects. */
(function(root){
    'use strict';

    function clearStuckGeneratorRunning(deps, node){
        if(!node || !node.running) return;
        if(deps.cascadeRunningIds.has(node.id) || deps.cascadeSerialIds.has(node.id)) return;
        node.running = false;
    }

    function resetCascadeRuntimeState(deps){
        deps.cascadeRunningIds.clear();
        deps.cascadeStopIds.clear();
        deps.cascadeSerialIds.clear();
        deps.cascadeContexts.forEach(ctx => clearCascadeCleanupTimer(deps, ctx));
        deps.cascadeContexts.clear();
        deps.loopContext = null;
    }

    function cascadeContextFor(deps, targetId){
        return targetId ? deps.cascadeContexts.get(targetId) || null : null;
    }

    function isCascadeActive(deps, targetId){
        const ctx = cascadeContextFor(deps, targetId);
        return Boolean(ctx && (ctx.status === 'running' || ctx.status === 'stopping'));
    }

    function isCascadeStopping(deps, targetId){
        return cascadeContextFor(deps, targetId)?.status === 'stopping';
    }

    function cascadeAbortError(deps, message='已停止一键运行'){
        const err = new Error(message);
        err.name = 'CascadeAbortError';
        err.isCascadeAbort = true;
        return err;
    }

    function isCascadeAbortError(deps, err){
        return Boolean(err?.isCascadeAbort || err?.name === 'CascadeAbortError');
    }

    function cascadeStopMessage(deps, reason=''){
        if(reason) return reason;
        return deps.langIsEn() ? 'One-click run stopped' : '已停止一键运行';
    }

    function cascadeBackendRestartMessage(deps){
        return deps.langIsEn() ? 'Backend restarted and task status was lost. This one-click run has been stopped.' : '后端已重启，任务状态已丢失，本次一键运行已停止';
    }

    function clearCascadeNodeState(deps, node, options={}){
        if(!node) return;
        const keepError = Boolean(options.keepError);
        if(node.runStatus) node.runStatus = '';
        if(node._cascadeIdx) node._cascadeIdx = '';
        if(!keepError){
            node.runError = '';
            node._cascadeFailed = false;
        }
    }

    function createCascadeContext(deps, targetId, order, options={}){
        const ctx = {
            targetId,
            order:[...(order || [])],
            status:'running',
            startedAt:deps.nowMs(),
            abortRequested:false,
            message:'',
            currentNodeId:'',
            currentRoundLabel:'',
            mode:options.mode || 'serial',
            cleanupTimer:null,
            controllers:new Set()
        };
        deps.cascadeContexts.set(targetId, ctx);
        return ctx;
    }

    function clearCascadeCleanupTimer(deps, ctx){
        if(!ctx?.cleanupTimer) return;
        deps.clearTimeout(ctx.cleanupTimer);
        ctx.cleanupTimer = null;
    }

    function beginCascade(deps, targetId, order, options={}){
        const existing = cascadeContextFor(deps, targetId);
        if(existing){
            clearCascadeCleanupTimer(deps, existing);
            deps.cascadeContexts.delete(targetId);
        }
        const ctx = createCascadeContext(deps, targetId, order, options);
        deps.cascadeRunningIds.add(targetId);
        if(options.serial) deps.cascadeSerialIds.add(targetId);
        if(options.mode) ctx.mode = options.mode;
        return ctx;
    }

    function queueCascadeCleanup(deps, ctx, ids){
        if(!ctx) return;
        clearCascadeCleanupTimer(deps, ctx);
        ctx.cleanupTimer = deps.setTimeout(() => {
            const uniqueIds = [...new Set((ids || []).filter(Boolean))];
            uniqueIds.forEach(id => {
                const node = deps.nodes.find(n => n.id === id);
                if(node && node.runStatus === 'done') clearCascadeNodeState(deps, node, {keepError:false});
            });
            deps.refreshNodes(uniqueIds);
            if(deps.cascadeContexts.get(ctx.targetId) === ctx) deps.cascadeContexts.delete(ctx.targetId);
            ctx.cleanupTimer = null;
        }, 3000);
    }

    function requestCascadeStop(deps, targetId, reason=''){
        if(!targetId) return;
        deps.cascadeStopIds.add(targetId);
        const ctx = cascadeContextFor(deps, targetId);
        if(ctx){
            ctx.abortRequested = true;
            ctx.status = 'stopping';
            if(reason) ctx.message = reason;
            [...(ctx.controllers || [])].forEach(controller => {
                try { controller.abort(); } catch(_) {}
            });
        }
        deps.refreshNodes(cascadeUiNodeIds(deps, targetId));
    }

    function ensureCascadeActive(deps, targetId, reason=''){
        const ctx = cascadeContextFor(deps, targetId);
        if(!ctx) return null;
        if(ctx.abortRequested || ctx.status === 'stopping') throw cascadeAbortError(deps, cascadeStopMessage(deps, reason || ctx.message));
        return ctx;
    }

    function finalizeCascade(deps, targetId, state, options={}){
        const ctx = cascadeContextFor(deps, targetId);
        const order = options.order || ctx?.order || deps.computeCascadeOrder(targetId);
        const uiIds = cascadeUiNodeIds(deps, targetId, order);
        clearCascadeCleanupTimer(deps, ctx);
        deps.cascadeRunningIds.delete(targetId);
        deps.cascadeStopIds.delete(targetId);
        deps.cascadeSerialIds.delete(targetId);
        if(ctx) ctx.status = state;
        if(state === 'done'){
            queueCascadeCleanup(deps, ctx, uiIds);
            deps.refreshNodes(uiIds);
            return;
        }
        if(state === 'stopped'){
            (order || []).forEach(id => {
                const node = deps.nodes.find(n => n.id === id);
                if(node && !node._cascadeFailed) clearCascadeNodeState(deps, node);
            });
        }
        deps.refreshNodes(uiIds);
        deps.cascadeContexts.delete(targetId);
    }

    function cascadeTargetIdFromOptions(deps, options={}){
        return String(options?.cascadeTargetId || options?.targetId || '');
    }

    function cascadeContextFromOptions(deps, options={}){
        return cascadeContextFor(deps, cascadeTargetIdFromOptions(deps, options));
    }

    async function cascadeFetch(deps, input, init={}, options={}){
        const ctx = cascadeContextFromOptions(deps, options);
        if(!ctx) return deps.fetch(input, init);
        ensureCascadeActive(deps, ctx.targetId, ctx.message);
        const controller = new AbortController();
        ctx.controllers.add(controller);
        try {
            return await deps.fetch(input, {...init, signal:controller.signal});
        } catch(err) {
            if(controller.signal.aborted || err?.name === 'AbortError'){
                throw cascadeAbortError(deps, cascadeStopMessage(deps, ctx.message));
            }
            throw err;
        } finally {
            ctx.controllers.delete(controller);
        }
    }

    function cascadeUiNodeIds(deps, targetId, order=null){
        const ids = new Set([targetId, ...(order || deps.computeCascadeOrder(targetId))]);
        const loop = deps.resolveCascadeLoop(targetId);
        if(loop?.node?.id) ids.add(loop.node.id);
        return [...ids].filter(Boolean);
    }

    function cancelCascade(deps, nodeId){
        requestCascadeStop(deps, nodeId);
    }

    const api={clearStuckGeneratorRunning, resetCascadeRuntimeState, cascadeContextFor, isCascadeActive, isCascadeStopping, cascadeAbortError, isCascadeAbortError, cascadeStopMessage, cascadeBackendRestartMessage, clearCascadeNodeState, createCascadeContext, clearCascadeCleanupTimer, beginCascade, queueCascadeCleanup, requestCascadeStop, ensureCascadeActive, finalizeCascade, cascadeTargetIdFromOptions, cascadeContextFromOptions, cascadeFetch, cascadeUiNodeIds, cancelCascade};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.CanvasCascadeState=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
