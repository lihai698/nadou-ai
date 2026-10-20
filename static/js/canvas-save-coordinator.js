/* Smart assistant execution: canvas-save-coordinator. Host supplies live state and effects. */
(function(root){
    'use strict';

function scheduleSave(deps){
    if(!deps.canvas || deps.applyingRemoteCanvas) return;
    deps.localCanvasDirty = true;
    backupClassicDraft(deps);
    deps.setStatus('Saving...');
    deps.classicSaveScheduler.cancel();
    if(deps.classicSaveSession.isSaving){
        deps.classicSaveSession.queue();
        return;
    }
    deps.classicSaveScheduler.schedule(500);
}

function serializableCanvasNode(deps, node){
    const copy = {...(node || {})};
    delete copy.running;
    delete copy.runStatus;
    delete copy.runError;
    delete copy._cascadeIdx;
    delete copy._cascadeFailed;
    delete copy._activeLoopCtx;
    return copy;
}

function serializableCanvasNodes(deps, list=deps.nodes){
    return (list || []).map((...args)=>serializableCanvasNode(deps, ...args));
}

function classicDraftSnapshot(deps){
    return deps.window.CanvasSaveRecovery.draftSnapshot(deps.canvas,serializableCanvasNodes(deps),deps.connections);
}

function classicConflictCopy(deps, node){
    const copy = deps.cloneNode(node, 340, 40);
    copy.title = `${node.title || node.type || '节点'}（本地冲突副本）`;
    delete copy._pending;
    delete copy._directPending;
    return copy;
}

function rememberClassicSaveBase(deps, remote){
    deps.classicSaveBase = JSON.parse(JSON.stringify(remote));
}

function backupClassicDraft(deps){
    if(typeof deps.window === 'undefined' || !deps.window.CanvasSaveRecovery || !deps.canvas) return;
    return deps.window.CanvasSaveRecovery.saveDraft('classic',deps.canvas.id,deps.classicSaveBase || deps.canvas,classicDraftSnapshot(deps));
}

function mergeRemoteCanvasEdits(deps, remote){
    if(!deps.canvas || remote?.id !== deps.canvas.id || !deps.window.CanvasSaveRecovery) return false;
    deps.mergeCanvasAssistantChanges(remote);
    const merged = deps.window.CanvasSaveRecovery.mergeDocument(deps.classicSaveBase,classicDraftSnapshot(deps),remote,(...args)=>classicConflictCopy(deps, ...args));
    const localViewport = {...deps.viewport};
    deps.canvas = merged.canvas;
    deps.nodes = deps.canvas.nodes;
    deps.connections = deps.canvas.connections;
    deps.viewport = localViewport;
    deps.canvas.viewport = localViewport;
    rememberClassicSaveBase(deps, remote);
    deps.lastCanvasUpdatedAt = Number(remote.updated_at || 0);
    deps.localCanvasDirty = true;
    deps.sanitizeConnections();
    backupClassicDraft(deps);
    deps.render();
    if(deps.currentCanvasTitle) deps.currentCanvasTitle.textContent = deps.canvas.title || deps.tr('canvas.untitled');
    if(merged.conflicts){
        deps.setClassicSaveWarning.conflict = true;
        deps.setClassicSaveWarning('检测到同时修改同一节点，已保留本地冲突副本。请检查后重试保存。');
    }
    return true;
}

function restoreClassicDraft(deps){
    const helper = deps.window.CanvasSaveRecovery;
    const recovered = helper?.recoverDraft('classic',deps.canvas.id,deps.classicSaveBase,(...args)=>classicConflictCopy(deps, ...args));
    const state = helper?.recoveredState(recovered,deps.viewport);
    if(!state) return false;
    deps.canvas = state.canvas;
    deps.nodes = deps.canvas.nodes;
    deps.connections = deps.canvas.connections;
    deps.localCanvasDirty = true;
    backupClassicDraft(deps);
    deps.setClassicSaveWarning.conflict = state.hasConflict;
    deps.setClassicSaveWarning(state.message);
    return true;
}

async function saveCanvas(deps){
    if(!deps.canvas || deps.applyingRemoteCanvas) return false;
    if(deps.classicSaveSession.isSaving){
        deps.classicSaveSession.queue();
        const inFlight = deps.classicSaveSession.inFlight;
        if(!inFlight) return false;
        const waitingCanvasId = deps.canvas.id;
        await inFlight;
        if(!deps.canvas || deps.canvas.id !== waitingCanvasId || deps.applyingRemoteCanvas) return false;
        // The earlier snapshot may not include this caller's accepted task ID.
        return saveCanvas(deps);
    }
    deps.classicSaveScheduler.cancel();
    deps.sanitizeConnections();
    const savingCanvasId = deps.canvas.id;
    const sentNodes = serializableCanvasNodes(deps);
    backupClassicDraft(deps);
    deps.classicSaveSession.begin();
    try {
        const result = await deps.CanvasSaveTransport.saveClassic({
            id:deps.canvas.id, request:deps.fetch,
            getVersion:()=>({updated_at:deps.lastCanvasUpdatedAt,meta_revision:deps.canvas.meta_revision}),
            payload:{
                title:deps.canvas.title,
                icon:deps.canvas.icon || '🧩',
                nodes:sentNodes,
                connections: deps.connections,
                viewport: deps.viewport,
                logs:deps.canvas.logs || [],
                client_id:deps.CLIENT_ID,
                base_updated_at:Number(deps.lastCanvasUpdatedAt || deps.canvas.updated_at || 0),
                base_meta_revision:Number(deps.canvas.meta_revision || 0)
            }
        });
        if(result.kind === 'conflict'){
            if(!mergeRemoteCanvasEdits(deps, result.canvas)) throw new Error('画布合并不可用，已保留本地草稿。');
            deps.classicSaveSession.queue();
            return false;
        }
        const data = result;
        const localViewport = {...deps.viewport};
        if(data.canvas) deps.canvas = {...deps.canvas, ...data.canvas, viewport:localViewport};
        deps.viewport = localViewport;
        deps.canvas.updated_at = Number(deps.canvas.updated_at || Date.now());
        deps.lastCanvasUpdatedAt = deps.canvas.updated_at;
        if(deps.currentCanvasTitle) deps.currentCanvasTitle.textContent = deps.canvas.title || deps.tr('canvas.untitled');
        deps.localCanvasDirty = Boolean(deps.classicSaveSession.queued);
        rememberClassicSaveBase(deps, data.canvas);
        if(deps.localCanvasDirty) backupClassicDraft(deps);
        else if(typeof deps.window !== 'undefined') deps.window.CanvasSaveRecovery?.clearDraft('classic',savingCanvasId);
        if(typeof deps.window !== 'undefined' && deps.window.CanvasSaveRecovery && !deps.setClassicSaveWarning.conflict) deps.setClassicSaveWarning('');
        if(deps.currentCanvasTime) deps.currentCanvasTime.textContent = deps.formatCanvasTime(deps.canvas.updated_at);
        deps.setStatus('Saved');
        deps.clearUnsavedCanvasAcceptedTasks(savingCanvasId, data.canvas.nodes);
        deps.clearUnsavedCanvasUnknownWarnings(savingCanvasId, data.canvas.nodes);
        if(deps.gateCanvasList) deps.loadCanvasList(false);
        return true;
    } catch(e) {
        deps.localCanvasDirty = true;
        backupClassicDraft(deps);
        if(typeof deps.window !== 'undefined' && deps.window.CanvasSaveRecovery) deps.setClassicSaveWarning('保存失败，当前修改尚未保存。请检查连接后重试。');
        deps.setStatus('Save failed');
        deps.console.error(e);
        return false;
    } finally {
        deps.classicSaveSession.finish();
        if(deps.classicSaveSession.queued && deps.canvas && !deps.applyingRemoteCanvas){
            deps.classicSaveSession.clearQueue();
            deps.localCanvasDirty = true;
            deps.classicSaveScheduler.schedule(0);
        }
    }
}

    const api={scheduleSave, serializableCanvasNode, serializableCanvasNodes, classicDraftSnapshot, classicConflictCopy, rememberClassicSaveBase, backupClassicDraft, mergeRemoteCanvasEdits, restoreClassicDraft, saveCanvas};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.CanvasSaveCoordinator=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
