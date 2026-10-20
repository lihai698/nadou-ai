/* Smart media measurements own DOM subscriptions and original-image probes. */
(function(root){
    'use strict';
    function create(host){
        const deps=host(),records=new Map();
        let mounted=false,disposed=false,listening=false;
        function release(record){
            if(records.get(record.img)!==record) return;
            records.delete(record.img);
            record.img.removeEventListener('load',record.apply);
            record.img.removeEventListener('loadedmetadata',record.apply);
            if(record.probe){record.probe.onload=null;record.probe.onerror=null;record.probe=null;}
        }
        function current(record){
            if(!mounted||disposed||records.get(record.img)!==record||!record.isCurrent()||!record.img.isConnected) return null;
            const nodeEl=record.img.closest('.image-node'),itemEl=record.img.closest('[data-image-index]');
            const nodeId=itemEl?.dataset.refNodeId||nodeEl?.dataset.id;
            const index=Number(itemEl?.dataset.refImageIndex??itemEl?.dataset.imageIndex??0);
            if(nodeId!==record.nodeId||index!==record.index||nodeEl?.dataset.id!==record.containerId) return null;
            const node=deps.nodes.find(n=>n.id===record.nodeId),image=node?.images?.[index];
            if(!image||image.url!==record.url||(record.img.dataset?.originalSrc||image.url||'')!==record.originalSrc) return null;
            const containerNode=deps.nodes.find(n=>n.id===record.containerId);
            if(!containerNode) return null;
            return {node,image,containerNode,itemEl};
        }
        function applySize(record,w,h,original){
            const target=current(record);
            if(!target){release(record);return;}
            const {node,image,containerNode,itemEl}=target;
            if(image.natural_w||image.natural_h){release(record);return;}
            if(w<=0||h<=0) return;
            if(original){
                image.natural_w=w;image.natural_h=h;
                delete image.layout_w;delete image.layout_h;
            }else{
                if(Number(image.layout_w||0)===w&&Number(image.layout_h||0)===h) return;
                image.layout_w=w;image.layout_h=h;
            }
            deps.applyThumbDisplaySizeToElement(itemEl,image,Math.max(itemEl?.clientWidth||0,itemEl?.clientHeight||0));
            deps.updateImageResolutionBadgeElement(itemEl,image);
            if(!deps.isSmartGroupNode(node)&&(node.images||[]).length===1&&!node.w&&!node.h){
                const layout=deps.singleImageLayout(image,node,deps.mediaNodeDefaultScale(node));
                node.w=layout.width;node.h=layout.height;
            }
            deps.updateNodeElementDuringResize(node);
            if(containerNode.id!==node.id) deps.updateNodeElementDuringResize(containerNode);
            if(deps.isNodeSelected(node.id)) deps.updateComposer();
            deps.scheduleSave();
            if(original) release(record);
        }
        function probeOriginal(record){
            if(record.probe||!record.isPreview||record.img.dataset?.previewKind==='video'||!record.originalSrc) return;
            const src=deps.displayMediaUrl({url:deps.smartOriginalMediaUrl(record.originalSrc)});
            if(!src||/^data:/i.test(src)||/^blob:/i.test(src)) return;
            const probe=new deps.Image();record.probe=probe;
            probe.onload=()=>{
                const w=probe.naturalWidth||0,h=probe.naturalHeight||0;
                probe.onload=null;probe.onerror=null;
                if(record.probe!==probe) return;
                record.probe=null;
                applySize(record,w,h,true);
            };
            probe.onerror=()=>{
                probe.onload=null;probe.onerror=null;
                if(record.probe===probe) record.probe=null;
                if(!current(record)) release(record);
            };
            probe.src=src;
        }
        function measure(){
            if(!mounted||disposed) return;
            for(const record of records.values()) if(!current(record)) release(record);
            deps.world.querySelectorAll('.image-node img,.image-node video').forEach(img=>{
                const nodeEl=img.closest('.image-node'),itemEl=img.closest('[data-image-index]');
                const nodeId=itemEl?.dataset.refNodeId||nodeEl?.dataset.id;
                const index=Number(itemEl?.dataset.refImageIndex??itemEl?.dataset.imageIndex??0);
                const node=deps.nodes.find(n=>n.id===nodeId),image=node?.images?.[index];
                if(img.tagName?.toLowerCase()==='img'&&image?.url) deps.bindImageProxyFallback(img,image);
                const existing=records.get(img);
                if(!node||!image||image.natural_w||image.natural_h){if(existing)release(existing);return;}
                if(existing){probeOriginal(existing);return;}
                const record={img,nodeId,index,url:image.url,containerId:nodeEl?.dataset.id,
                    originalSrc:img.dataset?.originalSrc||image.url||'',isPreview:deps.isSmartPreviewImage(img),
                    isCurrent:deps.captureCanvasContext(),probe:null,apply:null};
                record.apply=()=>applySize(record,img.naturalWidth||img.videoWidth||0,img.naturalHeight||img.videoHeight||0,!record.isPreview);
                records.set(img,record);
                if(!current(record)){release(record);return;}
                probeOriginal(record);
                if(record.isPreview&&image.layout_w&&image.layout_h) return;
                // Subscribe before the immediate path, which may settle and release both listeners.
                if(img.tagName?.toLowerCase()==='video'||!img.complete) img.addEventListener('load',record.apply,{once:true});
                img.addEventListener('loadedmetadata',record.apply,{once:true});
                if(img.tagName?.toLowerCase()!=='video'&&img.complete) record.apply();
            });
        }
        function suspend(){mounted=false;for(const record of records.values())release(record);}
        function mount(){
            if(disposed||mounted) return;
            mounted=true;
            if(!listening){
                deps.window.addEventListener('pagehide',suspend);
                deps.window.addEventListener('pageshow',mount);
                listening=true;
            }
            measure();
        }
        function dispose(){
            suspend();disposed=true;
            if(listening){deps.window.removeEventListener('pagehide',suspend);deps.window.removeEventListener('pageshow',mount);listening=false;}
        }
        return {measure,mount,suspend,dispose};
    }
    const api={create};
    if(typeof module!=='undefined'&&module.exports) module.exports=api;
    root.SmartImageDimensions=api;
})(typeof globalThis!=='undefined'?globalThis:window);
