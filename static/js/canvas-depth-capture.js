(function(){
    'use strict';
    const endpoint = '/api/canvas-depth-capture';
    const active = new Map();
    let current = null;
    let modal = null;

    function escapeHtml(value){
        return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    }
    function icon(name){ return `<i data-lucide="${name}" class="w-4 h-4"></i>`; }
    function operationId(){
        return (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, '');
    }
    async function request(url, options){
        const response = await fetch(url, options);
        let body;
        try { body = await response.json(); } catch(_error){ body = {}; }
        if(!response.ok){
            const error = new Error(body.detail || `请求失败（${response.status}）`);
            error.status = response.status;
            throw error;
        }
        return body;
    }
    async function submit(sourceUrl, id){
        return request(endpoint, {method:'POST', headers:{'Content-Type':'application/json'},
            body:JSON.stringify({source_url:sourceUrl, operation_id:id})});
    }
    async function get(taskId){ return request(`${endpoint}/${encodeURIComponent(taskId)}`); }
    async function cancel(taskId){ return request(`${endpoint}/${encodeURIComponent(taskId)}/cancel`, {method:'POST'}); }

    function watch(key, fetchState, onUpdate){
        if(active.has(key)) return;
        let stopped = false;
        active.set(key, () => { stopped = true; active.delete(key); });
        const tick = async () => {
            if(stopped) return;
            try {
                const task = await fetchState();
                if(stopped) return;
                onUpdate(task);
                if(['succeeded','failed','cancelled'].includes(task.status)){
                    active.get(key)?.();
                    return;
                }
            } catch(error){
                if(!stopped){
                    if(Number(error.status) === 404){
                        onUpdate({status:'failed', stage:'任务记录已失效', error:'任务不存在，请点击重试'});
                        active.get(key)?.();
                        return;
                    }
                    onUpdate({status:'query-error', stage:'暂时无法查询任务', error:error.message});
                }
            }
            if(!stopped) setTimeout(tick, 1500);
        };
        tick();
    }

    function ensureModal(){
        if(modal) return modal;
        modal = document.createElement('div');
        modal.className = 'depth-capture-modal';
        modal.innerHTML = `<div class="depth-capture-panel" role="dialog" aria-modal="true" aria-label="视频编辑">
            <div class="depth-capture-head"><div><strong>视频编辑</strong><span id="depthCaptureTitle"></span></div><button type="button" data-action="close" aria-label="关闭">${icon('x')}</button></div>
            <div class="depth-capture-tabs"><button type="button" data-tab="preview" class="active">${icon('play')}预览</button><button type="button" data-tab="capture">${icon('scan-face')}深度动作捕捉</button></div>
            <div class="depth-capture-body"><div class="depth-capture-video"><video id="depthCaptureSource" controls preload="metadata" playsinline></video></div>
            <div id="depthCapturePreview" class="depth-capture-info">原视频预览。处理后会保留原视频，并在画布上新增灰度深度与独立骨骼参考。</div>
            <div id="depthCaptureCapture" class="depth-capture-info" hidden>
                <p>从同一原视频导出两份对齐的参考：灰度深度视频保持纯净；骨骼视频和逐帧关节数据单独保存。支持 MP4、MOV、WebM，最长 15 秒。</p>
                <p id="depthCaptureDevice">当前机器首次使用约下载 0.94 GB CPU 深度组件和模型，另加约 30 MB 姿态组件和模型；安装后复用缓存。每段新视频仍需重新分析。</p>
                <div id="depthCaptureStatus" class="depth-capture-status"></div>
                <div id="depthCaptureResults" class="depth-capture-results"></div>
        <div class="depth-capture-actions"><button type="button" data-action="start" class="primary">${icon('scan-face')}创建两份参考</button><button type="button" data-action="cancel" hidden>取消并返回画布</button><button type="button" data-action="retry" hidden>重试并返回画布</button></div>
            </div></div>
        </div>`;
        document.body.appendChild(modal);
        modal.addEventListener('click', async event => {
            if(event.target === modal){ close(); return; }
            const tab = event.target.closest('[data-tab]');
            if(tab){ setTab(tab.dataset.tab); return; }
            const button = event.target.closest('[data-action]');
            if(!button || !current) return;
            if(button.dataset.action === 'close'){ close(); return; }
            button.disabled = true;
            try {
                if(button.dataset.action === 'start'){
                    await current.onStart();
                    close();
                }
                if(button.dataset.action === 'retry'){
                    await current.onRetry();
                    close();
                }
                if(button.dataset.action === 'cancel'){
                    await current.onCancel();
                    close();
                }
            } catch(error){
                modal.querySelector('#depthCaptureStatus').textContent = error.message || '操作失败';
            } finally { button.disabled = false; update(); }
        });
        modal.querySelector('video').addEventListener('loadedmetadata', update);
        document.addEventListener('keydown', event => { if(event.key === 'Escape' && modal?.classList.contains('open')) close(); });
        return modal;
    }
    function setTab(tab){
        if(!modal) return;
        modal.querySelectorAll('[data-tab]').forEach(button => button.classList.toggle('active', button.dataset.tab === tab));
        modal.querySelector('#depthCapturePreview').hidden = tab !== 'preview';
        modal.querySelector('#depthCaptureCapture').hidden = tab !== 'capture';
    }
    function open(options){
        ensureModal();
        current = options;
        modal.querySelector('#depthCaptureTitle').textContent = options.title || '';
        const video = modal.querySelector('video');
        video.src = options.sourceUrl;
        video.load();
        modal.classList.add('open');
        setTab('preview');
        update();
        window.lucide?.createIcons?.({nodes:[modal]});
    }
    function close(){
        if(!modal) return;
        modal.classList.remove('open');
        modal.querySelector('video').pause();
        modal.querySelector('video').removeAttribute('src');
        current = null;
    }
    function update(){
        if(!modal?.classList.contains('open') || !current) return;
        const item = current.getCurrent?.() || {};
        const video = modal.querySelector('video');
        const invalidDuration = Number.isFinite(video.duration) && video.duration > 15.1;
        const local = /^\/(assets|output|api\/storage-files)\//.test(current.sourceUrl || '');
        const status = modal.querySelector('#depthCaptureStatus');
        const results = modal.querySelector('#depthCaptureResults');
        const running = ['queued','running','query-error','submitting'].includes(item.status);
        const finished = item.status === 'succeeded';
        const failed = ['failed','cancelled'].includes(item.status);
        status.textContent = invalidDuration ? '视频超过 15 秒，请先选择较短片段。' : !local ? '请先将视频保存到本地素材库，再使用此功能。' : item.stage || (item.error || '准备就绪');
        if(item.error && item.stage) status.textContent += `：${item.error}`;
        if(item.progress && running) status.textContent += ` · ${item.progress}%`;
        const links = [];
        if(item.result_url) links.push(`<a href="${escapeHtml(item.result_url)}" download>下载灰度深度视频</a>`);
        if(item.pose_url) links.push(`<a href="${escapeHtml(item.pose_url)}" download>下载骨骼参考视频</a>`);
        if(item.pose_data_url) links.push(`<a href="${escapeHtml(item.pose_data_url)}" download>下载逐帧关节 JSON</a>`);
        if(finished && item.total_frames != null) links.push(`<span>识别到人物：${Number(item.detected_frames || 0)}/${Number(item.total_frames)} 帧</span>`);
        results.innerHTML = links.join('');
        modal.querySelector('[data-action="start"]').hidden = running || failed;
        modal.querySelector('[data-action="start"]').disabled = invalidDuration || !local;
        modal.querySelector('[data-action="cancel"]').hidden = !running || !item.taskId;
        modal.querySelector('[data-action="retry"]').hidden = !failed;
        modal.querySelector('[data-action="retry"]').disabled = invalidDuration || !local;
    }
    window.CanvasDepthCapture = {operationId, submit, get, cancel, watch, open, close, update};
})();
