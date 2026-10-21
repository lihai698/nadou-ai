/* Asset panel responsibility: smart-asset-panel. Host supplies live state and effects. */
(function(root){
    'use strict';

function toggleAssetLibrary(deps, open=!deps.assetLibraryOpen){
    if(!deps.assetPanel || !deps.assetToggle) return;
    deps.assetLibraryOpen = !!open;
    deps.assetPanel.classList.toggle('open', deps.assetLibraryOpen);
    deps.assetToggle?.classList.toggle('active', deps.assetLibraryOpen);
    if(deps.assetLibraryOpen) deps.loadAssetLibrary();
    deps.render();
}

function assetCategoryForMention(deps){
    const cats = deps.assetCategories('image');
    if(!cats.length) return null;
    return cats.find(cat => cat.id === deps.mentionAssetCategoryId)
        || cats.find(cat => cat.id === deps.activeAssetCategoryId)
        || cats.find(cat => (cat.items || []).length)
        || cats[0];
}

function assetMediaKind(deps, item){
    if(!item) return 'image';
    if(item.kind === 'workflow' || item.type === 'workflow') return 'workflow';
    if(item.kind === 'video' || item.type === 'video') return 'video';
    if(item.kind === 'audio' || item.type === 'audio') return 'audio';
    const url = String(item.url || item.thumbnail || '').toLowerCase().split('?')[0];
    const name = String(item.name || '').toLowerCase();
    if(/\.(mp4|webm|mov|m4v|avi|mkv)$/.test(url) || /\.(mp4|webm|mov|m4v|avi|mkv)$/.test(name)) return 'video';
    if(/\.(mp3|wav|m4a|aac|ogg|flac)$/.test(url) || /\.(mp3|wav|m4a|aac|ogg|flac)$/.test(name)) return 'audio';
    if(/\.(json|zip)$/.test(url) || /\.(json|zip)$/.test(name)) return 'workflow';
    return 'image';
}

function assetNodeImageFromItem(deps, item, fallbackName='asset'){
    const url = item?.url || item?.local_url || item?.source_url || item?.sourceUrl || item?.preview || item?.thumbnail || item?.thumb || '';
    const image = {
        url,
        name:item?.name || fallbackName,
        kind:item?.kind || assetMediaKind(deps, item)
    };
    deps.copyMediaSizeFields(item, image);
    if(item?.asset_uris && typeof item.asset_uris === 'object') image.asset_uris = {...item.asset_uris};
    return image;
}

function assetThumbHtml(deps, item){
    if(item?.cover_url) return `<div class="asset-thumb-wrap"><img src="${deps.escapeAttr(item.cover_url)}" alt="${deps.escapeAttr(item.name || '工作流')}" loading="lazy"></div>`;
    const url = deps.escapeAttr(item.url || '');
    const thumb = item.thumbnail || item.thumb || item.preview || item.url || '';
    const kind = assetMediaKind(deps, item);
    if(kind === 'video'){
        return `<div class="asset-thumb-wrap">${deps.smartVideoPreviewHtml(item, 256, 'class="asset-thumb" loading="lazy" decoding="async" alt=""')}<span class="asset-video-badge"><i data-lucide="film"></i>VIDEO</span></div>`;
    }
    if(kind === 'audio'){
        return `<div class="asset-thumb-wrap media-thumb audio-thumb asset-thumb"><i data-lucide="file-audio"></i><span>${deps.escapeHtml(item.name || 'Audio')}</span></div>`;
    }
    if(kind === 'workflow'){
        return `<div class="asset-thumb-wrap media-thumb workflow-thumb asset-thumb"><i data-lucide="workflow"></i><span>${deps.escapeHtml(item.name || 'Workflow')}</span></div>`;
    }
    // 网格缩略图用较小尺寸 + 懒加载/异步解码：素材多时滚动不再一次性加载解码全部图片。
    return deps.smartPreviewImgHtml({...item, url:thumb}, 256, 'class="asset-thumb" loading="lazy" decoding="async" alt=""');
}

function renderAssetLibrary(deps){
    if(!deps.assetPanel || !deps.assetGrid || !deps.assetCategorySelect) return;
    deps.document.querySelectorAll('[data-asset-tab]').forEach(btn => btn.classList.toggle('active', btn.dataset.assetTab === deps.assetTab));
    const libs = deps.currentAssetSourceLibraries();
    if(!deps.activeAssetLibraryId || !libs.some(lib => lib.id === deps.activeAssetLibraryId)) deps.activeAssetLibraryId = deps.assetLibrary.active_library_id || deps.assetLibraries()[0]?.id || deps.LOCAL_ASSET_LIBRARY_ID;
    if(deps.assetLibrarySelect){
        deps.assetLibrarySelect.innerHTML = libs.map(lib => `<option value="${deps.escapeHtml(lib.id)}" ${lib.id === deps.activeAssetLibraryId ? 'selected' : ''}>${deps.escapeHtml(lib.name || '资产库')}</option>`).join('');
    }
    const imageMode = deps.assetTab === 'image';
    const workflowMode = deps.assetTab === 'workflow';
    deps.assetImageControls.style.display = (imageMode || workflowMode) ? 'block' : 'none';
    const localMode = deps.assetLibraryIsLocal();
    deps.assetDropZone.style.display = imageMode ? 'flex' : 'none';
    deps.assetGrid.style.display = (imageMode || workflowMode) ? 'grid' : 'none';
    deps.workflowEmpty.style.display = 'none';
    if(!imageMode && !workflowMode){ deps.refreshIcons(); return; }
    const baseCats = workflowMode ? deps.workflowAssetCategories() : deps.assetCategories('image');
    const smartClassCats = imageMode && !localMode ? deps.assetSmartClassEntries().map(entry => ({
        ...entry,
        id:entry.id,
        name:`${entry.label} / ${entry.tag} (${entry.count})`,
        type:'image',
        smartClass:true,
        items:[]
    })) : [];
    const cats = workflowMode ? baseCats : [...baseCats, ...smartClassCats];
    const activeCatId = workflowMode ? deps.activeWorkflowAssetCategoryId : deps.activeAssetCategoryId;
    if(workflowMode && !cats.some(cat => cat.id === deps.activeWorkflowAssetCategoryId)) deps.activeWorkflowAssetCategoryId = cats[0]?.id || '';
    if(imageMode && !cats.some(cat => cat.id === deps.activeAssetCategoryId)) deps.activeAssetCategoryId = cats[0]?.id || '';
    deps.assetCategorySelect.innerHTML = cats.map(cat => `<option value="${deps.escapeHtml(cat.id)}" ${cat.id === (workflowMode ? deps.activeWorkflowAssetCategoryId : deps.activeAssetCategoryId) ? 'selected' : ''}>${deps.escapeHtml(cat.name || (workflowMode ? '工作流' : deps.tr('smart.assetFolder')))}</option>`).join('');
    const cat = workflowMode ? deps.activeWorkflowAssetCategory() : deps.activeAssetCategory();
    const smartClass = imageMode ? deps.parseAssetSmartClassId(deps.activeAssetCategoryId) : null;
    const items = smartClass ? deps.itemsForAssetSmartClass(deps.activeAssetCategoryId) : (cat?.items || []);
    if(deps.assetAddCategoryBtn) deps.assetAddCategoryBtn.disabled = Boolean(smartClass);
    if(deps.assetRenameCategoryBtn) deps.assetRenameCategoryBtn.disabled = !cat || Boolean(smartClass) || (localMode && (cat.id === '__root__' || !cat.id));
    deps.assetGrid.innerHTML = items.length ? items.map(item => `
        <div class="asset-item ${workflowMode ? 'workflow-asset-item' : ''}" draggable="true" data-asset-id="${deps.escapeHtml(item.id)}" data-url="${deps.escapeHtml(item.url)}" data-name="${deps.escapeHtml(item.name || 'asset')}" data-kind="${deps.escapeHtml(assetMediaKind(deps, item))}">
            ${assetThumbHtml(deps, item)}
            <div class="asset-meta">
                <span class="asset-name" ${localMode ? `data-rename-local-asset="${deps.escapeHtml(item.id)}"` : ''} title="${deps.escapeHtml(item.name || '')}">${deps.escapeHtml(item.name || 'asset')}</span>
                ${workflowMode
                    ? `<button class="asset-mini-btn" type="button" data-rename-workflow-asset="${deps.escapeHtml(item.id)}" title="${deps.escapeHtml(deps.tr('smart.assetRename'))}"><i data-lucide="pencil"></i></button>
                       <button class="asset-mini-btn" type="button" data-delete-workflow-asset="${deps.escapeHtml(item.id)}" title="${deps.escapeHtml(deps.tr('common.delete'))}"><i data-lucide="trash-2"></i></button>`
                    : localMode ? `<button class="asset-mini-btn" type="button" data-rename-local-asset="${deps.escapeHtml(item.id)}" title="${deps.escapeHtml(deps.tr('smart.assetRename'))}"><i data-lucide="pencil"></i></button>
                       <button class="asset-mini-btn" type="button" data-delete-local-asset="${deps.escapeHtml(item.id)}" title="${deps.escapeHtml(deps.tr('common.delete'))}"><i data-lucide="trash-2"></i></button>` : `<button class="asset-mini-btn" type="button" data-rename-asset="${deps.escapeHtml(item.id)}" title="${deps.escapeHtml(deps.tr('smart.assetRename'))}"><i data-lucide="pencil"></i></button>
                       <button class="asset-mini-btn" type="button" data-delete-asset="${deps.escapeHtml(item.id)}" title="${deps.escapeHtml(deps.tr('common.delete'))}"><i data-lucide="trash-2"></i></button>`}
            </div>
        </div>
    `).join('') : `<div class="asset-empty">${deps.escapeHtml(localMode ? '暂无本地素材，拖入图片即可保存' : (smartClass ? '这个智能分类下暂无素材' : (workflowMode ? '暂无工作流资产' : deps.tr('smart.assetEmpty'))))}</div>`;
    if(workflowMode) bindWorkflowAssetItemEvents(deps);
    else bindAssetItemEvents(deps);
    deps.bindSmartPreviewImageFallbacks(deps.assetGrid);
    deps.refreshIcons();
}

function openAssetNameDialog(deps, {title='', value='', placeholder='', cancelValue='', multiline=false }={}){
    if(!deps.assetDialogBackdrop || !deps.assetDialogInput || !deps.assetDialogOk || !deps.assetDialogCancel) return Promise.resolve(cancelValue);
    return new Promise(resolve => {
        deps.assetDialogTitle.textContent = title || deps.tr('smart.assetRename');
        deps.assetDialogInput.value = value || '';
        deps.assetDialogInput.placeholder = placeholder || '';
        deps.assetDialogInput.classList.toggle('is-multiline', Boolean(multiline));
        deps.assetDialogInput.rows = multiline ? 5 : 1;
        deps.assetDialogBackdrop.hidden = false;
        deps.assetDialogBackdrop.classList.add('open');
        deps.assetDialogInput.focus();
        deps.assetDialogInput.select();
        const cleanup = result => {
            deps.assetDialogBackdrop.classList.remove('open');
            deps.assetDialogBackdrop.hidden = true;
            deps.assetDialogOk.onclick = null;
            deps.assetDialogCancel.onclick = null;
            deps.assetDialogInput.onkeydown = null;
            deps.assetDialogBackdrop.onmousedown = null;
            deps.assetDialogInput.classList.remove('is-multiline');
            deps.assetDialogInput.rows = 1;
            resolve(result);
        };
        deps.assetDialogOk.onclick = () => cleanup(deps.assetDialogInput.value.trim());
        deps.assetDialogCancel.onclick = () => cleanup(cancelValue);
        deps.assetDialogInput.onkeydown = event => {
            if(event.key === 'Enter' && !multiline) cleanup(deps.assetDialogInput.value.trim());
            if(event.key === 'Enter' && multiline && (event.ctrlKey || event.metaKey)) cleanup(deps.assetDialogInput.value.trim());
            if(event.key === 'Escape') cleanup(cancelValue);
        };
        deps.assetDialogBackdrop.onmousedown = event => {
            if(event.target === deps.assetDialogBackdrop) cleanup(cancelValue);
        };
    });
}

function positionAssetHoverPreview(deps, event){
    if(!deps.assetHoverPreview || deps.assetHoverPreview.hidden || deps.assetHoverPreview.style.display === 'none') return;
    const pad = 14;
    const w = deps.assetHoverPreview.offsetWidth || 260;
    const h = deps.assetHoverPreview.offsetHeight || 300;
    let left = event.clientX - w - 16;
    if(left < pad) left = event.clientX + 16;
    left = Math.max(pad, Math.min(deps.window.innerWidth - w - pad, left));
    const top = Math.max(pad, Math.min(deps.window.innerHeight - h - pad, event.clientY + 12));
    deps.assetHoverPreview.style.left = `${left}px`;
    deps.assetHoverPreview.style.top = `${top}px`;
}

function showAssetHoverPreview(deps, event, item){
    if(!deps.assetHoverPreview || !item?.url) return;
    let media = deps.assetHoverPreview.querySelector('img,video');
    const name = deps.assetHoverPreview.querySelector('.asset-hover-name');
    const kind = assetMediaKind(deps, item);
    if(kind === 'video' && media?.tagName?.toLowerCase() !== 'video'){
        media?.replaceWith(deps.document.createElement('video'));
        media = deps.assetHoverPreview.querySelector('video');
    } else if(kind !== 'video' && media?.tagName?.toLowerCase() !== 'img'){
        media?.replaceWith(deps.document.createElement('img'));
        media = deps.assetHoverPreview.querySelector('img');
    }
    if(kind === 'video'){
        media.muted = true;
        media.loop = true;
        media.playsInline = true;
        media.preload = 'metadata';
        media.controls = false;
        media.disablePictureInPicture = true;
        media.setAttribute('disablepictureinpicture', '');
        media.setAttribute('controlslist', 'nodownload noplaybackrate noremoteplayback');
        media.src = item.url;
        media.play?.().catch(() => {});
    } else {
        // 用预览代理（缩放图）而非原图，悬浮预览更快、不卡。
        media.loading = 'lazy';
        media.decoding = 'async';
        media.src = deps.smartMediaPreviewUrl(item, 768);
        media.alt = 'asset preview';
    }
    name.textContent = item.name || 'asset';
    deps.assetHoverPreview.hidden = false;
    deps.assetHoverPreview.style.display = 'block';
    positionAssetHoverPreview(deps, event);
}

function hideAssetHoverPreview(deps){
    if(!deps.assetHoverPreview) return;
    deps.assetHoverPreview.style.display = 'none';
    deps.assetHoverPreview.hidden = true;
    const media = deps.assetHoverPreview.querySelector('img,video');
    media?.pause?.();
    media?.removeAttribute('src');
    media?.load?.();
}

function beginAssetInlineRename(deps, assetId){
    const item = (deps.activeAssetCategory()?.items || []).find(x => x.id === assetId)
        || (deps.activeWorkflowAssetCategory()?.items || []).find(x => x.id === assetId);
    const card = [...deps.assetGrid.querySelectorAll('.asset-item')].find(el => el.dataset.assetId === assetId);
    const nameEl = card?.querySelector('.asset-name');
    if(!item || !card || !nameEl || card.querySelector('.asset-rename-input')) return;
    hideAssetHoverPreview(deps);
    const previousName = item.name || 'asset';
    const previousDraggable = card.draggable;
    const input = deps.document.createElement('input');
    input.className = 'asset-rename-input';
    input.type = 'text';
    input.value = previousName;
    input.setAttribute('aria-label', deps.tr('smart.assetRename'));
    card.draggable = false;
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const restore = () => {
        if(input.isConnected) input.replaceWith(nameEl);
        card.draggable = previousDraggable;
    };
    const finish = async save => {
        if(done) return;
        done = true;
        const name = input.value.trim();
        if(!save || !name || name === previousName){
            restore();
            return;
        }
        input.disabled = true;
        try {
            if(deps.assetLibraryIsLocal() || item.file){
                const data = await deps.fetch('/api/local-assets/items', {
                    method:'PATCH',
                    headers:{'Content-Type':'application/json'},
                    body:JSON.stringify({path:item.file || item.id, name})
                }).then(async r => {
                    if(!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || '重命名失败');
                    return r.json();
                });
                deps.localAssetLibrary = {items:Array.isArray(data.items) ? data.items : deps.localAssetLibrary.items, tree:data.tree || deps.localAssetLibrary.tree};
                deps.activeAssetCategoryId = data.item?.folder || deps.activeAssetCategoryId;
                if(data.old_path && data.item?.url){
                    const oldUrl = `/assets/uploads/${String(data.old_path).split('/').map(encodeURIComponent).join('/')}`;
                    deps.nodes.forEach(node => (node.images || []).forEach(img => {
                        if(img?.url !== oldUrl) return;
                        img.url = data.item.url;
                        img.name = data.item.name || img.name;
                        deps.copyMediaSizeFields(data.item, img);
                    }));
                    deps.scheduleSave();
                }
                renderAssetLibrary(deps);
                deps.render();
                deps.toast('已重命名本地素材，反推提示词和分类索引已同步');
            } else {
                const data = await deps.fetch(`/api/asset-library/items/${encodeURIComponent(assetId)}`, {method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name})}).then(r => r.json());
                deps.setAssetLibraryFromResponse(data);
            }
        } catch(err){
            restore();
            deps.toast(err.message || deps.tr('smart.assetAddFail'));
        }
    };
    input.addEventListener('keydown', event => {
        event.stopPropagation();
        if(event.key === 'Enter'){
            event.preventDefault();
            finish(true);
        } else if(event.key === 'Escape'){
            event.preventDefault();
            finish(false);
        }
    });
    input.addEventListener('pointerdown', event => event.stopPropagation());
    input.addEventListener('mousedown', event => event.stopPropagation());
    input.addEventListener('click', event => event.stopPropagation());
    input.addEventListener('blur', () => finish(true));
}

