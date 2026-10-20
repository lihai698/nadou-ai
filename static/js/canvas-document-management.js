/* Classic document metadata and retained catalog compatibility: canvas-document-management. Host supplies live state and effects. */
(function(root){
    'use strict';

function refreshGateViewControls(deps){
    if(!deps.canvasGate) return;
    deps.canvasGate.classList.toggle('trash-mode', deps.trashMode);
    if(deps.gateTitleText) deps.gateTitleText.textContent = deps.trashMode ? deps.tr('canvas.trash') : deps.tr('canvas.selectCanvas');
    if(deps.gateSubtitle) deps.gateSubtitle.textContent = deps.trashMode ? deps.tr('canvas.trashSubtitle') : deps.tr('canvas.subtitle');
    const trashCount = deps.deletedCanvases.length;
    if(deps.gateTrashCount){
        deps.gateTrashCount.textContent = String(trashCount);
        deps.gateTrashCount.classList.toggle('visible', trashCount > 0);
    }
    const countPill = deps.document.getElementById('gateCountPill');
    if(countPill){
        const items = deps.trashMode ? deps.deletedCanvases : deps.canvases;
        const suffix = deps.tr('canvas.countSuffix');
        countPill.textContent = suffix ? `${items.length} ${suffix}` : String(items.length);
    }
    const sortSwitch = deps.document.getElementById('gateSortSwitch');
    if(sortSwitch){
        sortSwitch.classList.toggle('hidden', deps.trashMode);
        sortSwitch.querySelectorAll('[data-sort]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.sort === deps.canvasSortMode);
        });
    }
}

function setCreateMode(deps, active, kind='classic'){
    deps.creatingCanvas = active;
    deps.createCanvasKind = active ? ((kind === 'smart') ? 'smart' : 'classic') : 'classic';
    if(active) deps.trashMode = false;
    deps.canvasGate.classList.toggle('creating', active);
    refreshGateViewControls(deps);
    deps.setStatus(active ? deps.tr('canvas.enterCanvasName') : (deps.canvases.length ? deps.tr('canvas.chooseFirst') : deps.tr('canvas.noCanvasCreateFirst')));
    if(active) {
        deps.gateTitleInput.placeholder = deps.createCanvasKind === 'smart'
            ? (deps.tr('canvas.newSmartCanvasPlaceholder') || deps.tr('canvas.newCanvasPlaceholder'))
            : deps.tr('canvas.newCanvasPlaceholder');
        deps.gateTitleInput.focus();
        deps.gateTitleInput.select();
    } else {
        deps.gateTitleInput.value = '';
        deps.gateTitleInput.placeholder = deps.tr('canvas.newCanvasPlaceholder');
    }
    deps.refreshIcons();
}

async function loadCanvasList(deps, openFirst=true){
    try {
        const res = await deps.fetch('/api/canvases');
        if(!res.ok) throw new Error(deps.tr('canvas.canvasListFailed'));
        const data = await res.json();
        deps.canvases = data.canvases || [];
        sortCanvasListByUpdated(deps);
        refreshGateViewControls(deps);

        refreshTrashCount(deps);
        if(openFirst && deps.canvases[0]) await deps.openCanvas(deps.canvases[0].id);
        else if(!deps.canvas) {
            deps.setCanvasMode(false);
            deps.setStatus(deps.trashMode ? (deps.deletedCanvases.length ? deps.tr('canvas.trash') : deps.tr('canvas.trashEmpty')) : (deps.canvases.length ? deps.tr('canvas.chooseFirst') : deps.tr('canvas.noCanvasCreateFirst')));
        }
    } catch(e) {
        deps.setStatus(deps.tr('canvas.canvasListFailed'));
        deps.console.error(e);
    }
}

async function loadTrashList(deps){
    try {
        const res = await deps.fetch('/api/canvases/trash');
        if(!res.ok) throw new Error(deps.tr('canvas.trashLoadFailed'));
        const data = await res.json();
        deps.deletedCanvases = data.canvases || [];
        refreshGateViewControls(deps);

        deps.setStatus(deps.deletedCanvases.length ? deps.tr('canvas.trash') : deps.tr('canvas.trashEmpty'));
    } catch(e) {
        deps.setStatus(deps.tr('canvas.trashLoadFailed'));
        deps.console.error(e);
    }
}

async function refreshTrashCount(deps){
    if(deps.trashMode) return;
    try {
        const res = await deps.fetch('/api/canvases/trash');
        if(!res.ok) return;
        const data = await res.json();
        deps.deletedCanvases = data.canvases || [];
        refreshGateViewControls(deps);
    } catch(e) {}
}

async function setTrashMode(deps, active){
    deps.trashMode = active;
    deps.creatingCanvas = false;
    deps.pendingDeleteCanvasId = null;
    deps.pendingPurgeCanvasId = null;

    deps.canvasGate.classList.toggle('creating', false);
    refreshGateViewControls(deps);
    if(deps.trashMode) await loadTrashList(deps);
    else await loadCanvasList(deps, false);
    deps.refreshIcons();
}

function compareCanvasRecords(deps, a, b){
    // 置顶始终排在最前；其余按当前排序模式（最近编辑 / 名称）。
    const ap = a.pinned ? 1 : 0, bp = b.pinned ? 1 : 0;
    if(ap !== bp) return bp - ap;
    if(deps.canvasSortMode === 'name'){
        const cmp = String(a.title || '').localeCompare(String(b.title || ''), 'zh-Hans-CN', {numeric:true, sensitivity:'base'});
        if(cmp !== 0) return cmp;
    }
    return Number(b.updated_at || b.created_at || 0) - Number(a.updated_at || a.created_at || 0);
}

function sortCanvasListByUpdated(deps){
    deps.canvases.sort((...args)=>compareCanvasRecords(deps, ...args));
}

function setCanvasSortMode(deps, mode){
    const next = mode === 'name' ? 'name' : 'recent';
    if(next === deps.canvasSortMode) { refreshGateViewControls(deps); return; }
    deps.canvasSortMode = next;
    try { deps.localStorage.setItem('canvasSortMode', deps.canvasSortMode); } catch(e){}
    sortCanvasListByUpdated(deps);

    refreshGateViewControls(deps);
}

async function patchCanvasMeta(deps, id, patch){
    const item = deps.canvases.find(c => c.id === id);
    if(item) Object.assign(item, patch);
    if(deps.canvas?.id === id) Object.assign(deps.canvas, patch);
    if(deps.canvas?.id === id && deps.currentCanvasTitle) deps.currentCanvasTitle.textContent = deps.canvas.title || deps.tr('canvas.untitled');
    sortCanvasListByUpdated(deps);

    try {
        const res = await deps.fetch(`/api/canvases/${encodeURIComponent(id)}/meta`, {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify(patch)
        });
        if(!res.ok) throw new Error('meta save failed');
        const data = await res.json();
        if(data.canvas){
            if(deps.canvas?.id === id){
                deps.canvas.title = data.canvas.title;
                deps.canvas.icon = data.canvas.icon;
                deps.canvas.meta_revision = Number(data.canvas.meta_revision || 0);
                if(deps.currentCanvasTitle) deps.currentCanvasTitle.textContent = deps.canvas.title || deps.tr('canvas.untitled');
            }
            updateCanvasListRecord(deps, data.canvas);
        }
    } catch(e){
        deps.setStatus(deps.tr('canvas.metaSaveFailed') || '保存失败');
        deps.console.error(e);
        await loadCanvasList(deps, false);
    }
}

function updateCanvasListRecord(deps, record){
    if(!record?.id) return;
    const index = deps.canvases.findIndex(item => item.id === record.id);
    if(index >= 0) deps.canvases[index] = {...deps.canvases[index], ...record};
    else deps.canvases.unshift(record);
    sortCanvasListByUpdated(deps);

}

async function touchCanvasOpened(deps, id,isCurrent=()=>true){
    if(!id) return null;
    try {
        const res = await deps.fetch(`/api/canvases/${encodeURIComponent(id)}/touch`, {method:'POST'});
        if(!res.ok) return null;
        const data = await res.json();
        if(!isCurrent()) return null;
        if(data.canvas) updateCanvasListRecord(deps, data.canvas);
        return data.canvas || data;
    } catch(e) {
        if(isCurrent()) deps.console.warn('touch canvas failed', e);
        return null;
    }
}

async function createCanvas(deps){
    const customTitle = deps.gateTitleInput?.value.trim();
    const isSmart = deps.createCanvasKind === 'smart';
    const titleBase = isSmart ? deps.tr('canvas.newSmartCanvas') : deps.tr('canvas.newCanvas');
    const title = customTitle || `${titleBase} ${new Date().toLocaleTimeString(deps.window.StudioI18n?.lang() === 'en' ? 'en-US' : 'zh-CN', {hour:'2-digit', minute:'2-digit'})}`;
    deps.trashMode = false;
    refreshGateViewControls(deps);
    deps.setStatus('Creating...');
    try {
        const res = await deps.fetch('/api/canvases', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({title, icon:isSmart ? 'sparkles' : '🧩', kind:isSmart ? 'smart' : 'classic'})
        });
        if(!res.ok) throw new Error(deps.tr('canvas.createFailed'));
        const data = await res.json();
        if(isSmart){
            setCreateMode(deps, false);
            await loadCanvasList(deps, false);
            openSmartCanvasPage(deps, data.canvas?.id);
            return;
        }
        deps.resetCascadeRuntimeState();
        deps.canvas = data.canvas;
        deps.canvas.logs = deps.canvas.logs || [];
        deps.canvasOrphanUnknownSubmissionCount = 0;
        deps.nodes = (deps.canvas.nodes || []).map(n=>deps.window.CanvasAudio.migrate(n));
        deps.connections = deps.canvas.connections || [];
        deps.viewport = deps.localViewportForCanvas(deps.canvas.id, deps.canvas.viewport || {x:0, y:0, scale:1});
        deps.canvas.viewport = {...deps.viewport};
        deps.resetTransientRunState(deps.nodes);
        deps.sanitizeConnections();
        deps.selected.clear();
        deps.setCanvasMode(true);
        deps.render();
        deps.setStatus('Saved');
        setCreateMode(deps, false);
        await loadCanvasList(deps, false);

    } catch(e) {
        deps.setStatus(deps.tr('canvas.createFailed'));
        deps.console.error(e);
    }
}

