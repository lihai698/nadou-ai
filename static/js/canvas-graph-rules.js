/* Read-only canvas graph and connection rules. No DOM or task submission. */
(function(root){
    'use strict';

    function canvasRunTypes(deps){
        return ['generator','midjourney','msgen','comfy','llm','video','rh'];
    }

    function canvasWorkflowEdges(deps){
        const runTypes = canvasRunTypes(deps);
        const direct = [];
        deps.connections.forEach(c => {
            const from = deps.nodes.find(n => n.id === c.from);
            const to = deps.nodes.find(n => n.id === c.to);
            if(!from || !to || !runTypes.includes(from.type)) return;
            if(runTypes.includes(to.type)){
                direct.push([from.id, to.id]);
                return;
            }
            if(to.type === 'output'){
                deps.connections.filter(cc => cc.from === to.id).forEach(cc => {
                    const next = deps.nodes.find(n => n.id === cc.to);
                    if(next && runTypes.includes(next.type)) direct.push([from.id, next.id]);
                });
            }
        });
        return direct;
    }

    function computeConnectedWorkflowOrder(deps, anchorId){
        const anchor = deps.nodes.find(n => n.id === anchorId);
        const runTypes = canvasRunTypes(deps);
        if(!anchor || !runTypes.includes(anchor.type)) return [];
        const edges = canvasWorkflowEdges(deps);
        const connected = new Set([anchorId]);
        let changed = true;
        while(changed){
            changed = false;
            edges.forEach(([from, to]) => {
                if(connected.has(from) && !connected.has(to)){ connected.add(to); changed = true; }
                if(connected.has(to) && !connected.has(from)){ connected.add(from); changed = true; }
            });
        }
        const order = [];
        const seen = new Set();
        const visit = id => {
            if(seen.has(id)) return;
            seen.add(id);
            edges.filter(([, to]) => to === id).forEach(([from]) => {
                if(connected.has(from)) visit(from);
            });
            if(connected.has(id)) order.push(id);
        };
        deps.nodes.filter(n => connected.has(n.id) && runTypes.includes(n.type)).forEach(n => visit(n.id));
        return order;
    }

    function computeCascadeOrder(deps, targetId){
        const visited = new Set();
        const order = [];
        const GEN_TYPES = canvasRunTypes(deps);
        function dfs(id){
            if(visited.has(id)) return;
            visited.add(id);
            const node = deps.nodes.find(n => n.id === id);
            if(!node) return;
            // 找该节点的上游
            deps.connections.filter(c => c.to === id).forEach(c => {
                const from = deps.nodes.find(n => n.id === c.from);
                if(!from) return;
                if(GEN_TYPES.includes(from.type)){
                    dfs(from.id);
                } else if(from.type === 'output'){
                    // output 节点的上游是生成器
                    deps.connections.filter(cc => cc.to === from.id).forEach(cc => {
                        const ff = deps.nodes.find(n => n.id === cc.from);
                        if(ff && GEN_TYPES.includes(ff.type)) dfs(ff.id);
                    });
                }
            });
            if(GEN_TYPES.includes(node.type)) order.push(id);
        }
        dfs(targetId);
        return order;
    }

    function upstreamNodeIds(deps, targetId){
        const found = new Set();
        const walk = id => {
            deps.connections.filter(c => c.to === id).forEach(c => {
                if(found.has(c.from)) return;
                found.add(c.from);
                walk(c.from);
            });
        };
        walk(targetId);
        return found;
    }

    function resolveCascadeLoop(deps, targetId){
        const upstream = upstreamNodeIds(deps, targetId);
        const loops = deps.nodes.filter(n => n.type === 'loop' && upstream.has(n.id));
        if(!loops.length) return null;
        const loop = loops[loops.length - 1];
        return {node:loop, count:deps.loopCount(loop), mode:loop.mode === 'parallel' ? 'parallel' : 'serial'};
    }

    function wouldCreateGeneratorCycle(deps, fromId, toId){
        const seen = new Set();
        const walk = id => {
            if(id === fromId) return true;
            if(seen.has(id)) return false;
            seen.add(id);
            for(const c of deps.connections.filter(x => x.from === id)){
                if(walk(c.to)) return true;
                const next = deps.nodes.find(n => n.id === c.to);
                if(next?.type === 'output'){
                    for(const cc of deps.connections.filter(x => x.from === next.id)){
                        if(walk(cc.to)) return true;
                    }
                }
            }
            return false;
        };
        return walk(toId);
    }

    function canConnect(deps, fromId, toId){
        if(!fromId || !toId || fromId === toId) return false;
        const from = deps.nodes.find(n => n.id === fromId);
        const to = deps.nodes.find(n => n.id === toId);
        if(!from || !to) return false;
        if(to.type==='shot-table') return to.shotTableData?.source?.nodeId===fromId && ['image','output',...deps.CANVAS_MEDIA_OUTPUT_TYPES].includes(from.type);
        if(from.type==='shot-table') return false;
        if(from.type==='clip') return to.type==='output'&&!wouldCreateGeneratorCycle(deps, fromId,toId);
        if(to.type==='clip') return ['image','group','output',...deps.CANVAS_MEDIA_OUTPUT_TYPES].includes(from.type)&&!wouldCreateGeneratorCycle(deps, fromId,toId);
        if(to.depthCapture?.sourceId === fromId && from.type !== 'image' && from.type !== 'output') return false;
        if(to.depthCapture?.sourceId === fromId) return true;
        if(from.type==='generator' && to.type==='llm' && (from.audioOutputText || deps.canvasApiAudioMode(from)))return !wouldCreateGeneratorCycle(deps, fromId,toId);
        if(from.type==='audio')return ['generator','video','rh','comfy'].includes(to.type)&&!wouldCreateGeneratorCycle(deps, fromId,toId);
        if(deps.CANVAS_GENERATOR_TYPES.includes(from.type)){
            if(to.type === 'output') return true;
            if(deps.CANVAS_MEDIA_OUTPUT_TYPES.includes(from.type) && deps.CANVAS_GENERATOR_TYPES.includes(to.type)){
                return !wouldCreateGeneratorCycle(deps, fromId, toId);
            }
            return false;
        }
        if(to.type === 'loop'){
            const allowImage = Boolean(to.imageInput) && ['image','group','output'].includes(from.type);
            const allowPrompt = Boolean(to.showPrompt) && ['prompt','promptGroup','loop','llm'].includes(from.type);
            return allowImage || allowPrompt;
        }
        if(to.type === 'llm') return ['prompt','loop','promptGroup','llm','image','group','output'].includes(from.type);
        if(from.type === 'llm') return deps.CANVAS_GENERATOR_TYPES.includes(to.type);
        return deps.CANVAS_GENERATOR_TYPES.includes(to.type) && ['image','prompt','loop','group','promptGroup','output','llm'].includes(from.type);
    }

    function validStoryConnection(deps, c){
        const from = deps.nodes.find(n => n.id === c.from), to = deps.nodes.find(n => n.id === c.to);
        if(!from || !to || from.id === to.id) return false;
        if(from.type==='shot-table'&&['prompt','generator'].includes(to.type)&&Object.values(from.shotTableData?.generationMap||{}).some(v=>(v.promptId===to.id&&!v.promptProcessorId)||v.video?.promptId===to.id))return true;
        const tableId = from.type === 'shot-table' ? from.id : to.type === 'shot-table' ? to.id : to.storyWorkflowOrigin?.tableId || from.storyWorkflowOrigin?.tableId;
        const table = deps.nodes.find(n => n.id === tableId && n.type === 'shot-table');
        if(!table?.shotTableData?.productionData) return false;
        const origin = n => n.id === table.id || n.storyWorkflowOrigin?.tableId === table.id;
        return (origin(from) || from.id === table.shotTableData.source.nodeId) && origin(to);
    }

    function connectedClusterIds(deps, seedId){
        const ids = new Set(deps.nodes.map(n => n.id));
        if(!ids.has(seedId)) return [];
        const seen = new Set([seedId]);
        const queue = [seedId];
        while(queue.length){
            const id = queue.shift();
            deps.connections.forEach(c => {
                if(c.from !== id && c.to !== id) return;
                const next = c.from === id ? c.to : c.from;
                if(!ids.has(next) || seen.has(next)) return;
                seen.add(next);
                queue.push(next);
            });
        }
        return [...seen];
    }

    function upstreamNodesForKinds(deps, node, kinds=['input']){
        if(!node) return [];
        const allowed = new Set(kinds);
        const ids = new Set();
        (deps.canvas?.connections || []).forEach(conn => {
            if(conn.to === node.id && allowed.has(conn.kind || 'flow')) ids.add(conn.from);
        });
        if(!deps.canvasUsesConnections && allowed.has('input')){
            (node.inputNodeIds || []).forEach(id => ids.add(id));
        }
        return [...ids].map(id => deps.nodes.find(n => n.id === id)).filter(Boolean);
    }

    function inputNodesFor(deps, node){
        return upstreamNodesForKinds(deps, node, ['input']);
    }

    function workflowInputNodesFor(deps, node){
        return upstreamNodesForKinds(deps, node, ['input', 'flow']);
    }

    function outgoingConnectionsFor(deps, node, kinds=['input']){
        if(!node) return [];
        const allowed = new Set(kinds);
        return (deps.canvas?.connections || []).filter(conn => conn.from === node.id && allowed.has(conn.kind || 'flow'));
    }

    function outgoingInputConnectionsFor(deps, node){
        return outgoingConnectionsFor(deps, node, ['input']);
    }

    function lineConnectionsFor(deps, node){
        if(!node) return [];
        return (deps.canvas?.connections || []).filter(conn => {
            if(!conn?.from || !conn?.to || conn.from === conn.to) return false;
            return ['input', 'flow'].includes(conn.kind || 'flow');
        });
    }

    function connectedLineNodeIds(deps, node){
        if(!node) return [];
        const conns = lineConnectionsFor(deps, node);
        const upstream = [];
        const downstream = [];
        const seenUp = new Set([node.id]);
        const seenDown = new Set([node.id]);
        const walkUp = id => {
            conns.filter(conn => conn.to === id).forEach(conn => {
                if(seenUp.has(conn.from)) return;
                seenUp.add(conn.from);
                walkUp(conn.from);
                upstream.push(conn.from);
            });
        };
        const walkDown = id => {
            conns.filter(conn => conn.from === id).forEach(conn => {
                if(seenDown.has(conn.to)) return;
                seenDown.add(conn.to);
                downstream.push(conn.to);
                walkDown(conn.to);
            });
        };
        walkUp(node.id);
        walkDown(node.id);
        return [...upstream, node.id, ...downstream];
    }

    function upstreamLineNodeIds(deps, node){
        if(!node) return [];
        const conns = lineConnectionsFor(deps, node);
        const upstream = [];
        const seen = new Set([node.id]);
        const walk = id => {
            conns.filter(conn => conn.to === id).forEach(conn => {
                if(seen.has(conn.from)) return;
                seen.add(conn.from);
                walk(conn.from);
                upstream.push(conn.from);
            });
        };
        walk(node.id);
        return [...upstream, node.id];
    }

    function primaryImageInputFor(deps, node, options={}){
        const direct = options.includeFlow
            ? deps.directImageInputsForKinds(node, ['input', 'flow'])[0]
            : deps.directImageInputsFor(node)[0];
        if(direct) return direct;
        const inputs = options.includeFlow ? upstreamNodesForKinds(deps, node, ['input', 'flow']) : (deps.smartImageUsesWorkflowInput(node) ? workflowInputNodesFor(deps, node) : inputNodesFor(deps, node));
        const loop = inputs.find(n => n?.type === 'smart-loop');
        if(loop?.imageInput){
            const upstream = upstreamNodesForKinds(deps, loop, options.includeFlow ? ['input', 'flow'] : ['input']).find(n => deps.isSmartImageNode(n) && (n.images || []).some(img => img?.url));
            if(upstream) return upstream;
        }
        return null;
    }

    function hasDownstreamImageNode(deps, node){
        return downstreamNodesForId(deps, node?.id).some(n => deps.isSmartImageNode(n) && !deps.isHistoryGroupNode(n));
    }

    function isGeneratedOutputForNode(deps, sourceNode, targetNode){
        return Boolean(sourceNode?.id && targetNode?.sourceNodeId === sourceNode.id);
    }

    function downstreamWorkflowImageTargetsFor(deps, node){
        return downstreamImageTargetsFor(deps, node).filter(target => !isGeneratedOutputForNode(deps, node, target));
    }

    function hasDownstreamWorkflowImageNode(deps, node){
        return downstreamWorkflowImageTargetsFor(deps, node).length > 0;
    }

    function smartImageChainTo(deps, nodeId, options={}){
        const tail = deps.nodes.find(n => n.id === nodeId);
        if(!deps.isSmartImageNode(tail) || deps.isHistoryGroupNode(tail)) return [];
        const chain = [];
        const seen = new Set();
        let cur = tail;
        while(cur && !seen.has(cur.id)){
            seen.add(cur.id);
            chain.unshift(cur);
            cur = primaryImageInputFor(deps, cur, options);
        }
        return chain;
    }

    function upstreamNodesForId(deps, nodeId, kinds=['input']){
        const result = [];
        const seen = new Set([nodeId]);
        const walk = id => {
            upstreamNodesForKinds(deps, deps.nodes.find(n => n.id === id), kinds).forEach(input => {
                if(seen.has(input.id)) return;
                seen.add(input.id);
                walk(input.id);
                result.push(input);
            });
        };
        walk(nodeId);
        return result;
    }

    function resolveSmartCascadeLoop(deps, nodeId){
        const loops = upstreamNodesForId(deps, nodeId, ['input', 'flow']).filter(n => n.type === 'smart-loop');
        if(!loops.length) return null;
        const loop = loops[loops.length - 1];
        return {node:loop, count:deps.smartLoopCount(loop), mode:loop.mode === 'parallel' ? 'parallel' : 'serial'};
    }

    function downstreamNodesForId(deps, nodeId){
        const result = [];
        const seen = new Set([nodeId]);
        const walk = id => {
            (deps.canvas?.connections || [])
                .filter(conn => conn.from === id && ['input','flow'].includes(conn.kind || 'flow'))
                .map(conn => deps.nodes.find(n => n.id === conn.to))
                .filter(Boolean)
                .forEach(next => {
                    if(seen.has(next.id)) return;
                    seen.add(next.id);
                    result.push(next);
                    walk(next.id);
                });
        };
        walk(nodeId);
        return result;
    }

    function downstreamImageTargetsFor(deps, node){
        if(!node?.id) return [];
        return (deps.canvas?.connections || [])
            .filter(conn => conn.from === node.id && ['input','flow'].includes(conn.kind || 'flow'))
            .map(conn => deps.nodes.find(n => n.id === conn.to))
            .filter(n => deps.isSmartImageNode(n) && !deps.isHistoryGroupNode(n))
            .sort((a, b) => {
                const ax = Number(a.x) || 0, bx = Number(b.x) || 0;
                if(ax !== bx) return ax - bx;
                return (Number(a.y) || 0) - (Number(b.y) || 0);
            });
    }

    function downstreamCascadeTargetsFor(deps, node){
        if(!node?.id) return [];
        return (deps.canvas?.connections || [])
            .filter(conn => conn.from === node.id && ['input','flow'].includes(conn.kind || 'flow'))
            .map(conn => deps.nodes.find(n => n.id === conn.to))
            .filter(n => n && !deps.isHistoryGroupNode(n) && n.assistantNativeOrigin?.kind!=='loop' && (deps.isSmartImageNode(n) || n.type === 'smart-loop'))
            .sort((a, b) => {
                const ax = Number(a.x) || 0, bx = Number(b.x) || 0;
                if(ax !== bx) return ax - bx;
                return (Number(a.y) || 0) - (Number(b.y) || 0);
            });
    }

    function directLoopRunTargets(deps, loop){
        if(!loop?.id) return [];
        return downstreamImageTargetsFor(deps, loop)
            .filter(node => !hasDownstreamWorkflowImageNode(deps, node));
    }

    function smartCascadeGraphForTail(deps, tail){
        const path = smartImageChainTo(deps, tail?.id, {includeFlow:true}).filter(n => deps.isSmartImageNode(n) && !deps.isHistoryGroupNode(n));
        if(!path.length) return {root:null, path:[], edges:[], children:new Map()};
        const loop = resolveSmartCascadeLoop(deps, tail?.id);
        const loopRoots = loop?.node?.id ? downstreamImageTargetsFor(deps, loop.node) : [];
        const loopRoot = loopRoots.find(n => path.some(p => p.id === n.id));
        const root = loopRoot || path[0];
        const edges = [];
        const children = new Map();
        const seenEdges = new Set();
        const visiting = new Set();
        const walk = node => {
            if(!node?.id || visiting.has(node.id)) return;
            visiting.add(node.id);
            const targets = downstreamCascadeTargetsFor(deps, node);
            children.set(node.id, targets);
            targets.forEach(target => {
                const key = `${node.id}->${target.id}`;
                if(!seenEdges.has(key)){
                    seenEdges.add(key);
                    edges.push({source:node, target, key});
                }
                walk(target);
            });
            visiting.delete(node.id);
        };
        walk(root);
        return {root, path, edges, children};
    }

    function cascadeTailForLoop(deps, loopId){
        const loop = deps.nodes.find(n => n.id === loopId && n.type === 'smart-loop');
        const directTargets = directLoopRunTargets(deps, loop);
        if(directTargets.length) return directTargets[directTargets.length - 1];
        const directImages = downstreamImageTargetsFor(deps, {id:loopId});
        const directIds = new Set(directImages.map(n => n.id));
        const candidates = downstreamNodesForId(deps, loopId)
            .filter(n => deps.isSmartImageNode(n))
            .filter(n => !deps.isHistoryGroupNode(n))
            .filter(n => canRunSmartCascade(deps, n));
        if(!candidates.length) return null;
        return candidates.sort((a, b) => {
            const ad = directIds.has(a.id) ? 1 : 0;
            const bd = directIds.has(b.id) ? 1 : 0;
            if(ad !== bd) return ad - bd;
            const ax = Number(a.x) || 0, bx = Number(b.x) || 0;
            if(ax !== bx) return bx - ax;
            return (Number(b.y) || 0) - (Number(a.y) || 0);
        })[0];
    }

    function canRunSmartCascade(deps, node){
        if(!deps.isSmartImageNode(node) || deps.isHistoryGroupNode(node)) return false;
        const graph = smartCascadeGraphForTail(deps, node);
        const loop = resolveSmartCascadeLoop(deps, node.id);
        if(loop && isDirectLoopTargetRun(deps, loop, node, graph)) return true;
        if(hasDownstreamImageNode(deps, node)) return false;
        if(graph.edges.length) return true;
        return Boolean(loop);
    }

    function isDirectLoopTargetRun(deps, loop, tail, graph){
        if(!loop?.node?.id || !tail?.id) return false;
        if(graph?.root?.id !== tail.id) return false;
        if(hasDownstreamWorkflowImageNode(deps, tail)) return false;
        return downstreamImageTargetsFor(deps, loop.node).some(node => node.id === tail.id);
    }

    const api={canvasRunTypes, canvasWorkflowEdges, computeConnectedWorkflowOrder, computeCascadeOrder, upstreamNodeIds, resolveCascadeLoop, wouldCreateGeneratorCycle, canConnect, validStoryConnection, connectedClusterIds, upstreamNodesForKinds, inputNodesFor, workflowInputNodesFor, outgoingConnectionsFor, outgoingInputConnectionsFor, lineConnectionsFor, connectedLineNodeIds, upstreamLineNodeIds, primaryImageInputFor, hasDownstreamImageNode, isGeneratedOutputForNode, downstreamWorkflowImageTargetsFor, hasDownstreamWorkflowImageNode, smartImageChainTo, upstreamNodesForId, resolveSmartCascadeLoop, downstreamNodesForId, downstreamImageTargetsFor, downstreamCascadeTargetsFor, directLoopRunTargets, smartCascadeGraphForTail, cascadeTailForLoop, canRunSmartCascade, isDirectLoopTargetRun};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.CanvasGraphRules=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
