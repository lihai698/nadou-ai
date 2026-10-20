/* Editor grid responsibility: smart-editor-grid. Host supplies live state and effects. */
(function(root){
    'use strict';

function gridCustomLineHit(deps, point){
    const canvasEl = deps.editDrawCanvas();
    const threshold = Math.max(8, Math.min(canvasEl.width, canvasEl.height) / 80);
    let best = -1, bestDist = Infinity;
    deps.gridCustomLines.forEach((line, index) => {
        const dist = line.type === 'h' ? Math.abs(point.y - line.pos * canvasEl.height) : Math.abs(point.x - line.pos * canvasEl.width);
        if(dist < bestDist && dist <= threshold){ best = index; bestDist = dist; }
    });
    return best;
}

function setGridCustomLinePos(deps, index, point){
    const canvasEl = deps.editDrawCanvas();
    const line = deps.gridCustomLines[index];
    if(!line) return;
    line.pos = line.type === 'h'
        ? Math.max(0.001, Math.min(0.999, point.y / Math.max(1, canvasEl.height)))
        : Math.max(0.001, Math.min(0.999, point.x / Math.max(1, canvasEl.width)));
}

function syncGridGapValue(deps){
    const input = deps.document.getElementById('gridGapSize');
    const value = Math.max(0, Math.min(240, Number(input?.value || 0)));
    if(input) input.value = value;
    const label = deps.document.getElementById('gridGapValue');
    if(label) label.textContent = String(value);
    if(deps.gridJoinLayout && deps.gridOperationMode === 'join'){
        const rows = deps.gridJoinLayout.rows;
        const cols = deps.gridJoinLayout.cols;
        const order = gridJoinVisualOrder(deps);
        setGridJoinLayoutOrder(deps, order, rows, cols, value);
    }
    return value;
}

function gridSplitSettings(deps){
    const hLines = Math.max(0, Math.min(20, Number(deps.document.getElementById('gridHorizontalLines')?.value || 0)));
    const vLines = Math.max(0, Math.min(20, Number(deps.document.getElementById('gridVerticalLines')?.value || 0)));
    return {rows:hLines + 1, cols:vLines + 1, gap:syncGridGapValue(deps)};
}

function gridSplitRects(deps, width, height){
    if(deps.gridCustomMode) return gridSplitRectsCustom(deps, width, height);
    const {rows, cols, gap} = gridSplitSettings(deps);
    const halfGap = gap / 2, rects = [];
    for(let row = 0; row < rows; row++){
        const topLine = row * height / rows, bottomLine = (row + 1) * height / rows;
        const y1 = Math.round(row === 0 ? 0 : topLine + halfGap), y2 = Math.round(row === rows - 1 ? height : bottomLine - halfGap);
        for(let col = 0; col < cols; col++){
            const leftLine = col * width / cols, rightLine = (col + 1) * width / cols;
            const x1 = Math.round(col === 0 ? 0 : leftLine + halfGap), x2 = Math.round(col === cols - 1 ? width : rightLine - halfGap);
            if(x2 > x1 && y2 > y1) rects.push({row, col, x:x1, y:y1, w:x2 - x1, h:y2 - y1});
        }
    }
    return rects;
}

function gridSplitRectsCustom(deps, width, height){
    const gap = Math.max(0, Math.min(240, Number(deps.document.getElementById('gridGapSize')?.value || 0)));
    const halfGap = gap / 2;
    const rawH = [...new Set(deps.gridCustomLines.filter(l => l.type === 'h').map(l => l.pos * height))].sort((a, b) => a - b);
    const rawV = [...new Set(deps.gridCustomLines.filter(l => l.type === 'v').map(l => l.pos * width))].sort((a, b) => a - b);
    const hCuts = [0, ...rawH, height], vCuts = [0, ...rawV, width], rects = [];
    for(let row = 0; row < hCuts.length - 1; row++) for(let col = 0; col < vCuts.length - 1; col++){
        const y1 = Math.round(row === 0 ? hCuts[row] : hCuts[row] + halfGap), y2 = Math.round(row === hCuts.length - 2 ? hCuts[row + 1] : hCuts[row + 1] - halfGap);
        const x1 = Math.round(col === 0 ? vCuts[col] : vCuts[col] + halfGap), x2 = Math.round(col === vCuts.length - 2 ? vCuts[col + 1] : vCuts[col + 1] - halfGap);
        if(x2 > x1 && y2 > y1) rects.push({row, col, x:x1, y:y1, w:x2 - x1, h:y2 - y1});
    }
    return rects;
}

function gridLayoutFromRects(deps, rects){
    return {type:'grid-split', groupId:deps.uid('grid'), rows:Math.max(1, ...rects.map(r => Number(r.row || 0) + 1)), cols:Math.max(1, ...rects.map(r => Number(r.col || 0) + 1))};
}

function applyGridPreset(deps, rows, cols){
    deps.gridCustomMode = false; deps.gridCustomLines = []; deps.gridCustomHistory = []; deps.gridCustomDrag = null;
    const h = deps.document.getElementById('gridHorizontalLines'), v = deps.document.getElementById('gridVerticalLines');
    if(h){ h.disabled = false; h.value = String(Math.max(0, Number(rows || 1) - 1)); }
    if(v){ v.disabled = false; v.value = String(Math.max(0, Number(cols || 1) - 1)); }
    deps.document.getElementById('gridCustomToggle')?.classList.remove('primary');
    deps.document.getElementById('gridCustomToggle')?.classList.add('secondary');
    syncGridCustomControls(deps);
    syncGridCustomCursor(deps); syncGridCustomUndoBtn(deps); refreshGridSplitPreview(deps);
}

function toggleGridCustomMode(deps){
    deps.gridCustomMode = !deps.gridCustomMode;
    if(deps.gridCustomMode){ deps.gridCustomLines = []; deps.gridCustomHistory = []; }
    deps.gridCustomDrag = null;
    const toggle = deps.document.getElementById('gridCustomToggle');
    toggle.classList.toggle('primary', deps.gridCustomMode); toggle.classList.toggle('secondary', !deps.gridCustomMode);
    ['gridHorizontalLines','gridVerticalLines'].forEach(id => { const el = deps.document.getElementById(id); if(el) el.disabled = deps.gridCustomMode; });
    syncGridCustomControls(deps);
    syncGridCustomCursor(deps); syncGridCustomUndoBtn(deps); refreshGridSplitPreview(deps);
}

function setGridCustomOrientation(deps, orient){
    deps.gridCustomOrientation = orient;
    deps.document.getElementById('gridOrientH').classList.toggle('primary', orient === 'h');
    deps.document.getElementById('gridOrientH').classList.toggle('secondary', orient !== 'h');
    deps.document.getElementById('gridOrientV').classList.toggle('primary', orient === 'v');
    deps.document.getElementById('gridOrientV').classList.toggle('secondary', orient !== 'v');
    syncGridCustomCursor(deps);
}

function clearGridCustomLines(deps){ deps.gridCustomHistory = []; deps.gridCustomLines = []; deps.gridCustomDrag = null; syncGridCustomUndoBtn(deps); refreshGridSplitPreview(deps); }

function undoGridCustomLine(deps){ if(!deps.gridCustomHistory.length) return; deps.gridCustomLines = deps.gridCustomHistory.pop(); deps.gridCustomDrag = null; syncGridCustomUndoBtn(deps); refreshGridSplitPreview(deps); }

function refreshGridSplitPreview(deps){
    const canvasEl = deps.editDrawCanvas();
    const ctx = canvasEl.getContext('2d');
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    renderGridJoinPreview(deps);
    if(deps.imageEditMode !== 'grid') return;
    if(deps.gridOperationMode === 'join') return;
    const countEl = deps.document.getElementById('gridSplitCount');
    const lineWidth = Math.max(2, Math.round(Math.min(canvasEl.width, canvasEl.height) / 320));
    const drawLine = (x1, y1, x2, y2) => {
        ctx.save(); ctx.lineWidth = lineWidth + 2; ctx.strokeStyle = 'rgba(2,6,23,0.72)'; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.lineWidth = lineWidth; ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.restore();
    };
    if(deps.gridCustomMode){
        const gap = Math.max(0, Math.min(240, Number(deps.document.getElementById('gridGapSize')?.value || 0)));
        const hLines = deps.gridCustomLines.filter(l => l.type === 'h'), vLines = deps.gridCustomLines.filter(l => l.type === 'v');
        if(countEl) countEl.textContent = deps.tr('canvas.gridWillOutput').replace('{n}', (hLines.length + 1) * (vLines.length + 1));
        hLines.forEach(l => { const y = l.pos * canvasEl.height; gap > 0 ? (drawLine(0, y - gap / 2, canvasEl.width, y - gap / 2), drawLine(0, y + gap / 2, canvasEl.width, y + gap / 2)) : drawLine(0, y, canvasEl.width, y); });
        vLines.forEach(l => { const x = l.pos * canvasEl.width; gap > 0 ? (drawLine(x - gap / 2, 0, x - gap / 2, canvasEl.height), drawLine(x + gap / 2, 0, x + gap / 2, canvasEl.height)) : drawLine(x, 0, x, canvasEl.height); });
        return;
    }
    const {rows, cols, gap} = gridSplitSettings(deps);
    if(countEl) countEl.textContent = deps.tr('canvas.gridWillOutput').replace('{n}', rows * cols);
    for(let i = 1; i < cols; i++){ const x = i * canvasEl.width / cols; gap > 0 ? (drawLine(x - gap / 2, 0, x - gap / 2, canvasEl.height), drawLine(x + gap / 2, 0, x + gap / 2, canvasEl.height)) : drawLine(x, 0, x, canvasEl.height); }
    for(let i = 1; i < rows; i++){ const y = i * canvasEl.height / rows; gap > 0 ? (drawLine(0, y - gap / 2, canvasEl.width, y - gap / 2), drawLine(0, y + gap / 2, canvasEl.width, y + gap / 2)) : drawLine(0, y, canvasEl.width, y); }
}

async function applyImageGridSplit(deps){
    const isCurrent=deps.captureImageEditContext();
    if(!isCurrent()) return;
    if(!deps.cropState) return;
    if(deps.gridOperationMode === 'join') return applyImageGridJoin(deps);
    let {node, image} = deps.currentEditImage();
    const img = deps.document.getElementById('cropImage');
    if(!node || !image || !img.naturalWidth || !img.naturalHeight) return;
    const rects = gridSplitRects(deps, img.naturalWidth, img.naturalHeight).sort((a, b) => (Number(a.row || 0) - Number(b.row || 0)) || (Number(a.col || 0) - Number(b.col || 0)));
    if(!rects.length) return;
    const base = deps.safeExportFileName((deps.downloadNameForMediaItem(image, 'image') || 'image').replace(/\.[^.]+$/, ''), 'image');
    const digits = String(rects.length).length;
    const blobs = [];
    for(let i = 0; i < rects.length; i++){
        const rect = rects[i];
        const canvasEl = deps.document.createElement('canvas');
        canvasEl.width = rect.w; canvasEl.height = rect.h;
        canvasEl.getContext('2d').drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
        const blob = await new Promise(resolve => canvasEl.toBlob(resolve, 'image/png'));
        if(!isCurrent()) return;
        const order = String(i + 1).padStart(digits, '0');
        if(blob) blobs.push({blob, name:`${base}_${order}_r${rect.row + 1}_c${rect.col + 1}.png`});
    }
    const files = await deps.uploadImageBlobs(blobs, isCurrent);
    if(!isCurrent()) return;
    node = deps.currentEditImage().node;
    if(files.length){
        const layout = gridLayoutFromRects(deps, rects);
        const outputNode = deps.createNode((node.x || 0) + deps.imageLayout(node.images || [], deps.nodeScale(node), node).width + 40, node.y || 0, files.map((file, i) => ({
            url:file.url,
            name:file.name,
            grid:{...layout, row:rects[i]?.row || 0, col:rects[i]?.col || 0, w:rects[i]?.w || 1, h:rects[i]?.h || 1}
        })));
        outputNode.title = 'Grid';
        deps.closeImageEditor(); deps.render(); deps.scheduleSave();
    }
}

function beginGridJoinDrag(deps, event){
    if(deps.imageEditMode !== 'grid' || deps.gridOperationMode !== 'join') return;
    const itemEl = event.target?.closest?.('.grid-join-item');
    if(!itemEl) return;
    event.preventDefault();
    event.stopPropagation();
    const index = Number(itemEl.dataset.gridJoinIndex);
    const item = deps.gridJoinLayout?.items?.find(entry => Number(entry.index) === index);
    const host = deps.document.getElementById('gridJoinCanvas');
    if(!item || !host) return;
    itemEl.setPointerCapture?.(event.pointerId);
    deps.gridJoinDrag = {index, pointerId:event.pointerId, sx:event.clientX, sy:event.clientY, x:item.x, y:item.y};
    itemEl.classList.add('dragging');
}

function moveGridJoinDrag(deps, event){
    if(!deps.gridJoinDrag || deps.imageEditMode !== 'grid' || deps.gridOperationMode !== 'join') return;
    event.preventDefault();
    event.stopPropagation();
    const item = deps.gridJoinLayout?.items?.find(entry => Number(entry.index) === Number(deps.gridJoinDrag.index));
    if(!item) return;
    const host = deps.document.getElementById('gridJoinCanvas');
    const rect = host?.getBoundingClientRect();
    const logical = gridJoinCanvasSize(deps);
    const scale = rect ? Math.max(0.001, rect.width / Math.max(1, logical.w)) : Math.max(0.001, deps.imageEditZoom || 1);
    const dx = (event.clientX - deps.gridJoinDrag.sx) / scale;
    const dy = (event.clientY - deps.gridJoinDrag.sy) / scale;
    deps.gridJoinDrag.dx = dx;
    deps.gridJoinDrag.dy = dy;
    const el = host?.querySelector(`[data-grid-join-index="${deps.CSS.escape(String(deps.gridJoinDrag.index))}"]`);
    if(el){
        el.style.transform = `translate(${Math.round(dx)}px, ${Math.round(dy)}px)`;
    }
}

function gridJoinDragTarget(deps){
    if(!deps.gridJoinDrag || !deps.gridJoinLayout) return null;
    const dragged = deps.gridJoinLayout.items.find(entry => Number(entry.index) === Number(deps.gridJoinDrag.index));
    if(!dragged) return null;
    const dx = deps.gridJoinDrag.dx || 0;
    const dy = deps.gridJoinDrag.dy || 0;
    const cx = dragged.x + dx + dragged.w / 2;
    const cy = dragged.y + dy + dragged.h / 2;
    return (deps.gridJoinLayout.items || [])
        .filter(entry => Number(entry.index) !== Number(deps.gridJoinDrag.index))
        .map(entry => {
            const inside = cx >= entry.x && cx <= entry.x + entry.w && cy >= entry.y && cy <= entry.y + entry.h;
            const score = Math.hypot(cx - (entry.x + entry.w / 2), cy - (entry.y + entry.h / 2));
            return {entry, inside, score};
        })
        .filter(item => item.inside || item.score < Math.max(dragged.w, dragged.h, item.entry.w, item.entry.h) * 0.55)
        .sort((a, b) => (b.inside - a.inside) || a.score - b.score)[0]?.entry || null;
}

function endGridJoinDrag(deps, event){
    if(!deps.gridJoinDrag) return;
    const host = deps.document.getElementById('gridJoinCanvas');
    const draggedEl = host?.querySelector(`[data-grid-join-index="${deps.CSS.escape(String(deps.gridJoinDrag.index))}"]`);
    draggedEl?.classList.remove('dragging');
    if(draggedEl) draggedEl.style.transform = '';
    const dragged = deps.gridJoinLayout?.items?.find(entry => Number(entry.index) === Number(deps.gridJoinDrag.index));
    const target = gridJoinDragTarget(deps);
    if(dragged && target){
        const order = gridJoinVisualOrder(deps);
        const a = order.indexOf(Number(dragged.index));
        const b = order.indexOf(Number(target.index));
        if(a >= 0 && b >= 0) [order[a], order[b]] = [order[b], order[a]];
        setGridJoinLayoutOrder(deps, order, deps.gridJoinLayout.rows, deps.gridJoinLayout.cols, deps.gridJoinLayout.gap);
        deps.gridJoinUserMoved = true;
        renderGridJoinPreview(deps);
    }
    if(event?.pointerId != null) event.target?.releasePointerCapture?.(event.pointerId);
    deps.gridJoinDrag = null;
}

function gridGapInputValue(deps){
    return Math.max(0, Math.min(240, Number(deps.document.getElementById('gridGapSize')?.value || 0)));
}

function currentGridJoinItems(deps){
    // 分组拼接：聚合组内所有图片成员的图片，按阅读顺序给出连续索引（source 指向真实图片对象以写回自然尺寸）。
    if(deps.gridJoinGroupId){
        const group = deps.nodes.find(n => n.id === deps.gridJoinGroupId && deps.isSmartGroupNode(n));
        if(group){
            return deps.smartGroupImageRefs(group)
                .filter(r => deps.mediaKindForItem(r.item) === 'image' && r.item?.url)
                .map((r, index) => ({item:r.item, source:r.source, index}));
        }
    }
    const node = deps.currentEditImage().node;
    return (node?.images || [])
        .map((item, index) => ({item:deps.imageForDisplay(item), source:item, index}))
        .filter(entry => deps.mediaKindForItem(entry.item) === 'image' && entry.item?.url);
}

function openGroupGridJoin(deps, group){
    if(!deps.isSmartGroupNode(group)) return;
    const refs = deps.smartGroupImageRefs(group).filter(r => deps.mediaKindForItem(r.item) === 'image');
    if(refs.length <= 1){ deps.toast('分组至少需要 2 张图片才能宫格拼接'); return; }
    const first = refs[0];
    deps.openImageEditor(first.nodeId, first.index);
    if(!deps.imageEditModal.classList.contains('open')) return;
    deps.gridJoinGroupId = group.id;
    deps.setImageEditMode('grid', true);
    setGridOperationMode(deps, 'join');
}

function canGridJoinCurrentNode(deps){
    return currentGridJoinItems(deps).length > 1;
}

function gridJoinAutoDims(deps, count){
    const cols = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, count))));
    return {rows:Math.max(1, Math.ceil(count / cols)), cols};
}

