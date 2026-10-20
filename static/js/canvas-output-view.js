/* Classic output view responsibility: canvas-output-view. Host supplies live state and effects. */
(function(root){
    'use strict';

function pendingOutputStyle(deps, pending){
    const size = deps.normalizedPendingPreviewSize(pending?.previewSize);
    if(!size) return '';
    return ` style="aspect-ratio:${Math.max(1, size.w)}/${Math.max(1, size.h)}"`;
}

function renderPendingOutput(deps, pending){
    if(pending?.failed || pending?.queryPaused){
        const taskId = pending.taskLost ? pending.canvasTaskId : pending.queryPaused ? pending.canvasTaskId : pending.recoverTaskId || '';
        const querying = Boolean(pending.querying);
        const remoteRefreshable = Boolean(pending.remoteRefreshable && pending.canvasTaskId);
        const msg = pending.error || deps.tr('canvas.generationFailed');
        const sub = taskId ? `任务 ID：${deps.escapeHtml(taskId)}` : '没有任务 ID，无法查询';
        return `<div class="output-img-wrap loading-wrap recoverable" data-pending-id="${deps.escapeAttr(pending.id)}"${pendingOutputStyle(deps, pending)}>
            <span class="output-time-pill failed">${pending.savePending ? '保存待重试' : pending.queryPaused ? '查询暂停' : '失败'}</span>
            <div class="output-recover-state">
                <i data-lucide="refresh-cw" class="${querying ? 'spinning' : ''}"></i>
                <div class="output-recover-title">${querying ? '查询中' : remoteRefreshable ? '远端状态未知' : pending.taskLost ? '本地任务记录已失效' : pending.savePending ? '编号未保存，未重新生成' : pending.queryPaused ? '暂时无法查询，未重新生成' : '任务未丢失'}</div>
                <div class="output-recover-sub" title="${deps.escapeAttr(msg)}">${pending.taskLost ? deps.escapeHtml(msg) : sub}</div>
                <button class="output-recover-query" type="button" ${taskId && !querying && (!pending.taskLost || remoteRefreshable) ? '' : 'disabled'}>${querying ? '查询中...' : remoteRefreshable ? '刷新远端结果' : pending.savePending ? '保存并查询' : '查询结果'}</button>
            </div>
            <button class="output-del" title="${deps.tr('common.delete')}">×</button>
        </div>`;
    }
    return `<div class="output-img-wrap loading-wrap" data-pending-id="${deps.escapeAttr(pending.id)}"${pendingOutputStyle(deps, pending)}><span class="output-time-pill running">${deps.formatRunDuration(deps.nowMs() - Number(pending.startedAt || deps.nowMs()))}</span><div class="output-spinner"></div><button class="output-del" title="${deps.tr('common.delete')}">×</button></div>`;
}

function captureOutputScrolls(deps){
    const state = new Map();
    // output 节点滚动位置
    deps.nodesEl.querySelectorAll('.output-node').forEach(el => {
        const body = el.querySelector('.node-body');
        if(body) state.set('out:' + el.dataset.id, { top:body.scrollTop, left:body.scrollLeft });
    });
    // LLM 聊天日志滚动位置（记录是否在底部，以便恢复时保持底部）
    deps.nodesEl.querySelectorAll('.llm-node').forEach(el => {
        const log = el.querySelector('.llm-chat-log');
        if(!log) return;
        const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 12;
        state.set('llm:' + el.dataset.id, { top:log.scrollTop, atBottom });
    });
    return state;
}

function restoreOutputScrolls(deps, state){
    deps.requestAnimationFrame(() => {
        state.forEach((pos, key) => {
            if(key.startsWith('out:')){
                const id = key.slice(4);
                const body = deps.nodesEl.querySelector(`.output-node[data-id="${deps.CSS.escape(id)}"] .node-body`);
                if(body){ body.scrollTop = pos.top || 0; body.scrollLeft = pos.left || 0; }
            } else if(key.startsWith('llm:')){
                const id = key.slice(4);
                const log = deps.nodesEl.querySelector(`.llm-node[data-id="${deps.CSS.escape(id)}"] .llm-chat-log`);
                if(log){
                    // 之前在底部 → 保持底部（显示最新消息）；否则恢复原位
                    log.scrollTop = pos.atBottom ? log.scrollHeight : (pos.top || 0);
                }
            }
        });
    });
}

function bindOutputWrap(deps, wrap, node){
    const img = wrap.querySelector('img');
    const video = wrap.querySelector('video');
    const audio = wrap.querySelector('audio');
    const fileCard = wrap.querySelector('.output-file-card');
    const playBtn = wrap.querySelector('.canvas-video-play');
    const depthEdit = wrap.querySelector('.output-depth-edit');
    const del = wrap.querySelector('.output-del');
    const recoverQuery = wrap.querySelector('.output-recover-query');
    const outputDragUrl = () => img?.dataset.url || video?.dataset.url || audio?.dataset.url || wrap.dataset.outputUrl || '';
    wrap.draggable = Boolean(outputDragUrl());
    wrap.ondragstart = e => {
        const url = outputDragUrl();
        if(!url || e.target.closest('button,audio,video')) return;
        e.stopPropagation();
        wrap.dataset.dragging = '1';
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('application/x-canvas-output-image', url);
        e.dataTransfer.setData('text/uri-list', url);
        e.dataTransfer.setData('text/plain', url);
        if(img) setOutputDragPreview(deps, e, img);
    };
    wrap.ondragend = () => deps.setTimeout(() => { delete wrap.dataset.dragging; }, 0);
    if(img){
        img.draggable = true;
        img.ondragstart = e => {
            e.stopPropagation();
            img.dataset.dragging = '1';
            setOutputDragPreview(deps, e, img);
            e.dataTransfer.effectAllowed = 'copy';
            e.dataTransfer.setData('application/x-canvas-output-image', img.dataset.url);
            e.dataTransfer.setData('text/uri-list', img.dataset.url);
        };
        img.ondragend = () => deps.setTimeout(() => { delete img.dataset.dragging; }, 0);
        img.onclick = e => {
            e.stopPropagation();
            if(img.dataset.dragging || wrap.dataset.dragging) return;
            deps.openOutputLightbox(img.dataset.url, node);
        };
    }
    wrap.addEventListener('click', e => {
        const fallbackVideo = e.target.closest?.('video[data-output-video-fallback]');
        if(!fallbackVideo || !wrap.contains(fallbackVideo)) return;
        e.stopPropagation();
        deps.openOutputLightbox(fallbackVideo.dataset.url, node);
    });
    if(video){
        video.onclick = e => {
            e.stopPropagation();
            deps.openOutputLightbox(video.dataset.url, node);
        };
    }
    if(depthEdit){
        depthEdit.onmousedown = e => e.stopPropagation();
        depthEdit.onclick = e => {
            e.stopPropagation();
            const url = outputDragUrl();
            if(url) deps.openCanvasVideoEditor(node.id, url, deps.outputImageName(url));
        };
    }
    if(fileCard){
        fileCard.onclick = e => {
            e.stopPropagation();
            const url = wrap.dataset.outputUrl;
            if(url) deps.downloadUrl(url, deps.outputDownloadName(url)).catch(err => deps.alert(err.message || '下载失败'));
        };
    }
    if(del){
        del.onmousedown = e => e.stopPropagation();
        del.onclick = e => {
            e.stopPropagation();
            const pid = wrap.dataset.pendingId;
            if(pid){
                node._pending = (node._pending || []).filter(p => p.id !== pid);
            } else {
                const url = img?.dataset.url || video?.dataset.url || audio?.dataset.url || wrap.dataset.outputUrl || wrap.dataset.missingUrl || '';
                node.images = (node.images || []).filter(item => deps.outputUrlValue(item) !== url);
                if(node.imageComparisons) delete node.imageComparisons[url];
                deps.scheduleSave();
            }
            deps.refreshNodes([node.id]);
        };
    }
    if(playBtn && img){
        playBtn.onmousedown = e => {
            e.preventDefault();
            e.stopPropagation();
        };
        playBtn.onclick = e => {
            e.preventDefault();
            e.stopPropagation();
            deps.canvasActivateVideoPreview(wrap);
        };
    }
    if(recoverQuery){
        recoverQuery.onmousedown = e => e.stopPropagation();
        recoverQuery.onclick = e => {
            e.preventDefault();
            e.stopPropagation();
            const pid = wrap.dataset.pendingId;
            const pending = deps.pendingById(node, pid);
            if(pending?.canvasTaskType === 'video' && pending.canvasTaskId && (pending.queryPaused || pending.remoteRefreshable)){
                deps.saveAndQueryCanvasPendingTask(pending);
            } else if(pending?.canvasTaskType === 'online-image' && pending.canvasTaskId && pending.remoteRefreshable){
                deps.refreshCanvasImagePending(pending);
            } else if(pid) deps.queryRecoverPendingOutput(pid);
        };
    }
}

function outputDomKeyForItem(deps, item){
    return `url:${deps.outputUrlValue(item)}`;
}

function outputDomKeyForPending(deps, pending){
    return `pending:${pending?.id || ''}`;
}

function refreshOutputNodeContent(deps, node){
    const el = deps.nodesEl.querySelector(`.output-node[data-id="${deps.CSS.escape(node.id)}"]`);
    const body = el?.querySelector('.node-body');
    const grid = body?.querySelector('.output-grid');
    if(!body || !grid) return false;
    body.onwheel = e => { e.stopPropagation(); };
    const layout = outputGridLayout(deps, node);
    grid.classList.toggle('grid-layout', !!layout);
    if(layout) grid.style.setProperty('--grid-cols', String(Math.max(1, Number(layout.cols || 1))));
    else grid.style.removeProperty('--grid-cols');
    const items = [
        ...(node.images || []).map(item => ({
            key:outputDomKeyForItem(deps, item),
            html:renderOutputMedia(deps, item, !!layout)
        })),
        ...(node._pending || []).map(p => ({
            key:outputDomKeyForPending(deps, p),
            html:renderPendingOutput(deps, p)
        }))
    ];
    const wanted = new Set(items.map(item => item.key));
    [...grid.children].forEach(child => {
        const key = child.dataset.pendingId ? outputDomKeyForPending(deps, {id:child.dataset.pendingId}) : `url:${child.dataset.outputUrl || child.dataset.missingUrl || child.querySelector('img,video,audio')?.dataset.url || ''}`;
        if(!wanted.has(key)) child.remove();
        else child.dataset.outputKey = key;
    });
    items.forEach(item => {
        let child = [...grid.children].find(el => el.dataset.outputKey === item.key);
        if(!child){
            grid.insertAdjacentHTML('beforeend', item.html);
            child = grid.lastElementChild;
            child.dataset.outputKey = item.key;
            child.dataset.outputHtml = item.html;
            bindOutputWrap(deps, child, node);
        } else if(item.key.startsWith('pending:') && child.dataset.outputHtml !== item.html){
            const tpl = deps.document.createElement('template');
            tpl.innerHTML = item.html.trim();
            const fresh = tpl.content.firstElementChild;
            if(fresh){
                fresh.dataset.outputKey = item.key;
                fresh.dataset.outputHtml = item.html;
                child.replaceWith(fresh);
                child = fresh;
                bindOutputWrap(deps, child, node);
            }
        }
        grid.appendChild(child);
    });
    deps.bindCanvasPreviewImageFallbacks(grid);
    deps.syncCanvasSelectedImageResolution(el);
    deps.refreshOutputTimer();
    return true;
}

function renderOutputMedia(deps, item, useGridLayout=false){
    const url = deps.outputUrlValue(item);
    const safe = deps.escapeAttr(url);
    const meta = item && typeof item === 'object' ? item : {};
    const kind = deps.mediaKindForOutputItem(item);
    const grid = useGridLayout ? (meta.grid || null) : null;
    const gridStyle = grid ? ` style="grid-row:${Number(grid.row || 0) + 1};grid-column:${Number(grid.col || 0) + 1};aspect-ratio:${Math.max(1, Number(grid.w || 1))}/${Math.max(1, Number(grid.h || 1))}"` : '';
    const timePill = meta.runMs && !meta.viewed ? `<span class="output-time-pill">${deps.formatRunDuration(meta.runMs)}</span>` : '';
    if(deps.isMissingAssetUrl(url)){
        return `<div class="output-img-wrap" data-output-url="${safe}" data-missing-url="${safe}"${gridStyle}>${deps.missingAssetHtml(url, true)}${timePill}<button class="output-del" title="${deps.tr('common.delete')}">×</button></div>`;
    }
    if(kind === 'video'){
        return `<div class="output-img-wrap" data-output-url="${safe}"${gridStyle}>${deps.canvasVideoPreviewHtml(url, useGridLayout ? 512 : 768, 'alt="video output" data-video-fallback-attrs="controls data-output-video-fallback=&quot;1&quot;"')}${timePill}<button class="canvas-video-play output-video-play" type="button" title="播放"><i data-lucide="play"></i></button><div class="output-video-badge"><i data-lucide="play" class="w-3 h-3"></i>VIDEO</div><button class="output-depth-edit" type="button" title="编辑视频">编辑</button><button class="output-del" title="${deps.tr('common.delete')} ">×</button></div>`;
    }
    if(kind === 'audio'){
        return `<div class="output-img-wrap output-audio-wrap" data-output-url="${safe}"${gridStyle}><div class="output-audio-card"><i data-lucide="file-audio" class="w-7 h-7"></i><span>${deps.escapeHtml(deps.outputImageName(url))}</span><audio src="${safe}" data-url="${safe}" controls preload="metadata"></audio></div>${timePill}<button class="output-del" title="${deps.tr('common.delete')}">×</button></div>`;
    }
    if(kind === 'text' || kind === 'file'){
        const icon = kind === 'text' ? 'file-text' : 'file';
        const label = kind === 'text' ? 'TEXT' : 'FILE';
        return `<div class="output-img-wrap output-file-wrap" data-output-url="${safe}"${gridStyle}><div class="output-file-card"><i data-lucide="${icon}" class="w-7 h-7"></i><span>${deps.escapeHtml(meta.name || deps.outputImageName(url))}</span><small>${label}</small></div>${timePill}<button class="output-del" title="${deps.tr('common.delete')}">×</button></div>`;
    }
    return `<div class="output-img-wrap" data-output-url="${safe}"${gridStyle}>${deps.canvasPreviewImgHtml(url, useGridLayout ? 512 : 768, 'alt="generated output"')}${timePill}<button class="output-del" title="${deps.tr('common.delete')}">×</button></div>`;
}

function outputGridLayout(deps, node){
    const images = node?.images || [];
    if(!images.length || node?._pending?.length) return null;
    const layout = node.outputLayout;
    if(!layout || layout.type !== 'grid-split' || !layout.groupId) return null;
    const allMatch = images.every(item => item && typeof item === 'object' && item.grid?.groupId === layout.groupId);
    return allMatch ? layout : null;
}

function renderOutputGrid(deps, node, pendingHtml=''){
    const layout = outputGridLayout(deps, node);
    const gridClass = layout ? 'output-grid grid-layout' : 'output-grid';
    const style = layout ? ` style="--grid-cols:${Math.max(1, Number(layout.cols || 1))}"` : '';
    return `<div class="${gridClass}"${style}>${(node.images || []).map(item => renderOutputMedia(deps, item, !!layout)).join('')}${pendingHtml}</div>`;
}

function setOutputDragPreview(deps, event, img){
    if(!event.dataTransfer || !img) return;
    const wrap = deps.document.createElement('div');
    wrap.className = 'output-drag-preview';
    const clone = img.cloneNode();
    clone.removeAttribute('id');
    wrap.appendChild(clone);
    deps.document.body.appendChild(wrap);
    const rect = img.getBoundingClientRect();
    event.dataTransfer.setDragImage(wrap, Math.min(rect.width / 2, 120), Math.min(rect.height / 2, 120));
    deps.setTimeout(() => wrap.remove(), 0);
}

    const api={pendingOutputStyle, renderPendingOutput, captureOutputScrolls, restoreOutputScrolls, bindOutputWrap, outputDomKeyForItem, outputDomKeyForPending, refreshOutputNodeContent, renderOutputMedia, outputGridLayout, renderOutputGrid, setOutputDragPreview};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.CanvasOutputView=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
