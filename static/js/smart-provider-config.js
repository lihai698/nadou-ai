/* Smart provider model configuration: smart-provider-config. Host supplies live state and effects. */
(function(root){
    'use strict';

function imageProviders(deps){
    return (deps.apiProviders || []).filter(p => p.enabled !== false && p.id !== 'modelscope' && p.id !== 'volcengine' && (p.image_models || []).length);
}

function volcengineProvider(deps){
    return (deps.apiProviders || []).find(p => p.id === 'volcengine' && p.enabled !== false) || {
        id:'volcengine',
        name:'火山引擎',
        image_models:[],
        video_models:deps.DEFAULT_VIDEO_MODELS,
        enabled:true
    };
}

function chatApiProviders(deps){
    return (deps.apiProviders || []).filter(p => p.enabled !== false && (p.chat_models || []).length);
}

function resolveChatProviderId(deps, providerId=''){
    const providers = chatApiProviders(deps);
    if(providers.some(p => p.id === providerId)) return providerId;
    return providers[0]?.id || 'comfly';
}

function providerChatModels(deps, providerId){
    const provider = chatApiProviders(deps).find(p => p.id === providerId);
    return [...new Set(provider?.chat_models || [])];
}

function resolveChatModel(deps, model='', providerId=''){
    const models = providerChatModels(deps, resolveChatProviderId(deps, providerId));
    return models.includes(model) ? model : (models[0] || model || 'gpt-4o-mini');
}

function chatProviderOptions(deps, selectedId=''){
    const selected = resolveChatProviderId(deps, selectedId);
    return chatApiProviders(deps).map(provider => `<option value="${deps.escapeHtml(provider.id)}" ${provider.id === selected ? 'selected' : ''}>${deps.escapeHtml(provider.name || provider.id)}</option>`).join('');
}

function chatModelOptions(deps, selectedModel='', providerId=''){
    const selectedProvider = resolveChatProviderId(deps, providerId);
    const models = providerChatModels(deps, selectedProvider);
    const selected = resolveChatModel(deps, selectedModel, selectedProvider);
    return [...new Set([selected, ...models].filter(Boolean))].map(model => `<option value="${deps.escapeHtml(model)}" ${model === selected ? 'selected' : ''}>${deps.escapeHtml(model)}</option>`).join('');
}

function apiProviderById(deps, providerId){
    if(providerId === 'volcengine') return volcengineProvider(deps);
    return (deps.apiProviders || []).find(p => p.id === providerId) || imageProviders(deps)[0] || null;
}

function videoProviderPlatform(deps, providerId){
    const p = (deps.apiProviders || []).find(x => x.id === providerId);
    const proto = String(p?.protocol || '').toLowerCase();
    const base = String(p?.base_url || '').toLowerCase();
    if(proto === 'apimart' || base.includes('apimart.ai')) return 'apimart';
    if(proto === 'volcengine' || providerId === 'volcengine') return 'volcengine';
    return '';
}

function providerImageModels(deps, providerId){
    if(providerId === 'volcengine') return volcengineProvider(deps).image_models || [];
    return (deps.apiProviders || []).find(p => p.id === providerId)?.image_models || [];
}

function isJimengProviderId(deps, providerId){
    const id = String(providerId || '').trim().toLowerCase();
    const provider = (deps.apiProviders || []).find(item => String(item.id || '').trim().toLowerCase() === id);
    return id === 'jimeng' || String(provider?.protocol || '').trim().toLowerCase() === 'jimeng';
}

function jimengImageProviderId(deps){
    const provider = imageProviders(deps).find(item => isJimengProviderId(deps, item.id));
    return provider?.id || (isJimengProviderId(deps, deps.settings.provider_id) ? deps.settings.provider_id : '');
}

function sanitizeSmartApiSelection(deps, target=deps.settings){
    if(!target || typeof target !== 'object') return target;
    if(target.engine === 'volcengine'){
        if(target.apiKind === 'video'){
            target.videoProvider = 'volcengine';
            const models = volcengineVideoModels(deps);
            if(!models.includes(target.videoModel)) target.videoModel = models[0] || '';
        } else {
            target.provider_id = 'volcengine';
            const models = providerImageModels(deps, 'volcengine');
            if(!models.includes(target.model)) target.model = models[0] || '';
        }
        return target;
    }
    clearVolcengineSelectionOutsideVolcengine(deps, target);
    if(target.provider_id){
        const models = providerImageModels(deps, target.provider_id);
        if(models.length && !models.includes(target.model)) target.model = models[0] || '';
    }
    if((target.engine || 'api') === 'api' && (target.apiKind || 'image') !== 'video'){
        const allowAuto = deps.isGptImageAutoSizeModel(target.model);
        if(!target.resolution) target.resolution = allowAuto ? deps.defaultSmartApiResolution(target.model) : '1k';
        if(!allowAuto && target.resolution === 'auto') target.resolution = '1k';
    }
    if(target.videoProvider){
        const models = providerVideoModels(deps, target.videoProvider);
        if(models.length && !models.includes(target.videoModel)) target.videoModel = models[0] || '';
    }
    return target;
}

function modelscopeProvider(deps){
    return (deps.apiProviders || []).find(p => p.id === 'modelscope' && p.enabled !== false) || null;
}

function modelscopeImageModels(deps){
    return modelscopeProvider(deps)?.image_models || ['Tongyi-MAI/Z-Image-Turbo'];
}

function videoApiProviders(deps){
    const fromConfig = (deps.apiProviders || []).filter(p => p.enabled !== false && p.id !== 'volcengine' && (p.video_models || []).length);
    if(fromConfig.length) return fromConfig;
    return [{id:'comfly', name:'Comfly', video_models:deps.DEFAULT_VIDEO_MODELS, enabled:true}];
}

function videoProviderById(deps, providerId){
    if(providerId === 'volcengine') return volcengineProvider(deps);
    return videoApiProviders(deps).find(p => p.id === providerId) || videoApiProviders(deps)[0] || null;
}

function providerVideoModels(deps, providerId){
    if(providerId === 'volcengine') return volcengineVideoModels(deps);
    const provider = videoApiProviders(deps).find(p => p.id === providerId);
    const models = provider?.video_models || deps.DEFAULT_VIDEO_MODELS;
    return [...new Set(models)];
}

function volcengineVideoModels(deps){
    const provider = (deps.apiProviders || []).find(p => p.id === 'volcengine');
    return [...new Set(provider?.video_models || deps.DEFAULT_VIDEO_MODELS)];
}

async function loadConfig(deps){
    try {
        const cfg = await deps.fetch('/api/config').then(r => r.json());
        deps.apiProviders = Array.isArray(cfg.api_providers) ? cfg.api_providers : [];
        deps.comfyInstanceCount = Math.max(1, (Array.isArray(cfg.comfy_instances) ? cfg.comfy_instances : []).filter(Boolean).length || 1);
        // 提供商配置已就绪即先渲染参数面板，避免等工作流/RunningHub 预取完成后参数才「突然刷新出来」。
        sanitizeSmartApiSelection(deps, deps.settings);
        deps.updateProviderModels();
        const wf = await deps.fetch('/api/workflows').then(r => r.json()).catch(() => ({workflows:[]}));
        deps.comfyWorkflows = Array.isArray(wf.workflows) ? wf.workflows : [];
        deps.runningHubWorkflowCache = {};
        const rhProvider = deps.apiProviders.find(p => p.id === 'runninghub');
        const rhWorkflowIds = (rhProvider?.rh_workflows || []).map(item => String(item.workflowId || item.id || '').trim()).filter(Boolean);
        await Promise.all(rhWorkflowIds.map(async workflowId => {
            try { await deps.ensureRunningHubWorkflow(workflowId); } catch(_) {}
        }));
        deps.lastConfigRefreshAt = Date.now();
        sanitizeSmartApiSelection(deps, deps.settings);
        deps.updateProviderModels();
    } catch(e) {
        deps.toast(deps.tr('smart.toastApiSettingsFail'));
    }
}

async function refreshSmartConfigFromSettings(deps){
    await loadConfig(deps);
    deps.renderDynamicParams();
    const node = deps.selectedNode();
    if(node?.type === 'smart-prompt') {
        deps.applySettingsToNode(node);
        deps.render();
    }
}

function clearVolcengineSelectionOutsideVolcengine(deps, target=deps.settings){
    if(!target || typeof target !== 'object' || target.engine === 'volcengine') return target;
    if(target.provider_id === 'volcengine') target.provider_id = '';
    if(target.videoProvider === 'volcengine') target.videoProvider = '';
    return target;
}

    const api={imageProviders, volcengineProvider, chatApiProviders, resolveChatProviderId, providerChatModels, resolveChatModel, chatProviderOptions, chatModelOptions, apiProviderById, videoProviderPlatform, providerImageModels, isJimengProviderId, jimengImageProviderId, sanitizeSmartApiSelection, modelscopeProvider, modelscopeImageModels, videoApiProviders, videoProviderById, providerVideoModels, volcengineVideoModels, loadConfig, refreshSmartConfigFromSettings, clearVolcengineSelectionOutsideVolcengine};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.SmartProviderConfig=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
