/* Node editing responsibility: canvas-node-edit. Host supplies live state and effects. */
(function(root){
    'use strict';

    function addNode(deps, node){
        if(!deps.ensureCanvas()) return;
        deps.nodes.push(node);
        deps.render();
        deps.scheduleSave();
        return node;
    }

    function addImageNode(deps, point){
        const p = point || deps.defaultPoint(-120, 0);
        return addNode(deps, {id:deps.uid('img'), type:'image', x:p.x, y:p.y, url:'', name:'空白图片'});
    }

    function addClipNode(deps, point){
        const p = point || deps.defaultPoint(-300, 0);
        return addNode(deps, {id:deps.uid('clip'),type:'clip',x:p.x,y:p.y,w:760,h:196,clipData:deps.window.CanvasClipModel.createData()});
    }

    function addPromptNode(deps, point){
        const p = point || deps.defaultPoint(0, 0);
        return addNode(deps, {id:deps.uid('prompt'), type:'prompt', x:p.x, y:p.y, text:''});
    }

    function addLoopNode(deps, point){
        const p = point || deps.defaultPoint(40, 0);
        return addNode(deps, {
            id:deps.uid('loop'),
            type:'loop',
            x:p.x,
            y:p.y,
            count:3,
            mode:'serial',
            showPrompt:false,
            imageInput:false,
            videoInput:false,
            loopStart:1,
            imageBatchSize:1,
            videoBatchSize:1,
            variablePrompt:'',
            fixedPrompt:''
        });
    }

    function addGroupNode(deps, point){
        const p = point || deps.defaultPoint(40, 0);
        return addNode(deps, {id:deps.uid('grp'), type:'group', x:p.x, y:p.y, w:300, h:220, items:[]});
    }

    function addLLMNode(deps, point){
        const p = point || deps.defaultPoint(80, 0);
        const providerId = deps.chatApiProviders()[0]?.id || 'comfly';
        return addNode(deps, {
            id:deps.uid('llm'),
            type:'llm',
            x:p.x,
            y:p.y,
            llmProvider:providerId,
            model:deps.resolveChatModel('', providerId),
            mode:'node',
            systemPrompt:'You are a helpful assistant. Rewrite the input into a concise image prompt.',
            chatInput:'',
            messages:[],
            outputText:'',
            llmInputHeight:110,
            llmOutputHeight:150,
            running:false
        });
    }

    function addGeneratorNode(deps, point){
        const p = point || deps.defaultPoint(120, 0);
        const providerId = deps.imageApiProviders()[0]?.id || '';
        const model = deps.allImageModels(providerId)[0] || '';
        return addNode(deps, {id:deps.uid('gen'), type:'generator', x:p.x, y:p.y, apiProvider:providerId, model, ratio:'square', resolution:deps.defaultApiImageResolution(model), customRatio:'', customSize:'', customRatioWidth:'', customRatioHeight:'', customWidth:'', customHeight:'', inputs:[]});
    }

    function addMidjourneyNode(deps, point){
        const p = point || deps.defaultPoint(140, 0);
        return addNode(deps, {
            id:deps.uid('mj'), type:'midjourney', x:p.x, y:p.y,
            apiProvider:deps.resolveMidjourneyProviderId(''), mode:'imagine', size:'1:1', version:'6.1', speed:'relax',
            inputs:[], running:false, lastTaskId:'', lastAction:'', lastTaskStatus:'', lastImageCount:0, lastPrompt:'', mjModalTaskId:'', mjModalPrompt:''
        });
    }

    function addMsGenNode(deps, point){
        const p = point || deps.defaultPoint(140, 0);
        return addNode(deps, {
            id:deps.uid('msgen'),
            type:'msgen',
            x:p.x,
            y:p.y,
            msgenModel:'zimage',
            msWidth:1024,
            msHeight:1024,
            msCustomModel:deps.modelscopeImageModels()[0] || 'Tongyi-MAI/Z-Image-Turbo',
            msRatio:'square',
            msResolution:'1k',
            msCustomRatio:'',
            msCustomSize:'',
            msCustomRatioWidth:'',
            msCustomRatioHeight:'',
            msCustomWidth:'',
            msCustomHeight:'',
            count:1,
            fitImage:false,
            inputs:[],
            running:false
        });
    }

    function addVideoNode(deps, point){
        const p = point || deps.defaultPoint(160, 0);
        const providerId = deps.videoApiProviders()[0]?.id || 'comfly';
        const models = deps.providerVideoModels(providerId);
        return addNode(deps, {
            id:deps.uid('vid'),
            type:'video',
            x:p.x,
            y:p.y,
            apiProvider:providerId,
            model:models[0] || deps.videoModels[0] || deps.DEFAULT_VIDEO_MODELS[0],
            duration:5,
            aspectRatio:'16:9',
            resolution:'',
            enhancePrompt:false,
            enableUpsample:false,
            watermark:false,
            cameraFixed:false,
            generateAudio:false,
            useFrameRoles:false,
            multimodal:false,
            tempShLinks:[],
            inputs:[],
            running:false
        });
    }

    function addRhNode(deps, point){
        const p = point || deps.defaultPoint(180, 0);
        return addNode(deps, {
            id:deps.uid('rh'),
            type:'rh',
            x:p.x,
            y:p.y,
            w:430,
            h:0,
            rhMode:'app',
            rhPayment:'free',
            webappId:'',
            workflowId:'',
            instanceType:'',
            rhAppInfo:null,
            rhWorkflowInfo:null,
            rhParams:{},
            inputs:[],
            running:false
        });
    }

    function addComfyNode(deps, point){
        const p = point || deps.defaultPoint(160, 0);
        return addNode(deps, {
            id:deps.uid('comfy'),
            type:'comfy',
            x:p.x,
            y:p.y,
            w:420,
            h:460,
            mode:'text',
            width:1024,
            height:1024,
            enhanceStrength:0.5,
            enhanceUpscale:false,
            enhanceUpscaleRes:2048,
            editUpscale:false,
            editUpscaleRes:2048,
            editModel:deps.allImageModels(deps.imageApiProviders()[0]?.id || 'comfly')[0] || deps.models.gpt,
            ratio:'square',
            resolution:'1k',
            customRatio:'',
            customSize:'',
            customRatioWidth:'',
            customRatioHeight:'',
            customWidth:'',
            customHeight:'',
            comfyWorkflow:'',
            comfyParams:{},
            count:1,
            inputs:[]
        });
    }

    function addOutputNode(deps, point){
        const p = point || deps.defaultPoint(260, 0);
        return addNode(deps, {id:deps.uid('out'), type:'output', x:p.x, y:p.y, images:[]});
    }

    function createLinkedNode(deps, type){
        const state = deps.linkCreateState;
        deps.closeLinkCreateMenu();
        if(!state) return;
        const origin = deps.nodes.find(n => n.id === state.originId);
        if(!origin) return;
        deps.pushUndo();
        const created = createNodeByType(deps, type, state.point);
        if(!created) return;
        const fromId = state.originKind === 'out' ? origin.id : created.id;
        const toId = state.originKind === 'out' ? created.id : origin.id;
        if(deps.canConnect(fromId, toId) && !deps.connections.some(c => c.from === fromId && c.to === toId)){
            deps.connections.push({id:deps.uid('c'), from:fromId, to:toId});
            deps.syncLatestGeneratedOutputToConnection(fromId, toId);
            deps.syncGeneratorInputs();
            deps.scheduleSave();
            deps.render();
        }
    }

    function createNodeByType(deps, type, point){
        if(type === 'storyboard') return deps.window.CanvasVideoDeconstructionBridge.createBlankTable(point);
        if(type === 'clip') return addClipNode(deps, point);
        if(type === 'image') return addImageNode(deps, point);
        if(type === 'prompt') return addPromptNode(deps, point);
        if(type === 'loop') return addLoopNode(deps, point);
        if(type === 'group') return addGroupNode(deps, point);
        if(type === 'llm') return addLLMNode(deps, point);
        if(type === 'generator') return addGeneratorNode(deps, point);
        if(type === 'midjourney') return addMidjourneyNode(deps, point);
        if(type === 'msgen') return addMsGenNode(deps, point);
        if(type === 'video') return addVideoNode(deps, point);
    
        if(type === 'rh') return addRhNode(deps, point);
        if(type === 'comfy') return addComfyNode(deps, point);
    
        if(type === 'output') return addOutputNode(deps, point);
        return null;
    }

    function menuAdd(deps, type){
        deps.closeCreateMenu();
        if(type === 'clip') addClipNode(deps, deps.menuPoint);
        if(type === 'image') addImageNode(deps, deps.menuPoint);
        if(type === 'storyboard') deps.window.CanvasVideoDeconstructionBridge.createBlankTable(deps.menuPoint);
        if(type === 'prompt') addPromptNode(deps, deps.menuPoint);
        if(type === 'loop') addLoopNode(deps, deps.menuPoint);
        if(type === 'llm') addLLMNode(deps, deps.menuPoint);
        if(type === 'generator') addGeneratorNode(deps, deps.menuPoint);
        if(type === 'midjourney') addMidjourneyNode(deps, deps.menuPoint);
        if(type === 'msgen') addMsGenNode(deps, deps.menuPoint);
        if(type === 'video') addVideoNode(deps, deps.menuPoint);
    
        if(type === 'rh') addRhNode(deps, deps.menuPoint);
        if(type === 'comfy') addComfyNode(deps, deps.menuPoint);
    
        if(type === 'output') addOutputNode(deps, deps.menuPoint);
    }

    function cloneNode(deps, n, dx, dy){
        const copy = JSON.parse(JSON.stringify(deps.serializableCanvasNode(n)));
        copy.id = deps.uid(n.type);
        copy.x = n.x + dx;
        copy.y = n.y + dy;
        copy.running = false;
        deps.window.CanvasAudio.detachTask(copy);
        return copy;
    }

    function canvasNodesWithGroupMembers(deps, ids){
        const byId = new Map(deps.nodes.map(node => [node.id, node]));
        const seen = new Set();
        const queue = [...ids];
        for(let i = 0; i < queue.length; i++){
            const node = byId.get(queue[i]);
            if(!node || seen.has(node.id)) continue;
            seen.add(node.id);
            if(node.type === 'group' || node.type === 'promptGroup') queue.push(...(node.items || []));
        }
        return deps.nodes.filter(node => seen.has(node.id));
    }

    function duplicateNodesForAltDrag(deps, node, preserveConnections=false){
        const selectedSourceIds = deps.selected.has(node.id) ? [...deps.selected] : [node.id];
        const sourceIds = new Set(canvasNodesWithGroupMembers(deps, selectedSourceIds).map(source => source.id));
        const sourceNodes = deps.nodes.filter(n => sourceIds.has(n.id));
        const idMap = new Map();
        const copies = sourceNodes.map(source => {
            const copy = cloneNode(deps, source, 0, 0);
            idMap.set(source.id, copy.id);
            return copy;
        });
        copies.forEach(copy => {
            if((copy.type === 'group' || copy.type === 'promptGroup') && Array.isArray(copy.items)){
                copy.items = copy.items.map(id => idMap.get(id)).filter(Boolean);
            }
        });
        deps.remapCanvasDepthCopies(copies, idMap, preserveConnections);
        deps.window.CanvasClipHost?.remapCopies(copies,idMap);
        deps.window.CanvasVideoDeconstructionModel?.remapCopies(copies,idMap);
        deps.nodes.push(...copies);
        if(preserveConnections){
            const copiedConnections = (deps.connections || [])
                .filter(conn => sourceIds.has(conn.to))
                .map(conn => ({
                    ...conn,
                    id:deps.uid('c'),
                    from:idMap.get(conn.from) || conn.from,
                    to:idMap.get(conn.to) || conn.to
                }))
                .filter(conn => conn.from && conn.to && conn.from !== conn.to);
            copiedConnections.forEach(conn => {
                if((conn.kind === 'story' ? deps.validStoryConnection(conn) : deps.canConnect(conn.from, conn.to)) && !deps.connections.some(c => c.from === conn.from && c.to === conn.to)){
                    deps.connections.push(conn);
                }
            });
        }
        return {
            dragCopy:copies.find(copy => copy.id === idMap.get(node.id)),
            selectedCopyIds:selectedSourceIds.map(id => idMap.get(id)).filter(Boolean)
        };
    }

    function copySelectedNodes(deps){
        if(!deps.canvas || !deps.selected.size) return;
        const el = deps.document.activeElement;
        if(el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')) return;
        const toCopy = canvasNodesWithGroupMembers(deps, [...deps.selected]);
        if(!toCopy.length) return;
        const ids = new Set(toCopy.map(n => n.id));
        const pickedConnections = (deps.connections || []).filter(c => ids.has(c.from) && ids.has(c.to)).map(c => ({...c}));
        deps.clipboard = {
            nodes:JSON.parse(JSON.stringify(deps.serializableCanvasNodes(toCopy))),
            connections:JSON.parse(JSON.stringify(pickedConnections))
        };
    }

    function clipboardNodeCount(deps){
        if(Array.isArray(deps.clipboard)) return deps.clipboard.length;
        if(Array.isArray(deps.clipboard?.nodes)) return deps.clipboard.nodes.length;
        return 0;
    }

    function pasteNodes(deps){
        if(!deps.canvas || !deps.clipboard) return;
        const clipNodes = Array.isArray(deps.clipboard) ? deps.clipboard : (Array.isArray(deps.clipboard.nodes) ? deps.clipboard.nodes : []);
        const clipConnections = Array.isArray(deps.clipboard?.connections) ? deps.clipboard.connections : [];
        if(!clipNodes.length) return;
        deps.pushUndo();
        const xs = clipNodes.map(n => n.x), ys = clipNodes.map(n => n.y);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
        const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
        const dx = deps.lastMouseBoard.x - cx;
        const dy = deps.lastMouseBoard.y - cy;
        const idMap = new Map();
        const copies = clipNodes.map(n => { const c = cloneNode(deps, n, dx, dy); idMap.set(n.id, c.id); return c; });
        copies.forEach(c => {
            if((c.type === 'group' || c.type === 'promptGroup') && c.items)
                c.items = c.items.map(id => idMap.get(id)).filter(Boolean);
        });
        deps.remapCanvasDepthCopies(copies, idMap);
        deps.window.CanvasClipHost?.remapCopies(copies,idMap);
        deps.window.CanvasVideoDeconstructionModel?.remapCopies(copies,idMap);
        const newConnections = clipConnections
            .map(c => ({...c, id:deps.uid('c'), from:idMap.get(c.from), to:idMap.get(c.to)}))
            .filter(c => c.from && c.to);
        deps.nodes.push(...copies);
        deps.connections.push(...newConnections);
        deps.selected.clear();
        copies.forEach(c => deps.selected.add(c.id));
        deps.sanitizeConnections();
        deps.syncGeneratorInputs();
        deps.render();
        deps.scheduleSave();
    }

    function deleteNode(deps, id, event){
        event?.stopPropagation();
        deps.pushUndo();
    
        deps.nodes = deps.nodes.filter(n => n.id !== id);
        deps.nodes.forEach(n => {
            if((n.type === 'group' || n.type === 'promptGroup') && Array.isArray(n.items)) n.items = n.items.filter(itemId => itemId !== id);
        });
        deps.connections = deps.connections.filter(c => c.from !== id && c.to !== id);
        deps.selected.delete(id);
        deps.render();
        deps.scheduleSave();
    }

    function clearNodeContentBeforeDelete(deps, id){
        const node = deps.nodes.find(n => n.id === id);
        if(!node) return false;
        if(['image','audio'].includes(node.type) && node.url){
            deps.pushUndo();
            node.url = '';
            node.mediaKind = 'image';
            node.name = node.type==='audio'?'音频素材':deps.tr('canvas.imageCard');
            deps.render();
            deps.scheduleSave();
            return true;
        }
        if(node.type === 'output' && ((node.images || []).length || (node._pending || []).length)){
            deps.pushUndo();
            node.images = [];
            node._pending = [];
            node.imageComparisons = {};
            deps.refreshNodes([node.id]);
            deps.scheduleSave();
            return true;
        }
        return false;
    }

    function deleteNodeFromButton(deps, id, event){
        event?.preventDefault();
        event?.stopPropagation();
        if(clearNodeContentBeforeDelete(deps, id)) return;
        deleteNode(deps, id, event);
    }

    function deleteConnection(deps, id, event){
        event?.preventDefault();
        event?.stopPropagation();
        deps.pushUndo();
        deps.connections = deps.connections.filter(c => c.id !== id);
        if(deps.hoveredConnectionId === id) deps.hoveredConnectionId = '';
        deps.syncGeneratorInputs();
        deps.render();
        deps.scheduleSave();
    }

    function deleteSelectedNodes(deps){
        if(!deps.canvas || deps.selected.size === 0) return;
        deps.pushUndo();
        // 收集所有需要删除的 id（含 group 的 items 一并删除）
        const toDelete = new Set();
        const collect = id => {
            if(toDelete.has(id)) return;
            toDelete.add(id);
            const n = deps.nodes.find(x => x.id === id);
            if(n && (n.type === 'group' || n.type === 'promptGroup')){
                (n.items || []).forEach(collect);
            }
        };
        deps.selected.forEach(collect);
    
        deps.nodes = deps.nodes.filter(n => !toDelete.has(n.id));
        deps.nodes.forEach(n => {
            if((n.type === 'group' || n.type === 'promptGroup') && Array.isArray(n.items)) n.items = n.items.filter(id => !toDelete.has(id));
        });
        deps.connections = deps.connections.filter(c => !toDelete.has(c.from) && !toDelete.has(c.to));
        deps.selected.clear();
        deps.render();
        deps.scheduleSave();
    }

    const api={addNode, addImageNode, addClipNode, addPromptNode, addLoopNode, addGroupNode, addLLMNode, addGeneratorNode, addMidjourneyNode, addMsGenNode, addVideoNode, addRhNode, addComfyNode, addOutputNode, createLinkedNode, createNodeByType, menuAdd, cloneNode, canvasNodesWithGroupMembers, duplicateNodesForAltDrag, copySelectedNodes, clipboardNodeCount, pasteNodes, deleteNode, clearNodeContentBeforeDelete, deleteNodeFromButton, deleteConnection, deleteSelectedNodes};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.CanvasNodeEdit=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
