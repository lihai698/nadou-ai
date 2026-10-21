/* Canvas navigation and clear coordination: smart-navigation. Host supplies live state and effects. */
(function(root){
    'use strict';

async function backToCanvasList(deps){
    if(deps.returningToCanvasList) return;
    deps.returningToCanvasList = true;
    const button = deps.document.querySelector('.smart-back');
    if(button) button.disabled = true;
    try {
        deps.savePromptDraftForCurrent();
        if(!await deps.saveCanvas()){
            deps.setCanvasSaveError(true);
            deps.toast('保存失败，当前修改仍在画布中，请重试保存后再返回');
            return;
        }
        deps.window.location.href = deps.canvasListUrlForProject(deps.canvas?.project || deps.sourceProjectId || 'default');
    } finally {
        deps.returningToCanvasList = false;
        if(button) button.disabled = false;
    }
}

async function clearCurrentSmartCanvas(deps){
    if(!deps.canvasId || !deps.canvas || deps.clearCurrentCanvasBtn?.disabled) return;
    if(deps.smartCascadeAnyRunning() || deps.smartSaveSession.isSaving){
        deps.toast('当前画布正在运行或保存，请稍后再清空');
        return;
    }
    const confirmed = deps.window.confirm('确认清空当前画布？\n\n当前画布的节点、连线、日志和画布设置会被清除；能确认没有被其他位置引用的生成媒体与历史记录也会清理。此操作不能从回收站恢复。');
    if(!confirmed) return;
    deps.clearCurrentCanvasBtn.disabled = true;
    deps.invalidateMediaInputContext();
    deps.smartSaveScheduler.cancel();
    try {
        const data = await deps.CanvasSaveTransport.clearCanvas({
            id:deps.canvasId,request:deps.fetch,
            payload:{client_id:deps.smartClientId, base_updated_at:Number(deps.canvas.updated_at || 0)}
        });
        deps.activeSmartTaskPolls.clear();
        deps.activeSmartComfyTaskPolls.clear();
        deps.resetDeferredActions();
        deps.smartCascadeRuns.clear();
        deps.syncSmartCascadeLegacyState();
        if(deps.runTimerInterval){ deps.clearInterval(deps.runTimerInterval); deps.runTimerInterval = null; }
        deps.transientSmartCloudLinks = [];
        try { deps.localStorage.removeItem(`${deps.SMART_UNSAVED_ACCEPTED_TASKS_PREFIX}${deps.canvasId}`); } catch(e) {}
        deps.invalidateSmartVideoDeconstruction();
        deps.canvas = {...(data.canvas || deps.canvas), nodes:[], connections:[], logs:[], settings:{}};
        deps.nodes = [];
        deps.canvasBaseNodes = new Map();
        deps.smartSaveSession.clearQueue();
        deps.canvasDefaultSmartSettings = deps.cloneSmartSettings(deps.initialSmartSettings);
        deps.settings = deps.cloneSmartSettings(deps.initialSmartSettings);
        deps.lastComposerNodeId = '';
        deps.activeComposerSubject = null;
        deps.selectedId = '';
        deps.selectedIds = [];
        deps.selectedImage = {nodeId:'', index:-1};
        deps.history.reset();
        deps.canvas.updated_at = Number(deps.canvas.updated_at || Date.now());
        deps.canvas.settings = {};
        deps.canvas.viewport = {...deps.viewport};
        deps.rememberServerCanvasNodes(deps.canvas);
        deps.window.CanvasSaveRecovery?.clearDraft('smart',deps.canvasId);
        deps.setCanvasSaveError(false);
        deps.renderDynamicParams();
        deps.render();
        deps.toast(data.warning || (data.skipped_referenced?.length ? `画布已清空，保留 ${data.skipped_referenced.length} 个仍被引用的文件` : '当前画布已清空'));
    } catch(e) {
        deps.toast(e.message || '清空当前画布失败');
        deps.console.error(e);
    } finally {
        deps.clearCurrentCanvasBtn.disabled = false;
    }
}

    const api={backToCanvasList, clearCurrentSmartCanvas};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.SmartNavigation=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
