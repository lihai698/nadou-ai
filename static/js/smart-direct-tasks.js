/* Generation responsibility: smart-direct-tasks. Host supplies live state and effects. */
(function(root){
    'use strict';

    async function runQueuedSmartComfyGenerate(deps, payload, node, options={}){
        if(options.beforeSubmit) await options.beforeSubmit();
        const task = await deps.createSmartComfyTask(payload);
        if(!task?.task_id) throw new Error('任务提交未返回编号，受理状态未知');
        if(options.onAccepted) await options.onAccepted(task.task_id, task);
        if(!node) return deps.waitSmartComfyTaskResult(task.task_id);
        const pending = {
            taskId:task.task_id, kind:'comfy', outputKind:'',
            segmentId:'',
            querying:true, ...(options.pending || {})
        };
        node.pendingTasks = [...deps.smartPendingTasks(node), pending];
        node.pending = node.pendingTasks.length;
        deps.render();
        if(!await saveSmartAcceptedTasksBeforeQuery(deps, node, [task.task_id])){
            const error = new Error('任务已受理，但画布尚未保存；请先重试保存，再查询原任务');
            error.comfyTaskPaused = true;
            throw error;
        }
        deps.activeSmartComfyTaskPolls.add(task.task_id);
        try {
            const result = await deps.waitSmartComfyTaskResult(task.task_id, pending.assistantBinding);
            if(options.onResult) await options.onResult(result);
            node.pendingTasks = deps.smartPendingTasks(node).filter(item => item !== pending);
            node.pending = node.pendingTasks.length;
            return result;
        } catch(error){
            if(options.onFailure) options.onFailure(error);
            if(error.queryPaused){
                pending.queryPaused = true;
                pending.error = error.message || '暂时无法查询原任务';
                error.comfyTaskPaused = true;
            } else if(error.taskLost){
                pending.failed = true;
                pending.taskLost = true;
                pending.queryPaused = false;
                pending.error = `${error.message || '本地任务记录已失效'}；远端是否仍在生成未知，请勿直接重复提交。`;
                node.pending = deps.smartPendingTasks(node).length;
                node.taskFailureNotice = pending.error;
                error.comfyTaskLost = true;
            } else if(error.restartLost){
                node.pendingTasks = deps.smartPendingTasks(node).filter(item => item !== pending);
                node.pending = node.pendingTasks.length;
                node.taskFailureNotice = '本地任务记录已失效，可能服务已重启或任务过期；远端是否仍在生成未知，请勿直接重复提交。';
                error.comfyTaskLost = true;
            } else {
                node.pendingTasks = deps.smartPendingTasks(node).filter(item => item !== pending);
                node.pending = node.pendingTasks.length;
            }
            node.running = false;
            deps.render();
            deps.scheduleSave();
            throw error;
        } finally {
            pending.querying = false;
            deps.activeSmartComfyTaskPolls.delete(task.task_id);
        }
    }

    async function waitSmartCanvasTaskBatch(deps, node, taskResult){
        const taskIds = [...new Set((taskResult.taskIds || []).filter(Boolean))];
        const batch = taskIds.map(taskId => ({taskId, kind:'image', providerId:taskResult.providerId, model:taskResult.model, querying:true}));
        node.pendingTasks = [...deps.smartPendingTasks(node), ...batch];
        node.pending = node.pendingTasks.length;
        deps.render();
        // Persist accepted IDs before waiting so a reload can resume the same tasks.
        if(!await saveSmartAcceptedTasksBeforeQuery(deps, node, taskIds)){
            const error = new Error('任务已受理，但画布尚未保存；请先重试保存，再查询原任务');
            error.queryPaused = true;
            throw error;
        }
        const settled = await Promise.allSettled(taskIds.map(taskId => deps.pollSmartCanvasTask(taskId)));
        const failures = settled.filter(item => item.status === 'rejected');
        const urls = [];
        settled.forEach((item, index) => {
            const task = batch[index];
            task.querying = false;
            if(item.status === 'fulfilled'){
                const result = item.value;
                const images = deps.resultMediaUrls(result?.image_items?.length ? result.image_items : (result?.images?.length ? result.images : result));
                urls.push(...images);
                if(failures.length){
                    // Do not discard completed siblings when another query pauses.
                    deps.finalizeSmartPendingTask(node, task.taskId, images, 'image');
                    return;
                }
            } else if(item.reason?.queryPaused){
                task.queryPaused = true;
                task.error = '查询暂停，可稍后用原任务查询结果';
                return;
            } else if(item.reason?.imageTaskRecover && item.reason.recoverTaskId){
                task.failed = true;
                task.recoverTaskId = item.reason.recoverTaskId;
                task.providerId = item.reason.providerId || task.providerId;
                task.error = item.reason.message;
                return;
            }
            node.pendingTasks = deps.smartPendingTasks(node).filter(pending => pending !== task);
        });
        node.pending = deps.smartPendingTasks(node).length;
        deps.render();
        deps.scheduleSave();
        if(failures.length){
            node.running = false;
            const paused = failures.find(item => item.reason?.queryPaused);
            if(paused) paused.reason.message = '查询暂停，可稍后用原任务查询结果';
            throw (paused || failures[0]).reason;
        }
        return urls.filter(Boolean);
    }

    function smartTaskSubmissionWarning(deps, taskResult){
        const failures = taskResult?.submissionFailures || [];
        if(!failures.length) return '';
        const rejected = failures.filter(failure => failure.kind === 'rejected').length;
        const unknown = failures.length - rejected;
        const parts = [];
        if(rejected) parts.push(`${rejected} 项被明确拒绝`);
        if(unknown) parts.push(`${unknown} 项未收到可靠响应，可能已受理`);
        const accepted = (taskResult.taskIds || []).length;
        const advice = accepted || unknown
            ? `${accepted ? '已取得编号的任务会继续查询，' : ''}请勿直接重试整批。`
            : '请检查失败原因后重试。';
        return `本次请求 ${taskResult.count} 项，仅取得 ${accepted} 个任务编号；${parts.join('，')}。${advice}`;
    }

    function rememberSmartTaskSubmissionWarning(deps, node, warning, unknown=false){
        if(!node) return;
        const previousUnknown = Boolean(node.submissionUnknown && node.submissionWarning);
        if(warning){
            node.submissionWarning = previousUnknown && node.submissionWarning !== warning
                ? `${node.submissionWarning}\n${warning}` : warning;
            node.submissionUnknown = previousUnknown || Boolean(unknown);
        } else if(!previousUnknown){
            delete node.submissionWarning;
            delete node.submissionUnknown;
        }
        deps.scheduleSave();
    }

    function recordSmartTaskSubmission(deps, node, taskResult, runState=null){
        const warning = smartTaskSubmissionWarning(deps, taskResult);
        const unknown = (taskResult?.submissionFailures || []).some(failure => failure.kind === 'unknown');
        if(unknown && runState) runState.submissionUnknown = true;
        if(!node) return warning;
        rememberSmartTaskSubmissionWarning(deps, node, warning, unknown);
        if(warning) deps.toast(warning);
        return warning;
    }

    async function saveSmartAcceptedTasksBeforeQuery(deps, node, taskIds){
        const acceptedIds = new Set((taskIds || []).map(value => String(value || '').trim()).filter(Boolean));
        const pendingTasksForBackup = () => typeof deps.smartPendingTasks === 'function'
            ? deps.smartPendingTasks(node)
            : (Array.isArray(node?.pendingTasks) ? node.pendingTasks.filter(task => task && task.taskId) : []);
        const acceptedTasks = pendingTasksForBackup().filter(task => acceptedIds.has(String(task.taskId || '')));
        if(typeof deps.rememberSmartAcceptedTasks === 'function') deps.rememberSmartAcceptedTasks(node, acceptedTasks);
        if(await deps.saveCanvas()){
            if(typeof deps.clearSmartUnsavedAcceptedTasks === 'function') deps.clearSmartUnsavedAcceptedTasks(taskIds);
            return true;
        }
        pendingTasksForBackup().forEach(task => {
            if(!acceptedIds.has(task.taskId)) return;
            task.querying = false;
            task.queryPaused = true;
            task.savePending = true;
            task.error = '画布尚未保存，请先重试保存，再查询原任务';
        });
        node.pending = pendingTasksForBackup().length;
        node.running = false;
        deps.render();
        deps.scheduleSave();
        deps.toast('任务已受理，但画布尚未保存；请先重试保存，再查询原任务');
        return false;
    }

    const api={runQueuedSmartComfyGenerate, waitSmartCanvasTaskBatch, smartTaskSubmissionWarning, rememberSmartTaskSubmissionWarning, recordSmartTaskSubmission, saveSmartAcceptedTasksBeforeQuery};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.SmartDirectTasks=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
