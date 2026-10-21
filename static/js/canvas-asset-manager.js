/* Canvas menus and asset management: canvas-asset-manager. Host supplies live state and effects. */
(function(root){
    'use strict';

function openAssetManager(deps){
    deps.assetManagerModal?.classList.add('open');
    deps.managerSelectedAssetIds.clear();
    deps.managerSelectedPromptIds.clear();
    deps.canvasPromptTemplatesLoaded = false;
    Promise.all([deps.loadCanvasAssetLibrary({renderPanel:false}), deps.loadCanvasPromptTemplates()]).then((...args)=>renderAssetManager(deps, ...args));
}

function closeAssetManager(deps){
    deps.assetManagerModal?.classList.remove('open');
}

function renderAssetManager(deps){
    if(!deps.assetManagerBody) return;
    deps.clearAssetManagerUploads();
    deps.document.querySelectorAll('[data-manager-tab]').forEach(btn => btn.classList.toggle('active', btn.dataset.managerTab === deps.assetManagerTab));
    if(deps.assetManagerTab === 'prompts') renderPromptAssetManager(deps);
    else if(deps.assetManagerTab === 'workflows') renderWorkflowAssetManager(deps);
    else renderImageAssetManager(deps);
    deps.refreshIcons();
}

function renderImageAssetManager(deps){
    const libs = deps.canvasAssetLibraries();
    const library = deps.activeCanvasAssetLibrary();
    const cats = deps.canvasMediaCategories();
    if(!cats.some(cat => cat.id === deps.activeCanvasAssetCategoryId)) deps.activeCanvasAssetCategoryId = cats[0]?.id || '';
    const cat = deps.activeCanvasMediaCategory();
    const items = cat?.items || [];
    const canEditLibrary = !!library;
    const canEditCategory = !!cat;
    deps.assetManagerBody.innerHTML = `
        <div class="asset-manager-side">
            <div class="asset-manager-tools">
                <button type="button" class="primary" data-manager-asset-lib-new><i data-lucide="plus" class="w-4 h-4"></i><span>新资产库</span></button>
                <button type="button" ${!canEditLibrary ? 'disabled' : ''} data-manager-asset-lib-rename><i data-lucide="pencil" class="w-4 h-4"></i><span>重命名</span></button>
                <button type="button" class="danger" ${libs.length <= 1 ? 'disabled' : ''} data-manager-asset-lib-delete><i data-lucide="trash-2" class="w-4 h-4"></i><span>删除库</span></button>
            </div>
            <div class="asset-manager-list">
                ${libs.map(lib => `<button type="button" class="${lib.id === deps.activeCanvasAssetLibraryId ? 'active' : ''}" data-manager-asset-lib="${deps.escapeAttr(lib.id)}"><span>${deps.escapeHtml(lib.name || '资产库')}</span><small>${(lib.categories || []).reduce((n,c)=>n+(c.items || []).length,0)}</small></button>`).join('')}
            </div>
            <div class="asset-manager-tools">
                <button type="button" class="primary" data-manager-asset-cat-new><i data-lucide="folder-plus" class="w-4 h-4"></i><span>新分组</span></button>
                <button type="button" ${!canEditCategory ? 'disabled' : ''} data-manager-asset-cat-rename><i data-lucide="pencil" class="w-4 h-4"></i><span>重命名</span></button>
                <button type="button" class="danger" ${!canEditCategory ? 'disabled' : ''} data-manager-asset-cat-delete><i data-lucide="trash-2" class="w-4 h-4"></i><span>删除组</span></button>
            </div>
            <div class="asset-manager-list">
                ${cats.map(item => `<button type="button" class="${item.id === deps.activeCanvasAssetCategoryId ? 'active' : ''}" data-manager-asset-cat="${deps.escapeAttr(item.id)}"><span>${deps.escapeHtml(item.name || '分组')}</span><small>${(item.items || []).length}</small></button>`).join('')}
            </div>
        </div>
        <div class="asset-manager-main">
            <div class="asset-manager-tools">
                <label class="${!cat ? 'disabled' : ''}"><i data-lucide="upload" class="w-4 h-4"></i><span>批量上传</span><input id="managerAssetUpload" type="file" multiple accept="image/*" ${!cat ? 'disabled' : ''}></label>
                <button type="button" class="danger" ${deps.managerSelectedAssetIds.size ? '' : 'disabled'} data-manager-asset-delete><i data-lucide="trash-2" class="w-4 h-4"></i><span>删除所选 ${deps.managerSelectedAssetIds.size ? deps.managerSelectedAssetIds.size : ''}</span></button>
            </div>
            <div class="asset-manager-grid">
                ${items.length ? items.map(item => `<div class="asset-manager-card">
                    <input type="checkbox" data-manager-asset-check="${deps.escapeAttr(item.id)}" ${deps.managerSelectedAssetIds.has(item.id) ? 'checked' : ''}>
                    ${deps.canvasPreviewImgHtml(item.thumbnail || item.url || '', 512, 'alt=""')}
                    <span class="asset-manager-card-name" title="${deps.escapeAttr(item.name || '')}">${deps.escapeHtml(item.name || 'asset')}</span>
                    <div class="asset-manager-card-actions">
                        <button type="button" data-manager-asset-rename="${deps.escapeAttr(item.id)}"><i data-lucide="pencil" class="w-3.5 h-3.5"></i><span>重命名</span></button>
                        <button type="button" class="danger" data-manager-asset-remove="${deps.escapeAttr(item.id)}"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i><span>删除</span></button>
                    </div>
                </div>`).join('') : `<div class="canvas-asset-empty">当前分组为空</div>`}
            </div>
        </div>
    `;
    deps.bindCanvasPreviewImageFallbacks(deps.assetManagerBody);
    const upload = deps.document.getElementById('managerAssetUpload');
    if(upload) deps.bindAssetManagerUpload(upload, async () => {
        if(!upload.files?.length || !cat) return;
        try {
            const data = await deps.uploadFilesToLibrary(upload.files, library.id, cat.id);
            if(data?.library) deps.canvasAssetLibrary = data.library;
            deps.managerSelectedAssetIds.clear();
            renderAssetManager(deps);
            deps.renderCanvasAssetLibrary();
        } catch(err) {
            deps.showErrorModal(err.message || '保存素材失败', '保存素材失败');
        } finally {
            upload.value = '';
        }
    });
}

function workflowAssetThumbHtml(deps, item){
    if(item?.cover_url) return `<img src="${deps.escapeAttr(item.cover_url)}" alt="${deps.escapeAttr(item.name || '工作流')}" loading="lazy">`;
    return `<div class="asset-manager-card-text workflow-manager-thumb"><i data-lucide="workflow" class="w-6 h-6"></i><span>${deps.escapeHtml(item?.format === 'json' ? 'JSON 工作流' : 'ZIP 工作流包')}</span></div>`;
}

function renderWorkflowAssetManager(deps){
    const libs = deps.canvasAssetLibraries();
    const library = deps.activeCanvasAssetLibrary();
    const cats = deps.canvasWorkflowCategories();
    if(!cats.some(cat => cat.id === deps.activeCanvasWorkflowCategoryId)) deps.activeCanvasWorkflowCategoryId = cats[0]?.id || '';
    const cat = deps.activeCanvasWorkflowCategory();
    const items = cat?.items || [];
    deps.assetManagerBody.innerHTML = `
        <div class="asset-manager-side">
            <div class="asset-manager-tools">
                <button type="button" class="primary" data-manager-workflow-cat-new><i data-lucide="folder-plus" class="w-4 h-4"></i><span>新分组</span></button>
            </div>
            <div class="asset-manager-list">
                ${libs.map(lib => `<button type="button" class="${lib.id === deps.activeCanvasAssetLibraryId ? 'active' : ''}" data-manager-workflow-lib="${deps.escapeAttr(lib.id)}"><span>${deps.escapeHtml(lib.name || '资产库')}</span><small>${(lib.categories || []).filter(c => String(c.type || '') === 'workflow').reduce((n,c)=>n+(c.items || []).length,0)}</small></button>`).join('')}
            </div>
            <div class="asset-manager-list">
                ${cats.map(item => `<button type="button" class="${item.id === deps.activeCanvasWorkflowCategoryId ? 'active' : ''}" data-manager-workflow-cat="${deps.escapeAttr(item.id)}"><span>${deps.escapeHtml(item.name || '工作流')}</span><small>${(item.items || []).length}</small></button>`).join('') || '<div class="canvas-asset-empty">暂无工作流分组</div>'}
            </div>
        </div>
        <div class="asset-manager-main">
            <div class="asset-manager-tools">
                <label class="${!cat ? 'disabled' : ''}"><i data-lucide="upload" class="w-4 h-4"></i><span>上传工作流</span><input id="managerWorkflowUpload" type="file" multiple accept=".json,.zip,application/json,application/zip" ${!cat ? 'disabled' : ''}></label>
                <button type="button" ${!deps.managerSelectedWorkflowIds.size ? 'disabled' : ''} data-manager-workflow-export><i data-lucide="download" class="w-4 h-4"></i><span>导出所选 ${deps.managerSelectedWorkflowIds.size ? deps.managerSelectedWorkflowIds.size : ''}</span></button>
                <button type="button" class="danger" ${deps.managerSelectedWorkflowIds.size ? '' : 'disabled'} data-manager-workflow-delete><i data-lucide="trash-2" class="w-4 h-4"></i><span>删除所选 ${deps.managerSelectedWorkflowIds.size ? deps.managerSelectedWorkflowIds.size : ''}</span></button>
            </div>
            <div class="asset-manager-grid">
                ${items.length ? items.map(item => `<div class="asset-manager-card">
                    <input type="checkbox" data-manager-workflow-check="${deps.escapeAttr(item.id)}" ${deps.managerSelectedWorkflowIds.has(item.id) ? 'checked' : ''}>
                    ${workflowAssetThumbHtml(deps, item)}
                    <span class="asset-manager-card-name" title="${deps.escapeAttr(item.name || '')}">${deps.escapeHtml(item.name || 'workflow')}</span>
                    <div class="asset-manager-card-actions">
                        <button type="button" data-manager-workflow-rename="${deps.escapeAttr(item.id)}"><i data-lucide="pencil" class="w-3.5 h-3.5"></i><span>重命名</span></button>
                        <button type="button" class="danger" data-manager-workflow-remove="${deps.escapeAttr(item.id)}"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i><span>删除</span></button>
                    </div>
                </div>`).join('') : `<div class="canvas-asset-empty">当前分组为空</div>`}
            </div>
        </div>
    `;
    const upload = deps.document.getElementById('managerWorkflowUpload');
    if(upload) deps.bindAssetManagerUpload(upload, async () => {
        if(!upload.files?.length || !cat) return;
        const form = new FormData();
        form.append('library_id', library?.id || '');
        form.append('category_id', cat.id || '');
        [...upload.files].forEach(file => form.append('files', file));
        const data = await deps.fetch('/api/asset-library/workflows/upload', {method:'POST', body:form}).then(r => r.json());
        deps.canvasAssetLibrary = data.library || deps.canvasAssetLibrary;
        deps.managerSelectedWorkflowIds.clear();
        renderAssetManager(deps);
        deps.renderCanvasAssetLibrary();
    });
}

function renderPromptAssetManager(deps){
    const libs = deps.canvasPromptLibraries.filter(lib => lib.id !== 'system');
    if(!deps.canvasPromptLibraries.some(lib => lib.id === deps.activePromptLibraryId)) deps.activePromptLibraryId = libs[0]?.id || deps.canvasPromptLibraries[0]?.id || 'system';
    const lib = deps.canvasPromptLibraries.find(item => item.id === deps.activePromptLibraryId) || libs[0] || null;
    const items = lib?.items || [];
    const canEditLibrary = !!lib && !lib.readonly;
    deps.assetManagerBody.innerHTML = `
        <div class="asset-manager-side">
            <div class="asset-manager-tools">
                <button type="button" class="primary" data-manager-prompt-lib-new><i data-lucide="plus" class="w-4 h-4"></i><span>新提示词库</span></button>
                <button type="button" ${!canEditLibrary ? 'disabled' : ''} data-manager-prompt-lib-rename><i data-lucide="pencil" class="w-4 h-4"></i><span>重命名</span></button>
                <button type="button" class="danger" ${!canEditLibrary || deps.canvasPromptLibraries.length <= 1 ? 'disabled' : ''} data-manager-prompt-lib-delete><i data-lucide="trash-2" class="w-4 h-4"></i><span>删除库</span></button>
            </div>
            <div class="asset-manager-list">
                ${deps.canvasPromptLibraries.map(library => `<button type="button" class="${library.id === deps.activePromptLibraryId ? 'active' : ''}" data-manager-prompt-lib="${deps.escapeAttr(library.id)}"><span>${deps.escapeHtml(library.name || '提示词库')}</span><small>${(library.items || []).length}</small></button>`).join('')}
            </div>
        </div>
        <div class="asset-manager-main">
            <div class="asset-manager-tools">
                <button type="button" class="primary" ${!lib || lib.readonly ? 'disabled' : ''} data-manager-prompt-new><i data-lucide="file-plus-2" class="w-4 h-4"></i><span>新增提示词</span></button>
                <button type="button" class="danger" ${!lib || lib.readonly || !deps.managerSelectedPromptIds.size ? 'disabled' : ''} data-manager-prompt-delete><i data-lucide="trash-2" class="w-4 h-4"></i><span>删除所选 ${deps.managerSelectedPromptIds.size ? deps.managerSelectedPromptIds.size : ''}</span></button>
            </div>
            <div class="asset-manager-grid">
                ${items.length ? items.map(item => `<div class="asset-manager-card">
                    <input type="checkbox" data-manager-prompt-check="${deps.escapeAttr(item.id)}" ${deps.managerSelectedPromptIds.has(item.id) ? 'checked' : ''} ${lib?.readonly ? 'disabled' : ''}>
                    <div class="asset-manager-card-text">${deps.escapeHtml(item.positive || '')}</div>
                    <span class="asset-manager-card-name" title="${deps.escapeAttr(item.name || '')}">${deps.escapeHtml(item.name || '提示词')}</span>
                    <div class="asset-manager-card-actions">
                        <button type="button" ${lib?.readonly ? 'disabled' : ''} data-manager-prompt-edit="${deps.escapeAttr(item.id)}"><i data-lucide="pencil" class="w-3.5 h-3.5"></i><span>编辑</span></button>
                        <button type="button" class="danger" ${lib?.readonly ? 'disabled' : ''} data-manager-prompt-remove="${deps.escapeAttr(item.id)}"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i><span>删除</span></button>
                    </div>
                </div>`).join('') : `<div class="canvas-asset-empty">当前提示词库为空</div>`}
            </div>
        </div>
    `;
}

function handleAssetManagerTab(deps, btn){
        deps.assetManagerTab = btn.dataset.managerTab || 'assets';
        renderAssetManager(deps);
    }

function handleAssetManagerChange(deps, event){
    let shouldRender = false;
    const assetCheck = event.target.closest?.('[data-manager-asset-check]');
    if(assetCheck){
        if(assetCheck.checked) deps.managerSelectedAssetIds.add(assetCheck.dataset.managerAssetCheck);
        else deps.managerSelectedAssetIds.delete(assetCheck.dataset.managerAssetCheck);
        shouldRender = true;
    }
    const promptCheck = event.target.closest?.('[data-manager-prompt-check]');
    if(promptCheck){
        if(promptCheck.checked) deps.managerSelectedPromptIds.add(promptCheck.dataset.managerPromptCheck);
        else deps.managerSelectedPromptIds.delete(promptCheck.dataset.managerPromptCheck);
        shouldRender = true;
    }
    const workflowCheck = event.target.closest?.('[data-manager-workflow-check]');
    if(workflowCheck){
        if(workflowCheck.checked) deps.managerSelectedWorkflowIds.add(workflowCheck.dataset.managerWorkflowCheck);
        else deps.managerSelectedWorkflowIds.delete(workflowCheck.dataset.managerWorkflowCheck);
        shouldRender = true;
    }
    if(shouldRender) renderAssetManager(deps);
}

async function handleAssetManagerClick(deps, event){
    const assetLib = event.target.closest?.('[data-manager-asset-lib]');
    if(assetLib){ deps.activeCanvasAssetLibraryId = assetLib.dataset.managerAssetLib || ''; deps.activeCanvasAssetCategoryId = ''; deps.managerSelectedAssetIds.clear(); renderAssetManager(deps); return; }
    const assetCat = event.target.closest?.('[data-manager-asset-cat]');
    if(assetCat){ deps.activeCanvasAssetCategoryId = assetCat.dataset.managerAssetCat || ''; deps.managerSelectedAssetIds.clear(); renderAssetManager(deps); return; }
    const workflowLib = event.target.closest?.('[data-manager-workflow-lib]');
    if(workflowLib){ deps.activeCanvasAssetLibraryId = workflowLib.dataset.managerWorkflowLib || ''; deps.activeCanvasWorkflowCategoryId = ''; deps.managerSelectedWorkflowIds.clear(); renderAssetManager(deps); return; }
    const workflowCat = event.target.closest?.('[data-manager-workflow-cat]');
    if(workflowCat){ deps.activeCanvasWorkflowCategoryId = workflowCat.dataset.managerWorkflowCat || ''; deps.managerSelectedWorkflowIds.clear(); renderAssetManager(deps); return; }
    const promptLib = event.target.closest?.('[data-manager-prompt-lib]');
    if(promptLib){ deps.activePromptLibraryId = promptLib.dataset.managerPromptLib || 'system'; deps.managerSelectedPromptIds.clear(); renderAssetManager(deps); return; }
    const workflowRename = event.target.closest?.('[data-manager-workflow-rename]');
    if(workflowRename){
        const itemId = workflowRename.dataset.managerWorkflowRename || '';
        const item = (deps.activeCanvasWorkflowCategory()?.items || []).find(entry => entry.id === itemId);
        const name = deps.window.prompt('工作流名称', item?.name || '');
        if(!item || !String(name || '').trim()) return;
        const data = await deps.fetch(`/api/asset-library/items/${encodeURIComponent(item.id)}`, {method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name})}).then(r => r.json());
        deps.canvasAssetLibrary = data.library || deps.canvasAssetLibrary;
        renderAssetManager(deps); deps.renderCanvasAssetLibrary(); return;
    }
    const workflowRemove = event.target.closest?.('[data-manager-workflow-remove]');
    if(workflowRemove){
        const itemId = workflowRemove.dataset.managerWorkflowRemove || '';
        const item = (deps.activeCanvasWorkflowCategory()?.items || []).find(entry => entry.id === itemId);
        if(!item || !deps.window.confirm(`删除工作流「${item.name || 'workflow'}」？`)) return;
        const data = await deps.fetch(`/api/asset-library/items/${encodeURIComponent(item.id)}`, {method:'DELETE'}).then(r => r.json());
        deps.canvasAssetLibrary = data.library || deps.canvasAssetLibrary;
        deps.managerSelectedWorkflowIds.delete(item.id);
        renderAssetManager(deps); deps.renderCanvasAssetLibrary(); return;
    }
    const assetRename = event.target.closest?.('[data-manager-asset-rename]');
    if(assetRename){
        const itemId = assetRename.dataset.managerAssetRename || '';
        const item = (deps.activeCanvasMediaCategory()?.items || []).find(entry => entry.id === itemId);
        const name = deps.window.prompt('资产名称', item?.name || '');
        if(!item || !String(name || '').trim()) return;
        const data = await deps.fetch(`/api/asset-library/items/${encodeURIComponent(item.id)}`, {method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name})}).then(r => r.json());
        deps.canvasAssetLibrary = data.library || deps.canvasAssetLibrary;
        renderAssetManager(deps); deps.renderCanvasAssetLibrary(); return;
    }
    const assetRemove = event.target.closest?.('[data-manager-asset-remove]');
    if(assetRemove){
        const itemId = assetRemove.dataset.managerAssetRemove || '';
        const item = (deps.activeCanvasMediaCategory()?.items || []).find(entry => entry.id === itemId);
        if(!item || !deps.window.confirm(`删除资产「${item.name || 'asset'}」？`)) return;
        const data = await deps.fetch(`/api/asset-library/items/${encodeURIComponent(item.id)}`, {method:'DELETE'}).then(r => r.json());
        deps.canvasAssetLibrary = data.library || deps.canvasAssetLibrary;
        deps.managerSelectedAssetIds.delete(item.id);
        renderAssetManager(deps); deps.renderCanvasAssetLibrary(); return;
    }
    const promptEdit = event.target.closest?.('[data-manager-prompt-edit]');
    if(promptEdit){
        const lib = deps.activeCanvasPromptLibrary();
        if(!lib || lib.readonly) return;
        const itemId = promptEdit.dataset.managerPromptEdit || '';
        const item = (lib.items || []).find(entry => entry.id === itemId);
        if(!item) return;
        const name = deps.window.prompt('提示词名称', item.name || '提示词');
        if(!String(name || '').trim()) return;
        const positive = deps.window.prompt('提示词内容', item.positive || '');
        if(!String(positive || '').trim()) return;
        const data = await deps.fetch(`/api/prompt-libraries/items/${encodeURIComponent(item.id)}`, {method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({library_id:lib.id, name, positive, negative:item.negative || '', category:item.category || 'mine', scene:item.scene || ''})}).then(r => r.json());
        deps.canvasPromptLibraries = data.library?.libraries || deps.canvasPromptLibraries;
        deps.refreshCanvasPromptTemplatesFromLibraries();
        renderAssetManager(deps); return;
    }
    const promptRemove = event.target.closest?.('[data-manager-prompt-remove]');
    if(promptRemove){
        const lib = deps.activeCanvasPromptLibrary();
        if(!lib || lib.readonly) return;
        const itemId = promptRemove.dataset.managerPromptRemove || '';
        const item = (lib.items || []).find(entry => entry.id === itemId);
        if(!item || !deps.window.confirm(`删除提示词「${item.name || '提示词'}」？`)) return;
        const data = await deps.fetch(`/api/prompt-libraries/items/${encodeURIComponent(item.id)}`, {method:'DELETE'}).then(r => r.json());
        deps.canvasPromptLibraries = data.library?.libraries || deps.canvasPromptLibraries;
        deps.managerSelectedPromptIds.delete(item.id);
        deps.refreshCanvasPromptTemplatesFromLibraries();
        renderAssetManager(deps); return;
    }
    if(event.target.closest?.('[data-manager-asset-lib-new]')){
        const name = deps.window.prompt('资产库名称', '新资产库');
        if(!String(name || '').trim()) return;
        const data = await deps.fetch('/api/asset-library/libraries', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name})}).then(r => r.json());
        deps.canvasAssetLibrary = data.library || deps.canvasAssetLibrary;
        deps.activeCanvasAssetLibraryId = data.asset_library?.id || deps.activeCanvasAssetLibraryId;
        deps.activeCanvasAssetCategoryId = '';
        renderAssetManager(deps); deps.renderCanvasAssetLibrary(); return;
    }
    if(event.target.closest?.('[data-manager-asset-lib-rename]')){
        const lib = deps.activeCanvasAssetLibrary();
        const name = deps.window.prompt('资产库名称', lib?.name || '');
        if(!lib || !String(name || '').trim()) return;
        const data = await deps.fetch(`/api/asset-library/libraries/${encodeURIComponent(lib.id)}`, {method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name})}).then(r => r.json());
        deps.canvasAssetLibrary = data.library || deps.canvasAssetLibrary;
        renderAssetManager(deps); deps.renderCanvasAssetLibrary(); return;
    }
    if(event.target.closest?.('[data-manager-asset-lib-delete]')){
        const lib = deps.activeCanvasAssetLibrary();
        if(!lib || !deps.window.confirm(`删除资产库「${lib.name || '资产库'}」？`)) return;
        const data = await deps.fetch(`/api/asset-library/libraries/${encodeURIComponent(lib.id)}`, {method:'DELETE'}).then(r => r.json());
        deps.canvasAssetLibrary = data.library || deps.canvasAssetLibrary;
        deps.activeCanvasAssetLibraryId = deps.canvasAssetLibrary.active_library_id || deps.canvasAssetLibraries()[0]?.id || '';
        deps.activeCanvasAssetCategoryId = '';
        renderAssetManager(deps); deps.renderCanvasAssetLibrary(); return;
    }
    if(event.target.closest?.('[data-manager-asset-cat-new]')){
        const name = deps.window.prompt('分组名称', '新分组');
        if(!String(name || '').trim()) return;
        const data = await deps.fetch('/api/asset-library/categories', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({library_id:deps.activeCanvasAssetLibraryId, name, type:'image'})}).then(r => r.json());
        deps.canvasAssetLibrary = data.library || deps.canvasAssetLibrary;
        deps.activeCanvasAssetCategoryId = data.category?.id || deps.activeCanvasAssetCategoryId;
        renderAssetManager(deps); deps.renderCanvasAssetLibrary(); return;
    }
    if(event.target.closest?.('[data-manager-asset-cat-rename]')){
        const cat = deps.activeCanvasMediaCategory();
        const name = deps.window.prompt('分组名称', cat?.name || '');
        if(!cat || !String(name || '').trim()) return;
        const data = await deps.fetch(`/api/asset-library/categories/${encodeURIComponent(cat.id)}`, {method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name})}).then(r => r.json());
        deps.canvasAssetLibrary = data.library || deps.canvasAssetLibrary;
        renderAssetManager(deps); deps.renderCanvasAssetLibrary(); return;
    }
    if(event.target.closest?.('[data-manager-asset-cat-delete]')){
        const cat = deps.activeCanvasMediaCategory();
        if(!cat || !deps.window.confirm(`删除分组「${cat.name || '分组'}」？`)) return;
        const data = await deps.fetch(`/api/asset-library/categories/${encodeURIComponent(cat.id)}`, {method:'DELETE'}).then(r => r.json());
        deps.canvasAssetLibrary = data.library || deps.canvasAssetLibrary;
        deps.activeCanvasAssetCategoryId = deps.canvasMediaCategories()[0]?.id || '';
        renderAssetManager(deps); deps.renderCanvasAssetLibrary(); return;
    }
    if(event.target.closest?.('[data-manager-asset-delete]')){
        if(!deps.managerSelectedAssetIds.size) return;
        const data = await deps.fetch('/api/asset-library/items/delete', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({library_id:deps.activeCanvasAssetLibraryId, ids:[...deps.managerSelectedAssetIds]})}).then(r => r.json());
        deps.canvasAssetLibrary = data.library || deps.canvasAssetLibrary;
        deps.managerSelectedAssetIds.clear();
        renderAssetManager(deps); deps.renderCanvasAssetLibrary(); return;
    }
    if(event.target.closest?.('[data-manager-workflow-export]')){
        const items = (deps.activeCanvasWorkflowCategory()?.items || []).filter(item => deps.managerSelectedWorkflowIds.has(item.id));
        if(items.length === 1) {
            const item = items[0];
            deps.downloadUrl(item.url, `${item.name || 'workflow'}${String(item.url).toLowerCase().endsWith('.json') ? '.json' : '.zip'}`);
        } else if(items.length > 1) {
            const res = await deps.fetch('/api/canvas-assets/download', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({filename:'workflows.zip', items:items.map(item => ({url:item.url, name:item.name || 'workflow'}))})});
            if(res.ok) deps.downloadBlob(await res.blob(), 'workflows.zip');
        }
        return;
    }
    if(event.target.closest?.('[data-manager-workflow-delete]')){
        if(!deps.managerSelectedWorkflowIds.size) return;
        const data = await deps.fetch('/api/asset-library/items/delete', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({library_id:deps.activeCanvasAssetLibraryId, ids:[...deps.managerSelectedWorkflowIds]})}).then(r => r.json());
        deps.canvasAssetLibrary = data.library || deps.canvasAssetLibrary;
        deps.managerSelectedWorkflowIds.clear();
        renderAssetManager(deps); deps.renderCanvasAssetLibrary(); return;
    }
    if(event.target.closest?.('[data-manager-workflow-cat-new]')){
        const name = deps.window.prompt('工作流分组名称', '工作流');
        if(!String(name || '').trim()) return;
        const data = await deps.fetch('/api/asset-library/categories', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({library_id:deps.activeCanvasAssetLibraryId, name, type:'workflow'})}).then(r => r.json());
        deps.canvasAssetLibrary = data.library || deps.canvasAssetLibrary;
        deps.activeCanvasWorkflowCategoryId = data.category?.id || deps.activeCanvasWorkflowCategoryId;
        renderAssetManager(deps); deps.renderCanvasAssetLibrary(); return;
    }
    if(event.target.closest?.('[data-manager-prompt-lib-new]')){
        const name = deps.window.prompt('提示词库名称', '新提示词库');
        if(!String(name || '').trim()) return;
        const data = await deps.fetch('/api/prompt-libraries', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name})}).then(r => r.json());
        deps.canvasPromptLibraries = data.library?.libraries || deps.canvasPromptLibraries;
        deps.activePromptLibraryId = data.prompt_library?.id || deps.activePromptLibraryId;
        deps.refreshCanvasPromptTemplatesFromLibraries();
        renderAssetManager(deps); return;
    }
    if(event.target.closest?.('[data-manager-prompt-lib-rename]')){
        const lib = deps.activeCanvasPromptLibrary();
        if(!lib || lib.readonly) return;
        const name = deps.window.prompt('提示词库名称', lib.name || '');
        if(!String(name || '').trim()) return;
        const data = await deps.fetch(`/api/prompt-libraries/${encodeURIComponent(lib.id)}`, {method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name})}).then(r => r.json());
        deps.canvasPromptLibraries = data.library?.libraries || deps.canvasPromptLibraries;
        deps.refreshCanvasPromptTemplatesFromLibraries();
        renderAssetManager(deps); return;
    }
    if(event.target.closest?.('[data-manager-prompt-lib-delete]')){
        const lib = deps.activeCanvasPromptLibrary();
        if(!lib || lib.readonly || !deps.window.confirm(`删除提示词库「${lib.name || '提示词库'}」？`)) return;
        const data = await deps.fetch(`/api/prompt-libraries/${encodeURIComponent(lib.id)}`, {method:'DELETE'}).then(r => r.json());
        deps.canvasPromptLibraries = data.library?.libraries || deps.canvasPromptLibraries;
        deps.activePromptLibraryId = data.library?.active_library_id || deps.canvasPromptLibraries.find(item => item.id !== 'system')?.id || 'system';
        deps.refreshCanvasPromptTemplatesFromLibraries();
        renderAssetManager(deps); return;
    }
    if(event.target.closest?.('[data-manager-prompt-new]')){
        const lib = deps.activeCanvasPromptLibrary();
        if(!lib || lib.readonly) return;
        const name = deps.window.prompt('提示词名称', '新提示词');
        if(!String(name || '').trim()) return;
        const positive = deps.window.prompt('提示词内容', '');
        if(!String(positive || '').trim()) return;
        const data = await deps.fetch('/api/prompt-libraries/items', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({library_id:lib.id, name, positive, category:'mine'})}).then(r => r.json());
        deps.canvasPromptLibraries = data.library?.libraries || deps.canvasPromptLibraries;
        deps.refreshCanvasPromptTemplatesFromLibraries();
        renderAssetManager(deps); return;
    }
    if(event.target.closest?.('[data-manager-prompt-delete]')){
        if(!deps.managerSelectedPromptIds.size) return;
        const data = await deps.fetch('/api/prompt-libraries/items/delete', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ids:[...deps.managerSelectedPromptIds]})}).then(r => r.json());
        deps.canvasPromptLibraries = data.library?.libraries || deps.canvasPromptLibraries;
        deps.managerSelectedPromptIds.clear();
        deps.refreshCanvasPromptTemplatesFromLibraries();
        renderAssetManager(deps); return;
    }
}


