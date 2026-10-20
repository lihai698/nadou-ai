/* Image editor responsibility: smart-image-editor. Host supplies live state and effects. */
(function(root){
    'use strict';

function cropBounds(deps){
    return cropImageDisplaySize(deps);
}

function cropDragModeFromPointer(deps, event){
    const explicit = event.target.closest?.('[data-crop-handle]')?.dataset?.cropHandle;
    if(explicit) return `crop-${explicit}`;
    if(deps.imageEditMode !== 'crop') return 'move';
    const box = deps.document.getElementById('cropBox');
    const rect = box?.getBoundingClientRect?.();
    if(!rect) return 'move';
    const slop = 16;
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const nearL = x <= slop;
    const nearR = rect.width - x <= slop;
    const nearT = y <= slop;
    const nearB = rect.height - y <= slop;
    if(nearT && nearL) return 'crop-nw';
    if(nearT && nearR) return 'crop-ne';
    if(nearB && nearL) return 'crop-sw';
    if(nearB && nearR) return 'crop-se';
    if(nearT) return 'crop-n';
    if(nearR) return 'crop-e';
    if(nearB) return 'crop-s';
    if(nearL) return 'crop-w';
    return 'move';
}

function clampImageResizeScale(deps, value){
    const num = Number(value);
    if(!Number.isFinite(num)) return 0.5;
    return Math.max(0.05, Math.min(1, Math.round(num * 100) / 100));
}

function imageResizeDimensions(deps){
    const img = deps.document.getElementById('cropImage');
    const sourceW = Math.max(1, Math.round(Number(img?.naturalWidth || 0)));
    const sourceH = Math.max(1, Math.round(Number(img?.naturalHeight || 0)));
    const scale = clampImageResizeScale(deps, deps.imageResizeScale);
    return {
        sourceW,
        sourceH,
        scale,
        targetW:Math.max(1, Math.round(sourceW * scale)),
        targetH:Math.max(1, Math.round(sourceH * scale))
    };
}

function syncImageResizeControls(deps){
    deps.imageResizeScale = clampImageResizeScale(deps, deps.imageResizeScale);
    const range = deps.document.getElementById('imageResizeScaleRange');
    const input = deps.document.getElementById('imageResizeScaleInput');
    const label = deps.document.getElementById('imageResizeResolution');
    const overlay = deps.document.getElementById('resizeResolutionOverlay');
    const dims = imageResizeDimensions(deps);
    const text = `${dims.targetW}×${dims.targetH}`;
    if(range && Number(range.value) !== dims.scale) range.value = String(dims.scale);
    if(input && Number(input.value) !== dims.scale) input.value = String(dims.scale);
    if(label) label.textContent = text;
    if(overlay) overlay.textContent = text;
}

function setImageResizeScale(deps, value){
    deps.imageResizeScale = clampImageResizeScale(deps, value);
    syncImageResizeControls(deps);
}

async function resizedImageBlobFromEditor(deps){
    const img = deps.document.getElementById('cropImage');
    if(!img?.naturalWidth || !img?.naturalHeight) return null;
    const dims = imageResizeDimensions(deps);
    const canvasEl = deps.document.createElement('canvas');
    canvasEl.width = dims.targetW;
    canvasEl.height = dims.targetH;
    const ctx = canvasEl.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, 0, 0, dims.targetW, dims.targetH);
    const blob = await new Promise(resolve => canvasEl.toBlob(resolve, 'image/png'));
    return blob ? {blob, ...dims} : null;
}

function applyImageEditZoom(deps, scaleOverride=null){
    ensureImageEditBaseSize(deps);
    if(!deps.imageEditBaseW) return;
    const img = deps.document.getElementById('cropImage');
    const oldW = cropImageDisplaySize(deps).w;
    img.style.maxWidth = 'none'; img.style.maxHeight = 'none';
    img.style.width = Math.round(deps.imageEditBaseW * deps.imageEditZoom) + 'px';
    img.style.height = Math.round(deps.imageEditBaseH * deps.imageEditZoom) + 'px';
    deps.resizeEditDrawCanvas();
    if(deps.cropState){
        const scale = Number(scaleOverride) || (oldW > 0 ? cropImageDisplaySize(deps).w / oldW : 1);
        deps.cropState.x = Math.round(deps.cropState.x * scale); deps.cropState.y = Math.round(deps.cropState.y * scale);
        deps.cropState.w = Math.round(deps.cropState.w * scale); deps.cropState.h = Math.round(deps.cropState.h * scale);
        clampCrop(deps); renderCropBox(deps);
    }
    if(deps.imageEditMode === 'grid') deps.refreshGridSplitPreview();
    syncImageResizeControls(deps);
    syncImageEditOverflow(deps); deps.updateZoomLabel();
}

function syncImageEditOverflow(deps){
    const stage = deps.document.getElementById('imageEditStage');
    const crop = deps.document.getElementById('cropCanvas');
    if(!stage || !crop) return;
    const rect = crop.getBoundingClientRect(), pad = 36;
    stage.classList.toggle('overflow-x', rect.width + pad > stage.clientWidth);
    stage.classList.toggle('overflow-y', rect.height + pad > stage.clientHeight);
}

function resetImageEditZoom(deps){
    if(deps.imageEditMode === 'preview'){
        if(deps.panoramaState.enabled){
            deps.resetPanoramaView();
            return;
        }
        deps.resetPreviewTransform();
        return;
    }
    const stage = deps.document.getElementById('imageEditStage');
    deps.imageEditZoom = 1.0; applyImageEditZoom(deps);
    if(stage){ stage.scrollLeft = 0; stage.scrollTop = 0; }
}

function renderCropBox(deps){
    if(!deps.cropState) return;
    const cropCanvasEl = deps.document.getElementById('cropCanvas');
    const img = deps.document.getElementById('cropImage');
    const draw = deps.editDrawCanvas();
    const textCanvas = deps.editTextCanvas();
    let boxX = deps.cropState.x;
    let boxY = deps.cropState.y;
    if(deps.imageEditMode === 'outpaint' && cropCanvasEl && img){
        cropCanvasEl.style.width = `${Math.round(deps.cropState.w)}px`;
        cropCanvasEl.style.height = `${Math.round(deps.cropState.h)}px`;
        img.style.position = 'absolute';
        img.style.left = `${Math.round(deps.cropState.x)}px`;
        img.style.top = `${Math.round(deps.cropState.y)}px`;
        boxX = 0;
        boxY = 0;
        if(draw){
            draw.style.left = img.style.left;
            draw.style.top = img.style.top;
        }
        if(textCanvas){
            textCanvas.style.left = img.style.left;
            textCanvas.style.top = img.style.top;
        }
        updateOutpaintResolutionLabel(deps);
    } else if(cropCanvasEl && img){
        cropCanvasEl.style.width = '';
        cropCanvasEl.style.height = '';
        img.style.position = '';
        img.style.left = '';
        img.style.top = '';
        if(draw){
            draw.style.left = '';
            draw.style.top = '';
        }
        if(textCanvas){
            textCanvas.style.left = '';
            textCanvas.style.top = '';
        }
    }
    const box = deps.document.getElementById('cropBox');
    if(box){
        box.style.left = `${boxX}px`; box.style.top = `${boxY}px`; box.style.width = `${deps.cropState.w}px`; box.style.height = `${deps.cropState.h}px`;
    }
    const outpaintFrame = deps.document.getElementById('outpaintFrame');
    if(outpaintFrame){
        outpaintFrame.style.left = deps.imageEditMode === 'outpaint' ? '0px' : `${boxX}px`;
        outpaintFrame.style.top = deps.imageEditMode === 'outpaint' ? '0px' : `${boxY}px`;
        outpaintFrame.style.width = `${deps.cropState.w}px`;
        outpaintFrame.style.height = `${deps.cropState.h}px`;
    }
}

function outpaintNaturalSize(deps){
    const img = deps.document.getElementById('cropImage');
    if(!img || !deps.cropState) return {w:1, h:1};
    const display = cropImageDisplaySize(deps);
    const scaleX = Math.max(1, Number(img.naturalWidth || 1)) / Math.max(1, Number(display.w || img.clientWidth || 1));
    const scaleY = Math.max(1, Number(img.naturalHeight || 1)) / Math.max(1, Number(display.h || img.clientHeight || 1));
    return {
        w:Math.max(1, Math.round((deps.cropState.w || 1) * scaleX)),
        h:Math.max(1, Math.round((deps.cropState.h || 1) * scaleY))
    };
}

function updateOutpaintResolutionLabel(deps){
    const label = deps.document.getElementById('outpaintResolution');
    const cropCanvasEl = deps.document.getElementById('cropCanvas');
    if(!label || !deps.cropState) return;
    const size = outpaintNaturalSize(deps);
    const warning = deps.exceedsFourKStandard(size.w, size.h);
    cropCanvasEl?.classList.toggle('outpaint-warning', warning);
    label.textContent = `${Math.round(size.w)} x ${Math.round(size.h)}`;
}

function clampOutpaint(deps){
    if(!deps.cropState) return;
    const {w, h} = cropBounds(deps);
    deps.cropState.w = Math.max(w, deps.cropState.w);
    deps.cropState.h = Math.max(h, deps.cropState.h);
    deps.cropState.x = Math.min(deps.cropState.w - w, Math.max(0, deps.cropState.x));
    deps.cropState.y = Math.min(deps.cropState.h - h, Math.max(0, deps.cropState.y));
}

function resetOutpaintBox(deps){
    if(!deps.cropState) return;
    ensureImageEditBaseSize(deps, true);
    applyImageEditZoom(deps);
    const {w, h} = cropBounds(deps);
    deps.cropState.w = w;
    deps.cropState.h = h;
    deps.cropState.x = 0;
    deps.cropState.y = 0;
    clampOutpaint(deps);
    renderCropBox(deps);
}

function cropRatioFromPreset(deps, preset){
    if(!preset || preset === 'free') return null;
    if(preset === 'source'){
        const {w, h} = cropBounds(deps);
        return w > 0 && h > 0 ? w / h : null;
    }
    const parts = String(preset).split(':').map(v => Math.max(0, Number(v)));
    return parts.length === 2 && parts[0] > 0 && parts[1] > 0 ? parts[0] / parts[1] : null;
}

function syncCropRatioButtons(deps){
    deps.document.querySelectorAll('[data-crop-ratio]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.cropRatio === deps.cropAspectPreset);
    });
}

