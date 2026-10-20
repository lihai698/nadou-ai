/* Canvas input presentation and prompt request assembly: canvas-input-view. Host supplies live state and effects. */
(function(root){
    'use strict';

function canvasInputListNeedsRender(deps, list, signature){
    const key = JSON.stringify(signature);
    if(list.dataset.inputSignature === key) return false;
    list.dataset.inputSignature = key;
    return true;
}

function renderImageInputList(deps, list, node, imageInputs, emptyText=null){
    if(!list) return;
    if(!canvasInputListNeedsRender(deps, list, [emptyText || deps.tr('canvas.inputImagesEmpty'), imageInputs.map(src => [src.id, src.preview, src.label])])) return;
    list.innerHTML = imageInputs.length ? '' : `<div class="text-[11px] text-gray-300 py-2">${deps.escapeHtml(emptyText || deps.tr('canvas.inputImagesEmpty'))}</div>`;
    imageInputs.forEach((src, i) => {
        const item = deps.document.createElement('div');
        item.className = 'input-item';
        item.draggable = true;
        item.dataset.sourceId = src.id;
        const previewHtml = src.preview && !deps.isMissingAssetUrl(src.preview) ? deps.canvasPreviewImgHtml(src.preview, 256) : (src.preview ? deps.missingAssetHtml(src.preview, true) : '<i data-lucide="image" class="w-6 h-6 text-slate-400"></i>');
        item.innerHTML = `<span class="input-index">${i + 1}</span>${previewHtml}<span class="input-label">${deps.escapeHtml(src.label)}</span>`;
        item.ondragstart = e => {
            e.stopPropagation();
            deps.internalDrag = true;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('application/x-canvas-input', src.id);
        };
        item.ondragend = () => { deps.internalDrag = false; };
        item.ondragover = e => { e.preventDefault(); e.stopPropagation(); };
        item.ondrop = e => {
            e.preventDefault();
            e.stopPropagation();
            deps.reorderInput(node, e.dataTransfer.getData('application/x-canvas-input'), src.id);
            deps.internalDrag = false;
        };
        list.appendChild(item);
    });
    deps.refreshIcons();
    deps.bindCanvasPreviewImageFallbacks(list);
}

function renderVideoImageInputs(deps, list, node, imageInputs){
    if(!list) return;
    if(!canvasInputListNeedsRender(deps, list, [deps.tr('canvas.groupEmpty'), node.useFrameRoles, imageInputs.map(src => [src.id, src.preview, src.label, deps.mediaKindForRef(src.refs?.[0] || {url:src.preview || ''})])])) return;
    list.innerHTML = imageInputs.length ? '' : `<div class="text-[11px] text-gray-300 py-2">${deps.tr('canvas.groupEmpty')}</div>`;
    imageInputs.forEach((src, i) => {
        const item = deps.document.createElement('div');
        item.className = 'input-item video-input-item';
        item.draggable = true;
        item.dataset.sourceId = src.id;
        const kind = deps.mediaKindForRef(src.refs?.[0] || {url:src.preview || ''});
        const frameLabel = kind === 'image' && node.useFrameRoles && i === 0 ? deps.tr('canvas.videoRoleFirstFrame') : kind === 'image' && node.useFrameRoles && i === 1 ? deps.tr('canvas.videoRoleLastFrame') : '';
        const previewHtml = kind === 'video'
            ? deps.canvasVideoPreviewHtml(src.preview || src.refs?.[0]?.url || '', 256)
            : kind === 'audio'
            ? `<div class="video-input-audio"><i data-lucide="file-audio" class="w-6 h-6"></i><span>${deps.escapeHtml(src.label || 'Audio')}</span></div>`
            : src.preview && !deps.isMissingAssetUrl(src.preview)
            ? deps.canvasPreviewImgHtml(src.preview, 256)
            : (src.preview ? deps.missingAssetHtml(src.preview, true) : '<i data-lucide="image" class="w-6 h-6 text-slate-400"></i>');
        const typeLabel = kind === 'audio' ? `音频${i + 1}` : kind === 'video' ? `视频${i + 1}` : `图${i + 1}`;
        item.innerHTML = `
            <div class="video-input-thumb">
                <span class="input-index">${i + 1}</span>
                ${previewHtml}
                <span class="input-label">${deps.escapeHtml(typeLabel)}</span>
            </div>
            ${frameLabel ? `<div class="video-frame-label">${frameLabel}</div>` : ''}
        `;
        item.ondragstart = e => { e.stopPropagation(); deps.internalDrag = true; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('application/x-canvas-input', src.id); };
        item.ondragend = () => { deps.internalDrag = false; };
        item.ondragover = e => { e.preventDefault(); e.stopPropagation(); };
        item.ondrop = e => { e.preventDefault(); e.stopPropagation(); deps.reorderInput(node, e.dataTransfer.getData('application/x-canvas-input'), src.id); deps.internalDrag = false; };
        list.appendChild(item);
    });
    deps.refreshIcons();
    deps.bindCanvasPreviewImageFallbacks(list);
}

    const api={canvasInputListNeedsRender, renderImageInputList, renderVideoImageInputs};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.CanvasInputView=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
