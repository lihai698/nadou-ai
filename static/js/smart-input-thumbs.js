/* Canvas input presentation and prompt request assembly: smart-input-thumbs. Host supplies live state and effects. */
(function(root){
    'use strict';

function renderInputPromptPreview(deps, node){
    if(!deps.inputPromptPreview) return;
    const groupText = deps.isSmartGroupNode(node) ? deps.textForNode(node).trim() : '';
    const text = node ? [groupText, deps.inputPromptTextFor(node).trim()].filter(Boolean).join('\n\n') : '';
    deps.inputPromptPreview.classList.toggle('has-text', Boolean(text));
    deps.inputPromptPreview.innerHTML = text
        ? `<div class="input-prompt-preview-label">${deps.escapeHtml(deps.tr('smart.inputUpstream'))}</div><div class="input-prompt-preview-text">${deps.escapeHtml(text)}</div>`
        : '';
}

function renderInputThumbsRow(deps, node){
    if(!deps.inputThumbsRow) return;
    deps.syncJimengModelPillForRefs();
    deps.syncJimengVideoModelPillForRefs();
    const dedup = node ? deps.visibleReferenceImagesFor(node) : [];
    const manualRefKeys = new Set(deps.manualReferenceImagesFor(node).map(img => deps.inputRefKey(img)));
    const addActive = deps.mentionInsertMode === 'manual-ref';
    // 仅当参考图集合/状态真正变化时才重建缩略图 DOM。否则每敲一个字都重建并重新解码所有图片，
    // 参考图多时会让输入框打字明显卡顿。
    const thumbsSignature = JSON.stringify({
        node: node?.id || '',
        items: dedup.map(img => `${deps.inputRefKey(img)}@${img.url || ''}`),
        manual: [...manualRefKeys],
        add: addActive,
        mode: node ? deps.smartImageMode(node) : ''
    });
    if(deps.inputThumbsRow.dataset.thumbsSig === thumbsSignature) return;
    deps.inputThumbsRow.dataset.thumbsSig = thumbsSignature;
    deps.inputThumbsRow.classList.toggle('has-items', Boolean(node));
    if(!node){ deps.inputThumbsRow.innerHTML = ''; return; }
    const addButton = `<button class="input-thumb-add ${addActive ? 'active' : ''}" type="button" data-input-add-reference title="${deps.escapeHtml(addActive ? '收起参考图' : '添加参考图')}" aria-label="${deps.escapeHtml(addActive ? '收起参考图' : '添加参考图')}"><i data-lucide="image-plus"></i></button>`;
    if(!dedup.length){
        deps.inputThumbsRow.innerHTML = `<div class="input-thumb-list empty"></div><div class="input-thumb-actions">${addButton}</div>`;
        bindInputThumbReferenceActions(deps);
        deps.refreshIcons();
        return;
    }
    const mediaCounters = {image:0, video:0, audio:0, text:0, file:0};
    const thumbsHtml = dedup.map((img, i) => {
        const isVid = deps.isVideoMediaItem(img);
        const kind = deps.mediaKindForItem(img);
        const isSelf = node ? deps.isSelfReferenceForNode(node, img) : false;
        const title = isSelf
            ? deps.tr('smart.inputSelf')
            : (deps.smartImageMode(node) === 'workflow' ? deps.tr('smart.inputUpstreamWorkflow') : deps.tr('smart.inputUpstream'));
        const inner = kind === 'audio'
            ? `<div class="input-thumb-audio"><i data-lucide="file-audio"></i></div>`
            : isVid
            ? deps.smartVideoPreviewHtml(img, 256, 'draggable="false" alt=""')
            : deps.smartPreviewImgHtml(img, 256, 'draggable="false"');
        const count = (mediaCounters[kind] = (mediaCounters[kind] || 0) + 1);
        const label = kind === 'audio' ? `音频${count}` : kind === 'video' ? `视频${count}` : `图${count}`;
        const sourceUrl = img.originalLocalUrl || img.url || '';
        const key = deps.inputRefKey(img);
        const removable = manualRefKeys.has(key);
        const removeBtn = removable ? `<button class="input-thumb-remove" type="button" data-input-remove-reference="${deps.escapeHtml(deps.inputRefKey(img))}" title="删除参考图" aria-label="删除参考图">×</button>` : '';
        return `<div class="input-thumb ${isSelf ? 'input-self' : ''} ${removable ? 'input-manual-ref' : ''}" draggable="false" data-thumb-index="${i}" data-node-id="${deps.escapeHtml(img.nodeId || '')}" data-image-index="${img.imageIndex ?? ''}" data-url="${deps.escapeHtml(img.url || '')}" data-source-url="${deps.escapeHtml(sourceUrl)}" title="${deps.escapeHtml(`${img.name || deps.tr('smart.inputNum').replace('{n}', String(i + 1))} · ${title}`)}">${inner}<span class="input-thumb-label">${deps.escapeHtml(label)}</span>${removeBtn}</div>`;
    }).join('');
    deps.inputThumbsRow.innerHTML = `<div class="input-thumb-list">${thumbsHtml}${dedup.length > 1 ? `<span class="input-thumb-count">${deps.escapeHtml(deps.tr('smart.inputCount').replace('{n}', String(dedup.length)))}</span>` : ''}</div><div class="input-thumb-actions">${addButton}</div>`;
    deps.bindSmartPreviewImageFallbacks(deps.inputThumbsRow);
    bindInputThumbsDrag(deps, node, dedup, manualRefKeys);
    bindInputThumbReferenceActions(deps);
    deps.refreshIcons();
}

function bindInputThumbReferenceActions(deps){
    deps.inputThumbsRow?.querySelectorAll('[data-input-add-reference]').forEach(btn => {
        btn.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            deps.toggleAssetMentionPickerFromThumbs();
        });
    });
    deps.inputThumbsRow?.querySelectorAll('[data-input-remove-reference]').forEach(btn => {
        btn.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            deps.removeManualReferenceFromSelectedNode(btn.dataset.inputRemoveReference || '');
        });
    });
}

