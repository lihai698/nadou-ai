/* Delegated preview events: node media has a canvas owner; panel previews own only their DOM. */
(function(root){
'use strict';
function create(host){
    const deps=host();
    let previews=new WeakMap(),players=new WeakMap(),mounted=false,disposed=false,listening=false;
    function sourceFor(media){return media.dataset.originalSrc||media.dataset.url||media.getAttribute('src')||'';}
    function capture(media,scope=deps.document){
        const source=sourceFor(media),preview=media.dataset.previewSrc,kind=media.dataset.previewKind;
        const src=media.getAttribute('src'),isVideo=media.tagName?.toLowerCase()==='video',parent=media.parentElement;
        const nodeEl=media.closest('.image-node'),item=media.closest('[data-image-index]');
        const containerId=nodeEl?.dataset.id,nodeId=item?.dataset.refNodeId||containerId;
        const index=Number(item?.dataset.refImageIndex??item?.dataset.imageIndex??0);
        const modelUrl=nodeEl?deps.nodes.find(n=>n.id===nodeId)?.images?.[index]?.url:null;
        const isCurrent=nodeEl?deps.captureCanvasContext():null;
        return ()=>{
            if(!mounted||disposed||!media.isConnected||!scope.contains(media)||sourceFor(media)!==source
                ||media.dataset.previewSrc!==preview||media.dataset.previewKind!==kind||(isVideo&&media.getAttribute('src')!==src))return null;
            const liveNode=media.closest('.image-node');
            if(!nodeEl)return !liveNode&&media.parentElement===parent?{image:null}:null;
            if(!isCurrent()||liveNode?.dataset.id!==containerId||!deps.nodes.some(n=>n.id===containerId))return null;
            const liveItem=media.closest('[data-image-index]');
            if((liveItem?.dataset.refNodeId||liveNode?.dataset.id)!==nodeId
                ||Number(liveItem?.dataset.refImageIndex??liveItem?.dataset.imageIndex??0)!==index)return null;
            const image=deps.nodes.find(n=>n.id===nodeId)?.images?.[index];
            if(!modelUrl||image?.url!==modelUrl||deps.smartOriginalMediaUrl(deps.imageForDisplay(image))!==deps.smartOriginalMediaUrl(source))return null;
            return {image};
        };
    }
    function bind(scope=deps.document){
        if(!mounted||disposed)return;
        scope.querySelectorAll?.('img[data-preview-src][data-original-src]').forEach(img=>{
            previews.set(img,capture(img,scope));
        });
        scope.querySelectorAll?.('video[data-inline-video-active="1"]').forEach(video=>players.set(video,capture(video,scope)));
    }
    function onError(event){
        const img=event.target,current=previews.get(img);
        if(!current?.())return;
        const original=img.dataset.originalSrc||'';
        if(img.dataset.previewKind==='video'){
            const tpl=deps.document.createElement('template');
            tpl.innerHTML=deps.smartVideoFallbackHtml(original,img.dataset.videoFallbackAttrs||'');
            const video=tpl.content.firstElementChild;
            if(video){previews.delete(img);img.replaceWith(video);}
            return;
        }
        if(original&&img.getAttribute('src')!==original)img.src=original;
    }
    function onEnded(event){
        const video=event.target,owner=players.get(video)?.();
        if(!owner)return;
        if(owner.image)owner.image._inlineVideoActive=true;
        video.dataset.inlineVideoActive='1';
    }
    function activate(target){
        if(!mounted||disposed)return false;
        const root=target?.closest?.('.media-video-card,.video-thumb,.image-wrap,.thumb-item')||target?.parentElement||null;
        const img=target?.matches?.('img[data-preview-kind="video"]')?target:root?.querySelector?.('img[data-preview-kind="video"]');
        if(!img){
            const fallback=target?.matches?.('video[data-url]')?target:root?.querySelector?.('video[data-url]');
            if(fallback&&capture(fallback)()){
                fallback.controls=true;fallback.muted=false;
                fallback.play?.().catch(()=>{});
                return true;
            }
            return false;
        }
        const owner=capture(img)(),original=deps.smartOriginalMediaUrl(sourceFor(img));
        if(!owner||!original)return false;
        const tpl=deps.document.createElement('template');
        tpl.innerHTML=deps.smartVideoPlayerHtml(original);
        const video=tpl.content.firstElementChild;
        if(!video)return false;
        if(owner.image)owner.image._inlineVideoActive=true;
        previews.delete(img);img.replaceWith(video);
        video.parentElement?.querySelector?.('.smart-video-play')?.style?.setProperty('display','none');
        players.set(video,capture(video));
        video.play?.().catch(()=>{});
        return true;
    }
    function suspend(){
        mounted=false;
        deps.document.removeEventListener('error',onError,true);
        deps.document.removeEventListener('ended',onEnded,true);
        previews=new WeakMap();players=new WeakMap();
    }
    function mount(){
        if(disposed||mounted)return;
        mounted=true;
        deps.document.addEventListener('error',onError,true);
        deps.document.addEventListener('ended',onEnded,true);
        if(!listening){deps.window.addEventListener('pagehide',suspend);deps.window.addEventListener('pageshow',mount);listening=true;}
        bind();
    }
    function dispose(){
        suspend();disposed=true;
        if(listening){deps.window.removeEventListener('pagehide',suspend);deps.window.removeEventListener('pageshow',mount);listening=false;}
    }
    return {bind,activate,mount,dispose};
}
const api={create};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.SmartPreviewEvents=api;
})(typeof globalThis!=='undefined'?globalThis:window);
