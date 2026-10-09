(function(root,factory){
    const api=factory();
    if(typeof module==='object'&&module.exports) module.exports=api;
    else root.CanvasClipHost=api;
})(typeof window!=='undefined'?window:globalThis,function(){
    'use strict';
    const clone=value=>JSON.parse(JSON.stringify(value));
    function mediaKind(value){
        const kind=String(value?.kind||value?.mediaKind||'').toLowerCase();
        if(kind) return kind;
        const mime=String(value?.mimeType||value?.content_type||'');
        if(mime.startsWith('video/')) return 'video';
        if(mime.startsWith('audio/')) return 'audio';
        const url=String(typeof value==='string'?value:value?.url||'');
        if(/\.(mp4|webm|mov|m4v|mkv|avi)(\?|#|$)/i.test(url)) return 'video';
        if(/\.(mp3|wav|aac|m4a|ogg|flac)(\?|#|$)/i.test(url)) return 'audio';
        if(/\.(txt|json|zip|pdf)(\?|#|$)/i.test(url)) return 'file';
        return 'image';
    }
    function mediaForNode(node,nodes=[],seen=new Set()){
        if(!node||seen.has(node.id)) return [];
        seen.add(node.id);
        if(node.type==='group') return (node.items||[]).flatMap(id=>mediaForNode(nodes.find(n=>n.id===id),nodes,seen));
        const values=node.type==='image'?(node.url?[node]:[]):node.type==='output'?(node.images||[]):(node.generatedOutputs||[]);
        return values.map((value,i)=>{
            const item=typeof value==='string'?{url:value}:value;
            if(!item?.url) return null;
            const kind=mediaKind(item);
            if(!['image','video'].includes(kind)) return null;
            return {
                kind,url:item.url,name:item.name||node.name||(kind==='video'?'视频片段':'图片片段'),
                posterUrl:item.posterUrl||item.thumbnail||item.poster||node.thumbnail||'',
                durationSeconds:Number(item.durationSeconds||item.duration||0)||undefined,
                sourceNodeId:node.id,sourceResultId:node.type==='image'?'primary':String(item.id||item.resultId||item.url),
                fromUpstream:true,
            };
        }).filter(Boolean);
    }
    function collectUrls(node){
        return [...new Set((node?.clipData?.clips||[]).flatMap(c=>[c.url,c.posterUrl]).filter(url=>typeof url==='string'&&/^\/(assets|output|api\/storage-files)\//.test(url)))];
    }
    function remapCopies(copies,idMap,model){
        model=model||(typeof window!=='undefined'?window.CanvasClipModel:require('./canvas-clip-model.js'));
        const get=id=>idMap instanceof Map?idMap.get(id):idMap[id];
        const instanceMap=new Map();
        copies.filter(n=>n.type==='clip').forEach(n=>{
            const old=(n.clipData?.clips||[]).map(c=>c.id);
            n.clipData=model.remap(n.clipData||model.createData(),idMap);
            (n.clipData.clips||[]).forEach((c,i)=>instanceMap.set(old[i],c.id));
        });
        copies.forEach(n=>{
            if(!n.sourceClipNodeId) return;
            const source=get(n.sourceClipNodeId);
            if(source){n.sourceClipNodeId=source;if(n.sourceClipId)n.sourceClipId=instanceMap.get(n.sourceClipId)||n.sourceClipId;}
            else {delete n.sourceClipNodeId;delete n.sourceClipId;}
            (n.images||[]).forEach(item=>{
                if(typeof item!=='object'||!item.sourceClipNodeId)return;
                if(source){item.sourceClipNodeId=source;if(item.sourceClipId)item.sourceClipId=instanceMap.get(item.sourceClipId)||item.sourceClipId;}
                else {delete item.sourceClipNodeId;delete item.sourceClipId;}
            });
        });
    }
    function create(adapter){
        const model=adapter.model||(typeof window!=='undefined'?window.CanvasClipModel:require('./canvas-clip-model.js'));
        const histories=new Map(),pendingSync=new Map();
        const state=()=>adapter.getState();
        const getContext=()=>({canvasId:state().canvas?.id||'',generation:state().generation});
        const key=(id,ctx=getContext())=>JSON.stringify([ctx.canvasId,ctx.generation,id]);
        const getNode=id=>state().nodes.find(n=>n.id===id);
        const readOnly=()=>Boolean(state().canvas?.readOnly||state().canvas?.readonly);
        const isCurrent=(ctx,id)=>ctx?.canvasId===state().canvas?.id&&ctx.generation===state().generation&&Boolean(getNode(id));
        function commit(id,data,options={}){
            const node=getNode(id);
            if(readOnly()||node?.type!=='clip')return false;
            const next=clone(data),old=node.clipData||model.createData();
            if(JSON.stringify(old)===JSON.stringify(next))return true;
            if(options.history!==false){
                const k=key(id),history=histories.get(k)||{undo:[],redo:[]};
                history.undo.push(clone(old));if(history.undo.length>50)history.undo.shift();history.redo=[];histories.set(k,history);
                adapter.pushUndo();
            }
            node.clipData=next;adapter.save();adapter.render();return true;
        }
        function undo(id,redo=false){
            const node=getNode(id),history=histories.get(key(id));
            if(!node||readOnly()||!history)return false;
            const from=redo?history.redo:history.undo,to=redo?history.undo:history.redo;
            if(!from.length)return false;
            to.push(clone(node.clipData));const data=from.pop();
            adapter.pushUndo();node.clipData=data;adapter.save();adapter.render();return true;
        }
        function output(id,results,context){
            if(!isCurrent(context,id)||readOnly())return false;
            const source=getNode(id),valid=results.filter(r=>r?.url&&Number(r.durationSeconds)>0);
            if(!valid.length)return false;
            adapter.pushUndo();
            valid.forEach((result,i)=>{
                const sourceClipId=result.sourceClipId||null;
                let out=state().nodes.find(n=>n.type==='output'&&n.sourceClipNodeId===id&&(n.sourceClipId||null)===sourceClipId);
                if(!out){
                    out={id:adapter.uid('clip-output'),type:'output',x:source.x+(source.w||760)+70,y:source.y+i*250,w:460,images:[],sourceClipNodeId:id,sourceClipId};
                    state().nodes.push(out);
                }
                out.images=[{url:result.url,kind:'video',mediaKind:'video',durationSeconds:result.durationSeconds,name:result.name||'剪辑成片',sourceClipNodeId:id,sourceClipId}];
                if(!state().connections.some(c=>c.from===id&&c.to===out.id))state().connections.push({id:adapter.uid('c'),from:id,to:out.id});
            });
            adapter.save();adapter.render();return true;
        }
        function forNode(id){
            return {
                getContext,isCurrent,readOnly,scale:()=>state().scale||1,getNode,
                commit,undo:()=>undo(id),redo:()=>undo(id,true),output,
                select:()=>adapter.select(id),deleteNode:()=>adapter.deleteNode?.(id),
                listMedia:()=>adapter.listMedia(),upload:file=>adapter.upload(file),
                download:(url,name)=>adapter.download(url,name),refreshIcons:()=>adapter.refreshIcons?.(),
            };
        }
        async function syncConnected(){
            if(readOnly())return;
            const context=getContext(),s=state();
            for(const node of s.nodes.filter(n=>n.type==='clip')){
                const k=key(node.id,context);if(pendingSync.has(k))continue;
                const media=s.connections.filter(c=>c.to===node.id).flatMap(c=>mediaForNode(s.nodes.find(n=>n.id===c.from),s.nodes));
                const current=node.clipData||model.createData();
                if(JSON.stringify(model.syncSources(current,media))===JSON.stringify(current))continue;
                const work=(async()=>{
                    const resolved=[];
                    for(const m of media){
                        if(m.kind==='video'&&!m.durationSeconds&&adapter.probeDuration){m.durationSeconds=await adapter.probeDuration(m.url);}
                        resolved.push(m);
                    }
                    if(!isCurrent(context,node.id))return;
                    // 连线/素材可能在探测过程中被删掉；只导入仍存在的来源。
                    const latest=state(),active=latest.connections.filter(c=>c.to===node.id).flatMap(c=>mediaForNode(latest.nodes.find(n=>n.id===c.from),latest.nodes));
                    // 探测期间可能有新的输出结果到达；补探测并纳入同一批同步，避免局部刷新被 pendingSync 丢掉。
                    const resolvedKeys=new Set(resolved.map(m=>JSON.stringify([m.sourceNodeId,m.sourceResultId,m.url])));
                    for(const m of active){
                        const key=JSON.stringify([m.sourceNodeId,m.sourceResultId,m.url]);
                        if(resolvedKeys.has(key))continue;
                        if(m.kind==='video'&&!m.durationSeconds&&adapter.probeDuration)m.durationSeconds=await adapter.probeDuration(m.url);
                        resolved.push(m);resolvedKeys.add(key);
                    }
                    const allowed=new Set(active.map(m=>JSON.stringify([m.sourceNodeId,m.sourceResultId,m.url])));
                    const data=model.syncSources(getNode(node.id).clipData||model.createData(),resolved.filter(m=>allowed.has(JSON.stringify([m.sourceNodeId,m.sourceResultId,m.url]))));
                    commit(node.id,data,{history:false});
                })();
                pendingSync.set(k,work);work.catch(error=>adapter.onError?.(error)).finally(()=>pendingSync.delete(k));
            }
        }
        return {forNode,syncConnected,getContext,isCurrent,commit,remapCopies:(list,map)=>remapCopies(list,map,model)};
    }
    return {create,mediaForNode,collectUrls,remapCopies};
});
