// GPT 对话页的纯尺寸规则，不读取 DOM、配置、浏览器存储或网络。
(function attachGptChatResolutionRules(global){
    'use strict';

    const SIZE_OPTIONS = {
        square: [['1024x1024', '1k'], ['1536x1536', '2k'], ['2048x2048', '4k']],
        portrait: [['720x1080', '1k'], ['1024x1536', '2k'], ['1365x2048', '4k']],
        portrait43: [['1008x1344', '1k'], ['1536x2048', '2k'], ['2448x3264', '4k']],
        landscape43: [['1344x1008', '1k'], ['2048x1536', '2k'], ['3264x2448', '4k']],
        landscape: [['1080x720', '1k'], ['1536x1024', '2k'], ['2048x1365', '4k']],
        story: [['720x1280', '1k'], ['1080x1920', '2k'], ['1440x2560', '4k']],
        wide: [['1280x720', '1k'], ['1920x1080', '2k'], ['2560x1440', '4k']]
    };
    const CHAT_RATIO_VALUES = {
        square: '1:1',
        portrait: '2:3',
        landscape: '3:2',
        portrait43: '3:4',
        landscape43: '4:3',
        story: '9:16',
        wide: '16:9'
    };
    const VALID_RESOLUTIONS = ['auto', '1k', '2k', '4k', 'custom'];
    const RATIO_KEYS = Object.freeze({
        '1:1': 'square',
        '2:3': 'portrait',
        '3:2': 'landscape',
        '3:4': 'portrait43',
        '4:3': 'landscape43',
        '9:16': 'story',
        '16:9': 'wide'
    });

    function normalizeCustomSize(value){
        const match = String(value || '').trim().match(/^([1-9]\d{2,3})\s*[xX×*]\s*([1-9]\d{2,3})$/);
        if(!match) return '';
        const width = Math.round(Number(match[1]));
        const height = Math.round(Number(match[2]));
        if(width < 256 || height < 256 || width > 8192 || height > 8192) return '';
        return `${width}x${height}`;
    }

    function sizeForResolution({ratio = 'square', resolution = 'auto', customSize = ''} = {}){
        if(resolution === 'auto') return '1024x1024';
        if(resolution === 'custom') return normalizeCustomSize(customSize) || '1024x1024';
        const options = SIZE_OPTIONS[ratio] || SIZE_OPTIONS.square;
        const match = options.find(([, label]) => label === resolution) || options[0];
        return match[0];
    }

    function edgeOf(value){
        return Math.max(...String(value || '').split(/[xX×*]/).map(item => Number(item) || 0));
    }

    function resolutionForRequest({message = '', requestedSize = '', resolution = 'auto'} = {}){
        if(['1k', '2k', '4k'].includes(resolution)) return resolution;
        const text = String(message || '');
        if(/4\s*k|4K|超清|超高分辨率/i.test(text)) return '4k';
        if(/2\s*k|2K|高清|高分辨率/i.test(text)) return '2k';
        const edge = edgeOf(requestedSize);
        if(edge >= 2800) return '4k';
        if(edge >= 1600) return '2k';
        return '1k';
    }

    function sizeFromPrompt({message = '', fallbackSize = '1024x1024', resolution = 'auto'} = {}){
        const text = String(message || '');
        const direct = text.match(/(^|[^\d])([1-9]\d{2,4})\s*[xX×*]\s*([1-9]\d{2,4})(?!\d)/);
        if(direct){
            const width = Number(direct[2]);
            const height = Number(direct[3]);
            if(width >= 256 && height >= 256) return `${width}x${height}`;
        }
        const normalized = text.replace(/[：﹕∶]/g, ':').replace(/比/g, ':').replace(/[／/]/g, ':');
        const match = normalized.match(/(^|[^\d])(1|2|3|4|9|16)\s*:\s*(1|2|3|4|9|16)(?!\d)/);
        if(!match) return fallbackSize;
        const ratio = `${Number(match[2])}:${Number(match[3])}`;
        const ratioKey = RATIO_KEYS[ratio];
        if(!ratioKey) return fallbackSize;
        const wants4k = /4\s*k|4K|超清|超高分辨率/i.test(text);
        const wants2k = /2\s*k|2K|高清|高分辨率/i.test(text);
        if(resolution === 'custom' && !wants4k && !wants2k) return fallbackSize;
        const fallbackEdge = edgeOf(fallbackSize);
        const targetLabel = wants4k
            ? '4k'
            : (wants2k
                ? '2k'
                : (resolution === 'auto' ? '1k' : (fallbackEdge >= 2400 ? '4k' : (fallbackEdge >= 1500 ? '2k' : '1k'))));
        return (SIZE_OPTIONS[ratioKey] || SIZE_OPTIONS.square)
            .find(([, label]) => label === targetLabel)?.[0] || fallbackSize;
    }

    const rules = Object.freeze({
        SIZE_OPTIONS,
        CHAT_RATIO_VALUES,
        VALID_RESOLUTIONS,
        normalizeCustomSize,
        sizeForResolution,
        resolutionForRequest,
        sizeFromPrompt,
    });
    global.GptChatResolutionRules = rules;
    if(typeof module !== 'undefined' && module.exports) module.exports = rules;
})(typeof window !== 'undefined' ? window : globalThis);