function fitCropRectToAspect(deps, ratio, sourceRect=null){
    const {w:boundsW, h:boundsH} = cropBounds(deps);
    const rect = sourceRect || deps.cropState || {x:0, y:0, w:boundsW, h:boundsH};
    const minSize = 24;
    let nextW = Math.max(minSize, Number(rect.w || boundsW));
    let nextH = Math.max(minSize, Number(rect.h || boundsH));
    if(ratio){
        if(nextW / nextH > ratio) nextW = nextH * ratio;
        else nextH = nextW / ratio;
        if(nextW > boundsW){ nextW = boundsW; nextH = nextW / ratio; }
        if(nextH > boundsH){ nextH = boundsH; nextW = nextH * ratio; }
    } else {
        nextW = Math.min(nextW, boundsW);
        nextH = Math.min(nextH, boundsH);
    }
    const cx = Number(rect.x || 0) + Number(rect.w || nextW) / 2;
    const cy = Number(rect.y || 0) + Number(rect.h || nextH) / 2;
    deps.cropState.w = Math.round(nextW);
    deps.cropState.h = Math.round(nextH);
    deps.cropState.x = Math.round(cx - deps.cropState.w / 2);
    deps.cropState.y = Math.round(cy - deps.cropState.h / 2);
    clampCrop(deps);
}

