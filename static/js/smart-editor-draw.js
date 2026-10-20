/* Editor drawing and text responsibility: smart-editor-draw. Host supplies live state and effects. */
(function(root){
    'use strict';

function editDrawCanvas(deps){ return deps.document.getElementById('editDrawCanvas'); }

function resizeEditDrawCanvas(deps){
    const img = deps.document.getElementById('cropImage');
    const canvasEl = editDrawCanvas(deps);
    const display = deps.cropImageDisplaySize();
    const w = Math.max(1, img.naturalWidth || img.clientWidth || 1);
    const h = Math.max(1, img.naturalHeight || img.clientHeight || 1);
    if(canvasEl.width !== w || canvasEl.height !== h){ canvasEl.width = w; canvasEl.height = h; }
    canvasEl.style.width = `${display.w}px`;
    canvasEl.style.height = `${display.h}px`;
    deps.resizeEditTextCanvas();
    if(deps.imageEditMode === 'grid') deps.refreshGridSplitPreview();
}

function editDrawSnapshot(deps){
    const canvasEl = editDrawCanvas(deps);
    return {
        imageData:canvasEl.getContext('2d').getImageData(0, 0, canvasEl.width, canvasEl.height),
        labelCounter:deps.brushLabelCounter,
        textItems:deps.editTextItems.map(item => ({...item})),
        textSelectedId:deps.editTextSelectedId || ''
    };
}

function restoreEditDrawSnapshot(deps, snapshot){
    if(!snapshot) return;
    deps.removeEditTextInlineEditor(false);
    editDrawCanvas(deps).getContext('2d').putImageData(snapshot.imageData || snapshot, 0, 0);
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
    ['maskUndoBtn','brushUndoBtn'].forEach(id => { const btn = deps.document.getElementById(id); if(btn){ btn.disabled = !deps.editDrawUndoStack.length; btn.style.opacity = deps.editDrawUndoStack.length ? '1' : '.42'; } });
    ['maskRedoBtn','brushRedoBtn'].forEach(id => { const btn = deps.document.getElementById(id); if(btn){ btn.disabled = !deps.editDrawRedoStack.length; btn.style.opacity = deps.editDrawRedoStack.length ? '1' : '.42'; } });
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
    deps.document.getElementById('cropCanvas')?.classList.toggle('text-mode', deps.imageEditMode === 'brush' && deps.brushTool === 'text');
}

function editDrawPoint(deps, event){
    const canvasEl = editDrawCanvas(deps);
    const rect = canvasEl.getBoundingClientRect();
    return {x:(event.clientX - rect.left) * canvasEl.width / Math.max(1, rect.width), y:(event.clientY - rect.top) * canvasEl.height / Math.max(1, rect.height)};
}

function editBrushSize(deps){ return Number(deps.document.getElementById(deps.imageEditMode === 'mask' ? 'maskBrushSize' : 'paintBrushSize')?.value || 20); }

function brushColor(deps){ return deps.document.getElementById('paintBrushColor')?.value || '#ff2d55'; }

function setupDrawStyle(deps, ctx){
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = editBrushSize(deps);
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

function circledNumber(deps, n){ return n >= 1 && n <= 20 ? String.fromCharCode(0x2460 + n - 1) : String(n); }

function drawBrushShape(deps, ctx, start, end){
    setupDrawStyle(deps, ctx);
    const x = Math.min(start.x, end.x), y = Math.min(start.y, end.y), w = Math.abs(end.x - start.x), h = Math.abs(end.y - start.y);
    if(deps.brushTool === 'rect') ctx.strokeRect(x, y, w, h);
    else if(deps.brushTool === 'ellipse'){ ctx.beginPath(); ctx.ellipse(x + w / 2, y + h / 2, Math.max(1, w / 2), Math.max(1, h / 2), 0, 0, Math.PI * 2); ctx.stroke(); }
}

function drawNumberLabel(deps, point){
    const ctx = editDrawCanvas(deps).getContext('2d');
    const size = Math.max(18, editBrushSize(deps) * 2.2);
    const text = circledNumber(deps, deps.brushLabelCounter++);
    setupDrawStyle(deps, ctx);
    ctx.save(); ctx.font = `900 ${size}px Arial, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = Math.max(3, size / 8);
    ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.strokeText(text, point.x, point.y); ctx.fillStyle = brushColor(deps); ctx.fillText(text, point.x, point.y); ctx.restore();
}

function beginEditDraw(deps, event){
    if(deps.imageEditMode === 'crop') return;
    event.preventDefault(); event.stopPropagation();
    const canvasEl = editDrawCanvas(deps);
    canvasEl.setPointerCapture?.(event.pointerId);
    const p = editDrawPoint(deps, event);
    if(deps.imageEditMode === 'grid'){
        if(deps.gridOperationMode === 'join') return;
        if(!deps.gridCustomMode) return;
        const hit = deps.gridCustomLineHit(p);
        deps.gridCustomHistory.push([...deps.gridCustomLines.map(line => ({...line}))]);
        if(hit >= 0){ deps.gridCustomDrag = {index:hit, pointerId:event.pointerId}; deps.setGridCustomLinePos(hit, p); }
        else { deps.gridCustomLines.push({type:deps.gridCustomOrientation, pos:deps.gridCustomOrientation === 'h' ? p.y / canvasEl.height : p.x / canvasEl.width}); deps.gridCustomDrag = {index:deps.gridCustomLines.length - 1, pointerId:event.pointerId}; }
        deps.syncGridCustomUndoBtn(); deps.refreshGridSplitPreview(); return;
    }
    const ctx = canvasEl.getContext('2d');
    pushEditDrawHistory(deps);
    if(deps.imageEditMode === 'brush' && deps.brushTool === 'label'){ drawNumberLabel(deps, p); deps.editDrawState = null; canvasEl.releasePointerCapture?.(event.pointerId); return; }
    deps.editDrawState = {x:p.x, y:p.y, sx:p.x, sy:p.y, pointerId:event.pointerId, snapshot:(deps.imageEditMode === 'brush' && deps.brushTool !== 'free') ? editDrawSnapshot(deps) : null};
    setupDrawStyle(deps, ctx);
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + .01, p.y + .01);
    if(deps.imageEditMode === 'mask' || deps.brushTool === 'free') ctx.stroke();
    normalizeMaskPreviewCanvas(deps, canvasEl);
}

function moveEditDraw(deps, event){
    if(deps.imageEditMode === 'grid' && deps.gridOperationMode === 'join') return;
    if(deps.imageEditMode === 'grid' && deps.gridCustomMode && deps.gridCustomDrag){ event.preventDefault(); event.stopPropagation(); deps.setGridCustomLinePos(deps.gridCustomDrag.index, editDrawPoint(deps, event)); deps.refreshGridSplitPreview(); return; }
    if(!deps.editDrawState || deps.imageEditMode === 'crop' || deps.imageEditMode === 'grid') return;
    event.preventDefault(); event.stopPropagation();
    const ctx = editDrawCanvas(deps).getContext('2d');
    const p = editDrawPoint(deps, event);
    if(deps.imageEditMode === 'brush' && deps.brushTool !== 'free'){ restoreEditDrawSnapshot(deps, deps.editDrawState.snapshot); drawBrushShape(deps, ctx, {x:deps.editDrawState.sx, y:deps.editDrawState.sy}, p); return; }
    const events = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
    if(events.length){
        events.forEach(ev => strokeFreeDrawPoint(deps, editDrawPoint(deps, ev)));
    } else {
        strokeFreeDrawPoint(deps, p);
    }
    normalizeMaskPreviewCanvas(deps);
}

function endEditDraw(deps, event){
    if(deps.editDrawState && event?.pointerId != null) editDrawCanvas(deps).releasePointerCapture?.(event.pointerId);
    if(deps.gridCustomDrag && event?.pointerId != null) editDrawCanvas(deps).releasePointerCapture?.(event.pointerId);
    deps.editDrawState = null; deps.gridCustomDrag = null; syncEditDrawingHistoryButtons(deps);
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
    if(!deps.cropState || !editCanvasHasPixels(deps)) return;
    let {node, image} = deps.currentEditImage();
    if(!node || !image) return;
    const mask = maskCanvasFromDrawCanvas(deps, editDrawCanvas(deps));
    const blob = await new Promise(resolve => mask.toBlob(resolve, 'image/png'));
    if(!isCurrent()) return;
    const base = (image.name || 'image').replace(/\.[^.]+$/, '');
    const file = blob ? await deps.uploadCroppedBlob(blob, `${base}_mask.png`, isCurrent) : null;
    if(!isCurrent()) return;
    node = deps.currentEditImage().node;
    if(file){
        node.images.push({url:file.url, name:file.name, role:'mask'});
        deps.selectedId = node.id; deps.selectedImage = {nodeId:node.id, index:node.images.length - 1};
        deps.closeImageEditor(); deps.render(); deps.scheduleSave();
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
    if(!editCanvasHasPixels(deps)) return;
    const {node, image} = deps.currentEditImage();
    const img = deps.document.getElementById('cropImage');
    if(!node || !image || !img.naturalWidth || !img.naturalHeight) return;
    const canvasEl = deps.document.createElement('canvas');
    canvasEl.width = img.naturalWidth; canvasEl.height = img.naturalHeight;
    const ctx = canvasEl.getContext('2d');
    ctx.drawImage(img, 0, 0, canvasEl.width, canvasEl.height); ctx.drawImage(editDrawCanvas(deps), 0, 0); ctx.drawImage(deps.editTextCanvas(), 0, 0);
    const blob = await new Promise(resolve => canvasEl.toBlob(resolve, 'image/png'));
    if(!isCurrent()) return;
    const base = (image.name || 'image').replace(/\.[^.]+$/, '');
    const file = blob ? await deps.uploadCroppedBlob(blob, `${base}_paint.png`, isCurrent) : null;
    if(!isCurrent()) return;
    if(file && deps.replaceEditedImage(file)){ deps.closeImageEditor(); deps.render(); deps.scheduleSave(); }
}

function strokeFreeDrawPoint(deps, point){
    if(!deps.editDrawState) return;
    const ctx = editDrawCanvas(deps).getContext('2d');
    setupDrawStyle(deps, ctx);
    const dx = point.x - deps.editDrawState.x;
    const dy = point.y - deps.editDrawState.y;
    const dist = Math.hypot(dx, dy);
    const radius = Math.max(1, editBrushSize(deps) / 2);
    if(dist > radius){
        const steps = Math.ceil(dist / Math.max(1, radius * 0.35));
        for(let i = 1; i <= steps; i++){
            const t = i / steps;
            const x = deps.editDrawState.x + dx * t;
            const y = deps.editDrawState.y + dy * t;
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    ctx.beginPath();
    ctx.moveTo(deps.editDrawState.x, deps.editDrawState.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    deps.editDrawState.x = point.x;
    deps.editDrawState.y = point.y;
}

    const api={editDrawCanvas, resizeEditDrawCanvas, editDrawSnapshot, restoreEditDrawSnapshot, pushEditDrawHistory, syncEditDrawingHistoryButtons, undoEditDrawing, redoEditDrawing, clearEditDrawing, resetEditDrawingHistory, setBrushTool, syncBrushToolButtons, editDrawPoint, editBrushSize, brushColor, setupDrawStyle, normalizeMaskPreviewCanvas, circledNumber, drawBrushShape, drawNumberLabel, beginEditDraw, moveEditDraw, endEditDraw, editCanvasHasPixels, applyImageMask, maskCanvasFromDrawCanvas, applyImageBrush, strokeFreeDrawPoint};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.SmartEditorDraw=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
