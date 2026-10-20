/* Capture an editor session without owning a second canvas or node state. */
(function(root){
    'use strict';
    function capture(deps, {ignoreMode=false}={}){
        const edit=deps.cropState,mode=deps.imageEditMode,operation=deps.gridOperationMode;
        const source=ignoreMode?(deps.editImageSource??deps.editSourceKey):deps.editSourceKey,isCanvasCurrent=deps.captureCanvasContext();
        return ()=>Boolean(edit)&&isCanvasCurrent()&&deps.cropState===edit
            &&(ignoreMode||(deps.imageEditMode===mode&&deps.gridOperationMode===operation))
            &&(ignoreMode?(deps.editImageSource??deps.editSourceKey):deps.editSourceKey)===source
            &&deps.nodes.some(node=>node.id===edit.nodeId);
    }
    const api={capture};
    if(typeof module!=='undefined'&&module.exports)module.exports=api;
    root.ImageEditorSession=api;
})(typeof globalThis!=='undefined'?globalThis:window);