function setCropAspectPreset(deps, preset='free'){
    deps.cropAspectPreset = preset || 'free';
    deps.cropAspectRatio = cropRatioFromPreset(deps, deps.cropAspectPreset);
    syncCropRatioButtons(deps);
    if(deps.cropState && deps.imageEditMode === 'crop' && deps.cropAspectRatio){
        fitCropRectToAspect(deps, deps.cropAspectRatio);
        renderCropBox(deps);
    }
}

function resetCropBox(deps){
    if(!deps.cropState) return;
    if(deps.imageEditMode === 'outpaint') return resetOutpaintBox(deps);
    const {w, h} = cropBounds(deps);
    const rect = {x:Math.round(w * 0.08), y:Math.round(h * 0.08), w:Math.round(w * 0.84), h:Math.round(h * 0.84)};
    deps.cropState.x = rect.x; deps.cropState.y = rect.y; deps.cropState.w = rect.w; deps.cropState.h = rect.h;
    if(deps.cropAspectRatio) fitCropRectToAspect(deps, deps.cropAspectRatio, rect);
    renderCropBox(deps);
}

function openImageEditor(deps, nodeId, imageIndex=0){
    const node = deps.nodes.find(n => n.id === nodeId);
    const image = deps.imageForDisplay(node?.images?.[imageIndex]);
    if(!image?.url) return;
    const kind = deps.mediaKindForItem(image);
    if(kind !== 'image' && kind !== 'video'){
        deps.downloadPreviewFile(image);
        return;
    }
    deps.selectedId = nodeId;
    deps.selectedImage = {nodeId, index:imageIndex};
    deps.previewNavState = {nodeId, index:imageIndex, count:(node.images || []).filter(img => img?.url).length};
    deps.cropState = {nodeId, imageIndex, x:0, y:0, w:0, h:0};
    deps.gridCustomMode = false; deps.gridCustomLines = []; deps.gridCustomHistory = []; deps.gridCustomDrag = null; deps.gridCustomOrientation = 'h';
    deps.gridOperationMode = 'split'; deps.gridJoinLayout = null; deps.gridJoinDrag = null; deps.gridJoinImageCache = new Map(); deps.gridJoinUserMoved = false; deps.gridJoinGroupId = '';
    deps.imageEditZoom = 1.0; deps.imageEditBaseW = 0; deps.imageEditBaseH = 0; deps.imageResizeScale = 0.5; deps.imageEditModeTouched = false;
    deps.cropAspectPreset = 'free'; deps.cropAspectRatio = null; syncCropRatioButtons(deps);
    deps.editTextItems = []; deps.editTextSelectedId = ''; deps.editTextDrag = null; deps.editTextDirty = false;
    const toggle = deps.document.getElementById('gridCustomToggle');
    if(toggle){ toggle.classList.add('secondary'); toggle.classList.remove('primary'); }
    deps.syncGridCustomControls();
    deps.syncGridOperationControls();
    ['gridHorizontalLines','gridVerticalLines'].forEach(id => { const el = deps.document.getElementById(id); if(el) el.disabled = false; });
    const orientH = deps.document.getElementById('gridOrientH'), orientV = deps.document.getElementById('gridOrientV');
    if(orientH){ orientH.classList.add('primary'); orientH.classList.remove('secondary'); }
    if(orientV){ orientV.classList.add('secondary'); orientV.classList.remove('primary'); }
    deps.syncGridCustomUndoBtn(); deps.updateZoomLabel();
    const img = deps.document.getElementById('cropImage');
    img.style.width = ''; img.style.height = ''; img.style.maxWidth = ''; img.style.maxHeight = '';
    deps.imageEditModal.classList.add('open');
    deps.previewCompareOn = false;
    deps.previewCompareIndex = -1;
    deps.disposePanoramaPreview();
    deps.resetPreviewTransform();
    if(kind === 'video'){
        img.onload = null;
        img.onerror = null;
        img.removeAttribute('src');
        delete img.dataset.proxyFallbackTried;
        setImageEditMode(deps, 'preview');
        deps.updatePreviewNavButtons();
        deps.refreshIcons();
        return;
    }
    // 原图加载失败时的兜底链：依次尝试 download-output 代理、缩略图同款的 media-preview 代理（PIL 渲染，
    // 对截断/半下载的文件比浏览器宽容，所以缩略图能显示而原图破损时它仍能出图）。兜底时去掉 crossOrigin——
    // 预览不需要导出画布，带 crossOrigin 反而会因跨域/CORS 直接加载失败。
    const primaryEditorSrc = deps.displayMediaUrl(image);
    const editorFallbackUrls = [deps.proxiedMediaUrl(image), deps.smartMediaPreviewUrl(image, 2048)]
        .filter(Boolean)
        .filter((u, i, arr) => u !== primaryEditorSrc && arr.indexOf(u) === i);
    let editorFallbackIndex = 0;
    const editorSrcToken = `${nodeId}:${imageIndex}:${Date.now()}`;
    img.dataset.editorSrcToken = editorSrcToken;
    img.dataset.editorQuick = '';
    const isEditorCurrent=deps.captureImageEditContext({ignoreMode:true});
    img.onload = () => {
        if(!isEditorCurrent()) return;
        const targetImage = deps.nodes.find(n => n.id === nodeId)?.images?.[imageIndex];
        // 兜底用的是代理/缩放图，naturalWidth 不是原图真实尺寸，别污染节点的 natural_w/h。
        const loadedPrimary = img.dataset.editorQuick !== '1' && img.getAttribute('src') === primaryEditorSrc;
        if(loadedPrimary && editorFallbackIndex === 0 && targetImage && img.naturalWidth && img.naturalHeight && (!targetImage.natural_w || !targetImage.natural_h)){
            targetImage.natural_w = img.naturalWidth;
            targetImage.natural_h = img.naturalHeight;
            deps.scheduleSave();
        }
        deps.imageEditBaseW = img.clientWidth; deps.imageEditBaseH = img.clientHeight;
        deps.updateZoomLabel(); syncImageResizeControls(deps); deps.resizeEditDrawCanvas(); deps.resetEditDrawingHistory(); deps.clearEditDrawing(true); resetCropBox(deps);
        if(!deps.imageEditModeTouched) setImageEditMode(deps, 'preview');
        else deps.refreshComparePanel();
        if(!deps.panoramaState.enabled) deps.updatePreviewMetaHint();
        syncImageEditOverflow(deps); deps.refreshIcons();
    };
    img.onerror = () => {
        if(!isEditorCurrent()) return;
        if(editorFallbackIndex >= editorFallbackUrls.length) return;
        img.src = editorFallbackUrls[editorFallbackIndex++];
    };
    // 不设 crossOrigin：displayMediaUrl 已把所有地址收敛为同源（http 走本地代理），同源图片不会污染画布，
    // 裁剪/涂抹等导出操作照常可用。而带 crossOrigin 会让浏览器对“缩略图已无 CORS 缓存的同源图”重新发起
    // CORS 请求并失败——表现就是预览先闪一下（命中缓存）随即变成破损图。
    img.removeAttribute('crossorigin');
    const quickEditorSrc = deps.smartMediaPreviewUrl(image, 2048);
    const loadFullEditorImage = () => {
        if(!isEditorCurrent()) return;
        if(!deps.cropState || deps.cropState.nodeId !== nodeId || deps.cropState.imageIndex !== imageIndex) return;
        if(!deps.imageEditModal.classList.contains('open') || img.dataset.editorSrcToken !== editorSrcToken) return;
        img.dataset.editorQuick = '';
        if(img.getAttribute('src') !== primaryEditorSrc) img.src = primaryEditorSrc;
    };
    if(quickEditorSrc && quickEditorSrc !== primaryEditorSrc){
        img.dataset.editorQuick = '1';
        img.src = quickEditorSrc;
        deps.requestAnimationFrame(() => deps.setTimeout(loadFullEditorImage, 120));
    } else {
        img.src = primaryEditorSrc;
    }
    setImageEditMode(deps, 'preview');
    deps.updatePreviewNavButtons();
    deps.refreshIcons();
}

