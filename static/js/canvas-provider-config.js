/* Classic provider model configuration: canvas-provider-config. Host supplies live state and effects. */
(function(root){
    'use strict';

function loadLocalModelLists(deps){
    try {
        const managedRaw = deps.localStorage.getItem(deps.MANAGED_IMAGE_MODELS_KEY);
        const raw = JSON.parse(managedRaw || deps.localStorage.getItem(deps.CUSTOM_IMAGE_MODELS_KEY) || '[]');
        deps.localImageModels = Array.isArray(raw) ? raw.filter(Boolean) : [];
        deps.hasManagedImageModels = Boolean(managedRaw);
    } catch(e) {
        deps.localImageModels = [];
        deps.hasManagedImageModels = false;
    }
    try {
        const managedRaw = deps.localStorage.getItem(deps.MANAGED_CHAT_MODELS_KEY);
        const raw = JSON.parse(managedRaw || '[]');
        deps.localChatModels = Array.isArray(raw) ? raw.filter(Boolean) : [];
        deps.hasManagedChatModels = Boolean(managedRaw);
    } catch(e) {
        deps.localChatModels = [];
        deps.hasManagedChatModels = false;
    }
}

function uniqueModels(deps, list){
    const seen = new Set();
    return list.map(item => String(item || '').trim()).filter(item => {
        if(!item || seen.has(item)) return false;
        seen.add(item);
        return true;
    });
}

function defaultApiProviders(deps){
    return [{id:'comfly', name:'Comfly', base_url:'', enabled:true, image_models:deps.imageModels, chat_models:deps.chatModels, video_models:deps.videoModels.length ? deps.videoModels : deps.DEFAULT_VIDEO_MODELS, has_key:false, key_preview:''}];
}

function isRunningHubProvider(deps, provider){
    const id = String(provider?.id || '').trim().toLowerCase();
    const protocol = String(provider?.protocol || '').trim().toLowerCase();
    const name = String(provider?.name || '').trim().toLowerCase();
    return id === 'runninghub' || protocol === 'runninghub' || name === 'runninghub' || id === 'rh';
}

function normalizeProviderId(deps, value){
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').slice(0, 40);
}

function imageApiProviders(deps){
    const providers = (deps.apiProviders.length ? deps.apiProviders : defaultApiProviders(deps))
        .filter(p => p.id !== 'modelscope' && p.enabled !== false && (p.image_models || []).length);
    return providers;
}

function midjourneyApiProviders(deps){
    return (deps.apiProviders.length ? deps.apiProviders : [])
        .filter(provider => provider.enabled !== false && (
            String(provider.protocol || '').toLowerCase() === 'apimart'
            || /(^|\.)apimart\.ai(?:\/|$)/i.test(String(provider.base_url || ''))
        ));
}

function resolveMidjourneyProviderId(deps, id){
    const providers = midjourneyApiProviders(deps);
    return providers.find(provider => provider.id === id)?.id || providers[0]?.id || '';
}

function midjourneyProviderOptions(deps, selectedId){
    const selected = resolveMidjourneyProviderId(deps, selectedId);
    const providers = midjourneyApiProviders(deps);
    if(!providers.length) return '<option value="" disabled selected>请先配置 APIMart 平台</option>';
    return providers.map(provider => `<option value="${deps.escapeHtml(provider.id)}" ${provider.id === selected ? 'selected' : ''}>${deps.escapeHtml(provider.name || provider.id)}</option>`).join('');
}

function providerById(deps, id){
    return (deps.apiProviders.length ? deps.apiProviders : defaultApiProviders(deps)).find(p => p.id === id) || imageApiProviders(deps)[0] || defaultApiProviders(deps)[0];
}

function resolveProviderId(deps, id){
    return providerById(deps, id)?.id || 'comfly';
}

function chatApiProviders(deps){
    const providers = (deps.apiProviders.length ? deps.apiProviders : defaultApiProviders(deps))
        .filter(p => p.enabled !== false && (p.chat_models || []).length);
    return providers.length ? providers : defaultApiProviders(deps);
}

function resolveChatProviderId(deps, id){
    const providers = chatApiProviders(deps);
    return providers.find(p => p.id === id)?.id || providers[0]?.id || 'comfly';
}

function chatProviderOptions(deps, selectedId){
    const selected = resolveChatProviderId(deps, selectedId);
    return chatApiProviders(deps).map(provider => `<option value="${deps.escapeHtml(provider.id)}" ${provider.id === selected ? 'selected' : ''}>${deps.escapeHtml(provider.name || provider.id)}</option>`).join('');
}

function providerChatModels(deps, providerId){
    const provider = deps.apiProviders.find(p => p.id === providerId);
    return uniqueModels(deps, provider?.chat_models || []);
}

function providerAudioAnalysisModels(deps, providerId){
    const provider = deps.apiProviders.find(p => p.id === providerId);
    return uniqueModels(deps, provider?.chat_models || []);
}

function audioAnalysisApiProviders(deps){
    return (deps.apiProviders.length ? deps.apiProviders : defaultApiProviders(deps))
        .filter(provider => provider.enabled !== false && providerAudioAnalysisModels(deps, provider.id).length);
}

function audioAnalysisProviderOptions(deps, selectedId){
    const providers = audioAnalysisApiProviders(deps);
    if(!providers.length) return `<option value="" disabled selected>${deps.tr('canvas.noApiProviders') || '暂无 API 平台'}</option>`;
    const selected = providers.some(provider => provider.id === selectedId) ? selectedId : providers[0].id;
    return providers.map(provider => `<option value="${deps.escapeHtml(provider.id)}" ${provider.id === selected ? 'selected' : ''}>${deps.escapeHtml(provider.name || provider.id)}</option>`).join('');
}

function audioAnalysisModelOptions(deps, selectedModel, providerId){
    const models = providerAudioAnalysisModels(deps, providerId);
    if(!models.length) return `<option value="" disabled selected>${deps.tr('canvas.noModelsHint') || '暂无模型，请到 API 设置添加'}</option>`;
    const selected = String(selectedModel || '');
    const options = uniqueModels(deps, [selected, ...models]).filter(Boolean);
    return `<optgroup label="文本模型">${options.map(model => `<option value="${deps.escapeHtml(model)}" ${model === selected ? 'selected' : ''}>${deps.escapeHtml(model)}</option>`).join('')}</optgroup>`;
}

function resolveImageProviderId(deps, id){
    const providers = imageApiProviders(deps);
    return providers.find(p => p.id === id)?.id || providers[0]?.id || '';
}

function providerOptions(deps, selectedId){
    const selected = resolveImageProviderId(deps, selectedId);
    const providers = imageApiProviders(deps);
    if(!providers.length) return `<option value="" disabled selected>${deps.tr('canvas.noApiProviders') || '暂无 API 平台'}</option>`;
    return providers.map(provider => `<option value="${deps.escapeHtml(provider.id)}" ${provider.id === selected ? 'selected' : ''}>${deps.escapeHtml(provider.name || provider.id)}</option>`).join('');
}

function providerImageModels(deps, providerId){
    // 不走 providerById（会 fallback 到第一个 provider，造成串台），直接查精确匹配
    const provider = deps.apiProviders.find(p => p.id === providerId);
    return uniqueModels(deps, provider?.image_models || []);
}

function sanitizeImageNodeProviderModel(deps, node){
    if(!node || node.type !== 'generator') return;
    node.apiProvider = resolveImageProviderId(deps, node.apiProvider || '');
    const models = providerImageModels(deps, node.apiProvider);
    if(!models.length) node.model = '';
    else if(!models.includes(resolveImageModel(deps, node.model))) node.model = models[0] || '';
}

function videoApiProviders(deps){
    const providers = (deps.apiProviders.length ? deps.apiProviders : defaultApiProviders(deps))
        .filter(p => p.id !== 'modelscope' && p.enabled !== false && (p.video_models || []).length);
    return providers.length ? providers : defaultApiProviders(deps);
}

function resolveVideoProviderId(deps, id){
    const providers = videoApiProviders(deps);
    return providers.find(p => p.id === id)?.id || providers[0]?.id || 'comfly';
}

function videoProviderOptions(deps, selectedId){
    const selected = resolveVideoProviderId(deps, selectedId);
    return videoApiProviders(deps).map(provider => `<option value="${deps.escapeHtml(provider.id)}" ${provider.id === selected ? 'selected' : ''}>${deps.escapeHtml(provider.name || provider.id)}</option>`).join('');
}

function providerVideoModels(deps, providerId){
    // 不走 providerById（会 fallback 到第一个 provider，造成串台），直接查精确匹配
    const provider = deps.apiProviders.find(p => p.id === providerId);
    return uniqueModels(deps, provider?.video_models || []);
}

function sanitizeVideoNodeProviderModel(deps, node){
    if(!node || node.type !== 'video') return;
    node.apiProvider = resolveVideoProviderId(deps, node.apiProvider || 'comfly');
    const models = providerVideoModels(deps, node.apiProvider);
    if(!models.length) node.model = '';
    else if(!models.includes(node.model)) node.model = models[0] || '';
}

function videoModelOptions(deps, selectedModel, providerId){
    const models = providerVideoModels(deps, providerId);
    if(!models.length){
        return `<option value="" disabled selected>${deps.tr('canvas.noModelsHint') || '暂无模型，请到 API 设置添加'}</option>`;
    }
    const selected = selectedModel || models[0];
    return uniqueModels(deps, [selected, ...models]).filter(Boolean).map(model => `<option value="${deps.escapeHtml(model)}" ${model === selected ? 'selected' : ''}>${deps.escapeHtml(model)}</option>`).join('');
}

function allImageModels(deps, providerId){
    const providerModels = providerImageModels(deps, providerId || deps.managedProviderId);
    return uniqueModels(deps, providerModels);
}

function modelscopeImageModels(deps, selected = ''){
    const provider = (deps.apiProviders.length ? deps.apiProviders : []).find(p => p.id === 'modelscope');
    return uniqueModels(deps, [
        selected,
        ...((provider?.image_models || []).length ? provider.image_models : []),
        'Tongyi-MAI/Z-Image-Turbo',
        'black-forest-labs/FLUX.2-klein-9B'
    ]);
}

function modelscopeImageModelOptions(deps, selectedModel){
    const selectedValue = selectedModel || modelscopeImageModels(deps)[0] || 'Tongyi-MAI/Z-Image-Turbo';
    return modelscopeImageModels(deps, selectedValue).map(model => `<option value="${deps.escapeHtml(model)}" ${model === selectedValue ? 'selected' : ''}>${deps.escapeHtml(model)}</option>`).join('');
}

function currentMsModelId(deps, modelKey, node){
    if(modelKey === 'custom') return node.msCustomModel || modelscopeImageModels(deps)[0] || 'Tongyi-MAI/Z-Image-Turbo';
    return (deps.MS_GEN_MODELS[modelKey] || deps.MS_GEN_MODELS.zimage).modelId;
}

function modelscopeLorasForModel(deps, modelId){
    const provider = (deps.apiProviders.length ? deps.apiProviders : []).find(p => p.id === 'modelscope');
    const list = Array.isArray(provider?.ms_loras) ? provider.ms_loras : [];
    return list.filter(lora =>
        lora && lora.enabled !== false &&
        String(lora.id || '').trim() &&
        String(lora.target_model || lora.model || '').trim() === String(modelId || '').trim()
    );
}

function modelscopeLoraOptions(deps, loras, selectedId){
    return loras.map(lora => {
        const id = String(lora.id || '').trim();
        const label = String(lora.name || id).trim();
        return `<option value="${deps.escapeHtml(id)}" ${id === selectedId ? 'selected' : ''}>${deps.escapeHtml(label)}</option>`;
    }).join('');
}

function allChatModels(deps){
    const providerModels = chatApiProviders(deps).flatMap(p => p.chat_models || []);
    return uniqueModels(deps, deps.hasManagedChatModels ? deps.localChatModels : [...providerModels, ...deps.chatModels, ...deps.localChatModels]);
}

function resolveImageModel(deps, value){
    if(value === 'gpt') return deps.models.gpt;
    if(value === 'nano') return deps.models.nano;
    return value || allImageModels(deps, deps.managedProviderId)[0] || deps.models.gpt;
}

function resolveChatModel(deps, value, providerId=''){
    const providerModels = providerId ? providerChatModels(deps, providerId) : [];
    return value || providerModels[0] || allChatModels(deps)[0] || deps.chatModels[0] || 'gpt-4o-mini';
}

function msChatModelOptions(deps, selected){
    // 单一数据源：从 API 设置里 modelscope 平台的 chat_models 取
    const msProvider = deps.apiProviders.find(p => p.id === 'modelscope');
    const list = uniqueModels(deps, msProvider?.chat_models || []);
    if(!list.length){
        return `<option value="" disabled selected>${deps.tr('canvas.noModelsHint') || '暂无模型，请到 API 设置添加'}</option>`;
    }
    const sel = selected && list.includes(selected) ? selected : list[0];
    return list.map(m => `<option value="${deps.escapeHtml(m)}" ${m === sel ? 'selected' : ''}>${deps.escapeHtml(m.split('/').pop().split(':')[0])}</option>`).join('');
}

async function loadConfig(deps){
    loadLocalModelLists(deps);
    try {
        const cfg = await deps.fetch('/api/config').then(r=>r.json());
        deps.imageModels = cfg.image_models?.length ? cfg.image_models : deps.imageModels;
        deps.chatModels = cfg.chat_models?.length ? cfg.chat_models : deps.chatModels;
        deps.videoModels = cfg.video_models?.length ? cfg.video_models : deps.DEFAULT_VIDEO_MODELS;
        deps.msChatModels = cfg.ms_chat_models?.length ? cfg.ms_chat_models : deps.msChatModels;
        deps.comfyBackendCount = Math.max(1, (cfg.comfy_instances || []).length || 1);
        deps.apiProviders = Array.isArray(cfg.api_providers) && cfg.api_providers.length ? cfg.api_providers : defaultApiProviders(deps);
        deps.models.nano = deps.imageModels.find(m => m.toLowerCase().includes('nano')) || 'nano-banana-pro';
        deps.models.gpt = deps.imageModels.find(m => !m.toLowerCase().includes('nano')) || cfg.image_model || 'gpt-image-2';
        try {
            const wf = await deps.fetch('/api/workflows').then(r=>r.json());
            deps.comfyWorkflows = wf.workflows || [];
        } catch(_) {
            deps.comfyWorkflows = [];
        }
        deps.runningHubWorkflowCache = {};
        const rhProvider = deps.apiProviders.find(p => p.id === 'runninghub');
        const rhWorkflowIds = (rhProvider?.rh_workflows || []).map(item => String(item.workflowId || item.id || '').trim()).filter(Boolean);
        await Promise.all(rhWorkflowIds.map(async workflowId => {
            try { await deps.ensureRunningHubWorkflow(workflowId); } catch(_) {}
        }));
    } catch(e) {
        deps.apiProviders = defaultApiProviders(deps);
    }
}

async function refreshCanvasConfigFromSettings(deps){
    await loadConfig(deps);
    deps.pruneMissingComfyWorkflows();
    (deps.nodes || []).forEach(node => {
        sanitizeImageNodeProviderModel(deps, node);
        sanitizeVideoNodeProviderModel(deps, node);
    });
    if(typeof deps.render === 'function') deps.render();
}

    const api={loadLocalModelLists, uniqueModels, defaultApiProviders, isRunningHubProvider, normalizeProviderId, imageApiProviders, midjourneyApiProviders, resolveMidjourneyProviderId, midjourneyProviderOptions, providerById, resolveProviderId, chatApiProviders, resolveChatProviderId, chatProviderOptions, providerChatModels, providerAudioAnalysisModels, audioAnalysisApiProviders, audioAnalysisProviderOptions, audioAnalysisModelOptions, resolveImageProviderId, providerOptions, providerImageModels, sanitizeImageNodeProviderModel, videoApiProviders, resolveVideoProviderId, videoProviderOptions, providerVideoModels, sanitizeVideoNodeProviderModel, videoModelOptions, allImageModels, modelscopeImageModels, modelscopeImageModelOptions, currentMsModelId, modelscopeLorasForModel, modelscopeLoraOptions, allChatModels, resolveImageModel, resolveChatModel, msChatModelOptions, loadConfig, refreshCanvasConfigFromSettings};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.CanvasProviderConfig=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