function gridJoinNaturalSize(deps, entry){
    const item = entry?.item || {};
    const cached = deps.gridJoinImageCache.get(entry?.index);
    const w = Number(item.natural_w || item.width || cached?.naturalWidth || 0);
    const h = Number(item.natural_h || item.height || cached?.naturalHeight || 0);
    return {w:Math.max(1, w || 512), h:Math.max(1, h || 512)};
}

function gridJoinBaseCellSize(deps, items){
    const sizes = items.map((...args)=>gridJoinNaturalSize(deps, ...args));
    const maxW = Math.max(1, ...sizes.map(size => size.w));
    const maxH = Math.max(1, ...sizes.map(size => size.h));
    const scale = Math.min(1, 420 / Math.max(maxW, maxH));
    return {w:Math.max(1, Math.round(maxW * scale)), h:Math.max(1, Math.round(maxH * scale)), scale};
}

function gridJoinItemDisplaySize(deps, entry, cell){
    return {
        w:Math.max(1, Math.round(cell.w)),
        h:Math.max(1, Math.round(cell.h))
    };
}

function ensureGridJoinLayout(deps, rows=null, cols=null){
    const items = currentGridJoinItems(deps);
    if(!items.length){ deps.gridJoinLayout = null; return null; }
    const auto = gridJoinAutoDims(deps, items.length);
    const nextRows = Math.max(1, Number(rows || deps.gridJoinLayout?.rows || auto.rows) || auto.rows);
    const nextCols = Math.max(1, Number(cols || deps.gridJoinLayout?.cols || auto.cols) || auto.cols);
    const byIndex = new Map(items.map(entry => [entry.index, entry]));
    const previousOrder = gridJoinVisualOrder(deps)
        .map(index => byIndex.get(Number(index)))
        .filter(Boolean);
    const ordered = [
        ...previousOrder,
        ...items.filter(entry => !previousOrder.some(prev => Number(prev.index) === Number(entry.index)))
    ];
    const cell = gridJoinBaseCellSize(deps, ordered);
    const gap = gridGapInputValue(deps);
    const layoutItems = ordered.map((entry, order) => {
        const row = Math.floor(order / nextCols);
        const col = order % nextCols;
        const {w, h} = gridJoinItemDisplaySize(deps, entry, cell);
        return {
            index:entry.index,
            x:col * (cell.w + gap),
            y:row * (cell.h + gap),
            w,
            h
        };
    });
    deps.gridJoinLayout = {rows:nextRows, cols:nextCols, cellW:cell.w, cellH:cell.h, gap, items:layoutItems};
    return deps.gridJoinLayout;
}