function closeImageEditor(deps){
    deps.cleanupSmartLogPreviewNode();
    deps.imageEditModal.classList.remove('open');
    deps.document.querySelector('.image-edit-panel')?.classList.remove('video-preview-mode');
    const img = deps.document.getElementById('cropImage');
    const previewVideo = deps.document.getElementById('previewCurrentVideo');
    img.onload = null; img.onerror = null; img.removeAttribute('src'); delete img.dataset.proxyFallbackTried; delete img.dataset.editorSrcToken; delete img.dataset.editorQuick; img.style.width = ''; img.style.height = ''; img.style.maxWidth = ''; img.style.maxHeight = '';
    img.style.position = ''; img.style.left = ''; img.style.top = '';
    if(previewVideo){
        previewVideo.pause?.();
        previewVideo.onloadedmetadata = null;
        previewVideo.onloadeddata = null;
        previewVideo.removeAttribute('src');
        previewVideo.load?.();
        previewVideo.style.display = 'none';
    }
    deps.clearEditDrawing(true);
    deps.cropState = null; deps.cropDrag = null; deps.editDrawState = null; deps.resetEditDrawingHistory(); deps.gridCustomDrag = null; deps.gridJoinDrag = null; deps.gridJoinLayout = null; deps.gridJoinImageCache = new Map(); deps.gridJoinUserMoved = false; deps.gridOperationMode = 'split'; deps.gridJoinGroupId = '';
    deps.previewNavState = {nodeId:'', index:0, count:0};
    deps.imageEditZoom = 1.0; deps.imageEditBaseW = 0; deps.imageEditBaseH = 0; deps.imageResizeScale = 0.5; deps.imageEditModeTouched = false;
    deps.cropAspectPreset = 'free'; deps.cropAspectRatio = null; syncCropRatioButtons(deps);
    deps.disposePanoramaPreview();
    deps.previewPanDrag = null; deps.previewCompareDrag = false; deps.imageEditPanDrag = null; deps.resetPreviewTransform();
    deps.document.getElementById('imageEditStage')?.classList.remove('overflow-x', 'overflow-y', 'preview-mode');
    const cropCanvasEl = deps.document.getElementById('cropCanvas');
    cropCanvasEl?.classList.remove('grid-custom-h', 'grid-custom-v', 'outpaint-mode', 'outpaint-warning', 'dragging-image', 'text-mode', 'resize-mode');
    cropCanvasEl?.classList.remove('grid-join-mode');
    deps.document.getElementById('cropImage')?.classList.remove('grid-join-hidden');
    const joinCanvas = deps.document.getElementById('gridJoinCanvas');
    if(joinCanvas){ joinCanvas.innerHTML = ''; joinCanvas.style.display = 'none'; joinCanvas.style.width = ''; joinCanvas.style.height = ''; }
    if(cropCanvasEl){ cropCanvasEl.style.width = ''; cropCanvasEl.style.height = ''; }
    const textCanvas = deps.editTextCanvas();
    if(textCanvas){ textCanvas.style.left = ''; textCanvas.style.top = ''; }
    deps.updatePreviewNavButtons();
}

