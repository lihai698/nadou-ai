/* Smart parameter panel responsibility: smart-param-bindings. Host supplies live state and effects. */
(function(root){
    'use strict';

function setDynamicSetting(deps, key, value){
    if(key==='audioModel' && value==='__image__'){deps.settings.audioManualSelection=false;deps.persistActiveSmartSettings();deps.renderDynamicParams();deps.scheduleSave();return;}
    if(key.startsWith('audio')){deps.settings[key]=value;if(key==='audioProvider'){deps.settings.audioModel='';deps.settings.audioVoice='';}deps.persistActiveSmartSettings();deps.renderDynamicParams();deps.scheduleSave();return;}
    if(key==='provider_id' && deps.smartHasAudioAnalysisInput()){deps.settings.provider_id=value;deps.settings.model='';deps.persistActiveSmartSettings();deps.renderDynamicParams();deps.scheduleSave();return;}
    if(key==='model' && String(value).startsWith('audio:')){deps.settings.audioProvider=deps.settings.provider_id;deps.settings.audioModel=String(value).slice(6);deps.settings.audioManualSelection=true;deps.persistActiveSmartSettings();deps.renderDynamicParams();deps.scheduleSave();return;}
    if(key==='provider_id' && !deps.imageProviders().some(p=>p.id===value) && deps.window.CanvasAudio.providers(deps.apiProviders).some(p=>p.id===value)){deps.settings.audioProvider=value;deps.settings.audioManualSelection=true;deps.persistActiveSmartSettings();deps.renderDynamicParams();deps.scheduleSave();return;}
    const numericKeys = new Set(['count','width','height','videoDuration','enhanceStrength','enhanceUpscaleRes','editUpscaleRes','customRatioWidth','customRatioHeight','customWidth','customHeight','msCustomRatioWidth','msCustomRatioHeight','msCustomWidth','msCustomHeight']);
    const layoutKeys = new Set(['provider_id','model','resolution','ratio','msgenModel','msCustomModel','msResolution','msRatio','videoProvider','videoModel','videoAspect','videoResolution','comfyMode','comfyWorkflow','quality','count','enhanceUpscaleRes','editUpscaleRes','jimengUpscaleRes','rhConfigKey','rhPayment','rhInstanceType']);
    deps.settings[key] = numericKeys.has(key) && value !== '' ? Number(value) : value;
    if(key === 'provider_id') deps.settings.model = '';
    if(key === 'videoProvider') deps.settings.videoModel = '';
    if(key === 'videoMultimodal') deps.settings._videoMultimodalUserSet = true;
    if(key === 'videoMultimodal' && deps.settings.videoMultimodal) deps.settings.videoUseFrameRoles = false;
    deps.normalizeSmartVideoModeSettings(deps.settings, key === 'videoUseFrameRoles');
    if(key === 'comfyMode') deps.applyRecentSmartSettingsForCurrentMode();
    if(key === 'resolution'){
        if(deps.settings.resolution === 'custom') deps.settings.ratio = '';
        else if(!deps.settings.ratio) deps.settings.ratio = 'square';
    }
    if(key === 'ratio') deps.applySourceRatioToSettings('');
    if(key === 'msResolution'){
        if(deps.settings.msResolution === 'custom') deps.settings.msRatio = '';
        else if(!deps.settings.msRatio) deps.settings.msRatio = 'square';
    }
    if(key === 'msRatio') deps.applySourceRatioToSettings('ms');
    if(key === 'customRatioWidth' || key === 'customRatioHeight'){
        deps.settings.customRatio = deps.settings.customRatioWidth && deps.settings.customRatioHeight ? `${deps.settings.customRatioWidth}:${deps.settings.customRatioHeight}` : '';
        deps.settings.ratio = 'custom';
    }
    if(key === 'msCustomRatioWidth' || key === 'msCustomRatioHeight'){
        deps.settings.msCustomRatio = deps.settings.msCustomRatioWidth && deps.settings.msCustomRatioHeight ? `${deps.settings.msCustomRatioWidth}:${deps.settings.msCustomRatioHeight}` : '';
        deps.settings.msRatio = 'custom';
    }
    if(key === 'customWidth' || key === 'customHeight'){
        deps.settings.customSize = deps.settings.customWidth && deps.settings.customHeight ? `${deps.settings.customWidth}x${deps.settings.customHeight}` : '';
        deps.settings.resolution = 'custom';
    }
    if(key === 'msCustomWidth' || key === 'msCustomHeight'){
        deps.settings.msCustomSize = deps.settings.msCustomWidth && deps.settings.msCustomHeight ? `${deps.settings.msCustomWidth}x${deps.settings.msCustomHeight}` : '';
        deps.settings.msResolution = 'custom';
    }
    const sizeKeys = new Set(['resolution','ratio','customRatio','customRatioWidth','customRatioHeight','customWidth','customHeight','customSize']);
    const unlockOutpaintSize = deps.settings.outpaintResolutionLocked && sizeKeys.has(key);
    if(unlockOutpaintSize){
        delete deps.settings.outpaintResolutionLocked;
        const subject = deps.activeSettingsSubject();
        if(subject) delete subject.outpaintSize;
    }
    if(key === 'comfyWorkflow') {
        deps.settings.comfyParams = {};
        deps.ensureComfyWorkflow(deps.settings.comfyWorkflow).then(deps.renderDynamicParams);
    }
    if(key === 'rhConfigKey'){
        deps.settings.rhParams = {};
        deps.settings.rhRandomActive = {};
    }
    deps.persistActiveSmartSettings();
    deps.rememberRecentSmartSettings(deps.settings, deps.activeSettingsSubject());
    if(layoutKeys.has(key)) deps.renderDynamicParams();
    deps.scheduleSave();
}

function closeAllSmartPopovers(deps){
    deps.document.querySelectorAll('.smart-control.pinned, .smart-control.interacting').forEach(c => c.classList.remove('pinned', 'interacting'));
}

function markControlInteracting(deps, el){
    const ctrl = el?.closest?.('.smart-control');
    if(ctrl && !ctrl.classList.contains('pinned')) ctrl.classList.add('interacting');
}

function bindDynamicParams(deps){
    deps.dynamicParams.querySelectorAll('.smart-control').forEach(ctrl => {
        // 悬浮态的多选：鼠标移出整个控件（含上方弹层，弹层是 DOM 子节点）才解除，途中点参数不收起。
        ctrl.onmouseleave = () => ctrl.classList.remove('interacting');
    });
    deps.dynamicParams.querySelectorAll('.smart-control > .smart-pill').forEach(pill => {
        pill.onclick = event => {
            event.preventDefault();
            event.stopPropagation();
            const ctrl = pill.parentElement;
            const wasPinned = ctrl.classList.contains('pinned');
            closeAllSmartPopovers(deps);
            if(!wasPinned) ctrl.classList.add('pinned');
        };
    });
    deps.dynamicParams.querySelectorAll('[data-smart-param]').forEach(btn => {
        btn.onclick = event => {
            event.preventDefault();
            event.stopPropagation();
            markControlInteracting(deps, btn);
            setDynamicSetting(deps, btn.dataset.smartParam, btn.dataset.smartValue);
            if(btn.dataset.smartParam === 'videoDuration') deps.renderDynamicParams();
        };
    });
    deps.dynamicParams.querySelectorAll('[data-size-scope]').forEach(btn => {
        btn.onclick = event => {
            event.preventDefault();
            event.stopPropagation();
            markControlInteracting(deps, btn);
            const prefix = btn.dataset.sizePrefix || '';
            const scope = btn.dataset.sizeScope;
            const resKey = prefix ? `${prefix}Resolution` : 'resolution';
            const ratioKey = prefix ? `${prefix}Ratio` : 'ratio';
            const allowAuto = !prefix && deps.settings.engine === 'api' && deps.settings.apiKind !== 'video' && deps.isGptImageAutoSizeModel(deps.settings.model);
            if(scope === 'auto'){
                if(!allowAuto) return;
                deps.settings[resKey] = 'auto';
                if(!deps.settings[ratioKey]) deps.settings[ratioKey] = 'square';
            } else if(scope === 'custom'){
                deps.settings[resKey] = 'custom';
            } else {
                deps.settings[resKey] = ['1k','2k','4k'].includes(deps.settings[resKey]) ? deps.settings[resKey] : deps.sizePickerDefaultResolution(prefix);
                if(!deps.settings[ratioKey] || deps.settings[ratioKey] === 'custom') deps.settings[ratioKey] = 'square';
            }
            deps.persistActiveSmartSettings();
            deps.rememberRecentSmartSettings(deps.settings, deps.activeSettingsSubject());
            deps.renderDynamicParams();
            deps.scheduleSave();
        };
    });
    deps.dynamicParams.querySelectorAll('[data-param]').forEach(input => {
        input.onclick = event => event.stopPropagation();
        input.oninput = input.onchange = event => {
            event?.stopPropagation?.();
            setDynamicSetting(deps, input.dataset.param, input.value);
            if(input.dataset.param === 'videoDuration' && event?.type === 'change') deps.renderDynamicParams();
        };
    });
    deps.dynamicParams.querySelectorAll('[data-toggle-param]').forEach(btn => {
        btn.onclick = event => {
            event.preventDefault();
            event.stopPropagation();
            deps.settings[btn.dataset.toggleParam] = !deps.settings[btn.dataset.toggleParam];
            if(btn.dataset.toggleParam === 'videoMultimodal') deps.settings._videoMultimodalUserSet = true;
            if(btn.dataset.toggleParam === 'videoMultimodal' && deps.settings.videoMultimodal) deps.settings.videoUseFrameRoles = false;
            deps.normalizeSmartVideoModeSettings(deps.settings, btn.dataset.toggleParam === 'videoUseFrameRoles');
            deps.persistActiveSmartSettings();
            deps.renderDynamicParams();
            deps.scheduleSave();
        };
    });
    deps.dynamicParams.querySelectorAll('[data-trusted-source]').forEach(btn => {
        btn.onclick = async event => {
            event.preventDefault();
            event.stopPropagation();
            const src = btn.dataset.trustedSource;
            deps.settings.videoTrustedSource = ['library','cloud','manual'].includes(src) ? src : 'library';
            deps.persistActiveSmartSettings();
            deps.renderDynamicParams();
            deps.scheduleSave();
            try {
                if(src === 'cloud') await deps.uploadCurrentSmartVideosToCloud();
                else if(src === 'manual') await deps.setCurrentSmartManualVideoUrl();
            } catch(e) {
                deps.toast((e.message || '操作失败').slice(0, 180));
            }
        };
    });
    deps.dynamicParams.querySelectorAll('[data-comfy-bool]').forEach(btn => {
        btn.onclick = event => {
            event.preventDefault();
            event.stopPropagation();
            deps.settings.comfyParams = deps.settings.comfyParams || {};
            const id = btn.dataset.comfyBool;
            const field = deps.currentComfyFields().find(f => f.id === id);
            deps.settings.comfyParams[id] = !Boolean(deps.settings.comfyParams[id] ?? field?.default ?? false);
            deps.persistActiveSmartSettings();
            deps.renderDynamicParams();
            deps.scheduleSave();
        };
    });
    deps.dynamicParams.querySelectorAll('[data-comfy-param]').forEach(input => {
        input.onclick = event => event.stopPropagation();
        input.oninput = input.onchange = event => {
            event?.stopPropagation?.();
            deps.settings.comfyParams = deps.settings.comfyParams || {};
            const field = deps.currentComfyFields().find(f => f.id === input.dataset.comfyParam);
            if(field?.type === 'number' || field?.type === 'slider') deps.settings.comfyParams[input.dataset.comfyParam] = Number(input.value) || 0;
            else deps.settings.comfyParams[input.dataset.comfyParam] = input.value;
            deps.persistActiveSmartSettings();
            deps.scheduleSave();
        };
    });
    deps.dynamicParams.querySelectorAll('[data-comfy-pick]').forEach(btn => {
        btn.onclick = event => {
            event.preventDefault();
            event.stopPropagation();
            deps.settings.comfyParams = deps.settings.comfyParams || {};
            const fieldId = btn.dataset.comfyPick;
            const value = btn.dataset.comfyValue;
            deps.settings.comfyParams[fieldId] = value;
            const popover = btn.closest('.smart-popover');
            const control = btn.closest('.smart-control');
            const pillSub = control?.querySelector('.smart-pill .sub');
            if(pillSub) pillSub.textContent = value;
            if(popover){
                popover.querySelectorAll(`[data-comfy-pick="${fieldId}"]`).forEach(b => b.classList.toggle('active', b.dataset.comfyValue === value));
            }
            closeAllSmartPopovers(deps);
            deps.persistActiveSmartSettings();
            deps.scheduleSave();
        };
    });
    deps.dynamicParams.querySelectorAll('[data-comfy-random]').forEach(btn => {
        btn.onclick = event => {
            event.preventDefault();
            event.stopPropagation();
            deps.toggleSmartComfyRandom(btn.dataset.comfyRandom);
        };
    });
    deps.dynamicParams.querySelectorAll('[data-rh-bool]').forEach(btn => {
        btn.onclick = event => {
            event.preventDefault();
            event.stopPropagation();
            deps.settings.rhParams = deps.settings.rhParams || {};
            const key = btn.dataset.rhBool;
            const field = deps.rhActiveFields().find(f => deps.rhParamKey(f.nodeId, f.fieldName) === key);
            const cur = deps.settings.rhParams[key] || {};
            const on = String(deps.rhParamValue(field, null)).toLowerCase() === 'true';
            deps.settings.rhParams[key] = {...cur, value:String(!on)};
            deps.persistActiveSmartSettings();
            deps.renderDynamicParams();
            deps.scheduleSave();
        };
    });
    deps.dynamicParams.querySelectorAll('[data-rh-param]').forEach(input => {
        input.onclick = event => event.stopPropagation();
        input.oninput = input.onchange = event => {
            event?.stopPropagation?.();
            const key = input.dataset.rhParam;
            deps.settings.rhParams = deps.settings.rhParams || {};
            const cur = deps.settings.rhParams[key] || {};
            deps.settings.rhParams[key] = {...cur, value:input.value};
            const control = input.closest('.smart-control');
            const valueText = control?.querySelector('.rh-slider-value');
            const pillValue = control?.querySelector('.rh-slider-pill-value');
            if(valueText) valueText.textContent = input.value;
            if(pillValue) pillValue.textContent = input.value;
            deps.persistActiveSmartSettings();
            deps.scheduleSave();
        };
        if(input.dataset.rhType === 'slider'){
            input.onpointerup = () => input.blur();
            input.onmouseleave = () => {
                if(!input.closest('.smart-control')?.matches(':hover')) input.blur();
            };
        }
    });
    deps.dynamicParams.querySelectorAll('[data-rh-pick]').forEach(btn => {
        btn.onclick = event => {
            event.preventDefault();
            event.stopPropagation();
            const key = btn.dataset.rhPick;
            const value = btn.dataset.rhValue;
            deps.settings.rhParams = deps.settings.rhParams || {};
            const cur = deps.settings.rhParams[key] || {};
            deps.settings.rhParams[key] = {...cur, value};
            const popover = btn.closest('.smart-popover');
            const control = btn.closest('.smart-control');
            const pillSub = control?.querySelector('.smart-pill .sub');
            if(pillSub) pillSub.textContent = value;
            if(popover){
                popover.querySelectorAll('[data-rh-pick]').forEach(b => {
                    if(b.dataset.rhPick === key) b.classList.toggle('active', b.dataset.rhValue === value);
                });
            }
            closeAllSmartPopovers(deps);
            deps.persistActiveSmartSettings();
            deps.scheduleSave();
        };
    });
    deps.dynamicParams.querySelectorAll('[data-rh-random]').forEach(btn => {
        btn.onclick = event => {
            event.preventDefault();
            event.stopPropagation();
            deps.toggleSmartRhRandom(btn.dataset.rhRandom);
        };
    });
}

    const api={setDynamicSetting, closeAllSmartPopovers, markControlInteracting, bindDynamicParams};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.SmartParamBindings=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
