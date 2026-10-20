/* Layout and interaction responsibility: canvas-layout. Host supplies live state and effects. */
(function(root){
    'use strict';

    function screenToWorld(deps, clientX, clientY){
        const rect = deps.board.getBoundingClientRect();
        return { x:(clientX - rect.left - deps.viewport.x) / deps.viewport.scale, y:(clientY - rect.top - deps.viewport.y) / deps.viewport.scale };
    }

    function nodeBounds(deps, ids){
        const rects = ids.map(id => {
            const n = deps.nodes.find(item => item.id === id);
            const el = deps.nodesEl.querySelector(`.node[data-id="${id}"]`);
            if(!n) return null;
            return {x:n.x, y:n.y, w:el?.offsetWidth || n.w || 260, h:el?.offsetHeight || n.h || 220};
        }).filter(Boolean);
        const x1 = Math.min(...rects.map(r => r.x));
        const y1 = Math.min(...rects.map(r => r.y));
        const x2 = Math.max(...rects.map(r => r.x + r.w));
        const y2 = Math.max(...rects.map(r => r.y + r.h));
        return {x:x1, y:y1, w:x2 - x1, h:y2 - y1};
    }

    function nodeRect(deps, n){
        const el = deps.nodesEl.querySelector(`.node[data-id="${n.id}"]`);
        const w = el?.offsetWidth || n.w || 260;
        const h = el?.offsetHeight || n.h || 200;
        return {x:n.x, y:n.y, w, h, cx:n.x + w/2, cy:n.y + h/2};
    }

    function canvasArrangeAtomicIds(deps, ids){
        const out = new Set((ids || []).filter(id => deps.nodes.some(n => n.id === id)));
        let changed = true;
        while(changed){
            changed = false;
            deps.nodes.filter(n => (n.type === 'group' || n.type === 'promptGroup') && Array.isArray(n.items)).forEach(group => {
                (group.items || []).forEach(itemId => {
                    if(!out.has(itemId)) return;
                    out.delete(itemId);
                    out.add(group.id);
                    changed = true;
                });
            });
        }
        return [...out];
    }

    function translateCanvasNodeWithMembers(deps, node, dx, dy, seen=new Set()){
        if(!node || seen.has(node.id)) return;
        seen.add(node.id);
        node.x = Math.round((Number(node.x) || 0) + dx);
        node.y = Math.round((Number(node.y) || 0) + dy);
        if(node.type === 'group' || node.type === 'promptGroup'){
            (node.items || []).forEach(id => translateCanvasNodeWithMembers(deps, deps.nodes.find(n => n.id === id), dx, dy, seen));
        }
    }

    function moveCanvasNodeAtom(deps, node, x, y){
        const dx = Math.round(x - (Number(node.x) || 0));
        const dy = Math.round(y - (Number(node.y) || 0));
        translateCanvasNodeWithMembers(deps, node, dx, dy);
    }

    function arrangeIdsByConnections(deps, ids){
        const idSet = new Set(canvasArrangeAtomicIds(deps, ids));
        const selectedNodes = [...idSet].map(id => deps.nodes.find(n => n.id === id)).filter(Boolean);
        if(selectedNodes.length < 2) return false;
        const rects = selectedNodes.map(n => ({node:n, rect:nodeRect(deps, n)}));
        const startX = Math.min(...rects.map(item => item.rect.x));
        const startY = Math.min(...rects.map(item => item.rect.y));
        const internal = deps.connections.filter(c => idSet.has(c.from) && idSet.has(c.to));
        const depth = new Map(selectedNodes.map(n => [n.id, 0]));
        if(internal.length){
            const indegree = new Map(selectedNodes.map(n => [n.id, 0]));
            internal.forEach(c => indegree.set(c.to, (indegree.get(c.to) || 0) + 1));
            const roots = [...indegree.entries()].filter(([, n]) => n === 0).map(([id]) => id);
            const queue = roots.length ? roots.slice() : [selectedNodes[0].id];
            const seen = new Set(queue);
            while(queue.length){
                const id = queue.shift();
                internal.filter(c => c.from === id).forEach(c => {
                    depth.set(c.to, Math.max(depth.get(c.to) || 0, (depth.get(id) || 0) + 1));
                    if(!seen.has(c.to)){
                        seen.add(c.to);
                        queue.push(c.to);
                    }
                });
            }
        }
        const groups = new Map();
        selectedNodes.forEach(n => {
            const d = depth.get(n.id) || 0;
            if(!groups.has(d)) groups.set(d, []);
            groups.get(d).push(n);
        });
        const sortedDepths = [...groups.keys()].sort((a, b) => a - b);
        let x = startX;
        sortedDepths.forEach(d => {
            const col = groups.get(d).slice().sort((a, b) => nodeRect(deps, a).y - nodeRect(deps, b).y || String(a.id).localeCompare(String(b.id)));
            let y = startY;
            let maxW = 0;
            col.forEach(n => {
                const r = nodeRect(deps, n);
                moveCanvasNodeAtom(deps, n, x, y);
                y += Math.max(120, r.h) + 56;
                maxW = Math.max(maxW, Math.max(220, r.w));
            });
            x += maxW + 180;
        });
        return true;
    }

    function arrangeSelectedCanvasNodes(deps){
        if(!deps.canvas || !deps.selected.size) return;
        const explicit = [...deps.selected].filter(id => deps.nodes.some(n => n.id === id));
        const ids = canvasArrangeAtomicIds(deps, explicit.length > 1 ? explicit : deps.connectedClusterIds(explicit[0]));
        if(ids.length < 2) return;
        deps.pushUndo();
        if(!arrangeIdsByConnections(deps, ids)) return;
        deps.render();
        deps.scheduleSave();
    }

    const api={screenToWorld, nodeBounds, nodeRect, canvasArrangeAtomicIds, translateCanvasNodeWithMembers, moveCanvasNodeAtom, arrangeIdsByConnections, arrangeSelectedCanvasNodes};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.CanvasLayout=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
