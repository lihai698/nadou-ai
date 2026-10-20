/* Owns composer refresh scheduling; presentation and canvas state stay in the host. */
(function(root){
    'use strict';
    function create(host){
        const deps=host();
        let pending=null,mounted=false,disposed=false,listening=false,refreshOnResume=false;
        function cancel(){
            const previous=pending;
            pending=null;
            if(previous)deps.clearTimeout(previous.id);
        }
        function beginUpdate(){
            cancel();
            if(disposed)return false;
            if(!mounted){refreshOnResume=true;return false;}
            return true;
        }
        function schedule(delay=120){
            if(disposed||!mounted)return;
            cancel();
            const isCurrent=deps.captureCanvasContext(),nodeId=deps.selectedNode()?.id||'';
            if(!isCurrent())return;
            const request={id:0};
            pending=request;
            request.id=deps.setTimeout(()=>{
                // A cancelled callback must not consume a newer pending refresh.
                if(pending!==request)return;
                pending=null;
                if(!mounted||disposed||!isCurrent()||(deps.selectedNode()?.id||'')!==nodeId)return;
                deps.updateComposer();
            },Math.max(0,Number(delay)||0));
        }
        function suspend(){
            refreshOnResume=refreshOnResume||Boolean(pending);
            mounted=false;cancel();
        }
        function mount(){
            if(disposed||mounted)return;
            mounted=true;
            if(!listening){
                deps.window.addEventListener('pagehide',suspend);
                deps.window.addEventListener('pageshow',mount);
                listening=true;
            }
            // Restore the live selection after a suspended refresh, never replay its old target.
            if(refreshOnResume){refreshOnResume=false;deps.updateComposer();}
        }
        function dispose(){
            suspend();disposed=true;refreshOnResume=false;
            if(listening){
                deps.window.removeEventListener('pagehide',suspend);
                deps.window.removeEventListener('pageshow',mount);
                listening=false;
            }
        }
        return {schedule,beginUpdate,mount,dispose};
    }
    const api={create};
    if(typeof module!=='undefined'&&module.exports)module.exports=api;
    root.SmartComposerScheduler=api;
})(typeof globalThis!=='undefined'?globalThis:window);
