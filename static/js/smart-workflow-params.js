/* Workflow parameter responsibility: smart-workflow-params. Host supplies live state and effects. */
(function(root){
    'use strict';

    function rhParamKey(deps, nodeId, fieldName){
        return `${nodeId ?? ''}::${fieldName ?? ''}`;
    }

    function rhFieldKind(deps, field){
        const type = String(field?.fieldType || '').trim().toUpperCase();
        if(type === 'IMAGE') return 'image';
        if(type === 'VIDEO') return 'video';
        if(type === 'AUDIO') return 'audio';
        if(type === 'SLIDER') return 'slider';
        if(['NUMBER','FLOAT','INTEGER','INT'].includes(type)) return 'number';
        if(['BOOLEAN','BOOL'].includes(type)) return 'boolean';
        const key = `${field?.fieldName || ''} ${field?.fieldValue || ''}`.toLowerCase();
        if(/\b(image|img|mask|photo|picture)\b/.test(key) || /\.(png|jpe?g|webp|gif|bmp)(\?|$)/i.test(key)) return 'image';
        if(/\b(video|movie|mp4)\b/.test(key) || /\.(mp4|webm|mov|m4v|mkv)(\?|$)/i.test(key)) return 'video';
        if(/\b(audio|sound|music|voice)\b/.test(key) || /\.(mp3|wav|ogg|m4a|flac|aac)(\?|$)/i.test(key)) return 'audio';
        return 'text';
    }

    function rhFieldRole(deps, field){
        const kind = rhFieldKind(deps, field);
        if(['image','video','audio','number','slider','boolean'].includes(kind)) return kind;
        const text = `${field?.fieldName || ''} ${field?.label || ''} ${field?.group || ''}`.toLowerCase();
        if(/prompt|positive|negative|text|caption|description|关键词|提示词|正向|负向/.test(text)) return 'prompt';
        return 'text';
    }

    function rhExtractFieldOptions(deps, field){
        const candidates = [field?.fieldData, field?.options, field?.list, field?.values, field?.enum, field?.choices, field?.items, field?.selectOptions, field?.dropdown];
        for(const candidate of candidates){
            if(!Array.isArray(candidate) || !candidate.length) continue;
            if(candidate.every(x => ['string','number'].includes(typeof x))) return candidate.map(String);
            if(candidate.every(x => x && typeof x === 'object' && ('value' in x || 'label' in x || 'name' in x))){
                return candidate.map(x => x.value ?? x.label ?? x.name).filter(v => v !== undefined && v !== null).map(String);
            }
        }
        const name = String(field?.fieldName || '').trim();
        if(name){
            if(deps.RH_KNOWN_FIELD_OPTIONS[name]) return deps.RH_KNOWN_FIELD_OPTIONS[name].map(String);
            const hit = Object.keys(deps.RH_KNOWN_FIELD_OPTIONS).find(k => k.toLowerCase() === name.toLowerCase());
            if(hit) return deps.RH_KNOWN_FIELD_OPTIONS[hit].map(String);
        }
        return null;
    }

    function rhDefaultValue(deps, field){
        let value = field?.fieldValue;
        if(Array.isArray(value)) value = value[0];
        if(value === undefined || value === null || typeof value === 'object') return '';
        return String(value);
    }

    function rhRandomEnabled(deps, field){
        return rhFieldKind(deps, field) === 'number' && field?.random_enabled === true;
    }

    function rhIsWorkflowLinkValue(deps, value){
        return Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && Number.isInteger(value[1]);
    }

    function rhEntryFields(deps, entry){
        return Array.isArray(entry?.fields) ? entry.fields : [];
    }

    function rhWorkflowJsonFromSources(deps, ...sources){
        for(const source of sources){
            if(source && typeof source === 'object' && Object.keys(source).length) return source;
        }
        return {};
    }

    function rhCurrentKind(deps, sourceSettings=deps.settings){
        return deps.selectedRunningHubRef(sourceSettings)?.kind || 'app';
    }

    function rhUsableFields(deps, fields){
        const list = Array.isArray(fields) ? fields : [];
        if(!list.length) return [];
        const enabled = list.filter(f => f.enabled === true);
        return enabled.length ? enabled : list;
    }

    function rhActiveFields(deps, sourceSettings=deps.settings){
        const ref = deps.selectedRunningHubRef(sourceSettings);
        let fields = Array.isArray(sourceSettings?.rhFields) && sourceSettings.rhFields.length
            ? sourceSettings.rhFields
            : rhEntryFields(deps, ref?.entry);
        if(ref?.kind === 'workflow' && !(Array.isArray(sourceSettings?.rhFields) && sourceSettings.rhFields.length)){
            const cached = deps.runningHubWorkflowCache[ref.id];
            if(Array.isArray(cached?.fields) && cached.fields.length) fields = cached.fields;
        }
        fields = rhUsableFields(deps, fields);
        return deps.sortRunningHubFields(fields);
    }

    function rhFieldIndexes(deps, fields){
        const counters = {image:0, video:0, audio:0};
        const map = {};
        deps.sortRunningHubFields(fields).forEach(field => {
            const kind = rhFieldKind(deps, field);
            if(['image','video','audio'].includes(kind)){
                map[rhParamKey(deps, field.nodeId, field.fieldName)] = counters[kind]++;
            }
        });
        return map;
    }

    function rhRequiredLabel(deps, field){
        return field?.label || field?.fieldName || `#${field?.nodeId || ''}`;
    }

    function rhPruneWorkflowForMissingFields(deps, workflowJson, missingFields){
        if(!workflowJson || typeof workflowJson !== 'object' || !missingFields?.length) return null;
        const workflow = JSON.parse(JSON.stringify(workflowJson));
        const removeIds = new Set();
        missingFields.forEach(field => {
            const node = workflow[String(field.nodeId)];
            if(node?.inputs && Object.prototype.hasOwnProperty.call(node.inputs, field.fieldName)){
                delete node.inputs[field.fieldName];
            }
            if(node && (!node.inputs || !Object.keys(node.inputs).length)){
                removeIds.add(String(field.nodeId));
            }
        });
        removeIds.forEach(id => delete workflow[id]);
        Object.values(workflow).forEach(node => {
            if(!node?.inputs || typeof node.inputs !== 'object') return;
            Object.entries(node.inputs).forEach(([name, value]) => {
                if(rhIsWorkflowLinkValue(deps, value) && removeIds.has(String(value[0]))) delete node.inputs[name];
            });
        });
        return workflow;
    }

    async function rhBuildWorkflowRequestExtras(deps, media, nodeInfoList, sourceSettings=deps.settings){
        const config = await deps.currentRunningHubWorkflowConfig(sourceSettings);
        if(!config) return {};
        const fields = rhActiveFields(deps, sourceSettings);
        if((config.optionalImageMode || 'prune-workflow') !== 'prune-workflow'){
            const workflow = rhApplyNodeInfoListToWorkflow(deps, config.workflowJson || {}, nodeInfoList);
            return workflow ? {workflow} : {};
        }
        const indexes = rhFieldIndexes(deps, fields);
        const missingOptional = [];
        for(const field of fields){
            const kind = rhFieldKind(deps, field);
            if(!['image','video','audio'].includes(kind)) continue;
            const key = rhParamKey(deps, field.nodeId, field.fieldName);
            const idx = indexes[key] || 0;
            const hasInput = Boolean(media[kind]?.[idx]?.url);
            const kindLabel = kind === 'image' ? '图片' : kind === 'video' ? '视频' : '音频';
            if(field.required === true && !hasInput) throw new Error(`RunningHub 工作流缺少必选${kindLabel}：${rhRequiredLabel(deps, field)}`);
            if(field.required !== true && !hasInput) missingOptional.push(field);
        }
        if(!missingOptional.length){
            const workflow = rhApplyNodeInfoListToWorkflow(deps, config.workflowJson || {}, nodeInfoList);
            return workflow ? {workflow} : {};
        }
        missingOptional.forEach(field => {
            const key = rhParamKey(deps, field.nodeId, field.fieldName);
            const idx = nodeInfoList.findIndex(item => rhParamKey(deps, item.nodeId, item.fieldName) === key);
            if(idx >= 0) nodeInfoList.splice(idx, 1);
        });
        const workflow = rhApplyNodeInfoListToWorkflow(deps, rhPruneWorkflowForMissingFields(deps, config.workflowJson || {}, missingOptional), nodeInfoList);
        return workflow ? {workflow} : {};
    }

    async function rhUploadValueIfNeeded(deps, value, sourceSettings=deps.settings){
        const text = String(value || '').trim();
        if(!text) return '';
        if(!/^https?:\/\//i.test(text) && !text.startsWith('/output/') && !text.startsWith('/assets/')) return text;
        const res = await deps.fetch('/api/runninghub/upload-asset', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({url:text, useWallet:(sourceSettings || deps.settings).rhPayment === 'wallet'})
        });
        const data = await res.json();
        if(!res.ok || data.success === false) throw new Error(data.detail || data.error || deps.tr('smart.rhUploadFailed'));
        return data.data?.fileName || text;
    }

    async function rhBuildNodeInfoList(deps, media, sourceSettings=deps.settings, randomValues=deps.smartRhRandomValues){
        const fields = rhActiveFields(deps, sourceSettings);
        const result = [];
        const indexes = rhFieldIndexes(deps, fields);
        const mode = rhCurrentKind(deps, sourceSettings);
        const explicitParams = sourceSettings?.rhParams || {};
        for(const field of fields){
            const kind = rhFieldKind(deps, field);
            const key = rhParamKey(deps, field.nodeId, field.fieldName);
            if(mode === 'workflow' && field.sourceFromUpstream === false && !['image','video','audio'].includes(kind)) continue;
            if(mode === 'workflow' && !Object.prototype.hasOwnProperty.call(explicitParams, key) && rhLooksLikeComplexDefault(deps, field) && !['image','video','audio'].includes(kind) && rhFieldRole(deps, field) !== 'prompt') continue;
            if(mode === 'workflow' && ['image','video','audio'].includes(kind)){
                const idx = indexes[key] || 0;
                if(field.required !== true && !media[kind]?.[idx]?.url) continue;
            }
            let value = rhParamValue(deps, field, media, sourceSettings, fields, randomValues);
            if(rhFieldRole(deps, field) === 'prompt' && !String(value || '').trim()) value = rhDefaultValue(deps, field);
            if(['image','video','audio'].includes(kind)) value = await rhUploadValueIfNeeded(deps, value, sourceSettings);
            if(['number','slider'].includes(kind) && String(value ?? '').trim() !== '' && !Number.isNaN(Number(value))) value = Number(value);
            result.push({nodeId:field.nodeId, fieldName:field.fieldName, fieldValue:value});
        }
        return result;
    }

    function smartRhRandomActive(deps, key){
        return smartRhRandomActiveFor(deps, deps.settings, key);
    }

    function smartRhRandomActiveFor(deps, sourceSettings=deps.settings, key){
        sourceSettings = sourceSettings || deps.settings;
        sourceSettings.rhRandomActive = sourceSettings.rhRandomActive || {};
        return sourceSettings.rhRandomActive[key] !== false;
    }

    function smartRhRandomValue(deps, field){
        return smartComfyRandomValue(deps, {
            input:field.fieldName,
            name:field.label || field.fieldName,
            min:field.min,
            max:field.max,
            step:field.step,
            type:'number'
        });
    }

    function rhParamValue(deps, field, media=null, sourceSettings=deps.settings, fields=null, randomValues=deps.smartRhRandomValues){
        sourceSettings = sourceSettings || deps.settings;
        sourceSettings.rhParams = sourceSettings.rhParams || {};
        const key = rhParamKey(deps, field.nodeId, field.fieldName);
        const param = sourceSettings.rhParams[key];
        const kind = rhFieldKind(deps, field);
        if(['image','video','audio'].includes(kind)){
            const idx = rhFieldIndexes(deps, fields || rhActiveFields(deps, sourceSettings))[key] || 0;
            const up = media?.[kind]?.[idx]?.url || '';
            if(rhCurrentKind(deps, sourceSettings) === 'workflow' && kind === 'image' && field.required !== true && !up) return '';
            return up || param?.value || rhDefaultValue(deps, field);
        }
        if(rhRandomEnabled(deps, field) && smartRhRandomActiveFor(deps, sourceSettings, key)){
            if(randomValues[key] === undefined) randomValues[key] = smartRhRandomValue(deps, field);
            return randomValues[key];
        }
        if(rhFieldRole(deps, field) === 'prompt') return param?.value ?? (media?.prompt || rhDefaultValue(deps, field));
        return param?.value ?? rhDefaultValue(deps, field);
    }

    function rhUserParamValue(deps, field){
        deps.settings.rhParams = deps.settings.rhParams || {};
        const key = rhParamKey(deps, field.nodeId, field.fieldName);
        return deps.settings.rhParams[key]?.value ?? '';
    }

    function rhApplyNodeInfoListToWorkflow(deps, workflowJson, nodeInfoList){
        if(!workflowJson || typeof workflowJson !== 'object' || !Object.keys(workflowJson).length) return null;
        const workflow = JSON.parse(JSON.stringify(workflowJson));
        (nodeInfoList || []).forEach(item => {
            const node = workflow[String(item?.nodeId || '')];
            if(!node?.inputs || typeof node.inputs !== 'object') return;
            const fieldName = String(item?.fieldName || '');
            if(!fieldName || !Object.prototype.hasOwnProperty.call(node.inputs, fieldName)) return;
            node.inputs[fieldName] = item.fieldValue;
        });
        return workflow;
    }

    function rhLooksLikeComplexDefault(deps, field){
        const text = rhDefaultValue(deps, field).trim();
        if(!/^[{[]/.test(text)) return false;
        try {
            const parsed = JSON.parse(text);
            return parsed && typeof parsed === 'object';
        } catch(e) {
            return false;
        }
    }

    function comfyRandomEnabledField(deps, field){ return field?.type === 'number' && field.random_enabled === true; }

    function smartComfyRandomActive(deps, fieldId){
        return smartComfyRandomActiveFor(deps, deps.settings, fieldId);
    }

    function smartComfyRandomActiveFor(deps, source, fieldId){
        const active = source?.comfyRandomActive || {};
        return active[fieldId] !== false;
    }

    function smartComfyRandomValue(deps, field){
        const isFloat = Number(field.step) > 0 && Number(field.step) < 1;
        let min = Number.isFinite(Number(field.min)) ? Number(field.min) : null;
        let max = Number.isFinite(Number(field.max)) ? Number(field.max) : null;
        const name = `${field.input || ''} ${field.name || ''}`.toLowerCase();
        const looksSeed = name.includes('seed') || name.includes('noise') || name.includes('随机') || name.includes('噪');
        if(min === null) min = looksSeed ? 1 : 0;
        if(max === null || max <= min) max = looksSeed ? 4294967295 : 999999;
        if(looksSeed) max = Math.min(max, 4294967295);
        const value = min + Math.random() * (max - min);
        if(isFloat){
            const precision = Math.min(8, Math.max(1, String(field.step).split('.')[1]?.length || 2));
            return Number(value.toFixed(precision));
        }
        return Math.floor(value);
    }

    function comfyParamValue(deps, field){
        deps.settings.comfyParams = deps.settings.comfyParams || {};
        if(deps.settings.comfyParams[field.id] !== undefined) return deps.settings.comfyParams[field.id];
        return field.default ?? (field.type === 'boolean' ? false : (field.type === 'number' || field.type === 'slider' ? 0 : ''));
    }

    function comfyFieldKind(deps, field){
        if(['image','video','audio'].includes(field?.type)) return field.type;
        const key = `${field?.input || ''} ${field?.name || ''}`.toLowerCase();
        if(field?.type === 'textarea' || /prompt|text|提示词|正向|负向/.test(key)) return 'prompt';
        return 'setting';
    }

    function comfyParamsFromWorkflowValues(deps, config, values={}){
        const params = {};
        (config?.fields || []).forEach(field => {
            if(!field?.node || !field?.input) return;
            let value = values[field.id];
            if(value === undefined) value = field.default;
            if(field.type === 'number' || field.type === 'slider'){
                const n = Number(value);
                if(Number.isFinite(n)) value = field.step && Number(field.step) < 1 ? n : Math.round(n);
            } else if(field.type === 'boolean'){
                value = Boolean(value);
            } else if(field.type === 'dropdown' && typeof value === 'string'){
                const s = value.trim();
                if(s && /^-?\d+(?:\.\d+)?(?:e-?\d+)?$/i.test(s)) value = s.includes('.') || /e/i.test(s) ? Number(s) : parseInt(s, 10);
            }
            params[field.node] = params[field.node] || {};
            params[field.node][field.input] = value;
        });
        return params;
    }

    const api={rhParamKey, rhFieldKind, rhFieldRole, rhExtractFieldOptions, rhDefaultValue, rhRandomEnabled, rhIsWorkflowLinkValue, rhEntryFields, rhWorkflowJsonFromSources, rhCurrentKind, rhUsableFields, rhActiveFields, rhFieldIndexes, rhRequiredLabel, rhPruneWorkflowForMissingFields, rhBuildWorkflowRequestExtras, rhUploadValueIfNeeded, rhBuildNodeInfoList, smartRhRandomActive, smartRhRandomActiveFor, smartRhRandomValue, rhParamValue, rhUserParamValue, rhApplyNodeInfoListToWorkflow, rhLooksLikeComplexDefault, comfyRandomEnabledField, smartComfyRandomActive, smartComfyRandomActiveFor, smartComfyRandomValue, comfyParamValue, comfyFieldKind, comfyParamsFromWorkflowValues};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.SmartWorkflowParams=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
