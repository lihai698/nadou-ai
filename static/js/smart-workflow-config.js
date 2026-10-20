/* Workflow configuration responsibility: smart-workflow-config. Host supplies live state and effects. */
(function(root){
    'use strict';

    function runningHubProvider(deps){
        return (deps.apiProviders || []).find(p => p.id === 'runninghub' && p.enabled !== false) || null;
    }

    function runningHubEntries(deps, kind){
        const provider = runningHubProvider(deps);
        if(kind === 'model'){
            return (provider?.image_models || []).map(model => ({
                id:String(model || '').trim(),
                title:String(model || '').trim(),
                enabled:true
            })).filter(item => item.id);
        }
        const key = kind === 'workflow' ? 'rh_workflows' : 'rh_apps';
        return Array.isArray(provider?.[key]) ? provider[key].filter(item => item?.enabled !== false && item?.hidden !== true) : [];
    }

    function runningHubEntryId(deps, entry, kind){
        if(kind === 'model') return String(entry?.id || entry?.model || entry?.title || '').trim();
        return String(kind === 'workflow' ? (entry?.workflowId || entry?.id || '') : (entry?.appId || entry?.webappId || entry?.id || '')).trim();
    }

    function runningHubEntryLabel(deps, entry, kind){
        const id = runningHubEntryId(deps, entry, kind);
        if(kind === 'model') return entry?.title || entry?.name || id;
        return entry?.title || entry?.name || (kind === 'workflow' ? `Workflow ${id}` : `AI App ${id}`);
    }

    function runningHubEntryKey(deps, kind, id){
        return `${kind}:${String(id || '').trim()}`;
    }

    function parseRunningHubEntryKey(deps, value){
        const text = String(value || '').trim();
        const match = text.match(/^(app|workflow|model):(.+)$/);
        return match ? {kind:match[1], id:match[2].trim()} : null;
    }

    function runningHubAllEntries(deps){
        return [
            ...runningHubEntries(deps, 'model').map(entry => ({kind:'model', id:runningHubEntryId(deps, entry, 'model'), entry})).filter(x => x.id),
            ...runningHubEntries(deps, 'app').map(entry => ({kind:'app', id:runningHubEntryId(deps, entry, 'app'), entry})).filter(x => x.id),
            ...runningHubEntries(deps, 'workflow').map(entry => ({kind:'workflow', id:runningHubEntryId(deps, entry, 'workflow'), entry})).filter(x => x.id)
        ];
    }

    async function ensureComfyWorkflow(deps, name){
        if(!name) return null;
        if(deps.comfyWorkflowCache[name]) return deps.comfyWorkflowCache[name];
        const data = await deps.fetch(`/api/workflows/${encodeURIComponent(name)}`).then(r => r.ok ? r.json() : null).catch(() => null);
        if(data) deps.comfyWorkflowCache[name] = data;
        return data;
    }

    async function ensureRunningHubWorkflow(deps, workflowId, options={}){
        workflowId = String(workflowId || '').trim();
        if(!workflowId) return null;
        if(deps.runningHubWorkflowCache[workflowId]) return deps.runningHubWorkflowCache[workflowId];
        const res = await deps.fetch(`/api/runninghub/workflows/${encodeURIComponent(workflowId)}`);
        if(!res.ok){
            if(options.fetchRemote !== true) {
                delete deps.runningHubWorkflowCache[workflowId];
                return null;
            }
            const entry = runningHubEntries(deps, 'workflow').find(item => runningHubEntryId(deps, item, 'workflow') === workflowId);
            const remoteRes = await deps.fetch('/api/runninghub/workflows/fetch', {
                method:'POST',
                headers:{'Content-Type':'application/json'},
                body:JSON.stringify({
                    workflowId,
                    title:runningHubEntryLabel(deps, entry, 'workflow') || workflowId,
                    description:entry?.note || ''
                })
            }).catch(() => null);
            if(!remoteRes?.ok){
                delete deps.runningHubWorkflowCache[workflowId];
                return null;
            }
            const remoteData = await remoteRes.json().catch(() => null);
            const fetched = remoteData?.data;
            if(!fetched || !Array.isArray(fetched.fields)){
                delete deps.runningHubWorkflowCache[workflowId];
                return null;
            }
            deps.runningHubWorkflowCache[workflowId] = {
                workflowId,
                title:fetched.title || runningHubEntryLabel(deps, entry, 'workflow') || workflowId,
                description:fetched.description || entry?.note || '',
                fields:fetched.fields || [],
                workflowJson:fetched.workflowJson || {},
                optionalImageMode:entry?.optionalImageMode || 'prune-workflow',
            };
            return deps.runningHubWorkflowCache[workflowId];
        }
        const data = await res.json();
        deps.runningHubWorkflowCache[workflowId] = data.workflow || null;
        return deps.runningHubWorkflowCache[workflowId];
    }

    async function currentRunningHubWorkflowConfig(deps, sourceSettings=deps.settings){
        const ref = selectedRunningHubRef(deps, sourceSettings);
        if(ref?.kind !== 'workflow') return null;
        if(Array.isArray(sourceSettings?.rhFields) && sourceSettings.rhFields.length){
            return {
                ...(ref.entry || {}),
                workflowId:ref.id,
                fields:sourceSettings.rhFields,
                optionalImageMode:sourceSettings.rhOptionalImageMode || ref.entry?.optionalImageMode || 'prune-workflow',
                workflowJson:deps.rhWorkflowJsonFromSources(sourceSettings.rhWorkflowJson, ref.entry?.workflowJson)
            };
        }
        const cached = await ensureRunningHubWorkflow(deps, ref.id).catch(() => null);
        return {
            ...(ref.entry || {}),
            ...(cached || {}),
            workflowId:ref.id,
            fields:Array.isArray(cached?.fields) && cached.fields.length ? cached.fields : deps.rhEntryFields(ref.entry),
            optionalImageMode:ref.entry?.optionalImageMode || cached?.optionalImageMode || 'prune-workflow',
            workflowJson:deps.rhWorkflowJsonFromSources(cached?.workflowJson, ref.entry?.workflowJson)
        };
    }

    function selectedRunningHubRef(deps, sourceSettings=deps.settings){
        const all = runningHubAllEntries(deps);
        sourceSettings = sourceSettings || deps.settings;
        const parsed = parseRunningHubEntryKey(deps, sourceSettings.rhConfigKey || '');
        let ref = parsed ? all.find(item => item.kind === parsed.kind && item.id === parsed.id) : null;
        if(!ref && all.length) ref = all[0];
        if(ref && sourceSettings === deps.settings) deps.settings.rhConfigKey = runningHubEntryKey(deps, ref.kind, ref.id);
        return ref || null;
    }

    function runningHubSelectedModel(deps, sourceSettings=deps.settings){
        const ref = selectedRunningHubRef(deps, sourceSettings);
        return ref?.kind === 'model' ? ref.id : '';
    }

    function runningHubModelApiSettings(deps, sourceSettings=deps.settings){
        const model = runningHubSelectedModel(deps, sourceSettings);
        return {...(sourceSettings || deps.settings), engine:'api', apiKind:'image', provider_id:'runninghub', model};
    }

    function runningHubRunNeedsPrompt(deps, sourceSettings=deps.settings){
        if((sourceSettings || deps.settings).engine !== 'runninghub') return true;
        if(runningHubSelectedModel(deps, sourceSettings)) return true;
        const fields = deps.rhActiveFields(sourceSettings);
        const promptFields = fields.filter(field => deps.rhFieldRole(field) === 'prompt');
        if(!promptFields.length) return false;
        return promptFields.some(field => field.required === true && !deps.rhDefaultValue(field).trim());
    }

    function smartRunNeedsPrompt(deps, sourceSettings=deps.settings){
        sourceSettings = sourceSettings || deps.settings;
        if(sourceSettings.engine === 'runninghub') return runningHubRunNeedsPrompt(deps, sourceSettings);
        if(sourceSettings.engine === 'comfy' && sourceSettings.comfyMode === 'enhance') return false;
        return true;
    }

    function currentComfyFields(deps){
        return deps.comfyWorkflowCache[deps.settings.comfyWorkflow]?.config?.fields || [];
    }

    const api={runningHubProvider, runningHubEntries, runningHubEntryId, runningHubEntryLabel, runningHubEntryKey, parseRunningHubEntryKey, runningHubAllEntries, ensureComfyWorkflow, ensureRunningHubWorkflow, currentRunningHubWorkflowConfig, selectedRunningHubRef, runningHubSelectedModel, runningHubModelApiSettings, runningHubRunNeedsPrompt, smartRunNeedsPrompt, currentComfyFields};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.SmartWorkflowConfig=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
