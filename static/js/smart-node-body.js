/* Smart node view responsibility: smart-node-body. Host supplies live state and effects. */
(function(root){
    'use strict';

function promptNodeBodyHtml(deps, node){
    node.llmProvider = deps.resolveChatProviderId(node.llmProvider || '');
    node.llmModel = deps.resolveChatModel(node.llmModel || '', node.llmProvider);
    node.llmSystemEnabled = node.llmSystemEnabled === true;
    node.promptSplitEnabled = node.promptSplitEnabled === true;
    node.promptSeparator = deps.promptNodeSeparator(node);
    const readonly = node.llmEnabled ? 'readonly' : '';
    const systemPrompt = (node.llmSystemPrompt || '').trim();
    const inputThumbs = deps.smartNodeInputThumbsHtml(deps.promptNodeInputImages(node));
    const templateActive = deps.activePromptTemplateNodeId() === node.id;
    const promptItems = deps.promptNodePromptItems(node);
    const promptSplitPreviewH = deps.promptNodeSplitPreviewHeight(node);
    const upstreamPromptItems = deps.promptNodeUpstreamPromptItems(node);
    const upstreamPromptHtml = upstreamPromptItems.length ? `<div class="prompt-node-upstream">
        <div class="prompt-node-section-title">上游输入</div>
        <div class="prompt-node-upstream-list">${upstreamPromptItems.map((item, index) => `<div class="prompt-node-segment"><span>${index + 1}</span><p>${deps.escapeHtml(item)}</p></div>`).join('')}</div>
    </div>` : '';
    const llmParams = node.llmEnabled ? `
        <div class="prompt-node-llm">
            <select class="prompt-node-control prompt-llm-provider">${deps.chatProviderOptions(node.llmProvider)}</select>
            <select class="prompt-node-control prompt-llm-model">${deps.chatModelOptions(node.llmModel, node.llmProvider)}</select>
            <div class="prompt-llm-instruction-wrap">
                <textarea class="prompt-node-control prompt-llm-instruction" placeholder="${deps.escapeHtml(deps.tr('smart.promptLlmInstructionPlaceholder'))}" style="height:${deps.promptLlmInstructionHeight(node)}px">${deps.escapeHtml(node.llmInstruction || '')}</textarea>
                <div class="prompt-llm-instruction-resize prompt-node-control" data-llm-instruction-resize="1" title="拖动调整高度"><span></span></div>
            </div>
            ${upstreamPromptHtml}
            <div class="prompt-node-llm-actions">
                <button class="prompt-node-run prompt-node-control" type="button" ${node.running ? 'disabled' : ''}><i data-lucide="${node.running ? 'loader-2' : 'play'}"></i><span>${node.running ? deps.escapeHtml(deps.tr('common.running')) : deps.escapeHtml(deps.tr('common.run'))}</span></button>
                <button class="prompt-node-pill prompt-node-control prompt-system-toggle ${node.llmSystemEnabled ? 'active' : ''}" type="button"><i data-lucide="${node.llmSystemEnabled ? 'toggle-right' : 'toggle-left'}"></i><span>${deps.escapeHtml(node.llmSystemEnabled ? deps.tr('smart.promptLlmDisableSystem') : deps.tr('smart.promptLlmEnableSystem'))}</span></button>
            </div>
            ${node.llmSystemEnabled ? `<textarea class="prompt-node-control prompt-llm-system" placeholder="${deps.escapeHtml(deps.tr('smart.promptLlmSystemPlaceholder'))}">${deps.escapeHtml(systemPrompt || 'You are a helpful prompt assistant.')}</textarea>` : ''}
        </div>` : '';
    return `<div class="prompt-node-card">
        ${node.llmEnabled && node.llmOutputStale ? '<div class="prompt-node-section-title">旧结果 · 规则已变化，运行后更新</div>' : ''}
        <textarea class="prompt-node-text prompt-node-control" ${readonly} placeholder="${deps.escapeHtml(deps.tr('smart.promptPlaceholderNode'))}">${deps.escapeHtml(node.text || '')}</textarea>
        <div class="prompt-node-tools">
            <button class="prompt-node-pill prompt-node-control prompt-preset-edit ${templateActive ? 'active' : ''}" type="button"><i data-lucide="library"></i><span>模板库</span></button>
            <button class="prompt-node-pill prompt-node-control prompt-split-toggle ${node.promptSplitEnabled ? 'active' : ''}" type="button"><i data-lucide="split"></i><span>分隔符</span></button>
            <button class="prompt-node-pill prompt-llm-toggle ${node.llmEnabled ? 'active' : ''}" type="button"><i data-lucide="sparkles"></i><span>LLM</span></button>
        </div>
        ${node.promptSplitEnabled ? `<div class="prompt-node-split-row">
            <label class="prompt-node-split-control prompt-node-control"><span>分隔符</span><input class="prompt-node-separator" type="text" value="${deps.escapeHtml(node.promptSeparator)}" maxlength="8" placeholder=";"></label>
            <span class="prompt-node-split-count">${promptItems.length || 0} 段</span>
        </div>
        <div class="prompt-node-segments" style="height:${promptSplitPreviewH}px">${promptItems.length ? promptItems.map((item, index) => `<div class="prompt-node-segment"><span>${index + 1}</span><p>${deps.escapeHtml(item)}</p></div>`).join('') : ''}</div>
        <div class="prompt-split-preview-resize prompt-node-control" data-prompt-split-resize="1" title="拖动调整高度"><span></span></div>` : ''}
        ${inputThumbs}
        ${llmParams}
    </div>`;
}

function smartLoopBodyHtml(deps, node){
    node.count = deps.smartLoopCount(node);
    node.mode = node.mode === 'parallel' ? 'parallel' : 'serial';
    node.loopStart = Math.max(1, Number(node.loopStart) || 1);
    node.imageBatchSize = Math.max(1, Math.min(100, Number(node.imageBatchSize) || 1));
    node.showPrompt = Boolean(node.showPrompt);
    node.imageInput = Boolean(node.imageInput);
    const imageCount = deps.smartLoopInputImages(node, {index:node.loopStart}).length;
    const loopThumbs = deps.smartNodeInputThumbsHtml(deps.smartLoopPreviewImages(node));
    const promptItems = deps.smartLoopInputPromptItems(node);
    const promptFields = deps.smartLoopPromptFieldValues(node);
    const visiblePromptFields = promptFields.length ? promptFields : [''];
    const promptHint = promptItems.length
        ? deps.trf('smart.loopPromptHintFound', {n:promptItems.length})
        : deps.tr('smart.loopPromptHintVariable');
    const currentUpstreamPrompt = deps.smartLoopSelectedInputPrompt(node, {index:node.loopStart});
    const defaultPrompt = deps.smartLoopDefaultPromptText();
    const loopRunState = deps.smartCascadeRunForLoop(node.id);
    const loopRunning = Boolean(loopRunState);
    const loopStopping = Boolean(loopRunState?.stopRequested);
    return `<div class="loop-smart-card ${node.imageInput ? 'has-image' : ''} ${node.showPrompt ? 'has-prompt' : ''}">
        <div class="loop-smart-row loop-smart-top">
            <div class="loop-smart-seg">
                <button type="button" class="loop-smart-control ${node.mode !== 'parallel' ? 'active' : ''}" data-loop-mode="serial">${deps.escapeHtml(deps.tr('canvas.loopSerial'))}</button>
                <button type="button" class="loop-smart-control ${node.mode === 'parallel' ? 'active' : ''}" data-loop-mode="parallel" title="${deps.escapeHtml(deps.tr('smart.loopParallelTip'))}">${deps.escapeHtml(deps.tr('canvas.loopParallel'))}</button>
            </div>
        </div>
        <div class="loop-smart-row">
            <button class="loop-smart-control loop-smart-toggle ${node.imageInput ? 'active' : ''}" type="button" data-loop-toggle="image"><i data-lucide="image"></i><span>${deps.escapeHtml(deps.tr('canvas.loopImageToggle'))}</span></button>
            <button class="loop-smart-control loop-smart-toggle ${node.showPrompt ? 'active' : ''}" type="button" data-loop-toggle="prompt"><i data-lucide="text-cursor-input"></i><span>${deps.escapeHtml(deps.tr('canvas.loopPromptToggle'))}</span></button>
        </div>
        ${node.imageInput ? `<div class="loop-smart-panel">
            ${loopThumbs}
            <div class="loop-smart-mini">
                ${deps.loopNumberControlHtml({label:deps.tr('canvas.loopBatchSize'), value:node.imageBatchSize, key:'imageBatchSize', max:100, quick:[1,2,3,4,5,6,8,10]})}
            </div>
            <div class="loop-smart-note">${imageCount ? deps.escapeHtml(deps.trf('canvas.loopImageWillOutput', {n:imageCount})) : deps.escapeHtml(deps.tr('canvas.loopImageEmpty'))}</div>
        </div>` : ''}
        ${node.showPrompt ? `<div class="loop-smart-panel prompt-panel">
            ${currentUpstreamPrompt ? `<div class="loop-smart-upstream">
                <div class="loop-smart-upstream-label">${deps.escapeHtml(promptHint)}</div>
                <div class="loop-smart-upstream-text">${deps.escapeHtml(currentUpstreamPrompt)}</div>
            </div>` : ''}
            <div class="loop-smart-prompt-list">
                ${visiblePromptFields.map((value, index) => {
                    const displayValue = promptItems.length && deps.isSmartLoopDefaultPrompt(value) ? '' : value;
                    return `<div class="loop-smart-prompt-item">
                    <div class="loop-smart-prompt-index">${index + 1}</div>
                    <div class="loop-smart-control loop-smart-text" contenteditable="true" data-loop-prompt-index="${index}" data-placeholder="${deps.escapeHtml(deps.tr('canvas.loopVariablePlaceholder'))}">${deps.smartLoopVariableHtml(displayValue || (index === 0 && !promptFields.length && !promptItems.length ? defaultPrompt : ''))}</div>
                    <button class="loop-smart-control loop-smart-icon-btn" type="button" data-loop-prompt-delete="${index}" ${visiblePromptFields.length <= 1 ? 'disabled' : ''} title="${deps.escapeHtml(deps.tr('common.delete'))}" aria-label="${deps.escapeHtml(deps.tr('common.delete'))}">×</button>
                </div>`;
                }).join('')}
            </div>
            <div class="loop-smart-row loop-smart-prompt-actions">
                <button class="loop-smart-control loop-smart-token loop-smart-counter-token" type="button" data-loop-token="《计数》">${deps.escapeHtml(deps.tr('canvas.counterToken'))}</button>
                <span class="loop-smart-note">${deps.escapeHtml(promptHint)}</span>
                <button class="loop-smart-control loop-smart-add-prompt" type="button" data-loop-prompt-add="1" title="新增" aria-label="新增"><i data-lucide="plus"></i></button>
            </div>
        </div>` : ''}
        <div class="loop-smart-footer">
            ${deps.loopNumberControlHtml({label:deps.tr('canvas.loopImageStart'), value:node.loopStart, key:'loopStart', max:9999, quick:[1,2,3,4,5,6,8,10]})}
            ${deps.loopNumberControlHtml({label:deps.tr('canvas.loopCount'), value:node.count, key:'count', max:100, quick:[1,2,3,4,5,6,8,10]})}
            <button class="loop-smart-control loop-smart-run ${loopRunning ? 'is-stop' : ''}" type="button" data-loop-run="${deps.escapeHtml(node.id)}" ${loopStopping ? 'disabled' : ''}><i data-lucide="${loopRunning ? 'square' : 'workflow'}"></i><span>${deps.escapeHtml(loopRunning ? deps.smartCascadeStopText(loopStopping) : deps.tr('smart.loopRunAll'))}</span></button>
        </div>
    </div>`;
}

function smartGroupBodyHtml(deps, node){
    const groupThumbLayout = deps.smartGroupThumbLayout(node);
    const refThumbs = groupThumbLayout?.refs || [];
    const members = deps.smartGroupMembers(node);
    const counts = members.reduce((acc, member) => {
        if(member.type === 'smart-prompt') acc.prompt += 1;
        else if(member.type === 'smart-loop') acc.loop += 1;
        return acc;
    }, {prompt:0, media:refThumbs.length, loop:0});
    const summary = [
        counts.prompt ? `${counts.prompt} 提示词` : '',
        counts.media ? `${counts.media} 图片` : '',
        counts.loop ? `${counts.loop} 循环` : ''
    ].filter(Boolean).join(' · ') || '双击或拖入图片';
    if(refThumbs.length){
        const totalThumbs = Math.max(1, Number(groupThumbLayout?.rows || 1) * Number(groupThumbLayout?.cols || 1));
        if(totalThumbs === 1 && refThumbs.length === 1){
            const ref = refThumbs[0];
            const innerW = Math.max(24, Number(groupThumbLayout.innerW || groupThumbLayout.width || deps.SMART_GROUP_DEFAULT_WIDTH));
            const innerH = Math.max(24, Number(groupThumbLayout.innerH || groupThumbLayout.height || deps.SMART_GROUP_DEFAULT_HEIGHT));
            const canDelete = ref.nodeId === node.id;
            return `<div class="smart-group-card has-thumbs">
                <div class="smart-group-summary"><i data-lucide="group"></i><span>${deps.escapeHtml(summary)}</span></div>
                <div class="image-wrap smart-group-single-thumb ${deps.selectedImage.nodeId === ref.nodeId && Number(deps.selectedImage.index) === Number(ref.index) ? 'image-selected' : ''}" data-ref-node-id="${deps.escapeAttr(ref.nodeId)}" data-ref-image-index="${ref.index}" data-image-index="${ref.index}" data-media-signature="${deps.escapeAttr(`${deps.mediaKindForItem(ref.item)}:${ref.item?.url || ''}`)}" style="--node-img-w:${innerW}px;--node-img-h:${innerH}px">${deps.singleMediaHtml(ref.item, innerW, innerH)}${deps.imageNameBadgeHtml(ref.item)}${deps.imageResolutionBadgeHtml(ref.item)}${canDelete ? `<button class="mini-x image-delete" type="button" data-image-index="${ref.index}" title="${deps.escapeHtml(deps.tr('smart.deleteImage'))}"><i data-lucide="trash-2"></i></button>` : ''}</div>
            </div>`;
        }
        const groupMaxVisibleRows = (groupThumbLayout.compactMembers || []).length ? Number(groupThumbLayout.rows || 1) : deps.SMART_GROUP_MAX_VISIBLE_ROWS;
        const visibleRows = Math.max(1, Math.min(groupMaxVisibleRows, Number(groupThumbLayout.visibleRows || groupThumbLayout.rows || 1)));
        const maxHeight = Math.max(44, visibleRows * Number(groupThumbLayout.thumb || 96) + Math.max(0, visibleRows - 1) * 8);
        return `<div class="smart-group-card has-thumbs">
            <div class="smart-group-summary"><i data-lucide="group"></i><span>${deps.escapeHtml(summary)}</span></div>
            <div class="thumb-grid smart-group-thumb-grid" data-thumb-scroll="1" style="--thumb-cols:${groupThumbLayout.cols}; --thumb-size:${groupThumbLayout.thumb}px; --thumb-max-height:${maxHeight}px">${refThumbs.map(ref => {
                const canDelete = ref.nodeId === node.id;
                return `<div class="thumb-item ${deps.selectedImage.nodeId === ref.nodeId && Number(deps.selectedImage.index) === Number(ref.index) ? 'image-selected' : ''}" data-ref-node-id="${deps.escapeAttr(ref.nodeId)}" data-ref-image-index="${ref.index}" data-image-index="${ref.index}" data-media-signature="${deps.escapeAttr(`${deps.mediaKindForItem(ref.item)}:${ref.item?.url || ''}`)}">${deps.thumbMediaHtml(ref.item)}${deps.imageNameBadgeHtml(ref.item)}${deps.imageResolutionBadgeHtml(ref.item)}${canDelete ? `<button class="mini-x image-delete" type="button" data-image-index="${ref.index}" title="${deps.escapeHtml(deps.tr('smart.deleteImage'))}"><i data-lucide="trash-2"></i></button>` : ''}</div>`;
            }).join('')}</div>
        </div>`;
    }
    return `<div class="smart-group-card">
        <div class="smart-group-summary"><i data-lucide="group"></i><span>${deps.escapeHtml(summary)}</span></div>
        ${members.length ? '' : `<div class="smart-group-empty"><i data-lucide="plus"></i><span>拖入图片自动收进分组</span></div>`}
    </div>`;
}

function nodeBodyHtml(deps, node, layout){
    if(deps.isSmartImageNode(node)){const audioBody=deps.smartAudioBodyHtml(node);if(audioBody)return audioBody;}
    if(node.depthCapture && !(node.images || []).length){
        const capture = node.depthCapture;
        const running = ['queued','running','submitting','query-error'].includes(capture.status);
        const progress = Math.max(0, Math.min(100, Math.round(Number(capture.progress) || 0)));
        return `<div class="canvas-depth-task" style="width:${layout.width}px;min-height:${layout.height}px"><strong>${capture.role === 'pose' ? '骨骼姿态参考' : '灰度深度参考'}</strong><span>${deps.escapeHtml(capture.stage || '准备处理')}${capture.error ? `：${deps.escapeHtml(capture.error)}` : ''}</span><span class="canvas-depth-progress-label">进度 ${progress}%</span><div class="canvas-depth-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><i style="width:${progress}%"></i></div><div class="canvas-depth-task-actions">${running && capture.taskId ? '<button type="button" data-depth-action="cancel">取消</button>' : ''}${capture.sourceId && ['failed','cancelled'].includes(capture.status) ? '<button type="button" data-depth-action="retry">重试</button>' : ''}</div></div>`;
    }
    const media = nodeMediaBodyHtml(deps, node, layout);
    if(node.depthCapture?.role === 'pose' && node.depthCapture.pose_data_url){
        return `${media}<div class="canvas-depth-task-actions"><a href="${deps.escapeAttr(node.depthCapture.pose_data_url)}" download>下载关节 JSON</a></div>`;
    }
    const task = (node.type === 'smart-image' || !node.type) && (node.images || []).length
        ? deps.smartRecoverableImageTask(node) : null;
    if(!task) return media;
    return `${media}<div class="partial-task-recovery">${imageTaskRecoverBodyHtml(deps, node, task, {width:layout.width, height:150})}</div>`;
}

function nodeMediaBodyHtml(deps, node, layout){

    if(node.type === 'smart-group') return smartGroupBodyHtml(deps, node);
    if(node.type === 'smart-prompt') return promptNodeBodyHtml(deps, node);
    if(node.type === 'smart-loop') return smartLoopBodyHtml(deps, node);
    const imgs = (node.images || []).map(deps.imageForDisplay);
    if(node.jimengPending && node.jimengPending.submitId && imgs.length === 0){
        return jimengPendingBodyHtml(deps, node, layout);
    }
    const recoverTask = deps.smartRecoverableImageTask(node);
    if(recoverTask && imgs.length === 0){
        return imageTaskRecoverBodyHtml(deps, node, recoverTask, layout);
    }
    if(node.queued && imgs.length === 0 && !node.pending){
        return `<div class="loading-cell single queued" style="width:${layout.width}px;height:${layout.height}px"></div>`;
    }
    if(node.pending && imgs.length === 0){
        const count = Math.max(1, Number(node.pending) || 1);
        if(count <= 1) return `<div class="loading-cell single" style="width:${layout.width}px;height:${layout.height}px"></div>`;
        const cols = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(count))));
        const rows = Math.ceil(count / cols);
        return `<div class="loading-skeleton" style="grid-template-columns:repeat(${cols}, 1fr);grid-template-rows:repeat(${rows}, 1fr);width:${layout.width}px;height:${layout.height}px;padding:8px;box-sizing:border-box">${Array.from({length:count}).map(() => `<div class="loading-cell"></div>`).join('')}</div>`;
    }
    if(imgs.length > 1){
        const visibleRows = Math.max(1, Math.min(deps.MEDIA_GROUP_MAX_VISIBLE_ROWS, Number(layout.visibleRows || layout.rows || 1)));
        const maxHeight = visibleRows * Number(layout.thumb || 96) + Math.max(0, visibleRows - 1) * 8;
        return `<div class="thumb-grid" data-thumb-scroll="1" style="--thumb-cols:${layout.cols}; --thumb-size:${layout.thumb}px; --thumb-max-height:${maxHeight}px">${imgs.map((img, i) => `<div class="thumb-item has-outside-image-name ${deps.selectedImage.nodeId === node.id && deps.selectedImage.index === i ? 'image-selected' : ''}" data-image-index="${i}" data-media-signature="${deps.escapeAttr(`${deps.mediaKindForItem(img)}:${img?.url || ''}`)}">${deps.thumbMediaHtml(img)}${deps.imageNameBadgeHtml(img, {outside:true})}${deps.imageResolutionBadgeHtml(img)}<button class="mini-x image-delete" type="button" data-image-index="${i}" title="${deps.escapeHtml(deps.tr('smart.deleteImage'))}"><i data-lucide="trash-2"></i></button></div>`).join('')}</div>`;
    }
    if(imgs[0]) return `<div class="image-wrap has-outside-image-name ${deps.selectedImage.nodeId === node.id && deps.selectedImage.index === 0 ? 'image-selected' : ''}" data-image-index="0" data-media-signature="${deps.escapeAttr(`${deps.mediaKindForItem(imgs[0])}:${imgs[0]?.url || ''}`)}" style="--node-img-w:${layout.width}px;--node-img-h:${layout.height}px">${deps.singleMediaHtml(imgs[0], layout.width, layout.height)}${deps.imageNameBadgeHtml(imgs[0], {outside:true})}${deps.imageResolutionBadgeHtml(imgs[0])}<button class="mini-x image-delete" type="button" data-image-index="0" title="${deps.escapeHtml(deps.tr('smart.deleteImage'))}"><i data-lucide="trash-2"></i></button></div>`;
    if(node.viewAdjust) return `<div class="node-drop view-adjust-ready">
        <span class="upload-node-main"><i data-lucide="${node.viewAdjust.kind === 'angle' ? 'camera' : 'sun'}"></i></span>
        <span class="upload-node-title">${node.viewAdjust.kind === 'angle' ? '多角度' : '打光'}待生成</span>
        <span class="upload-node-sub">提示词与原图已关联</span>
    </div>`;
    return `<div class="node-drop" data-upload-action="files">
        <span class="upload-node-main"><i data-lucide="upload-cloud"></i></span>
        <span class="upload-node-title">${deps.escapeHtml(deps.tr('smart.createImportNode'))}</span>
        <span class="upload-node-sub">拖拽 / 粘贴 / 点击上传</span>
    </div>`;
}

