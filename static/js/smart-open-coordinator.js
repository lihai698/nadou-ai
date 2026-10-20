/* Canvas open lifecycle: smart-open-coordinator. Host supplies live state and effects. */
(function(root){
    'use strict';

async function loadCanvas(deps){
    if(!deps.canvasId) return;
    const isCurrent=deps.beginMediaInputLoad();
    deps.smartRemoteSync.stop();
    deps.invalidateSmartVideoDeconstruction();
    try {
        const res = await deps.fetch(`/api/canvases/${encodeURIComponent(deps.canvasId)}`);
        if(!res.ok) return;
        const data = await res.json();
        if(!isCurrent())return;
        deps.canvas = data.canvas;
        deps.rememberCanvasListProject(deps.canvas.project || 'default');
        deps.canvasUsesConnections = Object.prototype.hasOwnProperty.call(deps.canvas || {}, 'connections');
        deps.document.title = deps.canvas.title || deps.tr('canvas.smartCanvas');
        deps.document.getElementById('smartTitle').textContent = deps.canvas.title || deps.tr('canvas.smartCanvas');
        deps.nodes = (Array.isArray(deps.canvas.nodes) ? deps.canvas.nodes : []).map(deps.normalizeLegacySmartNode).filter(Boolean);
        deps.rememberServerCanvasNodes(deps.canvas);
        deps.migrateSmartGroupImageMembers();
        deps.canvas.connections = Array.isArray(deps.canvas.connections) ? deps.canvas.connections : [];
        deps.nodes.forEach(n => {
            if(deps.window.CanvasAudio.isActive(n))n.running=false;

            const pendingTasks = deps.smartPendingTasks(n);
            if(pendingTasks.length){
                n.pending = Math.max(pendingTasks.length, Number(n.pending || 0) || pendingTasks.length);
                n.running = false;
            } else if(deps.smartNodeHasDisplayResult(n)){
                deps.markSmartNodeComplete(n, {hideTimer:true});
            } else if(n.pending || n.queued){
                deps.clearSmartNodeBusyState(n);
            }
        });
        const cleanedCompletedState = deps.clearCompletedNodeBusyStates();
        const recoveredLoopOutputs = deps.recoverStuckLoopOutputsFromLogs();
        const hiddenCompletedTimers = deps.hideCompletedRunTimers();
        const cleanedDetachedInputs = deps.cleanupDetachedRunInputRefs();
        deps.viewport = {...deps.viewport, ...(deps.canvas.viewport || {})};
        deps.viewport.scale = deps.safeScale(deps.viewport.scale);
        if(deps.canvas.settings) deps.settings = {...deps.settings, ...deps.canvas.settings};
        deps.normalizeSmartVideoModeSettings(deps.settings, true);
        deps.nodes.forEach(node => {
            if(node.runSettings) deps.normalizeSmartVideoModeSettings(node.runSettings, true);
        });
        deps.canvasDefaultSmartSettings = deps.cloneSmartSettings(deps.settings);
        deps.loadRecentSmartSettings();
        if(deps.settings.comfy_workflow && !deps.settings.comfyWorkflow) deps.settings.comfyWorkflow = deps.settings.comfy_workflow;
        if(deps.settings.comfy_params && !deps.settings.comfyParams) deps.settings.comfyParams = deps.settings.comfy_params;
        const draftRecoveryReady = await deps.window.CanvasSaveRecovery?.prepareRecovery?.('smart',deps.canvasId,deps.rememberServerCanvasNodes.snapshot,deps.smartDraftConflictCopy);
        if(!isCurrent())return;
        const draftRecovered = deps.restoreSmartDraft();
        if(draftRecoveryReady === false && !draftRecovered){
            deps.setCanvasSaveError(true);
            const label = deps.document.querySelector('#canvasSaveError span');
            if(label) label.textContent = '暂时无法读取本机草稿，已显示最近保存的画布。请检查浏览器存储后重新打开。';
        }
        deps.restoreSmartUnsavedAcceptedTasks();
        deps.updateProviderModels();
        deps.applyViewport();
        deps.render();
        if(cleanedDetachedInputs || cleanedCompletedState || recoveredLoopOutputs || hiddenCompletedTimers) deps.scheduleSave();
        deps.resumeSmartPendingTasks();
    deps.resumeSmartAudioTasks();
        deps.resumeJimengPendingNodes();
        deps.startCanvasMetaPoll();
    } catch(e) { if(isCurrent())deps.toast(deps.tr('smart.toastCanvasFail')); }
}

    const api={loadCanvas};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.SmartOpenCoordinator=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
