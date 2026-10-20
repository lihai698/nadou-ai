/* Canvas parameter rules. Host supplies tables and model/media reads; no DOM. */
(function(root){
    'use strict';

    const SIZE_MAP = {
        square: { '1k':'1024x1024', '2k':'2048x2048', '4k':'4096x4096' },
        portrait: { '1k':'1024x1536', '2k':'1360x2048', '4k':'2352x3520' },
        portrait43: { '1k':'1008x1344', '2k':'1536x2048', '4k':'2448x3264' },
        landscape43: { '1k':'1344x1008', '2k':'2048x1536', '4k':'3264x2448' },
        landscape: { '1k':'1536x1024', '2k':'2048x1360', '4k':'3520x2352' },
        story: { '1k':'720x1280', '2k':'1152x2048', '4k':'2160x3840' },
        wide: { '1k':'1280x720', '2k':'2048x1152', '4k':'3840x2160' },
        ultrawide: { '1k':'1280x544', '2k':'2048x880', '4k':'3840x1648' },
        ultratall: { '1k':'544x1280', '2k':'880x2048', '4k':'1648x3840' }
    };
    const API_RATIO_VALUES = {
        square:'1:1',
        portrait:'2:3',
        landscape:'3:2',
        portrait43:'3:4',
        landscape43:'4:3',
        story:'9:16',
        wide:'16:9',
        ultrawide:'21:9',
        ultratall:'9:21'
    };
    const RES_LONG_SIDE = { '1k':1536, '2k':2048, '4k':3840 };
    const RES_PIXEL_LIMIT = { '1k':1572864, '2k':4194304, '4k':8294400 };

    function isGptImageAutoSizeModel(deps, model){
        const raw = String(model || '').trim().toLowerCase();
        const normalized = raw.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        const compact = raw.replace(/[^a-z0-9]+/g, '');
        return normalized === 'gpt-image-2'
            || normalized.startsWith('gpt-image-2-')
            || normalized.endsWith('-gpt-image-2')
            || normalized.includes('-gpt-image-2-')
            || compact === 'gptimage2'
            || compact.startsWith('gptimage2')
            || compact.endsWith('gptimage2');
    }

    function parseSizePair(deps, value){
        const match = String(value || '').match(/(\d+)\s*x\s*(\d+)/i);
        return match ? {width:Number(match[1]), height:Number(match[2])} : null;
    }

    function nearestFourKSizeFor(deps, width, height){
        const w = Math.max(1, Number(width) || 1);
        const h = Math.max(1, Number(height) || 1);
        const ratio = w / h;
        let best = null;
        Object.entries(SIZE_MAP).forEach(([key, values]) => {
            const size = parseSizePair(deps, values?.['4k']);
            if(!size) return;
            const score = Math.abs(Math.log(ratio / (size.width / size.height)));
            if(!best || score < best.score) best = {...size, key, score};
        });
        return best;
    }

    function exceedsFourKStandard(deps, width, height){
        const standard = nearestFourKSizeFor(deps, width, height);
        if(!standard) return false;
        return Number(width) > standard.width || Number(height) > standard.height;
    }

    function apiImageSize(deps, ratioValue, resolutionValue, customRatioValue = '', customSizeValue = ''){
        if(resolutionValue === 'auto') return 'auto';
        if(resolutionValue === 'custom') return String(customSizeValue || '').trim();
        const resolutionKey = resolutionValue || '1k';
        if(ratioValue === 'custom' || ratioValue === 'source'){
            const parsed = deps.parseRatioValue(customRatioValue);
            const longSide = RES_LONG_SIDE[resolutionKey] || 1024;
            if(parsed){
                const pixelLimit = RES_PIXEL_LIMIT[resolutionKey] || (longSide * longSide);
                const rawWidth = parsed >= 1 ? longSide : Math.min(longSide * parsed, Math.sqrt(pixelLimit * parsed));
                const rawHeight = parsed >= 1 ? Math.min(longSide / parsed, Math.sqrt(pixelLimit / parsed)) : longSide;
                const width = Math.floor(rawWidth / 16) * 16;
                const height = Math.floor(rawHeight / 16) * 16;
                return `${Math.max(64, width)}x${Math.max(64, height)}`;
            }
        }
        const ratioKey = ratioValue && SIZE_MAP[ratioValue] ? ratioValue : 'square';
        return SIZE_MAP[ratioKey]?.[resolutionKey] || SIZE_MAP.square[resolutionKey] || SIZE_MAP.square['1k'];
    }

    const api={SIZE_MAP, API_RATIO_VALUES, RES_LONG_SIDE, RES_PIXEL_LIMIT, isGptImageAutoSizeModel, parseSizePair, nearestFourKSizeFor, exceedsFourKStandard, apiImageSize};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.CanvasImageParams=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
