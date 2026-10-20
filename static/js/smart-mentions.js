/* Mention picker responsibility: smart-mentions. Host supplies live state and effects. */
(function(root){
    'use strict';

function mentionTokenHtml(deps, img){
    if(!img?.url) return '';
    const kind = deps.mediaKindForItem(img);
    const name = img.alias || img.name || (kind === 'audio' ? '音频' : kind === 'video' ? '视频' : '图片');
    const media = mentionTokenMediaHtml(deps, img, kind);
    return `<span class="mention-image-token" contenteditable="false" data-url="${deps.escapeHtml(img.url)}" data-kind="${deps.escapeHtml(kind)}" data-name="${deps.escapeHtml(name)}" data-node-id="${deps.escapeHtml(img.nodeId || '')}" data-image-index="${deps.escapeHtml(img.imageIndex ?? '')}">${media}<span>${deps.escapeHtml(name)}</span></span>`;
}

function mentionTokenMediaHtml(deps, img, kind=deps.mediaKindForItem(img)){
    if(kind === 'audio'){
        return `<div class="mention-audio-thumb"><i data-lucide="file-audio"></i></div>`;
    }
    if(kind === 'video'){
        return deps.smartVideoPreviewHtml(img, 256, 'alt=""');
    }
    return deps.smartPreviewImgHtml(img, 256, 'alt=""');
}

function mentionOptionMediaHtml(deps, img){
    const kind = deps.mediaKindForItem(img);
    if(kind === 'audio'){
        return `<div class="media-thumb audio-thumb mention-option-audio"><i data-lucide="file-audio"></i><span>${deps.escapeHtml(img.alias || img.name || 'Audio')}</span></div>`;
    }
    return kind === 'video' ? deps.smartVideoPreviewHtml(img, 256, 'alt=""') : deps.smartPreviewImgHtml(img, 256, 'alt=""');
}

function promptHtmlWithMentionTokens(deps, text, refs=[]){
    const value = String(text || '');
    const items = (refs || []).filter(ref => ref?.url && ref?.name).sort((a, b) => String(b.name || '').length - String(a.name || '').length);
    if(!value || !items.length || !value.includes('@')) return '';
    let html = '';
    let index = 0;
    while(index < value.length){
        if(value[index] === '@'){
            const hit = items.find(ref => value.slice(index + 1, index + 1 + String(ref.name || '').length) === String(ref.name || ''));
            if(hit){
                html += mentionTokenHtml(deps, hit);
                index += 1 + String(hit.name || '').length;
                continue;
            }
        }
        html += deps.escapeHtml(value[index]);
        index += 1;
    }
    return html;
}

function collectMentionedImagesFromPrompt(deps){
    const images = [];
    deps.collectPromptParts().forEach(part => {
        if(part.type === 'image' && part.url) images.push(part);
    });
    return images;
}

function uniqueReferenceImages(deps, images){
    const refs = [];
    const seen = new Set();
    (images || []).forEach((img, index) => {
        if(!img?.url || seen.has(img.url)) return;
        seen.add(img.url);
        if(refs.length >= deps.SMART_REFERENCE_IMAGE_MAX) return;
        refs.push({
            ...img,
            name:img.name || `图${refs.length + 1}`,
            role:img.role || `image_${refs.length + 1}`,
            imageIndex:Number.isFinite(Number(img.imageIndex)) ? Number(img.imageIndex) : index
        });
    });
    return refs;
}

function visibleReferenceImagesFor(deps, node){
    const base = deps.defaultReferenceImagesFor(node);
    return uniqueReferenceImages(deps, [...base, ...collectMentionedImagesFromPrompt(deps)]);
}

function inputMentionCandidateImages(deps, node){
    const current = node ? [...deps.lineImagesFor(node), ...deps.manualReferenceImagesFor(node)] : [];
    const seen = new Set();
    return current.filter(img => {
        if(!img?.url || seen.has(img.url)) return false;
        seen.add(img.url);
        return true;
    }).map((img, index) => ({
        ...img,
        mentionId:`mention_${index}_${Math.random().toString(36).slice(2, 7)}`,
        alias:img.name || `图片${index + 1}`
    }));
}

function assetRegisteredUris(deps, item){
    const regs = (item && item.registrations && typeof item.registrations === 'object') ? item.registrations : {};
    const out = {};
    Object.keys(regs).forEach(platform => {
        const reg = regs[platform];
        if(reg && reg.status === 'Active' && reg.asset_uri) out[platform] = reg.asset_uri;
    });
    return out;
}

function assetMentionCandidateImages(deps, categoryId=''){
    const cats = deps.assetCategories('image');
    const cat = cats.find(c => c.id === categoryId) || deps.assetCategoryForMention();
    if(!cat) return [];
    deps.mentionAssetCategoryId = cat.id;
    const items = (cat.items || []).map(item => ({...item, categoryName:cat.name || '', categoryId:cat.id}));
    const seen = new Set();
    return items.filter(item => {
        if(!item?.url || seen.has(item.url)) return false;
        seen.add(item.url);
        return true;
    }).map((item, index) => ({
        url:item.url,
        kind:deps.assetMediaKind(item),
        name:item.name || `资产${index + 1}`,
        alias:item.name || `资产${index + 1}`,
        role:'asset',
        categoryName:item.categoryName || '',
        asset_uris:assetRegisteredUris(deps, item),
        mentionId:`asset_${index}_${Math.random().toString(36).slice(2, 7)}`
    }));
}

function mentionCandidateImages(deps, node, source=deps.mentionSource){
    return source === 'asset' ? assetMentionCandidateImages(deps, deps.mentionAssetCategoryId) : inputMentionCandidateImages(deps, node);
}

function closeMentionPicker(deps){
    deps.mentionPicker.classList.remove('open');
    deps.mentionPicker.innerHTML = '';
    deps.mentionAnchorEl = null;
    deps.mentionInsertMode = 'token';
    if(deps.selectedNode()) deps.renderInputThumbsRow(deps.selectedNode());
}

function saveMentionRange(deps){
    const sel = deps.window.getSelection();
    if(sel && sel.rangeCount && deps.promptInput.contains(sel.anchorNode)){
        deps.mentionRange = sel.getRangeAt(0).cloneRange();
    }
}

function textBeforeCaret(deps){
    const sel = deps.window.getSelection();
    if(!sel || !sel.rangeCount || !deps.promptInput.contains(sel.anchorNode)) return '';
    const range = sel.getRangeAt(0).cloneRange();
    range.selectNodeContents(deps.promptInput);
    range.setEnd(sel.anchorNode, sel.anchorOffset);
    return range.toString();
}

function renderMentionPicker(deps, source){
    const node = deps.selectedNode();
    const inputItems = inputMentionCandidateImages(deps, node);
    const assetLibs = deps.assetLibraries();
    if(!deps.activeAssetLibraryId || !assetLibs.some(lib => lib.id === deps.activeAssetLibraryId)) deps.activeAssetLibraryId = deps.assetLibrary.active_library_id || assetLibs[0]?.id || '';
    const libraryWithMentionAssets = assetLibs.find(lib => (lib.categories || []).some(cat => (cat.type || 'image') === 'image' && (cat.items || []).some(item => item?.url)));
    const assetCats = deps.assetCategories('image');
    const hasInput = inputItems.length > 0;
    const hasAssets = Boolean(libraryWithMentionAssets);
    deps.mentionSource = source || (hasInput ? 'input' : 'asset');
    if(deps.mentionSource === 'asset' && hasAssets && !assetCats.some(cat => (cat.items || []).some(item => item?.url)) && libraryWithMentionAssets){
        deps.activeAssetLibraryId = libraryWithMentionAssets.id;
        deps.activeAssetCategoryId = '';
        deps.mentionAssetCategoryId = '';
    }
    if(deps.mentionSource === 'input' && !hasInput && hasAssets) deps.mentionSource = 'asset';
    if(deps.mentionSource === 'asset' && !hasAssets && hasInput) deps.mentionSource = 'input';
    if(!hasInput && !hasAssets){ closeMentionPicker(deps); return; }
    const nextAssetCats = deps.assetCategories('image');
    const currentAssetCat = deps.assetCategoryForMention();
    const assetItems = assetMentionCandidateImages(deps, currentAssetCat?.id || '');
    const candidates = (deps.mentionSource === 'asset' ? assetItems : inputItems).slice(0, 36);
    const body = candidates.length ? `<div class="mention-option-grid">${candidates.map((img, i) => `
            <button class="mention-option" type="button" data-mention-index="${i}">
                ${mentionOptionMediaHtml(deps, img)}
                <span>${deps.escapeHtml(img.alias)}</span>
            </button>
        `).join('')}</div>` : `<div class="mention-empty">${deps.escapeHtml(deps.tr('smart.mentionEmpty'))}</div>`;
    const librarySelect = (deps.mentionSource === 'asset' && assetLibs.length)
        ? `<label class="mention-library-row"><span>${deps.escapeHtml(deps.tr('smart.assetLibrary'))}</span><select class="mention-library-select" data-mention-library>${assetLibs.map(lib => `<option value="${deps.escapeHtml(lib.id)}" ${lib.id === deps.activeAssetLibraryId ? 'selected' : ''}>${deps.escapeHtml(lib.name || '资产库')}</option>`).join('')}</select></label>`
        : '';
    const folderChips = (deps.mentionSource === 'asset' && nextAssetCats.length)
        ? nextAssetCats.map(cat => {
            const label = cat.name || deps.tr('smart.assetFolder');
            return `<button class="mention-folder-chip ${cat.id === deps.mentionAssetCategoryId ? 'active' : ''}" type="button" data-mention-folder="${deps.escapeHtml(cat.id)}" title="${deps.escapeHtml(label)}">${deps.escapeHtml(label)}</button>`;
          }).join('')
        : '';
    deps.mentionPicker.innerHTML = `
        <div class="mention-picker-shell">
            <div class="mention-source-tabs">
                <button class="mention-source-tab ${deps.mentionSource === 'input' ? 'active' : ''}" type="button" data-mention-source="input" title="${deps.escapeHtml(deps.tr('smart.mentionInput'))}" ${hasInput ? '' : 'disabled'}>
                    <i data-lucide="image"></i><span>${deps.escapeHtml(deps.tr('smart.mentionInput'))}</span>
                </button>
                <button class="mention-source-tab ${deps.mentionSource === 'asset' ? 'active' : ''}" type="button" data-mention-source="asset" title="${deps.escapeHtml(deps.tr('smart.mentionAssets'))}" ${hasAssets ? '' : 'disabled'}>
                    <i data-lucide="library"></i><span>${deps.escapeHtml(deps.tr('smart.mentionAssets'))}</span>
                </button>
            </div>
            ${librarySelect}
            <div class="mention-folder-chips ${folderChips ? '' : 'hidden'}">
                ${folderChips}
            </div>
            <div class="mention-content">
                ${body}
            </div>
        </div>
    `;
    deps.mentionPicker._items = candidates;
    deps.bindSmartPreviewImageFallbacks(deps.mentionPicker);
    if(deps.mentionInsertMode === 'manual-ref'){
        placeMentionPickerInComposerCard(deps);
        deps.renderInputThumbsRow(deps.selectedNode());
        deps.mentionAnchorEl = deps.inputThumbsRow?.querySelector('[data-input-add-reference]') || deps.inputThumbsRow;
    } else {
        placeMentionPickerInPromptRow(deps);
    }
    positionMentionPickerAtCaret(deps);
    deps.mentionPicker.classList.add('open');
    deps.mentionPicker.querySelectorAll('[data-mention-source]').forEach(btn => {
        btn.addEventListener('mousedown', e => {
            e.preventDefault(); e.stopPropagation();
            if(btn.disabled) return;
            renderMentionPicker(deps, btn.dataset.mentionSource);
        });
    });
    deps.mentionPicker.querySelectorAll('[data-mention-library]').forEach(select => {
        select.addEventListener('mousedown', e => e.stopPropagation());
        select.addEventListener('change', e => {
            deps.activeAssetLibraryId = e.target.value || '';
            deps.activeAssetCategoryId = '';
            deps.mentionAssetCategoryId = '';
            deps.renderAssetLibrary();
            renderMentionPicker(deps, 'asset');
        });
    });
    deps.mentionPicker.querySelectorAll('[data-mention-folder]').forEach(btn => {
        btn.addEventListener('mousedown', e => {
            e.preventDefault(); e.stopPropagation();
            deps.mentionAssetCategoryId = btn.dataset.mentionFolder || '';
            renderMentionPicker(deps, 'asset');
        });
    });
    deps.mentionPicker.querySelectorAll('[data-mention-index]').forEach(btn => {
        btn.addEventListener('mousedown', e => {
            e.preventDefault(); e.stopPropagation();
            const item = deps.mentionPicker._items[Number(btn.dataset.mentionIndex)];
            if(deps.mentionInsertMode === 'manual-ref') addManualReferenceToSelectedNode(deps, item);
            else insertMentionToken(deps, item);
        });
    });
    deps.refreshIcons();
}

function showMentionPicker(deps){
    const node = deps.selectedNode();
    const hasInput = inputMentionCandidateImages(deps, node).length > 0;
    deps.mentionInsertMode = 'token';
    deps.mentionAnchorEl = null;
    placeMentionPickerInPromptRow(deps);
    deps.mentionSource = hasInput ? 'input' : 'asset';
    renderMentionPicker(deps, deps.mentionSource);
}

function setPromptCaretToEnd(deps){
    if(!deps.promptInput) return;
    deps.promptInput.focus();
    const range = deps.document.createRange();
    range.selectNodeContents(deps.promptInput);
    range.collapse(false);
    const sel = deps.window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    deps.mentionRange = range.cloneRange();
}

function toggleAssetMentionPickerFromThumbs(deps){
    if(!deps.selectedNode()) return;
    if(deps.mentionInsertMode === 'manual-ref'){
        closeMentionPicker(deps);
        return;
    }
    deps.mentionInsertMode = 'manual-ref';
    deps.renderInputThumbsRow(deps.selectedNode());
    deps.mentionAnchorEl = deps.inputThumbsRow?.querySelector('[data-input-add-reference]') || deps.inputThumbsRow;
    renderMentionPicker(deps, 'asset');
}

function addManualReferenceToSelectedNode(deps, img){
    const node = deps.selectedNode();
    if(!node || !img?.url) return;
    const kind = img.kind || deps.mediaKindForItem(img);
    const ref = {
        url:img.url,
        name:img.alias || img.name || (kind === 'audio' ? '音频' : kind === 'video' ? '视频' : '图片'),
        kind,
        nodeId:img.nodeId || '',
        imageIndex:Number.isFinite(Number(img.imageIndex)) ? Number(img.imageIndex) : '',
        asset_uris:img.asset_uris || {},
        manualAdded:true
    };
    if(img.originalLocalUrl) ref.originalLocalUrl = img.originalLocalUrl;
    const refs = Array.isArray(node.manualInputRefs) ? node.manualInputRefs.slice() : [];
    const key = deps.inputRefKey(ref);
    const exists = refs.some(item => deps.inputRefKey(item) === key || item.url === ref.url);
    if(exists){
        closeMentionPicker(deps);
        return;
    }
    deps.pushUndo();
    refs.push(ref);
    node.manualInputRefs = refs;
    closeMentionPicker(deps);
    deps.renderInputThumbsRow(node);
    deps.scheduleSave();
}

function removeManualReferenceFromSelectedNode(deps, key){
    const node = deps.selectedNode();
    if(!node || !key || !Array.isArray(node.manualInputRefs)) return;
    const refs = node.manualInputRefs.slice();
    const index = refs.findIndex(ref => deps.inputRefKey(ref) === key || ref?.url === key.replace(/^url\|/, ''));
    if(index < 0) return;
    deps.pushUndo();
    refs.splice(index, 1);
    node.manualInputRefs = refs;
    if(!refs.length) delete node.manualInputRefs;
    deps.renderInputThumbsRow(node);
    deps.scheduleSave();
}

function placeMentionPickerInPromptRow(deps){
    const row = deps.promptInput?.closest?.('.prompt-row');
    if(row && deps.mentionPicker.parentElement !== row) row.insertBefore(deps.mentionPicker, deps.promptResize || null);
}

function placeMentionPickerInComposerCard(deps){
    const card = deps.promptInput?.closest?.('.composer-card');
    if(card && deps.mentionPicker.parentElement !== card) card.appendChild(deps.mentionPicker);
}

function positionMentionPickerAtCaret(deps){
    const row = deps.promptInput.closest('.prompt-row');
    const rowRect = row.getBoundingClientRect();
    if(deps.mentionAnchorEl){
        const anchorRect = deps.mentionAnchorEl.getBoundingClientRect();
        const scale = (typeof deps.viewport !== 'undefined' && Number(deps.viewport?.scale)) || 1;
        const safeScale = scale > 0 ? scale : 1;
        const pickerWidth = deps.mentionPicker.offsetWidth || 340;
        const base = deps.mentionPicker.offsetParent || deps.mentionPicker.parentElement || row;
        const baseRect = base.getBoundingClientRect();
        const baseLogicalWidth = baseRect.width / safeScale;
        const rawLeft = (anchorRect.right - baseRect.left) / safeScale - pickerWidth;
        const rawTop = (anchorRect.bottom - baseRect.top) / safeScale + 2;
        const left = Math.max(4, Math.min(rawLeft, Math.max(4, baseLogicalWidth - pickerWidth - 4)));
        deps.mentionPicker.style.left = `${left}px`;
        deps.mentionPicker.style.top = `${Math.max(2, rawTop)}px`;
        return;
    }
    let caretRect = null;
    const sel = deps.window.getSelection();
    if(sel && sel.rangeCount){
        const range = sel.getRangeAt(0).cloneRange();
        caretRect = range.getClientRects()[0] || range.getBoundingClientRect();
    }
    const inputRect = deps.promptInput.getBoundingClientRect();
    // composer 在 world 里被 viewport.scale 缩放过，getBoundingClientRect 返回的是缩放后的屏幕像素，
    // 而 style.left/top 是逻辑像素 → 需要除以 scale 才能正确还原 caret 的逻辑坐标
    const scale = (typeof deps.viewport !== 'undefined' && Number(deps.viewport?.scale)) || 1;
    const safeScale = scale > 0 ? scale : 1;
    const rowLogicalWidth = rowRect.width / safeScale;
    const pickerWidth = deps.mentionPicker.offsetWidth || 340;
    const maxLeft = Math.max(4, rowLogicalWidth - pickerWidth - 4);
    const rawLeft = ((caretRect?.left || inputRect.left) - rowRect.left) / safeScale - 6;
    const rawTop = ((caretRect?.bottom || inputRect.top + 24) - rowRect.top) / safeScale + 2;
    const left = Math.max(4, Math.min(rawLeft, maxLeft));
    const top = Math.max(2, rawTop);
    deps.mentionPicker.style.left = `${left}px`;
    deps.mentionPicker.style.top = `${top}px`;
}

function maybeOpenMentionPicker(deps){
    saveMentionRange(deps);
    const before = textBeforeCaret(deps);
    if(/@$/.test(before)) showMentionPicker(deps);
    else closeMentionPicker(deps);
}

function insertMentionToken(deps, img){
    if(!img?.url) return;
    deps.promptInput.focus();
    const sel = deps.window.getSelection();
    if(deps.mentionRange){
        sel.removeAllRanges();
        sel.addRange(deps.mentionRange);
    }
    const range = sel.rangeCount ? sel.getRangeAt(0) : deps.document.createRange();
    let removedAt = false;
    if(range.startContainer?.nodeType === deps.Node.TEXT_NODE && range.startOffset > 0){
        const text = range.startContainer.textContent || '';
        if(text[range.startOffset - 1] === '@'){
            range.setStart(range.startContainer, range.startOffset - 1);
            range.deleteContents();
            removedAt = true;
        }
    }
    if(!removedAt) {
        const walker = deps.document.createTreeWalker(deps.promptInput, deps.NodeFilter.SHOW_TEXT);
        let lastText = null;
        while(walker.nextNode()) lastText = walker.currentNode;
        if(lastText && /@$/.test(lastText.textContent || '')) {
            lastText.textContent = lastText.textContent.slice(0, -1);
            range.selectNodeContents(deps.promptInput);
            range.collapse(false);
        }
    }
    const token = deps.document.createElement('span');
    token.className = 'mention-image-token';
    token.contentEditable = 'false';
    token.dataset.url = img.url;
    token.dataset.kind = deps.mediaKindForItem(img);
    token.dataset.name = img.alias || img.name || (token.dataset.kind === 'audio' ? '音频' : token.dataset.kind === 'video' ? '视频' : '图片');
    token.dataset.nodeId = img.nodeId || '';
    token.dataset.imageIndex = String(img.imageIndex ?? '');
    token.dataset.assetUris = JSON.stringify(img.asset_uris || {});
    token.innerHTML = `${mentionTokenMediaHtml(deps, img, token.dataset.kind)}<span>${deps.escapeHtml(token.dataset.name)}</span>`;
    range.insertNode(token);
    deps.bindSmartPreviewImageFallbacks(token);
    const spacer = deps.document.createTextNode(' ');
    token.after(spacer);
    range.setStartAfter(spacer);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    closeMentionPicker(deps);
    deps.promptInput.focus();
    deps.renderInputThumbsRow(deps.selectedNode());
    // DOM insertion does not emit the input event that normally persists drafts.
    delete deps.promptInput.dataset.preserveDraftOnce;
    deps.savePromptDraftForCurrent();
    deps.scheduleSave();
}

    const api={mentionTokenHtml, mentionTokenMediaHtml, mentionOptionMediaHtml, promptHtmlWithMentionTokens, collectMentionedImagesFromPrompt, uniqueReferenceImages, visibleReferenceImagesFor, inputMentionCandidateImages, assetRegisteredUris, assetMentionCandidateImages, mentionCandidateImages, closeMentionPicker, saveMentionRange, textBeforeCaret, renderMentionPicker, showMentionPicker, setPromptCaretToEnd, toggleAssetMentionPickerFromThumbs, addManualReferenceToSelectedNode, removeManualReferenceFromSelectedNode, placeMentionPickerInPromptRow, placeMentionPickerInComposerCard, positionMentionPickerAtCaret, maybeOpenMentionPicker, insertMentionToken};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.SmartMentions=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
