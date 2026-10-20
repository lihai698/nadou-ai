/* Canvas media drop and upload coordination: canvas-media-drop. Host supplies live state and effects. */
(function(root){
    'use strict';

function mediaKindForUpload(deps, file){
    const type = String(file?.type || '').toLowerCase();
    const name = String(file?.name || '').toLowerCase();
    if(type.startsWith('video/') || /\.(mp4|webm|mov|m4v|avi|mkv)(\?|$)/.test(name)) return 'video';
    if(type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|flac)(\?|$)/.test(name)) return 'audio';
    return 'image';
}

function isSupportedUploadFile(deps, file){
    const type = String(file?.type || '').toLowerCase();
    const name = String(file?.name || '').toLowerCase();
    return type.startsWith('image/') || type.startsWith('video/') || type.startsWith('audio/')
        || /\.(png|jpe?g|webp|gif|bmp|avif|mp4|webm|mov|m4v|avi|mkv|mp3|wav|m4a|aac|ogg|flac)(\?|$)/.test(name);
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

function dropDataTypes(deps, dataTransfer){
    return [...(dataTransfer?.types || [])].map(type => String(type || ''));
}

function readDropData(deps, dataTransfer, type){
    try { return dataTransfer?.getData?.(type) || ''; } catch(_) { return ''; }
}

function decodeDropText(deps, value){
    const text = String(value || '').trim();
    if(!text) return '';
    try { return decodeURIComponent(text); } catch(_) { return text; }
}

function imageDropTextFragments(deps, value){
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

function uniqueValues(deps, values){
    const seen = new Set();
    return values.filter(value => {
        const key = String(value || '').trim();
        if(!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function dropTextCandidates(deps, dataTransfer){
    if(!dataTransfer) return [];
    const types = uniqueValues(deps, [...deps.IMAGE_DROP_TEXT_TYPES, ...dropDataTypes(deps, dataTransfer)]);
    const values = types.map(type => readDropData(deps, dataTransfer, type)).filter(Boolean);
    return uniqueValues(deps, values.flatMap((...args)=>imageDropTextFragments(deps, ...args)).map((...args)=>decodeDropText(deps, ...args)))
        .filter(s => s && !s.startsWith('#'));
}

function isRemoteImageDropValue(deps, value){
    const text = String(value || '').trim();
    return /^https?:\/\/.+/i.test(text) || /^data:image\//i.test(text) || /^blob:/i.test(text);
}

function isLocalImageDropValue(deps, value){
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
    return (isWindowsPath || isPosixPath) && deps.IMAGE_DROP_EXT_RE.test(clean);
}

function imageFilesFromDataTransfer(deps, dataTransfer){
    return [...(dataTransfer?.files || [])].filter((...args)=>isSupportedUploadFile(deps, ...args));
}

function localImagePathsFromDataTransfer(deps, dataTransfer){
    return uniqueValues(deps, dropTextCandidates(deps, dataTransfer).filter((...args)=>isLocalImageDropValue(deps, ...args)));
}

function imageUrlFromDataTransfer(deps, dataTransfer){
    return dropTextCandidates(deps, dataTransfer).find((...args)=>isRemoteImageDropValue(deps, ...args)) || '';
}

function imageDropPayload(deps, dataTransfer){
    const files = imageFilesFromDataTransfer(deps, dataTransfer);
    if(files.length) return {type:'files', files};
    const localPaths = localImagePathsFromDataTransfer(deps, dataTransfer);
    if(localPaths.length) return {type:'localPaths', localPaths};
    const url = imageUrlFromDataTransfer(deps, dataTransfer);
    if(url) return {type:'url', url};
    return {type:'none'};
}

async function resolveImageDropPayload(deps, dataTransfer){
    const payload = imageDropPayload(deps, dataTransfer);
    if(payload.type !== 'none') return payload;
    if(deps.hasImageFiles(dataTransfer?.items)){
        const files = await uploadFilesFromDataTransfer(deps, dataTransfer);
        if(files.length) return {type:'files', files};
    }
    return payload;
}

    const api={mediaKindForUpload, isSupportedUploadFile, dataTransferItemEntry, filesFromEntry, uploadFilesFromDataTransfer, dropDataTypes, readDropData, decodeDropText, imageDropTextFragments, uniqueValues, dropTextCandidates, isRemoteImageDropValue, isLocalImageDropValue, imageFilesFromDataTransfer, localImagePathsFromDataTransfer, imageUrlFromDataTransfer, imageDropPayload, resolveImageDropPayload};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.CanvasMediaDrop=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
