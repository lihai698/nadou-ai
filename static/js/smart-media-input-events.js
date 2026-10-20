/* Smart media input events, picker ownership and asynchronous open lifetime. */
(function(root){
'use strict';
function create(host){
    const deps=host(),pickers=new Set(),bindings=[];
    let epoch=0,paused=false,disposed=false,mounted=false,listening=false,fileChoice=null,workflowChoice=null;
    function valid(generation){return !disposed&&!paused&&epoch===generation;}
    function capture(){
        const id=deps.canvas?.id,generation=epoch;
        return ()=>valid(generation)&&Boolean(id)&&deps.canvas?.id===id;
    }
    function clearChoices(){
        for(const cleanup of [...pickers])cleanup();
        fileChoice=null;workflowChoice=null;
        if(deps.fileInput)deps.fileInput.value='';
        if(deps.workflowInput)deps.workflowInput.value='';
        deps.pendingGroupUploadPoint=null;deps.uploadTargetId='';
    }
    function invalidate(){epoch++;clearChoices();}
    function beginOpen(){invalidate();const generation=epoch;return ()=>valid(generation);}
    function pick(nodeId){
        const isCurrent=capture();
        if(!isCurrent()||!deps.nodes.some(node=>node.id===nodeId))return;
        const input=deps.document.createElement('input');
        input.type='file';input.accept='image/*,video/*,audio/*';input.multiple=true;
        let consumed=false;
        function cleanup(){consumed=true;input.onchange=null;input.oncancel=null;input.remove();pickers.delete(cleanup);}
        input.onchange=()=>{
            if(consumed)return;
            const files=[...(input.files||[])],current=isCurrent()&&deps.nodes.some(node=>node.id===nodeId);
            cleanup();
            if(current&&files.length)deps.handleFiles(files,nodeId);
        };
        input.oncancel=cleanup;pickers.add(cleanup);
        input.style.position='fixed';input.style.left='-9999px';input.style.top='-9999px';input.style.opacity='0';
        deps.document.body.appendChild(input);input.click();
    }
    async function dropOnNode(event,nodeId){
        const isCurrent=capture();
        event.preventDefault();event.stopPropagation();
        if(!isCurrent())return;
        const payload=await deps.resolveSmartImageDropPayload(event.dataTransfer);
        if(!isCurrent()||!deps.nodes.some(node=>node.id===nodeId)||payload.type==='none')return;
        await deps.handleSmartImageDropPayload(payload,nodeId);
    }
    async function dropOnBoard(event){
        const isCurrent=capture();
        event.preventDefault();
        if(!isCurrent()||event.target.closest('.image-node'))return;
        const point=deps.screenToWorld(event),raw=event.dataTransfer.getData('application/x-smart-asset');
        if(raw){
            try{const asset=JSON.parse(raw);if(asset?.url){deps.pushUndo();deps.createImageNodeAt(point,[deps.assetNodeImageFromItem(asset)],{skipUndo:true});}return;}catch{}
        }
        const payload=await deps.resolveSmartImageDropPayload(event.dataTransfer);
        if(!isCurrent()||payload.type==='none')return;
        await deps.handleSmartImageDropPayload(payload,'',{point,forceNew:true});
    }
    function paste(event){
        if(!capture()())return;
        const files=[...(event.clipboardData?.files||[])].filter(deps.isSupportedUploadFile);
        if(files.length){deps.lastImagePasteAt=Date.now();deps.handleFiles(files,deps.selectedId);return;}
        if(!deps.isEditableTarget(event.target)&&deps.pasteAssetsFromInbox()){event.preventDefault();return;}
        if(deps.nodeClipboard?.nodes?.length&&!deps.isEditableTarget(event.target)){event.preventDefault();deps.pasteNodes();}
    }
    function rememberFileChoice(){fileChoice={isCurrent:capture(),point:deps.pendingGroupUploadPoint,target:deps.uploadTargetId||deps.selectedId};}
    function fileChange(){
        const choice=fileChoice;fileChoice=null;
        const files=[...(deps.fileInput?.files||[])];
        deps.pendingGroupUploadPoint=null;deps.uploadTargetId='';
        if(deps.fileInput)deps.fileInput.value='';
        if(!choice?.isCurrent()||!files.length)return;
        deps.handleFiles(files,choice.point?'':choice.target,choice.point?{point:choice.point,forceNew:true}:{forceNew:!choice.target});
    }
    function workflowChange(){
        const isCurrent=workflowChoice;workflowChoice=null;
        const file=deps.workflowInput?.files?.[0];
        if(deps.workflowInput)deps.workflowInput.value='';
        if(file&&isCurrent?.())deps.importSmartWorkflowFile(file);
    }
    function listen(target,type,fn){if(target){target.addEventListener(type,fn);bindings.push([target,type,fn]);}}
    function suspend(){
        invalidate();paused=true;
        for(const [target,type,fn] of bindings.splice(0))target.removeEventListener(type,fn);
        mounted=false;
    }
    function mount(){
        if(disposed||mounted)return;
        mounted=true;paused=false;
        if(!listening){deps.window.addEventListener('pagehide',suspend);deps.window.addEventListener('pageshow',mount);listening=true;}
        listen(deps.shell,'dragover',event=>{if(capture()())deps.setSmartDropCopyEffect(event,true);});
        listen(deps.shell,'drop',dropOnBoard);listen(deps.window,'paste',paste);
        listen(deps.fileInput,'click',rememberFileChoice);listen(deps.fileInput,'change',fileChange);
        listen(deps.workflowInput,'click',()=>{workflowChoice=capture();});listen(deps.workflowInput,'change',workflowChange);
    }
    function dispose(){suspend();if(listening){deps.window.removeEventListener('pagehide',suspend);deps.window.removeEventListener('pageshow',mount);}listening=false;disposed=true;}
    return {capture,beginOpen,invalidate,mount,suspend,dispose,pick,dropOnNode};
}
const api={create};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.SmartMediaInputEvents=api;
})(typeof globalThis!=='undefined'?globalThis:window);