function gridJoinVisualOrder(deps, layout=deps.gridJoinLayout){
    return (layout?.items || [])
        .slice()
        .sort((a, b) => (Number(a.y || 0) - Number(b.y || 0)) || (Number(a.x || 0) - Number(b.x || 0)))
        .map(item => Number(item.index));
}

function setGridJoinLayoutOrder(deps, order, rows=null, cols=null, gapOverride=null){
    const entries = currentGridJoinItems(deps);
    if(!entries.length){ deps.gridJoinLayout = null; return null; }
    const byIndex = new Map(entries.map(entry => [entry.index, entry]));
    const ordered = [
        ...order.map(index => byIndex.get(Number(index))).filter(Boolean),
        ...entries.filter(entry => !order.includes(entry.index))
    ];
    const auto = gridJoinAutoDims(deps, ordered.length);
    const nextRows = Math.max(1, Number(rows || deps.gridJoinLayout?.rows || auto.rows) || auto.rows);
    const nextCols = Math.max(1, Number(cols || deps.gridJoinLayout?.cols || auto.cols) || auto.cols);
    const cell = gridJoinBaseCellSize(deps, ordered);
    const gap = Math.max(0, Math.min(240, Number(gapOverride ?? deps.document.getElementById('gridGapSize')?.value ?? 0)));
    const layoutItems = ordered.map((entry, orderIndex) => {
        const row = Math.floor(orderIndex / nextCols);
        const col = orderIndex % nextCols;
        const {w, h} = gridJoinItemDisplaySize(deps, entry, cell);
        return {
            index:entry.index,
            x:col * (cell.w + gap),
            y:row * (cell.h + gap),
            w,
            h
        };
    });
    deps.gridJoinLayout = {rows:nextRows, cols:nextCols, cellW:cell.w, cellH:cell.h, gap, items:layoutItems};
    return deps.gridJoinLayout;
}