function bindAssetItemEvents(deps){
    deps.assetGrid.querySelectorAll('.asset-item').forEach(el => {
        const thumb = el.querySelector('.asset-thumb');
        // 悬浮预览延迟显示：滚动时缩略图会从光标下快速划过、连发 mouseenter，立即加载大图会卡。延迟后只在
        // 光标真正停留时才加载预览，滚动划过不触发。
        thumb?.addEventListener('mouseenter', e => {
            deps.clearTimeout(deps.assetHoverTimer);
            const data = {url:el.dataset.url, name:el.dataset.name, kind:el.dataset.kind};
            const cx = e.clientX, cy = e.clientY;
            deps.assetHoverTimer = deps.setTimeout(() => showAssetHoverPreview(deps, {clientX:cx, clientY:cy}, data), 160);
        });
        thumb?.addEventListener('mousemove', e => positionAssetHoverPreview(deps, e));
        thumb?.addEventListener('mouseleave', () => { deps.clearTimeout(deps.assetHoverTimer); hideAssetHoverPreview(deps); });
        el.addEventListener('dragstart', e => {
            hideAssetHoverPreview(deps);
            e.dataTransfer.effectAllowed = 'copy';
            const item = (deps.activeAssetCategory()?.items || []).find(x => x.id === el.dataset.assetId);
            const asset = assetNodeImageFromItem(deps, item || {url:el.dataset.url, name:el.dataset.name, kind:el.dataset.kind});
            e.dataTransfer.setData('application/x-smart-asset', JSON.stringify(asset));
            e.dataTransfer.setData('text/plain', asset.url || el.dataset.url || '');
        });

    });
    deps.assetGrid.querySelectorAll('[data-rename-asset]').forEach(btn => {
        btn.onclick = async e => {
            e.preventDefault(); e.stopPropagation();
            beginAssetInlineRename(deps, btn.dataset.renameAsset);
        };
    });
    deps.assetGrid.querySelectorAll('[data-rename-local-asset]').forEach(btn => {
        btn.onclick = async e => {
            e.preventDefault(); e.stopPropagation();
            beginAssetInlineRename(deps, btn.dataset.renameLocalAsset || '');
        };
    });
    deps.assetGrid.querySelectorAll('[data-delete-local-asset]').forEach(btn => {
        btn.onclick = async e => {
            e.preventDefault(); e.stopPropagation();
            btn.disabled = true;
            await deps.deleteLocalAssetFromPanel(btn.dataset.deleteLocalAsset || '');
        };
    });
    deps.assetGrid.querySelectorAll('[data-delete-asset]').forEach(btn => {
        btn.onclick = async e => {
            e.preventDefault(); e.stopPropagation();
            btn.disabled = true;
            try {
                const data = await deps.fetch(`/api/asset-library/items/${encodeURIComponent(btn.dataset.deleteAsset)}`, {method:'DELETE'}).then(r => r.json());
                deps.setAssetLibraryFromResponse(data);
            } catch(err){
                btn.disabled = false;
                deps.toast(err.message || deps.tr('smart.assetAddFail'));
            }
        };
    });
}

