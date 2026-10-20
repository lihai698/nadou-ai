/* Canvas persistence HTTP boundary. Editors own snapshots, queues, merges and drafts. */
(function(root){
    'use strict';

    function put(url,payload,request){
        return request(url,{
            method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)
        });
    }

    async function saveClassic({id,payload,request,getVersion}){
        const response=await put(`/api/canvases/${id}`,payload,request);
        if(response.status===409){
            const data=await response.json().catch(()=>({}));
            const remote=data.detail?.canvas || data.canvas;
            if(!remote || !Array.isArray(remote.nodes)){
                throw new Error('冲突版本不可用，已保留本地草稿。');
            }
            const version=getVersion();
            if(Number(remote.updated_at || 0)<=Number(version.updated_at || 0)
                && Number(remote.meta_revision || 0)===Number(version.meta_revision || 0)){
                throw new Error('冲突版本不可用，已保留本地草稿。');
            }
            return {kind:'conflict',canvas:remote};
        }
        if(!response.ok) throw new Error('save failed');
        const data=await response.json().catch(()=>({}));
        if(!Array.isArray(data.canvas?.nodes)) throw new Error('save response missing nodes');
        return {kind:'saved',canvas:data.canvas};
    }

    async function saveSmart({getId,payload,request,getVersion,onConflict}){
        const response=await put(`/api/canvases/${encodeURIComponent(getId())}`,payload,request);
        if(response.ok) return {kind:'saved',data:await response.json()};
        if(response.status!==409) throw new Error(`Canvas save failed: HTTP ${response.status}`);
        // Clear the old queue before awaiting JSON/GET; edits made while waiting may queue again.
        onConflict();
        const data=await response.json().catch(()=>({}));
        let remote=data.detail?.canvas;
        const version=getVersion();
        const sentVersion=Number(version.updated_at || 0);
        const sentMetaRevision=Number(version.meta_revision || 0);
        const newer=candidate=>Number(candidate?.updated_at || 0)>sentVersion
            || Number(candidate?.meta_revision || 0)>sentMetaRevision;
        if(!Array.isArray(remote?.nodes) || !newer(remote)){
            const latest=await request(`/api/canvases/${encodeURIComponent(getId())}`);
            if(latest.ok) remote=(await latest.json()).canvas;
        }
        if(!Array.isArray(remote?.nodes) || !newer(remote)){
            throw new Error('Canvas conflict: current server canvas unavailable');
        }
        return {kind:'conflict',canvas:remote};
    }

    async function clearCanvas({id,payload,request}){
        const url=`/api/canvases/${encodeURIComponent(id)}`;
        let failure;
        try {
            const response=await request(`${url}/clear`,{
                method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)
            });
            const data=await response.json().catch(()=>({}));
            if(response.ok) return data;
            failure=new Error(data.detail?.message || data.detail || '清空当前画布失败');
            failure.status=response.status;
            failure.canvas=data.detail?.canvas;
        } catch(error){failure=error;}
        // Version conflicts and other rejected requests must not discard local edits.
        if(failure.status && failure.status<500) throw failure;
        try {
            const response=await request(url,{cache:'no-store'});
            const remote=response.ok ? (await response.json()).canvas : null;
            const empty=remote?.id===id && Number(remote.updated_at)>Number(payload.base_updated_at || 0)
                && ['nodes','connections','logs'].every(key=>Array.isArray(remote[key]) && remote[key].length===0)
                && remote.settings && !Array.isArray(remote.settings) && typeof remote.settings==='object'
                && Object.keys(remote.settings).length===0;
            if(empty) return {canvas:remote,warning:`${failure.message}\n已重新核对：服务器上的画布内容已清空。媒体清理未确认完成。`};
        } catch(error){/* Keep the original failure if the readback cannot confirm a clear. */}
        throw failure;
    }

    root.CanvasSaveTransport={saveClassic,saveSmart,clearCanvas};
})(globalThis);