async function createSmartCanvas(deps){
    setCreateMode(deps, true, 'smart');
}

function openSmartCanvasPage(deps, id){
    if(!id) return;
    deps.window.location.href = `/static/smart-canvas.html?id=${encodeURIComponent(id)}&v=2026.05.22.1`;
}

function requestDeleteCanvas(deps, id, event){
    event?.preventDefault();
    event?.stopPropagation();

    deps.pendingPurgeCanvasId = null;
    deps.pendingDeleteCanvasId = id;

}

function requestPurgeCanvas(deps, id, event){
    event?.preventDefault();
    event?.stopPropagation();

    deps.pendingDeleteCanvasId = null;
    deps.pendingPurgeCanvasId = id;

}

function cancelDeleteCanvas(deps, event){
    event?.preventDefault();
    event?.stopPropagation();
    deps.pendingDeleteCanvasId = null;
    deps.pendingPurgeCanvasId = null;

}

async function deleteCanvas(deps, id, event){
    event?.preventDefault();
    event?.stopPropagation();
    deps.setStatus('Moving to trash...');
    try {
        const res = await deps.fetch(`/api/canvases/${id}`, {method:'DELETE'});
        if(!res.ok) throw new Error(deps.tr('canvas.moveToTrashFailed'));
        if(deps.openingCanvasId===id){
            deps.canvasOpenGeneration++;
            deps.openingCanvasId='';
        }
        const deletingCurrent = deps.canvas?.id === id;
        deps.pendingDeleteCanvasId = null;
        deps.canvases = deps.canvases.filter(item => item.id !== id);
        if(deletingCurrent){
            deps.classicRemoteSync.stop();
            deps.canvas = null;
            deps.nodes = [];
            deps.connections = [];
            deps.selected.clear();
            deps.viewport = {x: -1800, y: -1000, scale: 1};
            deps.setCanvasMode(false);
        }

        deps.setStatus(deps.canvases.length ? deps.tr('canvas.movedToTrash') : deps.tr('canvas.noCanvasCreateFirst'));
        await loadCanvasList(deps, false);
    } catch(e) {
        deps.setStatus(deps.tr('canvas.moveToTrashFailed'));
        deps.console.error(e);
    }
}

