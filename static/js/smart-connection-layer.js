/* Canvas connection layer: smart-connection-layer. Host supplies live state and effects. */
(function(root){
    'use strict';

function renderConnections(deps){
    const nodeById = new Map();
    deps.nodes.forEach(node => { if(!nodeById.has(node.id)) nodeById.set(node.id, node); });
    const groupScopes = new Map();
    deps.nodes.forEach(node => {
        if(!deps.isSmartGroupNode(node) || !Array.isArray(node.items)) return;
        node.items.forEach(id => { if(!groupScopes.has(id)) groupScopes.set(id, node.id); });
    });
    const scopeFor = id => groupScopes.get(id) || (deps.isSmartGroupNode(nodeById.get(id)) ? id : '');
    const conns = (deps.canvas?.connections || []).map((conn, index) => ({...conn, index})).filter(c => nodeById.has(c.from) && nodeById.has(c.to));
    const cascadeKeys = deps.cascadeConnectionKeys();
    const activeCascadeCount = (deps.smartCascadeRunPath?.states && Object.values(deps.smartCascadeRunPath.states).filter(state => state && state !== 'done').length) || 0;
    const reduceMotion = activeCascadeCount > 24;
    const selectedConnIds = new Set(deps.selectedNodeIds());
    // 合并连线：同一来源连到同一分组的多个成员，合成一条到分组的连线（A→A1/A2/A3 显示为 A→分组），
    // 减少“每张图都拖一条线”的杂乱。history 连线不合并。
    const buckets = new Map();
    const items = [];
    conns.forEach(conn => {
        const kind = conn.kind || 'flow';
        const fromScope = kind === 'history' ? '' : scopeFor(conn.from);
        const toScope = kind === 'history' ? '' : scopeFor(conn.to);
        // 同一分组内部的连线（成员↔成员、成员↔分组本体）属于内部关系，入组后隐藏，保持整洁。
        if(fromScope && fromScope === toScope) return;
        // 终点是某分组的成员：把同一来源连到该分组各成员的线合并成一条到分组的线。
        const isMemberTarget = toScope && toScope !== conn.to;
        if(isMemberTarget){
            const key = `${conn.from}|${toScope}|${kind}`;
            let b = buckets.get(key);
            if(!b){ b = {merged:true, from:conn.from, toId:toScope, kind, indices:[], targets:[]}; buckets.set(key, b); items.push(b); }
            b.indices.push(conn.index);
            b.targets.push(conn.to);
        } else {
            items.push({merged:false, from:conn.from, toId:conn.to, kind, indices:[conn.index], targets:[conn.to]});
        }
    });
    const paths = items.map(item => {
        const fromNode = nodeById.get(item.from);
        const toNode = nodeById.get(item.toId);
        if(!fromNode || !toNode) return '';
        const fr = deps.nodeRect(fromNode), tr = deps.nodeRect(toNode);
        const kind = item.kind;
        const isHistory = kind === 'history';
        const dataIndex = item.indices.join(',');
        const isInsertPreview = item.indices.some(i => deps.loopInsertPreview?.index === i);
        const edgeKeys = item.targets.map(t => `${item.from}->${t}`);
        const states = edgeKeys.map(deps.smartCascadeEdgeState).filter(Boolean);
        let cascadeState = '';
        if(states.includes('active')) cascadeState = 'active';
        else if(states.some(s => s !== 'done')) cascadeState = states.find(s => s !== 'done');
        else if(states.length) cascadeState = 'done';
        const isCascade = !isHistory && (edgeKeys.some(k => cascadeKeys.has(k)) || Boolean(cascadeState) || isInsertPreview);
        const isPendingLine = !isCascade && item.targets.some(t => nodeById.get(t)?.pending);
        const isSelectedLine = selectedConnIds.size > 0 && (selectedConnIds.has(item.from) || selectedConnIds.has(item.toId) || item.targets.some(t => selectedConnIds.has(t)));
        const fx = isHistory ? fr.x + fr.width / 2 : fr.x + fr.width;
        const fy = isHistory ? fr.y + fr.height : fr.y + fr.height / 2;
        const tx = isHistory ? tr.x + tr.width / 2 : tr.x;
        const ty = isHistory ? tr.y : tr.y + tr.height / 2;
        const dx = Math.max(50, Math.abs(tx - fx) * 0.45);
        const dy = Math.max(36, Math.abs(ty - fy) * 0.45);
        const curve = isHistory
            ? `M${fx} ${fy} C ${fx} ${fy+dy}, ${tx} ${ty-dy}, ${tx} ${ty}`
            : `M${fx} ${fy} C ${fx+dx} ${fy}, ${tx-dx} ${ty}, ${tx} ${ty}`;
        const mx = (fx + tx) / 2, my = (fy + ty) / 2;
        const cls = [
            isPendingLine ? 'conn-pending' : '',
            isCascade ? 'conn-cascade' : '',
            isCascade && cascadeState === 'done' ? 'conn-cascade-done' : '',
            isCascade && Boolean(cascadeState) && cascadeState !== 'done' ? 'conn-cascade-wait' : '',
            isCascade && cascadeState === 'active' ? 'conn-cascade-active' : '',
            isHistory ? 'conn-history' : '',
            isSelectedLine ? 'conn-selected' : ''
        ].filter(Boolean).join(' ');
        const color = isCascade ? '#16a34a' : isHistory ? 'rgba(100,116,139,0.46)' : kind === 'input' ? 'rgba(100,116,139,0.62)' : 'rgba(148,163,184,0.62)';
        const opacity = isPendingLine ? '.82' : '1';
        const width = kind === 'input' ? '1.9' : '1.6';
        return `<path class="${cls} conn-line" data-conn-index="${dataIndex}" d="${curve}" stroke="${color}" stroke-width="${width}" fill="none" opacity="${opacity}"></path><path class="conn-hit" data-conn-index="${dataIndex}" d="${curve}" stroke="transparent" stroke-width="14" fill="none"></path><circle class="conn-end" data-conn-index="${dataIndex}" cx="${tx}" cy="${ty}" r="3.5" fill="${color}" opacity=".66"></circle><g class="conn-cut" data-conn-index="${dataIndex}" transform="translate(${mx} ${my})"><circle r="8" fill="var(--card)" stroke="${color}" stroke-width="1.4"></circle><path d="M-3 -3 L3 3 M3 -3 L-3 3" stroke="${color}" stroke-width="1.5" stroke-linecap="round"></path></g>`;
    }).join('');
    let connectionWidth = 6000, connectionHeight = 4000;
    nodeById.forEach(node => {
        const rect = deps.nodeRect(node);
        connectionWidth = Math.max(connectionWidth, Math.ceil(rect.x + rect.width + 100));
        connectionHeight = Math.max(connectionHeight, Math.ceil(rect.y + rect.height + 100));
    });
    return `<svg class="connection-layer ${reduceMotion ? 'conn-reduce-motion' : ''}" width="${connectionWidth}" height="${connectionHeight}" viewBox="0 0 ${connectionWidth} ${connectionHeight}" xmlns="http://www.w3.org/2000/svg">${paths}</svg>`;
}

function refreshConnectionLayer(deps){
    deps.connectionLayerRaf = 0;
    const oldSvg = deps.world.querySelector('svg.connection-layer');
    if(!oldSvg) return;
    const tpl = deps.document.createElement('template');
    tpl.innerHTML = renderConnections(deps).trim();
    const nextSvg = tpl.content.firstElementChild;
    if(nextSvg) oldSvg.replaceWith(nextSvg);
    deps.bindConnectionEvents();
}

function scheduleConnectionLayerRefresh(deps){
    if(deps.connectionLayerRaf) return;
    deps.connectionLayerRaf = deps.requestAnimationFrame((...args)=>refreshConnectionLayer(deps, ...args));
}

    const api={renderConnections, refreshConnectionLayer, scheduleConnectionLayerRefresh};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.SmartConnectionLayer=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
