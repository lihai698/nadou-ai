/* Editor grid responsibility: canvas-editor-grid. Host supplies live state and effects. */
(function(root){
    'use strict';

function gridCustomLineHit(deps, point){
    if(!deps.gridCustomLines.length) return -1;
    const canvasEl = deps.editDrawCanvas();
    const threshold = Math.max(8, Math.min(canvasEl.width, canvasEl.height) / 80);
    let best = -1;
    let bestDist = Infinity;
    deps.gridCustomLines.forEach((line, index) => {
        const dist = line.type === 'h'
            ? Math.abs(point.y - line.pos * canvasEl.height)
            : Math.abs(point.x - line.pos * canvasEl.width);
        if(dist < bestDist && dist <= threshold){
            best = index;
            bestDist = dist;
        }
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
    return value;
}

function gridSplitSettings(deps){
    const hLines = Math.max(0, Math.min(20, Number(deps.document.getElementById('gridHorizontalLines')?.value || 0)));
    const vLines = Math.max(0, Math.min(20, Number(deps.document.getElementById('gridVerticalLines')?.value || 0)));
    const gap = syncGridGapValue(deps);
    return {rows:hLines + 1, cols:vLines + 1, gap};
}

function gridSplitRects(deps, width, height){
    if(deps.gridCustomMode) return gridSplitRectsCustom(deps, width, height);
    const {rows, cols, gap} = gridSplitSettings(deps);
    const halfGap = gap / 2;
    const rects = [];
    for(let row = 0; row < rows; row++){
        const topLine = row * height / rows;
        const bottomLine = (row + 1) * height / rows;
        const y1 = Math.round(row === 0 ? 0 : topLine + halfGap);
        const y2 = Math.round(row === rows - 1 ? height : bottomLine - halfGap);
        for(let col = 0; col < cols; col++){
            const leftLine = col * width / cols;
            const rightLine = (col + 1) * width / cols;
            const x1 = Math.round(col === 0 ? 0 : leftLine + halfGap);
            const x2 = Math.round(col === cols - 1 ? width : rightLine - halfGap);
            if(x2 > x1 && y2 > y1) rects.push({row, col, x:x1, y:y1, w:x2 - x1, h:y2 - y1});
        }
    }
    return rects;
}

function gridSplitRectsCustom(deps, width, height){
    const gap = Math.max(0, Math.min(240, Number(deps.document.getElementById('gridGapSize')?.value || 0)));
    const halfGap = gap / 2;
    // 按方向归类，转换为像素位置（去重并排序）
    const rawH = [...new Set(deps.gridCustomLines.filter(l => l.type === 'h').map(l => l.pos * height))].sort((a, b) => a - b);
    const rawV = [...new Set(deps.gridCustomLines.filter(l => l.type === 'v').map(l => l.pos * width))].sort((a, b) => a - b);
    const hCuts = [0, ...rawH, height]; // 切割边界（含图片两端）
    const vCuts = [0, ...rawV, width];
    const rects = [];
    for(let row = 0; row < hCuts.length - 1; row++){
        for(let col = 0; col < vCuts.length - 1; col++){
            const y1 = Math.round(row === 0 ? hCuts[row] : hCuts[row] + halfGap);
            const y2 = Math.round(row === hCuts.length - 2 ? hCuts[row + 1] : hCuts[row + 1] - halfGap);
            const x1 = Math.round(col === 0 ? vCuts[col] : vCuts[col] + halfGap);
            const x2 = Math.round(col === vCuts.length - 2 ? vCuts[col + 1] : vCuts[col + 1] - halfGap);
            if(x2 > x1 && y2 > y1) rects.push({row, col, x:x1, y:y1, w:x2 - x1, h:y2 - y1});
        }
    }
    return rects;
}

function gridLayoutFromRects(deps, rects){
    const rows = Math.max(1, ...rects.map(r => Number(r.row || 0) + 1));
    const cols = Math.max(1, ...rects.map(r => Number(r.col || 0) + 1));
    return {type:'grid-split', groupId:deps.uid('grid'), rows, cols};
}

function applyGridPreset(deps, rows, cols){
    deps.gridCustomMode = false;
    deps.gridCustomLines = [];
    deps.gridCustomHistory = [];
    deps.gridCustomDrag = null;
    const h = deps.document.getElementById('gridHorizontalLines');
    const v = deps.document.getElementById('gridVerticalLines');
    if(h){ h.disabled = false; h.value = String(Math.max(0, Number(rows || 1) - 1)); }
    if(v){ v.disabled = false; v.value = String(Math.max(0, Number(cols || 1) - 1)); }
    const toggle = deps.document.getElementById('gridCustomToggle');
    const custom = deps.document.getElementById('gridCustomControls');
    const regular = deps.document.getElementById('gridRegularControls');
    if(toggle){
        toggle.classList.remove('primary');
        toggle.classList.add('secondary');
    }
    if(custom) custom.style.display = 'none';
    if(regular) regular.style.display = 'contents';
    _syncGridCustomCursor(deps);
    _syncGridCustomUndoBtn(deps);
    refreshGridSplitPreview(deps);
}

function toggleGridCustomMode(deps){
    deps.gridCustomMode = !deps.gridCustomMode;
    if(deps.gridCustomMode){ deps.gridCustomLines = []; deps.gridCustomHistory = []; } // 进入自定义时清空旧线及历史
    deps.gridCustomDrag = null;
    const toggle = deps.document.getElementById('gridCustomToggle');
    const regular = deps.document.getElementById('gridRegularControls');
    const custom = deps.document.getElementById('gridCustomControls');
    toggle.classList.toggle('primary', deps.gridCustomMode);
    toggle.classList.toggle('secondary', !deps.gridCustomMode);
    // 禁用/启用常规输入
    ['gridHorizontalLines','gridVerticalLines'].forEach(id => {
        const el = deps.document.getElementById(id);
        if(el) el.disabled = deps.gridCustomMode;
    });
    if(custom) custom.style.display = deps.gridCustomMode ? 'flex' : 'none';
    _syncGridCustomCursor(deps);
    _syncGridCustomUndoBtn(deps);
    refreshGridSplitPreview(deps);
}

function setGridCustomOrientation(deps, orient){
    deps.gridCustomOrientation = orient;
    deps.document.getElementById('gridOrientH').classList.toggle('primary', orient === 'h');
    deps.document.getElementById('gridOrientH').classList.toggle('secondary', orient !== 'h');
    deps.document.getElementById('gridOrientV').classList.toggle('primary', orient === 'v');
    deps.document.getElementById('gridOrientV').classList.toggle('secondary', orient !== 'v');
    _syncGridCustomCursor(deps);
}

function clearGridCustomLines(deps){
    deps.gridCustomHistory = [];
    deps.gridCustomLines = [];
    deps.gridCustomDrag = null;
    _syncGridCustomUndoBtn(deps);
    refreshGridSplitPreview(deps);
}

function undoGridCustomLine(deps){
    if(!deps.gridCustomHistory.length) return;
    deps.gridCustomLines = deps.gridCustomHistory.pop();
    deps.gridCustomDrag = null;
    _syncGridCustomUndoBtn(deps);
    refreshGridSplitPreview(deps);
}

function refreshGridSplitPreview(deps){
    const canvasEl = deps.editDrawCanvas();
    const ctx = canvasEl.getContext('2d');
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    if(deps.imageEditMode !== 'grid') return;
    const countEl = deps.document.getElementById('gridSplitCount');
    const lineWidth = Math.max(2, Math.round(Math.min(canvasEl.width, canvasEl.height) / 320));
    const drawGuideLine = (x1, y1, x2, y2) => {
        ctx.save();
        ctx.lineWidth = lineWidth + 2;
        ctx.strokeStyle = 'rgba(2,6,23,0.72)';
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = 'rgba(255,255,255,0.92)';
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.restore();
    };
    if(deps.gridCustomMode){
        // 自定义模式：按已放置线渲染（包含空心范围预览）
        const gap = Math.max(0, Math.min(240, Number(deps.document.getElementById('gridGapSize')?.value || 0)));
        const hLines = deps.gridCustomLines.filter(l => l.type === 'h');
        const vLines = deps.gridCustomLines.filter(l => l.type === 'v');
        if(countEl) countEl.textContent = deps.tr('canvas.gridWillOutput').replace('{n}', (hLines.length + 1) * (vLines.length + 1));
        ctx.save();
        hLines.forEach(l => {
            const y = l.pos * canvasEl.height;
            if(gap > 0){
                drawGuideLine(0, y - gap / 2, canvasEl.width, y - gap / 2);
                drawGuideLine(0, y + gap / 2, canvasEl.width, y + gap / 2);
            } else {
                drawGuideLine(0, y, canvasEl.width, y);
            }
        });
        vLines.forEach(l => {
            const x = l.pos * canvasEl.width;
            if(gap > 0){
                drawGuideLine(x - gap / 2, 0, x - gap / 2, canvasEl.height);
                drawGuideLine(x + gap / 2, 0, x + gap / 2, canvasEl.height);
            } else {
                drawGuideLine(x, 0, x, canvasEl.height);
            }
        });
        ctx.restore();
        return;
    }
    // 常规模式
    const {rows, cols, gap} = gridSplitSettings(deps);
    if(countEl) countEl.textContent = deps.tr('canvas.gridWillOutput').replace('{n}', rows * cols);
    ctx.save();
    const scaleX = canvasEl.width;
    const scaleY = canvasEl.height;
    for(let i = 1; i < cols; i++){
        const x = i * scaleX / cols;
        if(gap > 0){
            drawGuideLine(x - gap / 2, 0, x - gap / 2, scaleY);
            drawGuideLine(x + gap / 2, 0, x + gap / 2, scaleY);
        } else {
            drawGuideLine(x, 0, x, scaleY);
        }
    }
    for(let i = 1; i < rows; i++){
        const y = i * scaleY / rows;
        if(gap > 0){
            drawGuideLine(0, y - gap / 2, scaleX, y - gap / 2);
            drawGuideLine(0, y + gap / 2, scaleX, y + gap / 2);
        } else {
            drawGuideLine(0, y, scaleX, y);
        }
    }
    ctx.restore();
}

async function applyImageGridSplit(deps){
    const isCurrent=deps.captureImageEditContext();
    if(!isCurrent()) return;
    if(!deps.cropState) return;
    let node = deps.nodes.find(n => n.id === deps.cropState.nodeId);
    const img = deps.document.getElementById('cropImage');
    if(!node || !img.naturalWidth || !img.naturalHeight) return;
    const rects = gridSplitRects(deps, img.naturalWidth, img.naturalHeight);
    if(!rects.length) return;
    const base = (node.name || 'image').replace(/\.[^.]+$/, '');
    const blobs = [];
    for(const rect of rects){
        const canvasEl = deps.document.createElement('canvas');
        canvasEl.width = rect.w;
        canvasEl.height = rect.h;
        canvasEl.getContext('2d').drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
        const blob = await new Promise(resolve => canvasEl.toBlob(resolve, 'image/png'));
        if(!isCurrent()) return;
        if(blob) blobs.push({blob, name:`${base}_r${rect.row + 1}_c${rect.col + 1}.png`});
    }
    if(!blobs.length) return;
    const files = await deps.uploadImageBlobs(blobs, isCurrent);
    if(!isCurrent()) return;
    node = deps.nodes.find(n => n.id === deps.cropState.nodeId);
    if(files.length){
        const out = deps.imageEditorOutputNode(node);
        const urls = files.map(file => file.url).filter(Boolean);
        const layout = gridLayoutFromRects(deps, rects);
        deps.appendOutputImages(out, urls, {url:node.url, name:node.name || 'source image'}, urls.map((url, i) => ({
            runMs:0,
            run:{prompt:'宫格切分', refs:[{url:node.url, name:node.name || 'source image'}]},
            grid:{...layout, row:rects[i]?.row || 0, col:rects[i]?.col || 0, w:rects[i]?.w || 1, h:rects[i]?.h || 1}
        })), layout);
        deps.closeImageEditor();
        deps.render();
        deps.scheduleSave();
    }
}

function _syncGridCustomUndoBtn(deps){
    const btn = deps.document.getElementById('gridUndoBtn');
    if(!btn) return;
    btn.disabled = deps.gridCustomHistory.length === 0;
    btn.style.opacity = deps.gridCustomHistory.length === 0 ? '0.4' : '1';
}

function _syncGridCustomCursor(deps){
    const cropCanvasEl = deps.document.getElementById('cropCanvas');
    cropCanvasEl.classList.toggle('grid-custom-h', deps.imageEditMode === 'grid' && deps.gridCustomMode && deps.gridCustomOrientation === 'h');
    cropCanvasEl.classList.toggle('grid-custom-v', deps.imageEditMode === 'grid' && deps.gridCustomMode && deps.gridCustomOrientation === 'v');
}

    const api={gridCustomLineHit, setGridCustomLinePos, syncGridGapValue, gridSplitSettings, gridSplitRects, gridSplitRectsCustom, gridLayoutFromRects, applyGridPreset, toggleGridCustomMode, setGridCustomOrientation, clearGridCustomLines, undoGridCustomLine, refreshGridSplitPreview, applyImageGridSplit, _syncGridCustomUndoBtn, _syncGridCustomCursor};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.CanvasEditorGrid=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
