/* Editor drawing and text responsibility: canvas-editor-draw. Host supplies live state and effects. */
(function(root){
    'use strict';

function editDrawCanvas(deps){
    return deps.document.getElementById('editDrawCanvas');
}

function resizeEditDrawCanvas(deps){
    const img = deps.document.getElementById('cropImage');
    const canvasEl = editDrawCanvas(deps);
    const w = Math.max(1, img.naturalWidth || img.clientWidth || 1);
    const h = Math.max(1, img.naturalHeight || img.clientHeight || 1);
    if(canvasEl.width !== w || canvasEl.height !== h){
        canvasEl.width = w;
        canvasEl.height = h;
    }
    canvasEl.style.width = `${img.clientWidth || 1}px`;
    canvasEl.style.height = `${img.clientHeight || 1}px`;
    deps.resizeEditTextCanvas();
    if(deps.imageEditMode === 'grid') deps.refreshGridSplitPreview();
}

function editDrawSnapshot(deps){
    const canvasEl = editDrawCanvas(deps);
    return {
        imageData: canvasEl.getContext('2d').getImageData(0, 0, canvasEl.width, canvasEl.height),
        labelCounter: deps.brushLabelCounter,
        textItems: deps.editTextItems.map(item => ({...item})),
        textSelectedId: deps.editTextSelectedId || '',
    };
}

function restoreEditDrawSnapshot(deps, snapshot){
    if(!snapshot) return;
    deps.removeEditTextInlineEditor(false);
    const canvasEl = editDrawCanvas(deps);
    const imageData = snapshot.imageData || snapshot;
    canvasEl.getContext('2d').putImageData(imageData, 0, 0);
    if(snapshot.labelCounter) deps.brushLabelCounter = snapshot.labelCounter;
    deps.editTextItems = (snapshot.textItems || []).map(item => ({...item}));
    deps.editTextSelectedId = snapshot.textSelectedId || '';
    deps.renderEditTextCanvas();
    deps.syncTextToolState(true);
}

function pushEditDrawHistory(deps){
    deps.editDrawUndoStack.push(editDrawSnapshot(deps));
    if(deps.editDrawUndoStack.length > deps.EDIT_DRAW_HISTORY_MAX) deps.editDrawUndoStack.shift();
    deps.editDrawRedoStack = [];
    syncEditDrawingHistoryButtons(deps);
}

function syncEditDrawingHistoryButtons(deps){
    ['maskUndoBtn','brushUndoBtn'].forEach(id => {
        const btn = deps.document.getElementById(id);
        if(btn){ btn.disabled = !deps.editDrawUndoStack.length; btn.style.opacity = deps.editDrawUndoStack.length ? '1' : '.42'; }
    });
    ['maskRedoBtn','brushRedoBtn'].forEach(id => {
        const btn = deps.document.getElementById(id);
        if(btn){ btn.disabled = !deps.editDrawRedoStack.length; btn.style.opacity = deps.editDrawRedoStack.length ? '1' : '.42'; }
    });
}

function undoEditDrawing(deps){
    if(!deps.editDrawUndoStack.length) return;
    deps.editDrawRedoStack.push(editDrawSnapshot(deps));
    restoreEditDrawSnapshot(deps, deps.editDrawUndoStack.pop());
    syncEditDrawingHistoryButtons(deps);
}

function redoEditDrawing(deps){
    if(!deps.editDrawRedoStack.length) return;
    deps.editDrawUndoStack.push(editDrawSnapshot(deps));
    restoreEditDrawSnapshot(deps, deps.editDrawRedoStack.pop());
    syncEditDrawingHistoryButtons(deps);
}

function clearEditDrawing(deps, silent=false){
    deps.removeEditTextInlineEditor(false);
    const canvasEl = editDrawCanvas(deps);
    if(!silent && editCanvasHasPixels(deps)) pushEditDrawHistory(deps);
    canvasEl.getContext('2d').clearRect(0, 0, canvasEl.width, canvasEl.height);
    const textCanvasEl = deps.editTextCanvas();
    textCanvasEl?.getContext('2d')?.clearRect(0, 0, textCanvasEl.width, textCanvasEl.height);
    deps.editTextItems = [];
    deps.editTextSelectedId = '';
    deps.editTextDrag = null;
    deps.editTextDirty = false;
    deps.brushLabelCounter = 1;
    deps.syncTextToolState(true);
    syncEditDrawingHistoryButtons(deps);
}

function resetEditDrawingHistory(deps){
    deps.removeEditTextInlineEditor(false);
    deps.editDrawUndoStack = [];
    deps.editDrawRedoStack = [];
    deps.brushLabelCounter = 1;
    deps.editTextItems = [];
    deps.editTextSelectedId = '';
    deps.editTextDrag = null;
    deps.editTextDirty = false;
    deps.renderEditTextCanvas();
    deps.syncTextToolState(true);
    syncEditDrawingHistoryButtons(deps);
}

function setBrushTool(deps, tool){
    if(tool !== 'text') deps.removeEditTextInlineEditor(true);
    deps.brushTool = ['free','rect','ellipse','label','text'].includes(tool) ? tool : 'free';
    syncBrushToolButtons(deps);
    deps.syncTextToolState(true);
}

function syncBrushToolButtons(deps){
    deps.document.querySelectorAll('[data-brush-tool]').forEach(btn => {
        const active = btn.dataset.brushTool === deps.brushTool;
        btn.classList.toggle('primary', active);
        btn.classList.toggle('secondary', !active);
    });
    const cropCanvasEl = deps.document.getElementById('cropCanvas');
    cropCanvasEl?.classList.toggle('text-mode', deps.imageEditMode === 'brush' && deps.brushTool === 'text');
}

function editDrawPoint(deps, event){
    const canvasEl = editDrawCanvas(deps);
    const rect = canvasEl.getBoundingClientRect();
    return {
        x:(event.clientX - rect.left) * canvasEl.width / Math.max(1, rect.width),
        y:(event.clientY - rect.top) * canvasEl.height / Math.max(1, rect.height),
    };
}

function editBrushSize(deps){
    const id = deps.imageEditMode === 'mask' ? 'maskBrushSize' : 'paintBrushSize';
    return Number(deps.document.getElementById(id)?.value || 20);
}

function brushColor(deps){
    return deps.document.getElementById('paintBrushColor')?.value || '#ff2d55';
}

function setupDrawStyle(deps, ctx){
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = editBrushSize(deps);
    ctx.strokeStyle = deps.imageEditMode === 'mask' ? deps.MASK_BRUSH_COLOR : brushColor(deps);
    ctx.fillStyle = deps.imageEditMode === 'mask' ? deps.MASK_BRUSH_COLOR : brushColor(deps);
    ctx.globalCompositeOperation = 'source-over';
}

function normalizeMaskPreviewCanvas(deps, canvasEl=editDrawCanvas(deps)){
    if(deps.imageEditMode !== 'mask' || !canvasEl?.width || !canvasEl?.height) return;
    const ctx = canvasEl.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height);
    const data = imageData.data;
    let changed = false;
    for(let i = 0; i < data.length; i += 4){
        if(data[i + 3] <= 0) continue;
        data[i] = 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
        if(data[i + 3] > deps.MASK_BRUSH_ALPHA) data[i + 3] = deps.MASK_BRUSH_ALPHA;
        changed = true;
    }
    if(changed) ctx.putImageData(imageData, 0, 0);
}

function circledNumber(deps, n){
    if(n >= 1 && n <= 20) return String.fromCharCode(0x2460 + n - 1);
    return String(n);
}

function drawBrushShape(deps, ctx, start, end, preview=false){
    setupDrawStyle(deps, ctx);
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const w = Math.abs(end.x - start.x);
    const h = Math.abs(end.y - start.y);
    if(deps.brushTool === 'rect'){
        ctx.strokeRect(x, y, w, h);
    } else if(deps.brushTool === 'ellipse'){
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h / 2, Math.max(1, w / 2), Math.max(1, h / 2), 0, 0, Math.PI * 2);
        ctx.stroke();
    }
}

