/* smart image editor events; state remains with the editor host. */
(function(root){'use strict';
function pointerMove(deps,e){
        if(deps.previewCompareDrag){
            e.preventDefault();
            deps.setPreviewComparePos(e.clientX);
            return true;
        }
        if(deps.panoramaState.drag){
            e.preventDefault();
            const dx = e.clientX - deps.panoramaState.drag.clientX;
            const dy = e.clientY - deps.panoramaState.drag.clientY;
            deps.panoramaState.yaw = deps.panoramaState.drag.yaw - dx * 0.18;
            deps.panoramaState.pitch = Math.max(-85, Math.min(85, deps.panoramaState.drag.pitch + dy * 0.18));
            deps.document.getElementById('previewStage')?.classList.add('panning');
            return true;
        }
        if(deps.previewPanDrag){
            const stage = deps.document.getElementById('previewStage');
            deps.previewPan = {
                x:deps.previewPanDrag.startX + (e.clientX - deps.previewPanDrag.clientX),
                y:deps.previewPanDrag.startY + (e.clientY - deps.previewPanDrag.clientY)
            };
            stage?.classList.add('panning');
            deps.applyPreviewTransform();
            return true;
        }
        if(deps.imageEditPanDrag){
            const stage = deps.document.getElementById('imageEditStage');
            if(stage){
                stage.scrollLeft = deps.imageEditPanDrag.scrollLeft - (e.clientX - deps.imageEditPanDrag.clientX);
                stage.scrollTop = deps.imageEditPanDrag.scrollTop - (e.clientY - deps.imageEditPanDrag.clientY);
            }
            return true;
        }
        if(deps.cropDrag && deps.cropState){
            const dx = e.clientX - deps.cropDrag.sx;
            const dy = e.clientY - deps.cropDrag.sy;
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
            return true;
        }
    return false;
}

function pointerUp(deps,e){
        if(deps.previewCompareDrag) deps.previewCompareDrag = false;
        if(deps.panoramaState.drag){
            deps.panoramaState.drag = null;
            deps.document.getElementById('previewStage')?.classList.remove('panning');
        }
        if(deps.previewPanDrag){
            deps.previewPanDrag = null;
            deps.document.getElementById('previewStage')?.classList.remove('panning');
        }
        if(deps.imageEditPanDrag) deps.imageEditPanDrag = null;
        if(deps.cropDrag){
            deps.document.getElementById('cropCanvas')?.classList.remove('dragging-image');
            deps.cropDrag = null;
        }
}

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
        if(deps.gridJoinDrag)deps.endGridJoinDrag();pointerUp(deps);
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
            deps.beginCropDrag(event, 'image');
        }, undefined, false);
        deps.document.querySelectorAll('[data-outpaint-handle]').forEach(handle => {
            listen(handle, 'mousedown', event => deps.beginCropDrag(event, `outpaint-${handle.dataset.outpaintHandle || 'corner'}`), undefined, false);
        });
        listen(deps.document.getElementById('cropImage'), 'mousedown', event => {
            if(deps.imageEditMode !== 'outpaint' || !deps.cropState) return;
            deps.document.getElementById('cropCanvas')?.classList.add('dragging-image');
            deps.beginCropDrag(event, 'image');
        }, undefined, false);
        deps.document.querySelectorAll('[data-image-edit-mode]').forEach(btn => {
            listen(btn, 'click', event => {
                event.stopPropagation();
                deps.setImageEditMode(btn.dataset.imageEditMode || 'crop', true);
            }, undefined, false);
        });
        listen(deps.imageEditModal, 'pointerdown', event => {
            event.stopPropagation();
        }, undefined, false);
        listen(deps.imageEditModal, 'mousedown', event => {
            event.stopPropagation();
        }, undefined, false);
        listen(deps.imageEditModal, 'mousemove', event => {
            if(deps.previewPanDrag || deps.previewCompareDrag || deps.panoramaState.drag || deps.imageEditPanDrag || deps.cropDrag) return;
            event.stopPropagation();
        }, undefined, false);
        listen(deps.imageEditModal, 'click', event => {
            event.stopPropagation();
            if(event.target === deps.imageEditModal) deps.closeImageEditor();
        }, undefined, false);
        listen(deps.imageEditModal, 'wheel', event => {
            event.stopPropagation();
        }, {passive:false}, false);
        listen(deps.document.getElementById('previewStage'), 'mousedown', event => {
            if(deps.imageEditMode !== 'preview' || event.button !== 0) return;
            if(event.target.closest('.preview-tools-overlay, .preview-download-overlay')) return;
            if(event.target.closest('.preview-compare-handle')) return;
            if(event.target.closest('video')) return;
            event.preventDefault();
            event.stopPropagation();
            if(deps.panoramaState.enabled){
                deps.panoramaState.drag = {
                    clientX:event.clientX,
                    clientY:event.clientY,
                    yaw:deps.panoramaState.yaw,
                    pitch:deps.panoramaState.pitch
                };
                deps.document.getElementById('previewStage')?.classList.add('panning');
                return;
            }
            deps.previewPanDrag = {clientX:event.clientX, clientY:event.clientY, startX:deps.previewPan.x, startY:deps.previewPan.y};
        }, undefined, false);
        listen(deps.document.getElementById('imageEditStage'), 'mousedown', event => {
            if(deps.imageEditMode === 'preview' || event.button !== 0) return;
            if(event.target.closest('.image-edit-actions, .preview-tools-overlay, .preview-download-overlay, .crop-box, .crop-handle')) return;
            if(event.target.closest('#editDrawCanvas, #editTextCanvas, .edit-text-inline') && deps.imageEditMode !== 'crop') return;
            const stage = event.currentTarget;
            if(stage.scrollWidth <= stage.clientWidth && stage.scrollHeight <= stage.clientHeight) return;
            event.preventDefault();
            event.stopPropagation();
            deps.imageEditPanDrag = {
                clientX:event.clientX,
                clientY:event.clientY,
                scrollLeft:stage.scrollLeft,
                scrollTop:stage.scrollTop
            };
        }, undefined, false);
        listen(deps.document.getElementById('previewCompareHandle'), 'mousedown', event => {
            if(deps.imageEditMode !== 'preview' || !deps.previewCompareOn || deps.previewCompareIndex < 0) return;
            event.preventDefault();
            event.stopPropagation();
            deps.previewPanDrag = null;
            deps.previewCompareDrag = true;
            deps.setPreviewComparePos(event.clientX);
        }, undefined, false);
        listen(deps.document.getElementById('previewCompareHandle'), 'pointerdown', event => {
            if(deps.imageEditMode !== 'preview' || !deps.previewCompareOn || deps.previewCompareIndex < 0) return;
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.setPointerCapture?.(event.pointerId);
            deps.previewPanDrag = null;
            deps.previewCompareDrag = true;
            deps.setPreviewComparePos(event.clientX);
        }, undefined, false);
        listen(deps.document.getElementById('previewCompareHandle'), 'pointermove', event => {
            if(!deps.previewCompareDrag) return;
            event.preventDefault();
            event.stopPropagation();
            deps.setPreviewComparePos(event.clientX);
        }, undefined, false);
        listen(deps.document.getElementById('previewCompareHandle'), 'pointerup', event => {
            if(deps.previewCompareDrag){
                event.preventDefault();
                event.stopPropagation();
            }
            deps.previewCompareDrag = false;
            event.currentTarget.releasePointerCapture?.(event.pointerId);
        }, undefined, false);
        listen(deps.document.getElementById('previewCompareHandle'), 'pointercancel', event => {
            deps.previewCompareDrag = false;
            event.currentTarget.releasePointerCapture?.(event.pointerId);
        }, undefined, false);
        listen(deps.document.getElementById('editDrawCanvas'), 'pointerdown', deps.beginEditDraw, undefined, false);
        listen(deps.document.getElementById('editDrawCanvas'), 'pointermove', deps.moveEditDraw, undefined, false);
        listen(deps.document.getElementById('editDrawCanvas'), 'pointerup', deps.endEditDraw, undefined, false);
        listen(deps.document.getElementById('editDrawCanvas'), 'pointercancel', deps.endEditDraw, undefined, false);
        listen(deps.document.getElementById('editDrawCanvas'), 'pointerleave', deps.endEditDraw, undefined, false);
        listen(deps.document.getElementById('gridJoinCanvas'), 'pointerdown', deps.beginGridJoinDrag, undefined, true);
        listen(deps.document.getElementById('gridJoinCanvas'), 'pointermove', deps.moveGridJoinDrag, undefined, true);
        listen(deps.document.getElementById('gridJoinCanvas'), 'pointerup', deps.endGridJoinDrag, undefined, true);
        listen(deps.document.getElementById('gridJoinCanvas'), 'pointercancel', deps.endGridJoinDrag, undefined, true);
        listen(deps.document.getElementById('gridJoinCanvas'), 'pointerleave', deps.endGridJoinDrag, undefined, true);
        listen(deps.document.getElementById('editTextCanvas'), 'pointerdown', deps.beginEditText, undefined, true);
        listen(deps.document.getElementById('editTextCanvas'), 'pointermove', deps.moveEditText, undefined, true);
        listen(deps.document.getElementById('editTextCanvas'), 'pointerup', deps.endEditText, undefined, true);
        listen(deps.document.getElementById('editTextCanvas'), 'pointercancel', deps.endEditText, undefined, true);
        listen(deps.document.getElementById('editTextCanvas'), 'pointerleave', deps.endEditText, undefined, true);
        listen(deps.document.getElementById('editTextCanvas'), 'dblclick', event => {
            if(deps.imageEditMode !== 'brush' || deps.brushTool !== 'text') return;
            event.preventDefault(); event.stopPropagation();
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
        deps.document.querySelectorAll('[data-panorama-ratio]').forEach(btn => {
            listen(btn, 'click', event => {
                event.preventDefault();
                event.stopPropagation();
                deps.applyPanoramaRatio(btn.dataset.panoramaRatio || 'wide');
            }, undefined, false);
        });
        ['panoramaRatioW','panoramaRatioH'].forEach(id => {
            listen(deps.document.getElementById(id), 'input', () => {
                deps.panoramaState.ratio = 'custom';
                deps.panoramaState.customW = Math.max(1, Math.min(999, Number(deps.document.getElementById('panoramaRatioW')?.value || 16)));
                deps.panoramaState.customH = Math.max(1, Math.min(999, Number(deps.document.getElementById('panoramaRatioH')?.value || 9)));
                deps.refreshPanoramaControls();
                deps.resizePanoramaViewer();
            }, undefined, true);
        });
        listen(deps.document.getElementById('imageEditStage'), 'wheel', event => {
            if(!deps.cropState) return;
            event.preventDefault();
            event.stopPropagation();
            if(deps.imageEditMode === 'preview'){
                if(deps.seekPreviewVideoFrames(event.deltaY > 0 ? 1 : -1)) return;
                if(deps.panoramaState.enabled){
                    const factor = event.deltaY < 0 ? 0.92 : 1 / 0.92;
                    deps.panoramaState.fov = Math.max(35, Math.min(100, deps.panoramaState.fov * factor));
                    deps.updateZoomLabel();
                    return;
                }
                const oldZoom = deps.previewZoom;
                const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
                deps.previewZoom = Math.max(0.05, deps.previewZoom * factor);
                const frame = deps.document.getElementById('previewFrame');
                const rect = frame?.getBoundingClientRect();
                if(rect){
                    const originX = event.clientX - rect.left - rect.width / 2;
                    const originY = event.clientY - rect.top - rect.height / 2;
                    const ratio = deps.previewZoom / oldZoom;
                    deps.previewPan.x -= originX * (ratio - 1);
                    deps.previewPan.y -= originY * (ratio - 1);
                }
                deps.applyPreviewTransform();
                return;
            }
            if(deps.imageEditMode === 'grid' && deps.gridOperationMode === 'join'){
                const stage = event.currentTarget;
                const oldZoom = deps.imageEditZoom;
                const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
                deps.imageEditZoom = Math.max(0.15, Math.min(6.0, deps.imageEditZoom * factor));
                const stageRect = stage.getBoundingClientRect();
                const mx = event.clientX - stageRect.left;
                const my = event.clientY - stageRect.top;
                const contentX = stage.scrollLeft + mx;
                const contentY = stage.scrollTop + my;
                const scale = deps.imageEditZoom / oldZoom;
                deps.refreshGridSplitPreview();
                deps.syncImageEditOverflow();
                deps.updateZoomLabel();
                stage.scrollLeft = contentX * scale - mx;
                stage.scrollTop = contentY * scale - my;
                return;
            }
            const stage = event.currentTarget;
            const oldZoom = deps.imageEditZoom;
            const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
            deps.imageEditZoom = Math.max(0.15, Math.min(6.0, deps.imageEditZoom * factor));
            const stageRect = stage.getBoundingClientRect();
            const mx = event.clientX - stageRect.left;
            const my = event.clientY - stageRect.top;
            const contentX = stage.scrollLeft + mx;
            const scale = deps.imageEditZoom / oldZoom;
            const contentY = stage.scrollTop + my;
            deps.applyImageEditZoom(scale);
            stage.scrollLeft = contentX * scale - mx;
            stage.scrollTop = contentY * scale - my;
        }, {passive:false}, false);
        listen(deps.window, 'resize', () => {
            if(deps.cropState) deps.syncImageEditOverflow();
            if(deps.panoramaState.enabled) deps.resizePanoramaViewer();
        }, undefined, false);

    }
    function dispose(){try{suspend();}finally{if(listening){deps.window.removeEventListener('pagehide',suspend);deps.window.removeEventListener('pageshow',mount);}listening=false;disposed=true;}}
    return {mount,suspend,dispose,capture,pointerMove:event=>!disposed&&!paused&&pointerMove(deps,event),pointerUp:event=>{if(!disposed&&!paused)pointerUp(deps,event);}};
}
const api={create,pointerMove,pointerUp};
if(typeof module!=='undefined'&&module.exports)module.exports=api;root.SmartImageEditorEvents=api;
})(typeof globalThis!=='undefined'?globalThis:window);