function jimengPendingBodyHtml(deps, node, layout){
    const jp = node.jimengPending || {};
    const querying = Boolean(jp.querying);
    const queueText = deps.jimengQueueText(jp.queueInfo);
    return `<div class="jimeng-pending-cell loading-cell single" style="width:${layout.width}px;height:${layout.height}px">
        <div class="jimeng-pending-overlay">
            <div class="jimeng-pending-spinner"><i data-lucide="loader-2"></i></div>
            <div class="jimeng-pending-text">${deps.escapeHtml(queueText)}</div>
            <div class="jimeng-pending-sub">任务未丢失，可继续等待或手动查询</div>
            <button class="jimeng-pending-query" type="button" data-jimeng-query="${deps.escapeAttr(node.id)}" ${querying ? 'disabled' : ''}><i data-lucide="${querying ? 'loader-2' : 'refresh-cw'}"></i><span>${querying ? '查询中…' : '查询结果'}</span></button>
        </div>
    </div>`;
}

function imageTaskRecoverBodyHtml(deps, node, task, layout){
    const querying = Boolean(task.querying);
    const failedCount = deps.smartPendingTasks(node).filter(item => item.failed && item.recoverTaskId).length;
    const taskLost = Boolean(task.taskLost);
    const remoteRefreshable = Boolean(task.remoteRefreshable && task.taskId);
    const title = querying ? '查询中' : remoteRefreshable ? '远端状态未知' : taskLost ? '本地任务记录已失效' : task.queryPaused ? '查询暂停，任务未丢失' : '任务未丢失';
    const sub = taskLost ? (task.error || '远端状态未知，请勿直接重新提交') : failedCount > 1 ? `还有 ${failedCount} 个任务可查询` : `任务 ID：${task.queryPaused ? task.taskId : task.recoverTaskId || task.taskId || ''}`;
    return `<div class="jimeng-pending-cell loading-cell single" style="width:${layout.width}px;height:${layout.height}px">
        <div class="jimeng-pending-overlay">
            <div class="jimeng-pending-spinner"><i data-lucide="${querying ? 'loader-2' : 'refresh-cw'}"></i></div>
            <div class="jimeng-pending-text">${deps.escapeHtml(title)}</div>
            <div class="jimeng-pending-sub">${deps.escapeHtml(sub)}</div>
            <button class="jimeng-pending-query" type="button" data-image-task-query="${deps.escapeAttr(node.id)}" data-task-id="${deps.escapeAttr(task.taskId)}" ${querying || (taskLost && !remoteRefreshable) ? 'disabled' : ''}><i data-lucide="${querying ? 'loader-2' : 'refresh-cw'}"></i><span>${querying ? '查询中…' : remoteRefreshable ? '刷新远端结果' : taskLost ? '请勿重新提交' : '查询结果'}</span></button>
        </div>
    </div>`;
}

