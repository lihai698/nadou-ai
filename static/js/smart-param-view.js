/* Smart parameter panel responsibility: smart-param-view. Host supplies live state and effects. */
(function(root){
    'use strict';

function renderDynamicParams(deps){
    if(!deps.dynamicParams) return;
    const keepOpen = deps.openControlState();
    const scrollState = deps.dynamicParamsScrollSnapshot();
    deps.settings.engine = ['api','volcengine','modelscope','comfy','runninghub'].includes(deps.settings.engine) ? deps.settings.engine : 'api';
    deps.settings.apiKind = deps.settings.apiKind === 'video' ? 'video' : 'image';
    deps.clearVolcengineSelectionOutsideVolcengine(deps.settings);
    deps.engineSelect.value = deps.settings.engine;
    deps.syncApiKindToggleVisibility();
    if(deps.settings.engine === 'api'){
        if(deps.smartApiAudioMode(deps.activeSettingsSubject(),deps.settings))deps.renderSmartApiAudioParams();
        else if(deps.settings.apiKind === 'video') renderApiVideoParams(deps);
        else renderApiParams(deps);
    }
    else if(deps.settings.engine === 'volcengine'){
        if(deps.settings.apiKind === 'video') renderVolcengineVideoParams(deps);
        else renderVolcengineParams(deps);
    }
    else if(deps.settings.engine === 'modelscope') renderMsParams(deps);
    else if(deps.settings.engine === 'runninghub') renderRunningHubParams(deps);
    else renderComfyParams(deps);
    deps.bindDynamicParams();
    deps.restoreOpenControl(keepOpen);
    deps.restoreDynamicParamsScroll(scrollState);
    deps.updatePromptPlaceholder();
    // renderApiParams 会根据上游音频重新整理文本模型，整理完成后再同步图片/视频切换按钮。
    deps.syncApiKindToggleVisibility();
    deps.persistActiveSmartSettings();
    deps.syncRunButtonState();
    if(deps.window.lucide) deps.lucide.createIcons();
}

function renderApiParams(deps){
    const audioAnalysis = deps.smartHasAudioAnalysisInput();
    const providers = audioAnalysis ? deps.chatApiProviders() : deps.imageProviders();
    const awaitingSelection=deps.activeSettingsSubject?.()?.shotTableOrigin&&(!deps.settings.provider_id||!deps.settings.model);
    if(!awaitingSelection&&(!deps.settings.provider_id || !providers.some(p => p.id === deps.settings.provider_id))) deps.settings.provider_id = providers[0]?.id || '';
    const models = audioAnalysis ? deps.providerChatModels(deps.settings.provider_id) : deps.filterJimengImageModels(deps.providerImageModels(deps.settings.provider_id));
    if(!awaitingSelection&&(!deps.settings.model || !models.includes(deps.settings.model))) deps.settings.model = models[0] || '';
    // 切换平台/模型时保留用户已选的分辨率（记忆），normalizeApiSizeSettings 只会修正非法的 auto。
    deps.normalizeApiSizeSettings('');
    const outpaintLocked = deps.settings.outpaintResolutionLocked === true;
    deps.dynamicParams.innerHTML = `
        ${deps.renderProviderControl(providers)}
        ${deps.renderModelControl(models,{audioAnalysis})}
        ${audioAnalysis ? '' : `${deps.renderSizePickerControl('', true)}${deps.renderQualityControl()}${deps.renderCountVisualControl()}${deps.isJimengProviderId(deps.settings.provider_id) ? deps.renderJimengUpscaleControl() : ''}`}
    `;
}

function renderApiVideoParams(deps){
    const providers = deps.videoApiProviders();
    const awaitingSelection=deps.activeSettingsSubject?.()?.shotTableOrigin&&(!deps.settings.videoProvider||!deps.settings.videoModel);
    if(!awaitingSelection&&(!deps.settings.videoProvider || !providers.some(p => p.id === deps.settings.videoProvider))) deps.settings.videoProvider = providers[0]?.id || 'comfly';
    const models = deps.filterJimengVideoModels(deps.providerVideoModels(deps.settings.videoProvider));
    if(!awaitingSelection&&(!deps.settings.videoModel || !models.includes(deps.settings.videoModel))) deps.settings.videoModel = models[0] || 'veo3-fast';
    deps.dynamicParams.innerHTML = `
        ${deps.renderVideoProviderControl(providers)}
        ${deps.renderVideoModelControl(models)}
        ${deps.renderVideoResolutionControl()}
        ${deps.renderVideoAspectControl()}
        ${deps.renderVideoDurationControl()}
        ${deps.renderVideoToggleControl('videoEnhancePrompt', deps.tr('smart.videoEnhancePrompt'))}
        ${deps.renderVideoToggleControl('videoEnableUpsample', deps.tr('smart.videoUpsample'))}
        ${deps.renderVideoToggleControl('videoGenerateAudio', deps.tr('smart.videoGenerateAudio'))}
        ${deps.renderVideoToggleControl('videoCameraFixed', deps.tr('smart.videoCameraFixed'))}
        ${deps.renderVideoToggleControl('videoWatermark', deps.tr('smart.videoWatermark'))}
        ${deps.renderVideoToggleControl('videoMultimodal', deps.tr('smart.videoMultimodal'))}
        ${deps.renderVideoToggleControl('videoUseFrameRoles', deps.tr('smart.videoUseFrameRoles'))}
        ${deps.isJimengProviderId(deps.settings.videoProvider) ? '' : deps.renderVideoTrustedAssetControl()}
    `;
}

function renderVolcengineParams(deps){
    const provider = deps.volcengineProvider();
    const providers = [provider];
    const models = deps.providerImageModels('volcengine');
    deps.settings.provider_id = 'volcengine';
    if(!deps.settings.model || !models.includes(deps.settings.model)) deps.settings.model = models[0] || '';
    deps.normalizeApiSizeSettings('');
    const outpaintLocked = deps.settings.outpaintResolutionLocked === true;
    deps.dynamicParams.innerHTML = `
        ${deps.renderProviderControl(providers)}
        ${deps.renderModelControl(models)}
        ${deps.renderSizePickerControl('', true)}
        ${deps.renderQualityControl()}
        ${deps.renderCountVisualControl()}
    `;
}

function renderVolcengineVideoParams(deps){
    const provider = deps.volcengineProvider();
    const providers = [provider];
    const models = deps.volcengineVideoModels();
    deps.settings.videoProvider = 'volcengine';
    if(!deps.settings.videoModel || !models.includes(deps.settings.videoModel)) deps.settings.videoModel = models[0] || 'seedance-1.0-pro';
    deps.dynamicParams.innerHTML = `
        ${deps.renderVideoProviderControl(providers)}
        ${deps.renderVideoModelControl(models)}
        ${deps.renderVideoResolutionControl()}
        ${deps.renderVideoAspectControl()}
        ${deps.renderVideoDurationControl()}
        ${deps.renderVideoToggleControl('videoEnhancePrompt', deps.tr('smart.videoEnhancePrompt'))}
        ${deps.renderVideoToggleControl('videoEnableUpsample', deps.tr('smart.videoUpsample'))}
        ${deps.renderVideoToggleControl('videoGenerateAudio', deps.tr('smart.videoGenerateAudio'))}
        ${deps.renderVideoToggleControl('videoCameraFixed', deps.tr('smart.videoCameraFixed'))}
        ${deps.renderVideoToggleControl('videoWatermark', deps.tr('smart.videoWatermark'))}
        ${deps.renderVideoToggleControl('videoMultimodal', deps.tr('smart.videoMultimodal'))}
        ${deps.renderVideoToggleControl('videoUseFrameRoles', deps.tr('smart.videoUseFrameRoles'))}
        ${deps.renderVideoTrustedAssetControl()}
    `;
}

function renderRunningHubParams(deps){
    const ref = deps.selectedRunningHubRef();
    const fields = deps.rhActiveFields();
    deps.settings.rhPayment = deps.settings.rhPayment === 'wallet' ? 'wallet' : 'free';
    deps.settings.rhParams = deps.settings.rhParams || {};
    deps.settings.rhRandomActive = deps.settings.rhRandomActive || {};
    if(!ref){
        deps.dynamicParams.innerHTML = `<div class="muted-note">${deps.escapeHtml(deps.tr('smart.rhNeedConfig'))}</div>`;
        return;
    }
    if(ref.kind === 'model'){
        deps.settings.provider_id = 'runninghub';
        deps.settings.model = ref.id;
        deps.normalizeApiSizeSettings('');
        deps.dynamicParams.innerHTML = `
            ${deps.renderRhConfigControl(ref)}
            ${deps.renderSizePickerControl('', true)}
            ${deps.renderQualityControl()}
            ${deps.renderCountVisualControl()}
        `;
        return;
    }
    const mediaFields = fields.filter(f => ['image','video','audio'].includes(deps.rhFieldRole(f))).length;
    const promptFields = fields.filter(f => deps.rhFieldRole(f) === 'prompt').length;
    deps.dynamicParams.innerHTML = `
        ${deps.renderRhConfigControl(ref)}
        ${deps.renderRhPaymentControl()}
        ${deps.renderRhMachineControl()}
        <div class="rh-mini-summary">${deps.escapeHtml(mediaFields)} 素材 · ${deps.escapeHtml(promptFields)} 提示词</div>
        ${fields.length ? fields.filter(f => !['image','video','audio','prompt'].includes(deps.rhFieldRole(f))).map(deps.renderRhSettingField).join('') : `<div class="muted-note">${deps.escapeHtml(deps.tr('smart.rhNeedFields'))}</div>`}
    `;
}

function renderMsParams(deps){
    deps.settings.msgenModel = deps.MS_GEN_MODELS[deps.settings.msgenModel] ? deps.settings.msgenModel : 'zimage';
    if(!deps.settings.msCustomModel) deps.settings.msCustomModel = deps.modelscopeImageModels()[0] || 'Tongyi-MAI/Z-Image-Turbo';
    deps.normalizeApiSizeSettings('ms');
    deps.dynamicParams.innerHTML = `
        ${deps.renderMsFunctionControl()}
        ${deps.renderMsCustomModelPill()}
        ${deps.renderSizePickerControl('ms', false)}
        ${deps.renderCountVisualControl()}
    `;
}

function renderComfyParams(deps){
    deps.settings.comfyMode = ['text','enhance','edit','custom'].includes(deps.settings.comfyMode) ? deps.settings.comfyMode : 'text';
    const modeOptions = [
        ['text', deps.tr('canvas.comfyModeText') || '文生图'],
        ['enhance', deps.tr('canvas.comfyModeEnhance') || '图片增强'],
        ['edit', deps.tr('canvas.comfyModeEdit') || '图片编辑'],
        ['custom', deps.tr('canvas.comfyModeCustom') || '自定义']
    ];
    if(deps.settings.comfyMode === 'custom'){
        if(!deps.settings.comfyWorkflow || !deps.comfyWorkflows.some(w => w.name === deps.settings.comfyWorkflow)) deps.settings.comfyWorkflow = deps.comfyWorkflows[0]?.name || '';
        if(deps.settings.comfyWorkflow && !deps.comfyWorkflowCache[deps.settings.comfyWorkflow]) deps.ensureComfyWorkflow(deps.settings.comfyWorkflow).then((...args)=>renderDynamicParams(deps, ...args));
    }
    let html = '';
    if(deps.settings.comfyMode === 'text'){
        html += `<div class="num-compact"><span class="num-label">${deps.escapeHtml(deps.tr('smart.width'))}</span><input type="number" data-param="width" value="${Number(deps.settings.width || 1024)}"></div>
            <div class="num-compact"><span class="num-label">${deps.escapeHtml(deps.tr('smart.height'))}</span><input type="number" data-param="height" value="${Number(deps.settings.height || 1024)}"></div>`;
    } else if(deps.settings.comfyMode === 'enhance'){
        html += `<div class="num-compact"><span class="num-label">${deps.escapeHtml(deps.tr('smart.strength'))}</span><input type="number" min="0.1" max="1" step="0.05" data-param="enhanceStrength" value="${Number(deps.settings.enhanceStrength ?? 0.5)}"></div>
            <button type="button" class="setting-check ${deps.settings.enhanceUpscale ? 'active' : ''}" data-toggle-param="enhanceUpscale"><span class="check-box"></span><span>${deps.escapeHtml(deps.tr('smart.superResolution'))}</span></button>
            ${deps.settings.enhanceUpscale ? deps.renderUpscalePill('enhanceUpscaleRes', Number(deps.settings.enhanceUpscaleRes || 2048)) : ''}`;
    } else if(deps.settings.comfyMode === 'edit'){
        html += `<button type="button" class="setting-check ${deps.settings.editUpscale ? 'active' : ''}" data-toggle-param="editUpscale"><span class="check-box"></span><span>${deps.escapeHtml(deps.tr('smart.superResolution'))}</span></button>
            ${deps.settings.editUpscale ? deps.renderUpscalePill('editUpscaleRes', Number(deps.settings.editUpscaleRes || 2048)) : ''}`;
    } else {
        const wf = deps.comfyWorkflowCache[deps.settings.comfyWorkflow];
        const fields = (wf?.config?.fields || []).filter(f => deps.comfyFieldKind(f) === 'setting');
        html += deps.renderComfyWorkflowControl();
        html += fields.length ? fields.map(deps.renderComfySettingField).join('') : (deps.settings.comfyWorkflow ? '' : `<div class="muted-note">${deps.escapeHtml(deps.tr('smart.noWorkflow'))}</div>`);
    }
    deps.dynamicParams.innerHTML = `
        <div class="smart-control comfy-mode-control">
            <button class="smart-pill" type="button"><i data-lucide="workflow"></i><span>${deps.escapeHtml(modeOptions.find(([v]) => v === deps.settings.comfyMode)?.[1] || 'ComfyUI')}</span></button>
            <div class="smart-popover compact-popover">
                <div class="smart-popover-title">${deps.escapeHtml(deps.tr('smart.comfyMode'))}</div>
                <div class="model-list">
                    ${modeOptions.map(([value, label]) => `<button type="button" class="direct-option ${value === deps.settings.comfyMode ? 'active' : ''}" data-smart-param="comfyMode" data-smart-value="${deps.escapeHtml(value)}"><span>${deps.escapeHtml(label)}</span></button>`).join('')}
                </div>
            </div>
        </div>
        ${html}
    `;
}

    const api={renderDynamicParams, renderApiParams, renderApiVideoParams, renderVolcengineParams, renderVolcengineVideoParams, renderRunningHubParams, renderMsParams, renderComfyParams};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.SmartParamView=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
