/* Classic keyboard shortcuts and focus lifecycle. */
(function(root){
'use strict';

function handleKeyDown(deps, e, queuePaste){
    if(deps.window.CanvasViewAdjust?.isOpen()) return;
    if(!deps.canvas) return;
    const key = String(e.key || '').toLowerCase();
    if(key === 'r' && !deps.isEditableTarget(e.target)) deps.isRKeyDown = true;
    if(e.key === 'Shift' && !e.altKey && !deps.isEditableTarget(deps.document.activeElement)) deps.setKnifeMode(true);
    if(e.key === 'Escape' && deps.document.getElementById('imageEditModal').classList.contains('open')) { deps.closeImageEditor(); return; }
    if(e.key === 'Escape' && deps.promptTemplateModal?.classList.contains('open')) { deps.closePromptTemplateModal(); return; }
    if(deps.outputLightbox.classList.contains('open') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')){
        if(deps.navigateOutputLightbox(e.key === 'ArrowRight' ? 1 : -1)){
            e.preventDefault();
            e.stopPropagation();
        }
        return;
    }
    if(e.key === 'Escape' && deps.outputLightbox.classList.contains('open')) { deps.closeOutputLightbox(); return; }
    if(!e.ctrlKey && !e.metaKey && !e.altKey && key === 'z' && !deps.isEditableTarget(e.target)
        && !deps.document.getElementById('imageEditModal')?.classList.contains('open')
        && !deps.promptTemplateModal?.classList.contains('open')
        && !deps.outputLightbox.classList.contains('open')
        && !deps.assetManagerModal?.classList.contains('open')
        && !deps.workflowTransferModal?.classList.contains('open')
        && !deps.logModal?.classList.contains('open')){
        if(e.repeat) return;
        e.preventDefault();
        deps.toggleZoomPreview();
        return;
    }
    if((e.ctrlKey || e.metaKey) && key === 'g') { e.preventDefault(); deps.groupSelectedImages(); }
    if((e.ctrlKey || e.metaKey) && key === 'c') {
        // 在输入框/可编辑元素里时，让浏览器原生 Ctrl+C 工作
        const tag = deps.document.activeElement?.tagName;
        if(tag === 'INPUT' || tag === 'TEXTAREA' || deps.document.activeElement?.isContentEditable) return;
        // 用户在页面任意位置选中了文本时，也不要拦截
        const sel = deps.window.getSelection && deps.window.getSelection();
        if(sel && sel.toString().length > 0) return;
        e.preventDefault();
        deps.copySelectedNodes();
    }
    if((e.ctrlKey || e.metaKey) && key === 'v') {
        const tag = deps.document.activeElement?.tagName;
        if(tag === 'INPUT' || tag === 'TEXTAREA' || deps.document.activeElement?.isContentEditable) return;
        if(deps.clipboardNodeCount()) {
            queuePaste();
        }
    }
    if((e.ctrlKey || e.metaKey) && key === 'z') {
        const tag = deps.document.activeElement?.tagName;
        if(tag === 'INPUT' || tag === 'TEXTAREA' || deps.document.activeElement?.isContentEditable) return;
        e.preventDefault(); deps.performUndo();
    }
    if(e.key === 'Delete' || e.key === 'Backspace') {
        const tag = deps.document.activeElement?.tagName;
        if(tag === 'INPUT' || tag === 'TEXTAREA' || deps.document.activeElement?.isContentEditable) return;
        if(deps.selected.size === 0) return;
        e.preventDefault();
        deps.deleteSelectedNodes();
    }
}

function handleKeyUp(deps, e){
    if(String(e.key || '').toLowerCase() === 'r') deps.isRKeyDown = false;
    if(e.key === 'Shift') deps.setKnifeMode(false);
}

function handleKeyBlur(deps){ deps.isRKeyDown = false; deps.setKnifeMode(false); }

function handleDragBlur(deps){
    if(deps.selectDrag){
        deps.selectionBox.style.display = 'none';
        deps.selectDrag = null;
        deps.document.body.classList.remove('canvas-selecting');
        deps.setCanvasMouseMove(null);
        deps.setCanvasMouseUp(null);
    }
    if(deps.dragNode || deps.resizeNode || deps.llmPaneDrag || deps.dragBoard || deps.minimapDrag || deps.knifeActive) deps.endDrag();
}

function create(host){
    const deps=host();
    let active=false,listening=false,disposed=false,generation=0;
    const pendingPaste=new Set();
    function cancelPendingPaste(){
        generation++;
        for(const timer of pendingPaste)deps.clearTimeout(timer);
        pendingPaste.clear();
    }
    function queuePaste(){
        const canvasId=deps.canvas?.id,openGeneration=deps.canvasOpenGeneration,epoch=generation,pasteRequestedAt=Date.now();
        const timer=deps.setTimeout(()=>{
            pendingPaste.delete(timer);
            if(!active||disposed||epoch!==generation||openGeneration!==deps.canvasOpenGeneration||!deps.canvas||deps.canvas.id!==canvasId)return;
            if(deps.lastImagePasteAt>=pasteRequestedAt)return;
            deps.pasteNodes();
        },90);
        pendingPaste.add(timer);
    }
    const handlers={keydown:event=>handleKeyDown(deps,event,queuePaste),keyup:event=>handleKeyUp(deps,event),keyblur:()=>{cancelPendingPaste();handleKeyBlur(deps);},dragblur:()=>handleDragBlur(deps)};
    function suspend(){
        cancelPendingPaste();
        if(!active)return;
        active=false;
        for(const [type,fn] of bindings)deps.window.removeEventListener(type,fn);
        handleKeyBlur(deps);
    }
    function mount(){
        if(active||disposed)return;
        active=true;
        if(!listening){deps.window.addEventListener('pagehide',suspend);deps.window.addEventListener('pageshow',mount);listening=true;}
        for(const [type,fn] of bindings)deps.window.addEventListener(type,fn);
    }
    function dispose(){
        try{suspend();}finally{
            if(listening){deps.window.removeEventListener('pagehide',suspend);deps.window.removeEventListener('pageshow',mount);}
            listening=false;disposed=true;
        }
    }
    const bindings=[['keydown',handlers.keydown],['keyup',handlers.keyup],['blur',handlers.keyblur],['blur',handlers.dragblur]];
    return {mount,suspend,dispose};
}
const api={create};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.CanvasKeyboardEvents=api;
})(typeof globalThis!=='undefined'?globalThis:window);
