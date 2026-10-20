/* Task HTTP submission and waiting. Editors own nodes, result application and poll registries. */
(function(root){
    'use strict';

    async function createCanvasVideoTask(deps, payload, pending, options={}) {
        const {canvasVideoTaskIdForPending, fetch, responseErrorMessage}=deps;
        const taskId = canvasVideoTaskIdForPending(pending);
        if(options.beforeSubmit)await options.beforeSubmit();
        if(options.persistStarted&&!await options.persistStarted())throw new Error('视频提交开始状态未保存，请先保存；请求未提交');
        if(options.beforeSubmit)await options.beforeSubmit();
        if(options.validate)options.validate();
        if(options.onSubmitting)options.onSubmitting();
        const response = await fetch('/api/canvas-video-tasks', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({...payload, client_task_id:taskId})
        });
        if(!response.ok) throw new Error(await responseErrorMessage(response, '视频任务提交失败'));
        const task = await response.json();
        if(!task.task_id) throw new Error('视频任务未返回本地编号，未继续提交');
        if(options.validateAccepted)options.validateAccepted(task,taskId);
        if(options.onAccepted)await options.onAccepted(task);
        return task;
    }

    async function refreshCanvasImageTaskOnce(deps, taskId, options={}) {
        const {cascadeFetch, cascadeTargetIdFromOptions, responseErrorMessage}=deps;
        const cascadeTargetId = cascadeTargetIdFromOptions(options);
        const response = await cascadeFetch(`/api/canvas-image-tasks/${encodeURIComponent(taskId)}/refresh`, {
            method:'POST'
        }, {cascadeTargetId});
        if(!response.ok){
            const error = new Error(await responseErrorMessage(response, '图片任务刷新失败'));
            error.imageTaskRefreshUnavailable = response.status === 404 || response.status === 409;
            if(response.status === 408 || response.status === 429 || response.status >= 500){
                error.retryableQuery = true;
                error.queryPaused = true;
            }
            throw error;
        }
        return response.json();
    }

    async function refreshCanvasVideoTaskOnce(deps, taskId, options={}) {
        const {cascadeFetch, cascadeTargetIdFromOptions, responseErrorMessage}=deps;
        const cascadeTargetId = cascadeTargetIdFromOptions(options);
        const response = await cascadeFetch(`/api/canvas-video-tasks/${encodeURIComponent(taskId)}/refresh`, {
            method:'POST'
        }, {cascadeTargetId});
        if(!response.ok){
            const error = new Error(await responseErrorMessage(response, '视频任务刷新失败'));
            if(response.status === 404 || response.status === 409){
                error.taskLost = true;
                error.videoTaskRefreshUnavailable = true;
            } else if(response.status === 408 || response.status === 429 || response.status >= 500){
                error.retryableQuery = true;
                error.queryPaused = true;
            }
            throw error;
        }
        return response.json();
    }

    async function waitCanvasVideoTaskResult(deps, taskId, options={}) {
        const {cascadeFetch, cascadeTargetIdFromOptions, ensureCascadeActive, findPendingTask, isCascadeAbortError, responseErrorMessage, sleep}=deps;
        if(!taskId) throw new Error('视频任务缺少本地编号');
        let queryFailures = 0;
        let refreshAttempted = false;
        const original=findPendingTask(taskId),pending=original?.pending;
        const validateTask=task=>{
            if(!pending?.assistantNativeActionId)return;
            const binding={task_id:taskId,canvas_id:pending.assistantCanvasId,node_id:pending.run?.node?.id,assistant_action_id:pending.assistantNativeActionId,input_hash:pending.assistantInputHash,provider_id:pending.providerId,model:pending.model};
            if(Object.entries(binding).some(([k,v])=>!v||task?.[k]!==v))throw new Error('原视频查询返回的任务归属、输入或模型不匹配');
        };
        const consumeRefreshResult = refreshed => {
            validateTask(refreshed);
            if(refreshed?.status === 'succeeded') return {done:true, result:refreshed.result || {}};
            if(refreshed?.status === 'failed'){
                const error = new Error(refreshed.error || '视频生成失败');
                error.videoTaskFailed = true;
                throw error;
            }
            if(refreshed?.status === 'unknown'){
                const canRefresh = refreshed?.remote?.query_supported === true && Boolean(refreshed?.remote?.task_id);
                const error = new Error(refreshed.error || '视频任务状态未知，请稍后再次查询');
                error.videoTaskUnknown = true;
                error.remoteRefreshable = canRefresh;
                error.taskLost = !canRefresh;
                error.queryPaused = canRefresh;
                throw error;
            }
            return {done:false};
        };
        if(options.forceRefresh){
            refreshAttempted = true;
            const refreshed = await refreshCanvasVideoTaskOnce(deps, taskId, options);
            const state = consumeRefreshResult(refreshed);
            if(state.done) return state.result;
        }
        while(true){
            const cascadeTargetId = cascadeTargetIdFromOptions(options);
            if(cascadeTargetId) ensureCascadeActive(cascadeTargetId);
            let response;
            try {
                response = await cascadeFetch(`/api/canvas-video-tasks/${encodeURIComponent(taskId)}`, {}, {cascadeTargetId});
                if(response.status === 408 || response.status === 429 || response.status >= 500){
                    const error = new Error(await responseErrorMessage(response, '视频任务查询失败'));
                    error.retryableQuery = true;
                    throw error;
                }
            } catch(error){
                if(isCascadeAbortError(error)) throw error;
                if((error.retryableQuery || error.name === 'TypeError') && queryFailures < 3){
                    await sleep(1000 * (2 ** queryFailures++));
                    continue;
                }
                if(error.retryableQuery || error.name === 'TypeError') error.queryPaused = true;
                throw error;
            }
            queryFailures = 0;
            if(!response.ok){
                const error = new Error(await responseErrorMessage(response, '视频任务查询失败'));
                error.taskLost = response.status === 404;
                throw error;
            }
            const task = await response.json();
            validateTask(task);
            if(task.status === 'succeeded') return task.result || {};
            if(task.status === 'failed'){
                const error = new Error(task.error || '视频生成失败');
                error.videoTaskFailed = true;
                throw error;
            }
            if(task.status === 'unknown'){
                const canRefresh = task?.remote?.query_supported === true && Boolean(task?.remote?.task_id);
                if(!canRefresh){
                    const error = new Error(task.error || '视频任务状态未知，请勿直接重新提交');
                    error.videoTaskUnknown = true;
                    error.remoteRefreshable = false;
                    error.taskLost = true;
                    throw error;
                }
                if(!refreshAttempted){
                    refreshAttempted = true;
                    let refreshed;
                    try {
                        refreshed = await refreshCanvasVideoTaskOnce(deps, taskId, options);
                    } catch(error){
                        if(isCascadeAbortError(error)) throw error;
                        error.remoteRefreshable = canRefresh && !error.videoTaskRefreshUnavailable;
                        if(error.retryableQuery || error.name === 'TypeError') error.queryPaused = true;
                        throw error;
                    }
                    const state = consumeRefreshResult(refreshed);
                    if(state.done) return state.result;
                    continue;
                }
                const error = new Error(task.error || '视频任务状态未知，请勿直接重新提交');
                error.videoTaskUnknown = true;
                error.remoteRefreshable = canRefresh;
                error.taskLost = true;
                throw error;
            }
            await sleep(1800);
        }
    }

    async function createCanvasImageTask(deps, payload, options={}) {
        const {cascadeFetch, responseErrorMessage, tr}=deps;
        if(options.acceptedTask?.task_id) return options.acceptedTask;
        if(options.beforeSubmit){
            try{await options.beforeSubmit();}
            catch(reason){const error=reason instanceof Error?reason:new Error(String(reason));error.submissionKnownRejected=true;throw error;}
        }
        const res = await cascadeFetch('/api/canvas-image-tasks', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify(payload)
        }, options);
        if(!res.ok){
            const error = new Error(await responseErrorMessage(res, tr('canvas.generationFailed')));
            error.submissionKnownRejected = res.status >= 400 && res.status < 500 && res.status !== 408;
            throw error;
        }
        const task = await res.json();
        if(!task?.task_id) throw new Error('任务提交未返回编号，受理状态未知');
        return task;
    }

    async function submitCanvasImageTaskBatch(deps, count, payload, options={}) {
        const {cascadeAbortError, cascadeContextFor, cascadeFetch, cascadeTargetIdFromOptions, responseErrorMessage, tr}=deps;
        const cascadeTargetId = cascadeTargetIdFromOptions(options);
        const cascadeContext = cascadeContextFor(cascadeTargetId);
        if(cascadeContext?.submissionIncomplete){
            throw cascadeAbortError('本次一键运行有任务未完整受理，已停止后续提交');
        }
        const settled = await Promise.allSettled(Array.from({length:count}, () => createCanvasImageTask(deps, payload, options)));
        const taskInfos = settled.filter(item => item.status === 'fulfilled').map(item => item.value);
        const rejected = settled.filter(item => item.status === 'rejected');
        const knownRejected = rejected.filter(item => item.reason?.submissionKnownRejected).length;
        const unknownCount = rejected.length - knownRejected;
        if(rejected.length && cascadeContext) cascadeContext.submissionIncomplete = true;
        const issues = [];
        if(knownRejected) issues.push(`${knownRejected} 项被明确拒绝`);
        if(unknownCount) issues.push(`${unknownCount} 项未收到可靠响应，可能已受理`);
        const advice = taskInfos.length
            ? '已取得编号的任务会继续查询，请勿直接重试整批。'
            : unknownCount ? '请勿直接重试整批。' : '请检查失败原因后重试。';
        const warning = rejected.length
            ? `本次请求 ${count} 项，仅取得 ${taskInfos.length} 个任务编号；${issues.join('，')}。${advice}`
            : '';
        if(!taskInfos.length){
            const error = new Error(warning || tr('canvas.generationFailed'));
            error.submissionUnknown = unknownCount > 0;
            error.submissionKnownRejected = unknownCount === 0;
            throw error;
        }
        return {taskInfos, warning, unknownCount};
    }

    async function createCanvasComfyTask(deps, payload, options={}) {
        const {actionFailed, cascadeFetch, responseErrorMessage}=deps;
        const res = await cascadeFetch('/api/canvas-comfy-tasks', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify(payload)
        }, options);
        if(!res.ok) throw new Error(await responseErrorMessage(res, actionFailed('canvas.comfyGenerate')));
        return res.json();
    }

    async function waitCanvasComfyTaskResult(deps, taskId, options={}) {
        const {actionFailed, cascadeBackendRestartMessage, cascadeFetch, cascadeTargetIdFromOptions, ensureCascadeActive, isCascadeAbortError, responseErrorMessage, sleep}=deps;
        if(!taskId) throw new Error(actionFailed('canvas.comfyGenerate'));
        let queryFailures = 0;
        while(true){
            const cascadeTargetId = cascadeTargetIdFromOptions(options);
            if(cascadeTargetId) ensureCascadeActive(cascadeTargetId);
            let res;
            try {
                res = await cascadeFetch(`/api/canvas-comfy-tasks/${encodeURIComponent(taskId)}`, {}, {cascadeTargetId});
                if(res.status === 408 || res.status === 429 || res.status >= 500){
                    const error = new Error(await responseErrorMessage(res, actionFailed('canvas.comfyGenerate')));
                    error.retryableQuery = true;
                    throw error;
                }
            } catch(error){
                if(isCascadeAbortError(error)) throw error;
                if((error.retryableQuery || error.name === 'TypeError') && queryFailures < 3){
                    await sleep(1000 * (2 ** queryFailures++));
                    continue;
                }
                if(error.retryableQuery || error.name === 'TypeError') error.queryPaused = true;
                throw error;
            }
            queryFailures = 0;
            if(!res.ok){
                if(res.status === 404){
                    const error = new Error(cascadeBackendRestartMessage());
                    error.restartLost = true;
                    throw error;
                }
                throw new Error(await responseErrorMessage(res, actionFailed('canvas.comfyGenerate')));
            }
            const data = await res.json();
    
            if(data.status === 'succeeded') return data.result || {};
            if(data.status === 'unknown'){
                const error = new Error(data.error || '本地任务记录已失效，远端状态未知，请勿直接重新提交');
                error.restartLost = true;
                error.taskLost = true;
                error.remoteRefreshable = Boolean(data.upstream_task_id);
                error.taskData = data;
                throw error;
            }
            if(data.status === 'failed') throw new Error(data.error || actionFailed('canvas.comfyGenerate'));
            await sleep(1600);
        }
    }

    async function waitCanvasImageTaskResult(deps, taskId, options={}) {
        const {cascadeBackendRestartMessage, cascadeFetch, cascadeTargetIdFromOptions, ensureCascadeActive, isCascadeAbortError, responseErrorMessage, sleep, tr}=deps;
        if(!taskId) throw new Error(tr('canvas.generationFailed'));
        let queryFailures = 0;
        while(true){
            const cascadeTargetId = cascadeTargetIdFromOptions(options);
            if(cascadeTargetId) ensureCascadeActive(cascadeTargetId);
            let res;
            try {
                res = await cascadeFetch(`/api/canvas-image-tasks/${encodeURIComponent(taskId)}`, {}, {cascadeTargetId});
                if(res.status === 408 || res.status === 429 || res.status >= 500){
                    const error = new Error(await responseErrorMessage(res, tr('canvas.generationFailed')));
                    error.retryableQuery = true;
                    throw error;
                }
            } catch(error){
                if(isCascadeAbortError(error)) throw error;
                if((error.retryableQuery || error.name === 'TypeError') && queryFailures < 3){
                    await sleep(1000 * (2 ** queryFailures++));
                    continue;
                }
                if(error.retryableQuery || error.name === 'TypeError') error.queryPaused = true;
                throw error;
            }
            queryFailures = 0;
            if(!res.ok){
                if(res.status === 404) throw new Error(cascadeBackendRestartMessage());
                throw new Error(await responseErrorMessage(res, tr('canvas.generationFailed')));
            }
            const data = await res.json();
            if(data.status === 'succeeded') return data.result || {};
            if(data.status === 'unknown'){
                const error = new Error(data.error || '本地任务记录已失效，远端状态未知，请勿直接重新提交');
                error.restartLost = true;
                error.taskLost = true;
                error.taskData = data;
                throw error;
            }
            if(data.status === 'failed'){
                const error = new Error(data.error || tr('canvas.generationFailed'));
                error.taskData = data;
                throw error;
            }
            await sleep(1800);
        }
    }

    async function createSmartComfyTask(deps, payload) {
        const {fetch, smartResponseErrorMessage, tr}=deps;
        const res = await fetch('/api/canvas-comfy-tasks', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify(payload)
        });
        if(!res.ok) throw new Error(await smartResponseErrorMessage(res, tr('smart.errRunFailed')));
        return res.json();
    }

    async function waitSmartComfyTaskResult(deps, taskId, binding=null) {
        const {fetch, resultMediaUrls, sleep, smartResponseErrorMessage, tr}=deps;
        if(!taskId) throw new Error(tr('smart.errRunFailed'));
        let queryFailures = 0;
        while(true){
            let res;
            try {
                res = await fetch(`/api/canvas-comfy-tasks/${encodeURIComponent(taskId)}`);
                if(res.status === 408 || res.status === 429 || res.status >= 500){
                    const error = new Error(await smartResponseErrorMessage(res, tr('smart.errRunFailed')));
                    error.retryableQuery = true;
                    throw error;
                }
            } catch(error){
                if((error.retryableQuery || error.name === 'TypeError') && queryFailures < 3){
                    await sleep(1000 * (2 ** queryFailures++));
                    continue;
                }
                if(error.retryableQuery || error.name === 'TypeError') error.queryPaused = true;
                throw error;
            }
            queryFailures = 0;
            if(!res.ok){
                if(res.status === 404){
                    const error = new Error(tr('smart.comfyTaskRestart'));
                    error.restartLost = true;
                    if(binding) error.taskLost = true;
                    throw error;
                }
                throw new Error(await smartResponseErrorMessage(res, tr('smart.errRunFailed')));
            }
            const data = await res.json();
    
            const readyResult = data?.result || data?.outputs || data?.images || data?.videos || data?.audios || data?.texts;
            if(!binding && readyResult && resultMediaUrls(readyResult).length) return data.result || data;
            if(data.status === 'succeeded') return binding ? data : data.result || {};
            if(data.status === 'unknown'){
                const error = new Error(data.error || '本地任务记录已失效，远端状态未知，请勿直接重新提交');
                error.restartLost = true;
                error.taskLost = true;
                error.taskData = data;
                throw error;
            }
            if(['failed','cancelled','canceled'].includes(data.status)){
                const error=new Error(data.error || tr('smart.errRunFailed'));
                error.taskData=data;
                throw error;
            }
            await sleep(1600);
        }
    }

    async function refreshSmartVideoCanvasTaskOnce(deps, taskId) {
        const {fetch, responseErrorMessage}=deps;
        const response = await fetch(`/api/canvas-video-tasks/${encodeURIComponent(taskId)}/refresh`, {method:'POST'});
        if(!response.ok){
            const error = new Error(await responseErrorMessage(response, '视频任务刷新失败'));
            if(response.status === 404 || response.status === 409){
                error.taskLost = true;
                error.videoTaskRefreshUnavailable = true;
            } else if(response.status === 408 || response.status === 429 || response.status >= 500){
                error.retryableQuery = true;
                error.queryPaused = true;
            }
            throw error;
        }
        return response.json();
    }

    async function pollSmartVideoCanvasTask(deps, taskId, options={}) {
        const {fetch, responseErrorMessage, setTimeout}=deps;
        if(!taskId) throw new Error('视频任务缺少本地编号');
        let refreshAttempted = false;
        let queryFailures = 0;
        const consumeRefreshResult = refreshed => {
            if(refreshed?.status === 'succeeded') return {done:true, result:refreshed.result || {}};
            if(refreshed?.status === 'failed'){
                const error = new Error(refreshed.error || '视频生成失败');
                error.videoTaskFailed = true;
                throw error;
            }
            if(refreshed?.status === 'unknown'){
                const canRefresh = refreshed?.remote?.query_supported === true && Boolean(refreshed?.remote?.task_id);
                const error = new Error(refreshed.error || '视频任务状态未知，请稍后再次查询');
                error.videoTaskUnknown = true;
                error.remoteRefreshable = canRefresh;
                error.taskLost = !canRefresh;
                error.queryPaused = canRefresh;
                throw error;
            }
            return {done:false};
        };
        if(options.forceRefresh){
            refreshAttempted = true;
            const refreshed = await refreshSmartVideoCanvasTaskOnce(deps, taskId);
            const state = consumeRefreshResult(refreshed);
            if(state.done) return state.result;
        }
        for(let i = 0; i < 900; i++){
            await new Promise(resolve => setTimeout(resolve, queryFailures ? 1000 * (2 ** (queryFailures - 1)) : (i ? 1800 : 0)));
            let response;
            try {
                response = await fetch(`/api/canvas-video-tasks/${encodeURIComponent(taskId)}`);
                if(!response.ok){
                    const error = new Error(await responseErrorMessage(response, '视频任务查询失败'));
                    error.taskLost = response.status === 404;
                    error.retryableQuery = response.status === 408 || response.status === 429 || response.status >= 500;
                    throw error;
                }
                queryFailures = 0;
            } catch(error){
                if(error.retryableQuery || error.name === 'TypeError'){
                    if(++queryFailures <= 3) continue;
                    error.queryPaused = true;
                } else if(!error.taskLost){
                    error.queryPaused = true;
                }
                throw error;
            }
            const task = await response.json();
            if(task.status === 'succeeded') return task.result || {};
            if(task.status === 'failed'){
                const error = new Error(task.error || '视频生成失败');
                error.videoTaskFailed = true;
                throw error;
            }
            if(task.status === 'unknown'){
                const canRefresh = task?.remote?.query_supported === true && Boolean(task?.remote?.task_id);
                if(!canRefresh){
                    const error = new Error(task.error || '视频任务状态未知，请勿直接重新提交');
                    error.videoTaskUnknown = true;
                    error.remoteRefreshable = false;
                    error.taskLost = true;
                    throw error;
                }
                if(!refreshAttempted){
                    refreshAttempted = true;
                    let refreshed;
                    try {
                        refreshed = await refreshSmartVideoCanvasTaskOnce(deps, taskId);
                    } catch(error){
                        error.remoteRefreshable = canRefresh && !error.videoTaskRefreshUnavailable;
                        if(error.retryableQuery || error.name === 'TypeError') error.queryPaused = true;
                        throw error;
                    }
                    const state = consumeRefreshResult(refreshed);
                    if(state.done) return state.result;
                    continue;
                }
                const error = new Error(task.error || '视频任务状态未知，请勿直接重新提交');
                error.videoTaskUnknown = true;
                error.remoteRefreshable = canRefresh;
                error.taskLost = true;
                throw error;
            }
        }
        throw new Error('视频任务查询超时；远端状态未知，请勿直接重新提交');
    }

    async function waitSmartImageTask(deps, taskId, binding=null) {
        const {extractUpstreamTaskId, fetch, imageTaskRecover, jimengPending, setTimeout, tr}=deps;
        if(!taskId) throw new Error(tr('smart.errRunFailed'));
        let queryFailures = 0;
        for(let i = 0; i < 900; i++){
            await new Promise(resolve => setTimeout(resolve, queryFailures ? 1000 * (2 ** (queryFailures - 1)) : 2000));
            let task;
            try {
                const response = await fetch(`/api/canvas-image-tasks/${encodeURIComponent(taskId)}`);
                if(!response.ok){
                    const error = new Error(await response.text());
                    error.retryableQuery = response.status === 408 || response.status === 429 || response.status >= 500;
                    error.restartLost = response.status === 404;
                    throw error;
                }
                task = await response.json();
                queryFailures = 0;
            } catch(e){
                if(e.retryableQuery || e.name === 'TypeError'){
                    if(++queryFailures <= 3) continue;
                    e.queryPaused = true;
                }
                throw e;
            }
            if(binding && ((task.task_id||task.id)!==taskId || Object.entries(binding).some(([key,value])=>task[key]!==value))){
                const error=new Error('原图片任务的画布、分组、动作、输入或模型归属不匹配；保留原编号');error.queryPaused=true;throw error;
            }
            if(task.status === 'succeeded') return task.result || {};
            if(task.status === 'jimeng_pending') throw jimengPending({submitId:task.submit_id, kind:task.kind, queueInfo:task.queue_info, message:task.message});
            if(task.status === 'unknown'){
                const error = new Error(task.error || '本地任务记录已失效，远端状态未知，请勿直接重新提交');
                error.restartLost = true;
                error.taskLost = true;
                error.remoteRefreshable = Boolean(task.upstream_task_id);
                error.taskData = task;
                throw error;
            }
            if(task.status === 'failed'){
                const recoverTaskId = task.upstream_task_id || extractUpstreamTaskId(task.error || '');
                if(recoverTaskId) throw imageTaskRecover({taskId, recoverTaskId, providerId:task.provider_id, kind:'image', message:task.error || tr('smart.errRunFailed')});
                throw new Error(task.error || tr('smart.errRunFailed'));
            }
        }
        throw new Error(tr('smart.errRunTimeout'));
    }

    const api={createCanvasVideoTask, refreshCanvasImageTaskOnce, refreshCanvasVideoTaskOnce, waitCanvasVideoTaskResult, createCanvasImageTask, submitCanvasImageTaskBatch, createCanvasComfyTask, waitCanvasComfyTaskResult, waitCanvasImageTaskResult, createSmartComfyTask, waitSmartComfyTaskResult, refreshSmartVideoCanvasTaskOnce, pollSmartVideoCanvasTask, waitSmartImageTask};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.CanvasTaskTransport=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
