/* Native assistant editor transactions for both canvases. Hosts expose live editor state;
 * CanvasAssistant owns its UI controller, listeners, cancellation and remount cleanup. */
(function(root){
'use strict';
function mountClassic(h){
    const nativeEditor=h.window.CanvasAssistantNative?.createEditor({
            getState:()=>({id:h.canvas?.id,kind:'classic',updatedAt:Number(h.canvas?.updated_at||0),nodes:h.nodes,connections:h.connections,readOnly:!!h.canvas?.readOnly}),
            getSnapshot:()=>({nodes:h.serializableCanvasNodes(),connections:h.connections}),
            save:()=>h.saveCanvasAssistantSnapshot(),pushUndo:()=>h.pushUndo(),render:()=>h.render(),clipModel:h.window.CanvasClipModel,setGroupMembers:h.setCanvasGroupMembers,setWorkflowParameters:h.setCanvasWorkflowParameters,
            exportWorkflow:typeof h.canvasAssistantExportWorkflow==='function'?h.canvasAssistantExportWorkflow:null,
            deliverMediaExport:async(node,results,destination)=>{
                if(destination==='download'){for(const r of results)await h.downloadUrl(r.url,r.name||'export.mp4');}
                else {const host=h.window.CanvasClipBridge?.forNode(node.id);if(!host||!host.output(node.id,results,host.getContext()))throw new Error('原生剪辑输出未接入画布');}
            },
            runNode:(node,options)=>node.type==='msgen'?h.runMsGenNode(node.id,options):node.type==='midjourney'?h.runMidjourneyNode(node.id,options):node.type==='comfy'?h.runComfyNode(node.id,options):node.type==='rh'?h.runRhNode(node.id,options):node.type==='video'?h.runVideoNode(node.id,options):h.runGenerator(node.id,options),
            runLLMNode:(node,options)=>h.runLLMNode(node.id,options),
            connectNodes:(from,to)=>{if(!h.canConnect(from,to)||h.wouldCreateGeneratorCycle(from,to))return false;if(!h.connections.some(c=>c.from===from&&c.to===to))h.connections.push({id:h.uid('c'),from,to});h.syncGeneratorInputs();h.refreshGeneratorInputViews();return true;},
            applyTask:(node,task,kind)=>{
                if(kind==='depth')return h.updateCanvasDepthCapture(h.canvasDepthPair(node),task,node.depthCapture.operationId);
                if(kind==='video'){
                    const id=task.task_id||task.id;
                    if(task.status==='succeeded')return h.completeCanvasVideoTask(id,task.result||task);
                    const found=h.findPendingTask(id);
                    if(!found)return false;
                    if(['failed','cancelled','canceled'].includes(task.status)){found.pending.failed=true;found.pending.error=task.error||'原视频任务未成功';h.refreshRunNodes(node,found.out);return true;}
                    return false;
                }
                if(kind==='comfy'){
                    const id=task.task_id||task.id;
                    if(task.status==='succeeded'){
                        if(!h.findPendingTask(id))return false;
                        h.completeCanvasComfyTask(id,task.result || task);
                        return !h.findPendingTask(id);
                    }
                    if(task.status==='failed'){
                        const found=h.findPendingTask(id);
                        if(!found)return false;
                        found.pending.error=task.error||'原生 ComfyUI 任务失败';
                        found.pending.failed=true;
                        h.refreshRunNodes(node,found.out);h.scheduleSave();
                        return true;
                    }
                    return false;
                }
                const id=task.task_id||task.id;
                if(task.status==='succeeded'){
                    const images=h.resultMediaUrls(task.image_items?.length?task.image_items:task).map(item=>kind==='video'?(typeof item==='string'?{url:item,kind:'video'}:{...item,kind:item.kind||'video'}):item);
                    if(!images.length)throw new Error('原任务成功但没有可回填的媒体结果');
                    const direct=(node._directPending||[]).filter(p=>p.canvasTaskId===id);
                    if(direct.length)h.materializeCanvasDirectTasks(node,direct);
                    if(!h.findPendingTask(id))return false;
                    h.completeCanvasImageTask(id,{...task,images});
                    return !h.findPendingTask(id);
                }else if(task.status==='failed'){
                    const direct=(node._directPending||[]).filter(p=>p.canvasTaskId===id);
                    if(direct.length)h.materializeCanvasDirectTasks(node,direct);
                    if(!h.findPendingTask(id))return false;
                    h.failCanvasImageTask(id,task.error||'原任务失败',task);
                }
            },
            applyFields:(node,patch)=>{if(node.type==='generator')h.setCanvasGeneratorSizeFields(node,patch);else if(node.type==='msgen')h.setCanvasMsSizeFields(node,patch);else Object.assign(node,patch);},
            createNode:type=>h.createNodeByType(type,h.defaultPoint(0,0)),
            shotHost:()=>h.window.CanvasVideoDeconstructionBridge,shotModel:h.window.CanvasVideoDeconstructionModel,
            check:proposal=>proposal.check(),
        });
        return h.window.CanvasAssistant?.mount({
            kind:'classic',
            getContext:()=>h.canvas ? {id:h.canvas.id,title:h.canvas.title,updatedAt:Number(h.canvas.updated_at||0),nodes:h.nodes,selectedNodeIds:[...h.selected],creationSettings:h.canvasAssistantCreationSettings()} : null,
            save:()=>h.saveCanvasAssistantSnapshot(),
            refresh:()=>h.syncRemoteCanvasNow(),
            prepareImageRequest:h.canvasAssistantImageRequest,
            generateImage:h.canvasAssistantGenerateImage,
            nativeSnapshot:()=>nativeEditor?.snapshot(),
            executeNativeAction:proposal=>nativeEditor.execute(proposal),
            syncNativeTask:proposal=>nativeEditor.syncTask(proposal),
            referencePreview:(item,size)=>item.kind==='video' ? h.canvasVideoPreviewHtml(item.url,size,'preload="none"') : h.canvasPreviewImgHtml(item.thumbnail||item.url,size,'loading="lazy" draggable="false"'),
            bindReferencePreviews:element=>h.bindCanvasPreviewImageFallbacks(element),
            openPromptTemplates:async callback=>{h.canvasAssistantTemplateCallback=callback;await h.openPromptTemplateModal('');},
            addTextNode:async text=>{const node=h.addPromptNode(h.defaultPoint(0,0));if(!node)return false;node.text=String(text||'');h.render();h.scheduleSave();return true;},
            addImageNode:async (url,name,kind)=>{if(!url)return false;h.createImageCardFromUrl(url,h.defaultPoint(0,0),name||'助手图片',kind);return h.saveCanvas();},
            viewChanges:async ids=>{
                await h.syncRemoteCanvasNow();
                const affected=h.nodes.filter(node=>ids.includes(node.id));
                if(!affected.length)return false;
                h.selected=new Set(affected.map(node=>node.id));h.render();h.fitAllNodesViewport();return true;
            },
        });
}

function mountSmart(h){
    const nativeEditor=h.window.CanvasAssistantNative?.createEditor({
        getState:()=>({id:h.canvasId,kind:'smart',updatedAt:Number(h.canvas?.updated_at||0),nodes:h.nodes,connections:h.canvas?.connections||[],readOnly:!!h.canvas?.readOnly}),
        getSnapshot:()=>({nodes:h.canvasForStorage().nodes,connections:h.canvas?.connections||[]}),
        save:()=>h.saveCanvas(),pushUndo:()=>h.pushUndo(),render:()=>h.render(),setLoopPrompts:h.setSmartLoopPromptFieldValues,setGroupMembers:h.setSmartGroupMemberIds,
        exportWorkflow:typeof h.smartCanvasAssistantExportWorkflow==='function'?h.smartCanvasAssistantExportWorkflow:null,
        connectNodes:h.connectInputNode,
        runLLMNode:(node,options)=>h.runPromptLLMNode(node.id,options),
        runNode:(node,options)=>node?.type==='smart-loop' ? h.runSmartAssistantNativeLoop(node,options) : h.runGeneration({...options,assistantNativeNodeId:node.id}),
        validateLoopSlots:(node,proposal)=>h.validateSmartAssistantLoopSlots(node,proposal),
        applyTask:async(node,task,kind)=>{

            if(kind==='depth')return h.updateSmartDepthCapture(h.smartDepthPair(node),task,node.depthCapture.operationId);
            const id=task.task_id||task.id;
            if(task.status==='succeeded'){
                const outputs=h.resultMediaUrls(task.image_items?.length?task.image_items:task);
                if(!outputs.length)throw new Error('原任务成功但没有可回填的媒体结果');
                h.finalizeSmartPendingTask(node,id,outputs,kind);h.render();
            }else if(task.status==='failed'){
                const pending=h.smartPendingTasks(node).find(p=>p.taskId===id);
                if(pending){pending.querying=false;await h.resumeSmartPendingNode(node,{},id);}
            }
        },
        shotHost:()=>h.window.CanvasVideoDeconstructionBridge,shotModel:h.window.CanvasVideoDeconstructionModel,
        applyFields:(node,patch)=>{const fields={...patch};if(Object.hasOwn(fields,'promptDraftText')){h.setPromptDraftForNode(node,fields.promptDraftText);delete fields.promptDraftText;}Object.assign(node,fields);},
        createNode:type=>{const point={x:(h.viewport?.x||0)+120,y:(h.viewport?.y||0)+120};
            if(type==='smart-image')return h.createImageNodeAt(point);
            const factory={'smart-prompt':h.createPromptNode,'smart-loop':h.createLoopNode,'smart-group':h.createSmartGroupNode}[type];
            return factory?.(point.x,point.y);},
        check:proposal=>proposal.check(),
    });
    return h.window.CanvasAssistant?.mount({
        kind:'smart',
        getContext:()=>h.canvas ? {id:h.canvasId,title:h.canvas.title,updatedAt:Number(h.canvas.updated_at||0),nodes:h.nodes,selectedNodeIds:h.selectedNodeIds(),creationSettings:h.smartAssistantCreationSettings()} : null,
        save:()=>h.saveCanvas(),
        refresh:()=>h.mergeReloadCanvasNow(),
        prepareImageRequest:h.smartAssistantImageRequest,
        generateImage:h.smartAssistantGenerateImage,
        nativeSnapshot:()=>nativeEditor?.snapshot(),
        executeNativeAction:proposal=>nativeEditor.execute(proposal),
        resumeNativeLoop:proposal=>nativeEditor.resumeLoop(proposal),
        syncNativeTask:proposal=>nativeEditor.syncTask(proposal),
        referencePreview:(item,size)=>item.kind==='video' ? h.smartVideoPreviewHtml(item,size,'preload="none"') : h.smartPreviewImgHtml(item.thumbnail||item.url,size,'loading="lazy" draggable="false"'),
        bindReferencePreviews:element=>h.bindSmartPreviewImageFallbacks(element),
        openPromptTemplates:async callback=>{h.canvasAssistantTemplateCallback=callback;await h.openPromptTemplatePanel('', '', {target:'assistant'});},
        addTextNode:async text=>{const node=h.createPromptNode((h.viewport?.x||0)+120,(h.viewport?.y||0)+120);if(!node)return false;node.text=String(text||'');h.render();h.scheduleSave();return true;},
        addImageNode:async (url,name,kind)=>{if(!url)return false;h.createNode((h.viewport?.x||0)+120,(h.viewport?.y||0)+120,[{url,name:name||'助手图片',kind:kind||'image'}],{select:true});return h.saveCanvas();},
        viewChanges:async ids=>{
            await h.mergeReloadCanvasNow();
            const affected=h.nodes.filter(node=>ids.includes(node.id));
            if(!affected.length)return false;
            h.selectedIds=affected.map(node=>node.id);h.selectedId=affected[0].id;h.render();h.fitAllNodesViewport();return true;
        },
    });
}
const api={mountClassic,mountSmart};
if(typeof module!=='undefined'&&module.exports)module.exports=api;root.CanvasAssistantEditor=api;
})(typeof globalThis!=='undefined'?globalThis:window);
