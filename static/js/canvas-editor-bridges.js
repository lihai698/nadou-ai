/* Canvas editor integrations. Owns bridge closures, duration cache and pointer listener.
 * Hosts supply live canvas state and existing editor operations; no storage or provider ownership. */
(function(root){
'use strict';
function create(h){
    const listeners=[];let suspended=false,disposed=false;
    function listen(type,fn,options){
        if(disposed)return;
        listeners.push({type,fn,options});
        if(!suspended)h.document.addEventListener(type,fn,options);
    }
    function suspend(){
        if(suspended||disposed)return;
        suspended=true;
        for(const {type,fn,options}of listeners)h.document.removeEventListener(type,fn,options);
    }
    function resume(){
        if(!suspended||disposed)return;
        suspended=false;
        for(const {type,fn,options}of listeners)h.document.addEventListener(type,fn,options);
    }
    function dispose(){suspend();disposed=true;listeners.length=0;}
function canvasClipMediaItems(canvasNodes, libraryItems=[], localItems=[]){
    const current = (canvasNodes || []).flatMap(node => h.window.CanvasClipHost?.mediaForNode?.(node, canvasNodes) || []);
    const all = [...current, ...(libraryItems || []), ...(localItems || [])];
    const unique = new Map();
    for(const item of all){
        const url = item?.url || item?.renderUrl;
        if(!url) continue;
        const kind = item.kind || h.mediaKindForOutputItem(item);
        if(!['image','video'].includes(kind)) continue;
        if(unique.has(url)) continue;
        unique.set(url, {
            ...item,
            kind, url,
            name: item.name || h.outputImageName(url),
            posterUrl: item.posterUrl || item.thumbnail || item.poster || '',
            durationSeconds: item.durationSeconds || item.duration,
            sourceResultId: item.sourceResultId || item.id || url,
        });
    }
    return [...unique.values()];
}

function initCanvasVideoDeconstructionBridge(){
    if(disposed) return;
    if(!h.window.CanvasVideoDeconstructionHost || h.window.CanvasVideoDeconstructionBridge) return;
    let generation=0;
    const sourceFor=(nodeId,url,title)=>{
        const n=h.nodes.find(n=>n.id===nodeId);
        const item=h.window.CanvasClipHost.mediaForNode(n,h.nodes).find(x=>x.kind==='video'&&x.url===url);
        return item ? {canvasId:h.canvas?.id,nodeId,resultId:item.sourceResultId,sourceUrl:item.url,title:title||item.name} : null;
    };
    const bridge=h.window.CanvasVideoDeconstructionHost.create({
        getState:()=>({canvas:h.canvas,nodes:h.nodes,connections:h.connections,generation,scale:h.viewport.scale}),
        inputMedia:n=>h.mediaRefsFromNode(n),
        inputPreview:v=>v.kind==='audio'?'<span class="input-thumb-audio" title="音频请先转写为文本">♫</span>':v.kind==='video'?h.canvasVideoPreviewHtml(v.url,256):h.canvasPreviewImgHtml(v.url,256),
        uid:h.uid,pushUndo:h.pushUndo,save:h.scheduleSave,render:h.render,
        readSource:source=>sourceFor(source.nodeId,source.sourceUrl)?.resultId===source.resultId?source:null,
        analysisSource:table=>{const item=bridge.inputs(table.id).find(v=>v.kind==='video');return item?sourceFor(item.nodeId,item.url,item.name):null;},
        select:ids=>{h.selected.clear();ids.forEach(id=>h.selected.add(id));h.refreshSelectionVisuals();},
        defaultImageSettings:()=>{const s=h.canvasAssistantCreationSettings();return {...s,providerId:s.provider_id};},
        defaultVideoSettings:()=>h.canvasAssistantCreationSettings(),
        nodeWidth:n=>Math.max(h.nodeRect(n).w,n.w||h.defaultNodeSize(n.type).w||0),
        rowSpacing:1000,
        nodeBounds:n=>h.nodeRect(n),
        separateShotNodes:true,
        createGenerationChain:({row,promptText,table,id,settings,x,y,uid:makeId})=>{
            const origin={tableId:id,rowId:row.id,stage:'image',sourceFingerprint:table.shotTableData.source.fingerprint,durationSeconds:row.durationSeconds,motionPrompt:row.motionPrompt||row.cells.motion||''};
            const prompt={id:makeId('prompt'),type:'prompt',x,y,w:320,h:260,text:promptText,name:`镜头 ${row.index} · 图片提示词`,shotTableOrigin:{...origin,role:'prompt'}};
            const generator={id:makeId('gen'),type:'generator',x:x+416,y,w:380,apiProvider:settings.providerId||'',model:settings.model||'',count:1,ratio:settings.ratio||'square',resolution:settings.resolution||'1k',quality:settings.quality||'auto',inputs:[],shotTableOrigin:{...origin,role:'generator'}};
            const output={id:makeId('out'),type:'output',x:x+892,y,w:360,h:300,images:[],name:`镜头 ${row.index} · 图片结果`,shotTableOrigin:{...origin,role:'result'}};
            return {nodes:[prompt,generator,output],connections:[{id:makeId('c'),from:prompt.id,to:generator.id},{id:makeId('c'),from:generator.id,to:output.id}],promptId:prompt.id,generatorId:generator.id,outputId:output.id};
        },
        videoMedia:n=>h.window.CanvasClipHost.mediaForNode(n,h.nodes),
        prepareShotMedia:async media=>{
            const resolved=[];
            for(const item of media){const durationSeconds=item.durationSeconds||await h.window.CanvasClipBridge.probeDuration(item.url);if(!(durationSeconds>0))throw new Error(`无法读取${item.name}的真实时长，请确认视频可以播放后重试`);resolved.push({...item,durationSeconds});}
            return resolved;
        },
        addShotCollection:({table,media,existing})=>{
            if(existing&&existing.type!=='clip')throw new Error('原剪辑节点已改变，请先核对');
            const collection=existing||{id:h.uid('clip'),type:'clip',x:Math.max(...h.nodes.map(n=>n.x+h.nodeRect(n).w))+96,y:table.y,w:760,h:196,clipData:h.window.CanvasClipModel.createData(),name:'分镜视频剪辑'};
            let data=collection.clipData;for(const item of media)data=h.window.CanvasClipModel.addMedia(data,item);collection.clipData=data;
            if(!existing)h.nodes.push(collection);return collection;
        },
        collectionNotice:'已按镜号加入剪辑时间线。重复整理保留剪辑修改；重新生成的结果作为新片段加入。请预览并调整节奏、对白和声音后导出。',
        validateVideoSettings:s=>h.videoApiProviders().some(p=>p.id===s.videoProvider&&p.enabled!==false&&(p.video_models||[]).includes(s.videoModel)),
        createVideoChain:({row,promptText,id,settings,x,y,uid:makeId,imageNodeId})=>{
            const prompt={id:makeId('prompt'),type:'prompt',x:x-456,y:y+396,w:320,h:260,text:promptText,name:`镜头 ${row.index} · 视频提示词`,shotTableOrigin:{tableId:id,rowId:row.id,stage:'video',role:'prompt'}};
            const output={id:makeId('out'),type:'output',x:x+516,y,w:360,h:300,images:[],name:`镜头 ${row.index} · 视频结果`,shotTableOrigin:{tableId:id,rowId:row.id,stage:'video',role:'result'}};
            const video={id:makeId('vid'),type:'video',x,y,w:420,name:`镜头 ${row.index} · 视频`,apiProvider:settings.videoProvider||'',model:settings.videoModel||'',duration:settings.videoDuration||5,aspectRatio:settings.videoAspect||'16:9',resolution:settings.videoResolution||'',enhancePrompt:!!settings.videoEnhancePrompt,enableUpsample:!!settings.videoEnableUpsample,watermark:!!settings.videoWatermark,cameraFixed:!!settings.videoCameraFixed,generateAudio:!!settings.videoGenerateAudio,multimodal:!!settings.videoMultimodal,useFrameRoles:!!settings.videoUseFrameRoles,inputs:[],tempShLinks:[],running:false,shotTableOrigin:{tableId:id,rowId:row.id,stage:'video',role:'generator',imageNodeId,durationSeconds:row.durationSeconds,startSeconds:row.startSeconds,endSeconds:row.endSeconds}};
            return {nodes:[prompt,video,output],connections:[{id:makeId('c'),from:imageNodeId,to:video.id},{id:makeId('c'),from:prompt.id,to:video.id},{id:makeId('c'),from:video.id,to:output.id}],promptId:prompt.id,generatorId:video.id,outputId:output.id};
        },
        focus:ids=>h.CanvasViewport.fitAllNodesViewport(h.classicViewportHost(),ids),
        validateImageSettings:s=>h.imageApiProviders().some(p=>p.id===s.providerId&&p.enabled!==false&&(p.image_models||[]).includes(s.model)),
        runGenerators:async ids=>{
            const owner=h.canvas?.id,epoch=generation;
            // 原生级联执行有自己的任务、并发和恢复，不另起生图接口。
            for(const id of ids){if(h.canvas?.id!==owner||generation!==epoch)break;await h.runNodeCascade(id);}
        }
    });
    const begin=bridge.begin;bridge.begin=()=>{generation++;begin();};
    bridge.sourceFor=sourceFor;bridge.saveNow=h.saveCanvas;bridge.onError=e=>{const message=e.message||'分镜表操作失败';h.setStatus(message);h.window.alert?.(message);};bridge.onNotice=text=>h.setStatus(text);
    h.window.CanvasVideoDeconstructionBridge=bridge;
}

function initCanvasClipBridge(){
    if(disposed) return;
    if(!h.window.CanvasClipHost || h.window.CanvasClipBridge) return;
    let generation=0;
    const durations=new Map();
    const probeDuration=url=>{
        if(durations.has(url)) return durations.get(url);
        const work=new Promise(resolve=>{
            const video=h.document.createElement('video');
            let settled=false;
            const finish=value=>{
                if(settled)return;settled=true;h.clearTimeout(timer);
                video.onloadedmetadata=null;video.onerror=null;video.removeAttribute('src');video.load();resolve(value);
            };
            const timer=h.setTimeout(()=>finish(undefined),8000);
            video.preload='metadata';video.muted=true;
            video.onloadedmetadata=()=>finish(Number.isFinite(video.duration)&&video.duration>0?video.duration:undefined);
            video.onerror=()=>finish(undefined);video.src=url;
        });
        durations.set(url,work);return work;
    };
    const bridge=h.window.CanvasClipHost.create({
        getState:()=>({canvas:h.canvas,nodes:h.nodes,connections:h.connections,generation,scale:h.viewport.scale}),
        uid:h.uid,pushUndo:h.pushUndo,save:h.scheduleSave,render:h.render,probeDuration,
        onError:error=>h.setStatus(`剪辑素材同步失败：${error.message}`),
        select:id=>{h.selected.clear();h.selected.add(id);h.nodesEl.querySelectorAll('.node').forEach(el=>el.classList.toggle('selected',el.dataset.id===id));},
        deleteNode:id=>h.deleteNode(id),refreshIcons:h.refreshIcons,download:h.downloadUrl,
        listMedia:async()=>{
            const loaded=await h.loadCanvasAssetLibrary({renderPanel:false});
            if(!loaded)throw new Error('资产库加载失败，请重试');
            const libraryItems=h.canvasAssetLibraries().flatMap(lib=>(lib.categories||[]).flatMap(cat=>cat.items||[]));
            return canvasClipMediaItems(h.nodes, libraryItems, h.localCanvasAssetLibrary.items || []);
        },
        upload:async file=>{
            const kind=h.mediaKindForUpload(file);
            if(!['image','video'].includes(kind))throw new Error('剪辑节点只接收图片和视频');
            const form=new h.FormData();form.append('files',file,file.name);
            const response=await h.fetch('/api/local-assets/upload',{method:'POST',body:form});
            const result=await response.json().catch(()=>({}));
            if(!response.ok)throw new Error(result.detail||'素材上传失败');
            const item=result.files?.[0];if(!item?.url)throw new Error('上传未返回有效素材，请重试');
            return {kind,url:item.url,name:item.name||file.name,posterUrl:item.thumbnail||'',durationSeconds:item.durationSeconds||item.duration,sourceResultId:item.id||item.url};
        },
    });
    bridge.begin=()=>{generation++;h.window.CanvasClipNode?.reconcile(bridge.getContext(),[]);};
    bridge.probeDuration=probeDuration;
    h.window.CanvasClipBridge=bridge;
    listen('pointerdown',event=>{
        if(!event.target.closest('.clip-node,.clip-panel'))h.window.CanvasClipNode?.closeAll();
    },true);
}

function initSmartVideoDeconstructionBridge(){
    if(disposed) return;
    if(!h.window.CanvasVideoDeconstructionHost || h.window.CanvasVideoDeconstructionBridge) return;
    let generation=0;
    const sourceFor=(nodeId,index,url,title)=>{
        const node=h.nodes.find(item=>item.id===nodeId);
        const item=h.imageForDisplay(node?.images?.[index]);
        if(!node || !item?.url || item.url!==url || h.mediaKindForItem(item)!=='video') return null;
        return {canvasId:h.canvasId,nodeId,resultId:item.id||item.resultId||item.url,sourceUrl:item.url,title:title||item.name||'视频'};
    };
    const bridge=h.window.CanvasVideoDeconstructionHost.create({
        tableType:'smart-shot-table',
        getState:()=>({canvas:h.canvas ? {...h.canvas,id:h.canvasId} : {id:h.canvasId},nodes:h.nodes,connections:h.canvas?.connections||[],generation,scale:h.viewport.scale}),
        uid:h.uid,
        pushUndo:h.pushUndo,
        save:()=>h.saveCanvas(),
        render:h.render,
        landFrames:(ctx,result)=>{
            const operation=result.operationId||result.id;
            let group=h.nodes.find(n=>n.frameGroupOperationId===operation);
            const prior=new Set((group?.images||[]).map(item=>item.frameIndex));
            const fresh=(result.frames||[]).filter(f=>f.url&&!prior.has(f.index));
            if(!fresh.length)return [];
            h.pushUndo();
            if(!group){const rect=h.nodeRect(ctx.sourceNode);group={id:h.uid('group'),type:'smart-group',title:`拆自${ctx.source.title||'视频'}`,x:rect.x+rect.width+96,y:rect.y,items:[],images:[],scale:1,frameGroupOperationId:operation,created_at:Date.now()};h.nodes.push(group);}
            const images=fresh.map(f=>({url:f.url,name:`${ctx.source.title||'视频'}·${h.window.CanvasVideoDeconstructionModel.formatTime(f.seconds||0)}`,kind:'image',frameIndex:f.index,frameOperationId:operation}));
            group.images.push(...images);
            group.w=Math.min(4,group.images.length)*292+16;
            group.h=Math.ceil(group.images.length/4)*222+60;
            h.selectedId=group.id;h.selectedIds=[];h.selectedImage={nodeId:'',index:-1};
            h.saveCanvas();h.render();return images;
        },
        readSource:source=>{const node=h.nodes.find(item=>item.id===source.nodeId);const index=(node?.images||[]).findIndex(item=>{const value=h.imageForDisplay(item);return value?.url===source.sourceUrl&&(value.id||value.resultId||value.url)===source.resultId;});return index>=0?sourceFor(source.nodeId,index,source.sourceUrl,source.title):null;},
        inputMedia:n=>(n.images||[]).map(h.imageForDisplay).filter(v=>v?.url).map(v=>({...v,kind:h.mediaKindForItem(v)})),
        inputPreview:v=>v.kind==='audio'?'<span class="input-thumb-audio" title="音频请先转写为文本">♫</span>':v.kind==='video'?h.smartVideoPreviewHtml(v,256):h.smartPreviewImgHtml(v,256),
        analysisSource:table=>{const item=bridge.inputs(table.id).find(v=>v.kind==='video');if(!item)return null;const n=h.nodes.find(n=>n.id===item.nodeId),index=(n?.images||[]).findIndex(v=>h.imageForDisplay(v)?.url===item.url);return index>=0?sourceFor(n.id,index,item.url):null;},
        select:ids=>{h.selectedIds=ids.slice();h.selectedId=ids.length===1?ids[0]:'';h.selectedImage={nodeId:'',index:-1};h.syncSelectionUi?.();},
        defaultImageSettings:()=>{const s=h.smartSettingsForNode();return s.engine==='api'&&s.apiKind!=='video'?{...s,providerId:s.provider_id}:{};},
        defaultVideoSettings:()=>{const s=h.smartSettingsForNode();return s.engine==='api'?s:{};},
        nodeWidth:n=>h.nodeRect(n).width,
        rowSpacing:540,
        nodeBounds:n=>h.nodeRect(n),
        videoMedia:n=>(n.images||[]).map(h.imageForDisplay).filter(item=>item?.url&&h.mediaKindForItem(item)==='video').map(item=>({...item,kind:'video',sourceNodeId:n.id,sourceResultId:item.id||item.resultId||item.url})),
        addShotCollection:({table,media,existing})=>{
            if(existing&&existing.type!=='smart-group')throw new Error('原镜头分组已改变，请先核对');
            const collection=existing||{id:h.uid('group'),type:'smart-group',x:Math.max(...h.nodes.map(n=>n.x+h.nodeRect(n).width))+96,y:table.y,w:900,h:320,title:'所选镜头视频 · 按镜号整理',items:[],images:[],scale:1,created_at:Date.now()};
            collection.images=collection.images||[];for(const item of media){const key=JSON.stringify([item.rowId,item.url,item.sourceResultId]);if(!collection.images.some(i=>i.shotResultKey===key))collection.images.push({...item,shotResultKey:key});}
            if(!existing)h.nodes.push(collection);return collection;
        },
        collectionNotice:'已按镜号整理到视频分组，可预览及批量下载。智能画布当前没有剪辑时间线；剪辑与成片导出请使用普通画布的剪辑节点。',
        validateVideoSettings:s=>h.videoApiProviders().some(p=>p.id===s.videoProvider&&p.enabled!==false&&h.providerVideoModels(s.videoProvider).includes(s.videoModel)),
        setVideoPrompt:(node,text)=>h.setPromptDraftForNode(node,text),
        setImagePrompt:(node,text)=>h.setPromptDraftForNode(node,text),
        createVideoChain:({row,promptText,id,table,settings,x,y,uid:makeId,imageNodeId})=>{
            const video={id:makeId('smart'),type:'smart-image',x,y,w:316,h:260,promptDraftText:promptText,promptDraftHtml:h.escapeHtml(promptText),promptDraftTouched:true,title:`镜头 ${row.index} · 视频`,images:[],runSettings:{...h.cloneSmartSettings(h.initialSmartSettings),...settings,engine:'api',apiKind:'video',videoProvider:settings.videoProvider||'',videoModel:settings.videoModel||'',count:1},shotTableOrigin:{tableId:id,rowId:row.id,sourceFingerprint:table.shotTableData.source.fingerprint||table.shotTableData.source.sourceUrl,stage:'video',inlineOutput:true,imageNodeId,durationSeconds:row.durationSeconds,startSeconds:row.startSeconds,endSeconds:row.endSeconds},created_at:Date.now()};
            return {nodes:[video],connections:[{from:imageNodeId,to:video.id,kind:'input'}],promptId:video.id,generatorId:video.id,outputId:video.id};
        },
        focus:ids=>h.SmartViewport.fitAllNodesViewport(h.smartViewportHost(),ids),
        validateImageSettings:s=>{const provider=(h.imageProviders?.()||[]).find(p=>p.id===s.providerId);return !!provider && provider.enabled!==false && (h.providerImageModels?.(s.providerId)||[]).includes(s.model);},
        createGenerationChain:({row,promptText,table,id,settings,x,y,uid:makeId,creationOnly})=>{
            const image={id:makeId('smart'),type:'smart-image',x:creationOnly?x:x+380,y,w:316,h:260,title:`镜头 ${row.index} · 画面`,images:[],runSettings:{...h.cloneSmartSettings(h.initialSmartSettings),...settings,engine:'api',apiKind:'image',provider_id:settings.providerId||'',model:settings.model||'',ratio:settings.ratio||'square',resolution:settings.resolution||'1k',quality:settings.quality||'auto',count:1},shotTableOrigin:{tableId:id,rowId:row.id,sourceFingerprint:table.shotTableData.source.fingerprint||table.shotTableData.source.sourceUrl,durationSeconds:row.durationSeconds,motionPrompt:row.motionPrompt||row.cells.motion||''},created_at:Date.now()};
            if(creationOnly){h.setPromptDraftForNode(image,promptText??(row.imagePrompt||row.cells.visual||''));Object.assign(image.shotTableOrigin,{stage:'image',inlineOutput:true});return {nodes:[image],connections:[],promptId:image.id,generatorId:image.id,outputId:image.id};}
            const prompt={id:makeId('prompt'),type:'smart-prompt',x,y,w:316,h:210,title:'Prompt',text:promptText??(row.imagePrompt||row.cells.visual||''),promptSeparator:';',promptSplitEnabled:false,llmEnabled:false,created_at:Date.now()};
            return {nodes:[prompt,image],connections:[{from:prompt.id,to:image.id,kind:'input'}],promptId:prompt.id,generatorId:image.id,outputId:image.id};
        },
        runGenerators:async ids=>{
            const owner=h.canvasId,epoch=generation;
            for(const id of ids){if(h.canvasId!==owner||generation!==epoch)break;const node=h.nodes.find(item=>item.id===id);if(!node)continue;h.selectedId=id;h.selectedIds=[];h.selectedImage={nodeId:'',index:-1};await h.runGeneration({shotTableRun:true});}
        }
    });
    const begin=bridge.begin;bridge.begin=()=>{generation++;begin();};
    bridge.sourceFor=sourceFor;bridge.saveNow=async()=>{for(let attempt=0;attempt<8;attempt++){if(await h.saveCanvas())return true;await new Promise(resolve=>h.setTimeout(resolve,220));}return false;};bridge.onError=e=>h.toast(e.message||'视频拆解操作失败');bridge.onNotice=text=>h.toast(text);
    h.window.CanvasVideoDeconstructionBridge=bridge;
}
    return {canvasClipMediaItems,initCanvasVideoDeconstructionBridge,initCanvasClipBridge,initSmartVideoDeconstructionBridge,suspend,resume,dispose};
}
const api={create};if(typeof module!=='undefined'&&module.exports)module.exports=api;root.CanvasEditorBridges=api;
})(typeof globalThis!=='undefined'?globalThis:window);
