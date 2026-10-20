/* Smart panorama and media preview responsibility: smart-media-preview. Host supplies live state and effects. */
(function(root){
    'use strict';

function applyPreviewTransform(deps){
    const frame = deps.document.getElementById('previewFrame');
    if(frame){
        frame.style.transform = deps.panoramaState.enabled ? '' : `translate(${deps.previewPan.x}px, ${deps.previewPan.y}px) scale(${deps.previewZoom})`;
    }
    deps.updateZoomLabel();
}

function resetPreviewTransform(deps){
    deps.previewZoom = 1.0;
    deps.previewPan = {x:0, y:0};
    deps.previewComparePos = 50;
    deps.document.getElementById('previewStage')?.style.setProperty('--compare-pos', `${deps.previewComparePos}%`);
    applyPreviewTransform(deps);
}

function setPreviewComparePos(deps, clientX){
    const frame = deps.document.getElementById('previewFrame');
    const stage = deps.document.getElementById('previewStage');
    if(!frame || !stage) return;
    const rect = frame.getBoundingClientRect();
    const pct = Math.max(0, Math.min(100, ((clientX - rect.left) / Math.max(1, rect.width)) * 100));
    deps.previewComparePos = pct;
    stage.style.setProperty('--compare-pos', `${pct}%`);
}

function syncPreviewFrameSize(deps){
    const frame = deps.document.getElementById('previewFrame');
    if(deps.panoramaState.enabled){
        deps.resizePanoramaViewer();
        return;
    }
    const currentImg = deps.document.getElementById('previewCurrentImage');
    const currentVideo = deps.document.getElementById('previewCurrentVideo');
    const compareImg = deps.document.getElementById('previewCompareImage');
    const currentMedia = currentVideo && currentVideo.style.display !== 'none' ? currentVideo : currentImg;
    if(!frame || !currentMedia) return;
    const w = currentMedia.clientWidth || currentMedia.videoWidth || currentMedia.naturalWidth || 1;
    const h = currentMedia.clientHeight || currentMedia.videoHeight || currentMedia.naturalHeight || 1;
    frame.style.width = `${w}px`;
    frame.style.height = `${h}px`;
    if(compareImg){
        compareImg.style.width = `${w}px`;
        compareImg.style.height = `${h}px`;
    }
}

function previewResolutionText(deps){
    const editing = deps.currentEditImage();
    const image = editing.image || {};
    const currentImg = deps.document.getElementById('previewCurrentImage');
    const currentVideo = deps.document.getElementById('previewCurrentVideo');
    const cropImg = deps.document.getElementById('cropImage');
    const w = Number(image.natural_w || image.width || image.w || 0) || Number(currentVideo?.videoWidth || 0) || Number(currentImg?.naturalWidth || 0) || Number(cropImg?.naturalWidth || 0);
    const h = Number(image.natural_h || image.height || image.h || 0) || Number(currentVideo?.videoHeight || 0) || Number(currentImg?.naturalHeight || 0) || Number(cropImg?.naturalHeight || 0);
    if(!w || !h) return '';
    return `${deps.tr('smart.resolution')}: ${Math.round(w)} x ${Math.round(h)}`;
}

function updatePreviewMetaHint(deps, extraText=deps.previewMetaExtraText){
    deps.previewMetaExtraText = extraText || '';
    const hint = deps.document.getElementById('previewMetaHint');
    if(!hint) return;
    hint.textContent = [previewResolutionText(deps), deps.previewMetaExtraText].filter(Boolean).join(' · ');
}

function rememberPreviewImageResolution(deps){
    const editing = deps.currentEditImage();
    const image = editing.image;
    if(!image) return;
    const currentImg = deps.document.getElementById('previewCurrentImage');
    const currentVideo = deps.document.getElementById('previewCurrentVideo');
    const cropImg = deps.document.getElementById('cropImage');
    const w = Number(currentVideo?.videoWidth || 0) || Number(currentImg?.naturalWidth || 0) || Number(cropImg?.naturalWidth || 0);
    const h = Number(currentVideo?.videoHeight || 0) || Number(currentImg?.naturalHeight || 0) || Number(cropImg?.naturalHeight || 0);
    if(w > 0 && h > 0 && (!image.natural_w || !image.natural_h)){
        image.natural_w = w;
        image.natural_h = h;
        deps.scheduleSave();
    }
}

function previewCompareSources(deps){
    const editing = deps.currentEditImage();
    const node = editing.node;
    if(!node) return [];
    const savedRefs = Array.isArray(node.runInputRefs) ? node.runInputRefs.filter(ref => ref?.url) : [];
    const upstream = savedRefs.length ? savedRefs : deps.inputImagesFor(node);
    const dedup = [];
    const seen = new Set();
    for(const img of upstream){
        if(!img?.url || seen.has(img.url) || deps.mediaKindForItem(img) !== 'image') continue;
        seen.add(img.url);
        dedup.push(img);
    }
    if(dedup.length) return dedup;
    const sourceId = node.sourceNodeId;
    if(sourceId){
        const src = deps.nodes.find(n => n.id === sourceId);
        if(src && (src.images || []).length){
            for(const img of src.images){
                if(!img?.url || seen.has(img.url) || deps.mediaKindForItem(img) !== 'image') continue;
                seen.add(img.url);
                dedup.push(img);
            }
        }
    }
    return dedup;
}

function refreshComparePanel(deps){
    const stage = deps.document.getElementById('previewStage');
    const compareImg = deps.document.getElementById('previewCompareImage');
    const currentImg = deps.document.getElementById('previewCurrentImage');
    const currentVideo = deps.document.getElementById('previewCurrentVideo');
    const compareLayer = deps.document.getElementById('previewCompareLayer');
    const compareHandle = deps.document.getElementById('previewCompareHandle');
    const thumbsEl = deps.document.getElementById('compareThumbs');
    const toggle = deps.document.getElementById('compareToggleBtn');
    const panoramaToggle = deps.document.getElementById('panoramaToggleBtn');
    const editing = deps.currentEditImage();
    const curUrl = editing.image?.url || '';
    const isVideoPreview = deps.mediaKindForItem(editing.image || {}) === 'video';
    const isPreviewMode = deps.imageEditMode === 'preview';
    if(panoramaToggle){
        panoramaToggle.style.display = isPreviewMode && !isVideoPreview ? 'inline-flex' : 'none';
        panoramaToggle.classList.toggle('active', deps.panoramaState.enabled);
    }
    if(!isPreviewMode && deps.panoramaState.enabled) deps.disposePanoramaPreview();
    if(deps.panoramaState.enabled && isPreviewMode && !isVideoPreview){
        currentImg.onload = null;
        currentImg.onerror = null;
        currentImg.style.display = 'none';
        stage?.classList.remove('compare-on');
        if(compareLayer) compareLayer.style.display = 'none';
        if(compareHandle) compareHandle.style.display = 'none';
        if(thumbsEl){ thumbsEl.style.display = 'none'; thumbsEl.innerHTML = ''; }
        if(toggle) toggle.classList.remove('active');
        updatePreviewMetaHint(deps, deps.tr('smart.panoramaHint'));
        return;
    }
    const onCurrentLoaded = () => {
        if(currentImg.dataset.previewQuick !== '1') rememberPreviewImageResolution(deps);
        syncPreviewFrameSize(deps);
        updatePreviewMetaHint(deps);
    };
    if(isVideoPreview){
        currentImg.onload = null;
        currentImg.onerror = null;
        currentImg.removeAttribute('src');
        currentImg.style.display = 'none';
        if(currentVideo){
            const previewSrc = deps.displayMediaUrl(editing.image || curUrl);
            currentVideo.style.display = 'block';
            currentVideo.onloadedmetadata = onCurrentLoaded;
            currentVideo.onloadeddata = onCurrentLoaded;
            if(currentVideo.getAttribute('src') !== previewSrc){
                currentVideo.src = previewSrc;
                currentVideo.load?.();
            }
            if(currentVideo.readyState >= 1) deps.requestAnimationFrame(onCurrentLoaded);
        }
        deps.previewCompareOn = false;
        deps.previewCompareIndex = -1;
        stage.classList.remove('compare-on');
        if(compareLayer) compareLayer.style.display = 'none';
        if(compareHandle) compareHandle.style.display = 'none';
        if(thumbsEl){ thumbsEl.style.display = 'none'; thumbsEl.innerHTML = ''; }
        if(toggle){
            toggle.disabled = true;
            toggle.style.opacity = '.45';
            toggle.classList.remove('active');
            toggle.title = deps.tr('smart.compareEmpty');
        }
        if(panoramaToggle) panoramaToggle.style.display = 'none';
        updatePreviewMetaHint(deps, editing.node?.runPrompt ? `${deps.tr('smart.runPromptPrefix')}${editing.node.runPrompt.slice(0, 60)}` : '');
        return;
    }
    if(currentVideo){
        currentVideo.pause?.();
        currentVideo.onloadedmetadata = null;
        currentVideo.onloadeddata = null;
        currentVideo.removeAttribute('src');
        currentVideo.load?.();
        currentVideo.style.display = 'none';
    }
    currentImg.style.display = 'block';
    currentImg.onload = onCurrentLoaded;
    currentImg.onerror = () => {
        if(currentImg.dataset.proxyFallbackTried === '1') return;
        const fallback = deps.proxiedMediaUrl(editing.image || curUrl);
        if(!fallback || fallback === currentImg.getAttribute('src')) return;
        currentImg.dataset.proxyFallbackTried = '1';
        currentImg.src = fallback;
    };
    const previewSrc = deps.displayMediaUrl(editing.image || curUrl);
    const quickPreviewSrc = deps.smartMediaPreviewUrl(editing.image || curUrl, 1536);
    const previewToken = `${editing.node?.id || ''}:${editing.index ?? 0}:${Date.now()}`;
    currentImg.dataset.previewSrcToken = previewToken;
    const loadFullPreview = () => {
        if(deps.imageEditMode !== 'preview' || !deps.imageEditModal.classList.contains('open')) return;
        if(currentImg.dataset.previewSrcToken !== previewToken) return;
        currentImg.dataset.previewQuick = '';
        if(currentImg.getAttribute('src') !== previewSrc) currentImg.src = previewSrc;
    };
    if(quickPreviewSrc && quickPreviewSrc !== previewSrc){
        currentImg.dataset.proxyFallbackTried = '';
        currentImg.dataset.previewQuick = '1';
        if(currentImg.getAttribute('src') !== quickPreviewSrc) currentImg.src = quickPreviewSrc;
        deps.requestAnimationFrame(() => deps.setTimeout(loadFullPreview, 120));
    } else if(currentImg.getAttribute('src') !== previewSrc) {
        currentImg.dataset.proxyFallbackTried = '';
        currentImg.dataset.previewQuick = '';
        currentImg.src = previewSrc;
    } else {
        currentImg.dataset.previewQuick = '';
    }
    if(currentImg.complete && currentImg.naturalWidth) deps.requestAnimationFrame(onCurrentLoaded);
    const sources = previewCompareSources(deps);
    const hasSource = sources.length > 0;
    if(toggle){
        toggle.disabled = !hasSource;
        toggle.style.opacity = hasSource ? '1' : '.45';
        toggle.title = hasSource ? deps.tr('smart.compareHover') : deps.tr('smart.compareEmpty');
        toggle.classList.toggle('active', hasSource && deps.previewCompareOn);
    }
    if(!hasSource){
        deps.previewCompareOn = false;
        deps.previewCompareIndex = -1;
        stage.classList.remove('compare-on');
        if(compareLayer) compareLayer.style.display = 'none';
        if(compareHandle) compareHandle.style.display = 'none';
        thumbsEl.style.display = 'none';
        updatePreviewMetaHint(deps, editing.node?.runPrompt ? `${deps.tr('smart.runPromptPrefix')}${editing.node.runPrompt.slice(0, 60)}` : '');
        return;
    }
    const sliderActive = deps.previewCompareOn && deps.previewCompareIndex >= 0 && deps.previewCompareIndex < sources.length;
    if(sliderActive){
        const src = sources[deps.previewCompareIndex];
        compareImg.src = src?.url || '';
        compareImg.onload = (...args)=>syncPreviewFrameSize(deps, ...args);
        syncPreviewFrameSize(deps);
        stage.classList.add('compare-on');
        if(compareLayer) compareLayer.style.display = '';
        if(compareHandle) compareHandle.style.display = '';
    } else {
        stage.classList.remove('compare-on');
        if(compareLayer) compareLayer.style.display = 'none';
        if(compareHandle) compareHandle.style.display = 'none';
    }
    if(deps.previewCompareOn){
        thumbsEl.style.display = 'inline-flex';
        thumbsEl.innerHTML = sources.map((s, i) => `<button type="button" class="compare-thumb ${i === deps.previewCompareIndex ? 'active' : ''}" data-compare-idx="${i}" title="${deps.escapeHtml(i === deps.previewCompareIndex ? deps.tr('smart.compareCancelTip') : deps.tr('smart.compareUseTip'))}">${deps.smartPreviewImgHtml(s.url, 256)}</button>`).join('');
        deps.bindSmartPreviewImageFallbacks(thumbsEl);
        thumbsEl.querySelectorAll('[data-compare-idx]').forEach(btn => {
            btn.onclick = e => {
                e.preventDefault(); e.stopPropagation();
                const idx = Number(btn.dataset.compareIdx);
                deps.previewCompareIndex = (deps.previewCompareIndex === idx) ? -1 : idx;
                refreshComparePanel(deps);
            };
        });
    } else {
        thumbsEl.style.display = 'none';
        thumbsEl.innerHTML = '';
    }
    let txt = editing.node?.runPrompt ? `${deps.tr('smart.runPromptPrefix')}${editing.node.runPrompt.slice(0, 60)}` : '';
    if(deps.previewCompareOn && !sliderActive) txt = (txt ? `${txt} · ` : '') + deps.tr('smart.compareHintPick');
    updatePreviewMetaHint(deps, txt);
}

function togglePreviewCompare(deps){
    const sources = previewCompareSources(deps);
    if(!sources.length){ deps.toast(deps.tr('smart.compareNoSource')); return; }
    deps.previewCompareOn = !deps.previewCompareOn;
    if(deps.previewCompareOn && (deps.previewCompareIndex < 0 || deps.previewCompareIndex >= sources.length)) deps.previewCompareIndex = 0;
    if(!deps.previewCompareOn) deps.previewCompareIndex = -1;
    refreshComparePanel(deps);
}

function currentPreviewVideo(deps){
    if(!deps.imageEditModal.classList.contains('open')) return null;
    if(deps.mediaKindForItem(deps.currentEditImage().image || {}) !== 'video') return null;
    return deps.document.getElementById('previewCurrentVideo');
}

function videoFrameStep(deps){
    const image = deps.currentEditImage().image || {};
    const fps = Number(image.fps || image.frameRate || image.frame_rate || image.framespersecond || image.frames_per_second || 0);
    return 1 / Math.max(1, Math.min(120, Number.isFinite(fps) && fps > 0 ? fps : 30));
}

function seekPreviewVideoFrames(deps, direction){
    const video = currentPreviewVideo(deps);
    if(!video || video.readyState < 1) return false;
    video.pause?.();
    const step = videoFrameStep(deps);
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    const maxTime = duration ? Math.max(0, duration - step / 2) : Number.MAX_SAFE_INTEGER;
    video.currentTime = Math.max(0, Math.min(maxTime, Number(video.currentTime || 0) + direction * step));
    return true;
}

function waitForVideoEvent(deps, video, eventName, timeout=1500){
    return new Promise(resolve => {
        let done = false;
        const finish = () => {
            if(done) return;
            done = true;
            deps.clearTimeout(timer);
            video.removeEventListener(eventName, finish);
            resolve();
        };
        const timer = deps.setTimeout(finish, timeout);
        video.addEventListener(eventName, finish, {once:true});
    });
}

async function seekVideoForFrame(deps, video, time){
    if(Math.abs(Number(video.currentTime || 0) - time) <= 0.002) return;
    video.currentTime = time;
    await waitForVideoEvent(deps, video, 'seeked', 2200);
}

async function exportVideoFrame(deps, which='current'){
    const video = currentPreviewVideo(deps);
    if(!video){ deps.toast('没有可导出的视频帧'); return; }
    if(video.readyState < 2) await waitForVideoEvent(deps, video, 'loadeddata', 2200);
    if(!video.videoWidth || !video.videoHeight){ deps.toast('视频还没有加载完成'); return; }
    const originalTime = Number(video.currentTime || 0);
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    const step = videoFrameStep(deps);
    const target = which === 'first'
        ? 0
        : which === 'last'
            ? Math.max(0, duration - step / 2)
            : originalTime;
    const suffix = which === 'first' ? 'first-frame' : which === 'last' ? 'last-frame' : 'current-frame';
    try {
        video.pause?.();
        await seekVideoForFrame(deps, video, target);
        const canvasEl = deps.document.createElement('canvas');
        canvasEl.width = video.videoWidth;
        canvasEl.height = video.videoHeight;
        const ctx = canvasEl.getContext('2d');
        ctx.drawImage(video, 0, 0, canvasEl.width, canvasEl.height);
        const blob = await new Promise(resolve => canvasEl.toBlob(resolve, 'image/png'));
        if(!blob) throw new Error('导出帧失败');
        const editing = deps.currentEditImage();
        const rawName = editing.image?.name || deps.fileNameFromUrl(editing.image?.url || '') || 'video';
        const base = String(rawName).replace(/\.[a-z0-9]{2,8}$/i, '') || 'video';
        const filename = deps.safeExportFileName(`${base}-${suffix}.png`, `${suffix}.png`);
        const uploaded = await deps.uploadFiles([new deps.File([blob], filename, {type:'image/png'})]);
        const frame = uploaded[0];
        if(!frame?.url) throw new Error('导出到画布失败');
        frame.kind = 'image';
        frame.natural_w = video.videoWidth;
        frame.natural_h = video.videoHeight;
        const rect = editing.node ? deps.nodeRect(editing.node) : null;
        const point = rect
            ? {x:rect.x + rect.width + 240, y:rect.y + rect.height / 2}
            : deps.viewportCenter();
        deps.pushUndo();
        const newNode = deps.createImageNodeAt(point, [frame], {select:true, skipUndo:true});
        deps.selectedIds = [];
        deps.selectedImage = {nodeId:newNode.id, index:0};
        deps.render();
        deps.scheduleSave();
        deps.toast('已导出到画布');
        if(which !== 'current') await seekVideoForFrame(deps, video, originalTime);
    } catch(e) {
        deps.toast((e.message || '导出帧失败').slice(0, 120));
    }
}

function updatePreviewNavButtons(deps){
    let count;
    if(deps.previewNavState.groupId && Array.isArray(deps.previewNavState.seq)){
        count = deps.previewNavState.seq.length;
    } else {
        const node = deps.nodes.find(n => n.id === deps.previewNavState.nodeId);
        count = Math.max(0, (node?.images || []).filter(img => img?.url).length);
    }
    deps.previewNavState.count = count;
    const show = deps.imageEditModal.classList.contains('open') && deps.imageEditMode === 'preview' && count > 1;
    deps.document.getElementById('previewPrevBtn')?.classList.toggle('visible', show);
    deps.document.getElementById('previewNextBtn')?.classList.toggle('visible', show);
}

function navigatePreviewImage(deps, delta){
    if(!deps.imageEditModal.classList.contains('open') || deps.imageEditMode !== 'preview') return;
    // 分组预览：跨成员节点按整组序列左右切换（openImageEditor 会重置 previewNavState，故切换后重新挂回分组上下文）。
    if(deps.previewNavState.groupId && Array.isArray(deps.previewNavState.seq) && deps.previewNavState.seq.length > 1){
        const groupId = deps.previewNavState.groupId;
        const seq = deps.previewNavState.seq;
        const pos = (Number(deps.previewNavState.seqPos || 0) + Number(delta || 0) + seq.length) % seq.length;
        const ref = seq[pos];
        deps.openImageEditor(ref.nodeId, ref.index);
        if(deps.imageEditModal.classList.contains('open')){
            deps.previewNavState.groupId = groupId;
            deps.previewNavState.seq = seq;
            deps.previewNavState.seqPos = pos;
            // openImageEditor 重置了 previewNavState，需在恢复分组上下文后重算导航/下载全部按钮。
            deps.setImageEditMode('preview');
        }
        return;
    }
    const node = deps.nodes.find(n => n.id === deps.previewNavState.nodeId);
    const images = (node?.images || []).filter(img => img?.url);
    if(!node || images.length <= 1) return;
    const count = images.length;
    const next = (Number(deps.previewNavState.index || 0) + Number(delta || 0) + count) % count;
    deps.openImageEditor(node.id, next);
}

function openImagePreview(deps, nodeId, imageIndex=0){
    deps.openImageEditor(nodeId, imageIndex);
    deps.setImageEditMode('preview');
}

function openImagePreviewSmart(deps, nodeId, imageIndex=0){
    const group = deps.smartGroupContainingNode(nodeId);
    if(group){
        openGroupImagePreview(deps, group, nodeId, imageIndex);
        return;
    }
    openImagePreview(deps, nodeId, imageIndex);
}

function openGroupImagePreview(deps, group, startNodeId, startIndex=0){
    if(!deps.isSmartGroupNode(group)){ openImagePreview(deps, startNodeId, startIndex); return; }
    const refs = deps.smartGroupImageRefs(group);
    if(refs.length <= 1){ openImagePreview(deps, startNodeId, startIndex); return; }
    const seq = refs.map(r => ({nodeId:r.nodeId, index:r.index}));
    let pos = seq.findIndex(s => s.nodeId === startNodeId && Number(s.index) === Number(startIndex));
    if(pos < 0) pos = 0;
    openImagePreview(deps, seq[pos].nodeId, seq[pos].index);
    if(!deps.imageEditModal.classList.contains('open')) return;
    deps.previewNavState.groupId = group.id;
    deps.previewNavState.seq = seq;
    deps.previewNavState.seqPos = pos;
    // 恢复分组上下文后重算导航/下载全部按钮（openImageEditor 已把 previewNavState 重置成单节点态）。
    deps.setImageEditMode('preview');
}

    const api={applyPreviewTransform, resetPreviewTransform, setPreviewComparePos, syncPreviewFrameSize, previewResolutionText, updatePreviewMetaHint, rememberPreviewImageResolution, previewCompareSources, refreshComparePanel, togglePreviewCompare, currentPreviewVideo, videoFrameStep, seekPreviewVideoFrames, waitForVideoEvent, seekVideoForFrame, exportVideoFrame, updatePreviewNavButtons, navigatePreviewImage, openImagePreview, openImagePreviewSmart, openGroupImagePreview};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.SmartMediaPreview=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
