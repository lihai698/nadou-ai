/* Classic generation midjourney. Host supplies instance state and effects. */
(function(root){
    'use strict';

    async function midjourneyRequest(deps, path, options={}){
        const {cascadeTargetId='', ...init} = options;
        const response = await deps.cascadeFetch(path, init, cascadeTargetId ? {cascadeTargetId} : {});
        if(!response.ok) throw new Error(await deps.responseErrorMessage(response, 'Midjourney 请求失败'));
        return response.json();
    }

    async function waitMidjourneyTask(deps, providerId, taskId, options={}){
        while(true){
            const cascadeTargetId = deps.cascadeTargetIdFromOptions(options);
            if(cascadeTargetId) deps.ensureCascadeActive(cascadeTargetId);
            const result = await midjourneyRequest(deps, `/api/midjourney/tasks/${encodeURIComponent(taskId)}?provider_id=${encodeURIComponent(providerId)}`, {cascadeTargetId});
            if(result.status === 'succeeded') return result;
            if(result.status === 'failed') throw new Error(result.error || 'Midjourney 任务失败');
            await deps.sleep(2200);
        }
    }

    async function completeMidjourneyRun(deps, node, out, run, result, append=false){
        const outputs = result.image_items?.length ? result.image_items : (result.images || []);
        if(!outputs.length) throw new Error('Midjourney 任务没有返回图片');
        run.request = deps.requestMetaFromResult(result);
        run.request.task_id = result.task_id || node.lastTaskId || '';
        deps.appendOutputImages(out, outputs, run.refs?.[0], [{runMs:deps.nowMs() - Number(run.startedAt || deps.nowMs()), run}]);
        deps.mergeGeneratedOutputs(node, outputs, append);
        node.runStatus = 'done';
        node.runError = '';
        node.running = false;
        node.lastTaskStatus = 'SUCCESS';
        node.lastImageCount = outputs.length;
        deps.addGenerationLog({run, outputs, runMs:deps.nowMs() - Number(run.startedAt || deps.nowMs())});
        deps.refreshRunNodes(node, out);
        deps.scheduleSave();
    }

    async function runMidjourneyNode(deps, nodeId, opts={}){
        if(opts.assistantNativeActionId)return deps.runCanvasAssistantCatalogImage(nodeId,opts);
        const node = deps.nodes.find(item => item.id === nodeId);
        if(!node || (node.running && !opts.cascade)) return;
        const providerId = deps.resolveMidjourneyProviderId(node.apiProvider || '');
        if(!providerId){ deps.showErrorModal('请先在 API 设置中添加 APIMart 平台。', 'Midjourney'); return; }
        const sources = deps.orderedSources(node, deps.generatorSources(node));
        const prompt = sources.map(source => source.prompt).filter(Boolean).join('\n\n').trim();
        const refs = deps.imageRefsOnly(sources.flatMap(source => source.refs || []));
        const mode = ['imagine','blend','edit'].includes(node.mode) ? node.mode : 'imagine';
        if(mode === 'blend' && (refs.length < 2 || refs.length > 4)){
            deps.alert('多图融合需要连接 2 到 4 张图片');
            return;
        }
        if(mode !== 'blend' && !prompt){ deps.alert(deps.tr('canvas.needPrompt')); return; }
        if(mode === 'edit' && !refs.length){ deps.alert('图片编辑需要连接至少一张图片'); return; }
        const out = deps.outputForNode(node, 460);
        const run = deps.runSnapshot(node, prompt, refs);
        run.taskLabel = mode === 'blend' ? 'Midjourney 多图融合' : mode === 'edit' ? 'Midjourney 图片编辑' : `Midjourney v${node.version || '6.1'}`;
        run.startedAt = deps.nowMs();
        node.lastPrompt = prompt;
        node.running = true;
        node.runStatus = 'running';
        node.runError = '';
        deps.refreshRunNodes(node, out);
        try {
            const submitted = await midjourneyRequest(deps, '/api/midjourney/submit', {
                method:'POST', headers:{'Content-Type':'application/json'}, cascadeTargetId:deps.cascadeTargetIdFromOptions(opts),
                body:JSON.stringify({provider_id:providerId, mode, prompt, size:node.size, version:node.version, speed:node.speed, reference_images:refs.slice(0, 4)})
            });
            node.lastTaskId = submitted.task_id;
            node.lastAction = mode;
            node.lastTaskStatus = submitted.status || 'queued';
            deps.scheduleSave();
            const result = await waitMidjourneyTask(deps, providerId, submitted.task_id, opts);
            await completeMidjourneyRun(deps, node, out, run, result, Boolean(opts.cascade));
        } catch(error) {
            node.running = false;
            node.runStatus = 'failed';
            node.runError = error.message || String(error);
            node.lastTaskStatus = 'FAILED';
            deps.addGenerationLog({run, outputs:[], runMs:deps.nowMs() - run.startedAt, error:node.runError});
            deps.refreshRunNodes(node, out);
            deps.scheduleSave();
            if(opts.cascade) throw error;
            deps.showErrorModal(node.runError, 'Midjourney');
        }
    }

    async function runMidjourneyAction(deps, nodeId, action, index=0, extra={}){
        const node = deps.nodes.find(item => item.id === nodeId);
        if(!node?.lastTaskId || node.running) return;
        const providerId = deps.resolveMidjourneyProviderId(node.apiProvider || '');
        if(!providerId){ deps.showErrorModal('请先在 API 设置中添加 APIMart 平台。', 'Midjourney'); return; }
        const out = deps.outputForNode(node, 460);
        const run = deps.runSnapshot(node, '', []);
        const actionLabels = {upscale:`U${index}`, variation:`V${index}`, low_variation:'弱变体', high_variation:'强变体', remix_subtle:`轻微重塑 ${index}`, remix_strong:`强烈重塑 ${index}`, zoom:`扩图 ${extra.zoomRatio || 2}x`, pan:`平移 ${extra.direction || ''}`, inpaint:'局部重绘', reroll:'Reroll'};
        run.taskLabel = `Midjourney ${actionLabels[action] || action}`;
        run.startedAt = deps.nowMs();
        node.running = true;
        node.runStatus = 'running';
        deps.refreshRunNodes(node, out);
        try {
            const submitted = await midjourneyRequest(deps, '/api/midjourney/actions', {
                method:'POST', headers:{'Content-Type':'application/json'},
                body:JSON.stringify({provider_id:providerId, task_id:node.lastTaskId, action, index, speed:node.speed, prompt:node.lastPrompt || '', direction:extra.direction || '', zoom_ratio:extra.zoomRatio || null})
            });
            node.lastTaskId = submitted.task_id;
            node.lastAction = action;
            node.lastTaskStatus = submitted.status || 'queued';
            deps.scheduleSave();
            if(action === 'inpaint'){
                node.mjModalTaskId = submitted.task_id;
                node.mjModalPrompt = node.mjModalPrompt || node.lastPrompt || '';
                node.running = false;
                node.runStatus = '';
                deps.refreshRunNodes(node, out);
                deps.scheduleSave();
                return;
            }
            const result = await waitMidjourneyTask(deps, providerId, submitted.task_id);
            await completeMidjourneyRun(deps, node, out, run, result, true);
        } catch(error) {
            node.running = false;
            node.runStatus = 'failed';
            node.runError = error.message || String(error);
            node.lastTaskStatus = 'FAILED';
            deps.addGenerationLog({run, outputs:[], runMs:deps.nowMs() - run.startedAt, error:node.runError});
            deps.refreshRunNodes(node, out);
            deps.scheduleSave();
            deps.showErrorModal(node.runError, 'Midjourney');
        }
    }

    async function runMidjourneyModal(deps, nodeId, maskRef){
        const node = deps.nodes.find(item => item.id === nodeId);
        if(!node?.mjModalTaskId || !maskRef?.url || node.running) return;
        const providerId = deps.resolveMidjourneyProviderId(node.apiProvider || '');
        if(!providerId){ deps.showErrorModal('请先在 API 设置中添加 APIMart 平台。', 'Midjourney'); return; }
        const out = deps.outputForNode(node, 460);
        const prompt = String(node.mjModalPrompt || node.lastPrompt || '').trim();
        const run = deps.runSnapshot(node, prompt, [maskRef]);
        run.taskLabel = 'Midjourney 局部重绘';
        run.startedAt = deps.nowMs();
        node.running = true;
        node.runStatus = 'running';
        deps.refreshRunNodes(node, out);
        try {
            const submitted = await midjourneyRequest(deps, '/api/midjourney/modal', {
                method:'POST', headers:{'Content-Type':'application/json'},
                body:JSON.stringify({provider_id:providerId, task_id:node.mjModalTaskId, prompt, speed:node.speed, mask_image:maskRef})
            });
            node.lastTaskId = submitted.task_id;
            node.lastAction = 'inpaint';
            node.lastTaskStatus = submitted.status || 'submitted';
            node.mjModalTaskId = '';
            deps.scheduleSave();
            const result = await waitMidjourneyTask(deps, providerId, submitted.task_id);
            await completeMidjourneyRun(deps, node, out, run, result, true);
        } catch(error) {
            node.running = false;
            node.runStatus = 'failed';
            node.runError = error.message || String(error);
            deps.addGenerationLog({run, outputs:[], runMs:deps.nowMs() - run.startedAt, error:node.runError});
            deps.refreshRunNodes(node, out);
            deps.scheduleSave();
            deps.showErrorModal(node.runError, 'Midjourney');
        }
    }

    const api={midjourneyRequest, waitMidjourneyTask, completeMidjourneyRun, runMidjourneyNode, runMidjourneyAction, runMidjourneyModal};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.CanvasMidjourneyRunner=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
