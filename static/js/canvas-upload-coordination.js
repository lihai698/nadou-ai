/* Canvas media drop and upload coordination: canvas-upload-coordination. Host supplies live state and effects. */
(function(root){
    'use strict';

async function importLocalImages(deps, paths){
    if(!paths?.length) return [];
    const response = await deps.fetch('/api/ai/import-local-image', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({paths})
    });
    if(!response.ok) throw new Error(await deps.responseErrorMessage(response, deps.langIsEn() ? 'Local image import failed' : '导入本地图片失败'));
    const data = await response.json();
    return data.files || [];
}

function layoutUploadedMediaNodes(deps, created, base){
    const list = [...(created || [])];
    if(!list.length) return;
    const cols = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(list.length))));
    const gapX = 280;
    const gapY = 250;
    const startX = base.x - ((cols - 1) * gapX) / 2;
    list.forEach((node, i) => {
        node.x = startX + (i % cols) * gapX;
        node.y = base.y + Math.floor(i / cols) * gapY;
    });
}

function createGroupForUploadedNodes(deps, created, point){
    const targets = [...(created || [])].filter(n => ['image','audio'].includes(n?.type));
    if(targets.length < 2) return null;
    deps.render();
    const box = deps.nodeBounds(targets.map(n => n.id));
    const fallback = point || deps.defaultPoint(0, 0);
    const group = {
        id:deps.uid('grp'),
        type:'group',
        x:Number.isFinite(box.x) ? box.x - 24 : fallback.x - 24,
        y:Number.isFinite(box.y) ? box.y - 58 : fallback.y - 58,
        w:Number.isFinite(box.w) ? box.w + 48 : 600,
        h:Number.isFinite(box.h) ? box.h + 90 : 420,
        items:targets.map(n => n.id)
    };
    deps.nodes.push(group);
    deps.selected.clear();
    deps.selected.add(group.id);
    return group;
}

async function uploadMediaFiles(deps, files, point, onlyImages=false, opts={}){
    if(!deps.ensureCanvas()) return;
    const isCurrent=deps.captureMediaInputContext();
    const supported = [...files].filter(file => {
        const kind = deps.mediaKindForUpload(file);
        return onlyImages ? kind === 'image' : ['image','video','audio'].includes(kind);
    }).slice(0, deps.CANVAS_UPLOAD_MAX);
    if(!supported.length) return [];
    const totalBytes = supported.reduce((sum, file) => sum + Number(file.size || 0), 0);
    const oversized = supported.find(file => Number(file.size || 0) > deps.CANVAS_UPLOAD_MAX_FILE_BYTES);
    if(oversized) throw new Error(deps.langIsEn() ? `${oversized.name || 'File'} exceeds 100MB` : `${oversized.name || '文件'}超过 100MB，无法上传`);
    if(totalBytes > deps.CANVAS_UPLOAD_MAX_BATCH_BYTES) throw new Error(deps.langIsEn() ? 'This upload exceeds the 500MB batch limit' : '本次上传总大小超过 500MB');
    const form = new FormData();
    supported.forEach(file => form.append('files', file));
    const response = await deps.fetch('/api/ai/upload', {method:'POST', body:form});
    const data = await response.json().catch(() => ({}));
    if(!isCurrent())return [];
    if(!response.ok) throw new Error(data.detail || (deps.langIsEn() ? 'Upload failed' : '上传失败'));
    if(!Array.isArray(data.files) || data.files.length !== supported.length || data.files.some(file => !file?.url)){
        throw new Error(deps.langIsEn() ? 'Upload was incomplete. Please try again.' : '上传不完整，请重试');
    }
    const base = point || deps.screenToWorld(deps.window.innerWidth / 2, deps.window.innerHeight / 2);
    const created = [];
    (data.files || []).forEach((file, i) => {
        const kind = file.kind || deps.mediaKindForUpload(supported[i]);
        const node = {
            id:deps.uid('img'),
            type:'image',
            x:base.x + i * 36,
            y:base.y + i * 36,
            url:file.url,
            name:file.name,
            mediaKind:kind, mime:supported[i]?.type || '',sizeBytes:supported[i]?.size || 0
        };
        deps.window.CanvasAudio.migrate(node);
        deps.nodes.push(node);
        created.push(node);
    });
    if(opts.group && created.length > 1){
        layoutUploadedMediaNodes(deps, created, base);
        created.group = createGroupForUploadedNodes(deps, created, base);
    }
    deps.render();
    deps.scheduleSave();
    return created;
}

async function uploadImages(deps, files, point){
    return uploadMediaFiles(deps, files, point, false);
}

async function uploadImageGroup(deps, files, point){
    return uploadMediaFiles(deps, files, point, false, {group:true});
}

function createImageCardFromUrl(deps, url, point, name='image', kind=''){
    if(!deps.ensureCanvas() || !url) return;
    const p = point || deps.defaultPoint(0, 0);
    const mediaKind = ['image','video','audio'].includes(kind) ? kind : deps.isVideoUrl(url) ? 'video' : deps.isAudioUrl(url) ? 'audio' : 'image';
    deps.nodes.push({id:deps.uid('img'), type:'image', x:p.x, y:p.y, url, name:name || deps.outputImageName(url), mediaKind});
    deps.window.CanvasAudio.migrate(deps.nodes[deps.nodes.length-1]);
    deps.render();
    deps.scheduleSave();
}