function setImageEditMode(deps, mode, userTouched=false){
    const editKind = deps.mediaKindForItem(currentEditImage(deps).image || {});
    const isVideoPreview = editKind === 'video';
    if(isVideoPreview && mode !== 'preview') mode = 'preview';
    if(userTouched) deps.imageEditModeTouched = true;
    const prev = deps.imageEditMode;
    if(mode !== 'brush') deps.removeEditTextInlineEditor(true);
    deps.imageEditMode = ['preview','crop','outpaint','mask','brush','resize','grid'].includes(mode) ? mode : 'preview';
    const cropCanvasEl = deps.document.getElementById('cropCanvas');
    const previewStageEl = deps.document.getElementById('previewStage');
    const editStageEl = deps.document.getElementById('imageEditStage');
    const editPanelEl = deps.document.querySelector('.image-edit-panel');
    const previewDownloadBtn = deps.document.getElementById('previewDownloadBtn');
    const previewDownloadAllBtn = deps.document.getElementById('previewDownloadAllBtn');
    const modeBar = deps.document.querySelector('.image-edit-mode');
    const videoFrameTools = deps.document.getElementById('videoFrameTools');
    const zoomLabel = deps.document.getElementById('imageEditZoomLabel');
    const cancelBtn = deps.document.getElementById('imageEditCancelBtn');
    const isPreview = deps.imageEditMode === 'preview';
    if(!isPreview && deps.panoramaState.enabled) deps.disposePanoramaPreview();
    cropCanvasEl.style.display = isPreview ? 'none' : '';
    previewStageEl.style.display = isPreview ? 'inline-flex' : 'none';
    editStageEl?.classList.toggle('preview-mode', isPreview);
    editPanelEl?.classList.toggle('video-preview-mode', isVideoPreview);
    if(previewDownloadBtn) previewDownloadBtn.style.display = isPreview ? 'inline-flex' : 'none';
    if(previewDownloadAllBtn) previewDownloadAllBtn.style.display = isPreview && !isVideoPreview && deps.previewDownloadGroupItems().length > 1 ? 'inline-flex' : 'none';
    if(modeBar) modeBar.style.display = isVideoPreview ? 'none' : '';
    if(videoFrameTools) videoFrameTools.style.display = isVideoPreview && isPreview ? 'flex' : 'none';
    if(zoomLabel) zoomLabel.style.display = isVideoPreview ? 'none' : '';
    if(cancelBtn){
        cancelBtn.style.display = '';
        cancelBtn.textContent = isVideoPreview ? '关闭' : deps.tr('common.cancel');
    }
    cropCanvasEl.classList.toggle('mask-mode', deps.imageEditMode === 'mask');
    cropCanvasEl.classList.toggle('brush-mode', deps.imageEditMode === 'brush');
    cropCanvasEl.classList.toggle('resize-mode', deps.imageEditMode === 'resize');
    cropCanvasEl.classList.toggle('grid-mode', deps.imageEditMode === 'grid');
    cropCanvasEl.classList.toggle('outpaint-mode', deps.imageEditMode === 'outpaint');
    deps.syncGridCustomCursor();
    deps.document.querySelectorAll('[data-image-edit-mode]').forEach(btn => btn.classList.toggle('active', btn.dataset.imageEditMode === deps.imageEditMode));
    deps.document.getElementById('imagePreviewTools').classList.toggle('active', isPreview && !isVideoPreview);
    deps.document.getElementById('imageCropTools')?.classList.toggle('active', deps.imageEditMode === 'crop');
    deps.document.getElementById('imageMaskTools').classList.toggle('active', deps.imageEditMode === 'mask');
    deps.document.getElementById('imageBrushTools').classList.toggle('active', deps.imageEditMode === 'brush');
    deps.document.getElementById('imageResizeTools')?.classList.toggle('active', deps.imageEditMode === 'resize');
    deps.document.getElementById('imageGridTools').classList.toggle('active', deps.imageEditMode === 'grid');
    if(deps.imageEditMode === 'grid' && deps.gridOperationMode === 'join' && !deps.canGridJoinCurrentNode()) deps.gridOperationMode = 'split';
    deps.syncGridOperationControls();
    deps.syncGridGapValue();
    syncImageResizeControls(deps);
    const applyBtn = deps.document.getElementById('imageEditApplyBtn');
    deps.document.getElementById('compareToggleBtn').style.display = isPreview && !isVideoPreview ? 'inline-flex' : 'none';
    deps.document.getElementById('panoramaToggleBtn').style.display = isPreview && !isVideoPreview ? 'inline-flex' : 'none';
    deps.document.getElementById('panoramaExportBtn').style.display = isPreview && !isVideoPreview && deps.panoramaState.enabled ? 'inline-flex' : 'none';
    deps.document.getElementById('compareThumbs').style.display = 'none';
    if(isPreview){
        deps.document.getElementById('imageEditTitle').textContent = isVideoPreview ? '预览视频' : deps.tr('smart.previewImage');
        deps.document.getElementById('imageEditSub').textContent = isVideoPreview ? '' : deps.tr('smart.previewHint');
        applyBtn.style.display = 'none';
        deps.refreshComparePanel();
    } else {
        ensureImageEditBaseSize(deps, true);
        applyImageEditZoom(deps);
        applyBtn.style.display = '';
        if(deps.imageEditMode === 'resize'){
            deps.document.getElementById('imageEditTitle').textContent = '缩放图片';
            deps.document.getElementById('imageEditSub').textContent = '选择缩小倍数，应用会替换当前原图';
            applyBtn.innerHTML = `<i data-lucide="minimize-2" class="w-4 h-4"></i><span>应用缩放</span>`;
        } else {
            const icon = deps.imageEditMode === 'crop' ? 'crop' : deps.imageEditMode === 'outpaint' ? 'expand' : deps.imageEditMode === 'mask' ? 'brush' : deps.imageEditMode === 'brush' ? 'paintbrush' : 'grid-3x3';
            const labelKey = deps.imageEditMode === 'crop' ? 'canvas.applyCrop' : deps.imageEditMode === 'outpaint' ? 'canvas.applyOutpaint' : deps.imageEditMode === 'mask' ? 'canvas.applyMask' : deps.imageEditMode === 'brush' ? 'canvas.applyBrush' : 'canvas.applyGrid';
            const titleKey = deps.imageEditMode === 'crop' ? 'canvas.cropImage' : deps.imageEditMode === 'outpaint' ? 'canvas.outpaintImage' : deps.imageEditMode === 'mask' ? 'canvas.maskEdit' : deps.imageEditMode === 'brush' ? 'canvas.brushEdit' : 'canvas.modeGrid';
            const subKey = deps.imageEditMode === 'crop' ? 'canvas.cropHint' : deps.imageEditMode === 'outpaint' ? 'canvas.outpaintHint' : deps.imageEditMode === 'mask' ? 'canvas.maskHint2' : deps.imageEditMode === 'brush' ? 'canvas.brushHint' : 'canvas.gridHint';
            deps.document.getElementById('imageEditTitle').textContent = deps.tr(titleKey);
            deps.document.getElementById('imageEditSub').textContent = deps.tr(subKey);
            const applyLabel = deps.imageEditMode === 'grid' && deps.gridOperationMode === 'join' ? '输出拼接' : deps.tr(labelKey);
            applyBtn.innerHTML = `<i data-lucide="${icon}" class="w-4 h-4"></i><span>${applyLabel}</span>`;
        }
        if(deps.imageEditMode === 'crop'){
            deps.requestAnimationFrame(() => {
                resetCropBox(deps);
                syncImageEditOverflow(deps);
            });
        } else if(deps.imageEditMode === 'outpaint'){
            deps.requestAnimationFrame(() => {
                resetOutpaintBox(deps);
                syncImageEditOverflow(deps);
            });
        }
    }
    deps.resizeEditDrawCanvas();
    if(deps.imageEditMode === 'grid') deps.refreshGridSplitPreview();
    else if(deps.imageEditMode === 'crop' || deps.imageEditMode === 'resize' || deps.imageEditMode === 'outpaint' || prev === 'grid') deps.clearEditDrawing(true);
    deps.syncEditDrawingHistoryButtons();
    deps.syncBrushToolButtons();
    deps.syncTextToolState(true);
    deps.updatePreviewNavButtons();
    deps.refreshIcons();
}

