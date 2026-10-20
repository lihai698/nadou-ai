/* Layout and interaction responsibility: canvas-interaction. Host supplies live state and effects. */
(function(root){
    'use strict';

    function startSelection(deps, e){
        e.preventDefault();
        e.stopPropagation();
        if(deps.document.activeElement && deps.document.activeElement !== deps.document.body) deps.document.activeElement.blur();
        deps.selectDrag = {sx:e.clientX, sy:e.clientY, x:e.clientX, y:e.clientY, autoGroup:Boolean(e.ctrlKey || e.metaKey)};
        deps.document.body.classList.add('canvas-selecting');
        deps.selectionBox.style.display = 'block';
        updateSelectionBox(deps, e.clientX, e.clientY);
        deps.setCanvasMouseMove(e2 => updateSelectionBox(deps, e2.clientX, e2.clientY));
        deps.setCanvasMouseUp((...args)=>finishSelection(deps, ...args));
    }

    function updateSelectionBox(deps, x, y){
        if(!deps.selectDrag) return;
        deps.selectDrag.x = x; deps.selectDrag.y = y;
        const left = Math.min(deps.selectDrag.sx, x);
        const top = Math.min(deps.selectDrag.sy, y);
        deps.selectionBox.style.left = `${left}px`;
        deps.selectionBox.style.top = `${top}px`;
        deps.selectionBox.style.width = `${Math.abs(x - deps.selectDrag.sx)}px`;
        deps.selectionBox.style.height = `${Math.abs(y - deps.selectDrag.sy)}px`;
    }

    function finishSelection(deps){
        if(!deps.selectDrag) return;
        const autoGroup = deps.selectDrag.autoGroup;
        const rect = deps.selectionBox.getBoundingClientRect();
        deps.selectionBox.style.display = 'none';
        deps.selected.clear();
        deps.nodesEl.querySelectorAll('.node').forEach(el => {
            const r = el.getBoundingClientRect();
            const overlaps = r.left < rect.right && r.right > rect.left && r.top < rect.bottom && r.bottom > rect.top;
            if(overlaps) deps.selected.add(el.dataset.id);
        });
        deps.selectDrag = null;
        deps.document.body.classList.remove('canvas-selecting');
        deps.setCanvasMouseMove(null);
        deps.setCanvasMouseUp(null);
        if(autoGroup && deps.selected.size > 1) deps.groupSelectedImages();
        else deps.render();
        if(deps.workflowTransferModal?.classList.contains('open')) deps.updateWorkflowTransferMeta();
    }

    function startNodeDrag(deps, e, node){
        if(e.button !== 0) return;
        if(deps.startKnifeDrag(e)) return;
        e.preventDefault();
        e.stopPropagation();
        let dragTarget = node;
        if(e.altKey){
            deps.setKnifeMode(false);
            deps.pushUndo();
            const {dragCopy, selectedCopyIds} = deps.duplicateNodesForAltDrag(node, e.shiftKey);
            deps.selected.clear();
            selectedCopyIds.forEach(id => deps.selected.add(id));
            dragTarget = dragCopy;
            if(e.shiftKey){
                deps.sanitizeConnections();
                deps.syncGeneratorInputs();
            }
            deps.render();
        }
        const isGroup = dragTarget.type === 'group' || dragTarget.type === 'promptGroup';
        const collected = new Map();
        const collect = n => {
            if(!n || collected.has(n.id) || n.id === dragTarget.id) return;
            collected.set(n.id, {node:n, ox:n.x, oy:n.y});
            if(n.type === 'group' || n.type === 'promptGroup'){
                (n.items || []).map(id => deps.nodes.find(x => x.id === id)).forEach(collect);
            }
        };
        if(isGroup){
            (dragTarget.items || []).map(id => deps.nodes.find(n => n.id === id)).forEach(collect);
        }
        // 如果被拖节点在多选里，所有其他选中节点（含其组成员）一起移动
        if(deps.selected.has(dragTarget.id) && deps.selected.size > 1){
            [...deps.selected].forEach(id => collect(deps.nodes.find(n => n.id === id)));
        }
        const children = [...collected.values()];
        deps.dragNode = {node: dragTarget, children, sx:e.clientX, sy:e.clientY, ox:dragTarget.x, oy:dragTarget.y};
        deps.document.body.classList.add('canvas-node-drag');
        deps.setCanvasMouseMove((...args)=>onNodeDrag(deps, ...args));
        deps.setCanvasMouseUp((...args)=>endDrag(deps, ...args));
    }

    function onNodeDrag(deps, e){
        if(!deps.dragNode) return;
        const dx = (e.clientX - deps.dragNode.sx) / deps.viewport.scale;
        const dy = (e.clientY - deps.dragNode.sy) / deps.viewport.scale;
        deps.dragNode.node.x = deps.dragNode.ox + dx;
        deps.dragNode.node.y = deps.dragNode.oy + dy;
        const el = deps.nodesEl.querySelector(`.node[data-id="${deps.dragNode.node.id}"]`);
        if(el){
            el.style.left = `${deps.dragNode.node.x}px`;
            el.style.top = `${deps.dragNode.node.y}px`;
        }
        (deps.dragNode.children || []).forEach(childDrag => {
            childDrag.node.x = childDrag.ox + dx;
            childDrag.node.y = childDrag.oy + dy;
            const childEl = deps.nodesEl.querySelector(`.node[data-id="${childDrag.node.id}"]`);
            if(childEl){
                childEl.style.left = `${childDrag.node.x}px`;
                childEl.style.top = `${childDrag.node.y}px`;
            }
        });
        deps.scheduleLinksRender();
        deps.renderSelectionHub();
        if(deps.workflowTransferModal?.classList.contains('open')) deps.updateWorkflowTransferMeta();
        deps.scheduleMinimapRender();
    }

    function startNodeResize(deps, e, node){
        e.preventDefault();
        e.stopPropagation();
        const el = deps.nodesEl.querySelector(`.node[data-id="${node.id}"]`);
        const rect = el?.getBoundingClientRect();
        deps.resizeNode = {
            node,
            sx:e.clientX,
            sy:e.clientY,
            sw:(rect?.width ? rect.width / deps.viewport.scale : node.w || deps.defaultNodeSize(node.type).w),
            sh:(rect?.height ? rect.height / deps.viewport.scale : node.h || deps.defaultNodeSize(node.type).h || 160)
        };
        deps.document.body.classList.add('canvas-node-resize');
        deps.setCanvasMouseMove((...args)=>onNodeResize(deps, ...args));
        deps.setCanvasMouseUp((...args)=>endDrag(deps, ...args));
    }

    function onNodeResize(deps, e){
        if(!deps.resizeNode) return;
        const min = deps.defaultNodeSize(deps.resizeNode.node.type);
        const isClip = deps.resizeNode.node.type==='clip';
        const nextW = isClip ? Math.max(560,Math.min(960,deps.resizeNode.sw+(e.clientX-deps.resizeNode.sx)/deps.viewport.scale)) : Math.max(Math.min(min.w, 220), deps.resizeNode.sw + (e.clientX - deps.resizeNode.sx) / deps.viewport.scale);
        const nextH = isClip ? Math.max(188,Math.min(260,deps.resizeNode.sh+(e.clientY-deps.resizeNode.sy)/deps.viewport.scale)) : Math.max(96, deps.resizeNode.sh + (e.clientY - deps.resizeNode.sy) / deps.viewport.scale);
        deps.resizeNode.node.w = Math.round(nextW);
        deps.resizeNode.node.h = Math.round(nextH);
        const el = deps.nodesEl.querySelector(`.node[data-id="${deps.resizeNode.node.id}"]`);
        if(el){
            el.classList.add('sized');
            el.style.width = `${deps.resizeNode.node.w}px`;
            el.style.height = `${deps.resizeNode.node.h}px`;
        }
        deps.scheduleLinksRender();
        deps.renderSelectionHub();
        deps.scheduleMinimapRender();
    }

    function endDrag(deps, event=null){
        const hadContentDrag = Boolean(deps.dragNode || deps.resizeNode || deps.llmPaneDrag || deps.knifeChanged || deps.tempLink);
        const hadViewportDrag = Boolean(deps.dragBoard || deps.minimapDrag);
        if(deps.dragNode){
            const moved = [deps.dragNode.node, ...(deps.dragNode.children || []).map(c => c.node)].filter(Boolean);
            // 拖动 group/promptGroup 自身时不重新评估（成员跟着一起走，包含关系不变）
            const draggedGroup = moved.some(n => n.type === 'group' || n.type === 'promptGroup');
            if(!draggedGroup) deps.updateGroupMembership(moved);
        }
        deps.dragNode = null;
        deps.dragBoard = null;
        deps.resizeNode = null;
        deps.llmPaneDrag = null;
        deps.knifeActive = false;
        deps.knifePoint = null;
        deps.knifeTrail = [];
        const shouldRenderKnife = deps.knifeNeedsRender;
        deps.knifeChanged = false;
        deps.knifeNeedsRender = false;
        if(!event?.shiftKey) deps.setKnifeMode(false);
        deps.endTextSelection();
        deps.document.body.classList.remove('canvas-node-drag', 'canvas-node-resize', 'canvas-selecting', 'canvas-board-pan');
        deps.setCanvasMouseMove(null);
        deps.setCanvasMouseUp(null);
        if(shouldRenderKnife) deps.render();
        deps.scheduleMinimapRender();
        if(hadContentDrag) deps.scheduleSave();
        else if(hadViewportDrag) deps.scheduleViewportSave();
    }

    function startLink(deps, e, originId, originKind){
        e.stopPropagation();
        originKind = originKind || 'out';
        const src = deps.portPoint(originId, originKind);
        const source = deps.nodes.find(n => n.id === originId);
        deps.tempLink = {from:originId, originKind, x1:src.x, y1:src.y, x2:src.x, y2:src.y};
        deps.setCanvasMouseMove(e2 => {
            const p = deps.screenToWorld(e2.clientX, e2.clientY);
            deps.tempLink.x2 = p.x;
            deps.tempLink.y2 = p.y;
            deps.renderLinks();
        });
        deps.setCanvasMouseUp(e2 => {
            const targetKind = originKind === 'out' ? 'in' : 'out';
            const targetPort = nearestPort(deps, e2.clientX, e2.clientY, targetKind);
            const target = targetPort?.closest('.node');
            if(target){
                const targetId = target.dataset.id;
                const fromId = originKind === 'out' ? originId : targetId;
                const toId = originKind === 'out' ? targetId : originId;
                if(deps.canConnect(fromId, toId)){
                    if(!deps.connections.some(c => c.from === fromId && c.to === toId)){
                        deps.pushUndo();
                        deps.connections.push({id:deps.uid('c'), from:fromId, to:toId});
                        deps.syncLatestGeneratedOutputToConnection(fromId, toId);
                    }
                    deps.syncGeneratorInputs();
                    deps.scheduleSave();
                    deps.render();
                }
            } else if(originKind === 'out'){
                if(source && deps.CANVAS_GENERATOR_TYPES.includes(source.type)){
                    const p = deps.screenToWorld(e2.clientX, e2.clientY);
                    deps.pushUndo();
                    const out = {id:deps.uid('out'), type:'output', x:p.x, y:p.y - 63, images:[]};
                    deps.nodes.push(out);
                    deps.connections.push({id:deps.uid('c'), from:source.id, to:out.id});
                    deps.syncLatestGeneratedOutputToConnection(source.id, out.id);
                    deps.syncGeneratorInputs();
                    deps.scheduleSave();
                    deps.render();
                } else {
                    deps.openLinkCreateMenu(originId, originKind, e2.clientX, e2.clientY);
                }
            } else if(originKind === 'in'){
                deps.openLinkCreateMenu(originId, originKind, e2.clientX, e2.clientY);
            }
            deps.tempLink = null;
            deps.setCanvasMouseMove(null);
            deps.setCanvasMouseUp(null);
            deps.renderLinks();
        });
    }

    function nearestPort(deps, clientX, clientY, kind){
        const selector = `.port.${kind}`;
        const direct = deps.document.elementFromPoint(clientX, clientY)?.closest(selector);
        if(direct) return direct;
        let best = null;
        let bestDistance = Infinity;
        deps.nodesEl.querySelectorAll(selector).forEach(port => {
            const r = port.getBoundingClientRect();
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;
            const d = Math.hypot(clientX - cx, clientY - cy);
            if(d < bestDistance){
                bestDistance = d;
                best = port;
            }
        });
        return bestDistance <= 48 ? best : null;
    }

    function startSelectionLink(deps, e, kind){
        e.preventDefault();
        e.stopPropagation();
        const p = deps.screenToWorld(e.clientX, e.clientY);
        deps.tempLink = {from:`selection:${kind}`, x1:p.x, y1:p.y, x2:p.x, y2:p.y};
        deps.setCanvasMouseMove(e2 => { const next = deps.screenToWorld(e2.clientX, e2.clientY); deps.tempLink.x2 = next.x; deps.tempLink.y2 = next.y; deps.renderLinks(); });
        deps.setCanvasMouseUp(e2 => {
            const targetPort = nearestPort(deps, e2.clientX, e2.clientY, 'in');
            const target = targetPort?.closest('.generator-node');
            if(target) deps.connectSelectionToGenerator(kind, target.dataset.id);
            deps.tempLink = null;
            deps.setCanvasMouseMove(null);
            deps.setCanvasMouseUp(null);
            deps.render();
            deps.scheduleSave();
        });
    }

    function renderSelectionHub(deps){
    deps.selectionHub.innerHTML = '';
    deps.selectionHub.classList.remove('open');
    const targets = [...deps.selected].filter(id => deps.nodes.some(node => node.id === id));
    if(targets.length < 2) return;
    const groupButton = deps.document.createElement('button');
    groupButton.type = 'button';
    groupButton.className = 'tool-btn';
    groupButton.title = `${deps.tr('canvas.group')} (Ctrl+G)`;
    groupButton.innerHTML = `<i data-lucide="group" class="w-3.5 h-3.5"></i><span>${deps.escapeHtml(deps.tr('canvas.group'))}</span>`;
    groupButton.onmousedown = event => event.stopPropagation();
    groupButton.onclick = deps.groupSelectedImages;
    deps.selectionHub.appendChild(groupButton);
    deps.selectionHub.classList.add('open');
    const box = deps.nodeBounds([...deps.selected]);
    const x = box.x * deps.viewport.scale + deps.viewport.x;
    const y = box.y * deps.viewport.scale + deps.viewport.y;
    const boardRect = deps.board.getBoundingClientRect();
    const boardScale = boardRect.width / deps.board.clientWidth || 1;
    const safeTop = (deps.document.querySelector('.topbar').getBoundingClientRect().bottom - boardRect.top) / boardScale + 8;
    deps.selectionHub.style.left = `${Math.max(10, Math.min(x, deps.board.clientWidth - deps.selectionHub.offsetWidth - 10))}px`;
    deps.selectionHub.style.top = `${Math.max(safeTop, Math.min(y - deps.selectionHub.offsetHeight - 8, deps.board.clientHeight - deps.selectionHub.offsetHeight - 10))}px`;
    deps.refreshIcons();
}

function refreshSelectionVisuals(deps){
    deps.nodesEl.querySelectorAll('.node').forEach(el => {
        el.classList.toggle('selected', deps.selected.has(el.dataset.id));
    });
    deps.syncCanvasSelectedImageResolution(deps.nodesEl);
    deps.renderLinks();
    renderSelectionHub(deps);
    if(deps.workflowTransferModal?.classList.contains('open')) deps.updateWorkflowTransferMeta();
    deps.scheduleMinimapRender();
}

function knifeHitsConnection(deps, a, b, connection){
    const from = deps.portPoint(connection.from, 'out');
    const to = deps.portPoint(connection.to, 'in');
    const threshold = Math.max(8, 12 / deps.viewport.scale);
    let prev = deps.cubicPoint(from, to, 0);
    for(let i = 1; i <= 28; i++){
        const cur = deps.cubicPoint(from, to, i / 28);
        if(deps.segmentsIntersect(a, b, prev, cur) || deps.pointSegmentDistance(prev, a, b) <= threshold || deps.pointSegmentDistance(cur, a, b) <= threshold) return true;
        prev = cur;
    }
    return false;
}

function applyKnifeCut(deps, from, to){
    if(!deps.canvas || !deps.connections.length || !from || !to) return;
    const nodeHits = new Set();
    deps.nodes.forEach(n => {
        const el = deps.nodesEl.querySelector(`.node[data-id="${n.id}"]`);
        if(!el) return;
        const r = deps.nodeRect(n);
        if(deps.segmentIntersectsRect(from, to, r)) nodeHits.add(n.id);
    });
    const next = deps.connections.filter(c => !nodeHits.has(c.from) && !nodeHits.has(c.to) && !knifeHitsConnection(deps, from, to, c));
    if(next.length === deps.connections.length) return;
    if(!deps.knifeChanged) deps.pushUndo();
    deps.knifeChanged = true;
    deps.connections = next;
    deps.syncGeneratorInputs();
    deps.refreshGeneratorInputViews();
    deps.knifeNeedsRender = true;
    deps.renderLinks();
    renderSelectionHub(deps);
    deps.scheduleSave();
}

function setKnifeMode(deps, active){
    deps.document.body.classList.toggle('canvas-knife', Boolean(active && deps.canvas));
    if(!active){
        deps.knifeActive = false;
        deps.knifePoint = null;
        deps.knifeTrail = [];
        deps.knifeChanged = false;
        deps.knifeNeedsRender = false;
        deps.renderLinks();
    }
}

function startKnifeDrag(deps, e){
    if(!deps.canvas || e.button !== 0 || !e.shiftKey || e.altKey || isEditableTarget(deps, e.target)) return false;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation?.();
    deps.closeCreateMenu();
    setKnifeMode(deps, true);
    deps.knifeActive = true;
    deps.knifeChanged = false;
    deps.knifeNeedsRender = false;
    deps.knifePoint = deps.screenToWorld(e.clientX, e.clientY);
    deps.knifeTrail = [deps.knifePoint];
    deps.renderLinks();
    deps.setCanvasMouseMove((...args)=>continueKnifeDrag(deps, ...args));
    deps.setCanvasMouseUp(deps.endDrag);
    return true;
}

function continueKnifeDrag(deps, e){
    if(!deps.canvas || !deps.knifeActive) return;
    if(!e.shiftKey){
        setKnifeMode(deps, false);
        return;
    }
    const point = deps.screenToWorld(e.clientX, e.clientY);
    if(deps.knifePoint) applyKnifeCut(deps, deps.knifePoint, point);
    deps.knifePoint = point;
    deps.knifeTrail.push(point);
    if(deps.knifeTrail.length > 120) deps.knifeTrail = deps.knifeTrail.slice(-120);
    deps.renderLinks();
}

function isEditableTarget(deps, target){
    const tag = target?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable || target?.closest?.('select, option');
}

function isZoomPreviewIgnoredTarget(deps, target){
    return !!target?.closest?.('#createMenu, #linkCreateMenu, #nodeInputMenu, #nodeOutputMenu, #imageNodeMenu, .minimap, #canvasAssetPanel, #assetManagerModal, #workflowTransferModal, #logModal, #promptTemplateModal, #imageEditModal, #outputLightbox');
}

function startBoardPan(deps, e, opts={}){
    if(!deps.canvas) return false;
    if(isEditableTarget(deps, e.target) || e.target.closest?.('#createMenu, #linkCreateMenu, #nodeInputMenu, #nodeOutputMenu, #imageNodeMenu, .minimap')) return false;
    e.preventDefault();
    e.stopPropagation();
    deps.closeCreateMenu();
    if(deps.document.activeElement && deps.document.activeElement !== deps.document.body) deps.document.activeElement.blur();
    deps.dragBoard = {sx:e.clientX, sy:e.clientY, ox:deps.viewport.x, oy:deps.viewport.y, moved:false, clearSelectionOnClick:Boolean(opts.clearSelectionOnClick)};
    deps.document.body.classList.add('canvas-board-pan');
    deps.setCanvasMouseMove(e2 => {
        if(Math.hypot(e2.clientX - deps.dragBoard.sx, e2.clientY - deps.dragBoard.sy) > 4) deps.dragBoard.moved = true;
        deps.viewport.x = deps.dragBoard.ox + e2.clientX - deps.dragBoard.sx;
        deps.viewport.y = deps.dragBoard.oy + e2.clientY - deps.dragBoard.sy;
        deps.applyViewport();
        renderSelectionHub(deps);
    });
    deps.setCanvasMouseUp(e2 => {
        const shouldClearSelection = deps.dragBoard?.clearSelectionOnClick && !deps.dragBoard.moved && deps.selected.size;
        if(shouldClearSelection){
            deps.selected.clear();
            refreshSelectionVisuals(deps);
        }
        deps.endDrag(e2);
    });
    return true;
}

    const api={startSelection, updateSelectionBox, finishSelection, startNodeDrag, onNodeDrag, startNodeResize, onNodeResize, endDrag, startLink, nearestPort, startSelectionLink, renderSelectionHub, refreshSelectionVisuals, knifeHitsConnection, applyKnifeCut, setKnifeMode, startKnifeDrag, continueKnifeDrag, isEditableTarget, isZoomPreviewIgnoredTarget, startBoardPan};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.CanvasInteraction=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
