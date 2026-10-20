/* Prompt template responsibility: smart-prompt-template. Host supplies live state and effects. */
(function(root){
    'use strict';

function defaultPromptTemplateGroups(deps){
    return [
        {id:'view', name:deps.tr('smart.tplCatView')},
        {id:'storyboard', name:deps.tr('smart.tplCatStoryboard')},
        {id:'character', name:deps.tr('smart.tplCatCharacter')},
        {id:'product', name:deps.tr('smart.tplCatProduct')},
        {id:'lighting', name:deps.tr('smart.tplCatLighting')},
        {id:'mine', name:deps.tr('smart.tplCatMine')}
    ];
}

function loadPromptTemplateGroups(deps){
    try {
        const list = JSON.parse(deps.localStorage.getItem(deps.PROMPT_TEMPLATE_GROUPS_KEY) || '[]');
        const valid = Array.isArray(list) ? list.filter(g => g?.id && g?.name) : [];
        const defaults = defaultPromptTemplateGroups(deps);
        deps.promptTemplateGroups = defaults.map(group => valid.find(g => g.id === group.id) || group);
        valid.filter(g => !deps.promptTemplateGroups.some(x => x.id === g.id)).forEach(g => deps.promptTemplateGroups.push(g));
    } catch(e) {
        deps.promptTemplateGroups = defaultPromptTemplateGroups(deps);
    }
}

function savePromptTemplateGroups(deps){
    deps.localStorage.setItem(deps.PROMPT_TEMPLATE_GROUPS_KEY, JSON.stringify(deps.promptTemplateGroups));
}

function loadPromptTemplateOverrides(deps){
    try {
        const data = JSON.parse(deps.localStorage.getItem(deps.PROMPT_TEMPLATE_OVERRIDES_KEY) || '{}');
        deps.promptTemplateOverrides = {
            hiddenBuiltinIds:Array.isArray(data.hiddenBuiltinIds) ? data.hiddenBuiltinIds : [],
            editedBuiltins:data.editedBuiltins && typeof data.editedBuiltins === 'object' ? data.editedBuiltins : {}
        };
    } catch(e) {
        deps.promptTemplateOverrides = {hiddenBuiltinIds:[], editedBuiltins:{}};
    }
}

function savePromptTemplateOverrides(deps){
    deps.localStorage.setItem(deps.PROMPT_TEMPLATE_OVERRIDES_KEY, JSON.stringify(deps.promptTemplateOverrides));
}

async function loadPromptTemplates(deps){
    try {
        const data = await deps.fetch('/api/prompt-libraries').then(r => r.ok ? r.json() : {library:{libraries:[]}});
        deps.promptLibraries = Array.isArray(data.library?.libraries) ? data.library.libraries : [];
        if(!deps.promptLibraries.length) {
            const fallback = await deps.fetch('/api/smart-canvas/prompt-templates').then(r => r.ok ? r.json() : {templates:[]});
            deps.builtinPromptTemplates = Array.isArray(fallback.templates) ? fallback.templates.filter(t => t?.id && t?.positive) : [];
            deps.promptLibraries = [{id:'system', name:'系统提示词库', readonly:true, items:deps.builtinPromptTemplates}];
        } else {
            const system = deps.promptLibraries.find(lib => lib.id === 'system') || deps.promptLibraries[0];
            deps.builtinPromptTemplates = Array.isArray(system?.items) ? system.items.filter(t => t?.id && t?.positive) : [];
        }
        if(!deps.promptLibraries.some(lib => lib.id === deps.activePromptLibraryId)) deps.activePromptLibraryId = deps.promptLibraries[0]?.id || 'system';
        renderPromptLibrarySelect(deps);
    } catch(e) {
        deps.builtinPromptTemplates = [];
        deps.promptLibraries = [];
    }
}

function activePromptLibrary(deps){
    return deps.promptLibraries.find(lib => lib.id === deps.activePromptLibraryId) || deps.promptLibraries[0] || {id:'system', name:'系统提示词库', readonly:true, items:deps.builtinPromptTemplates};
}

function renderPromptLibrarySelect(deps){
    if(!deps.promptTemplateLibrarySelect) return;
    deps.promptTemplateLibrarySelect.innerHTML = deps.promptLibraries.map(lib => `<option value="${deps.escapeAttr(lib.id)}" ${lib.id === deps.activePromptLibraryId ? 'selected' : ''}>${deps.escapeHtml(lib.name || '提示词库')}</option>`).join('');
}

function promptTemplateItems(deps){
    const activeLibrary = activePromptLibrary(deps);
    if(activeLibrary.id !== 'system'){
        return (activeLibrary.items || []).filter(t => t?.id && t?.positive).map(t => ({
            ...t,
            sourceId:t.id,
            builtin:false,
            remote:true,
            libraryId:activeLibrary.id
        }));
    }
    // 系统库的条目同样走后端（/api/prompt-libraries），与素材库管理共用一套数据。
    // 这样画布里修改/删除系统提示词会实时同步，不再依赖各端不互通的 localStorage 覆盖。
    // 仍保留 builtin:true 用于“内置”标签与完整提示词（含负向/参数）的展示。
    const source = Array.isArray(activeLibrary.items) && activeLibrary.items.length ? activeLibrary.items : deps.builtinPromptTemplates;
    const builtins = source
        .filter(t => t?.id && t?.positive)
        .map(t => ({...t, sourceId:t.id, builtin:true, remote:true, libraryId:'system'}));
    const mine = deps.promptPresets.map(p => ({
        id:`mine:${p.id}`,
        sourceId:p.id,
        name:p.name || deps.tr('smart.promptPresetUnnamed'),
        // 系统库分组以后端为准（custom=“我的”），本地旧预设归到 custom 分组下展示，避免无对应标签。
        category:(p.category && p.category !== 'mine') ? p.category : 'custom',
        scene:'我的提示词预设',
        positive:p.text || '',
        negative:'',
        params:{},
        builtin:false
    }));
    return [...builtins, ...mine];
}

function promptTemplateText(deps, template, mode='positive'){
    const positive = String(template?.positive || '').trim();
    if(mode === 'positive' || !template?.builtin) return positive;
    const negative = String(template?.negative || '').trim();
    const params = Object.entries(template?.params || {})
        .map(([key, value]) => `${key}: ${value}`)
        .join('\n');
    return [positive, negative ? `Negative prompt:\n${negative}` : '', params ? `Params:\n${params}` : ''].filter(Boolean).join('\n\n');
}

function promptTemplateName(deps, template){
    if(deps.window.StudioI18n?.lang?.() === 'en' && template?.name_en) return template.name_en;
    return template?.name || '';
}

function promptTemplateScene(deps, template){
    if(deps.window.StudioI18n?.lang?.() === 'en' && template?.scene_en) return template.scene_en;
    return template?.scene || '';
}

function promptTemplateSearchText(deps, template){
    return [
        template?.name,
        template?.name_en,
        template?.scene,
        template?.scene_en,
        template?.positive,
        template?.negative
    ].join(' ').toLowerCase();
}

function activePromptTemplateGroups(deps){
    const lib = activePromptLibrary(deps);
    // 系统库的分组也以后端 categories 为准，与素材库管理共用同一份分组数据（可重命名/删除并同步）。
    const fromLib = Array.isArray(lib?.categories) ? lib.categories.filter(c => c?.id && c?.name) : [];
    if(fromLib.length) return fromLib;
    if(!lib || lib.id === 'system') return deps.promptTemplateGroups;
    return [];
}

function promptTemplateCategoryLabel(deps, category){
    if(category === 'all') return deps.tr('smart.tplAll');
    // 分组名优先以后端 categories 为准（含内置分组重命名），保证两端显示一致。
    const fromGroups = activePromptTemplateGroups(deps).find(g => g.id === category)?.name;
    if(fromGroups) return fromGroups;
    const builtin = {
        view:deps.tr('smart.tplCatView'),
        storyboard:deps.tr('smart.tplCatStoryboard'),
        character:deps.tr('smart.tplCatCharacter'),
        product:deps.tr('smart.tplCatProduct'),
        lighting:deps.tr('smart.tplCatLighting'),
        custom:deps.tr('smart.tplCatMine'),
        mine:deps.tr('smart.tplCatMine')
    };
    return builtin[category] || deps.promptTemplateGroups.find(g => g.id === category)?.name || category;
}

function promptTemplateSelectedItem(deps){
    return promptTemplateItems(deps).find(item => item.id === deps.promptTemplateSelectedId) || promptTemplateItems(deps)[0] || null;
}

function promptTemplateScrollSnapshot(deps){
    if(!deps.promptTemplatePanel) return null;
    return {
        panelTop:deps.promptTemplatePanel.scrollTop || 0,
        tabLeft:deps.promptTemplatePanel.querySelector('.prompt-template-tabs')?.scrollLeft || 0,
        listTop:deps.promptTemplatePanel.querySelector('.prompt-template-list')?.scrollTop || 0,
        detailTop:deps.promptTemplatePanel.querySelector('.prompt-template-preview-content')?.scrollTop || 0
    };
}

function restorePromptTemplateScroll(deps, snapshot){
    if(!snapshot || !deps.promptTemplatePanel) return;
    deps.requestAnimationFrame(() => {
        deps.promptTemplatePanel.scrollTop = snapshot.panelTop || 0;
        const tabs = deps.promptTemplatePanel.querySelector('.prompt-template-tabs');
        const list = deps.promptTemplatePanel.querySelector('.prompt-template-list');
        const detail = deps.promptTemplatePanel.querySelector('.prompt-template-preview-content');
        if(tabs) tabs.scrollLeft = snapshot.tabLeft || 0;
        if(list) list.scrollTop = snapshot.listTop || 0;
        if(detail) detail.scrollTop = snapshot.detailTop || 0;
    });
}

function renderPromptTemplatePanel(deps, options={}){
    if(!deps.promptTemplatePanel || !deps.promptTemplateBody || !deps.promptTemplateCats) return;
    renderPromptLibrarySelect(deps);
    const scrollSnapshot = options.preserveScroll === false ? null : promptTemplateScrollSnapshot(deps);
    const query = String(deps.promptTemplateSearch?.value || '').trim().toLowerCase();
    const allTemplates = promptTemplateItems(deps);
    const activeGroups = activePromptTemplateGroups(deps);
    // 防御：若当前分类筛选不属于当前词库（例如刚切换词库或分类已被删除），回到“全部”，避免列表被过滤为空。
    if(deps.promptTemplateCategory !== 'all' && !activeGroups.some(g => g.id === deps.promptTemplateCategory)) deps.promptTemplateCategory = 'all';
    const categories = [{id:'all', name:deps.tr('smart.tplAll')}, ...activeGroups.map(group => ({...group, name:promptTemplateCategoryLabel(deps, group.id)}))];
    const groupCounts = allTemplates.reduce((map, item) => {
        map[item.category || 'mine'] = (map[item.category || 'mine'] || 0) + 1;
        return map;
    }, {all:allTemplates.length});
    deps.promptTemplateCats.innerHTML = deps.promptTemplateGroupEditMode ? `
        <div class="prompt-template-group-panel">
            <div class="prompt-template-group-title">
                <div>
                    <strong>${deps.escapeHtml(deps.tr('smart.tplGroupManage'))}</strong>
                    <span>${deps.escapeHtml(deps.tr('smart.tplGroupHint'))}</span>
                </div>
                <div class="prompt-template-group-tools">
                    <button type="button" data-template-cat-new><i data-lucide="plus"></i><span>${deps.escapeHtml(deps.tr('smart.tplAdd'))}</span></button>
                    <button type="button" class="primary" data-template-group-edit><i data-lucide="check"></i><span>${deps.escapeHtml(deps.tr('smart.tplDone'))}</span></button>
                </div>
            </div>
            <div class="prompt-template-group-list">
                ${activeGroups.map(group => `
                    <div class="prompt-template-group-row has-delete">
                        <button type="button" class="group-name ${group.id === deps.promptTemplateCategory ? 'active' : ''}" data-template-cat="${deps.escapeHtml(group.id)}">
                            <span>${deps.escapeHtml(promptTemplateCategoryLabel(deps, group.id))}</span>
                            <small>${groupCounts[group.id] || 0}</small>
                        </button>
                        <button type="button" class="group-tool" data-template-cat-edit="${deps.escapeHtml(group.id)}" title="${deps.escapeAttr(deps.tr('smart.tplRename'))}"><i data-lucide="pencil"></i></button>
                        <button type="button" class="group-tool danger" data-template-cat-delete="${deps.escapeHtml(group.id)}" title="${deps.escapeAttr(deps.tr('common.delete'))}"><i data-lucide="trash-2"></i></button>
                    </div>
                `).join('')}
            </div>
        </div>
    ` : `
        <div class="prompt-template-nav">
            <div class="prompt-template-tabs">
                ${categories.map(cat => `
                    <button type="button" class="${cat.id === deps.promptTemplateCategory ? 'active' : ''}" data-template-cat="${deps.escapeHtml(cat.id)}">
                        <span>${deps.escapeHtml(cat.name)}</span>
                        <small>${groupCounts[cat.id] || 0}</small>
                    </button>
                `).join('')}
            </div>
            <button type="button" class="prompt-template-manage-groups" data-template-group-edit><i data-lucide="settings-2"></i><span>${deps.escapeHtml(deps.tr('smart.tplManageGroups'))}</span></button>
        </div>
    `;
    const items = allTemplates.filter(item => {
        if(deps.promptTemplateCategory !== 'all' && item.category !== deps.promptTemplateCategory) return false;
        if(!query) return true;
        return promptTemplateSearchText(deps, item).includes(query);
    });
    if(items.length && !items.some(item => item.id === deps.promptTemplateSelectedId)) deps.promptTemplateSelectedId = items[0].id;
    const selected = items.find(item => item.id === deps.promptTemplateSelectedId) || items[0] || null;
    const selectedPreset = selected?.builtin || selected?.remote
        ? {id:selected.id, name:selected.name || '', text:selected.positive || '', category:selected.category || 'storyboard', builtin:Boolean(selected.builtin)}
        : (selected ? deps.currentPromptPreset(selected.sourceId) : null);
    const target = deps.promptTemplatePanel.dataset.target || 'node';
    const node = deps.nodes.find(n => n.id === deps.promptTemplatePanel.dataset.nodeId);
    const activeLibrary = activePromptLibrary(deps);
    // 系统库 readonly=false，其条目也可编辑/删除（经后端持久化），因此只看 readonly。
    const canEditCurrentLibrary = !activeLibrary.readonly;
    const editMode = Boolean(deps.promptTemplateEditing && selectedPreset);
    deps.promptTemplateBody.innerHTML = `
        <div class="prompt-template-list">
            <div class="prompt-template-list-tools">
                <button type="button" data-template-save-current><i data-lucide="bookmark-plus"></i><span>${deps.escapeHtml(deps.tr('smart.tplSaveCurrent'))}</span></button>
                <button type="button" data-template-new><i data-lucide="file-plus-2"></i><span>${deps.escapeHtml(deps.tr('smart.tplNewTemplate'))}</span></button>
            </div>
            ${items.length ? items.map(item => `<button type="button" class="prompt-template-card ${item.id === selected?.id ? 'active' : ''}" data-template-id="${deps.escapeHtml(item.id)}">
                <span class="prompt-template-card-top">
                    <span class="prompt-template-name">${deps.escapeHtml(promptTemplateName(deps, item))}</span>
                    <span class="prompt-template-source">${deps.escapeHtml(item.builtin ? deps.tr('smart.tplBuiltin') : deps.tr('smart.tplMine'))}</span>
                </span>
                <span class="prompt-template-scene">${deps.escapeHtml(promptTemplateScene(deps, item) || item.positive || '')}</span>
                <span class="prompt-template-tag">${deps.escapeHtml(promptTemplateCategoryLabel(deps, item.category || 'mine'))}</span>
            </button>`).join('') : `<div class="prompt-template-list-empty">${deps.escapeHtml(deps.tr('smart.tplNoMatches'))}</div>`}
        </div>
        <div class="prompt-template-detail">
            ${selected ? `
                <div class="prompt-template-detail-head">
                    <div>
                        <strong>${deps.escapeHtml(promptTemplateName(deps, selected) || '')}</strong>
                        <span>${deps.escapeHtml(promptTemplateCategoryLabel(deps, selected.category || ''))} · ${deps.escapeHtml(selected.builtin ? deps.tr('smart.tplBuiltinTemplate') : deps.tr('smart.tplMineTemplate'))}</span>
                    </div>
                    ${editMode ? '' : `
                        <div class="prompt-template-icon-actions">
                            <button type="button" ${!canEditCurrentLibrary ? 'disabled' : ''} data-template-edit title="${deps.escapeAttr(deps.tr('smart.tplEditTemplate'))}"><i data-lucide="pencil"></i><span>${deps.escapeHtml(deps.tr('common.edit'))}</span></button>
                            <button type="button" ${!canEditCurrentLibrary ? 'disabled' : ''} class="danger" data-template-delete title="${deps.escapeAttr(deps.tr('smart.tplDeleteTemplate'))}"><i data-lucide="trash-2"></i><span>${deps.escapeHtml(deps.tr('common.delete'))}</span></button>
                        </div>
                    `}
                </div>
            ${editMode ? `
                <div class="prompt-template-edit-fields">
                    <label>${deps.escapeHtml(deps.tr('smart.tplName'))}</label>
                    <input data-template-edit-name value="${deps.escapeAttr(selectedPreset.name || '')}" placeholder="${deps.escapeAttr(deps.tr('smart.tplName'))}">
                    <label>${deps.escapeHtml(deps.tr('smart.tplGroup'))}</label>
                    <select data-template-edit-category>
                        ${activeGroups.map(group => `<option value="${deps.escapeAttr(group.id)}" ${group.id === (selectedPreset.category || selected?.category || 'mine') ? 'selected' : ''}>${deps.escapeHtml(promptTemplateCategoryLabel(deps, group.id))}</option>`).join('')}
                    </select>
                    <label>${deps.escapeHtml(deps.tr('smart.tplContent'))}</label>
                    <textarea data-template-edit-text placeholder="${deps.escapeAttr(deps.tr('smart.tplContent'))}">${deps.escapeHtml(selectedPreset.text || '')}</textarea>
                </div>
            ` : `
                <div class="prompt-template-preview-content">
                <div class="prompt-template-section">
                    <label>${deps.escapeHtml(deps.tr('smart.tplPositive'))}</label>
                    <p>${deps.escapeHtml(selected?.positive || '')}</p>
                </div>
                ${selected?.negative ? `<div class="prompt-template-section">
                    <label>${deps.escapeHtml(deps.tr('smart.tplNegative'))}</label>
                    <p>${deps.escapeHtml(selected.negative)}</p>
                </div>` : ''}
                ${Object.keys(selected?.params || {}).length ? `<div class="prompt-template-section">
                    <label>${deps.escapeHtml(deps.tr('smart.tplParams'))}</label>
                    <p>${deps.escapeHtml(Object.entries(selected.params).map(([k,v]) => `${k}: ${v}`).join('\n'))}</p>
                </div>` : ''}
                </div>
            `}
            <div class="prompt-template-actions">
                ${editMode ? `
                    <button type="button" data-template-edit-cancel><i data-lucide="x"></i><span>${deps.escapeHtml(deps.tr('common.cancel'))}</span></button>
                    <button type="button" class="danger" data-template-delete><i data-lucide="trash-2"></i><span>${deps.escapeHtml(deps.tr('common.delete'))}</span></button>
                    <button type="button" class="primary" data-template-edit-save><i data-lucide="save"></i><span>${deps.escapeHtml(deps.tr('common.save'))}</span></button>
                ` : `
                    <button type="button" data-template-apply="positive"><i data-lucide="corner-down-left"></i><span>${deps.escapeHtml(deps.tr('smart.tplApplyPositive'))}</span></button>
                    <button type="button" class="primary" data-template-apply="full"><i data-lucide="wand-sparkles"></i><span>${deps.escapeHtml(deps.tr('smart.tplApplyFull'))}</span></button>
                `}
            </div>
            ` : `<div class="prompt-template-empty">${deps.escapeHtml(deps.tr('smart.tplPickOrCreate'))}</div>`}
        </div>
    `;
    deps.refreshIcons();
    restorePromptTemplateScroll(deps, scrollSnapshot);
}

function activePromptTemplateNodeId(deps){
    return deps.promptTemplatePanel?.classList?.contains('open') && deps.promptTemplatePanel.dataset.target !== 'composer' ? (deps.promptTemplatePanel.dataset.nodeId || '') : '';
}

function syncComposerTemplateButton(deps){
    if(!deps.composerTemplateBtn || !deps.promptTemplatePanel) return;
    const active = deps.promptTemplatePanel.classList.contains('open') && deps.promptTemplatePanel.dataset.target === 'composer';
    deps.composerTemplateBtn.classList.toggle('active', active);
    deps.composerTemplateBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
}

async function openPromptTemplatePanel(deps, nodeId='', templateId='', options={}){
    if(!deps.promptTemplatePanel) return;
    const target = ['composer','assistant'].includes(options.target) ? options.target : 'node';
    deps.promptTemplatePanel.dataset.target = target;
    deps.promptTemplatePanel.dataset.nodeId = nodeId || '';
    if(deps.promptTemplatePanel.parentElement !== deps.shell) deps.shell.appendChild(deps.promptTemplatePanel);
    if(templateId) deps.promptTemplateSelectedId = templateId;
    deps.promptTemplatePanel.classList.add('open');
    // 每次打开都从后端拉取最新提示词库，确保素材库管理里的新增/修改/删除实时反映到画布（同根同源）。
    try { await loadPromptTemplates(deps); } catch(e){}
    if(!deps.promptTemplateSelectedId || !promptTemplateItems(deps).some(it => it.id === deps.promptTemplateSelectedId)){
        deps.promptTemplateSelectedId = promptTemplateItems(deps)[0]?.id || '';
    }
    renderPromptTemplatePanel(deps);
    if(target === 'node' && nodeId){
        deps.selectedId = nodeId;
        deps.selectedIds = [];
        deps.selectedImage = {nodeId:'', index:-1};
    }
    deps.render();
    syncComposerTemplateButton(deps);
    deps.promptTemplateSearch?.focus();
}

function closePromptTemplatePanel(deps){
    deps.promptTemplatePanel?.classList.remove('open');
    deps.canvasAssistantTemplateCallback = null;
    syncComposerTemplateButton(deps);
    deps.render();
}

function setPromptTemplateText(deps, node,text){
    if(node.llmEnabled){node.llmInstruction=text;node.llmOutputStale=true;}
    else node.text=text;
}

function applyPromptTemplateToNode(deps, mode='positive'){
    const template = promptTemplateItems(deps).find(item => item.id === deps.promptTemplateSelectedId);
    if(!template) return;
    if(deps.promptTemplatePanel?.dataset.target === 'assistant' && deps.canvasAssistantTemplateCallback){
        const callback=deps.canvasAssistantTemplateCallback;
        deps.canvasAssistantTemplateCallback=null;
        callback(promptTemplateText(deps, template, mode));
        closePromptTemplatePanel(deps);
        return;
    }
    if(deps.promptTemplatePanel?.dataset.target === 'composer'){
        const text = promptTemplateText(deps, template, mode);
        deps.setPromptText(text);
        delete deps.promptInput.dataset.preserveDraftOnce;
        deps.savePromptDraftForCurrent();
        deps.renderInputThumbsRow(deps.selectedNode());
        closePromptTemplatePanel(deps);
        deps.scheduleSave();
        return;
    }
    const node = deps.nodes.find(n => n.id === deps.promptTemplatePanel?.dataset.nodeId);
    if(!node) return;
    setPromptTemplateText(deps, node,promptTemplateText(deps, template, mode));
    node.promptPresetId = template.builtin ? '' : template.sourceId || '';
    closePromptTemplatePanel(deps);
    deps.render();
    deps.scheduleSave();
}

async function saveCurrentPromptAsTemplate(deps){
    const library = activePromptLibrary(deps);
    // 系统库 readonly=false，也允许新增条目（走后端，与素材库管理同步）。
    if(library.readonly){ deps.toast('请选择可编辑的提示词库'); return; }
    const text = deps.promptTemplatePanel?.dataset.target === 'composer'
        ? deps.promptPlainText()
        : (()=>{const node=deps.nodes.find(n=>n.id===deps.promptTemplatePanel?.dataset.nodeId);return String((node?.llmEnabled?node.llmInstruction:node?.text)||'').trim();})();
    if(!text){ deps.toast(deps.tr('smart.promptPresetEmpty')); return; }
    try {
        const data = await deps.fetch('/api/prompt-libraries/items', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({library_id:library.id, name:deps.defaultPromptPresetName(text), category:deps.promptTemplateCategory === 'all' ? 'custom' : deps.promptTemplateCategory, positive:text, scene:'我的提示词预设'})
        }).then(async r => {
            if(!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || '保存失败');
            return r.json();
        });
        deps.promptLibraries = data.library?.libraries || deps.promptLibraries;
        deps.activePromptLibraryId = library.id;
        deps.promptTemplateCategory = data.item?.category || 'custom';
        deps.promptTemplateSelectedId = data.item?.id || '';
        deps.promptTemplateEditing = true;
        renderPromptTemplatePanel(deps, {preserveScroll:false});
    } catch(err) {
        deps.toast(err.message || '保存失败');
    }
}

async function createBlankPromptTemplate(deps){
    const library = activePromptLibrary(deps);
    // 系统库 readonly=false，也允许新建空白条目（走后端，与素材库管理同步）。
    if(library.readonly){ deps.toast('请选择可编辑的提示词库'); return; }
    const category = deps.promptTemplateCategory && deps.promptTemplateCategory !== 'all' ? deps.promptTemplateCategory : 'custom';
    try {
        const data = await deps.fetch('/api/prompt-libraries/items', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({library_id:library.id, name:deps.tr('smart.tplNewTemplateName'), category, positive:'新提示词', scene:'我的提示词预设'})
        }).then(async r => {
            if(!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || '创建失败');
            return r.json();
        });
        deps.promptLibraries = data.library?.libraries || deps.promptLibraries;
        deps.activePromptLibraryId = library.id;
        deps.promptTemplateCategory = category;
        deps.promptTemplateSelectedId = data.item?.id || '';
        deps.promptTemplateEditing = true;
        renderPromptTemplatePanel(deps, {preserveScroll:false});
    } catch(err) {
        deps.toast(err.message || '创建失败');
    }
}