function bindWorkflowAssetItemEvents(deps){
    deps.assetGrid.querySelectorAll('.workflow-asset-item').forEach(card=>{
        card.addEventListener('dragstart',event=>{event.dataTransfer.effectAllowed='copy';event.dataTransfer.setData('application/x-smart-asset',JSON.stringify({url:card.dataset.url,name:card.dataset.name,kind:'workflow'}));});
        card.addEventListener('dblclick',event=>{if(!event.target.closest('button,input'))deps.importSmartWorkflowAssetUrl(card.dataset.url,card.dataset.name||'workflow');});
        card.title='拖入画布或双击引用工作流';
    });
    deps.assetGrid.querySelectorAll('[data-rename-workflow-asset]').forEach(btn => {
        btn.onclick = async e => {
            e.preventDefault();
            e.stopPropagation();
            beginAssetInlineRename(deps, btn.dataset.renameWorkflowAsset);
        };
    });
    deps.assetGrid.querySelectorAll('[data-delete-workflow-asset]').forEach(btn => {
        btn.onclick = async e => {
            e.preventDefault();
            e.stopPropagation();
            const item = (deps.activeWorkflowAssetCategory()?.items || []).find(x => x.id === btn.dataset.deleteWorkflowAsset);
            if(!item) return;
            btn.disabled = true;
            try {
                const data = await deps.fetch(`/api/asset-library/items/${encodeURIComponent(item.id)}`, {method:'DELETE'}).then(r => r.json());
                deps.setAssetLibraryFromResponse(data);
            } catch(err){
                btn.disabled = false;
                deps.toast(err.message || deps.tr('smart.assetAddFail'));
            }
        };
    });
}

    const api={toggleAssetLibrary, assetCategoryForMention, assetMediaKind, assetNodeImageFromItem, assetThumbHtml, renderAssetLibrary, openAssetNameDialog, positionAssetHoverPreview, showAssetHoverPreview, hideAssetHoverPreview, beginAssetInlineRename, bindAssetItemEvents, bindWorkflowAssetItemEvents};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.SmartAssetPanel=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
