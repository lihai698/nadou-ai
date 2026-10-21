/* Canvas connection layer: canvas-connection-layer. Host supplies live state and effects. */
(function(root){
    'use strict';

function portPoint(deps, id, kind){
    const n = deps.nodes.find(x => x.id === id);
    if(!n) return {x:0,y:0};  // 真正的孤儿连线（节点已删除）：renderLinks 会跳过它
    const el = deps.nodesEl.querySelector(`.node[data-id="${deps.CSS.escape(id)}"]`);
    const port = el?.querySelector(`.port.${kind}`);
    if(port){
        const r = port.getBoundingClientRect();
        return deps.screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
    }
    // 没有 DOM（节点渲染失败被跳过）或没找到端口时，用节点存储的几何坐标兜底，
    // 让连线仍画在节点附近，而不是落到 (0,0) 或干脆消失。
    const w = (el?.offsetWidth) || n.w || 260, h = (el?.offsetHeight) || n.h || 160;
    const nx = Number(n.x) || 0, ny = Number(n.y) || 0;
    return kind === 'out' ? {x:nx + w, y:ny + h / 2} : {x:nx, y:ny + h / 2};
}

function canResolvePort(deps, id){
    // 只跳过“真正的孤儿连线”（端点节点已不存在）；节点存在但暂时没 DOM 的，portPoint 会用几何坐标兜底。
    return Boolean(deps.nodes.find(x => x.id === id));
}

function renderLinks(deps){
    deps.linksEl.innerHTML = '';
    deps.linkControlsEl.innerHTML = '';
    // 先批量读取所有端点坐标（portPoint 里有 getBoundingClientRect），再统一写入 DOM。
    // 否则“读一条 rect → append 一条线”交错进行，每次 append 都让布局失效，下一次读 rect 就触发一次
    // 全量强制重排（layout thrashing），连线一多拖动就掉帧。读写分离后每帧只强制重排一次。
    const segments = [];
    deps.connections.forEach(c => {
        // 端点无法解析（节点已删除、或尚未渲染出 DOM）就跳过，否则连线会被画到 (0,0)，
        // 看起来像很多连线都从同一个空白处中转。
        if(!canResolvePort(deps, c.from) || !canResolvePort(deps, c.to)) return;
        segments.push({c, a:portPoint(deps, c.from, 'out'), b:portPoint(deps, c.to, 'in')});
    });
    segments.forEach(({c, a, b}) => {
        const relClass = isConnectionSelected(deps, c) ? ' link-active' : '';
        deps.linksEl.appendChild(pathEl(deps, a.x, a.y, b.x, b.y, `link${relClass}`));
        deps.linkControlsEl.appendChild(linkDeleteButton(deps, c, a, b));
        deps.linksEl.appendChild(linkHitEl(deps, a.x, a.y, b.x, b.y, c.id));
    });
    renderTempLink(deps);
    renderKnifeTrail(deps);
}

function renderTempLink(deps){
    let path = deps.linksEl.querySelector?.('.link.temp');
    if(!deps.tempLink){ path?.remove(); return; }
    const t=deps.tempLink;
    const a=t.originKind==='in' ? {x:t.x2,y:t.y2} : {x:t.x1,y:t.y1};
    const b=t.originKind==='in' ? {x:t.x1,y:t.y1} : {x:t.x2,y:t.y2};
    if(!path){
        path=pathEl(deps,a.x,a.y,b.x,b.y,'link temp');
        deps.linksEl.appendChild(path);
    } else {
        const dx=Math.max(80,Math.abs(b.x-a.x)*.45);
        path.setAttribute('d',`M ${a.x} ${a.y} C ${a.x+dx} ${a.y}, ${b.x-dx} ${b.y}, ${b.x} ${b.y}`);
    }
}

function renderKnifeTrail(deps){
    if(!deps.knifeActive || deps.knifeTrail.length < 2) return;
    const poly = deps.document.createElementNS('http://www.w3.org/2000/svg','polyline');
    poly.setAttribute('points', deps.knifeTrail.map(p => `${p.x},${p.y}`).join(' '));
    poly.setAttribute('class', 'link knife-trail');
    deps.linksEl.appendChild(poly);
}

function linkDeleteButton(deps, connection, a, b){
    const btn = deps.document.createElement('button');
    btn.className = `link-delete ${isConnectionSelected(deps, connection) ? 'visible' : ''} ${deps.hoveredConnectionId === connection.id ? 'hover' : ''}`;
    btn.type = 'button';
    btn.title = deps.tr('canvas.deleteLink');
    btn.setAttribute('aria-label', deps.tr('canvas.deleteLink'));
    btn.dataset.connectionId = connection.id;
    btn.style.left = `${(a.x + b.x) / 2}px`;
    btn.style.top = `${(a.y + b.y) / 2}px`;
    btn.textContent = '×';
    btn.onclick = e => deps.deleteConnection(connection.id, e);
    return btn;
}

function linkHitEl(deps, x1,y1,x2,y2,id){
    const p = pathEl(deps, x1, y1, x2, y2, 'link-hit');
    p.dataset.connectionId = id;
    return p;
}

function setHoveredConnection(deps, id){
    if(deps.hoveredConnectionId === id) return;
    const oldId = deps.hoveredConnectionId;
    deps.hoveredConnectionId = id || '';
    if(oldId){
        const oldBtn = deps.linkControlsEl.querySelector(`[data-connection-id="${deps.CSS.escape(oldId)}"]`);
        if(oldBtn) oldBtn.classList.remove('hover');
    }
    if(deps.hoveredConnectionId){
        const btn = deps.linkControlsEl.querySelector(`[data-connection-id="${deps.CSS.escape(deps.hoveredConnectionId)}"]`);
        if(btn) btn.classList.add('hover');
    }
}

function connectionDistanceToPoint(deps, connection, point){
    const from = portPoint(deps, connection.from, 'out');
    const to = portPoint(deps, connection.to, 'in');
    let min = Infinity;
    let prev = cubicPoint(deps, from, to, 0);
    for(let i = 1; i <= 28; i++){
        const cur = cubicPoint(deps, from, to, i / 28);
        min = Math.min(min, pointSegmentDistance(deps, point, prev, cur));
        prev = cur;
    }
    return min;
}

function updateConnectionHoverFromMouse(deps, e){
    if(!deps.canvas || deps.tempLink || deps.dragNode || deps.dragBoard || deps.resizeNode || deps.knifeActive){
        setHoveredConnection(deps, '');
        return;
    }
    const button = deps.document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.link-delete');
    if(button?.dataset.connectionId){
        setHoveredConnection(deps, button.dataset.connectionId);
        return;
    }
    const point = deps.screenToWorld(e.clientX, e.clientY);
    const threshold = Math.max(12, 16 / deps.viewport.scale);
    let bestId = '';
    let best = Infinity;
    deps.connections.forEach(c => {
        const d = connectionDistanceToPoint(deps, c, point);
        if(d < best){ best = d; bestId = c.id; }
    });
    setHoveredConnection(deps, best <= threshold ? bestId : '');
}

function isConnectionSelected(deps, connection){
    return deps.selected.has(connection.from) || deps.selected.has(connection.to);
}

function pathEl(deps, x1,y1,x2,y2,cls){
    const p = deps.document.createElementNS('http://www.w3.org/2000/svg','path');
    const dx = Math.max(80, Math.abs(x2 - x1) * .45);
    p.setAttribute('d', `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`);
    p.setAttribute('class', cls);
    return p;
}

function pointSegmentDistance(deps, p, a, b){
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if(!len2) return Math.hypot(p.x - a.x, p.y - a.y);
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

function cubicPoint(deps, a, b, t){
    const dx = Math.max(80, Math.abs(b.x - a.x) * .45);
    const p1 = {x:a.x + dx, y:a.y};
    const p2 = {x:b.x - dx, y:b.y};
    const u = 1 - t;
    return {
        x:u*u*u*a.x + 3*u*u*t*p1.x + 3*u*t*t*p2.x + t*t*t*b.x,
        y:u*u*u*a.y + 3*u*u*t*p1.y + 3*u*t*t*p2.y + t*t*t*b.y
    };
}

    function segmentsIntersect(deps, a, b, c, d){
    const orient = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    const onSeg = (p, q, r) => Math.min(p.x, r.x) <= q.x && q.x <= Math.max(p.x, r.x) && Math.min(p.y, r.y) <= q.y && q.y <= Math.max(p.y, r.y);
    const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
    if(o1 === 0 && onSeg(a, c, b)) return true;
    if(o2 === 0 && onSeg(a, d, b)) return true;
    if(o3 === 0 && onSeg(c, a, d)) return true;
    if(o4 === 0 && onSeg(c, b, d)) return true;
    return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
}

function segmentIntersectsRect(deps, a, b, r){
    if(a.x >= r.x && a.x <= r.x + r.w && a.y >= r.y && a.y <= r.y + r.h) return true;
    if(b.x >= r.x && b.x <= r.x + r.w && b.y >= r.y && b.y <= r.y + r.h) return true;
    const p1 = {x:r.x, y:r.y}, p2 = {x:r.x + r.w, y:r.y}, p3 = {x:r.x + r.w, y:r.y + r.h}, p4 = {x:r.x, y:r.y + r.h};
    return segmentsIntersect(deps, a, b, p1, p2) || segmentsIntersect(deps, a, b, p2, p3) || segmentsIntersect(deps, a, b, p3, p4) || segmentsIntersect(deps, a, b, p4, p1);
}

    const api={portPoint, canResolvePort, renderLinks, renderTempLink, renderKnifeTrail, linkDeleteButton, linkHitEl, setHoveredConnection, connectionDistanceToPoint, updateConnectionHoverFromMouse, isConnectionSelected, pathEl, pointSegmentDistance, cubicPoint, segmentsIntersect, segmentIntersectsRect};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.CanvasConnectionLayer=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
