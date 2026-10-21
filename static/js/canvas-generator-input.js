/* Smart assistant execution: canvas-generator-input. Host supplies live state and effects. */
(function(root){
    'use strict';

function generatedImageRefs(deps, node){
    const keepGeneratedMedia = ['rh','video'].includes(node?.type) || !!node?.audioTaskId;
    return (node?.generatedOutputs || [])
        .map((item, i) => {
            const url = deps.outputUrlValue(item);
            if(!url) return null;
            const kind = deps.mediaKindForOutputItem(item);
            return {url, name:deps.outputImageName(url) || `${node.type || 'generated'}-${i + 1}`, kind, index:i};
        })
        .filter(Boolean)
        .filter(ref => keepGeneratedMedia || ref.kind === 'image' || (node.type === 'generator' && ref.kind === 'audio'))
        .map(ref => {
            const {index, ...clean} = ref;
            return clean;
        });
}

function mediaRefsFromNode(deps, node){
    if(!node) return [];
    if(['image','audio'].includes(node.type) && node.url){
        const kind = deps.mediaKindForNode(node);
        return [{url:node.url, name:node.name || kind, role:node.role || '', kind}];
    }
    if(node.type === 'group'){
        return (node.items || [])
            .map(id => deps.nodes.find(x => x.id === id))
            .filter(x => ['image','audio'].includes(x?.type) && x?.url)
            .map(item => ({url:item.url, name:item.name || deps.mediaKindForNode(item), role:item.role || '', kind:deps.mediaKindForNode(item)}));
    }
    if(node.type === 'output'){
        return (node.images || []).map((item, i) => {
            const url = deps.outputUrlValue(item);
            if(!url) return null;
            const kind = deps.mediaKindForOutputItem(item);
            return {url, name:deps.outputImageName(url) || `output-${i + 1}`, kind, nodeId:node.id, outputIndex:i};
        }).filter(Boolean);
    }
    if(deps.CANVAS_MEDIA_OUTPUT_TYPES.includes(node.type)) return generatedImageRefs(deps, node);
    return [];
}

function generatorSources(deps, gen){
    const localPrompt = typeof gen.viewAdjustPrompt === 'string' ? [{id:`${gen.id}:view-adjust`,type:'prompt',label:gen.shotTableOrigin?.stage==='image'?'分镜图片提示词':'视角调整',refs:[],prompt:gen.viewAdjustPrompt}] : [];
    return localPrompt.concat(deps.connections.filter(c => c.to === gen.id && c.kind !== 'story').map(c => deps.nodes.find(n => n.id === c.from)).filter(Boolean).map(n => {
        if(n.type === 'output' && (n.images||[]).length){
            // 从 output 节点取最新一张图当作 reference 给下游
            const reversed = [...n.images].map((item, index) => ({item, index})).reverse();
            const found = reversed.find(entry => deps.outputUrlValue(entry.item));
            if(found){
                const last = deps.outputUrlValue(found.item);
                const kind = deps.mediaKindForOutputItem(found.item);
                return {id:n.id, type:'outputImage', label:'上游输出', preview:last, refs:[{url:last, name:'output.png', kind, nodeId:n.id, outputIndex:found.index}], prompt:''};
            }
        }
        if(deps.CANVAS_MEDIA_OUTPUT_TYPES.includes(n.type)){
            const refs = generatedImageRefs(deps, n);
            if(refs.length){
                return refs.map((ref, i) => ({
                    id:`${n.id}:generated:${i}:${ref.url}`,
                    type:'generatedImage',
                    label:`上游生成 ${i + 1}`,
                    preview:ref.url,
                    refs:[ref],
                    prompt:''
                }));
            }
        }
        if(['image','audio'].includes(n.type) && n.url) {
            const kind = deps.mediaKindForNode(n);
            return {id:n.id, type:kind, label:n.name || kind, preview:n.url, refs:[{url:n.url, name:n.name || kind, role:n.role || '', kind}], prompt:''};
        }
        if(n.type === 'group') {
            const items = (n.items || []).map(id => deps.nodes.find(x => x.id === id)).filter(Boolean);
            const sources = items.filter(x => ['image','audio'].includes(x.type) && x.url).map(img => ({
                id:`${n.id}:${img.id}`,
                type:`group-${deps.mediaKindForNode(img)}`,
                groupId:n.id,
                imageId:img.id,
                label:img.name || deps.mediaKindForNode(img),
                preview:img.url,
                refs:[{url:img.url, name:img.name || deps.mediaKindForNode(img), role:img.role || '', kind:deps.mediaKindForNode(img)}],
                prompt:''
            }));
            const prompts = items.filter(x => x.type === 'prompt').map(p => p.text || '').filter(Boolean);
            if(prompts.length){
                const combined = prompts.join('\n\n');
                sources.push({
                    id:`${n.id}:prompts`,
                    type:'groupPrompt',
                    groupId:n.id,
                    label:combined.slice(0, 32),
                    refs:[],
                    prompt:combined
                });
            }
            return sources;
        }
        if(n.type === 'prompt') return {id:n.id, type:'prompt', label:(n.text || '提示词').slice(0, 32), refs:[], prompt:n.text || ''};
        if(n.type === 'loop') {
            const ctx = gen?._activeLoopCtx || deps.loopContext || null;
            const prompt = deps.renderLoopPrompt(n, ctx);
            const imageRefs = deps.loopInputImageRefs(n, ctx);
            const out = [];
            if(imageRefs.length){
                const currentIndex = Math.max(1, Number(ctx?.index || n.loopStart || 1) || 1);
                imageRefs.forEach((ref, i) => {
                    out.push({
                        id:`${n.id}:image:${currentIndex + i}:${ref.url}`,
                        type:'loopImage',
                        label:deps.trf('canvas.loopImageLabel', {n:currentIndex + i}),
                        preview:ref.url,
                        refs:[ref],
                        prompt:i === 0 && !out.length ? prompt : ''
                    });
                });
            }
            if(out.length) return out;
            return {id:n.id, type:'loop', label:`${deps.tr('canvas.loopNode')} ${deps.loopCount(n)}x`, refs:[], prompt};
        }
        if(n.type === 'promptGroup') {
            const prompts = (n.items || []).map(id => deps.nodes.find(x => x.id === id)).filter(Boolean).map(p => p.text || '').filter(Boolean);
            return {id:n.id, type:'promptGroup', label:`提示词 ${prompts.length} 个`, refs:[], prompt:prompts.join('\n\n')};
        }
        if(n.type === 'llm' && (n.mode || 'node') === 'node' && n.outputText) return {id:n.id, type:'llm', label:(n.outputText || 'LLM').slice(0, 32), refs:[], prompt:n.outputText || ''};
        return null;
    }).flat().filter(Boolean));
}

function orderedSources(deps, gen, sources){
    gen.inputs = (gen.inputs || []).filter(id => sources.some(s => s.id === id));
    sources.forEach(s => { if(!gen.inputs.includes(s.id)) gen.inputs.push(s.id); });
    return gen.inputs.map(id => sources.find(s => s.id === id)).filter(Boolean);
}

function reorderInput(deps, gen, movedId, targetId){
    if(!movedId || movedId === targetId) return;
    const sources = generatorSources(deps, gen);
    const imageIds = sources.filter(s => s.refs?.length).map(s => s.id);
    if(!imageIds.includes(movedId) || !imageIds.includes(targetId)) return;
    const promptIds = (gen.inputs || []).filter(id => !imageIds.includes(id));
    const ids = (gen.inputs || []).filter(id => imageIds.includes(id));
    const from = ids.indexOf(movedId), to = ids.indexOf(targetId);
    if(from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    gen.inputs = [...ids, ...promptIds];
    deps.render();
    deps.scheduleSave();
}

function syncGeneratorInputs(deps){
    deps.nodes.filter(n => deps.CANVAS_GENERATOR_TYPES.includes(n.type)).forEach(gen => {
        orderedSources(deps, gen, generatorSources(deps, gen));

    });
}

function scheduleGeneratorInputSync(deps){
    deps.clearTimeout(deps.generatorInputSyncTimer);
    deps.generatorInputSyncTimer = deps.setTimeout(() => {
        syncGeneratorInputs(deps);
        refreshGeneratorInputViews(deps);
    }, 160);
}

function refreshGeneratorInputViews(deps){
    deps.nodes.filter(n => deps.CANVAS_GENERATOR_TYPES.includes(n.type)).forEach(gen => {
        const el = deps.nodesEl.querySelector(`.node[data-id="${gen.id}"]`);
        if(!el) return;
        const sources = orderedSources(deps, gen, generatorSources(deps, gen));
        const imageInputs = sources
            .map(src => ({...src, refs:deps.imageRefsOnly(src.refs || [])}))
            .filter(src => src.refs?.length);
        deps.renderPromptPreview(el.querySelector('.prompt-list'), sources.filter(src => src.prompt && !src.refs?.length));
        if(gen.type==='generator' && (deps.canvasApiAudioMode(gen,sources) || el.querySelector('.api-audio-body'))){deps.refreshNodes([gen.id]);return;}
        if(gen.type === 'generator') deps.renderImageInputList(el.querySelector('.input-list'), gen, imageInputs);
        if(gen.type === 'midjourney') deps.renderImageInputList(el.querySelector('.mj-input-list'), gen, imageInputs);
        if(gen.type === 'msgen') deps.renderImageInputList(el.querySelector('.ms-img-list'), gen, imageInputs);
        if(gen.type === 'comfy') deps.renderComfyImages(el.querySelector('.input-list'), gen, imageInputs);

        if(gen.type === 'video'){
            const mediaInputs = sources.filter(src => src.refs?.some(ref => ['image','video','audio'].includes(deps.mediaKindForRef(ref))));
            deps.renderVideoImageInputs(el.querySelector('.video-img-list'), gen, mediaInputs);
        }

        if(gen.type === 'rh'){
            const media = deps.rhMediaSources(gen);
            if(deps.rhCurrentKind(gen) === 'model') deps.renderPromptPreview(el.querySelector('.rh-prompt-list'), media.sources.filter(src => src.prompt && !src.refs?.length));
            else deps.renderRhPromptFields(el.querySelector('.rh-prompt-list'), gen, deps.rhActiveFields(gen));
            deps.renderRhInputs(el.querySelector('.rh-input-list'), gen, media);
            deps.renderRhParams(el.querySelector('.rh-param-list'), gen, deps.rhActiveFields(gen), media);
        }
    });
}

    const api={generatedImageRefs, mediaRefsFromNode, generatorSources, orderedSources, reorderInput, syncGeneratorInputs, scheduleGeneratorInputSync, refreshGeneratorInputViews};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.CanvasGeneratorInput=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
