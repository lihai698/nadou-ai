/* Node editing responsibility: smart-group-edit. Host supplies live state and effects. */
(function(root){
    'use strict';

    function rerouteSmartConnections(deps, fromId, toId){
        if(deps.canvas){
            deps.canvas.connections = (deps.canvas.connections || []).map(c => {
                let conn = c;
                if(c.from === fromId) conn = {...conn, from:toId};
                if(c.to === fromId) conn = {...conn, to:toId};
                return conn;
            }).filter((c, i, arr) => c.from !== c.to && arr.findIndex(x => x.from === c.from && x.to === c.to && (x.kind || 'flow') === (c.kind || 'flow')) === i);
        }
        deps.nodes.forEach(n => {
            if(Array.isArray(n.inputNodeIds)) n.inputNodeIds = Array.from(new Set(n.inputNodeIds.map(id => id === fromId ? toId : id).filter(id => id !== n.id)));
        });
    }

    function absorbImageNodeIntoSmartGroup(deps, group, child){
        if(group?.groupMode==='frame'||child?.groupMode==='frame')return false;
        const add = (child.images || []).map(img => deps.stripImageGenerationMeta({...img}));
        if(!add.length) return false;
        group.images = [...(group.images || []), ...add];
        // 清掉显式尺寸，让缩略图网格按图片数自动整理排列（“放入图片自动整理”）。
        delete group.w; delete group.h;
        rerouteSmartConnections(deps, child.id, group.id);
        deps.nodes = deps.nodes.filter(n => n.id !== child.id);
        deps.nodes.forEach(g => { if(deps.isSmartGroupNode(g) && Array.isArray(g.items)) g.items = g.items.filter(id => id !== child.id); });
        return true;
    }

    function setSmartGroupMemberIds(deps, group, memberIds){
        if(group?.groupMode==='frame')throw new Error('工作组成员请通过画布解组后重新框选，不能使用素材组成员编辑');
        const targets = memberIds.map(id => deps.nodes.find(n => n.id === id));
        if(!deps.isSmartGroupNode(group) || targets.some(n => !n || !['smart-prompt','smart-loop'].includes(n.type)) || new Set(memberIds).size !== memberIds.length) throw new Error('智能分组只允许现有提示词或循环成员');
        group.items = [];
        targets.forEach(child => addNodeToSmartGroup(deps, group, child));
        if(targets.length) deps.arrangeSmartGroupMembers(group, {skipUndo:true});
    }

    function addNodeToSmartGroup(deps, group, child){
        if(group?.groupMode==='frame'||child?.groupMode==='frame')return false;
        if(!deps.isSmartGroupNode(group) || !child || child.id === group.id) return false;
        const items = Array.isArray(group.items) ? group.items.slice() : [];
        const zoom = deps.smartGroupZoom(group);
        if(deps.isSmartGroupNode(child)){
            // 把一个分组拖进另一个分组：吸收它的图片到本组网格，把它的非图片成员并入本组，然后删除被拖分组本体。
            const mergedImages = (child.images || []).map(img => deps.stripImageGenerationMeta({...img}));
            group.images = [...(group.images || []), ...mergedImages];
            if(mergedImages.length){ delete group.w; delete group.h; }
            const childMemberIds = deps.smartGroupMembers(child)
                .map(m => m.id)
                .filter(id => id !== group.id && !items.includes(id));
            group.items = [...items, ...childMemberIds];
            childMemberIds.forEach(id => {
                const m = deps.nodes.find(n => n.id === id);
                if(m) deps.scaleSmartGroupMemberToZoom(group, m, zoom);
            });
            rerouteSmartConnections(deps, child.id, group.id);
            deps.nodes = deps.nodes.filter(n => n.id !== child.id);
            deps.nodes.forEach(g => { if(deps.isSmartGroupNode(g) && Array.isArray(g.items)) g.items = g.items.filter(id => id !== child.id); });
            return true;
        }
        // 图片节点：收进卡片内的缩略图网格（不再作为画布上的独立节点）。
        if(deps.isSmartImageNode(child)) return absorbImageNodeIntoSmartGroup(deps, group, child);
        // 提示词 / 循环：仍作为画布上的成员节点。
        if(items.includes(child.id)) return false;
        group.items = [...items, child.id];
        deps.scaleSmartGroupMemberToZoom(group, child, zoom);
        return true;
    }

    function groupSelectedNodes(deps){
        const ids = deps.selectedIds.length ? deps.selectedIds.slice() : (deps.selectedId ? [deps.selectedId] : []);
        const selected = ids.map(id => deps.nodes.find(n => n.id === id)).filter(n => n && !deps.isSmartGroupNode(n));
        if(selected.length < 1){ deps.toast('请选择要放入分组的节点'); return; }
        deps.pushUndo();
        const rects = selected.map(deps.nodeRect);
        const minX = Math.min(...rects.map(r => r.x));
        const minY = Math.min(...rects.map(r => r.y));
        const maxX = Math.max(...rects.map(r => r.x + r.width));
        const maxY = Math.max(...rects.map(r => r.y + r.height));
        const group = {
            id:deps.uid('group'),
            type:'smart-group',
            x:Math.round(minX - 18),
            y:Math.round(minY - 44),
            w:Math.max(340, Math.round(maxX - minX + 36)),
            h:Math.max(220, Math.round(maxY - minY + 72)),
            title:'智能分组',
            items:[],
            images:[],
            created_at:Date.now()
        };
        deps.nodes.push(group);
        // 图片成员吸收进分组网格，提示词/循环作为成员节点；随后自动整理。
        selected.forEach(node => addNodeToSmartGroup(deps, group, node));
        deps.arrangeSmartGroupMembers(group, {skipUndo:true});
        deps.selectedIds = [];
        deps.selectedId = group.id;
        deps.selectedImage = {nodeId:'', index:-1};
        deps.render();
        deps.scheduleSave();
    }

    function ungroupNode(deps, groupId){
        const group = deps.nodes.find(n => n.id === groupId);
        if(!group) return false;
        // 释放智能分组：把收进卡片的图片重新拆成独立图片节点（平铺在分组原位置），提示词/循环成员原地保留，再删除分组容器。
        if(deps.isSmartGroupNode(group)){
            deps.pushUndo();
            const memberIds = deps.smartGroupMembers(group).map(m => m.id);
            const groupImages = (group.images || []).filter(img => img?.url);
            let created = [];
            if(groupImages.length){
                const layout = deps.imageLayout(group.images || [], deps.nodeScale(group), group);
                const pad = 16, gap = 8;
                const cell = Math.max(28, Math.round(layout.thumb || 96));
                const cols = Math.max(1, layout.cols || 1);
                created = groupImages.map((img, index) => {
                    const col = index % cols;
                    const row = Math.floor(index / cols);
                    const size = deps.thumbDisplaySize(img, cell);
                    const x = Math.round(Number(group.x || 0) + pad + col * (cell + gap) + Math.max(0, (cell - size.width) / 2));
                    const y = Math.round(Number(group.y || 0) + pad + row * (cell + gap) + Math.max(0, (cell - size.height) / 2));
                    const node = {id:deps.uid('smart'), type:'smart-image', x, y, w:size.width, h:size.height, title:'Image', images:[deps.stripImageGenerationMeta({...img})], scale:deps.MEDIA_NODE_DEFAULT_SCALE, created_at:Date.now()};
                    deps.inheritNodeMetaFromImage(node);
                    deps.clearDetachedRunInputRefs(node);
                    return node;
                });
            }
            deps.nodes = deps.nodes.filter(n => n.id !== groupId);
            deps.nodes.push(...created);
            if(deps.canvas) deps.canvas.connections = (deps.canvas.connections || []).filter(c => c.from !== groupId && c.to !== groupId);
            deps.nodes.forEach(node => {
                if(Array.isArray(node.inputNodeIds)) node.inputNodeIds = node.inputNodeIds.filter(id => id !== groupId);
                if(deps.isSmartGroupNode(node) && Array.isArray(node.items)) node.items = node.items.filter(id => id !== groupId);
            });
            deps.selectedIds = [...created.map(n => n.id), ...memberIds].filter(id => deps.nodes.some(n => n.id === id));
            deps.selectedId = deps.selectedIds.length === 1 ? deps.selectedIds[0] : '';
            deps.selectedImage = {nodeId:'', index:-1};
            deps.render();
            deps.scheduleSave();
            return true;
        }
        if(!Array.isArray(group.images) || group.images.length < 2) return false;
        deps.pushUndo();
        const layout = deps.imageLayout(group.images || [], deps.nodeScale(group), group);
        const pad = 16;
        const gap = 8;
        const cell = Math.max(28, Math.round(layout.thumb || 96));
        const created = (group.images || []).map((img, index) => {
            const col = index % Math.max(1, layout.cols || 1);
            const row = Math.floor(index / Math.max(1, layout.cols || 1));
            const size = deps.thumbDisplaySize(img, cell);
            const x = Math.round(Number(group.x || 0) + pad + col * (cell + gap) + Math.max(0, (cell - size.width) / 2));
            const y = Math.round(Number(group.y || 0) + pad + row * (cell + gap) + Math.max(0, (cell - size.height) / 2));
            const node = {
                id:deps.uid('smart'),
                type:'smart-image',
                x,
                y,
                w:size.width,
                h:size.height,
                title:'Image',
                images:[deps.stripImageGenerationMeta({...img})],
                scale:deps.MEDIA_NODE_DEFAULT_SCALE,
                created_at:Date.now()
            };
            deps.inheritNodeMetaFromImage(node);
            deps.clearDetachedRunInputRefs(node);
            return node;
        });
        deps.nodes = deps.nodes.filter(n => n.id !== groupId);
        deps.nodes.push(...created);
        if(deps.canvas) deps.canvas.connections = (deps.canvas.connections || []).filter(c => c.from !== groupId && c.to !== groupId);
        deps.nodes.forEach(node => {
            if(Array.isArray(node.inputNodeIds)){
                node.inputNodeIds = node.inputNodeIds.filter(inputId => inputId !== groupId);
            }
        });
        deps.selectedIds = created.map(node => node.id);
        deps.selectedId = deps.selectedIds.length === 1 ? deps.selectedIds[0] : '';
        deps.selectedImage = {nodeId:'', index:-1};
        deps.render();
        deps.scheduleSave();
        return true;
    }

    function addDraggedNodeToSmartGroup(deps, draggedNode, group){
        return addDraggedNodesToSmartGroup(deps, draggedNode ? [draggedNode] : [], group);
    }

    function addDraggedNodesToSmartGroup(deps, draggedNodes, group){
        if(!group || !deps.isSmartGroupNode(group)) return false;
        const list = (draggedNodes || []).filter(n => n && n.id !== group.id);
        if(!list.length) return false;
        let added = false;
        list.forEach(n => {
            if(addNodeToSmartGroup(deps, group, n)) added = true;
        });
        if(!added) return false;
        // 提示词/循环成员入组后自动整理成网格（图片已收进卡片网格，自动平铺）。
        deps.arrangeSmartGroupMembers(group, {skipUndo:true});
        deps.selectedIds = [];
        // 图片被吸收进分组（原节点已删除），统一选中目标分组；仅当单个提示词/循环节点拖入时保持选中它。
        const survivingSingle = list.length === 1 && deps.nodes.some(n => n.id === list[0].id) ? list[0].id : '';
        deps.selectedId = survivingSingle || group.id;
        deps.selectedImage = {nodeId:'', index:-1};
        return true;
    }

    function addCreatedNodeToMenuGroup(deps, node){
        const group = deps.createMenuGroupId ? deps.nodes.find(n => n.id === deps.createMenuGroupId) : null;
        if(addNodeToSmartGroup(deps, group, node)){
            // 通过分组小菜单新建的节点入组后自动整理（节点创建已压过 undo，这里不再重复）。
            deps.arrangeSmartGroupMembers(group, {skipUndo:true});
            deps.render();
            deps.scheduleSave();
        }
    }

    const api={rerouteSmartConnections, absorbImageNodeIntoSmartGroup, setSmartGroupMemberIds, addNodeToSmartGroup, groupSelectedNodes, ungroupNode, addDraggedNodeToSmartGroup, addDraggedNodesToSmartGroup, addCreatedNodeToMenuGroup};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.SmartGroupEdit=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
