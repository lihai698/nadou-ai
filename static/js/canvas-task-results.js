/* Task result application and output data. Host owns live canvas state and effects. */
(function(root){
    'use strict';

    function outputHasUrl(deps, out, url){
        return Boolean(url && (out?.images || []).some(item => deps.outputUrlValue(item) === url));
    }

    function appendOutputImagesWithoutDuplicates(deps, out, images, compareRef=null, metas=[], layout=null){
        const unique = (images || []).filter(item => {
            const url = deps.outputUrlValue(item);
            return url && !outputHasUrl(deps, out, url);
        });
        appendOutputImages(deps, out, unique, compareRef, metas, layout);
        return unique.length;
    }

    function syncLatestGeneratedOutputToConnection(deps, fromId, toId){
        const source = deps.nodes.find(n => n.id === fromId);
        const out = deps.nodes.find(n => n.id === toId);
        if(!source || !out || out.type !== 'output' || !deps.CANVAS_MEDIA_OUTPUT_TYPES.includes(source.type)) return false;
        const latest = deps.latestGeneratedOutputItem(source);
        if(!latest) return false;
        return appendOutputImagesWithoutDuplicates(deps, out, [latest]) > 0;
    }

    function syncConnectedOutputsFromGenerated(deps, node, outputs){
        if(!node || !deps.CANVAS_MEDIA_OUTPUT_TYPES.includes(node.type)) return;
        const list = (outputs || []).filter(item => deps.outputUrlValue(item));
        if(!list.length) return;
        deps.outputNodesForSource(node.id).forEach(out => appendOutputImagesWithoutDuplicates(deps, out, list));
    }

    function appendOutputImages(deps, out, images, compareRef, metas=[], layout=null){
        const list = (images || []).filter(Boolean);
        if(!out || !list.length) return;
        if(layout?.type === 'grid-split'){
            out.images = [];
            out.outputLayout = layout;
        } else if(out.outputLayout) {
            delete out.outputLayout;
        }
        out.images = [...(out.images || []), ...list.map((url, i) => {
            const meta = metas[i] || metas[0] || {};
            const source = url && typeof url === 'object' ? url : {};
            const item = {url:deps.outputUrlValue(url), viewed:false, runMs:meta.runMs || 0, run:meta.run || null};
            if(source.name) item.name = source.name;
            if(source.kind || source.mediaKind) item.kind = source.kind || source.mediaKind;
            if(meta.kind) item.kind = meta.kind;
            if(meta.grid) item.grid = meta.grid;
            return item;
        })];
        if(compareRef?.url){
            out.imageComparisons = out.imageComparisons || {};
            list.forEach(url => {
                out.imageComparisons[url] = {url:compareRef.url, name:compareRef.name || 'input image'};
            });
        }
    }

    function mergeGeneratedOutputs(deps, node, outputs, append=false){
        if(!node) return;
        const keepGeneratedMedia = ['rh','video'].includes(node.type) || Boolean(node.audioTaskId);
        const clean = (outputs || []).map(item => {
            const url = deps.outputUrlValue(item);
            if(!url) return null;
            const kind = ['video'].includes(node.type)
                ? 'video'
                : ['rh'].includes(node.type) && deps.isVideoUrl(url)
                    ? 'video'
                    : deps.mediaKindForOutputItem(item);
            if(!keepGeneratedMedia && kind !== 'image' && !(node.type === 'generator' && kind === 'audio')) return null;
            return kind === 'image' ? url : {...(typeof item==='object'?item:{}),url, kind};
        }).filter(Boolean);
        if(clean.length){delete node.audioOutputText;deps.outputNodesForSource(node.id).forEach(out=>delete out.audioOutputText);}
        if(!append){
            node.generatedOutputs = clean;
            syncConnectedOutputsFromGenerated(deps, node, clean);
            return;
        }
        const seen = new Set((node.generatedOutputs || []).map(deps.outputUrlValue).filter(Boolean));
        const added = clean.filter(item => {
            const url = deps.outputUrlValue(item);
            return url && !seen.has(url) && seen.add(url);
        });
        node.generatedOutputs = [...(node.generatedOutputs || []), ...added];
        syncConnectedOutputsFromGenerated(deps, node, added);
    }

    function pendingById(deps, out, id){
        return (out?._pending || []).find(p => p.id === id) || null;
    }

    function collectRunMetas(deps, out, ids){
        return (ids || []).map(id => pendingById(deps, out, id)).filter(Boolean).map(p => ({
            runMs: deps.nowMs() - Number(p.startedAt || deps.nowMs()),
            run: p.run || {},
        }));
    }

    function collectRunMeta(deps, out, id){
        return collectRunMetas(deps, out, [id])[0] || {runMs:0, run:{}};
    }

    function findOutputByPendingId(deps, pendingId){
        return deps.nodes.find(n => n.type === 'output' && (n._pending || []).some(p => p.id === pendingId));
    }

    function findPendingTask(deps, taskId){
        for(const out of deps.nodes.filter(n => n.type === 'output')){
            const pending = (out._pending || []).find(p => p.canvasTaskId === taskId);
            if(pending) return {out, pending};
        }
        return null;
    }

    function completeCanvasVideoTask(deps, taskId, result, fallback=null){
        const current=findPendingTask(deps, taskId);
        const found=current||fallback;
        if(!found)return false;
        const {out,pending}=found,gen=deps.nodes.find(n=>n.id===pending.run?.node?.id);
        // Direct runs without an output still use a fallback, but only for the original live node.
        if(!current && (!fallback?.node || !deps.nodes.includes(fallback.node) || (out && !deps.nodes.includes(out)))) return false;
        if(pending.assistantNativeActionId){
            const run=gen?.assistantNativeRun;
            const outputIds=deps.connections.filter(c=>c.from===gen?.id).map(c=>c.to).filter(id=>deps.nodes.some(n=>n.id===id&&n.type==='output'));
            if(deps.canvas?.id!==pending.assistantCanvasId||!deps.nodes.includes(out)||out.type!=='output'||run?.actionId!==pending.assistantNativeActionId||run.taskKind!=='video'||run.outputNodeId!==out.id||outputIds.length!==1||outputIds[0]!==out.id||!((run.taskIds||[]).includes(taskId)||run.plannedTaskId===taskId))throw new Error('原视频输出或任务归属已变化，保留原任务，不回填到其它节点');
        }
        const outputUrls=deps.resultMediaUrls(result).map(item=>{const url=deps.outputUrlValue(item);return item&&typeof item==='object'?{...item,url,kind:item.kind||'video'}:{url,kind:'video'};}).filter(item=>item.url);
        if(!outputUrls.length)throw new Error('视频任务成功但没有返回视频地址');
        const runMs=deps.nowMs()-Number(pending.startedAt||deps.nowMs());
        pending.run.request=deps.requestMetaFromResult(result);
        if(out)appendOutputImagesWithoutDuplicates(deps, out,outputUrls,pending.run?.refs?.[0],[{run:pending.run||{},runMs,kind:'video'}]);
        if(gen){
            mergeGeneratedOutputs(deps, gen,outputUrls,Boolean(pending.appendGenerated));gen.runStatus='done';gen.runError='';gen.running=false;
            if(pending.assistantNativeActionId){gen.assistantNativeRun={...gen.assistantNativeRun,taskIds:[taskId],unknownCount:0,warning:''};gen.submissionUnknown=false;gen.submissionWarning='';}
        }
        if(out)out._pending=(out._pending||[]).filter(item=>item.id!==pending.id);
        deps.addGenerationLog({run:pending.run||{},outputs:outputUrls,runMs});deps.refreshRunNodes(gen,out);deps.scheduleSave();
        return true;
    }

    function completeCanvasComfyTask(deps, taskId, result){
        const found = findPendingTask(deps, taskId);
        if(!found) return;
        const {out, pending} = found;
        const run = pending.run || {};
        const outputs = deps.resultMediaUrls(result);
        if(!outputs.length) throw new Error(deps.noReturnedImage('canvas.comfyGenerate'));
        const runMs = deps.nowMs() - Number(pending.startedAt || deps.nowMs());
        run.request = deps.requestMetaFromResult(result);
        const gen = deps.nodes.find(node => node.id === run.node?.id);
        appendOutputImages(deps, out, outputs, run.refs?.[0], [{run, runMs}]);
        out._pending = (out._pending || []).filter(item => item.id !== pending.id);
        if(gen){
    
            mergeGeneratedOutputs(deps, gen, outputs, Boolean(pending.appendGenerated));
            gen.runStatus = 'done';
            gen.runError = '';
            gen.running = false;
        }
        deps.addGenerationLog({run, outputs, runMs});
        deps.refreshRunNodes(gen, out);
        deps.scheduleSave();
        return true;
    }

    function completeCanvasImageTask(deps, taskId, result){
        const found = findPendingTask(deps, taskId);
        if(!found) return;
        const {out, pending} = found;
        if(pending.assistantCatalogImage){
            const node=deps.nodes.find(n=>n.id===pending.run?.node?.id),run=node?.assistantNativeRun;
            if(deps.canvas?.id!==pending.assistantCanvasId||run?.actionId!==pending.assistantNativeActionId||run.inputHash!==pending.assistantInputHash||run.outputNodeId!==out.id||out.id!==pending.assistantOutputNodeId||!deps.connections.some(c=>c.from===node?.id&&c.to===out.id)){const error=new Error('原图片输出或助手归属已变化，保留原任务');error.queryPaused=true;throw error;}
            if(!result.images?.length)throw new Error('原任务没有图片，不能登记成功');
            if(node.type==='midjourney'){
                if(!result.native_remote_task_id)throw new Error('Midjourney缺少原供应商编号，请只查询原任务');
                node.lastTaskId=result.native_remote_task_id;
                node.lastTaskStatus='SUCCESS';node.lastAction=result.native_mode||pending.run?.node?.mode||node.mode;
                node.lastImageCount=result.images.length;node.lastPrompt=result.native_prompt??pending.run?.prompt??'';
            }
        }
        const meta = {
            runMs: deps.nowMs() - Number(pending.startedAt || deps.nowMs()),
            run: pending.run || {},
        };
        meta.run.request = deps.requestMetaFromResult(result);
        const images = pending.assistantCatalogImage&&result.image_items?.length ? result.image_items : result.images || [];
        out._pending = (out._pending || []).filter(p => p.id !== pending.id);
        appendOutputImages(deps, out, images, meta.run?.refs?.[0], [meta]);
        const gen = deps.nodes.find(n => n.id === meta.run?.node?.id);
        if(gen){
            mergeGeneratedOutputs(deps, gen, images, Boolean(pending.appendGenerated));
            gen.runStatus = 'done';
            if(gen.assistantTaskId===taskId) gen.assistantCompletedTaskId=taskId;
            gen.runError = '';
            gen.running = false;
        }
        deps.addGenerationLog({run:meta.run, outputs:images, runMs:meta.runMs || 0});
        deps.syncGeneratorInputs();
        deps.refreshRunNodes(gen, out);
        deps.refreshGeneratorInputViews();
        deps.scheduleSave();
    }

    function failCanvasImageTask(deps, taskId, message, taskData={}){
        const found = findPendingTask(deps, taskId);
        if(!found) return;
        const {out, pending} = found;
        const run = pending.run || {};
        const runMs = deps.nowMs() - Number(pending.startedAt || deps.nowMs());
        const recoverTaskId = taskData?.upstream_task_id || taskData?.task_id || deps.extractUpstreamTaskId(message);
        const gen = deps.nodes.find(n => n.id === run?.node?.id);
        if(recoverTaskId){
            pending.failed = true;
            pending.queryPaused = false;
            pending.querying = false;
            pending.error = message || deps.tr('canvas.generationFailed');
            pending.recoverTaskId = recoverTaskId;
            pending.providerId = taskData?.provider_id || pending.providerId || deps.providerIdForPending(pending);
            pending.canvasTaskStatus = 'failed';
            if(gen){
                gen.runStatus = 'failed';
                gen.runError = pending.error;
                if(pending?.cascadeTargetId) gen._cascadeFailed = true;
                gen.running = false;
            }
            deps.addGenerationLog({run, outputs:[], runMs, error:pending.error});
            deps.refreshRunNodes(gen, out);
            deps.scheduleSave();
            return;
        }
        out._pending = (out._pending || []).filter(p => p.id !== pending.id);
        if(gen){
            gen.runStatus = 'failed';
            gen.runError = message || deps.tr('canvas.generationFailed');
            if(pending?.cascadeTargetId) gen._cascadeFailed = true;
            gen.running = false;
        }
        deps.addGenerationLog({run, outputs:[], runMs, error:message || deps.tr('canvas.generationFailed')});
        deps.refreshRunNodes(gen, out);
        deps.scheduleSave();
    }

    function finalizeSmartPendingTask(deps, node, taskId, images, kind='image'){
        if(!node || !taskId) return;
        if(node.assistantTaskId===taskId) node.assistantCompletedTaskId=taskId;
        delete node.taskFailureNotice;
        node.pendingTasks = deps.smartPendingTasks(node).filter(task => task.taskId !== taskId);
        node.pending = Math.max(0, Number(node.pending || 0) - 1);
        const ext = kind === 'video' ? 'mp4' : kind === 'audio' ? 'mp3' : kind === 'text' ? 'txt' : 'png';
        const mediaItems = deps.resultMediaUrls(images);
        if(mediaItems.length) delete node.audioOutputText;
        const existing = deps.cleanHistoryImages(node.images || []);
        const seen = new Set(existing.map(img => `${img.kind || ''}|${img.url || ''}`));
        const additions = deps.cleanHistoryImages((mediaItems || []).map((item, i) => {
            const url = typeof item === 'string' ? item : item?.url || '';
            const itemKind = (typeof item === 'object' && item.kind) || kind;
            return deps.stripImageGenerationMeta(deps.copyMediaSizeFields(item, {url, name:(typeof item === 'object' && item.name) || `output-${i + 1}.${ext}`, kind:itemKind, generatedResult:true}));
        }).filter(item => item.url)).filter(item => {
            const key = `${item.kind || ''}|${item.url || ''}`;
            if(seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        node.images = [...existing, ...additions];
        if(additions.length) node.outputKind = kind;
        if(!node.pending && deps.smartPendingTasks(node).length === 0){
            delete node.pendingTasks;
            if(kind === 'video'){
                delete node.videoTaskId;
                delete node.videoTaskStatus;
                delete node.videoTaskError;
                delete node.submissionWarning;
                delete node.submissionUnknown;
            }
            node.runFinishedAt = deps.nowMs();
            if(!node.runStartedAt) node.runStartedAt = node.runFinishedAt;
            node.runElapsedMs = Math.max(0, node.runFinishedAt - Number(node.runStartedAt || node.runFinishedAt));
            node.runTimerHidden = false;
            node.running = false;
            node.title = node.images.length > 1 ? (kind === 'video' ? 'Videos' : kind === 'audio' ? 'Audios' : kind === 'text' ? 'Texts' : 'Group') : (kind === 'video' ? 'Video' : kind === 'audio' ? 'Audio' : kind === 'text' ? 'Text' : 'Image');
            if(node.images.length > 1 && (!Number.isFinite(Number(node.scale)) || Number(node.scale) === deps.MEDIA_NODE_DEFAULT_SCALE || Number(node.scale) === deps.MEDIA_GROUP_PREVIOUS_DEFAULT_SCALE)) node.scale = deps.MEDIA_GROUP_DEFAULT_SCALE;
            else node.scale = deps.mediaNodeDefaultScale(node);
            delete node.w;
            delete node.h;
        }
    }

    function validateSmartGroupPendingOutput(deps, node, task){
        if(task.assistantLoopStepKey)return deps.validateSmartLoopPendingOutput(node,task);
        if(!task.assistantSourceNodeId)return;
        const source=deps.nodes.find(n=>n.id===task.assistantSourceNodeId&&n.type==='smart-group'),run=source?.assistantNativeRun,origin=node.assistantNativeOrigin;
        const incoming=(deps.canvas.connections||[]).filter(c=>c.to===node.id);
        if(!deps.nodes.includes(node) || deps.canvasId!==task.assistantBinding?.canvas_id || !source || run?.actionId!==task.assistantNativeActionId || run.outputNodeId!==node.id || !run.taskIds?.includes(task.taskId)
            || origin?.actionId!==task.assistantNativeActionId || origin.sourceNodeId!==source.id || origin.inputHash!==task.assistantInputHash || incoming.length!==1 || incoming[0].from!==source.id || incoming[0].kind!=='flow'){
            const error=new Error('智能分组原结果分支或归属已变化，保留原编号，不回填其它节点');error.queryPaused=true;throw error;
        }
    }

    const api={outputHasUrl, appendOutputImagesWithoutDuplicates, syncLatestGeneratedOutputToConnection, syncConnectedOutputsFromGenerated, appendOutputImages, mergeGeneratedOutputs, pendingById, collectRunMetas, collectRunMeta, findOutputByPendingId, findPendingTask, completeCanvasVideoTask, completeCanvasComfyTask, completeCanvasImageTask, failCanvasImageTask, finalizeSmartPendingTask, validateSmartGroupPendingOutput};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.CanvasTaskResults=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
