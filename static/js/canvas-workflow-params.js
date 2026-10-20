/* Workflow parameter responsibility: canvas-workflow-params. Host supplies live state and effects. */
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
        const fieldType = String(field?.fieldType || '').toUpperCase();
        if(['LIST','SELECT','DROPDOWN','COMBO','ENUM'].includes(fieldType) && Array.isArray(field?.fieldValue)){
            return field.fieldValue.filter(x => ['string','number'].includes(typeof x)).map(String);
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

    function rhCurrentKind(deps, node){
        const selected = deps.rhSelectedEntryRef(node)?.kind;
        if(selected) return selected;
        return ['model','workflow','app'].includes(node?.rhMode) ? node.rhMode : 'app';
    }

    function rhUsableFields(deps, fields){
        const list = Array.isArray(fields) ? fields : [];
        if(!list.length) return [];
        const enabled = list.filter(f => f.enabled === true);
        return enabled.length ? enabled : list;
    }

    function rhActiveFields(deps, node){
        if(rhCurrentKind(deps, node) === 'model') return [];
        const sortFields = fields => [...(fields || [])].sort((a, b) => {
            const ak = rhFieldKind(deps, a), bk = rhFieldKind(deps, b);
            if(ak === 'image' && bk === 'image'){
                const ao = Number(a.imageOrder) || 9999;
                const bo = Number(b.imageOrder) || 9999;
                if(ao !== bo) return ao - bo;
            }
            if(ak === 'image' && bk !== 'image') return -1;
            if(ak !== 'image' && bk === 'image') return 1;
            return String(a.nodeId || '').localeCompare(String(b.nodeId || ''), undefined, {numeric:true}) || String(a.fieldName || '').localeCompare(String(b.fieldName || ''));
        });
        if(rhCurrentKind(deps, node) === 'workflow') {
            const workflowId = deps.validRunningHubWorkflowId(node.workflowId || '');
            const savedEntry = deps.currentRunningHubWorkflowEntry(node);
            if(Array.isArray(savedEntry?.fields) && savedEntry.fields.length) return sortFields(rhUsableFields(deps, savedEntry.fields));
            const saved = workflowId ? deps.runningHubWorkflowCache[workflowId] : null;
            if(Array.isArray(saved?.fields)) return sortFields(rhUsableFields(deps, saved.fields));
            return sortFields(node.rhWorkflowInfo?.nodeInfoList || []);
        }
        const savedApp = deps.currentRunningHubAppConfig(node);
        if(Array.isArray(savedApp?.fields) && savedApp.fields.length) return sortFields(rhUsableFields(deps, savedApp.fields));
        return sortFields(node.rhAppInfo?.nodeInfoList || []);
    }

    function rhFieldIndexes(deps, fields){
        const counters = {image:0, video:0, audio:0};
        const map = {};
        const ordered = [...(fields || [])].sort((a, b) => {
            const ak = rhFieldKind(deps, a), bk = rhFieldKind(deps, b);
            if(ak === 'image' && bk === 'image'){
                return (Number(a.imageOrder) || 9999) - (Number(b.imageOrder) || 9999);
            }
            return 0;
        });
        ordered.forEach(field => {
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
            if(node && rhWorkflowNodeInfoList(deps, {[field.nodeId]: node}).length <= 0){
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

    async function rhBuildWorkflowRequestExtras(deps, node, media, nodeInfoList){
        const config = await deps.ensureRunningHubWorkflowConfigForNode(node);
        if(!config || (config.optionalImageMode || 'prune-workflow') !== 'prune-workflow') return {};
        const fields = rhActiveFields(deps, node);
        const indexes = rhFieldIndexes(deps, fields);
        const missingOptional = [];
        for(const field of fields){
            if(rhFieldKind(deps, field) !== 'image') continue;
            const key = rhParamKey(deps, field.nodeId, field.fieldName);
            const idx = indexes[key] || 0;
            const hasInput = Boolean(media.image?.[idx]?.url);
            if(field.required === true && !hasInput){
                throw new Error(`RunningHub 工作流缺少必选图片：${rhRequiredLabel(deps, field)}`);
            }
            if(field.required !== true && !hasInput){
                missingOptional.push(field);
            }
        }
        if(!missingOptional.length) return {};
        missingOptional.forEach(field => {
            const key = rhParamKey(deps, field.nodeId, field.fieldName);
            const idx = nodeInfoList.findIndex(item => rhParamKey(deps, item.nodeId, item.fieldName) === key);
            if(idx >= 0) nodeInfoList.splice(idx, 1);
        });
        const workflow = rhPruneWorkflowForMissingFields(deps, config.workflowJson || {}, missingOptional);
        return workflow ? {workflow} : {};
    }

    async function rhUploadValueIfNeeded(deps, value, node=null){
        const text = String(value || '').trim();
        if(!text) return '';
        if(!/^https?:\/\//i.test(text) && !text.startsWith('/output/') && !text.startsWith('/assets/')) return text;
        const res = await deps.fetch('/api/runninghub/upload-asset', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({url:text, useWallet:rhUseWallet(deps, node)})
        });
        const data = await res.json();
        if(!res.ok || data.success === false) throw new Error(data.detail || data.error || deps.tr('canvas.rhUploadFailed'));
        return data.data?.fileName || text;
    }

    async function rhBuildNodeInfoList(deps, node, media){
        const fields = rhActiveFields(deps, node);
        const result = [];
        const indexes = rhFieldIndexes(deps, fields);
        for(const field of fields){
            const kind = rhFieldKind(deps, field);
            const key = rhParamKey(deps, field.nodeId, field.fieldName);
            if(rhCurrentKind(deps, node) === 'workflow' && field.sourceFromUpstream === false && !['image','video','audio'].includes(kind)) continue;
            if(rhCurrentKind(deps, node) === 'workflow' && kind === 'image'){
                const idx = indexes[key] || 0;
                const hasInput = Boolean(media.image?.[idx]?.url);
                if(field.required !== true && !hasInput) continue;
            }
            let value = rhFieldValue(deps, node, field, media);
            if(['image','video','audio'].includes(kind)) value = await rhUploadValueIfNeeded(deps, value, node);
            if(['number','slider'].includes(kind) && String(value ?? '').trim() !== '' && !Number.isNaN(Number(value))) value = Number(value);
            result.push({nodeId:field.nodeId, fieldName:field.fieldName, fieldValue:value});
        }
        return result;
    }

    function rhRandomActive(deps, node, key){
        node.rhRandomActive = node.rhRandomActive || {};
        return node.rhRandomActive[key] !== false;
    }

    function rhWorkflowNodeInfoList(deps, data){
        const list = [];
        if(!data || typeof data !== 'object' || Array.isArray(data)) return list;
        Object.entries(data).forEach(([nodeId, nodeContent]) => {
            const inputs = nodeContent?.inputs || {};
            if(!inputs || typeof inputs !== 'object') return;
            Object.entries(inputs).forEach(([fieldName, rawValue]) => {
                if(rhIsWorkflowLinkValue(deps, rawValue)) return;
                let fieldValue = rawValue;
                if(fieldValue !== null && typeof fieldValue === 'object') fieldValue = JSON.stringify(fieldValue);
                else if(fieldValue === undefined || fieldValue === null) fieldValue = '';
                else fieldValue = String(fieldValue);
                list.push({
                    nodeId:String(nodeId),
                    fieldName:String(fieldName),
                    fieldValue,
                    fieldType:rhInferWorkflowFieldType(deps, fieldName, fieldValue),
                    source:'workflow'
                });
            });
        });
        return list;
    }

    function rhInferWorkflowFieldType(deps, fieldName, fieldValue){
        const key = `${fieldName || ''} ${fieldValue || ''}`.toLowerCase();
        if(/\b(image|img|mask|photo|picture)\b/.test(key) || /\.(png|jpe?g|webp|gif|bmp)(\?|$)/i.test(key)) return 'IMAGE';
        if(/\b(video|movie|mp4)\b/.test(key) || /\.(mp4|webm|mov|m4v|mkv)(\?|$)/i.test(key)) return 'VIDEO';
        if(/\b(audio|sound|music|voice)\b/.test(key) || /\.(mp3|wav|ogg|m4a|flac|aac)(\?|$)/i.test(key)) return 'AUDIO';
        if(/^(true|false)$/i.test(String(fieldValue || ''))) return 'BOOLEAN';
        if(String(fieldValue || '').trim() !== '' && !Number.isNaN(Number(fieldValue))) return 'NUMBER';
        return 'TEXT';
    }

    function rhCurrentEntry(deps, node){
        return deps.rhSelectedEntryRef(node)?.entry || null;
    }

    function rhUseWallet(deps, node){
        return node?.rhPayment === 'wallet';
    }

    function rhFieldValue(deps, node, field, media=null){
        node.rhParams = node.rhParams || {};
        const key = rhParamKey(deps, field.nodeId, field.fieldName);
        const kind = rhFieldKind(deps, field);
        const param = node.rhParams[key];
        if(['image','video','audio'].includes(kind)){
            const idx = rhFieldIndexes(deps, rhActiveFields(deps, node))[key] || 0;
            const up = (media || deps.rhMediaSources(node))[kind]?.[idx]?.url || '';
            if(rhCurrentKind(deps, node) === 'workflow' && kind === 'image' && field.required !== true && !up && param?.sourceFromUpstream !== false) return '';
            if(param?.sourceFromUpstream === false) return param.value ?? rhDefaultValue(deps, field);
            return up || param?.value || rhDefaultValue(deps, field);
        }
        if(rhRandomEnabled(deps, field) && rhRandomActive(deps, node, key)){
            node.rhRandomValues = node.rhRandomValues || {};
            if(node.rhRandomValues[key] === undefined){
                node.rhRandomValues[key] = comfyRandomValue(deps, {
                    input:field.fieldName,
                    name:field.label || field.fieldName,
                    min:field.min,
                    max:field.max,
                    step:field.step,
                    type:'number'
                });
            }
            return node.rhRandomValues[key];
        }
        if(rhFieldRole(deps, field) === 'prompt'){
            const upstreamPrompt = (media || deps.rhMediaSources(node)).prompt || '';
            return param?.value ?? (upstreamPrompt || rhDefaultValue(deps, field));
        }
        return param?.value ?? rhDefaultValue(deps, field);
    }

    function comfyFieldKind(deps, f){
        if(['image','video','audio'].includes(f?.type)) return f.type;
        const key = `${f.input || ''} ${f.name || ''}`.toLowerCase();
        if(f.type === 'textarea' || /prompt|text|提示词|正向|负向/.test(key)) return 'prompt';
        return 'setting';
    }

    function comfyFields(deps, node, kind='all'){
        const data = deps.currentComfyWorkflow(node);
        const fields = data?.config?.fields || [];
        return kind === 'all' ? fields : fields.filter(f => comfyFieldKind(deps, f) === kind);
    }

    function comfyParamValue(deps, node, field){
        node.comfyParams = node.comfyParams || {};
        if(node.comfyParams[field.id] !== undefined) return node.comfyParams[field.id];
        return field.default ?? (field.type === 'boolean' ? false : (field.type === 'number' || field.type === 'slider' ? 0 : ''));
    }

    function comfyRandomEnabled(deps, field){
        return field?.type === 'number' && field.random_enabled === true;
    }

    function comfyRandomActive(deps, node, fieldId){
        node.comfyRandomActive = node.comfyRandomActive || {};
        return node.comfyRandomActive[fieldId] !== false;
    }

    function comfyRandomValue(deps, field){
        const isFloat = Number(field.step) > 0 && Number(field.step) < 1;
        let min = Number.isFinite(Number(field.min)) ? Number(field.min) : null;
        let max = Number.isFinite(Number(field.max)) ? Number(field.max) : null;
        const name = `${field.input || ''} ${field.name || ''}`.toLowerCase();
        const looksSeed = name.includes('seed') || name.includes('noise') || name.includes('随机') || name.includes('噪');
        if(min === null) min = looksSeed ? 1 : 0;
        if(max === null || max <= min) max = looksSeed ? 4294967295 : 999999;
        if(looksSeed) max = Math.min(max, 4294967295);
        let value = min + Math.random() * (max - min);
        if(isFloat){
            const precision = Math.min(8, Math.max(1, String(field.step).split('.')[1]?.length || 2));
            return Number(value.toFixed(precision));
        }
        return Math.floor(value);
    }

    const api={rhParamKey, rhFieldKind, rhFieldRole, rhExtractFieldOptions, rhDefaultValue, rhRandomEnabled, rhIsWorkflowLinkValue, rhEntryFields, rhWorkflowJsonFromSources, rhCurrentKind, rhUsableFields, rhActiveFields, rhFieldIndexes, rhRequiredLabel, rhPruneWorkflowForMissingFields, rhBuildWorkflowRequestExtras, rhUploadValueIfNeeded, rhBuildNodeInfoList, rhRandomActive, rhWorkflowNodeInfoList, rhInferWorkflowFieldType, rhCurrentEntry, rhUseWallet, rhFieldValue, comfyFieldKind, comfyFields, comfyParamValue, comfyRandomEnabled, comfyRandomActive, comfyRandomValue};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.CanvasWorkflowParams=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