function clampCrop(deps){
    if(!deps.cropState) return;
    if(deps.imageEditMode === 'outpaint') return clampOutpaint(deps);
    const {w, h} = cropBounds(deps);
    deps.cropState.w = Math.max(24, Math.min(deps.cropState.w, w)); deps.cropState.h = Math.max(24, Math.min(deps.cropState.h, h));
    deps.cropState.x = Math.max(0, Math.min(deps.cropState.x, w - deps.cropState.w)); deps.cropState.y = Math.max(0, Math.min(deps.cropState.y, h - deps.cropState.h));
}

function beginCropDrag(deps, event, mode){
    if(!deps.cropState) return;
    event.preventDefault(); event.stopPropagation();
    if(deps.imageEditMode === 'outpaint' && mode === 'move') return;
    deps.cropDrag = {mode, sx:event.clientX, sy:event.clientY, start:{...deps.cropState}};
}

function resizeOutpaintFromDrag(deps, dx, dy){
    const start = deps.cropDrag?.start;
    if(!start) return;
    let growX = 0, growY = 0;
    if(deps.cropDrag.mode === 'outpaint-left') growX = -dx;
    else if(deps.cropDrag.mode === 'outpaint-right') growX = dx;
    else if(deps.cropDrag.mode === 'outpaint-top') growY = -dy;
    else if(deps.cropDrag.mode === 'outpaint-bottom') growY = dy;
    else if(deps.cropDrag.mode === 'outpaint-corner'){ growX = dx; growY = dy; }
    const {w, h} = cropBounds(deps);
    const nextW = Math.max(w, start.w + growX * 2);
    const nextH = Math.max(h, start.h + growY * 2);
    deps.cropState.w = nextW;
    deps.cropState.h = nextH;
    deps.cropState.x = start.x + Math.round((nextW - start.w) / 2);
    deps.cropState.y = start.y + Math.round((nextH - start.h) / 2);
    clampOutpaint(deps);
}

function clampAspectCropToBounds(deps, anchorX, anchorY, movingX, movingY, ratio, handle){
    const {w:boundsW, h:boundsH} = cropBounds(deps);
    const minSize = 24;
    let width = Math.max(minSize, Math.abs(movingX - anchorX));
    let height = Math.max(minSize, Math.abs(movingY - anchorY));
    if(width / height > ratio) width = height * ratio;
    else height = width / ratio;
    const dirX = handle.includes('w') ? -1 : 1;
    const dirY = handle.includes('n') ? -1 : 1;
    width = Math.min(width, dirX < 0 ? anchorX : boundsW - anchorX);
    height = Math.min(height, dirY < 0 ? anchorY : boundsH - anchorY);
    if(width / height > ratio) width = height * ratio;
    else height = width / ratio;
    return {
        x:dirX < 0 ? anchorX - width : anchorX,
        y:dirY < 0 ? anchorY - height : anchorY,
        w:width,
        h:height
    };
}

