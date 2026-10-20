/* Canvas parameter rules. Host supplies tables and model/media reads; no DOM. */
(function(root){
    'use strict';

    function defaultApiImageResolution(deps, model){
        return deps.isGptImageAutoSizeModel(deps.resolveImageModel(model)) ? '4k' : '1k';
    }

    function normalizedImageQuality(deps, value){
        const quality = String(value || 'auto').trim().toLowerCase();
        return ['low','medium','high'].includes(quality) ? quality : '';
    }

    function parseRatioValue(deps, value){
        const raw = String(value || '').trim();
        if(!raw) return null;
        if(raw.includes(':')){
            const [w,h] = raw.split(':').map(Number);
            if(w > 0 && h > 0) return w / h;
        }
        const n = Number(raw);
        return n > 0 ? n : null;
    }

    function gcdInt(deps, a, b){
        a = Math.abs(Math.round(Number(a) || 0));
        b = Math.abs(Math.round(Number(b) || 0));
        while(b){ const t = b; b = a % b; a = t; }
        return a || 1;
    }

    function ratioPartsFromDimensions(deps, width, height){
        const w = Math.max(1, Math.round(Number(width) || 1));
        const h = Math.max(1, Math.round(Number(height) || 1));
        const target = w / h;
        let best = {width:1, height:1, score:Infinity};
        const maxPart = 21;
        for(let rw = 1; rw <= maxPart; rw++){
            for(let rh = 1; rh <= maxPart; rh++){
                const ratio = rw / rh;
                const relativeError = Math.abs(ratio - target) / target;
                const complexityPenalty = Math.max(rw, rh) * 0.0008;
                const score = relativeError + complexityPenalty;
                if(score < best.score) best = {width:rw, height:rh, score};
            }
        }
        const g = gcdInt(deps, best.width, best.height);
        return {width:best.width / g, height:best.height / g};
    }

    function normalizeApiNodeSizeChoice(deps, node){
        if(!node) return;
        const allowAuto = deps.isGptImageAutoSizeModel(deps.resolveImageModel(node.model));
        if(allowAuto && node._apiResolutionUserSet !== true && (!node.resolution || node.resolution === '1k' || node.resolution === 'auto')) node.resolution = defaultApiImageResolution(deps, node.model);
        else if(!node.resolution) node.resolution = defaultApiImageResolution(deps, node.model);
        if(!allowAuto && node.resolution === 'auto') node.resolution = '1k';
    }

    function setCanvasGeneratorSizeFields(deps, node, patch){
        Object.assign(node,patch);
        if(Object.hasOwn(patch,'resolution')){
            node._apiResolutionUserSet=true;
            if(node.resolution==='custom')node.ratio='';
            else{if(!node.ratio)node.ratio='square';node.customSize='';node.customWidth='';node.customHeight='';}
        }
        if(Object.hasOwn(patch,'ratio') && node.ratio!=='custom'){
            node.customRatio='';node.customRatioWidth='';node.customRatioHeight='';
        }
        if(Object.hasOwn(patch,'customRatioWidth') || Object.hasOwn(patch,'customRatioHeight')){
            node.customRatioWidth=String(node.customRatioWidth||'');node.customRatioHeight=String(node.customRatioHeight||'');
            node.customRatio=node.customRatioWidth&&node.customRatioHeight?`${node.customRatioWidth}:${node.customRatioHeight}`:'';
            node.ratio='custom';
        }
        if(Object.hasOwn(patch,'customWidth') || Object.hasOwn(patch,'customHeight')){
            node.customWidth=String(node.customWidth||'');node.customHeight=String(node.customHeight||'');
            node.customSize=node.customWidth&&node.customHeight?`${node.customWidth}x${node.customHeight}`:'';
            node.resolution='custom';node._apiResolutionUserSet=true;node.ratio='';
        }
        normalizeApiNodeSizeChoice(deps, node);
    }

    function setCanvasMsSizeFields(deps, node, patch){
        Object.assign(node,patch);
        if(Object.hasOwn(patch,'msResolution')){
            if(node.msResolution==='custom')node.msRatio='';
            else{if(!node.msRatio)node.msRatio='square';node.msCustomSize='';node.msCustomWidth='';node.msCustomHeight='';}
        }
        if(Object.hasOwn(patch,'msRatio') && node.msRatio!=='custom'){
            node.msCustomRatio='';node.msCustomRatioWidth='';node.msCustomRatioHeight='';
        }
        if(Object.hasOwn(patch,'msCustomRatioWidth') || Object.hasOwn(patch,'msCustomRatioHeight')){
            node.msCustomRatioWidth=String(node.msCustomRatioWidth||'');node.msCustomRatioHeight=String(node.msCustomRatioHeight||'');
            node.msCustomRatio=node.msCustomRatioWidth&&node.msCustomRatioHeight?`${node.msCustomRatioWidth}:${node.msCustomRatioHeight}`:'';
            node.msRatio='custom';
        }
        if(Object.hasOwn(patch,'msCustomWidth') || Object.hasOwn(patch,'msCustomHeight')){
            node.msCustomWidth=String(node.msCustomWidth||'');node.msCustomHeight=String(node.msCustomHeight||'');
            node.msCustomSize=node.msCustomWidth&&node.msCustomHeight?`${node.msCustomWidth}x${node.msCustomHeight}`:'';
            node.msResolution='custom';node.msRatio='';
        }
    }

    async function generatorSizeForRun(deps, gen, refs){
        if((gen.ratio || 'square') === 'source'){
            const ref = refs?.[0];
            if(ref?.url){
                try {
                    const dims = await deps.getImageDimensions(ref.url);
                    const parts = ratioPartsFromDimensions(deps, dims.width, dims.height);
                    gen.customRatioWidth = String(parts.width);
                    gen.customRatioHeight = String(parts.height);
                    gen.customRatio = `${parts.width}:${parts.height}`;
                } catch(_) {}
            }
        }
        const ratio = (gen.ratio === 'source' && !gen.customRatio)
            ? 'square'
            : (gen.ratio ?? 'square');
        return deps.apiImageSize(ratio, gen.resolution || defaultApiImageResolution(deps, gen.model), gen.customRatio || '', gen.customSize || '');
    }

    function normalizeApiNodeLayout(deps, node){
        if(!node || node.type !== 'generator') return;
        if(Number(node.w || 0) === 418) node.w = 380;
    }

    function normalizedPendingPreviewSize(deps, size){
        const w = Number(size?.w ?? size?.width ?? 0);
        const h = Number(size?.h ?? size?.height ?? 0);
        if(w > 0 && h > 0) return {w:Math.round(w), h:Math.round(h)};
        return null;
    }

    function pendingPreviewSizeFromSizeString(deps, sizeStr){
        const parsed = deps.parseSizeValue(sizeStr);
        return parsed ? normalizedPendingPreviewSize(deps, parsed) : null;
    }

    function defaultNodeSize(deps, type){
        if(type === 'shot-table') return {w:1120,h:390};
        if(type === 'clip') return {w:760,h:196};
        if(type === 'audio') return {w:330,h:0};
        if(type === 'image') return {w:260, h:336};
        if(type === 'prompt') return {w:310, h:0};
        if(type === 'loop') return {w:336, h:0};
        if(type === 'llm') return {w:420, h:590};
        if(type === 'generator') return {w:380, h:0};
        if(type === 'midjourney') return {w:380, h:0};
        if(type === 'msgen') return {w:380, h:0};
        if(type === 'video') return {w:400, h:0};
    
        if(type === 'rh') return {w:430, h:0};
        if(type === 'comfy') return {w:420, h:460};
    
        if(type === 'output') return {w:460, h:0};
        return {w:260, h:0};
    }

    const api={defaultApiImageResolution, normalizedImageQuality, parseRatioValue, gcdInt, ratioPartsFromDimensions, normalizeApiNodeSizeChoice, setCanvasGeneratorSizeFields, setCanvasMsSizeFields, generatorSizeForRun, normalizeApiNodeLayout, normalizedPendingPreviewSize, pendingPreviewSizeFromSizeString, defaultNodeSize};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.ClassicNodeParams=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
