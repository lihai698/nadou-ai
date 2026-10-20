/* Prompt template responsibility: canvas-prompt-template. Host supplies live state and effects. */
(function(root){
    'use strict';

async function loadCanvasPromptTemplates(deps){
    if(deps.canvasPromptTemplatesLoaded) return deps.canvasPromptTemplates;
    try {
        loadCanvasPromptTemplateGroups(deps);
        loadCanvasPromptTemplateOverrides(deps);
        const data = await deps.fetch('/api/prompt-libraries').then(r => r.ok ? r.json() : {library:{libraries:[]}});
        deps.canvasPromptLibraries = Array.isArray(data.library?.libraries) ? data.library.libraries : [];
        if(!deps.canvasPromptLibraries.some(lib => lib.id === deps.activePromptLibraryId)) {
            deps.activePromptLibraryId = deps.canvasPromptLibraries.some(lib => lib.id === 'system') ? 'system' : (deps.canvasPromptLibraries[0]?.id || 'system');
        }
        deps.canvasPromptTemplates = activeCanvasPromptLibraryItems(deps);
    } catch(e) {
        deps.canvasPromptTemplates = [];
        deps.canvasPromptLibraries = [];
    }
    deps.canvasPromptTemplatesLoaded = true;
    return deps.canvasPromptTemplates;
}

function activeCanvasPromptLibrary(deps){
    return deps.canvasPromptLibraries.find(lib => lib.id === deps.activePromptLibraryId) || deps.canvasPromptLibraries[0] || {id:'system', name:'系统提示词库', readonly:true, items:[]};
}

function defaultCanvasPromptTemplateGroups(deps){
    return [
        {id:'view', name:deps.tr('smart.tplCatView')},
        {id:'storyboard', name:deps.tr('smart.tplCatStoryboard')},
        {id:'character', name:deps.tr('smart.tplCatCharacter')},
        {id:'product', name:deps.tr('smart.tplCatProduct')},
        {id:'lighting', name:deps.tr('smart.tplCatLighting')},
        // “我的”分组在后端/智能画布里用的分类 id 是 custom，这里保持一致，否则后端 custom 条目在普通画布看不到。
        {id:'custom', name:deps.tr('smart.tplCatMine')}
    ];
}

function loadCanvasPromptTemplateGroups(deps){
    try {
        const list = JSON.parse(deps.localStorage.getItem(deps.CANVAS_PROMPT_TEMPLATE_GROUPS_KEY) || '[]');
        const valid = Array.isArray(list) ? list.filter(g => g?.id && g?.name) : [];
        const defaults = defaultCanvasPromptTemplateGroups(deps);
        deps.promptTemplateGroups = defaults.map(group => valid.find(g => g.id === group.id) || group);
        valid.filter(g => !deps.promptTemplateGroups.some(x => x.id === g.id)).forEach(g => deps.promptTemplateGroups.push(g));
    } catch(e) {
        deps.promptTemplateGroups = defaultCanvasPromptTemplateGroups(deps);
    }
}

function loadCanvasPromptTemplateOverrides(deps){
    try {
        const data = JSON.parse(deps.localStorage.getItem(deps.CANVAS_PROMPT_TEMPLATE_OVERRIDES_KEY) || '{}');
        deps.canvasPromptTemplateOverrides = {
            hiddenBuiltinIds:Array.isArray(data.hiddenBuiltinIds) ? data.hiddenBuiltinIds : [],
            editedBuiltins:data.editedBuiltins && typeof data.editedBuiltins === 'object' ? data.editedBuiltins : {}
        };
    } catch(e) {
        deps.canvasPromptTemplateOverrides = {hiddenBuiltinIds:[], editedBuiltins:{}};
    }
}

function saveCanvasPromptTemplateOverrides(deps){
    deps.localStorage.setItem(deps.CANVAS_PROMPT_TEMPLATE_OVERRIDES_KEY, JSON.stringify(deps.canvasPromptTemplateOverrides));
}

function activeCanvasPromptLibraryItems(deps){
    const lib = activeCanvasPromptLibrary(deps);
    const hidden = new Set(deps.canvasPromptTemplateOverrides.hiddenBuiltinIds || []);
    if(lib.id !== 'system'){
        return (lib.items || []).filter(t => t?.id && t?.positive).map(t => ({
            ...t,
            sourceId:t.id,
            remote:true,
            libraryId:lib.id,
            libraryName:lib.name || '提示词库',
            builtin:false,
        }));
    }
    const system = deps.canvasPromptLibraries.find(item => item.id === 'system') || lib;
    const builtins = (system.items || [])
        .filter(t => t?.id && t?.positive && !hidden.has(t.id))
        .map(t => ({
            ...t,
            ...(deps.canvasPromptTemplateOverrides.editedBuiltins?.[t.id] || {}),
            sourceId:t.id,
            builtin:true,
            // 系统提示词库本身是后端真实库（/api/prompt-libraries 返回的 system 库），标记为 remote，
            // 这样编辑/删除走后端 PATCH/DELETE 并同步（与智能画布一致），而不是只存本地、不同步。
            remote:true,
            libraryId:'system',
            libraryName:'系统提示词库',
        }));
    const remotes = deps.canvasPromptLibraries
        .filter(item => item.id !== 'system')
        .flatMap(item => (item.items || [])
            .filter(t => t?.id && t?.positive)
            .map(t => ({
                ...t,
                sourceId:t.id,
                remote:true,
                builtin:false,
                libraryId:item.id,
                libraryName:item.name || '提示词库',
            })));
    return [...builtins, ...remotes];
}

function refreshCanvasPromptTemplatesFromLibraries(deps){
    deps.canvasPromptTemplatesLoaded = true;
    deps.canvasPromptTemplates = activeCanvasPromptLibraryItems(deps);
    renderCanvasPromptLibrarySelect(deps);
}

function renderCanvasPromptLibrarySelect(deps){
    if(!deps.promptTemplateLibrarySelect) return;
    deps.promptTemplateLibrarySelect.innerHTML = deps.canvasPromptLibraries.map(lib => `<option value="${deps.escapeAttr(lib.id)}" ${lib.id === deps.activePromptLibraryId ? 'selected' : ''}>${deps.escapeHtml(lib.name || '提示词库')}</option>`).join('');
}

function activeCanvasPromptTemplateGroups(deps){
    const lib = activeCanvasPromptLibrary(deps);
    const shared = Array.isArray(lib?.categories) ? lib.categories.filter(c => c?.id && c?.name) : [];
    if(lib?.id !== 'system') return shared;
    // Keep older browser-only groups visible without silently publishing them to the shared library.
    const sharedIds = new Set(shared.map(group => group.id));
    const builtinIds = new Set(defaultCanvasPromptTemplateGroups(deps).map(group => group.id));
    const legacy = deps.promptTemplateGroups
        .filter(group => !sharedIds.has(group.id) && !builtinIds.has(group.id))
        .map(group => ({...group, legacyLocal:true}));
    return [...shared, ...legacy];
}

function canvasPromptTemplateCategoryLabel(deps, category){
    if(category === 'all') return deps.tr('smart.tplAll');
    const group = activeCanvasPromptTemplateGroups(deps).find(g => g.id === category);
    if(group) return group.legacyLocal ? `${group.name}${deps.langIsEn() ? ' (local legacy)' : '（旧本地）'}` : group.name;
    const builtin = {
        view:deps.tr('smart.tplCatView'),
        storyboard:deps.tr('smart.tplCatStoryboard'),
        character:deps.tr('smart.tplCatCharacter'),
        product:deps.tr('smart.tplCatProduct'),
        lighting:deps.tr('smart.tplCatLighting'),
        custom:deps.tr('smart.tplCatMine'),
        mine:deps.tr('smart.tplCatMine')
    };
    return builtin[category] || category || '';
}

function selectedCanvasPromptTemplateGroupIsLegacy(deps){
    return activeCanvasPromptTemplateGroups(deps).some(group => group.id === deps.promptTemplateCategory && group.legacyLocal);
}

function canvasPromptTemplateIsLegacy(deps, item){
    return activeCanvasPromptTemplateGroups(deps).some(group => group.id === item?.category && group.legacyLocal);
}

function canvasPromptTemplateName(deps, template){
    if(deps.langIsEn() && template?.name_en) return template.name_en;
    return template?.name || '';
}

function canvasPromptTemplateScene(deps, template){
    if(deps.langIsEn() && template?.scene_en) return template.scene_en;
    return template?.scene || '';
}

function canvasPromptTemplateText(deps, template, mode='positive'){
    const positive = String(template?.positive || '').trim();
    if(mode === 'positive') return positive;
    const negative = String(template?.negative || '').trim();
    const params = Object.entries(template?.params || {})
        .map(([key, value]) => `${key}: ${value}`)
        .join('\n');
    return [positive, negative ? `Negative prompt:\n${negative}` : '', params ? `Params:\n${params}` : ''].filter(Boolean).join('\n\n');
}

function canvasPromptTemplateSearchText(deps, template){
    return [
        template?.name,
        template?.name_en,
        template?.scene,
        template?.scene_en,
        template?.positive,
        template?.negative,
        template?.libraryName
    ].join(' ').toLowerCase();
}

function canvasPromptTemplateVisibleItems(deps){
    const query = String(deps.promptTemplateSearch?.value || deps.promptTemplateQuery || '').trim().toLowerCase();
    return deps.canvasPromptTemplates.filter(item => {
        if(deps.promptTemplateCategory !== 'all' && item.category !== deps.promptTemplateCategory) return false;
        if(!query) return true;
        return canvasPromptTemplateSearchText(deps, item).includes(query);
    });
}

function currentCanvasPromptTemplateLibraryEditable(deps){
    // 系统库后端 readonly=false，也允许新增/编辑（走后端，与智能画布、素材库管理同步）。只按 readonly 判断。
    const lib = activeCanvasPromptLibrary(deps);
    return Boolean(lib && !lib.readonly);
}

function currentCanvasPromptTemplateNodeText(deps){
    const node = deps.nodes.find(n => n.id === deps.promptTemplateNodeId && n.type === 'prompt');
    return String(node?.text || '').trim();
}

function syncCanvasPromptTemplateButtons(deps){
    const activeId = deps.promptTemplateModal?.classList.contains('open') ? deps.promptTemplateNodeId : '';
    deps.document.querySelectorAll('[data-prompt-template-open]').forEach(btn => {
        const active = Boolean(activeId && btn.dataset.promptTemplateNodeId === activeId);
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
}

function canvasPromptTemplateDefaultName(deps, text){
    return (String(text || '').trim().split(/\r?\n/)[0] || '新提示词').slice(0, 28);
}

function selectedCanvasPromptTemplate(deps){
    return deps.canvasPromptTemplates.find(item => item.id === deps.promptTemplateSelectedId) || deps.canvasPromptTemplates[0] || null;
}

function syncCanvasPromptTemplateMutation(deps, data, fallbackSelectedId=''){
    deps.canvasPromptLibraries = data.library?.libraries || deps.canvasPromptLibraries;
    refreshCanvasPromptTemplatesFromLibraries(deps);
    deps.promptTemplateSelectedId = data.item?.id || fallbackSelectedId || deps.promptTemplateSelectedId;
    const selected = selectedCanvasPromptTemplate(deps);
    deps.promptTemplateCategory = selected?.category || deps.promptTemplateCategory || 'all';
}

async function saveCurrentCanvasPromptAsTemplate(deps){
    const lib = activeCanvasPromptLibrary(deps);
    if(!currentCanvasPromptTemplateLibraryEditable(deps)){ deps.setStatus('请选择可编辑的提示词库'); return; }
    if(selectedCanvasPromptTemplateGroupIsLegacy(deps)){ deps.setStatus('旧本地分组只读，请选择共享分组后保存'); return; }
    const text = currentCanvasPromptTemplateNodeText(deps);
    if(!text){ deps.setStatus('当前提示词为空'); return; }
    try {
        const data = await deps.fetch('/api/prompt-libraries/items', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({
                library_id:lib.id,
                name:canvasPromptTemplateDefaultName(deps, text),
                category:deps.promptTemplateCategory === 'all' ? 'custom' : deps.promptTemplateCategory,
                positive:text,
                scene:'我的提示词预设'
            })
        }).then(async r => {
            if(!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || '保存失败');
            return r.json();
        });
        deps.activePromptLibraryId = lib.id;
        syncCanvasPromptTemplateMutation(deps, data, data.item?.id || '');
        deps.promptTemplateEditing = true;
        renderPromptTemplateModal(deps);
    } catch(err) {
        deps.setStatus(err.message || '保存失败');
    }
}

async function createBlankCanvasPromptTemplate(deps){
    const lib = activeCanvasPromptLibrary(deps);
    if(!currentCanvasPromptTemplateLibraryEditable(deps)){ deps.setStatus('请选择可编辑的提示词库'); return; }
    if(selectedCanvasPromptTemplateGroupIsLegacy(deps)){ deps.setStatus('旧本地分组只读，请选择共享分组后新建'); return; }
    const category = deps.promptTemplateCategory && deps.promptTemplateCategory !== 'all' ? deps.promptTemplateCategory : 'custom';
    try {
        const data = await deps.fetch('/api/prompt-libraries/items', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({library_id:lib.id, name:'新模板', category, positive:'新提示词', scene:'我的提示词预设'})
        }).then(async r => {
            if(!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || '创建失败');
            return r.json();
        });
        deps.activePromptLibraryId = lib.id;
        deps.promptTemplateCategory = category;
        syncCanvasPromptTemplateMutation(deps, data, data.item?.id || '');
        deps.promptTemplateEditing = true;
        renderPromptTemplateModal(deps);
    } catch(err) {
        deps.setStatus(err.message || '创建失败');
    }
}

async function saveCanvasPromptTemplateEdit(deps){
    const lib = activeCanvasPromptLibrary(deps);
    const item = selectedCanvasPromptTemplate(deps);
    if(!item) return;
    if(canvasPromptTemplateIsLegacy(deps, item)){ deps.setStatus('旧本地分组只读，请选择共享分组后编辑'); return; }
    const name = deps.promptTemplatePanel.querySelector('[data-template-edit-name]')?.value?.trim() || '';
    const positive = deps.promptTemplatePanel.querySelector('[data-template-edit-text]')?.value?.trim() || '';
    const category = deps.promptTemplatePanel.querySelector('[data-template-edit-category]')?.value || 'mine';
    if(!name || !positive){ deps.setStatus(deps.tr('smart.tplRequired')); return; }
    try {
        // 仅当模板不是后端项（非 remote）时才退回本地覆盖；系统库现在是 remote，走下面的后端 PATCH 同步。
        if(item.builtin && !item.remote){
            deps.canvasPromptTemplateOverrides.editedBuiltins = deps.canvasPromptTemplateOverrides.editedBuiltins || {};
            deps.canvasPromptTemplateOverrides.editedBuiltins[item.sourceId || item.id] = {
                ...(deps.canvasPromptTemplateOverrides.editedBuiltins[item.sourceId || item.id] || {}),
                name,
                category,
                positive
            };
            saveCanvasPromptTemplateOverrides(deps);
            deps.promptTemplateEditing = false;
            refreshCanvasPromptTemplatesFromLibraries(deps);
            renderPromptTemplateModal(deps);
            return;
        }
        const data = await deps.fetch(`/api/prompt-libraries/items/${encodeURIComponent(item.id)}`, {
            method:'PATCH',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({library_id:item.libraryId || lib.id, name, category, scene:item.scene || '', positive, negative:item.negative || ''})
        }).then(async r => {
            if(!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || '保存失败');
            return r.json();
        });
        // 迁移：清掉这条系统模板的旧本地覆盖，避免它盖住刚同步到后端的最新内容。
        const legacyKey = item.sourceId || item.id;
        if(deps.canvasPromptTemplateOverrides.editedBuiltins && deps.canvasPromptTemplateOverrides.editedBuiltins[legacyKey]){
            delete deps.canvasPromptTemplateOverrides.editedBuiltins[legacyKey];
            saveCanvasPromptTemplateOverrides(deps);
        }
        syncCanvasPromptTemplateMutation(deps, data, item.id);
        deps.promptTemplateEditing = false;
        renderPromptTemplateModal(deps);
    } catch(err) {
        deps.setStatus(err.message || '保存失败');
    }
}

async function deleteCanvasPromptTemplate(deps){
    const item = selectedCanvasPromptTemplate(deps);
    if(!item) return;
    if(canvasPromptTemplateIsLegacy(deps, item)){ deps.setStatus('旧本地分组只读，请选择共享分组后删除'); return; }
    if(!deps.window.confirm(`删除提示词「${canvasPromptTemplateName(deps, item) || '提示词'}」？`)) return;
    try {
        // 系统库现在是 remote，删除走后端 DELETE 并同步；仅非 remote 的内置项才退回本地隐藏。
        if(item.builtin && !item.remote){
            deps.canvasPromptTemplateOverrides.hiddenBuiltinIds = [...new Set([...(deps.canvasPromptTemplateOverrides.hiddenBuiltinIds || []), item.sourceId || item.id])];
            saveCanvasPromptTemplateOverrides(deps);
            deps.promptTemplateSelectedId = '';
            deps.promptTemplateEditing = false;
            refreshCanvasPromptTemplatesFromLibraries(deps);
            renderPromptTemplateModal(deps);
            return;
        }
        const data = await deps.fetch(`/api/prompt-libraries/items/${encodeURIComponent(item.id)}`, {method:'DELETE'}).then(async r => {
            if(!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || '删除失败');
            return r.json();
        });
        deps.canvasPromptLibraries = data.library?.libraries || deps.canvasPromptLibraries;
        refreshCanvasPromptTemplatesFromLibraries(deps);
        deps.promptTemplateSelectedId = '';
        deps.promptTemplateEditing = false;
        renderPromptTemplateModal(deps);
    } catch(err) {
        deps.setStatus(err.message || '删除失败');
    }
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

async function createCanvasPromptTemplateGroup(deps){
    const name = deps.window.prompt(deps.tr('smart.tplNewGroupPrompt'), deps.tr('smart.tplNewGroupDefault'));
    if(!String(name || '').trim()) return;
    const lib = activeCanvasPromptLibrary(deps);
    try {
        const data = await deps.fetch('/api/prompt-libraries/categories', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body:JSON.stringify({name:String(name).trim().slice(0, 24), library_id:lib.id})
        }).then(async r => { if(!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || '新增分组失败'); return r.json(); });
        deps.canvasPromptLibraries = data.library?.libraries || deps.canvasPromptLibraries;
        deps.promptTemplateCategory = data.category?.id || deps.promptTemplateCategory;
        refreshCanvasPromptTemplatesFromLibraries(deps);
        renderPromptTemplateModal(deps);
    } catch(err){ deps.setStatus(err.message || '新增分组失败'); }
}

async function renameCanvasPromptTemplateGroup(deps, groupId){
    const lib = activeCanvasPromptLibrary(deps);
    const group = activeCanvasPromptTemplateGroups(deps).find(g => g.id === groupId);
    if(!group || group.legacyLocal) return;
    const name = deps.window.prompt(deps.tr('smart.tplGroupNamePrompt'), group.name || '');
    if(!String(name || '').trim()) return;
    try {
        const data = await deps.fetch(`/api/prompt-libraries/categories/${encodeURIComponent(groupId)}`, {
            method:'PATCH', headers:{'Content-Type':'application/json'},
            body:JSON.stringify({name:String(name).trim().slice(0, 24), library_id:lib.id})
        }).then(async r => { if(!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || '重命名失败'); return r.json(); });
        deps.canvasPromptLibraries = data.library?.libraries || deps.canvasPromptLibraries;
        refreshCanvasPromptTemplatesFromLibraries(deps);
        renderPromptTemplateModal(deps);
    } catch(err){ deps.setStatus(err.message || '重命名失败'); }
}

async function deleteCanvasPromptTemplateGroup(deps, groupId){
    if(activeCanvasPromptTemplateGroups(deps).find(group => group.id === groupId)?.legacyLocal) return;
    if(!deps.window.confirm(deps.tr('smart.tplDeleteGroupConfirm'))) return;
    try {
        const data = await deps.fetch(`/api/prompt-libraries/categories/${encodeURIComponent(groupId)}`, {method:'DELETE'})
            .then(async r => { if(!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || '删除失败'); return r.json(); });
        deps.canvasPromptLibraries = data.library?.libraries || deps.canvasPromptLibraries;
        if(deps.promptTemplateCategory === groupId) deps.promptTemplateCategory = 'all';
        refreshCanvasPromptTemplatesFromLibraries(deps);
        renderPromptTemplateModal(deps);
    } catch(err){ deps.setStatus(err.message || '删除失败'); }
}

function renderPromptTemplateModal(deps){
    if(!deps.promptTemplateModal || !deps.promptTemplatePanel || !deps.promptTemplateCats || !deps.promptTemplateBody) return;
    deps.canvasPromptTemplates = activeCanvasPromptLibraryItems(deps);
    renderCanvasPromptLibrarySelect(deps);
    const scrollSnapshot = promptTemplateScrollSnapshot(deps);
    const activeGroups = activeCanvasPromptTemplateGroups(deps);
    const categories = [{id:'all', name:deps.tr('smart.tplAll')}, ...activeGroups.map(group => ({...group, name:canvasPromptTemplateCategoryLabel(deps, group.id)}))];
    const counts = deps.canvasPromptTemplates.reduce((map, item) => {
        const category = item.category || 'mine';
        map[category] = (map[category] || 0) + 1;
        map.all += 1;
        return map;
    }, {all:0});
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
                    <div class="prompt-template-group-row ${(!group.legacyLocal && !['view','storyboard','character','product','lighting','mine'].includes(group.id)) ? 'has-delete' : ''}">
                        <button type="button" class="group-name ${group.id === deps.promptTemplateCategory ? 'active' : ''}" data-template-cat="${deps.escapeAttr(group.id)}">
                            <span>${deps.escapeHtml(canvasPromptTemplateCategoryLabel(deps, group.id))}</span>
                            <small>${counts[group.id] || 0}</small>
                        </button>
                        ${group.legacyLocal ? '' : `<button type="button" class="group-tool" data-template-cat-edit="${deps.escapeAttr(group.id)}" title="${deps.escapeAttr(deps.tr('smart.tplRename'))}"><i data-lucide="pencil"></i></button>
                        ${['view','storyboard','character','product','lighting','mine'].includes(group.id) ? '' : `<button type="button" class="group-tool danger" data-template-cat-delete="${deps.escapeAttr(group.id)}" title="${deps.escapeAttr(deps.tr('common.delete'))}"><i data-lucide="trash-2"></i></button>`}`}
                    </div>
                `).join('')}
            </div>
        </div>
    ` : `
        <div class="prompt-template-nav">
            <div class="prompt-template-tabs">
                ${categories.map(cat => `
                    <button type="button" class="${cat.id === deps.promptTemplateCategory ? 'active' : ''}" data-template-cat="${deps.escapeAttr(cat.id)}">
                        <span>${deps.escapeHtml(cat.name)}</span>
                        <small>${counts[cat.id] || 0}</small>
                    </button>
                `).join('')}
            </div>
            <button type="button" class="prompt-template-manage-groups" data-template-group-edit><i data-lucide="settings-2"></i><span>${deps.escapeHtml(deps.tr('smart.tplManageGroups'))}</span></button>
        </div>
    `;
    const items = canvasPromptTemplateVisibleItems(deps);
    if(items.length && !items.some(item => item.id === deps.promptTemplateSelectedId)) deps.promptTemplateSelectedId = items[0].id;
    const selected = items.find(item => item.id === deps.promptTemplateSelectedId) || items[0] || null;
    const canCreateCurrentLibrary = currentCanvasPromptTemplateLibraryEditable(deps) && !selectedCanvasPromptTemplateGroupIsLegacy(deps);
    const canEditSelectedTemplate = currentCanvasPromptTemplateLibraryEditable(deps) && !canvasPromptTemplateIsLegacy(deps, selected);
    const editMode = Boolean(deps.promptTemplateEditing && selected && canEditSelectedTemplate);
    deps.promptTemplateBody.innerHTML = `
        <div class="prompt-template-list">
            <div class="prompt-template-list-tools">
                <button type="button" ${canCreateCurrentLibrary ? '' : 'disabled'} data-template-save-current><i data-lucide="bookmark-plus"></i><span>${deps.escapeHtml(deps.tr('smart.tplSaveCurrent'))}</span></button>
                <button type="button" ${canCreateCurrentLibrary ? '' : 'disabled'} data-template-new><i data-lucide="file-plus-2"></i><span>${deps.escapeHtml(deps.tr('smart.tplNewTemplate'))}</span></button>
            </div>
            ${items.length ? items.map(item => `<button type="button" class="prompt-template-card ${item.id === selected?.id ? 'active' : ''}" data-template-id="${deps.escapeAttr(item.id)}">
                <span class="prompt-template-card-top">
                    <span class="prompt-template-name">${deps.escapeHtml(canvasPromptTemplateName(deps, item))}</span>
                    <span class="prompt-template-source">${deps.escapeHtml(item.builtin ? deps.tr('smart.tplBuiltin') : deps.tr('smart.tplMine'))}</span>
                </span>
                <span class="prompt-template-scene">${deps.escapeHtml(canvasPromptTemplateScene(deps, item) || item.positive || '')}</span>
                <span class="prompt-template-tag">${deps.escapeHtml(canvasPromptTemplateCategoryLabel(deps, item.category || 'mine'))}</span>
            </button>`).join('') : `<div class="prompt-template-list-empty">${deps.escapeHtml(deps.tr('smart.tplNoMatches'))}</div>`}
        </div>
        <div class="prompt-template-detail">
            ${selected ? `
                <div class="prompt-template-detail-head">
                    <div>
                        <strong>${deps.escapeHtml(canvasPromptTemplateName(deps, selected) || '')}</strong>
                        <span>${deps.escapeHtml(canvasPromptTemplateCategoryLabel(deps, selected.category || ''))} · ${deps.escapeHtml(selected.builtin ? deps.tr('smart.tplBuiltinTemplate') : deps.tr('smart.tplMineTemplate'))}</span>
                    </div>
                    ${editMode ? '' : `
                        <div class="prompt-template-icon-actions">
                            <button type="button" ${canEditSelectedTemplate ? '' : 'disabled'} data-template-edit title="${deps.escapeAttr(deps.tr('smart.tplEditTemplate'))}"><i data-lucide="pencil"></i><span>${deps.escapeHtml(deps.tr('common.edit'))}</span></button>
                            <button type="button" class="danger" ${canEditSelectedTemplate ? '' : 'disabled'} data-template-delete title="${deps.escapeAttr(deps.tr('smart.tplDeleteTemplate'))}"><i data-lucide="trash-2"></i><span>${deps.escapeHtml(deps.tr('common.delete'))}</span></button>
                        </div>
                    `}
                </div>
            ${editMode ? `
                <div class="prompt-template-edit-fields">
                    <label>${deps.escapeHtml(deps.tr('smart.tplName'))}</label>
                    <input data-template-edit-name value="${deps.escapeAttr(canvasPromptTemplateName(deps, selected) || '')}" placeholder="${deps.escapeAttr(deps.tr('smart.tplName'))}">
                    <label>${deps.escapeHtml(deps.tr('smart.tplGroup'))}</label>
                    <select data-template-edit-category>
                        ${activeGroups.map(group => `<option value="${deps.escapeAttr(group.id)}" ${group.id === (selected.category || 'custom') ? 'selected' : ''} ${group.legacyLocal && group.id !== selected.category ? 'disabled' : ''}>${deps.escapeHtml(canvasPromptTemplateCategoryLabel(deps, group.id))}</option>`).join('')}
                    </select>
                    <label>${deps.escapeHtml(deps.tr('smart.tplContent'))}</label>
                    <textarea data-template-edit-text placeholder="${deps.escapeAttr(deps.tr('smart.tplContent'))}">${deps.escapeHtml(selected.positive || '')}</textarea>
                </div>
            ` : `
                <div class="prompt-template-preview-content">
                    <div class="prompt-template-section">
                        <label>${deps.escapeHtml(deps.tr('smart.tplPositive'))}</label>
                        <p>${deps.escapeHtml(selected.positive || '')}</p>
                    </div>
                    ${selected.negative ? `<div class="prompt-template-section"><label>${deps.escapeHtml(deps.tr('smart.tplNegative'))}</label><p>${deps.escapeHtml(selected.negative)}</p></div>` : ''}
                    ${Object.keys(selected.params || {}).length ? `<div class="prompt-template-section"><label>${deps.escapeHtml(deps.tr('smart.tplParams'))}</label><p>${deps.escapeHtml(Object.entries(selected.params).map(([k,v]) => `${k}: ${v}`).join('\n'))}</p></div>` : ''}
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

async function openPromptTemplateModal(deps, nodeId){
    deps.promptTemplateNodeId = nodeId || '';
    deps.promptTemplateQuery = '';
    deps.promptTemplateEditing = false;
    if(deps.promptTemplateSearch) deps.promptTemplateSearch.value = '';
    await loadCanvasPromptTemplates(deps);
    if(!deps.promptTemplateCategory) deps.promptTemplateCategory = 'all';
    if(!deps.promptTemplateSelectedId) deps.promptTemplateSelectedId = deps.canvasPromptTemplates[0]?.id || '';
    renderPromptTemplateModal(deps);
    deps.promptTemplateModal?.classList.add('open');
    syncCanvasPromptTemplateButtons(deps);
    deps.promptTemplateSearch?.focus();
}

function closePromptTemplateModal(deps){
    deps.promptTemplateModal?.classList.remove('open');
    deps.promptTemplateNodeId = '';
    deps.promptTemplateEditing = false;
    deps.canvasAssistantTemplateCallback = null;
    syncCanvasPromptTemplateButtons(deps);
}

function applyPromptTemplateToPromptNode(deps, mode='positive'){
    const template = deps.canvasPromptTemplates.find(item => item.id === deps.promptTemplateSelectedId);
    if(deps.canvasAssistantTemplateCallback){
        if(!template) return;
        const callback = deps.canvasAssistantTemplateCallback;
        deps.canvasAssistantTemplateCallback = null;
        callback(canvasPromptTemplateText(deps, template, mode));
        closePromptTemplateModal(deps);
        return;
    }
    const node = deps.nodes.find(n => n.id === deps.promptTemplateNodeId && n.type === 'prompt');
    if(!template || !node) return;
    node.text = canvasPromptTemplateText(deps, template, mode);
    closePromptTemplateModal(deps);
    deps.scheduleSave();
    deps.syncGeneratorInputs();
    deps.refreshGeneratorInputViews();
    deps.render();
}

    const api={loadCanvasPromptTemplates, activeCanvasPromptLibrary, defaultCanvasPromptTemplateGroups, loadCanvasPromptTemplateGroups, loadCanvasPromptTemplateOverrides, saveCanvasPromptTemplateOverrides, activeCanvasPromptLibraryItems, refreshCanvasPromptTemplatesFromLibraries, renderCanvasPromptLibrarySelect, activeCanvasPromptTemplateGroups, canvasPromptTemplateCategoryLabel, selectedCanvasPromptTemplateGroupIsLegacy, canvasPromptTemplateIsLegacy, canvasPromptTemplateName, canvasPromptTemplateScene, canvasPromptTemplateText, canvasPromptTemplateSearchText, canvasPromptTemplateVisibleItems, currentCanvasPromptTemplateLibraryEditable, currentCanvasPromptTemplateNodeText, syncCanvasPromptTemplateButtons, canvasPromptTemplateDefaultName, selectedCanvasPromptTemplate, syncCanvasPromptTemplateMutation, saveCurrentCanvasPromptAsTemplate, createBlankCanvasPromptTemplate, saveCanvasPromptTemplateEdit, deleteCanvasPromptTemplate, promptTemplateScrollSnapshot, restorePromptTemplateScroll, createCanvasPromptTemplateGroup, renameCanvasPromptTemplateGroup, deleteCanvasPromptTemplateGroup, renderPromptTemplateModal, openPromptTemplateModal, closePromptTemplateModal, applyPromptTemplateToPromptNode};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.CanvasPromptTemplate=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