function resetGridJoinLayout(deps){
    deps.gridJoinUserMoved = false;
    deps.gridJoinLayout = null;
    ensureGridJoinLayout(deps);
    renderGridJoinPreview(deps);
}

function applyGridJoinPreset(deps, rows, cols){
    deps.gridJoinUserMoved = false;
    const order = gridJoinVisualOrder(deps);
    if(order.length) setGridJoinLayoutOrder(deps, order, rows, cols);
    else {
        deps.gridJoinLayout = null;
        ensureGridJoinLayout(deps, rows, cols);
    }
    renderGridJoinPreview(deps);
}

function setGridJoinOutputSize(deps, size){
    deps.gridJoinOutputSize = Math.max(256, Math.min(8192, Number(size) || 2048));
    syncGridJoinSizeControls(deps);
    refreshGridSplitPreview(deps);
}

function syncGridJoinSizeControls(deps){
    deps.document.querySelectorAll('[data-grid-join-size]').forEach(btn => {
        const active = Number(btn.dataset.gridJoinSize || 0) === Number(deps.gridJoinOutputSize);
        btn.classList.toggle('active', active);
    });
}

function setGridOperationMode(deps, mode){
    deps.gridOperationMode = mode === 'join' && canGridJoinCurrentNode(deps) ? 'join' : 'split';
    if(mode === 'join' && deps.gridOperationMode !== 'join') deps.toast('请从包含多张图片的分组打开宫格拼接');
    syncGridOperationControls(deps);
    refreshGridSplitPreview(deps);
}

