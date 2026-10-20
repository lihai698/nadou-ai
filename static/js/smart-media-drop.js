/* Canvas media drop and upload coordination: smart-media-drop. Host supplies live state and effects. */
(function(root){
    'use strict';

function isSupportedUploadFile(deps, file){
    const type = String(file?.type || '').toLowerCase();
    const name = String(file?.name || '').toLowerCase();
    return type.startsWith('image/') || type.startsWith('video/') || type.startsWith('audio/')
        || /\.(png|jpe?g|webp|gif|mp4|webm|mov|m4v|mp3|wav|m4a|aac|ogg|flac)(\?|$)/.test(name);
}

function dataTransferItemEntry(deps, item){
    try { return item?.webkitGetAsEntry?.() || null; } catch { return null; }
}

async function filesFromEntry(deps, entry){
    if(!entry) return [];
    if(entry.isFile){
        return new Promise(resolve => entry.file(file => resolve(file ? [file] : []), () => resolve([])));
    }
    if(!entry.isDirectory) return [];
    const reader = entry.createReader();
    const children = [];
    while(true){
        const batch = await new Promise(resolve => reader.readEntries(resolve, () => resolve([])));
        if(!batch.length) break;
        children.push(...batch);
    }
    const nested = await Promise.all(children.map((...args)=>filesFromEntry(deps, ...args)));
    return nested.flat();
}

async function uploadFilesFromDataTransfer(deps, dataTransfer){
    const items = [...(dataTransfer?.items || [])];
    const entries = items.map((...args)=>dataTransferItemEntry(deps, ...args)).filter(Boolean);
    const raw = entries.length
        ? (await Promise.all(entries.map((...args)=>filesFromEntry(deps, ...args)))).flat()
        : [...(dataTransfer?.files || [])];
    return raw.filter((...args)=>isSupportedUploadFile(deps, ...args));
}

function smartImageFilesFromDataTransfer(deps, dataTransfer){
    return [...(dataTransfer?.files || [])].filter((...args)=>isSupportedUploadFile(deps, ...args));
}

function smartDropDataTypes(deps, dataTransfer){
    return [...(dataTransfer?.types || [])].map(type => String(type || ''));
}

function readSmartDropData(deps, dataTransfer, type){
    try { return dataTransfer?.getData?.(type) || ''; } catch(_) { return ''; }
}

function decodeSmartDropText(deps, value){
    const text = String(value || '').trim();
    if(!text) return '';
    try { return decodeURIComponent(text); } catch(_) { return text; }
}

function smartDropTextFragments(deps, value){
    const text = String(value || '').trim();
    if(!text) return [];
    const fragments = [];
    if(/<img|<a\s/i.test(text)){
        const doc = new deps.DOMParser().parseFromString(text, 'text/html');
        doc.querySelectorAll('img[src],a[href]').forEach(el => fragments.push(el.getAttribute('src') || el.getAttribute('href') || ''));
    }
    text.split(/\r?\n/).forEach(line => {
        const item = line.trim();
        if(item) fragments.push(item);
    });
    const downloadUrl = text.match(/^image\/[^\s:]+:(.+)$/i);
    if(downloadUrl) fragments.push(downloadUrl[1]);
    return fragments;
}

function uniqueSmartDropValues(deps, values){
    const seen = new Set();
    return values.filter(value => {
        const key = String(value || '').trim();
        if(!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function smartDropTextCandidates(deps, dataTransfer){
    if(!dataTransfer) return [];
    const types = uniqueSmartDropValues(deps, [...deps.SMART_IMAGE_DROP_TEXT_TYPES, ...smartDropDataTypes(deps, dataTransfer)]);
    const values = types.map(type => readSmartDropData(deps, dataTransfer, type)).filter(Boolean);
    return uniqueSmartDropValues(deps, values.flatMap((...args)=>smartDropTextFragments(deps, ...args)).map((...args)=>decodeSmartDropText(deps, ...args)))
        .filter(s => s && !s.startsWith('#'));
}

function isRemoteSmartImageDropValue(deps, value){
    const text = String(value || '').trim();
    return /^https?:\/\/.+/i.test(text) || /^data:image\//i.test(text) || /^blob:/i.test(text);
}

function isLocalSmartImageDropValue(deps, value){
    const text = String(value || '').trim();
    if(!text) return false;
    let path = text;
    if(/^file:/i.test(path)){
        try {
            const url = new deps.URL(path);
            if(url.protocol !== 'file:') return false;
            path = decodeURIComponent(url.pathname || path);
        } catch(_) {
            return false;
        }
    }
    if(/^\/[a-zA-Z]:[\\/]/.test(path)) path = path.slice(1);
    const clean = path.split(/[?#]/, 1)[0];
    const isWindowsPath = /^[a-zA-Z]:[\\/]/.test(clean);
    const isPosixPath = clean.startsWith('/');
    return (isWindowsPath || isPosixPath) && deps.SMART_IMAGE_DROP_EXT_RE.test(clean);
}

function smartLocalImagePathsFromDataTransfer(deps, dataTransfer){
    return uniqueSmartDropValues(deps, smartDropTextCandidates(deps, dataTransfer).filter((...args)=>isLocalSmartImageDropValue(deps, ...args)));
}

function smartImageNameFromUrl(deps, url){
    try {
        const clean = String(url || '').split('?', 1)[0].split('#', 1)[0];
        return decodeURIComponent(clean.split('/').pop() || 'image');
    } catch(_) {
        return 'image';
    }
}

function smartImageDropPayload(deps, dataTransfer){
    const files = smartImageFilesFromDataTransfer(deps, dataTransfer);
    if(files.length) return {type:'files', files};
    const localPaths = smartLocalImagePathsFromDataTransfer(deps, dataTransfer);
    if(localPaths.length) return {type:'localPaths', localPaths};
    const url = smartDropTextCandidates(deps, dataTransfer).find((...args)=>isRemoteSmartImageDropValue(deps, ...args)) || '';
    if(url) return {type:'url', url};
    return {type:'none'};
}

async function resolveSmartImageDropPayload(deps, dataTransfer){
    const payload = smartImageDropPayload(deps, dataTransfer);
    if(payload.type !== 'none') return payload;
    const files = await uploadFilesFromDataTransfer(deps, dataTransfer);
    return files.length ? {type:'files', files} : payload;
}

function hasSmartImageDropData(deps, dataTransfer){
    if(!dataTransfer) return false;
    if(smartImageFilesFromDataTransfer(deps, dataTransfer).length) return true;
    const types = smartDropDataTypes(deps, dataTransfer);
    if(types.some(type => deps.SMART_IMAGE_DROP_TYPE_HINT_RE.test(type.toLowerCase()))) return true;
    return smartImageDropPayload(deps, dataTransfer).type !== 'none';
}

function hasSmartAssetDrag(deps, dataTransfer){
    return smartDropDataTypes(deps, dataTransfer).includes('application/x-smart-asset');
}

function hasMediaDrawerDrag(deps, dataTransfer){
    return smartDropDataTypes(deps, dataTransfer).includes('application/x-smart-asset');
}

function hasSmartInputThumbDrag(deps, dataTransfer){
    return smartDropDataTypes(deps, dataTransfer).includes('application/x-smart-input-thumb');
}

function setSmartDropCopyEffect(deps, e, includeAsset=false){
    e.preventDefault();
    if(hasSmartInputThumbDrag(deps, e.dataTransfer)) return;
    if(hasSmartImageDropData(deps, e.dataTransfer) || (includeAsset && hasSmartAssetDrag(deps, e.dataTransfer))){
        e.dataTransfer.dropEffect = 'copy';
    }
}

    const api={isSupportedUploadFile, dataTransferItemEntry, filesFromEntry, uploadFilesFromDataTransfer, smartImageFilesFromDataTransfer, smartDropDataTypes, readSmartDropData, decodeSmartDropText, smartDropTextFragments, uniqueSmartDropValues, smartDropTextCandidates, isRemoteSmartImageDropValue, isLocalSmartImageDropValue, smartLocalImagePathsFromDataTransfer, smartImageNameFromUrl, smartImageDropPayload, resolveSmartImageDropPayload, hasSmartImageDropData, hasSmartAssetDrag, hasMediaDrawerDrag, hasSmartInputThumbDrag, setSmartDropCopyEffect};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.SmartMediaDrop=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
