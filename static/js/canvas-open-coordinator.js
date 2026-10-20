/* Canvas open lifecycle: canvas-open-coordinator. Host supplies live state and effects. */
(function(root){
    'use strict';

async function openCanvas(deps, id){
    const generation=++deps.canvasOpenGeneration;
    const isCurrent=()=>generation===deps.canvasOpenGeneration;
    deps.openingCanvasId=id;
    let syncStopped=false;
    const needsSave=()=>deps.canvas && (deps.localCanvasDirty || deps.classicSaveSession.isSaving || deps.classicSaveScheduler.pending || deps.classicSaveSession.queued);
    const persistCurrent=async()=>{
        const saved=await deps.saveCanvas();
        if(!isCurrent()) return false;
        if(!saved || deps.localCanvasDirty || deps.classicSaveSession.queued){
            if(syncStopped && deps.canvas) deps.classicRemoteSync.start();
            deps.showErrorModal('画布尚未保存成功，请稍后重试。');
            return false;
        }
        return true;
    };
    try {
        // Keep the old editor active until its latest edits have been persisted.
        if(needsSave() && !await persistCurrent()) return;
        deps.classicRemoteSync.stop();
        syncStopped=true;
        deps.window.CanvasClipBridge?.begin?.();
        deps.window.CanvasVideoDeconstructionBridge?.begin?.();
        deps.window.CanvasVideoDeconstructionUI?.closeAll?.(true);
        deps.setStatus('Opening...');
        const canvasBeforeFetch=deps.canvas;
        const res = await deps.fetch(`/api/canvases/${id}`);
        if(!isCurrent()) return;
        if(!res.ok) throw new Error(deps.tr('canvas.openFailed'));
        const data = await res.json();
        if(!isCurrent()) return;
        const openedCanvas = data.canvas;
        const touched = await deps.touchCanvasOpened(openedCanvas.id,isCurrent);
        if(!isCurrent()) return;
        // A completed autosave replaces canvas even after its dirty flag is cleared.
        if(deps.canvas?.id===id && deps.canvas!==canvasBeforeFetch) return openCanvas(deps, id);
        // The user can keep editing the old canvas while the next GET is pending.
        if(needsSave()){
            if(!await persistCurrent()) return;
            // Reopening the same ID must not apply a snapshot fetched before that save.
            if(deps.canvas?.id===id) return openCanvas(deps, id);
        }
        deps.resetCascadeRuntimeState();
        deps.canvas = openedCanvas;
        deps.rememberCanvasListProject(deps.canvas.project || 'default');
        if(touched?.updated_at) deps.canvas.updated_at = Number(touched.updated_at);
        if((deps.canvas.kind || 'classic') === 'smart'){
            deps.openSmartCanvasPage(deps.canvas.id);
            return;
        }
        deps.canvas.logs = deps.canvas.logs || [];
        deps.nodes = (deps.canvas.nodes || []).map(n=>deps.window.CanvasAudio.migrate(n));
        deps.connections = deps.canvas.connections || [];
        deps.viewport = deps.localViewportForCanvas(deps.canvas.id, deps.canvas.viewport || {x:0, y:0, scale:1});
        deps.canvas.viewport = {...deps.viewport};
        deps.lastCanvasUpdatedAt = Number(deps.canvas.updated_at || 0);
        deps.localCanvasDirty = false;
        deps.resetTransientRunState(deps.nodes);
        deps.sanitizeConnections();
        deps.rememberClassicSaveBase(deps.canvas);
        const draftRecoveryReady = await deps.window.CanvasSaveRecovery?.prepareRecovery?.('classic',deps.canvas.id,deps.classicSaveBase,deps.classicConflictCopy);
        if(!isCurrent()) return;
        const draftRecovered = deps.restoreClassicDraft();
        if(draftRecoveryReady === false && !draftRecovered) deps.setClassicSaveWarning('暂时无法读取本机草稿，已显示最近保存的画布。请检查浏览器存储后重新打开。');
        const recoveredUnsavedTasks = deps.restoreUnsavedCanvasAcceptedTasks();
        const recoveredUnknownSubmissions = deps.restoreUnsavedCanvasUnknownWarnings();
        deps.pruneMissingComfyWorkflows();
        await deps.refreshMissingCanvasAssets();
        if(!isCurrent()) return;
        deps.selected.clear();
        deps.setCanvasMode(true);

        deps.render();
        deps.resumeCanvasImageTasks();
        deps.resumeCanvasAudioTasks();
        if(recoveredUnsavedTasks) deps.showErrorModal(`已恢复 ${recoveredUnsavedTasks} 个尚未保存的任务编号。请在结果卡片点击“保存并查询”，不要重新提交。`, deps.tr('canvas.apiFailed'));
        else if(recoveredUnknownSubmissions) deps.showErrorModal(`已恢复 ${recoveredUnknownSubmissions} 条受理状态未知的提示。再次提交前请核对原任务，避免重复计费。`, deps.tr('canvas.apiFailed'));
        deps.startCanvasRemotePolling();
        deps.setStatus('Ready');
    } catch(e) {
        if(!isCurrent()) return;
        deps.setStatus(deps.tr('canvas.openFailed'));
        deps.console.error(e);
        // 打开失败（id 无效/已删除）：回到选画布页面，避免停在空白编辑器。
        deps.window.location.replace(deps.canvasListUrlForProject(deps.canvas?.project || deps.requestedCanvasListProject() || deps.rememberedCanvasListProject()));
    } finally {
        if(isCurrent()) deps.openingCanvasId='';
    }
}

    const api={openCanvas};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.CanvasOpenCoordinator=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
