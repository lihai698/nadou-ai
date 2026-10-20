/* Generation log responsibility: smart-log. Host supplies live state and effects. */
(function(root){
    'use strict';

function addSmartGenerationLog(deps, {run, outputs=[], runMs=0, error=''}) {
    if(!deps.canvas) return;
    deps.canvas.logs = deps.canvas.logs || [];
    const outputItems = deps.resultMediaUrls(outputs).map(item => {
        if(typeof item === 'string') return {url:item};
        if(!item || typeof item !== 'object') return null;
        const url = item.url || item.path || item.src || item.uri || '';
        if(!url) return null;
        return deps.copyMediaSizeFields(item, {
            url,
            kind:item.kind || item.type || item.mediaKind || '',
            name:item.name || item.filename || ''
        });
    }).filter(item => item?.url);
    if(!error && outputItems.length) deps.playGenerationCompleteSound();
    const entry = {
        id:deps.uid('log'),
        createdAt:Date.now(),
        status:error ? 'failed' : 'success',
        platform:deps.smartRunPlatformLabel(run),
        nodeId:run?.nodeId || '',
        nodeType:run?.nodeType || 'smart-image',
        model:deps.smartRunTaskLabel(run),
        request:deps.smartRunRequestMeta(run),
        prompt:run?.prompt || '',
        outputs:outputItems,
        refs:run?.refs || [],
        runMs:Number(runMs || 0),
        error:error ? String(error) : ''
    };
    deps.canvas.logs = [entry, ...deps.canvas.logs].slice(0, 500);
    if(!error && deps.recoverStuckLoopOutputsFromLogs()) deps.render();
    deps.scheduleSave();
}

function smartLogOutputItem(deps, output){
    if(typeof output === 'string') return {url:output};
    if(!output || typeof output !== 'object') return null;
    const url = output.url || output.path || output.src || output.uri || '';
    if(!url) return null;
    return deps.copyMediaSizeFields(output, {
        url,
        kind:output.kind || output.type || output.mediaKind || '',
        name:output.name || output.filename || ''
    });
}

function normalizedSizeLabel(deps, value){
    const parsed = deps.parseSizeValue(value);
    const w = Number(parsed?.width || 0);
    const h = Number(parsed?.height || 0);
    return w > 0 && h > 0 ? `${Math.round(w)} x ${Math.round(h)}` : '';
}

function smartLogSizeSummary(deps, log, outputs=[]){
    const req = log?.request || {};
    const requestLabel = normalizedSizeLabel(deps, req.size || req.resolution || '');
    const actualLabels = [...new Set(outputs.map(deps.imageResolutionLabel).filter(Boolean))];
    if(!actualLabels.length) return '';
    const actualText = actualLabels.slice(0, 3).join(', ');
    const more = actualLabels.length > 3 ? ` +${actualLabels.length - 3}` : '';
    const actualLabel = `${actualText}${more}`;
    if(requestLabel && actualLabels.some(label => label !== requestLabel)){
        return `请求 ${requestLabel} / 实际 ${actualLabel}`;
    }
    return `实际 ${actualLabel}`;
}

function cleanupSmartLogPreviewNode(deps){
    if(deps.nodes.some(n => n.id === deps.SMART_LOG_PREVIEW_NODE_ID)) deps.nodes = deps.nodes.filter(n => n.id !== deps.SMART_LOG_PREVIEW_NODE_ID);
    if(deps.smartLogPreviewRestore){
        deps.selectedId = deps.smartLogPreviewRestore.selectedId;
        deps.selectedImage = deps.smartLogPreviewRestore.selectedImage;
        deps.smartLogPreviewRestore = null;
    }
}

function closeSmartLogLightbox(deps){
    const box = deps.document.getElementById('smartLogLightbox');
    if(!box) return;
    box.classList.remove('open');
    const img = box.querySelector('img');
    if(img){ img.onerror = null; img.removeAttribute('src'); }
}

function openSmartLogLightbox(deps, url, kind='image'){
    if(!url) return;
    if(kind === 'video' || deps.outputUrlLooksVideo(url)){ deps.window.open(deps.displayMediaUrl({url}), '_blank'); return; }
    let box = deps.document.getElementById('smartLogLightbox');
    if(!box){
        box = deps.document.createElement('div');
        box.id = 'smartLogLightbox';
        box.className = 'smart-log-lightbox';
        box.innerHTML = `<img alt="preview" draggable="false"><button class="smart-log-lightbox-close" type="button" aria-label="${deps.escapeAttr(deps.tr('common.close') || '关闭')}"><i data-lucide="x"></i></button>`;
        deps.document.body.appendChild(box);
        box.addEventListener('click', e => {
            if(e.target === box || e.target.closest('.smart-log-lightbox-close')) closeSmartLogLightbox(deps);
        });
    }
    const img = box.querySelector('img');
    // 原图加载失败时回退到缩略图同款的 media-preview 代理（PIL 渲染，对截断文件更宽容）。
    let triedFallback = false;
    img.onerror = () => {
        if(triedFallback) return;
        triedFallback = true;
        const fb = deps.smartMediaPreviewUrl({url}, 2048);
        if(fb && fb !== img.getAttribute('src')) img.src = fb;
    };
    img.src = deps.displayMediaUrl({url});
    box.classList.add('open');
    deps.refreshIcons();
}

function smartLogPreviewNode(deps, url, kind='image'){
    openSmartLogLightbox(deps, url, kind);
}

async function deleteCanvasLogEntry(deps, logId, deleteMedia=false){
    if(!deps.canvas || !deps.canvasId || !logId) return;
    const confirmText = deleteMedia ? deps.tr('canvas.deleteLogMediaConfirm') : deps.tr('canvas.deleteLogConfirm');
    if(!deps.confirm(confirmText)) return;
    try {
        if(deps.smartSaveScheduler.pending){
            deps.smartSaveScheduler.cancel();
            await deps.saveCanvas();
        }
        const res = await deps.fetch(`/api/canvases/${encodeURIComponent(deps.canvasId)}/logs/delete`, {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({
                log_id:logId,
                delete_unreferenced_media:deleteMedia,
                reset_referencing_nodes:deleteMedia,
                base_updated_at:Number(deps.canvas.updated_at || 0)
            })
        });
        const data = await res.json().catch(() => ({}));
        if(!res.ok) throw new Error(data.detail || deps.tr('canvas.logDeleteFailed'));
        deps.canvas.logs = data.canvas?.logs || (deps.canvas.logs || []).filter(item => item.id !== logId);
        if(data.canvas?.nodes){
            deps.canvas.nodes = data.canvas.nodes;
            deps.canvas.connections = data.canvas.connections || [];
            deps.nodes = deps.canvas.nodes;
            deps.render();
        }
        deps.canvas.updated_at = Number(data.canvas?.updated_at || deps.canvas.updated_at || Date.now());
        renderSmartCanvasLog(deps);
        const notes = [deps.tr('canvas.logDeleted')];
        if(data.removed_files?.length) notes.push(deps.tr('canvas.logMediaRemoved').replace('{n}', data.removed_files.length));
        if(data.reset_node_ids?.length) notes.push(deps.tr('canvas.logNodesReset').replace('{n}', data.reset_node_ids.length));
        if(data.skipped_referenced?.length) notes.push(deps.tr('canvas.logMediaReferenced').replace('{n}', data.skipped_referenced.length));
        deps.toast(notes.join(' · '));
    } catch(err) {
        deps.toast(err?.message || deps.tr('canvas.logDeleteFailed'));
    }
}

function renderSmartCanvasLog(deps){
    const logs = deps.canvas?.logs || [];
    deps.smartLogList.innerHTML = logs.length ? logs.map(log => {
        const outputs = (log.outputs || []).map((...args)=>smartLogOutputItem(deps, ...args)).filter(item => item?.url);
        const thumbs = outputs.slice(0, 8).map(item => {
            const safe = deps.escapeAttr(item.url);
            const kind = item.kind || (deps.outputUrlLooksVideo(item.url) ? 'video' : 'image');
            const label = deps.imageResolutionLabel(item);
            const attrs = `data-url="${safe}" data-kind="${deps.escapeAttr(kind)}" title="${deps.escapeAttr(label || 'output')}" alt="output"`;
            return kind === 'video' ? deps.smartVideoPreviewHtml(item, 256, attrs) : deps.smartPreviewImgHtml(item, 256, attrs);
        }).join('');
        const date = new Date(log.createdAt || Date.now()).toLocaleString(deps.window.StudioI18n?.lang() === 'en' ? 'en-US' : 'zh-CN');
        const req = log.request || {};
        const taskId = req.task_id || req.taskId || req.prompt_id || req.promptId || '';
        const backend = req.workflow_json || req.workflow || req.provider_id || req.providerId || req.backend || '';
        const sizeSummary = smartLogSizeSummary(deps, log, outputs);
        const subParts = [
            date,
            `${deps.window.StudioI18n?.lang() === 'en' ? 'outputs' : '输出'} ${outputs.length}`,
            sizeSummary,
            taskId ? `ID ${taskId}` : '',
            backend
        ].filter(Boolean);
        return `<div class="log-item ${log.status === 'failed' ? 'failed' : ''}" data-canvas-log-id="${deps.escapeAttr(log.id || '')}">
            <div class="log-main">
                <div class="log-meta">
                    <span class="log-chip ${log.status === 'failed' ? 'status-failed' : 'status-ok'}">${deps.escapeHtml(log.status === 'failed' ? deps.tr('canvas.failed') : deps.tr('canvas.success'))}</span>
                    <span class="log-chip">${deps.escapeHtml(log.platform || '-')}</span>
                    ${log.model ? `<span class="log-chip">${deps.escapeHtml(log.model)}</span>` : ''}
                    <span class="log-chip">${deps.escapeHtml(deps.formatRunDuration(log.runMs || 0))}</span>
                </div>
                <div class="log-subline">${subParts.map(part => `<span title="${deps.escapeAttr(part)}">${deps.escapeHtml(part)}</span>`).join('')}</div>
                ${log.error ? `<div class="log-error" title="${deps.escapeAttr(log.error)}" data-error="${deps.escapeAttr(log.error)}">${deps.escapeHtml(log.error)}</div>` : ''}
                <div class="log-prompt" title="${deps.escapeAttr(log.prompt || deps.tr('canvas.noPromptMeta'))}" data-prompt="${deps.escapeAttr(log.prompt || '')}">${deps.escapeHtml(log.prompt || deps.tr('canvas.noPromptMeta'))}</div>
                <div class="log-actions">
                    <button type="button" data-log-delete="record"><i data-lucide="list-x"></i><span>${deps.escapeHtml(deps.tr('canvas.deleteLog'))}</span></button>
                    <button type="button" class="danger" data-log-delete="media"><i data-lucide="trash-2"></i><span>${deps.escapeHtml(deps.tr('canvas.deleteLogAndMedia'))}</span></button>
                </div>
            </div>
            <div class="log-thumbs">${thumbs}</div>
        </div>`;
    }).join('') : `<div class="log-empty">${deps.escapeHtml(deps.tr('canvas.noLogs'))}</div>`;
    deps.bindSmartPreviewImageFallbacks(deps.smartLogList);
    deps.smartLogList.querySelectorAll('[data-url]').forEach(el => {
        el.onclick = e => {
            e.stopPropagation();
            smartLogPreviewNode(deps, el.dataset.url, el.dataset.kind || 'image');
        };
    });
    const bindLogCopy = (selector, key) => {
        deps.smartLogList.querySelectorAll(selector).forEach(el => {
            el.onclick = async e => {
                e.stopPropagation();
                const text = el.dataset[key] || '';
                const copied = await deps.copyTextToClipboard(text);
                const oldText = el.textContent;
                el.textContent = copied ? deps.tr('canvas.copied') : deps.tr('canvas.copyFailed');
                if(copied) el.classList.add('copied');
                deps.setTimeout(() => {
                    el.textContent = oldText;
                    el.classList.remove('copied');
                }, 900);
            };
        });
    };
    bindLogCopy('[data-prompt]', 'prompt');
    bindLogCopy('[data-error]', 'error');
    deps.smartLogList.querySelectorAll('[data-log-delete]').forEach(button => {
        button.onclick = e => {
            e.stopPropagation();
            const logId = button.closest('[data-canvas-log-id]')?.dataset.canvasLogId || '';
            deleteCanvasLogEntry(deps, logId, button.dataset.logDelete === 'media');
        };
    });
    deps.refreshIcons();
}

function openSmartCanvasLog(deps){
    if(!deps.canvas) return;
    renderSmartCanvasLog(deps);
    deps.smartLogModal.classList.add('open');
}

function closeSmartCanvasLog(deps){
    deps.smartLogModal.classList.remove('open');
}

    const api={addSmartGenerationLog, smartLogOutputItem, normalizedSizeLabel, smartLogSizeSummary, cleanupSmartLogPreviewNode, closeSmartLogLightbox, openSmartLogLightbox, smartLogPreviewNode, deleteCanvasLogEntry, renderSmartCanvasLog, openSmartCanvasLog, closeSmartCanvasLog};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.SmartLog=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
