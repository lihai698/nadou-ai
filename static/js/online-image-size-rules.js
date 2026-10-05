// Pure size and ratio rules for the online image page.
(function attachOnlineImageSizeRules(global){
    'use strict';

    const SIZE_OPTIONS = {
        square: [
            ['1024x1024', '1k'],
            ['2048x2048', '2k'],
            ['3840x2160', '4k']
        ],
        portrait: [
            ['1024x1536', '1k'],
            ['1360x2048', '2k'],
            ['2352x3520', '4k']
        ],
        portrait43: [
            ['1008x1344', '1k'],
            ['1536x2048', '2k'],
            ['2448x3264', '4k']
        ],
        landscape43: [
            ['1344x1008', '1k'],
            ['2048x1536', '2k'],
            ['3264x2448', '4k']
        ],
        landscape: [
            ['1536x1024', '1k'],
            ['2048x1360', '2k'],
            ['3520x2352', '4k']
        ],
        story: [
            ['720x1280', '1k'],
            ['1152x2048', '2k'],
            ['2160x3840', '4k']
        ],
        wide: [
            ['1280x720', '1k'],
            ['2048x1152', '2k'],
            ['3840x2160', '4k']
        ]
    };
    const RES_LONG_SIDE = { '1k': 1536, '2k': 2048, '4k': 3840 };
    const RES_PIXEL_LIMIT = { '1k': 1572864, '2k': 4194304, '4k': 8294400 };

    function parseSizeValue(value){
        const match = String(value || '').trim().match(/^(\d+)\s*[xX*]\s*(\d+)$/);
        return match ? {width:match[1], height:match[2]} : null;
    }

    function customRatioValue(width, height){
        const w = Number(width);
        const h = Number(height);
        return w > 0 && h > 0 ? w / h : null;
    }

    function customSizeValue(width, height){
        const w = Number(width);
        const h = Number(height);
        return w > 0 && h > 0 ? `${Math.round(w)}x${Math.round(h)}` : '';
    }

    function currentSize({
        ratio = 'square',
        resolution = '1k',
        customRatioWidth = '',
        customRatioHeight = '',
        customWidth = '',
        customHeight = ''
    } = {}){
        if(resolution === 'custom') return customSizeValue(customWidth, customHeight);
        const options = SIZE_OPTIONS[ratio] || SIZE_OPTIONS.square;
        if(ratio === 'custom'){
            const parsed = customRatioValue(customRatioWidth, customRatioHeight);
            const longSide = RES_LONG_SIDE[resolution] || 1024;
            if(parsed){
                const pixelLimit = RES_PIXEL_LIMIT[resolution] || (longSide * longSide);
                const rawWidth = parsed >= 1 ? longSide : Math.min(longSide * parsed, Math.sqrt(pixelLimit * parsed));
                const rawHeight = parsed >= 1 ? Math.min(longSide / parsed, Math.sqrt(pixelLimit / parsed)) : longSide;
                const width = Math.floor(rawWidth / 16) * 16;
                const height = Math.floor(rawHeight / 16) * 16;
                return `${Math.max(64, width)}x${Math.max(64, height)}`;
            }
        }
        const match = options.find(([, label]) => label === resolution)
            || SIZE_OPTIONS.square.find(([, label]) => label === resolution)
            || SIZE_OPTIONS.square[0];
        return match[0];
    }

    const rules = Object.freeze({
        SIZE_OPTIONS,
        RES_LONG_SIDE,
        RES_PIXEL_LIMIT,
        parseSizeValue,
        customRatioValue,
        customSizeValue,
        currentSize,
    });
    global.OnlineImageSizeRules = rules;
    if(typeof module !== 'undefined' && module.exports) module.exports = rules;
})(typeof window !== 'undefined' ? window : globalThis);