function syncGridOperationControls(deps){
    const join = deps.gridOperationMode === 'join';
    deps.document.getElementById('gridSplitModeBtn')?.classList.toggle('primary', !join);
    deps.document.getElementById('gridSplitModeBtn')?.classList.toggle('secondary', join);
    const joinBtn = deps.document.getElementById('gridJoinModeBtn');
    if(joinBtn){
        joinBtn.disabled = !canGridJoinCurrentNode(deps);
        joinBtn.classList.toggle('primary', join);
        joinBtn.classList.toggle('secondary', !join);
    }
    deps.document.querySelectorAll('.grid-split-control').forEach(el => { el.style.display = join ? 'none' : (el.id === 'gridRegularControls' ? 'contents' : ''); });
    deps.document.querySelectorAll('.grid-join-control').forEach(el => { el.style.display = join ? 'flex' : 'none'; });
    syncGridJoinSizeControls(deps);
    if(!join) syncGridCustomControls(deps);
    deps.document.getElementById('cropCanvas')?.classList.toggle('grid-join-mode', join);
    deps.document.getElementById('cropImage')?.classList.toggle('grid-join-hidden', join);
    if(join) ensureGridJoinLayout(deps);
    else deps.gridJoinDrag = null;
}

function syncGridCustomControls(deps){
    const join = deps.gridOperationMode === 'join';
    const custom = deps.document.getElementById('gridCustomControls');
    if(custom) custom.style.display = !join && deps.gridCustomMode ? 'flex' : 'none';
    deps.document.querySelectorAll('.grid-split-control.grid-preset-row').forEach(row => {
        row.style.display = !join && !deps.gridCustomMode ? 'flex' : 'none';
    });
    const regular = deps.document.getElementById('gridRegularControls');
    if(regular) regular.style.display = !join && !deps.gridCustomMode ? 'contents' : 'none';
}

