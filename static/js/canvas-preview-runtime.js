/* Classic canvas preview state, image probes and transient DOM media handlers. */
(function(root){
    'use strict';
function create(deps){
const CANVAS_SELECTED_HIGH_RES_DELAY = 320;

const CANVAS_HIGH_RES_ZOOM_THRESHOLD = 0.86;

let canvasSelectedHighResTimer = 0;

let canvasSelectedHighResSeq = 0;

let canvasImageResolutionSyncTimer = 0;

const canvasSelectedHighResLoaded = new Set();

const canvasSelectedHighResLoading = new Map();

function loadCanvasOriginalImageDimensions(url){
    const src = String(url || '');
    if(!src || /^data:/i.test(src) || /^blob:/i.test(src)) return Promise.resolve(null);
    return new Promise(resolve => {
        const img = new deps.Image();
        img.onload = () => resolve(img.naturalWidth && img.naturalHeight ? {w:img.naturalWidth, h:img.naturalHeight} : null);
        img.onerror = () => resolve(null);
        img.src = src;
    });
}

function canvasActivateVideoPreview(img){
    if(!img) return false;
    const target = img.matches?.('img[data-preview-kind="video"]') ? img : img.querySelector?.('img[data-preview-kind="video"]');
    if(!target) {
        const fallback = img.matches?.('video[data-url]') ? img : img.querySelector?.('video[data-url]');
        if(fallback){
            fallback.controls = true;
            fallback.muted = false;
            fallback.play?.().catch(() => {});
            return true;
        }
        return false;
    }
    const original = deps.canvasOriginalMediaUrl(target.dataset.originalSrc || target.dataset.url || target.getAttribute('src') || '');
    if(!original) return false;
    const tpl = deps.document.createElement('template');
    tpl.innerHTML = deps.canvasVideoPlayerHtml(original, target.dataset.videoPlayerAttrs || '');
    const video = tpl.content.firstElementChild;
    if(!video) return false;
    target.replaceWith(video);
    video.parentElement?.querySelector?.('.canvas-video-play')?.style?.setProperty('display', 'none');
    video.play?.().catch(() => {});
    return true;
}

function isCanvasPreviewImage(img){
    return img?.tagName?.toLowerCase?.() === 'img'
        && img.dataset?.previewSrc
        && img.dataset?.originalSrc
        && img.dataset.previewSrc !== img.dataset.originalSrc
        && img.getAttribute('src') !== img.dataset.originalSrc;
}

function bindCanvasPreviewImageFallbacks(root=deps.document){
    root.querySelectorAll?.('img[data-preview-src][data-original-src]:not([data-preview-fallback-bound])').forEach(img => {
        img.dataset.previewFallbackBound = '1';
        const fallback = () => {
            if(!img.parentElement) return;
            const original = img.dataset.originalSrc || img.dataset.url || '';
            if(img.dataset.previewKind === 'video'){
                const video = deps.document.createElement('template');
                video.innerHTML = deps.canvasVideoFallbackHtml(original, img.dataset.videoFallbackAttrs || '');
                img.replaceWith(video.content.firstElementChild);
                return;
            }
            if(original && img.getAttribute('src') !== original) img.src = original;
        };
        img.addEventListener('error', fallback);
        // 动态输入列表可能在绑定前就收到预览接口的错误响应。
        if(img.complete && !img.naturalWidth) fallback();
    });
}

function canvasImageEditorIsOpen(){
    return Boolean(deps.document.getElementById('imageEditModal')?.classList.contains('open'));
}

function preloadCanvasSelectedHighRes(src){
    if(!src || canvasSelectedHighResLoaded.has(src)) return Promise.resolve(true);
    if(canvasSelectedHighResLoading.has(src)) return canvasSelectedHighResLoading.get(src);
    const task = new Promise(resolve => {
        const img = new deps.Image();
        img.decoding = 'async';
        img.onload = async () => {
            try { if(img.decode) await img.decode(); } catch(e) {}
            canvasSelectedHighResLoaded.add(src);
            resolve(true);
        };
        img.onerror = () => resolve(false);
        img.src = src;
    }).finally(() => canvasSelectedHighResLoading.delete(src));
    canvasSelectedHighResLoading.set(src, task);
    return task;
}

function canvasViewportWantsHighRes(){
    return Number(deps.viewport?.scale || 1) >= CANVAS_HIGH_RES_ZOOM_THRESHOLD;
}

function canvasImageNearViewport(img){
    if(!img?.isConnected || !deps.board) return false;
    const boardRect = deps.board.getBoundingClientRect();
    const rect = img.getBoundingClientRect();
    const margin = 220;
    return rect.right >= boardRect.left - margin && rect.left <= boardRect.right + margin
        && rect.bottom >= boardRect.top - margin && rect.top <= boardRect.bottom + margin;
}

function syncCanvasSelectedImageResolution(root=deps.nodesEl){
    const selectedImages = [];
    const wantHighRes = deps.canvasViewportWantsHighRes();
    root.querySelectorAll?.('.node img[data-preview-src][data-original-src]').forEach(img => {
        if(img.dataset.previewKind === 'video') return;
        const preview = img.dataset.previewSrc || '';
        const original = img.dataset.originalSrc || img.dataset.url || '';
        if(!wantHighRes || !deps.canvasImageNearViewport(img)){
            delete img.dataset.selectedHighResTarget;
            if(preview && img.getAttribute('src') !== preview) img.src = preview;
            return;
        }
        const target = deps.canvasDisplayMediaUrl(original);
        if(!target) return;
        img.dataset.selectedHighResTarget = target;
        if(canvasSelectedHighResLoaded.has(target)){
            if(img.getAttribute('src') !== target) img.src = target;
            return;
        }
        if(preview && img.getAttribute('src') !== preview) img.src = preview;
        selectedImages.push({img, target});
    });
    if(canvasSelectedHighResTimer) deps.clearTimeout(canvasSelectedHighResTimer);
    const seq = ++canvasSelectedHighResSeq;
    if(!selectedImages.length || deps.canvasImageEditorIsOpen()) return;
    canvasSelectedHighResTimer = deps.setTimeout(async () => {
        canvasSelectedHighResTimer = 0;
        if(seq !== canvasSelectedHighResSeq || deps.canvasImageEditorIsOpen()) return;
        await Promise.all(selectedImages.map(item => deps.preloadCanvasSelectedHighRes(item.target)));
        if(seq !== canvasSelectedHighResSeq || deps.canvasImageEditorIsOpen()) return;
        selectedImages.forEach(({img, target}) => {
            if(!img.isConnected || img.dataset.selectedHighResTarget !== target) return;
            if(!deps.canvasViewportWantsHighRes() || !deps.canvasImageNearViewport(img)) return;
            if(canvasSelectedHighResLoaded.has(target) && img.getAttribute('src') !== target) img.src = target;
        });
    }, CANVAS_SELECTED_HIGH_RES_DELAY);
}

function scheduleCanvasImageResolutionSync(root=deps.nodesEl, delay=120){
    if(canvasImageResolutionSyncTimer) deps.clearTimeout(canvasImageResolutionSyncTimer);
    canvasImageResolutionSyncTimer = deps.setTimeout(() => {
        canvasImageResolutionSyncTimer = 0;
        deps.syncCanvasSelectedImageResolution(root);
    }, Math.max(0, Number(delay) || 0));
}

function suspend(){
    if(canvasSelectedHighResTimer) deps.clearTimeout(canvasSelectedHighResTimer);
    if(canvasImageResolutionSyncTimer) deps.clearTimeout(canvasImageResolutionSyncTimer);
    canvasSelectedHighResTimer=0;canvasImageResolutionSyncTimer=0;canvasSelectedHighResSeq++;
}
    return {loadCanvasOriginalImageDimensions, canvasActivateVideoPreview, isCanvasPreviewImage, bindCanvasPreviewImageFallbacks, canvasImageEditorIsOpen, preloadCanvasSelectedHighRes, canvasViewportWantsHighRes, canvasImageNearViewport, syncCanvasSelectedImageResolution, scheduleCanvasImageResolutionSync, suspend};
}
const api={create};
if(typeof module!=='undefined' && module.exports) module.exports=api;
root.CanvasPreviewRuntime=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
