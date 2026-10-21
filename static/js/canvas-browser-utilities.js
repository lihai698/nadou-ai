/* Shared clipboard operations and HTTP error messages. Each caller supplies its live browser environment and callbacks. */
(function(root){
    'use strict';

function apiErrorMessage(deps, data, fallback='请求失败'){
    if(!data) return fallback;
    if(typeof data === 'string') return data || fallback;
    const detail = data.detail ?? data.error ?? data.message;
    if(typeof detail === 'string') return detail || fallback;
    if(Array.isArray(detail)){
        const messages = detail.map(item => {
            if(typeof item === 'string') return item;
            const loc = Array.isArray(item?.loc) ? item.loc.filter(x => x !== 'body').join('.') : '';
            const msg = item?.msg || item?.message || JSON.stringify(item);
            return loc ? `${loc}: ${msg}` : msg;
        }).filter(Boolean);
        return messages.join('\n') || fallback;
    }
    if(detail && typeof detail === 'object'){
        return detail.message || detail.msg || JSON.stringify(detail);
    }
    try {
        return JSON.stringify(data);
    } catch(e) {
        return fallback;
    }
}

async function responseErrorMessage(deps, response, fallback='请求失败'){
    try {
        const data = await response.clone().json();
        return deps.apiErrorMessage(data, fallback);
    } catch(e) {
        try {
            const text = await response.text();
            return text || fallback;
        } catch(_) {
            return fallback;
        }
    }
}

function copyTextWithCopyEvent(deps, value){
    let handled = false;
    const onCopy = event => {
        event.preventDefault();
        event.clipboardData?.setData('text/plain', value);
        handled = true;
    };
    deps.document.addEventListener('copy', onCopy);
    try {
        return deps.document.execCommand('copy') && handled;
    } catch(_) {
        return false;
    } finally {
        deps.document.removeEventListener('copy', onCopy);
    }
}

function copyTextWithTextarea(deps, value){
    let ta = null;
    try {
        ta = deps.document.createElement('textarea');
        ta.value = value;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        ta.style.top = '0';
        ta.style.opacity = '0';
        deps.document.body.appendChild(ta);
        ta.focus({preventScroll:true});
        ta.select();
        ta.setSelectionRange(0, ta.value.length);
        return deps.document.execCommand('copy');
    } catch(_) {
        return false;
    } finally {
        ta?.remove();
    }
}

async function clipboardMatchesText(deps, value){
    try {
        if(deps.navigator.clipboard?.readText && deps.window.isSecureContext){
            return (await deps.navigator.clipboard.readText()) === value;
        }
    } catch(_) {}
    return null;
}

async function copyTextToClipboard(deps, text){
    const value = String(text || '');
    if(!value) return false;
    if(deps.copyTextWithCopyEvent(value) || deps.copyTextWithTextarea(value)){
        const verified = await deps.clipboardMatchesText(value);
        return verified !== false;
    }
    try {
        if(deps.navigator.clipboard?.writeText && deps.window.isSecureContext !== false){
            await deps.navigator.clipboard.writeText(value);
            const verified = await deps.clipboardMatchesText(value);
            return verified !== false;
        }
    } catch(_) {}
    return false;
}

    const api={apiErrorMessage, responseErrorMessage, copyTextWithCopyEvent, copyTextWithTextarea, clipboardMatchesText, copyTextToClipboard};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.CanvasBrowserUtilities=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
