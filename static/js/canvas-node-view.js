/* Classic node view responsibility: canvas-node-view. Host supplies live state and effects. */
(function(root){
'use strict';

function renderNode(deps, node){
    if(node.depthCapture && (node.x == null || node.x === '' || !Number.isFinite(Number(node.x)))){
        const source = deps.nodes.find(item => item.id === node.depthCapture.sourceId);
        const sourceX = Number(source?.x);
        const sourceY = Number(source?.y);
        const sourceWidth = Number(source?.w) || deps.defaultNodeSize(source?.type || 'image').w || 260;
        node.x = (Number.isFinite(sourceX) ? sourceX : 0) + sourceWidth + 70;
        if(node.y == null || node.y === '' || !Number.isFinite(Number(node.y))){
            node.y = (Number.isFinite(sourceY) ? sourceY : 0) + (node.depthCapture.role === 'pose' ? 245 : 0);
        }
    }
    deps.normalizeApiNodeLayout(node);
    if(node.type === 'rh' && Number(node.h) === 560) delete node.h;
    const el = deps.document.createElement('div');
    const size = deps.defaultNodeSize(node.type);
    const hasFixedSize = Boolean(node.h || size.h);
    el.className = `node ${node.type}-node ${node.url ? 'has-image' : ''} ${hasFixedSize ? 'sized' : ''} ${deps.selected.has(node.id) ? 'selected' : ''}`;
    el.style.left = `${node.x}px`;
    el.style.top = `${node.y}px`;
    el.style.width = `${node.w || size.w}px`;
    if(node.h || size.h) el.style.height = `${node.h || size.h}px`;
    el.dataset.id = node.id;
    el.onclick = (e) => {
        e.stopPropagation();
        if(deps.isNodeControl(e.target)) return;
        deps.window.CanvasClipNode?.closeAll(node.type==='clip'?node.id:undefined);
        if(e.ctrlKey || e.metaKey) deps.selected.has(node.id) ? deps.selected.delete(node.id) : deps.selected.add(node.id);
        else if(!deps.selected.has(node.id)) { deps.selected.clear(); deps.selected.add(node.id); }
        deps.refreshSelectionVisuals();
    };
    el.oncontextmenu = e => {
    if(!deps.CANVAS_GENERATOR_TYPES.includes(node.type) && node.type !== 'output') return;
        e.preventDefault();
        e.stopPropagation();
        if(node.type === 'output') deps.openOutputNodeMenu(node.id, e.clientX, e.clientY);
        else deps.openGeneratorNodeMenu(node.id, e.clientX, e.clientY);
    };
    const title = node.type === 'audio' ? '音频素材' : node.type === 'image' ? 'Image' : node.type === 'prompt' ? 'Prompt' : node.type === 'loop' ? deps.tr('canvas.loopNode') : node.type === 'promptGroup' ? 'Prompts' : node.type === 'group' ? 'Group' : node.type === 'output' ? 'Output' : node.type === 'llm' ? 'LLM' : node.type === 'comfy' ? 'ComfyUI' : node.type === 'rh' ? 'RunningHub' : node.type === 'midjourney' ? 'Midjourney' : node.type === 'msgen' ? deps.tr('canvas.modelscopeGenerate') : node.type === 'video' ? deps.tr('canvas.videoGenerateNode') : deps.tr('canvas.apiGenerate');
    const shotRow=node.shotTableOrigin&&deps.nodes.find(n=>n.id===node.shotTableOrigin.tableId)?.shotTableData?.rows.find(row=>row.id===node.shotTableOrigin.rowId);
    const shotStage=node.shotTableOrigin?.stage==='video'?'视频':'图片';
    const shotLabel={prompt:`${shotStage}提示词`,generator:shotStage==='视频'?'视频生成 API':'生图 API',result:`${shotStage}结果`}[node.shotTableOrigin?.role]||(shotStage==='视频'?'视频':'画面');
    const displayTitle = shotRow ? deps.escapeHtml(`镜头 ${shotRow.index} · ${shotLabel}`) : node.type === 'shot-table' ? '分镜表' : node.depthCapture ? (node.depthCapture.role === 'pose' ? '骨骼姿态' : '灰度深度') : node.type === 'image' && node.url ? deps.nodeTitleForMedia(node) : title;
    // 失败徽章只在一键运行模式中显示，单节点失败已通过 alert 提示
    const showStatus = ['generator','midjourney','msgen','comfy','llm','video','rh'].includes(node.type) && node.runStatus
        && (node.runStatus !== 'failed' || node._cascadeFailed);
    const statusHtml = showStatus ? (() => {
        const label = { queued:'排队中', running:'运行中', done:'完成', failed:'失败' }[node.runStatus] || '';
        return `<span class="node-run-status ${node.runStatus}"><span class="dot"></span>${deps.escapeHtml(label)}${node._cascadeIdx?' '+node._cascadeIdx:''}</span>`;
    })() : '';
    const submissionWarningHtml = node.submissionWarning
        ? `<button type="button" class="node-run-status failed node-submission-warning" style="border:0;cursor:pointer;font-family:inherit" title="${deps.escapeAttr(node.submissionWarning)}"><span class="dot"></span>${node.submissionUnknown ? '提交状态未知' : '部分受理'}</button>` : '';
    el.innerHTML = `<div class="node-head"><span class="node-title">${displayTitle}</span><div style="display:flex;align-items:center;gap:8px">${statusHtml}${submissionWarningHtml}<button type="button" onclick="deleteNodeFromButton('${node.id}', event)" class="node-delete"><i data-lucide="x" class="w-4 h-4"></i></button></div></div>`;
    el.querySelector('.node-submission-warning')?.addEventListener('click', e => {
        e.stopPropagation();
        deps.showErrorModal(node.submissionWarning, deps.tr('canvas.apiFailed'));
    });
    const body = deps.document.createElement('div');
    body.className = 'node-body';
    if(node.type === 'image') {
        if(node.url) {
            const missing = deps.isMissingAssetUrl(node.url);
            const mediaKind = deps.mediaKindForNode(node);
            const isEditableImage = mediaKind === 'image' && !missing;
            body.innerHTML = `<div class="image-preview-wrap">${missing ? deps.missingAssetHtml(node.url) : deps.canvasPreviewImgHtml(node.url, 768, 'draggable="false"')}</div><div class="image-caption text-[11px] text-gray-400 truncate">${deps.escapeHtml(node.name || 'image')}${missing ? ` · ${deps.langIsEn() ? 'missing' : '文件缺失'}` : ''}</div>`;
            if(!missing && mediaKind !== 'image'){
                const mediaHtml = mediaKind === 'video'
                    ? `<div class="media-card video-card">${deps.canvasVideoPreviewHtml(node.url, 768, 'draggable="false" data-video-fallback-attrs="controls"')}<button class="canvas-video-play" type="button" title="播放"><i data-lucide="play"></i></button></div>`
                    : `<div class="media-card audio-card"><i data-lucide="file-audio" class="w-8 h-8"></i><div class="audio-title">${deps.escapeHtml(node.name || 'Audio')}</div><div class="audio-sub">AUDIO</div><audio src="${deps.escapeAttr(node.url)}" data-url="${deps.escapeAttr(node.url)}" controls preload="metadata"></audio></div>`;
                body.innerHTML = `<div class="image-preview-wrap">${mediaHtml}</div><div class="image-caption text-[11px] text-gray-400 truncate">${deps.escapeHtml(node.name || deps.nodeTitleForMedia(node))}</div>`;
            }
            if(node.depthCapture?.role === 'pose' && node.depthCapture.pose_data_url){
                body.insertAdjacentHTML('beforeend', `<div class="canvas-depth-task-actions"><a href="${deps.escapeAttr(node.depthCapture.pose_data_url)}" download>下载关节 JSON</a></div>`);
            }
            const previewWrap = body.querySelector('.image-preview-wrap');
            const loadedImg = body.querySelector('img');
            const videoPlayBtn = body.querySelector('.canvas-video-play');
            const openPreview = e => {
                if(!node.url || missing) return;
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                if(isEditableImage) deps.openImageEditor(node.id, (e.shiftKey || e.altKey) ? 'crop' : 'preview');
                else deps.openImageNodePreview(node.id);
            };
            body.onmousedown = e => {
                if(e.detail >= 2){
                    openPreview(e);
                    return;
                }
                deps.startNodeDrag(e, node);
            };
            body.ondragover = e => deps.allowImageNodeDropEvent(e, previewWrap);
            body.ondragleave = e => {
                e.stopPropagation();
                previewWrap.classList.remove('drag-over');
            };
            body.ondrop = e => deps.handleImageNodeDropEvent(e, node.id, previewWrap);
            body.oncontextmenu = e => {
                e.preventDefault();
                e.stopPropagation();
                deps.openImageNodeMenu(node.id, e.clientX, e.clientY);
            };
            if(loadedImg && isEditableImage){
                loadedImg.addEventListener('mousedown', e => {
                    if(e.detail >= 2) openPreview(e);
                }, true);
                loadedImg.addEventListener('dblclick', openPreview, true);
            }
            if(loadedImg && mediaKind === 'video'){
                loadedImg.addEventListener('mousedown', e => {
                    if(e.button !== 0) return;
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                }, true);
                loadedImg.addEventListener('click', e => {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    deps.canvasActivateVideoPreview(e.currentTarget || loadedImg);
                }, true);
            }
            if(videoPlayBtn && loadedImg && mediaKind === 'video'){
                videoPlayBtn.addEventListener('mousedown', e => {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                }, true);
                videoPlayBtn.addEventListener('click', e => {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    deps.canvasActivateVideoPreview(videoPlayBtn.closest('.media-card,.image-preview-wrap') || loadedImg);
                }, true);
            }
            body.addEventListener('dblclick', openPreview, true);
            if(loadedImg && loadedImg.complete && loadedImg.naturalHeight > 0){
                deps.requestAnimationFrame(deps.refreshGeometry);
            } else if(loadedImg) {
                loadedImg.onload = () => deps.refreshGeometryAfterLayout();
            }
        } else if(node.depthCapture){
            const capture = node.depthCapture;
            const running = ['queued','running','submitting','query-error'].includes(capture.status);
            const progress = Math.max(0, Math.min(100, Math.round(Number(capture.progress) || 0)));
            body.innerHTML = `<div class="canvas-depth-task"><strong>${capture.role === 'pose' ? '骨骼姿态参考' : '灰度深度参考'}</strong><span>${deps.escapeHtml(capture.stage || '准备处理')}${capture.error ? `：${deps.escapeHtml(capture.error)}` : ''}</span><span class="canvas-depth-progress-label">进度 ${progress}%</span><div class="canvas-depth-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><i style="width:${progress}%"></i></div><div class="canvas-depth-task-actions">${running && capture.taskId ? `<button type="button" data-depth-action="cancel">取消</button>` : ''}${capture.sourceId && ['failed','cancelled'].includes(capture.status) ? `<button type="button" data-depth-action="retry">重试</button>` : ''}</div></div>`;
            body.onmousedown = event => {
                if(event.button !== 0 || event.target.closest('button, a')) return;
                deps.startNodeDrag(event, node);
            };
            body.querySelectorAll('[data-depth-action]').forEach(button => {
                button.onclick = event => {
                    event.stopPropagation();
                    if(button.dataset.depthAction === 'retry') deps.retryCanvasDepthCapture(node.id);
                    else deps.cancelCanvasDepthCapture(node.id);
                };
            });
        } else {
        body.innerHTML = `<div class="blank-image"><i data-lucide="image-plus" class="w-7 h-7"></i><div class="text-[11px] font-bold">${deps.tr('canvas.clickDragPasteImage')}</div></div>`;
            const blank = body.querySelector('.blank-image');
            blank.onclick = () => deps.pickImageForNode(node.id);
            blank.ondragover = e => deps.allowImageNodeDropEvent(e, blank);
            blank.ondragleave = e => { e.stopPropagation(); blank.classList.remove('drag-over'); };
            blank.ondrop = e => deps.handleImageNodeDropEvent(e, node.id, blank);
        }
    }
    if(node.type==='audio')body.appendChild(deps.renderCanvasAudioMaterial(node));
    if(node.type === 'prompt') {
        const templateActive = deps.promptTemplateModal?.classList.contains('open') && deps.promptTemplateNodeId === node.id;
        body.innerHTML = `<div class="prompt-editor"><div class="prompt-toolbar"><button class="prompt-template-btn ${templateActive ? 'active' : ''}" type="button" data-prompt-template-open data-prompt-template-node-id="${deps.escapeAttr(node.id)}" aria-pressed="${templateActive ? 'true' : 'false'}" title="${deps.escapeAttr(deps.tr('canvas.promptTemplateLibrary'))}"><i data-lucide="library"></i><span>${deps.escapeHtml(deps.tr('canvas.promptTemplateShort'))}</span></button>${deps.promptCounterHtml(node.text || '')}</div><textarea placeholder="${deps.tr('canvas.promptPlaceholder')}">${deps.escapeHtml(node.text || '')}</textarea></div>`;
        const textarea = body.querySelector('textarea');
        const templateBtn = body.querySelector('[data-prompt-template-open]');
        templateBtn.onclick = e => {
            e.preventDefault();
            e.stopPropagation();
            deps.openPromptTemplateModal(node.id);
        };
        deps.bindScrollableText(textarea);
        textarea.oninput = e => {
            node.text = e.target.value;
            deps.refreshPromptCounter(body, node.text);
            deps.scheduleSave();
            deps.scheduleGeneratorInputSync();
        };
    }
    if(node.type === 'loop') body.appendChild(deps.renderLoopBody(node));
    if(node.type === 'group') {
        const items = (node.items || []).map(id => deps.nodes.find(n => n.id === id)).filter(Boolean);
        const imgCount = items.filter(n => n.type === 'image' && deps.mediaKindForNode(n) === 'image').length;
        const videoCount = items.filter(n => n.type === 'image' && deps.mediaKindForNode(n) === 'video').length;
        const audioCount = items.filter(n => ['image','audio'].includes(n.type) && deps.mediaKindForNode(n) === 'audio').length;
        const promptCount = items.filter(n => n.type === 'prompt').length;
        const parts = [];
        const otherCount = items.length - imgCount - videoCount - audioCount - promptCount;
        if(otherCount) parts.push(deps.langIsEn() ? `${items.length} nodes` : `${items.length} 个节点`);
        if(imgCount) parts.push(`${imgCount} ${deps.tr('canvas.imageCount')}`);
        if(videoCount) parts.push(deps.langIsEn() ? `${videoCount} video` : `${videoCount} 个视频`);
        if(audioCount) parts.push(deps.langIsEn() ? `${audioCount} audio` : `${audioCount} 个音频`);
        if(promptCount) parts.push(`${promptCount} ${deps.tr('canvas.promptCount')}`);
        if(!parts.length && items.length) parts.push(deps.langIsEn() ? `${items.length} items` : `${items.length} 项素材`);
        const text = parts.length ? `${parts.join(' · ')} ${deps.tr('canvas.grouped')}` : deps.tr('canvas.groupEmpty');
        body.innerHTML = `<div class="text-[11px] text-gray-400">${text}</div>`;
        const previewItems = deps.groupImageItems(node);
        if(previewItems.length){
            const openGroupPreview = e => {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation?.();
                deps.openGroupLightbox(node.id);
            };
            body.style.cursor = 'zoom-in';
            body.onmousedown = e => {
                if(e.button !== 0) return;
                if(e.detail >= 2){
                    openGroupPreview(e);
                    return;
                }
                deps.startNodeDrag(e, node);
            };
            body.ondblclick = openGroupPreview;
        }
    }
    if(node.type === 'promptGroup') {
        const promptNodes = (node.items || []).map(id => deps.nodes.find(n => n.id === id)).filter(Boolean);
        body.innerHTML = `<div class="text-[11px] text-gray-400">${promptNodes.length} ${deps.tr('canvas.promptCount')} ${deps.tr('canvas.grouped')}</div>`;
    }
    if(node.type === 'llm') body.appendChild(deps.renderLLMBody(node));
    if(node.type === 'generator') body.appendChild(deps.renderGeneratorBody(node));
    if(node.type === 'midjourney') body.appendChild(deps.renderMidjourneyBody(node));
    if(node.type === 'msgen') body.appendChild(deps.renderMsGenBody(node));
    if(node.type === 'video') body.appendChild(deps.renderVideoBody(node));

    if(node.type === 'rh') body.appendChild(deps.renderRhBody(node));
    if(node.type === 'comfy') body.appendChild(deps.renderComfyBody(node));

    if(node.shotTableOrigin?.inlineOutput){
        const preview=deps.document.createElement('div');
        preview.className='shot-inline-results';
        preview.innerHTML=deps.renderOutputGrid(node,(node._pending||[]).map(p=>deps.renderPendingOutput(p)).join(''));
        preview.querySelectorAll('.output-img-wrap').forEach(wrap=>deps.bindOutputWrap(wrap,node));
        body.appendChild(preview);
    }
    if(node.type === 'output') {
        const pendingHtml = (node._pending || []).map(p =>
            deps.renderPendingOutput(p)
        ).join('');
        body.innerHTML = deps.renderOutputGrid(node, pendingHtml)+(node.audioOutputText?`<div class="audio-recognition-result">${deps.escapeHtml(node.audioOutputText)}</div>`:'');
        body.onwheel = e => {
            e.stopPropagation();
        };
        body.querySelectorAll('.output-img-wrap').forEach(wrap => deps.bindOutputWrap(wrap, node));
    }
    el.appendChild(body);
    if(node.type==='clip' && deps.window.CanvasClipBridge) deps.window.CanvasClipNode.mount(el,node,deps.window.CanvasClipBridge.forNode(node.id));
    if(node.type==='shot-table' && deps.window.CanvasVideoDeconstructionBridge) deps.window.CanvasVideoDeconstructionUI.mount(el,node,deps.window.CanvasVideoDeconstructionBridge);
    el.querySelectorAll('button, select, textarea, input').forEach(control => {
        // 镜头表的控件由表格容器统一处理，保持事件能到达该容器。
        if(control.closest('.shot-table-body')) return;
        control.addEventListener('mousedown', e => e.stopPropagation(), true);
        control.addEventListener('click', e => e.stopPropagation());
    });
    el.onmousedown = e => {
        if(e.button !== 0 || !deps.isNodeDragSurface(e.target)) return;
        deps.startNodeDrag(e, node);
    };
    const canInput = Boolean(node.storyWorkflowOrigin) || Boolean(node.depthCapture) || node.type==='shot-table' || ['audio','image','prompt','group','promptGroup','clip','generator','midjourney','comfy','output','llm','msgen','video','rh'].includes(node.type) || (node.type === 'loop' && (node.imageInput || node.showPrompt));
    const canOutput = node.type==='shot-table' || ['clip','image','audio','prompt','loop','group','promptGroup','generator','midjourney','comfy','llm','msgen','video','rh','output'].includes(node.type);
    if(canInput) el.insertAdjacentHTML('beforeend', `<div class="port in" title="${deps.tr('canvas.connectHere')}"></div>`);
    if(canOutput) el.insertAdjacentHTML('beforeend', `<div class="port out" title="${deps.tr('canvas.dragConnect')}"></div>`);
    el.insertAdjacentHTML('beforeend', `<div class="resize-handle" title="${deps.tr('canvas.resize')}"></div>`);
    el.querySelector('.node-head').onmousedown = e => {
        if(e.button !== 0) return;
        if(deps.isNodeControl(e.target)) return;
        if(node.type === 'group' && e.detail >= 2 && deps.groupImageItems(node).length){
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation?.();
            deps.openGroupLightbox(node.id);
            return;
        }
        deps.startNodeDrag(e, node);
    };
    el.querySelector('.resize-handle').onmousedown = e => { if(e.button === 0 && !e.shiftKey) deps.startNodeResize(e, node); };
    el.ondragstart = e => { if(e.target.closest('[data-audio-drag]'))return; e.preventDefault(); e.stopPropagation(); };
    const out = el.querySelector('.port.out');
    if(out) out.onmousedown = e => { if(e.button === 0 && !e.shiftKey) deps.startLink(e, node.id, 'out'); };
    const inp = el.querySelector('.port.in');
    if(inp) inp.onmousedown = e => { if(e.button === 0 && !e.shiftKey) deps.startLink(e, node.id, 'in'); };
    return el;
}

const api={renderNode};
if(typeof module!=='undefined' && module.exports) module.exports=api;
root.CanvasNodeView=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