async function savePromptTemplateEdit(deps){
    const item = promptTemplateSelectedItem(deps);
    if(!item) return;
    const name = deps.promptTemplatePanel.querySelector('[data-template-edit-name]')?.value?.trim() || '';
    const text = deps.promptTemplatePanel.querySelector('[data-template-edit-text]')?.value?.trim() || '';
    const category = deps.promptTemplatePanel.querySelector('[data-template-edit-category]')?.value || 'mine';
    if(!name || !text){ deps.toast(deps.tr('smart.tplRequired')); return; }
    if(item.remote){
        try {
            const data = await deps.fetch(`/api/prompt-libraries/items/${encodeURIComponent(item.id)}`, {
                method:'PATCH',
                headers:{'Content-Type':'application/json'},
                body:JSON.stringify({library_id:item.libraryId || activePromptLibrary(deps).id, name, category, positive:text, scene:item.scene || '', negative:item.negative || ''})
            }).then(async r => {
                if(!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || '保存失败');
                return r.json();
            });
            deps.promptLibraries = data.library?.libraries || deps.promptLibraries;
            deps.promptTemplateSelectedId = data.item?.id || item.id;
        } catch(err) {
            deps.toast(err.message || '保存失败');
            return;
        }
    } else if(item.builtin){
        deps.promptTemplateOverrides.editedBuiltins = deps.promptTemplateOverrides.editedBuiltins || {};
        deps.promptTemplateOverrides.editedBuiltins[item.id] = {
            ...(deps.promptTemplateOverrides.editedBuiltins[item.id] || {}),
            name,
            positive:text,
            category
        };
        savePromptTemplateOverrides(deps);
    } else {
        const preset = deps.currentPromptPreset(item.sourceId);
        if(!preset) return;
        const idx = deps.promptPresets.findIndex(p => p.id === preset.id);
        if(idx >= 0) deps.promptPresets[idx] = {...deps.promptPresets[idx], name, text, category, updatedAt:Date.now()};
        deps.savePromptPresets();
        deps.nodes.forEach(node => { if(node.promptPresetId === preset.id) setPromptTemplateText(deps, node,text); });
    }
    deps.promptTemplateEditing = false;
    renderPromptTemplatePanel(deps);
    deps.render();
    deps.scheduleSave();
}

