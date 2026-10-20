/* Classic node view responsibility: canvas-generation-view. Host supplies live state and effects. */
(function(root){
'use strict';

function renderMsGenBody(deps, node){
    const wrap = deps.document.createElement('div');
    wrap.className = 'generator-body';
    const modelKey = node.msgenModel || 'zimage';
    const msModel = deps.MS_GEN_MODELS[modelKey] || deps.MS_GEN_MODELS.zimage;
    const inputSources = deps.generatorSources(node);
    const ordered = deps.orderedSources(node, inputSources);
    const mediaInputs = ordered.filter(src => src.refs?.some(ref => ['image','video','audio'].includes(deps.mediaKindForRef(ref))));
    const promptInputs = ordered.filter(src => src.prompt && !src.refs?.length);
    const referenceImages = ordered.flatMap(src => src.refs || []);
    const isCustomMs = modelKey === 'custom';
    const msUsesImages = Boolean(msModel.supportsImage || msModel.acceptsImage);
    node.msCustomModel = node.msCustomModel || deps.modelscopeImageModels()[0] || 'Tongyi-MAI/Z-Image-Turbo';
    const msModelId = deps.currentMsModelId(modelKey, node);
    const msLoras = deps.modelscopeLorasForModel(msModelId);
    const selectedMsLora = msLoras.find(lora => String(lora.id || '').trim() === String(node.msLoraId || '').trim()) || msLoras[0];
    const loraEnabled = Boolean(node.msLoraEnabled);
    const loraStrength = node.msLoraStrength ?? Number(selectedMsLora?.strength ?? 0.8);
    const msCount = Math.max(1, Math.min(8, Number(node.count || 1)));
    wrap.innerHTML = `
        <div class="ms-model-tabs">
            ${Object.entries(deps.MS_GEN_MODELS).map(([k,m]) =>
                `<button type="button" data-model="${k}" class="${modelKey===k?'active':''}">${deps.escapeHtml(m.labelKey ? deps.tr(m.labelKey) : m.label)}</button>`
            ).join('')}
        </div>
        <div class="ms-content">
            <div class="prompt-list mt-2 mb-2"></div>
            ${msUsesImages ? `
            <div class="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">${deps.tr('canvas.images')}</div>
            <div class="input-list ms-img-list"></div>
            ` : ''}
        </div>
        <div class="ms-controls">
            <div class="gen-settings">
                ${isCustomMs ? `
                <div class="gen-settings-row">
                    <select class="select-lite ms-custom-model-select">${deps.modelscopeImageModelOptions(node.msCustomModel)}</select>
                </div>
                ` : ''}
                <div class="gen-settings-row">
                    <select class="select-lite resolution compact-select" data-field="msResolution">
                        <option value="1k">1K</option>
                        <option value="2k">2K</option>
                        <option value="4k">4K</option>
                    <option value="custom">${deps.tr('canvas.custom')}</option>
                </select>
                <select class="select-lite ratio compact-select" data-field="msRatio">
                    <option value="square">1:1</option>
                    <option value="portrait">2:3</option>
                    <option value="landscape">3:2</option>
                        <option value="portrait43">3:4</option>
                        <option value="landscape43">4:3</option>
                        <option value="story">9:16</option>
                        <option value="wide">16:9</option>
                        <option value="ultrawide">21:9</option>
                        <option value="ultratall">9:21</option>
                        <option value="custom">${deps.tr('canvas.custom')}</option>
                    </select>
                    <div class="gen-count-row">
                        <div class="gen-stepper">
                            <button class="gen-step-btn" data-ms-step="-1" type="button" title="${deps.tr('canvas.decrease')}" aria-label="${deps.tr('canvas.decreaseCount')}"><i data-lucide="chevron-left" class="w-3.5 h-3.5"></i></button>
                            <input class="gen-count-input ms-count-input" type="text" inputmode="numeric" pattern="[0-9]*" value="${msCount}">
                            <button class="gen-step-btn" data-ms-step="1" type="button" title="${deps.tr('canvas.increase')}" aria-label="${deps.tr('canvas.increaseCount')}"><i data-lucide="chevron-right" class="w-3.5 h-3.5"></i></button>
                        </div>
                    </div>
                </div>
                <div class="gen-settings-row ms-custom-ratio-row" style="display:none">
                    <label class="field">
                        <div class="setting-title">${deps.tr('canvas.ratioWidth')}</div>
                        <input class="setting-input ms-custom-ratio-w-input" type="number" min="1" step="1" value="${deps.escapeHtml(node.msCustomRatioWidth || '')}" placeholder="4">
                    </label>
                    <label class="field">
                        <div class="setting-title">${deps.tr('canvas.ratioHeight')}</div>
                        <input class="setting-input ms-custom-ratio-h-input" type="number" min="1" step="1" value="${deps.escapeHtml(node.msCustomRatioHeight || '')}" placeholder="3">
                    </label>
                </div>
                <div class="gen-settings-row ms-custom-size-row" style="display:none">
                    <label class="field">
                        <div class="setting-title">${deps.tr('canvas.width')}</div>
                        <input class="setting-input ms-custom-w-input" type="number" min="64" step="64" value="${deps.escapeHtml(node.msCustomWidth || '')}" placeholder="Auto">
                    </label>
                    <label class="field">
                        <div class="setting-title">${deps.tr('canvas.height')}</div>
                        <input class="setting-input ms-custom-h-input" type="number" min="64" step="64" value="${deps.escapeHtml(node.msCustomHeight || '')}" placeholder="Auto">
                    </label>
                    <button class="secondary-btn ms-fit-size-btn" type="button" style="height:32px;align-self:flex-end;padding:0 10px;font-size:11px">${deps.tr('canvas.fitImageSize')}</button>
                </div>
                ${msLoras.length ? `
                <div class="gen-settings-row">
                    <label class="setting-check" style="cursor:pointer">
                        <input type="checkbox" class="ms-lora-check" ${node.msLoraEnabled ? 'checked' : ''}>
                        <span style="font-size:11px;font-weight:700">${deps.tr('canvas.enableLora')}</span>
                    </label>
                </div>
                ${node.msLoraEnabled ? `
                <div class="gen-settings-row">
                    <label class="field" style="flex:1">
                        <div class="setting-title">LoRA</div>
                        <select class="select-lite ms-lora-select">${deps.modelscopeLoraOptions(msLoras, String(selectedMsLora?.id || '').trim())}</select>
                    </label>
                </div>
                <div class="gen-settings-row">
                    <label class="field" style="flex:1">
                        <div class="setting-title" style="display:flex;justify-content:space-between">
                            <span>${deps.tr('canvas.loraStrength')}</span><span class="ms-lora-strength-val">${loraStrength.toFixed(2)}</span>
                        </div>
                        <input type="range" class="canvas-range ms-lora-strength-slider" min="0.1" max="1.0" step="0.05" value="${loraStrength}">
                    </label>
                </div>` : ''}` : ''}
                ${!msLoras.length ? `<div class="gen-settings-row"><div style="color:var(--faint);font-size:11px;font-weight:700;line-height:1.45">${deps.tr('canvas.noLoraForModel')}</div></div>` : ''}
            </div>
            <div class="gen-run-row">
                <button class="gen-btn ${node.running?'running':''}" ${node.running?'disabled':''}>
                    <i data-lucide="zap" class="w-4 h-4"></i>${node.running ? deps.tr('canvas.generating') : deps.tr('canvas.msGenerate')}
                </button>
                ${deps.cascadeBtnHtml(node)}
            </div>
            ${deps.retryBarHtml(node)}
        </div>
    `;
    wrap.querySelectorAll('.ms-model-tabs button').forEach(btn => {
        btn.onclick = e => {
            e.stopPropagation();
            if(node.msgenModel !== btn.dataset.model){
                node.msLoraId = '';
                delete node.msLoraStrength;
                node.msLoraEnabled = false;
            }
            node.msgenModel = btn.dataset.model;
            deps.render();
            deps.scheduleSave();
        };
    });
    const msCustomModelSelect = wrap.querySelector('.ms-custom-model-select');
    if(msCustomModelSelect){
        msCustomModelSelect.onmousedown = e => e.stopPropagation();
        msCustomModelSelect.onclick = e => e.stopPropagation();
        msCustomModelSelect.onchange = e => {
            e.stopPropagation();
            node.msCustomModel = e.target.value;
            node.msLoraId = '';
            delete node.msLoraStrength;
            node.msLoraEnabled = false;
            deps.scheduleSave();
            deps.render();
        };
    }
    const msRatioSelect = wrap.querySelector('[data-field="msRatio"]');
    const msResolutionSelect = wrap.querySelector('[data-field="msResolution"]');
    if(msRatioSelect && msResolutionSelect){
        const msCustomRatioRow = wrap.querySelector('.ms-custom-ratio-row');
        const msCustomSizeRow = wrap.querySelector('.ms-custom-size-row');
        const msCustomRatioWInput = wrap.querySelector('.ms-custom-ratio-w-input');
        const msCustomRatioHInput = wrap.querySelector('.ms-custom-ratio-h-input');
        const msCustomWInput = wrap.querySelector('.ms-custom-w-input');
        const msCustomHInput = wrap.querySelector('.ms-custom-h-input');
        const msFitSizeBtn = wrap.querySelector('.ms-fit-size-btn');
        if((!node.msCustomRatioWidth || !node.msCustomRatioHeight) && node.msCustomRatio) {
            const raw = String(node.msCustomRatio || '');
            if(raw.includes(':')){
                const [w,h] = raw.split(':');
                node.msCustomRatioWidth = node.msCustomRatioWidth || w;
                node.msCustomRatioHeight = node.msCustomRatioHeight || h;
            }
        }
        if((!node.msCustomWidth || !node.msCustomHeight) && node.msCustomSize) {
            const parsed = deps.parseSizeValue(node.msCustomSize);
            node.msCustomWidth = node.msCustomWidth || parsed?.width || '';
            node.msCustomHeight = node.msCustomHeight || parsed?.height || '';
        }
        const syncMsCustomSizeControls = () => {
            const ratioValue = node.msRatio && [...msRatioSelect.options].some(opt => opt.value === node.msRatio) ? node.msRatio : 'square';
            msRatioSelect.value = ratioValue;
            msResolutionSelect.value = node.msResolution || '1k';
            msRatioSelect.disabled = node.msResolution === 'custom';
            msCustomRatioRow.style.display = node.msRatio === 'custom' ? 'flex' : 'none';
            msCustomSizeRow.style.display = node.msResolution === 'custom' ? 'flex' : 'none';
            msCustomRatioWInput.value = node.msCustomRatioWidth || '';
            msCustomRatioHInput.value = node.msCustomRatioHeight || '';
            msCustomWInput.value = node.msCustomWidth || '';
            msCustomHInput.value = node.msCustomHeight || '';
            if(msFitSizeBtn) msFitSizeBtn.disabled = !referenceImages.some(ref => ref.url);
        };
        msRatioSelect.onmousedown = e => e.stopPropagation();
        msRatioSelect.onclick = e => e.stopPropagation();
        msRatioSelect.onchange = e => {
            e.stopPropagation();
            deps.setCanvasMsSizeFields(node,{msRatio:e.target.value});
            syncMsCustomSizeControls();
            deps.scheduleSave();
        };
        msResolutionSelect.onmousedown = e => e.stopPropagation();
        msResolutionSelect.onclick = e => e.stopPropagation();
        msResolutionSelect.onchange = e => {
            e.stopPropagation();
            deps.setCanvasMsSizeFields(node,{msResolution:e.target.value});
            syncMsCustomSizeControls();
            deps.scheduleSave();
        };
        [msCustomRatioWInput, msCustomRatioHInput].forEach(input => {
            input.onmousedown = e => e.stopPropagation();
            input.onclick = e => e.stopPropagation();
            input.oninput = () => {
                deps.setCanvasMsSizeFields(node,{msCustomRatioWidth:msCustomRatioWInput.value,msCustomRatioHeight:msCustomRatioHInput.value});
                syncMsCustomSizeControls();
                deps.scheduleSave();
            };
        });
        [msCustomWInput, msCustomHInput].forEach(input => {
            input.onmousedown = e => e.stopPropagation();
            input.onclick = e => e.stopPropagation();
            input.oninput = () => {
                deps.setCanvasMsSizeFields(node,{msCustomWidth:msCustomWInput.value,msCustomHeight:msCustomHInput.value});
                syncMsCustomSizeControls();
                deps.scheduleSave();
            };
        });
        if(msFitSizeBtn){
            msFitSizeBtn.onmousedown = e => e.stopPropagation();
            msFitSizeBtn.onclick = async e => {
                e.stopPropagation();
                const ref = referenceImages.find(item => item.url);
                if(!ref) return;
                try {
                    const dims = await deps.getImageDimensions(ref.url);
                    node.msCustomWidth = dims.width;
                    node.msCustomHeight = dims.height;
                    node.msCustomSize = `${dims.width}x${dims.height}`;
                    node.msResolution = 'custom';
                    node.msRatio = '';
                    syncMsCustomSizeControls();
                    deps.scheduleSave();
                } catch(err) {
                    deps.showErrorModal(deps.tr('canvas.imageReadFailed'));
                }
            };
        }
        syncMsCustomSizeControls();
    }
    const msCountInput = wrap.querySelector('.ms-count-input');
    if(msCountInput){
        msCountInput.onmousedown = e => e.stopPropagation();
        msCountInput.onclick = e => e.stopPropagation();
        msCountInput.oninput = e => {
            node.count = Math.max(1, Math.min(8, Number(e.target.value) || 1));
            deps.scheduleSave();
        };
        msCountInput.onblur = e => { e.target.value = String(Math.max(1, Math.min(8, Number(node.count || 1)))); };
        wrap.querySelectorAll('[data-ms-step]').forEach(btn => {
            btn.onclick = e => {
                e.stopPropagation();
                const next = Math.max(1, Math.min(8, Number(node.count || 1) + Number(btn.dataset.msStep || 0)));
                node.count = next;
                msCountInput.value = String(next);
                deps.scheduleSave();
            };
        });
    }
    const msLoraCheck = wrap.querySelector('.ms-lora-check');
    if(msLoraCheck){
        msLoraCheck.onchange = e => {
            node.msLoraEnabled = e.target.checked;
            if(node.msLoraEnabled && !node.msLoraId && msLoras[0]){
                node.msLoraId = String(msLoras[0].id || '').trim();
                node.msLoraStrength = Number(msLoras[0].strength ?? 0.8);
            }
            deps.scheduleSave();
            deps.render();
        };
    }
    const msLoraSelect = wrap.querySelector('.ms-lora-select');
    if(msLoraSelect){
        msLoraSelect.onmousedown = e => e.stopPropagation();
        msLoraSelect.onclick = e => e.stopPropagation();
        msLoraSelect.onchange = e => {
            node.msLoraId = e.target.value;
            const picked = msLoras.find(lora => String(lora.id || '').trim() === node.msLoraId);
            node.msLoraStrength = Number(picked?.strength ?? node.msLoraStrength ?? 0.8);
            deps.scheduleSave();
            deps.render();
        };
    }
    const msLoraSlider = wrap.querySelector('.ms-lora-strength-slider');
    if(msLoraSlider){
        msLoraSlider.onmousedown = e => e.stopPropagation();
        msLoraSlider.onclick = e => e.stopPropagation();
        msLoraSlider.oninput = e => {
            node.msLoraStrength = parseFloat(e.target.value);
            const val = wrap.querySelector('.ms-lora-strength-val');
            if(val) val.textContent = node.msLoraStrength.toFixed(2);
            deps.scheduleSave();
        };
    }
    // Make entire setting-check pill clickable (not just the checkbox square)
    wrap.querySelectorAll('.setting-check').forEach(pill => {
        pill.onmousedown = e => e.stopPropagation();
        const cb = pill.querySelector('input[type="checkbox"]');
        if(!cb) return;
        pill.onclick = e => {
            e.stopPropagation();
            e.preventDefault(); // prevent native label activation; we handle it
            cb.checked = !cb.checked;
            cb.dispatchEvent(new deps.Event('change'));
        };
        cb.onclick = e => e.stopPropagation(); // prevent bubble → pill.onclick
    });
    if(msUsesImages){
        const list = wrap.querySelector('.ms-img-list');
        deps.renderImageInputList(list, node, mediaInputs);
    }
    deps.renderPromptPreview(wrap.querySelector('.prompt-list'), promptInputs);
    wrap.querySelector('.gen-btn').onclick = e => { e.stopPropagation(); deps.runCanvasGenerate(node.id); };
    deps.bindCascadeButtons(wrap, node.id);
    return wrap;
}

function renderGeneratorBody(deps, node){
    const audioSources=deps.orderedSources(node,deps.generatorSources(node));
    if(deps.canvasApiAudioMode(node,audioSources))return deps.renderCanvasApiAudio(node,audioSources);
    const wrap = deps.document.createElement('div');
    wrap.className = 'generator-body';
    const inputSources = deps.generatorSources(node);
    const ordered = deps.orderedSources(node, inputSources);
    const mediaInputs = ordered.filter(src => src.refs?.some(ref => ['image','video','audio'].includes(deps.mediaKindForRef(ref))));
    const hasAudioAnalysisInput = audioSources.some(src => src.refs?.some(ref => deps.mediaKindForRef(ref) === 'audio'));
    const promptInputs = ordered.filter(src => src.prompt && !src.refs?.length && src.id !== `${node.id}:view-adjust`);
    if(hasAudioAnalysisInput){
        const providers = deps.audioAnalysisApiProviders();
        if(!providers.some(provider => provider.id === node.apiProvider)) node.apiProvider = providers[0]?.id || '';
        const models = deps.providerAudioAnalysisModels(node.apiProvider);
        if(models.length && !models.includes(node.model)) node.model = models[0];
    }else deps.sanitizeImageNodeProviderModel(node);
    deps.normalizeApiNodeSizeChoice(node);
    wrap.innerHTML = `
        ${typeof node.viewAdjustPrompt === 'string' ? `<div class="prompt-editor view-adjust-node-prompt"><textarea data-view-adjust-prompt aria-label="视角调整提示词">${deps.escapeHtml(node.viewAdjustPrompt)}</textarea></div>` : ''}
        <div class="prompt-list mb-3"></div>
        <div class="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">${hasAudioAnalysisInput ? '音频输入 · 文本模型分析' : deps.tr('canvas.images')}</div>
        <div class="input-list"></div>
        <div class="gen-settings">
            <div class="gen-settings-row">
                <select class="select-lite provider-select">${hasAudioAnalysisInput ? deps.audioAnalysisProviderOptions(node.apiProvider) : `${deps.providerOptions(node.apiProvider)}${deps.canvasAudioProviderOptions(node.apiProvider)}`}</select>
                <select class="select-lite model-select">${hasAudioAnalysisInput ? deps.audioAnalysisModelOptions(node.model, node.apiProvider) : `${deps.imageModelOptions(node.model, node.apiProvider)}${deps.canvasAudioModelOptions(node.apiProvider)}`}</select>
            </div>
            <div class="gen-settings-row api-size-row"${hasAudioAnalysisInput ? ' style="display:none"' : ''}>
                <select class="select-lite resolution compact-select" data-field="resolution">
                    <option value="auto">自动</option>
                    <option value="1k">1K</option>
                    <option value="2k">2K</option>
                    <option value="4k">4K</option>
                    <option value="custom">${deps.tr('canvas.custom')}</option>
                </select>
                <select class="select-lite ratio compact-select" data-field="ratio">
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
                <select class="select-lite quality-select">
                    <option value="auto">Q auto</option>
                    <option value="low">Q low</option>
                    <option value="medium">Q med</option>
                    <option value="high">Q high</option>
                </select>
                <div class="gen-count-row">
                    <div class="gen-stepper">
                        <button class="gen-step-btn" data-step="-1" type="button" title="${deps.tr('canvas.decrease')}" aria-label="${deps.tr('canvas.decreaseCount')}"><i data-lucide="chevron-left" class="w-3.5 h-3.5"></i></button>
                        <input class="gen-count-input" type="text" inputmode="numeric" pattern="[0-9]*" value="${Math.max(1, Math.min(8, Number(node.count || 1)))}">
                        <button class="gen-step-btn" data-step="1" type="button" title="${deps.tr('canvas.increase')}" aria-label="${deps.tr('canvas.increaseCount')}"><i data-lucide="chevron-right" class="w-3.5 h-3.5"></i></button>
                    </div>
                </div>
            </div>
            <div class="gen-settings-row custom-ratio-row" style="display:none">
                <label class="field">
                    <div class="setting-title">${deps.tr('canvas.ratioWidth')}</div>
                    <input class="setting-input custom-ratio-w-input" type="number" min="1" step="1" value="${deps.escapeHtml(node.customRatioWidth || '')}" placeholder="4">
                </label>
                <label class="field">
                    <div class="setting-title">${deps.tr('canvas.ratioHeight')}</div>
                    <input class="setting-input custom-ratio-h-input" type="number" min="1" step="1" value="${deps.escapeHtml(node.customRatioHeight || '')}" placeholder="3">
                </label>
            </div>
            <div class="gen-settings-row custom-size-row" style="display:none">
                <label class="field">
                    <div class="setting-title">${deps.tr('canvas.width')}</div>
                    <input class="setting-input custom-w-input" type="number" min="64" step="64" value="${deps.escapeHtml(node.customWidth || '')}" placeholder="Auto">
                </label>
                <label class="field">
                    <div class="setting-title">${deps.tr('canvas.height')}</div>
                    <input class="setting-input custom-h-input" type="number" min="64" step="64" value="${deps.escapeHtml(node.customHeight || '')}" placeholder="Auto">
                </label>
                <button class="secondary-btn fit-size-btn" type="button" style="height:32px;align-self:flex-end;padding:0 10px;font-size:11px">${deps.tr('canvas.fitImageSize')}</button>
            </div>
        </div>
        <div class="gen-run-row">
            <button class="gen-btn ${node.running ? 'running' : ''}" ${node.running ? 'disabled' : ''}><i data-lucide="zap" class="w-4 h-4"></i>${node.running ? deps.tr('canvas.generating') : deps.tr('canvas.apiGenerate')}</button>
            ${deps.cascadeBtnHtml(node)}
        </div>
        ${deps.retryBarHtml(node)}
    `;
    const viewPrompt = wrap.querySelector('[data-view-adjust-prompt]');
    if(viewPrompt){
        viewPrompt.onmousedown = event => event.stopPropagation();
        viewPrompt.oninput = () => {node.viewAdjustPrompt = viewPrompt.value; deps.scheduleSave();};
    }
    const providerSelect = wrap.querySelector('.provider-select');
    const modelSelect = wrap.querySelector('.model-select');
    providerSelect.onmousedown = e => e.stopPropagation();
    providerSelect.onclick = e => e.stopPropagation();
    providerSelect.onchange = e => {
        e.stopPropagation();
        if(hasAudioAnalysisInput){
            node.apiProvider = e.target.value;
            const models = deps.providerAudioAnalysisModels(node.apiProvider);
            node.model = models[0] || '';
            modelSelect.innerHTML = deps.audioAnalysisModelOptions(node.model, node.apiProvider);
            deps.scheduleSave();
            return;
        }
        if(!deps.imageApiProviders().some(p=>p.id===e.target.value)){node.audioProvider=e.target.value;node.audioManualSelection=true;deps.refreshNodes([node.id]);deps.scheduleSave();return;}
        node.apiProvider = e.target.value;
        const providerModels = deps.providerImageModels(node.apiProvider);
        if(!providerModels.includes(deps.resolveImageModel(node.model))) node.model = providerModels[0] || '';
        node._apiResolutionUserSet = false;
        node.resolution = deps.defaultApiImageResolution(node.model);
        modelSelect.innerHTML = deps.imageModelOptions(node.model, node.apiProvider)+deps.canvasAudioModelOptions(node.apiProvider);
        syncSizeControls();
        syncQualityControls();
        deps.scheduleSave();
    };
    modelSelect.onmousedown = e => e.stopPropagation();
    modelSelect.onclick = e => e.stopPropagation();
    modelSelect.onchange = e => {
        e.stopPropagation();
        if(hasAudioAnalysisInput){
            node.model = e.target.value;
            deps.scheduleSave();
            return;
        }
        if(e.target.value.startsWith('audio:')){node.audioProvider=node.apiProvider;node.audioModel=e.target.value.slice(6);node.audioManualSelection=true;deps.refreshNodes([node.id]);deps.scheduleSave();return;}
        node.model = e.target.value;
        node._apiResolutionUserSet = false;
        if(node.resolution !== 'custom') node.resolution = deps.defaultApiImageResolution(node.model);
        syncSizeControls();
        syncQualityControls();
        deps.scheduleSave();
    };
    const ratioSelect = wrap.querySelector('.ratio');
    const resolutionSelect = wrap.querySelector('.resolution');
    const qualitySelect = wrap.querySelector('.quality-select');
    const customRatioRow = wrap.querySelector('.custom-ratio-row');
    const customSizeRow = wrap.querySelector('.custom-size-row');
    const customRatioWInput = wrap.querySelector('.custom-ratio-w-input');
    const customRatioHInput = wrap.querySelector('.custom-ratio-h-input');
    const customWInput = wrap.querySelector('.custom-w-input');
    const customHInput = wrap.querySelector('.custom-h-input');
    const fitSizeBtn = wrap.querySelector('.fit-size-btn');
    const referenceImages = ordered.flatMap(src => src.refs || []);
    const syncQualityControls = () => {
        qualitySelect.disabled = false;
        if(!['auto','low','medium','high'].includes(String(node.quality || 'auto'))) node.quality = 'auto';
        qualitySelect.value = node.quality || 'auto';
    };
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
    hydrateCustomParts();
    let sourceRatioRequest = 0;
    const updateSourceRatioFromFirstRef = async () => {
        if(node.ratio !== 'source') return;
        const ref = referenceImages.find(item => item.url);
        const requestId = ++sourceRatioRequest;
        if(!ref){
            node.customRatio = '';
            node.customRatioWidth = '';
            node.customRatioHeight = '';
            customRatioWInput.value = '';
            customRatioHInput.value = '';
            return;
        }
        try {
            const dims = await deps.getImageDimensions(ref.url);
            if(requestId !== sourceRatioRequest || node.ratio !== 'source') return;
            const parts = deps.ratioPartsFromDimensions(dims.width, dims.height);
            node.customRatioWidth = String(parts.width);
            node.customRatioHeight = String(parts.height);
            node.customRatio = `${parts.width}:${parts.height}`;
            customRatioWInput.value = node.customRatioWidth;
            customRatioHInput.value = node.customRatioHeight;
            deps.scheduleSave();
        } catch(_) {}
    };
    const syncSizeControls = () => {
        deps.normalizeApiNodeSizeChoice(node);
        const autoOption = resolutionSelect.querySelector('option[value="auto"]');
        if(autoOption) autoOption.disabled = !deps.isGptImageAutoSizeModel(deps.resolveImageModel(node.model));
        const squareOption = ratioSelect.querySelector('option[value="square"]');
        if(squareOption){
            squareOption.disabled = false;
            squareOption.title = '';
        }
        const ratioValue = node.ratio && [...ratioSelect.options].some(opt => opt.value === node.ratio) ? node.ratio : 'square';
        ratioSelect.value = ratioValue;
        resolutionSelect.value = node.resolution || deps.defaultApiImageResolution(node.model);
        ratioSelect.disabled = node.resolution === 'custom' || node.resolution === 'auto';
        customRatioRow.style.display = (node.resolution !== 'auto' && (node.ratio === 'custom' || node.ratio === 'source')) ? 'flex' : 'none';
        customSizeRow.style.display = node.resolution === 'custom' ? 'flex' : 'none';
        customRatioWInput.disabled = node.ratio === 'source';
        customRatioHInput.disabled = node.ratio === 'source';
        customRatioWInput.value = node.customRatioWidth || '';
        customRatioHInput.value = node.customRatioHeight || '';
        customWInput.value = node.customWidth || '';
        customHInput.value = node.customHeight || '';
        if(fitSizeBtn) fitSizeBtn.disabled = !referenceImages.some(ref => ref.url);
        syncQualityControls();
        if(node.ratio === 'source') updateSourceRatioFromFirstRef();
    };
    qualitySelect.onmousedown = e => e.stopPropagation();
    qualitySelect.onclick = e => e.stopPropagation();
    qualitySelect.onchange = e => {
        e.stopPropagation();
        node.quality = e.target.value;
        deps.scheduleSave();
    };
    ratioSelect.onmousedown = e => e.stopPropagation();
    ratioSelect.onclick = e => e.stopPropagation();
    ratioSelect.onchange = e => {
        e.stopPropagation();
        deps.setCanvasGeneratorSizeFields(node,{ratio:e.target.value});
        syncSizeControls();
        deps.scheduleSave();
    };
    resolutionSelect.onmousedown = e => e.stopPropagation();
    resolutionSelect.onclick = e => e.stopPropagation();
    resolutionSelect.onchange = e => {
        e.stopPropagation();
        deps.setCanvasGeneratorSizeFields(node,{resolution:e.target.value});
        syncSizeControls();
        deps.scheduleSave();
    };
    [customRatioWInput, customRatioHInput].forEach(input => {
        input.onmousedown = e => e.stopPropagation();
        input.onclick = e => e.stopPropagation();
        input.oninput = e => {
            deps.setCanvasGeneratorSizeFields(node,{customRatioWidth:customRatioWInput.value,customRatioHeight:customRatioHInput.value});
            syncSizeControls();
            deps.scheduleSave();
        };
    });
    [customWInput, customHInput].forEach(input => {
        input.onmousedown = e => e.stopPropagation();
        input.onclick = e => e.stopPropagation();
        input.oninput = e => {
            deps.setCanvasGeneratorSizeFields(node,{customWidth:customWInput.value,customHeight:customHInput.value});
            syncSizeControls();
            deps.scheduleSave();
        };
    });
    if(fitSizeBtn){
        fitSizeBtn.onmousedown = e => e.stopPropagation();
        fitSizeBtn.onclick = async e => {
            e.stopPropagation();
            const ref = referenceImages.find(item => item.url);
            if(!ref) return;
            try {
                const dims = await deps.getImageDimensions(ref.url);
                node.customWidth = dims.width;
                node.customHeight = dims.height;
                node.customSize = `${dims.width}x${dims.height}`;
                node.resolution = 'custom';
                node._apiResolutionUserSet = true;
                node.ratio = '';
                syncSizeControls();
                deps.scheduleSave();
            } catch(err) {
                    deps.showErrorModal(deps.tr('canvas.imageReadFailed'));
            }
        };
    }
    syncSizeControls();
    const countInput = wrap.querySelector('.gen-count-input');
    countInput.onmousedown = e => e.stopPropagation();
    countInput.onclick = e => e.stopPropagation();
    countInput.oninput = e => {
        const value = Math.max(1, Math.min(8, Number(e.target.value) || 1));
        node.count = value;
        deps.scheduleSave();
    };
    countInput.onblur = e => { e.target.value = String(Math.max(1, Math.min(8, Number(node.count || 1)))); };
    wrap.querySelectorAll('[data-step]').forEach(btn => {
        btn.onclick = e => {
            e.stopPropagation();
            const next = Math.max(1, Math.min(8, Number(node.count || 1) + Number(btn.dataset.step || 0)));
            node.count = next;
            countInput.value = String(next);
            deps.scheduleSave();
        };
    });
    const list = wrap.querySelector('.input-list');
    deps.renderImageInputList(list, node, mediaInputs);
    deps.renderPromptPreview(wrap.querySelector('.prompt-list'), promptInputs);
    wrap.querySelector('.gen-btn').onclick = e => { e.stopPropagation(); deps.runCanvasGenerate(node.id); };
    deps.bindCascadeButtons(wrap, node.id);
    return wrap;
}

function midjourneyModalHtml(deps, node, maskRef){
    if(!node.mjModalTaskId) return '';
    const hasMask = Boolean(maskRef?.url);
    return `<div class="mj-modal-panel"><div class="mj-action-title">局部重绘</div><textarea class="mj-modal-prompt" placeholder="描述要替换的内容">${deps.escapeHtml(node.mjModalPrompt || node.lastPrompt || '')}</textarea><div class="mj-modal-mask ${hasMask ? 'ready' : ''}"><i data-lucide="${hasMask ? 'brush' : 'image-off'}"></i><span>${hasMask ? `遮罩已连接：${deps.escapeHtml(maskRef.name || 'mask')}` : '连接遮罩图片节点后才能提交'}</span></div><button type="button" class="mj-reroll mj-modal-submit" ${hasMask && !node.running ? '' : 'disabled'}><i data-lucide="wand-sparkles"></i>${node.running ? '提交中...' : '提交局部重绘'}</button></div>`;
}

function midjourneyContinuationHtml(deps, node){
    if(!node.lastTaskId || node.mjModalTaskId) return '';
    if(['blend','edit'].includes(node.lastAction)) return '';
    const isSingle = Number(node.lastImageCount || 0) === 1;
    if(!isSingle){
        if(['8.1','8.2'].includes(String(node.version || '')) && node.lastAction !== 'blend' && node.lastAction !== 'edit'){
            return `<div class="mj-actions"><div class="mj-action-title">v8 重塑</div><div class="mj-action-grid">${[1,2,3,4].map(index => `<button type="button" data-mj-action="remix_subtle" data-index="${index}" title="轻微重塑第 ${index} 张">R${index}</button>`).join('')}</div><div class="mj-action-grid">${[1,2,3,4].map(index => `<button type="button" data-mj-action="remix_strong" data-index="${index}" title="强烈重塑第 ${index} 张">R+${index}</button>`).join('')}</div><button class="mj-reroll" type="button" data-mj-action="reroll"><i data-lucide="refresh-cw"></i>重新生成</button></div>`;
        }
        return `<div class="mj-actions"><div class="mj-action-title">选择四宫格图片</div><div class="mj-action-grid">${[1,2,3,4].map(index => `<button type="button" data-mj-action="upscale" data-index="${index}" title="放大第 ${index} 张">U${index}</button>`).join('')}</div><div class="mj-action-grid">${[1,2,3,4].map(index => `<button type="button" data-mj-action="variation" data-index="${index}" title="生成第 ${index} 张的弱变体">V${index}</button>`).join('')}</div><button class="mj-reroll" type="button" data-mj-action="reroll"><i data-lucide="refresh-cw"></i>重新生成</button></div>`;
    }
    return `<div class="mj-actions"><div class="mj-action-title">单图细化</div><div class="mj-text-action-grid"><button type="button" data-mj-action="low_variation" data-index="1">弱变体</button><button type="button" data-mj-action="high_variation" data-index="1">强变体</button><button type="button" data-mj-action="zoom" data-zoom-ratio="1.5">扩图 1.5x</button><button type="button" data-mj-action="zoom" data-zoom-ratio="2">扩图 2x</button></div><div class="mj-pan-grid"><button type="button" data-mj-action="pan" data-direction="left" title="向左扩展"><i data-lucide="arrow-left"></i></button><button type="button" data-mj-action="pan" data-direction="up" title="向上扩展"><i data-lucide="arrow-up"></i></button><button type="button" data-mj-action="inpaint" title="局部重绘"><i data-lucide="brush"></i></button><button type="button" data-mj-action="pan" data-direction="right" title="向右扩展"><i data-lucide="arrow-right"></i></button></div></div>`;
}

function renderMidjourneyBody(deps, node){
    const wrap = deps.document.createElement('div');
    wrap.className = 'generator-body midjourney-body';
    node.apiProvider = deps.resolveMidjourneyProviderId(node.apiProvider || '');
    node.mode = ['imagine','blend','edit'].includes(node.mode) ? node.mode : 'imagine';
    node.size = /^\d{1,2}:\d{1,2}$/.test(String(node.size || '')) ? node.size : '1:1';
    node.version = String(node.version || '6.1');
    node.speed = ['relax','fast','turbo'].includes(node.speed) ? node.speed : 'relax';
    const sources = deps.orderedSources(node, deps.generatorSources(node));
    const mediaInputs = sources.filter(src => src.refs?.some(ref => deps.mediaKindForRef(ref) === 'image'));
    const promptInputs = sources.filter(src => src.prompt && !src.refs?.length);
    const maskRef = mediaInputs.flatMap(source => source.refs || []).find(ref => String(ref.role || '').toLowerCase() === 'mask') || null;
    const hasProvider = Boolean(node.apiProvider);
    const taskText = node.lastTaskId ? `任务 ${deps.escapeHtml(node.lastTaskId.slice(-14))}` : '生成四宫格后可选图';
    const runLabel = node.running ? '提交中...' : '生成四宫格';
    wrap.innerHTML = `
        <div class="prompt-list mb-3"></div>
        <div class="midjourney-input-head"><span>参考图片</span><span>最多 4 张</span></div>
        <div class="input-list mj-input-list"></div>
        <div class="gen-settings mj-settings">
            <div class="gen-settings-row">
                <select class="select-lite mj-mode"><option value="imagine" ${node.mode === 'imagine' ? 'selected' : ''}>生成</option><option value="blend" ${node.mode === 'blend' ? 'selected' : ''}>融合</option><option value="edit" ${node.mode === 'edit' ? 'selected' : ''}>编辑</option></select>
                <select class="select-lite mj-provider">${deps.midjourneyProviderOptions(node.apiProvider)}</select>
                <select class="select-lite mj-version">
                    ${['8.2','8.1','7','6.1','5.2','5.1'].map(version => `<option value="${version}" ${node.version === version ? 'selected' : ''}>v${version}</option>`).join('')}
                </select>
            </div>
            <div class="gen-settings-row">
                <select class="select-lite mj-size">
                    ${['1:1','3:4','4:3','9:16','16:9','21:9'].map(size => `<option value="${size}" ${node.size === size ? 'selected' : ''}>${size}</option>`).join('')}
                </select>
                <select class="select-lite mj-speed">
                    <option value="relax" ${node.speed === 'relax' ? 'selected' : ''}>Relax</option>
                    <option value="fast" ${node.speed === 'fast' ? 'selected' : ''}>Fast</option>
                    <option value="turbo" ${node.speed === 'turbo' ? 'selected' : ''}>Turbo</option>
                </select>
            </div>
        </div>
        <div class="mj-task-line ${node.lastTaskId ? 'ready' : ''}"><i data-lucide="clock-3"></i><span>${taskText}</span></div>
        <div class="gen-run-row"><button class="gen-btn mj-run" ${node.running || !hasProvider ? 'disabled' : ''}><i data-lucide="wand-sparkles" class="w-4 h-4"></i>${runLabel}</button>${deps.cascadeBtnHtml(node)}</div>
        ${midjourneyContinuationHtml(deps, node)}
        ${midjourneyModalHtml(deps, node, maskRef)}
        ${deps.retryBarHtml(node)}
    `;
    deps.renderPromptPreview(wrap.querySelector('.prompt-list'), promptInputs);
    deps.renderImageInputList(wrap.querySelector('.mj-input-list'), node, mediaInputs);
    ['mode','provider','version','size','speed'].forEach(field => {
        const input = wrap.querySelector(`.mj-${field}`);
        if(!input) return;
        input.onchange = event => {
            event.stopPropagation();
            node[field === 'provider' ? 'apiProvider' : field] = event.target.value;
            deps.scheduleSave();
            if(field === 'provider' || field === 'mode') deps.render();
        };
    });
    wrap.querySelector('.mj-run').onclick = event => { event.stopPropagation(); deps.runCanvasGenerate(node.id); };
    wrap.querySelectorAll('[data-mj-action]').forEach(button => {
        button.onclick = event => {
            event.stopPropagation();
            deps.runMidjourneyAction(node.id, button.dataset.mjAction, Number(button.dataset.index || 0), {
                direction:button.dataset.direction || '',
                zoomRatio:Number(button.dataset.zoomRatio || 0) || null
            });
        };
    });
    const modalPrompt = wrap.querySelector('.mj-modal-prompt');
    if(modalPrompt){
        modalPrompt.oninput = event => { node.mjModalPrompt = event.target.value; deps.scheduleSave(); };
    }
    const modalSubmit = wrap.querySelector('.mj-modal-submit');
    if(modalSubmit){
        modalSubmit.onclick = event => { event.stopPropagation(); deps.runMidjourneyModal(node.id, maskRef); };
    }
    deps.bindCascadeButtons(wrap, node.id);
    return wrap;
}

function renderVideoBody(deps, node){
    const wrap = deps.document.createElement('div');
    wrap.className = 'generator-body';
    const inputSources = deps.generatorSources(node);
    const ordered = deps.orderedSources(node, inputSources);
    const mediaInputs = ordered.filter(src => src.refs?.some(ref => ['image','video','audio'].includes(deps.mediaKindForRef(ref))));
    const promptInputs = ordered.filter(src => src.prompt && !src.refs?.length);
    deps.sanitizeVideoNodeProviderModel(node);
    node.model = node.model || 'veo3-fast';
    wrap.innerHTML = `
        <div class="prompt-list mb-3"></div>
        <div class="video-input-head">
            <div class="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Media</div>
            <div class="video-input-actions">
                <button type="button" class="tool-btn" data-video-manual-url title="手动输入视频 URL"><i data-lucide="link" class="w-4 h-4"></i><span>输入网址</span></button>
                <button type="button" class="tool-btn" data-video-temp-sh ${node.tempShUploading ? 'disabled' : ''} title="上传当前输入视频到云端直链"><i data-lucide="upload-cloud" class="w-4 h-4"></i><span>${node.tempShUploading ? '上传中...' : '上传云端'}</span></button>
            </div>
        </div>
        <div class="input-list video-img-list"></div>
        <div class="gen-settings">
            <div class="gen-settings-row">
                <select class="select-lite video-provider" style="flex:1">${deps.videoProviderOptions(node.apiProvider)}</select>
                <select class="select-lite video-model" style="flex:2">${deps.videoModelOptions(node.model, node.apiProvider)}</select>
            </div>
            <div class="gen-settings-row">
                <label class="field" style="flex:1">
                    <div class="setting-title">${deps.tr('canvas.videoDuration')}</div>
                    <input class="setting-input video-duration" type="number" min="1" max="60" step="1" value="${Number(node.duration || 5)}">
                </label>
                <label class="field" style="flex:1">
                    <div class="setting-title">${deps.tr('canvas.videoAspect')}</div>
                    <select class="select-lite video-aspect compact-select">
                        <option value="16:9">16:9</option>
                        <option value="9:16">9:16</option>
                        <option value="1:1">1:1</option>
                        <option value="4:3">4:3</option>
                        <option value="3:4">3:4</option>
                        <option value="21:9">21:9</option>
                        <option value="9:21">9:21</option>
                        <option value="keep_ratio">keep</option>
                        <option value="adaptive">adapt</option>
                    </select>
                </label>
                <label class="field" style="flex:1">
                    <div class="setting-title">${deps.tr('canvas.videoResolution')}</div>
                    <select class="select-lite video-resolution compact-select">
                        <option value="">Auto</option>
                        <option value="480p">480p</option>
                        <option value="720p">720p</option>
                        <option value="1080p">1080p</option>
                        <option value="780P">780P</option>
                    </select>
                </label>
            </div>
            <div class="gen-settings-row" style="flex-wrap:wrap">
                <button type="button" class="setting-check ${node.enhancePrompt ? 'active' : ''}" data-video-toggle="enhancePrompt"><span class="check-dot"></span>${deps.tr('canvas.videoEnhancePrompt')}</button>
                <button type="button" class="setting-check ${node.enableUpsample ? 'active' : ''}" data-video-toggle="enableUpsample"><span class="check-dot"></span>${deps.tr('canvas.videoUpsample')}</button>
                <button type="button" class="setting-check ${node.watermark ? 'active' : ''}" data-video-toggle="watermark"><span class="check-dot"></span>${deps.tr('canvas.videoWatermark')}</button>
                <button type="button" class="setting-check ${node.cameraFixed ? 'active' : ''}" data-video-toggle="cameraFixed"><span class="check-dot"></span>${deps.tr('canvas.videoCameraFixed')}</button>
                <button type="button" class="setting-check ${node.generateAudio ? 'active' : ''}" data-video-toggle="generateAudio"><span class="check-dot"></span>${deps.tr('canvas.videoGenerateAudio')}</button>
                <button type="button" class="setting-check ${node.multimodal ? 'active' : ''}" data-video-toggle="multimodal"><span class="check-dot"></span>${deps.tr('canvas.videoMultimodal')}</button>
                <button type="button" class="setting-check ${node.useFrameRoles ? 'active' : ''}" data-video-toggle="useFrameRoles"><span class="check-dot"></span>${deps.tr('canvas.videoFirstLastFrames')}</button>
            </div>
        </div>
        <div class="gen-run-row">
            <button class="gen-btn ${node.running ? 'running' : ''}" ${node.running ? 'disabled' : ''}><i data-lucide="clapperboard" class="w-4 h-4"></i>${node.running ? deps.tr('canvas.generating') : deps.tr('canvas.videoGenerate')}</button>
            ${deps.cascadeBtnHtml(node)}
        </div>
        ${deps.retryBarHtml(node)}
    `;
    const providerSelect = wrap.querySelector('.video-provider');
    const modelSelect = wrap.querySelector('.video-model');
    const durationSelect = wrap.querySelector('.video-duration');
    const aspectSelect = wrap.querySelector('.video-aspect');
    const resolutionSelect = wrap.querySelector('.video-resolution');
    providerSelect.value = node.apiProvider;
    durationSelect.value = String(node.duration || 5);
    aspectSelect.value = node.aspectRatio || '16:9';
    resolutionSelect.value = node.resolution || '';
    [providerSelect, modelSelect, durationSelect, aspectSelect, resolutionSelect].forEach(input => {
        input.onmousedown = e => e.stopPropagation();
        input.onclick = e => e.stopPropagation();
    });
    providerSelect.onchange = e => {
        e.stopPropagation();
        node.apiProvider = e.target.value;
        const models = deps.providerVideoModels(node.apiProvider);
        if(!models.includes(node.model)) node.model = models[0] || node.model;
        modelSelect.innerHTML = deps.videoModelOptions(node.model, node.apiProvider);
        deps.scheduleSave();
    };
    modelSelect.onchange = e => { e.stopPropagation(); node.model = e.target.value; deps.scheduleSave(); };
    durationSelect.oninput = e => { e.stopPropagation(); node.duration = Math.max(1, Math.min(60, Number(e.target.value || 5))); deps.scheduleSave(); };
    durationSelect.onblur = e => { e.target.value = String(Math.max(1, Math.min(60, Number(node.duration || 5)))); };
    aspectSelect.onchange = e => { e.stopPropagation(); node.aspectRatio = e.target.value; deps.scheduleSave(); };
    resolutionSelect.onchange = e => { e.stopPropagation(); node.resolution = e.target.value; deps.scheduleSave(); };
    wrap.querySelectorAll('[data-video-toggle]').forEach(btn => {
        btn.onmousedown = e => e.stopPropagation();
        btn.onclick = e => {
            e.stopPropagation();
            const field = btn.dataset.videoToggle;
            node[field] = !node[field];
            if(field === 'multimodal' && node.multimodal) node.useFrameRoles = false;
            if(field === 'useFrameRoles' && node.useFrameRoles) node.multimodal = false;
            deps.render();
            deps.scheduleSave();
        };
    });
    wrap.querySelectorAll('[data-video-temp-sh]').forEach(btn => {
        btn.onmousedown = e => e.stopPropagation();
        btn.onclick = async e => {
            e.stopPropagation();
            try {
                await deps.uploadCanvasVideosToCloud(node.id);
            } catch(err) {
                deps.showErrorModal(err.message || '云端上传失败', '上传云端');
            }
        };
    });
    wrap.querySelectorAll('[data-video-manual-url]').forEach(btn => {
        btn.onmousedown = e => e.stopPropagation();
        btn.onclick = async e => {
            e.stopPropagation();
            try {
                await deps.setCanvasManualVideoUrl(node.id);
            } catch(err) {
                deps.showErrorModal(err.message || '设置视频网址失败', '输入网址');
            }
        };
    });
    const list = wrap.querySelector('.video-img-list');
    deps.renderVideoImageInputs(list, node, mediaInputs);
    deps.renderPromptPreview(wrap.querySelector('.prompt-list'), promptInputs);
    wrap.querySelector('.gen-btn').onclick = e => { e.stopPropagation(); deps.runCanvasGenerate(node.id); };
    deps.bindCascadeButtons(wrap, node.id);
    return wrap;
}

const api={renderMsGenBody, renderGeneratorBody, midjourneyModalHtml, midjourneyContinuationHtml, renderMidjourneyBody, renderVideoBody};
if(typeof module!=='undefined' && module.exports) module.exports=api;
root.CanvasGenerationView=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
