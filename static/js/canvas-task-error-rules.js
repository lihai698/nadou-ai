// 画布任务错误文本规则；不读取 DOM、配置、浏览器存储或网络。
(function attachCanvasTaskErrorRules(global){
    'use strict';

    function normalizeErrorMessage(error, {fallback = '', restartMessage = ''} = {}){
        const raw = error?.message || String(error || '');
        const text = String(raw || '').trim();
        if(!text) return fallback || '';
        if(/backend restarted and task status was lost/i.test(text)) return restartMessage || text;
        if(/(404|not found|missing)/i.test(text) && /canvas-image-task/i.test(text)) return restartMessage || text;
        if(/Failed to fetch|NetworkError|Load failed|ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET/i.test(text)) return restartMessage || text;
        return text;
    }

    const rules = Object.freeze({normalizeErrorMessage});
    global.CanvasTaskErrorRules = rules;
    if(typeof module !== 'undefined' && module.exports) module.exports = rules;
})(typeof window !== 'undefined' ? window : globalThis);