async function deletePromptTemplate(deps){
    const item = promptTemplateSelectedItem(deps);
    if(!item) return;
    if(item.remote){
        try {
            const data = await deps.fetch(`/api/prompt-libraries/items/${encodeURIComponent(item.id)}`, {method:'DELETE'}).then(async r => {
                if(!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || '删除失败');
                return r.json();
            });
            deps.promptLibraries = data.library?.libraries || deps.promptLibraries;
        } catch(err) {
            deps.toast(err.message || '删除失败');
            return;
        }
    } else if(item.builtin){
        deps.promptTemplateOverrides.hiddenBuiltinIds = [...new Set([...(deps.promptTemplateOverrides.hiddenBuiltinIds || []), item.id])];
        savePromptTemplateOverrides(deps);
    } else {
        deps.promptPresets = deps.promptPresets.filter(p => p.id !== item.sourceId);
        deps.nodes.forEach(node => { if(node.promptPresetId === item.sourceId) node.promptPresetId = ''; });
        deps.savePromptPresets();
    }
    deps.promptTemplateSelectedId = '';
    deps.promptTemplateEditing = false;
    renderPromptTemplatePanel(deps, {preserveScroll:false});
    deps.render();
    deps.scheduleSave();
}

async function createPromptTemplateGroup(deps){
    const name = deps.window.prompt(deps.tr('smart.tplNewGroupPrompt'), deps.tr('smart.tplNewGroupDefault'));
    if(!String(name || '').trim()) return;
    const lib = activePromptLibrary(deps);
    // 系统库（readonly=false）也走后端新增分组，与素材库管理同步。
    if(lib && !lib.readonly){
        try {
            const data = await deps.fetch('/api/prompt-libraries/categories', {
                method:'POST', headers:{'Content-Type':'application/json'},
                body:JSON.stringify({name:String(name).trim().slice(0, 24), library_id:lib.id})
            }).then(async r => { if(!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || '新增分组失败'); return r.json(); });
            deps.promptLibraries = data.library?.libraries || deps.promptLibraries;
            deps.promptTemplateCategory = data.category?.id || deps.promptTemplateCategory;
            renderPromptTemplatePanel(deps, {preserveScroll:false});
        } catch(err){ if(typeof deps.setStatus === 'function') deps.setStatus(err.message || '新增分组失败'); }
        return;
    }
    const group = {id:deps.uid('tpl_group'), name:String(name).trim().slice(0, 24)};
    deps.promptTemplateGroups.push(group);
    savePromptTemplateGroups(deps);
    deps.promptTemplateCategory = group.id;
    renderPromptTemplatePanel(deps, {preserveScroll:false});
}