function create(host){
    const deps=host();
    let bindings=[],active=false,listening=false,disposed=false;
    const uploads=new Map();
    function listen(target,type,fn,options){
        target.addEventListener(type,fn,options);bindings.push([target,type,fn,options]);
    }
    function suspend(){
        for(const [target,type,fn,options] of bindings)target.removeEventListener(type,fn,options);
        bindings=[];
        for(const {target,fn} of uploads.values())target.removeEventListener('change',fn);
        active=false;
    }
    function mount(){
        if(disposed||active)return;
        active=true;
        if(!listening){
            deps.window.addEventListener('pagehide',suspend);
            deps.window.addEventListener('pageshow',mount);
            listening=true;
        }
        
        deps.document.querySelectorAll('[data-manager-tab]').forEach(btn=>listen(btn,'click',()=>handleAssetManagerTab(deps,btn)));
        if(deps.assetManagerModal){
            listen(deps.assetManagerModal,'change',event=>handleAssetManagerChange(deps,event));
            listen(deps.assetManagerModal,'click',event=>handleAssetManagerClick(deps,event),true);
        }
 
        for(const {target,fn} of uploads.values())target.addEventListener('change',fn);
    }
    
    function clearUploads(){
        for(const {target,fn} of uploads.values())target.removeEventListener('change',fn);
        uploads.clear();
    }
    function bindUpload(target,fn){
        const old=uploads.get(target.id);
        if(old)old.target.removeEventListener('change',old.fn);
        uploads.set(target.id,{target,fn});
        if(active)target.addEventListener('change',fn);
    }
    
    function dispose(){
        suspend();clearUploads();
        if(listening){
            deps.window.removeEventListener('pagehide',suspend);
            deps.window.removeEventListener('pageshow',mount);
        }
        listening=false;disposed=true;
    }
    return {mount,dispose,clearUploads,bindUpload};
}
    const api={create, openAssetManager, closeAssetManager, renderAssetManager, renderImageAssetManager, workflowAssetThumbHtml, renderWorkflowAssetManager, renderPromptAssetManager, handleAssetManagerTab, handleAssetManagerChange, handleAssetManagerClick};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.CanvasAssetManager=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