function syncGridCustomUndoBtn(deps){
    const btn = deps.document.getElementById('gridUndoBtn');
    if(!btn) return;
    btn.disabled = deps.gridCustomHistory.length === 0;
    btn.style.opacity = deps.gridCustomHistory.length === 0 ? '0.4' : '1';
}

function syncGridCustomCursor(deps){
    const el = deps.document.getElementById('cropCanvas');
    el.classList.toggle('grid-custom-h', deps.imageEditMode === 'grid' && deps.gridOperationMode !== 'join' && deps.gridCustomMode && deps.gridCustomOrientation === 'h');
    el.classList.toggle('grid-custom-v', deps.imageEditMode === 'grid' && deps.gridOperationMode !== 'join' && deps.gridCustomMode && deps.gridCustomOrientation === 'v');
}

function gridJoinCanvasSize(deps, layout=deps.gridJoinLayout){
    if(!layout) return {w:1, h:1};
    const gap = Math.max(0, Number(layout.gap || 0));
    const byGrid = {
        w:Math.max(1, Number(layout.cols || 1) * Number(layout.cellW || 1) + Math.max(0, Number(layout.cols || 1) - 1) * gap),
        h:Math.max(1, Number(layout.rows || 1) * Number(layout.cellH || 1) + Math.max(0, Number(layout.rows || 1) - 1) * gap)
    };
    const byItems = (layout.items || []).reduce((acc, item) => ({
        w:Math.max(acc.w, Number(item.x || 0) + Number(item.w || 0)),
        h:Math.max(acc.h, Number(item.y || 0) + Number(item.h || 0))
    }), byGrid);
    return {w:Math.ceil(byItems.w), h:Math.ceil(byItems.h)};
}

