/* Node editing responsibility: smart-connection-edit. Host supplies live state and effects. */
(function(root){
    'use strict';

    function addConnection(deps, fromId, toId, kind='flow'){
        if(!fromId || !toId || fromId === toId) return;
        deps.canvas.connections = deps.canvas.connections || [];
        if(deps.canvas.connections.some(c => c.from === fromId && c.to === toId && (c.kind || 'flow') === kind)) return;
        deps.canvas.connections.push({from:fromId, to:toId, kind});
    }

    function connectInputNode(deps, fromId, toId){
        const from = deps.nodes.find(n => n.id === fromId);
        const to = deps.nodes.find(n => n.id === toId);
        if(!from || !to || from.id === to.id) return false;
        if(from.type === 'smart-shot-table' || to.type === 'smart-shot-table'){
            const seen=new Set(), pending=[toId];
            while(pending.length){
                const id=pending.pop();
                if(id===fromId) return false;
                if(seen.has(id)) continue;
                seen.add(id);
                for(const edge of deps.canvas.connections || []){
                    if(edge.from===id && ['input','flow'].includes(edge.kind || 'flow')) pending.push(edge.to);
                }
            }
        }
        if(to.type === 'smart-loop'){
            const groupImages = deps.isSmartGroupNode(from) ? deps.imagesForNode(from).filter(img => img?.url) : [];
            const groupPrompts = deps.isSmartGroupNode(from) ? deps.promptTextItemsForNode(from).filter(Boolean) : [];
            const looksImage = deps.isSmartImageNode(from) || groupImages.length > 0 || (from.type === 'smart-loop' && from.imageInput);
            const looksPrompt = from.type === 'smart-prompt' || groupPrompts.length > 0 || (from.type === 'smart-loop' && from.showPrompt);
            if(looksImage && !to.imageInput) to.imageInput = true;
            if(looksPrompt && !to.showPrompt) to.showPrompt = true;
            if(looksImage || looksPrompt) deps.fitSmartLoopNode(to);
            const canImage = Boolean(to.imageInput) && looksImage;
            const canPrompt = Boolean(to.showPrompt) && looksPrompt;
            if(!canImage && !canPrompt) return false;
        }
        to.inputNodeIds = Array.from(new Set([...(to.inputNodeIds || []), from.id]));
        addConnection(deps, from.id, to.id, 'input');
        return true;
    }

    function disconnectConnection(deps, index){
        disconnectConnections(deps, [index]);
    }

    function disconnectConnections(deps, spec){
        if(!deps.canvas || !Array.isArray(deps.canvas.connections)) return;
        const indices = (Array.isArray(spec) ? spec : String(spec).split(','))
            .map(v => Number(v))
            .filter(n => Number.isInteger(n) && n >= 0 && n < deps.canvas.connections.length);
        if(!indices.length) return;
        const set = new Set(indices);
        const removed = deps.canvas.connections.filter((_, i) => set.has(i));
        if(!removed.length) return;
        deps.pushUndo();
        deps.canvas.connections = deps.canvas.connections.filter((_, i) => !set.has(i));
        removed.forEach(conn => {
            const toNode = deps.nodes.find(n => n.id === conn.to);
            if(toNode && Array.isArray(toNode.inputNodeIds)){
                toNode.inputNodeIds = toNode.inputNodeIds.filter(id => id !== conn.from);
            }
            const stillConnected = (deps.canvas.connections || []).some(item => item.from === conn.from && item.to === conn.to && ['input','flow'].includes(item.kind || 'flow'));
    
            if(toNode && ['input','flow'].includes(conn.kind || 'flow')) deps.clearDetachedRunInputRefs(toNode);
            if((conn.kind || 'flow') === 'history'){
                const group = deps.nodes.find(n => n.id === conn.to && deps.isHistoryGroupNode(n) && n.historyFor === conn.from);
                deps.demoteHistoryGroupNode(group);
            }
        });
        deps.render();
        deps.scheduleSave();
    }

    const api={addConnection, connectInputNode, disconnectConnection, disconnectConnections};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.SmartConnectionEdit=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