function resizeCropFromDrag(deps, dx, dy){
    const start = deps.cropDrag?.start;
    if(!start) return;
    const handle = String(deps.cropDrag.mode || 'resize').replace(/^crop-/, '') || 'se';
    if(!deps.cropAspectRatio){
        let left = start.x;
        let top = start.y;
        let right = start.x + start.w;
        let bottom = start.y + start.h;
        if(handle.includes('w')) left += dx;
        if(handle.includes('e') || handle === 'resize') right += dx;
        if(handle.includes('n')) top += dy;
        if(handle.includes('s') || handle === 'resize') bottom += dy;
        deps.cropState.x = Math.min(left, right - 24);
        deps.cropState.y = Math.min(top, bottom - 24);
        deps.cropState.w = Math.max(24, right - deps.cropState.x);
        deps.cropState.h = Math.max(24, bottom - deps.cropState.y);
        return;
    }
    const normalized = handle === 'resize' ? 'se' : handle;
    const centerX = start.x + start.w / 2;
    const centerY = start.y + start.h / 2;
    if(normalized === 'e' || normalized === 'w'){
        const {w:boundsW, h:boundsH} = cropBounds(deps);
        let width = Math.max(24, normalized === 'e' ? start.w + dx : start.w - dx);
        const maxW = normalized === 'e' ? boundsW - start.x : start.x + start.w;
        const maxH = Math.max(24, 2 * Math.min(centerY, boundsH - centerY));
        width = Math.min(width, maxW, maxH * deps.cropAspectRatio);
        const height = width / deps.cropAspectRatio;
        deps.cropState.x = Math.round(normalized === 'e' ? start.x : start.x + start.w - width);
        deps.cropState.y = Math.round(centerY - height / 2);
        deps.cropState.w = Math.round(width);
        deps.cropState.h = Math.round(height);
        return;
    }
    if(normalized === 'n' || normalized === 's'){
        const {w:boundsW, h:boundsH} = cropBounds(deps);
        let height = Math.max(24, normalized === 's' ? start.h + dy : start.h - dy);
        const maxH = normalized === 's' ? boundsH - start.y : start.y + start.h;
        const maxW = Math.max(24, 2 * Math.min(centerX, boundsW - centerX));
        height = Math.min(height, maxH, maxW / deps.cropAspectRatio);
        const width = height * deps.cropAspectRatio;
        deps.cropState.x = Math.round(centerX - width / 2);
        deps.cropState.y = Math.round(normalized === 's' ? start.y : start.y + start.h - height);
        deps.cropState.w = Math.round(width);
        deps.cropState.h = Math.round(height);
        return;
    }
    const anchorX = normalized.includes('w') ? start.x + start.w : start.x;
    const anchorY = normalized.includes('n') ? start.y + start.h : start.y;
    const movingX = normalized.includes('w') ? start.x + dx : start.x + start.w + dx;
    const movingY = normalized.includes('n') ? start.y + dy : start.y + start.h + dy;
    const next = clampAspectCropToBounds(deps, anchorX, anchorY, movingX, movingY, deps.cropAspectRatio, normalized);
    deps.cropState.x = Math.round(next.x);
    deps.cropState.y = Math.round(next.y);
    deps.cropState.w = Math.round(next.w);
    deps.cropState.h = Math.round(next.h);
}

async function applyImageCrop(deps){
    const isCurrent=deps.captureImageEditContext();
    if(!isCurrent()) return;
    if(!deps.cropState) return;
    const {node, image} = currentEditImage(deps);
    const img = deps.document.getElementById('cropImage');
    if(!node || !image || !img.naturalWidth || !img.naturalHeight) return;
    const scaleX = img.naturalWidth / (img.clientWidth || 1), scaleY = img.naturalHeight / (img.clientHeight || 1);
    const sx = Math.max(0, Math.round(deps.cropState.x * scaleX)), sy = Math.max(0, Math.round(deps.cropState.y * scaleY));
    const sw = Math.max(1, Math.round(deps.cropState.w * scaleX)), sh = Math.max(1, Math.round(deps.cropState.h * scaleY));
    const canvasEl = deps.document.createElement('canvas');
    canvasEl.width = sw; canvasEl.height = sh;
    canvasEl.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    const blob = await new Promise(resolve => canvasEl.toBlob(resolve, 'image/png'));
    if(!isCurrent()) return;
    const base = (image.name || 'image').replace(/\.[^.]+$/, '');
    const file = blob ? await deps.uploadCroppedBlob(blob, `${base}_crop.png`, isCurrent) : null;
    if(!isCurrent()) return;
    if(file && replaceEditedImage(deps, file)){ closeImageEditor(deps); deps.render(); deps.scheduleSave(); }
}

async function applyImageOutpaint(deps){
    const isCurrent=deps.captureImageEditContext();
    if(!isCurrent()) return;
    if(!deps.cropState) return;
    let {node, image} = currentEditImage(deps);
    const img = deps.document.getElementById('cropImage');
    if(!node || !image || !img.naturalWidth || !img.naturalHeight) return;
    clampOutpaint(deps);
    const scaleX = img.naturalWidth / (img.clientWidth || 1), scaleY = img.naturalHeight / (img.clientHeight || 1);
    const outW = Math.max(img.naturalWidth, Math.round(deps.cropState.w * scaleX));
    const outH = Math.max(img.naturalHeight, Math.round(deps.cropState.h * scaleY));
    const dx = Math.round(deps.cropState.x * scaleX);
    const dy = Math.round(deps.cropState.y * scaleY);
    const canvasEl = deps.document.createElement('canvas');
    canvasEl.width = outW; canvasEl.height = outH;
    const ctx = canvasEl.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, outW, outH);
    ctx.drawImage(img, dx, dy, img.naturalWidth, img.naturalHeight);
    const blob = await new Promise(resolve => canvasEl.toBlob(resolve, 'image/png'));
    if(!isCurrent()) return;
    const base = (image.name || 'image').replace(/\.[^.]+$/, '');
    const file = blob ? await deps.uploadCroppedBlob(blob, `${base}_outpaint.png`, isCurrent) : null;
    if(!isCurrent()) return;
    node = currentEditImage(deps).node;
    if(file && replaceEditedImage(deps, file)){
        applyOutpaintSizeToSmartParams(deps, outW, outH);
        deps.setPromptDraftForNode(node, 'Remove white area and fill the scene');
        deps.promptInput.dataset.preserveDraftOnce = '1';
        closeImageEditor(deps);
        deps.render();
        deps.scheduleSave();
    }
}

async function applyImageResize(deps){
    const isCurrent=deps.captureImageEditContext();
    if(!isCurrent()) return;
    if(!deps.cropState) return;
    const {node, image} = currentEditImage(deps);
    if(!node || !image) return;
    let resized = null;
    try {
        resized = await resizedImageBlobFromEditor(deps);
        if(!isCurrent()) return;
    } catch(err) {
        if(!isCurrent()) return;
        deps.toast('缩放失败：当前图片无法写入画布，请换成本地图片或重新上传后再试');
        return;
    }
    if(!resized?.blob) return;
    const base = deps.safeExportFileName((deps.downloadNameForMediaItem(image, 'image') || image.name || 'image').replace(/\.[^.]+$/, ''), 'image');
    const suffix = `${Math.round(resized.scale * 100)}pct`;
    const file = await deps.uploadCroppedBlob(resized.blob, `${base}_resize_${suffix}.png`, isCurrent);
    if(!isCurrent()) return;
    if(!file) return;
    if(!replaceEditedImage(deps, file, {kind:'image', role:image.role || '', natural_w:resized.targetW, natural_h:resized.targetH})){
        return;
    }
    closeImageEditor(deps);
    deps.render();
    deps.scheduleSave();
}

