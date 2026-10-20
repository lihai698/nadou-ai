/* Generation responsibility: smart-comfy-runner. Host supplies live state and effects. */
(function(root){
    'use strict';

    async function generateComfyUrlsWithSettings(deps, runSettings, prompt, refs, node){
        const allRefs = refs || [];
        const imageRefs = deps.imageRefsOnly(allRefs);
        const mode = runSettings.comfyMode || 'text';
        if(mode === 'text'){
            const data = await deps.runQueuedSmartComfyGenerate({prompt, width:Number(runSettings.width || 1024), height:Number(runSettings.height || 1024), workflow_json:'Z-Image.json', type:'zimage', client_id:deps.smartClientId}, node);
            const urls = deps.resultMediaUrls(data);
            return {urls, kind:deps.mediaKindForUrls(urls, 'image')};
        }
        if(mode === 'enhance'){
            if(!imageRefs.length) throw new Error(deps.tr('smart.errEnhanceNeedRefs'));
            const inputName = await deps.comfyNameForRef(imageRefs[0]);
            const data = await deps.runQueuedSmartComfyGenerate({workflow_json:'Z-Image-Enhance.json', type:'enhance', params:{"15":{image:inputName},"204":{value:Number(runSettings.enhanceStrength ?? 0.5)}}, client_id:deps.smartClientId}, node);
            const urls = deps.resultMediaUrls(data);
            return {urls, kind:deps.mediaKindForUrls(urls, 'image')};
        }
        if(mode === 'edit'){
            if(!imageRefs.length) throw new Error(deps.tr('smart.errEditNeedRefs'));
            const names = [];
            for(const ref of imageRefs.slice(0, 3)) names.push(await deps.comfyNameForRef(ref));
            const data = await deps.runQueuedSmartComfyGenerate({prompt, workflow_json:'Flux2-Klein.json', type:'klein', params:{"168":{text:prompt},"158":{noise_seed:Math.floor(Math.random()*1000000)},"278":{image:names[0] || ""},"270":{image:names[1] || ""},"292":{image:names[2] || ""},"313":{value:Boolean(names[1])},"314":{value:Boolean(names[2])}}, client_id:deps.smartClientId}, node);
            const urls = deps.resultMediaUrls(data);
            return {urls, kind:deps.mediaKindForUrls(urls, 'image')};
        }
        const workflowName = runSettings.comfyWorkflow || deps.comfyWorkflows[0]?.name || '';
        if(!workflowName) throw new Error(deps.tr('smart.errNeedWorkflow'));
        const wf = await deps.fetch(`/api/workflows/${encodeURIComponent(workflowName)}`).then(async r => {
            if(!r.ok) throw new Error(await r.text());
            return r.json();
        });
        const fields = wf.config?.fields || [];
        const values = {};
        fields.filter(f => deps.comfyFieldKind(f) === 'prompt').forEach((field, index) => {
            values[field.id] = index === 0 ? prompt : (field.default ?? '');
        });
        const assignMediaFields = async (mediaFields, mediaRefs) => {
            for(let i = 0; i < mediaFields.length && i < mediaRefs.length; i++){
                values[mediaFields[i].id] = await deps.comfyNameForRef(mediaRefs[i]);
            }
        };
        await assignMediaFields(fields.filter(f => deps.comfyFieldKind(f) === 'image'), imageRefs);
        await assignMediaFields(fields.filter(f => deps.comfyFieldKind(f) === 'video'), deps.videoRefsOnly(allRefs));
        await assignMediaFields(fields.filter(f => deps.comfyFieldKind(f) === 'audio'), deps.audioRefsOnly(allRefs));
        fields.filter(f => deps.comfyFieldKind(f) === 'setting').forEach(field => {
            if(deps.comfyRandomEnabledField(field) && deps.smartComfyRandomActiveFor(runSettings, field.id)){
                values[field.id] = deps.smartComfyRandomValue(field);
            } else {
                values[field.id] = runSettings.comfyParams?.[field.id] ?? field.default;
            }
        });
        const result = await deps.runQueuedSmartComfyGenerate({prompt, workflow_json:workflowName, params:deps.comfyParamsFromWorkflowValues(wf.config || {fields:[]}, values), type:'workflow-custom', client_id:deps.smartClientId}, node);
        const urls = deps.resultMediaUrls(result);
        const fallbackKind = result.videos?.length ? 'video' : result.audios?.length ? 'audio' : result.texts?.length ? 'text' : 'image';
        return {urls, kind:deps.mediaKindForUrls(urls, fallbackKind)};
    }

    async function runComfyGeneration(deps, node, prompt, refs, pendingNode, meta){
        const allRefs = refs || [];
        refs = deps.imageRefsOnly(allRefs);
        const mode = deps.settings.comfyMode || 'text';
        if(mode === 'text') return runComfyText(deps, node, prompt, pendingNode, meta);
        if(mode === 'enhance') return runComfyEnhance(deps, node, refs, pendingNode, meta);
        if(mode === 'edit') return runComfyEdit(deps, node, prompt, refs, pendingNode, meta);
        const workflowName = deps.settings.comfyWorkflow || deps.comfyWorkflows[0]?.name || '';
        if(!workflowName) throw new Error(deps.tr('smart.errNeedWorkflow'));
        const wf = await deps.fetch(`/api/workflows/${encodeURIComponent(workflowName)}`).then(async r => {
            if(!r.ok) throw new Error(await r.text());
            return r.json();
        });
        const fields = wf.config?.fields || [];
        const values = {};
        fields.filter(f => deps.comfyFieldKind(f) === 'prompt').forEach((field, index) => {
            values[field.id] = index === 0 ? prompt : (field.default ?? '');
        });
        const assignMediaFields = async (mediaFields, mediaRefs) => {
            for(let i = 0; i < mediaFields.length && i < mediaRefs.length; i++){
                values[mediaFields[i].id] = await deps.comfyNameForRef(mediaRefs[i]);
            }
        };
        await assignMediaFields(fields.filter(f => deps.comfyFieldKind(f) === 'image'), refs);
        await assignMediaFields(fields.filter(f => deps.comfyFieldKind(f) === 'video'), deps.videoRefsOnly(allRefs));
        await assignMediaFields(fields.filter(f => deps.comfyFieldKind(f) === 'audio'), deps.audioRefsOnly(allRefs));
        fields.filter(f => deps.comfyFieldKind(f) === 'setting').forEach(field => {
            if(deps.comfyRandomEnabledField(field) && deps.smartComfyRandomActive(field.id)){
                values[field.id] = deps.smartComfyRandomValue(field);
            } else {
                values[field.id] = deps.settings.comfyParams?.[field.id] ?? field.default;
            }
        });
        const result = await deps.runQueuedSmartComfyGenerate({prompt, workflow_json:workflowName, params:deps.comfyParamsFromWorkflowValues(wf.config || {fields:[]}, values), type:'workflow-custom', client_id:deps.smartClientId}, pendingNode);
        const urls = deps.resultMediaUrls(result);
        if(!urls.length) throw new Error(deps.tr('smart.errComfyNoImages'));
        const kind = deps.mediaKindForUrls(urls, result.videos?.length ? 'video' : result.audios?.length ? 'audio' : result.texts?.length ? 'text' : 'image');
        const ext = kind === 'video' ? 'mp4' : kind === 'audio' ? 'mp3' : 'png';
        const out = urls.map((url, i) => ({url, name:`comfy-${i + 1}.${ext}`, kind})).filter(x => x.url);
        if(!out.length) throw new Error(deps.tr('smart.errComfyEmpty'));
        const outputUrls = out.map(o => o.url);
        if(pendingNode){
            deps.finalizePendingNode(pendingNode, outputUrls, meta, kind);
        } else {
            const created = deps.createNode((node.x || 0) + deps.nodeRect(node).width + 40, node.y || 0, out);
            deps.attachRunMeta(created, meta);
            deps.addConnection(node.id, created.id);
        }
        deps.clearPromptInput({preserveDraft:true});
        deps.scheduleSave();
    }

    async function runComfyText(deps, node, prompt, pendingNode, meta){
        const data = await deps.runQueuedSmartComfyGenerate({prompt, width:Number(deps.settings.width || 1024), height:Number(deps.settings.height || 1024), workflow_json:'Z-Image.json', type:'zimage', client_id:deps.smartClientId}, pendingNode);
        const out = data.outputs || data.images || [];
        if(!out.length) throw new Error(deps.tr('smart.errComfyNoImages'));
        if(pendingNode){
            deps.finalizePendingNode(pendingNode, out, meta);
        } else {
            const created = deps.createNode((node.x || 0) + deps.nodeRect(node).width + 40, node.y || 0, out.map((url, i) => ({url, name:`comfy-${i + 1}.png`})));
            deps.attachRunMeta(created, meta);
            deps.addConnection(node.id, created.id);
        }
        deps.clearPromptInput({preserveDraft:true});
        deps.scheduleSave();
    }

    async function runComfyEnhance(deps, node, refs, pendingNode, meta){
        if(!refs.length) throw new Error(deps.tr('smart.errEnhanceNeedRefs'));
        const inputName = await deps.comfyNameForRef(refs[0]);
        const data = await deps.runQueuedSmartComfyGenerate({workflow_json:'Z-Image-Enhance.json', type:'enhance', params:{"15":{image:inputName},"204":{value:Number(deps.settings.enhanceStrength ?? 0.5)}}, client_id:deps.smartClientId}, pendingNode);
        const out = data.outputs || data.images || [];
        if(!out.length) throw new Error(deps.tr('smart.errComfyNoImages'));
        if(pendingNode){
            deps.finalizePendingNode(pendingNode, out, meta);
        } else {
            const created = deps.createNode((node.x || 0) + deps.nodeRect(node).width + 40, node.y || 0, out.map((url, i) => ({url, name:`enhance-${i + 1}.png`})));
            deps.attachRunMeta(created, meta);
            deps.addConnection(node.id, created.id);
        }
        deps.scheduleSave();
    }

    async function runComfyEdit(deps, node, prompt, refs, pendingNode, meta){
        if(!refs.length) throw new Error(deps.tr('smart.errEditNeedRefs'));
        const names = [];
        for(const ref of refs.slice(0, 3)) names.push(await deps.comfyNameForRef(ref));
        const data = await deps.runQueuedSmartComfyGenerate({prompt, workflow_json:'Flux2-Klein.json', type:'klein', params:{"168":{text:prompt},"158":{noise_seed:Math.floor(Math.random()*1000000)},"278":{image:names[0] || ""},"270":{image:names[1] || ""},"292":{image:names[2] || ""},"313":{value:Boolean(names[1])},"314":{value:Boolean(names[2])}}, client_id:deps.smartClientId}, pendingNode);
        const out = data.outputs || data.images || [];
        if(!out.length) throw new Error(deps.tr('smart.errComfyNoImages'));
        if(pendingNode){
            deps.finalizePendingNode(pendingNode, out, meta);
        } else {
            const created = deps.createNode((node.x || 0) + deps.nodeRect(node).width + 40, node.y || 0, out.map((url, i) => ({url, name:`edit-${i + 1}.png`})));
            deps.attachRunMeta(created, meta);
            deps.addConnection(node.id, created.id);
        }
        deps.clearPromptInput({preserveDraft:true});
        deps.scheduleSave();
    }

    const api={generateComfyUrlsWithSettings, runComfyGeneration, runComfyText, runComfyEnhance, runComfyEdit};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.SmartComfyRunner=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