function bindInputThumbsDrag(deps, node, items, manualRefKeys=new Set()){
    if(!deps.inputThumbsRow) return;
    let thumbDragIndex = -1;
    deps.inputThumbsRow.querySelectorAll('.input-thumb').forEach(el => {
        const index = Number(el.dataset.thumbIndex || -1);
        const item = items[index];
        const key = deps.inputRefKey(item);
        const canReorderManual = items.length > 1 && manualRefKeys.has(key);
        const canReorderSource = items.length > 1 && Boolean(item?.nodeId);
        el.draggable = canReorderManual || canReorderSource;
        el.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
        });
        if(!el.draggable) return;
        el.addEventListener('dragstart', e => {
            e.stopPropagation();
            thumbDragIndex = index;
            el.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            if(canReorderManual) e.dataTransfer.setData('application/x-smart-manual-ref', key);
            else e.dataTransfer.setData('application/x-smart-input-thumb', String(index));
        });
        el.addEventListener('dragend', e => {
            e.stopPropagation();
            thumbDragIndex = -1;
            clearInputThumbDropMarkers(deps);
            el.classList.remove('dragging');
        });
        el.addEventListener('dragover', e => {
            const manualFromKey = e.dataTransfer.getData('application/x-smart-manual-ref');
            if(manualFromKey){
                if(!manualRefKeys.has(key) || manualFromKey === key) return;
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = 'move';
                clearInputThumbDropMarkers(deps);
                const placement = inputThumbDropPlacement(deps, el, e);
                el.dataset.dropPlacement = placement;
                el.classList.add(placement === 'before' ? 'drop-before' : 'drop-after');
                return;
            }
            const rawFrom = e.dataTransfer.getData('application/x-smart-input-thumb');
            const from = rawFrom === '' ? thumbDragIndex : Number(rawFrom);
            if(!Number.isFinite(from) || from < 0 || from === index || !items[index]?.nodeId) return;
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'move';
            clearInputThumbDropMarkers(deps);
            const placement = inputThumbDropPlacement(deps, el, e);
            el.dataset.dropPlacement = placement;
            el.classList.add(placement === 'before' ? 'drop-before' : 'drop-after');
        });
        el.addEventListener('dragleave', e => {
            if(el.contains(e.relatedTarget)) return;
            delete el.dataset.dropPlacement;
            el.classList.remove('drop-before', 'drop-after');
        });
        el.addEventListener('drop', e => {
            const manualFromKey = e.dataTransfer.getData('application/x-smart-manual-ref');
            if(manualFromKey){
                if(!manualRefKeys.has(key) || manualFromKey === key) return;
                e.preventDefault();
                e.stopPropagation();
                const placement = inputThumbDropPlacement(deps, el, e);
                clearInputThumbDropMarkers(deps);
                reorderManualInputRefs(deps, node, manualFromKey, key, placement);
                return;
            }
            const rawFrom = e.dataTransfer.getData('application/x-smart-input-thumb');
            const from = rawFrom === '' ? thumbDragIndex : Number(rawFrom);
            if(!Number.isFinite(from) || from < 0 || from === index || !items[index]?.nodeId) return;
            e.preventDefault();
            e.stopPropagation();
            const placement = inputThumbDropPlacement(deps, el, e);
            clearInputThumbDropMarkers(deps);
            reorderInputThumb(deps, node, items, from, index, placement);
        });
    });
}

