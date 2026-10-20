/* Canvas output application and history coordination: smart-output-coordination. Host supplies live state and effects. */
(function(root){
    'use strict';

function isHistoryGroupNode(deps, node){
    return Boolean(deps.isSmartImageNode(node) && (node.isHistoryGroup || node.historyFor));
}

function nextOutputPositionForSource(deps, sourceNode, pendingBox, options={}){
    const sourceRect = deps.nodeRect(sourceNode);
    const x = (sourceRect.x || 0) + sourceRect.width + 80;
    const gap = 28;
    const outputs = deps.outgoingConnectionsFor(sourceNode, ['input','flow'])
        .map(conn => deps.nodes.find(n => n.id === conn.to))
        .filter(n => deps.isSmartImageNode(n))
        .map(n => deps.nodeRect(n))
        .filter(rect => Math.abs((rect.x || 0) - x) < Math.max(320, (pendingBox?.w || 260) + 120))
        .sort((a, b) => (a.y || 0) - (b.y || 0));
    if(!outputs.length) return {x, y:sourceRect.y || 0};
    let y = sourceRect.y || 0;
    for(const rect of outputs){
        const bottom = (rect.y || 0) + (rect.height || 0) + gap;
        if(y < bottom) y = bottom;
    }
    return {x, y};
}

function createPendingOutputFromSource(deps, sourceNode, expectedCount, meta, options={}){
    const pendingBox = deps.pendingBoxSize(expectedCount, {sourceNode, refs:options.refs || meta?.promptRefs || []});
    const pos = nextOutputPositionForSource(deps, sourceNode, pendingBox);
    const output = {
        id:options.outputNodeId || deps.uid('smart'),
        type:'smart-image',
        x:pos.x,
        y:pos.y,
        title:'Image',
        images:[],
        pending:Math.max(1, Number(expectedCount) || 1),
        runStartedAt:deps.nowMs(),
        runTimerHidden:false,
        w:pendingBox.w,
        h:pendingBox.h,
        scale:deps.MEDIA_NODE_DEFAULT_SCALE,
        created_at:Date.now()
    };
    output._selectAfterRunId = options.selectOutput ? output.id : sourceNode.id;
    deps.nodes.push(output);
    if(options.connectSource === false) deps.addConnection(sourceNode.id, output.id, 'flow');
    else deps.connectInputNode(sourceNode.id, output.id);
    deps.attachRunMeta(output, options.stripInputMeta ? deps.stripRunInputMeta(meta) : meta);
    if(!options.preserveSelection){
        deps.selectedId = sourceNode.id;
        deps.selectedImage = {nodeId:'', index:-1};
    }
    return output;
}

function createParallelLoopOutputNode(deps, templateNode, sourceNode, roundIndex, roundOffset=0){
    const rect = deps.nodeRect(templateNode);
    const output = deps.cloneSmartNode(templateNode, 0, 0);
    output.id = deps.uid('smart');
    output.type = 'smart-image';
    output.x = (Number(templateNode.x) || 0) + (Number(rect.width) || 260) + 80;
    output.y = (Number(templateNode.y) || 0) + roundOffset * ((Number(rect.height) || 180) + 28);
    output.title = `Image ${roundIndex}`;
    output.images = [];
    output.pending = 0;
    output.running = false;
    output.created_at = Date.now();
    delete output.w;
    delete output.h;
    delete output.historyFor;
    delete output.isHistoryGroup;
    delete output.sourceNodeId;
    delete output.runAt;
    delete output.runPrompt;
    delete output.runModelPrompt;
    delete output.runPromptRefs;
    delete output.runInputRefs;
    // 克隆自模板节点会带上 inputNodeIds（含上游提示词节点），而生成出的输出槽并未真正
    // 连线到这些上游；若不清空，节点即便没有任何连线也会一直显示"上游输入xxxx"。
    output.inputNodeIds = [];
    delete output.blockedInputRefs;
    delete output.manualInputRefs;
    deps.nodes.push(output);
    deps.connectInputNode(sourceNode.id, output.id);
    return output;
}

function loopOutputSlotsForRoot(deps, rootNode){
    if(!rootNode?.id) return [];
    return deps.downstreamNodesForId(rootNode.id)
        .filter(n => deps.isSmartImageNode(n) && !isHistoryGroupNode(deps, n))
        .sort((a, b) => {
            const ax = Number(a.x) || 0, bx = Number(b.x) || 0;
            if(ax !== bx) return ax - bx;
            return (Number(a.y) || 0) - (Number(b.y) || 0);
        });
}

function loopOutputSlotForRound(deps, rootNode, loopNode, roundIndex, slotIndex){
    if(!rootNode?.id) return null;
    const candidates = loopOutputSlotsForRoot(deps, rootNode)
        .filter(node => node.sourceNodeId === rootNode.id)
        .filter(node => !loopNode?.id || !node.loopSourceId || node.loopSourceId === loopNode.id);
    const untagged = candidates.filter(node => !Number.isFinite(Number(node.loopRoundIndex)) && !Number.isFinite(Number(node.loopSlotIndex)));
    return candidates.find(node => Number(node.loopRoundIndex) === Number(roundIndex))
        || candidates.find(node => Number(node.loopSlotIndex) === Number(slotIndex))
        || untagged[Math.max(0, Number(slotIndex) || 0)]
        || null;
}

function tagLoopOutputSlot(deps, output, rootNode, loopNode, roundIndex, slotIndex){
    if(!output) return output;
    output.sourceNodeId = rootNode?.id || output.sourceNodeId || '';
    output.loopSourceId = loopNode?.id || output.loopSourceId || '';
    output.loopRootId = rootNode?.id || output.loopRootId || '';
    output.loopRoundIndex = Number(roundIndex) || 0;
    output.loopSlotIndex = Math.max(0, Number(slotIndex) || 0);
    return output;
}

function createLoopOutputSlot(deps, rootNode, roundIndex, roundOffset=0, options={}){
    const rootRect = deps.nodeRect(rootNode);
    const output = deps.cloneSmartNode(rootNode, 0, 0);
    output.id = options.outputNodeId || deps.uid('smart');
    output.type = 'smart-image';
    output.x = (Number(rootNode.x) || 0) + (Number(rootRect.width) || 260) + 80;
    output.title = `Image ${roundIndex}`;
    output.images = [];
    output.pending = options.pending ? Math.max(1, Number(options.pending) || 1) : 0;
    output.running = Boolean(options.pending);
    output.queued = Boolean(options.queued);
    if(options.pending){
        output.runStartedAt = deps.nowMs();
        output.runTimerHidden = false;
    }
    output.created_at = Date.now();
    delete output.w;
    delete output.h;
    delete output.historyFor;
    delete output.isHistoryGroup;
    delete output.sourceNodeId;
    delete output.runAt;
    delete output.runPrompt;
    delete output.runModelPrompt;
    delete output.runPromptRefs;
    delete output.runInputRefs;
    delete output.runFinishedAt;
    delete output.runElapsedMs;
    // 同 createParallelLoopOutputNode：清空克隆带来的 inputNodeIds，否则输出槽虽只用 flow
    // 连接到 root，却会因继承 root 的 inputNodeIds 而误显示上游提示词输入。
    output.inputNodeIds = [];
    delete output.blockedInputRefs;
    delete output.manualInputRefs;
    tagLoopOutputSlot(deps, output, rootNode, options.loopNode || null, roundIndex, options.slotIndex ?? roundOffset);
    const slots = loopOutputSlotsForRoot(deps, rootNode).map(deps.nodeRect);
    let y = (Number(rootNode.y) || 0) + roundOffset * ((Number(rootRect.height) || 180) + 28);
    slots.forEach(rect => {
        if((Number(rect.x) || 0) >= (Number(output.x) || 0) - 24){
            y = Math.max(y, (Number(rect.y) || 0) + (Number(rect.height) || 0) + 28);
        }
    });
    output.y = y;
    deps.nodes.push(output);
    deps.addConnection(rootNode.id, output.id, 'flow');
        const runPath = deps.smartCascadePathForCtx(options.ctx || options.runState);
        if(runPath?.states) runPath.states[`${rootNode.id}->${output.id}`] = 'wait';
    return output;
}

function extractCurrentImagesToSource(deps, node, meta=null){
    const imgs = (node.images || []).slice();
    if(!imgs.length) return null;
    const r = deps.nodeRect(node);
    const newX = (node.x || 0) - Math.max(280, r.width + 60);
    const source = {
        id: deps.uid('smart'),
        type: 'smart-image',
        x: newX,
        y: node.y || 0,
        title: imgs.length > 1 ? 'Group' : 'Image',
        // 抽出到上游源节点的图片只保留"原始素材"语义：清空 runPrompt / runSettings /
        // sourceNodeId / runAt / promptDraftHtml / promptDraftText 等"生成"相关字段，
        // 避免上游图片继承下游输出的提示词信息
        images: imgs.map(img => deps.stripImageGenerationMeta({...img})),
        created_at: Date.now()
    };
    if(Number.isFinite(Number(node.w))) source.w = node.w;
    if(Number.isFinite(Number(node.h))) source.h = node.h;
    if(Number.isFinite(Number(node.scale))) source.scale = node.scale;
    deps.nodes.push(source);
    deps.connectInputNode(source.id, node.id);
    node.images = [];
    delete node.w;
    delete node.h;
    return source;
}

function finalizePendingNode(deps, pendingNode, urls, meta, kind='image'){
    if(!pendingNode) return;
    pendingNode = deps.liveSmartNode(pendingNode);
    const ext = kind === 'video' ? 'mp4' : kind === 'audio' ? 'mp3' : kind === 'text' ? 'txt' : 'png';
    const imgs = cleanHistoryImages(deps, urls.map((item, i) => {
        const url = typeof item === 'string' ? item : item?.url || '';
        const itemKind = (typeof item === 'object' && item.kind) || kind;
        return deps.copyMediaSizeFields(item, {url, name:(typeof item === 'object' && item.name) || `output-${i + 1}.${ext}`, kind:itemKind, generatedResult:true});
    }).filter(img => img.url));
    pendingNode.images = imgs;
    if(imgs.length)delete pendingNode.audioOutputText;
    deps.markSmartNodeComplete(pendingNode, meta);
    pendingNode.outputKind = kind;
    if(imgs.length > 1) pendingNode.title = kind === 'video' ? 'Videos' : kind === 'audio' ? 'Audios' : kind === 'text' ? 'Texts' : 'Group';
    else pendingNode.title = kind === 'video' ? 'Video' : kind === 'audio' ? 'Audio' : kind === 'text' ? 'Text' : kind === 'file' ? 'File' : 'Image';
    pendingNode.scale = deps.mediaNodeDefaultScale(pendingNode);
    delete pendingNode.w;
    delete pendingNode.h;
    const metaTarget = pendingNode._runMetaTargetId ? deps.nodes.find(n => n.id === pendingNode._runMetaTargetId) : pendingNode;
    if(metaTarget) deps.attachRunMeta(metaTarget, meta);
    pendingNode.images = (pendingNode.images || []).map(img => deps.stripImageGenerationMeta(img));
    deps.clearSourceBusyStateIfDownstreamDone(deps.nodes.find(n => n.id === meta?.sourceNodeId));
    // 生成完成不抢占选择:仅当用户仍停留在该生成节点上(或当前无选择)时才切换选择;
    // 否则保留用户当前选择 —— 支持并发生成时去调整/编辑别的卡片,A 节点的参数栏不被打断。
    const afterRunSelection = pendingNode._selectAfterRunId || pendingNode.id;
    if(!deps.selectedId || deps.selectedId === pendingNode.id) deps.selectedId = afterRunSelection;
    delete pendingNode._runMetaTargetId;
    delete pendingNode._selectAfterRunId;
    if(deps.activeComposerSubject?.id && deps.selectedId === deps.activeComposerSubject.id) deps.lastComposerNodeId = `${deps.selectedId}:node`;
    deps.selectedImage = {nodeId:'', index:-1};
}

function restoreFromExtraction(deps, node, extracted){
    if(!node || !extracted) return;
    node.images = extracted.images.slice();
    if(Number.isFinite(Number(extracted.w))) node.w = extracted.w;
    if(Number.isFinite(Number(extracted.h))) node.h = extracted.h;
    deps.nodes = deps.nodes.filter(n => n.id !== extracted.id);
    deps.canvas.connections = (deps.canvas.connections || []).filter(c => !(c.from === extracted.id && c.to === node.id));
    if(Array.isArray(node.inputNodeIds)){
        node.inputNodeIds = node.inputNodeIds.filter(id => id !== extracted.id);
    }
}

function restoreSourceVisualState(deps, node, state){
    if(!node || !state) return;
    node.images = (state.images || []).map(img => ({...img}));
    node.title = state.title || (node.images.length > 1 ? 'Group' : 'Image');
    ['w','h','scale','outputKind'].forEach(key => {
        if(state[key] === undefined) delete node[key];
        else node[key] = state[key];
    });
}

function pushRightSideNodes(deps, sourceNode, delta){
    const shift = Math.ceil(Number(delta) || 0);
    if(!sourceNode || shift <= 0) return;
    const sourceRight = (Number(sourceNode.x) || 0) + deps.nodeRect(sourceNode).width - shift;
    const downstreamIds = new Set(deps.downstreamNodesForId(sourceNode.id).map(n => n.id));
    deps.nodes.forEach(n => {
        if(!n || n.id === sourceNode.id) return;
        const r = deps.nodeRect(n);
        const shouldShift = downstreamIds.has(n.id) || (Number(r.x) > sourceRight && Math.abs((Number(r.y) || 0) - (Number(sourceNode.y) || 0)) < 520);
        if(shouldShift) n.x = (Number(n.x) || 0) + shift;
    });
}

function cascadeOutputTitle(deps, kind='image', count=1){
    if(Number(count) > 1) return kind === 'video' ? 'Videos' : kind === 'audio' ? 'Audios' : kind === 'text' ? 'Texts' : 'Group';
    return kind === 'video' ? 'Video' : kind === 'audio' ? 'Audio' : kind === 'text' ? 'Text' : kind === 'file' ? 'File' : 'Image';
}

function nonPreviewOutputImages(deps, images=[]){
    return (images || []).filter(img => img?.url && !img.loopInputPreview);
}

function cleanHistoryImages(deps, images=[]){
    const seen = new Set();
    return nonPreviewOutputImages(deps, images)
        .map(img => deps.stripImageGenerationMeta({...img}))
        .filter(img => {
            const key = `${img.kind || ''}|${img.url || ''}`;
            if(seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

function hasHistoryConnection(deps, nodeId, groupId){
    return Boolean(nodeId && groupId && (deps.canvas?.connections || []).some(conn => conn.from === nodeId && conn.to === groupId && (conn.kind || 'flow') === 'history'));
}

function demoteHistoryGroupNode(deps, group){
    if(!group) return;
    delete group.historyFor;
    delete group.isHistoryGroup;
    if(group.title === '历史分组'){
        const count = (group.images || []).length;
        group.title = count > 1 ? 'Group' : count === 1 ? 'Image' : deps.tr('smart.createImportNode');
    }
}

function historyGroupForNode(deps, node){
    if(!node?.id) return null;
    let matched = null;
    deps.nodes.forEach(n => {
        if(!isHistoryGroupNode(deps, n) || n.historyFor !== node.id) return;
        if(hasHistoryConnection(deps, node.id, n.id)){
            if(!matched) matched = n;
        } else {
            demoteHistoryGroupNode(deps, n);
        }
    });
    return matched;
}

function positionHistoryGroupForNode(deps, node, group){
    if(!node || !group) return;
    const r = deps.nodeRect(node);
    const gr = deps.nodeRect(group);
    if(!Number.isFinite(Number(group.x))) group.x = Math.round((Number(node.x) || 0) + Math.max(0, (r.width - gr.width) / 2));
    if(!Number.isFinite(Number(group.y))) group.y = Math.round((Number(node.y) || 0) + r.height + 56);
}

function ensureHistoryGroupForNode(deps, node){
    if(!node?.id) return null;
    let group = historyGroupForNode(deps, node);
    if(!group){
        const r = deps.nodeRect(node);
        group = {
            id:deps.uid('smart'),
            type:'smart-image',
            x:Math.round(Number(node.x || 0)),
            y:Math.round(Number(node.y || 0) + r.height + 56),
            title:'历史分组',
            images:[],
            historyFor:node.id,
            isHistoryGroup:true,
            scale:deps.MEDIA_GROUP_DEFAULT_SCALE,
            created_at:Date.now()
        };
        deps.nodes.push(group);
    }
    group.type = 'smart-image';
    group.title = '历史分组';
    group.isHistoryGroup = true;
    group.historyFor = node.id;
    if(!Number.isFinite(Number(group.scale))) group.scale = deps.MEDIA_GROUP_DEFAULT_SCALE;
    deps.addConnection(node.id, group.id, 'history');
    positionHistoryGroupForNode(deps, node, group);
    return group;
}

function replaceOutputsToNodeWithHistory(deps, node, additions, kind='image', meta=null, options={}){
    if(!node || !additions?.length) return [];
    node = deps.liveSmartNode(node);
    const beforeRight = (Number(node.x) || 0) + deps.nodeRect(node).width;
    const existing = cleanHistoryImages(deps, node.images || []);
    const next = cleanHistoryImages(deps, additions);
    if(!next.length) return [];
    delete node.audioOutputText;
    const history = existing.length ? ensureHistoryGroupForNode(deps, node) : historyGroupForNode(deps, node);
    if(history){
        const archived = cleanHistoryImages(deps, [...existing, ...(history.images || [])]);
        history.images = archived;
        history.title = '历史分组';
        history.outputKind = kind;
        history.scale = deps.MEDIA_GROUP_DEFAULT_SCALE;
        delete history.w;
        delete history.h;
    }
    node.images = next;
    deps.markSmartNodeComplete(node, meta);
    node.outputKind = kind;
    node.title = cascadeOutputTitle(deps, kind, node.images.length);
    node.scale = node.images.length > 1 ? deps.MEDIA_GROUP_DEFAULT_SCALE : deps.MEDIA_NODE_DEFAULT_SCALE;
    delete node.w;
    delete node.h;
    if(meta) deps.attachRunMeta(node, meta);
    const afterRight = (Number(node.x) || 0) + deps.nodeRect(node).width;
    const skipShift = options.skipShift || Boolean(deps.smartLoopContext?.nodeId);
    if(!skipShift) pushRightSideNodes(deps, node, afterRight - beforeRight + 36);
    deps.selectedImage = {nodeId:'', index:-1};
    return next;
}

function appendOutputsToNode(deps, node, additions, kind='image', options={}){
    if(!node || !additions?.length) return [];
    node = deps.liveSmartNode(node);
    const beforeRight = (Number(node.x) || 0) + deps.nodeRect(node).width;
    const existing = cleanHistoryImages(deps, node.images || []);
    const seen = new Set(existing.map(img => `${img.kind || ''}|${img.url || ''}`));
    const next = cleanHistoryImages(deps, additions).filter(img => {
        const key = `${img.kind || ''}|${img.url || ''}`;
        if(seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    if(!next.length) return [];
    node.images = [...existing, ...next];
    delete node.audioOutputText;
    deps.markSmartNodeComplete(node);
    node.outputKind = kind;
    node.title = node.images.length > 1 ? (kind === 'video' ? 'Videos' : kind === 'audio' ? 'Audios' : kind === 'text' ? 'Texts' : 'Group') : (kind === 'video' ? 'Video' : kind === 'audio' ? 'Audio' : kind === 'text' ? 'Text' : kind === 'file' ? 'File' : 'Image');
    delete node.w;
    delete node.h;
    const afterRight = (Number(node.x) || 0) + deps.nodeRect(node).width;
    const skipShift = options.skipShift || Boolean(deps.smartLoopContext?.nodeId);
    if(!skipShift) pushRightSideNodes(deps, node, afterRight - beforeRight + 36);
    return next;
}

function appendLoopOutputsToNode(deps, node, additions, kind='image', ctx=deps.smartLoopContext){
    if(!node || !additions?.length) return [];
    const runState = ctx?.runState;
    if(runState && !runState.loopAppendInitialized) runState.loopAppendInitialized = new Set();
    const initialized = runState?.loopAppendInitialized;
    if(initialized && !initialized.has(node.id)){
        initialized.add(node.id);
        const existing = cleanHistoryImages(deps, node.images || []);
        if(existing.length){
            const history = ensureHistoryGroupForNode(deps, node);
            history.images = cleanHistoryImages(deps, [...existing, ...(history.images || [])]);
            history.title = '历史分组';
            history.outputKind = kind;
            history.scale = deps.MEDIA_GROUP_DEFAULT_SCALE;
            delete history.w;
            delete history.h;
        }
        node.images = [];
    }
    return appendOutputsToNode(deps, node, additions, kind, {skipShift:true});
}

    const api={isHistoryGroupNode, nextOutputPositionForSource, createPendingOutputFromSource, createParallelLoopOutputNode, loopOutputSlotsForRoot, loopOutputSlotForRound, tagLoopOutputSlot, createLoopOutputSlot, extractCurrentImagesToSource, finalizePendingNode, restoreFromExtraction, restoreSourceVisualState, pushRightSideNodes, cascadeOutputTitle, nonPreviewOutputImages, cleanHistoryImages, hasHistoryConnection, demoteHistoryGroupNode, historyGroupForNode, positionHistoryGroupForNode, ensureHistoryGroupForNode, replaceOutputsToNodeWithHistory, appendOutputsToNode, appendLoopOutputsToNode};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.SmartOutputCoordination=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