function smartNodeToolbarHtml(deps, node){
    const isImageNode = node?.type === 'smart-image' || !node?.type;
    const images = node?.images || [];
    if(!isImageNode || !images.some(img => img?.url)) return '';
    const item = deps.imageForDisplay(images[deps.smartNodeToolbarImageIndex(node)] || images.find(img => img?.url));
    if(!item?.url) return '';
    const kind = deps.mediaKindForItem(item);
    const canEditImage = kind === 'image';
    const imageCount = images.filter(img => deps.mediaKindForItem(deps.imageForDisplay(img)) === 'image' && deps.imageForDisplay(img)?.url).length;
    const gridLabel = imageCount > 1 ? '宫格拼接' : '宫格切分';
    const actions = [
        {key:'preview', icon:'eye', label:'预览', enabled:kind === 'image' || kind === 'video'},
        {key:'video-edit', icon:'scan-face', label:'编辑', enabled:kind === 'video'},
        {key:'crop', icon:'crop', label:'裁剪', enabled:canEditImage},
        {key:'outpaint', icon:'expand', label:'扩图', enabled:canEditImage},
        {key:'mask', icon:'brush', label:'遮罩', enabled:canEditImage},
        {key:'brush', icon:'paintbrush', label:'画笔', enabled:canEditImage},
        {key:'grid', icon:'grid-3x3', label:gridLabel, enabled:canEditImage},
        ...(deps.jimengImageProviderId() ? [{key:'upscale', icon:'maximize-2', label:deps.tr('smart.jimengUpscaleAction'), enabled:canEditImage}] : []),
        {key:'download', icon:'download', label:'下载', enabled:true}
    ];
    return `<div class="smart-node-floating-menu" data-smart-node-menu="1">${canEditImage ? deps.CanvasViewAdjust.menuHtml() : ''}${actions.map(action => `
        <button type="button" data-smart-node-action="${deps.escapeAttr(action.key)}" data-node-id="${deps.escapeAttr(node.id)}" ${action.enabled ? '' : 'disabled'} title="${deps.escapeAttr(action.label)}">
            <i data-lucide="${deps.escapeAttr(action.icon)}"></i><span>${deps.escapeHtml(action.label)}</span>
        </button>`).join('')}</div>`;
}

