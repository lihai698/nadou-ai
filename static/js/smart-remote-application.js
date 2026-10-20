/* Canvas remote state application: smart-remote-application. Host supplies live state and effects. */
(function(root){
    'use strict';

function applyMergedServerCanvas(deps, serverCanvas){
    if(!serverCanvas || !deps.canvas) return false;
    deps.invalidateSmartVideoDeconstruction();
    const remoteNodes = (Array.isArray(serverCanvas.nodes) ? serverCanvas.nodes : []).map(deps.normalizeLegacySmartNode).filter(Boolean);
    const conflictCopies = [];
    const mergedNodes = deps.mergeSmartNodeLists(deps.nodes, remoteNodes, deps.canvasBaseNodes, conflictCopies);
    const nodeIds = new Set(mergedNodes.map(n => n.id));
    deps.nodes = mergedNodes;
    const localConnections = deps.canvas.connections || [];
    deps.canvas.connections = deps.mergeSmartConnections(localConnections, serverCanvas.connections, nodeIds);
    const copyIds = new Map(conflictCopies.map(n=>[n._conflictSourceId,n.id]));
    localConnections.forEach(edge=>{
        if(!copyIds.has(edge.from) && !copyIds.has(edge.to)) return;
        const copy = {...edge,from:copyIds.get(edge.from)||edge.from,to:copyIds.get(edge.to)||edge.to};
        if(copy.id) copy.id = `${copy.id}-${copyIds.get(edge.from)||copyIds.get(edge.to)}`;
        if(nodeIds.has(copy.from)&&nodeIds.has(copy.to)) deps.canvas.connections.push(copy);
    });
    deps.nodes.filter(deps.isSmartGroupNode).forEach(group=>{
        if(Array.isArray(group.items)) group.items=group.items.filter(id=>nodeIds.has(id));
    });
    const cleanedState = deps.clearCompletedNodeBusyStates();
    const recoveredLoopOutputs = deps.recoverStuckLoopOutputsFromLogs();
    deps.canvas.updated_at = Number(serverCanvas.updated_at || deps.canvas.updated_at || 0);
    deps.canvas.meta_revision = Number(serverCanvas.meta_revision || 0);
    deps.canvas.icon = serverCanvas.icon || 'layers';
    deps.rememberServerCanvasNodes(serverCanvas);
    if(deps.canvas.title !== serverCanvas.title && serverCanvas.title){
        deps.canvas.title = serverCanvas.title;
        deps.document.title = deps.canvas.title;
        const titleEl = deps.document.getElementById('smartTitle');
        if(titleEl) titleEl.textContent = deps.canvas.title;
    }
    deps.render();
    if(deps.window.CanvasSaveRecovery) deps.backupSmartDraft();
    if(conflictCopies.length){
        deps.setCanvasSaveError.conflict = true;
        deps.setCanvasSaveError(true);
        const label = deps.document.querySelector('#canvasSaveError span');
        if(label) label.textContent = '检测到同时修改同一节点，已保留本地冲突副本。请检查后重试保存。';
        deps.toast('检测到同一节点同时修改，已保留本地冲突副本。');
    }
    if(typeof deps.scheduleConnectionLayerRefresh === 'function') deps.scheduleConnectionLayerRefresh();
    if(cleanedState || recoveredLoopOutputs || conflictCopies.length) deps.scheduleSave();
    deps.resumeSmartPendingTasks();
    deps.resumeSmartAudioTasks();
    deps.resumeJimengPendingNodes();
    return true;
}

    const api={applyMergedServerCanvas};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.SmartRemoteApplication=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
