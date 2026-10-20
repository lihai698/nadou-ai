/* Classic generation direct. Host supplies instance state and effects. */
(function(root){
    'use strict';

    function materializeCanvasDirectTasks(deps, node, pendingTasks){
        if(!pendingTasks?.length) return null;
        let out = deps.connections.filter(c => c.from === node.id)
            .map(c => deps.nodes.find(n => n.id === c.to)).find(n => n?.type === 'output');
        if(!out){
            out = {id:deps.uid('out'), type:'output', x:node.x, y:node.y + 650, images:[]};
            deps.nodes.push(out);
            deps.connections.push({id:deps.uid('c'), from:node.id, to:out.id});
        }
        const ids = new Set(pendingTasks.map(p => p.canvasTaskId));
        const existing = new Set((out._pending || []).map(p => p.canvasTaskId));
        out._pending = [...(out._pending || []), ...pendingTasks.filter(p => !existing.has(p.canvasTaskId)).map(p => ({
            ...p, cascadeTargetId:'', queryPaused:true, queryRecoverable:true,
            appendGenerated:true, error:p.savePending ? p.error : '查询暂停，可继续查询原任务'
        }))];
        node._directPending = (node._directPending || []).filter(p => !ids.has(p.canvasTaskId));
        if(!node._directPending.length) delete node._directPending;
        node.running = false;
        node.runStatus = 'query-paused';
        deps.render();
        deps.scheduleSave();
        return out;
    }

    async function waitCanvasDirectTasks(deps, node, taskInfos, run, options={}){
        const batch = taskInfos.map(task => deps.makePendingForRun(deps.uid('p'), run, node, options, {
            canvasTaskId:task.task_id, canvasTaskType:'online-image',
            providerId:options.providerId, model:options.model
        }));
        node._directPending = [...(node._directPending || []), ...batch];
        deps.scheduleSave();
        if(!await deps.saveCanvas()){
            const error = deps.pauseCanvasAcceptedTasksUntilSaved(node, batch);
            materializeCanvasDirectTasks(deps, node, batch);
            throw error;
        }
        options.onAcceptedSaved?.();
        const settled = await Promise.allSettled(taskInfos.map(task => deps.waitCanvasImageTaskResult(task.task_id, options)));
        const failures = settled.filter(item => item.status === 'rejected');
        const needsRecovery = failures.some(({reason}) => reason?.queryPaused || reason?.taskLost || reason?.restartLost || deps.isCascadeAbortError(reason)
            || reason?.taskData?.upstream_task_id || deps.extractUpstreamTaskId(reason?.message || ''));
        if(failures.length === settled.length && !needsRecovery){
            const ids = new Set(batch.map(p => p.canvasTaskId));
            node._directPending = (node._directPending || []).filter(p => !ids.has(p.canvasTaskId));
            if(!node._directPending.length) delete node._directPending;
            failures.forEach(({reason}) => deps.addGenerationLog({run, outputs:[], error:reason.message || deps.tr('canvas.generationFailed')}));
            deps.scheduleSave();
            throw failures[0].reason;
        }
        if(!failures.length){
            const ids = new Set(batch.map(p => p.canvasTaskId));
            node._directPending = (node._directPending || []).filter(p => !ids.has(p.canvasTaskId));
            if(!node._directPending.length) delete node._directPending;
            const last = settled[settled.length - 1]?.value;
            if(last) run.request = deps.requestMetaFromResult(last);
            deps.scheduleSave();
            return settled.flatMap(item => item.value.images || []);
        }
        const out = materializeCanvasDirectTasks(deps, node, batch);
        settled.forEach((item, index) => {
            const taskId = taskInfos[index].task_id;
            if(item.status === 'fulfilled') deps.completeCanvasImageTask(taskId, item.value);
            else if(item.reason?.taskLost || item.reason?.restartLost){
                const found = deps.findPendingTask(taskId);
                if(found){
                    const message = `${item.reason.message || '本地任务记录已失效，远端状态未知'}；远端是否仍在生成未知，请勿直接重复提交。`;
                    found.pending.failed = true;
                    found.pending.taskLost = true;
                    found.pending.queryPaused = false;
                    found.pending.querying = false;
                    found.pending.queryRecoverable = true;
                    found.pending.canvasTaskStatus = 'unknown';
                    found.pending.remoteRefreshable = Boolean(item.reason?.remoteRefreshable || item.reason?.taskData?.upstream_task_id);
                    found.pending.error = message;
                    const gen = deps.nodes.find(n => n.id === found.pending.run?.node?.id);
                    if(gen){ gen.running = false; gen.runStatus = 'task-lost'; gen.runError = message; }
                    deps.refreshRunNodes(gen, found.out);
                    deps.scheduleSave();
                }
            }
            else if(!item.reason?.queryPaused && !deps.isCascadeAbortError(item.reason)){
                deps.failCanvasImageTask(taskId, item.reason.message || deps.tr('canvas.generationFailed'), item.reason.taskData || {});
            }
        });
        const cancelled = failures.find(item => deps.isCascadeAbortError(item.reason));
        if(cancelled) throw cancelled.reason;
        if((out._pending || []).length){
            const taskLost = (out._pending || []).some(item => item.taskLost);
            node.runStatus = taskLost ? 'task-lost' : 'query-paused';
            const error = new Error(taskLost
                ? '本地任务记录已失效，远端是否仍在生成未知，请勿直接重复提交。'
                : '查询暂停，请在恢复卡片中查询原任务');
            if(taskLost) error.taskLost = true;
            else error.queryPaused = true;
            throw error;
        }
        throw failures[0].reason;
    }

    async function runQueuedComfyGenerate(deps, payload, options={}){
        const pending = deps.pendingById(options.out, options.pendingId);
        const source = deps.nodes.find(node => node.id === pending?.run?.node?.id);
        let task,submitted=false;
        try{
            if(options.beforeSubmit) await options.beforeSubmit();
    
            submitted=true;
            task = await deps.createCanvasComfyTask(payload, options);
            if(!task?.task_id) throw new Error('任务提交未返回编号，受理状态未知');
        }catch(error){
    
            throw error;
        }
        if(!pending){if(options.onAccepted)await options.onAccepted(task.task_id);return deps.waitCanvasComfyTaskResult(task.task_id, options);}
        pending.canvasTaskId = task.task_id;
        pending.canvasTaskType = 'comfy';
        pending.queryRecoverable = true;
        pending.cascadeTargetId = '';
        try{if(options.onAccepted)await options.onAccepted(task.task_id);}
        finally{deps.rememberUnsavedCanvasAcceptedTasks(source || {}, [pending], options.out);}
    
        deps.refreshRunNodes(source, options.out);
        if(!await deps.saveCanvas()){
            const error = deps.pauseCanvasAcceptedTasksUntilSaved(source || {}, [pending], options.out);
            error.comfyTaskPaused = true;
            throw error;
        }
        deps.activeCanvasComfyTaskPolls.add(task.task_id);
        try {
            return await deps.waitCanvasComfyTaskResult(task.task_id, options);
        } catch(error){
            if(error.queryPaused || deps.isCascadeAbortError(error)){
                pending.queryPaused = true;
                pending.queryRecoverable = true;
                pending.cascadeTargetId = '';
                pending.error = deps.isCascadeAbortError(error) ? '页面已停止等待，远端任务状态未知；可查询原任务。' : error.message || '暂时无法查询原任务';
                error.comfyTaskPaused = true;
            } else if(error.restartLost){
                pending.failed = true;
                pending.taskLost = true;
                pending.error = `${error.message}；远端是否仍在生成未知，请勿直接重复提交。`;
                error.comfyTaskLost = true;
            }
            if(error.comfyTaskPaused || error.comfyTaskLost){
                deps.refreshRunNodes(source, options.out);
                deps.scheduleSave();
            }
            throw error;
        } finally {
            deps.activeCanvasComfyTaskPolls.delete(task.task_id);
        }
    }

    const api={materializeCanvasDirectTasks, waitCanvasDirectTasks, runQueuedComfyGenerate};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.CanvasDirectTasks=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