async function createImageCardsFromLocalPaths(deps, paths, point){
    if(!deps.ensureCanvas()) return [];
    const isCurrent=deps.captureMediaInputContext();
    deps.setStatus(deps.langIsEn() ? 'Importing images...' : '导入图片...');
    try {
        const files = await importLocalImages(deps, (paths || []).slice(0, deps.CANVAS_UPLOAD_MAX));
        if(!isCurrent())return [];
        const base = point || deps.screenToWorld(deps.window.innerWidth / 2, deps.window.innerHeight / 2);
        const created = [];
        files.forEach((file, i) => {
            const node = {id:deps.uid('img'), type:'image', x:base.x + i * 36, y:base.y + i * 36, url:file.url, name:file.name, mediaKind:'image'};
            deps.nodes.push(node);
            created.push(node);
        });
        deps.render();
        deps.scheduleSave();
        deps.setStatus('Ready');
        return created;
    } catch(err) {
        if(!isCurrent())return [];
        deps.setStatus('Ready');
        throw err;
    }
}

async function applyImageDropPayloadToBoard(deps, payload, point){
    if(payload.type === 'files'){
        if(payload.files.length > 1) return uploadImageGroup(deps, payload.files, point);
        return uploadImages(deps, payload.files, point);
    }
    if(payload.type === 'localPaths') return createImageCardsFromLocalPaths(deps, payload.localPaths, point);
    if(payload.type === 'url') {
        createImageCardFromUrl(deps, payload.url, point, deps.outputImageName(payload.url));
        return [];
    }
    return [];
}

async function applyImageDropPayloadToNode(deps, nodeId, payload){
    const node = deps.nodes.find(n => n.id === nodeId);
    if(!node || !['image','audio'].includes(node.type)) return;
    const isCurrent=deps.captureMediaInputContext();
    if(node.type==='audio' && payload.type==='files' && payload.files.some(file=>deps.mediaKindForUpload(file)!=='audio'))throw new Error('音频素材节点只能替换为音频文件');
    if(payload.type === 'files') {
        await fillImageNode(deps, nodeId, payload.files, {group:payload.files.length > 1});
        return;
    }
    if(payload.type === 'localPaths') {
        const files = await importLocalImages(deps, (payload.localPaths || []).slice(0, deps.CANVAS_UPLOAD_MAX));
        if(!isCurrent()||!deps.nodes.includes(node))return;
        const file = files[0];
        if(file?.url) {
            deps.pushUndo();
            node.url = file.url;
            node.name = file.name || deps.outputImageName(file.url);
            node.mediaKind = 'image';
            deps.render();
            deps.scheduleSave();
        }
        return;
    }
    if(payload.type === 'url' && payload.url){
        deps.pushUndo();
        node.url = payload.url;
        node.name = deps.outputImageName(payload.url);
        node.mediaKind = deps.isVideoUrl(payload.url) ? 'video' : deps.isAudioUrl(payload.url) ? 'audio' : 'image';
        if(node.type==='audio' && node.mediaKind!=='audio')node.type='image';
        deps.window.CanvasAudio.migrate(node);
        deps.render();
        deps.scheduleSave();
    }
}

function allowImageNodeDropEvent(deps, e, highlightEl){
    if(deps.hasImageDropData(e.dataTransfer) || deps.hasOutputImageDrag(e.dataTransfer) || Array.from(e.dataTransfer?.types || []).includes('application/x-canvas-asset')){
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        highlightEl?.classList.add('drag-over');
        deps.dropOverlay.classList.remove('active');
    }
}

function clearImageNodeDropState(deps, e, highlightEl){
    e.preventDefault();
    e.stopPropagation();
    highlightEl?.classList.remove('drag-over');
    deps.dropOverlay.classList.remove('active');
}

async function handleImageNodeDropEvent(deps, e, nodeId, highlightEl){
    const isCurrent=deps.captureMediaInputContext();
    if(deps.hasOutputImageDrag(e.dataTransfer)){
        clearImageNodeDropState(deps, e, highlightEl);
        setImageNodeFromOutput(deps, nodeId, e.dataTransfer.getData('application/x-canvas-output-image'));
        return;
    }
    const payload = await deps.resolveImageDropPayload(e.dataTransfer);
    if(!isCurrent()){
        highlightEl?.classList.remove('drag-over');
        return;
    }
    clearImageNodeDropState(deps, e, highlightEl);
    if(payload.type === 'none') return;
    try {
        await applyImageDropPayloadToNode(deps, nodeId, payload);
    } catch(err) {
        if(!isCurrent())return;
        deps.setStatus('Ready');
        deps.showErrorModal(err.message || (deps.langIsEn() ? 'Image import failed' : '导入图片失败'), deps.langIsEn() ? 'Image import failed' : '导入图片失败');
    }
}