function renderGridJoinPreview(deps){
    const host = deps.document.getElementById('gridJoinCanvas');
    const countEl = deps.document.getElementById('gridSplitCount');
    const cropCanvasEl = deps.document.getElementById('cropCanvas');
    if(!host) return;
    host.innerHTML = '';
    if(deps.imageEditMode !== 'grid' || deps.gridOperationMode !== 'join'){
        host.style.display = 'none';
        if(cropCanvasEl){ cropCanvasEl.style.width = ''; cropCanvasEl.style.height = ''; }
        return;
    }
    const items = currentGridJoinItems(deps);
    if(items.length <= 1){
        host.style.display = 'none';
        if(cropCanvasEl){ cropCanvasEl.style.width = ''; cropCanvasEl.style.height = ''; }
        if(countEl) countEl.textContent = '分组需要至少 2 张图片';
        return;
    }
    const isCurrent=deps.captureImageEditContext(),cache=deps.gridJoinImageCache;
    const layout = ensureGridJoinLayout(deps);
    const size = gridJoinCanvasSize(deps, layout);
    const zoom = Math.max(0.05, Number(deps.imageEditZoom || 1));
    const displayW = Math.max(1, Math.round(size.w * zoom));
    const displayH = Math.max(1, Math.round(size.h * zoom));
    host.style.display = 'block';
    host.style.width = `${Math.max(1, Math.round(size.w))}px`;
    host.style.height = `${Math.max(1, Math.round(size.h))}px`;
    host.style.transform = `scale(${zoom})`;
    host.style.transformOrigin = '0 0';
    if(cropCanvasEl){
        cropCanvasEl.style.width = `${displayW}px`;
        cropCanvasEl.style.height = `${displayH}px`;
    }
    const byIndex = new Map(items.map(entry => [entry.index, entry]));
    (layout.items || []).forEach(item => {
        const entry = byIndex.get(item.index);
        if(!entry) return;
        const img = deps.document.createElement('img');
        img.className = 'grid-join-item';
        img.draggable = false;
        img.dataset.gridJoinIndex = String(item.index);
        img.style.left = `${Math.round(item.x)}px`;
        img.style.top = `${Math.round(item.y)}px`;
        img.style.width = `${Math.round(item.w)}px`;
        img.style.height = `${Math.round(item.h)}px`;
        img.alt = entry.item.name || `image-${item.index + 1}`;
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            if(!isCurrent() || deps.gridJoinImageCache!==cache) return;
            const current=currentGridJoinItems(deps).find(value=>value.index===item.index&&value.item?.url===entry.item?.url);
            if(!current) return;
            const hadNaturalSize = Boolean(current.source.natural_w && current.source.natural_h);
            cache.set(item.index, img);
            if(!current.source.natural_w && img.naturalWidth) current.source.natural_w = img.naturalWidth;
            if(!current.source.natural_h && img.naturalHeight) current.source.natural_h = img.naturalHeight;
            if(!hadNaturalSize && img.naturalWidth && img.naturalHeight && deps.imageEditMode === 'grid' && deps.gridOperationMode === 'join'){
                ensureGridJoinLayout(deps);
                renderGridJoinPreview(deps);
            }
        };
        img.onerror = () => {
            if(!isCurrent() || deps.gridJoinImageCache!==cache) return;
            if(img.dataset.proxyFallbackTried === '1') return;
            const fallback = deps.proxiedMediaUrl(entry.item);
            if(!fallback || fallback === img.getAttribute('src')) return;
            img.dataset.proxyFallbackTried = '1';
            img.src = fallback;
        };
        img.src = deps.displayMediaUrl(entry.item);
        host.appendChild(img);
    });
    if(countEl) countEl.textContent = `将拼接 ${items.length} 张图片 · 输出长边 ${Math.round(deps.gridJoinOutputSize / 1024)}K`;
}

function loadGridJoinImage(deps, entry){
    const cache=deps.gridJoinImageCache;
    const cached = deps.gridJoinImageCache.get(entry.index);
    if(cached?.complete && cached.naturalWidth) return Promise.resolve(cached);
    return new Promise((resolve, reject) => {
        const img = new deps.Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            if(deps.gridJoinImageCache===cache) cache.set(entry.index, img);
            resolve(img);
        };
        img.onerror = () => {
            if(deps.gridJoinImageCache!==cache){reject(new Error('图片加载失败'));return;}
            if(img.dataset.proxyFallbackTried === '1'){
                reject(new Error('图片加载失败'));
                return;
            }
            const fallback = deps.proxiedMediaUrl(entry.item);
            if(!fallback || fallback === img.src){
                reject(new Error('图片加载失败'));
                return;
            }
            img.dataset.proxyFallbackTried = '1';
            img.src = fallback;
        };
        img.src = deps.displayMediaUrl(entry.item);
    });
}

