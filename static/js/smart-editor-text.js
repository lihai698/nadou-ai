/* Editor drawing and text responsibility: smart-editor-text. Host supplies live state and effects. */
(function(root){
    'use strict';

function editTextCanvas(deps){ return deps.document.getElementById('editTextCanvas'); }

function editTextContext(deps){ return editTextCanvas(deps)?.getContext('2d') || null; }

function selectedEditTextItem(deps){ return deps.editTextItems.find(item => item.id === deps.editTextSelectedId) || null; }

function defaultEditTextText(deps){ return deps.window.StudioI18n?.lang?.() === 'en' ? 'Double-click to edit' : '双击编辑'; }

function editTextSizeFromBrush(deps){ return Math.max(14, Math.min(120, Math.round(deps.editBrushSize() * 2))); }

function createEditTextItem(deps, text, point, preset={}){
    const size = Math.max(10, Math.min(120, Number(preset.size) || editTextSizeFromBrush(deps)));
    return {id:deps.uid('txt'), text:String(text || defaultEditTextText(deps)).trim(), x:Number(point?.x || 0), y:Number(point?.y || 0), color:preset.color || deps.brushColor(), size};
}

function textItemFont(deps, item){
    const size = Math.max(10, Math.min(120, Number(item?.size) || 28));
    return `900 ${size}px Arial, sans-serif`;
}

function measureEditTextItem(deps, item, ctx=editTextContext(deps)){
    if(!item || !ctx) return {x:0, y:0, w:0, h:0};
    const size = Math.max(10, Math.min(120, Number(item.size) || 28));
    ctx.save();
    ctx.font = textItemFont(deps, item);
    const metrics = ctx.measureText(String(item.text || ''));
    ctx.restore();
    const width = Math.max(1, metrics.width || 1);
    const ascent = Number.isFinite(metrics.actualBoundingBoxAscent) ? metrics.actualBoundingBoxAscent : size * 0.8;
    const descent = Number.isFinite(metrics.actualBoundingBoxDescent) ? metrics.actualBoundingBoxDescent : size * 0.25;
    const pad = Math.max(4, Math.round(size * 0.18));
    return {x:item.x - width / 2 - pad, y:item.y - (ascent + descent) / 2 - pad, w:width + pad * 2, h:ascent + descent + pad * 2, textW:width, textH:ascent + descent, pad};
}

function hitEditTextItem(deps, point){
    const ctx = editTextContext(deps);
    if(!ctx) return null;
    for(let i = deps.editTextItems.length - 1; i >= 0; i--){
        const item = deps.editTextItems[i];
        const box = measureEditTextItem(deps, item, ctx);
        if(point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h) return item;
    }
    return null;
}

function renderEditTextCanvas(deps){
    const canvasEl = editTextCanvas(deps);
    const ctx = editTextContext(deps);
    if(!canvasEl || !ctx) return;
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    deps.editTextItems.forEach(item => {
        if(!item?.text) return;
        const selected = item.id === deps.editTextSelectedId;
        const box = measureEditTextItem(deps, item, ctx);
        ctx.save();
        ctx.font = textItemFont(deps, item);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = item.color || deps.brushColor();
        ctx.strokeStyle = 'rgba(255,255,255,.92)';
        ctx.lineWidth = Math.max(2, (Number(item.size) || 28) / 8);
        ctx.strokeText(String(item.text || ''), item.x, item.y);
        ctx.fillText(String(item.text || ''), item.x, item.y);
        if(selected){
            ctx.setLineDash([7, 5]);
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = 'rgba(15,23,42,.72)';
            ctx.strokeRect(box.x, box.y, box.w, box.h);
            ctx.setLineDash([]);
            ctx.fillStyle = 'rgba(15,23,42,.92)';
            ctx.beginPath();
            ctx.arc(item.x + box.w / 2 - box.pad, item.y - box.h / 2 + box.pad, 3.5, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    });
    positionEditTextInlineEditor(deps);
}

function syncTextToolState(deps, force=false){
    const cropCanvasEl = deps.document.getElementById('cropCanvas');
    cropCanvasEl?.classList.toggle('text-mode', deps.imageEditMode === 'brush' && deps.brushTool === 'text');
}

function syncSelectedEditTextStyleFromBrush(deps){
    if(deps.imageEditMode !== 'brush' || deps.brushTool !== 'text' || deps.editTextInlineEditor) return;
    const item = selectedEditTextItem(deps);
    if(!item) return;
    const nextSize = editTextSizeFromBrush(deps);
    const nextColor = deps.brushColor();
    if(item.size === nextSize && item.color === nextColor) return;
    beginTextEditChange(deps);
    item.size = nextSize;
    item.color = nextColor;
    renderEditTextCanvas(deps);
    syncTextToolState(deps, true);
}

function beginTextEditChange(deps){
    if(deps.editTextDirty) return;
    deps.pushEditDrawHistory();
    deps.editTextDirty = true;
}

function setSelectedEditTextItem(deps, id){
    deps.editTextSelectedId = id || '';
    renderEditTextCanvas(deps);
    syncTextToolState(deps, true);
}

function confirmSelectedEditTextItem(deps){
    const selected = selectedEditTextItem(deps);
    if(!selected) return false;
    if(!String(selected.text || '').trim()) deps.editTextItems = deps.editTextItems.filter(item => item.id !== selected.id);
    deps.editTextSelectedId = '';
    deps.editTextDrag = null;
    deps.editTextDirty = false;
    renderEditTextCanvas(deps);
    syncTextToolState(deps, true);
    return true;
}

function editTextCanvasScale(deps){
    const canvasEl = editTextCanvas(deps);
    const rect = canvasEl?.getBoundingClientRect?.();
    return {x:(rect?.width || canvasEl?.width || 1) / Math.max(1, canvasEl?.width || 1), y:(rect?.height || canvasEl?.height || 1) / Math.max(1, canvasEl?.height || 1), rect};
}

function selectInlineEditorText(deps, el){
    const range = deps.document.createRange();
    range.selectNodeContents(el);
    const sel = deps.window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
}

function inlineEditorText(deps){
    return String(deps.editTextInlineEditor?.el?.innerText || deps.editTextInlineEditor?.el?.textContent || '').replace(/\u00a0/g, ' ');
}

function autosizeEditTextInlineEditor(deps){
    const editor = deps.editTextInlineEditor;
    if(!editor?.el) return;
    const el = editor.el;
    el.style.width = 'auto';
    el.style.height = 'auto';
    el.style.width = `${Math.max(Number(editor.minW || 48), el.scrollWidth + 10)}px`;
    el.style.height = `${Math.max(Number(editor.minH || 28), el.scrollHeight + 4)}px`;
}

function positionEditTextInlineEditor(deps){
    const editor = deps.editTextInlineEditor;
    if(!editor?.el) return;
    const item = deps.editTextItems.find(x => x.id === editor.itemId);
    const canvasEl = editTextCanvas(deps);
    const cropCanvasEl = deps.document.getElementById('cropCanvas');
    if(!item || !canvasEl || !cropCanvasEl) return;
    const box = measureEditTextItem(deps, item, editTextContext(deps));
    const scale = editTextCanvasScale(deps);
    const hostRect = cropCanvasEl.getBoundingClientRect();
    const canvasRect = scale.rect || canvasEl.getBoundingClientRect();
    const left = canvasRect.left - hostRect.left + box.x * scale.x;
    const top = canvasRect.top - hostRect.top + box.y * scale.y;
    const w = Math.max(48, box.w * scale.x);
    const h = Math.max(28, box.h * scale.y);
    editor.minW = w;
    editor.minH = h;
    editor.el.style.left = `${left}px`;
    editor.el.style.top = `${top}px`;
    editor.el.style.minWidth = `${w}px`;
    editor.el.style.minHeight = `${h}px`;
    editor.el.style.font = `900 ${Math.max(10, (Number(item.size) || 28) * scale.y)}px Arial, sans-serif`;
    editor.el.style.color = item.color || deps.brushColor();
    autosizeEditTextInlineEditor(deps);
}

function removeEditTextInlineEditor(deps, commit=true){
    const editor = deps.editTextInlineEditor;
    if(!editor) return;
    const item = deps.editTextItems.find(x => x.id === editor.itemId);
    const next = inlineEditorText(deps).trim();
    deps.editTextInlineEditor = null;
    editor.el.remove();
    if(!item) return;
    if(commit){
        if(next !== String(editor.before || '')){
            beginTextEditChange(deps);
            if(next) item.text = next;
            else {
                deps.editTextItems = deps.editTextItems.filter(x => x.id !== item.id);
                deps.editTextSelectedId = '';
            }
        }
    } else {
        item.text = editor.before || item.text || defaultEditTextText(deps);
    }
    deps.editTextDirty = false;
    renderEditTextCanvas(deps);
    syncTextToolState(deps, true);
}

function beginEditTextInline(deps, item){
    if(!item) return;
    removeEditTextInlineEditor(deps, true);
    deps.editTextSelectedId = item.id;
    const host = deps.document.getElementById('cropCanvas');
    if(!host) return;
    const el = deps.document.createElement('div');
    el.className = 'edit-text-inline';
    el.contentEditable = 'true';
    el.spellcheck = false;
    el.textContent = item.text || defaultEditTextText(deps);
    host.appendChild(el);
    deps.editTextInlineEditor = {el, itemId:item.id, before:item.text || ''};
    positionEditTextInlineEditor(deps);
    el.addEventListener('input', (...args)=>autosizeEditTextInlineEditor(deps, ...args));
    el.addEventListener('keydown', event => {
        if(event.key === 'Enter' && !event.shiftKey){ event.preventDefault(); removeEditTextInlineEditor(deps, true); }
        else if(event.key === 'Escape'){ event.preventDefault(); removeEditTextInlineEditor(deps, false); }
    });
    el.addEventListener('blur', () => removeEditTextInlineEditor(deps, true));
    deps.requestAnimationFrame(() => { el.focus(); selectInlineEditorText(deps, el); });
    renderEditTextCanvas(deps);
    syncTextToolState(deps, true);
}

function editTextPoint(deps, event){ return deps.editDrawPoint(event); }

function beginEditText(deps, event){
    if(deps.imageEditMode !== 'brush' || deps.brushTool !== 'text') return;
    event.preventDefault(); event.stopPropagation();
    removeEditTextInlineEditor(deps, true);
    const canvasEl = editTextCanvas(deps);
    const point = editTextPoint(deps, event);
    const hit = hitEditTextItem(deps, point);
    if(hit){
        deps.editTextSelectedId = hit.id;
        deps.editTextDrag = {id:hit.id, pointerId:event.pointerId, startX:hit.x, startY:hit.y, sx:event.clientX, sy:event.clientY, moved:false, hasHistory:false};
        canvasEl.setPointerCapture?.(event.pointerId);
        canvasEl.style.cursor = 'grabbing';
        syncTextToolState(deps, true);
        renderEditTextCanvas(deps);
        return;
    }
    if(selectedEditTextItem(deps)){
        confirmSelectedEditTextItem(deps);
        return;
    }
    beginTextEditChange(deps);
    const item = createEditTextItem(deps, defaultEditTextText(deps), point, {color:deps.brushColor(), size:editTextSizeFromBrush(deps)});
    deps.editTextItems.push(item);
    deps.editTextSelectedId = item.id;
    canvasEl.style.cursor = 'text';
    renderEditTextCanvas(deps);
    syncTextToolState(deps, true);
}

function updateEditTextCursor(deps, event){
    const canvasEl = editTextCanvas(deps);
    if(!canvasEl || deps.imageEditMode !== 'brush' || deps.brushTool !== 'text') return;
    const hit = hitEditTextItem(deps, editTextPoint(deps, event));
    canvasEl.style.cursor = hit ? 'move' : 'text';
}

function moveEditText(deps, event){
    if(!deps.editTextDrag){
        updateEditTextCursor(deps, event);
        return;
    }
    event.preventDefault(); event.stopPropagation();
    const item = deps.editTextItems.find(x => x.id === deps.editTextDrag.id);
    if(!item) return;
    const dx = event.clientX - deps.editTextDrag.sx;
    const dy = event.clientY - deps.editTextDrag.sy;
    if(!deps.editTextDrag.moved && Math.abs(dx) + Math.abs(dy) < 2) return;
    deps.editTextDrag.moved = true;
    if(!deps.editTextDrag.hasHistory){
        beginTextEditChange(deps);
        deps.editTextDrag.hasHistory = true;
    }
    const canvasEl = editTextCanvas(deps);
    const rect = canvasEl?.getBoundingClientRect?.();
    const scaleX = canvasEl ? canvasEl.width / Math.max(1, rect?.width || canvasEl.width) : 1;
    const scaleY = canvasEl ? canvasEl.height / Math.max(1, rect?.height || canvasEl.height) : 1;
    item.x = deps.editTextDrag.startX + dx * scaleX;
    item.y = deps.editTextDrag.startY + dy * scaleY;
    renderEditTextCanvas(deps);
}

function endEditText(deps, event){
    if(deps.editTextDrag && event?.pointerId != null) editTextCanvas(deps)?.releasePointerCapture?.(event.pointerId);
    deps.editTextDrag = null;
    deps.editTextDirty = false;
    renderEditTextCanvas(deps);
    syncTextToolState(deps, true);
    if(event) updateEditTextCursor(deps, event);
}

function editTextHasContent(deps){ return deps.editTextItems.some(item => String(item?.text || '').trim().length > 0); }

function resizeEditTextCanvas(deps){
    const img = deps.document.getElementById('cropImage');
    const canvasEl = editTextCanvas(deps);
    if(!img || !canvasEl) return;
    const display = deps.cropImageDisplaySize();
    const w = Math.max(1, img.naturalWidth || img.clientWidth || 1);
    const h = Math.max(1, img.naturalHeight || img.clientHeight || 1);
    if(canvasEl.width !== w) canvasEl.width = w;
    if(canvasEl.height !== h) canvasEl.height = h;
    canvasEl.style.width = `${display.w}px`;
    canvasEl.style.height = `${display.h}px`;
    renderEditTextCanvas(deps);
}

    const api={editTextCanvas, editTextContext, selectedEditTextItem, defaultEditTextText, editTextSizeFromBrush, createEditTextItem, textItemFont, measureEditTextItem, hitEditTextItem, renderEditTextCanvas, syncTextToolState, syncSelectedEditTextStyleFromBrush, beginTextEditChange, setSelectedEditTextItem, confirmSelectedEditTextItem, editTextCanvasScale, selectInlineEditorText, inlineEditorText, autosizeEditTextInlineEditor, positionEditTextInlineEditor, removeEditTextInlineEditor, beginEditTextInline, editTextPoint, beginEditText, updateEditTextCursor, moveEditText, endEditText, editTextHasContent, resizeEditTextCanvas};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.SmartEditorText=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
