/* Image editor responsibility: canvas-image-editor. Host supplies live state and effects. */
(function(root){
    'use strict';

function cropBounds(deps){
    const img = deps.document.getElementById('cropImage');
    return {w:img.clientWidth || 1, h:img.clientHeight || 1};
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

function applyImageEditZoom(deps){
    if(!deps.imageEditBaseW) return;
    const img = deps.document.getElementById('cropImage');
    const oldW = img.clientWidth;
    img.style.maxWidth = 'none';
    img.style.maxHeight = 'none';
    img.style.width = Math.round(deps.imageEditBaseW * deps.imageEditZoom) + 'px';
    img.style.height = Math.round(deps.imageEditBaseH * deps.imageEditZoom) + 'px';
    deps.resizeEditDrawCanvas();
    // 按比例同步裁剪框位置
    if(deps.cropState && oldW > 0){
        const scale = img.clientWidth / oldW;
        deps.cropState.x = Math.round(deps.cropState.x * scale);
        deps.cropState.y = Math.round(deps.cropState.y * scale);
        deps.cropState.w = Math.round(deps.cropState.w * scale);
        deps.cropState.h = Math.round(deps.cropState.h * scale);
        clampCrop(deps);
        renderCropBox(deps);
    }
    if(deps.imageEditMode === 'grid') deps.refreshGridSplitPreview();
    syncImageResizeControls(deps);
    syncImageEditOverflow(deps);
    deps._updateZoomLabel();
}

function syncImageEditOverflow(deps){
    const stage = deps.document.getElementById('imageEditStage');
    const crop = deps.document.getElementById('cropCanvas');
    if(!stage || !crop) return;
    const rect = crop.getBoundingClientRect();
    const pad = 36;
    const overflowX = rect.width + pad > stage.clientWidth;
    const overflowY = rect.height + pad > stage.clientHeight;
    stage.classList.toggle('overflowing', overflowX || overflowY);
    stage.classList.toggle('overflow-x', overflowX);
    stage.classList.toggle('overflow-y', overflowY);
}

function resetImageEditZoom(deps){
    const stage = deps.document.getElementById('imageEditStage');
    deps.imageEditZoom = 1.0;
    applyImageEditZoom(deps);
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
    box.style.left = `${boxX}px`;
    box.style.top = `${boxY}px`;
    box.style.width = `${deps.cropState.w}px`;
    box.style.height = `${deps.cropState.h}px`;
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
    const scaleX = Math.max(1, Number(img.naturalWidth || 1)) / Math.max(1, Number(img.clientWidth || 1));
    const scaleY = Math.max(1, Number(img.naturalHeight || 1)) / Math.max(1, Number(img.clientHeight || 1));
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
    cropCanvasEl?.classList.toggle('outpaint-warning', deps.exceedsFourKStandard(size.w, size.h));
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
    const {w, h} = cropBounds(deps);
    deps.cropState.x = 0;
    deps.cropState.y = 0;
    deps.cropState.w = w;
    deps.cropState.h = h;
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
    deps.cropState.x = rect.x;
    deps.cropState.y = rect.y;
    deps.cropState.w = rect.w;
    deps.cropState.h = rect.h;
    if(deps.cropAspectRatio) fitCropRectToAspect(deps, deps.cropAspectRatio, rect);
    renderCropBox(deps);
}

function openImageEditor(deps, nodeId, initialMode='crop'){
    const node = deps.nodes.find(n => n.id === nodeId);
    if(!node?.url) return;
    if(deps.mediaKindForNode(node) !== 'image') return;
    if(!['preview','crop','outpaint','mask','brush','resize','grid'].includes(initialMode)) initialMode = 'crop';
    deps.cropState = {nodeId, x:0, y:0, w:0, h:0};
    // 重置自定义宫格状态
    deps.gridCustomMode = false;
    deps.gridCustomLines = [];
    deps.gridCustomHistory = [];
    deps.gridCustomDrag = null;
    deps.gridCustomOrientation = 'h';
    deps.imageEditZoom = 1.0;
    deps.imageEditBaseW = 0;
    deps.imageEditBaseH = 0;
    deps.imageResizeScale = 0.5;
    deps.imageEditModeTouched = false;
    deps.cropAspectPreset = 'free';
    deps.cropAspectRatio = null;
    syncCropRatioButtons(deps);
    deps.editTextItems = [];
    deps.editTextSelectedId = '';
    deps.editTextDrag = null;
    deps.editTextDirty = false;
    const toggle = deps.document.getElementById('gridCustomToggle');
    if(toggle){ toggle.classList.add('secondary'); toggle.classList.remove('primary'); }
    const custom = deps.document.getElementById('gridCustomControls');
    if(custom) custom.style.display = 'none';
    ['gridHorizontalLines','gridVerticalLines'].forEach(id => { const el = deps.document.getElementById(id); if(el) el.disabled = false; });
    const orientH = deps.document.getElementById('gridOrientH');
    const orientV = deps.document.getElementById('gridOrientV');
    if(orientH){ orientH.classList.add('primary'); orientH.classList.remove('secondary'); }
    if(orientV){ orientV.classList.add('secondary'); orientV.classList.remove('primary'); }
    deps._syncGridCustomUndoBtn();
    deps._updateZoomLabel();
    const modal = deps.document.getElementById('imageEditModal');
    const img = deps.document.getElementById('cropImage');
    img.style.width = '';
    img.style.height = '';
    img.style.maxWidth = '';
    img.style.maxHeight = '';
    modal.classList.add('open');
    deps.installCanvasViewAdjustMenu();
    const editorSrcToken = `${nodeId}:${Date.now()}`;
    img.dataset.editorSrcToken = editorSrcToken;
    const isEditorCurrent=deps.captureImageEditContext({ignoreMode:true});
    img.onload = () => {
        if(!isEditorCurrent()) return;
        // 记录 zoom=1 时的基础显示尺寸
        deps.imageEditBaseW = img.clientWidth;
        deps.imageEditBaseH = img.clientHeight;
        deps._updateZoomLabel();
        syncImageResizeControls(deps);
        deps.resizeEditDrawCanvas();
        deps.resetEditDrawingHistory();
        deps.clearEditDrawing(true);
        resetCropBox(deps);
        if(!deps.imageEditModeTouched) setImageEditMode(deps, initialMode);
        syncImageEditOverflow(deps);
        deps.refreshIcons();
    };
    img.crossOrigin = 'anonymous';
    const fullEditorSrc = deps.canvasDisplayMediaUrl(node.url, node.name || '');
    const quickEditorSrc = deps.canvasMediaPreviewUrl(node.url, initialMode === 'preview' ? 1536 : 2048);
    if(quickEditorSrc && quickEditorSrc !== fullEditorSrc){
        img.src = quickEditorSrc;
        deps.requestAnimationFrame(() => {
            deps.setTimeout(() => {
                if(!isEditorCurrent()) return;
                if(!deps.cropState || deps.cropState.nodeId !== nodeId) return;
                if(!modal.classList.contains('open') || img.dataset.editorSrcToken !== editorSrcToken) return;
                if(img.getAttribute('src') !== fullEditorSrc) img.src = fullEditorSrc;
            }, initialMode === 'preview' ? 120 : 60);
        });
    } else {
        img.src = fullEditorSrc;
    }
    setImageEditMode(deps, initialMode);
    deps.refreshIcons();
}

function closeImageEditor(deps){
    deps.document.getElementById('imageEditModal').classList.remove('open');
    const img = deps.document.getElementById('cropImage');
    img.onload = null;
    delete img.dataset.editorSrcToken;
    img.removeAttribute('src');
    img.style.width = '';
    img.style.height = '';
    img.style.maxWidth = '';
    img.style.maxHeight = '';
    deps.clearEditDrawing(true);
    deps.cropState = null;
    deps.cropDrag = null;
    deps.editDrawState = null;
    deps.resetEditDrawingHistory();
    deps.gridCustomDrag = null;
    deps.imageEditZoom = 1.0;
    deps.imageEditBaseW = 0;
    deps.imageEditBaseH = 0;
    deps.imageResizeScale = 0.5;
    deps.imageEditModeTouched = false;
    deps.cropAspectPreset = 'free';
    deps.cropAspectRatio = null;
    syncCropRatioButtons(deps);
    deps.document.getElementById('imageEditStage')?.classList.remove('overflowing', 'overflow-x', 'overflow-y');
    const cropCanvasEl = deps.document.getElementById('cropCanvas');
    cropCanvasEl.classList.remove('grid-custom-h', 'grid-custom-v', 'outpaint-mode', 'outpaint-warning', 'dragging-image', 'text-mode', 'resize-mode');
    cropCanvasEl.style.width = '';
    cropCanvasEl.style.height = '';
    const textCanvas = deps.editTextCanvas();
    if(textCanvas){
        textCanvas.style.left = '';
        textCanvas.style.top = '';
    }
}

function setImageEditMode(deps, mode, userTouched=false){
    if(userTouched) deps.imageEditModeTouched = true;
    const prevImageEditMode = deps.imageEditMode;
    if(mode !== 'brush') deps.removeEditTextInlineEditor(true);
    deps.imageEditMode = ['preview','crop','outpaint','mask','brush','resize','grid'].includes(mode) ? mode : 'crop';
    const isPreview = deps.imageEditMode === 'preview';
    const cropCanvasEl = deps.document.getElementById('cropCanvas');
    cropCanvasEl.classList.toggle('preview-mode', isPreview);
    cropCanvasEl.classList.toggle('mask-mode', deps.imageEditMode === 'mask');
    cropCanvasEl.classList.toggle('brush-mode', deps.imageEditMode === 'brush');
    cropCanvasEl.classList.toggle('resize-mode', deps.imageEditMode === 'resize');
    cropCanvasEl.classList.toggle('grid-mode', deps.imageEditMode === 'grid');
    cropCanvasEl.classList.toggle('outpaint-mode', deps.imageEditMode === 'outpaint');
    deps._syncGridCustomCursor();
    deps.document.querySelectorAll('[data-image-edit-mode]').forEach(btn => btn.classList.toggle('active', btn.dataset.imageEditMode === deps.imageEditMode));
    deps.document.getElementById('imageCropTools')?.classList.toggle('active', deps.imageEditMode === 'crop');
    deps.document.getElementById('imageMaskTools').classList.toggle('active', deps.imageEditMode === 'mask');
    deps.document.getElementById('imageBrushTools').classList.toggle('active', deps.imageEditMode === 'brush');
    deps.document.getElementById('imageResizeTools')?.classList.toggle('active', deps.imageEditMode === 'resize');
    deps.document.getElementById('imageGridTools').classList.toggle('active', deps.imageEditMode === 'grid');
    deps.syncGridGapValue();
    syncImageResizeControls(deps);
    const title = deps.document.getElementById('imageEditTitle');
    const sub = deps.document.getElementById('imageEditSub');
    const apply = deps.document.getElementById('imageEditApplyBtn');
    if(isPreview){
        apply.style.display = 'none';
        title.textContent = deps.tr('canvas.previewImage');
        sub.textContent = deps.tr('canvas.previewHint');
    } else {
        apply.style.display = '';
        if(deps.imageEditMode === 'resize'){
            title.textContent = '缩放图片';
            sub.textContent = '选择缩小倍数，应用会替换当前原图';
            apply.innerHTML = `<i data-lucide="minimize-2" class="w-4 h-4"></i><span>应用缩放</span>`;
        } else {
            const icon = deps.imageEditMode === 'crop' ? 'crop' : deps.imageEditMode === 'outpaint' ? 'expand' : deps.imageEditMode === 'mask' ? 'brush' : deps.imageEditMode === 'brush' ? 'paintbrush' : 'grid-3x3';
            const labelKey = deps.imageEditMode === 'crop' ? 'canvas.applyCrop' : deps.imageEditMode === 'outpaint' ? 'canvas.applyOutpaint' : deps.imageEditMode === 'mask' ? 'canvas.applyMask' : deps.imageEditMode === 'brush' ? 'canvas.applyBrush' : 'canvas.applyGrid';
            const titleKey = deps.imageEditMode === 'crop' ? 'canvas.cropImage' : deps.imageEditMode === 'outpaint' ? 'canvas.outpaintImage' : deps.imageEditMode === 'mask' ? 'canvas.maskEdit' : deps.imageEditMode === 'brush' ? 'canvas.brushEdit' : 'canvas.modeGrid';
            const subKey = deps.imageEditMode === 'crop' ? 'canvas.cropHint' : deps.imageEditMode === 'outpaint' ? 'canvas.outpaintHint' : deps.imageEditMode === 'mask' ? 'canvas.maskHint2' : deps.imageEditMode === 'brush' ? 'canvas.brushHint' : 'canvas.gridHint';
            title.textContent = deps.tr(titleKey);
            sub.textContent = deps.tr(subKey);
            apply.innerHTML = `<i data-lucide="${icon}" class="w-4 h-4"></i><span>${deps.tr(labelKey)}</span>`;
        }
    }
    deps.resizeEditDrawCanvas();
    if(isPreview) deps.clearEditDrawing(true);
    else if(deps.imageEditMode === 'grid') deps.refreshGridSplitPreview();
    else if(deps.imageEditMode === 'outpaint') resetOutpaintBox(deps);
    else if(deps.imageEditMode === 'crop' || deps.imageEditMode === 'resize') deps.clearEditDrawing(true);
    else if(prevImageEditMode === 'grid') deps.clearEditDrawing(true); // 离开 grid 时主动清掉画布上残留的分割线预览
    deps.syncEditDrawingHistoryButtons();
    deps.syncBrushToolButtons();
    deps.syncTextToolState(true);
    deps.refreshIcons();
}

function clampCrop(deps){
    if(!deps.cropState) return;
    if(deps.imageEditMode === 'outpaint') return clampOutpaint(deps);
    const {w, h} = cropBounds(deps);
    deps.cropState.w = Math.max(24, Math.min(deps.cropState.w, w));
    deps.cropState.h = Math.max(24, Math.min(deps.cropState.h, h));
    deps.cropState.x = Math.max(0, Math.min(deps.cropState.x, w - deps.cropState.w));
    deps.cropState.y = Math.max(0, Math.min(deps.cropState.y, h - deps.cropState.h));
}

function beginCropDrag(deps, event, mode){
    if(!deps.cropState) return;
    event.preventDefault();
    event.stopPropagation();
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
    const corner = /[ns][ew]/.test(handle);
    if(corner){
        if(width / height > ratio) width = height * ratio;
        else height = width / ratio;
    } else if(handle === 'e' || handle === 'w'){
        height = width / ratio;
    } else {
        width = height * ratio;
    }
    const dirX = handle.includes('w') ? -1 : 1;
    const dirY = handle.includes('n') ? -1 : 1;
    const maxW = dirX < 0 ? anchorX : boundsW - anchorX;
    const maxH = dirY < 0 ? anchorY : boundsH - anchorY;
    width = Math.min(width, maxW);
    height = Math.min(height, maxH);
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
    let anchorX = normalized.includes('w') ? start.x + start.w : normalized.includes('e') ? start.x : centerX;
    let anchorY = normalized.includes('n') ? start.y + start.h : normalized.includes('s') ? start.y : centerY;
    let movingX = normalized.includes('w') ? start.x + dx : normalized.includes('e') ? start.x + start.w + dx : centerX;
    let movingY = normalized.includes('n') ? start.y + dy : normalized.includes('s') ? start.y + start.h + dy : centerY;
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
    let node = deps.nodes.find(n => n.id === deps.cropState.nodeId);
    const img = deps.document.getElementById('cropImage');
    if(!node || !img.naturalWidth || !img.naturalHeight) return;
    const scaleX = img.naturalWidth / (img.clientWidth || 1);
    const scaleY = img.naturalHeight / (img.clientHeight || 1);
    const sx = Math.max(0, Math.round(deps.cropState.x * scaleX));
    const sy = Math.max(0, Math.round(deps.cropState.y * scaleY));
    const sw = Math.max(1, Math.round(deps.cropState.w * scaleX));
    const sh = Math.max(1, Math.round(deps.cropState.h * scaleY));
    const canvasEl = deps.document.createElement('canvas');
    canvasEl.width = sw;
    canvasEl.height = sh;
    canvasEl.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    const blob = await new Promise(resolve => canvasEl.toBlob(resolve, 'image/png'));
    if(!isCurrent()) return;
    if(!blob) return;
    const base = (node.name || 'image').replace(/\.[^.]+$/, '');
    const file = await deps.uploadCroppedBlob(blob, `${base}_crop.png`, isCurrent);
    if(!isCurrent()) return;
    node = deps.nodes.find(n => n.id === deps.cropState.nodeId);
    if(file){
        node.url = file.url;
        node.name = file.name;
        closeImageEditor(deps);
        deps.render();
        deps.scheduleSave();
    }
}

async function applyImageOutpaint(deps){
    const isCurrent=deps.captureImageEditContext();
    if(!isCurrent()) return;
    if(!deps.cropState) return;
    let node = deps.nodes.find(n => n.id === deps.cropState.nodeId);
    const img = deps.document.getElementById('cropImage');
    if(!node || !img.naturalWidth || !img.naturalHeight) return;
    clampOutpaint(deps);
    const scaleX = img.naturalWidth / (img.clientWidth || 1);
    const scaleY = img.naturalHeight / (img.clientHeight || 1);
    const outW = Math.max(img.naturalWidth, Math.round(deps.cropState.w * scaleX));
    const outH = Math.max(img.naturalHeight, Math.round(deps.cropState.h * scaleY));
    const dx = Math.round(deps.cropState.x * scaleX);
    const dy = Math.round(deps.cropState.y * scaleY);
    const canvasEl = deps.document.createElement('canvas');
    canvasEl.width = outW;
    canvasEl.height = outH;
    const ctx = canvasEl.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, outW, outH);
    ctx.drawImage(img, dx, dy, img.naturalWidth, img.naturalHeight);
    const blob = await new Promise(resolve => canvasEl.toBlob(resolve, 'image/png'));
    if(!isCurrent()) return;
    if(!blob) return;
    const base = (node.name || 'image').replace(/\.[^.]+$/, '');
    const file = await deps.uploadCroppedBlob(blob, `${base}_outpaint.png`, isCurrent);
    if(!isCurrent()) return;
    node = deps.nodes.find(n => n.id === deps.cropState.nodeId);
    if(file){
        node.url = file.url;
        node.name = file.name;
        node.mediaKind = 'image';
        node.natural_w = outW;
        node.natural_h = outH;
        closeImageEditor(deps);
        deps.render();
        deps.scheduleSave();
    }
}

async function applyImageResize(deps){
    const isCurrent=deps.captureImageEditContext();
    if(!isCurrent()) return;
    if(!deps.cropState) return;
    let node = deps.nodes.find(n => n.id === deps.cropState.nodeId);
    if(!node) return;
    let resized = null;
    try {
        resized = await resizedImageBlobFromEditor(deps);
        if(!isCurrent()) return;
    } catch(err) {
        if(!isCurrent()) return;
        deps.alert('缩放失败：当前图片无法写入画布，请换成本地图片或重新上传后再试。');
        return;
    }
    if(!resized?.blob) return;
    const base = (node.name || 'image').replace(/\.[^.]+$/, '');
    const suffix = `${Math.round(resized.scale * 100)}pct`;
    const file = await deps.uploadCroppedBlob(resized.blob, `${base}_resize_${suffix}.png`, isCurrent);
    if(!isCurrent()) return;
    node = deps.nodes.find(n => n.id === deps.cropState.nodeId);
    if(!file) return;
    node.url = file.url;
    node.name = file.name;
    node.mediaKind = 'image';
    node.natural_w = resized.targetW;
    node.natural_h = resized.targetH;
    closeImageEditor(deps);
    deps.render();
    deps.scheduleSave();
}

function applyImageEdit(deps){
    if(deps.imageEditMode === 'outpaint') return applyImageOutpaint(deps);
    if(deps.imageEditMode === 'mask') return deps.applyImageMask();
    if(deps.imageEditMode === 'brush') return deps.applyImageBrush();
    if(deps.imageEditMode === 'resize') return applyImageResize(deps);
    if(deps.imageEditMode === 'grid') return deps.applyImageGridSplit();
    return applyImageCrop(deps);
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
        if(!response.ok) throw new Error(data.detail || '上传失败');
        if(!Array.isArray(data.files) || data.files.length !== blobs.length || data.files.some(file => !file?.url)){
            throw new Error('图片上传不完整，请重试');
        }
        return data.files;
    } catch(err) {
        if(!isCurrent()) return [];
        deps.showErrorModal(err.message || '上传失败，请重试', '上传失败');
        return [];
    }
}

    const api={uploadCroppedBlob, uploadImageBlobs, cropBounds, cropDragModeFromPointer, clampImageResizeScale, imageResizeDimensions, syncImageResizeControls, setImageResizeScale, resizedImageBlobFromEditor, applyImageEditZoom, syncImageEditOverflow, resetImageEditZoom, renderCropBox, outpaintNaturalSize, updateOutpaintResolutionLabel, clampOutpaint, resetOutpaintBox, cropRatioFromPreset, syncCropRatioButtons, fitCropRectToAspect, setCropAspectPreset, resetCropBox, openImageEditor, closeImageEditor, setImageEditMode, clampCrop, beginCropDrag, resizeOutpaintFromDrag, clampAspectCropToBounds, resizeCropFromDrag, applyImageCrop, applyImageOutpaint, applyImageResize, applyImageEdit};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.CanvasImageEditor=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