function reorderManualInputRefs(deps, currentNode, fromKey, targetKey, placement='before'){
    if(!currentNode || !fromKey || !targetKey || fromKey === targetKey) return false;
    const refs = Array.isArray(currentNode.manualInputRefs) ? currentNode.manualInputRefs.slice() : [];
    const from = refs.findIndex(item => deps.inputRefKey(item) === fromKey);
    const target = refs.findIndex(item => deps.inputRefKey(item) === targetKey);
    if(from < 0 || target < 0 || from === target) return false;
    deps.pushUndo();
    const [moved] = refs.splice(from, 1);
    let insertAt = refs.findIndex(item => deps.inputRefKey(item) === targetKey);
    if(insertAt < 0) return false;
    if(placement === 'after') insertAt += 1;
    refs.splice(insertAt, 0, moved);
    currentNode.manualInputRefs = refs;
    if(deps.inputThumbsRow) delete deps.inputThumbsRow.dataset.thumbsSig;
    renderInputThumbsRow(deps, currentNode);
    deps.scheduleSave();
    return true;
}

function inputThumbDropPlacement(deps, el, event){
    const rect = el.getBoundingClientRect();
    return event.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
}

function clearInputThumbDropMarkers(deps){
    deps.inputThumbsRow?.querySelectorAll('.input-thumb.drop-before,.input-thumb.drop-after,.input-thumb.dragging')
        .forEach(el => {
            delete el.dataset.dropPlacement;
            el.classList.remove('drop-before', 'drop-after', 'dragging');
        });
}

function bindInputThumbVideoActions(deps){
    deps.inputThumbsRow?.querySelectorAll('[data-manual-video-url]').forEach(btn => {
        btn.onclick = async event => {
            event.preventDefault();
            event.stopPropagation();
            try {
                await deps.setCurrentSmartManualVideoUrl();
            } catch(e) {
                deps.toast((e.message || '设置视频网址失败').slice(0, 180));
            }
        };
    });
    deps.inputThumbsRow?.querySelectorAll('[data-temp-sh-upload-video]').forEach(btn => {
        btn.onclick = async event => {
            event.preventDefault();
            event.stopPropagation();
            try {
                await deps.uploadCurrentSmartVideosToCloud();
            } catch(e) {
                deps.toast((e.message || '云端上传失败').slice(0, 180));
            }
        };
    });
}

function movedBeforeAfterIds(deps, ids, movedId, targetId, placement='before'){
    const list = (ids || []).filter(Boolean);
    const from = list.indexOf(movedId);
    const target = list.indexOf(targetId);
    if(from < 0 || target < 0 || movedId === targetId) return list;
    const [moved] = list.splice(from, 1);
    let insertAt = list.indexOf(targetId);
    if(insertAt < 0) return ids || [];
    if(placement === 'after') insertAt += 1;
    list.splice(insertAt, 0, moved);
    return list;
}

function sameOrderedIds(deps, a, b){
    if((a || []).length !== (b || []).length) return false;
    return (a || []).every((id, index) => id === b[index]);
}

