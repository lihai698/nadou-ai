/* Asset panel responsibility: canvas-asset-panel. Host supplies live state and effects. */
(function(root){
    'use strict';

function canvasAssetLibraries(deps){
    return Array.isArray(deps.canvasAssetLibrary.libraries) && deps.canvasAssetLibrary.libraries.length ? deps.canvasAssetLibrary.libraries : [{id:'default', name:'默认资产库', categories:deps.canvasAssetLibrary.categories || []}];
}

function localCanvasAssetFolderCategories(deps){
    const result = [];
    const walk = node => {
        if(!node) return;
        const isRoot = (node.id || node.path || '__root__') === '__root__';
        result.push({
            id: node.id || (node.path ? node.path : '__root__'),
            name: node.name || (node.path ? node.path.split('/').pop() : '全部上传'),
            type: 'image',
            items: (isRoot ? (deps.localCanvasAssetLibrary.items || []) : (node.items || [])).filter(item => canvasAssetItemKind(deps, item) === 'image'),
            readonly: true,
            source: 'local',
        });
        (node.children || []).forEach(walk);
    };
    walk(deps.localCanvasAssetLibrary.tree || {id:'__root__', name:'全部上传', items:deps.localCanvasAssetLibrary.items || [], children:[]});
    return result.filter(cat => cat.id === '__root__' || cat.items.length || (deps.localCanvasAssetLibrary.tree?.children || []).length);
}

function canvasAssetLibraryIsLocal(deps){
    return deps.activeCanvasAssetLibraryId === deps.LOCAL_CANVAS_ASSET_LIBRARY_ID;
}

function canvasAssetSourceLibraries(deps){
    return [
        ...canvasAssetLibraries(deps),
        {id:deps.LOCAL_CANVAS_ASSET_LIBRARY_ID, name:'本地素材', categories:localCanvasAssetFolderCategories(deps), readonly:true, source:'local'}
    ];
}

function activeCanvasAssetLibrary(deps){
    if(canvasAssetLibraryIsLocal(deps)) return canvasAssetSourceLibraries(deps).find(lib => lib.id === deps.LOCAL_CANVAS_ASSET_LIBRARY_ID);
    const libs = canvasAssetLibraries(deps);
    return libs.find(lib => lib.id === deps.activeCanvasAssetLibraryId) || libs[0] || null;
}

function canvasAssetCategories(deps){
    return (activeCanvasAssetLibrary(deps)?.categories || deps.canvasAssetLibrary.categories || []).filter(cat => {
        const type = String(cat.type || 'image').toLowerCase();
        return type === 'image' || type === 'media' || type === 'workflow';
    });
}

function canvasMediaCategories(deps){
    return (activeCanvasAssetLibrary(deps)?.categories || deps.canvasAssetLibrary.categories || []).filter(cat => {
        const type = String(cat.type || 'image').toLowerCase();
        return type === 'image' || type === 'media';
    });
}

function activeCanvasAssetCategory(deps){
    const cats = canvasAssetCategories(deps);
    return cats.find(cat => cat.id === deps.activeCanvasAssetCategoryId) || cats[0] || null;
}

function activeCanvasMediaCategory(deps){
    const cats = canvasMediaCategories(deps);
    return cats.find(cat => cat.id === deps.activeCanvasAssetCategoryId) || cats[0] || null;
}

function canvasWorkflowCategories(deps){
    return (activeCanvasAssetLibrary(deps)?.categories || deps.canvasAssetLibrary.categories || []).filter(cat => String(cat.type || '').toLowerCase() === 'workflow');
}

function activeCanvasWorkflowCategory(deps){
    const cats = canvasWorkflowCategories(deps);
    return cats.find(cat => cat.id === deps.activeCanvasWorkflowCategoryId) || cats[0] || null;
}

function currentCanvasAssetItem(deps, itemId){
    return (activeCanvasAssetCategory(deps)?.items || []).find(item => item.id === itemId)
        || (activeCanvasWorkflowCategory(deps)?.items || []).find(item => item.id === itemId)
        || null;
}

function canvasAssetItemKind(deps, item){
    const explicit = String(item?.kind || item?.mediaKind || '').toLowerCase();
    if(['image','video','audio','text','file','workflow'].includes(explicit)) return explicit;
    if(String(item?.type || '').toLowerCase() === 'workflow') return 'workflow';
    const url = String(item?.url || item || '');
    if(/\.(json|zip)(\?|#|$)/i.test(url)) return 'workflow';
    if(deps.isVideoUrl(url)) return 'video';
    if(deps.isAudioUrl(url)) return 'audio';
    return 'image';
}

function canvasAssetThumbHtml(deps, item){
    const kind = canvasAssetItemKind(deps, item);
    const url = deps.escapeAttr(item?.url || '');
    const thumbUrl = item?.thumbnail || item?.url || '';
    if(kind === 'video'){
        return `<div class="canvas-asset-thumb-wrap">${deps.canvasVideoPreviewHtml(item?.url || '', 512, 'class="canvas-asset-thumb" alt=""')}<div class="canvas-asset-video-badge"><i data-lucide="play"></i><span>VIDEO</span></div></div>`;
    }
    if(kind === 'audio'){
        return `<div class="canvas-asset-thumb-wrap canvas-asset-file-thumb"><i data-lucide="file-audio" class="w-6 h-6"></i><span>${deps.escapeHtml(item?.name || 'audio')}</span></div>`;
    }
    if(kind === 'workflow'){
        return `<div class="canvas-asset-thumb-wrap canvas-asset-file-thumb workflow-thumb"><i data-lucide="workflow" class="w-6 h-6"></i><span>${deps.escapeHtml(item?.name || 'workflow')}</span></div>`;
    }
    return `<div class="canvas-asset-thumb-wrap">${deps.canvasPreviewImgHtml(thumbUrl, 512, 'class="canvas-asset-thumb" alt=""')}</div>`;
}

function positionCanvasAssetHoverPreview(deps, event){
    if(!deps.canvasAssetHoverPreview || deps.canvasAssetHoverPreview.hidden || deps.canvasAssetHoverPreview.style.display === 'none') return;
    const pad = 14;
    const w = deps.canvasAssetHoverPreview.offsetWidth || 280;
    const h = deps.canvasAssetHoverPreview.offsetHeight || 330;
    let left = event.clientX - w - 16;
    if(left < pad) left = event.clientX + 16;
    left = Math.max(pad, Math.min(deps.window.innerWidth - w - pad, left));
    const top = Math.max(pad, Math.min(deps.window.innerHeight - h - pad, event.clientY + 12));
    deps.canvasAssetHoverPreview.style.left = `${left}px`;
    deps.canvasAssetHoverPreview.style.top = `${top}px`;
}

function showCanvasAssetHoverPreview(deps, event, item){
    if(!deps.canvasAssetHoverPreview || !item?.url) return;
    if(canvasAssetItemKind(deps, item) === 'workflow') return;
    const img = deps.canvasAssetHoverPreview.querySelector('img');
    const video = deps.canvasAssetHoverPreview.querySelector('video');
    const isVideo = canvasAssetItemKind(deps, item) === 'video';
    const name = deps.canvasAssetHoverPreview.querySelector('.canvas-asset-hover-name');
    if(img){
        img.style.display = 'block';
        img.src = deps.canvasMediaPreviewUrl(isVideo ? item.url : (item.thumbnail || item.url || ''), 768);
        img.dataset.previewSrc = img.src || '';
        img.dataset.originalSrc = item.url || item.thumbnail || '';
        img.dataset.url = item.url || item.thumbnail || '';
        img.dataset.previewKind = isVideo ? 'video' : '';
        img.dataset.videoFallbackAttrs = '';
        img.alt = item.name || 'asset preview';
    }
    if(video){
        video.style.display = 'none';
        video.removeAttribute('src');
    }
    deps.bindCanvasPreviewImageFallbacks(deps.canvasAssetHoverPreview);
    if(name) name.textContent = item.name || 'asset';
    deps.canvasAssetHoverPreview.hidden = false;
    deps.canvasAssetHoverPreview.style.display = 'block';
    positionCanvasAssetHoverPreview(deps, event);
}

function hideCanvasAssetHoverPreview(deps){
    if(!deps.canvasAssetHoverPreview) return;
    deps.canvasAssetHoverPreview.style.display = 'none';
    deps.canvasAssetHoverPreview.hidden = true;
    const img = deps.canvasAssetHoverPreview.querySelector('img');
    if(img) img.removeAttribute('src');
    const video = deps.canvasAssetHoverPreview.querySelector('video');
    if(video) {
        video.pause?.();
        video.removeAttribute('src');
    }
}

async function renameCanvasAssetItem(deps, itemId){
    const item = currentCanvasAssetItem(deps, itemId);
    const name = deps.window.prompt('资产名称', item?.name || '');
    if(!item || !String(name || '').trim()) return;
    const data = await deps.fetch(`/api/asset-library/items/${encodeURIComponent(item.id)}`, {
        method:'PATCH',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({name:String(name).trim()})
    }).then(r => r.json());
    deps.canvasAssetLibrary = data.library || deps.canvasAssetLibrary;
    renderCanvasAssetLibrary(deps);
    if(deps.assetManagerModal?.classList.contains('open')) deps.renderAssetManager();
}

async function deleteCanvasAssetItem(deps, itemId){
    const item = currentCanvasAssetItem(deps, itemId);
    if(!item || !deps.window.confirm(`删除资产「${item.name || 'asset'}」？`)) return;
    const data = await deps.fetch(`/api/asset-library/items/${encodeURIComponent(item.id)}`, {method:'DELETE'}).then(r => r.json());
    deps.canvasAssetLibrary = data.library || deps.canvasAssetLibrary;
    deps.managerSelectedAssetIds.delete(item.id);
    deps.managerSelectedWorkflowIds.delete(item.id);
    hideCanvasAssetHoverPreview(deps);
    renderCanvasAssetLibrary(deps);
    if(deps.assetManagerModal?.classList.contains('open')) deps.renderAssetManager();
}

async function loadCanvasAssetLibrary(deps, {renderPanel=true}={}){
    try {
        const [data, localData] = await Promise.all([
            deps.fetch('/api/asset-library').then(r => r.json()),
            deps.fetch('/api/local-assets').then(r => r.ok ? r.json() : {items:[], tree:null}).catch(() => ({items:[], tree:null}))
        ]);
        deps.canvasAssetLibrary = data.library || deps.canvasAssetLibrary;
        deps.localCanvasAssetLibrary = {items:Array.isArray(localData.items) ? localData.items : [], tree:localData.tree || null};
        const libs = canvasAssetLibraries(deps);
        if(!deps.activeCanvasAssetLibraryId) deps.activeCanvasAssetLibraryId = deps.canvasAssetLibrary.active_library_id || libs[0]?.id || '';
        if(deps.activeCanvasAssetLibraryId !== deps.LOCAL_CANVAS_ASSET_LIBRARY_ID && !libs.some(lib => lib.id === deps.activeCanvasAssetLibraryId)) deps.activeCanvasAssetLibraryId = libs[0]?.id || '';
        const cats = canvasAssetCategories(deps);
        if(!cats.some(cat => cat.id === deps.activeCanvasAssetCategoryId)) deps.activeCanvasAssetCategoryId = cats[0]?.id || '';
        if(renderPanel) renderCanvasAssetLibrary(deps);
        return data;
    } catch(e) {
        deps.setStatus('资产库加载失败');
        return null;
    }
}

function renderCanvasAssetLibrary(deps){
    if(!deps.canvasAssetPanel || !deps.canvasAssetGrid) return;
    hideCanvasAssetHoverPreview(deps);
    const libs = canvasAssetSourceLibraries(deps);
    if(!deps.activeCanvasAssetLibraryId || !libs.some(lib => lib.id === deps.activeCanvasAssetLibraryId)) deps.activeCanvasAssetLibraryId = deps.canvasAssetLibrary.active_library_id || canvasAssetLibraries(deps)[0]?.id || deps.LOCAL_CANVAS_ASSET_LIBRARY_ID;
    if(deps.canvasAssetLibrarySelect){
        deps.canvasAssetLibrarySelect.innerHTML = libs.map(lib => `<option value="${deps.escapeAttr(lib.id)}" ${lib.id === deps.activeCanvasAssetLibraryId ? 'selected' : ''}>${deps.escapeHtml(lib.name || '资产库')}</option>`).join('');
    }
    const cats = canvasAssetCategories(deps);
    if(!cats.some(cat => cat.id === deps.activeCanvasAssetCategoryId)) deps.activeCanvasAssetCategoryId = cats[0]?.id || '';
    if(deps.canvasAssetCategorySelect){
        deps.canvasAssetCategorySelect.innerHTML = cats.map(cat => {
            const type = String(cat.type || 'image').toLowerCase();
            const prefix = type === 'workflow' ? '工作流 / ' : '';
            return `<option value="${deps.escapeAttr(cat.id)}" ${cat.id === deps.activeCanvasAssetCategoryId ? 'selected' : ''}>${deps.escapeHtml(prefix + (cat.name || '默认分组'))}</option>`;
        }).join('');
    }
    const cat = activeCanvasAssetCategory(deps);
    const catType = String(cat?.type || 'image').toLowerCase();
    const localMode = canvasAssetLibraryIsLocal(deps);
    if(deps.canvasAssetAddCategoryBtn) deps.canvasAssetAddCategoryBtn.disabled = localMode;
    if(deps.canvasAssetDropZone) {
        deps.canvasAssetDropZone.style.display = localMode ? 'none' : 'flex';
        deps.canvasAssetDropZone.textContent = catType === 'workflow' ? '工作流分组支持上传/导出工作流，双击卡片导入画布' : '拖入图片或输出保存到当前分组';
    }
    const items = cat?.items || [];
    deps.canvasAssetGrid.innerHTML = items.length ? items.map(item => `
        <div class="canvas-asset-item" draggable="true" data-asset-id="${deps.escapeAttr(item.id || '')}" data-url="${deps.escapeAttr(item.url)}" data-name="${deps.escapeAttr(item.name || 'asset')}" data-kind="${deps.escapeAttr(canvasAssetItemKind(deps, item))}">
            ${canvasAssetThumbHtml(deps, item)}
            <div class="canvas-asset-meta">
                <span class="canvas-asset-name" title="${deps.escapeAttr(item.name || '')}">${deps.escapeHtml(item.name || 'asset')}</span>
                ${localMode
                    ? `<span class="canvas-asset-local-tag">本地</span>`
                    : `<button class="canvas-asset-action" type="button" data-canvas-asset-rename="${deps.escapeAttr(item.id || '')}" title="重命名" aria-label="重命名"><i data-lucide="pencil" class="w-4 h-4"></i></button>
                       <button class="canvas-asset-action danger" type="button" data-canvas-asset-delete="${deps.escapeAttr(item.id || '')}" title="删除" aria-label="删除"><i data-lucide="trash-2" class="w-4 h-4"></i></button>`}
            </div>
        </div>
    `).join('') : `<div class="canvas-asset-empty">${deps.escapeHtml(localMode ? '暂无本地素材，请在素材库管理中上传' : '当前分组还没有资产')}</div>`;
    deps.bindCanvasPreviewImageFallbacks(deps.canvasAssetGrid);
    deps.canvasAssetGrid.querySelectorAll('.canvas-asset-item').forEach(card => {
        card.addEventListener('dragstart', event => {
            event.dataTransfer.effectAllowed = 'copy';
            event.dataTransfer.setData('application/x-canvas-asset', JSON.stringify({url:card.dataset.url, name:card.dataset.name, kind:card.dataset.kind || ''}));
            event.dataTransfer.setData('text/plain', card.dataset.url || '');
        });
        card.addEventListener('dblclick', () => {
            if(card.dataset.kind === 'workflow') deps.importWorkflowAssetUrl(card.dataset.url, card.dataset.name || 'workflow');
            else deps.createImageCardFromUrl(card.dataset.url, deps.defaultPoint(0, 0), card.dataset.name || 'asset');
        });
        const item = items.find(entry => entry.id === card.dataset.assetId);
        card.addEventListener('mouseenter', event => showCanvasAssetHoverPreview(deps, event, item));
        card.addEventListener('mousemove', (...args)=>positionCanvasAssetHoverPreview(deps, ...args));
        card.addEventListener('mouseleave', (...args)=>hideCanvasAssetHoverPreview(deps, ...args));
        card.querySelectorAll('.canvas-asset-action').forEach(btn => {
            btn.addEventListener('pointerdown', event => event.stopPropagation());
            btn.addEventListener('dblclick', event => event.stopPropagation());
        });
        card.querySelector('[data-canvas-asset-rename]')?.addEventListener('click', async event => {
            event.preventDefault();
            event.stopPropagation();
            hideCanvasAssetHoverPreview(deps);
            await renameCanvasAssetItem(deps, event.currentTarget.dataset.canvasAssetRename || '');
        });
        card.querySelector('[data-canvas-asset-delete]')?.addEventListener('click', async event => {
            event.preventDefault();
            event.stopPropagation();
            await deleteCanvasAssetItem(deps, event.currentTarget.dataset.canvasAssetDelete || '');
        });
    });
    deps.refreshIcons();
}

function toggleCanvasAssetLibrary(deps, open=!deps.canvasAssetLibraryOpen){
    deps.canvasAssetLibraryOpen = !!open;
    if(deps.canvasAssetLibraryOpen && deps.workflowTransferModal?.classList.contains('open')) deps.closeWorkflowTransferModal();
    deps.canvasAssetPanel?.classList.toggle('open', deps.canvasAssetLibraryOpen);
    deps.canvasAssetToggle?.classList.toggle('active', deps.canvasAssetLibraryOpen);
    if(!deps.canvasAssetLibraryOpen) hideCanvasAssetHoverPreview(deps);
    if(deps.canvasAssetLibraryOpen) loadCanvasAssetLibrary(deps);
}

async function addUrlToCanvasAssetLibrary(deps, url, name=''){
    if(canvasAssetLibraryIsLocal(deps)){ deps.setStatus('本地素材请在素材库管理中上传'); return; }
    const cat = activeCanvasAssetCategory(deps);
    if(!cat){ deps.setStatus('请先创建资产分组'); return; }
    if(String(cat.type || 'image').toLowerCase() === 'workflow'){ deps.setStatus('当前是工作流分组，请切换到图片分组保存媒体'); return; }
    const data = await deps.fetch('/api/asset-library/items', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({library_id:deps.activeCanvasAssetLibraryId, category_id:cat.id, url, name})
    }).then(async r => {
        if(!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || '保存失败');
        return r.json();
    });
    deps.canvasAssetLibrary = data.library || deps.canvasAssetLibrary;
    renderCanvasAssetLibrary(deps);
    deps.setStatus('已保存到资产库');
}

async function uploadFilesToLibrary(deps, files, libraryId, categoryId){
    const selected = [...files];
    if(!selected.length) return null;
    const form = new FormData();
    selected.forEach(file => form.append('files', file));
    const uploadResponse = await deps.fetch('/api/ai/upload', {method:'POST', body:form});
    const uploaded = await uploadResponse.json().catch(() => ({}));
    if(!uploadResponse.ok) throw new Error(uploaded.detail || '上传失败');
    if(!Array.isArray(uploaded.files) || uploaded.files.length !== selected.length || uploaded.files.some(file => !file?.url)){
        throw new Error('素材上传不完整，请重试');
    }
    const items = uploaded.files.map(file => ({library_id:libraryId, category_id:categoryId, url:file.url, name:file.name || 'asset'}));
    const response = await deps.fetch('/api/asset-library/items/batch', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({library_id:libraryId, category_id:categoryId, items})
    });
    const data = await response.json().catch(() => ({}));
    if(!response.ok || !data.library) throw new Error(data.detail || '保存素材失败');
    if(!Array.isArray(data.items) || data.items.length !== items.length){
        throw new Error('部分素材未保存，请刷新素材库后检查');
    }
    return data;
}

    const api={canvasAssetLibraries, localCanvasAssetFolderCategories, canvasAssetLibraryIsLocal, canvasAssetSourceLibraries, activeCanvasAssetLibrary, canvasAssetCategories, canvasMediaCategories, activeCanvasAssetCategory, activeCanvasMediaCategory, canvasWorkflowCategories, activeCanvasWorkflowCategory, currentCanvasAssetItem, canvasAssetItemKind, canvasAssetThumbHtml, positionCanvasAssetHoverPreview, showCanvasAssetHoverPreview, hideCanvasAssetHoverPreview, renameCanvasAssetItem, deleteCanvasAssetItem, loadCanvasAssetLibrary, renderCanvasAssetLibrary, toggleCanvasAssetLibrary, addUrlToCanvasAssetLibrary, uploadFilesToLibrary};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.CanvasAssetPanel=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
