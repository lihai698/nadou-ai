/* Smart high-resolution previews own timers, probes and proxy error subscriptions. */
(function(root){
    'use strict';
    function create(host){
        const deps=host(),loaded=new Set(),loading=new Map(),fallbacks=new Map();
        let mounted=false,disposed=false,listening=false,highTimer=0,syncTimer=0,sequence=0,scheduleSequence=0;
        function editorOpen(){return Boolean(deps.imageEditModal?.classList?.contains('open'));}
        function wantsHighRes(){return Number(deps.viewport?.scale||1)>=0.86;}
        function nearViewport(img){
            if(!img?.isConnected||!deps.shell) return false;
            const shell=deps.shell.getBoundingClientRect(),rect=img.getBoundingClientRect(),margin=220;
            return rect.right>=shell.left-margin&&rect.left<=shell.right+margin&&rect.bottom>=shell.top-margin&&rect.top<=shell.bottom+margin;
        }
        function captureTarget(img){
            const isCurrent=deps.captureCanvasContext(),original=img.dataset.originalSrc;
            const nodeEl=img.closest('.image-node'),itemEl=img.closest('[data-image-index]');
            const nodeId=itemEl?.dataset.refNodeId||nodeEl?.dataset.id;
            const index=Number(itemEl?.dataset.refImageIndex??itemEl?.dataset.imageIndex??0);
            const containerId=nodeEl?.dataset.id,url=deps.nodes.find(n=>n.id===nodeId)?.images?.[index]?.url;
            return ()=>{
                if(!mounted||disposed||!isCurrent()||!img.isConnected||img.dataset.originalSrc!==original) return false;
                const currentNode=img.closest('.image-node'),currentItem=img.closest('[data-image-index]');
                return (currentItem?.dataset.refNodeId||currentNode?.dataset.id)===nodeId
                    &&Number(currentItem?.dataset.refImageIndex??currentItem?.dataset.imageIndex??0)===index
                    &&currentNode?.dataset.id===containerId&&deps.nodes.some(n=>n.id===containerId)
                    &&Boolean(url)&&deps.nodes.find(n=>n.id===nodeId)?.images?.[index]?.url===url;
            };
        }
        function releaseFallback(record){
            if(fallbacks.get(record.img)!==record) return;
            record.img.removeEventListener('error',record.error);
            delete record.img.dataset.proxyFallbackBound;
            delete record.img.dataset.proxyFallbackTried;
            fallbacks.delete(record.img);
        }
        function pruneFallbacks(){for(const record of fallbacks.values())if(!record.current())releaseFallback(record);}
        function bindProxy(img,itemOrUrl){
            if(!mounted||disposed||!img) return;
            pruneFallbacks();
            const url=deps.smartOriginalMediaUrl(itemOrUrl),existing=fallbacks.get(img);
            if(existing?.url===url) return;
            if(existing) releaseFallback(existing);
            const current=captureTarget(img);
            if(!current()) return;
            const record={img,url,current,error:null};
            record.error=()=>{
                if(!current()){releaseFallback(record);return;}
                if(img.dataset.proxyFallbackTried==='1') return;
                const fallback=deps.proxiedMediaUrl(itemOrUrl);
                if(!fallback||fallback===img.getAttribute('src')) return;
                img.dataset.proxyFallbackTried='1';img.src=fallback;
            };
            fallbacks.set(img,record);img.dataset.proxyFallbackBound='1';img.addEventListener('error',record.error);
        }
        function preload(src){
            if(!src||loaded.has(src)) return Promise.resolve(true);
            if(loading.has(src)) return loading.get(src).promise;
            const img=new deps.Image(),record={img,promise:null,cancel:null};
            record.promise=new Promise(resolve=>{
                let settled=false;
                function finish(ok){
                    if(settled) return;
                    settled=true;img.onload=null;img.onerror=null;
                    if(loading.get(src)===record) loading.delete(src);
                    if(ok) loaded.add(src);
                    resolve(ok);
                }
                record.cancel=()=>finish(false);
                img.decoding='async';
                img.onload=async()=>{
                    try{if(img.decode)await img.decode();}catch(e){}
                    if(loading.get(src)===record&&mounted&&!disposed) finish(true);
                };
                img.onerror=()=>finish(false);
            });
            loading.set(src,record);img.src=src;
            return record.promise;
        }
        function sync(scope=deps.world){
            if(!mounted||disposed) return;
            pruneFallbacks();
            if(highTimer) deps.clearTimeout(highTimer);
            highTimer=0;
            const seq=++sequence,images=[],wantHighRes=wantsHighRes();
            (scope||deps.world).querySelectorAll?.('img[data-preview-src][data-original-src]').forEach(img=>{
                if(img.dataset.previewKind==='video') return;
                const current=captureTarget(img);
                if(!current()) return;
                const preview=img.dataset.previewSrc||'',original=img.dataset.originalSrc||'';
                if(!wantHighRes||!nearViewport(img)){
                    delete img.dataset.selectedHighResTarget;
                    if(preview&&img.getAttribute('src')!==preview) img.src=preview;
                    return;
                }
                const target=deps.displayMediaUrl({url:deps.smartOriginalMediaUrl(original)});
                if(!target) return;
                img.dataset.selectedHighResTarget=target;
                if(loaded.has(target)){
                    if(img.getAttribute('src')!==target) img.src=target;
                    return;
                }
                if(preview&&img.getAttribute('src')!==preview) img.src=preview;
                images.push({img,target,current});
            });
            if(!images.length||editorOpen()) return;
            highTimer=deps.setTimeout(async()=>{
                if(seq!==sequence||!mounted||disposed) return;
                highTimer=0;
                if(editorOpen()) return;
                const active=images.filter(item=>item.current());
                await Promise.all(active.map(item=>preload(item.target)));
                if(seq!==sequence||!mounted||disposed||editorOpen()) return;
                active.forEach(({img,target,current})=>{
                    if(!current()||img.dataset.selectedHighResTarget!==target||!wantsHighRes()||!nearViewport(img)) return;
                    if(loaded.has(target)&&img.getAttribute('src')!==target) img.src=target;
                });
            },320);
        }
        function schedule(scope=deps.world,delay=120){
            if(!mounted||disposed) return;
            if(syncTimer) deps.clearTimeout(syncTimer);
            const seq=++scheduleSequence,isCurrent=deps.captureCanvasContext();
            syncTimer=deps.setTimeout(()=>{
                if(seq!==scheduleSequence||!mounted||disposed) return;
                syncTimer=0;
                if(isCurrent()) sync(scope);
            },Math.max(0,Number(delay)||0));
        }
        function suspend(){
            mounted=false;sequence++;scheduleSequence++;
            if(highTimer) deps.clearTimeout(highTimer);
            if(syncTimer) deps.clearTimeout(syncTimer);
            highTimer=0;syncTimer=0;
            for(const record of loading.values())record.cancel();
            for(const record of fallbacks.values())releaseFallback(record);
            loaded.clear();
        }
        function mount(){
            if(mounted||disposed) return;
            mounted=true;
            if(!listening){deps.window.addEventListener('pagehide',suspend);deps.window.addEventListener('pageshow',mount);listening=true;}
            sync();
        }
        function dispose(){
            suspend();disposed=true;
            if(listening){deps.window.removeEventListener('pagehide',suspend);deps.window.removeEventListener('pageshow',mount);listening=false;}
        }
        return {sync,schedule,bindProxy,mount,dispose};
    }
    const api={create};
    if(typeof module==='object'&&module.exports)module.exports=api;
    else root.SmartImageResolution=api;
})(typeof window!=='undefined'?window:globalThis);
