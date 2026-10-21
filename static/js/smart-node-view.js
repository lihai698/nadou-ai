/* Smart node view responsibility: smart-node-view. Host supplies live state and effects. */
(function(root){
    'use strict';

function rememberInlineVideoActivations(deps){
    deps.world.querySelectorAll('.image-node [data-image-index] video[data-inline-video-active="1"]').forEach(video => {
        const nodeEl = video.closest('.image-node');
        const itemEl = video.closest('[data-image-index]');
        const node = deps.nodes.find(n => n.id === nodeEl?.dataset.id);
        const index = Number(itemEl?.dataset.imageIndex ?? 0);
        const image = node?.images?.[index];
        if(image && deps.mediaKindForItem(image) === 'video') image._inlineVideoActive = true;
    });
}

function render(deps){
    if(deps.window.CanvasVideoDeconstructionBridge) deps.window.CanvasVideoDeconstructionUI?.reconcile(deps.window.CanvasVideoDeconstructionBridge,deps.nodes.filter(n=>n.type==='smart-shot-table').map(n=>n.id));
    if(deps.smartWorkflowTransferModal?.classList.contains('open')) deps.updateSmartWorkflowTransferMeta();
    rememberInlineVideoActivations(deps);
    deps.world.classList.toggle('smart-multi-selected', deps.selectedNodeIds().length > 1);
    const composerEl = deps.composer;
    const mediaStates = deps.captureMediaPlaybackStates();
    // 用户正在提示词框(contenteditable)输入时,本次重渲染不要移动 composer:
    // 移动 DOM 节点会打断输入法合成会话,导致输入中断(即使保留焦点描边也接不上)。
    const promptHadFocus = deps.document.activeElement === deps.promptInput;
    const reusableNodes = new Map();
    const nodeById = new Map();
    deps.nodes.forEach(node => { if(!nodeById.has(node.id)) nodeById.set(node.id, node); });
    deps.world.querySelectorAll('.image-node').forEach(el => {
        const node = nodeById.get(el.dataset.id);
        if(deps.smartNodeHasLiveMedia(node)) reusableNodes.set(node.id, el);
    });
    const nodeHtmlEntries = deps.nodes
        .filter(node => node.id !== deps.SMART_LOG_PREVIEW_NODE_ID)
        // 分组节点先渲染（DOM 靠前→层级在下），作为成员的背板；成员渲染在后、盖在分组之上，
        // 否则缩小分组把成员挪进卡片区域时会被分组卡片背景遮住而“消失”。
        .slice()
        .sort((a, b) => (deps.isSmartGroupNode(a) ? 0 : 1) - (deps.isSmartGroupNode(b) ? 0 : 1))
        .map(node => {
        if(node.groupMode === 'frame') return {node, html:deps.renderWorkgroupFrame(node).outerHTML};
        const imgs = node.images || [];
        const isShotTable = node.type === 'smart-shot-table';
        const shotRow=nodeById.get(node.shotTableOrigin?.tableId)?.shotTableData?.rows.find(row=>row.id===node.shotTableOrigin.rowId);
        const title = shotRow ? deps.escapeHtml(`镜头 ${shotRow.index} · ${node.shotTableOrigin.stage==='video'?'视频':'画面'}`) : node.audioTaskId ? 'API生成' : isShotTable ? '智能分镜表' : node.depthCapture ? (node.depthCapture.role === 'pose' ? '骨骼姿态' : '灰度深度') : node.viewAdjust ? `API · ${node.viewAdjust.kind === 'angle' ? '多角度' : '打光'}` : node.type === 'smart-group' ? (node.title === '万能分组' ? '智能分组' : (node.title || '智能分组')) : node.type === 'smart-prompt' ? 'Prompt' : node.type === 'smart-loop' ? 'Loop' : imgs.length > 1 ? 'Group' : imgs.length ? 'Image' : deps.escapeHtml(deps.tr('smart.createImportNode'));
        const scale = deps.nodeScale(node);
        const layout = deps.imageLayout(imgs, scale, node);
        const isPrompt = node.type === 'smart-prompt';
        const isLoop = node.type === 'smart-loop';

        const isSmartGroup = node.type === 'smart-group';
        const isCompactMember = deps.isSmartGroupCompactMember(node);
        const isImageNode = node.type === 'smart-image' || !node.type;
        const isJimengPending = Boolean(node.jimengPending && node.jimengPending.submitId && imgs.length === 0);
        const isQueued = Boolean(node.queued && imgs.length === 0 && !node.pending && !isJimengPending);
        const hasAudioText=Boolean(node.audioOutputText);
        const isEmpty = !isShotTable && isImageNode && imgs.length === 0 && !node.pending && !isQueued && !isJimengPending && !node.depthCapture && !node.audioTaskId && !node.audioOutputText;
        const isHistory = deps.isHistoryGroupNode(node);
        const isGroup = isImageNode && imgs.length > 1;
        const isPending = ((node.pending || isQueued || isJimengPending) && imgs.length === 0);
        const body = isShotTable ? '' : deps.nodeBodyHtml(node, layout);
        const deleteBtn = (isGroup) ? '' : `<button class="mini-x node-delete" type="button" title="${deps.escapeHtml(deps.tr('smart.deleteNode'))}"><i data-lucide="trash-2"></i></button>`;
        const conflictCopyHtml = String(node.title || '').includes('（本地冲突副本）')
            ? '<span class="smart-conflict-copy">本地冲突副本</span>' : '';
        const submissionWarningHtml = node.submissionWarning
            ? `<button class="smart-submission-warning" type="button" title="${deps.escapeAttr(node.submissionWarning)}" data-smart-submission-warning="1">${node.submissionUnknown ? '提交状态未知' : '部分受理'}</button>` : '';
        const taskFailureHtml = node.taskFailureNotice
            ? `<button class="smart-submission-warning" type="button" title="${deps.escapeAttr(node.taskFailureNotice)}" data-smart-task-failure="1">任务已失效</button>` : '';
        const hint = hasAudioText ? '识别文字 · 可连接现有 LLM' : isSmartGroup ? '双击添加 · 拖入归组 · 选中后生成' : isPending ? deps.escapeHtml(deps.tr('smart.hintPending')) : (imgs.length > 1 ? deps.escapeHtml(deps.tr('smart.hintMulti')) : imgs.length ? deps.escapeHtml(deps.tr('smart.hintSingle')) : node.viewAdjust ? '在下方 API 面板调整模型并运行' : deps.escapeHtml(deps.tr('smart.hintEmpty')));
        const html = `<div class="image-node ${isShotTable ? 'shot-table-node smart-shot-table-node' : ''} ${isEmpty ? 'empty-node' : ''} ${isGroup ? 'group-node' : ''} ${isHistory ? 'history-group-node' : ''} ${isPrompt ? 'prompt-smart-node' : ''} ${isLoop ? 'loop-smart-node' : ''} ${isSmartGroup ? 'smart-group-node' : ''} ${isCompactMember ? 'smart-group-member-node' : ''} ${deps.isNodeSelected(node.id) ? 'selected' : ''} ${(deps.dragState?.groupIds?.includes(node.id) || deps.dragState?.id === node.id) ? 'dragging' : ''} ${node.running ? 'node-running' : ''} ${isPending ? 'node-pending' : ''}" data-id="${deps.escapeHtml(node.id)}" style="left:${node.x || 0}px;top:${node.y || 0}px;width:${layout.width}px;height:${layout.height}px">

            <div class="node-head"><div class="node-title">${title}</div><div class="node-actions">${deleteBtn}</div></div>
            ${!isEmpty && !isGroup ? `<div class="floating-node-actions"><button class="mini-x node-delete" type="button" title="${deps.escapeHtml(deps.tr('smart.deleteNode'))}"><i data-lucide="trash-2"></i></button></div>` : ''}
            ${deps.smartNodeToolbarHtml(node)}${deps.smartGroupToolbarHtml(node)}
            ${deps.runTimePillHtml(node)}
            <div class="smart-node-notices">${conflictCopyHtml}${submissionWarningHtml}${taskFailureHtml}</div>
            <div class="node-body">${body}</div>
            ${isCompactMember && (isPrompt || isLoop) ? '<div class="smart-group-member-grab" title="拖动移出分组"></div>' : ''}
            <div class="node-hint">${hint}</div>
            ${imgs.length || node.pending || isQueued || isJimengPending || isPrompt || isLoop || isSmartGroup || isShotTable ? '<div class="node-resize-handle" data-resize="1"></div>' : ''}
            <div class="node-port port-in" data-port="in" title="input"></div>
            <div class="node-port port-out" data-port="out" title="output"></div>
        </div>`;
        return {node, html};
    });
    const tpl = deps.document.createElement('template');
    tpl.innerHTML = nodeHtmlEntries.map(entry => entry.html).join('');
    const renderedNodeEls = new Map();
    [...tpl.content.children].forEach(el => {
        if(!renderedNodeEls.has(el.dataset.id)) renderedNodeEls.set(el.dataset.id, el);
    });
    const keepEls = new Set();
    reusableNodes.forEach(el => keepEls.add(el));
    if(composerEl) keepEls.add(composerEl);
    [...deps.world.childNodes].forEach(child => {
        if(!keepEls.has(child)) child.remove();
    });
    // 用户正在提示词框输入时不要移动 composer:移动 DOM 会打断输入法合成、中断输入。
    // composer 已在 keepEls 中(未被移除),不重排也不影响显示(z-index 固定)。
    if(composerEl && !promptHadFocus) deps.world.appendChild(composerEl);
    deps.world.insertAdjacentHTML('beforeend', deps.renderConnections());
    nodeHtmlEntries.forEach(entry => {
        const fresh = renderedNodeEls.get(entry.node.id);
        if(!fresh) return;
        deps.world.appendChild(fresh);
        if(entry.node.type === 'smart-shot-table' && deps.window.CanvasVideoDeconstructionBridge && deps.window.CanvasVideoDeconstructionUI){
            deps.window.CanvasVideoDeconstructionUI.mount(fresh,entry.node,deps.window.CanvasVideoDeconstructionBridge);
        }
        const reusable = reusableNodes.get(entry.node.id);
        if(reusable){
            deps.transplantSmartMediaElements(reusable, fresh);
            if(reusable !== fresh) reusable.remove();
        }
    });
    deps.restoreMediaPlaybackStates(mediaStates);
    deps.bindNodeEvents();
    deps.bindConnectionEvents();
    deps.updateComposer();
    deps.renderMinimap();
    if(deps.window.lucide) deps.lucide.createIcons();
    deps.bindSmartPreviewImageFallbacks(deps.world);
    deps.syncSmartSelectedImageResolution(deps.world);
    deps.measureSmartNodeImages();
    deps.refreshRunTimerPills();
    deps.syncSelectionGroup?.();
    return;
    
}



function moveNodeElementsDuringDrag(deps){
    if(!deps.dragState) return;
    const groupItems = deps.dragState.group || [{id:deps.dragState.id}];
    groupItems.map(item => item.id).forEach(id => {
        const n = deps.nodes.find(x => x.id === id);
        const el = deps.world.querySelector(`.image-node[data-id="${deps.CSS.escape(id)}"]`);
        if(n && el){
            el.style.left = `${n.x || 0}px`;
            el.style.top = `${n.y || 0}px`;
        }
    });
    const active = deps.selectedNode();
    if(active && (deps.dragState.group || [{id:deps.dragState.id}]).some(item => item.id === active.id)){
        deps.positionComposerForNode(active);
    }
    deps.scheduleInteractionLayerRefresh();
    deps.syncSelectionGroup?.();
}

function updateNodeElementDuringResize(deps, node){
    if(!node) return;
    const el = deps.world.querySelector(`.image-node[data-id="${deps.CSS.escape(node.id)}"]`);
    if(!el){
        deps.render();
        return;
    }
    const imgs = deps.isSmartGroupNode(node) ? deps.smartGroupImageRefs(node).map(ref => ref.item) : (node.images || []);
    const layout = deps.imageLayout(imgs, deps.nodeScale(node), node);
    el.style.width = `${layout.width}px`;
    el.style.height = `${layout.height}px`;
    const body = el.querySelector('.node-body');
    if(body){
        const loadingSingle = body.querySelector('.loading-cell.single');
        if(loadingSingle){
            loadingSingle.style.width = `${layout.width}px`;
            loadingSingle.style.height = `${layout.height}px`;
        }
        const loadingGrid = body.querySelector('.loading-skeleton');
        if(loadingGrid){
            const count = Math.max(1, Number(node.pending) || 1);
            const cols = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(count))));
            const rows = Math.ceil(count / cols);
            loadingGrid.style.width = `${layout.width}px`;
            loadingGrid.style.height = `${layout.height}px`;
            loadingGrid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
            loadingGrid.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
        }
        const maxVisibleRows = deps.isSmartGroupNode(node)
            ? (deps.smartGroupCompactMembers(node).length ? Number(layout.rows || 1) : deps.SMART_GROUP_MAX_VISIBLE_ROWS)
            : deps.MEDIA_GROUP_MAX_VISIBLE_ROWS;
        const grid = body.querySelector('.thumb-grid');
        if(grid){
            grid.style.setProperty('--thumb-cols', layout.cols);
            grid.style.setProperty('--thumb-size', `${layout.thumb}px`);
            const visibleRows = Math.max(1, Math.min(maxVisibleRows, Number(layout.visibleRows || layout.rows || 1)));
            const maxHeight = visibleRows * Number(layout.thumb || 96) + Math.max(0, visibleRows - 1) * 8;
            grid.style.setProperty('--thumb-max-height', `${maxHeight}px`);
            grid.querySelectorAll('.thumb-item').forEach((itemEl, index) => {
                deps.applyThumbDisplaySizeToElement(itemEl, imgs[index], layout.thumb);
            });
        }
        const wrap = body.querySelector('.image-wrap');
        if(wrap){
            // 分组单图卡片含 16px 内边距（PAD=32），图片按内边距内的尺寸显示，避免溢出边框。
            const wrapW = deps.isSmartGroupNode(node) ? Math.max(24, Number(layout.innerW || 0) || (Number(layout.width) - 32)) : layout.width;
            const wrapH = deps.isSmartGroupNode(node) ? Math.max(24, Number(layout.innerH || 0) || (Number(layout.height) - 60)) : layout.height;
            wrap.style.setProperty('--node-img-w', `${wrapW}px`);
            wrap.style.setProperty('--node-img-h', `${wrapH}px`);
        }
        const media = body.querySelector('.node-img');
        if(media){
            const mediaW = deps.isSmartGroupNode(node) ? Math.max(24, Number(layout.innerW || 0) || (Number(layout.width) - 32)) : layout.width;
            const mediaH = deps.isSmartGroupNode(node) ? Math.max(24, Number(layout.innerH || 0) || (Number(layout.height) - 60)) : layout.height;
            media.style.width = `${mediaW}px`;
            media.style.height = `${mediaH}px`;
        }
    }
    const active = deps.selectedNode();
    if(active?.id === node.id) deps.positionComposerForNode(active);
    deps.scheduleInteractionLayerRefresh();
    deps.syncSelectionGroup?.();
}

