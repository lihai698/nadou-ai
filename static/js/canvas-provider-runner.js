/* Generation responsibility: canvas-provider-runner. Host supplies live state and effects. */
(function(root){
    'use strict';

    async function runMsGenNode(deps, nodeId, opts={}){
        if(opts.assistantNativeActionId)return deps.runCanvasAssistantCatalogImage(nodeId,opts);
        const node = deps.nodes.find(n => n.id === nodeId);
        if(!node || (node.running && !opts.cascade)) return;
        const cascadeTargetId = deps.cascadeTargetIdFromOptions(opts);
        const sources = deps.orderedSources(node, deps.generatorSources(node));
        const prompt = sources.map(s => s.prompt).filter(Boolean).join('\n\n');
        const refs = deps.imageRefsOnly(sources.flatMap(s => s.refs || []));
        const modelKey = node.msgenModel || 'zimage';
        const msModel = deps.MS_GEN_MODELS[modelKey] || deps.MS_GEN_MODELS.zimage;
        const msModelId = deps.currentMsModelId(modelKey, node);
        const msLoras = deps.modelscopeLorasForModel(msModelId);
        if(!prompt){ deps.alert(deps.tr('canvas.needPrompt')); return; }
        if(msModel.supportsImage && !refs.length){ deps.alert(deps.tr('canvas.needImage')); return; }
        const count = Math.max(1, Math.min(8, Number(node.count || 1)));
        // 链路中间节点默认不创建 Output；链尾、手动开启或已有 Output 连接时才输出。
        let out = deps.outputForNode(node, 460);
        const pendingIds = Array.from({length:count}, () => deps.uid('p'));
        const run = deps.runSnapshot(node, prompt, refs);
        const size = deps.apiImageSize(node.msRatio ?? 'square', node.msResolution || '1k', node.msCustomRatio || '', node.msCustomSize || '');
        const parsed = deps.parseSizeValue(size);
        let width = Number(parsed?.width) || 1024;
        let height = Number(parsed?.height) || 1024;
        if(!parsed && node.msWidth && node.msHeight){
            width = Number(node.msWidth) || width;
            height = Number(node.msHeight) || height;
        }
        const requestSize = {width, height};
        if(out) out._pending = [...(out._pending || []), ...pendingIds.map(id => deps.makePendingForRun(id, run, node, {refs, requestSize, cascadeTargetId}))];
        if(!opts.cascade){
            node.running = true;
            deps.refreshRunNodes(node, out);
            deps.setTimeout(() => { node.running = false; deps.refreshRunNodes(node, out); }, 2000);
        }
        else deps.refreshRunNodes(node, out);
        try {
            const imageUrls = [];
            if(msModel.supportsImage || msModel.acceptsImage){
                for(const ref of refs.slice(0, deps.CANVAS_REFERENCE_IMAGE_MAX)){
                    if(ref.url){
                        try { imageUrls.push(await deps.urlToBase64(ref.url)); }
                        catch(e){ imageUrls.push(ref.url); }
                    }
                }
            }
            const submitMs = async () => {
                let apiBody;
                if(modelKey === 'zimage'){
                    apiBody = { prompt, resolution: `${width}x${height}`, client_id: deps.CLIENT_ID };
                } else if(modelKey === 'qwen_edit'){
                    apiBody = { prompt, image_urls: imageUrls, resolution: `${width}x${height}`, client_id: deps.CLIENT_ID };
                } else if(modelKey === 'custom'){
                    apiBody = {
                        prompt,
                        model: node.msCustomModel || deps.modelscopeImageModels()[0] || 'Tongyi-MAI/Z-Image-Turbo',
                        image_urls: imageUrls,
                        width,
                        height,
                        size: `${width}x${height}`,
                        client_id: deps.CLIENT_ID
                    };
                } else {
                    apiBody = { prompt, model: msModel.modelId, image_urls: imageUrls, width, height, size:`${width}x${height}`, client_id: deps.CLIENT_ID };
                }
                if(node.msLoraEnabled){
                    const selected = msLoras.find(lora => String(lora.id || '').trim() === String(node.msLoraId || '').trim()) || msLoras[0];
                    const loraId = String(selected?.id || node.msLoraId || '').trim();
                    if(!loraId) throw new Error(deps.tr('canvas.noLoraBoundError'));
                    apiBody.loras = { [loraId]: Number(node.msLoraStrength ?? selected?.strength ?? 0.8) };
                }
                const res = await deps.cascadeFetch(msModel.endpoint, {
                    method:'POST', headers:{'Content-Type':'application/json'},
                    body:JSON.stringify(apiBody)
                }, {cascadeTargetId});
                if(!res.ok) throw new Error(await deps.responseErrorMessage(res, deps.tr('canvas.msFailed')));
                return await res.json();
            };
            const results = await Promise.all(Array.from({length:count}, submitMs));
            const metas = deps.collectRunMetas(out, pendingIds);
            const outputUrls = results.map(data => data.url).filter(Boolean);
            run.request = results[0] ? deps.requestMetaFromResult(results[0]) : {};
            if(out) out._pending = (out._pending || []).filter(p => !pendingIds.includes(p.id));
            deps.appendOutputImages(out, outputUrls, refs[0], metas);
            deps.mergeGeneratedOutputs(node, outputUrls, Boolean(opts.cascade));
            deps.addGenerationLog({run, outputs:outputUrls, runMs:Math.max(...metas.map(m => m.runMs || 0), 0)});
            node.runStatus = 'done'; node.runError = '';
            deps.refreshRunNodes(node, out);
            deps.scheduleSave();
        } catch(err){
            const metas = deps.collectRunMetas(out, pendingIds);
            deps.addGenerationLog({run, outputs:[], runMs:Math.max(...metas.map(m => m.runMs || 0), 0), error:err.message || String(err)});
            if(out) out._pending = (out._pending || []).filter(p => !pendingIds.includes(p.id));
            if(deps.isCascadeAbortError(err)){
                if(opts.cascade) throw err;
                return;
            }
            node.runStatus = 'failed'; node.runError = err.message || String(err);
            deps.refreshRunNodes(node, out);
            if(opts.cascade) throw err;
            deps.alert(err.message || deps.tr('canvas.msFailed'));
        }
    }

    async function runRhNode(deps, nodeId, opts={}){
        const node = deps.nodes.find(n => n.id === nodeId);
        if(!node || (node.running && !opts.cascade)) return;
        const assistant = Boolean(opts.assistantNativeActionId);
        const cascadeTargetId = deps.cascadeTargetIdFromOptions(opts);
        deps.ensureRhNodeSelection(node);
        const mode = deps.rhCurrentKind(node);
        if(mode === 'model') return runRhModelNode(deps, node, opts);
        if(mode === 'workflow' && !String(node.workflowId || '').trim()){ deps.alert(deps.tr('canvas.rhNeedWorkflowId')); return; }
        if(mode === 'app' && !String(node.webappId || '').trim()){ deps.alert(deps.tr('canvas.rhNeedWebappId')); return; }
        const selectedRef = deps.rhSelectedEntryRef(node);
        const selectedEntry = selectedRef?.entry || null;
        if(!selectedEntry){
            deps.alert(mode === 'workflow' ? '请先在 API 设置里添加 RunningHub 工作流' : '请先在 API 设置里添加 RunningHub 应用');
            return;
        }
        const selectedId = mode === 'workflow' ? String(node.workflowId || '').trim() : String(node.webappId || '').trim();
        if(assistant && (selectedRef.kind!==mode || selectedRef.id!==selectedId || node.rhConfigKey!==`${mode}:${selectedId}` || node.apiProvider!=='runninghub' || node.count!==1 || node.outputEnabled!==true)){
            const error=new Error('RH 手选工作流、应用或单次输出设置已变化，未提交任务');error.submissionKnownRejected=true;throw error;
        }
        const compiledNode={...node,rhRandomValues:{},rhParams:{...(node.rhParams||{})}};
        if(mode === 'workflow') await deps.ensureRunningHubWorkflowConfigForNode(compiledNode);
        if(!deps.rhActiveFields(compiledNode).length){
            deps.alert(mode === 'workflow' ? '请先在 API 设置里编辑并保存这个 RunningHub 工作流参数' : '请先在 API 设置里编辑并保存这个 RunningHub 应用参数');
            return;
        }
        const media = deps.rhMediaSources(node);
        let out = assistant?deps.nodes.find(n=>n.id===opts.assistantOutputNodeId&&n.type==='output'):deps.outputForNode(node, 500);
        if(assistant && (!out || deps.connections.filter(c=>c.from===node.id&&deps.nodes.find(n=>n.id===c.to)?.type==='output').length!==1 || !deps.connections.some(c=>c.from===node.id&&c.to===out.id))){
            const error=new Error('RH 原生输出连接已变化，未提交任务');error.submissionKnownRejected=true;throw error;
        }
        const pendingId = deps.uid('p');
        const run = deps.runSnapshot(node, media.prompt || 'RunningHub', media.refs);
        run.taskLabel = 'RunningHub';
        if(out) out._pending = [...(out._pending || []), deps.makePendingForRun(pendingId, run, node, {refs:media.refs, cascadeTargetId})];
        if(!opts.cascade) node.running = true;
        deps.refreshRunNodes(node, out);
        let taskAccepted = false;
        try {
            const nodeInfoList = await deps.rhBuildNodeInfoList(compiledNode, media);
            const workflowExtras = mode === 'workflow' ? await deps.rhBuildWorkflowRequestExtras(compiledNode, media, nodeInfoList) : {};
            const endpoint = mode === 'workflow' ? '/api/runninghub/workflow-submit' : '/api/runninghub/submit';
            const body = mode === 'workflow'
                ? {workflowId:node.workflowId.trim(), nodeInfoList, useWallet:deps.rhUseWallet(node), ...workflowExtras}
                : {webappId:node.webappId.trim(), nodeInfoList, instanceType:node.instanceType || '', useWallet:deps.rhUseWallet(node)};
            if(opts.beforeSubmit) await opts.beforeSubmit();
            const submit = await deps.cascadeFetch(endpoint, {
                method:'POST',
                headers:{'Content-Type':'application/json'},
                body:JSON.stringify(body)
            }, {cascadeTargetId}).then(async r => {
                const data = await r.json();
                if(!r.ok || data.success === false) throw new Error(data.detail || data.error || deps.tr('canvas.rhFailed'));
                return data.data || data;
            });
            const taskId = submit.taskId;
            if(!taskId) throw new Error(deps.tr('canvas.rhNoTaskId'));
            taskAccepted = true;
            const useWallet = deps.rhUseWallet(node);
            run.request = {task_id:taskId, webappId:node.webappId, workflowId:node.workflowId, backend:'runninghub', mode, useWallet};
            const pending=deps.pendingById(out,pendingId);
            Object.assign(pending,{canvasTaskId:taskId,canvasTaskType:'runninghub',providerId:'runninghub',model:`${mode}:${selectedId}`,assistantNativeActionId:String(opts.assistantNativeActionId||''),assistantInputHash:String(opts.assistantRunInputHash||''),assistantCanvasId:String(opts.assistantCanvasId||''),queryRecoverable:true,rhMode:mode,useWallet});
            if(assistant)node.assistantNativeRun={previousActionId:node.assistantNativeRun?.previousActionId||'',actionId:opts.assistantNativeActionId,taskKind:'runninghub',taskIds:[taskId],submissionStarted:true,startedAt:pending.startedAt,inputHash:String(opts.assistantRunInputHash||''),outputNodeId:out.id};
            deps.rememberUnsavedCanvasAcceptedTasks(node,[pending],out);
            deps.refreshRunNodes(node,out);
            deps.scheduleSave();
            if(!await deps.saveCanvas()) throw deps.pauseCanvasAcceptedTasksUntilSaved(node,[pending],out);
            let result = null;
            for(let i = 0; i < 720; i++){
                if(cascadeTargetId) deps.ensureCascadeActive(cascadeTargetId);
                await deps.sleep(2500);
                const data = await deps.cascadeFetch(`/api/runninghub/query?taskId=${encodeURIComponent(taskId)}&useWallet=${useWallet ? '1' : '0'}`, {}, {cascadeTargetId}).then(async r => {
                    const json = await r.json();
                    if(!r.ok || json.success === false) throw new Error(json.detail || json.error || deps.tr('canvas.rhFailed'));
                    return json.data || json;
                });
                if(data.status === 'SUCCESS'){
                    result = data;
                    break;
                }
                if(data.status === 'FAILED') throw new Error(data.failReason || deps.tr('canvas.rhFailed'));
            }
            if(!result) throw new Error(deps.tr('canvas.rhTimeout'));
            const outputs = result.urls || [];
            if(!outputs.length) throw new Error(deps.tr('canvas.rhOutputsEmpty'));
            const meta = deps.collectRunMeta(out, pendingId);
            if(out) out._pending = (out._pending || []).filter(p => p.id !== pendingId);
            deps.appendOutputImages(out, outputs, media.refs[0], [meta]);
            deps.mergeGeneratedOutputs(node, outputs, Boolean(opts.cascade));
            deps.addGenerationLog({run, outputs, runMs:meta.runMs || 0});
            node.runStatus = 'done';
            node.runError = '';
            if(assistant){node.assistantNativeRun.resultUrls=[...outputs];node.assistantNativeRun.status='succeeded';}
            deps.refreshRunNodes(node, out);
            deps.scheduleSave();
        } catch(err) {
            const meta = deps.collectRunMeta(out, pendingId);
            deps.addGenerationLog({run, outputs:[], runMs:meta.runMs || 0, error:err.message || String(err)});
            const pending=deps.pendingById(out,pendingId);
            if(taskAccepted && pending){
                pending.queryPaused=true;pending.queryRecoverable=true;pending.error=err.message||String(err);pending.cascadeTargetId='';
                node.runStatus='query-paused';node.runError=pending.error;deps.scheduleSave();
                if(opts.cascade) throw err;
                return;
            }
            if(out) out._pending = (out._pending || []).filter(p => p.id !== pendingId);
            if(deps.isCascadeAbortError(err)){
                if(opts.cascade) throw err;
                return;
            }
            node.runStatus = 'failed';
            node.runError = err.message || String(err);
            deps.refreshRunNodes(node, out);
            if(opts.cascade) throw err;
            deps.alert(err.message || deps.tr('canvas.rhFailed'));
        } finally {
            node.running = false;
            deps.refreshRunNodes(node, out);
        }
    }

    async function runRhModelNode(deps, node, opts={}){
        if(!node || (node.running && !opts.cascade)) return;
        const cascadeTargetId = deps.cascadeTargetIdFromOptions(opts);
        const selectedRef = deps.rhSelectedEntryRef(node);
        const model = selectedRef?.id || node.rhModel || node.model || '';
        if(!model){
            deps.alert('请先在 API 设置里添加 RunningHub 模型 API');
            return;
        }
        if(opts.assistantNativeActionId){
            if(selectedRef?.kind!=='model'||selectedRef.id!==node.rhModel||node.rhConfigKey!=='model:'+node.rhModel||node.model!==node.rhModel||node.apiProvider!=='runninghub'||node.rhMode!=='model'||node.count!==1||node.outputEnabled!==true){
                const error=new Error('RH 手选模型或单次输出设置已变化，未提交任务');error.submissionKnownRejected=true;throw error;
            }
        }else{
            node.rhModel = model;
            node.model = model;
            node.apiProvider = 'runninghub';
        }
        const media = deps.rhMediaSources(node);
        const prompt = media.prompt || '';
        const refs = deps.imageRefsOnly(media.refs || []);
        if(!prompt && !refs.length){ deps.alert(deps.tr('canvas.needPromptOrImage')); return; }
        if(!deps.confirmCanvasUnknownResubmission(node, opts)) return;
        const count = Math.max(1, Math.min(8, Number(node.count || 1)));
        let out = deps.outputForNode(node, 500);
        const run = deps.runSnapshot(node, prompt || 'Edit the reference images.', refs);
        run.taskLabel = 'RunningHub';
        const payload = {
            prompt:prompt || 'Edit the reference images.',
            provider_id:'runninghub',
            model,
            size:await deps.generatorSizeForRun(opts.assistantNativeActionId?{...node}:node, refs),
            reference_images:refs.slice(0, deps.CANVAS_REFERENCE_IMAGE_MAX)
        };
        const quality = deps.normalizedImageQuality(node.quality);
        if(quality) payload.quality = quality;
        let pendingIds = [];
        const startedAt = deps.nowMs();
        if(!opts.cascade){
            node.running = true;
            deps.refreshRunNodes(node, out);
            if(!opts.assistantNativeActionId)deps.setTimeout(() => { node.running = false; deps.refreshRunNodes(node, out); }, 2000);
        }
        deps.rememberCanvasSubmissionWarning(node, '');
        try {
            const submissionOptions={...opts,cascadeTargetId};
            if(opts.assistantNativeActionId){
                const validOutput=()=>deps.nodes.includes(out)&&out?.type==='output'&&deps.connections.some(c=>c.from===node.id&&c.to===out.id);
                submissionOptions.beforeSubmit=async()=>{
                    if(!validOutput())throw new Error('RH 原生输出连接已变化，未提交任务');
                    if(opts.beforeSubmit)await opts.beforeSubmit();
                    if(!validOutput())throw new Error('RH 原生输出连接已变化，未提交任务');
                };
            }
            const submission = await deps.submitCanvasImageTaskBatch(count, payload, submissionOptions);
            const {taskInfos, warning, unknownCount} = submission;
            if(opts.assistantNativeActionId)node.assistantNativeRun={previousActionId:node.assistantNativeRun?.previousActionId||'',actionId:opts.assistantNativeActionId,taskKind:'image',taskIds:taskInfos.map(task=>task.task_id),unknownCount,warning,startedAt};
            deps.rememberCanvasSubmissionWarning(node, warning, unknownCount > 0);
            if(!out){
                const outputs = await deps.waitCanvasDirectTasks(node, taskInfos, run, {cascadeTargetId, refs, requestSize:payload.size, providerId:payload.provider_id, model:payload.model,
                    onAcceptedSaved:() => { if(warning && !opts.cascade) deps.showErrorModal(warning, deps.tr('canvas.apiFailed')); }});
                if(!outputs.length) throw new Error(deps.tr('canvas.generationFailed'));
                deps.mergeGeneratedOutputs(node, outputs, Boolean(opts.cascade));
                deps.addGenerationLog({run, outputs, runMs:deps.nowMs() - startedAt});
                node.runStatus = 'done';
                node.runError = warning;
                node.running = false;
                deps.refreshRunNodes(node, out);
                deps.scheduleSave();
                if(warning && opts.cascade) throw new Error(warning);
                return;
            }
            pendingIds = taskInfos.map(() => deps.uid('p'));
            out._pending = [
                ...(out._pending || []),
                ...taskInfos.map((task, index) => deps.makePendingForRun(pendingIds[index], run, node, {refs, requestSize:payload.size, cascadeTargetId}, {
                    canvasTaskId:task.task_id,
                    canvasTaskType:'online-image',
                    providerId:payload.provider_id,
                    model:payload.model,
                    appendGenerated:Boolean(opts.cascade)
                }))
            ];
            if(opts.assistantNativeActionId)deps.rememberUnsavedCanvasAcceptedTasks(node,pendingIds.map(id=>deps.pendingById(out,id)).filter(Boolean),out);
            deps.refreshRunNodes(node, out);
            deps.scheduleSave();
            if(!await deps.saveCanvas()) throw deps.pauseCanvasAcceptedTasksUntilSaved(node, pendingIds.map(id => deps.pendingById(out, id)).filter(Boolean), out);
            if(warning && !opts.cascade) deps.showErrorModal(warning, deps.tr('canvas.apiFailed'));
            const statuses = await Promise.all(taskInfos.map(task => deps.pollCanvasImageTask(task.task_id, {cascadeTargetId})));
            if(statuses.includes('aborted')) throw deps.cascadeAbortError(deps.cascadeStopMessage());
            if(statuses.includes('failed')) throw new Error(node.runError || deps.tr('canvas.generationFailed'));
            if(warning){
                node.runError = warning;
                deps.refreshRunNodes(node, out);
                deps.scheduleSave();
                if(opts.cascade) throw new Error(warning);
            }
        } catch(err) {
            if(err.submissionUnknown) deps.rememberCanvasSubmissionWarning(node, err.message, true);
            if(opts.assistantNativeActionId && err.submissionKnownRejected)node.assistantNativeRun={actionId:opts.assistantNativeActionId,taskKind:'image',taskIds:[],knownRejected:true,error:err.message};
            const remainingPending = pendingIds.map(id => deps.pendingById(out, id)).filter(Boolean);
            const removableIds = remainingPending.filter(p => !(p.queryRecoverable || (p.failed && p.recoverTaskId))).map(p => p.id);
            if(removableIds.length){
                const metas = deps.collectRunMetas(out, removableIds);
                deps.addGenerationLog({run, outputs:[], runMs:Math.max(...metas.map(m => m.runMs || 0), 0), error:err.message || String(err)});
                if(out) out._pending = (out._pending || []).filter(p => !removableIds.includes(p.id));
            }
            if(err.queryPaused){
                node.runStatus = 'query-paused';
                node.running = false;
                deps.refreshRunNodes(node, out);
                deps.scheduleSave();
                if(opts.cascade) throw deps.cascadeAbortError('查询暂停，请先恢复原任务结果');
                return;
            }
            if(deps.isCascadeAbortError(err)){
                node.running = false;
                deps.refreshRunNodes(node, out);
                deps.scheduleSave();
                if(opts.cascade) throw err;
                return;
            }
            node.runStatus = 'failed';
            node.runError = err.message || String(err);
            node.running = false;
            deps.refreshRunNodes(node, out);
            deps.scheduleSave();
            if(remainingPending.some(p => p.failed && p.recoverTaskId) && !removableIds.length) return;
            if(opts.cascade) throw err;
            deps.showErrorModal(err.message || deps.tr('canvas.generationFailed'), deps.tr('canvas.apiFailed'));
        }
    }

    const api={runMsGenNode, runRhNode, runRhModelNode};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.CanvasProviderRunner=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