function reorderInputSourceNodes(deps, currentNode, movedId, targetId, placement='before'){
    if(!currentNode || !movedId || !targetId || movedId === targetId) return false;
    const sourceNodes = deps.smartImageUsesWorkflowInput(currentNode, deps.smartLoopContext)
        ? deps.workflowInputNodesFor(currentNode)
        : deps.inputNodesFor(currentNode);
    const sourceIds = sourceNodes.map(n => n.id).filter(Boolean);
    if(!sourceIds.includes(movedId) || !sourceIds.includes(targetId)) return false;
    const nextIds = movedBeforeAfterIds(deps, sourceIds, movedId, targetId, placement);
    if(sameOrderedIds(deps, sourceIds, nextIds)) return false;
    const oldExplicitIds = Array.isArray(currentNode.inputNodeIds) ? currentNode.inputNodeIds.filter(Boolean) : [];
    currentNode.inputNodeIds = [
        ...nextIds.filter(id => oldExplicitIds.includes(id)),
        ...oldExplicitIds.filter(id => !nextIds.includes(id))
    ];
    if(deps.canvas && Array.isArray(deps.canvas.connections)){
        const order = new Map(nextIds.map((id, index) => [id, index]));
        const relevantSlots = new Set();
        const relevant = [];
        deps.canvas.connections.forEach((conn, index) => {
            const kind = conn?.kind || 'flow';
            if(conn?.to === currentNode.id && ['input', 'flow'].includes(kind) && order.has(conn.from)){
                relevantSlots.add(index);
                relevant.push({conn, index});
            }
        });
        if(relevant.length){
            relevant.sort((a, b) => (order.get(a.conn.from) - order.get(b.conn.from)) || (a.index - b.index));
            let cursor = 0;
            deps.canvas.connections = deps.canvas.connections.map((conn, index) => relevantSlots.has(index) ? relevant[cursor++].conn : conn);
        }
    }
    return true;
}

function reorderInputThumb(deps, currentNode, items, from, to, placement='before'){
    // items are already sourced from inputImagesFor → multiple source nodes possible.
    // Reorder within a source group's images first; separate input nodes use the
    // current node's input order, with a visual-position swap as a final fallback.
    if(from < 0 || to < 0 || from >= items.length || to >= items.length) return;
    // 强制让缩略图条在重排后重建（绕过 renderInputThumbsRow 的“无变化跳过”缓存），否则顺序看起来没变。
    if(deps.inputThumbsRow) delete deps.inputThumbsRow.dataset.thumbsSig;
    const fromImg = items[from];
    const toImg = items[to];
    if(!fromImg || !toImg) return;
    if(fromImg.nodeId === toImg.nodeId){
        const src = deps.nodes.find(n => n.id === fromImg.nodeId);
        if(!src) return;
        deps.pushUndo();
        const fi = Number(fromImg.imageIndex);
        const ti = Number(toImg.imageIndex);
        if(Number.isFinite(fi) && Number.isFinite(ti) && (src.images || [])[fi]){
            const arr = src.images;
            let insertAt = Math.max(0, Math.min(arr.length, ti + (placement === 'after' ? 1 : 0)));
            const item = arr.splice(fi, 1)[0];
            if(fi < insertAt) insertAt -= 1;
            arr.splice(Math.max(0, Math.min(arr.length, insertAt)), 0, item);
        }
        deps.render();
        deps.scheduleSave();
        return;
    }
    // 分组：缩略图来自各成员节点，跨成员拖动应改变 group.items 的成员顺序（= 图1234 的编号顺序），
    // 而不是去交换节点的画布位置（那只改了图层上下层级）。
    if(deps.isSmartGroupNode(currentNode) && Array.isArray(currentNode.items)
        && fromImg.nodeId !== toImg.nodeId
        && currentNode.items.includes(fromImg.nodeId) && currentNode.items.includes(toImg.nodeId)){
        const next = movedBeforeAfterIds(deps, currentNode.items.slice(), fromImg.nodeId, toImg.nodeId, placement);
        if(!sameOrderedIds(deps, currentNode.items, next)){
            deps.pushUndo();
            currentNode.items = next;
            if(deps.inputThumbsRow) delete deps.inputThumbsRow.dataset.thumbsSig;
            deps.render();
            deps.scheduleSave();
        }
        return;
    }
    const canReorderSources = currentNode && fromImg.nodeId && toImg.nodeId;
    const a = deps.nodes.find(n => n.id === fromImg.nodeId);
    const b = deps.nodes.find(n => n.id === toImg.nodeId);
    if(!canReorderSources || !a || !b) return;
    deps.pushUndo();
    if(reorderInputSourceNodes(deps, currentNode, fromImg.nodeId, toImg.nodeId, placement)){
        deps.render();
        deps.scheduleSave();
        return;
    }
    // Cross-node fallback: swap X positions of source nodes
    const ax = a.x, ay = a.y;
    a.x = b.x; a.y = b.y;
    b.x = ax; b.y = ay;
    deps.render();
    deps.scheduleSave();
}

    const api={renderInputPromptPreview, renderInputThumbsRow, bindInputThumbReferenceActions, bindInputThumbsDrag, reorderManualInputRefs, inputThumbDropPlacement, clearInputThumbDropMarkers, bindInputThumbVideoActions, movedBeforeAfterIds, sameOrderedIds, reorderInputSourceNodes, reorderInputThumb};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.SmartInputThumbs=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
