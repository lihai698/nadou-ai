/* Canvas media drop and upload coordination: smart-upload-coordination. Host supplies live state and effects. */
(function(root){
    'use strict';

function uploadTitleForItems(deps, items, fallback='Upload'){
    const list = [...(items || [])];
    if(!list.length) return fallback;
    const kinds = new Set(list.map(item => item instanceof deps.File ? deps.mediaKindForFile(item) : deps.mediaKindForItem(item)));
    if(kinds.size > 1) return list.length > 1 ? 'Media' : fallback;
    if(kinds.has('video')) return list.length > 1 ? 'Videos' : 'Video';
    if(kinds.has('audio')) return 'Audio';
    return list.length > 1 ? 'Group' : 'Image';
}

async function smartResponseErrorMessage(deps, response, fallback='请求失败'){
    try {
        const data = await response.clone().json();
        const detail = data.detail ?? data.error ?? data.message;
        if(typeof detail === 'string') return detail || fallback;
        if(Array.isArray(detail)) return detail.map(item => item?.msg || item?.message || String(item)).join('\n') || fallback;
    } catch(_) {}
    try {
        const text = await response.text();
        if(text) return text;
    } catch(_) {}
    return fallback;
}

async function uploadFiles(deps, files){
    const supported = [...(files || [])].filter(deps.isSupportedUploadFile).slice(0, deps.SMART_UPLOAD_MAX);
    if(!supported.length) return [];
    const totalBytes = supported.reduce((sum, file) => sum + Number(file.size || 0), 0);
    const oversized = supported.find(file => Number(file.size || 0) > deps.SMART_UPLOAD_MAX_FILE_BYTES);
    if(oversized) throw new Error(deps.window.StudioI18n?.lang?.() === 'en' ? `${oversized.name || 'File'} exceeds 100MB` : `${oversized.name || '文件'}超过 100MB，无法上传`);
    if(totalBytes > deps.SMART_UPLOAD_MAX_BATCH_BYTES) throw new Error(deps.window.StudioI18n?.lang?.() === 'en' ? 'This upload exceeds the 500MB batch limit' : '本次上传总大小超过 500MB');
    const form = new FormData();
    supported.forEach(file => form.append('files', file, file.name || 'media'));
    const data = await deps.fetch('/api/ai/upload', {method:'POST', body:form}).then(async r => {
        if(!r.ok) throw new Error(await smartResponseErrorMessage(deps, r, deps.tr('smart.toastUploadFail')));
        return r.json();
    });
    if(!Array.isArray(data.files) || data.files.length !== supported.length || data.files.some(file => !file?.url)){
        throw new Error(deps.tr('smart.toastUploadFail'));
    }
    return data.files.map((file, index) => ({
        ...file,
        kind:file.kind || deps.mediaKindForFile(supported[index])
    }));
}

function appendImagesToSmartNode(deps, uploaded, targetId='', opts={}){
    const images = [...(uploaded || [])].filter(file => file?.url);
    if(!images.length) return null;

    const targetGroup = deps.nodes.find(n => n.id === targetId && deps.isSmartGroupNode(n));
    let node = targetGroup ? null : (deps.nodes.find(n => n.id === targetId) || deps.selectedNode());
    if(node && !deps.isSmartImageNode(node)) node = null;
    if(opts.forceNew) node = null;
    if(!node){
        const groupRect = targetGroup ? deps.nodeRect(targetGroup) : null;
        const center = opts.point || (groupRect ? {x:groupRect.x + groupRect.width / 2, y:groupRect.y + groupRect.height / 2} : deps.viewportCenter());
        deps.undoSuppressed = true;
        node = deps.createImageNodeAt(center, []);
        deps.undoSuppressed = false;
    }
    // 上传只替换节点里的素材，保留上传前的显示尺寸和缩放比例。
    // 空节点没有显式 w/h，也要先记住它的默认尺寸，避免上传后按素材重新排版。
    const originalRect = deps.nodeRect(node);
    const originalScale = deps.nodeScale(node);
    node.images = [...(node.images || []), ...images.map(file => ({...file, kind:file.kind || deps.mediaKindForItem(file)}))];
    if(Number.isFinite(Number(originalRect.width)) && originalRect.width > 24) node.w = Math.round(originalRect.width);
    if(Number.isFinite(Number(originalRect.height)) && originalRect.height > 24) node.h = Math.round(originalRect.height);
    if(!Number.isFinite(Number(node.scale)) || Number(node.scale) <= 0) node.scale = originalScale;
    if(node.images.length > 1){
        node.title = uploadTitleForItems(deps, node.images, 'Group');
    }
    if(node.images.length === 1) node.title = uploadTitleForItems(deps, node.images, node.title || 'Image');
    if(targetGroup) deps.addNodeToSmartGroup(targetGroup, node);
    deps.selectedId = node.id;
    deps.render();
    deps.scheduleSave();
    return node;
}

function captureUploadTarget(deps, targetId, opts){
    const current=deps.captureMediaInputContext(),selected=deps.selectedNode();
    const id=targetId||(!opts.forceNew&&deps.isSmartImageNode(selected)?selected.id:'');
    return {id,options:{...opts,forceNew:opts.forceNew||!id},
        isCurrent:()=>current()&&(!id||deps.nodes.some(node=>node.id===id))};
}

async function handleFiles(deps, files, targetId='', opts={}){
    const target=captureUploadTarget(deps,targetId,opts);
    if(!target.isCurrent())return;
    try {
        const fileList = [...(files || [])].filter(deps.isSupportedUploadFile).slice(0, deps.SMART_UPLOAD_MAX);
        if(!fileList.length) return;
        const uploaded = await uploadFiles(deps, fileList);
        if(!target.isCurrent()||!uploaded.length) return;
        if(!opts.skipUndo) deps.pushUndo();
        appendImagesToSmartNode(deps, uploaded.map((file, index) => ({...file, kind:file.kind || deps.mediaKindForFile(fileList[index])})), target.id, target.options);
    } catch(e) { if(target.isCurrent())deps.toast(e.message || deps.tr('smart.toastUploadFail')); }
}

async function importSmartLocalImages(deps, paths){
    if(!paths?.length) return [];
    const response = await deps.fetch('/api/ai/import-local-image', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({paths:(paths || []).slice(0, deps.SMART_UPLOAD_MAX)})
    });
    if(!response.ok) throw new Error(await smartResponseErrorMessage(deps, response, deps.tr('smart.toastUploadFail')));
    const data = await response.json();
    return data.files || [];
}

async function handleSmartImageDropPayload(deps, payload, targetId='', opts={}){
    const target=captureUploadTarget(deps,targetId,opts);
    if(!target.isCurrent())return;
    try {
        if(payload.type === 'files') await handleFiles(deps, payload.files, targetId, opts);
        else if(payload.type === 'localPaths') {
            const uploaded=await importSmartLocalImages(deps,payload.localPaths);
            if(!target.isCurrent())return;
            if(!opts.skipUndo) deps.pushUndo();
            appendImagesToSmartNode(deps, uploaded, target.id, target.options);
        } else if(payload.type === 'url') {
            if(!opts.skipUndo) deps.pushUndo();
            appendImagesToSmartNode(deps, [{url:payload.url, name:deps.smartImageNameFromUrl(payload.url), kind:'image'}], targetId, opts);
        }
    } catch(e) {
        if(target.isCurrent())deps.toast(e.message || deps.tr('smart.toastUploadFail'));
    }
}

    const api={uploadTitleForItems, smartResponseErrorMessage, uploadFiles, appendImagesToSmartNode, handleFiles, importSmartLocalImages, handleSmartImageDropPayload};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.SmartUploadCoordination=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
