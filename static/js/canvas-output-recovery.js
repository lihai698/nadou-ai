/* Canvas output application and history coordination: canvas-output-recovery. Host supplies live state and effects. */
(function(root){
    'use strict';

function extractUpstreamTaskId(deps, text){
    const match = String(text || '').match(/(?:task_id|taskId|task id)\s*[=:：]\s*([A-Za-z0-9_.:-]+)/i);
    return match ? match[1] : '';
}

function providerIdForPending(deps, pending){
    return pending?.providerId
        || pending?.run?.request?.provider_id
        || pending?.run?.node?.apiProvider
        || pending?.run?.node?.provider_id
        || 'comfly';
}

function completeRecoverPendingOutput(deps, out, pending, result){
    if(!out || !pending || !result) return;
    const images = result.images || [];
    if(!images.length) return;
    const meta = {
        runMs: deps.nowMs() - Number(pending.startedAt || deps.nowMs()),
        run: pending.run || {},
    };
    meta.run.request = deps.requestMetaFromResult(result);
    out._pending = (out._pending || []).filter(p => p.id !== pending.id);
    deps.appendOutputImages(out, images, meta.run?.refs?.[0], [meta]);
    const gen = deps.nodes.find(n => n.id === meta.run?.node?.id);
    if(gen){
        deps.mergeGeneratedOutputs(gen, images, Boolean(pending.appendGenerated));
        gen.runStatus = 'done';
        gen.runError = '';
        gen.running = false;
    }
    deps.addGenerationLog({run:meta.run, outputs:images, runMs:meta.runMs || 0});
    deps.refreshRunNodes(gen, out);
    deps.scheduleSave();
}

async function queryRecoverPendingOutput(deps, pendingId){
    const out = deps.findOutputByPendingId(pendingId);
    const pending = deps.pendingById(out, pendingId);
    if(!out || !pending || pending.querying) return;
    if(pending.canvasTaskId && ['online-image', 'comfy', 'video', 'runninghub'].includes(pending.canvasTaskType)){
        return saveAndQueryCanvasPendingTask(deps, pending);
    }
    const taskId = pending.recoverTaskId || extractUpstreamTaskId(deps, pending.error || '');
    if(!taskId){
        deps.showErrorModal('没有任务 ID，无法查询结果', deps.tr('canvas.apiFailed'));
        return;
    }
    pending.querying = true;
    pending.recoverTaskId = taskId;
    deps.refreshNodes([out.id]);
    try {
        const res = await deps.fetch('/api/image-task-query', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({provider_id:providerIdForPending(deps, pending), task_id:taskId})
        });
        if(!res.ok) throw new Error(await deps.responseErrorMessage(res, '查询失败'));
        const data = await res.json();
        if(data.status === 'succeeded'){
            completeRecoverPendingOutput(deps, out, pending, data);
            return;
        }
        if(data.status === 'failed'){
            pending.error = data.error || deps.tr('canvas.generationFailed');
            deps.showErrorModal(pending.error, deps.tr('canvas.apiFailed'));
        } else {
            pending.error = data.message || '任务仍在生成中，请稍后再查询';
            deps.setStatus(pending.error);
        }
    } catch(err) {
        pending.error = err.message || '查询失败';
        deps.showErrorModal(pending.error, deps.tr('canvas.apiFailed'));
    } finally {
        const latest = deps.pendingById(out, pendingId);
        if(latest){
            latest.querying = false;
            deps.refreshNodes([out.id]);
            deps.scheduleSave();
        }
    }
}

async function saveAndQueryCanvasPendingTask(deps, pending){
    if(!pending?.canvasTaskId) return 'missing';
    if(pending.savePending){
        if(!await deps.saveCanvas()){
            deps.showErrorModal('画布尚未保存，请稍后点击“保存并查询”；不要重新提交。', deps.tr('canvas.apiFailed'));
            return 'paused';
        }
        delete pending.savePending;
        deps.scheduleSave();
    }
    return pending.canvasTaskType === 'runninghub'
        ? deps.pollCanvasRunningHubTask(pending.canvasTaskId, {useWallet:Boolean(pending.useWallet)})
        : pending.canvasTaskType === 'comfy'
        ? deps.pollCanvasComfyTask(pending.canvasTaskId)
        : pending.canvasTaskType === 'video'
            ? deps.pollCanvasVideoTask(pending.canvasTaskId, {forceRefresh:Boolean(pending.remoteRefreshable)})
            : deps.pollCanvasImageTask(pending.canvasTaskId);
}

    const api={extractUpstreamTaskId, providerIdForPending, completeRecoverPendingOutput, queryRecoverPendingOutput, saveAndQueryCanvasPendingTask};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.CanvasOutputRecovery=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
