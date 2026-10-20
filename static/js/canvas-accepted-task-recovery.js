/* Unsaved accepted-task journals and recovery. Host owns live canvas and UI. */
(function(root){
    'use strict';

    function unsavedCanvasAcceptedTasksKey(deps, canvasId=deps.canvas?.id){
        return canvasId ? `${deps.CANVAS_UNSAVED_ACCEPTED_TASKS_PREFIX}${canvasId}` : '';
    }

    function readUnsavedCanvasAcceptedTasks(deps, canvasId=deps.canvas?.id){
        const key = unsavedCanvasAcceptedTasksKey(deps, canvasId);
        if(!key) return [];
        try {
            const entries = JSON.parse(deps.storage.getItem(key) || '[]');
            return Array.isArray(entries) ? entries : [];
        } catch(_) { return []; }
    }

    function clearUnsavedCanvasAcceptedTasks(deps, canvasId=deps.canvas?.id, savedNodes=[]){
        const key = unsavedCanvasAcceptedTasksKey(deps, canvasId);
        if(!key) return;
        const savedIds = new Set(savedNodes.flatMap(node => [...(node._pending || []), ...(node._directPending || [])]
            .map(task => task.canvasTaskId).filter(Boolean)));
        const remaining = readUnsavedCanvasAcceptedTasks(deps, canvasId).filter(entry => !savedIds.has(entry?.taskId));
        try {
            if(remaining.length) deps.storage.setItem(key, JSON.stringify(remaining));
            else deps.storage.removeItem(key);
        } catch(_) {}
    }

    function unknownCanvasSubmissionKey(deps, canvasId=deps.canvas?.id){
        return canvasId ? `${deps.CANVAS_UNKNOWN_SUBMISSION_PREFIX}${canvasId}` : '';
    }

    function clearUnsavedCanvasUnknownWarnings(deps, canvasId=deps.canvas?.id, savedNodes=[]){
        const key = unknownCanvasSubmissionKey(deps, canvasId);
        if(!key) return;
        try {
            const parsed = JSON.parse(deps.storage.getItem(key) || '[]');
            const entries = Array.isArray(parsed) ? parsed : [];
            const remaining = entries.filter(entry => !savedNodes.some(node => node.id === entry?.nodeId
                && node.submissionUnknown && node.submissionWarning?.includes(entry.warning)));
            if(remaining.length) deps.storage.setItem(key, JSON.stringify(remaining));
            else deps.storage.removeItem(key);
        } catch(_) {}
    }

    function rememberUnsavedCanvasUnknownWarning(deps, node){
        const key = unknownCanvasSubmissionKey(deps);
        if(!key || !node?.submissionWarning) return;
        try {
            const parsed = JSON.parse(deps.storage.getItem(key) || '[]');
            const entries = Array.isArray(parsed) ? parsed : [];
            const next = entries.filter(item => item?.nodeId !== node.id);
            next.push({nodeId:String(node.id || ''), warning:String(node.submissionWarning).slice(0, 1000)});
            deps.storage.setItem(key, JSON.stringify(next.slice(-32)));
        } catch(_) {}
    }

    function restoreUnsavedCanvasUnknownWarnings(deps){
        const key = unknownCanvasSubmissionKey(deps);
        if(!key) return 0;
        try {
            const entries = JSON.parse(deps.storage.getItem(key) || '[]');
            if(!Array.isArray(entries)) return 0;
            let recovered = 0;
            entries.forEach(entry => {
                if(!entry?.nodeId || !entry.warning) return;
                const node = deps.nodes.find(item => item.id === entry.nodeId);
                if(node){
                    if(!node.submissionWarning?.includes(entry.warning)){
                        node.submissionWarning = [node.submissionWarning, entry.warning].filter(Boolean).join('\n');
                    }
                    node.submissionUnknown = true;
                } else deps.canvasOrphanUnknownSubmissionCount += 1;
                recovered += 1;
            });
            if(recovered) deps.scheduleSave();
            return recovered;
        } catch(_) { return 0; }
    }

    function confirmOrphanUnknownCanvasSubmission(deps){
        if(!deps.canvasOrphanUnknownSubmissionCount) return true;
        return deps.confirm(`此画布有 ${deps.canvasOrphanUnknownSubmissionCount} 次受理状态未知的请求，其原节点尚未保存。再次提交可能重复计费，请先核对原任务。确定继续吗？`);
    }

    function rememberUnsavedCanvasAcceptedTasks(deps, node, tasks, out=null){
        const key = unsavedCanvasAcceptedTasksKey(deps);
        if(!key) return false;
        const entries = readUnsavedCanvasAcceptedTasks(deps);
        tasks.forEach(task => {
            const taskId = String(task.canvasTaskId || '').slice(0, 256);
            if(!taskId) return;
            const entry = {
                taskId, nodeId:String(node.id || ''), outputId:String(out?.id || ''),
                taskType:['comfy','video','runninghub'].includes(task.canvasTaskType)?task.canvasTaskType:'online-image',
                segmentId:String(task.segmentId || '').slice(0, 128),
                x:Number(node.x || 0), y:Number(node.y || 0),
                providerId:String(task.providerId || '').slice(0, 128),
                model:String(task.model || '').slice(0, 256),
                useWallet:Boolean(task.useWallet), rhMode:String(task.rhMode || ''),
                startedAt:Number(task.startedAt || deps.nowMs()),
                ...(node.assistantNativeRun?.actionId && node.assistantNativeRun.taskIds?.includes(taskId)?{assistantNativeActionId:String(node.assistantNativeRun.actionId),assistantTaskKind:node.assistantNativeRun.taskKind,assistantRunStartedAt:Number(node.assistantNativeRun.startedAt||task.startedAt||deps.nowMs()),assistantPreviousActionId:String(node.assistantNativeRun.previousActionId||''),...(node.assistantNativeRun.taskKind==='video'?{assistantInputHash:node.assistantNativeRun.inputHash,assistantCanvasId:deps.canvas?.id}: {})}:{}),
            };
            const index = entries.findIndex(item => item?.taskId === taskId);
            if(index >= 0) entries[index] = {...entries[index],...entry};
            else entries.push(entry);
        });
        try {
            deps.storage.setItem(key, JSON.stringify(entries.slice(-32)));
            return true;
        } catch(_) { return false; }
    }

    function restoreUnsavedCanvasAcceptedTasks(deps){
        const entries = readUnsavedCanvasAcceptedTasks(deps);
        let recovered = 0;
        entries.forEach(entry => {
            const taskId = String(entry?.taskId || '');
            if(!taskId) return;
            const source = deps.nodes.find(node => node.id === entry.nodeId);
            if(source && entry.assistantNativeActionId && ['image','comfy','video','runninghub'].includes(entry.assistantTaskKind)){
                const run=source.assistantNativeRun;
                const backupTime=Number(entry.assistantRunStartedAt||entry.startedAt||0);
                const replacesOld=run&&run.actionId!==entry.assistantNativeActionId&&((Number(run.startedAt)>0&&Number(run.startedAt)<backupTime)||(!run.startedAt&&entry.assistantPreviousActionId===run.actionId));
                if(!run || run.actionId===entry.assistantNativeActionId || replacesOld){
                    const current=replacesOld?null:run;
                    source.assistantNativeRun={...(current||{}),actionId:entry.assistantNativeActionId,taskKind:entry.assistantTaskKind,taskIds:[...new Set([...(current?.taskIds||[]),taskId])],submissionStarted:true,startedAt:backupTime,...(entry.assistantTaskKind==='video'?{plannedTaskId:taskId,inputHash:entry.assistantInputHash,outputNodeId:entry.outputId}: {}),...(entry.assistantTaskKind==='runninghub'?{inputHash:entry.assistantInputHash,outputNodeId:entry.outputId}: {})};
                }
            }
            const existing = deps.findPendingTask(taskId);
            if(existing){
                existing.pending.savePending = true;
                existing.pending.queryPaused = true;
                existing.pending.queryRecoverable = true;
                existing.pending.cascadeTargetId = '';
                recovered += 1;
                return;
            }
            let out = deps.nodes.find(node => node.id === entry.outputId && node.type === 'output');
            if(entry.assistantTaskKind==='video'&&entry.assistantNativeActionId&&(!out||!source||!deps.connections.some(c=>c.from===source.id&&c.to===out.id)))return;
            if(!out && source) out = deps.connections.filter(link => link.from === source.id)
                .map(link => deps.nodes.find(node => node.id === link.to)).find(node => node?.type === 'output');
            if(!out){
                out = {id:deps.uid('out'), type:'output', x:Number(source?.x ?? entry.x ?? 0), y:Number(source?.y ?? entry.y ?? 0) + 650, images:[]};
                deps.nodes.push(out);
                if(source) deps.connections.push({id:deps.uid('c'), from:source.id, to:out.id});
            }
            out._pending = [...(out._pending || []), {
                id:deps.uid('p'), canvasTaskId:taskId, canvasTaskType:['comfy','video','runninghub'].includes(entry.taskType)?entry.taskType:'online-image',
                ...(entry.assistantTaskKind==='video'?{assistantNativeActionId:entry.assistantNativeActionId,assistantInputHash:entry.assistantInputHash,assistantCanvasId:entry.assistantCanvasId}: {}),
                providerId:String(entry.providerId || ''), model:String(entry.model || ''),
                useWallet:Boolean(entry.useWallet), rhMode:String(entry.rhMode || ''),
                segmentId:String(entry.segmentId || ''),
                startedAt:Number(entry.startedAt || deps.nowMs()),
                run:{node:{id:String(entry.nodeId || '')}, refs:[]},
                queryPaused:true, queryRecoverable:true, savePending:true,
                appendGenerated:true, error:'画布尚未保存，请先保存并查询原任务'
            }];
            recovered += 1;
        });
        if(recovered) deps.scheduleSave();
        return recovered;
    }

    function confirmCanvasUnknownResubmission(deps, node, opts={}){
        const unsavedTasks = [
            ...(node._directPending || []),
            ...deps.nodes.filter(item => item.type === 'output').flatMap(item => item._pending || [])
                .filter(pending => pending.run?.node?.id === node.id)
        ].filter(pending => pending.savePending);
        if(unsavedTasks.length){
            const message = `原任务编号尚未保存（${unsavedTasks.map(task => task.canvasTaskId).filter(Boolean).join('、')}）。请先在结果卡片点击“保存并查询”，不要重新提交。`;
            if(opts.cascade) throw deps.cascadeAbortError(`${message}一键运行已停止。`);
            deps.showErrorModal(message, deps.tr('canvas.apiFailed'));
            return false;
        }
        if(!node.submissionUnknown) return true;
        const warning = '上一次请求未收到可靠响应，可能已受理。再次提交可能重复计费。';
        if(opts.cascade) throw new Error(`${warning}一键运行已停止；请先核对该节点。`);
        return deps.confirm(`${warning}请先核对上一次任务。确定再次提交吗？`);
    }

    function pauseCanvasAcceptedTasksUntilSaved(deps, node, tasks, out=null){
        const browserBackupSaved = rememberUnsavedCanvasAcceptedTasks(deps, node, tasks, out);
        const message = browserBackupSaved
            ? '任务已受理，但画布尚未保存；请在结果卡片点击“保存并查询”，不要重新提交。'
            : '任务已受理，但画布尚未保存且浏览器无法备份编号；请保持此页面打开，在结果卡片点击“保存并查询”，不要重新提交。';
        tasks.forEach(task => {
            task.queryPaused = true;
            task.queryRecoverable = true;
            task.savePending = true;
            task.error = message;
            task.cascadeTargetId = '';
        });
        node.running = false;
        deps.scheduleSave();
        deps.showErrorModal(message, deps.tr('canvas.apiFailed'));
        const error = new Error(message);
        error.queryPaused = true;
        return error;
    }

    function rememberCanvasSubmissionWarning(deps, node, warning, unknown=false){
        const previousUnknown = Boolean(node.submissionUnknown && node.submissionWarning);
        if(warning){
            if(previousUnknown){
                if(!node.submissionWarning.includes(warning)) node.submissionWarning += `\n${warning}`;
            } else {
                node.submissionWarning = warning;
            }
            node.submissionUnknown = previousUnknown || Boolean(unknown);
            if(unknown) rememberUnsavedCanvasUnknownWarning(deps, node);
        } else if(!previousUnknown){
            delete node.submissionWarning;
            delete node.submissionUnknown;
        }
    }

    function smartUnsavedAcceptedTasksKey(deps, id){
        const currentId = id === undefined
            ? (typeof deps.canvasId === 'string' ? deps.canvasId : '')
            : String(id || '');
        return currentId ? `${deps.SMART_UNSAVED_ACCEPTED_TASKS_PREFIX}${currentId}` : '';
    }

    function readSmartUnsavedAcceptedTasks(deps, id){
        const key = smartUnsavedAcceptedTasksKey(deps, id);
        if(!key || typeof deps.storage === 'undefined') return [];
        try {
            const entries = JSON.parse(deps.storage.getItem(key) || '[]');
            return Array.isArray(entries) ? entries : [];
        } catch(_) { return []; }
    }

    function rememberSmartAcceptedTasks(deps, node, tasks=[], ownerCanvasId){
        const key = smartUnsavedAcceptedTasksKey(deps, ownerCanvasId);
        if(!key || !node?.id || typeof deps.storage === 'undefined') return false;
        const entries = readSmartUnsavedAcceptedTasks(deps, ownerCanvasId);
        (tasks || []).forEach(task => {
            const taskId = String(task?.taskId || '').trim().slice(0, 256);
            if(!taskId) return;
            const entry = {
                taskId,
                nodeId:String(node.id).slice(0, 160),
                kind:String(task.kind || 'image').slice(0, 32),
                providerId:String(task.providerId || '').slice(0, 128),
                model:String(task.model || '').slice(0, 256),
                segmentId:String(task.segmentId || '').slice(0, 128),
                startedAt:Number(task.startedAt || deps.nowMs())
            };
            if(task.assistantNativeActionId){
                entry.assistantNativeActionId=String(task.assistantNativeActionId).slice(0,160);
                entry.assistantMaxCalls=Number(task.assistantMaxCalls)||1;
                if(task.assistantBinding)entry.assistantBinding={...task.assistantBinding};
                if(task.segmentInputSignature)entry.segmentInputSignature=String(task.segmentInputSignature);
                if(task.assistantSourceNodeId){
                    entry.assistantSourceNodeId=String(task.assistantSourceNodeId).slice(0,100);
                    entry.assistantInputHash=String(task.assistantInputHash||'').slice(0,64);
                    if(task.assistantLoopStepKey)entry.assistantLoopStepKey=String(task.assistantLoopStepKey).slice(0,80);
                }
            }
            const index = entries.findIndex(item => item?.taskId === taskId);
            if(index >= 0) entries[index] = {...entries[index],...entry};
            else entries.push(entry);
        });
        try {
            deps.storage.setItem(key, JSON.stringify(entries.slice(-32)));
            return true;
        } catch(_) { return false; }
    }

    function clearSmartUnsavedAcceptedTasks(deps, taskIds=[]){
        const key = smartUnsavedAcceptedTasksKey(deps);
        if(!key || typeof deps.storage === 'undefined') return;
        const ids = new Set((taskIds || []).map(value => String(value || '').trim()).filter(Boolean));
        if(!ids.size) return;
        const remaining = readSmartUnsavedAcceptedTasks(deps).filter(item => !ids.has(String(item?.taskId || '')));
        try {
            if(remaining.length) deps.storage.setItem(key, JSON.stringify(remaining));
            else deps.storage.removeItem(key);
        } catch(_) {}
    }

    function restoreSmartUnsavedAcceptedTasks(deps){
        const entries = readSmartUnsavedAcceptedTasks(deps);
        if(!entries.length) return 0;
        let recovered = 0;
        const alreadySaved = [];
        entries.forEach(entry => {
            const taskId = String(entry?.taskId || '').trim();
            const node = deps.nodes.find(item => item?.id === entry?.nodeId);
            if(!taskId || !node) return;
            if(entry.assistantLoopStepKey){
                const owner=deps.nodes.find(n=>n.id===entry.assistantSourceNodeId&&n.type==='smart-loop'),run=owner?.assistantNativeRun,slot=run?.slots?.[entry.assistantLoopStepKey],origin=node.assistantNativeOrigin;
                if(!run || run.actionId!==entry.assistantNativeActionId || slot?.outputNodeId!==node.id || origin?.kind!=='loop' || origin.actionId!==run.actionId || origin.sourceNodeId!==owner.id || origin.inputHash!==entry.assistantInputHash || origin.stepKey!==entry.assistantLoopStepKey)return;
                if(!run.taskIds.includes(taskId))run.taskIds.push(taskId);
                if(['submitting','unknown'].includes(slot.status))run.unknownCount=Math.max(0,(run.unknownCount||0)-1);
                slot.taskIds=[taskId];if(slot.status!=='succeeded')slot.status='accepted';
                if(!run.unknownCount && !Object.values(run.slots).some(s=>['submitting','unknown'].includes(s.status))){owner.submissionUnknown=false;node.submissionUnknown=false;}
            }
            if(!entry.assistantLoopStepKey && entry.assistantNativeActionId && Number.isInteger(entry.assistantMaxCalls) && entry.assistantMaxCalls>=1 && entry.assistantMaxCalls<=8){
                const sameAction=entries.filter(item=>item?.nodeId===node.id && item.assistantNativeActionId===entry.assistantNativeActionId);
                const recoveredIds=[...new Set(sameAction.map(item=>String(item.taskId||'').trim()).filter(Boolean))];
                const owner=entry.assistantSourceNodeId ? deps.nodes.find(n=>n.id===entry.assistantSourceNodeId&&n.type==='smart-group') : node;
                const origin=node.assistantNativeOrigin;
                if(entry.assistantSourceNodeId && (!owner || origin?.sourceNodeId!==owner.id || origin.actionId!==entry.assistantNativeActionId || origin.inputHash!==entry.assistantInputHash))return;
                const prior=owner.assistantNativeRun;
                if(!prior || prior.actionId===entry.assistantNativeActionId){
                    const taskIds=[...new Set([...(prior?.taskIds||[]),...recoveredIds])];
                    const unknownCount=Math.max(Number(prior?.unknownCount)||0,entry.assistantMaxCalls-taskIds.length);
                    owner.assistantNativeRun={...prior,actionId:entry.assistantNativeActionId,taskKind:entry.kind==='comfy'?'comfy':'image',taskIds,submissionStarted:true,unknownCount,
                        ...(entry.assistantSourceNodeId?{outputNodeId:node.id,inputHash:entry.assistantInputHash}:{}),
                        ...(entry.assistantBinding?{assistantBinding:{...entry.assistantBinding},segmentId:entry.segmentId,segmentInputSignature:entry.segmentInputSignature}: {})};
                    if(unknownCount){owner.submissionUnknown=true;node.submissionUnknown=true;}
                }
            }
            const existing = deps.smartPendingTasks(node).find(task => task.taskId === taskId);
            if(existing){
                alreadySaved.push(taskId);
                return;
            } else {
                node.pendingTasks = [...deps.smartPendingTasks(node), {
                    taskId,
                    kind:String(entry.kind || 'image'),
                    providerId:String(entry.providerId || ''),
                    model:String(entry.model || ''),
                    segmentId:String(entry.segmentId || ''),
                    ...(entry.assistantSourceNodeId?{assistantNativeActionId:entry.assistantNativeActionId,assistantSourceNodeId:entry.assistantSourceNodeId,assistantInputHash:entry.assistantInputHash}:{}),
                    ...(entry.assistantLoopStepKey?{assistantLoopStepKey:entry.assistantLoopStepKey}:{}),
                    ...(entry.assistantBinding?{assistantNativeActionId:entry.assistantNativeActionId,assistantMaxCalls:entry.assistantMaxCalls,assistantBinding:{...entry.assistantBinding},segmentInputSignature:entry.segmentInputSignature}:{}),
                    startedAt:Number(entry.startedAt || deps.nowMs()),
                    querying:false,
                    queryPaused:true,
                    savePending:true,
                    queryRecoverable:true,
                    error:'画布尚未保存，请先重试保存，再查询原任务'
                }];
            }
            node.pending = deps.smartPendingTasks(node).length;
            node.running = false;
            recovered += 1;
        });
        clearSmartUnsavedAcceptedTasks(deps, alreadySaved);
        if(recovered) deps.render();
        return recovered;
    }

    const api={unsavedCanvasAcceptedTasksKey, readUnsavedCanvasAcceptedTasks, clearUnsavedCanvasAcceptedTasks, unknownCanvasSubmissionKey, clearUnsavedCanvasUnknownWarnings, rememberUnsavedCanvasUnknownWarning, restoreUnsavedCanvasUnknownWarnings, confirmOrphanUnknownCanvasSubmission, rememberUnsavedCanvasAcceptedTasks, restoreUnsavedCanvasAcceptedTasks, confirmCanvasUnknownResubmission, pauseCanvasAcceptedTasksUntilSaved, rememberCanvasSubmissionWarning, smartUnsavedAcceptedTasksKey, readSmartUnsavedAcceptedTasks, rememberSmartAcceptedTasks, clearSmartUnsavedAcceptedTasks, restoreSmartUnsavedAcceptedTasks};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.CanvasAcceptedTaskRecovery=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
