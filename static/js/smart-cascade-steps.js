/* Smart cascade steps. Host supplies instance state and effects. */
(function(root){
    'use strict';

    function finishLoopTargetPreviewState(deps, node){
        if(!node) return;
        node = deps.liveSmartNode(node);
        deps.markSmartNodeComplete(node);
        if((node.images || []).some(img => img?.url)){
            node.title = node.images.length > 1 ? 'Group' : 'Image';
            node.scale = node.images.length > 1 ? deps.MEDIA_GROUP_DEFAULT_SCALE : deps.MEDIA_NODE_DEFAULT_SCALE;
            node.outputKind = deps.mediaKindForUrls(node.images || [], (node.images || []).some(deps.isVideoMediaItem) ? 'video' : 'image');
            delete node.w;
            delete node.h;
        }
    }

    function refsForDirectLoopRound(deps, loopNode, loopIndex, total){
        if(!loopNode?.imageInput) return [];
        return deps.outputImagesForNode(loopNode, true, {index:loopIndex, total, nodeId:loopNode.id})
            .filter(ref => ref?.url)
            .map((ref, index) => ({
                ...ref,
                role:ref.role || `image_${index + 1}`,
                name:ref.name || deps.trf('canvas.loopImageLabel', {n:loopIndex + index})
            }));
    }

    function showDirectLoopRoundPreview(deps, loopNode, target, refs, loopIndex, total){
        if(!loopNode?.imageInput || !deps.isSmartImageNode(target)) return false;
        const cleanRefs = (refs || []).filter(ref => ref?.url);
        if(!cleanRefs.length) return false;
        const preview = cleanRefs.map((ref, index) => deps.stripImageGenerationMeta({
            url:ref.url || '',
            name:ref.name || deps.trf('canvas.loopImageLabel', {n:loopIndex + index}),
            kind:ref.kind || (deps.isVideoMediaItem(ref) ? 'video' : 'image'),
            nodeId:ref.nodeId || '',
            imageIndex:ref.imageIndex ?? '',
            loopInputPreview:true
        })).filter(ref => ref.url);
        if(!preview.length) return false;
        target.images = preview;
        target.pending = 0;
        target.running = true;
        target.runStartedAt = deps.nowMs();
        delete target.runFinishedAt;
        delete target.runElapsedMs;
        target.runTimerHidden = false;
        target.runInputRefs = cleanRefs.map(ref => ({
            url:ref.url || '',
            name:ref.name || '',
            nodeId:ref.nodeId || '',
            imageIndex:ref.imageIndex ?? '',
            kind:ref.kind || ''
        })).filter(ref => ref.url);
        target.outputKind = deps.mediaKindForUrls(preview, preview.some(deps.isVideoMediaItem) ? 'video' : 'image');
        target.scale = preview.length > 1 ? deps.MEDIA_GROUP_DEFAULT_SCALE : deps.MEDIA_NODE_DEFAULT_SCALE;
        target.title = total > 1 ? `Image ${loopIndex}/${total}` : (target.title || 'Image');
        delete target.w;
        delete target.h;
        deps.render();
        return true;
    }

    async function runCascadeStepIntoNode(deps, sourceNode, targetNode, inputRefs, ctx=deps.smartLoopContext){
        const outputNode = targetNode || sourceNode;
        if(!sourceNode || !targetNode || !outputNode) return [];
        if(ctx?.runState?.submissionUnknown || deps.smartUnknownSubmissionForNode(sourceNode) || deps.smartUnknownSubmissionForNode(targetNode)){
            throw new Error(deps.smartUnknownResubmissionNotice(true));
        }
        const targetSettings=deps.smartSettingsForNode(targetNode);
        const audioInputTarget=deps.smartHasAudioAnalysisInput(targetNode,inputRefs)
            || (deps.smartApiAudioMode(targetNode,targetSettings) && deps.smartAudioSources(targetNode).some(ref=>ref.kind==='audio'));
        const requestNode = sourceNode?.type === 'smart-loop' || audioInputTarget ? targetNode : sourceNode;
        const previousSettings = deps.cloneSmartSettings(deps.settings);
        const runSettings = deps.smartLoopRoundSettings({...deps.cloneSmartSettings(deps.settings), ...deps.cloneSmartSettings(deps.smartSettingsForNode(requestNode) || {})}, ctx);
        deps.settings = runSettings;
        const outpaintSize = deps.validOutpaintSize(requestNode);
        const freshGroupInput = ctx?.workgroupRun && inputRefs?.length;
        const selfRefs = sourceNode?.type === 'smart-loop' || freshGroupInput ? [] : deps.selfReferenceImagesForNode(sourceNode, false, ctx).filter(img => img?.url);
        const sourceRefs = (freshGroupInput ? inputRefs : selfRefs.length ? selfRefs : deps.defaultReferenceImagesFor(requestNode, false, ctx)).filter(img => img?.url);
        const refsForRequest = sourceRefs.length
            ? sourceRefs
            : (inputRefs && inputRefs.length ? inputRefs : null);
        const request = deps.buildPromptRequestForNode(
            requestNode,
            refsForRequest,
            ctx
        );
        const prompt = (request.prompt || '').trim();
        const displayPrompt = (request.displayPrompt || '').trim();
        const audioAnalysisInput = deps.smartHasAudioAnalysisInput(requestNode, request.refs);
        if((!prompt || !displayPrompt) && deps.smartRunNeedsPrompt(runSettings)
            && !audioAnalysisInput
            && !(deps.smartApiAudioMode(requestNode,runSettings,request.refs) && deps.window.CanvasAudio.operation(runSettings,deps.apiProviders)==='recognition')){
            deps.settings = previousSettings;
            throw new Error('链路节点缺少提示词');
        }
        const meta = {
            prompt,
            displayPrompt:request.displayPrompt || '',
            promptRefs:(request.refs || []).map(ref => ({url:ref.url || '', name:ref.name || '', nodeId:ref.nodeId || '', imageIndex:ref.imageIndex ?? ''})).filter(ref => ref.url),
            inputRefs:(request.refs || []).map(ref => ({url:ref.url || '', name:ref.name || '', nodeId:ref.nodeId || '', imageIndex:ref.imageIndex ?? '', kind:ref.kind || ''})).filter(ref => ref.url),
            sourceNodeId:sourceNode.id,
            settings:JSON.parse(JSON.stringify(runSettings)),
            createdAt:Date.now()
        };
        if(requestNode.promptDraftHtml != null){
            meta.promptHtml = requestNode.promptDraftHtml;
            meta.promptText = requestNode.promptDraftText || request.displayPrompt || '';
        }
        const logKind = deps.isApiLikeEngine(runSettings.engine) && runSettings.apiKind === 'video' ? 'video' : 'image';
        const runLog = deps.smartRunSnapshot(requestNode, prompt, request.refs || [], logKind);
        const runLogStart = deps.nowMs();
        const targetPromptState = {
            promptDraftHtml:targetNode.promptDraftHtml,
            promptDraftText:targetNode.promptDraftText,
            runPrompt:targetNode.runPrompt,
            runModelPrompt:targetNode.runModelPrompt,
            runPromptRefs:targetNode.runPromptRefs ? targetNode.runPromptRefs.map(ref => ({...ref})) : undefined,
            runInputRefs:targetNode.runInputRefs ? targetNode.runInputRefs.map(ref => ({...ref})) : undefined,
            runSettings:targetNode.runSettings ? deps.cloneSmartSettings(targetNode.runSettings) : undefined,
            sourceNodeId:targetNode.sourceNodeId,
            runAt:targetNode.runAt
        };
        outputNode.running = true;
        outputNode.runStartedAt = deps.nowMs();
        delete outputNode.runFinishedAt;
        delete outputNode.runElapsedMs;
        outputNode.runTimerHidden = false;
        deps.rememberRecentSmartSettings(runSettings, requestNode);
        deps.render();
        deps.settings = previousSettings;
        try {
            const result = await deps.generateUrlsForCurrentSettings(outputNode, prompt, request.refs || [], runSettings, ctx);
            if(result.kind==='text'){outputNode.audioOutputText=result.text;outputNode.running=false;outputNode.pending=0;deps.render();deps.scheduleSave();return [];}
            if(!result.urls?.length) throw new Error(result.kind === 'video' ? deps.tr('smart.errNoOutVideos') : deps.tr('smart.errNoOutImages'));
            if(outpaintSize) delete requestNode.outpaintSize;
            deps.addSmartGenerationLog({run:{...runLog, kind:result.kind || logKind}, outputs:result.urls, runMs:deps.nowMs() - runLogStart});
            const ext = result.kind === 'video' ? 'mp4' : result.kind === 'audio' ? 'mp3' : result.kind === 'text' ? 'txt' : 'png';
            const additions = result.urls.map((item, i) => {
                const url = typeof item === 'string' ? item : item?.url || '';
                return deps.stripImageGenerationMeta(deps.copyMediaSizeFields(item, {url, name:(typeof item === 'object' && item.name) || `output-${i + 1}.${ext}`, kind:(typeof item === 'object' && item.kind) || result.kind, generatedResult:true}));
            }).filter(item => item.url);
            if(ctx?.appendLoopOutputs) {
                deps.appendLoopOutputsToNode(outputNode, additions, result.kind, ctx);
            } else {
                deps.replaceOutputsToNodeWithHistory(outputNode, additions, result.kind, null, {skipShift:Boolean(ctx?.nodeId)});
            }
            outputNode.runPrompt = targetPromptState.runPrompt;
            outputNode.runModelPrompt = targetPromptState.runModelPrompt;
            outputNode.runPromptRefs = targetPromptState.runPromptRefs || [];
            outputNode.runInputRefs = targetPromptState.runInputRefs || [];
            outputNode.runSettings = targetPromptState.runSettings;
            outputNode.sourceNodeId = targetPromptState.sourceNodeId;
            outputNode.runAt = targetPromptState.runAt;
            if(targetPromptState.promptDraftHtml === undefined) delete outputNode.promptDraftHtml;
            else outputNode.promptDraftHtml = targetPromptState.promptDraftHtml;
            if(targetPromptState.promptDraftText === undefined) delete outputNode.promptDraftText;
            else outputNode.promptDraftText = targetPromptState.promptDraftText;
            ['runPrompt','runModelPrompt','runSettings','sourceNodeId','runAt'].forEach(key => {
                if(targetPromptState[key] === undefined) delete outputNode[key];
            });
            deps.settings = previousSettings;
            deps.render();
            return deps.rememberRoundOutputs(ctx, outputNode, additions);
        } catch(e) {
            deps.settings = previousSettings;
            if(deps.handleJimengPendingSignal(outputNode, e)){
                deps.render();
                return [];
            }
            if(typeof deps.retainSmartVideoTaskRecovery === 'function' && deps.retainSmartVideoTaskRecovery(outputNode, e)){
                deps.render();
                deps.scheduleSave();
                throw e;
            }
            outputNode.running = false;
            if(!e?.smartGenerationLogged && !e?.comfyTaskPaused && !e?.comfyTaskLost) deps.addSmartGenerationLog({run:runLog, outputs:[], runMs:deps.nowMs() - runLogStart, error:e.message || String(e)});
            deps.render();
            throw e;
        }
    }

    async function runLoopRoundIntoSlot(deps, loopNode, rootNode, outputSlot, loopIndex, ctx){
        if(!loopNode || !rootNode || !outputSlot) return [];
        outputSlot = deps.liveSmartNode(outputSlot);
        if(ctx?.runState?.submissionUnknown || deps.smartUnknownSubmissionForNode(rootNode) || deps.smartUnknownSubmissionForNode(outputSlot)){
            throw new Error(deps.smartUnknownResubmissionNotice(true));
        }
        const previousSettings = deps.cloneSmartSettings(deps.settings);
        const edgeKey = `${rootNode.id}->${outputSlot.id}`;
        const runSettings = deps.smartLoopRoundSettings({...deps.cloneSmartSettings(deps.settings), ...deps.cloneSmartSettings(deps.smartSettingsForNode(rootNode) || {})}, ctx);
        deps.settings = runSettings;
        try {
            const refsForRequest = deps.outputImagesForNode(loopNode, true, ctx).filter(img => img?.url);
            const request = deps.buildPromptRequestForNode(rootNode, refsForRequest.length ? refsForRequest : null, ctx);
            const prompt = (request.prompt || '').trim();
            const displayPrompt = (request.displayPrompt || '').trim();
            const audioAnalysisInput = deps.smartHasAudioAnalysisInput(rootNode, request.refs);
            if((!prompt || !displayPrompt) && deps.smartRunNeedsPrompt(runSettings)
                && !audioAnalysisInput
                && !(deps.smartApiAudioMode(rootNode,runSettings,request.refs) && deps.window.CanvasAudio.operation(runSettings,deps.apiProviders)==='recognition')) throw new Error('链路节点缺少提示词');
            const meta = {
                prompt,
                displayPrompt:request.displayPrompt || '',
                promptRefs:(request.refs || []).map(ref => ({url:ref.url || '', name:ref.name || '', nodeId:ref.nodeId || '', imageIndex:ref.imageIndex ?? ''})).filter(ref => ref.url),
                inputRefs:(request.refs || []).map(ref => ({url:ref.url || '', name:ref.name || '', nodeId:ref.nodeId || '', imageIndex:ref.imageIndex ?? '', kind:ref.kind || ''})).filter(ref => ref.url),
                sourceNodeId:rootNode.id,
                settings:JSON.parse(JSON.stringify(runSettings)),
                createdAt:Date.now()
            };
            const logKind = deps.isApiLikeEngine(runSettings.engine) && runSettings.apiKind === 'video' ? 'video' : 'image';
            const runLog = deps.smartRunSnapshot(rootNode, prompt, request.refs || [], logKind);
            const runLogStart = deps.nowMs();
            const expectedCount = deps.isApiLikeEngine(runSettings.engine) && runSettings.apiKind !== 'video'
                ? Math.max(1, Math.min(8, Number(runSettings.count || 1)))
                : 1;
            outputSlot.queued = false;
            outputSlot.running = true;
            outputSlot.pending = expectedCount;
            outputSlot.runStartedAt = deps.nowMs();
            delete outputSlot.runFinishedAt;
            delete outputSlot.runElapsedMs;
            outputSlot.runTimerHidden = false;
            const runPath = deps.smartCascadePathForCtx(ctx);
            if(runPath?.states) {
                runPath.states[edgeKey] = 'active';
                deps.scheduleConnectionLayerRefresh();
            }
            deps.render();
            deps.settings = previousSettings;
            let result;
            if(deps.isApiLikeEngine(runSettings.engine) && runSettings.apiKind !== 'video' && !deps.smartApiAudioMode(outputSlot,runSettings,request.refs || [])){
                const taskResult = await deps.runApiGeneration(prompt, request.refs || [], runSettings);
                const warning = deps.recordSmartTaskSubmission(outputSlot, taskResult, ctx?.runState);
                const taskIds = Array.isArray(taskResult?.taskIds) ? taskResult.taskIds : [];
                if(!taskIds.length) throw new Error(warning || deps.tr('smart.errRunFailed'));
                const existing = deps.cleanHistoryImages(outputSlot.images || []);
                if(existing.length){
                    const history = deps.ensureHistoryGroupForNode(outputSlot);
                    history.images = deps.cleanHistoryImages([...existing, ...(history.images || [])]);
                    history.title = '历史分组';
                    history.outputKind = 'image';
                    history.scale = deps.MEDIA_GROUP_DEFAULT_SCALE;
                    delete history.w;
                    delete history.h;
                    outputSlot.images = [];
                }
                outputSlot.pendingTasks = taskIds.map(taskId => ({taskId, kind:'image', providerId:taskResult.providerId, model:taskResult.model}));
                outputSlot.pending = taskIds.length;
                outputSlot.running = false;
                deps.render();
                deps.scheduleSave();
                if(!await deps.saveSmartAcceptedTasksBeforeQuery(outputSlot, taskIds)){
                    throw new Error('任务已受理，但画布尚未保存；请先重试保存，再查询原任务');
                }
                await deps.resumeSmartPendingNode(outputSlot, {run:runLog, runLogStart});
                if(outputSlot.jimengPending || deps.smartRecoverableImageTask(outputSlot)){
                    outputSlot.queued = false;
                    return [];
                }
                result = {urls:(outputSlot.images || []).map(img => img?.url ? img : null).filter(Boolean), kind:'image'};
            } else {
                result = await deps.generateUrlsForCurrentSettings(outputSlot, prompt, request.refs || [], runSettings, ctx);
            }
            if(result.kind==='text'){outputSlot.audioOutputText=result.text;deps.markSmartNodeComplete(outputSlot,meta);deps.render();deps.scheduleSave();return [];}
            if(!result.urls?.length) throw new Error(result.kind === 'video' ? deps.tr('smart.errNoOutVideos') : deps.tr('smart.errNoOutImages'));
            let additions;
            if(deps.isApiLikeEngine(runSettings.engine) && runSettings.apiKind !== 'video'){
                additions = (outputSlot.images || []).map(img => deps.stripImageGenerationMeta({...img})).filter(img => img?.url);
                if(meta) deps.attachRunMeta(outputSlot, meta);
            } else {
                const ext = result.kind === 'video' ? 'mp4' : result.kind === 'audio' ? 'mp3' : result.kind === 'text' ? 'txt' : 'png';
                additions = result.urls.map((item, i) => {
                    const url = typeof item === 'string' ? item : item?.url || '';
                    return deps.stripImageGenerationMeta(deps.copyMediaSizeFields(item, {url, name:(typeof item === 'object' && item.name) || `output-${i + 1}.${ext}`, kind:(typeof item === 'object' && item.kind) || result.kind, generatedResult:true}));
                }).filter(item => item.url);
                outputSlot = deps.liveSmartNode(outputSlot);
                outputSlot.images = deps.nonPreviewOutputImages(outputSlot.images);
                deps.replaceOutputsToNodeWithHistory(outputSlot, additions, result.kind, meta, {skipShift:Boolean(ctx?.nodeId)});
            }
            outputSlot = deps.liveSmartNode(outputSlot);
            deps.markSmartNodeComplete(outputSlot, meta);
            deps.clearSourceBusyStateIfDownstreamDone(rootNode);
            if(runPath?.states) {
                runPath.states[edgeKey] = 'done';
                deps.scheduleConnectionLayerRefresh();
            }
            deps.addSmartGenerationLog({run:{...runLog, kind:result.kind || logKind}, outputs:result.urls, runMs:deps.nowMs() - runLogStart});
            return deps.rememberRoundOutputs(ctx, outputSlot, additions);
        } catch(e) {
            if(deps.handleJimengPendingSignal(outputSlot, e)){
                outputSlot.queued = false;
                return [];
            }
            if(typeof deps.retainSmartVideoTaskRecovery === 'function' && deps.retainSmartVideoTaskRecovery(outputSlot, e)){
                outputSlot.queued = false;
                deps.render();
                deps.scheduleSave();
                throw e;
            }
            outputSlot.queued = false;
            outputSlot.pending = deps.smartPendingTasks(outputSlot).length;
            outputSlot.running = false;
            throw e;
        } finally {
            deps.settings = previousSettings;
        }
    }

    function appendCascadeRefsToReceiver(deps, node, refs, ctx=deps.smartLoopContext){
        if(!node || !refs?.length) return [];
        const additions = refs
            .filter(ref => ref?.url)
            .map((ref, i) => deps.stripImageGenerationMeta({
                url:ref.url,
                name:ref.name || `output-${i + 1}.png`,
                kind:ref.kind || (deps.isVideoMediaItem(ref) ? 'video' : 'image')
            }));
        if(!additions.length) return [];
        deps.replaceOutputsToNodeWithHistory(node, additions, deps.mediaKindForUrls(additions, additions.some(deps.isVideoMediaItem) ? 'video' : 'image'), null, {skipShift:Boolean(ctx?.nodeId)});
        deps.render();
        return deps.rememberRoundOutputs(ctx, node, additions);
    }

    function cascadeRefsFromOutputs(deps, outputs, targetNode){
        return (outputs || []).filter(img => img?.url).map((img, index) => ({
            url:img.url,
            name:img.name || `图${index + 1}`,
            kind:img.kind || 'image',
            role:`image_${index + 1}`,
            nodeId:targetNode?.id || '',
            imageIndex:targetNode ? (targetNode.images || []).length - outputs.length + index : index
        }));
    }

    const api={finishLoopTargetPreviewState, refsForDirectLoopRound, showDirectLoopRoundPreview, runCascadeStepIntoNode, runLoopRoundIntoSlot, appendCascadeRefsToReceiver, cascadeRefsFromOutputs};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.SmartCascadeSteps=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