async function fillImageNode(deps, nodeId, files, opts={}){
    if(!deps.ensureCanvas()) return;
    const isCurrent=deps.captureMediaInputContext();
    if(deps.nodes.find(node => node.id === nodeId)?.type === 'audio' && [...files].some(file => deps.mediaKindForUpload(file) !== 'audio')){
        throw new Error('音频素材节点只能替换为音频文件');
    }
    const imgs = [...files].filter(file => ['image','video','audio'].includes(deps.mediaKindForUpload(file))).slice(0, deps.CANVAS_UPLOAD_MAX);
    if(!imgs.length) return;
    if(opts.group && imgs.length > 1){
        const source = deps.nodes.find(n => n.id === nodeId);
        deps.pushUndo();
        const point = source ? {x:Number(source.x || 0), y:Number(source.y || 0)} : deps.defaultPoint(0, 0);
        const outgoing = deps.connections.filter(c => c.from === source?.id).map(c => c.to);
        const incoming = deps.connections.filter(c => c.to === source?.id).map(c => c.from);
        const created = await uploadImageGroup(deps, imgs, point);
        if(!isCurrent())return;
        const group = created?.group;
        if(source && created?.length > 1){
            deps.nodes = deps.nodes.filter(n => n.id !== source.id);
            deps.connections = deps.connections.filter(c => c.from !== source.id && c.to !== source.id);
            if(group){
                outgoing.forEach(toId => {
                    if(deps.canConnect(group.id, toId) && !deps.connections.some(c => c.from === group.id && c.to === toId)){
                        deps.connections.push({id:deps.uid('c'), from:group.id, to:toId});
                    }
                });
                incoming.forEach(fromId => {
                    if(deps.canConnect(fromId, group.id) && !deps.connections.some(c => c.from === fromId && c.to === group.id)){
                        deps.connections.push({id:deps.uid('c'), from:fromId, to:group.id});
                    }
                });
            }
            deps.selected.delete(source.id);
            deps.render();
            deps.scheduleSave();
        }
        return;
    }
    const form = new FormData();
    form.append('files', imgs[0]);
    const response = await deps.fetch('/api/ai/upload', {method:'POST', body:form});
    const data = await response.json().catch(() => ({}));
    if(!isCurrent())return;
    if(!response.ok) throw new Error(data.detail || '上传失败');
    const file = data.files?.[0];
    if(!file?.url) throw new Error('上传失败，请重试');
    const node = deps.nodes.find(n => n.id === nodeId);
    if(file && node){
        node.url = file.url;
        node.name = file.name;
        node.mediaKind = file.kind || deps.mediaKindForUpload(imgs[0]);
        node.mime=imgs[0].type;node.sizeBytes=imgs[0].size;
        if(node.type==='audio' && node.mediaKind!=='audio')node.type='image';
        deps.window.CanvasAudio.migrate(node);
        deps.render();
        deps.scheduleSave();
    }
}

function setImageNodeFromOutput(deps, nodeId, url){
    const node = deps.nodes.find(n => n.id === nodeId);
    if(!node || !['image','audio'].includes(node.type) || !url || deps.isVideoUrl(url)) return;
    deps.pushUndo();
    node.url = url;
    node.name = deps.outputImageName(url);
    node.mediaKind=deps.isAudioUrl(url)?'audio':'image';node.type=node.mediaKind==='audio'?'audio':'image';
    deps.render();
    deps.scheduleSave();
}

function clearImageNode(deps, nodeId, event=null){
    if(event){
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
    }
    const node = deps.nodes.find(n => n.id === nodeId);
    if(!node || node.type !== 'image') return;
    deps.pushUndo();
    node.url = '';
    node.mediaKind = 'image';
    node.name = '空白图片';
    deps.render();
    deps.scheduleSave();
}

function pickImageForNode(deps, nodeId){
    deps.pickMediaForNode(nodeId);
}

function pickMediaForNode(deps, nodeId){
    const isCurrent=deps.captureMediaInputContext();
    const audioOnly = deps.nodes.find(node => node.id === nodeId)?.type === 'audio';
    const input = deps.document.createElement('input');
    input.type = 'file';
    input.accept = audioOnly ? 'audio/*' : 'image/*,video/*,audio/*';
    input.multiple = !audioOnly;
    input.onchange = async () => {
        input.onchange=null;
        if(!isCurrent()||!input.files?.length) return;
        try { await deps.fillImageNode(nodeId, input.files, {group:input.files.length > 1}); }
        catch(error) { if(isCurrent())deps.showErrorModal(error.message || '上传失败', audioOnly ? '音频素材' : '素材上传'); }
    };
    input.click();
}

    const api={pickMediaForNode, importLocalImages, layoutUploadedMediaNodes, createGroupForUploadedNodes, uploadMediaFiles, uploadImages, uploadImageGroup, createImageCardFromUrl, createImageCardsFromLocalPaths, applyImageDropPayloadToBoard, applyImageDropPayloadToNode, allowImageNodeDropEvent, clearImageNodeDropState, handleImageNodeDropEvent, fillImageNode, setImageNodeFromOutput, clearImageNode, pickImageForNode};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.CanvasUploadCoordination=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
