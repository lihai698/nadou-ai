/* Task recovery controls: smart-task-recovery-control. Host supplies live state and effects. */
(function(root){
    'use strict';

function smartPendingTasks(deps, node){
    if(!node || !Array.isArray(node.pendingTasks)) return [];
    return node.pendingTasks.filter(task => task && task.taskId);
}

function extractUpstreamTaskId(deps, text){
    const match = String(text || '').match(/(?:task_id|taskId|task id)\s*[=:：]\s*([A-Za-z0-9_.:-]+)/i);
    return match ? match[1] : '';
}

function jimengQueueText(deps, queueInfo){
    const qi = queueInfo || {};
    const idx = qi.queue_idx;
    const len = qi.queue_length;
    if(idx != null && len != null) return `即梦云端排队中（第 ${idx}/${len} 位）`;
    return '即梦云端生成中';
}

function setNodeJimengPending(deps, node, signal){
    if(!node || !signal || !signal.submitId) return;
    const prev = node.jimengPending && node.jimengPending.submitId === signal.submitId ? node.jimengPending : null;
    node.jimengPending = {
        submitId:signal.submitId,
        kind:signal.kind || (prev && prev.kind) || 'image',
        queueInfo:signal.queueInfo || (prev && prev.queueInfo) || {},
        message:signal.message || (prev && prev.message) || '',
        startedAt:(prev && prev.startedAt) || deps.nowMs(),
        updatedAt:deps.nowMs(),
        querying:prev ? prev.querying : false
    };
    node.running = false;
    node.pending = 0;
    delete node.pendingTasks;
    if(!node.runStartedAt) node.runStartedAt = node.jimengPending.startedAt;
    delete node.runFinishedAt;
    delete node.runElapsedMs;
    node.runTimerHidden = false;
    deps.render();
    deps.scheduleSave();
    startJimengPoll(deps, node);
}

function handleJimengPendingSignal(deps, node, e){
    if(!(e && e.jimengPending && e.submitId)) return false;
    setNodeJimengPending(deps, node, e);
    deps.toast((e.message || jimengQueueText(deps, e.queueInfo)).slice(0, 160));
    return true;
}

function finalizeJimengPending(deps, node, urls, kind='image'){
    if(!node) return false;
    const ext = kind === 'video' ? 'mp4' : kind === 'audio' ? 'mp3' : kind === 'text' ? 'txt' : 'png';
    const additions = (urls || []).map((item, i) => {
        const url = typeof item === 'string' ? item : item?.url || '';
        const itemKind = (typeof item === 'object' && item.kind) || kind;
        return deps.stripImageGenerationMeta(deps.copyMediaSizeFields(item, {url, name:(typeof item === 'object' && item.name) || `output-${i + 1}.${ext}`, kind:itemKind, generatedResult:true}));
    }).filter(item => item.url);
    if(!additions.length) return false;
    delete node.jimengPending;
    deps.replaceOutputsToNodeWithHistory(node, additions, kind, null, {skipShift:true});
    node.running = false;
    node.pending = 0;
    node.runFinishedAt = deps.nowMs();
    if(!node.runStartedAt) node.runStartedAt = node.runFinishedAt;
    node.runElapsedMs = Math.max(0, node.runFinishedAt - Number(node.runStartedAt || node.runFinishedAt));
    node.runTimerHidden = false;
    deps.render();
    deps.scheduleSave();
    return true;
}

function applyJimengQueryResult(deps, node, data){
    if(!node || !data) return false;
    if(data.status === 'succeeded'){
        const kind = data.kind || node.jimengPending?.kind || 'image';
        return finalizeJimengPending(deps, node, data.urls || [], kind);
    }
    if(data.status === 'failed'){
        delete node.jimengPending;
        node.running = false;
        node.pending = 0;
        deps.toast((data.error || '即梦任务失败').slice(0, 160));
        deps.render();
        deps.scheduleSave();
        return true;
    }
    if(node.jimengPending){
        node.jimengPending.queueInfo = data.queue_info || node.jimengPending.queueInfo || {};
        node.jimengPending.message = data.message || node.jimengPending.message || '';
        node.jimengPending.updatedAt = deps.nowMs();
    }
    deps.render();
    deps.scheduleSave();
    return false;
}

async function fetchJimengQuery(deps, submitId, kind){
    return deps.fetch('/api/jimeng/query-media', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({submit_id:submitId, kind:kind || 'image'})
    }).then(async r => { if(!r.ok) throw new Error(await r.text()); return r.json(); });
}

async function queryJimengNow(deps, nodeId){
    const node = deps.nodes.find(n => n.id === nodeId);
    if(!node || !node.jimengPending || !node.jimengPending.submitId) return;
    if(node.jimengPending.querying) return;
    const submitId = node.jimengPending.submitId;
    const kind = node.jimengPending.kind || 'image';
    node.jimengPending.querying = true;
    deps.render();
    try {
        const data = await fetchJimengQuery(deps, submitId, kind);
        applyJimengQueryResult(deps, node, data);
    } catch(e){
        deps.toast((e.message || '查询失败').slice(0, 160));
    } finally {
        if(node.jimengPending) node.jimengPending.querying = false;
        deps.render();
    }
}

function providerIdForSmartTask(deps, node, task){
    return task?.providerId || node?.runSettings?.provider_id || deps.settings.provider_id || 'comfly';
}

async function fetchImageTaskQuery(deps, providerId, taskId){
    return deps.fetch('/api/image-task-query', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({provider_id:providerId || 'comfly', task_id:taskId})
    }).then(async r => {
        if(!r.ok) throw new Error(await r.text());
        return r.json();
    });
}

