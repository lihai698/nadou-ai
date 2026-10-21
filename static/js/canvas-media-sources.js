/* Media source URLs and markup for both canvases. Host provides location and callbacks; this module owns no state or listeners. */
(function(root){
    'use strict';

function canvasOriginalMediaUrl(deps, url){
    const raw = String(url || '');
    if(!raw) return '';
    try {
        const parsed = new deps.URL(raw, deps.window.location.origin);
        if(parsed.pathname === '/api/media-preview'){
            const original = parsed.searchParams.get('url') || '';
            return original || raw;
        }
    } catch(e) {}
    return raw;
}

function canvasFileNameFromUrl(deps, url=''){
    try {
        const parsed = new deps.URL(String(url || ''), deps.window.location.href);
        return decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '');
    } catch(e) {
        return decodeURIComponent(String(url || '').split('?')[0].split('#')[0].split('/').filter(Boolean).pop() || '');
    }
}

function canvasProxiedMediaUrl(deps, url, name=''){
    const raw = deps.canvasOriginalMediaUrl(url);
    if(!raw || raw.startsWith('/assets/') || raw.startsWith('/output/') || raw.startsWith('data:') || raw.startsWith('blob:')) return raw;
    if(!/^https?:\/\//i.test(raw)) return raw;
    const filename = name || deps.canvasFileNameFromUrl(raw) || 'preview';
    return `/api/download-output?inline=1&url=${encodeURIComponent(raw)}&name=${encodeURIComponent(filename)}`;
}

function canvasDisplayMediaUrl(deps, url, name=''){
    const raw = deps.canvasOriginalMediaUrl(url);
    return /^https?:\/\//i.test(raw) ? deps.canvasProxiedMediaUrl(raw, name) : raw;
}

function canvasMediaPreviewUrl(deps, url, size=512){
    const raw = deps.canvasOriginalMediaUrl(url);
    if(!raw || raw.startsWith('data:') || raw.startsWith('blob:')) return raw;
    if(!raw.startsWith('/output/') && !raw.startsWith('/assets/')) return deps.canvasDisplayMediaUrl(raw);
    if(!/\.(png|jpe?g|webp|gif|bmp|avif|tiff?|mp4|webm|mov|m4v|avi|mkv|flv)(\?|#|$)/i.test(raw)) return raw;
    const width = Math.max(64, Math.min(2048, Math.round(Number(size) || 512)));
    return `/api/media-preview?w=${width}&url=${encodeURIComponent(raw)}`;
}

function canvasPreviewImgHtml(deps, url, size=512, attrs=''){
    const original = deps.canvasOriginalMediaUrl(url);
    const preview = deps.canvasMediaPreviewUrl(original, size);
    // loading=lazy：画布内容多时，视口外的缩略图不加载/不解码，避免一次性解码上百张图卡顿；
    // decoding=async：解码放到主线程外，渲染时不阻塞。
    return `<img loading="lazy" decoding="async" src="${deps.escapeAttr(preview)}" data-preview-src="${deps.escapeAttr(preview)}" data-original-src="${deps.escapeAttr(original)}" data-url="${deps.escapeAttr(original)}"${attrs ? ` ${attrs}` : ''}>`;
}

function canvasVideoPreviewHtml(deps, url, size=512, attrs=''){
    const original = deps.canvasOriginalMediaUrl(url);
    const preview = deps.canvasMediaPreviewUrl(original, size);
    return `<img loading="lazy" decoding="async" src="${deps.escapeAttr(preview)}" data-preview-src="${deps.escapeAttr(preview)}" data-original-src="${deps.escapeAttr(original)}" data-url="${deps.escapeAttr(original)}" data-preview-kind="video"${attrs ? ` ${attrs}` : ''}>`;
}

function canvasVideoFallbackHtml(deps, url, attrs=''){
    const original = deps.canvasOriginalMediaUrl(url);
    const src = deps.canvasDisplayMediaUrl(original);
    return `<video src="${deps.escapeAttr(src)}" data-url="${deps.escapeAttr(original)}" muted preload="metadata" playsinline disablepictureinpicture controlslist="nodownload noplaybackrate noremoteplayback"${attrs ? ` ${attrs}` : ''}></video>`;
}

function canvasVideoPlayerHtml(deps, url, attrs=''){
    const original = deps.canvasOriginalMediaUrl(url);
    const src = deps.canvasDisplayMediaUrl(original);
    return `<video src="${deps.escapeAttr(src)}" data-url="${deps.escapeAttr(original)}" controls autoplay playsinline preload="metadata" disablepictureinpicture controlslist="nodownload noplaybackrate noremoteplayback"${attrs ? ` ${attrs}` : ''}></video>`;
}

function smartOriginalMediaUrl(deps, itemOrUrl){
    const raw = typeof itemOrUrl === 'string' ? itemOrUrl : (itemOrUrl?.url || '');
    const text = String(raw || '');
    if(!text) return '';
    try {
        const parsed = new deps.URL(text, deps.window.location.origin);
        if(parsed.pathname === '/api/media-preview'){
            const original = parsed.searchParams.get('url') || '';
            return original || text;
        }
    } catch(e) {}
    return text;
}

function fileNameFromUrl(deps, url=''){
    try {
        const parsed = new deps.URL(String(url || ''), deps.window.location.href);
        return decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '');
    } catch(e) {
        return decodeURIComponent(String(url || '').split('?')[0].split('#')[0].split('/').filter(Boolean).pop() || '');
    }
}

function proxiedMediaUrl(deps, itemOrUrl, name=''){
    const url = deps.smartOriginalMediaUrl(itemOrUrl);
    if(!url || String(url).startsWith('/assets/') || String(url).startsWith('/output/') || String(url).startsWith('data:') || String(url).startsWith('blob:')) return url;
    const filename = name || (typeof itemOrUrl === 'object' ? (itemOrUrl.name || '') : '') || deps.fileNameFromUrl(url) || 'preview';
    return `/api/download-output?inline=1&url=${encodeURIComponent(url)}&name=${encodeURIComponent(filename)}`;
}

function displayMediaUrl(deps, itemOrUrl, name=''){
    const url = deps.smartOriginalMediaUrl(itemOrUrl);
    if(/^https?:\/\//i.test(String(url || ''))) return deps.proxiedMediaUrl(itemOrUrl, name);
    return url;
}

function smartMediaPreviewUrl(deps, itemOrUrl, size=512){
    const raw = deps.smartOriginalMediaUrl(itemOrUrl);
    const displayItem = typeof itemOrUrl === 'object' && itemOrUrl ? {...itemOrUrl, url:raw} : raw;
    const displayUrl = deps.displayMediaUrl(displayItem);
    if(!raw || raw.startsWith('data:') || raw.startsWith('blob:')) return displayUrl;
    if(!raw.startsWith('/output/') && !raw.startsWith('/assets/')) return displayUrl;
    if(!/\.(png|jpe?g|webp|gif|bmp|avif|tiff?|mp4|webm|mov|m4v|avi|mkv)(\?|#|$)/i.test(raw)) return displayUrl;
    const width = Math.max(64, Math.min(2048, Math.round(Number(size) || 512)));
    return `/api/media-preview?w=${width}&url=${encodeURIComponent(raw)}`;
}

function smartPreviewImgHtml(deps, itemOrUrl, size=512, attrs=''){
    const original = deps.smartOriginalMediaUrl(itemOrUrl);
    const preview = deps.smartMediaPreviewUrl(itemOrUrl, size);
    return `<img src="${deps.escapeHtml(preview)}" data-preview-src="${deps.escapeAttr(preview)}" data-original-src="${deps.escapeAttr(original)}"${attrs ? ` ${attrs}` : ''}>`;
}

function smartVideoPreviewHtml(deps, itemOrUrl, size=512, attrs=''){
    const original = deps.smartOriginalMediaUrl(itemOrUrl);
    const preview = deps.smartMediaPreviewUrl(itemOrUrl, size);
    return `<img src="${deps.escapeHtml(preview)}" data-preview-src="${deps.escapeAttr(preview)}" data-original-src="${deps.escapeAttr(original)}" data-url="${deps.escapeAttr(original)}" data-preview-kind="video"${attrs ? ` ${attrs}` : ''}>`;
}

function smartVideoFallbackHtml(deps, url, attrs=''){
    const original = deps.smartOriginalMediaUrl(url);
    const src = deps.displayMediaUrl({url:original});
    return `<video src="${deps.escapeHtml(src)}" data-url="${deps.escapeAttr(original)}" muted preload="metadata" playsinline disablepictureinpicture controlslist="nodownload noplaybackrate noremoteplayback"${attrs ? ` ${attrs}` : ''}></video>`;
}

function smartVideoPlayerHtml(deps, url, attrs=''){
    const original = deps.smartOriginalMediaUrl(url);
    const safe = deps.escapeHtml(deps.displayMediaUrl({url:original}));
    return `<video src="${safe}" data-url="${deps.escapeAttr(original)}" data-inline-video-active="1" controls autoplay playsinline preload="metadata" disablepictureinpicture controlslist="nodownload noplaybackrate noremoteplayback"${attrs ? ` ${attrs}` : ''}></video>`;
}

    const api={canvasOriginalMediaUrl, canvasFileNameFromUrl, canvasProxiedMediaUrl, canvasDisplayMediaUrl, canvasMediaPreviewUrl, canvasPreviewImgHtml, canvasVideoPreviewHtml, canvasVideoFallbackHtml, canvasVideoPlayerHtml, smartOriginalMediaUrl, fileNameFromUrl, proxiedMediaUrl, displayMediaUrl, smartMediaPreviewUrl, smartPreviewImgHtml, smartVideoPreviewHtml, smartVideoFallbackHtml, smartVideoPlayerHtml};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.CanvasMediaSources=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
