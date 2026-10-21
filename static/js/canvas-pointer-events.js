/* Classic pointer event routing and lifecycle. State remains in the editor host. */
(function(root){
'use strict';

function handleMinimapMouseDown(deps, e){
    if(!deps.canvas || e.button !== 0) return;
    if(e.target.closest?.('#canvasArrangeBtn')) return;
    e.preventDefault();
    e.stopPropagation();
    deps.minimapDrag = true;
    deps.centerViewportOnWorldPoint(deps.minimapEventToWorld(e));
    deps.setCanvasMouseMove(e2 => {
        if(deps.minimapDrag) deps.centerViewportOnWorldPoint(deps.minimapEventToWorld(e2));
    });
    deps.setCanvasMouseUp(() => {
        deps.minimapDrag = false;
        deps.setCanvasMouseMove(null);
        deps.setCanvasMouseUp(null);
        deps.scheduleViewportSave();
    });
}

function handleArrangeMouseDown(deps, e){return e.stopPropagation();}

function handleArrangeClick(deps, e){
    e.preventDefault();
    e.stopPropagation();
    deps.arrangeSelectedCanvasNodes();
}

function handlePreviewMouseDown(deps, e){
    if(!deps.zoomPreviewState || e.button !== 0) return;
    if(deps.isZoomPreviewIgnoredTarget(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
}

function handlePreviewClick(deps, e){
    if(!deps.zoomPreviewState || e.button !== 0) return;
    if(deps.isZoomPreviewIgnoredTarget(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    const nodeEl = e.target.closest?.('.node');
    if(nodeEl?.dataset?.id) deps.exitZoomPreviewToNode(nodeEl.dataset.id);
    else deps.exitZoomPreview(deps.screenToWorld(e.clientX, e.clientY));
}

function handleBoardMouseDown(deps, e){
    if(!deps.canvas) return;
    if(e.button === 1){
        deps.startBoardPan(e);
        return;
    }
    if(e.button !== 0) return;
    if(deps.startKnifeDrag(e)) return;
    // Dismiss any open native select dropdown
    if(deps.document.activeElement && deps.document.activeElement !== deps.document.body) deps.document.activeElement.blur();
    if(e.target !== deps.board && e.target !== deps.world && e.target !== deps.nodesEl && e.target !== deps.linksEl) return;
    deps.closeCreateMenu();
    if(deps.isRKeyDown){
        e.preventDefault();
        deps.startSelection(e);
        return;
    }
    if(e.ctrlKey || e.metaKey){
        e.preventDefault();
        deps.startSelection(e);
        return;
    }
    deps.startBoardPan(e, {clearSelectionOnClick:true});
}

function handleBoardMouseMove(deps, e){
    const point = deps.screenToWorld(e.clientX, e.clientY);
    deps.lastMouseBoard = point;
    deps.updateConnectionHoverFromMouse(e);
    if(deps.canvas && deps.knifeActive && !deps.isEditableTarget(e.target) && !deps.dragNode && !deps.dragBoard && !deps.resizeNode && !deps.tempLink){
        deps.continueKnifeDrag(e);
    } else if(!e.shiftKey) {
        deps.setKnifeMode(false);
    }
}

function handleBoardMouseLeave(deps){return deps.setHoveredConnection('');}

function handleContextMenu(deps, e){
    if(!deps.canvas) return;
    if((e.ctrlKey || e.metaKey) || deps.isRKeyDown){
        e.preventDefault();
        e.stopPropagation();
        return;
    }
    if(e.target !== deps.board && e.target !== deps.world && e.target !== deps.nodesEl && e.target !== deps.linksEl) return;
    e.preventDefault();
    e.stopPropagation();
    deps.openCreateMenu(e.clientX, e.clientY);
}

function handleDismissMenuMouseDown(deps, e){
    if(e.target.closest?.('#createMenu, #linkCreateMenu, #nodeInputMenu, #nodeOutputMenu, #imageNodeMenu')) return;
    deps.closeCreateMenu();
}

function handleWheel(deps, e){
    if(!deps.canvas) return;
    if(e.target.closest?.('#createMenu')) return;
    e.preventDefault();
    const before = deps.screenToWorld(e.clientX, e.clientY);
    deps.viewport.scale = deps.viewport.scale * (e.deltaY > 0 ? .92 : 1.08);
    const rect = deps.board.getBoundingClientRect();
    deps.viewport.x = e.clientX - rect.left - before.x * deps.viewport.scale;
    deps.viewport.y = e.clientY - rect.top - before.y * deps.viewport.scale;
    deps.applyViewport();
    deps.renderLinks();
    deps.renderSelectionHub();
    deps.scheduleViewportSave();
}

function finishTransientInput(deps){
    const contentChanged=Boolean(deps.dragNode||deps.resizeNode||deps.llmPaneDrag||deps.knifeChanged);
    const viewportChanged=Boolean(deps.dragBoard||deps.minimapDrag);
    let finalized=false;
    deps.tempLink=null;
    try{
        if(contentChanged||viewportChanged){deps.endDrag();finalized=true;}
    }finally{
        deps.dragNode=null;deps.dragBoard=null;deps.resizeNode=null;deps.llmPaneDrag=null;deps.minimapDrag=false;
        deps.selectDrag=null;deps.knifeActive=false;deps.knifeChanged=false;deps.knifeNeedsRender=false;
        deps.knifePoint=null;deps.knifeTrail=[];deps.isRKeyDown=false;
        if(deps.selectionBox)deps.selectionBox.style.display='none';

        deps.document.body.classList.remove('canvas-knife','canvas-node-drag','canvas-node-resize','canvas-selecting','canvas-board-pan');
        if(contentChanged&&!finalized){deps.localCanvasDirty=true;deps.backupClassicDraft();}
        if(viewportChanged)deps.saveLocalViewport();
        if(deps.canvas)deps.renderLinks();
    }
}

function create(host){
    const deps=host();
    let releases=[],active=false,listening=false,disposed=false;
    const mouse={onmousemove:null,onmouseup:null};
    function setMouse(key,fn){
        if(fn==null){
            if(deps.window[key]===mouse[key])deps.window[key]=null;
            mouse[key]=null;
            return;
        }
        if(disposed)return;
        deps.window[key]=fn;mouse[key]=fn;
    }
    function releaseMouse(){setMouse('onmousemove',null);setMouse('onmouseup',null);}
    function listen(target,type,fn,options){
        target.addEventListener(type,fn,options);
        releases.push(()=>target.removeEventListener(type,fn,options));
    }
    function assign(target,key,fn){
        const previous=target[key];target[key]=fn;
        releases.push(()=>{if(target[key]===fn)target[key]=previous;});
    }
    function suspend(){
        if(!active&&!mouse.onmousemove&&!mouse.onmouseup)return;
        active=false;
        try{finishTransientInput(deps);}
        finally{releaseMouse();for(const release of releases.reverse())release();releases=[];}
    }
    function mount(){
        if(active||disposed)return;
        active=true;
        if(!listening){deps.window.addEventListener('pagehide',suspend);deps.window.addEventListener('pageshow',mount);listening=true;}
        listen(deps.window,'blur',releaseMouse);
        if(deps.minimap){listen(deps.minimap,'mousedown',event=>handleMinimapMouseDown(deps,event));}
        if(deps.canvasArrangeBtn){listen(deps.canvasArrangeBtn,'mousedown',event=>handleArrangeMouseDown(deps,event));}
        if(deps.canvasArrangeBtn){listen(deps.canvasArrangeBtn,'click',event=>handleArrangeClick(deps,event));}
        listen(deps.board,'mousedown',event=>handlePreviewMouseDown(deps,event), true);
        listen(deps.board,'click',event=>handlePreviewClick(deps,event), true);
        assign(deps.board,'onmousedown',event=>handleBoardMouseDown(deps,event));
        listen(deps.board,'mousemove',event=>handleBoardMouseMove(deps,event));
        listen(deps.board,'mouseleave',event=>handleBoardMouseLeave(deps,event));
        assign(deps.board,'oncontextmenu',event=>handleContextMenu(deps,event));
        listen(deps.board,'mousedown',event=>handleDismissMenuMouseDown(deps,event));
        assign(deps.board,'onwheel',event=>handleWheel(deps,event));
        if(deps.canvas)deps.renderSelectionHub();
    }
    function dispose(){
        try{suspend();}
        finally{
            if(listening){deps.window.removeEventListener('pagehide',suspend);deps.window.removeEventListener('pageshow',mount);}
            listening=false;disposed=true;
        }
    }
    return {mount,suspend,dispose,setMouseMove:fn=>setMouse('onmousemove',fn),setMouseUp:fn=>setMouse('onmouseup',fn)};
}
const api={create, handleMinimapMouseDown, handleArrangeMouseDown, handleArrangeClick, handlePreviewMouseDown, handlePreviewClick, handleBoardMouseDown, handleBoardMouseMove, handleBoardMouseLeave, handleContextMenu, handleDismissMenuMouseDown, handleWheel};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.CanvasPointerEvents=api;
})(typeof globalThis!=='undefined'?globalThis:window);