function drawNumberLabel(deps, point){
    const canvasEl = editDrawCanvas(deps);
    const ctx = canvasEl.getContext('2d');
    const size = Math.max(18, editBrushSize(deps) * 2.2);
    const text = circledNumber(deps, deps.brushLabelCounter++);
    setupDrawStyle(deps, ctx);
    ctx.save();
    ctx.font = `900 ${size}px Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(3, size / 8);
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.strokeText(text, point.x, point.y);
    ctx.fillStyle = brushColor(deps);
    ctx.fillText(text, point.x, point.y);
    ctx.restore();
}

function beginEditDraw(deps, event){
    if(deps.imageEditMode === 'crop') return;
    if(deps.imageEditMode === 'grid'){
        if(!deps.gridCustomMode) return;
        // 自定义模式：拖动已有线，或点击空白处放置新线
        event.preventDefault();
        event.stopPropagation();
        const canvasEl = editDrawCanvas(deps);
        canvasEl.setPointerCapture?.(event.pointerId);
        const point = editDrawPoint(deps, event);
        const hitIndex = deps.gridCustomLineHit(point);
        deps.gridCustomHistory.push([...deps.gridCustomLines.map(line => ({...line}))]);
        if(hitIndex >= 0){
            deps.gridCustomDrag = {index: hitIndex, pointerId: event.pointerId};
            deps.setGridCustomLinePos(hitIndex, point);
            deps.refreshGridSplitPreview();
            deps._syncGridCustomUndoBtn();
            return;
        }
        const rect = canvasEl.getBoundingClientRect();
        const fracX = Math.max(0.001, Math.min(0.999, (event.clientX - rect.left) / rect.width));
        const fracY = Math.max(0.001, Math.min(0.999, (event.clientY - rect.top) / rect.height));
        deps.gridCustomLines.push({type: deps.gridCustomOrientation, pos: deps.gridCustomOrientation === 'h' ? fracY : fracX});
        deps.gridCustomDrag = {index: deps.gridCustomLines.length - 1, pointerId: event.pointerId};
        deps._syncGridCustomUndoBtn();
        deps.refreshGridSplitPreview();
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    const canvasEl = editDrawCanvas(deps);
    canvasEl.setPointerCapture?.(event.pointerId);
    const ctx = canvasEl.getContext('2d');
    const p = editDrawPoint(deps, event);
    pushEditDrawHistory(deps);
    if(deps.imageEditMode === 'brush' && deps.brushTool === 'label'){
        drawNumberLabel(deps, p);
        deps.editDrawState = null;
        canvasEl.releasePointerCapture?.(event.pointerId);
        syncEditDrawingHistoryButtons(deps);
        return;
    }
    deps.editDrawState = {x:p.x, y:p.y, sx:p.x, sy:p.y, pointerId:event.pointerId, snapshot:(deps.imageEditMode === 'brush' && deps.brushTool !== 'free') ? editDrawSnapshot(deps) : null};
    setupDrawStyle(deps, ctx);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + 0.01, p.y + 0.01);
    if(deps.imageEditMode === 'mask' || deps.brushTool === 'free') ctx.stroke();
    normalizeMaskPreviewCanvas(deps, canvasEl);
}

function moveEditDraw(deps, event){
    if(deps.imageEditMode === 'grid' && deps.gridCustomMode && deps.gridCustomDrag){
        event.preventDefault();
        event.stopPropagation();
        deps.setGridCustomLinePos(deps.gridCustomDrag.index, editDrawPoint(deps, event));
        deps.refreshGridSplitPreview();
        return;
    }
    if(!deps.editDrawState || deps.imageEditMode === 'crop' || deps.imageEditMode === 'grid') return;
    event.preventDefault();
    event.stopPropagation();
    const ctx = editDrawCanvas(deps).getContext('2d');
    const p = editDrawPoint(deps, event);
    if(deps.imageEditMode === 'brush' && deps.brushTool !== 'free'){
        restoreEditDrawSnapshot(deps, deps.editDrawState.snapshot);
        drawBrushShape(deps, ctx, {x:deps.editDrawState.sx, y:deps.editDrawState.sy}, p, true);
        return;
    }
    setupDrawStyle(deps, ctx);
    ctx.beginPath();
    ctx.moveTo(deps.editDrawState.x, deps.editDrawState.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    deps.editDrawState.x = p.x;
    deps.editDrawState.y = p.y;
    normalizeMaskPreviewCanvas(deps);
}

function endEditDraw(deps, event){
    if(deps.editDrawState && event?.pointerId != null) editDrawCanvas(deps).releasePointerCapture?.(event.pointerId);
    if(deps.gridCustomDrag && event?.pointerId != null) editDrawCanvas(deps).releasePointerCapture?.(event.pointerId);
    deps.editDrawState = null;
    deps.gridCustomDrag = null;
    syncEditDrawingHistoryButtons(deps);
}

function editCanvasHasPixels(deps){
    if(deps.editTextHasContent()) return true;
    const canvasEl = editDrawCanvas(deps);
    const data = canvasEl.getContext('2d').getImageData(0, 0, canvasEl.width, canvasEl.height).data;
    for(let i = 3; i < data.length; i += 4) if(data[i] > 0) return true;
    return false;
}

async function applyImageMask(deps){
    const isCurrent=deps.captureImageEditContext();
    if(!isCurrent()) return;
    if(!deps.cropState) return;
    let node = deps.nodes.find(n => n.id === deps.cropState.nodeId);
    if(!node || !editCanvasHasPixels(deps)) return;
    const mask = maskCanvasFromDrawCanvas(deps, editDrawCanvas(deps));
    const blob = await new Promise(resolve => mask.toBlob(resolve, 'image/png'));
    if(!isCurrent()) return;
    if(!blob) return;
    const base = (node.name || 'image').replace(/\.[^.]+$/, '');
    const file = await deps.uploadCroppedBlob(blob, `${base}_mask.png`, isCurrent);
    if(!isCurrent()) return;
    node = deps.nodes.find(n => n.id === deps.cropState.nodeId);
    if(file){
        deps.addGeneratedImageNode(file, node, 'mask', 28, {role:'mask'});
        deps.closeImageEditor();
        deps.render();
        deps.scheduleSave();
    }
}

function maskCanvasFromDrawCanvas(deps, src){
    const mask = deps.document.createElement('canvas');
    mask.width = src.width;
    mask.height = src.height;
    const srcCtx = src.getContext('2d');
    const srcData = srcCtx.getImageData(0, 0, src.width, src.height);
    const ctx = mask.getContext('2d');
    const out = ctx.createImageData(mask.width, mask.height);
    for(let i = 0; i < srcData.data.length; i += 4){
        const painted = srcData.data[i + 3] > 8;
        const v = painted ? 255 : 0;
        out.data[i] = v;
        out.data[i + 1] = v;
        out.data[i + 2] = v;
        out.data[i + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
    return mask;
}

async function applyImageBrush(deps){
    const isCurrent=deps.captureImageEditContext();
    if(!isCurrent()) return;
    if(!deps.cropState) return;
    deps.removeEditTextInlineEditor(true);
    let node = deps.nodes.find(n => n.id === deps.cropState.nodeId);
    const img = deps.document.getElementById('cropImage');
    if(!node || !img.naturalWidth || !img.naturalHeight || !editCanvasHasPixels(deps)) return;
    const canvasEl = deps.document.createElement('canvas');
    canvasEl.width = img.naturalWidth;
    canvasEl.height = img.naturalHeight;
    const ctx = canvasEl.getContext('2d');
    ctx.drawImage(img, 0, 0, canvasEl.width, canvasEl.height);
    ctx.drawImage(editDrawCanvas(deps), 0, 0);
    ctx.drawImage(deps.editTextCanvas(), 0, 0);
    const blob = await new Promise(resolve => canvasEl.toBlob(resolve, 'image/png'));
    if(!isCurrent()) return;
    if(!blob) return;
    const base = (node.name || 'image').replace(/\.[^.]+$/, '');
    const file = await deps.uploadCroppedBlob(blob, `${base}_paint.png`, isCurrent);
    if(!isCurrent()) return;
    node = deps.nodes.find(n => n.id === deps.cropState.nodeId);
    if(file){
        node.url = file.url;
        node.name = file.name;
        deps.closeImageEditor();
        deps.render();
        deps.scheduleSave();
    }
}

    const api={editDrawCanvas, resizeEditDrawCanvas, editDrawSnapshot, restoreEditDrawSnapshot, pushEditDrawHistory, syncEditDrawingHistoryButtons, undoEditDrawing, redoEditDrawing, clearEditDrawing, resetEditDrawingHistory, setBrushTool, syncBrushToolButtons, editDrawPoint, editBrushSize, brushColor, setupDrawStyle, normalizeMaskPreviewCanvas, circledNumber, drawBrushShape, drawNumberLabel, beginEditDraw, moveEditDraw, endEditDraw, editCanvasHasPixels, applyImageMask, maskCanvasFromDrawCanvas, applyImageBrush};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.CanvasEditorDraw=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
