/* Generation responsibility: smart-generation-runner. Host supplies live state and effects. */
(function(root){
    'use strict';

    async function generateUrlsForCurrentSettings(deps, node, prompt, refs, runSettings=deps.settings, ctx=null){
        const activeSettings = runSettings || deps.settings;
        const audioRefs = deps.audioRefsOnly(refs || []);
        if(deps.isApiLikeEngine(activeSettings.engine)
            && activeSettings.apiKind !== 'video'
            && audioRefs.length
            && deps.providerChatModels(activeSettings.provider_id).includes(activeSettings.model)){
            const message = String(prompt || '').trim() || '请分析这段音频，概括主要内容、说话人和关键信息。';
            const response = await deps.fetch('/api/canvas-llm', {
                method:'POST',
                headers:{'Content-Type':'application/json'},
                body:JSON.stringify({
                    message,
                    messages:[],
                    audios:audioRefs.map(ref => ref.url).filter(Boolean),
                    model:activeSettings.model,
                    provider:activeSettings.provider_id,
                    ms_model:activeSettings.provider_id === 'modelscope' ? activeSettings.model : '',
                    system_prompt:''
                })
            }).then(async response => {
                if(!response.ok) throw new Error(await response.text());
                return response.json();
            });
            return {urls:[], kind:'text', text:String(response.text || '').trim()};
        }
        if(deps.smartApiAudioMode(node,activeSettings,refs)){const item=await deps.runSmartApiAudio(node,prompt,refs,activeSettings);if(!item)throw new Error('音频任务结果尚未确认');return {urls:item.url?[item]:[],kind:item.kind,text:item.text};}
        if(activeSettings.engine === 'comfy') return deps.generateComfyUrlsWithSettings(activeSettings, prompt, refs, node);
        if(activeSettings.engine === 'runninghub' && deps.runningHubSelectedModel(activeSettings)){
            const taskResult = await deps.runApiGeneration(prompt, refs, deps.runningHubModelApiSettings(activeSettings));
            const warning = deps.recordSmartTaskSubmission(node, taskResult, ctx?.runState);
            const taskIds = Array.isArray(taskResult?.taskIds) ? taskResult.taskIds : [];
            if(taskIds.length){
                const urls = await deps.waitSmartCanvasTaskBatch(node, taskResult);
                return {urls, kind:deps.mediaKindForUrls(urls, 'image')};
            }
            if(warning) throw new Error(warning);
            const urls = deps.resultMediaUrls(taskResult);
            return {urls, kind:deps.mediaKindForUrls(urls, 'image')};
        }
        if(deps.isApiLikeEngine(activeSettings.engine) && activeSettings.apiKind === 'video'){
            if(node) deps.prepareSmartVideoTask(node);
            return {urls:await deps.runApiVideoGeneration(prompt, refs, activeSettings, node, ctx?.runState), kind:'video'};
        }
        if(deps.isApiLikeEngine(activeSettings.engine)){
            const taskResult = await deps.runApiGeneration(prompt, refs, activeSettings);
            const warning = deps.recordSmartTaskSubmission(node, taskResult, ctx?.runState);
            const taskIds = Array.isArray(taskResult?.taskIds) ? taskResult.taskIds : [];
            if(taskIds.length){
                const urls = await deps.waitSmartCanvasTaskBatch(node, taskResult);
                return {urls, kind:deps.mediaKindForUrls(urls, 'image')};
            }
            if(warning) throw new Error(warning);
            const urls = deps.resultMediaUrls(taskResult);
            return {urls, kind:deps.mediaKindForUrls(urls, 'image')};
        }
        const urls = activeSettings.engine === 'runninghub'
            ? await deps.runRunningHubGeneration(prompt, refs, activeSettings)
            : activeSettings.engine === 'modelscope'
                ? await deps.runModelscopeGeneration(prompt, refs, activeSettings)
                : [];
        return {urls, kind:deps.mediaKindForUrls(urls, 'image')};
    }

    async function runGeneration(deps, options={}){
        if(options.assistantNativeActionId)return deps.runSmartAssistantNativeImage(deps.nodes.find(n=>n.id===options.assistantNativeNodeId),options);
        const node = options.assistantProposal ? deps.nodes.find(n=>n.id===options.assistantProposal.nodeId) : deps.selectedNode();
    
        if(!node || deps.smartNodeInFlight(node)) return;
        if(node.shotPromptOrigin && !options.acceptedTask){try{deps.CanvasVideoDeconstructionModel.validateShotImage(deps.nodes,deps.canvas.connections||[],node);}catch(error){deps.toast(error.message);return;}}
        if(!deps.confirmSmartUnknownResubmission(node)) return;
        const request = options.assistantProposal ? {prompt:options.assistantProposal.prompt,displayPrompt:options.assistantProposal.prompt,refs:options.assistantProposal.referenceImages.map(url=>({url,kind:'image'}))} : options.shotTableRun ? deps.buildPromptRequestForNode(node, [], deps.smartLoopContext) : deps.buildPromptRequest(node, null, true, deps.smartLoopContext);
        const prompt = request.prompt.trim();
        const refs = request.refs;
        const previousSettings = deps.cloneSmartSettings(deps.settings);
        const runSettings = deps.smartSettingsForNode(node);
        // 自动识别只看上游连接；当前节点已生成的音频不能把手动返回的图片选择再次切回音频。
        if(deps.smartApiAudioMode(node,runSettings)){try{await deps.runSmartApiAudio(node,prompt,refs,runSettings);}catch(error){deps.toast(error.message || '音频处理失败');}return;}
        deps.settings = {...deps.settings, ...deps.cloneSmartSettings(runSettings || {}), ...(options.acceptedTask?{count:1}:{})};
        if(!prompt && deps.smartRunNeedsPrompt(deps.settings)){
            deps.settings = previousSettings;
            deps.toast(deps.tr('smart.toastNeedPrompt'));
            return;
        }
        const outpaintSize = node?.outpaintSize && Number(node.outpaintSize.width) > 0 && Number(node.outpaintSize.height) > 0
            ? {width:Math.round(Number(node.outpaintSize.width)), height:Math.round(Number(node.outpaintSize.height))}
            : null;
        if(outpaintSize && deps.isApiLikeEngine(deps.settings.engine) && deps.settings.apiKind !== 'video'){
            deps.settings = {
                ...deps.settings,
                resolution:'custom',
                ratio:'',
                customWidth:outpaintSize.width,
                customHeight:outpaintSize.height,
                customSize:`${outpaintSize.width}x${outpaintSize.height}`
            };
        }
        const meta = deps.snapshotRunMeta(prompt, node.id, request.displayPrompt, refs);
        if(options.assistantProposal){meta.promptText=options.assistantProposal.prompt;meta.promptHtml=deps.escapeHtml(options.assistantProposal.prompt);}
        const logKind = deps.isApiLikeEngine(deps.settings.engine) && deps.settings.apiKind === 'video' ? 'video' : 'image';
        const runLog = deps.smartRunSnapshot(node, prompt, refs, logKind);
        deps.rememberRecentSmartSettings(deps.settings, node);
        const runLogStart = deps.nowMs();
        const expectedCount = deps.settings.engine === 'runninghub'
            ? 1
            : deps.settings.engine === 'comfy'
            ? (deps.settings.comfyMode === 'text' || deps.settings.comfyMode === 'enhance' || deps.settings.comfyMode === 'edit' || deps.settings.comfyMode === 'custom' ? 1 : 1)
            : Math.max(1, Math.min(8, Number(deps.settings.count || 1)));
        const apiConcurrentRun = deps.isApiLikeEngine(deps.settings.engine) || deps.settings.engine === 'runninghub' || deps.settings.engine === 'modelscope' || deps.settings.engine === 'comfy';
        const nodeHasImages = deps.isSmartGroupNode(node) ? deps.imagesForNode(node).some(img => img?.url) : (node.images || []).some(img => img?.url);
        const workflowModeRun = deps.smartImageUsesWorkflowInput(node, deps.smartLoopContext);
        const sourceVisualState = deps.isSmartImageNode(node) && nodeHasImages && !workflowModeRun ? {
            images:(node.images || []).map(img => ({...img})),
            title:node.title,
            w:node.w,
            h:node.h,
            scale:node.scale,
            outputKind:node.outputKind
        } : null;
        deps.pushUndo();
        let extracted = null;
        let branchNode = null;
        const groupRun = deps.isSmartGroupNode(node);
        const shouldCreateBranchOutput = groupRun || (nodeHasImages && !workflowModeRun);
        const pendingMeta = shouldCreateBranchOutput ? deps.stripRunInputMeta(meta) : meta;
        deps.undoSuppressed = true;
        if(shouldCreateBranchOutput) branchNode = deps.createPendingOutputFromSource(node, expectedCount, pendingMeta, {connectSource:false, selectOutput:true, refs});
        deps.undoSuppressed = false;
        const pendingNode = branchNode || node;
        if(node.shotTableOrigin){
            pendingNode.shotTableOrigin = {...node.shotTableOrigin};
            const table = deps.nodes.find(n=>n.id===node.shotTableOrigin.tableId);
            const key = `${node.shotTableOrigin.sourceFingerprint}:${node.shotTableOrigin.rowId}`;
            if(table?.shotTableData?.generationMap[key]) table.shotTableData.generationMap[key].outputId=pendingNode.id;
        }
        if(extracted) pendingNode._runMetaTargetId = extracted.id;
        if(!branchNode){
            pendingNode.pending = Math.max(1, Number(expectedCount) || 1);
            pendingNode.runStartedAt = deps.nowMs();
            delete pendingNode.runFinishedAt;
            delete pendingNode.runElapsedMs;
            pendingNode.runTimerHidden = false;
            const pendingBox = deps.pendingBoxSize(pendingNode.pending, {sourceNode:node, refs});
            pendingNode.w = pendingBox.w;
            pendingNode.h = pendingBox.h;
            deps.attachRunMeta(pendingNode, pendingMeta);
        }
        if(apiConcurrentRun){
            deps.coolNodeRunningState(pendingNode, 2000);
            deps.syncRunButtonState();
        } else {
            pendingNode.running = true;
            deps.syncRunButtonState();
        }
        deps.render();
        try {
            if(deps.settings.engine === 'comfy'){
                await deps.runComfyGeneration(pendingNode, prompt, refs, pendingNode, pendingMeta);
                if(sourceVisualState) deps.restoreSourceVisualState(node, sourceVisualState);
                deps.addSmartGenerationLog({run:runLog, outputs:pendingNode.images || [], runMs:deps.nowMs() - runLogStart});
                deps.settings = previousSettings;
                return;
            }
            if(deps.isApiLikeEngine(deps.settings.engine) && deps.settings.apiKind === 'video'){
                deps.prepareSmartVideoTask(pendingNode);
                deps.render();
                deps.scheduleSave();
                const outVideos = await deps.runApiVideoGeneration(prompt, refs, deps.settings, pendingNode);
                if(!outVideos.length) throw new Error(deps.tr('smart.errNoOutVideos'));
                deps.finalizePendingNode(pendingNode, outVideos, pendingMeta, 'video');
                if(sourceVisualState) deps.restoreSourceVisualState(node, sourceVisualState);
                deps.addSmartGenerationLog({run:runLog, outputs:outVideos, runMs:deps.nowMs() - runLogStart});
                deps.clearPromptInput({preserveDraft:true});
                deps.settings = previousSettings;
                deps.scheduleSave();
                return;
            }
            const rhModelMode = deps.settings.engine === 'runninghub' && Boolean(deps.runningHubSelectedModel(deps.settings));
            const outImages = rhModelMode
                ? await deps.runApiGeneration(prompt, refs, deps.runningHubModelApiSettings(deps.settings))
                : deps.settings.engine === 'runninghub'
                    ? await deps.runRunningHubGeneration(prompt, refs)
                    : deps.settings.engine === 'modelscope'
                    ? await deps.runModelscopeGeneration(prompt, refs)
                    : await deps.runApiGeneration(prompt, refs, deps.settings, options);
            if(deps.isApiLikeEngine(deps.settings.engine) || rhModelMode){
                const taskIds = Array.isArray(outImages?.taskIds) ? outImages.taskIds : [];
                const warning = deps.recordSmartTaskSubmission(taskIds.length ? pendingNode : node, outImages);
                if(!taskIds.length) throw new Error(warning || deps.tr('smart.errRunFailed'));
                pendingNode.pendingTasks = taskIds.map(taskId => ({taskId, kind:'image', providerId:outImages.providerId, model:outImages.model}));
                pendingNode.pending = taskIds.length;
                pendingNode.runStartedAt = deps.nowMs();
                pendingNode.runTimerHidden = false;
                pendingNode.running = false;
                deps.render();
                deps.scheduleSave();
                if(!await deps.saveSmartAcceptedTasksBeforeQuery(pendingNode, taskIds)){
                    if(sourceVisualState) deps.restoreSourceVisualState(node, sourceVisualState);
                    deps.settings = previousSettings;
                    return;
                }
                await deps.resumeSmartPendingNode(pendingNode, {run:runLog, runLogStart});
                if(pendingNode.jimengPending || deps.smartRecoverableImageTask(pendingNode)){
                    if(sourceVisualState) deps.restoreSourceVisualState(node, sourceVisualState);
                    deps.clearPromptInput({preserveDraft:true});
                    deps.settings = previousSettings;
                    deps.scheduleSave();
                    return;
                }
                if(!(pendingNode.images || []).length) throw new Error(deps.tr('smart.errNoOutImages'));
                if(outpaintSize) delete node.outpaintSize;
                if(sourceVisualState) deps.restoreSourceVisualState(node, sourceVisualState);
                deps.addSmartGenerationLog({run:runLog, outputs:pendingNode.images || [], runMs:deps.nowMs() - runLogStart});
                deps.clearPromptInput({preserveDraft:true});
                deps.settings = previousSettings;
                deps.scheduleSave();
                return;
            }
            if(!outImages.length) throw new Error(deps.tr('smart.errNoOutImages'));
            if(outpaintSize) delete node.outpaintSize;
            deps.finalizePendingNode(pendingNode, outImages, pendingMeta);
            if(sourceVisualState) deps.restoreSourceVisualState(node, sourceVisualState);
            deps.addSmartGenerationLog({run:runLog, outputs:outImages, runMs:deps.nowMs() - runLogStart});
            deps.clearPromptInput({preserveDraft:true});
            deps.settings = previousSettings;
            deps.scheduleSave();
        } catch(e) {
            deps.settings = previousSettings;
            if(deps.handleJimengPendingSignal(pendingNode, e)){
                if(sourceVisualState) deps.restoreSourceVisualState(node, sourceVisualState);
                delete pendingNode._runMetaTargetId;
                deps.clearPromptInput({preserveDraft:true});
                return;
            }
            if(e?.comfyTaskPaused || e?.comfyTaskLost){
                pendingNode.running = false;
                if(sourceVisualState) deps.restoreSourceVisualState(node, sourceVisualState);
                delete pendingNode._runMetaTargetId;
                deps.toast((e.message || '可稍后查询原任务').slice(0, 160));
                deps.scheduleSave();
                return;
            }
            if(typeof deps.retainSmartVideoTaskRecovery === 'function' && deps.retainSmartVideoTaskRecovery(pendingNode, e)){
                pendingNode.queued = false;
                if(branchNode){
                    deps.selectedId = branchNode.id;
                    deps.selectedIds = [];
                    deps.selectedImage = {nodeId:'', index:-1};
                }
                delete pendingNode._runMetaTargetId;
                deps.scheduleSave();
                deps.toast((e.message || '视频任务状态未知，请稍后查询原任务').slice(0, 160));
                return;
            }
            pendingNode.pending = 0;
            if(branchNode){
                if(branchNode.submissionWarning){
                    deps.rememberSmartTaskSubmissionWarning(node, branchNode.submissionWarning, branchNode.submissionUnknown);
                }
                deps.nodes = deps.nodes.filter(n => n.id !== branchNode.id);
                deps.canvas.connections = (deps.canvas.connections || []).filter(c => c.from !== branchNode.id && c.to !== branchNode.id);
                deps.selectedId = node.id;
            } else {
                pendingNode.pending = 0;
                pendingNode.running = false;
                if(!(pendingNode.images || []).length){
                    delete pendingNode.w;
                    delete pendingNode.h;
                }
            }
            if(extracted) deps.restoreFromExtraction(node, extracted);
            delete pendingNode._runMetaTargetId;
            if(!e?.smartGenerationLogged) deps.addSmartGenerationLog({run:runLog, outputs:[], runMs:deps.nowMs() - runLogStart, error:e.message || String(e)});
            deps.toast((e.message || deps.tr('smart.errRunFailed')).slice(0, 160));
        } finally {
            if(!apiConcurrentRun){
                deps.clearNodeRunningState(pendingNode);
                deps.syncRunButtonState();
            }
            deps.render();
        }
    }

    const api={generateUrlsForCurrentSettings, runGeneration};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.SmartGenerationRunner=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
