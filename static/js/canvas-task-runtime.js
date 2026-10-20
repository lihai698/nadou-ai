/* Task recovery execution. Host owns live canvas state and effects. */
(function(root){
    'use strict';

    async function pollCanvasVideoTask(deps, taskId, options={}){
        if(!taskId || deps.activeCanvasTaskPolls.has(taskId)) return;
        const found = deps.findPendingTask(taskId);
        if(!found || found.pending.savePending) return;
        deps.activeCanvasTaskPolls.add(taskId);
        const {out, pending} = found;
        pending.querying = true;
        pending.queryPaused = false;
        deps.refreshRunNodes(deps.nodes.find(n => n.id === pending.run?.node?.id), out);
        try {
            const result = await deps.waitCanvasVideoTaskResult(taskId, options);
            deps.completeCanvasVideoTask(taskId,result);
        } catch(error){
            const current = deps.findPendingTask(taskId);
            if(!current) return;
            current.pending.querying = false;
            current.pending.queryRecoverable = true;
            current.pending.error = error.message || '视频任务查询失败';
            current.pending.taskLost = Boolean(error.taskLost);
            current.pending.queryPaused = !error.taskLost;
            current.pending.remoteRefreshable = Boolean(error.remoteRefreshable);
            current.pending.failed = true;
            const gen = deps.nodes.find(n => n.id === current.pending.run?.node?.id);
            if(gen){ gen.running = false; gen.runStatus = error.taskLost ? 'task-lost' : 'query-paused'; gen.runError = current.pending.error; }
        } finally {
            const latest = deps.findPendingTask(taskId);
            if(latest) latest.pending.querying = false;
            if(latest || !deps.findPendingTask(taskId)) deps.scheduleSave();
            deps.refreshRunNodes(deps.nodes.find(n => n.id === pending.run?.node?.id), out);
            deps.activeCanvasTaskPolls.delete(taskId);
        }
    }

    async function pollCanvasComfyTask(deps, taskId){
        if(!taskId || deps.activeCanvasComfyTaskPolls.has(taskId)) return;
        const found = deps.findPendingTask(taskId);
        if(!found || found.pending.savePending || found.pending.taskLost) return;
        deps.activeCanvasComfyTaskPolls.add(taskId);
        found.pending.queryPaused = false;
        found.pending.error = '';
        deps.refreshRunNodes(deps.nodes.find(node => node.id === found.pending.run?.node?.id), found.out);
        try {
            const result = await deps.waitCanvasComfyTaskResult(taskId);
            deps.completeCanvasComfyTask(taskId, result);
        } catch(error){
            const current = deps.findPendingTask(taskId);
            if(!current) return;
            if(error.queryPaused){
                current.pending.queryPaused = true;
                current.pending.error = error.message || '暂时无法查询原任务';
            } else if(error.restartLost){
                current.pending.failed = true;
                current.pending.taskLost = true;
                current.pending.error = `${error.message}；远端是否仍在生成未知，请勿直接重复提交。`;
            } else {
                current.out._pending = (current.out._pending || []).filter(item => item !== current.pending);
                const gen = deps.nodes.find(node => node.id === current.pending.run?.node?.id);
                if(gen){ gen.runStatus = 'failed'; gen.runError = error.message || deps.actionFailed('canvas.comfyGenerate'); }
            }
            deps.refreshRunNodes(deps.nodes.find(node => node.id === current.pending.run?.node?.id), current.out);
            deps.scheduleSave();
        } finally {
            deps.activeCanvasComfyTaskPolls.delete(taskId);
        }
    }

    async function pollCanvasRunningHubTask(deps, taskId, options={}){
        if(!taskId || deps.activeCanvasTaskPolls.has(taskId)) return 'running';
        deps.activeCanvasTaskPolls.add(taskId);
        try {
            while(true){
                const found=deps.findPendingTask(taskId);
                if(!found) return 'missing';
                if(found.pending.savePending) return 'paused';
                let response;
                try{
                    response=await deps.fetch(`/api/runninghub/query?taskId=${encodeURIComponent(taskId)}&useWallet=${options.useWallet?'1':'0'}`);
                    if(!response.ok)throw new Error(await deps.responseErrorMessage(response,deps.tr('canvas.rhFailed')));
                    const json=await response.json();
                    if(json.success===false)throw new Error(json.detail||json.error||deps.tr('canvas.rhFailed'));
                    const data=json.data||json;
                    if(data.status==='SUCCESS'){
                        const outputs=data.urls||[];
                        if(!outputs.length)throw new Error(deps.tr('canvas.rhOutputsEmpty'));
                        const meta=deps.collectRunMeta(found.out,found.pending.id);
                        found.out._pending=(found.out._pending||[]).filter(item=>item.id!==found.pending.id);
                        deps.appendOutputImages(found.out,outputs,found.pending.run?.refs?.[0],[meta]);
                        const node=deps.nodes.find(item=>item.id===found.pending.run?.node?.id);
                        deps.mergeGeneratedOutputs(node,outputs,Boolean(found.pending.appendGenerated));
                        if(node){node.runStatus='done';node.runError='';node.running=false;if(node.assistantNativeRun?.taskIds?.includes(taskId) && node.assistantNativeRun.actionId===found.pending.assistantNativeActionId && node.assistantNativeRun.inputHash===found.pending.assistantInputHash && node.assistantNativeRun.outputNodeId===found.out.id){node.assistantNativeRun.resultUrls=[...outputs];node.assistantNativeRun.status='succeeded';}}
                        deps.addGenerationLog({run:found.pending.run||{},outputs,runMs:meta.runMs||0});
                        deps.refreshRunNodes(node,found.out);deps.scheduleSave();return 'succeeded';
                    }
                    if(data.status==='FAILED'){
                        found.pending.failed=true;found.pending.queryPaused=false;found.pending.error=data.failReason||deps.tr('canvas.rhFailed');
                        const node=deps.nodes.find(item=>item.id===found.pending.run?.node?.id);
                        if(node){node.runStatus='failed';node.runError=found.pending.error;node.running=false;}
                        deps.refreshRunNodes(node,found.out);deps.scheduleSave();return 'failed';
                    }
                }catch(error){
                    const current=deps.findPendingTask(taskId);
                    if(current){current.pending.queryPaused=true;current.pending.queryRecoverable=true;current.pending.error=error.message||deps.tr('canvas.rhFailed');const node=deps.nodes.find(item=>item.id===current.pending.run?.node?.id);if(node){node.runStatus='query-paused';node.running=false;}deps.refreshRunNodes(node,current.out);deps.scheduleSave();}
                    return 'paused';
                }
                await deps.sleep(2500);
            }
        } finally { deps.activeCanvasTaskPolls.delete(taskId); }
    }

    async function pollCanvasImageTask(deps, taskId, options={}){
        if(!taskId) return 'failed';
        if(deps.activeCanvasTaskPolls.has(taskId)) return 'running';
        deps.activeCanvasTaskPolls.add(taskId);
        let queryFailures = 0;
        try {
            while(true){
                const found = deps.findPendingTask(taskId);
                if(!found) return 'missing';
                if(found.pending.savePending) return 'paused';
                if(found.pending.taskLost) return 'failed';
                const cascadeTargetId = String(options?.cascadeTargetId || found?.pending?.cascadeTargetId || '');
                if(cascadeTargetId) deps.ensureCascadeActive(cascadeTargetId);
                if(found.pending.queryPaused){
                    found.pending.queryPaused = false;
                    found.pending.error = '';
                    deps.refreshRunNodes(deps.nodes.find(n => n.id === found.pending.run?.node?.id), found.out);
                    deps.scheduleSave();
                }
                let res;
                try {
                    res = await deps.cascadeFetch(`/api/canvas-image-tasks/${encodeURIComponent(taskId)}`, {}, {cascadeTargetId});
                    if(res.status === 408 || res.status === 429 || res.status >= 500){
                        const error = new Error(await deps.responseErrorMessage(res, deps.tr('canvas.generationFailed')));
                        error.retryableQuery = true;
                        throw error;
                    }
                } catch(error){
                    if(deps.isCascadeAbortError(error)) throw error;
                    if(!error.retryableQuery && error.name !== 'TypeError') throw error;
                    if(queryFailures < 3){
                        await deps.sleep(1000 * (2 ** queryFailures++));
                        continue;
                    }
                    // Keep the accepted task so refresh or the query button can resume GETs.
                    const current = deps.findPendingTask(taskId);
                    if(!current) return 'missing';
                    current.pending.queryPaused = true;
                    current.pending.queryRecoverable = true;
                    current.pending.error = deps.normalizeCanvasTaskError(error, deps.tr('canvas.generationFailed'));
                    current.pending.cascadeTargetId = '';
                    const gen = deps.nodes.find(n => n.id === current.pending.run?.node?.id);
                    if(gen){ gen.running = false; gen.runStatus = 'query-paused'; }
                    deps.refreshRunNodes(gen, current.out);
                    deps.scheduleSave();
                    return cascadeTargetId ? 'aborted' : 'paused';
                }
                queryFailures = 0;
                if(!res.ok){
                    if(res.status === 404) throw new Error(deps.cascadeBackendRestartMessage());
                    throw new Error(await deps.responseErrorMessage(res, deps.tr('canvas.generationFailed')));
                }
                const data = await res.json();
                if(found.pending.assistantCatalogImage)deps.validateCanvasAssistantCatalogTask(found.pending,data);
                if(data.status === 'succeeded'){
                    deps.completeCanvasImageTask(taskId, data.result || {});
                    return 'succeeded';
                }
                if(data.status === 'unknown'){
                    const error = new Error(data.error || '本地任务记录已失效，远端状态未知，请勿直接重新提交');
                    error.restartLost = true;
                    error.taskLost = true;
                    error.remoteRefreshable = Boolean(data.upstream_task_id);
                    error.taskData = data;
                    throw error;
                }
                if(data.status === 'failed'){
                    deps.failCanvasImageTask(taskId, data.error || deps.tr('canvas.generationFailed'), data);
                    return 'failed';
                }
                await deps.sleep(1800);
            }
        } catch(err) {
            const message = deps.normalizeCanvasTaskError(err, deps.tr('canvas.generationFailed'));
            if(deps.isCascadeAbortError(err)) return 'aborted';
            if(err.restartLost || err.taskLost){
                const current = deps.findPendingTask(taskId);
                if(current){
                    const lostMessage = `${message}；远端是否仍在生成未知，请勿直接重复提交。`;
                    current.pending.failed = true;
                    current.pending.taskLost = true;
                    current.pending.queryPaused = false;
                    current.pending.querying = false;
                    current.pending.queryRecoverable = true;
                    current.pending.canvasTaskStatus = 'unknown';
                    current.pending.remoteRefreshable = Boolean(err.remoteRefreshable || err.taskData?.upstream_task_id);
                    current.pending.error = lostMessage;
                    const gen = deps.nodes.find(n => n.id === current.pending.run?.node?.id);
                    if(gen){
                        gen.running = false;
                        gen.runStatus = 'task-lost';
                        gen.runError = lostMessage;
                    }
                    deps.refreshRunNodes(gen, current.out);
                    deps.scheduleSave();
                }
                return 'failed';
            }
            deps.failCanvasImageTask(taskId, message);
            return 'failed';
        } finally {
            deps.activeCanvasTaskPolls.delete(taskId);
        }
    }

    function resumeCanvasImageTasks(deps){
        deps.resumeCanvasDepthCaptureTasks();
        deps.nodes.filter(n => n._directPending?.length).forEach(node => deps.materializeCanvasDirectTasks(node, node._directPending));
        deps.nodes.filter(n => n.type === 'output').forEach(out => {
            (out._pending || []).forEach(p => {
                if(p.canvasTaskType === 'online-image' && p.canvasTaskId && !p.failed && !p.savePending) deps.pollCanvasImageTask(p.canvasTaskId, {cascadeTargetId:p.cascadeTargetId || ''});
                if(p.canvasTaskType === 'comfy' && p.canvasTaskId && !p.failed && !p.savePending) deps.pollCanvasComfyTask(p.canvasTaskId);
                if(p.canvasTaskType === 'video' && p.canvasTaskId && !p.failed && !p.savePending) deps.pollCanvasVideoTask(p.canvasTaskId, {cascadeTargetId:p.cascadeTargetId || ''});
                if(p.canvasTaskType === 'runninghub' && p.canvasTaskId && !p.failed && !p.savePending) deps.pollCanvasRunningHubTask(p.canvasTaskId, {useWallet:Boolean(p.useWallet)});
            });
        });
    }

    async function resumeSmartPendingNode(deps, node, logContext={}, onlyTaskId=''){
        const tasks = deps.smartPendingTasks(node);
        if(!node || !tasks.length) return;
        const logTaskFailure = (message, task) => {
            if(!logContext?.run || !message) return;
            const runMs = Math.max(0, deps.nowMs() - Number(logContext.runLogStart || deps.nowMs()));
            deps.addSmartGenerationLog({
                run:logContext.run,
                outputs:[],
                runMs,
                error:message
            });
        };
        node.pending = Math.max(tasks.length, Number(node.pending || 0) || tasks.length);
        node.running = false;
        deps.render();
        const failures = [];
        await Promise.all(tasks.map(async task => {
            if((onlyTaskId && task.taskId !== onlyTaskId) || task.querying || task.savePending || task.taskLost
                || (task.failed && task.recoverTaskId) || (task.kind === 'comfy' && deps.activeSmartComfyTaskPolls.has(task.taskId))) return;
            task.querying = true;
            deps.render();
            try {
                if(task.assistantSourceNodeId)deps.validateSmartGroupPendingOutput(node,task);
                const result = task.kind === 'comfy'
                    ? await deps.waitSmartComfyTaskResult(task.taskId,task.assistantBinding)
                    : task.kind === 'video'
                        ? await deps.pollSmartVideoCanvasTask(task.taskId, {forceRefresh:Boolean(task.remoteRefreshable)})
                        : await deps.pollSmartCanvasTask(task.taskId,task.assistantBinding);
                if(task.assistantSourceNodeId)deps.validateSmartGroupPendingOutput(node,task);
                const outputs = deps.resultMediaUrls(result?.image_items?.length ? result.image_items : (result?.images?.length ? result.images : result));
                {
                    const kind = task.kind === 'comfy' ? deps.mediaKindForUrls(outputs, task.outputKind || 'image') : task.kind || 'image';
                    deps.finalizeSmartPendingTask(node, task.taskId, outputs, kind);
                    if(task.assistantLoopStepKey){
                        const owner=deps.nodes.find(n=>n.id===task.assistantSourceNodeId&&n.type==='smart-loop'),entry=owner?.assistantNativeRun?.slots?.[task.assistantLoopStepKey];
                        if(entry && outputs.length){entry.status='succeeded';entry.resultUrls=(node.images||[]).map(i=>i.url);}
                    }
                }
                deps.render();
                deps.scheduleSave();
            } catch(e) {
    
                if(e && e.queryPaused){
                    task.queryPaused = true;
                    task.error = e.message || '暂时无法查询任务';
                    deps.toast('查询暂停，可稍后用原任务查询结果');
                    return;
                }
                if(e && e.jimengPending && e.submitId){
                    node.pendingTasks = deps.smartPendingTasks(node).filter(item => item.taskId !== task.taskId);
                    deps.setNodeJimengPending(node, e);
                    deps.render();
                    deps.scheduleSave();
                    return;
                }
                if(e && e.taskLost && task.kind !== 'video'){
                    task.failed = true;
                    task.taskLost = true;
                    task.queryPaused = false;
                    task.remoteRefreshable = Boolean(e.remoteRefreshable || e.taskData?.upstream_task_id);
                    task.error = `${e.message || '本地任务记录已失效'}；远端是否仍在生成未知，请勿直接重复提交。`;
                    node.taskFailureNotice = task.error;
                    node.running = false;
                    node.pending = Math.max(1, deps.smartPendingTasks(node).length);
                    logTaskFailure(task.error, task);
                    deps.render();
                    deps.scheduleSave();
                    return;
                }
                if(e && (e.videoTaskUnknown || e.taskLost) && task.kind === 'video'){
                    task.failed = true;
                    task.queryPaused = !e.taskLost;
                    task.taskLost = Boolean(e.taskLost);
                    task.remoteRefreshable = Boolean(e.remoteRefreshable);
                    task.error = e.message || '视频任务状态未知，请勿直接重新提交';
                    node.videoTaskStatus = task.taskLost ? 'unknown' : 'query-paused';
                    node.videoTaskError = task.error;
                    node.running = false;
                    node.pending = Math.max(1, deps.smartPendingTasks(node).length);
                    logTaskFailure(task.error, task);
                    deps.render();
                    deps.scheduleSave();
                    return;
                }
                if(e && e.imageTaskRecover && e.recoverTaskId){
                    task.failed = true;
                    delete task.queryPaused;
                    task.querying = false;
                    task.recoverTaskId = e.recoverTaskId;
                    task.providerId = e.providerId || task.providerId || deps.providerIdForSmartTask(node, task);
                    task.error = e.message || deps.tr('smart.errRunFailed');
                    node.running = false;
                    node.pending = Math.max(1, deps.smartPendingTasks(node).length);
                    logTaskFailure(task.error, task);
                    deps.toast('任务未丢失，可稍后手动查询结果');
                    deps.render();
                    deps.scheduleSave();
                    return;
                }
                node.pendingTasks = deps.smartPendingTasks(node).filter(item => item.taskId !== task.taskId);
                node.pending = Math.max(0, Number(node.pending || 0) - 1);
                if(e?.restartLost){
                    node.taskFailureNotice = '本地任务记录已失效，可能服务已重启或任务过期；远端是否仍在生成未知，请勿直接重复提交。';
                }
                if(!node.pending && deps.smartPendingTasks(node).length === 0){
                    delete node.pendingTasks;
                    node.running = false;
                    if(!(node.images || []).length){
                        delete node.w;
                        delete node.h;
                    }
                }
                failures.push(e);
                logTaskFailure(e.message || deps.tr('smart.errRunFailed'), task);
                if(e && typeof e === 'object') e.smartGenerationLogged = true;
                deps.toast((e.message || deps.tr('smart.errRunFailed')).slice(0, 160));
                deps.render();
                deps.scheduleSave();
            } finally {
                task.querying = false;
                deps.render();
                deps.scheduleSave();
            }
        }));
        if(failures.length && !(node.images || []).length && !deps.smartRecoverableImageTask(node)){
            throw failures[0];
        }
    }

    function resumeSmartPendingTasks(deps){
        deps.resumeSmartDepthCaptureTasks();
        deps.nodes.filter(node => deps.smartPendingTasks(node).length).forEach(node => {
            deps.smartPendingTasks(node).forEach(task => { task.querying = false; });
            resumeSmartPendingNode(deps, node).catch(() => {}); // The node handler already displays and saves terminal failures.
        });
    }

    const api={pollCanvasVideoTask, pollCanvasComfyTask, pollCanvasRunningHubTask, pollCanvasImageTask, resumeCanvasImageTasks, resumeSmartPendingNode, resumeSmartPendingTasks};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.CanvasTaskRuntime=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
