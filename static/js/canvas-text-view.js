/* Classic node view responsibility: canvas-text-view. Host supplies live state and effects. */
(function(root){
'use strict';

function renderLoopBody(deps, node){
    const wrap = deps.document.createElement('div');
    wrap.className = 'loop-body';
    node.count = deps.loopCount(node);
    node.loopStart = Math.max(1, Number(node.loopStart) || 1);
    node.imageBatchSize = Math.max(1, Math.min(100, Number(node.imageBatchSize) || 1));
    node.mode = node.mode === 'parallel' ? 'parallel' : 'serial';
    node.showPrompt = Boolean(node.showPrompt);
    node.imageInput = Boolean(node.imageInput);
    node.videoInput = false;
    const imageInputCount = deps.loopInputImageRefs(node, {index:node.loopStart}).length;
    const promptItemCount = node.showPrompt ? deps.loopInputPromptItems(node).length : 0;
    const hasUpstreamPrompt = promptItemCount > 0;
    const loopTargetId = deps.findLoopCascadeTarget(node.id);
    const loopTargetOrder = loopTargetId ? deps.computeCascadeOrder(loopTargetId) : [];
    const loopRunHtml = loopTargetId ? (deps.isCascadeActive(loopTargetId)
        ? `<div class="gen-run-row"><button class="gen-cascade-btn gen-cascade-stop" type="button" data-loop-cascade-stop="${loopTargetId}" ${deps.isCascadeStopping(loopTargetId) ? 'disabled' : ''}><i data-lucide="square" class="w-4 h-4"></i><span>${deps.isCascadeStopping(loopTargetId) ? '停止中…' : '停止运行'}</span></button></div>`
        : `<div class="gen-run-row"><button class="gen-cascade-btn" type="button" data-loop-cascade="${loopTargetId}" title="从当前循环节点启动整条工作流"><i data-lucide="play-circle" class="w-4 h-4"></i><span>开始 ${loopTargetOrder.length || 1} 个节点 × ${node.count} ${deps.tr('canvas.loopRounds')}</span></button></div>`)
        : '';
    wrap.innerHTML = `
        <div class="loop-count-row">
            <div class="loop-run-row">
                <div class="loop-count-group">
                    <span class="loop-count-label">${deps.tr('canvas.loopCount')}</span>
                    <input class="loop-count-input" type="number" min="1" max="100" step="1" value="${node.count}">
                </div>
                <div class="seg loop-mode">
                    <button type="button" data-loop-mode="serial" class="${node.mode !== 'parallel' ? 'active' : ''}">${deps.tr('canvas.loopSerial')}</button>
                    <button type="button" data-loop-mode="parallel" class="${node.mode === 'parallel' ? 'active' : ''}">${deps.tr('canvas.loopParallel')}</button>
                </div>
            </div>
            <div class="loop-toggle-row">
                <button class="loop-toggle loop-image-toggle ${node.imageInput ? 'active' : ''}" type="button"><i data-lucide="image" class="w-3.5 h-3.5"></i>${deps.tr('canvas.loopImageToggle')}</button>
                <button class="loop-toggle loop-prompt-toggle ${node.showPrompt ? 'active' : ''}" type="button"><i data-lucide="text-cursor-input" class="w-3.5 h-3.5"></i>${deps.tr('canvas.loopPromptToggle')}</button>
            </div>
        </div>
        ${node.imageInput ? `<div class="loop-image-panel">
            <div class="loop-image-row">
                <span class="loop-count-label">${deps.tr('canvas.loopImageStart')}</span>
                <input class="loop-count-input loop-image-start-input" type="number" min="1" max="9999" step="1" value="${node.loopStart}">
                <span class="loop-count-label">${deps.tr('canvas.loopBatchSize')}</span>
                <input class="loop-count-input loop-batch-input" type="number" min="1" max="100" step="1" value="${node.imageBatchSize}">
            </div>
            <div class="loop-image-hint loop-image-hint-only">${imageInputCount ? deps.trf('canvas.loopImageWillOutput', {n:imageInputCount}) : deps.tr('canvas.loopImageEmpty')}</div>
        </div>` : ''}
        ${node.showPrompt ? `<div class="loop-prompt-panel ${hasUpstreamPrompt ? 'has-upstream' : ''}">
            <div class="loop-field">
                <div class="loop-variable-editor ${hasUpstreamPrompt ? 'is-disabled' : ''}" contenteditable="${hasUpstreamPrompt ? 'false' : 'true'}" data-placeholder="${deps.escapeAttr(deps.tr('canvas.loopVariablePlaceholder'))}">${deps.loopVariableHtml(node.variablePrompt || '')}</div>
            </div>
            ${hasUpstreamPrompt ? `<div class="loop-prompt-hint">已识别 ${promptItemCount} 条提示词，按计数轮流输出</div>` : ''}
            <div class="loop-start-row">
                <button class="loop-token-btn loop-counter-token-btn" type="button" data-token="《计数》">${deps.tr('canvas.counterToken')}</button>
                <span class="loop-count-label">${deps.tr('canvas.loopStart')}</span>
                <input class="loop-count-input loop-start-input" type="number" min="1" max="9999" step="1" value="${node.loopStart}">
            </div>
        </div>` : ''}
        ${loopRunHtml}
    `;
    const countInput = wrap.querySelector('.loop-count-input');
    const variable = wrap.querySelector('.loop-variable-editor');
    const toggle = wrap.querySelector('.loop-prompt-toggle');
    const imageToggle = wrap.querySelector('.loop-image-toggle');
    if(variable) {
        variable.onmousedown = e => e.stopPropagation();
        variable.onclick = e => e.stopPropagation();
        variable.onwheel = e => e.stopPropagation();
    }
    const refreshPreview = () => {
        const preview = wrap.querySelector('.loop-preview:last-child');
        if(preview) preview.textContent = deps.renderLoopPrompt(node, {index:1, total:deps.loopCount(node)}) || deps.tr('canvas.noPromptMeta');
    };
    const refreshImageHint = () => {
        const hint = wrap.querySelector('.loop-image-hint-only');
        if(!hint) return;
        const count = deps.loopInputImageRefs(node, {index:node.loopStart}).length;
        hint.textContent = count ? deps.trf('canvas.loopImageWillOutput', {n:count}) : deps.tr('canvas.loopImageEmpty');
    };
    const syncStartInputs = source => {
        wrap.querySelectorAll('.loop-image-start-input, .loop-start-input').forEach(input => {
            if(input !== source && input.value !== String(node.loopStart)) input.value = node.loopStart;
        });
    };
    countInput.oninput = e => {
        node.count = deps.loopCount({count:e.target.value});
        e.target.value = node.count;
        refreshPreview();
        /* 同步底部级联按钮上的轮数文字，避免输入循环次数后下游"× N 轮"残留旧值
           不直接 render() 是为了不破坏当前正在输入的 input 焦点 */
        const loopCascadeBtn = wrap.querySelector('[data-loop-cascade]');
        if(loopCascadeBtn){
            const span = loopCascadeBtn.querySelector('span');
            if(span) span.textContent = `开始 ${loopTargetOrder.length || 1} 个节点 × ${node.count} ${deps.tr('canvas.loopRounds')}`;
        }
        if(loopTargetId){
            const targetEl = deps.document.querySelector(`.node[data-id="${loopTargetId}"]`);
            const targetCascadeBtn = targetEl?.querySelector('[data-cascade]');
            if(targetCascadeBtn){
                const span = targetCascadeBtn.querySelector('span');
                if(span){
                    const targetOrder = deps.computeCascadeOrder(loopTargetId);
                    span.textContent = `一键运行 ${targetOrder.length} 个节点 × ${node.count} ${deps.tr('canvas.loopRounds')}`;
                }
            }
        }
        deps.scheduleSave();
    };
    const startInput = wrap.querySelector('.loop-start-input');
    if(startInput){
        startInput.onmousedown = e => e.stopPropagation();
        startInput.onclick = e => e.stopPropagation();
        startInput.oninput = e => {
            node.loopStart = Math.max(1, Number(e.target.value) || 1);
            refreshImageHint();
            syncStartInputs(e.target);
            deps.scheduleSave();
            deps.syncGeneratorInputs();
            deps.refreshGeneratorInputViews();
        };
    }
    const imageStartInput = wrap.querySelector('.loop-image-start-input');
    if(imageStartInput){
        imageStartInput.onmousedown = e => e.stopPropagation();
        imageStartInput.onclick = e => e.stopPropagation();
        imageStartInput.oninput = e => {
            node.loopStart = Math.max(1, Number(e.target.value) || 1);
            refreshImageHint();
            syncStartInputs(e.target);
            deps.scheduleSave();
            deps.syncGeneratorInputs();
            deps.refreshGeneratorInputViews();
        };
    }
    const batchInput = wrap.querySelector('.loop-batch-input');
    if(batchInput){
        batchInput.onmousedown = e => e.stopPropagation();
        batchInput.onclick = e => e.stopPropagation();
        batchInput.oninput = e => {
            node.imageBatchSize = Math.max(1, Math.min(100, Number(e.target.value) || 1));
            e.target.value = node.imageBatchSize;
            refreshImageHint();
            deps.scheduleSave();
            deps.syncGeneratorInputs();
            deps.refreshGeneratorInputViews();
        };
    }
    wrap.querySelectorAll('[data-loop-mode]').forEach(btn => {
        btn.onclick = e => {
            e.stopPropagation();
            node.mode = btn.dataset.loopMode === 'parallel' ? 'parallel' : 'serial';
            deps.render();
            deps.scheduleSave();
        };
    });
    toggle.onclick = e => {
        e.stopPropagation();
        const opening = !node.showPrompt;
        node.showPrompt = opening;
        deps.autoSizeLoopNode(node, opening);
        deps.autoSizeLoopForPanels(node);
        if(!opening){
            deps.connections = deps.connections.filter(c => c.to !== node.id || deps.canConnect(c.from, node.id));
        }
        deps.render();
        deps.scheduleSave();
        deps.syncGeneratorInputs();
        deps.refreshGeneratorInputViews();
    };
    if(variable) {
        variable.oninput = e => {
            node.variablePrompt = deps.loopEditorText(variable);
            refreshPreview();
            deps.scheduleSave();
            deps.syncGeneratorInputs();
            deps.refreshGeneratorInputViews();
        };
        variable.addEventListener('click', e => {
            const btn = e.target.closest('.loop-token-chip button');
            if(!btn) return;
            e.preventDefault();
            e.stopPropagation();
            btn.closest('.loop-token-chip')?.remove();
            node.variablePrompt = deps.loopEditorText(variable);
            refreshPreview();
            deps.scheduleSave();
            deps.syncGeneratorInputs();
            deps.refreshGeneratorInputViews();
        });
    }
    wrap.querySelectorAll('[data-token]').forEach(btn => {
        btn.onclick = e => {
            e.stopPropagation();
            const token = btn.dataset.token || '';
            if(!variable) return;
            deps.insertLoopToken(variable, token);
            node.variablePrompt = deps.loopEditorText(variable);
            variable.focus();
            refreshPreview();
            deps.scheduleSave();
            deps.syncGeneratorInputs();
            deps.refreshGeneratorInputViews();
        };
    });
    if(imageToggle){
        imageToggle.onclick = e => {
            e.stopPropagation();
            node.imageInput = !node.imageInput;
            if(node.imageInput){
                node.loopStart = Math.max(1, Number(node.loopStart) || 1);
                node.imageBatchSize = Math.max(1, Math.min(100, Number(node.imageBatchSize) || 1));
            } else {
                deps.connections = deps.connections.filter(c => c.to !== node.id || deps.canConnect(c.from, node.id));
            }
            deps.autoSizeLoopForPanels(node);
            deps.render();
            deps.scheduleSave();
            deps.syncGeneratorInputs();
            deps.refreshGeneratorInputViews();
        };
    }
    wrap.querySelectorAll('[data-loop-cascade]').forEach(btn => {
        btn.onmousedown = e => e.stopPropagation();
        btn.onclick = e => {
            e.stopPropagation();
            deps.runNodeCascade(btn.dataset.loopCascade);
        };
    });
    wrap.querySelectorAll('[data-loop-cascade-stop]').forEach(btn => {
        btn.onmousedown = e => e.stopPropagation();
        btn.onclick = e => {
            e.stopPropagation();
            deps.requestCascadeStop(btn.dataset.loopCascadeStop);
        };
    });
    return wrap;
}

function renderLLMBody(deps, node){
    const wrap = deps.document.createElement('div');
    wrap.className = 'llm-body';
    const mode = node.mode || 'node';
    node.llmProvider = deps.resolveChatProviderId(node.llmProvider || 'comfly');
    const llmProv = node.llmProvider;
    if(llmProv === 'modelscope') node.model = node.llmMsModel || node.model;
    if(!deps.providerChatModels(llmProv).includes(node.model)) node.model = deps.providerChatModels(llmProv)[0] || node.model;
    const modelOpts = deps.chatModelOptions(node.model, llmProv);
    const imgs = deps.llmInputImages(node);
    const videos = deps.llmInputVideos(node);
    const audios = deps.llmInputAudios(node);
    const mediaBadgeText = [
        imgs.length ? `${imgs.length} 张图片` : '',
        videos.length ? `${videos.length} 个视频` : '',
        audios.length ? `${audios.length} 个音频` : ''
    ].filter(Boolean).join(' · ');
    const imgBadge = mediaBadgeText ? `<div style="display:flex;align-items:center;gap:6px;padding:5px 10px;border-radius:8px;background:rgba(16,185,129,.12);color:#047857;font-size:10.5px;font-weight:700;width:fit-content;line-height:1.4"><i data-lucide="${audios.length && !imgs.length && !videos.length ? 'audio-lines' : videos.length && !imgs.length ? 'video' : 'image'}" class="w-3 h-3"></i>已连接 ${mediaBadgeText} · 请选择文本模型进行分析</div>` : '';
    node.showSystem = Boolean(node.showSystem);
    wrap.innerHTML = `
        <div class="llm-row">
            <select class="select-lite llm-provider-select" style="flex:1">${deps.chatProviderOptions(llmProv)}</select>
            <select class="select-lite llm-model">${modelOpts}</select>
            <div class="llm-mode"><button data-mode="node">${deps.tr('canvas.nodeMode')}</button><button data-mode="chat">${deps.tr('canvas.chatMode')}</button></div>
            <button class="llm-sys-toggle ${node.showSystem ? 'active' : ''}" type="button">System</button>
        </div>
        ${imgBadge}
        ${node.showSystem ? `<textarea class="llm-system" placeholder="${deps.tr('canvas.systemPrompt')}">${deps.escapeHtml(node.systemPrompt || '')}</textarea>` : ''}
        <div class="llm-node-pane"></div>
        <div class="llm-chat-pane"></div>
    `;
    const providerSelect = wrap.querySelector('.llm-provider-select');
    const modelSelect = wrap.querySelector('.llm-model');
    providerSelect.value = llmProv;
    modelSelect.value = deps.resolveChatModel(node.model, llmProv);
    [providerSelect, modelSelect].forEach(input => {
        input.onmousedown = e => e.stopPropagation();
        input.onclick = e => e.stopPropagation();
    });
    providerSelect.onchange = e => {
        e.stopPropagation();
        node.llmProvider = e.target.value;
        const models = deps.providerChatModels(node.llmProvider);
        node.model = models[0] || '';
        if(node.llmProvider === 'modelscope') node.llmMsModel = node.model;
        deps.render();
        deps.scheduleSave();
    };
    modelSelect.onchange = e => {
        e.stopPropagation();
        node.model = e.target.value;
        if((node.llmProvider||'comfly') === 'modelscope') node.llmMsModel = e.target.value;
        deps.scheduleSave();
    };
    wrap.querySelector('.llm-sys-toggle').onclick = e => { e.stopPropagation(); node.showSystem = !node.showSystem; deps.render(); deps.scheduleSave(); };
    const sysEl = wrap.querySelector('.llm-system');
    if(sysEl){ sysEl.oninput = e => { node.systemPrompt = e.target.value; deps.scheduleSave(); }; deps.bindScrollableText(sysEl); }
    wrap.querySelectorAll('[data-mode]').forEach(btn => {
        btn.classList.toggle('active', mode === btn.dataset.mode);
        btn.onclick = e => { e.stopPropagation(); node.mode = btn.dataset.mode; deps.render(); deps.scheduleSave(); };
    });
    const nodePane = wrap.querySelector('.llm-node-pane');
    const chatPane = wrap.querySelector('.llm-chat-pane');
    if(mode === 'chat'){
        nodePane.style.display = 'none';
        renderLLMChatPane(deps, chatPane, node);
    } else {
        chatPane.style.display = 'none';
        renderLLMNodePane(deps, nodePane, node);
    }
    return wrap;
}

function renderLLMNodePane(deps, container, node){
    const connectedInput = deps.llmInputText(node);
    const isReadonly = connectedInput.length > 0;
    const inputValue = connectedInput || node.userInput || '';
    const inputHeight = Math.max(70, node.llmInputHeight || 110);
    const outputHeight = Math.max(70, node.llmOutputHeight || 150);
    const inputPlaceholder = deps.langIsEn() ? 'Type input, or connect a Prompt node…' : '直接输入，或连接提示词节点…';
    container.innerHTML = `
        <div class="llm-pane-label">Input${isReadonly ? ' <span style="font-size:9px;opacity:.5;font-weight:600;text-transform:none;letter-spacing:0">(来自连接)</span>' : ''}</div>
        <textarea class="llm-input-area llm-input-output" style="height:${inputHeight}px; flex:0 0 ${inputHeight}px;" ${isReadonly ? 'readonly' : ''} placeholder="${inputPlaceholder}">${deps.escapeHtml(inputValue)}</textarea>
        <div class="llm-pane-resizer" title="${deps.tr('canvas.resizePanes')}"></div>
        <div class="llm-pane-label">Output</div>
        <div class="llm-output-wrap" style="height:${outputHeight}px; flex:0 0 ${outputHeight}px;">
            <button class="llm-copy-btn llm-output-copy" type="button" title="复制"><i data-lucide="copy" class="w-3.5 h-3.5"></i></button>
            <div class="llm-output llm-result-output">${deps.escapeHtml(node.outputText || deps.tr('canvas.llmOutputEmpty'))}</div>
        </div>
        <div class="gen-run-row mt-2">
            <button class="llm-run ${node.running ? 'running' : ''}" ${node.running ? 'disabled' : ''}><i data-lucide="play" class="w-4 h-4"></i>${node.running ? deps.tr('canvas.running') : 'Run LLM'}</button>
            ${deps.cascadeBtnHtml(node)}
        </div>
        ${deps.retryBarHtml(node)}
    `;
    const inputEl = container.querySelector('.llm-input-output');
    deps.bindScrollableText(inputEl);
    if(!isReadonly){
        inputEl.oninput = e => { node.userInput = e.target.value; };
    }
    deps.bindScrollableText(container.querySelector('.llm-result-output'));
    container.querySelector('.llm-pane-resizer').onmousedown = e => deps.startLLMPaneResize(e, node);
    container.querySelector('.llm-run').onclick = e => { e.stopPropagation(); deps.runLLMNode(node.id); };
    deps.bindCascadeButtons(container, node.id);
    const copyBtn = container.querySelector('.llm-output-copy');
    if(copyBtn){
        copyBtn.onmousedown = e => e.stopPropagation();
        copyBtn.onclick = async e => {
            e.stopPropagation();
            const text = node.outputText || '';
            if(!text) return;
            if(await deps.copyTextToClipboard(text)){
                copyBtn.classList.add('copied');
                deps.setTimeout(() => copyBtn.classList.remove('copied'), 1500);
            }
        };
    }
}

function renderLLMChatPane(deps, container, node){
    const messages = node.messages || [];
    container.innerHTML = `
        <div class="llm-chat-log">${messages.length ? messages.map((msg, mi) => `<div class="llm-bubble ${msg.role === 'user' ? 'user' : 'assistant'}" data-msg-idx="${mi}">${deps.escapeHtml(msg.content || '')}${msg.role === 'assistant' ? `<button class="llm-bubble-copy" type="button" title="复制"><i data-lucide="copy" style="width:11px;height:11px;display:inline-block;vertical-align:middle"></i></button>` : ''}</div>`).join('') : `<div class="text-[11px] text-gray-300">${deps.tr('canvas.startChat')}</div>`}</div>
        <textarea class="llm-chat-input mt-2" rows="2" placeholder="${deps.tr('canvas.chatInput')}">${deps.escapeHtml(node.chatInput || '')}</textarea>
        <button class="llm-run mt-2" ${node.running ? 'disabled' : ''}><i data-lucide="send" class="w-4 h-4"></i>${node.running ? deps.tr('canvas.sending') : 'Send'}</button>
    `;
    deps.bindScrollableText(container.querySelector('.llm-chat-log'));
    deps.bindScrollableText(container.querySelector('.llm-chat-input'));
    const chatInputEl = container.querySelector('.llm-chat-input');
    chatInputEl.oninput = e => { node.chatInput = e.target.value; deps.scheduleSave(); };
    chatInputEl.onkeydown = e => {
        if(e.key === 'Enter' && !e.shiftKey && !e.isComposing){
            e.preventDefault();
            e.stopPropagation();
            deps.runLLMChat(node.id);
        }
    };
    container.querySelector('.llm-run').onclick = e => { e.stopPropagation(); deps.runLLMChat(node.id); };
    container.querySelectorAll('.llm-bubble-copy').forEach(btn => {
        btn.onmousedown = e => e.stopPropagation();
        btn.onclick = async e => {
            e.stopPropagation();
            const bubble = btn.closest('.llm-bubble');
            const idx = Number(bubble?.dataset.msgIdx);
            const msg = (node.messages || [])[idx];
            if(!msg) return;
            if(await deps.copyTextToClipboard(msg.content || '')){
                btn.classList.add('copied');
                deps.setTimeout(() => btn.classList.remove('copied'), 1500);
            }
        };
    });
}

const api={renderLoopBody, renderLLMBody, renderLLMNodePane, renderLLMChatPane};
if(typeof module!=='undefined' && module.exports) module.exports=api;
root.CanvasTextView=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
