/* Canvas output application and history coordination: canvas-output-edit. Host supplies live state and effects. */
(function(root){
    'use strict';

function createInputGroupFromOutput(deps, node, point){
    const urls = deps.outputImageUrls(node);
    if(!node || !urls.length) return null;
    const cols = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(urls.length))));
    const cardW = 260;
    const cardH = 336;
    const gap = 24;
    const base = point || {x:Number(node.x || 0), y:Number(node.y || 0)};
    const imageNodes = urls.map((url, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const img = {
            id:deps.uid('img'),
            type:'image',
            x:base.x + 24 + col * (cardW + gap),
            y:base.y + 58 + row * (cardH + gap),
            w:cardW,
            h:cardH,
            url,
            name:deps.outputImageName(url)
        };
        deps.nodes.push(img);
        return img;
    });
    const rows = Math.ceil(urls.length / cols);
    const group = {
        id:deps.uid('grp'),
        type:'group',
        x:base.x,
        y:base.y,
        w:cols * cardW + (cols - 1) * gap + 48,
        h:rows * cardH + (rows - 1) * gap + 90,
        items:imageNodes.map(img => img.id)
    };
    deps.nodes.push(group);
    return group;
}

function convertOutputNodeToInputGroup(deps, nodeId){
    const node = deps.nodes.find(n => n.id === nodeId);
    if(!node || node.type !== 'output') return;
    if(!deps.outputImageUrls(node).length) return;
    deps.pushUndo();
    const downstream = deps.connections.filter(c => c.from === nodeId).map(c => c.to);
    const group = createInputGroupFromOutput(deps, node, {x:Number(node.x || 0), y:Number(node.y || 0)});
    if(!group) return;
    deps.nodes = deps.nodes.filter(n => n.id !== nodeId);
    deps.connections = deps.connections.filter(c => c.from !== nodeId && c.to !== nodeId);
    downstream.forEach(toId => {
        if(deps.canConnect(group.id, toId) && !deps.connections.some(c => c.from === group.id && c.to === toId)){
            deps.connections.push({id:deps.uid('c'), from:group.id, to:toId});
        }
    });
    deps.selected.clear();
    deps.selected.add(group.id);
    deps.syncGeneratorInputs();
    deps.refreshGeneratorInputViews();
    deps.render();
    deps.scheduleSave();
}

function copyOutputNodeToInputGroup(deps, nodeId){
    const node = deps.nodes.find(n => n.id === nodeId);
    if(!node || node.type !== 'output') return;
    if(!deps.outputImageUrls(node).length) return;
    deps.pushUndo();
    const group = createInputGroupFromOutput(deps, node, {x:Number(node.x || 0) + 36, y:Number(node.y || 0) + 36});
    if(!group) return;
    deps.selected.clear();
    deps.selected.add(group.id);
    deps.syncGeneratorInputs();
    deps.refreshGeneratorInputViews();
    deps.render();
    deps.scheduleSave();
}

    const api={createInputGroupFromOutput, convertOutputNodeToInputGroup, copyOutputNodeToInputGroup};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.CanvasOutputEdit=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
