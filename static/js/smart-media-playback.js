/* Owns smart media playback restoration; media data remains in the canvas host. */
(function(root){
'use strict';
function create(host){
    const deps=host(),pending=new Map();
    let mounted=false,disposed=false,listening=false;
    function captureTarget(media){
        const isCurrent=deps.captureCanvasContext();
        const source=media.getAttribute('src'),url=media.dataset?.url||media.dataset?.originalSrc||source||'';
        const nodeEl=media.closest('.image-node'),item=media.closest('[data-image-index]');
        const containerId=nodeEl?.dataset.id,nodeId=item?.dataset.refNodeId||containerId;
        const index=Number(item?.dataset.refImageIndex??item?.dataset.imageIndex??0);
        const modelUrl=deps.nodes.find(n=>n.id===nodeId)?.images?.[index]?.url;
        return ()=>{
            if(!mounted||disposed||!isCurrent()||!media.isConnected||media.getAttribute('src')!==source)return false;
            const currentNode=media.closest('.image-node'),currentItem=media.closest('[data-image-index]');
            return (media.dataset?.url||media.dataset?.originalSrc||media.getAttribute('src')||'')===url
                &&currentNode?.dataset.id===containerId&&deps.nodes.some(n=>n.id===containerId)
                &&(currentItem?.dataset.refNodeId||currentNode?.dataset.id)===nodeId
                &&Number(currentItem?.dataset.refImageIndex??currentItem?.dataset.imageIndex??0)===index
                &&Boolean(modelUrl)&&deps.nodes.find(n=>n.id===nodeId)?.images?.[index]?.url===modelUrl;
        };
    }
    function release(record){
        if(pending.get(record.media)!==record)return;
        pending.delete(record.media);
        if(record.frame)deps.cancelAnimationFrame(record.frame);
        if(record.metadata)record.media.removeEventListener('loadedmetadata',record.metadata);
        record.frame=0;record.metadata=null;
    }
    function apply(record){
        if(pending.get(record.media)!==record)return;
        if(!record.current()){release(record);return;}
        const {media,state}=record;
        if(record.metadata){media.removeEventListener('loadedmetadata',record.metadata);record.metadata=null;}
        try { media.playbackRate = state.playbackRate || 1; } catch(e) {}
        try { media.muted = state.muted; } catch(e) {}
        try { media.volume = state.volume; } catch(e) {}
        const applyTime=()=>{
            if(pending.get(media)!==record)return;
            if(!record.current()){release(record);return;}
            if(record.metadata){media.removeEventListener('loadedmetadata',record.metadata);record.metadata=null;}
            if(Number.isFinite(state.currentTime)&&state.currentTime>0&&Math.abs((media.currentTime||0)-state.currentTime)>0.2){
                try { media.currentTime = state.currentTime; } catch(e) {}
            }
            if(!state.paused&&typeof media.play==='function'){
                const playPromise=media.play();
                if(playPromise?.catch)playPromise.catch(()=>{});
            }
            if(!record.frame)release(record);
        };
        if(media.readyState>=1)applyTime();
        else {record.metadata=applyTime;media.addEventListener('loadedmetadata',applyTime,{once:true});}
    }
    function restoreMediaPlaybackState(media,state,nextFrame=false){
        if(!mounted||disposed||!media||!state)return;
        // render() follows transplantation with a batch restore: retain its frame,
        // but replace the old snapshot so that only the latest state can win.
        nextFrame=nextFrame||Boolean(pending.get(media)?.frame);
        for(const record of pending.values())if(record.media===media||!record.current())release(record);
        const current=captureTarget(media);
        if(!current())return;
        const record={media,state,current,frame:0,metadata:null};pending.set(media,record);
        if(nextFrame)record.frame=deps.requestAnimationFrame(()=>{
            if(pending.get(media)!==record)return;
            record.frame=0;apply(record);
        });
        apply(record);
    }
function captureMediaPlaybackState(media){
    if(!media) return null;
    return {
        currentTime:Number.isFinite(media.currentTime) ? media.currentTime : 0,
        paused:Boolean(media.paused),
        playbackRate:Number.isFinite(media.playbackRate) ? media.playbackRate : 1,
        muted:Boolean(media.muted),
        volume:Number.isFinite(media.volume) ? media.volume : 1
    };
}
function playbackKey(media){
    const containerId=media.closest('.image-node')?.dataset.id;
    if(!containerId)return null;
    const item=media.closest('[data-image-index]');
    const nodeId=item?.dataset.refNodeId||containerId;
    const index=Number(item?.dataset.refImageIndex??item?.dataset.imageIndex??0);
    const url=media.dataset.url||media.getAttribute('src')||'';
    // One file can be visible in several nodes or slots, each with its own player.
    return url?JSON.stringify([containerId,nodeId,index,media.tagName.toLowerCase(),url]):null;
}
function transplantSmartMediaElements(oldNodeEl, newNodeEl){
    const oldItems = [...(oldNodeEl?.querySelectorAll?.('.thumb-item,.image-wrap') || [])];
    const newItems = [...(newNodeEl?.querySelectorAll?.('.thumb-item,.image-wrap') || [])];
    const claimed=new Set();
    oldItems.forEach((oldItem, index) => {
        const oldMedia = oldItem.querySelector('video,audio,img.node-img,.thumb-item > img,.media-thumb img');
        if(!oldMedia) return;
        const selector = oldMedia.tagName.toLowerCase();
        const oldUrl = oldMedia.dataset?.url || oldMedia.dataset?.originalSrc || oldMedia.getAttribute('src') || '';
        const oldSignature = oldItem.dataset?.mediaSignature || `${selector}:${oldUrl}`;
        const candidates=newItems.filter(item=>!claimed.has(item));
        const oldSlot=oldItem.dataset?.refImageIndex??oldItem.dataset?.imageIndex;
        const newItem = candidates.find(item => oldSlot!==undefined
                &&(item.dataset?.refImageIndex??item.dataset?.imageIndex)===oldSlot
                &&item.dataset?.refNodeId===oldItem.dataset?.refNodeId
                &&item.dataset?.mediaSignature===oldSignature)
            || candidates.find(item => item.dataset?.mediaSignature === oldSignature)
            || candidates.find(item => item.querySelector?.(selector)?.dataset?.url === oldUrl)
            || candidates.find(item => item.querySelector?.(selector)?.dataset?.originalSrc === oldUrl)
            || candidates.find(item => item.querySelector?.(selector)?.getAttribute?.('src') === oldMedia.getAttribute('src'))
            || (!claimed.has(newItems[index])?newItems[index]:null);
        const newMedia = newItem?.querySelector?.(selector);
        const newUrl = newMedia?.dataset?.url || newMedia?.dataset?.originalSrc || newMedia?.getAttribute?.('src') || '';
        if(!newMedia || oldUrl !== newUrl) return;
        claimed.add(newItem);
        if(selector === 'img'){
            oldMedia.className = newMedia.className;
            oldMedia.draggable = false;
            oldMedia.alt = newMedia.getAttribute('alt') || oldMedia.getAttribute('alt') || '';
            oldMedia.style.cssText = newMedia.style.cssText;
            oldMedia.dataset.originalSrc = newMedia.dataset?.originalSrc || oldMedia.dataset?.originalSrc || '';
            newMedia.replaceWith(oldMedia);
            return;
        }
        const state = captureMediaPlaybackState(oldMedia);
        newMedia.replaceWith(oldMedia);
        restoreMediaPlaybackState(oldMedia, state, true);
    });
}
function captureMediaPlaybackStates(){
    const states = new Map();
    deps.world.querySelectorAll('video[data-url], audio[data-url]').forEach(media => {
        const key=playbackKey(media);
        if(key) states.set(key, captureMediaPlaybackState(media));
    });
    return states;
}
function restoreMediaPlaybackStates(states){
    if(!states?.size) return;
    deps.world.querySelectorAll('video[data-url], audio[data-url]').forEach(media => {
        restoreMediaPlaybackState(media, states.get(playbackKey(media)));
    });
}

    function suspend(){mounted=false;for(const record of pending.values())release(record);}
    function mount(){
        if(disposed||mounted)return;
        mounted=true;
        if(!listening){deps.window.addEventListener('pagehide',suspend);deps.window.addEventListener('pageshow',mount);listening=true;}
    }
    function dispose(){
        suspend();disposed=true;
        if(listening){deps.window.removeEventListener('pagehide',suspend);deps.window.removeEventListener('pageshow',mount);listening=false;}
    }
    return {captureMediaPlaybackState,restoreMediaPlaybackState,transplantSmartMediaElements,captureMediaPlaybackStates,restoreMediaPlaybackStates,mount,dispose};
}
const api={create};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.SmartMediaPlayback=api;
})(typeof globalThis!=='undefined'?globalThis:window);