async function querySmartImageTaskNow(deps, nodeId, localTaskId){
    const node = deps.nodes.find(n => n.id === nodeId);
    if(!node) return;
    const task = smartPendingTasks(deps, node).find(item => item.taskId === localTaskId) || deps.smartRecoverableImageTask(node);
    if(!task || task.querying) return;
    if(task.taskLost){
        if(task.kind === 'video' && task.remoteRefreshable){
            task.taskLost = false;
            task.failed = false;
            task.queryPaused = true;
            task.error = '';
            task.querying = false;
            deps.render();
            try { await deps.resumeSmartPendingNode(node, {}, task.taskId); }
            catch(e) { deps.toast((e.message || deps.tr('smart.errRunFailed')).slice(0, 160)); }
            return;
        }
        if(task.kind === 'image' && task.remoteRefreshable && task.taskId){
            task.querying = true;
            deps.render();
            try {
                const response = await deps.fetch(`/api/canvas-image-tasks/${encodeURIComponent(task.taskId)}/refresh`, {method:'POST'});
                if(!response.ok) throw new Error(await deps.responseErrorMessage(response, '图片任务刷新失败'));
                const data = await response.json();
                if(data.status === 'succeeded'){
                    task.failed = false;
                    task.querying = false;
                    const result = data.result || {};
                    deps.finalizeSmartPendingTask(node, task.taskId, deps.resultMediaUrls(result.image_items?.length ? result.image_items : (result.images || result)), 'image');
                    deps.render();
                    deps.scheduleSave();
                    return;
                }
                if(data.status === 'failed'){
                    task.error = data.error || deps.tr('smart.errRunFailed');
                    task.remoteRefreshable = false;
                    deps.toast(task.error.slice(0, 160));
                } else {
                    task.error = data.error || data.message || '远端任务仍在生成中，请稍后再次刷新';
                    task.remoteRefreshable = Boolean(data.upstream_task_id);
                    deps.toast(task.error.slice(0, 160));
                }
            } catch(e){
                task.error = e.message || '图片任务刷新失败';
                deps.toast(task.error.slice(0, 160));
            } finally {
                const latest = smartPendingTasks(deps, node).find(item => item.taskId === localTaskId);
                if(latest) latest.querying = false;
                deps.render();
                deps.scheduleSave();
            }
            return;
        }
        deps.toast(task.error || '本地任务记录已失效，远端状态未知，请勿直接重新提交');
        return;
    }
    if(task.queryPaused){
        if(task.savePending){
            if(!await deps.saveCanvas()){
                deps.toast('画布尚未保存，请先重试保存，再查询原任务');
                return;
            }
            if(typeof deps.clearSmartUnsavedAcceptedTasks === 'function') deps.clearSmartUnsavedAcceptedTasks([task.taskId]);
            delete task.savePending;
            deps.scheduleSave();
        }
        try { await deps.resumeSmartPendingNode(node, {}, task.taskId); }
        catch(e) { deps.toast((e.message || deps.tr('smart.errRunFailed')).slice(0, 160)); }
        return;
    }
    const recoverTaskId = task.recoverTaskId || extractUpstreamTaskId(deps, task.error || '');
    if(!recoverTaskId){
        deps.toast('没有任务 ID，无法查询');
        return;
    }
    task.querying = true;
    task.recoverTaskId = recoverTaskId;
    deps.render();
    try {
        const data = await fetchImageTaskQuery(deps, providerIdForSmartTask(deps, node, task), recoverTaskId);
        if(data.status === 'succeeded'){
            task.failed = false;
            task.querying = false;
            deps.finalizeSmartPendingTask(node, task.taskId, deps.resultMediaUrls(data.image_items?.length ? data.image_items : (data.images?.length ? data.images : data)), task.kind || 'image');
            deps.render();
            deps.scheduleSave();
            return;
        }
        if(data.status === 'failed'){
            task.error = data.error || deps.tr('smart.errRunFailed');
            deps.toast(task.error.slice(0, 160));
        } else {
            task.error = data.message || '任务仍在生成中，请稍后再查询';
            deps.toast(task.error);
        }
    } catch(e){
        task.error = e.message || '查询失败';
        deps.toast(task.error.slice(0, 160));
    } finally {
        const latest = smartPendingTasks(deps, node).find(item => item.taskId === localTaskId);
        if(latest) latest.querying = false;
        deps.render();
        deps.scheduleSave();
    }
}

