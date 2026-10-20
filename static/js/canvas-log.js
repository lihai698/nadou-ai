/* Generation log responsibility: canvas-log. Host supplies live state and effects. */
(function(root){
    'use strict';

function logTaskLabel(deps, log){
    const req = log?.request || {};
    if(log?.platform === 'ComfyUI'){
        const byWorkflow = deps.comfyLabelFromWorkflow(req.workflow_json || req.workflow);
        if(byWorkflow) return byWorkflow;
    }
    return log?.model || '-';
}

async function deleteCanvasLogEntry(deps, logId, deleteMedia=false){
    if(!deps.canvas || !logId) return;
    const confirmText = deleteMedia ? deps.tr('canvas.deleteLogMediaConfirm') : deps.tr('canvas.deleteLogConfirm');
    if(!deps.confirm(confirmText)) return;
    try {
        if(deps.localCanvasDirty || deps.classicSaveScheduler.pending){
            deps.classicSaveScheduler.cancel();
            await deps.saveCanvas();
        }
        const res = await deps.fetch(`/api/canvases/${encodeURIComponent(deps.canvas.id)}/logs/delete`, {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({
                log_id:logId,
                delete_unreferenced_media:deleteMedia,
                reset_referencing_nodes:deleteMedia,
                base_updated_at:Number(deps.canvas.updated_at || deps.lastCanvasUpdatedAt || 0)
            })
        });
        const data = await res.json().catch(() => ({}));
        if(!res.ok) throw new Error(data.detail || deps.tr('canvas.logDeleteFailed'));
        deps.canvas.logs = data.canvas?.logs || (deps.canvas.logs || []).filter(item => item.id !== logId);
        if(data.canvas?.nodes){
            deps.canvas.nodes = data.canvas.nodes;
            deps.canvas.connections = data.canvas.connections || [];
            deps.nodes = deps.canvas.nodes;
            deps.connections = deps.canvas.connections;
            deps.render();
        }
        deps.canvas.updated_at = Number(data.canvas?.updated_at || deps.canvas.updated_at || Date.now());
        deps.lastCanvasUpdatedAt = deps.canvas.updated_at;
        renderCanvasLog(deps);
        const notes = [deps.tr('canvas.logDeleted')];
        if(data.removed_files?.length) notes.push(deps.tr('canvas.logMediaRemoved').replace('{n}', data.removed_files.length));
        if(data.reset_node_ids?.length) notes.push(deps.tr('canvas.logNodesReset').replace('{n}', data.reset_node_ids.length));
        if(data.skipped_referenced?.length) notes.push(deps.tr('canvas.logMediaReferenced').replace('{n}', data.skipped_referenced.length));
        deps.setStatus(notes.join(' · '));
    } catch(err) {
        deps.setStatus(err?.message || deps.tr('canvas.logDeleteFailed'));
    }
}

function addGenerationLog(deps, {run, outputs=[], runMs=0, error=''}) {
    if(!deps.canvas) return;
    deps.canvas.logs = deps.canvas.logs || [];
    if(!error && (outputs || []).some(item => deps.outputUrlValue(item))) deps.playGenerationCompleteSound();
    const entry = {
        id:deps.uid('log'),
        createdAt:Date.now(),
        status:error ? 'failed' : 'success',
        platform:deps.runPlatformLabel(run),
        nodeType:run?.nodeType || '',
        model:run?.taskLabel || deps.runTaskLabel(run),
        request:run?.request || {},
        prompt:run?.prompt || '',
        outputs:(outputs || []).filter(Boolean),
        refs:run?.refs || [],
        runMs:Number(runMs || 0),
        error:error ? String(error) : '',
    };
    deps.canvas.logs = [entry, ...deps.canvas.logs].slice(0, 500);
}

function renderCanvasLog(deps){
    const list = deps.document.getElementById('logList') || (typeof deps.logList !== 'undefined' ? deps.logList : null);
    const logs = (typeof deps.canvas !== 'undefined' && Array.isArray(deps.canvas?.logs)) ? deps.canvas.logs : [];
    if(!list) return;
    list.innerHTML = logs.length ? logs.map(log => {
        const thumbs = (log.outputs || []).slice(0, 8).map(item => {
            const url = deps.outputUrlValue(item);
            if(!url) return '';
            const safe = deps.escapeAttr(url);
            if(deps.isMissingAssetUrl(url)) return `<div class="missing-asset compact" data-url="${safe}"><i data-lucide="image-off" class="w-4 h-4"></i></div>`;
            const kind = deps.mediaKindForOutputItem(item);
            return kind === 'audio' ? `<div class="audio-input-thumb"><i data-lucide="file-audio"></i></div>` : kind === 'video' ? deps.canvasVideoPreviewHtml(url, 256, 'alt="output"') : deps.canvasPreviewImgHtml(url, 256, 'alt="output"');
        }).join('');
        const date = new Date(log.createdAt || Date.now()).toLocaleString(deps.window.StudioI18n?.lang() === 'en' ? 'en-US' : 'zh-CN');
        const req = log.request || {};
        const taskId = req.task_id || req.taskId || req.prompt_id || req.promptId || '';
        const requestId = req.request_id || req.requestId || req.id || '';
        const backend = req.backend || req.provider_id || req.providerId || '';
        const workflow = req.workflow_json || req.workflow || '';
        const taskLabel = logTaskLabel(deps, log);
        const idText = taskId || requestId || '';
        const backendText = workflow || backend || '';
        const subParts = [
            date,
            `${deps.langIsEn() ? 'outputs' : '输出'} ${(log.outputs || []).length}`,
            idText ? `ID ${idText}` : '',
            backendText,
        ].filter(Boolean);
        return `<div class="log-item ${log.status === 'failed' ? 'failed' : ''}" data-canvas-log-id="${deps.escapeAttr(log.id || '')}">
            <div class="log-main">
                <div class="log-meta">
                    <span class="log-chip ${log.status === 'failed' ? 'status-failed' : 'status-ok'}">${deps.escapeHtml(log.status === 'failed' ? deps.tr('canvas.failed') : deps.tr('canvas.success'))}</span>
                    <span class="log-chip">${deps.escapeHtml(log.platform || '-')}</span>
                    ${taskLabel ? `<span class="log-chip">${deps.escapeHtml(taskLabel)}</span>` : ''}
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
    }).join('') : `<div class="log-empty">${deps.tr('canvas.noLogs')}</div>`;
    deps.bindCanvasPreviewImageFallbacks(list);
    list.querySelectorAll('[data-url]').forEach(el => {
        el.onclick = e => {
            e.stopPropagation();
            deps.openOutputLightbox(el.dataset.url, null);
        };
    });
    const bindCanvasLogCopy = (selector, key) => {
        list.querySelectorAll(selector).forEach(el => {
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
    bindCanvasLogCopy('[data-prompt]', 'prompt');
    bindCanvasLogCopy('[data-error]', 'error');
    list.querySelectorAll('[data-log-delete]').forEach(button => {
        button.onclick = e => {
            e.stopPropagation();
            const logId = button.closest('[data-canvas-log-id]')?.dataset.canvasLogId || '';
            deleteCanvasLogEntry(deps, logId, button.dataset.logDelete === 'media');
        };
    });
    deps.refreshIcons();
}

function openCanvasLog(deps, event){
    event?.preventDefault?.();
    event?.stopPropagation?.();
    event?.stopImmediatePropagation?.();
    const modal = deps.document.getElementById('logModal') || (typeof deps.logModal !== 'undefined' ? deps.logModal : null);
    const list = deps.document.getElementById('logList') || (typeof deps.logList !== 'undefined' ? deps.logList : null);
    modal?.classList.add('open');
    if(list && !list.innerHTML) list.innerHTML = `<div class="log-empty">${deps.tr('canvas.noLogs')}</div>`;
    try {
        renderCanvasLog(deps);
    } catch(err) {
        deps.console.error('renderCanvasLog failed', err);
        if(list) list.innerHTML = `<div class="log-empty">${deps.escapeHtml(err?.message || String(err))}</div>`;
    }
}

function closeCanvasLog(deps){
    const modal = deps.document.getElementById('logModal') || (typeof deps.logModal !== 'undefined' ? deps.logModal : null);
    modal?.classList.remove('open');
}

    const api={logTaskLabel, deleteCanvasLogEntry, addGenerationLog, renderCanvasLog, openCanvasLog, closeCanvasLog};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.CanvasLog=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
