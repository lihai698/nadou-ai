/* Classic node view responsibility: canvas-workflow-view. Host supplies live state and effects. */
(function(root){
'use strict';

function comfyWorkflowOptions(deps, selected){
    const opts = deps.comfyWorkflows.map(w => `<option value="${deps.escapeHtml(w.name)}" ${w.name === selected ? 'selected' : ''}>${deps.escapeHtml(w.title || w.name.replace('.json',''))}</option>`).join('');
    return opts || `<option value="">${deps.tr('canvas.comfyNoWorkflow')}</option>`;
}

function renderComfyBody(deps, node){
    const wrap = deps.document.createElement('div');
    wrap.className = 'comfy-body';
    const inputSources = deps.generatorSources(node);
    const ordered = deps.orderedSources(node, inputSources);
    const mediaInputs = ordered.filter(src => src.refs?.length);
    const imageInputs = mediaInputs
        .map(src => ({...src, refs:deps.imageRefsOnly(src.refs || [])}))
        .filter(src => src.refs?.length);
    const promptInputs = ordered.filter(src => src.prompt && !src.refs?.length);
    const mode = node.mode || 'text';
    const imageFieldCount = mode === 'custom' ? deps.comfyFields(node, 'image').length : 0;
    const videoFieldCount = mode === 'custom' ? deps.comfyFields(node, 'video').length : 0;
    const audioFieldCount = mode === 'custom' ? deps.comfyFields(node, 'audio').length : 0;
    const mediaFieldCount = imageFieldCount + videoFieldCount + audioFieldCount;
    if(mode === 'custom'){
        const validWorkflow = deps.validComfyWorkflowName(node.comfyWorkflow);
        if(node.comfyWorkflow && node.comfyWorkflow !== validWorkflow) node.comfyWorkflow = validWorkflow;
        if(!node.comfyWorkflow && validWorkflow) node.comfyWorkflow = validWorkflow;
    }
    wrap.innerHTML = `
        <div class="mode-tabs">
            <button type="button" data-mode="text" class="${mode === 'text' ? 'active' : ''}">${deps.tr('canvas.comfyModeText')}</button>
            <button type="button" data-mode="enhance" class="${mode === 'enhance' ? 'active' : ''}">${deps.tr('canvas.comfyModeEnhance')}</button>
            <button type="button" data-mode="edit" class="${mode === 'edit' ? 'active' : ''}">${deps.tr('canvas.comfyModeEdit')}</button>
            <button type="button" data-mode="custom" class="${mode === 'custom' ? 'active' : ''}">${deps.tr('canvas.comfyModeCustom')}</button>
        </div>
        <div class="comfy-content">
            <div class="prompt-list"></div>
            <div class="comfy-images ${(mode === 'text' || (mode === 'custom' && !mediaFieldCount)) ? 'hidden' : ''}">
                <div class="text-[10px] font-bold text-gray-400 uppercase tracking-widest">${mode === 'custom' ? `Media · Images ${imageFieldCount} · Videos ${videoFieldCount} · Audio ${audioFieldCount}` : 'Images'}</div>
                <div class="input-list mt-2"></div>
            </div>
        </div>
        <div class="comfy-controls">
            <div class="gen-settings comfy-settings"></div>
            <div class="gen-run-row">
                <button class="comfy-run ${node.running ? 'running' : ''}" ${node.running ? 'disabled' : ''}><i data-lucide="zap" class="w-4 h-4"></i>${node.running ? deps.tr('canvas.comfyRunning') : deps.tr('canvas.comfyRun')}</button>
                ${deps.cascadeBtnHtml(node)}
            </div>
            ${deps.retryBarHtml(node)}
        </div>
    `;
    wrap.querySelectorAll('[data-mode]').forEach(btn => {
        btn.onclick = e => {
            e.stopPropagation();
            node.mode = btn.dataset.mode;
            if(node.mode === 'custom' && !deps.hasComfyWorkflow(node.comfyWorkflow) && deps.comfyWorkflows[0]?.name){
                node.comfyWorkflow = deps.comfyWorkflows[0].name;
                deps.ensureComfyWorkflow(node.comfyWorkflow).then(() => deps.render());
            }
            deps.render();
            deps.scheduleSave();
        };
    });
    deps.renderPromptPreview(wrap.querySelector('.prompt-list'), promptInputs);
    if(mode !== 'text' && !(mode === 'custom' && !mediaFieldCount)){
        renderComfyImages(deps, wrap.querySelector('.input-list'), node, mode === 'custom' ? mediaInputs : imageInputs);
    }
    renderComfySettings(deps, wrap.querySelector('.comfy-settings'), node);
    wrap.querySelector('.comfy-run').onclick = e => { e.stopPropagation(); deps.runCanvasGenerate(node.id); };
    deps.bindCascadeButtons(wrap, node.id);
    return wrap;
}

function renderComfyImages(deps, list, node, imageInputs){
    if(!list) return;
    if(!deps.canvasInputListNeedsRender(list, [deps.tr('canvas.groupEmpty'), imageInputs.map(src => [src.id, src.preview, src.label, deps.mediaKindForRef((src.refs || [])[0] || src.preview)])])) return;
    list.innerHTML = imageInputs.length ? '' : `<div class="text-[11px] text-gray-300 py-2">${deps.tr('canvas.groupEmpty')}</div>`;
    imageInputs.forEach((src, i) => {
        const item = deps.document.createElement('div');
        item.className = 'input-item';
        item.draggable = true;
        item.dataset.sourceId = src.id;
        const firstRef = (src.refs || [])[0];
        const kind = deps.mediaKindForRef(firstRef || src.preview);
        const icon = kind === 'video' ? 'file-video' : kind === 'audio' ? 'file-audio' : 'image';
        const label = kind === 'image' ? `${deps.tr('canvas.image')} ${i + 1}` : `${deps.nodeTitleForMedia({mediaKind:kind})} ${i + 1}`;
        const previewHtml = kind === 'video' && src.preview && !deps.isMissingAssetUrl(src.preview)
            ? deps.canvasVideoPreviewHtml(src.preview, 256)
            : kind === 'audio'
                ? `<i data-lucide="${icon}" class="w-6 h-6 text-slate-400"></i>`
                : (src.preview && !deps.isMissingAssetUrl(src.preview) ? deps.canvasPreviewImgHtml(src.preview, 256) : (src.preview ? deps.missingAssetHtml(src.preview, true) : `<i data-lucide="${icon}" class="w-6 h-6 text-slate-400"></i>`));
        item.innerHTML = `<span class="input-index">${i + 1}</span>${previewHtml}<span class="input-label">${deps.escapeHtml(label)}</span>`;
        item.ondragstart = e => {
            e.stopPropagation();
            deps.internalDrag = true;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('application/x-canvas-input', src.id);
        };
        item.ondragend = () => { deps.internalDrag = false; };
        item.ondragover = e => { e.preventDefault(); e.stopPropagation(); };
        item.ondrop = e => {
            e.preventDefault();
            e.stopPropagation();
            deps.reorderInput(node, e.dataTransfer.getData('application/x-canvas-input'), src.id);
            deps.internalDrag = false;
        };
        list.appendChild(item);
    });
    deps.bindCanvasPreviewImageFallbacks(list);
}

function renderComfySettings(deps, container, node){
    const mode = node.mode || 'text';
    if(mode === 'text'){
        container.innerHTML = `
            <div class="gen-settings-row">
                <label class="field"><div class="setting-title">${deps.tr('canvas.width')}</div><input class="setting-input" data-field="width" type="number" min="64" step="64" value="${Number(node.width || 1024)}"></label>
                <label class="field"><div class="setting-title">${deps.tr('canvas.height')}</div><input class="setting-input" data-field="height" type="number" min="64" step="64" value="${Number(node.height || 1024)}"></label>
            </div>
        `;
    } else if(mode === 'enhance'){
        const strength = Number(node.enhanceStrength ?? 0.5);
        container.innerHTML = `
            <div class="gen-settings-row">
                <label class="field" style="flex:1">
                    <div class="setting-title" style="display:flex;justify-content:space-between">
                        <span>${deps.tr('studio.enhancementStrength')}</span><span class="enhance-strength-val">${strength.toFixed(2)}</span>
                    </div>
                    <input type="range" class="canvas-range enhance-strength-slider" data-field="enhanceStrength" min="0.1" max="1.0" step="0.05" value="${strength}">
                </label>
            </div>
            <div class="gen-settings-row">
                <button type="button" class="setting-check ${node.enhanceUpscale ? 'active' : ''}" data-toggle-field="enhanceUpscale"><span class="check-dot"></span>${deps.tr('studio.superResolution')}</button>
                <select class="select-lite ${node.enhanceUpscale ? '' : 'opacity-40 cursor-not-allowed'}" data-field="enhanceUpscaleRes" ${node.enhanceUpscale ? '' : 'disabled'}><option value="2048">2X (2048)</option><option value="4096">4X (4096)</option></select>
            </div>
        `;
        container.querySelector('[data-field="enhanceUpscaleRes"]').value = String(node.enhanceUpscaleRes || 2048);
    } else if(mode === 'edit'){
        container.innerHTML = `
            <div class="gen-settings-row">
                <button type="button" class="setting-check ${node.editUpscale ? 'active' : ''}" data-toggle-field="editUpscale"><span class="check-dot"></span>${deps.tr('studio.superResolution')}</button>
                <select class="select-lite ${node.editUpscale ? '' : 'opacity-40 cursor-not-allowed'}" data-field="editUpscaleRes" ${node.editUpscale ? '' : 'disabled'}><option value="2048">2X (2048)</option><option value="4096">4X (4096)</option></select>
            </div>
        `;
        container.querySelector('[data-field="editUpscaleRes"]').value = String(node.editUpscaleRes || 2048);
    } else if(mode === 'custom'){
        const selected = deps.validComfyWorkflowName(node.comfyWorkflow || deps.comfyWorkflows[0]?.name || '');
        if(node.comfyWorkflow && node.comfyWorkflow !== selected) node.comfyWorkflow = selected;
        const data = deps.currentComfyWorkflow(node);
        const fields = data?.config?.fields || [];
        const settingFields = fields.filter(f => deps.comfyFieldKind(f) === 'setting');
        container.innerHTML = `
            <div class="gen-settings-row">
                <select class="select-lite comfy-workflow-select" data-field="comfyWorkflow" style="width:100%">${comfyWorkflowOptions(deps, selected)}</select>
            </div>
            ${!selected ? `<div class="text-[11px] text-slate-400">${deps.tr('canvas.comfyNoWorkflow')}</div>` : (!data ? `<div class="text-[11px] text-slate-400">${deps.tr('canvas.comfyLoadingWorkflow')}</div>` : '')}
            ${data ? settingFields.map(f => renderComfyCustomField(deps, node, f)).join('') || `<div class="text-[11px] text-slate-400">${deps.tr('canvas.comfyNoExtraParams')}</div>` : ''}
        `;
        if(selected && !data) deps.ensureComfyWorkflow(selected).then(() => deps.render());
    } else {
        container.innerHTML = '';
    }
    container.querySelectorAll('[data-toggle-field]').forEach(btn => {
        btn.onmousedown = e => e.stopPropagation();
        btn.onclick = e => {
            e.stopPropagation();
            const field = btn.dataset.toggleField;
            node[field] = !node[field];
            deps.render();
            deps.scheduleSave();
        };
    });
    container.querySelectorAll('button[data-comfy-param]').forEach(btn => {
        btn.onmousedown = e => e.stopPropagation();
        btn.onclick = e => updateComfyField(deps, node, btn, e);
    });
    container.querySelectorAll('button[data-comfy-random]').forEach(btn => {
        btn.onmousedown = e => e.stopPropagation();
        btn.onclick = e => {
            e.stopPropagation();
            deps.toggleComfyRandom(node.id, btn.dataset.comfyRandom);
        };
    });
    container.querySelectorAll('input, select, textarea').forEach(input => {
        input.onmousedown = e => e.stopPropagation();
        input.onclick = e => e.stopPropagation();
        if(input.classList.contains('model-select')) return;
        input.onchange = e => updateComfyField(deps, node, input, e);
        input.oninput = e => updateComfyField(deps, node, input, e);
    });
}

function renderComfyCustomField(deps, node, f){
    const value = deps.comfyParamValue(node, f);
    const label = deps.escapeHtml(f.name || f.input);
    if(f.type === 'boolean'){
        return `<div class="gen-settings-row">
            <button type="button" class="setting-check ${value ? 'active' : ''}" data-comfy-param="${deps.escapeHtml(f.id)}" data-comfy-type="boolean"><span class="check-dot"></span>${label}</button>
        </div>`;
    }
    if(f.type === 'slider'){
        const min = f.min ?? 0, max = f.max ?? 10, step = f.step ?? 1;
        return `<div class="gen-settings-row">
            <label class="field" style="flex:1">
                <div class="setting-title" style="display:flex;justify-content:space-between"><span>${label}</span><span class="comfy-param-val">${deps.escapeHtml(value)}</span></div>
                <input type="range" class="canvas-range" data-comfy-param="${deps.escapeHtml(f.id)}" data-comfy-type="slider" min="${min}" max="${max}" step="${step}" value="${deps.escapeHtml(value)}">
            </label>
        </div>`;
    }
    if(f.type === 'dropdown'){
        const opts = (f.options || []).map(o => `<option value="${deps.escapeHtml(o)}" ${String(value) === String(o) ? 'selected' : ''}>${deps.escapeHtml(o)}</option>`).join('');
        return `<div class="gen-settings-row">
            <label class="field" style="flex:1"><div class="setting-title">${label}</div><select class="select-lite" data-comfy-param="${deps.escapeHtml(f.id)}" data-comfy-type="dropdown" style="width:100%">${opts || '<option value="">(无选项)</option>'}</select></label>
        </div>`;
    }
    if(f.type === 'textarea'){
        return `<div class="gen-settings-row">
            <label class="field" style="flex:1"><div class="setting-title">${label}</div><textarea class="setting-input" data-comfy-param="${deps.escapeHtml(f.id)}" data-comfy-type="textarea" style="height:66px;padding-top:8px;resize:vertical">${deps.escapeHtml(value)}</textarea></label>
        </div>`;
    }
    const type = f.type === 'number' ? 'number' : 'text';
    if(deps.comfyRandomEnabled(f)){
        const active = deps.comfyRandomActive(node, f.id);
        return `<div class="gen-settings-row">
            <div class="comfy-random-field">
                <label class="field"><div class="setting-title">${label}</div><input class="setting-input" type="number" data-comfy-param="${deps.escapeHtml(f.id)}" data-comfy-type="number" value="${deps.escapeHtml(value)}"></label>
                <button class="tool-btn comfy-random-btn ${active ? 'active' : ''}" type="button" data-comfy-random="${deps.escapeHtml(f.id)}" title="${active ? '随机已开启，点击关闭' : '随机已关闭，点击开启'}" aria-label="${active ? '随机已开启，点击关闭' : '随机已关闭，点击开启'}"><i data-lucide="dice-5" class="w-4 h-4"></i></button>
            </div>
        </div>`;
    }
    return `<div class="gen-settings-row">
        <label class="field" style="flex:1"><div class="setting-title">${label}</div><input class="setting-input" type="${type}" data-comfy-param="${deps.escapeHtml(f.id)}" data-comfy-type="${deps.escapeHtml(f.type || 'text')}" value="${deps.escapeHtml(value)}"></label>
    </div>`;
}

function updateComfyField(deps, node, input, event){
    event?.stopPropagation();
    const paramId = input.dataset.comfyParam;
    if(paramId){
        node.comfyParams = node.comfyParams || {};
        const field = deps.comfyFields(node).find(f => f.id === paramId);
        const type = input.dataset.comfyType || field?.type || 'text';
        const value = type === 'boolean' ? !Boolean(node.comfyParams[paramId] ?? field?.default ?? false)
            : (type === 'number' || type === 'slider') ? Number(input.value) || 0 : input.value;
        deps.setCanvasWorkflowParameters(node, {[paramId]:value});
        const val = input.closest('.field')?.querySelector('.comfy-param-val');
        if(val) val.textContent = node.comfyParams[paramId];
        if(type === 'boolean') deps.render();
        deps.scheduleSave();
        return;
    }
    const field = input.dataset.field;
    if(!field) return;
    if(field === 'comfyWorkflow'){
        node.comfyWorkflow = deps.validComfyWorkflowName(input.value);
        node.comfyParams = {};
        deps.ensureComfyWorkflow(node.comfyWorkflow).then(() => deps.render());
        deps.scheduleSave();
        return;
    }
    if(input.type === 'checkbox') {
        node[field] = input.checked;
        if(field === 'enhanceUpscale') deps.render();
    }
    else if(field === 'enhanceStrength') {
        node[field] = Number(input.value) || 0.5;
        const val = input.closest('.field')?.querySelector('.enhance-strength-val');
        if(val) val.textContent = node[field].toFixed(2);
    }
    else if(['width','height','enhanceUpscaleRes','editUpscaleRes','count'].includes(field)) node[field] = Number(input.value) || 1;
    else node[field] = input.value;
    deps.scheduleSave();
}

function rhMediaPreviewHtml(deps, ref, kind){
    const safe = deps.escapeAttr(ref?.url || '');
    if(kind === 'video') return deps.canvasVideoPreviewHtml(ref?.url || '', 256);
    if(kind === 'audio') return `<i data-lucide="file-audio" class="w-6 h-6 text-slate-400"></i>`;
    return safe && !deps.isMissingAssetUrl(safe) ? deps.canvasPreviewImgHtml(safe, 256) : `<i data-lucide="image" class="w-6 h-6 text-slate-400"></i>`;
}

function renderRhBody(deps, node){
    const wrap = deps.document.createElement('div');
    wrap.className = 'rh-body';
    node.rhParams = node.rhParams || {};
    const entry = deps.ensureRhNodeSelection(node);
    const selectedRef = deps.rhSelectedEntryRef(node);
    const media = deps.rhMediaSources(node);
    const fields = deps.rhActiveFields(node);
    const mode = selectedRef?.kind || deps.rhCurrentKind(node);
    const selectedId = selectedRef?.id || (mode === 'workflow' ? (node.workflowId || '') : (node.webappId || ''));
    const selectedKey = selectedRef ? deps.runningHubEntryKey(selectedRef.kind, selectedRef.id) : '';
    const entryNote = entry?.note || entry?.description || '';
    if(mode === 'model'){
        node.model = selectedRef?.id || node.rhModel || node.model || '';
        deps.normalizeApiNodeSizeChoice(node);
    }
    wrap.innerHTML = `
        <div class="rh-top">
            <label class="field rh-webapp-field">
                <div class="setting-title">RunningHub 配置</div>
                <select class="select-lite rh-entry-select">${deps.rhEntryOptions(selectedKey)}</select>
            </label>
            <label class="field rh-payment-field" style="${mode === 'model' ? 'display:none' : ''}">
                <div class="setting-title">Key</div>
                <select class="select-lite rh-payment-select">${deps.rhPaymentOptions(node)}</select>
            </label>
            <label class="field rh-machine-field" style="${mode === 'model' ? 'display:none' : ''}">
                <div class="setting-title">显存</div>
                <select class="select-lite rh-machine-select">
                    <option value="" ${!node.instanceType ? 'selected' : ''}>24G</option>
                    <option value="plus" ${node.instanceType === 'plus' ? 'selected' : ''}>48G</option>
                </select>
            </label>
        </div>
        <div class="rh-prompt-list"></div>
        <div class="rh-media-section">
            <div class="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">${deps.tr('canvas.rhInputs')}</div>
            <div class="input-list rh-input-list"></div>
        </div>
        ${mode === 'model' ? rhModelSettingsHtml(deps, node) : ''}
        <div class="rh-param-head">
            <span>${mode === 'model' ? '模型 API 参数' : mode === 'workflow' ? deps.tr('canvas.rhWorkflowParams') : deps.tr('canvas.rhParams')}</span>
            <span>${fields.length}</span>
        </div>
        <div class="rh-param-list"></div>
        <div class="gen-run-row">
            <button class="gen-btn rh-run ${node.running ? 'running' : ''}" ${node.running ? 'disabled' : ''}><i data-lucide="workflow" class="w-4 h-4"></i>${node.running ? deps.tr('canvas.rhRunning') : deps.tr('canvas.rhRun')}</button>
            ${deps.cascadeBtnHtml(node)}
        </div>
        ${deps.retryBarHtml(node)}
    `;
    const entrySelect = wrap.querySelector('.rh-entry-select');
    if(entrySelect) entrySelect.onchange = e => {
        const parsed = deps.parseRunningHubEntryKey(e.target.value);
        const ref = parsed ? deps.runningHubAllEntries().find(item => item.kind === parsed.kind && item.id === parsed.id) : null;
        if(ref) deps.applyRhEntrySelection(node, ref);
        node.rhParams = {};
        node.rhRandomValues = {};
        deps.render();
        deps.scheduleSave();
    };
    const paymentSelect = wrap.querySelector('.rh-payment-select');
    if(paymentSelect) paymentSelect.onchange = e => {
        node.rhPayment = e.target.value === 'wallet' ? 'wallet' : 'free';
        deps.scheduleSave();
    };
    const machineSelect = wrap.querySelector('.rh-machine-select');
    if(machineSelect) machineSelect.onchange = e => {
        node.instanceType = e.target.value === 'plus' ? 'plus' : '';
        deps.scheduleSave();
    };
    if(mode === 'model') deps.renderPromptPreview(wrap.querySelector('.rh-prompt-list'), media.sources.filter(src => src.prompt && !src.refs?.length));
    else renderRhPromptFields(deps, wrap.querySelector('.rh-prompt-list'), node, fields);
    renderRhInputs(deps, wrap.querySelector('.rh-input-list'), node, media);
    renderRhParams(deps, wrap.querySelector('.rh-param-list'), node, fields, media);
    if(mode === 'model') bindRhModelControls(deps, wrap, node, media);
    wrap.querySelector('.rh-run').onclick = e => { e.stopPropagation(); deps.runCanvasGenerate(node.id); };
    deps.bindCascadeButtons(wrap, node.id);
    deps.refreshIcons();
    return wrap;
}

function rhModelSettingsHtml(deps, node){
    const count = Math.max(1, Math.min(8, Number(node.count || 1)));
    return `
        <div class="gen-settings rh-model-settings">
            <div class="gen-settings-row api-size-row">
                <select class="select-lite resolution compact-select" data-rh-model-field="resolution">
                    <option value="auto">自动</option>
                    <option value="1k">1K</option>
                    <option value="2k">2K</option>
                    <option value="4k">4K</option>
                    <option value="custom">${deps.tr('canvas.custom')}</option>
                </select>
                <select class="select-lite ratio compact-select" data-rh-model-field="ratio">
                    <option value="square">1:1</option>
                    <option value="portrait">2:3</option>
                    <option value="landscape">3:2</option>
                    <option value="portrait43">3:4</option>
                    <option value="landscape43">4:3</option>
                    <option value="story">9:16</option>
                    <option value="wide">16:9</option>
                    <option value="ultrawide">21:9</option>
                    <option value="ultratall">9:21</option>
                    <option value="source">${deps.tr('canvas.adaptiveRatio')}</option>
                    <option value="custom">${deps.tr('canvas.custom')}</option>
                </select>
                <select class="select-lite quality-select" data-rh-model-field="quality">
                    <option value="auto">Q auto</option>
                    <option value="low">Q low</option>
                    <option value="medium">Q med</option>
                    <option value="high">Q high</option>
                </select>
                <input class="setting-input rh-model-count-input" data-rh-model-field="count" type="number" min="1" max="8" step="1" value="${count}" style="width:64px">
            </div>
            <div class="gen-settings-row custom-ratio-row" style="display:none">
                <label class="field"><div class="setting-title">${deps.tr('canvas.ratioWidth')}</div><input class="setting-input custom-ratio-w-input" data-rh-model-field="customRatioWidth" type="number" min="1" step="1" value="${deps.escapeHtml(node.customRatioWidth || '')}" placeholder="4"></label>
                <label class="field"><div class="setting-title">${deps.tr('canvas.ratioHeight')}</div><input class="setting-input custom-ratio-h-input" data-rh-model-field="customRatioHeight" type="number" min="1" step="1" value="${deps.escapeHtml(node.customRatioHeight || '')}" placeholder="3"></label>
            </div>
            <div class="gen-settings-row custom-size-row" style="display:none">
                <label class="field"><div class="setting-title">${deps.tr('canvas.width')}</div><input class="setting-input custom-w-input" data-rh-model-field="customWidth" type="number" min="64" step="64" value="${deps.escapeHtml(node.customWidth || '')}" placeholder="Auto"></label>
                <label class="field"><div class="setting-title">${deps.tr('canvas.height')}</div><input class="setting-input custom-h-input" data-rh-model-field="customHeight" type="number" min="64" step="64" value="${deps.escapeHtml(node.customHeight || '')}" placeholder="Auto"></label>
            </div>
        </div>
    `;
}

function bindRhModelControls(deps, wrap, node, media){
    const resolutionSelect = wrap.querySelector('[data-rh-model-field="resolution"]');
    const ratioSelect = wrap.querySelector('[data-rh-model-field="ratio"]');
    const qualitySelect = wrap.querySelector('[data-rh-model-field="quality"]');
    const countInput = wrap.querySelector('[data-rh-model-field="count"]');
    const customRatioRow = wrap.querySelector('.custom-ratio-row');
    const customSizeRow = wrap.querySelector('.custom-size-row');
    const customRatioWInput = wrap.querySelector('[data-rh-model-field="customRatioWidth"]');
    const customRatioHInput = wrap.querySelector('[data-rh-model-field="customRatioHeight"]');
    const customWInput = wrap.querySelector('[data-rh-model-field="customWidth"]');
    const customHInput = wrap.querySelector('[data-rh-model-field="customHeight"]');
    const hydrateCustomParts = () => {
        if((!node.customRatioWidth || !node.customRatioHeight) && node.customRatio) {
            const raw = String(node.customRatio || '');
            if(raw.includes(':')){
                const [w,h] = raw.split(':');
                node.customRatioWidth = node.customRatioWidth || w;
                node.customRatioHeight = node.customRatioHeight || h;
            }
        }
        if((!node.customWidth || !node.customHeight) && node.customSize) {
            const parsed = deps.parseSizeValue(node.customSize);
            node.customWidth = node.customWidth || parsed?.width || '';
            node.customHeight = node.customHeight || parsed?.height || '';
        }
    };
    const sync = () => {
        hydrateCustomParts();
        deps.normalizeApiNodeSizeChoice(node);
        if(resolutionSelect) resolutionSelect.value = node.resolution || deps.defaultApiImageResolution(node.model);
        if(ratioSelect) ratioSelect.value = node.ratio || 'square';
        if(qualitySelect) qualitySelect.value = node.quality || 'auto';
        if(countInput) countInput.value = Math.max(1, Math.min(8, Number(node.count || 1)));
        if(customRatioRow) customRatioRow.style.display = node.ratio === 'custom' ? '' : 'none';
        if(customSizeRow) customSizeRow.style.display = node.resolution === 'custom' ? '' : 'none';
        if(customRatioWInput) customRatioWInput.value = node.customRatioWidth || '';
        if(customRatioHInput) customRatioHInput.value = node.customRatioHeight || '';
        if(customWInput) customWInput.value = node.customWidth || '';
        if(customHInput) customHInput.value = node.customHeight || '';
    };
    wrap.querySelectorAll('[data-rh-model-field]').forEach(control => {
        control.onmousedown = e => e.stopPropagation();
        control.onclick = e => e.stopPropagation();
        control.oninput = control.onchange = e => {
            const field = control.dataset.rhModelField;
            if(field === 'resolution'){
                node.resolution = e.target.value || deps.defaultApiImageResolution(node.model);
                node._apiResolutionUserSet = true;
            } else if(field === 'ratio'){
                node.ratio = e.target.value || 'square';
            } else if(field === 'quality'){
                node.quality = e.target.value || 'auto';
            } else if(field === 'count'){
                node.count = Math.max(1, Math.min(8, Number(e.target.value || 1)));
            } else if(field === 'customRatioWidth' || field === 'customRatioHeight'){
                node[field] = e.target.value;
                node.customRatio = node.customRatioWidth && node.customRatioHeight ? `${node.customRatioWidth}:${node.customRatioHeight}` : '';
            } else if(field === 'customWidth' || field === 'customHeight'){
                node[field] = e.target.value;
                node.customSize = node.customWidth && node.customHeight ? `${node.customWidth}x${node.customHeight}` : '';
            }
            sync();
            deps.scheduleSave();
        };
    });
    sync();
}

function renderRhInputs(deps, list, node, media){
    if(!list) return;
    const refs = media.refs || [];
    if(!deps.canvasInputListNeedsRender(list, [deps.tr('canvas.groupEmpty'), refs.map(ref => [ref.url, deps.mediaKindForRef(ref)])])) return;
    if(!refs.length){
        list.innerHTML = `<div class="text-[11px] text-gray-300 py-2">${deps.tr('canvas.groupEmpty')}</div>`;
        return;
    }
    list.innerHTML = '';
    refs.forEach((ref, i) => {
        const kind = deps.mediaKindForRef(ref);
        const item = deps.document.createElement('div');
        item.className = 'input-item rh-input-item';
        item.innerHTML = `<span class="input-index">${i + 1}</span>${rhMediaPreviewHtml(deps, ref, kind)}<span class="input-label">${deps.escapeHtml(deps.nodeTitleForMedia({mediaKind:kind}))}</span>`;
        list.appendChild(item);
    });
    deps.bindCanvasPreviewImageFallbacks(list);
}

function renderRhPromptFields(deps, container, node, fields){
    if(!container) return;
    const prompts = (fields || []).filter(field => deps.rhFieldRole(field) === 'prompt');
    const html = prompts.map(field => {
        const key = deps.rhParamKey(field.nodeId, field.fieldName);
        const label = field.label || field.fieldName || 'Prompt';
        const value = deps.rhFieldValue(node, field, deps.rhMediaSources(node));
        return `<label class="field rh-prompt-field">
            <div class="setting-title">${deps.escapeHtml(label)}</div>
            <textarea class="setting-input rh-param-input" data-rh-param="${deps.escapeAttr(key)}" data-rh-role="prompt">${deps.escapeHtml(value)}</textarea>
        </label>`;
    }).join('');
    if(container.innerHTML === html) return;
    container.innerHTML = html;
    bindRhParamControls(deps, container, node);
}

function renderRhParams(deps, container, node, fields, media){
    if(!container) return;
    const params = (fields || []).filter(field => {
        const role = deps.rhFieldRole(field);
        return !['image','video','audio','prompt'].includes(role);
    });
    const html = params.length ? params.map((field, i) => {
        const key = deps.rhParamKey(field.nodeId, field.fieldName);
        const kind = deps.rhFieldRole(field);
        const options = deps.rhExtractFieldOptions(field);
        const value = deps.rhFieldValue(node, field, media);
        const label = field.label || field.fieldName || `Field ${i + 1}`;
        const valueText = String(value ?? '');
        const wide = kind === 'text' && (String(label).length > 18 || valueText.length > 28);
        return renderRhSettingField(deps, node, field, key, kind, label, value, options, wide);
    }).join('') : `<div class="rh-empty">${deps.tr('canvas.rhNoParams')}</div>`;
    if(container.innerHTML === html) return;
    container.innerHTML = html;
    bindRhParamControls(deps, container, node);
}

function renderRhSettingField(deps, node, field, key, kind, label, value, options, wide=false){
    const safeLabel = deps.escapeHtml(label);
    if(kind === 'boolean'){
        const active = String(value).toLowerCase() === 'true';
        return `<div class="gen-settings-row rh-param-row ${wide ? 'wide' : ''}">
            <button type="button" class="setting-check ${active ? 'active' : ''}" data-rh-param="${deps.escapeAttr(key)}" data-rh-type="boolean"><span class="check-dot"></span>${safeLabel}</button>
        </div>`;
    }
    if(kind === 'slider'){
        const min = Number.isFinite(Number(field.min)) ? Number(field.min) : 0;
        const max = Number.isFinite(Number(field.max)) && Number(field.max) > min ? Number(field.max) : 1;
        const step = Number.isFinite(Number(field.step)) && Number(field.step) > 0 ? Number(field.step) : 0.01;
        const numericValue = Number.isFinite(Number(value)) ? Number(value) : min;
        return `<div class="gen-settings-row rh-param-row ${wide ? 'wide' : ''}">
            <label class="field" style="flex:1">
                <div class="setting-title" style="display:flex;justify-content:space-between"><span>${safeLabel}</span><span class="rh-param-val">${deps.escapeHtml(numericValue)}</span></div>
                <input type="range" class="canvas-range rh-param-input" data-rh-param="${deps.escapeAttr(key)}" data-rh-type="slider" min="${deps.escapeAttr(min)}" max="${deps.escapeAttr(max)}" step="${deps.escapeAttr(step)}" value="${deps.escapeAttr(numericValue)}">
            </label>
        </div>`;
    }
    if(options?.length){
        return `<div class="gen-settings-row rh-param-row ${wide ? 'wide' : ''}">
            <label class="field"><div class="setting-title">${safeLabel}</div><select class="select-lite rh-param-input" data-rh-param="${deps.escapeAttr(key)}" data-rh-type="select" style="width:100%">${options.map(opt => `<option value="${deps.escapeAttr(opt)}" ${String(value) === String(opt) ? 'selected' : ''}>${deps.escapeHtml(opt)}</option>`).join('')}</select></label>
        </div>`;
    }
    if(deps.rhRandomEnabled(field)){
        const active = deps.rhRandomActive(node, key);
        return `<div class="gen-settings-row rh-param-row ${wide ? 'wide' : ''}">
            <div class="comfy-random-field">
                <label class="field"><div class="setting-title">${safeLabel}</div><input class="setting-input rh-param-input" type="number" data-rh-param="${deps.escapeAttr(key)}" data-rh-type="number" value="${deps.escapeAttr(value)}" ${active ? 'disabled' : ''}></label>
                <button class="tool-btn comfy-random-btn ${active ? 'active' : ''}" type="button" data-rh-random="${deps.escapeAttr(key)}" title="${active ? '随机已开启，点击关闭' : '随机已关闭，点击开启'}"><i data-lucide="dice-5" class="w-4 h-4"></i></button>
            </div>
        </div>`;
    }
    const inputType = kind === 'number' ? 'number' : 'text';
    return `<div class="gen-settings-row rh-param-row ${wide ? 'wide' : ''}">
        <label class="field"><div class="setting-title">${safeLabel}</div><input class="setting-input rh-param-input" type="${inputType}" data-rh-param="${deps.escapeAttr(key)}" data-rh-type="${deps.escapeAttr(kind)}" value="${deps.escapeAttr(value)}"></label>
    </div>`;
}

function bindRhParamControls(deps, container, node){
    container.querySelectorAll('button[data-rh-param]').forEach(btn => {
        btn.onmousedown = e => e.stopPropagation();
        btn.onclick = e => {
            e.stopPropagation();
            const key = btn.dataset.rhParam;
            node.rhParams = node.rhParams || {};
            const field = deps.rhActiveFields(node).find(f => deps.rhParamKey(f.nodeId, f.fieldName) === key);
            const on = String(deps.rhFieldValue(node, field)).toLowerCase() === 'true';
            deps.setCanvasWorkflowParameters(node, {[key]:!on});
            deps.render();
            deps.scheduleSave();
        };
    });
    container.querySelectorAll('input[data-rh-param], select[data-rh-param], textarea[data-rh-param]').forEach(control => {
        control.onmousedown = e => e.stopPropagation();
        control.onclick = e => e.stopPropagation();
        control.oninput = control.onchange = e => {
            const key = control.dataset.rhParam;
            node.rhParams = node.rhParams || {};
            deps.setCanvasWorkflowParameters(node, {[key]:e.target.value});
            const val = control.closest('.field')?.querySelector('.rh-param-val');
            if(val) val.textContent = e.target.value;
            deps.scheduleSave();
        };
    });
    container.querySelectorAll('[data-rh-random]').forEach(btn => {
        btn.onmousedown = e => e.stopPropagation();
        btn.onclick = e => {
            e.stopPropagation();
            deps.toggleRhRandom(node.id, btn.dataset.rhRandom);
        };
    });
}

const api={comfyWorkflowOptions, renderComfyBody, renderComfyImages, renderComfySettings, renderComfyCustomField, updateComfyField, rhMediaPreviewHtml, renderRhBody, rhModelSettingsHtml, bindRhModelControls, renderRhInputs, renderRhPromptFields, renderRhParams, renderRhSettingField, bindRhParamControls};
if(typeof module!=='undefined' && module.exports) module.exports=api;
root.CanvasWorkflowView=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
