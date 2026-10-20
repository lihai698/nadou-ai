/* Asset panel responsibility: smart-asset-import. Host supplies live state and effects. */
(function(root){
    'use strict';

async function addUrlToAssetLibrary(deps, url, name=''){
    if(deps.assetLibraryIsLocal()) return addUrlToLocalAssetLibrary(deps, url, name);
    const cat = deps.activeAssetCategory();
    if(!cat){ deps.toast(deps.tr('smart.assetNoFolder')); return; }
    const data = await deps.fetch('/api/asset-library/items', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({library_id:deps.activeAssetLibraryId, category_id:cat.id, url, name})}).then(async r => {
        if(!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || deps.tr('smart.assetAddFail'));
        return r.json();
    });
    deps.setAssetLibraryFromResponse(data);
    deps.toast(deps.tr('smart.assetSaved'));
}

function localAssetFolderPath(deps){
    const cat = deps.activeAssetCategory();
    return cat && cat.id !== '__root__' ? (cat.id || '') : '';
}

function setLocalAssetLibraryFromResponse(deps, data){
    deps.localAssetLibrary = {items:Array.isArray(data.items) ? data.items : deps.localAssetLibrary.items, tree:data.tree || deps.localAssetLibrary.tree};
}

async function addFilesToLocalAssetLibrary(deps, files=[]){
    const supported = [...(files || [])].filter(deps.isSupportedUploadFile);
    if(!supported.length) return [];
    const form = new FormData();
    form.append('folder', localAssetFolderPath(deps));
    supported.forEach(file => form.append('files', file, file.name || 'media'));
    const data = await deps.fetch('/api/local-assets/upload', {method:'POST', body:form}).then(async r => {
        if(!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || deps.tr('smart.assetAddFail'));
        return r.json();
    });
    const localData = await deps.fetch('/api/local-assets').then(r => r.ok ? r.json() : {items:[], tree:null});
    setLocalAssetLibraryFromResponse(deps, localData);
    deps.renderAssetLibrary();
    deps.toast(`已保存 ${data.files?.length || 0} 个本地素材`);
    return data.files || [];
}

async function addLocalPathsToLocalAssetLibrary(deps, paths=[]){
    const imported = await deps.importSmartLocalImages(paths);
    return addUrlItemsToLocalAssetLibrary(deps, imported.map(item => ({url:item.url, name:item.name || deps.smartImageNameFromUrl(item.url)})));
}

async function addUrlItemsToLocalAssetLibrary(deps, items=[]){
    const list = (items || []).filter(item => item?.url);
    if(!list.length) return [];
    const data = await deps.fetch('/api/local-assets/import-urls', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({folder:localAssetFolderPath(deps), items:list.map(item => ({url:item.url, name:item.name || deps.smartImageNameFromUrl(item.url)}))})
    }).then(async r => {
        if(!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || deps.tr('smart.assetAddFail'));
        return r.json();
    });
    setLocalAssetLibraryFromResponse(deps, data);
    deps.renderAssetLibrary();
    deps.toast(`已保存 ${data.count || 0} 个本地素材`);
    return data.files || [];
}

async function addUrlToLocalAssetLibrary(deps, url, name=''){
    return addUrlItemsToLocalAssetLibrary(deps, [{url, name:name || deps.smartImageNameFromUrl(url)}]);
}

async function deleteLocalAssetFromPanel(deps, itemId){
    const item = (deps.activeAssetCategory()?.items || []).find(x => x.id === itemId)
        || (deps.localAssetLibrary.items || []).find(x => x.id === itemId || x.file === itemId);
    if(!item) return;
    try {
        const data = await deps.fetch('/api/local-assets/delete', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({names:[item.file || item.id]})
        }).then(async r => {
            if(!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || '删除失败');
            return r.json();
        });
        const localData = await deps.fetch('/api/local-assets').then(r => r.ok ? r.json() : {items:[], tree:null});
        setLocalAssetLibraryFromResponse(deps, localData);
        deps.renderAssetLibrary();
        deps.toast(data.skipped_referenced?.length ? deps.tr('smart.localAssetDeleteKept')
            : data.deleted?.length ? deps.tr('smart.localAssetDeleted') : deps.tr('smart.localAssetDeleteMissing'));
    } catch(err){
        deps.toast(err.message || '删除失败');
    }
}

function setAssetDragOver(deps, active){
    if(!deps.assetDropZone || !deps.assetPanel) return;
    deps.assetDropZone.classList.toggle('drag-over', !!active);
    deps.assetPanel.classList.toggle('drag-over', !!active);
}

function handleAssetPanelDragOver(deps, e){
    if(deps.hasCanvasImageDrag(e) || deps.hasSmartImageDropData(e.dataTransfer)){
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        setAssetDragOver(deps, true);
    }
}

async function handleAssetPanelDrop(deps, e){
    if(!deps.hasCanvasImageDrag(e) && !deps.hasSmartImageDropData(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    setAssetDragOver(deps, false);
    const raw = e.dataTransfer.getData('application/x-smart-canvas-image');
    if(raw){
        try {
            const payload = JSON.parse(raw);
            if(payload?.url) await addUrlToAssetLibrary(deps, payload.url, payload.name || '');
            return;
        } catch(e) {
            deps.toast(deps.tr('smart.assetAddFail'));
            return;
        }
    }
    try {
        const payload = await deps.resolveSmartImageDropPayload(e.dataTransfer);
        if(payload.type === 'files') {
            if(deps.assetLibraryIsLocal()) await addFilesToLocalAssetLibrary(deps, payload.files);
            else {
                const uploaded = await deps.uploadFiles(payload.files);
                for(const file of uploaded) if(file?.url) await addUrlToAssetLibrary(deps, file.url, file.name || '');
            }
        } else if(payload.type === 'localPaths') {
            if(deps.assetLibraryIsLocal()) await addLocalPathsToLocalAssetLibrary(deps, payload.localPaths);
            else {
                const imported = await deps.importSmartLocalImages(payload.localPaths);
                for(const file of imported) if(file?.url) await addUrlToAssetLibrary(deps, file.url, file.name || '');
            }
        } else if(payload.type === 'url') {
            await addUrlToAssetLibrary(deps, payload.url, deps.smartImageNameFromUrl(payload.url));
        }
    } catch(err) {
        deps.toast(err.message || deps.tr('smart.assetAddFail'));
    }
}

    const api={addUrlToAssetLibrary, localAssetFolderPath, setLocalAssetLibraryFromResponse, addFilesToLocalAssetLibrary, addLocalPathsToLocalAssetLibrary, addUrlItemsToLocalAssetLibrary, addUrlToLocalAssetLibrary, deleteLocalAssetFromPanel, setAssetDragOver, handleAssetPanelDragOver, handleAssetPanelDrop};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.SmartAssetImport=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
