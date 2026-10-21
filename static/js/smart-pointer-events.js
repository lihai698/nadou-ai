/* Smart pointer event responsibility: smart-pointer-events. Host supplies live state and effects. */
(function(root){
    'use strict';

    function pointerDown(deps, e) {
        if(deps.zoomPreviewState && e.button === 0 && !e.target.closest('.composer,.smart-back,.asset-panel,.asset-toggle,.smart-log-toggle,.smart-shortcut-toggle,.smart-workflow-toggle,.log-modal,.shortcut-modal,.image-edit-modal,.create-menu,.smart-minimap')) return;
        if(e.target.closest('.image-node,.composer,.smart-back,.asset-panel,.asset-toggle,.smart-log-toggle,.smart-shortcut-toggle,.smart-workflow-toggle,.log-modal,.shortcut-modal,.create-menu,.smart-minimap')) return;
        deps.closeCreateMenu();
        if(e.button === 0 && e.shiftKey){
            e.preventDefault();
            deps.didPan = false;
            deps.connectionEraseState = {started:false, count:0, indices:new Set(), lastX:e.clientX, lastY:e.clientY, trail:[]};
            deps.shell.classList.add('connection-erasing');
            deps.updateConnectionEraseTrail(e);
            deps.eraseConnectionsAtPoint(e);
            return;
        }
        if(e.button === 0 && deps.isRKeyDown){
            e.preventDefault();
            deps.didPan = false;
            deps.selectionState = {startScreen:{x:e.clientX, y:e.clientY}, startWorld:deps.screenToWorld(e)};
            deps.updateSelectionBox(e);
            return;
        }
        if(e.button === 0 && (e.ctrlKey || e.metaKey)){
            e.preventDefault();
            deps.didPan = false;
            deps.selectionState = {startScreen:{x:e.clientX, y:e.clientY}, startWorld:deps.screenToWorld(e)};
            deps.updateSelectionBox(e);
            return;
        }
        if(e.button !== 0 && e.button !== 1) return;
        e.preventDefault();
        deps.didPan = false;
        deps.panState = {button:e.button, startX:e.clientX, startY:e.clientY, ox:deps.viewport.x, oy:deps.viewport.y};
        deps.shell.classList.add('panning');
    }

    function contextMenu(deps, e) {
        if((e.ctrlKey || e.metaKey) || deps.isRKeyDown){
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        if(deps.didPan || e.target.closest('.composer,.smart-back,.asset-panel,.asset-toggle,.smart-log-toggle,.smart-shortcut-toggle,.smart-workflow-toggle,.log-modal,.shortcut-modal,.image-edit-modal,.create-menu,.smart-minimap')) return;
        if(deps.document.getElementById('imageEditModal')?.classList.contains('open')) return;
        e.preventDefault();
        e.stopPropagation();
        const groupEl = e.target.closest('.image-node.smart-group-node');
        if(groupEl?.dataset?.id){
            deps.selectedId = groupEl.dataset.id;
            deps.selectedIds = [];
            deps.selectedImage = {nodeId:'', index:-1};
            deps.openCreateMenu(e, {groupId:groupEl.dataset.id});
            return;
        }
        if(e.target.closest('.image-node')) return;
        deps.openCreateMenu(e);
    }

    function doubleClick(deps, e) {
        if(deps.didPan || e.target.closest('.image-node,.composer,.smart-back,.asset-panel,.asset-toggle,.smart-log-toggle,.smart-shortcut-toggle,.smart-workflow-toggle,.log-modal,.shortcut-modal,.image-edit-modal,.create-menu')) return;
        if(deps.document.getElementById('imageEditModal')?.classList.contains('open')) return;
        e.preventDefault();
        deps.openCreateMenu(e);
    }

    function backgroundClick(deps, e) {
        if(deps.selectionJustFinished) return;
        if(deps.didPan || e.target.closest('.image-node,.composer,.smart-back,.asset-panel,.asset-toggle,.smart-log-toggle,.smart-shortcut-toggle,.smart-workflow-toggle,.log-modal,.shortcut-modal,.image-edit-modal,.create-menu')) return;
        if(deps.document.getElementById('imageEditModal')?.classList.contains('open')) return;
        deps.closeCreateMenu();
        deps.clearSelection();
        deps.render();
    }

    function pointerMove(deps, e) {
        deps.lastMouseWorld = deps.screenToWorld(e);
        if(deps.smartMinimapDrag){
            e.preventDefault();
            deps.centerViewportOnWorldPoint(deps.minimapEventToWorld(e));
            return;
        }
        if(deps.connectionEraseState){
            e.preventDefault();
            deps.updateConnectionEraseTrail(e);
            deps.eraseConnectionsAlongPointer(e);
            return;
        }
        if(deps.portDragState){
            if(e.buttons === 0){ cancelPortDrag(deps); return; }
            e.preventDefault();
            const p = deps.screenToWorld(e);
            deps.portDragState.currentWorld = p;
            deps.portDragState.moved = true;
            const hitEl = deps.document.elementFromPoint(e.clientX, e.clientY);
            const portEl = hitEl?.closest?.('.node-port');
            const nodeEl = portEl?.closest?.('.image-node') || hitEl?.closest?.('.image-node');
            let targetId = '', targetPort = '';
            if(nodeEl && nodeEl.dataset.id && nodeEl.dataset.id !== deps.portDragState.fromId){
                targetId = nodeEl.dataset.id;
                if(portEl){
                    targetPort = portEl.dataset.port;
                } else {
                    targetPort = deps.portDragState.fromPort === 'out' ? 'in' : 'out';
                }
                const compatible = (deps.portDragState.fromPort === 'out' && targetPort === 'in') || (deps.portDragState.fromPort === 'in' && targetPort === 'out');
                if(!compatible){ targetId = ''; targetPort = ''; }
            }
            deps.portDragState.hoverTargetId = targetId;
            deps.portDragState.hoverPort = targetPort;
            deps.updatePortDragVisual();
            return;
        }
        if(deps.promptResizeState){
            e.preventDefault();
            const dy = e.clientY - deps.promptResizeState.startY;
            deps.settings.promptH = Math.max(60, Math.min(380, deps.promptResizeState.startH + dy));
            deps.promptInput.style.setProperty('--prompt-h', `${deps.settings.promptH}px`);
            deps.persistActiveSmartSettings();
            return;
        }
        if(deps.selectionState){
            e.preventDefault();
            deps.updateSelectionBox(e);
            return;
        }
        if(deps.handleImageEditorPointerMove(e)) return;
        if(deps.resizeState){
            const node = deps.nodes.find(n => n.id === deps.resizeState.id);
            if(!node) return;
            const dx = (e.clientX - deps.resizeState.startX) / deps.viewport.scale;
            const dy = (e.clientY - deps.resizeState.startY) / deps.viewport.scale;
            const minW = node.type === 'smart-prompt' ? 260 : node.type === 'smart-loop' ? 252 : node.type === 'smart-group' ? deps.SMART_GROUP_MIN_WIDTH : 48;
            const minH = node.type === 'smart-prompt' ? 170 : node.type === 'smart-loop' ? 132 : node.type === 'smart-group' ? deps.SMART_GROUP_MIN_HEIGHT : 48;
            if(node.type === 'smart-group' && deps.smartGroupImageRefs(node).some(ref => ref.item?.url)){
                // 图片分组：和普通节点一样直接改 w/h，缩略图网格按新尺寸实时重排。不要走下面的“成员缩放”那套，
                // 否则拖动过程里会按成员包围盒/缩放比例收缩，松手才回到拖动宽度（用户反馈的“变宽时先缩小”）。
                node.w = Math.max(minW, Math.round(deps.resizeState.startW + dx));
                node.h = Math.max(minH, Math.round(deps.resizeState.startH + dy));
                if(deps.smartGroupCompactMembers(node).length) deps.arrangeSmartGroupMembers(node, {skipUndo:true, syncDom:true});
                deps.updateNodeElementDuringResize(node);
                return;
            }
            if(node.type === 'smart-group'){
                // 分组当“画布中的画布”：拖手柄按宽度方向算出统一缩放比例，组内所有成员（图片+提示词）按相对手势
                // 起点的快照整体缩放+重排，然后把分组框自动收紧到成员的包围盒——盒子始终贴合内容，右侧不会留空白。
                const startZoom = deps.resizeState.startZoom || 1;
                // 目标框宽 = 手柄拖出的框宽；缩放映射以“贴合内容的框宽”为基准，保证两个阶段都线性跟随手柄、衔接连续。
                const targetW = deps.resizeState.startW + dx;
                const fitBase = deps.resizeState.contentFitW || deps.resizeState.startW || 1;
                const desiredZoom = startZoom * (targetW / fitBase);
                // 成员缩放上限 SMART_GROUP_MAX_MEMBER_ZOOM（默认 1=原始尺寸）：到上限就不再放大成员，改为让分组框继续扩大。
                const effectiveZoom = Math.max(0.2, Math.min(deps.SMART_GROUP_MAX_MEMBER_ZOOM, desiredZoom));
                const memberRatio = effectiveZoom / startZoom;
                const capped = desiredZoom > deps.SMART_GROUP_MAX_MEMBER_ZOOM;
                node._memberZoom = effectiveZoom;
                const gx = Number(node.x) || 0, gy = Number(node.y) || 0;
                const SMART_GROUP_PAD = 16;
                let maxRight = gx, maxBottom = gy, hasMember = false;
                (deps.resizeState.members || []).forEach(snap => {
                    const member = deps.nodes.find(n => n.id === snap.id);
                    if(!member) return;
                    hasMember = true;
                    member.x = gx + (snap.sx - gx) * memberRatio;
                    member.y = gy + (snap.sy - gy) * memberRatio;
                    member.w = Math.max(40, Math.round(snap.sw * memberRatio));
                    member.h = Math.max(40, Math.round(snap.sh * memberRatio));
                    if(snap.isImage) member.scale = 1;
                    maxRight = Math.max(maxRight, member.x + member.w);
                    maxBottom = Math.max(maxBottom, member.y + member.h);
                    const memberEl = deps.world.querySelector(`.image-node[data-id="${deps.CSS.escape(member.id)}"]`);
                    if(memberEl){
                        memberEl.style.left = `${member.x}px`;
                        memberEl.style.top = `${member.y}px`;
                    }
                    deps.updateNodeElementDuringResize(member);
                });
                if(capped || !hasMember){
                    // 成员已到上限（或空分组）：分组框随手柄继续扩大，成员不再放大。
                    node.w = Math.max(minW, Math.round(deps.resizeState.startW + dx));
                    node.h = Math.max(minH, Math.round(deps.resizeState.startH + dy));
                } else {
                    // 未到上限：分组框收紧到成员包围盒，贴合内容无空白。
                    node.w = Math.max(minW, Math.round(maxRight - gx + SMART_GROUP_PAD));
                    node.h = Math.max(minH, Math.round(maxBottom - gy + SMART_GROUP_PAD));
                }
                node.scale = 1;
                deps.updateNodeElementDuringResize(node);
                return;
            }
            node.w = Math.max(minW, Math.round(deps.resizeState.startW + dx));
            node.h = Math.max(minH, Math.round(deps.resizeState.startH + dy));
            node.scale = 1;
            deps.updateNodeElementDuringResize(node);
            return;
        }
        if(deps.llmInstructionResizeState){
            const node = deps.nodes.find(n => n.id === deps.llmInstructionResizeState.id);
            if(!node) return;
            const dy = (e.clientY - deps.llmInstructionResizeState.startY) / deps.viewport.scale;
            const newInstrH = Math.max(deps.PROMPT_LLM_INSTRUCTION_MIN_H, Math.min(deps.PROMPT_LLM_INSTRUCTION_MAX_H, Math.round(deps.llmInstructionResizeState.startH + dy)));
            node.llmInstructionHeight = newInstrH;
            // 只把“指令框的高度变化量”叠加到节点总高度上，保留用户手动拉大的上方区域，避免上方被重置变小。
            node.h = Math.max(deps.promptNodeExpandedHeight(node), Math.round(deps.llmInstructionResizeState.startNodeH + (newInstrH - deps.llmInstructionResizeState.startH)));
            node.w = Math.max(Number(node.w) || 0, 316);
            node.scale = 1;
            deps.updateNodeElementDuringResize(node);
            const ta = deps.world.querySelector(`.image-node[data-id="${deps.CSS.escape(node.id)}"] .prompt-llm-instruction`);
            if(ta) ta.style.height = `${deps.promptLlmInstructionHeight(node)}px`;
            return;
        }
        if(deps.promptSplitResizeState){
            const node = deps.nodes.find(n => n.id === deps.promptSplitResizeState.id);
            if(!node) return;
            const dy = (e.clientY - deps.promptSplitResizeState.startY) / deps.viewport.scale;
            const newPreviewH = Math.max(deps.PROMPT_SPLIT_PREVIEW_MIN_H, Math.min(deps.PROMPT_SPLIT_PREVIEW_MAX_H, Math.round(deps.promptSplitResizeState.startH + dy)));
            node.promptSplitPreviewHeight = newPreviewH;
            node.h = Math.max(deps.promptNodeMinHeight(node), Math.round(deps.promptSplitResizeState.startNodeH + (newPreviewH - deps.promptSplitResizeState.startH)));
            node.w = Math.max(Number(node.w) || 0, 316);
            node.scale = 1;
            deps.updateNodeElementDuringResize(node);
            const list = deps.world.querySelector(`.image-node[data-id="${deps.CSS.escape(node.id)}"] .prompt-node-segments`);
            if(list) list.style.height = `${deps.promptNodeSplitPreviewHeight(node)}px`;
            return;
        }
        if(deps.thumbDragState){
            const dx = e.clientX - deps.thumbDragState.startX;
            const dy = e.clientY - deps.thumbDragState.startY;
            const source = deps.nodes.find(n => n.id === deps.thumbDragState.nodeId);
            if(!deps.thumbDragState.detached && Math.abs(dx) + Math.abs(dy) > 6){
                const canDetachThumb = source && (deps.isSmartGroupNode(source) ? (source.images || []).length >= 1 : (source.images || []).length > 1);
                if(canDetachThumb){
                    const img = source.images[deps.thumbDragState.imgIndex];
                    if(img){
                        deps.commitPendingUndo();
                        deps.undoSuppressed = true;
                        deps.applyNodeMetaToImage(img, source);
                        source.images.splice(deps.thumbDragState.imgIndex, 1);
                        if(deps.isSmartGroupNode(source)){
                            deps.arrangeSmartGroupMembers(source, {skipUndo:true, syncDom:true});
                        } else if(source.images.length <= 1){
                            source.title = 'Image';
                            delete source.w; delete source.h;
                            deps.inheritNodeMetaFromImage(source);
                        }
                        const point = deps.screenToWorld(e);
                        deps.selectedId = '';
                        deps.selectedImage = {nodeId:'', index:-1};
                        const newNode = deps.createImageNodeAt(point, [img], {select:false, skipUndo:true});
                        deps.undoSuppressed = false;
                        deps.dragState = {id:newNode.id, startX:e.clientX, startY:e.clientY, ox:newNode.x, oy:newNode.y, thumbDetached:true};
                        deps.thumbDragState.detached = true;
                        deps.render();
                    }
                }
            }
            if(deps.thumbDragState.detached) deps.thumbDragState = null;
            else return;
        }
        if(deps.panState){
            const dx = e.clientX - deps.panState.startX;
            const dy = e.clientY - deps.panState.startY;
            if(Math.abs(dx) + Math.abs(dy) > 3) deps.didPan = true;
            deps.viewport.x = deps.panState.ox + dx;
            deps.viewport.y = deps.panState.oy + dy;
            deps.applyViewport();
            return;
        }
        if(!deps.dragState) return;
        const node = deps.nodes.find(n => n.id === deps.dragState.id);
        if(!node) return;
        const moveDx = (e.clientX - deps.dragState.startX) / deps.viewport.scale;
        const moveDy = (e.clientY - deps.dragState.startY) / deps.viewport.scale;
        (deps.dragState.group || [{id:deps.dragState.id, ox:deps.dragState.ox, oy:deps.dragState.oy}]).forEach(item => {
            const n = deps.nodes.find(x => x.id === item.id);
            if(!n) return;
            n.x = item.ox + moveDx;
            n.y = item.oy + moveDy;
        });
        if(deps.assetLibraryOpen){
            const hit = deps.document.elementFromPoint(e.clientX, e.clientY);
            if(hit && deps.assetPanel?.contains(hit)){
                deps.setAssetDragOver(true);
                deps.clearDropHighlight();
                deps.setAssetDragOver(true);
                return;
            }
            deps.setAssetDragOver(false);
        }
        const draggedRect = deps.nodeRect(node);
        const rawTarget = deps.dragState.ctrlGroup
            ? (['smart-prompt','smart-loop'].includes(node.type)
                ? deps.dragConnectTargetFor(node, deps.screenToWorld(e))
                : deps.rectOverlapNode(node.id, draggedRect.x, draggedRect.y, draggedRect.width, draggedRect.height, deps.dragState.groupIds))
            : null;
        const target = deps.isSmartGroupNode(rawTarget) ? null : rawTarget;
        deps.setDropHighlight(target?.id || '');
        deps.moveNodeElementsDuringDrag();
        deps.updateLoopInsertPreview();
        if(target) deps.setDropHighlight(target.id);
    }

    function pointerUp(deps, e) {
        deps.document.body.classList.remove('smart-node-drag');
        deps.document.body.classList.remove('smart-node-resize');
        if(deps.connectionEraseState){
            const changed = deps.finishConnectionErase();
            deps.connectionEraseState = null;
            deps.shell.classList.remove('connection-erasing');
            deps.clearConnectionEraseTrail();
            if(changed) deps.scheduleSave();
            return;
        }
        if(deps.portDragState){
            const drag = deps.portDragState;
            deps.portDragState = null;
            deps.shell.classList.remove('port-dragging');
            deps.clearPortDragVisual();
            deps.handlePortDrop(drag, e);
            return;
        }
        if(deps.promptResizeState){ deps.promptResizeState = null; deps.scheduleSave(); }
        if(deps.selectionState) deps.finishSelection(e);
        deps.handleImageEditorPointerUp(e);
        if(deps.resizeState){
            const node = deps.nodes.find(n => n.id === deps.resizeState.id);
            const rect = node ? deps.nodeRect(node) : null;
            const changed = rect && (Math.abs(rect.width - deps.resizeState.startW) > 1 || Math.abs(rect.height - deps.resizeState.startH) > 1);
            if(changed){
                deps.commitPendingUndo();
            } else { deps.discardPendingUndo(); }
            deps.resizeState = null;
            if(changed) deps.render();
            deps.scheduleSave();
        }
        if(deps.llmInstructionResizeState){
            const node = deps.nodes.find(n => n.id === deps.llmInstructionResizeState.id);
            const changed = node && deps.promptLlmInstructionHeight(node) !== deps.llmInstructionResizeState.startH;
            deps.document.body.classList.remove('smart-node-resize', 'smart-llm-instr-resize');
            if(changed) deps.commitPendingUndo(); else deps.discardPendingUndo();
            deps.llmInstructionResizeState = null;
            deps.render();
            deps.scheduleSave();
        }
        if(deps.promptSplitResizeState){
            const node = deps.nodes.find(n => n.id === deps.promptSplitResizeState.id);
            const changed = node && deps.promptNodeSplitPreviewHeight(node) !== deps.promptSplitResizeState.startH;
            deps.document.body.classList.remove('smart-node-resize', 'smart-prompt-split-resize');
            if(changed) deps.commitPendingUndo(); else deps.discardPendingUndo();
            deps.promptSplitResizeState = null;
            deps.render();
            deps.scheduleSave();
        }
        if(deps.thumbDragState){
            if(!deps.thumbDragState.detached) deps.discardPendingUndo();
            deps.thumbDragState = null;
        }
        if(deps.panState) {
            deps.panState = null;
            deps.shell.classList.remove('panning');
            deps.scheduleSave();
            deps.setTimeout(() => { deps.didPan = false; }, 0);
        }
        if(deps.smartMinimapDrag){
            deps.smartMinimapDrag = false;
        }
        if(deps.dragState){
            const draggedNode = deps.nodes.find(n => n.id === deps.dragState.id);
            let stateChanged = false;
            const hit = deps.document.elementFromPoint(e.clientX, e.clientY);
            const droppedOnAssetPanel = deps.assetLibraryOpen && hit && deps.assetPanel?.contains(hit);
            if(droppedOnAssetPanel && draggedNode && (draggedNode.images || []).length){
                const imagesToSave = (draggedNode.images || []).filter(img => img?.url);
                imagesToSave.forEach(img => deps.addUrlToAssetLibrary(img.url, img.name || draggedNode.title || 'image'));
                (deps.dragState.group || [{id:deps.dragState.id, ox:deps.dragState.ox, oy:deps.dragState.oy}]).forEach(item => {
                    const n = deps.nodes.find(x => x.id === item.id);
                    if(n){ n.x = item.ox; n.y = item.oy; }
                });
                deps.setAssetDragOver(false);
                deps.discardPendingUndo();
                deps.clearDropHighlight();
                deps.dragState = null;
                deps.document.body.classList.remove('smart-node-drag');
                deps.render();
                deps.scheduleSave();
                return;
            }
            const autoTarget = draggedNode && deps.dragState.ctrlGroup ? deps.dragConnectTargetFor(draggedNode, deps.screenToWorld(e)) : null;
            const insertHit = draggedNode?.type === 'smart-loop' && deps.dragState.ctrlGroup && (deps.dragState.group || []).length <= 1
                ? deps.insertionConnectionForNode(draggedNode)
                : null;
            const draggedRect = draggedNode ? deps.nodeRect(draggedNode) : null;
            const groupTarget = draggedNode && (draggedNode.images || []).length && (deps.dragState.group || []).length <= 1 && draggedRect
                ? deps.rectOverlapNode(draggedNode.id, draggedRect.x, draggedRect.y, draggedRect.width, draggedRect.height, deps.dragState.groupIds)
                : null;
            // 拖入分组：单个节点、多选（批量拖入）或整个分组（其成员会并入目标分组）都允许并入主分组下的目标分组。
            // 目标分组由主拖动节点的中心命中决定；smartGroupTargetForDraggedNode 已排除正在被拖动的节点/分组。
            const draggedNodes = (deps.dragState.group || []).map(item => deps.nodes.find(n => n.id === item.id)).filter(Boolean);
            const smartGroupTarget = draggedNode ? deps.smartGroupTargetForDraggedNode(draggedNode) : null;
            if(
                insertHit &&
                deps.insertLoopNodeIntoConnection(draggedNode, insertHit)
            ){
                stateChanged = true;
                deps.render();
            } else if(
                smartGroupTarget &&
                deps.addDraggedNodesToSmartGroup(draggedNodes.length ? draggedNodes : [draggedNode], smartGroupTarget)
            ){
                stateChanged = true;
                deps.render();
            } else if(
                groupTarget &&
                deps.dragState.ctrlGroup &&
                (groupTarget.images || []).length > 1 &&
                deps.mergeImageNodesIntoGroup(draggedNode.id, groupTarget.id)
            ){
                stateChanged = true;
                deps.render();
            } else if(
                draggedNode &&
                autoTarget &&
                deps.dragState.ctrlGroup &&
                (deps.dragState.group || []).length <= 1 &&
                deps.canAutoConnectDraggedNode(draggedNode, autoTarget) &&
                deps.connectInputNode(draggedNode.id, autoTarget.id)
            ){
                stateChanged = true;
                deps.restoreDraggedNodePosition();
                if(deps.selectedId === draggedNode.id) deps.selectedId = '';
                deps.render();
            } else if(draggedNode && (draggedNode.images || []).length && (deps.dragState.group || []).length <= 1){
                const r = deps.nodeRect(draggedNode);
                const target = deps.rectOverlapNode(draggedNode.id, r.x, r.y, r.width, r.height, deps.dragState.groupIds);
                if(target && deps.isSmartGroupNode(target)){
                    if((deps.dragState.group || []).some(item => {
                        const n = deps.nodes.find(x => x.id === item.id);
                        return n && (Math.abs((Number(n.x) || 0) - item.ox) > 1 || Math.abs((Number(n.y) || 0) - item.oy) > 1);
                    })) stateChanged = true;
                } else if(target && deps.dragState.ctrlGroup && !deps.isSmartGroupNode(target) && deps.canAutoConnectDraggedNode(draggedNode, target)){
                    stateChanged = true;
                    deps.connectInputNode(draggedNode.id, target.id);
                    if(!deps.dragState.thumbDetached) deps.restoreDraggedNodePosition();
                    if(deps.selectedId === draggedNode.id) deps.selectedId = '';
                    deps.render();
                } else if((deps.dragState.group || []).some(item => {
                    const n = deps.nodes.find(x => x.id === item.id);
                    return n && (Math.abs((Number(n.x) || 0) - item.ox) > 1 || Math.abs((Number(n.y) || 0) - item.oy) > 1);
                })){
                    stateChanged = true;
                }
            } else if((deps.dragState.group || []).some(item => {
                const n = deps.nodes.find(x => x.id === item.id);
                return n && (Math.abs((Number(n.x) || 0) - item.ox) > 1 || Math.abs((Number(n.y) || 0) - item.oy) > 1);
            }) || (draggedNode && (Math.abs((draggedNode.x || 0) - deps.dragState.ox) > 1 || Math.abs((draggedNode.y || 0) - deps.dragState.oy) > 1))){
                stateChanged = true;
            }
            if(deps.dragState.thumbDetached) stateChanged = true;
            // 拖出（没落到任何分组上）：普通节点退出所在分组；子分组退出时把它并入过的成员从主分组里撤掉。
            if(draggedNode && !smartGroupTarget && deps.pruneSmartGroupMembershipsForNode(draggedNode)){
                stateChanged = true;
                deps.render();
            }
            if(stateChanged) deps.commitPendingUndo();
            else deps.discardPendingUndo();
            if(stateChanged || deps.dragState.thumbDetached) deps.suppressNodeClickUntil = Date.now() + 180;
            deps.clearDropHighlight();
            deps.loopInsertPreview = null;
            deps.dragState = null;
            deps.scheduleSave();
            deps.scheduleConnectionLayerRefresh();
        }
    }

    function cancelPortDrag(deps){
        if(!deps.portDragState) return;
        deps.portDragState=null;
        deps.shell.classList.remove('port-dragging');
        deps.clearPortDragVisual();
        deps.discardPendingUndo();
    }

    const api={pointerDown, contextMenu, doubleClick, backgroundClick, pointerMove, pointerUp, cancelPortDrag};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.SmartPointerEvents=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
