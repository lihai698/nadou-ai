/* Layout and interaction responsibility: smart-selection. Host supplies live state and effects. */
(function(root){
    'use strict';

    function selectedNode(deps){ return deps.nodes.find(n => n.id === deps.selectedId) || null; }

    function clearSelection(deps){
        deps.savePromptDraftForCurrent();
        deps.selectedId = '';
        deps.selectedIds = [];
        deps.selectedImage = {nodeId:'', index:-1};
        syncSelectionGroup(deps);
    }

    function syncSelectionUi(deps){
        const ids = selectedNodeIds(deps);
        const nextIds = new Set(ids);
        const touchedIds = new Set([...deps.smartSelectionUiNodeIds, ...nextIds]);
        if(deps.smartSelectionUiImage.nodeId) touchedIds.add(deps.smartSelectionUiImage.nodeId);
        if(deps.selectedImage.nodeId) touchedIds.add(deps.selectedImage.nodeId);
        deps.world.classList.toggle('smart-multi-selected', ids.length > 1);
        deps.smartArrangeBtn?.classList.toggle('visible', ids.length > 0);
        deps.smartNodeElementsByIds(touchedIds).forEach(el => {
            const id = el.dataset.id || '';
            el.classList.toggle('selected', isNodeSelected(deps, id));
            el.querySelectorAll('.thumb-item,.image-wrap').forEach(item => {
                const targetNodeId = item.dataset.refNodeId || id;
                const index = Number(item.dataset.refImageIndex ?? item.dataset.imageIndex ?? 0);
                item.classList.toggle('image-selected', deps.selectedImage.nodeId === targetNodeId && deps.selectedImage.index === index);
            });
        });
        deps.smartSelectionUiNodeIds = nextIds;
        deps.smartSelectionUiImage = {nodeId:deps.selectedImage.nodeId || '', index:Number(deps.selectedImage.index ?? -1)};
        deps.syncSmartSelectedImageResolution(deps.world);
        deps.syncRunButtonState();
        deps.scheduleConnectionLayerRefresh();
        syncSelectionGroup(deps);
    }

    function syncSelectionGroup(deps){
        deps.renderWorkgroups?.();
    }

    function isNodeSelected(deps, id){
        return deps.selectedId === id || deps.selectedIds.includes(id);
    }

    function selectedNodeIds(deps){
        return deps.selectedIds.length ? deps.selectedIds.slice() : (deps.selectedId ? [deps.selectedId] : []);
    }

    function updateSelectionBox(deps, event){
        if(!deps.selectionState) return;
        const sx = deps.selectionState.startScreen.x, sy = deps.selectionState.startScreen.y;
        const x = Math.min(sx, event.clientX), y = Math.min(sy, event.clientY);
        deps.selectionBox.style.display = 'block';
        deps.selectionBox.style.left = `${x}px`;
        deps.selectionBox.style.top = `${y}px`;
        deps.selectionBox.style.width = `${Math.abs(event.clientX - sx)}px`;
        deps.selectionBox.style.height = `${Math.abs(event.clientY - sy)}px`;
    }

    function finishSelection(deps, event){
        if(!deps.selectionState) return;
        const a = deps.selectionState.startWorld;
        const b = deps.screenToWorld(event);
        const minX = Math.min(a.x, b.x), minY = Math.min(a.y, b.y);
        const maxX = Math.max(a.x, b.x), maxY = Math.max(a.y, b.y);
        deps.selectedIds = deps.nodes.filter(node => {
            const r = deps.nodeRect(node);
            return r.x < maxX && r.x + r.width > minX && r.y < maxY && r.y + r.height > minY;
        }).map(n => n.id);
        deps.selectedId = deps.selectedIds.length === 1 ? deps.selectedIds[0] : '';
        deps.selectedImage = {nodeId:'', index:-1};
        deps.selectionState = null;
        deps.selectionJustFinished = true;
        deps.selectionBox.style.display = 'none';
        deps.render();
        deps.setTimeout(() => { deps.selectionJustFinished = false; }, 0);
    }

    const api={selectedNode, clearSelection, syncSelectionUi, syncSelectionGroup, isNodeSelected, selectedNodeIds, updateSelectionBox, finishSelection};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.SmartSelection=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