function smartGroupToolbarHtml(deps, node){
    if(!deps.isSmartGroupNode(node)) return '';
    const hasContent = (node.images || []).some(img => img?.url) || deps.smartGroupMembers(node).length > 0;
    const imageCount = (node.images || []).filter(img => img?.url).length;
    const actions = [
        {key:'arrange', icon:'layout-grid', label:'整理排列', enabled:hasContent},
        {key:'preview', icon:'eye', label:'预览', enabled:imageCount > 0},
        {key:'grid', icon:'grid-3x3', label:'宫格拼接', enabled:imageCount > 1},
        {key:'download', icon:'archive', label:'批量下载', enabled:imageCount > 0},
        {key:'ungroup', icon:'ungroup', label:'解散分组', enabled:true}
    ];
    return `<div class="smart-node-floating-menu" data-smart-group-menu="1">${actions.map(action => `
        <button type="button" data-smart-group-action="${deps.escapeAttr(action.key)}" data-node-id="${deps.escapeAttr(node.id)}" ${action.enabled ? '' : 'disabled'} title="${deps.escapeAttr(action.label)}">
            <i data-lucide="${deps.escapeAttr(action.icon)}"></i><span>${deps.escapeHtml(action.label)}</span>
        </button>`).join('')}</div>`;
}

    const api={promptNodeBodyHtml, smartLoopBodyHtml, smartGroupBodyHtml, nodeBodyHtml, nodeMediaBodyHtml, jimengPendingBodyHtml, imageTaskRecoverBodyHtml, smartNodeToolbarHtml, smartGroupToolbarHtml};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.SmartNodeBody=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
