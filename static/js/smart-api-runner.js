/* Generation responsibility: smart-api-runner. Host supplies live state and effects. */
(function(root){
    'use strict';

    async function runApiGeneration(deps, prompt, refs, runSettings=deps.settings, options={}){
        if(!runSettings.provider_id || !runSettings.model) throw new Error(deps.tr('smart.errNoApiModel'));
        const count = options.acceptedTask ? 1 : Math.max(1, Math.min(8, Number(runSettings.count || 1)));
        const payload = {
            prompt,
            provider_id:runSettings.provider_id,
            model:runSettings.model,
            size:deps.sizeForRun(runSettings),
            aspect_ratio:deps.API_RATIO_VALUES[runSettings.ratio] || (runSettings.ratio === 'custom' ? String(runSettings.customRatio || '').trim() : ''),
            resolution:['1k','2k','4k'].includes(runSettings.resolution) ? runSettings.resolution : '',
            quality:runSettings.quality || 'auto',
            n:1,
            reference_images:deps.imageRefsOnly(refs).slice(0, deps.SMART_REFERENCE_IMAGE_MAX)
        };
        if(options.assistantNativeActionId && options.assistantRunInputHash){
            Object.assign(payload,{assistant_action_id:options.assistantNativeActionId,canvas_id:options.assistantCanvasId,node_id:options.assistantNativeNodeId,input_hash:options.assistantRunInputHash});
            if(options.assistantLoopStepKey)payload.assistant_slot_key=options.assistantLoopStepKey;
        }
        const settled = await Promise.allSettled(Array.from({length:count}, async () => {
            if(options.acceptedTask?.task_id) return options.acceptedTask.task_id;
            if(options.beforeSubmit){try{await options.beforeSubmit();}catch(error){error.submissionKnownRejected=true;throw error;}}
            const response = await deps.fetch('/api/canvas-image-tasks', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)});
            if(!response.ok){
                const error = new Error((await response.text().catch(() => '')) || `HTTP ${response.status}`);
                error.submissionRejected = response.status >= 400 && response.status < 500 && response.status !== 408;
                throw error;
            }
            const task = await response.json();
            if(!task?.task_id) throw new Error('任务提交未返回编号，受理状态未知');
            if(options.onAccepted)await options.onAccepted(task.task_id);
            return task.task_id;
        }));
        const submissionFailures = settled.flatMap((item, index) => item.status === 'rejected'
            ? [{index:index + 1, kind:item.reason?.submissionRejected || item.reason?.submissionKnownRejected ? 'rejected' : 'unknown', message:item.reason?.message || String(item.reason)}]
            : []);
        return {
            taskIds:settled.filter(item => item.status === 'fulfilled').map(item => item.value),
            submissionFailures, count, providerId:payload.provider_id, model:payload.model
        };
    }

    function restoreSmartVideoSubmissionWarning(deps, node, previous){
        if(!node || !previous) return;
        if(previous.warning === undefined) delete node.submissionWarning;
        else node.submissionWarning = previous.warning;
        if(previous.unknown === undefined) delete node.submissionUnknown;
        else node.submissionUnknown = previous.unknown;
        deps.render();
        deps.scheduleSave();
    }

    async function markSmartVideoSubmissionBeforeRequest(deps, node){
        if(!node) throw new Error('视频请求缺少画布节点，无法确认保存状态');
        const previous = {warning:node.submissionWarning, unknown:node.submissionUnknown};
        const warning = '视频请求可能已被受理；若页面或服务中断，远端状态未知。再次提交可能重复计费。';
        node.submissionWarning = previous.warning
            ? (previous.warning.includes(warning) ? previous.warning : `${previous.warning}\n${warning}`)
            : warning;
        node.submissionUnknown = true;
        deps.render();
        if(await deps.saveCanvas()) return previous;
        restoreSmartVideoSubmissionWarning(deps, node, previous);
        throw new Error('画布尚未保存，本次视频请求未提交；请先重试保存');
    }

    async function runApiVideoGeneration(deps, prompt, refs, runSettings=deps.settings, node, runState=null){
        if(!runSettings.videoModel) throw new Error(deps.tr('smart.errNoVideoModel'));
        try {
            const uploadedRefs = deps.applyUploadedUrlsToSmartRefs(refs, runSettings);
            const trustedMode = Boolean(runSettings.videoTrustedAsset);
            const trustedSource = trustedMode ? (['library','cloud','manual'].includes(runSettings.videoTrustedSource) ? runSettings.videoTrustedSource : 'library') : 'none';
            // 仅「素材库链接」来源才走 asset:// 认证地址 + 后端可信素材路由；上传云端/手动网址走普通直链。
            const useAssetUris = trustedSource === 'library';
            const targetPlatform = deps.videoProviderPlatform(runSettings.videoProvider || 'comfly');
            let mismatchedAsset = false;
            const effUrl = ref => {
                const uris = (ref && ref.asset_uris && typeof ref.asset_uris === 'object') ? ref.asset_uris : null;
                if(useAssetUris && uris && Object.keys(uris).length){
                    // asset:// 与平台绑定：取当前视频平台对应的认证地址；该素材没注册到这个平台就回退本地 url
                    if(targetPlatform && uris[targetPlatform]) return uris[targetPlatform];
                    mismatchedAsset = true;
                }
                return ref?.url;
            };
            const refImages = deps.imageRefsOnly(uploadedRefs).map((ref, i) => {
                const item = {url:effUrl(ref), name:ref.name || `图${i + 1}`};
                if(runSettings.videoUseFrameRoles){
                    if(i === 0) item.role = 'first_frame';
                    else if(i === 1) item.role = 'last_frame';
                }
                return item;
            });
            // 云端上传/手动链接只替换素材 URL，不能改变原引用的媒体类型。
            // 否则图片的云端 URL 会被无条件塞进 videos，导致 APIMart 把 PNG 当参考视频解析。
            const refVideos = deps.videoRefsOnly(uploadedRefs).map(ref => effUrl(ref)).filter(Boolean);
            const refAudios = deps.audioRefsOnly(uploadedRefs).map(ref => effUrl(ref)).filter(Boolean).slice(0, 3);
            if(mismatchedAsset) deps.toast('部分认证素材属于其它平台，已回退为普通素材。切换到对应平台的视频接口才能用 asset:// 认证地址。');
            const payload = {
                prompt,
                provider_id: runSettings.videoProvider || 'comfly',
                model: runSettings.videoModel || 'veo3-fast',
                duration: Math.max(1, Math.min(60, Number(runSettings.videoDuration) || 5)),
                aspect_ratio: runSettings.videoAspect || '16:9',
                resolution: runSettings.videoResolution || '',
                images: refImages,
                videos: refVideos,
                audios: refAudios,
                enhance_prompt: Boolean(runSettings.videoEnhancePrompt),
                enable_upsample: Boolean(runSettings.videoEnableUpsample),
                watermark: Boolean(runSettings.videoWatermark),
                camerafixed: Boolean(runSettings.videoCameraFixed),
                generate_audio: Boolean(runSettings.videoGenerateAudio),
                multimodal: Boolean(runSettings.videoMultimodal),
                trusted_asset: useAssetUris
            };
            const previousWarning = await markSmartVideoSubmissionBeforeRequest(deps, node);
            try {
                const durableTaskId = node?.videoTaskId || '';
                const response = await deps.fetch(durableTaskId ? '/api/canvas-video-tasks' : '/api/canvas-video', {
                    method:'POST',
                    headers:{'Content-Type':'application/json'},
                    body:JSON.stringify(durableTaskId ? {...payload, client_task_id:durableTaskId} : payload)
                });
                if(!response.ok){
                    const error = new Error(await deps.smartResponseErrorMessage(response, deps.tr('smart.errRunFailed')));
                    if(response.status >= 400 && response.status < 500 && response.status !== 408){
                        restoreSmartVideoSubmissionWarning(deps, node, previousWarning);
                    }
                    throw error;
                }
                let result = await response.json();
                if(durableTaskId){
                    node.videoTaskStatus = 'running';
                    deps.scheduleSave();
                    result = await deps.pollSmartVideoCanvasTask(durableTaskId);
                }
                if(result && result.jimeng_pending) throw new deps.JimengPendingSignal({submitId:result.submit_id, kind:result.kind || 'video', queueInfo:result.queue_info, message:result.message});
                const urls = deps.resultMediaUrls(result);
                if(urls.length){
                    if(durableTaskId){
                        node.pendingTasks = deps.smartPendingTasks(node).filter(task => task.taskId !== durableTaskId);
                        delete node.videoTaskId;
                        delete node.videoTaskStatus;
                        delete node.videoTaskError;
                        node.pending = deps.smartPendingTasks(node).length;
                    }
                    restoreSmartVideoSubmissionWarning(deps, node, previousWarning);
                }
                else if(runState) runState.submissionUnknown = true;
                return urls;
            } catch(error) {
                if(runState && node.submissionUnknown) runState.submissionUnknown = true;
                throw error;
            }
        } finally {
            deps.transientSmartCloudLinks = [];
        }
    }

    const api={runApiGeneration, restoreSmartVideoSubmissionWarning, markSmartVideoSubmissionBeforeRequest, runApiVideoGeneration};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.SmartApiRunner=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
