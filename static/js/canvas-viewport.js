/* Viewport and minimap responsibility: canvas-viewport. Host supplies live state and effects. */
(function(root){
    'use strict';

    function applyViewport(deps){
        deps.world.style.transform = `translate(${deps.viewport.x}px, ${deps.viewport.y}px) scale(${deps.viewport.scale})`;
        if(deps.window.CanvasVideoDeconstructionBridge) deps.window.CanvasVideoDeconstructionUI.updateScale(deps.window.CanvasVideoDeconstructionBridge);
        scheduleMinimapRender(deps);
        deps.scheduleCanvasImageResolutionSync(deps.nodesEl, 120);
    }

    function renderMinimap(deps){
        if(!deps.minimapContent || !deps.minimapViewport) return;
        deps.canvasArrangeBtn?.classList.toggle('visible', deps.selected.size > 0);
        const bounds = minimapBounds(deps);
        const cw = deps.minimapContent.clientWidth || 172;
        const ch = deps.minimapContent.clientHeight || 110;
        const scale = Math.min(cw / bounds.w, ch / bounds.h);
        const mapW = bounds.w * scale;
        const mapH = bounds.h * scale;
        const ox = (cw - mapW) / 2;
        const oy = (ch - mapH) / 2;
        deps.minimapState = {bounds, scale, ox, oy, cw, ch};
        const nodeHtml = (deps.nodes || []).map(n => {
            const r = estimatedNodeRect(deps, n);
            return `<div class="minimap-node ${deps.selected.has(n.id) ? 'selected' : ''}" style="left:${ox + (r.x - bounds.x) * scale}px;top:${oy + (r.y - bounds.y) * scale}px;width:${Math.max(3, r.w * scale)}px;height:${Math.max(3, r.h * scale)}px"></div>`;
        }).join('');
        deps.minimapContent.innerHTML = `${nodeHtml}${deps.nodes?.length ? '' : '<div class="minimap-empty">EMPTY</div>'}<div id="minimapViewport" class="minimap-viewport"></div>`;
        deps.minimapViewport = deps.document.getElementById('minimapViewport');
        updateMinimapViewport(deps);
    }

    function minimapEventToWorld(deps, e){
        if(!deps.minimapState) renderMinimap(deps);
        const state = deps.minimapState;
        const rect = deps.minimapContent.getBoundingClientRect();
        const x = (e.clientX - rect.left - state.ox) / state.scale + state.bounds.x;
        const y = (e.clientY - rect.top - state.oy) / state.scale + state.bounds.y;
        return {x, y};
    }

    function centerViewportOnWorldPoint(deps, point){
        const rect = deps.board.getBoundingClientRect();
        deps.viewport.x = rect.width / 2 - point.x * deps.viewport.scale;
        deps.viewport.y = rect.height / 2 - point.y * deps.viewport.scale;
        applyViewport(deps);
        deps.renderLinks();
        deps.renderSelectionHub();
    }

    function fitAllNodesViewport(deps){
        const rect = deps.board.getBoundingClientRect();
        if(!deps.nodes.length){
            deps.viewport.scale = 0.45;
            deps.viewport.x = rect.width / 2;
            deps.viewport.y = rect.height / 2;
            applyViewport(deps);
            deps.renderLinks();
            deps.renderSelectionHub();
            scheduleViewportSave(deps);
            return;
        }
        const rects = deps.nodes.map((...args)=>estimatedNodeRect(deps, ...args));
        const minX = Math.min(...rects.map(r => r.x));
        const minY = Math.min(...rects.map(r => r.y));
        const maxX = Math.max(...rects.map(r => r.x + r.w));
        const maxY = Math.max(...rects.map(r => r.y + r.h));
        const pad = 180;
        const width = Math.max(1, maxX - minX + pad * 2);
        const height = Math.max(1, maxY - minY + pad * 2);
        const nextScale = Math.max(0.06, Math.min(0.82, (rect.width - 80) / width, (rect.height - 80) / height));
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        deps.viewport.scale = nextScale;
        deps.viewport.x = rect.width / 2 - cx * deps.viewport.scale;
        deps.viewport.y = rect.height / 2 - cy * deps.viewport.scale;
        applyViewport(deps);
        deps.renderLinks();
        deps.renderSelectionHub();
        scheduleViewportSave(deps);
    }

    function enterZoomPreview(deps){
        if(deps.zoomPreviewState || !deps.canvas) return;
        deps.zoomPreviewState = {...deps.viewport};
        deps.shell.classList.add('zoom-preview');
        deps.document.body.classList.add('canvas-zoom-preview');
        deps.closeCreateMenu();
        deps.closeLinkCreateMenu();
        fitAllNodesViewport(deps);
    }

    function exitZoomPreview(deps, point=null){
        if(!deps.zoomPreviewState) return false;
        const prev = deps.zoomPreviewState;
        deps.zoomPreviewState = null;
        deps.shell.classList.remove('zoom-preview');
        deps.document.body.classList.remove('canvas-zoom-preview');
        deps.viewport.scale = safeViewportScale(deps, prev.scale);
        if(point){
            const rect = deps.board.getBoundingClientRect();
            deps.viewport.x = rect.width / 2 - point.x * deps.viewport.scale;
            deps.viewport.y = rect.height / 2 - point.y * deps.viewport.scale;
        } else {
            deps.viewport.x = prev.x;
            deps.viewport.y = prev.y;
        }
        applyViewport(deps);
        deps.renderLinks();
        deps.renderSelectionHub();
        scheduleViewportSave(deps);
        return true;
    }

    function exitZoomPreviewToNode(deps, nodeId){
        if(!deps.zoomPreviewState) return false;
        const node = deps.nodes.find(n => n.id === nodeId);
        if(!node) return exitZoomPreview(deps);
        const prev = deps.zoomPreviewState;
        const boardRect = deps.board.getBoundingClientRect();
        const rect = estimatedNodeRect(deps, node);
        const cx = rect.x + rect.w / 2;
        const cy = rect.y + rect.h / 2;
        const fitW = Math.max(1, boardRect.width - 160);
        const fitH = Math.max(1, boardRect.height - 160);
        const fitScale = Math.min(
            deps.ZOOM_PREVIEW_NODE_MAX_SCALE,
            fitW / Math.max(1, rect.w),
            fitH / Math.max(1, rect.h)
        );
        const readableScale = Math.min(deps.ZOOM_PREVIEW_NODE_MAX_SCALE, Math.max(deps.ZOOM_PREVIEW_NODE_DEFAULT_SCALE, fitScale));
        deps.zoomPreviewState = null;
        deps.shell.classList.remove('zoom-preview');
        deps.document.body.classList.remove('canvas-zoom-preview');
        deps.viewport.scale = Math.max(safeViewportScale(deps, prev.scale), readableScale);
        deps.viewport.x = boardRect.width / 2 - cx * deps.viewport.scale;
        deps.viewport.y = boardRect.height / 2 - cy * deps.viewport.scale;
        applyViewport(deps);
        deps.renderLinks();
        deps.renderSelectionHub();
        scheduleViewportSave(deps);
        return true;
    }

    function toggleZoomPreview(deps){
        if(deps.zoomPreviewState) exitZoomPreview(deps);
        else enterZoomPreview(deps);
    }

    function loadLocalViewportMap(deps){
        try {
            const data = JSON.parse(deps.sessionStorage.getItem(deps.CANVAS_SESSION_VIEWPORTS_KEY) || '{}');
            return data && typeof data === 'object' ? data : {};
        } catch(e) {
            return deps.canvasSessionViewportFallback;
        }
    }

    function localViewportForCanvas(deps, canvasId, fallback={x:0, y:0, scale:1}){
        const item = loadLocalViewportMap(deps)[canvasId || ''];
        if(!item || typeof item !== 'object') return {...fallback};
        return {
            x:Number.isFinite(Number(item.x)) ? Number(item.x) : Number(fallback.x || 0),
            y:Number.isFinite(Number(item.y)) ? Number(item.y) : Number(fallback.y || 0),
            scale:Number.isFinite(Number(item.scale)) ? Math.max(.12, Math.min(8, Number(item.scale))) : Number(fallback.scale || 1)
        };
    }

    function saveLocalViewport(deps){
        if(!deps.canvas?.id) return;
        const map = loadLocalViewportMap(deps);
        map[deps.canvas.id] = {
            x:Number(deps.viewport.x || 0),
            y:Number(deps.viewport.y || 0),
            scale:Number(deps.viewport.scale || 1),
            updatedAt:Date.now()
        };
        deps.canvasSessionViewportFallback = map;
        try {
            deps.sessionStorage.setItem(deps.CANVAS_SESSION_VIEWPORTS_KEY, JSON.stringify(map));
        } catch(e) {}
    }

    function estimatedNodeRect(deps, n){
        const el = deps.nodesEl?.querySelector?.(`.node[data-id="${deps.CSS.escape(n.id)}"]`);
        const size = deps.defaultNodeSize(n.type);
        const w = el?.offsetWidth || n.w || size.w || 260;
        const h = el?.offsetHeight || n.h || size.h || 160;
        return {x:n.x || 0, y:n.y || 0, w, h};
    }

    function currentWorldViewRect(deps){
        const rect = deps.board.getBoundingClientRect();
        const scale = deps.viewport.scale || 1;
        return {
            x:-deps.viewport.x / scale,
            y:-deps.viewport.y / scale,
            w:rect.width / scale,
            h:rect.height / scale
        };
    }

    function minimapBounds(deps){
        const rects = (deps.nodes || []).map((...args)=>estimatedNodeRect(deps, ...args));
        rects.push(currentWorldViewRect(deps));
        if(!rects.length) return {x:0, y:0, w:1000, h:700};
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        rects.forEach(r => {
            minX = Math.min(minX, r.x);
            minY = Math.min(minY, r.y);
            maxX = Math.max(maxX, r.x + r.w);
            maxY = Math.max(maxY, r.y + r.h);
        });
        const pad = Math.max(240, Math.max(maxX - minX, maxY - minY) * 0.08);
        return {x:minX - pad, y:minY - pad, w:Math.max(1, maxX - minX + pad * 2), h:Math.max(1, maxY - minY + pad * 2)};
    }

    function scheduleMinimapRender(deps){
        if(deps.minimapRenderQueued) return;
        deps.minimapRenderQueued = true;
        deps.requestAnimationFrame(() => {
            deps.minimapRenderQueued = false;
            renderMinimap(deps);
        });
    }

    function scheduleLinksRender(deps){
        if(deps.linksRenderQueued) return;
        deps.linksRenderQueued = true;
        deps.requestAnimationFrame(() => {
            deps.linksRenderQueued = false;
            deps.renderLinks();
        });
    }

    function updateMinimapViewport(deps){
        if(!deps.minimapViewport || !deps.minimapState) return;
        const r = currentWorldViewRect(deps);
        const {bounds, scale, ox, oy} = deps.minimapState;
        deps.minimapViewport.style.left = `${ox + (r.x - bounds.x) * scale}px`;
        deps.minimapViewport.style.top = `${oy + (r.y - bounds.y) * scale}px`;
        deps.minimapViewport.style.width = `${Math.max(8, r.w * scale)}px`;
        deps.minimapViewport.style.height = `${Math.max(8, r.h * scale)}px`;
    }

    function safeViewportScale(deps, value){
        const n = Number(value);
        return Number.isFinite(n) && n > 0 ? n : 1;
    }

    function refreshGeometry(deps){
        deps.renderLinks();
        deps.renderSelectionHub();
    }

    function refreshGeometryAfterLayout(deps){
        deps.requestAnimationFrame(() => {
            refreshGeometry(deps);
            deps.requestAnimationFrame((...args)=>refreshGeometry(deps, ...args));
        });
    }

    function scheduleViewportSave(deps){
        saveLocalViewport(deps);
    }

    const api={applyViewport, renderMinimap, minimapEventToWorld, centerViewportOnWorldPoint, fitAllNodesViewport, enterZoomPreview, exitZoomPreview, exitZoomPreviewToNode, toggleZoomPreview, loadLocalViewportMap, localViewportForCanvas, saveLocalViewport, estimatedNodeRect, currentWorldViewRect, minimapBounds, scheduleMinimapRender, scheduleLinksRender, updateMinimapViewport, safeViewportScale, refreshGeometry, refreshGeometryAfterLayout, scheduleViewportSave};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.CanvasViewport=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