async function renamePromptTemplateGroup(deps, groupId){
    const lib = activePromptLibrary(deps);
    const group = activePromptTemplateGroups(deps).find(g => g.id === groupId);
    if(!group) return;
    const name = deps.window.prompt(deps.tr('smart.tplGroupNamePrompt'), group.name || '');
    if(!String(name || '').trim()) return;
    // 系统库的内置分组也走后端重命名（后端已放开内置分组限制），两端同步。
    if(lib && !lib.readonly){
        try {
            const data = await deps.fetch(`/api/prompt-libraries/categories/${encodeURIComponent(groupId)}`, {
                method:'PATCH', headers:{'Content-Type':'application/json'},
                body:JSON.stringify({name:String(name).trim().slice(0, 24), library_id:lib.id})
            }).then(async r => { if(!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || '重命名失败'); return r.json(); });
            deps.promptLibraries = data.library?.libraries || deps.promptLibraries;
            renderPromptTemplatePanel(deps);
        } catch(err){ if(typeof deps.setStatus === 'function') deps.setStatus(err.message || '重命名失败'); }
        return;
    }
    group.name = String(name).trim().slice(0, 24);
    savePromptTemplateGroups(deps);
    renderPromptTemplatePanel(deps);
}

async function deletePromptTemplateGroup(deps, groupId){
    const lib = activePromptLibrary(deps);
    // 系统库的内置分组也走后端删除（后端已放开限制并把孤立条目改挂到剩余分组），两端同步。
    if(lib && !lib.readonly){
        if(!deps.window.confirm(deps.tr('smart.tplDeleteGroupConfirm'))) return;
        try {
            const data = await deps.fetch(`/api/prompt-libraries/categories/${encodeURIComponent(groupId)}`, {method:'DELETE'})
                .then(async r => { if(!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || '删除失败'); return r.json(); });
            deps.promptLibraries = data.library?.libraries || deps.promptLibraries;
            if(deps.promptTemplateCategory === groupId) deps.promptTemplateCategory = 'all';
            renderPromptTemplatePanel(deps, {preserveScroll:false});
        } catch(err){ if(typeof deps.setStatus === 'function') deps.setStatus(err.message || '删除失败'); }
        return;
    }
    if(!deps.window.confirm(deps.tr('smart.tplDeleteGroupConfirm'))) return;
    deps.promptTemplateGroups = deps.promptTemplateGroups.filter(g => g.id !== groupId);
    deps.promptPresets = deps.promptPresets.map(p => p.category === groupId ? {...p, category:'mine'} : p);
    Object.entries(deps.promptTemplateOverrides.editedBuiltins || {}).forEach(([id, item]) => {
        if(item?.category === groupId) deps.promptTemplateOverrides.editedBuiltins[id] = {...item, category:'mine'};
    });
    if(deps.promptTemplateCategory === groupId) deps.promptTemplateCategory = 'all';
    savePromptTemplateGroups(deps);
    deps.savePromptPresets();
    savePromptTemplateOverrides(deps);
    renderPromptTemplatePanel(deps, {preserveScroll:false});
}

    const api={defaultPromptTemplateGroups, loadPromptTemplateGroups, savePromptTemplateGroups, loadPromptTemplateOverrides, savePromptTemplateOverrides, loadPromptTemplates, activePromptLibrary, renderPromptLibrarySelect, promptTemplateItems, promptTemplateText, promptTemplateName, promptTemplateScene, promptTemplateSearchText, activePromptTemplateGroups, promptTemplateCategoryLabel, promptTemplateSelectedItem, promptTemplateScrollSnapshot, restorePromptTemplateScroll, renderPromptTemplatePanel, activePromptTemplateNodeId, syncComposerTemplateButton, openPromptTemplatePanel, closePromptTemplatePanel, setPromptTemplateText, applyPromptTemplateToNode, saveCurrentPromptAsTemplate, createBlankPromptTemplate, savePromptTemplateEdit, deletePromptTemplate, createPromptTemplateGroup, renamePromptTemplateGroup, deletePromptTemplateGroup};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.SmartPromptTemplate=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
