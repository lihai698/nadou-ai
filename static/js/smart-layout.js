/* Layout and interaction responsibility: smart-layout. Host supplies live state and effects. */
(function(root){
    'use strict';

    function safeScale(deps, value){
        const n = Number(value);
        return Number.isFinite(n) && n > 0 ? n : 1;
    }

    function nodeScale(deps, node){
        const v = Number(node?.scale);
        if((node?.images || []).length > 1 && v === deps.MEDIA_GROUP_PREVIOUS_DEFAULT_SCALE) return deps.MEDIA_GROUP_DEFAULT_SCALE;
        return Number.isFinite(v) && v > 0 ? v : 1;
    }

    function mediaNodeDefaultScale(deps, node){
        if((node?.images || []).length > 1 && !Number.isFinite(Number(node?.scale))) return deps.MEDIA_GROUP_DEFAULT_SCALE;
        return Number.isFinite(Number(node?.scale)) && Number(node.scale) > 0 ? Number(node.scale) : deps.MEDIA_NODE_DEFAULT_SCALE;
    }

    function smartGroupLayoutSize(deps, node){
        if(node?.groupMode==='frame') return {width:node.w||300,height:node.h||220};
        const explicitW = Number(node?.w);
        const explicitH = Number(node?.h);
        const width = Number.isFinite(explicitW) && explicitW >= deps.SMART_GROUP_MIN_WIDTH ? explicitW : deps.SMART_GROUP_DEFAULT_WIDTH;
        const height = !Number.isFinite(explicitH) || explicitH === deps.SMART_GROUP_LEGACY_HEIGHT
            ? deps.SMART_GROUP_DEFAULT_HEIGHT
            : Math.max(explicitH, deps.SMART_GROUP_MIN_HEIGHT);
        return {
            width:Math.round(width),
            height:Math.round(height)
        };
    }

    function smartGroupZoom(deps, group){
        const z = Number(group?._memberZoom);
        return Number.isFinite(z) && z > 0 ? z : 1;
    }

    function scaleSmartGroupMemberToZoom(deps, group, member, zoom){
        if(!member || !(zoom > 0) || zoom === 1) return;
        const r = nodeRect(deps, member);
        member.w = Math.max(40, Math.round((Number(r.width) || 0) * zoom));
        member.h = Math.max(40, Math.round((Number(r.height) || 0) * zoom));
        if(deps.isSmartImageNode(member)) member.scale = 1;
    }

    function smartGroupThumbLayout(deps, node){
        const refs = deps.smartGroupImageRefs(node).filter(ref => ref.item?.url);
        if(!refs.length) return null;
        const compactMembers = deps.smartGroupCompactMembers(node);
        const count = refs.length + compactMembers.length;
        const items = refs.map(ref => ref.item);
        const explicitW = Number(node?.w);
        const explicitH = Number(node?.h);
        const hasExplicit = Number.isFinite(explicitW) && explicitW >= deps.SMART_GROUP_MIN_WIDTH
            && Number.isFinite(explicitH) && explicitH >= deps.SMART_GROUP_MIN_HEIGHT;
        const scale = mediaNodeDefaultScale(deps, {type:'smart-image', images:items, scale:node?.scale});
        const summarySpace = 28;
        const outerPad = 32;
        if(node.frameGroupOperationId){
            const cols=Math.min(4,count),rows=Math.ceil(count/cols);
            return {refs,compactMembers,cols,rows,visibleRows:rows,width:Math.round(explicitW||cols*292+16),height:Math.round(explicitH||rows*222+60),thumb:190,single:count===1};
        }
        if(count === 1){
            if(hasExplicit){
                return {
                    refs,
                    compactMembers,
                    cols:1,
                    rows:1,
                    visibleRows:1,
                    width:Math.round(explicitW),
                    height:Math.round(explicitH),
                    thumb:Math.round(96 * scale),
                    single:true,
                    innerW:Math.max(24, Math.round(explicitW - outerPad)),
                    innerH:Math.max(24, Math.round(explicitH - outerPad - summarySpace))
                };
            }
            const single = singleImageLayout(deps, refs[0].item, {}, scale);
            return {
                refs,
                compactMembers,
                ...single,
                width:Math.max(deps.SMART_GROUP_MIN_WIDTH, Math.round(single.width + outerPad)),
                height:Math.max(deps.SMART_GROUP_MIN_HEIGHT, Math.round(single.height + outerPad + summarySpace)),
                innerW:single.width,
                innerH:single.height
            };
        }
        const gap = 8;
        const maxVisibleRows = compactMembers.length ? count : deps.SMART_GROUP_MAX_VISIBLE_ROWS;
        if(hasExplicit){
            const fitted = groupImageGridLayout(deps, count, Math.max(72, explicitW - outerPad), Math.max(56, explicitH - outerPad - summarySpace), 100000, 0, gap, maxVisibleRows);
            return {...fitted, refs, compactMembers, width:Math.round(explicitW), height:Math.round(explicitH)};
        }
        const thumb = Math.round(deps.MEDIA_GROUP_THUMB_BASE * scale);
        const cell = thumb + gap;
        const cols = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(count))));
        const rows = Math.ceil(count / cols);
        const visibleRows = Math.min(maxVisibleRows, rows);
        const gridW = cols * thumb + (cols - 1) * gap;
        const gridH = visibleRows * cell - gap;
        return {
            refs,
            compactMembers,
            cols,
            rows,
            visibleRows,
            thumb,
            width:Math.max(deps.SMART_GROUP_MIN_WIDTH, Math.round(gridW + outerPad)),
            height:Math.max(deps.SMART_GROUP_MIN_HEIGHT, Math.round(gridH + outerPad + summarySpace))
        };
    }

    function arrangeSmartGroupMembers(deps, group, options={}){
        if(!deps.isSmartGroupNode(group)) return false;
        const hasThumbImages = deps.smartGroupImageRefs(group).some(ref => ref.item?.url);
        if(hasThumbImages){
            const compactMembers = deps.smartGroupCompactMembers(group);
            if(!options.skipUndo) deps.pushUndo();
            const layout = smartGroupThumbLayout(deps, group);
            if(!layout) return true;
            const refs = layout.refs || [];
            const thumb = Math.max(28, Math.round(Number(layout.thumb) || 96));
            const gap = 8;
            const cols = Math.max(1, Number(layout.cols) || 1);
            const gridW = cols * thumb + Math.max(0, cols - 1) * gap;
            const contentW = Math.max(0, Math.round(Number(layout.width) || deps.SMART_GROUP_DEFAULT_WIDTH) - 32);
            const originX = (Number(group.x) || 0) + 16 + Math.max(0, Math.round((contentW - gridW) / 2));
            const originY = (Number(group.y) || 0) + 16 + 28;
            group.w = Math.max(deps.SMART_GROUP_MIN_WIDTH, Math.round(Number(layout.width) || deps.SMART_GROUP_DEFAULT_WIDTH));
            group.h = Math.max(deps.SMART_GROUP_MIN_HEIGHT, Math.round(Number(layout.height) || deps.SMART_GROUP_DEFAULT_HEIGHT));
            const ordered = compactMembers.slice().sort((a, b) => {
                const ra = nodeRect(deps, a), rb = nodeRect(deps, b);
                const dy = (Number(ra.y) || 0) - (Number(rb.y) || 0);
                if(Math.abs(dy) > 24) return dy;
                return (Number(ra.x) || 0) - (Number(rb.x) || 0);
            });
            ordered.forEach((member, memberIndex) => {
                const index = refs.length + memberIndex;
                const col = index % cols;
                const row = Math.floor(index / cols);
                member.x = Math.round(originX + col * (thumb + gap));
                member.y = Math.round(originY + row * (thumb + gap));
                member.w = thumb;
                member.h = thumb;
                member.scale = 1;
            });
            if(group._memberZoom !== undefined) group._memberZoom = 1;
            if(options.syncDom) deps.syncSmartGroupMemberElements(group);
            return true;
        }
        const members = deps.smartGroupMembers(group);
        if(!members.length) return false;
        if(!options.skipUndo) deps.pushUndo();
        const ordered = members.slice().sort((a, b) => {
            const ra = nodeRect(deps, a), rb = nodeRect(deps, b);
            const dy = (Number(ra.y) || 0) - (Number(rb.y) || 0);
            if(Math.abs(dy) > 24) return dy;
            return (Number(ra.x) || 0) - (Number(rb.x) || 0);
        });
        // 归一化图片成员尺寸：清掉入组缩放写入的 w/h，回到自然尺寸。否则反复拖出/拖入会越缩越小，
        // 且“整理”无法恢复——这是用户反馈的“拖出再拖入图片变小、整理也救不回来”的根因。
        ordered.forEach(node => {
            if(deps.isSmartImageNode(node)){
                delete node.w;
                delete node.h;
            }
        });
        const sizes = ordered.map(node => {
            const r = nodeRect(deps, node);
            return {node, w:Math.max(40, Number(r.width) || 120), h:Math.max(40, Number(r.height) || 120)};
        });
        const count = sizes.length;
        const pad = deps.SMART_GROUP_ARRANGE_PADDING;
        const gap = deps.SMART_GROUP_ARRANGE_GAP;
        const headerH = deps.SMART_GROUP_ARRANGE_HEADER;
        const cols = Math.max(1, Math.min(count, Math.round(Math.sqrt(count)) || 1));
        const rows = Math.ceil(count / cols);
        const colW = new Array(cols).fill(0);
        const rowH = new Array(rows).fill(0);
        sizes.forEach((s, i) => {
            const c = i % cols, r = Math.floor(i / cols);
            colW[c] = Math.max(colW[c], s.w);
            rowH[r] = Math.max(rowH[r], s.h);
        });
        const colX = [];
        let accX = 0;
        for(let c = 0; c < cols; c++){ colX[c] = accX; accX += colW[c] + gap; }
        const rowY = [];
        let accY = 0;
        for(let r = 0; r < rows; r++){ rowY[r] = accY; accY += rowH[r] + gap; }
        const originX = (Number(group.x) || 0) + pad;
        const originY = (Number(group.y) || 0) + headerH + pad;
        sizes.forEach((s, i) => {
            const c = i % cols, r = Math.floor(i / cols);
            s.node.x = Math.round(originX + colX[c] + (colW[c] - s.w) / 2);
            s.node.y = Math.round(originY + rowY[r] + (rowH[r] - s.h) / 2);
        });
        const totalW = colW.reduce((a, b) => a + b, 0) + gap * (cols - 1) + pad * 2;
        const totalH = rowH.reduce((a, b) => a + b, 0) + gap * (rows - 1) + pad * 2 + headerH;
        group.w = Math.max(deps.SMART_GROUP_MIN_WIDTH, Math.round(totalW));
        group.h = Math.max(deps.SMART_GROUP_MIN_HEIGHT, Math.round(totalH));
        // 成员已回到自然尺寸，分组缩放基准随之归零，避免后续再缩放时跳变。
        if(group._memberZoom !== undefined) group._memberZoom = 1;
        return true;
    }

    function mediaLayoutSize(deps, img){
        const width = Number(img?.natural_w || img?.width || img?.w || img?.layout_w || img?.preview_w || 0);
        const height = Number(img?.natural_h || img?.height || img?.h || img?.layout_h || img?.preview_h || 0);
        return width > 0 && height > 0 ? {width, height} : {width:0, height:0};
    }

    function singleImageLayout(deps, image, node, scale){
        const explicitW = Number(node?.w);
        const explicitH = Number(node?.h);
        if(Number.isFinite(explicitW) && explicitW > 24 && Number.isFinite(explicitH) && explicitH > 24){
            return {cols:1, rows:1, width:Math.round(explicitW), height:Math.round(explicitH), thumb:Math.round(96 * scale), single:true};
        }
        // 音频没有自然宽高，否则会套用图片的 260x180 默认框，导致卡片四周大片空白。给一个贴合内容的紧凑尺寸。
        if(deps.isAudioMediaItem(image)){
            return {cols:1, rows:1, width:Math.round(288 * scale), height:Math.round(150 * scale), thumb:Math.round(96 * scale), single:true};
        }
        const layoutSize = mediaLayoutSize(deps, image);
        const naturalW = layoutSize.width;
        const naturalH = layoutSize.height;
        if(naturalW > 0 && naturalH > 0){
            const maxW = 260 * scale;
            const maxH = 220 * scale;
            const fit = Math.min(maxW / naturalW, maxH / naturalH);
            return {
                cols:1,
                rows:1,
                width:Math.max(72, Math.round(naturalW * fit)),
                height:Math.max(72, Math.round(naturalH * fit)),
                thumb:Math.round(96 * scale),
                single:true
            };
        }
        return {cols:1, rows:1, width:Math.round(260*scale), height:Math.round(180*scale), thumb:Math.round(96*scale), single:true};
    }

    function groupImageGridLayout(deps, count, explicitW, explicitH, maxThumb, pad=32, gap=8, maxVisibleRows=deps.MEDIA_GROUP_MAX_VISIBLE_ROWS){
        let best = null;
        for(let cols = 1; cols <= count; cols++){
            const rows = Math.ceil(count / cols);
            const visibleRows = Math.min(Math.max(1, maxVisibleRows), rows);
            const availableW = explicitW - pad - (cols - 1) * gap;
            const availableH = explicitH - pad - (visibleRows - 1) * gap;
            if(availableW <= 0 || availableH <= 0) continue;
            const rawThumb = Math.floor(Math.min(availableW / cols, availableH / visibleRows));
            const fittedThumb = Math.max(28, Math.min(maxThumb, rawThumb));
            const fits = rawThumb >= 28;
            const usedW = cols * fittedThumb + (cols - 1) * gap + pad;
            const usedH = visibleRows * fittedThumb + (visibleRows - 1) * gap + pad;
            const spareW = Math.max(0, explicitW - usedW);
            const spareH = Math.max(0, explicitH - usedH);
            const atMax = fittedThumb >= maxThumb;
            const score = [
                fits ? 1 : 0,
                fittedThumb,
                atMax ? cols : 0,
                -(spareW + spareH * 0.35),
                -rows
            ];
            let better = !best;
            if(best){
                for(let i = 0; i < score.length; i++){
                    if(score[i] === best.score[i]) continue;
                    better = score[i] > best.score[i];
                    break;
                }
            }
            if(better){
                best = {cols, rows, visibleRows, thumb:fittedThumb, score};
            }
        }
        const fallbackCols = Math.min(count, 2);
        const fallbackRows = Math.ceil(count / fallbackCols);
        return best || {cols:fallbackCols, rows:fallbackRows, visibleRows:Math.min(deps.MEDIA_GROUP_MAX_VISIBLE_ROWS, fallbackRows), thumb:28};
    }

    function promptNodeLayoutSize(deps, node){
        const oldCollapsedH = 230;
        const oldExpandedH = node?.llmSystemEnabled ? 400 : 340;
        const explicitW = Number(node?.w);
        const explicitH = Number(node?.h);
        if(deps.isSmartGroupCompactMember(node) && Number.isFinite(explicitW) && explicitW > 24 && Number.isFinite(explicitH) && explicitH > 24){
            return {width:Math.round(explicitW), height:Math.round(explicitH)};
        }
        const width = !Number.isFinite(explicitW) || explicitW === 360 ? 316 : explicitW;
        const fallbackH = deps.promptNodeMinHeight(node);
        const legacyExpandedH = node?.llmSystemEnabled ? 344 : 292;
        const height = !Number.isFinite(explicitH) || explicitH === 194 || explicitH === oldCollapsedH || explicitH === oldExpandedH || explicitH === legacyExpandedH
            ? fallbackH
            : Math.max(explicitH, fallbackH);
        return {width:Math.round(width), height:Math.round(height)};
    }

    function smartGroupImageGridLayout(deps, node){
        const images = (node?.images || []).filter(img => img?.url);
        const count = images.length;
        const s = mediaNodeDefaultScale(deps, node);
        if(count === 1){
            const single = singleImageLayout(deps, images[0], node, s);
            const explicitW = Number(node?.w), explicitH = Number(node?.h);
            const hasExplicit = Number.isFinite(explicitW) && explicitW > 24 && Number.isFinite(explicitH) && explicitH > 24;
            // 容器有 16px 内边距（PAD=32）；无显式尺寸时把外框放大 PAD，以包住图片，避免“分组比图片还小”。
            return hasExplicit ? single : {...single, width:single.width + 32, height:single.height + 32};
        }
        const baseThumb = Math.round(deps.MEDIA_GROUP_THUMB_BASE * s);
        const cell = baseThumb + 8;
        const PAD = 32;
        const explicitW = Number(node?.w);
        const explicitH = Number(node?.h);
        const cols = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(count))));
        const rows = Math.ceil(count / cols);
        const visibleRows = Math.min(deps.SMART_GROUP_MAX_VISIBLE_ROWS, rows);
        if(Number.isFinite(explicitW) && explicitW > 40 && Number.isFinite(explicitH) && explicitH > 40){
            // 用户拉伸过分组：按显式尺寸拟合，maxThumb 给一个极大值以解除“放大不超过原始”的限制。
            const fitted = groupImageGridLayout(deps, count, explicitW, explicitH, 100000, PAD, 8, deps.SMART_GROUP_MAX_VISIBLE_ROWS);
            return {cols:fitted.cols, rows:fitted.rows, visibleRows:fitted.visibleRows, width:Math.round(explicitW), height:fitted.visibleRows * (fitted.thumb + 8) - 8 + PAD, thumb:fitted.thumb};
        }
        const width = Math.max(Math.round(226 * s), cols * cell + PAD);
        const height = visibleRows * cell - 8 + PAD;
        return {cols, rows, visibleRows, width, height, thumb:baseThumb};
    }

    function imageLayout(deps, images, scale=1, node=null){
        if(node?.type === 'smart-shot-table') return {cols:1,rows:1,width:Math.max(560,Number(node.w)||1120),height:Math.max(300,Number(node.h)||390),thumb:96,single:true};
        if(node?.type === 'smart-group'){
            const groupThumbLayout = smartGroupThumbLayout(deps, node);
            if(groupThumbLayout) return groupThumbLayout;
            return {cols:1, rows:1, ...smartGroupLayoutSize(deps, node), thumb:96, single:true};
        }
        if(node?.type === 'smart-prompt') return {cols:1, rows:1, ...promptNodeLayoutSize(deps, node), thumb:96, single:true};
    
        if(node?.type === 'smart-loop'){
            const explicitW = Number(node.w);
            const explicitH = Number(node.h);
            if(deps.isSmartGroupCompactMember(node) && Number.isFinite(explicitW) && explicitW > 24 && Number.isFinite(explicitH) && explicitH > 24){
                return {cols:1, rows:1, width:Math.round(explicitW), height:Math.round(explicitH), thumb:96, single:true};
            }
            return {cols:1, rows:1, width:Math.round(Number(node.w) || smartLoopWidth(deps, node)), height:Math.round(Math.max(Number(node.h) || 0, smartLoopHeight(deps, node))), thumb:96, single:true};
        }
        const count = (images || []).length;
        const s = node?.type === 'smart-image' || !node?.type ? mediaNodeDefaultScale(deps, node) : (Number.isFinite(scale) && scale > 0 ? scale : 1);
        if(count === 0){
            const explicitW = Number(node?.w);
            const explicitH = Number(node?.h);
            const pending = Number(node?.pending) > 0 || Boolean(node?.queued);
            const fallbackW = pending ? 260 * s : deps.EMPTY_UPLOAD_NODE_WIDTH;
            const fallbackH = pending ? 180 * s : deps.EMPTY_UPLOAD_NODE_HEIGHT;
            return {
                cols:1,
                rows:1,
                width:Math.round(Number.isFinite(explicitW) && explicitW > 24 ? explicitW : fallbackW),
                height:Math.round(Number.isFinite(explicitH) && explicitH > 24 ? explicitH : fallbackH),
                thumb:Math.round(96*s),
                single:true
            };
        }
        if(count === 1) return singleImageLayout(deps, images[0], node, s);
        const thumb = Math.round(deps.MEDIA_GROUP_THUMB_BASE * s);
        const cell = thumb + 8;
        const PAD = 32; // group-node has 16px padding on each side
        const grid = images.find(img => img?.grid?.type === 'grid-split')?.grid;
        const explicitW = Number(node?.w);
        const explicitH = Number(node?.h);
        if(grid){
            const cols = Math.max(1, Number(grid.cols || 1));
            const rows = Math.max(1, Number(grid.rows || 1));
            const visibleRows = Math.min(deps.MEDIA_GROUP_MAX_VISIBLE_ROWS, rows);
            if(Number.isFinite(explicitW) && explicitW > 40 && Number.isFinite(explicitH) && explicitH > 40){
                const fittedThumb = Math.max(28, Math.floor(Math.min((explicitW - PAD - (cols - 1) * 8) / cols, (explicitH - PAD - (visibleRows - 1) * 8) / visibleRows)));
                return {cols, rows, visibleRows, width:Math.round(explicitW), height:visibleRows * (fittedThumb + 8) - 8 + PAD, thumb:fittedThumb};
            }
            return {cols, rows, visibleRows, width:Math.max(Math.round(226*s), cols * cell + PAD), height:visibleRows * cell - 8 + PAD, thumb};
        }
        const cols = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(count))));
        const rows = Math.ceil(count / cols);
        const visibleRows = Math.min(deps.MEDIA_GROUP_MAX_VISIBLE_ROWS, rows);
        if(Number.isFinite(explicitW) && explicitW > 40 && Number.isFinite(explicitH) && explicitH > 40){
            const fitted = groupImageGridLayout(deps, count, explicitW, explicitH, thumb, PAD, 8);
            return {cols:fitted.cols, rows:fitted.rows, visibleRows:fitted.visibleRows, width:Math.round(explicitW), height:fitted.visibleRows * (fitted.thumb + 8) - 8 + PAD, thumb:fitted.thumb};
        }
        const width = Math.max(Math.round(226*s), cols * cell + PAD);
        const height = visibleRows * cell - 8 + PAD;
        return {cols, rows, visibleRows, width, height, thumb};
    }

    function smartLoopWidth(deps, node){
        return 340;
    }

    function smartLoopHeight(deps, node){
        let h = 168;
        if(node?.imageInput) h += 72;
        if(node?.showPrompt) {
            const promptCount = Math.max(1, deps.smartLoopPromptFieldValues(node).length);
            h += 94 + promptCount * 58 + deps.smartLoopUpstreamPromptPreviewHeight(node);
        }
        h += deps.smartNodeInputThumbsHeight(deps.smartLoopPreviewImages(node));
        return h;
    }

    function fitSmartLoopNode(deps, node){
        if(!node || node.type !== 'smart-loop') return;
        node.w = smartLoopWidth(deps, node);
        node.h = smartLoopHeight(deps, node);
    }

    function nodeRect(deps, node){
        const layout = imageLayout(deps, node.images || [], nodeScale(deps, node), node);
        return {x:node.x || 0, y:node.y || 0, width:layout.width, height:layout.height};
    }

    function smartArrangeAtomicIds(deps, ids){
        const out = new Set((ids || []).filter(id => deps.nodes.some(n => n.id === id)));
        let changed = true;
        while(changed){
            changed = false;
            deps.nodes.filter(deps.isSmartGroupNode).forEach(group => {
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

    function translateSmartNodeWithMembers(deps, node, dx, dy, seen=new Set()){
        if(!node || seen.has(node.id)) return;
        seen.add(node.id);
        node.x = Math.round((Number(node.x) || 0) + dx);
        node.y = Math.round((Number(node.y) || 0) + dy);
        if(deps.isSmartGroupNode(node)){
            deps.smartGroupMembers(node).forEach(member => translateSmartNodeWithMembers(deps, member, dx, dy, seen));
        }
    }

    function moveSmartNodeAtom(deps, node, x, y){
        const dx = Math.round(x - (Number(node.x) || 0));
        const dy = Math.round(y - (Number(node.y) || 0));
        translateSmartNodeWithMembers(deps, node, dx, dy);
    }

    function arrangeSmartIdsByConnections(deps, ids){
        const idSet = new Set(smartArrangeAtomicIds(deps, ids));
        const selectedNodes = [...idSet].map(id => deps.nodes.find(n => n.id === id)).filter(Boolean);
        if(selectedNodes.length < 2) return false;
        const rects = selectedNodes.map(node => ({node, rect:nodeRect(deps, node)}));
        const startX = Math.min(...rects.map(item => item.rect.x));
        const startY = Math.min(...rects.map(item => item.rect.y));
        const internal = (deps.canvas?.connections || []).filter(c => idSet.has(c.from) && idSet.has(c.to));
        const depth = new Map(selectedNodes.map(node => [node.id, 0]));
        if(internal.length){
            const indegree = new Map(selectedNodes.map(node => [node.id, 0]));
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
        selectedNodes.forEach(node => {
            const d = depth.get(node.id) || 0;
            if(!groups.has(d)) groups.set(d, []);
            groups.get(d).push(node);
        });
        const sortedDepths = [...groups.keys()].sort((a, b) => a - b);
        let x = startX;
        sortedDepths.forEach(d => {
            const col = groups.get(d).slice().sort((a, b) => nodeRect(deps, a).y - nodeRect(deps, b).y || String(a.id).localeCompare(String(b.id)));
            let y = startY;
            let maxW = 0;
            col.forEach(node => {
                const rect = nodeRect(deps, node);
                moveSmartNodeAtom(deps, node, x, y);
                y += Math.max(110, rect.height) + 56;
                maxW = Math.max(maxW, Math.max(180, rect.width));
            });
            x += maxW + 180;
        });
        return true;
    }

    function arrangeSelectedSmartNodes(deps){
        if(!deps.canvas) return;
        const explicit = deps.selectedNodeIds().filter(id => deps.nodes.some(n => n.id === id));
        if(!explicit.length) return;
        const ids = smartArrangeAtomicIds(deps, explicit.length > 1 ? explicit : deps.connectedSmartClusterIds(explicit[0]));
        if(ids.length < 2) return;
        deps.pushUndo();
        if(!arrangeSmartIdsByConnections(deps, ids)) return;
        deps.render();
        deps.scheduleSave();
        deps.toast('已整理选中节点');
    }

    function screenToWorld(deps, event){
        const rect = deps.shell.getBoundingClientRect();
        return {
            x:(event.clientX - rect.left - deps.viewport.x) / deps.viewport.scale,
            y:(event.clientY - rect.top - deps.viewport.y) / deps.viewport.scale
        };
    }

    function viewportCenter(deps){
        return {
            x:(deps.shell.clientWidth / 2 - deps.viewport.x) / deps.viewport.scale,
            y:(deps.shell.clientHeight / 2 - deps.viewport.y) / deps.viewport.scale
        };
    }

    const api={safeScale, nodeScale, mediaNodeDefaultScale, smartGroupLayoutSize, smartGroupZoom, scaleSmartGroupMemberToZoom, smartGroupThumbLayout, arrangeSmartGroupMembers, mediaLayoutSize, singleImageLayout, groupImageGridLayout, promptNodeLayoutSize, smartGroupImageGridLayout, imageLayout, smartLoopWidth, smartLoopHeight, fitSmartLoopNode, nodeRect, smartArrangeAtomicIds, translateSmartNodeWithMembers, moveSmartNodeAtom, arrangeSmartIdsByConnections, arrangeSelectedSmartNodes, screenToWorld, viewportCenter};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.SmartLayout=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
