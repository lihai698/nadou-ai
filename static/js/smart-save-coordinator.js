/* Smart assistant execution: smart-save-coordinator. Host supplies live state and effects. */
(function(root){
    'use strict';

function scheduleSave(deps){
    if(deps.window.CanvasSaveRecovery) backupSmartDraft(deps);
    deps.history.beforeScheduleSave();
    deps.smartSaveScheduler.cancel();
    if(deps.smartSaveSession.isSaving){
        deps.smartSaveSession.queue();
        return;
    }
    deps.smartSaveScheduler.schedule(450);
}

function backupSmartDraft(deps){
    const helper = deps.window.CanvasSaveRecovery;
    if(!helper || !deps.canvasId || !deps.canvas) return;
    deps.savePromptDraftForCurrent();
    const snapshot = helper.draftSnapshot(deps.canvasForStorage(),
        deps.nodes.filter(n=>n.id !== deps.SMART_LOG_PREVIEW_NODE_ID).map(deps.serializableSmartNode),deps.canvas.connections);
    return helper.saveDraft('smart',deps.canvasId,deps.rememberServerCanvasNodes.snapshot || deps.canvas,snapshot);
}

function smartDraftConflictCopy(deps, node){
    const copy = deps.cloneSmartNode(node,340,40);
    copy.title = `${node.title || node.type || '节点'}（本地冲突副本）`;
    return copy;
}

function restoreSmartDraft(deps){
    const helper = deps.window.CanvasSaveRecovery;
    const recovered = helper?.recoverDraft('smart',deps.canvasId,deps.rememberServerCanvasNodes.snapshot,(...args)=>smartDraftConflictCopy(deps, ...args));
    const state = helper?.recoveredState(recovered,deps.viewport);
    if(!state) return false;
    deps.canvas = state.canvas;
    deps.nodes = deps.canvas.nodes.map(deps.normalizeLegacySmartNode).filter(Boolean);
    deps.canvasDefaultSmartSettings = deps.cloneSmartSettings(deps.canvas.settings || deps.canvasDefaultSmartSettings);
    deps.setCanvasSaveError.conflict = state.hasConflict;
    deps.setCanvasSaveError(true);
    const label = deps.document.querySelector('#canvasSaveError span');
    if(label) label.textContent = state.message;
    backupSmartDraft(deps);
    return true;
}

async function saveCanvas(deps){
    if(!deps.canvasId || !deps.canvas) return false;
    deps.smartSaveScheduler.cancel();
    if(deps.smartSaveSession.isSaving){
        deps.smartSaveSession.queue();
        const inFlight = deps.smartSaveSession.inFlight;
        if(!inFlight) return false;
        const waitingCanvasId = deps.canvasId;
        await inFlight;
        if(!deps.canvas || deps.canvasId !== waitingCanvasId) return false;
        return saveCanvas(deps);
    }
    const preserveRedo = deps.history.prepareStorageNormalization();
    deps.savePromptDraftForCurrent();
    deps.nodes.forEach(node => {
        node.images = (node.images || []).map(img => deps.mediaItemForStorage(deps.stripImageGenerationMeta(img)));
        if(node.runSettings) node.runSettings = deps.settingsForStorage(node.runSettings);
    });
    deps.canvas.nodes = deps.nodes;
    deps.canvas.settings = deps.settingsForStorage(deps.canvasDefaultSmartSettings || deps.initialSmartSettings);
    deps.canvas.viewport = {...deps.viewport};
    const storageCanvas = deps.canvasForStorage();
    if(deps.window.CanvasSaveRecovery) backupSmartDraft(deps);
    deps.history.finishStorageNormalization(preserveRedo);
    deps.smartSaveSession.begin();
    try {
        const result = await deps.CanvasSaveTransport.saveSmart({
            getId:()=>deps.canvasId, request:deps.fetch,
            getVersion:()=>({updated_at:storageCanvas.updated_at,meta_revision:storageCanvas.meta_revision}),
            onConflict:()=>{ deps.smartSaveSession.clearQueue(); },
            payload:{
                title:storageCanvas.title || deps.tr('smart.title'),
                icon:storageCanvas.icon || 'sparkles',
                nodes:storageCanvas.nodes || [],
                connections:storageCanvas.connections || [],
                viewport:storageCanvas.viewport || {x:0,y:0,scale:1},
                logs:storageCanvas.logs || [],
                settings:storageCanvas.settings,
                base_updated_at:storageCanvas.updated_at || deps.canvas.updated_at || 0,
                base_meta_revision:Number(storageCanvas.meta_revision || 0),
                client_id:deps.smartClientId
            }
        });
        if(result.kind === 'saved'){
            const data = result.data;
            if(data.canvas){
                if(data.canvas.updated_at) deps.canvas.updated_at = data.canvas.updated_at;
                deps.canvas.meta_revision = Number(data.canvas.meta_revision || 0);
                if(data.canvas.title) deps.canvas.title = data.canvas.title;
                if(data.canvas.icon) deps.canvas.icon = data.canvas.icon;
                deps.document.title = deps.canvas.title || deps.tr('canvas.smartCanvas');
                const titleEl = deps.document.getElementById('smartTitle');
                if(titleEl) titleEl.textContent = deps.canvas.title || deps.tr('canvas.smartCanvas');
            }
            deps.rememberServerCanvasNodes(Array.isArray(data.canvas?.nodes) ? data.canvas : storageCanvas);
            if(typeof deps.clearSmartUnsavedAcceptedTasks === 'function'){
                deps.clearSmartUnsavedAcceptedTasks((storageCanvas.nodes || []).flatMap(node =>
                    (node.pendingTasks || []).map(task => task?.taskId).filter(Boolean)));
            }
            if(deps.window.CanvasSaveRecovery){
                if(deps.smartSaveSession.queued) backupSmartDraft(deps);
                else deps.window.CanvasSaveRecovery.clearDraft('smart',deps.canvasId);
            }
            deps.setCanvasSaveError(false);
            return true;
        } else {
            deps.applyMergedServerCanvas(result.canvas);
            deps.nodes.forEach(node => {
                node.images = (node.images || []).map(img => deps.mediaItemForStorage(deps.stripImageGenerationMeta(img)));
                if(node.runSettings) node.runSettings = deps.settingsForStorage(node.runSettings);
            });
            deps.canvas.nodes = deps.nodes;
            deps.smartSaveSession.queue();
            return false;
        }
    } catch(e) {
        if(deps.window.CanvasSaveRecovery) backupSmartDraft(deps);
        deps.setCanvasSaveError(true);
        deps.console.error(e);
        return false;
    } finally {
        deps.smartSaveSession.finish();
        if(deps.smartSaveSession.queued){
            deps.smartSaveSession.clearQueue();
            deps.smartSaveScheduler.cancel();
            deps.smartSaveScheduler.schedule(300);
        }
    }
}

    const api={scheduleSave, backupSmartDraft, smartDraftConflictCopy, restoreSmartDraft, saveCanvas};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.SmartSaveCoordinator=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
