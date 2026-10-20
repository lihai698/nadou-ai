/* Smart parameter panel responsibility: smart-param-controls. Host supplies live state and effects. */
(function(root){
    'use strict';

function renderVideoProviderControl(deps, providers){
    const current = (providers || []).find(p => p.id === deps.settings.videoProvider) || deps.videoProviderById(deps.settings.videoProvider);
    return `<div class="smart-control provider-control">
        <button class="smart-pill" type="button"><i data-lucide="plug-zap"></i><span class="sub">${deps.escapeHtml(current?.name || deps.settings.videoProvider || deps.tr('smart.platform'))}</span></button>
        <div class="smart-popover compact-popover">
            <div class="smart-popover-title">${deps.escapeHtml(deps.tr('smart.videoPlatform'))}</div>
            <div class="model-list">
                ${providers.map(p => `<button type="button" class="direct-option ${p.id === deps.settings.videoProvider ? 'active' : ''}" data-smart-param="videoProvider" data-smart-value="${deps.escapeHtml(p.id)}"><span>${deps.escapeHtml(p.name || p.id)}</span></button>`).join('') || `<div class="muted-note">${deps.escapeHtml(deps.tr('smart.noVideoPlatform'))}</div>`}
            </div>
        </div>
    </div>`;
}

function renderVideoModelControl(deps, models){
    return `<div class="smart-control model-control">
        <button class="smart-pill" type="button"><i data-lucide="film"></i><span class="sub">${deps.escapeHtml(deps.settings.videoModel || deps.tr('smart.model'))}</span></button>
        <div class="smart-popover compact-popover">
            <div class="smart-popover-title">${deps.escapeHtml(deps.tr('smart.videoModel'))}</div>
            <div class="model-list">
                ${models.map(m => `<button type="button" class="direct-option ${m === deps.settings.videoModel ? 'active' : ''}" data-smart-param="videoModel" data-smart-value="${deps.escapeHtml(m)}"><span>${deps.escapeHtml(m)}</span></button>`).join('') || `<div class="muted-note">${deps.escapeHtml(deps.tr('smart.noVideoModel'))}</div>`}
            </div>
        </div>
    </div>`;
}

function renderVideoDurationControl(deps){
    const v = Math.max(1, Math.min(60, Number(deps.settings.videoDuration) || 5));
    const quick = [3, 4, 5, 6, 8, 10, 12, 15];
    return `<div class="smart-control duration-control" title="${deps.escapeHtml(deps.tr('smart.videoDurationTip'))}">
        <button class="smart-pill" type="button"><i data-lucide="timer"></i><span>${v}s</span></button>
        <div class="smart-popover compact-popover">
            <div class="smart-popover-title">${deps.escapeHtml(deps.tr('smart.videoDuration'))}</div>
            <div class="duration-grid">
                ${quick.map(n => `<button type="button" class="duration-option ${n === v ? 'active' : ''}" data-smart-param="videoDuration" data-smart-value="${n}">${n}s</button>`).join('')}
            </div>
            <label class="duration-custom">
                <span>${deps.escapeHtml(deps.tr('smart.custom'))}</span>
                <input type="number" min="1" max="60" step="1" data-param="videoDuration" value="${v}">
            </label>
        </div>
    </div>`;
}

function renderVideoAspectControl(deps){
    const options = [
        ['16:9','16:9'], ['9:16','9:16'], ['1:1','1:1'], ['4:3','4:3'], ['3:4','3:4'],
        ['21:9','21:9'], ['9:21','9:21'], ['keep_ratio', deps.tr('smart.videoAspectKeep')], ['adaptive', deps.tr('smart.videoAspectAdaptive')]
    ];
    const value = deps.settings.videoAspect || '16:9';
    const labelMap = Object.fromEntries(options);
    return `<div class="smart-control aspect-control">
        <button class="smart-pill" type="button"><i data-lucide="scan"></i><span>${deps.escapeHtml(labelMap[value] || value)}</span></button>
        <div class="smart-popover">
            <div class="smart-popover-title">${deps.escapeHtml(deps.tr('smart.videoAspect'))}</div>
            <div class="ratio-grid">
                ${options.map(([v,l]) => `<button type="button" class="ratio-option ${v === value ? 'active' : ''}" data-smart-param="videoAspect" data-smart-value="${deps.escapeHtml(v)}"><span class="ratio-icon ${deps.videoAspectIconClass(v)}"></span><span>${deps.escapeHtml(l)}</span></button>`).join('')}
            </div>
        </div>
    </div>`;
}

function renderVideoResolutionControl(deps){
    const options = [['', deps.tr('smart.videoResAuto')], ['480p','480P'], ['720p','720P'], ['1080p','1080P']];
    const value = deps.settings.videoResolution || '';
    const labelMap = Object.fromEntries(options);
    return `<div class="smart-control resolution-control">
        <button class="smart-pill" type="button"><i data-lucide="monitor"></i><span>${deps.escapeHtml(labelMap[value] || value || deps.tr('smart.videoResAuto'))}</span></button>
        <div class="smart-popover compact-popover">
            <div class="smart-popover-title">${deps.escapeHtml(deps.tr('smart.videoResolution'))}</div>
            <div class="model-list">
                ${options.map(([v,l]) => `<button type="button" class="direct-option ${v === value ? 'active' : ''}" data-smart-param="videoResolution" data-smart-value="${deps.escapeHtml(v)}"><span>${deps.escapeHtml(l)}</span></button>`).join('')}
            </div>
        </div>
    </div>`;
}

function renderVideoToggleControl(deps, key, label){
    const on = !!deps.settings[key];
    return `<button type="button" class="setting-check ${on ? 'active' : ''}" data-toggle-param="${deps.escapeHtml(key)}"><span class="check-box"></span><span>${deps.escapeHtml(label)}</span></button>`;
}

function renderTempShUploadControl(deps){
    return `<button type="button" class="smart-pill cloud-upload-pill" data-temp-sh-upload-video title="上传当前输入图片或视频到云端直链"><i data-lucide="upload-cloud"></i><span>上传云端</span></button>`;
}

function renderManualVideoUrlControl(deps){
    return `<button type="button" class="smart-pill manual-video-url-pill" data-manual-video-url title="手动输入媒体 URL"><i data-lucide="link"></i><span>输入网址</span></button>`;
}

function renderVideoTrustedAssetControl(deps){
    const on = !!deps.settings.videoTrustedAsset;
    let html = renderVideoToggleControl(deps, 'videoTrustedAsset', deps.tr('smart.videoTrustedAsset'));
    if(!on) return html;
    const src = ['library','cloud','manual'].includes(deps.settings.videoTrustedSource) ? deps.settings.videoTrustedSource : 'library';
    html += `<div class="trusted-source-row">
        <button type="button" class="smart-pill trusted-src-pill ${src === 'library' ? 'active' : ''}" data-trusted-source="library" title="使用素材库中已注册的认证素材链接（asset://）"><i data-lucide="library"></i><span>素材库链接</span></button>
        <button type="button" class="smart-pill trusted-src-pill ${src === 'cloud' ? 'active' : ''}" data-trusted-source="cloud" title="把当前输入图片/视频上传到云端直链"><i data-lucide="upload-cloud"></i><span>上传云端</span></button>
        <button type="button" class="smart-pill trusted-src-pill ${src === 'manual' ? 'active' : ''}" data-trusted-source="manual" title="手动输入媒体 URL 或 asset:// 地址"><i data-lucide="link"></i><span>输入网址</span></button>
    </div>`;
    return html;
}

function renderJimengUpscaleControl(deps){
    const current = deps.JIMENG_UPSCALE_RESOLUTIONS.includes(deps.settings.jimengUpscaleRes) ? deps.settings.jimengUpscaleRes : '2k';
    return `<div class="smart-control upscale-control jimeng-upscale-control">
        <button class="smart-pill" type="button" title="${deps.escapeAttr(deps.tr('smart.jimengUpscale'))}"><i data-lucide="maximize-2"></i><span>${deps.escapeHtml(deps.tr('smart.jimengUpscale'))} · ${deps.escapeHtml(current.toUpperCase())}</span><i data-lucide="chevron-down" class="pill-caret"></i></button>
        <div class="smart-popover compact-popover"><div class="smart-popover-title">${deps.escapeHtml(deps.tr('smart.upscaleTarget'))}</div>
            <div class="model-list">${deps.JIMENG_UPSCALE_RESOLUTIONS.map(value => `<button type="button" class="direct-option ${value === current ? 'active' : ''}" data-smart-param="jimengUpscaleRes" data-smart-value="${deps.escapeHtml(value)}"><span>${deps.escapeHtml(value.toUpperCase())}</span></button>`).join('')}</div>
        </div>
    </div>`;
}

function renderRhConfigControl(deps, ref){
    const models = deps.runningHubEntries('model');
    const apps = deps.runningHubEntries('app');
    const workflows = deps.runningHubEntries('workflow');
    const selected = ref ? deps.runningHubEntryKey(ref.kind, ref.id) : '';
    const groupHtml = (kind, entries, label) => entries.length ? `
        <div class="model-list-label rh-list-label">${deps.escapeHtml(label)}<span class="count">${entries.length}</span></div>
        ${entries.map(entry => {
            const id = deps.runningHubEntryId(entry, kind);
            const key = deps.runningHubEntryKey(kind, id);
            const icon = kind === 'workflow' ? 'workflow' : kind === 'model' ? 'box' : 'sparkles';
            return `<button type="button" class="direct-option rh-entry-option ${key === selected ? 'active' : ''}" data-smart-param="rhConfigKey" data-smart-value="${deps.escapeHtml(key)}"><i data-lucide="${icon}"></i><span>${deps.escapeHtml(deps.runningHubEntryLabel(entry, kind))}</span></button>`;
        }).join('')}
    ` : '';
    return `<div class="smart-control rh-config-control">
        <button class="smart-pill" type="button"><i data-lucide="workflow"></i><span class="sub">${deps.escapeHtml(ref ? deps.runningHubEntryLabel(ref.entry, ref.kind) : deps.tr('smart.rhConfig'))}</span><i data-lucide="chevron-down" class="pill-caret"></i></button>
        <div class="smart-popover compact-popover rh-picker-popover">
            <div class="smart-popover-title">${deps.escapeHtml(deps.tr('smart.rhConfig'))}</div>
            <div class="model-list rh-config-list">
                ${groupHtml('model', models, '模型 API')}${groupHtml('app', apps, 'AI 应用')}${groupHtml('workflow', workflows, '工作流') || ''}
            </div>
        </div>
    </div>`;
}

function renderRhPaymentControl(deps){
    const value = deps.settings.rhPayment === 'wallet' ? 'wallet' : 'free';
    const labels = {free:deps.tr('smart.rhFreeKey'), wallet:deps.tr('smart.rhWalletKey')};
    return `<div class="smart-control rh-payment-control">
        <button class="smart-pill" type="button"><i data-lucide="key-round"></i><span>${deps.escapeHtml(labels[value])}</span><i data-lucide="chevron-down" class="pill-caret"></i></button>
        <div class="smart-popover compact-popover rh-picker-popover">
            <div class="smart-popover-title">${deps.escapeHtml(deps.tr('smart.rhKey'))}</div>
            <div class="model-list">
                ${Object.entries(labels).map(([key, label]) => `<button type="button" class="direct-option ${key === value ? 'active' : ''}" data-smart-param="rhPayment" data-smart-value="${deps.escapeHtml(key)}"><span>${deps.escapeHtml(label)}</span></button>`).join('')}
            </div>
        </div>
    </div>`;
}

function renderRhMachineControl(deps){
    const value = deps.settings.rhInstanceType === 'plus' ? 'plus' : '';
    const labels = {'':'24G', plus:'48G'};
    return `<div class="smart-control rh-machine-control">
        <button class="smart-pill" type="button"><i data-lucide="cpu"></i><span>${deps.escapeHtml(labels[value])}</span><i data-lucide="chevron-down" class="pill-caret"></i></button>
        <div class="smart-popover compact-popover rh-picker-popover">
            <div class="smart-popover-title">${deps.escapeHtml(deps.tr('smart.rhMachine'))}</div>
            <div class="model-list">
                ${Object.entries(labels).map(([key, label]) => `<button type="button" class="direct-option ${key === value ? 'active' : ''}" data-smart-param="rhInstanceType" data-smart-value="${deps.escapeHtml(key)}"><span>${deps.escapeHtml(label)}</span></button>`).join('')}
            </div>
        </div>
    </div>`;
}

function renderUpscalePill(deps, paramKey, current){
    const opts = [2048, 4096];
    const labels = {2048:'2X / 2048', 4096:'4X / 4096'};
    return `<div class="smart-control upscale-control">
        <button class="smart-pill" type="button"><i data-lucide="maximize-2"></i><span>${deps.escapeHtml(labels[current] || `${current}px`)}</span></button>
        <div class="smart-popover compact-popover">
            <div class="smart-popover-title">${deps.escapeHtml(deps.tr('smart.upscaleTarget'))}</div>
            <div class="model-list">
                ${opts.map(v => `<button type="button" class="direct-option ${v === current ? 'active' : ''}" data-smart-param="${deps.escapeHtml(paramKey)}" data-smart-value="${v}"><span>${deps.escapeHtml(labels[v])}</span></button>`).join('')}
            </div>
        </div>
    </div>`;
}

function renderComfyWorkflowControl(deps){
    if(!deps.comfyWorkflows.length) return `<div class="muted-note">${deps.escapeHtml(deps.tr('smart.noWorkflow'))}</div>`;
    const current = deps.comfyWorkflows.find(w => w.name === deps.settings.comfyWorkflow) || deps.comfyWorkflows[0];
    const label = current?.title || (current?.name || '').replace('.json','') || deps.tr('smart.workflow');
    return `<div class="smart-control workflow-control">
        <button class="smart-pill" type="button"><i data-lucide="layers"></i><span class="sub">${deps.escapeHtml(label)}</span></button>
        <div class="smart-popover compact-popover">
            <div class="smart-popover-title">${deps.escapeHtml(deps.tr('smart.workflow'))}</div>
            <div class="model-list">
                ${deps.comfyWorkflows.map(w => `<button type="button" class="direct-option ${w.name === deps.settings.comfyWorkflow ? 'active' : ''}" data-smart-param="comfyWorkflow" data-smart-value="${deps.escapeHtml(w.name)}"><span>${deps.escapeHtml(w.title || w.name.replace('.json',''))}</span></button>`).join('')}
            </div>
        </div>
    </div>`;
}

function renderSizeControls(deps, prefix='', includeSource=false){
    const ratioKey = prefix ? `${prefix}Ratio` : 'ratio';
    const resKey = prefix ? `${prefix}Resolution` : 'resolution';
    const ratios = [
        ['square','1:1'], ['portrait','2:3'], ['landscape','3:2'], ['portrait43','3:4'], ['landscape43','4:3'], ['story','9:16'], ['wide','16:9'], ['ultrawide','21:9'], ['ultratall','9:21'],
        ...(includeSource ? [['source', deps.tr('canvas.adaptiveRatio') || '适配比例']] : []),
        ['custom', deps.tr('canvas.custom') || '自定义']
    ];
    const resolutionOptions = (!prefix && deps.settings.engine === 'api') ? ['auto','1k','2k','4k','custom'] : ['1k','2k','4k','custom'];
    return `<select data-param="${resKey}">
            ${resolutionOptions.map(v => deps.optionHtml(v, v === 'auto' ? '自动' : (v === 'custom' ? (deps.tr('canvas.custom') || '自定义') : v.toUpperCase()), deps.settings[resKey] || (prefix ? '1k' : deps.defaultSmartApiResolution(deps.settings.model)))).join('')}
        </select>
        <select data-param="${ratioKey}" ${deps.settings[resKey] === 'custom' || deps.settings[resKey] === 'auto' ? 'disabled' : ''}>
            ${ratios.map(([v,l]) => `<option value="${deps.escapeHtml(v)}" ${v === (deps.settings[ratioKey] || 'square') ? 'selected' : ''}>${deps.escapeHtml(l)}</option>`).join('')}
        </select>`;
}

function renderProviderControl(deps, providers){
    const current = (providers || []).find(p => p.id === deps.settings.provider_id) || deps.apiProviderById(deps.settings.provider_id);
    return `<div class="smart-control provider-control">
        <button class="smart-pill" type="button"><i data-lucide="plug-zap"></i><span class="sub">${deps.escapeHtml(current?.name || deps.settings.provider_id || deps.tr('smart.platform'))}</span></button>
        <div class="smart-popover compact-popover">
            <div class="smart-popover-title">${deps.escapeHtml(deps.tr('smart.apiPlatform'))}</div>
            <div class="model-list">
                ${providers.map(p => `<button type="button" class="direct-option ${p.id === deps.settings.provider_id ? 'active' : ''}" data-smart-param="provider_id" data-smart-value="${deps.escapeHtml(p.id)}"><span>${deps.escapeHtml(p.name || p.id)}</span></button>`).join('') || `<div class="muted-note">${deps.escapeHtml(deps.tr('smart.noApiPlatform'))}</div>`}
            </div>
        </div>
    </div>`;
}

function renderModelControl(deps, models, options={}){
    const audioAnalysis = options.audioAnalysis === true;
    return `<div class="smart-control model-control">
        <button class="smart-pill" type="button"><i data-lucide="sparkles"></i><span class="sub">${deps.escapeHtml(deps.settings.model || deps.tr('smart.model'))}</span></button>
        <div class="smart-popover compact-popover">
            <div class="smart-popover-title">${deps.escapeHtml(audioAnalysis ? '文本模型' : deps.tr('smart.imageModel'))}</div>
            <div class="model-list">
                ${models.map(m => `<button type="button" class="direct-option ${m === deps.settings.model ? 'active' : ''}" data-smart-param="model" data-smart-value="${deps.escapeHtml(m)}"><span>${deps.escapeHtml(m)}</span></button>`).join('') || `<div class="muted-note">${deps.escapeHtml(deps.tr('smart.noImageModel'))}</div>`}
                ${audioAnalysis ? '' : deps.window.CanvasAudio.models(deps.apiProviders.find(p=>p.id===deps.settings.provider_id)).map(m=>`<button class="direct-option" type="button" data-smart-param="model" data-smart-value="audio:${deps.escapeAttr(m)}"><span>音频 · ${deps.escapeHtml(deps.window.CanvasAudio.modelName(deps.apiProviders.find(p=>p.id===deps.settings.provider_id),m))}</span></button>`).join('')}
            </div>
        </div>
    </div>`;
}

function renderMsFunctionControl(deps){
    return `<div class="smart-control provider-control">
        <button class="smart-pill" type="button"><i data-lucide="sparkles"></i><span class="sub">${deps.escapeHtml(deps.msModelLabel(deps.settings.msgenModel) || 'Modelscope')}</span></button>
        <div class="smart-popover compact-popover">
            <div class="smart-popover-title">${deps.escapeHtml(deps.tr('smart.msFunction'))}</div>
            <div class="model-list">
                ${Object.entries(deps.MS_GEN_MODELS).map(([key]) => `<button type="button" class="direct-option ${key === deps.settings.msgenModel ? 'active' : ''}" data-smart-param="msgenModel" data-smart-value="${deps.escapeHtml(key)}"><span>${deps.escapeHtml(deps.msModelLabel(key))}</span></button>`).join('')}
            </div>
        </div>
    </div>`;
}

function renderMsCustomModelPill(deps){
    if(deps.settings.msgenModel !== 'custom') return '';
    const models = deps.modelscopeImageModels();
    const label = deps.settings.msCustomModel || deps.tr('smart.customModel');
    return `<div class="smart-control model-control">
        <button class="smart-pill" type="button"><i data-lucide="boxes"></i><span class="sub">${deps.escapeHtml(label)}</span></button>
        <div class="smart-popover compact-popover">
            <div class="smart-popover-title">${deps.escapeHtml(deps.tr('smart.msCustomModel'))}</div>
            <div class="model-list">
                ${models.map(m => `<button type="button" class="direct-option ${m === deps.settings.msCustomModel ? 'active' : ''}" data-smart-param="msCustomModel" data-smart-value="${deps.escapeHtml(m)}"><span>${deps.escapeHtml(m)}</span></button>`).join('') || `<div class="muted-note">${deps.escapeHtml(deps.tr('smart.noMsModel'))}</div>`}
            </div>
        </div>
    </div>`;
}

function renderRatioControl(deps, prefix='', includeSource=false){
    const ratioKey = prefix ? `${prefix}Ratio` : 'ratio';
    const resKey = prefix ? `${prefix}Resolution` : 'resolution';
    const ratios = [
        ['square','1:1'], ['portrait','2:3'], ['landscape','3:2'], ['portrait43','3:4'], ['landscape43','4:3'],
        ['story','9:16'], ['wide','16:9'], ['ultrawide','21:9'], ['ultratall','9:21'],
        ...(includeSource ? [['source', deps.tr('smart.imageRatio')]] : []),
        ['custom', deps.tr('smart.custom')]
    ];
    return `<div class="smart-control ratio-control">
        <button class="smart-pill" type="button"><i data-lucide="scan"></i><span>${deps.escapeHtml(deps.ratioLabel(prefix))}</span></button>
        <div class="smart-popover">
            <div class="smart-popover-title">${deps.escapeHtml(deps.tr('smart.ratio'))}</div>
            <div class="ratio-grid">
                ${ratios.map(([value, label]) => `<button type="button" class="ratio-option ${value === (deps.settings[ratioKey] || 'square') ? 'active' : ''}" data-smart-param="${ratioKey}" data-smart-value="${deps.escapeHtml(value)}"><span class="ratio-icon ${deps.ratioIconClass(value)}"></span><span>${deps.escapeHtml(label)}</span></button>`).join('')}
            </div>
        </div>
    </div>`;
}

function renderResolutionControl(deps, prefix=''){
    const resKey = prefix ? `${prefix}Resolution` : 'resolution';
    const options = (!prefix && deps.settings.engine === 'api') ? ['auto','1k','2k','4k','custom'] : ['1k','2k','4k','custom'];
    const current = deps.settings[resKey] || ((!prefix && deps.settings.engine === 'api') ? deps.defaultSmartApiResolution(deps.settings.model) : '1k');
    const allowAuto = !prefix && deps.settings.engine === 'api' && deps.settings.apiKind !== 'video' && deps.isGptImageAutoSizeModel(deps.settings.model);
    return `<div class="smart-control resolution-control">
        <button class="smart-pill" type="button"><i data-lucide="monitor"></i><span>${deps.escapeHtml(deps.resolutionLabel(prefix))}</span></button>
        <div class="smart-popover compact-popover">
            <div class="smart-popover-title">${deps.escapeHtml(deps.tr('smart.resolution'))}</div>
            <div class="seg-row">
                ${options.map(value => `<button type="button" class="${value === current ? 'active' : ''}" data-smart-param="${resKey}" data-smart-value="${value}" ${value === 'auto' && !allowAuto ? 'disabled' : ''}>${value === 'auto' ? '自动' : (value === 'custom' ? deps.escapeHtml(deps.tr('smart.custom')) : value.toUpperCase())}</button>`).join('')}
            </div>
        </div>
    </div>`;
}

function renderSizePickerControl(deps, prefix='', includeSource=false){
    const ratioKey = prefix ? `${prefix}Ratio` : 'ratio';
    const resKey = prefix ? `${prefix}Resolution` : 'resolution';
    const customRatioKey = prefix ? `${prefix}CustomRatio` : 'customRatio';
    if(deps.settings[ratioKey] === 'source') deps.applySourceRatioToSettings(prefix);
    const scope = deps.sizePickerScope(prefix);
    const options = (!prefix && deps.settings.engine === 'api') ? ['auto','1k','2k','4k'] : ['1k','2k','4k'];
    const currentRes = deps.settings[resKey] || ((!prefix && deps.settings.engine === 'api') ? deps.defaultSmartApiResolution(deps.settings.model) : '1k');
    const currentRatio = deps.settings[ratioKey] || 'square';
    const currentCustomRatio = deps.settings[customRatioKey] || (currentRatio === 'source' ? deps.sourceImageRatioLabel(prefix) : '');
    const allowAuto = !prefix && deps.settings.engine === 'api' && deps.settings.apiKind !== 'video' && deps.isGptImageAutoSizeModel(deps.settings.model);
    const ratios = [
        ['square','1:1','正方形'], ['portrait','2:3','竖图'], ['landscape','3:2','横图'], ['portrait43','3:4','竖图'], ['landscape43','4:3','横图'],
        ['story','9:16','竖屏'], ['wide','16:9','宽屏'], ['ultrawide','21:9','超宽'], ['ultratall','9:21','超竖'],
        ...(includeSource ? [['source', deps.sourceImageRatioLabel(prefix) || '原图', '适配输入']] : [])
    ];
    const wKey = prefix ? `${prefix}CustomWidth` : 'customWidth';
    const hKey = prefix ? `${prefix}CustomHeight` : 'customHeight';
    return `<div class="smart-control size-picker-control ${scope === 'auto' ? 'auto-mode' : ''} ${scope === 'custom' ? 'custom-mode' : ''}">
        <button class="smart-pill size-picker-pill" type="button"><i data-lucide="scan-line"></i><span class="size-picker-label"><span class="size-picker-type">尺寸</span><span class="size-picker-dot"></span><span class="size-picker-value">${deps.escapeHtml(deps.sizePickerLabel(prefix))}</span></span></button>
        <div class="smart-popover size-picker-popover">
            <div class="size-picker-head">
                <div class="smart-popover-title">尺寸选择</div>
                <div class="size-picker-scope">
                    <button type="button" class="${scope === 'auto' ? 'active' : ''}" data-size-scope="auto" data-size-prefix="${deps.escapeHtml(prefix)}" ${allowAuto ? '' : 'disabled'}>自动</button>
                    <button type="button" class="${scope === 'preset' ? 'active' : ''}" data-size-scope="preset" data-size-prefix="${deps.escapeHtml(prefix)}">系统参数</button>
                    <button type="button" class="${scope === 'custom' ? 'active' : ''}" data-size-scope="custom" data-size-prefix="${deps.escapeHtml(prefix)}">自定义</button>
                </div>
            </div>
            ${scope === 'auto' ? `<div class="size-picker-pane size-picker-auto"><div class="size-picker-note"><strong>自动尺寸</strong><span>使用模型默认尺寸，或由支持自动尺寸的模型自行决定。</span></div></div>` : ''}
            ${scope === 'preset' ? `<div class="size-picker-pane size-picker-preset">
                <div class="size-picker-list">
                    ${ratios.map(([value, label, sub]) => `<button type="button" class="size-picker-option ${value === currentRatio ? 'active' : ''}" data-smart-param="${ratioKey}" data-smart-value="${deps.escapeHtml(value)}"><span>${deps.escapeHtml(label)}</span><small>${deps.escapeHtml(sub)}</small></button>`).join('')}
                </div>
                <div class="size-picker-list">
                    ${options.filter(v => v !== 'auto').map(value => `<button type="button" class="size-picker-option ${value === currentRes ? 'active' : ''}" data-smart-param="${resKey}" data-smart-value="${value}"><span>${value.toUpperCase()}</span><small>${deps.escapeHtml(deps.apiImageSize(currentRatio, value, currentCustomRatio, '') || '')}</small></button>`).join('')}
                </div>
            </div>` : ''}
            ${scope === 'custom' ? `<div class="size-picker-pane size-picker-custom">
                <div class="size-custom-box">
                    <div class="size-custom-title">自定义分辨率</div>
                    <div class="size-custom-row"><input type="number" data-param="${wKey}" value="${deps.escapeHtml(deps.settings[wKey] || '')}" placeholder="宽度"><span>×</span><input type="number" data-param="${hKey}" value="${deps.escapeHtml(deps.settings[hKey] || '')}" placeholder="高度"></div>
                </div>
            </div>` : ''}
        </div>
    </div>`;
}

function renderInlineCustomRatioFields(deps, prefix=''){
    const ratioKey = prefix ? `${prefix}Ratio` : 'ratio';
    if(deps.settings[ratioKey] === 'source') return '';
    if(deps.settings[ratioKey] !== 'custom') return '';
    const wKey = prefix ? `${prefix}CustomRatioWidth` : 'customRatioWidth';
    const hKey = prefix ? `${prefix}CustomRatioHeight` : 'customRatioHeight';
    return `<div class="inline-fields">
        <span class="inline-label">${deps.escapeHtml(deps.tr('smart.ratio'))}</span>
        <input type="number" data-param="${wKey}" value="${deps.escapeHtml(deps.settings[wKey] || '')}" placeholder="W">
        <span class="inline-divider">:</span>
        <input type="number" data-param="${hKey}" value="${deps.escapeHtml(deps.settings[hKey] || '')}" placeholder="H">
    </div>`;
}

function renderInlineCustomSizeFields(deps, prefix=''){
    const resKey = prefix ? `${prefix}Resolution` : 'resolution';
    if(deps.settings[resKey] !== 'custom') return '';
    const wKey = prefix ? `${prefix}CustomWidth` : 'customWidth';
    const hKey = prefix ? `${prefix}CustomHeight` : 'customHeight';
    return `<div class="inline-fields">
        <span class="inline-label">${deps.escapeHtml(deps.tr('smart.size'))}</span>
        <input type="number" data-param="${wKey}" value="${deps.escapeHtml(deps.settings[wKey] || '')}" placeholder="${deps.escapeHtml(deps.tr('smart.width'))}">
        <span class="inline-divider">×</span>
        <input type="number" data-param="${hKey}" value="${deps.escapeHtml(deps.settings[hKey] || '')}" placeholder="${deps.escapeHtml(deps.tr('smart.height'))}">
    </div>`;
}

function renderQualityControl(deps){
    const value = deps.settings.quality || 'auto';
    const labels = {auto:deps.tr('smart.qualityAuto'), low:deps.tr('smart.qualityLow'), medium:deps.tr('smart.qualityMid'), high:deps.tr('smart.qualityHigh')};
    return `<div class="smart-control quality-control">
        <button class="smart-pill" type="button"><i data-lucide="sliders-horizontal"></i><span>${deps.escapeHtml(labels[value] || value)}</span></button>
        <div class="smart-popover compact-popover">
            <div class="smart-popover-title">${deps.escapeHtml(deps.tr('smart.quality'))}</div>
            <div class="seg-row">
                ${Object.entries(labels).map(([k, l]) => `<button type="button" class="${k === value ? 'active' : ''}" data-smart-param="quality" data-smart-value="${deps.escapeHtml(k)}">${deps.escapeHtml(l)}</button>`).join('')}
            </div>
        </div>
    </div>`;
}

function renderCountVisualControl(deps){
    const value = Number(deps.settings.count || 1);
    return `<div class="smart-control count-control">
        <button class="smart-pill" type="button"><i data-lucide="copy"></i><span>${value}${deps.tr('smart.countUnit') ? ' ' + deps.escapeHtml(deps.tr('smart.countUnit')) : ''}</span></button>
        <div class="smart-popover compact-popover" style="min-width:170px">
            <div class="smart-popover-title">${deps.escapeHtml(deps.tr('smart.count'))}</div>
            <div class="count-grid">
                ${[1,2,3,4,5,6,7,8].map(n => `<button type="button" class="count-cell ${n === value ? 'active' : ''}" data-smart-param="count" data-smart-value="${n}">${n}</button>`).join('')}
            </div>
        </div>
    </div>`;
}

function renderCountControl(deps){
    return `<select data-param="count">${[1,2,3,4,5,6,7,8].map(n => deps.optionHtml(n, `${n} 张`, Number(deps.settings.count || 1))).join('')}</select>`;
}

function renderCustomRatioControls(deps, prefix=''){
    const ratioKey = prefix ? `${prefix}Ratio` : 'ratio';
    if(deps.settings[ratioKey] !== 'custom' && deps.settings[ratioKey] !== 'source') return '';
    const wKey = prefix ? `${prefix}CustomRatioWidth` : 'customRatioWidth';
    const hKey = prefix ? `${prefix}CustomRatioHeight` : 'customRatioHeight';
    const disabled = deps.settings[ratioKey] === 'source' ? 'disabled' : '';
    return `<input type="number" data-param="${wKey}" value="${deps.escapeHtml(deps.settings[wKey] || '')}" placeholder="比例宽" ${disabled}>
            <input type="number" data-param="${hKey}" value="${deps.escapeHtml(deps.settings[hKey] || '')}" placeholder="比例高" ${disabled}>`;
}

function renderCustomSizeControls(deps, prefix=''){
    const resKey = prefix ? `${prefix}Resolution` : 'resolution';
    if(deps.settings[resKey] !== 'custom') return '';
    const wKey = prefix ? `${prefix}CustomWidth` : 'customWidth';
    const hKey = prefix ? `${prefix}CustomHeight` : 'customHeight';
    return `<input type="number" data-param="${wKey}" value="${deps.escapeHtml(deps.settings[wKey] || '')}" placeholder="宽度">
            <input type="number" data-param="${hKey}" value="${deps.escapeHtml(deps.settings[hKey] || '')}" placeholder="高度">`;
}

function renderComfySettingField(deps, field){
    const value = deps.comfyParamValue(field);
    const label = field.name || field.input || field.id;
    if(field.type === 'boolean') return `<button type="button" class="setting-check ${value ? 'active' : ''}" data-comfy-bool="${deps.escapeHtml(field.id)}"><span class="check-box"></span><span>${deps.escapeHtml(label)}</span></button>`;
    if(field.type === 'dropdown'){
        const opts = field.options || [];
        const curLabel = String(value || opts[0] || label);
        return `<div class="smart-control comfy-dropdown-control" title="${deps.escapeHtml(label)}">
            <button class="smart-pill" type="button"><span class="sub">${deps.escapeHtml(curLabel)}</span></button>
            <div class="smart-popover compact-popover">
                <div class="smart-popover-title">${deps.escapeHtml(label)}</div>
                <div class="model-list">
                    ${opts.map(o => `<button type="button" class="direct-option ${String(o) === String(value) ? 'active' : ''}" data-comfy-pick="${deps.escapeHtml(field.id)}" data-comfy-value="${deps.escapeHtml(o)}"><span>${deps.escapeHtml(o)}</span></button>`).join('') || `<div class="muted-note">${deps.escapeHtml(deps.tr('smart.noOption'))}</div>`}
                </div>
            </div>
        </div>`;
    }
    if(field.type === 'textarea') return `<textarea class="wide" data-comfy-param="${deps.escapeHtml(field.id)}" placeholder="${deps.escapeHtml(label)}" style="width:160px">${deps.escapeHtml(value)}</textarea>`;
    const type = (field.type === 'number' || field.type === 'slider') ? 'number' : 'text';
    const min = field.min !== undefined ? ` min="${deps.escapeHtml(field.min)}"` : '';
    const max = field.max !== undefined ? ` max="${deps.escapeHtml(field.max)}"` : '';
    const step = field.step !== undefined ? ` step="${deps.escapeHtml(field.step)}"` : '';
    const isNumeric = type === 'number';
    const inputHtml = `<input type="${type}" data-comfy-param="${deps.escapeHtml(field.id)}" value="${deps.escapeHtml(value)}"${min}${max}${step}>`;
    if(isNumeric && deps.comfyRandomEnabledField(field)){
        const active = deps.smartComfyRandomActive(field.id);
        return `<div class="num-with-dice" title="${deps.escapeHtml(label)}">
            <span class="num-label">${deps.escapeHtml(label)}</span>
            ${inputHtml}
            <button type="button" class="dice-btn ${active ? 'active' : ''}" data-comfy-random="${deps.escapeHtml(field.id)}" title="${deps.escapeHtml(active ? deps.tr('smart.diceOn') : deps.tr('smart.diceOff'))}"><i data-lucide="dice-5"></i></button>
        </div>`;
    }
    if(isNumeric){
        return `<div class="num-compact" title="${deps.escapeHtml(label)}"><span class="num-label">${deps.escapeHtml(label)}</span>${inputHtml}</div>`;
    }
    return `<div class="num-compact" title="${deps.escapeHtml(label)}"><span class="num-label">${deps.escapeHtml(label)}</span>${inputHtml}</div>`;
}

function renderRhSettingField(deps, field){
    const key = deps.rhParamKey(field.nodeId, field.fieldName);
    const kind = deps.rhFieldRole(field);
    const label = field.label || field.fieldName || 'Field';
    const value = deps.rhParamValue(field, null);
    const options = deps.rhExtractFieldOptions(field);
    if(kind === 'boolean'){
        const active = String(value).toLowerCase() === 'true';
        return `<button type="button" class="setting-check ${active ? 'active' : ''}" data-rh-bool="${deps.escapeHtml(key)}"><span class="check-box"></span><span>${deps.escapeHtml(label)}</span></button>`;
    }
    if(kind === 'slider'){
        const min = Number.isFinite(Number(field.min)) ? Number(field.min) : 0;
        const max = Number.isFinite(Number(field.max)) && Number(field.max) > min ? Number(field.max) : 1;
        const step = Number.isFinite(Number(field.step)) && Number(field.step) > 0 ? Number(field.step) : 0.01;
        const numericValue = Number.isFinite(Number(value)) ? Number(value) : min;
        return `<div class="smart-control rh-slider-control" title="${deps.escapeHtml(label)}">
            <button class="smart-pill" type="button"><span class="sub">${deps.escapeHtml(label)}</span><span class="rh-slider-pill-value">${deps.escapeHtml(numericValue)}</span></button>
            <div class="smart-popover compact-popover rh-picker-popover rh-param-popover rh-slider-popover">
                <div class="smart-popover-title"><span>${deps.escapeHtml(label)}</span><span class="rh-slider-value">${deps.escapeHtml(numericValue)}</span></div>
                <input type="range" class="smart-range rh-slider-input" data-rh-param="${deps.escapeHtml(key)}" data-rh-type="slider" min="${deps.escapeHtml(min)}" max="${deps.escapeHtml(max)}" step="${deps.escapeHtml(step)}" value="${deps.escapeHtml(numericValue)}">
            </div>
        </div>`;
    }
    if(options?.length){
        const curLabel = String(value || options[0] || label);
        return `<div class="smart-control rh-dropdown-control" title="${deps.escapeHtml(label)}">
            <button class="smart-pill" type="button"><span class="sub">${deps.escapeHtml(curLabel)}</span><i data-lucide="chevron-down" class="pill-caret"></i></button>
            <div class="smart-popover compact-popover rh-picker-popover rh-param-popover">
                <div class="smart-popover-title">${deps.escapeHtml(label)}</div>
                <div class="model-list rh-param-list">
                    ${options.map(o => `<button type="button" class="direct-option ${String(o) === String(value) ? 'active' : ''}" data-rh-pick="${deps.escapeHtml(key)}" data-rh-value="${deps.escapeHtml(o)}"><span>${deps.escapeHtml(o)}</span></button>`).join('') || `<div class="muted-note">${deps.escapeHtml(deps.tr('smart.noOption'))}</div>`}
                </div>
            </div>
        </div>`;
    }
    const type = kind === 'number' ? 'number' : 'text';
    const inputHtml = `<input type="${type}" data-rh-param="${deps.escapeHtml(key)}" value="${deps.escapeHtml(value)}">`;
    if(kind === 'number' && deps.rhRandomEnabled(field)){
        const active = deps.smartRhRandomActive(key);
        return `<div class="num-with-dice" title="${deps.escapeHtml(label)}">
            <span class="num-label">${deps.escapeHtml(label)}</span>
            ${inputHtml}
            <button type="button" class="dice-btn ${active ? 'active' : ''}" data-rh-random="${deps.escapeHtml(key)}" title="${deps.escapeHtml(active ? deps.tr('smart.diceOn') : deps.tr('smart.diceOff'))}"><i data-lucide="dice-5"></i></button>
        </div>`;
    }
    return `<div class="num-compact ${type === 'text' ? 'rh-text-param' : ''}" title="${deps.escapeHtml(label)}"><span class="num-label">${deps.escapeHtml(label)}</span>${inputHtml}</div>`;
}

    const api={renderVideoProviderControl, renderVideoModelControl, renderVideoDurationControl, renderVideoAspectControl, renderVideoResolutionControl, renderVideoToggleControl, renderTempShUploadControl, renderManualVideoUrlControl, renderVideoTrustedAssetControl, renderJimengUpscaleControl, renderRhConfigControl, renderRhPaymentControl, renderRhMachineControl, renderUpscalePill, renderComfyWorkflowControl, renderSizeControls, renderProviderControl, renderModelControl, renderMsFunctionControl, renderMsCustomModelPill, renderRatioControl, renderResolutionControl, renderSizePickerControl, renderInlineCustomRatioFields, renderInlineCustomSizeFields, renderQualityControl, renderCountVisualControl, renderCountControl, renderCustomRatioControls, renderCustomSizeControls, renderComfySettingField, renderRhSettingField};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.SmartParamControls=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
