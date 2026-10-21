/* Viewport and minimap responsibility: smart-viewport. Host supplies live state and effects. */
(function(root){
    'use strict';

    function applyViewport(deps){
        if(deps.window.CanvasVideoDeconstructionBridge) deps.window.CanvasVideoDeconstructionUI?.updateScale(deps.window.CanvasVideoDeconstructionBridge);
        deps.world.style.transform = `translate(${deps.viewport.x}px, ${deps.viewport.y}px) scale(${deps.viewport.scale})`;
        deps.updateWorkgroupViewport?.();
        // world 被 transform:scale 缩放后，其内部带 backdrop-filter 的卡片（参数设置/合成卡等）
        // 会被部分浏览器（Chrome/Edge 等 Blink 内核）当作独立合成层先按 1x 栅格化、再整体缩放，
        // 缩小时位图被降采样 → 组件发虚。缩放态下关闭这些 backdrop-filter（底色本身已接近不透明，
        // 观感几乎无差），让卡片随矢量重新栅格化，保持清晰。
        deps.world.classList.toggle('canvas-scaled', Math.abs(deps.viewport.scale - 1) > 0.001);
        deps.shell.style.backgroundSize = '24px 24px';
        deps.shell.style.backgroundPosition = '0 0';
        renderMinimap(deps);
        deps.scheduleSmartImageResolutionSync(deps.world, 120);
    }

    function renderMinimap(deps){
        if(!deps.minimapContent || !deps.minimapViewport) return;
        deps.smartArrangeBtn?.classList.toggle('visible', deps.selectedNodeIds().length > 0);
        const width = deps.minimapContent.clientWidth || 170;
        const height = deps.minimapContent.clientHeight || 108;
        const viewW = deps.shell.clientWidth / deps.viewport.scale;
        const viewH = deps.shell.clientHeight / deps.viewport.scale;
        const viewX = -deps.viewport.x / deps.viewport.scale;
        const viewY = -deps.viewport.y / deps.viewport.scale;
        const rects = deps.nodes.filter(n => n.id !== deps.SMART_LOG_PREVIEW_NODE_ID).map(deps.nodeRect);
        rects.push({x:viewX, y:viewY, width:viewW, height:viewH});
        const minX = Math.min(...rects.map(r => r.x), -200);
        const minY = Math.min(...rects.map(r => r.y), -200);
        const maxX = Math.max(...rects.map(r => r.x + r.width), viewX + viewW + 200);
        const maxY = Math.max(...rects.map(r => r.y + r.height), viewY + viewH + 200);
        const scale = Math.min(width / Math.max(1, maxX - minX), height / Math.max(1, maxY - minY));
        const offsetX = (width - (maxX - minX) * scale) / 2;
        const offsetY = (height - (maxY - minY) * scale) / 2;
        deps.smartMinimapState = {minX, minY, scale, offsetX, offsetY, width, height};
        const project = r => ({
            left:offsetX + (r.x - minX) * scale,
            top:offsetY + (r.y - minY) * scale,
            width:Math.max(4, r.width * scale),
            height:Math.max(4, r.height * scale)
        });
        const nodeHtml = rects.slice(0, -1).map(r => {
            const p = project(r);
            return `<div class="minimap-node" style="left:${p.left}px;top:${p.top}px;width:${p.width}px;height:${p.height}px"></div>`;
        }).join('');
        const view = project({x:viewX, y:viewY, width:viewW, height:viewH});
        deps.minimapContent.innerHTML = `${nodeHtml}<div id="minimapViewport" class="smart-minimap-viewport" style="left:${view.left}px;top:${view.top}px;width:${view.width}px;height:${view.height}px"></div>`;
        deps.minimapViewport = deps.document.getElementById('minimapViewport');
    }

    function minimapEventToWorld(deps, event){
        if(!deps.smartMinimapState) renderMinimap(deps);
        const state = deps.smartMinimapState;
        if(!state) return deps.viewportCenter();
        const rect = deps.minimapContent.getBoundingClientRect();
        const mx = event.clientX - rect.left;
        const my = event.clientY - rect.top;
        return {
            x:state.minX + (mx - state.offsetX) / Math.max(0.0001, state.scale),
            y:state.minY + (my - state.offsetY) / Math.max(0.0001, state.scale)
        };
    }

    function centerViewportOnWorldPoint(deps, point){
        deps.viewport.x = deps.shell.clientWidth / 2 - point.x * deps.viewport.scale;
        deps.viewport.y = deps.shell.clientHeight / 2 - point.y * deps.viewport.scale;
        applyViewport(deps);
        deps.scheduleSave();
    }

    function fitAllNodesViewport(deps, ids){
        const targets=ids ? deps.nodes.filter(n=>ids.includes(n.id)) : deps.nodes;
        if(ids&&!targets.length)return;
        // 浏览器对工具栏的焦点滚动不能抵消画布定位，否则新节点仍会落在屏幕外。
        deps.shell.scrollLeft=0;deps.shell.scrollTop=0;
        if(!deps.nodes.length){
            deps.viewport.scale = 0.45;
            deps.viewport.x = deps.shell.clientWidth / 2;
            deps.viewport.y = deps.shell.clientHeight / 2;
            applyViewport(deps);
            deps.scheduleSave();
            return;
        }
        const rects = targets.map(deps.nodeRect);
        const minX = Math.min(...rects.map(r => r.x));
        const minY = Math.min(...rects.map(r => r.y));
        const maxX = Math.max(...rects.map(r => r.x + r.width));
        const maxY = Math.max(...rects.map(r => r.y + r.height));
        const pad = 160;
        const width = Math.max(1, maxX - minX + pad * 2);
        const height = Math.max(1, maxY - minY + pad * 2);
        const nextScale = Math.max(0.06, Math.min(0.82, (deps.shell.clientWidth - 80) / width, (deps.shell.clientHeight - 80) / height));
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        deps.viewport.scale = nextScale;
        deps.viewport.x = deps.shell.clientWidth / 2 - cx * deps.viewport.scale;
        deps.viewport.y = deps.shell.clientHeight / 2 - cy * deps.viewport.scale;
        applyViewport(deps);
        deps.scheduleSave();
    }

    function enterZoomPreview(deps){
        if(deps.zoomPreviewState) return;
        deps.zoomPreviewState = {...deps.viewport};
        deps.shell.classList.add('zoom-preview');
        deps.closeCreateMenu();
        fitAllNodesViewport(deps);
    }

    function exitZoomPreview(deps, point=null){
        if(!deps.zoomPreviewState) return false;
        const prev = deps.zoomPreviewState;
        deps.zoomPreviewState = null;
        deps.shell.classList.remove('zoom-preview');
        deps.viewport.scale = prev.scale;
        if(point){
            deps.viewport.x = deps.shell.clientWidth / 2 - point.x * deps.viewport.scale;
            deps.viewport.y = deps.shell.clientHeight / 2 - point.y * deps.viewport.scale;
        } else {
            deps.viewport.x = prev.x;
            deps.viewport.y = prev.y;
        }
        applyViewport(deps);
        deps.scheduleSave();
        return true;
    }

    function exitZoomPreviewToNode(deps, nodeId){
        if(!deps.zoomPreviewState) return false;
        const node = deps.nodes.find(n => n.id === nodeId);
        if(!node) return exitZoomPreview(deps);
        const prev = deps.zoomPreviewState;
        const rect = deps.nodeRect(node);
        const cx = rect.x + rect.width / 2;
        const cy = rect.y + rect.height / 2;
        const fitW = Math.max(1, deps.shell.clientWidth - 160);
        const fitH = Math.max(1, deps.shell.clientHeight - 160);
        const fitScale = Math.min(
            deps.ZOOM_PREVIEW_NODE_MAX_SCALE,
            fitW / Math.max(1, rect.width),
            fitH / Math.max(1, rect.height)
        );
        const readableScale = Math.min(deps.ZOOM_PREVIEW_NODE_MAX_SCALE, Math.max(deps.ZOOM_PREVIEW_NODE_DEFAULT_SCALE, fitScale));
        deps.zoomPreviewState = null;
        deps.shell.classList.remove('zoom-preview');
        deps.viewport.scale = Math.max(deps.safeScale(prev.scale), readableScale);
        deps.viewport.x = deps.shell.clientWidth / 2 - cx * deps.viewport.scale;
        deps.viewport.y = deps.shell.clientHeight / 2 - cy * deps.viewport.scale;
        applyViewport(deps);
        deps.scheduleSave();
        return true;
    }

    function toggleZoomPreview(deps){
        if(deps.zoomPreviewState) exitZoomPreview(deps);
        else enterZoomPreview(deps);
    }

    const api={applyViewport, renderMinimap, minimapEventToWorld, centerViewportOnWorldPoint, fitAllNodesViewport, enterZoomPreview, exitZoomPreview, exitZoomPreviewToNode, toggleZoomPreview};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.SmartViewport=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