async function restoreCanvas(deps, id, event){
    event?.preventDefault();
    event?.stopPropagation();
    deps.setStatus('Restoring...');
    try {
        const res = await deps.fetch(`/api/canvases/${id}/restore`, {method:'POST'});
        if(!res.ok) throw new Error(deps.tr('canvas.restoreFailed'));
        deps.pendingPurgeCanvasId = null;
        deps.deletedCanvases = deps.deletedCanvases.filter(item => item.id !== id);
        await loadCanvasList(deps, false);
        await loadTrashList(deps);
        deps.setStatus(deps.tr('canvas.restored'));
    } catch(e) {
        deps.setStatus(deps.tr('canvas.restoreFailed'));
        deps.console.error(e);
    }
}

async function purgeCanvas(deps, id, event){
    event?.preventDefault();
    event?.stopPropagation();
    deps.setStatus('Deleting...');
    try {
        const res = await deps.fetch(`/api/canvases/${id}/purge`, {method:'DELETE'});
        if(!res.ok) throw new Error(deps.tr('canvas.purgeFailed'));
        deps.pendingPurgeCanvasId = null;
        deps.deletedCanvases = deps.deletedCanvases.filter(item => item.id !== id);

        deps.setStatus(deps.deletedCanvases.length ? deps.tr('canvas.purged') : deps.tr('canvas.trashEmpty'));
        await loadTrashList(deps);
    } catch(e) {
        deps.setStatus(deps.tr('canvas.purgeFailed'));
        deps.console.error(e);
    }
}

