/* Canvas navigation and clear coordination: canvas-navigation. Host supplies live state and effects. */
(function(root){
    'use strict';

async function returnToCanvasManager(deps){
    if(deps.backToManagerBtn?.disabled) return;
    if(deps.backToManagerBtn) deps.backToManagerBtn.disabled = true;
    try {
        if(deps.canvas && (deps.localCanvasDirty || deps.classicSaveSession.isSaving || deps.classicSaveScheduler.pending)){
            const saved = await deps.saveCanvas();
            if(!saved || deps.localCanvasDirty || deps.classicSaveSession.queued){
                deps.showErrorModal('画布尚未保存成功，请稍后重试。');
                return;
            }
        }
        deps.window.location.href = deps.canvasListUrlForProject(deps.canvas?.project || deps.requestedCanvasListProject() || deps.rememberedCanvasListProject());
    } finally {
        if(deps.backToManagerBtn) deps.backToManagerBtn.disabled = false;
    }
}

async function clearCurrentCanvas(deps){
    if(!deps.canvas || deps.clearCurrentCanvasBtn?.disabled) return;
    if(deps.classicSaveSession.isSaving){ deps.setStatus('正在保存，请稍后再清空'); return; }
    const confirmed = deps.window.confirm('确认清空当前画布？\n\n当前画布的节点、连线、日志和画布设置会被清除；能确认没有被其他位置引用的生成媒体与历史记录也会清理。此操作不能从回收站恢复。');
    if(!confirmed) return;
    deps.clearCurrentCanvasBtn.disabled = true;
    deps.classicSaveScheduler.cancel();
    const clearingCanvasId=deps.canvas.id;
    try {
        const data = await deps.CanvasSaveTransport.clearCanvas({
            id:clearingCanvasId,request:deps.fetch,
            payload:{client_id:deps.CLIENT_ID, base_updated_at:Number(deps.lastCanvasUpdatedAt || deps.canvas.updated_at || 0)}
        });
        if(deps.canvas?.id!==clearingCanvasId) return;
        deps.resetCascadeRuntimeState();
        if(deps.outputTimer){ deps.clearInterval(deps.outputTimer); deps.outputTimer = null; }
        try {
            deps.localStorage.removeItem(deps.unsavedCanvasAcceptedTasksKey(deps.canvas.id));
            deps.localStorage.removeItem(deps.unknownCanvasSubmissionKey(deps.canvas.id));
        } catch(e) {}
        deps.canvas = {...(data.canvas || deps.canvas), nodes:[], connections:[], logs:[], settings:{}};
        deps.nodes = [];
        deps.connections = [];
        deps.selected.clear();
        deps.localCanvasDirty = false;
        deps.classicSaveSession.clearQueue();
        deps.lastCanvasUpdatedAt = Number(deps.canvas.updated_at || Date.now());
        deps.viewport = deps.localViewportForCanvas(deps.canvas.id, deps.canvas.viewport || deps.viewport);
        deps.canvas.viewport = {...deps.viewport};
        deps.rememberClassicSaveBase(deps.canvas);
        deps.window.CanvasSaveRecovery?.clearDraft('classic',clearingCanvasId);
        deps.setClassicSaveWarning.conflict=false;
        deps.setClassicSaveWarning('');
        deps.render();
        deps.currentCanvasTime.textContent = deps.formatCanvasTime(deps.canvas.updated_at);
        deps.setStatus(data.skipped_referenced?.length ? `画布已清空，保留 ${data.skipped_referenced.length} 个仍被引用的文件` : '当前画布已清空');
        if(data.warning) deps.showErrorModal(data.warning,'清空结果提示');
        await deps.loadCanvasList(false);
    } catch(e) {
        if(deps.canvas?.id!==clearingCanvasId) return;
        if(e.status===409 && e.canvas) deps.applyRemoteCanvasData(e.canvas);
        deps.setStatus(e.message || '清空当前画布失败');
        deps.console.error(e);
    } finally {
        deps.clearCurrentCanvasBtn.disabled = false;
    }
}

    const api={returnToCanvasManager, clearCurrentCanvas};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.CanvasNavigation=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
