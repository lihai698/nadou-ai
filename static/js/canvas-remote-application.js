/* Canvas remote state application: canvas-remote-application. Host supplies live state and effects. */
(function(root){
    'use strict';

function applyRemoteCanvasData(deps, remote){
    if(!remote || !deps.canvas || remote.id !== deps.canvas.id) return;
    if(deps.localCanvasDirty || deps.classicSaveScheduler.pending || deps.classicSaveSession.isSaving || deps.classicSaveSession.queued){
        deps.classicRemoteSync.schedule(1000);
        return;
    }
    deps.applyingRemoteCanvas = true;
    try {
        deps.resetCascadeRuntimeState();
        const localViewport = deps.localViewportForCanvas(deps.canvas.id, deps.viewport || remote.viewport || {x:0, y:0, scale:1});
        const localSelectedIds = new Set(deps.selected);
        deps.canvas = remote;
        deps.rememberClassicSaveBase(remote);
        deps.canvas.logs = deps.canvas.logs || [];
        deps.nodes = (deps.canvas.nodes || []).map(n=>deps.window.CanvasAudio.migrate(n));
        deps.connections = deps.canvas.connections || [];
        deps.viewport = localViewport;
        deps.canvas.viewport = {...deps.viewport};
        deps.lastCanvasUpdatedAt = Number(deps.canvas.updated_at || Date.now());
        deps.localCanvasDirty = false;
        resetTransientRunState(deps, deps.nodes);
        deps.sanitizeConnections();
        deps.pruneMissingComfyWorkflows();
        deps.refreshMissingCanvasAssets().then(() => deps.render());
        deps.selected = new Set([...localSelectedIds].filter(id => deps.nodes.some(node => node.id === id)));

        deps.render();
        deps.resumeCanvasImageTasks();
        deps.resumeCanvasAudioTasks();
        if(deps.currentCanvasTitle) deps.currentCanvasTitle.textContent = deps.canvas.title || deps.tr('canvas.untitled');
        if(deps.currentCanvasTime) deps.currentCanvasTime.textContent = deps.formatCanvasTime(deps.canvas.updated_at || deps.canvas.created_at);
        deps.setStatus('Synced');
    } finally {
        deps.applyingRemoteCanvas = false;
    }
}

function resetTransientRunState(deps, list=deps.nodes){
    list.forEach(n=>deps.window.CanvasAudio.migrate(n));
    (list || []).forEach(node => {
        if(!node) return;
        if(node.running) node.running = false;
        if(node.runStatus) node.runStatus = '';
        if(node.runError) node.runError = '';
        if(node._cascadeIdx) node._cascadeIdx = '';
        if(node._cascadeFailed) node._cascadeFailed = false;
    });
}

    const api={applyRemoteCanvasData, resetTransientRunState};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.CanvasRemoteApplication=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
