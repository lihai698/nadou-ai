/* Classic generation comfy. Host supplies instance state and effects. */
(function(root){
    'use strict';

    async function runComfyNode(deps, nodeId, opts={}){
        const node = deps.nodes.find(n => n.id === nodeId);
        if(!node || (node.running && !opts.cascade)) return;
        const cascadeTargetId = deps.cascadeTargetIdFromOptions(opts);
        const compiledNode = opts.assistantNativeActionId ? {...node,inputs:[...(node.inputs||[])],comfyParams:{...(node.comfyParams||{})}} : node;
        const sources = deps.orderedSources(compiledNode, deps.generatorSources(node));
        const prompt = sources.map(s => s.prompt).filter(Boolean).join('\n\n');
        const allRefs = sources.flatMap(s => s.refs || []);
        const refs = deps.imageRefsOnly(allRefs);
        const mode = node.mode || 'text';
        const customImageFields = mode === 'custom' ? deps.comfyFields(node, 'image') : [];
        const customVideoFields = mode === 'custom' ? deps.comfyFields(node, 'video') : [];
        const customAudioFields = mode === 'custom' ? deps.comfyFields(node, 'audio') : [];
        const customPromptFields = mode === 'custom' ? deps.comfyFields(node, 'prompt') : [];
        if((mode === 'text' || (mode === 'custom' && customPromptFields.length)) && !prompt){ deps.alert(deps.tr('canvas.needPrompt')); return; }
        if((mode !== 'text' && mode !== 'custom' && !refs.length) || (mode === 'custom' && refs.length < customImageFields.length)){ deps.alert(deps.tr('canvas.needImage')); return; }
        if(mode === 'custom' && deps.videoRefsOnly(allRefs).length < customVideoFields.length){ deps.alert(deps.langIsEn() ? 'Please connect enough video inputs for this ComfyUI workflow.' : '请为这个 ComfyUI 工作流连接足够的视频输入'); return; }
        if(mode === 'custom' && deps.audioRefsOnly(allRefs).length < customAudioFields.length){ deps.alert(deps.langIsEn() ? 'Please connect enough audio inputs for this ComfyUI workflow.' : '请为这个 ComfyUI 工作流连接足够的音频输入'); return; }
        let out = deps.outputForNode(node, 480);
        const pendingId = deps.uid('p');
        const run = deps.runSnapshot(node, prompt, refs);
        run.taskLabel = deps.comfyRunLabel(node);
        const assistantRun = opts.assistantNativeActionId ? (node.assistantNativeRun = {
            actionId:opts.assistantNativeActionId,
            taskKind:'comfy',
            taskIds:[],
            submissionStarted:false,
            unknownCount:0,
            warning:''
        }) : null;
        const comfyRunOptions = {
            cascadeTargetId,
            out,
            pendingId,
            beforeSubmit:opts.beforeSubmit,
            onAccepted:taskId=>{
                if(!assistantRun || !taskId)return;
                if(!assistantRun.taskIds.includes(taskId))assistantRun.taskIds.push(taskId);
            }
        };
        const requestSize = mode === 'text' ? {width:Number(node.width || 1024), height:Number(node.height || 1024)} : null;
        if(out) out._pending = [...(out._pending||[]), deps.makePendingForRun(pendingId, run, node, {refs, requestSize, cascadeTargetId, ...(assistantRun ? {assistantNativeActionId:assistantRun.actionId} : {})})];
        if(!opts.cascade){
            node.running = true;
            deps.refreshRunNodes(node, out);
            deps.setTimeout(() => { node.running = false; deps.refreshRunNodes(node, out); }, 2000);
        }
        else deps.refreshRunNodes(node, out);
        try {
            let images = [];
            if(mode === 'text'){
                run.taskLabel = deps.tr('canvas.comfyText');
                const result = await deps.runQueuedComfyGenerate({
                    prompt,
                    width:Number(node.width || 1024),
                    height:Number(node.height || 1024),
                    workflow_json:'Z-Image.json',
                    type:'zimage',
                    client_id:deps.CLIENT_ID
                }, comfyRunOptions);
                run.request = deps.requestMetaFromResult(result);
                images = deps.comfyResultOutputs(result);
            } else if(mode === 'enhance'){
                run.taskLabel = deps.tr('canvas.comfyEnhance');
                const inputName = await deps.comfyNameForRef(refs[0]);
                const enhance = await deps.runQueuedComfyGenerate({
                    workflow_json:'Z-Image-Enhance.json',
                    params:{
                        "15": { image:inputName },
                        "204": { value:Number(node.enhanceStrength ?? 0.5) }
                    },
                    type:'enhance',
                    client_id:deps.CLIENT_ID
                }, comfyRunOptions);
                run.request = deps.requestMetaFromResult(enhance);
                if(enhance.error) throw new Error(deps.actionFailed('canvas.comfyEnhance', enhance.error));
                if(!enhance.images?.length) throw new Error(deps.noReturnedImage('canvas.comfyEnhance'));
                if(node.enhanceUpscale){
                    images = await runComfyUpscale(deps, enhance.images?.[0], node.enhanceUpscaleRes || 2048, comfyRunOptions);
                } else {
                    images = enhance.images || [];
                }
            } else if(mode === 'custom'){
                const workflowName = deps.validComfyWorkflowName(node.comfyWorkflow || deps.comfyWorkflows[0]?.name || '');
                run.taskLabel = workflowName || deps.tr('canvas.comfyCustom');
                if(compiledNode.comfyWorkflow && compiledNode.comfyWorkflow !== workflowName) compiledNode.comfyWorkflow = workflowName;
                const wf = await deps.ensureComfyWorkflow(workflowName);
                if(!workflowName || !wf) throw new Error(deps.tr('canvas.comfyNoWorkflow'));
                const fields = wf?.config?.fields || [];
                const params = {};
                const imageFields = fields.filter(f => deps.comfyFieldKind(f) === 'image');
                const videoFields = fields.filter(f => deps.comfyFieldKind(f) === 'video');
                const audioFields = fields.filter(f => deps.comfyFieldKind(f) === 'audio');
                const promptFields = fields.filter(f => deps.comfyFieldKind(f) === 'prompt');
                const settingFields = fields.filter(f => deps.comfyFieldKind(f) === 'setting');
                const assignMediaFields = async (mediaFields, mediaRefs) => {
                    const names = [];
                    for(const ref of mediaRefs.slice(0, mediaFields.length)) names.push(await deps.comfyNameForRef(ref));
                    mediaFields.forEach((f, i) => {
                        if(!f.node || !f.input) return;
                        params[f.node] = params[f.node] || {};
                        params[f.node][f.input] = names[i] || '';
                    });
                };
                await assignMediaFields(imageFields, refs);
                await assignMediaFields(videoFields, deps.videoRefsOnly(allRefs));
                await assignMediaFields(audioFields, deps.audioRefsOnly(allRefs));
                promptFields.forEach(f => {
                    if(!f.node || !f.input) return;
                    params[f.node] = params[f.node] || {};
                    params[f.node][f.input] = prompt;
                });
                settingFields.forEach(f => {
                    if(!f.node || !f.input) return;
                    params[f.node] = params[f.node] || {};
                    if(deps.comfyRandomEnabled(f) && deps.comfyRandomActive(compiledNode, f.id)){
                        compiledNode.comfyParams = compiledNode.comfyParams || {};
                        compiledNode.comfyParams[f.id] = deps.comfyRandomValue(f);
                    }
                    params[f.node][f.input] = deps.comfyParamValue(compiledNode, f);
                });
                const result = await deps.runQueuedComfyGenerate({
                    prompt,
                    workflow_json:workflowName,
                    params,
                    type:'workflow-custom',
                    client_id:deps.CLIENT_ID
                    }, comfyRunOptions);
                run.request = deps.requestMetaFromResult(result);
                if(result.error) throw new Error(deps.actionFailed('canvas.comfyCustom', result.error));
                images = deps.comfyResultOutputs(result);
                if(!images.length) throw new Error(deps.noReturnedImage('canvas.comfyCustom'));
            } else {
                run.taskLabel = deps.tr('canvas.comfyEdit');
                const names = [];
                for (const ref of refs.slice(0, 3)) names.push(await deps.comfyNameForRef(ref));
                const result = await deps.runQueuedComfyGenerate({
                    prompt,
                    workflow_json:'Flux2-Klein.json',
                    type:'klein',
                    params:{
                        "168": { text:prompt },
                        "158": { noise_seed:Math.floor(Math.random() * 1000000) },
                        "278": { image:names[0] || "" },
                        "270": { image:names[1] || "" },
                        "292": { image:names[2] || "" },
                        "313": { value:Boolean(names[1]) },
                        "314": { value:Boolean(names[2]) }
                    },
                    client_id:deps.CLIENT_ID
                }, comfyRunOptions);
                run.request = deps.requestMetaFromResult(result);
                if(result.error) throw new Error(deps.actionFailed('canvas.comfyEdit', result.error));
                if(!result.images?.length) throw new Error(deps.noReturnedImage('canvas.comfyEdit'));
                images = node.editUpscale ? await runComfyUpscale(deps, result.images?.[0], node.editUpscaleRes || 2048, comfyRunOptions) : result.images || [];
            }
            const meta = deps.collectRunMeta(out, pendingId);
            if(out) out._pending = (out._pending||[]).filter(p => p.id !== pendingId);
            deps.appendOutputImages(out, images, refs[0], [meta]);
            deps.mergeGeneratedOutputs(node, images, Boolean(opts.cascade));
            deps.addGenerationLog({run, outputs:images, runMs:meta.runMs || 0});
            node.runStatus = 'done'; node.runError = '';
            deps.refreshRunNodes(node, out);
            deps.scheduleSave();
        } catch(err) {
            const meta = deps.collectRunMeta(out, pendingId);
            if(err.comfyTaskPaused || err.comfyTaskLost){
                node.runStatus = err.comfyTaskPaused ? 'query-paused' : 'task-lost';
                node.runError = err.message || '';
                deps.refreshRunNodes(node, out);
                if(opts.cascade) throw err;
                return;
            }
            deps.addGenerationLog({run, outputs:[], runMs:meta.runMs || 0, error:err.message || String(err)});
            if(out && !err.comfyTaskPaused && !err.comfyTaskLost) out._pending = (out._pending||[]).filter(p => p.id !== pendingId);
            if(deps.isCascadeAbortError(err)){
                deps.refreshRunNodes(node, out);
                if(opts.cascade) throw err;
                return;
            }
            node.runStatus = 'failed'; node.runError = err.message || String(err);
            deps.refreshRunNodes(node, out);
            if(opts.cascade) throw err;
            deps.alert(err.message || deps.actionFailed('canvas.comfyGenerate'));
        }
    }

    async function runComfyUpscale(deps, imageUrl, resolution, options={}){
        if(!imageUrl) throw new Error(deps.actionFailed('studio.superResolution', deps.langIsEn() ? 'missing input image' : '缺少输入图片'));
        const nextInput = await deps.uploadCanvasUrlToComfy(imageUrl);
        const upscale = await deps.runQueuedComfyGenerate({
            workflow_json:'upscale.json',
            params:{
                "15": { image:nextInput },
                "172": { seed:Math.floor(Math.random() * 4294967295), resolution:Number(resolution || 2048) }
            },
            type:'enhance',
            client_id:deps.CLIENT_ID
        }, options);
        if(upscale.error) throw new Error(deps.actionFailed('studio.superResolution', upscale.error));
        if(!upscale.images?.length) throw new Error(deps.noReturnedImage('studio.superResolution'));
        return upscale.images || [];
    }

    const api={runComfyNode, runComfyUpscale};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.CanvasComfyRunner=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
