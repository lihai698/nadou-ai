/* Prompt preset responsibility: smart-prompt-presets. Host supplies live state and effects. */
(function(root){
    'use strict';

function loadPromptPresets(deps){
    try {
        const list = JSON.parse(deps.localStorage.getItem(deps.PROMPT_PRESETS_KEY) || '[]');
        deps.promptPresets = Array.isArray(list) ? list.filter(p => p?.id && typeof p.text === 'string') : [];
    } catch(e) {
        deps.promptPresets = [];
    }
}

function savePromptPresets(deps){
    deps.localStorage.setItem(deps.PROMPT_PRESETS_KEY, JSON.stringify(deps.promptPresets));
}

function currentPromptPreset(deps, id){
    return deps.promptPresets.find(p => p.id === id) || null;
}

function defaultPromptPresetName(deps, text){
    return (String(text || '').trim().split(/\r?\n/)[0] || deps.tr('smart.promptPresetDefault')).slice(0, 28);
}

function promptPresetPanelNode(deps){
    return deps.nodes.find(n => n.id === deps.promptPresetPanel?.dataset.nodeId) || null;
}

function setPromptPresetStatus(deps, text='', tone=''){
    if(!deps.promptPresetStatus) return;
    deps.promptPresetStatus.textContent = text;
    deps.promptPresetStatus.classList.toggle('warn', tone === 'warn');
    deps.promptPresetStatus.classList.toggle('ok', tone === 'ok');
}

function resetPromptPresetDeleteState(deps){
    deps.promptPresetDeleteArmed = false;
    if(deps.promptPresetDelete){
        deps.promptPresetDelete.textContent = deps.tr('common.delete');
        deps.promptPresetDelete.classList.remove('confirm-danger');
    }
}

function createPromptPresetFromNode(deps, node, {openPanel=true, openTemplatePanel=false}={}){
    const text = String((node?.llmEnabled ? node.llmInstruction : node?.text) || '').trim();
    if(!text){ deps.toast(deps.tr('smart.promptPresetEmpty')); return null; }
    const preset = {id:deps.uid('preset'), name:defaultPromptPresetName(deps, text), text, createdAt:Date.now(), updatedAt:Date.now()};
    deps.promptPresets.unshift(preset);
    savePromptPresets(deps);
    if(node) node.promptPresetId = preset.id;
    deps.render();
    deps.scheduleSave();
    if(openPanel) openPromptPresetPanel(deps, node?.id || '', preset.id, {status:deps.tr('smart.promptPresetSavedNew'), tone:'ok'});
    if(openTemplatePanel) {
        deps.promptTemplateCategory = 'mine';
        deps.promptTemplateSelectedId = `mine:${preset.id}`;
        deps.promptTemplateEditing = true;
        deps.openPromptTemplatePanel(node?.id || '', deps.promptTemplateSelectedId);
    }
    return preset;
}

function createPromptPresetFromComposer(deps){
    const text = deps.promptPlainText();
    if(!text){ deps.toast(deps.tr('smart.promptPresetEmpty')); return null; }
    const preset = {id:deps.uid('preset'), name:defaultPromptPresetName(deps, text), text, category:'mine', createdAt:Date.now(), updatedAt:Date.now()};
    deps.promptPresets.unshift(preset);
    savePromptPresets(deps);
    deps.savePromptDraftForCurrent();
    deps.scheduleSave();
    return preset;
}

function savePromptNodeAsPreset(deps, node){
    createPromptPresetFromNode(deps, node);
}

function renderPromptPresetPanel(deps, selectedId='', message=''){
    if(!deps.promptPresetSelect) return;
    resetPromptPresetDeleteState(deps);
    deps.promptPresetSelect.innerHTML = deps.promptPresets.length
        ? deps.promptPresets.map(p => `<option value="${deps.escapeHtml(p.id)}" ${p.id === selectedId ? 'selected' : ''}>${deps.escapeHtml(p.name || deps.tr('smart.promptPresetUnnamed'))}</option>`).join('')
        : `<option value="">${deps.escapeHtml(deps.tr('smart.promptPresetNone'))}</option>`;
    const preset = currentPromptPreset(deps, selectedId) || deps.promptPresets[0] || null;
    if(preset && deps.promptPresetSelect.value !== preset.id) deps.promptPresetSelect.value = preset.id;
    deps.promptPresetName.value = preset?.name || '';
    deps.promptPresetText.value = preset?.text || '';
    const hasPreset = Boolean(preset);
    const nodeHasText = Boolean(String(promptPresetPanelNode(deps)?.text || '').trim());
    deps.promptPresetApply.disabled = !hasPreset;
    deps.promptPresetDelete.disabled = !hasPreset;
    deps.promptPresetSave.disabled = !hasPreset;
    if(deps.promptPresetNew) deps.promptPresetNew.disabled = !nodeHasText;
    setPromptPresetStatus(deps, message || (hasPreset ? deps.tr('smart.promptPresetPanelHint') : deps.tr('smart.promptPresetPanelEmpty')));
}

function openPromptPresetPanel(deps, nodeId='', presetId='', options={}){
    if(!deps.promptPresetPanel) return;
    deps.promptPresetPanel.dataset.nodeId = nodeId || '';
    const node = deps.nodes.find(n => n.id === nodeId);
    const preferred = presetId || node?.promptPresetId || deps.promptPresets[0]?.id || '';
    renderPromptPresetPanel(deps, preferred, options.status || '');
    if(options.tone) setPromptPresetStatus(deps, options.status || '', options.tone);
    const nodeEl = nodeId ? deps.world.querySelector(`.image-node[data-id="${deps.CSS.escape(nodeId)}"]`) : null;
    const rect = nodeEl?.getBoundingClientRect();
    const shellRect = deps.shell.getBoundingClientRect();
    const maxLeft = Math.max(18, shellRect.width - 410);
    const maxTop = Math.max(18, shellRect.height - 330);
    const left = rect ? Math.min(maxLeft, Math.max(18, rect.right - shellRect.left + 12)) : 80;
    const top = rect ? Math.min(maxTop, Math.max(18, rect.top - shellRect.top)) : 80;
    deps.promptPresetPanel.style.left = `${left}px`;
    deps.promptPresetPanel.style.top = `${top}px`;
    deps.promptPresetPanel.classList.add('open');
    deps.refreshIcons();
}

function closePromptPresetPanel(deps){
    deps.promptPresetPanel?.classList.remove('open');
    resetPromptPresetDeleteState(deps);
}

function editPromptPresetForNode(deps, node){
    deps.openPromptTemplatePanel(node?.id || '', node?.promptPresetId ? `mine:${node.promptPresetId}` : '');
}

function applySelectedPromptPreset(deps){
    const preset = currentPromptPreset(deps, deps.promptPresetSelect.value);
    const node = promptPresetPanelNode(deps);
    if(!preset || !node) return;
    node.promptPresetId = preset.id;
    node.text = preset.text || '';
    closePromptPresetPanel(deps);
    deps.render();
    deps.scheduleSave();
}

function saveSelectedPromptPreset(deps){
    const preset = currentPromptPreset(deps, deps.promptPresetSelect.value);
    if(!preset) return;
    const name = deps.promptPresetName.value.trim();
    const text = deps.promptPresetText.value.trim();
    if(!name || !text){ setPromptPresetStatus(deps, deps.tr('smart.promptPresetRequired'), 'warn'); return; }
    const idx = deps.promptPresets.findIndex(p => p.id === preset.id);
    if(idx >= 0) deps.promptPresets[idx] = {...deps.promptPresets[idx], name, text, updatedAt:Date.now()};
    savePromptPresets(deps);
    const node = promptPresetPanelNode(deps);
    if(node?.promptPresetId === preset.id) node.text = text;
    renderPromptPresetPanel(deps, preset.id, deps.tr('smart.promptPresetSaved'));
    setPromptPresetStatus(deps, deps.tr('smart.promptPresetSaved'), 'ok');
    deps.render();
    deps.scheduleSave();
}

function createPromptPresetFromPanel(deps){
    const node = promptPresetPanelNode(deps);
    const preset = createPromptPresetFromNode(deps, node, {openPanel:false});
    if(!preset) return;
    renderPromptPresetPanel(deps, preset.id, deps.tr('smart.promptPresetSavedNew'));
    setPromptPresetStatus(deps, deps.tr('smart.promptPresetSavedNew'), 'ok');
    deps.promptPresetName?.focus();
    deps.promptPresetName?.select();
}

function deleteSelectedPromptPreset(deps){
    const preset = currentPromptPreset(deps, deps.promptPresetSelect.value);
    if(!preset) return;
    if(!deps.promptPresetDeleteArmed){
        deps.promptPresetDeleteArmed = true;
        deps.promptPresetDelete.textContent = deps.tr('smart.promptPresetDeleteAgain');
        deps.promptPresetDelete.classList.add('confirm-danger');
        setPromptPresetStatus(deps, deps.tr('smart.promptPresetDeleteConfirm').replace('{name}', preset.name || deps.tr('smart.promptPresetUnnamed')), 'warn');
        return;
    }
    deps.promptPresets = deps.promptPresets.filter(p => p.id !== preset.id);
    deps.nodes.forEach(node => { if(node.promptPresetId === preset.id) node.promptPresetId = ''; });
    savePromptPresets(deps);
    renderPromptPresetPanel(deps, deps.promptPresets[0]?.id || '', deps.tr('smart.promptPresetDeleted'));
    setPromptPresetStatus(deps, deps.tr('smart.promptPresetDeleted'), 'ok');
    deps.render();
    deps.scheduleSave();
}

    const api={loadPromptPresets, savePromptPresets, currentPromptPreset, defaultPromptPresetName, promptPresetPanelNode, setPromptPresetStatus, resetPromptPresetDeleteState, createPromptPresetFromNode, createPromptPresetFromComposer, savePromptNodeAsPreset, renderPromptPresetPanel, openPromptPresetPanel, closePromptPresetPanel, editPromptPresetForNode, applySelectedPromptPreset, saveSelectedPromptPreset, createPromptPresetFromPanel, deleteSelectedPromptPreset};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.SmartPromptPresets=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
