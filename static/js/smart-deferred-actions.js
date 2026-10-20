/* Owns cooldown and paste timers within the current editor open lifetime. */
(function(root){
'use strict';
function create(host){
    const deps=host(),nodes=new Map();
    let mounted=false,listening=false,disposed=false,serial=0,button=null,paste=null,resumeRefresh=false;
    function cancel(record){if(record)deps.clearTimeout(record.timer);}
    function cancelNode(id){const record=nodes.get(id);cancel(record);nodes.delete(id);}
    function invalidate(){
        let changed=false;
        cancel(button);button=null;cancel(paste);paste=null;
        for(const [id,record] of nodes){
            cancel(record);
            if(record.current()){
                const node=deps.nodes.find(n=>n.id===id);
                if(node&&node.running){node.running=false;changed=true;}
            }
        }
        nodes.clear();
        return changed;
    }
    function coolRunButton(ms=2000){
        if(!mounted||disposed||!deps.runBtn)return 0;
        cancel(button);
        const record={token:++serial,current:deps.captureCanvasContext(),timer:0};button=record;
        deps.syncRunButtonState();
        record.timer=deps.setTimeout(()=>{
            if(button!==record)return;
            button=null;
            if(mounted&&!disposed&&record.current())deps.syncRunButtonState();
        },ms);
        return record.token;
    }
    function coolNodeRunningState(node,ms=2000){
        if(!mounted||disposed||!node)return 0;
        cancelNode(node.id);
        const current=deps.captureCanvasContext();
        if(!current())return 0;
        const record={token:++serial,current,timer:0};nodes.set(node.id,record);
        node.running=true;
        record.timer=deps.setTimeout(()=>{
            if(nodes.get(node.id)!==record)return;
            nodes.delete(node.id);
            if(!mounted||disposed||!current())return;
            const live=deps.nodes.find(n=>n.id===node.id);
            if(live){live.running=false;deps.render();}
        },ms);
        return record.token;
    }
    function clearNodeRunningState(node){
        if(!node)return;
        cancelNode(node.id);node.running=false;
    }
    function cancelPaste(){cancel(paste);paste=null;}
    function queuePaste(){
        if(!mounted||disposed)return;
        cancelPaste();
        const record={current:deps.captureCanvasContext(),clipboard:deps.nodeClipboard,requestedAt:Date.now(),timer:0};
        if(!record.current())return;
        paste=record;
        record.timer=deps.setTimeout(()=>{
            if(paste!==record)return;
            paste=null;
            if(!mounted||disposed||!record.current()||deps.nodeClipboard!==record.clipboard
                ||deps.isEditableTarget(deps.document.activeElement))return;
            if(deps.lastImagePasteAt>=record.requestedAt||deps.lastNodePasteAt>=record.requestedAt)return;
            deps.pasteNodes();
        },90);
    }
    function suspend(){resumeRefresh=invalidate()||resumeRefresh;mounted=false;}
    function mount(){
        if(mounted||disposed)return;
        mounted=true;
        if(!listening){
            deps.window.addEventListener('pagehide',suspend);
            deps.window.addEventListener('pageshow',mount);
            deps.window.addEventListener('blur',cancelPaste);
            listening=true;
        }
        if(resumeRefresh){resumeRefresh=false;deps.render();deps.syncRunButtonState();}
    }
    function dispose(){
        suspend();disposed=true;
        if(listening){
            deps.window.removeEventListener('pagehide',suspend);
            deps.window.removeEventListener('pageshow',mount);
            deps.window.removeEventListener('blur',cancelPaste);
            listening=false;
        }
    }
    return {coolRunButton,coolNodeRunningState,clearNodeRunningState,cancelNode,queuePaste,invalidate,mount,suspend,dispose};
}
const api={create};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.SmartDeferredActions=api;
})(typeof globalThis!=='undefined'?globalThis:window);