function startJimengPoll(deps, node){
    if(!node || !node.jimengPending || !node.jimengPending.submitId) return;
    const submitId = node.jimengPending.submitId;
    if(deps.activeJimengPolls.has(submitId)) return;
    deps.activeJimengPolls.add(submitId);
    const nodeId = node.id;
    (async () => {
        try {
            for(let i = 0; i < deps.JIMENG_POLL_MAX; i++){
                await new Promise(resolve => deps.setTimeout(resolve, deps.JIMENG_POLL_INTERVAL));
                const cur = deps.nodes.find(n => n.id === nodeId);
                if(!cur || !cur.jimengPending || cur.jimengPending.submitId !== submitId) return;
                if(cur.jimengPending.querying) continue;
                let data;
                try {
                    data = await fetchJimengQuery(deps, submitId, cur.jimengPending.kind || 'image');
                } catch(err){ continue; }
                const done = applyJimengQueryResult(deps, cur, data);
                if(done) return;
                const after = deps.nodes.find(n => n.id === nodeId);
                if(!after || !after.jimengPending || after.jimengPending.submitId !== submitId) return;
            }
        } finally {
            deps.activeJimengPolls.delete(submitId);
        }
    })();
}

function resumeJimengPendingNodes(deps){
    deps.nodes.filter(n => n && n.jimengPending && n.jimengPending.submitId).forEach(n => {
        n.jimengPending.querying = false;
        startJimengPoll(deps, n);
    });
}

async function pollSmartCanvasTask(deps, taskId, binding=null){
    if(!taskId) throw new Error(deps.tr('smart.errRunFailed'));
    const pollKey=binding?JSON.stringify([taskId,binding]):taskId;
    if(deps.activeSmartTaskPolls.has(pollKey)) return deps.activeSmartTaskPolls.get(pollKey);
    const promise = deps.CanvasTaskTransport.waitSmartImageTask({
        extractUpstreamTaskId:(...args)=>extractUpstreamTaskId(deps, ...args),
        fetch:(...args)=>deps.fetch(...args),
        imageTaskRecover:data=>new deps.ImageTaskRecoverSignal(data),
        jimengPending:data=>new deps.JimengPendingSignal(data),
        setTimeout:(...args)=>deps.setTimeout(...args),
        tr:(...args)=>deps.tr(...args)
    }, taskId, binding);
    deps.activeSmartTaskPolls.set(pollKey, promise);
    try {
        return await promise;
    } finally {
        deps.activeSmartTaskPolls.delete(pollKey);
    }
}

function prepareSmartVideoTask(deps, node){
    if(!node) return '';
    const taskId = node.videoTaskId || `canvas_video_${deps.uid('v').replace(/[^A-Za-z0-9_-]/g, '')}`;
    node.videoTaskId = taskId;
    node.videoTaskStatus = 'queued';
    delete node.videoTaskError;
    const tasks = smartPendingTasks(deps, node);
    if(!tasks.some(task => task.taskId === taskId)){
        node.pendingTasks = [...tasks, {taskId, kind:'video', providerId:deps.settings.videoProvider || 'comfly', model:deps.settings.videoModel || ''}];
    }
    node.pending = Math.max(1, smartPendingTasks(deps, node).length);
    node.running = false;
    return taskId;
}

function retainSmartVideoTaskRecovery(deps, node, error){
    if(!node?.videoTaskId) return false;
    const taskLost = Boolean(error?.taskLost);
    const shouldRetain = Boolean(error?.queryPaused || error?.videoTaskUnknown || (taskLost && error?.remoteRefreshable));
    if(!shouldRetain) return false;
    const taskId = String(node.videoTaskId);
    const tasks = smartPendingTasks(deps, node);
    let task = tasks.find(item => item.taskId === taskId);
    if(!task){
        task = {taskId, kind:'video'};
        node.pendingTasks = [...tasks, task];
    }
    task.kind = 'video';
    task.querying = false;
    task.failed = true;
    task.queryPaused = !taskLost && Boolean(error?.queryPaused || error?.videoTaskUnknown);
    task.taskLost = taskLost;
    task.remoteRefreshable = Boolean(error?.remoteRefreshable);
    task.error = error?.message || '视频任务状态未知，请勿直接重新提交';
    node.videoTaskStatus = taskLost ? 'unknown' : task.queryPaused ? 'query-paused' : 'unknown';
    node.videoTaskError = task.error;
    node.pending = Math.max(1, smartPendingTasks(deps, node).length);
    node.running = false;
    return true;
}

    const api={smartPendingTasks, extractUpstreamTaskId, jimengQueueText, setNodeJimengPending, handleJimengPendingSignal, finalizeJimengPending, applyJimengQueryResult, fetchJimengQuery, queryJimengNow, providerIdForSmartTask, fetchImageTaskQuery, querySmartImageTaskNow, startJimengPoll, resumeJimengPendingNodes, pollSmartCanvasTask, prepareSmartVideoTask, retainSmartVideoTaskRecovery};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.SmartTaskRecoveryControl=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