function drawImageCover(deps, ctx, img, dx, dy, dw, dh){
    const sw = Math.max(1, Number(img?.naturalWidth || img?.videoWidth || img?.width || 1));
    const sh = Math.max(1, Number(img?.naturalHeight || img?.videoHeight || img?.height || 1));
    const targetW = Math.max(1, Number(dw || 1));
    const targetH = Math.max(1, Number(dh || 1));
    const scale = Math.max(targetW / sw, targetH / sh);
    const cropW = Math.max(1, targetW / scale);
    const cropH = Math.max(1, targetH / scale);
    const sx = Math.max(0, (sw - cropW) / 2);
    const sy = Math.max(0, (sh - cropH) / 2);
    ctx.drawImage(img, sx, sy, cropW, cropH, dx, dy, targetW, targetH);
}

async function applyImageGridJoin(deps){
    const isCurrent=deps.captureImageEditContext();
    if(!isCurrent()) return;
    let {node, image} = deps.currentEditImage();
    const items = currentGridJoinItems(deps);
    if(!node || items.length <= 1){ deps.toast('请从包含多张图片的分组打开宫格拼接'); return; }
    const layout = ensureGridJoinLayout(deps);
    if(!layout?.items?.length) return;
    const size = gridJoinCanvasSize(deps, layout);
    const targetLong = Math.max(256, Number(deps.gridJoinOutputSize) || 2048);
    const outputScale = Math.max(1, targetLong / Math.max(1, Math.max(size.w, size.h)));
    const canvasEl = deps.document.createElement('canvas');
    canvasEl.width = Math.max(1, Math.round(size.w * outputScale));
    canvasEl.height = Math.max(1, Math.round(size.h * outputScale));
    const ctx = canvasEl.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);
    const byIndex = new Map(items.map(entry => [entry.index, entry]));
    for(const item of layout.items || []){
        const entry = byIndex.get(item.index);
        if(!entry) continue;
        let img;
        try { img = await loadGridJoinImage(deps, entry); }
        catch(err){ if(!isCurrent()) return; throw err; }
        if(!isCurrent()) return;
        drawImageCover(deps, ctx, img, Math.round(item.x * outputScale), Math.round(item.y * outputScale), Math.round(item.w * outputScale), Math.round(item.h * outputScale));
    }
    const blob = await new Promise(resolve => canvasEl.toBlob(resolve, 'image/png'));
    if(!isCurrent()) return;
    const base = deps.safeExportFileName((deps.downloadNameForMediaItem(image || items[0]?.item, 'image') || 'image').replace(/\.[^.]+$/, ''), 'image');
    const file = blob ? await deps.uploadCroppedBlob(blob, `${base}_join.png`, isCurrent) : null;
    if(!isCurrent()) return;
    node = deps.currentEditImage().node;
    if(file){
        const rect = deps.nodeRect(node);
        const outputNode = deps.createImageNodeAt({x:rect.x + rect.width + 240, y:rect.y + rect.height / 2}, [{
            url:file.url,
            name:file.name,
            kind:'image',
            natural_w:canvasEl.width,
            natural_h:canvasEl.height
        }], {select:true, skipUndo:true});
        outputNode.title = 'Grid Join';
        deps.closeImageEditor();
        deps.render();
        deps.scheduleSave();
        deps.toast('已输出拼接图片');
    }
}

    const api={gridCustomLineHit, setGridCustomLinePos, syncGridGapValue, gridSplitSettings, gridSplitRects, gridSplitRectsCustom, gridLayoutFromRects, applyGridPreset, toggleGridCustomMode, setGridCustomOrientation, clearGridCustomLines, undoGridCustomLine, refreshGridSplitPreview, applyImageGridSplit, beginGridJoinDrag, moveGridJoinDrag, gridJoinDragTarget, endGridJoinDrag, gridGapInputValue, currentGridJoinItems, openGroupGridJoin, canGridJoinCurrentNode, gridJoinAutoDims, gridJoinNaturalSize, gridJoinBaseCellSize, gridJoinItemDisplaySize, ensureGridJoinLayout, gridJoinVisualOrder, setGridJoinLayoutOrder, resetGridJoinLayout, applyGridJoinPreset, setGridJoinOutputSize, syncGridJoinSizeControls, setGridOperationMode, syncGridOperationControls, syncGridCustomControls, syncGridCustomUndoBtn, syncGridCustomCursor, gridJoinCanvasSize, renderGridJoinPreview, loadGridJoinImage, drawImageCover, applyImageGridJoin};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.SmartEditorGrid=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
