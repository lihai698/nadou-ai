/* Canvas parameter rules. Host supplies tables and model/media reads; no DOM. */
(function(root){
    'use strict';

    function defaultSmartApiResolution(deps, model){
        return deps.isGptImageAutoSizeModel(model) ? '4k' : '1k';
    }

    function parseRatioValue(deps, value){
        const raw = String(value || '').trim();
        const parts = raw.includes(':') ? raw.split(':') : raw.split(/[xX*]/);
        if(parts.length !== 2) return 0;
        const w = Number(parts[0]);
        const h = Number(parts[1]);
        return w > 0 && h > 0 ? w / h : 0;
    }

    function normalizeApiSizeSettings(deps, prefix=''){
        const ratioKey = prefix ? `${prefix}Ratio` : 'ratio';
        const resKey = prefix ? `${prefix}Resolution` : 'resolution';
        const allowAuto = !prefix && deps.settings.engine === 'api' && deps.settings.apiKind !== 'video' && deps.isGptImageAutoSizeModel(deps.settings.model);
        if(!deps.settings[resKey]) deps.settings[resKey] = allowAuto ? defaultSmartApiResolution(deps, deps.settings.model) : '1k';
        if(!allowAuto && deps.settings[resKey] === 'auto') deps.settings[resKey] = '1k';
        if(deps.settings[resKey] === 'auto' && !deps.settings[ratioKey]) deps.settings[ratioKey] = 'square';
    }

    function normalizeSmartVideoModeSettings(deps, target, preferMultimodal=false){
        if(!target || typeof target !== 'object') return target;
        target.videoUseFrameRoles = Boolean(target.videoUseFrameRoles);
        if(preferMultimodal && !target.videoUseFrameRoles && target._videoMultimodalUserSet !== true) target.videoMultimodal = true;
        else target.videoMultimodal = Boolean(target.videoMultimodal);
        if(target.videoUseFrameRoles) target.videoMultimodal = false;
        return target;
    }

    function isApiLikeEngine(deps, engine){
        return ['api', 'volcengine'].includes(String(engine || '').toLowerCase());
    }

    function smartLoopRoundSettings(deps, runSettings, ctx=deps.smartLoopContext){
        const next = {...(runSettings || {})};
        const imageCountEngine = isApiLikeEngine(deps, next.engine)
            ? next.apiKind !== 'video'
            : next.engine === 'modelscope';
        if(ctx?.nodeId && imageCountEngine){
            next.count = 1;
        }
        return next;
    }

    function normalizeSmartImageMode(deps, mode){
        return 'self';
    }

    function smartImageMode(deps, node){
        return 'self';
    }

    function setSmartImageMode(deps, node, mode){
        if(!deps.isSmartImageNode(node)) return;
        delete node.imageMode;
    }

    function smartImageUsesWorkflowInput(deps, node, ctx=deps.smartLoopContext){
        return Boolean(deps.isSmartImageNode(node) && ctx?.forceWorkflow);
    }

    function normalizeLegacySmartNode(deps, node){
        if(!node || typeof node !== 'object') return node;
        if(node.type === 'smart-container'){
            const fallbackImage = node.inputImage?.url ? deps.stripImageGenerationMeta({
                url:node.inputImage.url,
                name:node.inputImage.name || 'image',
                kind:node.inputImage.kind || deps.mediaKindForItem(node.inputImage),
                natural_w:Number(node.inputImage.natural_w || 0),
                natural_h:Number(node.inputImage.natural_h || 0)
            }) : null;
            const images = Array.isArray(node.images) && node.images.length
                ? node.images
                : (fallbackImage ? [fallbackImage] : []);
            const normalized = {
                ...node,
                type:'smart-image',
                title:images.length > 1 ? 'Group' : (images.length ? 'Image' : deps.tr('smart.createImportNode')),
                images
            };
            delete normalized.imageMode;
            delete normalized.inputImage;
            delete normalized.steps;
            delete normalized.resultGrouping;
            return normalized;
        }
        if(!node.type) node.type = 'smart-image';
        if(node.type === 'smart-image') delete node.imageMode;
        if(node.type === 'smart-image' && node.historyFor) node.isHistoryGroup = true;
        return node;
    }

    function validOutpaintSize(deps, node){
        const w = Math.round(Number(node?.outpaintSize?.width || 0));
        const h = Math.round(Number(node?.outpaintSize?.height || 0));
        return w > 0 && h > 0 ? {width:w, height:h} : null;
    }

    function withOutpaintDisplaySettings(deps, node, baseSettings){
        const size = validOutpaintSize(deps, node);
        if(!size) return baseSettings;
        const engine = ['api','volcengine','modelscope','comfy','runninghub'].includes(baseSettings?.engine) ? baseSettings.engine : 'api';
        const next = {
            ...baseSettings,
            resolution:'custom',
            ratio:'',
            customWidth:size.width,
            customHeight:size.height,
            customSize:`${size.width}x${size.height}`,
            outpaintResolutionLocked:true
        };
        if(isApiLikeEngine(deps, engine)) next.apiKind = 'image';
        if(engine === 'modelscope'){
            next.msResolution = 'custom';
            next.msRatio = '';
            next.msCustomWidth = size.width;
            next.msCustomHeight = size.height;
            next.msCustomSize = `${size.width}x${size.height}`;
        }
        if(engine === 'comfy'){
            next.width = size.width;
            next.height = size.height;
        }
        return next;
    }

    function sizeForRun(deps, sourceSettings=deps.settings){
        const fallbackResolution = sourceSettings.engine === 'api' && deps.isGptImageAutoSizeModel(sourceSettings.model)
            ? defaultSmartApiResolution(deps, sourceSettings.model)
            : '1k';
        return deps.apiImageSize(sourceSettings.ratio || 'square', sourceSettings.resolution || fallbackResolution, sourceSettings.customRatio || '', sourceSettings.customSize || '') || '1024x1024';
    }

    function expectedOutputSize(deps){
        if(deps.settings.engine === 'comfy'){
            if(deps.settings.comfyMode === 'text'){
                const w = Number(deps.settings.width) || 1024;
                const h = Number(deps.settings.height) || 1024;
                return {w, h};
            }
            return {w:1024, h:1024};
        }
        if(deps.settings.engine === 'runninghub') return {w:1024, h:1024};
        const sizeStr = deps.settings.engine === 'modelscope'
            ? deps.apiImageSize(deps.settings.msRatio || 'square', deps.settings.msResolution || '1k', deps.settings.msCustomRatio || '', deps.settings.msCustomSize || '')
            : sizeForRun(deps);
        const parsed = deps.parseSizeValue(sizeStr);
        if(parsed){
            return {w: Number(parsed.width) || 1024, h: Number(parsed.height) || 1024};
        }
        return {w:1024, h:1024};
    }

    function explicitRequestOutputSizeForPending(deps){
        if(isApiLikeEngine(deps, deps.settings.engine) && deps.settings.apiKind !== 'video'){
            const parsed = deps.parseSizeValue(sizeForRun(deps));
            if(parsed) return {w:Number(parsed.width) || 1024, h:Number(parsed.height) || 1024};
        }
        if(deps.settings.engine === 'modelscope'){
            const sizeStr = deps.apiImageSize(deps.settings.msRatio || 'square', deps.settings.msResolution || '1k', deps.settings.msCustomRatio || '', deps.settings.msCustomSize || '');
            const parsed = deps.parseSizeValue(sizeStr);
            if(parsed) return {w:Number(parsed.width) || 1024, h:Number(parsed.height) || 1024};
        }
        if(deps.settings.engine === 'comfy' && deps.settings.comfyMode === 'text'){
            const w = Number(deps.settings.width) || 1024;
            const h = Number(deps.settings.height) || 1024;
            return {w, h};
        }
        return null;
    }

    function pendingSizeFromImageRef(deps, img){
        const w = Number(img?.natural_w || img?.width || 0);
        const h = Number(img?.natural_h || img?.height || 0);
        return w > 0 && h > 0 ? {w, h} : null;
    }

    const api={defaultSmartApiResolution, parseRatioValue, normalizeApiSizeSettings, normalizeSmartVideoModeSettings, isApiLikeEngine, smartLoopRoundSettings, normalizeSmartImageMode, smartImageMode, setSmartImageMode, smartImageUsesWorkflowInput, normalizeLegacySmartNode, validOutpaintSize, withOutpaintDisplaySettings, sizeForRun, expectedOutputSize, explicitRequestOutputSizeForPending, pendingSizeFromImageRef};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.SmartNodeParams=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
