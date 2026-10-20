/* Asset panel responsibility: smart-asset-model. Host supplies live state and effects. */
(function(root){
    'use strict';

function assetCategories(deps, type='image'){
    const library = activeAssetLibrary(deps);
    return (library?.categories || deps.assetLibrary.categories || []).filter(cat => (cat.type || 'image') === type);
}

function assetSmartClassKey(deps, entry){
    if(!entry?.dimension || !entry?.tag) return '';
    return `${String(entry.dimension)}::${String(entry.tag)}`;
}

function assetSmartClassOptionId(deps, entry){
    const key = assetSmartClassKey(deps, entry);
    return key ? `${deps.ASSET_SMART_CATEGORY_PREFIX}${key}` : '';
}

function parseAssetSmartClassId(deps, id=''){
    const value = String(id || '');
    if(!value.startsWith(deps.ASSET_SMART_CATEGORY_PREFIX)) return null;
    const raw = value.slice(deps.ASSET_SMART_CATEGORY_PREFIX.length);
    const index = raw.indexOf('::');
    if(index < 0) return null;
    return {dimension:raw.slice(0, index), tag:raw.slice(index + 2)};
}

function assetSmartClassEntries(deps){
    const groups = new Map();
    assetCategories(deps, 'image').forEach(cat => {
        (cat.items || []).forEach(item => {
            const flat = Array.isArray(item?.classification?.flat) ? item.classification.flat : [];
            flat.forEach(entry => {
                const key = assetSmartClassKey(deps, entry);
                if(!key) return;
                const prev = groups.get(key) || {
                    id:assetSmartClassOptionId(deps, entry),
                    dimension:String(entry.dimension || ''),
                    label:String(entry.label || entry.dimension || '分类'),
                    tag:String(entry.tag || ''),
                    count:0
                };
                prev.count += 1;
                groups.set(key, prev);
            });
        });
    });
    return [...groups.values()].sort((a, b) => {
        if(a.label !== b.label) return a.label.localeCompare(b.label, 'zh-CN');
        return b.count - a.count || a.tag.localeCompare(b.tag, 'zh-CN');
    });
}

function itemsForAssetSmartClass(deps, optionId=''){
    const parsed = parseAssetSmartClassId(deps, optionId);
    if(!parsed) return [];
    return assetCategories(deps, 'image').flatMap(cat => cat.items || []).filter(item => {
        const flat = Array.isArray(item?.classification?.flat) ? item.classification.flat : [];
        return flat.some(entry => String(entry.dimension || '') === parsed.dimension && String(entry.tag || '') === parsed.tag);
    });
}

function workflowAssetCategories(deps){
    return assetCategories(deps, 'workflow');
}

function assetLibraries(deps){
    return Array.isArray(deps.assetLibrary.libraries) && deps.assetLibrary.libraries.length ? deps.assetLibrary.libraries : [{id:'default', name:'默认资产库', categories:deps.assetLibrary.categories || []}];
}

function localAssetFolderCategories(deps){
    const result = [];
    const walk = node => {
        if(!node) return;
        const isRoot = (node.id || node.path || '__root__') === '__root__';
        result.push({
            id: node.id || (node.path ? node.path : '__root__'),
            name: node.name || (node.path ? node.path.split('/').pop() : '全部上传'),
            type: 'image',
            items: (isRoot ? (deps.localAssetLibrary.items || []) : (node.items || [])).filter(item => deps.assetMediaKind(item) === 'image'),
            readonly: true,
            source: 'local',
        });
        (node.children || []).forEach(walk);
    };
    walk(deps.localAssetLibrary.tree || {id:'__root__', name:'全部上传', items:deps.localAssetLibrary.items || [], children:[]});
    return result;
}

function assetLibraryIsLocal(deps){
    return deps.activeAssetLibraryId === deps.LOCAL_ASSET_LIBRARY_ID;
}

function currentAssetSourceLibraries(deps){
    return [
        ...assetLibraries(deps),
        {id:deps.LOCAL_ASSET_LIBRARY_ID, name:'本地素材', categories:localAssetFolderCategories(deps), readonly:true, source:'local'}
    ];
}

function activeAssetLibrary(deps){
    if(assetLibraryIsLocal(deps)) return currentAssetSourceLibraries(deps).find(lib => lib.id === deps.LOCAL_ASSET_LIBRARY_ID);
    const libs = assetLibraries(deps);
    return libs.find(lib => lib.id === deps.activeAssetLibraryId) || libs[0] || null;
}

function activeAssetCategory(deps){
    const cats = assetCategories(deps, 'image');
    if(parseAssetSmartClassId(deps, deps.activeAssetCategoryId)) return null;
    if(!cats.length) return null;
    return cats.find(cat => cat.id === deps.activeAssetCategoryId) || cats[0];
}

function activeWorkflowAssetCategory(deps){
    const cats = workflowAssetCategories(deps);
    if(!cats.length) return null;
    return cats.find(cat => cat.id === deps.activeWorkflowAssetCategoryId) || cats[0];
}

function currentAssetTabIsWorkflow(deps){
    return deps.assetTab === 'workflow';
}

function currentAssetTabCategories(deps){
    return currentAssetTabIsWorkflow(deps) ? workflowAssetCategories(deps) : assetCategories(deps, 'image');
}

function activeAssetTabCategory(deps){
    return currentAssetTabIsWorkflow(deps) ? activeWorkflowAssetCategory(deps) : activeAssetCategory(deps);
}

function setActiveAssetTabCategory(deps, categoryId=''){
    if(currentAssetTabIsWorkflow(deps)) deps.activeWorkflowAssetCategoryId = categoryId || '';
    else deps.activeAssetCategoryId = categoryId || '';
}

async function loadAssetLibrary(deps){
    try {
        const [data, localData] = await Promise.all([
            deps.fetch('/api/asset-library').then(r => r.json()),
            deps.fetch('/api/local-assets').then(r => r.ok ? r.json() : {items:[], tree:null}).catch(() => ({items:[], tree:null}))
        ]);
        deps.localAssetLibrary = {items:Array.isArray(localData.items) ? localData.items : [], tree:localData.tree || null};
        setAssetLibraryFromResponse(deps, data, {render:false});
        deps.renderAssetLibrary();
    } catch(e) {
        deps.toast(deps.tr('smart.assetLoadFail'));
    }
}

function refreshAssetLibrarySoon(deps, delay=120){
    deps.clearTimeout(deps.assetLibraryRefreshTimer);
    deps.assetLibraryRefreshTimer = deps.setTimeout(async () => {
        await loadAssetLibrary(deps);
        if(deps.mentionPicker?.classList?.contains('open') && deps.mentionSource === 'asset') deps.renderMentionPicker('asset');
    }, delay);
}

function handleAssetLibraryUpdatedMessage(deps, data={}){
    const remoteUpdatedAt = Number(data.updated_at || 0);
    if(remoteUpdatedAt && remoteUpdatedAt <= Number(deps.assetLibraryUpdatedAt || 0)) return;
    refreshAssetLibrarySoon(deps);
}

function connectAssetLibrarySyncSocket(deps){
    if(deps.window.parent && deps.window.parent !== deps.window) return;
    const host = deps.window.location.host;
    if(!host) return;
    const protocol = deps.location.protocol === 'https:' ? 'wss' : 'ws';
    const clientId = deps.smartClientId;
    let socket;
    let retryTimer = null;
    const connect = () => {
        try {
            socket = new deps.WebSocket(`${protocol}://${host}/ws/stats?client_id=${clientId}`);
        } catch(e) {
            retryTimer = deps.setTimeout(connect, 3000);
            return;
        }
        socket.onmessage = event => {
            try {
                const data = JSON.parse(event.data);
                if(data?.type === 'asset_library_updated') handleAssetLibraryUpdatedMessage(deps, data);
                if(data?.type === 'canvas_updated') deps.handleCanvasUpdatedMessage(data);
            } catch(e) {}
        };
        socket.onclose = () => {
            retryTimer = deps.setTimeout(connect, 3000);
        };
        socket.onerror = () => {
            try { socket.close(); } catch(e) {}
        };
    };
    deps.window.addEventListener('beforeunload', () => {
        deps.clearTimeout(retryTimer);
        try { socket?.close(); } catch(e) {}
    });
    connect();
}

function setAssetLibraryFromResponse(deps, data, options={}){
    deps.assetLibrary = data.library || deps.assetLibrary;
    deps.assetLibraryUpdatedAt = Number(deps.assetLibrary.updated_at || deps.assetLibraryUpdatedAt || 0);
    const libs = assetLibraries(deps);
    if(!deps.activeAssetLibraryId) deps.activeAssetLibraryId = deps.assetLibrary.active_library_id || libs[0]?.id || '';
    if(deps.activeAssetLibraryId && deps.activeAssetLibraryId !== deps.LOCAL_ASSET_LIBRARY_ID && !libs.some(lib => lib.id === deps.activeAssetLibraryId)) deps.activeAssetLibraryId = libs[0]?.id || '';
    const cats = assetCategories(deps, 'image');
    if(deps.activeAssetCategoryId && !cats.some(cat => cat.id === deps.activeAssetCategoryId)) deps.activeAssetCategoryId = '';
    if(!deps.activeAssetCategoryId) deps.activeAssetCategoryId = activeAssetCategory(deps)?.id || '';
    const workflowCats = workflowAssetCategories(deps);
    if(deps.activeWorkflowAssetCategoryId && !workflowCats.some(cat => cat.id === deps.activeWorkflowAssetCategoryId)) deps.activeWorkflowAssetCategoryId = '';
    if(!deps.activeWorkflowAssetCategoryId) deps.activeWorkflowAssetCategoryId = activeWorkflowAssetCategory(deps)?.id || '';
    if(deps.mentionAssetCategoryId && !cats.some(cat => cat.id === deps.mentionAssetCategoryId)) deps.mentionAssetCategoryId = '';
    if(!deps.mentionAssetCategoryId) deps.mentionAssetCategoryId = deps.activeAssetCategoryId;
    if(options.render !== false) {
        deps.renderAssetLibrary();
        if(deps.mentionPicker?.classList?.contains('open') && deps.mentionSource === 'asset') deps.renderMentionPicker('asset');
    }
}

    const api={assetCategories, assetSmartClassKey, assetSmartClassOptionId, parseAssetSmartClassId, assetSmartClassEntries, itemsForAssetSmartClass, workflowAssetCategories, assetLibraries, localAssetFolderCategories, assetLibraryIsLocal, currentAssetSourceLibraries, activeAssetLibrary, activeAssetCategory, activeWorkflowAssetCategory, currentAssetTabIsWorkflow, currentAssetTabCategories, activeAssetTabCategory, setActiveAssetTabCategory, loadAssetLibrary, refreshAssetLibrarySoon, handleAssetLibraryUpdatedMessage, connectAssetLibrarySyncSocket, setAssetLibraryFromResponse};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.SmartAssetModel=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
