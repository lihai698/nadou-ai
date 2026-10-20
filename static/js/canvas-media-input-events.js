/* Classic media input routing and asynchronous target lifetime. */
(function(root){
'use strict';

function handleDragOver(deps, e){
    if(e.target.closest?.('.image-node')){
        deps.dropOverlay.classList.remove('active');
        return;
    }
    if(deps.isCanvasInputDrag(e.dataTransfer)){
        deps.dropOverlay.classList.remove('active');
        return;
    }
    if(deps.hasImageDropData(e.dataTransfer) || deps.hasOutputImageDrag(e.dataTransfer)){
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        deps.dropOverlay.classList.add('active');
    }
}

function handleDragLeave(deps, e){
    if(e.target === deps.board || !deps.board.contains(e.relatedTarget)) deps.dropOverlay.classList.remove('active');
}

async function handleDrop(deps, e){
    const isCurrent=deps.captureMediaInputContext();
    e.preventDefault();
    deps.dropOverlay.classList.remove('active');
    if(e.target.closest?.('.image-node')) return;
    if(deps.hasOutputImageDrag(e.dataTransfer)) {
        deps.createImageCardFromOutput(e.dataTransfer.getData('application/x-canvas-output-image'), deps.screenToWorld(e.clientX, e.clientY));
        return;
    }
    if(Array.from(e.dataTransfer?.types || []).includes('application/x-canvas-asset')){
        try {
            const payload = JSON.parse(e.dataTransfer.getData('application/x-canvas-asset') || '{}');
            if(payload?.url) {
                if(String(payload.kind || '').toLowerCase() === 'workflow') await deps.importWorkflowAssetUrl(payload.url, payload.name || 'workflow');
                else deps.createImageCardFromUrl(payload.url, deps.screenToWorld(e.clientX, e.clientY), payload.name || 'asset');
            }
        } catch(err) {}
        return;
    }
    if(deps.isCanvasInputDrag(e.dataTransfer)) {
        deps.internalDrag = false;
        return;
    }
    const payload = await deps.resolveImageDropPayload(e.dataTransfer);
    if(!isCurrent())return;
    if(payload.type === 'none') return;
    try {
        await deps.applyImageDropPayloadToBoard(payload, deps.screenToWorld(e.clientX, e.clientY));
    } catch(err) {
        if(!isCurrent())return;
        deps.setStatus('Ready');
        deps.showErrorModal(err.message || (deps.langIsEn() ? 'Image import failed' : '导入图片失败'), deps.langIsEn() ? 'Image import failed' : '导入图片失败');
    }
}

function handleDragEnd(deps){return deps.dropOverlay.classList.remove('active');}

function handleWindowDrop(deps){return deps.dropOverlay.classList.remove('active');}

function handlePaste(deps, e){
    if(!deps.canvas) return;
    const files = [...(e.clipboardData?.items || [])].filter(x => x.kind === 'file' && /^(image|video|audio)\//.test(String(x.type || ''))).map(x => x.getAsFile());
    if(!files.length) return;
    e.preventDefault();
    deps.lastImagePasteAt = Date.now();
    const blank = [...deps.selected].map(id => deps.nodes.find(n => n.id === id)).find(n => n?.type === 'image' && !n.url);
    if(blank) deps.fillImageNode(blank.id, files);
    else if(files.length > 1) deps.uploadImageGroup(files);
    else deps.uploadImages(files);
}

function create(host){
    const deps=host();
    let active=false,listening=false,paused=false,disposed=false,epoch=0;
    const bindings=[['board','dragover',event=>handleDragOver(deps,event)],['board','dragleave',event=>handleDragLeave(deps,event)],['board','drop',event=>handleDrop(deps,event)],['window','dragend',event=>handleDragEnd(deps,event)],['window','drop',event=>handleWindowDrop(deps,event)],['window','paste',event=>handlePaste(deps,event)]];
    function capture(){
        const id=deps.canvas?.id,openGeneration=deps.canvasOpenGeneration,lifetime=epoch;
        return ()=>!disposed&&!paused&&lifetime===epoch&&Boolean(deps.canvas)&&deps.canvas.id===id&&deps.canvasOpenGeneration===openGeneration;
    }
    function suspend(){
        epoch++;paused=true;
        if(active){active=false;for(const [target,type,fn] of bindings)deps[target].removeEventListener(type,fn);}
        deps.dropOverlay.classList.remove('active');deps.internalDrag=false;
    }
    function mount(){
        if(active||disposed)return;
        active=true;paused=false;
        if(!listening){deps.window.addEventListener('pagehide',suspend);deps.window.addEventListener('pageshow',mount);listening=true;}
        for(const [target,type,fn] of bindings)deps[target].addEventListener(type,fn);
    }
    function dispose(){
        try{suspend();}finally{
            if(listening){deps.window.removeEventListener('pagehide',suspend);deps.window.removeEventListener('pageshow',mount);}
            listening=false;disposed=true;
        }
    }
    return {mount,suspend,dispose,capture};
}
const api={create};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.CanvasMediaInputEvents=api;
})(typeof globalThis!=='undefined'?globalThis:window);
