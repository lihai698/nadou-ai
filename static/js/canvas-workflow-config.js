/* Workflow configuration responsibility: canvas-workflow-config. Host supplies live state and effects. */
(function(root){
    'use strict';

    function runningHubProvider(deps){
        const provider = (deps.apiProviders || []).find(p => p.id === 'runninghub');
        return provider || null;
    }

    function runningHubEntries(deps, kind){
        const provider = runningHubProvider(deps);
        if(kind === 'model'){
            return deps.uniqueModels(provider?.image_models || []).map(model => ({
                id:model,
                model,
                title:model,
                enabled:true,
                source:'model'
            }));
        }
        const key = kind === 'workflow' ? 'rh_workflows' : 'rh_apps';
        return Array.isArray(provider?.[key]) ? provider[key].filter(item => item?.enabled !== false && item?.hidden !== true) : [];
    }

    function runningHubEntryId(deps, entry, kind){
        if(kind === 'model') return String(typeof entry === 'string' ? entry : (entry?.model || entry?.id || entry?.name || '')).trim();
        return String(kind === 'workflow' ? (entry?.workflowId || entry?.id || '') : (entry?.appId || entry?.id || '')).trim();
    }

    function runningHubEntryLabel(deps, entry, kind){
        const id = runningHubEntryId(deps, entry, kind);
        if(kind === 'model') return entry?.title || entry?.name || id;
        return entry?.title || entry?.name || (kind === 'workflow' ? `工作流 ${id.slice(-6)}` : `AI 应用 ${id.slice(-6)}`);
    }

    function runningHubEntryKey(deps, kind, id){
        return `${kind}:${String(id || '').trim()}`;
    }

    function parseRunningHubEntryKey(deps, value){
        const text = String(value || '').trim();
        const match = text.match(/^(app|workflow|model):(.+)$/);
        if(match) return {kind:match[1], id:match[2]};
        return null;
    }

    function runningHubAllEntries(deps){
        return [
            ...runningHubEntries(deps, 'model').map(entry => ({kind:'model', id:runningHubEntryId(deps, entry, 'model'), entry})),
            ...runningHubEntries(deps, 'app').map(entry => ({kind:'app', id:runningHubEntryId(deps, entry, 'app'), entry})),
            ...runningHubEntries(deps, 'workflow').map(entry => ({kind:'workflow', id:runningHubEntryId(deps, entry, 'workflow'), entry}))
        ].filter(item => item.id);
    }

    async function ensureComfyWorkflow(deps, name){
        if(!hasComfyWorkflow(deps, name)) return null;
        if(deps.comfyWorkflowCache[name]) return deps.comfyWorkflowCache[name];
        const res = await deps.fetch(`/api/workflows/${encodeURIComponent(name)}`);
        if(!res.ok){
            delete deps.comfyWorkflowCache[name];
            return null;
        }
        const data = await res.json();
        deps.comfyWorkflowCache[name] = data;
        return data;
    }

    async function ensureRunningHubWorkflow(deps, workflowId){
        workflowId = validRunningHubWorkflowId(deps, workflowId);
        if(!workflowId) return null;
        if(deps.runningHubWorkflowCache[workflowId]) return deps.runningHubWorkflowCache[workflowId];
        const res = await deps.fetch(`/api/runninghub/workflows/${encodeURIComponent(workflowId)}`);
        if(!res.ok){
            delete deps.runningHubWorkflowCache[workflowId];
            return null;
        }
        const data = await res.json();
        deps.runningHubWorkflowCache[workflowId] = data.workflow || null;
        return deps.runningHubWorkflowCache[workflowId];
    }

    function currentRunningHubWorkflowConfig(deps, node){
        if(deps.rhCurrentKind(node) !== 'workflow') return null;
        const workflowId = validRunningHubWorkflowId(deps, node.workflowId || '');
        const entry = currentRunningHubWorkflowEntry(deps, node);
        if(entry){
            const cached = workflowId ? deps.runningHubWorkflowCache[workflowId] : null;
            return {
                ...entry,
                ...(cached || {}),
                workflowId:runningHubEntryId(deps, entry, 'workflow') || workflowId,
                title:entry.title || cached?.title || workflowId,
                fields:deps.rhEntryFields(entry).length ? deps.rhEntryFields(entry) : (cached?.fields || []),
                optionalImageMode:entry.optionalImageMode || cached?.optionalImageMode || 'prune-workflow',
                workflowJson:deps.rhWorkflowJsonFromSources(cached?.workflowJson, entry.workflowJson)
            };
        }
        return workflowId ? deps.runningHubWorkflowCache[workflowId] : null;
    }

    function hasComfyWorkflow(deps, name){
        return !!name && deps.comfyWorkflows.some(w => w.name === name);
    }

    function validComfyWorkflowName(deps, name){
        return hasComfyWorkflow(deps, name) ? name : (deps.comfyWorkflows[0]?.name || '');
    }

    function pruneMissingComfyWorkflows(deps){
        let changed = false;
        deps.nodes.filter(n => n.type === 'comfy').forEach(node => {
            if(node.comfyWorkflow && !hasComfyWorkflow(deps, node.comfyWorkflow)){
                delete deps.comfyWorkflowCache[node.comfyWorkflow];
                node.comfyWorkflow = '';
                changed = true;
            }
        });
        if(changed) deps.scheduleSave();
    }

    function currentComfyWorkflow(deps, node){
        const selected = validComfyWorkflowName(deps, node.comfyWorkflow || deps.comfyWorkflows[0]?.name || '');
        return deps.comfyWorkflowCache[selected] || null;
    }

    function validRunningHubWorkflowId(deps, workflowId){
        return String(workflowId || '').trim();
    }

    function currentRunningHubWorkflow(deps, node){
        const workflowId = validRunningHubWorkflowId(deps, node.workflowId || '');
        return deps.runningHubWorkflowCache[workflowId] || null;
    }

    function rhSelectedEntryRef(deps, node){
        const parsed = parseRunningHubEntryKey(deps, node?.rhConfigKey || '');
        const all = runningHubAllEntries(deps);
        if(parsed){
            const hit = all.find(item => item.kind === parsed.kind && item.id === parsed.id);
            if(hit) return hit;
        }
        const workflowId = validRunningHubWorkflowId(deps, node?.workflowId || '');
        if(workflowId){
            const hit = all.find(item => item.kind === 'workflow' && item.id === workflowId);
            if(hit) return hit;
        }
        const webappId = String(node?.webappId || '').trim();
        if(webappId){
            const hit = all.find(item => item.kind === 'app' && item.id === webappId);
            if(hit) return hit;
        }
        return null;
    }

    function applyRhEntrySelection(deps, node, ref){
        if(!node || !ref) return;
        node.rhConfigKey = runningHubEntryKey(deps, ref.kind, ref.id);
        node.rhMode = ref.kind;
        if(ref.kind === 'workflow') node.workflowId = ref.id;
        else if(ref.kind === 'app') node.webappId = ref.id;
        else if(ref.kind === 'model'){
            node.rhModel = ref.id;
            node.model = ref.id;
            node.apiProvider = 'runninghub';
            node.resolution = node.resolution || deps.defaultApiImageResolution(ref.id);
            node.ratio = node.ratio || 'square';
            node.quality = node.quality || 'auto';
            node.count = Math.max(1, Math.min(8, Number(node.count || 1)));
        }
    }

    function currentRunningHubAppConfig(deps, node){
        const webappId = String(node?.webappId || '').trim();
        if(!webappId) return null;
        return runningHubEntries(deps, 'app').find(app => runningHubEntryId(deps, app, 'app') === webappId) || null;
    }

    function currentRunningHubWorkflowEntry(deps, node){
        const workflowId = validRunningHubWorkflowId(deps, node?.workflowId || '');
        if(!workflowId) return null;
        return runningHubEntries(deps, 'workflow').find(workflow => runningHubEntryId(deps, workflow, 'workflow') === workflowId) || null;
    }

    function ensureRhNodeSelection(deps, node){
        if(!node || node.type !== 'rh') return null;
        node.rhPayment = node.rhPayment || 'free';
        const all = runningHubAllEntries(deps);
        let ref = rhSelectedEntryRef(deps, node);
        if(!ref && all.length) ref = all[0];
        if(ref){
            applyRhEntrySelection(deps, node, ref);
            return ref.entry;
        }
        return null;
    }

    async function ensureRunningHubWorkflowConfigForNode(deps, node){
        if(deps.rhCurrentKind(node) !== 'workflow') return null;
        const workflowId = validRunningHubWorkflowId(deps, node.workflowId || '');
        if(!workflowId) return null;
        if(!deps.runningHubWorkflowCache[workflowId]){
            try { await ensureRunningHubWorkflow(deps, workflowId); } catch(_) {}
        }
        return currentRunningHubWorkflowConfig(deps, node);
    }

    async function rhFetchAppInfo(deps, nodeId, showAlert=true){
        const node = deps.nodes.find(n => n.id === nodeId);
        if(!node) return;
        if(!String(node.webappId || '').trim()){
            if(showAlert) deps.alert(deps.tr('canvas.rhNeedWebappId'));
            return false;
        }
        node.rhFetching = true;
        deps.refreshNodes([node.id]);
        try {
            const res = await deps.fetch(`/api/runninghub/app-info?webappId=${encodeURIComponent(node.webappId.trim())}`);
            const data = await res.json();
            if(!res.ok || data.success === false) throw new Error(data.detail || data.error || deps.tr('canvas.rhFailed'));
            node.rhAppInfo = data.data || {};
            node.rhParams = node.rhParams || {};
            (node.rhAppInfo.nodeInfoList || []).forEach(field => {
                const key = deps.rhParamKey(field.nodeId, field.fieldName);
                if(!node.rhParams[key]) node.rhParams[key] = {value:deps.rhDefaultValue(field)};
            });
            node.runStatus = '';
            node.runError = '';
            deps.scheduleSave();
            return true;
        } catch(err) {
            if(showAlert) deps.alert(err.message || deps.tr('canvas.rhFailed'));
            return false;
        } finally {
            node.rhFetching = false;
            deps.refreshNodes([node.id]);
        }
    }

    async function rhFetchWorkflowInfo(deps, nodeId, showAlert=true){
        const node = deps.nodes.find(n => n.id === nodeId);
        if(!node) return false;
        if(!String(node.workflowId || '').trim()){
            if(showAlert) deps.alert(deps.tr('canvas.rhNeedWorkflowId'));
            return false;
        }
        node.rhFetching = true;
        deps.refreshNodes([node.id]);
        try {
            const saved = await ensureRunningHubWorkflow(deps, node.workflowId.trim());
            const res = await deps.fetch(`/api/runninghub/workflow-info?workflowId=${encodeURIComponent(node.workflowId.trim())}`);
            const data = await res.json();
            if(!res.ok || data.success === false) throw new Error(data.detail || data.error || deps.tr('canvas.rhFailed'));
            const info = data.data || {};
            const savedFields = Array.isArray(saved?.fields) ? saved.fields : [];
            const mergedFields = savedFields.length
                ? savedFields
                : Array.isArray(info.nodeInfoList) ? info.nodeInfoList : [];
            node.rhWorkflowInfo = {
                workflowId:node.workflowId.trim(),
                nodeInfoList:mergedFields,
                raw:info.raw || null
            };
            node.rhParams = node.rhParams || {};
            (node.rhWorkflowInfo.nodeInfoList || []).forEach(field => {
                const key = deps.rhParamKey(field.nodeId, field.fieldName);
                if(!node.rhParams[key]) node.rhParams[key] = {value:deps.rhDefaultValue(field)};
            });
            node.runStatus = '';
            node.runError = '';
            deps.scheduleSave();
            return true;
        } catch(err) {
            if(showAlert) deps.alert(err.message || deps.tr('canvas.rhFailed'));
            return false;
        } finally {
            node.rhFetching = false;
            deps.refreshNodes([node.id]);
        }
    }

    async function rhImportWorkflowJson(deps, nodeId, file){
        const node = deps.nodes.find(n => n.id === nodeId);
        if(!node || !file) return;
        try {
            const text = await file.text();
            const json = JSON.parse(text);
            const nodeInfoList = deps.rhWorkflowNodeInfoList(json);
            if(!nodeInfoList.length) throw new Error(deps.tr('canvas.rhWorkflowJsonInvalid'));
            node.rhMode = 'workflow';
            node.rhWorkflowInfo = {fileName:file.name || 'api.json', nodeInfoList};
            node.rhParams = node.rhParams || {};
            nodeInfoList.forEach(field => {
                const key = deps.rhParamKey(field.nodeId, field.fieldName);
                if(!node.rhParams[key]) node.rhParams[key] = {value:deps.rhDefaultValue(field)};
            });
            node.runStatus = '';
            node.runError = '';
            deps.render();
            deps.scheduleSave();
        } catch(err) {
            deps.alert(err.message || deps.tr('canvas.rhWorkflowJsonInvalid'));
        }
    }

    const api={runningHubProvider, runningHubEntries, runningHubEntryId, runningHubEntryLabel, runningHubEntryKey, parseRunningHubEntryKey, runningHubAllEntries, ensureComfyWorkflow, ensureRunningHubWorkflow, currentRunningHubWorkflowConfig, hasComfyWorkflow, validComfyWorkflowName, pruneMissingComfyWorkflows, currentComfyWorkflow, validRunningHubWorkflowId, currentRunningHubWorkflow, rhSelectedEntryRef, applyRhEntrySelection, currentRunningHubAppConfig, currentRunningHubWorkflowEntry, ensureRhNodeSelection, ensureRunningHubWorkflowConfigForNode, rhFetchAppInfo, rhFetchWorkflowInfo, rhImportWorkflowJson};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.CanvasWorkflowConfig=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
