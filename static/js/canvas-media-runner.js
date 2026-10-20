/* Classic generation media. Host supplies instance state and effects. */
(function(root){
    'use strict';

    async function runGenerator(deps, genId, opts={}){
        const gen = deps.nodes.find(n => n.id === genId);
        if(!gen || (gen.running && !opts.cascade)) return;
        if(gen.shotPromptOrigin && !opts.acceptedTask){try{deps.CanvasVideoDeconstructionModel.validateShotImage(deps.nodes,deps.connections,gen);}catch(error){error.submissionKnownRejected=true;if(opts.assistantNativeActionId||opts.cascade)throw error;deps.showErrorModal(error.message,'本镜提示词需要更新');return;}}
        if(!opts.acceptedTask && deps.canvasApiAudioMode(gen)){
            if(opts.assistantNativeActionId || opts.assistantProposal){
                const error = new Error('此节点当前使用音频分支，助手图片运行确认不适用；未提交任务');
                error.submissionKnownRejected = true;
                throw error;
            }
            try{return await deps.runCanvasApiAudio(gen,opts);}catch(error){if(opts.cascade)throw error;deps.showErrorModal(error.message,'音频处理失败');return;}
        }
        const cascadeTargetId = deps.cascadeTargetIdFromOptions(opts);
        const compiledNode = opts.assistantNativeActionId ? {...gen,inputs:[...(gen.inputs||[])]} : gen;
        const sources = deps.orderedSources(compiledNode, deps.generatorSources(gen));
        const prompt = opts.assistantProposal?.prompt ?? sources.map(s => s.prompt).filter(Boolean).join('\n\n');
        const audioRefs = deps.audioRefsOnly(sources.flatMap(source => source.refs || []));
        if(!opts.acceptedTask && audioRefs.length && deps.providerChatModels(gen.apiProvider).includes(gen.model)){
            if(opts.assistantNativeActionId || opts.assistantProposal){
                const error = new Error('此节点当前使用音频识别分支，助手图片运行确认不适用；未提交任务');
                error.submissionKnownRejected = true;
                throw error;
            }
            return deps.runAudioAnalysisGenerator(gen, prompt, audioRefs, opts);
        }
        const refs = opts.assistantProposal ? opts.assistantProposal.referenceImages.map(url=>({url,kind:'image'})) : deps.imageRefsOnly(sources.flatMap(s => s.refs || []));
        if(!prompt && !refs.length){ deps.alert(deps.tr('canvas.needPromptOrImage')); return; }
        if(!deps.confirmCanvasUnknownResubmission(gen, opts)) return;
        const count = opts.acceptedTask ? 1 : Math.max(1, Math.min(8, Number(gen.count || 1)));
        let out = deps.outputForNode(gen, 460);
        const run = deps.runSnapshot(gen, prompt || 'Edit the reference images.', refs);
        const payload = {
            prompt: prompt || 'Edit the reference images.',
            provider_id:deps.resolveImageProviderId(gen.apiProvider || 'comfly'),
            model:deps.resolveImageModel(gen.model),
            size:await deps.generatorSizeForRun(compiledNode, refs),
            reference_images:refs.slice(0, deps.CANVAS_REFERENCE_IMAGE_MAX)
        };
        const quality = deps.normalizedImageQuality(gen.quality);
        if(quality) payload.quality = quality;
        let pendingIds = [];
        const startedAt = deps.nowMs();
        if(!opts.cascade){
            gen.running = true;
            deps.refreshRunNodes(gen, out);
            // API 支持并发：2s 后即可再次点击，任务仍由 pending 卡片继续追踪
            deps.setTimeout(() => { gen.running = false; deps.refreshRunNodes(gen, out); }, 2000);
        }
        deps.rememberCanvasSubmissionWarning(gen, '');
        try {
            const submission = await deps.submitCanvasImageTaskBatch(count, payload, {...opts,cascadeTargetId});
            const {taskInfos, warning, unknownCount} = submission;
            if(opts.assistantNativeActionId)gen.assistantNativeRun={actionId:opts.assistantNativeActionId,taskKind:'image',taskIds:taskInfos.map(task=>task.task_id),unknownCount,warning};
            deps.rememberCanvasSubmissionWarning(gen, warning, unknownCount > 0);
            if(!out){
                const outputs = await deps.waitCanvasDirectTasks(gen, taskInfos, run, {cascadeTargetId, refs, requestSize:payload.size, providerId:payload.provider_id, model:payload.model,
                    onAcceptedSaved:() => { if(warning && !opts.cascade) deps.showErrorModal(warning, deps.tr('canvas.apiFailed')); }});
                if(!outputs.length) throw new Error(deps.tr('canvas.generationFailed'));
                deps.mergeGeneratedOutputs(gen, outputs, Boolean(opts.cascade));
                deps.addGenerationLog({run, outputs, runMs:deps.nowMs() - startedAt});
                gen.runStatus = 'done';
                if(opts.acceptedTask?.task_id) gen.assistantCompletedTaskId=opts.acceptedTask.task_id;
                gen.runError = warning;
                gen.running = false;
                deps.refreshRunNodes(gen, out);
                deps.scheduleSave();
                if(warning && opts.cascade) throw new Error(warning);
                return;
            }
            pendingIds = taskInfos.map(() => deps.uid('p'));
            if(out) out._pending = [
                ...(out._pending || []),
                ...taskInfos.map((task, index) => deps.makePendingForRun(pendingIds[index], run, gen, {refs, requestSize:payload.size, cascadeTargetId}, {
                    canvasTaskId:task.task_id,
                    canvasTaskType:'online-image',
                    providerId:payload.provider_id,
                    model:payload.model,
                    appendGenerated:Boolean(opts.cascade)
                }))
            ];
            deps.refreshRunNodes(gen, out);
            deps.scheduleSave();
            if(!await deps.saveCanvas()) throw deps.pauseCanvasAcceptedTasksUntilSaved(gen, pendingIds.map(id => deps.pendingById(out, id)).filter(Boolean), out);
            if(warning && !opts.cascade) deps.showErrorModal(warning, deps.tr('canvas.apiFailed'));
            const statuses = await Promise.all(taskInfos.map(task => deps.pollCanvasImageTask(task.task_id, {cascadeTargetId})));
            if(statuses.includes('aborted')) throw deps.cascadeAbortError(deps.cascadeStopMessage());
            if(statuses.includes('failed')) throw new Error(gen.runError || deps.tr('canvas.generationFailed'));
            if(warning){
                gen.runError = warning;
                deps.refreshRunNodes(gen, out);
                deps.scheduleSave();
                if(opts.cascade) throw new Error(warning);
            }
        } catch(err) {
            if(err.submissionUnknown) deps.rememberCanvasSubmissionWarning(gen, err.message, true);
            if(opts.assistantNativeActionId && err.submissionKnownRejected)gen.assistantNativeRun={actionId:opts.assistantNativeActionId,taskKind:'image',taskIds:[],knownRejected:true,error:err.message};
            const remainingPending = pendingIds.map(id => deps.pendingById(out, id)).filter(Boolean);
            const removableIds = remainingPending.filter(p => !(p.queryRecoverable || (p.failed && p.recoverTaskId))).map(p => p.id);
            if(removableIds.length){
                const metas = deps.collectRunMetas(out, removableIds);
                deps.addGenerationLog({run, outputs:[], runMs:Math.max(...metas.map(m => m.runMs || 0), 0), error:err.message || String(err)});
                if(out) out._pending = (out._pending||[]).filter(p => !removableIds.includes(p.id));
            }
            if(err.queryPaused){
                gen.runStatus = 'query-paused';
                gen.running = false;
                deps.refreshRunNodes(gen, out);
                deps.scheduleSave();
                if(opts.cascade) throw deps.cascadeAbortError('查询暂停，请先恢复原任务结果');
                return;
            }
            if(deps.isCascadeAbortError(err)){
                gen.running = false;
                deps.refreshRunNodes(gen, out);
                deps.scheduleSave();
                throw err;
            }
            gen.runStatus = 'failed'; gen.runError = err.message || String(err);
            gen.running = false;
            deps.refreshRunNodes(gen, out);
            deps.scheduleSave();
            if(remainingPending.some(p => p.failed && p.recoverTaskId) && !removableIds.length) return;
            if(opts.cascade) throw err;
            deps.showErrorModal(err.message || deps.tr('canvas.generationFailed'), deps.tr('canvas.apiFailed'));
        }
    }

    async function runVideoNode(deps, nodeId, opts={}){
        const node = deps.nodes.find(n => n.id === nodeId);
        if(!node || (node.running && !opts.cascade)) return;
        const cascadeTargetId = deps.cascadeTargetIdFromOptions(opts);
        const sources = deps.orderedSources(node, deps.generatorSources(node));
        const prompt = sources.map(s => s.prompt).filter(Boolean).join('\n\n');
        const allRefs = sources.flatMap(s => s.refs || []);
        const mediaRefs = deps.applyUploadedUrlToRefs((allRefs || []).filter(ref => ['image','video','audio'].includes(deps.mediaKindForRef(ref))), node);
        const refs = deps.imageRefsOnly(mediaRefs);
        const videoRefs = deps.videoRefsOnly(mediaRefs);
        const audioRefs = deps.audioRefsOnly(mediaRefs);
        if(node.useFrameRoles && refs[0]) refs[0] = {...refs[0], role:'first_frame'};
        if(node.useFrameRoles && refs[1]) refs[1] = {...refs[1], role:'last_frame'};
        if(!prompt){ deps.alert(deps.tr('canvas.videoNeedsPrompt')); return; }
        const assistant=Boolean(opts.assistantNativeActionId);
        const originalOut=assistant?deps.nodes.find(n=>n.id===opts.assistantOutputNodeId&&n.type==='output'):null;
        const validate=()=>{
            const provider=(deps.apiProviders||[]).find(p=>p.id===node.apiProvider&&p.enabled!==false);
            if(!deps.nodes.includes(node)||deps.canvas?.id!==opts.assistantCanvasId||!originalOut||!deps.nodes.includes(originalOut)||originalOut.type!=='output'||!deps.connections.some(c=>c.from===node.id&&c.to===originalOut.id)||node.outputEnabled!==true||!provider||(provider.video_models||[]).indexOf(node.model)<0||!opts.assistantRunInputHash||opts.assistantMaxCalls!==1)throw new Error('原视频模型、画布或输出连接已变化，请重新读取；请求未提交');
        };
        let out = assistant?originalOut:deps.outputForNode(node, 460);
        const stillAttached=()=>deps.nodes.includes(node) && (!out || deps.nodes.includes(out));
        const pendingId = deps.uid('p');
        const run = deps.runSnapshot(node, prompt, refs);
        const pending = deps.makePendingForRun(pendingId, run, node, {refs, cascadeTargetId});
        deps.canvasVideoTaskIdForPending(pending);
        if(assistant){
            pending.assistantNativeActionId=opts.assistantNativeActionId;pending.assistantCanvasId=opts.assistantCanvasId;pending.assistantInputHash=opts.assistantRunInputHash;pending.providerId=node.apiProvider;pending.model=node.model;
            Object.assign(node.assistantNativeRun,{plannedTaskId:pending.canvasTaskId,outputNodeId:out?.id,inputHash:opts.assistantRunInputHash,startedAt:deps.nowMs()});
        }
        if(out) out._pending = [...(out._pending || []), pending];
        if(!opts.cascade){ node.running = true; deps.refreshRunNodes(node, out); }
        else deps.refreshRunNodes(node, out);
        let posted=false;
        try {
            if(assistant)validate();
            const payload = {
                    prompt,
                    provider_id:assistant?node.apiProvider:deps.resolveVideoProviderId(node.apiProvider || 'comfly'),
                    model:assistant?node.model:node.model || 'veo3-fast',
                    duration:Number(node.duration || 5),
                    aspect_ratio:node.aspectRatio || '16:9',
                    resolution:node.resolution || '',
                    images:refs,
                    videos:deps.manualVideoUrlForNode(node)
                        ? [deps.manualVideoUrlForNode(node)]
                        : videoRefs.map(ref => deps.tempShUploadedUrlForNode(node, ref.url)),
                    audios:audioRefs.map(ref => ref.url).filter(Boolean),
                    enhance_prompt:Boolean(node.enhancePrompt),
                    enable_upsample:Boolean(node.enableUpsample),
                    watermark:Boolean(node.watermark),
                    camerafixed:Boolean(node.cameraFixed),
                    generate_audio:Boolean(node.generateAudio),
                    multimodal:Boolean(node.multimodal)
            };
            if(assistant)Object.assign(payload,{canvas_id:opts.assistantCanvasId,node_id:node.id,assistant_action_id:opts.assistantNativeActionId,input_hash:opts.assistantRunInputHash});
            if(!await deps.saveCanvas()){
                pending.savePending = true;
                pending.queryPaused = true;
                pending.error = '编号未保存，视频请求未提交；请先保存画布再查询。';
                throw new Error(pending.error);
            }
            if(!stillAttached()){
                if(assistant) validate();
                return;
            }
            const accepted = await deps.createCanvasVideoTask(payload, pending,assistant?{
                beforeSubmit:opts.beforeSubmit,validate,
                persistStarted:()=>deps.saveCanvas(),onSubmitting:()=>{posted=true;},
                validateAccepted:(task,id)=>{const binding={task_id:id,canvas_id:opts.assistantCanvasId,node_id:node.id,assistant_action_id:opts.assistantNativeActionId,input_hash:opts.assistantRunInputHash,provider_id:payload.provider_id,model:payload.model};if(Object.entries(binding).some(([key,value])=>task[key]!==value))throw new Error('视频受理编号或归属不匹配，只查询原预分配编号');},
                onAccepted:async task=>{
                    node.assistantNativeRun.taskIds=[task.task_id];node.submissionUnknown=false;
                    deps.rememberUnsavedCanvasAcceptedTasks(node,[pending],out);
                }
            }:{});
            if(!stillAttached()) return;
            pending.canvasTaskId = accepted.task_id || pending.canvasTaskId;
            pending.queryRecoverable = true;
            pending.queryPaused = false;
            pending.savePending = false;
            deps.refreshRunNodes(node, out);
            if(assistant&&!await deps.saveCanvas()){
                deps.pauseCanvasAcceptedTasksUntilSaved(node,[pending],out);
                return;
            }
            if(!stillAttached()) return;
            deps.scheduleSave();
            const result = await deps.waitCanvasVideoTaskResult(pending.canvasTaskId, {cascadeTargetId});
            deps.completeCanvasVideoTask(pending.canvasTaskId,result,{out,pending,node});
        } catch(err) {
            if(assistant){
                const receipt=node.assistantNativeRun;
                receipt.error=err.message||'视频运行未完成';receipt.knownRejected=!posted;receipt.submissionStarted=posted;
                if(!posted){if(out)out._pending=(out._pending||[]).filter(p=>p.id!==pendingId);}
                else if(!receipt.taskIds.length){node.submissionUnknown=true;receipt.unknownCount=1;receipt.warning='视频请求受理状态未知，仅查询原预分配编号，不重新提交';}
            }
            if(!stillAttached()){
                if(opts.cascade) throw err;
                return;
            }
            const meta = deps.collectRunMeta(out, pendingId);
            deps.addGenerationLog({run, outputs:[], runMs:meta.runMs || 0, error:err.message || String(err)});
            if(pending.canvasTaskId && out && (!assistant||posted)){
                pending.failed = true;
                pending.queryPaused = !err.taskLost;
                pending.taskLost = Boolean(err.taskLost);
                pending.queryRecoverable = true;
                pending.error = err.message || '视频任务状态未知，请勿直接重新提交';
            } else if(out) out._pending = (out._pending || []).filter(p => p.id !== pendingId);
            if(deps.isCascadeAbortError(err)){
                if(opts.cascade) throw err;
                return;
            }
            node.runStatus = 'failed'; node.runError = err.message || String(err);
            deps.refreshRunNodes(node, out);
            if(opts.cascade) throw err;
            deps.alert(err.message || deps.tr('canvas.videoFailed'));
        } finally {
            node.running = false;
            if(stillAttached()){
                deps.refreshRunNodes(node, out);
                if(assistant)await deps.saveCanvas();
            }
        }
    }

    const api={runGenerator, runVideoNode};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.CanvasMediaRunner=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