function syncSmartGroupMemberElements(deps, group){
    if(!deps.isSmartGroupNode(group)) return;
    deps.smartGroupCompactMembers(group).forEach(member => {
        const el = deps.world.querySelector(`.image-node[data-id="${deps.CSS.escape(member.id)}"]`);
        if(el){
            el.style.left = `${member.x || 0}px`;
            el.style.top = `${member.y || 0}px`;
        }
        updateNodeElementDuringResize(deps, member);
    });
}

// Only the pending frame and its listeners live here; canvas state stays in the host.
function createInteractionRefresh(host){
    const deps=host();
    let pending=null,mounted=false,disposed=false,listening=false;
    function cancel(){
        const previous=pending;
        pending=null;
        if(previous) deps.cancelAnimationFrame(previous.id);
    }
    function schedule(){
        if(!mounted||disposed) return;
        if(pending){
            if(pending.isCurrent()) return;
            cancel();
        }
        const isCurrent=deps.captureCanvasContext();
        if(!isCurrent()) return;
        const frame={id:0,isCurrent};
        pending=frame;
        frame.id=deps.requestAnimationFrame(()=>{
            // A cancelled callback must not clear a newer frame after restore/open.
            if(pending!==frame) return;
            pending=null;
            if(!mounted||disposed||!isCurrent()) return;
            deps.refreshConnectionLayer();
            deps.renderMinimap();
        });
    }
    function suspend(){mounted=false;cancel();}
    function mount(){
        if(disposed) return;
        mounted=true;
        if(listening) return;
        listening=true;
        deps.window.addEventListener('pagehide',suspend);
        deps.window.addEventListener('pageshow',mount);
    }
    function dispose(){
        suspend();disposed=true;
        if(listening){
            deps.window.removeEventListener('pagehide',suspend);
            deps.window.removeEventListener('pageshow',mount);
            listening=false;
        }
    }
    return {schedule,mount,suspend,dispose};
}

    const api={rememberInlineVideoActivations, render, moveNodeElementsDuringDrag, updateNodeElementDuringResize, syncSmartGroupMemberElements, createInteractionRefresh};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.SmartNodeView=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
