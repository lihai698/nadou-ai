/* Node editing responsibility: smart-node-edit. Host supplies live state and effects. */
(function(root){
    'use strict';

    function createNode(deps, x, y, images=[], options={}){
        if(!options.skipUndo) deps.pushUndo();
        const nodeImages = (images || []).map(img => ({...img}));
        const node = {id:deps.uid('smart'), type:'smart-image', x, y, title:nodeImages.length > 1 ? 'Group' : nodeImages.length ? 'Image' : deps.tr('smart.createImportNode'), images:nodeImages, created_at:Date.now()};
        node.scale = nodeImages.length > 1 ? deps.MEDIA_GROUP_DEFAULT_SCALE : deps.mediaNodeDefaultScale(node);
        deps.inheritNodeMetaFromImage(node);
        deps.nodes.push(node);
        if(options.select !== false) deps.selectedId = node.id;
        deps.render();
        deps.scheduleSave();
        return node;
    }

    function createPromptNode(deps, x, y, options={}){
        if(!options.skipUndo) deps.pushUndo();
        const providerId = deps.resolveChatProviderId();
        const node = {
            id:deps.uid('prompt'),
            type:'smart-prompt',
            x,
            y,
            w:316,
            h:240,
            title:'Prompt',
            text:'',
            promptSeparator:';',
            promptSplitEnabled:false,
            llmEnabled:false,
            llmProvider:providerId,
            llmModel:deps.resolveChatModel('', providerId),
            llmSystemEnabled:false,
            llmSystemPrompt:'You are a helpful prompt assistant.',
            llmInstruction:'',
            created_at:Date.now()
        };
        deps.nodes.push(node);
        if(options.select !== false) deps.selectedId = node.id;
        deps.render();
        deps.scheduleSave();
        return node;
    }

    function createLoopNode(deps, x, y, options={}){
        if(!options.skipUndo) deps.pushUndo();
        const node = {id:deps.uid('loop'), type:'smart-loop', x, y, w:340, h:168, title:'Loop', count:1, mode:'serial', showPrompt:false, imageInput:false, loopStart:1, imageBatchSize:1, variablePrompt:'', created_at:Date.now()};
        deps.nodes.push(node);
        if(options.select !== false) deps.selectedId = node.id;
        deps.render();
        deps.scheduleSave();
        return node;
    }

    function createSmartGroupNode(deps, x, y, options={}){
        if(!options.skipUndo) deps.pushUndo();
        const node = {id:deps.uid('group'), type:'smart-group', x, y, w:deps.SMART_GROUP_DEFAULT_WIDTH, h:deps.SMART_GROUP_DEFAULT_HEIGHT, title:'智能分组', items:[], created_at:Date.now()};
        deps.nodes.push(node);
        if(options.select !== false) deps.selectedId = node.id;
        deps.render();
        deps.scheduleSave();
        return node;
    }

    function createImageNodeAt(deps, point, images=[], options={}){
        const layout = deps.imageLayout(images || [], deps.mediaNodeDefaultScale({type:'smart-image', images:images || []}), {type:'smart-image', images:images || []});
        return createNode(deps, (point?.x || 0) - Math.round(layout.width / 2), (point?.y || 0) - Math.round(layout.height / 2), images, options);
    }

    function cloneSmartNode(deps, node, dx=0, dy=0){
        const copy = JSON.parse(JSON.stringify(node));
        copy.id = deps.uid(
            node.type === 'smart-prompt'
                ? 'prompt'
                : node.type === 'smart-loop'
                ? 'loop'
                : node.type === 'smart-group'
                ? 'group'
                : 'smart'
        );
        copy.x = (Number(node.x) || 0) + dx;
        copy.y = (Number(node.y) || 0) + dy;
        deps.clearSmartNodeTransientRunState(copy, {clearRunHistory:true});
        deps.window.CanvasAudio.detachTask(copy);
        if(copy.type === 'smart-group') copy.title = copy.title || '智能分组';
        return copy;
    }

    function smartNodesWithGroupMembers(deps, ids){
        const seen = new Set(ids);
        ids.forEach(id => {
            const group = deps.nodes.find(node => node.id === id);
            if(deps.isSmartGroupNode(group)){
                (group.items || []).forEach(memberId => {
                    const member = deps.nodes.find(node => node.id === memberId);
                    if(member && !deps.isSmartGroupNode(member)) seen.add(memberId);
                });
            }
        });
        return deps.nodes.filter(node => seen.has(node.id));
    }

    function copySelectedNodes(deps){
        if(!deps.canvas || deps.isEditableTarget(deps.document.activeElement)) return;
        const ids = deps.selectedNodeIds();
        const copiedNodes = smartNodesWithGroupMembers(deps, ids);
        if(!copiedNodes.length) return;
        const idSet = new Set(copiedNodes.map(n => n.id));
        const copiedConnections = (deps.canvas.connections || []).filter(c => idSet.has(c.from) && idSet.has(c.to));
        deps.nodeClipboard = {
            nodes:JSON.parse(JSON.stringify(copiedNodes)),
            connections:JSON.parse(JSON.stringify(copiedConnections))
        };
        deps.toast(`已复制 ${copiedNodes.length} 个节点`);
    }

    function pasteNodes(deps){
        if(!deps.canvas || !deps.nodeClipboard?.nodes?.length || deps.isEditableTarget(deps.document.activeElement)) return;
        deps.lastNodePasteAt = Date.now();
        deps.pushUndo();
        const sourceNodes = deps.nodeClipboard.nodes;
        const xs = sourceNodes.map(n => Number(n.x) || 0);
        const ys = sourceNodes.map(n => Number(n.y) || 0);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
        const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
        const p = deps.lastMouseWorld || deps.viewportCenter();
        const dx = p.x - cx;
        const dy = p.y - cy;
        const idMap = new Map();
        const copies = sourceNodes.map(n => {
            const copy = cloneSmartNode(deps, n, dx, dy);
            idMap.set(n.id, copy.id);
            return copy;
        });
        copies.forEach(copy => {
            if(copy.type === 'smart-group' && Array.isArray(copy.items)){
                copy.items = copy.items.map(id => idMap.get(id)).filter(Boolean);
            }
            if(Array.isArray(copy.inputNodeIds)){
                copy.inputNodeIds = copy.inputNodeIds.map(id => idMap.get(id)).filter(Boolean);
            }
            if(copy.sourceNodeId) copy.sourceNodeId = idMap.get(copy.sourceNodeId) || '';
            deps.remapSmartViewAdjustRefs(copy, idMap);
        });
        deps.remapSmartDepthCopies(copies, idMap);
        const newConnections = (deps.nodeClipboard.connections || []).map(conn => ({
            ...conn,
            from:idMap.get(conn.from),
            to:idMap.get(conn.to)
        })).filter(conn => conn.from && conn.to && conn.from !== conn.to);
        deps.canvas.connections = [...(deps.canvas.connections || []), ...newConnections];
        deps.nodes.push(...copies);
        deps.selectedId = copies.length === 1 ? copies[0].id : '';
        deps.selectedIds = copies.length > 1 ? copies.map(n => n.id) : [];
        deps.selectedImage = {nodeId:'', index:-1};
        deps.render();
        deps.scheduleSave();
    }

    function duplicateForAltDrag(deps, node, preserveConnections=false){
        const ids = (deps.isNodeSelected(node.id) ? deps.selectedNodeIds() : [node.id]);
        const sourceNodes = smartNodesWithGroupMembers(deps, ids);
        if(!sourceNodes.length) return node;
        deps.pushUndo();
        const idMap = new Map();
        const copies = sourceNodes.map(n => {
            const copy = cloneSmartNode(deps, n, 0, 0);
            idMap.set(n.id, copy.id);
            return copy;
        });
        copies.forEach(copy => {
            if(deps.isSmartGroupNode(copy) && Array.isArray(copy.items)) copy.items = copy.items.map(id => idMap.get(id)).filter(Boolean);
            if(Array.isArray(copy.inputNodeIds)){
                copy.inputNodeIds = preserveConnections
                    ? copy.inputNodeIds.map(id => idMap.get(id) || id).filter(Boolean)
                    : [];
            }
            if(copy.sourceNodeId) copy.sourceNodeId = preserveConnections ? (idMap.get(copy.sourceNodeId) || copy.sourceNodeId) : '';
            deps.remapSmartViewAdjustRefs(copy, idMap, preserveConnections);
        });
        deps.remapSmartDepthCopies(copies, idMap, preserveConnections);
        if(preserveConnections){
            const idSet = new Set(sourceNodes.map(n => n.id));
            const newConnections = (deps.canvas.connections || [])
                .filter(conn => idSet.has(conn.to))
                .map(conn => ({...conn, from:idMap.get(conn.from) || conn.from, to:idMap.get(conn.to) || conn.to}))
                .filter(conn => conn.from && conn.to && conn.from !== conn.to);
            const nextConnections = [...(deps.canvas.connections || [])];
            newConnections.forEach(conn => {
                const kind = conn.kind || 'flow';
                if(nextConnections.some(c => c.from === conn.from && c.to === conn.to && (c.kind || 'flow') === kind)) return;
                nextConnections.push(conn);
                const toNode = deps.nodes.find(n => n.id === conn.to) || copies.find(n => n.id === conn.to);
                if(toNode && (conn.kind || 'flow') === 'input'){
                    toNode.inputNodeIds = Array.from(new Set([...(toNode.inputNodeIds || []), conn.from]));
                }
            });
            deps.canvas.connections = nextConnections;
        }
        deps.nodes.push(...copies);
        deps.selectedId = ids.length === 1 ? idMap.get(ids[0]) : '';
        deps.selectedIds = ids.length > 1 ? ids.map(id => idMap.get(id)).filter(Boolean) : [];
        deps.selectedImage = {nodeId:'', index:-1};
        const dragCopy = copies.find(c => c.id === idMap.get(node.id)) || copies[0];
        deps.render();
        deps.scheduleSave();
        return dragCopy;
    }

    function deleteNode(deps, id){
        deps.pushUndo();
        const deleteIds = new Set([id]);
        deps.nodes.forEach(node => {
            if(deps.isHistoryGroupNode(node) && node.historyFor === id) deleteIds.add(node.id);
        });
        deleteIds.forEach(id=>deps.cancelNodeCooldown(id));
        deps.nodes = deps.nodes.filter(node => !deleteIds.has(node.id));
        if(deps.canvas) deps.canvas.connections = (deps.canvas.connections || []).filter(c => !deleteIds.has(c.from) && !deleteIds.has(c.to));
        deps.nodes.forEach(node => {
            if(Array.isArray(node.inputNodeIds)) node.inputNodeIds = node.inputNodeIds.filter(inputId => !deleteIds.has(inputId));
            if(deps.isSmartGroupNode(node) && Array.isArray(node.items)) node.items = node.items.filter(itemId => !deleteIds.has(itemId));
        });
        if(deps.selectedId === id) deps.selectedId = '';
        deps.selectedIds = deps.selectedIds.filter(selected => !deleteIds.has(selected));
        if(deleteIds.has(deps.selectedImage.nodeId)) deps.selectedImage = {nodeId:'', index:-1};
        deps.render();
        deps.scheduleSave();
    }

    function clearNodeMediaBeforeDelete(deps, id){
        const node = deps.nodes.find(n => n.id === id);
        if(!node || (node.type && node.type !== 'smart-image')) return false;
        deps.cancelNodeCooldown(id);
        const hadMedia = Boolean((node.images || []).length || node.pending);
        if(!hadMedia) return false;
        deps.pushUndo();
        node.images = [];
        node.pending = 0;
        node.running = false;
        node.title = deps.tr('smart.createImportNode');
        delete node.w;
        delete node.h;
        const history = deps.historyGroupForNode(node);
        if(history){
            deps.nodes = deps.nodes.filter(n => n.id !== history.id);
            if(deps.canvas) deps.canvas.connections = (deps.canvas.connections || []).filter(c => c.from !== history.id && c.to !== history.id);
        }
        if(deps.selectedImage.nodeId === id) deps.selectedImage = {nodeId:'', index:-1};
        deps.selectedId = id;
        deps.selectedIds = [];
        deps.render();
        deps.scheduleSave();
        return true;
    }

    function deleteNodeFromButton(deps, id){
        if(clearNodeMediaBeforeDelete(deps, id)) return;
        deleteNode(deps, id);
    }

    function createNodeFromMenu(deps, type){
        const p = deps.createMenuPoint || deps.viewportCenter();
        const groupId = deps.createMenuGroupId;
        deps.closeCreateMenu();
        if(type === 'storyboard') return deps.window.CanvasVideoDeconstructionBridge.createBlankTable({x:p.x-560,y:p.y-195});
        if(type === 'group') return createSmartGroupNode(deps, p.x - 170, p.y - 110);
        let created = null;
        if(type === 'prompt') created = createPromptNode(deps, p.x - 158, p.y - 97);
        else if(type === 'loop') created = createLoopNode(deps, p.x - 135, p.y - 95);
        else created = createImageNodeAt(deps, p);
        deps.createMenuGroupId = groupId;
        deps.addCreatedNodeToMenuGroup(created);
        deps.createMenuGroupId = '';
        return created;
    }

    const api={createNode, createPromptNode, createLoopNode, createSmartGroupNode, createImageNodeAt, cloneSmartNode, smartNodesWithGroupMembers, copySelectedNodes, pasteNodes, duplicateForAltDrag, deleteNode, clearNodeMediaBeforeDelete, deleteNodeFromButton, createNodeFromMenu};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.SmartNodeEdit=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