function applyImageEdit(deps){
    if(deps.imageEditMode === 'preview') return;
    if(deps.imageEditMode === 'outpaint') return applyImageOutpaint(deps);
    if(deps.imageEditMode === 'mask') return deps.applyImageMask();
    if(deps.imageEditMode === 'brush') return deps.applyImageBrush();
    if(deps.imageEditMode === 'resize') return applyImageResize(deps);
    if(deps.imageEditMode === 'grid') return deps.applyImageGridSplit();
    return applyImageCrop(deps);
}

function cropImageDisplaySize(deps){
    const img = deps.document.getElementById('cropImage');
    const clientW = Number(img?.clientWidth || 0);
    const clientH = Number(img?.clientHeight || 0);
    if(clientW > 2 && clientH > 2) return {w:clientW, h:clientH};
    ensureImageEditBaseSize(deps);
    const fallbackW = Math.round((deps.imageEditBaseW || Number(img?.naturalWidth || 0) || 1) * deps.imageEditZoom);
    const fallbackH = Math.round((deps.imageEditBaseH || Number(img?.naturalHeight || 0) || 1) * deps.imageEditZoom);
    return {w:Math.max(1, fallbackW), h:Math.max(1, fallbackH)};
}

function currentEditImage(deps){
    const node = deps.nodes.find(n => n.id === deps.cropState?.nodeId);
    const index = Number(deps.cropState?.imageIndex || 0);
    return {node, index, image:deps.imageForDisplay(node?.images?.[index])};
}

function ensureImageEditBaseSize(deps, force=false){
    if(deps.imageEditBaseW && deps.imageEditBaseH && !force) return;
    const img = deps.document.getElementById('cropImage');
    const naturalW = img.naturalWidth || img.clientWidth || 0;
    const naturalH = img.naturalHeight || img.clientHeight || 0;
    if(!naturalW || !naturalH) return;
    const maxW = Math.max(1, Math.min(1300, deps.window.innerWidth - 100));
    const maxH = Math.max(1, Math.min(840, deps.window.innerHeight - 200));
    const fit = Math.min(1, maxW / naturalW, maxH / naturalH);
    deps.imageEditBaseW = Math.max(1, Math.round(naturalW * fit));
    deps.imageEditBaseH = Math.max(1, Math.round(naturalH * fit));
}

function replaceEditedImage(deps, file, extra={}){
    const {node, index} = currentEditImage(deps);
    if(!node || !file) return false;
    node.images[index] = {...(node.images[index] || {}), url:file.url, name:file.name, kind:file.kind || deps.mediaKindForItem(file), natural_w:0, natural_h:0, ...extra};
    if((node.images || []).length === 1){ delete node.w; delete node.h; }
    deps.selectedId = node.id; deps.selectedImage = {nodeId:node.id, index};
    return true;
}

function applyOutpaintSizeToSmartParams(deps, width, height){
    const w = Math.max(1, Math.round(Number(width) || 0));
    const h = Math.max(1, Math.round(Number(height) || 0));
    if(!w || !h) return;
    const subject = currentEditImage(deps).node;
    if(!subject || !deps.isSmartImageNode(subject)) return;
    subject.outpaintSize = {width:w, height:h};
    subject.runSettings = deps.withOutpaintDisplaySettings(subject, deps.cloneSmartSettings(subject.runSettings || deps.settings));
    if(deps.activeSettingsSubject()?.id === subject.id){
        deps.settings = deps.smartSettingsForNode(subject);
        deps.renderDynamicParams();
    }
}

async function uploadCroppedBlob(deps, blob, name, isCurrent=deps.captureImageEditContext()){
    const files = await uploadImageBlobs(deps, [{blob, name}], isCurrent);
    return files[0];
}

async function uploadImageBlobs(deps, blobs, isCurrent=deps.captureImageEditContext()){
    if(!isCurrent() || !blobs.length) return [];
    const form = new deps.FormData();
    blobs.forEach(item => form.append('files', item.blob, item.name));
    try {
        const response = await deps.fetch('/api/ai/upload', {method:'POST', body:form});
        const data = await response.json().catch(() => ({}));
        if(!isCurrent()) return [];
        if(!response.ok) throw new Error(data.detail || deps.tr('smart.toastUploadFail'));
        if(!Array.isArray(data.files) || data.files.length !== blobs.length || data.files.some(file => !file?.url)){
            throw new Error(deps.tr('smart.toastUploadFail'));
        }
        return data.files;
    } catch(err) {
        if(!isCurrent()) return [];
        deps.toast(err.message || deps.tr('smart.toastUploadFail'));
        return [];
    }
}

    const api={uploadCroppedBlob, uploadImageBlobs, cropBounds, cropDragModeFromPointer, clampImageResizeScale, imageResizeDimensions, syncImageResizeControls, setImageResizeScale, resizedImageBlobFromEditor, applyImageEditZoom, syncImageEditOverflow, resetImageEditZoom, renderCropBox, outpaintNaturalSize, updateOutpaintResolutionLabel, clampOutpaint, resetOutpaintBox, cropRatioFromPreset, syncCropRatioButtons, fitCropRectToAspect, setCropAspectPreset, resetCropBox, openImageEditor, closeImageEditor, setImageEditMode, clampCrop, beginCropDrag, resizeOutpaintFromDrag, clampAspectCropToBounds, resizeCropFromDrag, applyImageCrop, applyImageOutpaint, applyImageResize, applyImageEdit, cropImageDisplaySize, currentEditImage, ensureImageEditBaseSize, replaceEditedImage, applyOutpaintSizeToSmartParams};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.SmartImageEditor=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
