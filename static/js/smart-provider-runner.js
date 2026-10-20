/* Generation responsibility: smart-provider-runner. Host supplies live state and effects. */
(function(root){
    'use strict';

    function smartCompactJson(deps, value, max=4200){
        let text = '';
        try {
            text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
        } catch(e) {
            text = String(value || '');
        }
        text = String(text || '').trim();
        return text.length > max ? `${text.slice(0, max)}...` : text;
    }

    function smartDetailedError(deps, message, details={}){
        const err = new Error(String(message || deps.tr('smart.errRunFailed')));
        err.smartDetails = details || {};
        if(details?.taskId) err.taskId = details.taskId;
        return err;
    }

    function runningHubPayloadError(deps, stage, data, fallback, extra={}){
        const detailObj = data?.detail && typeof data.detail === 'object' ? data.detail : null;
        const rawDetail = detailObj?.message || data?.detail || data?.error || data?.message || data?.failReason || data?.msg || fallback || deps.tr('smart.rhFailed');
        const detail = typeof rawDetail === 'object' ? smartCompactJson(deps, rawDetail, 1200) : String(rawDetail || '');
        const raw = detailObj?.raw || data?.raw || data?.data?.raw || data;
        const code = detailObj?.code ?? data?.code ?? data?.data?.code ?? raw?.code ?? '';
        const taskId = detailObj?.taskId || detailObj?.task_id || data?.taskId || data?.task_id || data?.data?.taskId || extra.taskId || '';
        const parts = [`RunningHub ${stage}失败`, detail].filter(Boolean);
        if(taskId) parts.push(`taskId=${taskId}`);
        if(code !== '') parts.push(`code=${code}`);
        return smartDetailedError(deps, parts.join('：'), {stage, taskId, code, raw, ...(detailObj || {}), ...extra});
    }

    async function runRunningHubGeneration(deps, prompt, refs, runSettings=deps.settings){
        const ref = deps.selectedRunningHubRef(runSettings);
        if(!ref) throw new Error(deps.tr('smart.rhNeedConfig'));
        const fields = deps.rhActiveFields(runSettings);
        if(!fields.length) throw new Error(deps.tr('smart.rhNeedFields'));
        const randomValues = {};
        const mode = ref.kind;
        const media = deps.rhMediaForRun(prompt, refs);
        const nodeInfoList = await deps.rhBuildNodeInfoList(media, runSettings, randomValues);
        const workflowExtras = mode === 'workflow' ? await deps.rhBuildWorkflowRequestExtras(media, nodeInfoList, runSettings) : {};
        const endpoint = mode === 'workflow' ? '/api/runninghub/workflow-submit' : '/api/runninghub/submit';
        const body = mode === 'workflow'
            ? {workflowId:ref.id, nodeInfoList, useWallet:runSettings.rhPayment === 'wallet', ...workflowExtras}
            : {webappId:ref.id, nodeInfoList, instanceType:runSettings.rhInstanceType || '', useWallet:runSettings.rhPayment === 'wallet'};
        if(mode === 'workflow') runSettings.rhWorkflowId = ref.id;
        else runSettings.rhAppId = ref.id;
        runSettings.rhMode = mode;
        const submit = await deps.fetch(endpoint, {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify(body)
        }).then(async r => {
            const data = await r.clone().json().catch(async () => ({detail:await r.text().catch(() => '')}));
            if(!r.ok || data.success === false) throw runningHubPayloadError(deps, '提交', data, deps.tr('smart.rhFailed'), {
                endpoint,
                workflowId:body.workflowId || '',
                webappId:body.webappId || '',
                nodeInfoList:nodeInfoList.slice(0, 40),
                hasWorkflow:Boolean(body.workflow)
            });
            return data.data || data;
        });
        const taskId = submit.taskId;
        if(!taskId) throw new Error(deps.tr('smart.rhNoTaskId'));
        runSettings.rhTaskId = taskId;
        const useWallet = runSettings.rhPayment === 'wallet';
        for(let i = 0; i < 720; i++){
            await deps.sleep(2500);
            const data = await deps.fetch(`/api/runninghub/query?taskId=${encodeURIComponent(taskId)}&useWallet=${useWallet ? '1' : '0'}`).then(async r => {
                const json = await r.clone().json().catch(async () => ({detail:await r.text().catch(() => '')}));
                if(!r.ok || json.success === false) throw runningHubPayloadError(deps, '查询', json, deps.tr('smart.rhFailed'), {taskId});
                return json.data || json;
            });
            if(data.status === 'SUCCESS'){
                const urls = deps.resultMediaUrls(data.image_items?.length ? data.image_items : (data.urls || []));
                if(!urls.length) throw new Error(deps.tr('smart.rhOutputsEmpty'));
                return urls;
            }
            if(data.status === 'FAILED') throw runningHubPayloadError(deps, '执行', data, data.failReason || deps.tr('smart.rhFailed'), {taskId});
        }
        throw new Error(deps.tr('smart.rhTimeout'));
    }

    async function runModelscopeGeneration(deps, prompt, refs, runSettings=deps.settings){
        refs = deps.imageRefsOnly(refs);
        const modelKey = runSettings.msgenModel || 'zimage';
        const msModel = deps.MS_GEN_MODELS[modelKey] || deps.MS_GEN_MODELS.zimage;
        if(msModel.supportsImage && !refs.length) throw new Error(deps.tr('smart.errMsNeedRefs'));
        const size = deps.apiImageSize(runSettings.msRatio || 'square', runSettings.msResolution || '1k', runSettings.msCustomRatio || '', runSettings.msCustomSize || '');
        const parsed = deps.parseSizeValue(size);
        const width = Number(parsed?.width) || 1024;
        const height = Number(parsed?.height) || 1024;
        const imageUrls = [];
        if(msModel.supportsImage || msModel.acceptsImage){
            for(const ref of refs.slice(0, deps.SMART_REFERENCE_IMAGE_MAX)){
                if(ref.url) imageUrls.push(await deps.urlToBase64(ref.url).catch(() => ref.url));
            }
        }
        const count = Math.max(1, Math.min(8, Number(runSettings.count || 1)));
        const submit = async () => {
            let body;
            if(modelKey === 'zimage') body = {prompt, resolution:`${width}x${height}`};
            else if(modelKey === 'qwen_edit') body = {prompt, image_urls:imageUrls, resolution:`${width}x${height}`};
            else body = {prompt, model:modelKey === 'custom' ? (runSettings.msCustomModel || deps.modelscopeImageModels()[0]) : msModel.modelId, image_urls:imageUrls, width, height, size:`${width}x${height}`};
            const data = await deps.fetch(msModel.endpoint, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)}).then(async r => {
                if(!r.ok) throw new Error(await r.text());
                return r.json();
            });
            return data.url || data.images?.[0] || '';
        };
        const results = await Promise.all(Array.from({length:count}, submit));
        return results.filter(Boolean);
    }

    const api={smartCompactJson, smartDetailedError, runningHubPayloadError, runRunningHubGeneration, runModelscopeGeneration};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.SmartProviderRunner=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