// Compatibility for older embedded gates. The current editor has no gate controls;
// its standalone canvas-list page owns its own listeners and creation UI.
function createLegacyGateBindings(deps){
    let active=false;
    const bindings=[];
    function bind(element,type,handler){
        if(!element) return;
        element.addEventListener(type,handler);
        bindings.push([element,type,handler]);
    }
    function resume(){
        if(active) return;
        active=true;
        bind(deps.gateCreateBtn,'click',()=>setCreateMode(deps,true));
        bind(deps.gateCreateSmartBtn,'click',()=>createSmartCanvas(deps));
        bind(deps.gateBackBtn,'click',()=>setTrashMode(deps,false));
        bind(deps.gateTrashBtn,'click',()=>setTrashMode(deps,true));
        bind(deps.gateRefreshBtn,'click',()=>deps.trashMode?loadTrashList(deps):loadCanvasList(deps,false));
        bind(deps.document?.getElementById?.('gateSortSwitch'),'click',event=>{
            const btn=event.target.closest('[data-sort]');
            if(btn) setCanvasSortMode(deps,btn.dataset.sort);
        });
        bind(deps.gateConfirmBtn,'click',()=>createCanvas(deps));
        bind(deps.gateCancelBtn,'click',()=>setCreateMode(deps,false));
        bind(deps.gateTitleInput,'keydown',event=>{
            if(event.key==='Enter') createCanvas(deps);
            if(event.key==='Escape') setCreateMode(deps,false);
        });
    }
    function suspend(){
        for(const [element,type,handler] of bindings) element.removeEventListener(type,handler);
        bindings.length=0;
        active=false;
    }
    return {resume,suspend};
}

    const api={refreshGateViewControls, setCreateMode, loadCanvasList, loadTrashList, refreshTrashCount, setTrashMode, compareCanvasRecords, sortCanvasListByUpdated, setCanvasSortMode, patchCanvasMeta, updateCanvasListRecord, touchCanvasOpened, createCanvas, createSmartCanvas, openSmartCanvasPage, requestDeleteCanvas, requestPurgeCanvas, cancelDeleteCanvas, deleteCanvas, restoreCanvas, purgeCanvas, createLegacyGateBindings};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.CanvasDocumentManagement=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
