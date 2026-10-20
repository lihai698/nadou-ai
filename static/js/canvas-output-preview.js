/* Classic output view responsibility: canvas-output-preview. Host supplies live state and effects. */
(function(root){
    'use strict';

function outputCompareUrlFor(deps, url, out){
    const source = out?.imageComparisons?.[url];
    if(typeof source === 'string' && source) return source;
    if(source?.url) return source.url;
    const meta = deps.outputMetaFor(url, out);
    return meta?.run?.refs?.find(ref => ref?.url)?.url || '';
}

function markOutputViewed(deps, out, url){
    if(!out || !url || !(out.images || []).length) return;
    let changed = false;
    out.images = out.images.map(item => {
        if(typeof item === 'string') return item;
        if(item?.url === url && !item.viewed){
            changed = true;
            return {...item, viewed:true};
        }
        return item;
    });
    if(changed){
        deps.render();
        deps.scheduleSave();
    }
}

function outputLightboxItems(deps, out=null){
    const normalize = (item, sourceOut=null) => {
        const url = deps.outputUrlValue(item);
        if(!url || deps.mediaKindForOutputItem(item) !== 'image') return null;
        return {url, outId:sourceOut?.id || ''};
    };
    const sourceOut = out?.id ? deps.nodes.find(n => n.id === out.id) || out : null;
    if(sourceOut){
        if(sourceOut.type === 'group') return deps.groupImageItems(sourceOut).map(item => normalize(item, sourceOut)).filter(Boolean);
        if(sourceOut.type === 'image' && sourceOut.url) return [normalize({url:sourceOut.url, kind:deps.mediaKindForNode(sourceOut)}, sourceOut)].filter(Boolean);
        return (sourceOut.images || []).map(item => normalize(item, sourceOut)).filter(Boolean);
    }
    const outputNodeItems = deps.nodes
        .filter(n => n.type === 'output')
        .flatMap(n => (n.images || []).map(item => normalize(item, n)).filter(Boolean));
    if(outputNodeItems.length) return outputNodeItems;
    return (deps.canvas?.logs || [])
        .flatMap(log => (log.outputs || []).map(url => normalize(url, null)).filter(Boolean));
}

function openGroupLightbox(deps, groupId, index=0){
    const group = deps.nodes.find(n => n.id === groupId);
    const items = deps.groupImageItems(group);
    if(!items.length) return;
    const item = items[Math.max(0, Math.min(items.length - 1, index))] || items[0];
    openOutputLightbox(deps, item.url, group);
}

function navigateOutputLightbox(deps, direction){
    if(!deps.outputLightbox.classList.contains('open') || !deps.currentOutputLightboxUrl) return false;
    const out = deps.currentOutputLightboxOutId ? deps.nodes.find(n => n.id === deps.currentOutputLightboxOutId) : null;
    const items = outputLightboxItems(deps, out);
    if(items.length < 2) return false;
    let idx = items.findIndex(item => item.url === deps.currentOutputLightboxUrl);
    if(idx < 0) idx = 0;
    const next = items[(idx + direction + items.length) % items.length];
    const nextOut = next.outId ? deps.nodes.find(n => n.id === next.outId) : null;
    openOutputLightbox(deps, next.url, nextOut);
    return true;
}

function setOutputCompareMode(deps, active){
    deps.outputPreview.classList.toggle('compare-mode', active);
    if(active){
        deps.outputCompareOriginalWrap.style.clipPath = 'inset(0 50% 0 0)';
        deps.outputCompareSlider.style.left = '50%';
    }
}

function outputResolutionText(deps, text, meta=null){
    const parts = [text || '--'];
    if(meta?.runMs) parts.push(`<span>${deps.formatRunDuration(meta.runMs)}</span>`);
    deps.outputResolution.innerHTML = parts.join('<span style="opacity:.38">|</span>');
}

function setupOutputPromptPanel(deps, meta){
    deps.currentOutputMeta = meta || null;
    const prompt = meta?.run?.prompt || '';
    deps.outputPromptPanel.classList.toggle('open', !!prompt || !!meta?.run);
    deps.outputPromptText.textContent = prompt || deps.tr('canvas.noPromptMeta');
    deps.outputCopyPromptBtn.onclick = e => {
        e.stopPropagation();
        if(!prompt) return;
        deps.copyTextToClipboard(prompt);
        const span = deps.outputCopyPromptBtn.querySelector('span');
        const oldText = span?.textContent || deps.tr('canvas.copyPrompt');
        deps.outputCopyPromptBtn.classList.add('copied');
        if(span) span.textContent = deps.tr('canvas.copied');
        deps.clearTimeout(deps.outputCopyPromptBtn._copyTimer);
        deps.outputCopyPromptBtn._copyTimer = deps.setTimeout(() => {
            deps.outputCopyPromptBtn.classList.remove('copied');
            if(span) span.textContent = oldText;
        }, 1200);
    };
    deps.outputRerunBtn.onclick = e => {
        e.stopPropagation();
        deps.rerunFromOutputMeta(deps.currentOutputMeta);
    };
}

function updateOutputCompareSlider(deps, clientX){
    const rect = deps.outputCompareContainer.getBoundingClientRect();
    if(!rect.width) return;
    const percent = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    deps.outputCompareOriginalWrap.style.clipPath = `inset(0 ${100 - percent}% 0 0)`;
    deps.outputCompareSlider.style.left = `${percent}%`;
}

function applyOutputPreviewZoom(deps){
    const transform = `translate(${deps.outputPreviewPan.x}px, ${deps.outputPreviewPan.y}px) scale(${deps.outputPreviewZoom})`;
    [deps.outputLightboxImg, deps.outputCompareResult, deps.outputCompareOriginal].forEach(img => {
        img.style.transform = transform;
        img.style.transformOrigin = '0 0';
    });
    deps.outputPreview.classList.toggle('zoomed', deps.outputPreviewZoom > 1.001);
}

function resetOutputPreviewZoom(deps){
    deps.outputPreviewZoom = 1;
    deps.outputPreviewPan = {x: 0, y: 0};
    deps.outputPreviewPanDrag = null;
    deps.outputPreview.classList.remove('panning');
    applyOutputPreviewZoom(deps);
}

function initOutputPreviewZoomEvents(deps){
    deps.outputPreview.addEventListener('wheel', e => {
        if(deps.outputLightboxVideo.style.display === 'block') return;
        e.preventDefault();
        e.stopPropagation();
        const rect = deps.outputPreview.getBoundingClientRect();
        const localX = e.clientX - rect.left;
        const localY = e.clientY - rect.top;
        const before = {
            x:(localX - deps.outputPreviewPan.x) / deps.outputPreviewZoom,
            y:(localY - deps.outputPreviewPan.y) / deps.outputPreviewZoom
        };
        const factor = e.deltaY > 0 ? .9 : 1.1;
        const nextZoom = Math.max(1, Math.min(6, deps.outputPreviewZoom * factor));
        deps.outputPreviewZoom = nextZoom;
        deps.outputPreviewPan = nextZoom <= 1.001 ? {x: 0, y: 0} : {
            x:localX - before.x * nextZoom,
            y:localY - before.y * nextZoom
        };
        applyOutputPreviewZoom(deps);
    }, {passive:false});
    deps.outputPreview.addEventListener('mousedown', e => {
        if(deps.outputLightboxVideo.style.display === 'block') return;
        if(e.button !== 0 || deps.outputPreviewZoom <= 1.001) return;
        if(e.target.closest('.output-preview-actions, .output-resolution, .output-compare-slider')) return;
        deps.outputPreviewPanDrag = {
            sx:e.clientX,
            sy:e.clientY,
            ox:deps.outputPreviewPan.x,
            oy:deps.outputPreviewPan.y
        };
        deps.outputPreview.classList.add('panning');
        e.preventDefault();
        e.stopPropagation();
    });
    deps.window.addEventListener('mousemove', e => {
        if(!deps.outputPreviewPanDrag) return;
        deps.outputPreviewPan = {
            x:deps.outputPreviewPanDrag.ox + e.clientX - deps.outputPreviewPanDrag.sx,
            y:deps.outputPreviewPanDrag.oy + e.clientY - deps.outputPreviewPanDrag.sy
        };
        applyOutputPreviewZoom(deps);
    });
    deps.window.addEventListener('mouseup', () => {
        deps.outputPreviewPanDrag = null;
        deps.outputPreview.classList.remove('panning');
    });
}

function initOutputCompareEvents(deps){
    deps.outputCompareContainer.addEventListener('mousedown', e => {
        deps.outputCompareDrag = true;
        updateOutputCompareSlider(deps, e.clientX);
        e.preventDefault();
        e.stopPropagation();
    });
    deps.outputCompareSlider.addEventListener('mousedown', e => {
        deps.outputCompareDrag = true;
        e.preventDefault();
        e.stopPropagation();
    });
    deps.window.addEventListener('mousemove', e => {
        if(deps.outputCompareDrag) updateOutputCompareSlider(deps, e.clientX);
    });
    deps.window.addEventListener('mouseup', () => { deps.outputCompareDrag = false; });
    deps.outputCompareContainer.addEventListener('touchstart', e => {
        deps.outputCompareDrag = true;
        updateOutputCompareSlider(deps, e.touches[0].clientX);
        e.preventDefault();
        e.stopPropagation();
    }, {passive:false});
    deps.window.addEventListener('touchmove', e => {
        if(deps.outputCompareDrag) {
            updateOutputCompareSlider(deps, e.touches[0].clientX);
            e.preventDefault();
        }
    }, {passive:false});
    deps.window.addEventListener('touchend', () => { deps.outputCompareDrag = false; });
}

function openOutputLightbox(deps, url, out){
    if(!url) return;
    resetOutputPreviewZoom(deps);
    deps.currentOutputLightboxOutId = out?.id || '';
    deps.currentOutputLightboxUrl = url;
    const meta = deps.outputMetaFor(url, out);
    markOutputViewed(deps, out, url);
    setupOutputPromptPanel(deps, meta);
    outputResolutionText(deps, '--', meta);
    deps.currentOutputCompareUrl = outputCompareUrlFor(deps, url, out);
    setOutputCompareMode(deps, false);
    const groupDownloadItems = out?.type === 'group' ? deps.groupImageItems(out) : [];
    if(deps.outputDownloadAllBtn){
        deps.outputDownloadAllBtn.style.display = groupDownloadItems.length > 1 ? 'flex' : 'none';
        deps.outputDownloadAllBtn.onclick = e => {
            e.stopPropagation();
            if(deps.currentOutputLightboxOutId) deps.downloadGroupNodeImages(deps.currentOutputLightboxOutId);
        };
    }
    const videoMode = deps.mediaKindForOutputItem(meta && Object.keys(meta).length ? {...meta, url} : url) === 'video';
    deps.outputLightboxImg.style.display = videoMode ? 'none' : 'block';
    deps.outputLightboxVideo.style.display = videoMode ? 'block' : 'none';
    deps.outputCompareResult.style.display = videoMode ? 'none' : 'block';
    deps.outputCompareOriginal.style.display = videoMode ? 'none' : 'block';
    if(videoMode){
        deps.outputLightboxImg.src = '';
        deps.outputCompareResult.src = '';
        deps.outputCompareOriginal.src = '';
        deps.outputLightboxVideo.onloadedmetadata = () => {
            outputResolutionText(deps, deps.outputLightboxVideo.videoWidth && deps.outputLightboxVideo.videoHeight
                ? `${deps.outputLightboxVideo.videoWidth} x ${deps.outputLightboxVideo.videoHeight}`
                : 'Video', meta);
        };
        deps.outputLightboxVideo.src = deps.canvasDisplayMediaUrl(url, deps.outputDownloadName(url));
        deps.outputPreview.ondblclick = null;
        deps.outputDownloadBtn.onclick = e => {
            e.stopPropagation();
            deps.downloadUrl(url, deps.outputDownloadName(url)).catch(err => deps.alert(err.message || '下载失败'));
        };
        deps.outputLightbox.classList.add('open');
        deps.refreshIcons();
        return;
    }
    deps.outputLightboxVideo.pause();
    deps.outputLightboxVideo.src = '';
    deps.outputLightboxImg.draggable = false;
    deps.outputCompareResult.draggable = false;
    deps.outputCompareOriginal.draggable = false;
    deps.outputLightboxImg.onload = () => {
        outputResolutionText(deps, `${deps.outputLightboxImg.naturalWidth} x ${deps.outputLightboxImg.naturalHeight}`, meta);
    };
    deps.outputLightboxImg.src = deps.canvasDisplayMediaUrl(url, deps.outputDownloadName(url));
    deps.outputCompareResult.src = deps.canvasDisplayMediaUrl(url, deps.outputDownloadName(url));
    deps.outputCompareOriginal.src = deps.currentOutputCompareUrl ? deps.canvasDisplayMediaUrl(deps.currentOutputCompareUrl, deps.outputDownloadName(deps.currentOutputCompareUrl)) : '';
    deps.outputPreview.ondblclick = e => {
        e.stopPropagation();
        if(!deps.currentOutputCompareUrl) return;
        setOutputCompareMode(deps, !deps.outputPreview.classList.contains('compare-mode'));
    };
    deps.outputDownloadBtn.onclick = e => {
        e.stopPropagation();
        deps.downloadUrl(url, deps.outputDownloadName(url)).catch(err => deps.alert(err.message || '下载失败'));
    };
    deps.outputLightbox.classList.add('open');
    deps.refreshIcons();
}

function closeOutputLightbox(deps){
    deps.outputLightbox.classList.remove('open');
    setOutputCompareMode(deps, false);
    deps.outputLightboxImg.src = '';
    deps.outputLightboxVideo.pause();
    deps.outputLightboxVideo.src = '';
    deps.outputLightboxVideo.style.display = 'none';
    deps.outputLightboxImg.style.display = 'block';
    deps.outputCompareResult.style.display = 'block';
    deps.outputCompareOriginal.style.display = 'block';
    deps.outputCompareResult.src = '';
    deps.outputCompareOriginal.src = '';
    deps.outputPreview.ondblclick = null;
    if(deps.outputDownloadAllBtn){
        deps.outputDownloadAllBtn.style.display = 'none';
        deps.outputDownloadAllBtn.onclick = null;
    }
    resetOutputPreviewZoom(deps);
    deps.currentOutputCompareUrl = '';
    deps.currentOutputMeta = null;
    deps.currentOutputLightboxOutId = '';
    deps.currentOutputLightboxUrl = '';
    setupOutputPromptPanel(deps, null);
}

    const api={outputCompareUrlFor, markOutputViewed, outputLightboxItems, openGroupLightbox, navigateOutputLightbox, setOutputCompareMode, outputResolutionText, setupOutputPromptPanel, updateOutputCompareSlider, applyOutputPreviewZoom, resetOutputPreviewZoom, initOutputPreviewZoomEvents, initOutputCompareEvents, openOutputLightbox, closeOutputLightbox};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.CanvasOutputPreview=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
