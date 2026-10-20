/* Node editing responsibility: canvas-group-edit. Host supplies live state and effects. */
(function(root){
    'use strict';

    function setCanvasGroupMembers(deps, group, memberIds){
        const targets = memberIds.map(id => deps.nodes.find(n => n.id === id));
        if(group.type !== 'group' || targets.some(n => !n || n.id === group.id || ['group','promptGroup'].includes(n.type))) throw new Error('原生分组成员无效');
        group.items = [...memberIds];
        if(targets.length){
            const box = deps.nodeBounds(memberIds);
            Object.assign(group, {x:box.x - 24, y:box.y - 88, w:box.w + 48, h:box.h + 120});
            if(targets.some(n => !['image','audio','prompt'].includes(n.type))) group.groupMode = 'workflow';
            handoffExistingInputsToGroup(deps, group, targets);
        }
        deps.syncGeneratorInputs();
        deps.refreshGeneratorInputViews();
    }

    function groupSelectedImages(deps){
        if(!deps.ensureCanvas()) return;
        const targets = [...deps.selected].map(id => deps.nodes.find(n => n.id === id)).filter(Boolean);
        if(targets.length === 1 && ['group','promptGroup'].includes(targets[0].type)) return;
        let group;
        deps.pushUndo();
        if(targets.length){
            const box = deps.nodeBounds(targets.map(n => n.id));
            group = {id:deps.uid('grp'), type:'group', x:box.x - 24, y:box.y - 88, w:box.w + 48, h:box.h + 120, items:targets.map(n => n.id)};
            if(targets.some(n => !['image','audio','prompt'].includes(n.type))) group.groupMode = 'workflow';
        } else {
            const p = deps.defaultPoint(0, 0);
            group = {id:deps.uid('grp'), type:'group', x:p.x, y:p.y, w:300, h:220, items:[]};
        }
        deps.nodes.push(group);
        if(targets.length) handoffExistingInputsToGroup(deps, group, targets);
        deps.selected.clear();
        deps.selected.add(group.id);
        deps.syncGeneratorInputs();
        deps.refreshGeneratorInputViews();
        deps.render();
        deps.scheduleSave();
    }

    function connectSelectionToGenerator(deps, kind, genId){
        const ids = [...deps.selected];
        let source = null;
        if(kind === 'images'){
            const imgs = ids.map(id => deps.nodes.find(n => n.id === id)).filter(n => n?.type === 'image' && n.url);
            if(!imgs.length) return;
            const box = deps.nodeBounds(imgs.map(n => n.id));
            source = {id:deps.uid('grp'), type:'group', x:box.x - 24, y:box.y - 58, w:box.w + 48, h:box.h + 90, items:imgs.map(n => n.id)};
        } else {
            const prompts = ids.map(id => deps.nodes.find(n => n.id === id)).filter(n => n?.type === 'prompt');
            if(!prompts.length) return;
            const box = deps.nodeBounds(prompts.map(n => n.id));
            source = {id:deps.uid('pg'), type:'promptGroup', x:box.x - 24, y:box.y - 58, w:box.w + 48, h:box.h + 90, items:prompts.map(n => n.id)};
        }
        deps.nodes.push(source);
        deps.connections.push({id:deps.uid('c'), from:source.id, to:genId});
        deps.selected.clear();
        deps.selected.add(source.id);
        deps.syncGeneratorInputs();
    }

    function handoffExistingInputsToGroup(deps, group, children){
        if(!group || group.type !== 'group' || group.groupMode === 'workflow') return false;
        const childIds = new Set((children || []).filter(n => ['image','prompt'].includes(n?.type)).map(n => n.id));
        if(!childIds.size) return false;
        const targetIds = new Set();
        deps.connections.forEach(c => {
            if(!childIds.has(c.from)) return;
            const target = deps.nodes.find(n => n.id === c.to);
            if(target && deps.CANVAS_GENERATOR_TYPES.includes(target.type)) targetIds.add(target.id);
        });
        if(!targetIds.size) return false;
        deps.connections = deps.connections.filter(c => !(childIds.has(c.from) && targetIds.has(c.to)));
        targetIds.forEach(targetId => {
            if(!deps.connections.some(c => c.from === group.id && c.to === targetId) && deps.canConnect(group.id, targetId)){
                deps.connections.push({id:deps.uid('c'), from:group.id, to:targetId});
            }
        });
        return true;
    }

    function updateGroupMembership(deps, movedNodes){
        const pairs = [
            {childType:'image', groupType:'group'},
            {childType:'audio', groupType:'group'},
            {childType:'prompt', groupType:'group'},
            {childType:'prompt', groupType:'promptGroup'},
            {childType:null, groupType:'group', workflow:true}
        ];
        let changed = false;
        const handoffGroupConnections = (group, child) => {
            if(!group || group.type !== 'group' || group.groupMode === 'workflow' || !['image','audio','prompt'].includes(child?.type)) return;
            const directTargets = deps.connections
                .filter(c => c.from === child.id)
                .map(c => deps.nodes.find(n => n.id === c.to))
                .filter(n => n && deps.CANVAS_GENERATOR_TYPES.includes(n.type));
            const groupTargets = deps.connections
                .filter(c => c.from === group.id)
                .map(c => deps.nodes.find(n => n.id === c.to))
                .filter(n => n && deps.CANVAS_GENERATOR_TYPES.includes(n.type));
            const targets = new Map([...directTargets, ...groupTargets].map(n => [n.id, n]));
            targets.forEach(target => {
                const before = deps.connections.length;
                deps.connections = deps.connections.filter(c => !(c.from === child.id && c.to === target.id));
                if(deps.connections.length !== before) changed = true;
                if(!deps.connections.some(c => c.from === group.id && c.to === target.id) && deps.canConnect(group.id, target.id)){
                    deps.connections.push({id:deps.uid('c'), from:group.id, to:target.id});
                    changed = true;
                }
            });
        };
        pairs.forEach(({childType, groupType, workflow=false}) => {
            const groups = deps.nodes.filter(n => n.type === groupType && (n.groupMode === 'workflow') === workflow);
            const children = movedNodes.filter(n => n && (childType ? n.type === childType : !['group','promptGroup'].includes(n.type)));
            if(!children.length || !groups.length) return;
            children.forEach(child => {
                const cr = deps.nodeRect(child);
                const containing = groups.find(g => {
                    const gr = deps.nodeRect(g);
                    return cr.cx >= gr.x && cr.cx <= gr.x + gr.w && cr.cy >= gr.y && cr.cy <= gr.y + gr.h;
                });
                groups.forEach(g => {
                    if(g === containing) return;
                    const idx = (g.items || []).indexOf(child.id);
                    if(idx >= 0){ g.items.splice(idx, 1); changed = true; }
                });
                if(containing){
                    containing.items = containing.items || [];
                    if(!containing.items.includes(child.id)){ containing.items.push(child.id); changed = true; }
                    handoffGroupConnections(containing, child);
                }
            });
        });
        if(changed){
            deps.syncGeneratorInputs();
            deps.refreshGeneratorInputViews();
            deps.render();
            deps.scheduleSave();
        }
    }

    const api={setCanvasGroupMembers, groupSelectedImages, connectSelectionToGenerator, handoffExistingInputsToGroup, updateGroupMembership};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.CanvasGroupEdit=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
