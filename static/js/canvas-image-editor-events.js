/* classic image editor events; state remains with the editor host. */
(function(root){'use strict';

function create(host){
    const deps=host(),releases=[],captures=new Map();let active=false,listening=false,disposed=false,paused=false,epoch=0;
    function capture(){const generation=epoch;return ()=>!disposed&&!paused&&generation===epoch;}
    function listen(target,type,fn,options,optional=false){
        if(!target&&optional)return;
        const handler=function(event){
            if(!active)return;
            try{return fn.call(this,event);}finally{
                if(type==='pointerdown'&&Number.isFinite(event.pointerId)){if(!captures.has(target))captures.set(target,new Set());captures.get(target).add(event.pointerId);}
                if(type==='pointerup'||type==='pointercancel'||type==='pointerleave')captures.get(target)?.delete(event.pointerId);
            }
        };
        target.addEventListener(type,handler,options);releases.push(()=>target.removeEventListener(type,handler,options));
    }
    function releaseCaptures(){for(const [target,ids]of captures)for(const id of ids)if(target.hasPointerCapture?.(id))target.releasePointerCapture(id);captures.clear();}
    function finishInput(){
        if(deps.editDrawState||deps.gridCustomDrag)deps.endEditDraw();
        if(deps.editTextDrag)deps.endEditText();
        deps.cropDrag=null;deps.document.getElementById('cropCanvas')?.classList.remove('dragging-image');
        releaseCaptures();
    }
    function suspend(){
        epoch++;paused=true;active=false;
        try{finishInput();if(deps.cropState)deps.closeImageEditor();}
        finally{releaseCaptures();for(const release of releases.splice(0).reverse())release();}
    }
    function mount(){
        if(active||disposed)return;active=true;paused=false;
        if(!listening){deps.window.addEventListener('pagehide',suspend);deps.window.addEventListener('pageshow',mount);listening=true;}
        listen(deps.window,'blur',finishInput);
        listen(deps.document.getElementById('cropBox'), 'mousedown', event => deps.beginCropDrag(event, deps.cropDragModeFromPointer(event)), undefined, false);
        deps.document.querySelectorAll('[data-crop-handle]').forEach(handle => {
            listen(handle, 'mousedown', event => deps.beginCropDrag(event, `crop-${handle.dataset.cropHandle || 'se'}`), undefined, false);
        });
        deps.document.querySelectorAll('[data-crop-ratio]').forEach(btn => {
            listen(btn, 'click', event => {
                event.stopPropagation();
                deps.setCropAspectPreset(btn.dataset.cropRatio || 'free');
            }, undefined, false);
        });
        listen(deps.document.getElementById('outpaintFrame'), 'mousedown', event => {
            if(event.target.closest('[data-outpaint-handle]')) return;
            deps.document.getElementById('cropCanvas')?.classList.add('dragging-image');
            deps.beginCropDrag(event, 'image');
        }, undefined, true);
        deps.document.querySelectorAll('[data-outpaint-handle]').forEach(handle => {
            listen(handle, 'mousedown', event => deps.beginCropDrag(event, `outpaint-${handle.dataset.outpaintHandle || 'corner'}`), undefined, false);
        });
        listen(deps.document.getElementById('cropImage'), 'mousedown', event => {
            if(deps.imageEditMode !== 'outpaint' || !deps.cropState) return;
            deps.document.getElementById('cropCanvas')?.classList.add('dragging-image');
            deps.beginCropDrag(event, 'image');
        }, undefined, true);
        deps.document.querySelectorAll('[data-image-edit-mode]').forEach(btn => {
            listen(btn, 'click', event => {
                event.stopPropagation();
                deps.setImageEditMode(btn.dataset.imageEditMode || 'crop', true);
            }, undefined, false);
        });
        listen(deps.document.getElementById('editDrawCanvas'), 'pointerdown', deps.beginEditDraw, undefined, false);
        listen(deps.document.getElementById('editDrawCanvas'), 'pointermove', deps.moveEditDraw, undefined, false);
        listen(deps.document.getElementById('editDrawCanvas'), 'pointerup', deps.endEditDraw, undefined, false);
        listen(deps.document.getElementById('editDrawCanvas'), 'pointercancel', deps.endEditDraw, undefined, false);
        listen(deps.document.getElementById('editDrawCanvas'), 'pointerleave', deps.endEditDraw, undefined, false);
        listen(deps.document.getElementById('editTextCanvas'), 'pointerdown', deps.beginEditText, undefined, true);
        listen(deps.document.getElementById('editTextCanvas'), 'pointermove', deps.moveEditText, undefined, true);
        listen(deps.document.getElementById('editTextCanvas'), 'pointerup', deps.endEditText, undefined, true);
        listen(deps.document.getElementById('editTextCanvas'), 'pointercancel', deps.endEditText, undefined, true);
        listen(deps.document.getElementById('editTextCanvas'), 'pointerleave', deps.endEditText, undefined, true);
        listen(deps.document.getElementById('editTextCanvas'), 'dblclick', event => {
            if(deps.imageEditMode !== 'brush' || deps.brushTool !== 'text') return;
            event.preventDefault();
            event.stopPropagation();
            const hit = deps.hitEditTextItem(deps.editTextPoint(event));
            if(hit){
                deps.setSelectedEditTextItem(hit.id);
                deps.beginEditTextInline(hit);
            }
        }, undefined, true);
        ['paintBrushSize','paintBrushColor'].forEach(id => {
            const control = deps.document.getElementById(id);
            if(!control) return;
            listen(control, 'input', deps.syncSelectedEditTextStyleFromBrush, undefined, false);
            listen(control, 'change', () => { deps.editTextDirty = false; }, undefined, false);
        });
        ['gridHorizontalLines','gridVerticalLines','gridGapSize'].forEach(id => {
            listen(deps.document.getElementById(id), 'input', () => {
                deps.syncGridGapValue();
                deps.refreshGridSplitPreview();
            }, undefined, false);
        });
        ['imageResizeScaleRange','imageResizeScaleInput'].forEach(id => {
            listen(deps.document.getElementById(id), 'input', event => deps.setImageResizeScale(event.target.value), undefined, true);
        });
        // 图片编辑区滚轮缩放
        listen(deps.document.getElementById('imageEditStage'), 'wheel', event => {
            if(!deps.cropState) return;
            event.preventDefault();
            event.stopPropagation();
            const stage = event.currentTarget;
            const oldZoom = deps.imageEditZoom;
            const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
            deps.imageEditZoom = Math.max(0.15, Math.min(6.0, deps.imageEditZoom * factor));
            // 焦点缩放：保持鼠标指向的图片位置不动
            const stageRect = stage.getBoundingClientRect();
            const mx = event.clientX - stageRect.left; // 鼠标在 stage 内偏移
            const my = event.clientY - stageRect.top;
            const contentX = stage.scrollLeft + mx;
            const contentY = stage.scrollTop + my;
            deps.applyImageEditZoom();
            const scale = deps.imageEditZoom / oldZoom;
            stage.scrollLeft = contentX * scale - mx;
            stage.scrollTop = contentY * scale - my;
        }, {passive: false}, false);
        listen(deps.window, 'resize', () => {
            if(deps.cropState) deps.syncImageEditOverflow();
        }, undefined, false);

        listen(deps.window, 'mousemove', event => {
            if(!deps.cropDrag || !deps.cropState) return;
            const dx = event.clientX - deps.cropDrag.sx;
            const dy = event.clientY - deps.cropDrag.sy;
            if(deps.cropDrag.mode === 'move'){
                deps.cropState.x = deps.cropDrag.start.x + dx;
                deps.cropState.y = deps.cropDrag.start.y + dy;
            } else if(deps.cropDrag.mode === 'image'){
                deps.cropState.x = deps.cropDrag.start.x + dx;
                deps.cropState.y = deps.cropDrag.start.y + dy;
            } else if(String(deps.cropDrag.mode || '').startsWith('outpaint-')){
                deps.resizeOutpaintFromDrag(dx, dy);
            } else {
                deps.resizeCropFromDrag(dx, dy);
            }
            deps.clampCrop();
            deps.renderCropBox();
        }, undefined, false);
        listen(deps.window, 'mouseup', () => { deps.cropDrag = null; deps.document.getElementById('cropCanvas')?.classList.remove('dragging-image'); }, undefined, false);

    }
    function dispose(){try{suspend();}finally{if(listening){deps.window.removeEventListener('pagehide',suspend);deps.window.removeEventListener('pageshow',mount);}listening=false;disposed=true;}}
    return {mount,suspend,dispose,capture};
}
const api={create};
if(typeof module!=='undefined'&&module.exports)module.exports=api;root.CanvasImageEditorEvents=api;
})(typeof globalThis!=='undefined'?globalThis:window);
