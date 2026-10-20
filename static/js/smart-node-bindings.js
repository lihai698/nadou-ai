/* Smart node view responsibility: smart-node-bindings. Host supplies live state and effects. */
(function(root){
    'use strict';

function refreshPromptNodeSegmentsUi(deps, el, node){
    const items = deps.promptNodePromptItems(node);
    const count = el.querySelector('.prompt-node-split-count');
    if(count) count.textContent = `${items.length || 0} 段`;
    const list = el.querySelector('.prompt-node-segments');
    if(list){
        list.innerHTML = items.length
            ? items.map((item, index) => `<div class="prompt-node-segment"><span>${index + 1}</span><p>${deps.escapeHtml(item)}</p></div>`).join('')
            : '';
    }
}

function bindConnectionEvents(deps){
    deps.world.querySelectorAll('[data-conn-index]').forEach(el => {
        if(el.classList.contains('conn-hit')){
            el.addEventListener('dblclick', e => {
                e.preventDefault(); e.stopPropagation();
                deps.disconnectConnections(el.dataset.connIndex);
            });
            return;
        }
        el.addEventListener('click', e => {
            e.preventDefault(); e.stopPropagation();
            deps.disconnectConnections(el.dataset.connIndex);
        });
    });
}

function bindPromptNodeControls(deps, el, node){
    el.querySelectorAll('.prompt-node-control, .prompt-node-pill').forEach(control => {
        control.addEventListener('mousedown', e => e.stopPropagation());
        control.addEventListener('click', e => e.stopPropagation());
        control.addEventListener('dblclick', e => e.stopPropagation());
    });
    const textEl = el.querySelector('.prompt-node-text');
    if(textEl) {
        deps.bindScrollableText(textEl);
        textEl.oninput = e => {
            const prevExtra = deps.promptNodeSplitExtraHeight(node);
            node.text = e.target.value;
            refreshPromptNodeSegmentsUi(deps, el, node);
            if(node.promptSplitEnabled === true){
                deps.syncPromptNodeHeightForSplit(node, prevExtra);
                deps.updateNodeElementDuringResize(node);
            }
            deps.scheduleSave();
        };
    }
    const separatorEl = el.querySelector('.prompt-node-separator');
    if(separatorEl) {
        separatorEl.oninput = e => {
            const prevExtra = deps.promptNodeSplitExtraHeight(node);
            node.promptSeparator = e.target.value || ';';
            refreshPromptNodeSegmentsUi(deps, el, node);
            deps.syncPromptNodeHeightForSplit(node, prevExtra);
            deps.updateNodeElementDuringResize(node);
            deps.scheduleSave();
        };
    }
    const splitToggle = el.querySelector('.prompt-split-toggle');
    if(splitToggle) splitToggle.onclick = e => {
        e.preventDefault();
        e.stopPropagation();
        const prevExtra = deps.promptNodeSplitExtraHeight(node);
        node.promptSplitEnabled = node.promptSplitEnabled !== true;
        if(node.promptSplitEnabled){
            node.promptSeparator = deps.promptNodeSeparator(node);
        }
        deps.syncPromptNodeHeightForSplit(node, prevExtra);
        deps.render();
        deps.scheduleSave();
    };
    const presetEdit = el.querySelector('.prompt-preset-edit');
    if(presetEdit) presetEdit.onclick = e => {
        e.preventDefault();
        e.stopPropagation();
        deps.editPromptPresetForNode(node);
    };
    const toggle = el.querySelector('.prompt-llm-toggle');
    if(toggle) toggle.onclick = e => {
        e.preventDefault(); e.stopPropagation();
        node.llmEnabled = !node.llmEnabled;
        if(node.llmEnabled){
            node.llmOutputStale = true;
            node.llmProvider = deps.resolveChatProviderId(node.llmProvider || '');
            node.llmModel = deps.resolveChatModel(node.llmModel || '', node.llmProvider);
            node.h = Math.max(Number(node.h) || 0, deps.promptNodeExpandedHeight(node));
            node.w = Math.max(Number(node.w) || 0, 316);
        } else {
            node.h = deps.promptNodeMinHeight(node);
            node.w = Math.max(Number(node.w) || 0, 316);
        }
        deps.render();
        deps.scheduleSave();
    };
    const providerEl = el.querySelector('.prompt-llm-provider');
    if(providerEl) providerEl.onchange = e => {
        e.stopPropagation();
        node.llmProvider = deps.resolveChatProviderId(e.target.value);
        node.llmModel = deps.resolveChatModel('', node.llmProvider);
        node.llmOutputStale = true;
        deps.render();
        deps.scheduleSave();
    };
    const modelEl = el.querySelector('.prompt-llm-model');
    if(modelEl) modelEl.onchange = e => { e.stopPropagation(); node.llmModel = e.target.value; node.llmOutputStale=true; deps.scheduleSave(); };
    const systemToggleEl = el.querySelector('.prompt-system-toggle');
    if(systemToggleEl) systemToggleEl.onclick = e => {
        e.preventDefault();
        e.stopPropagation();
        const prevHeight = Number(node.h) || 0;
        node.llmSystemEnabled = !node.llmSystemEnabled;
        node.llmOutputStale = true;
        if(node.llmSystemEnabled) node.h = Math.max(prevHeight, deps.promptNodeExpandedHeight(node));
        else if(prevHeight <= 364) node.h = deps.promptNodeExpandedHeight(node);
        deps.render();
        deps.scheduleSave();
    };
    const systemEl = el.querySelector('.prompt-llm-system');
    if(systemEl) { deps.bindScrollableText(systemEl); systemEl.oninput = e => { node.llmSystemPrompt = e.target.value; node.llmOutputStale=true; deps.scheduleSave(); }; }
    const instructionEl = el.querySelector('.prompt-llm-instruction');
    if(instructionEl) { deps.bindScrollableText(instructionEl); instructionEl.oninput = e => { node.llmInstruction = e.target.value; node.llmOutputStale=true; deps.scheduleSave(); }; }
    const instructionResizeEl = el.querySelector('[data-llm-instruction-resize]');
    if(instructionResizeEl) instructionResizeEl.addEventListener('mousedown', e => {
        if(e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        deps.llmInstructionResizeState = {id:node.id, startY:e.clientY, startH:deps.promptLlmInstructionHeight(node), startNodeH:deps.promptNodeLayoutSize(node).height};
        // 拖动期间屏蔽文本框的指针/选区，否则上拉时光标滑到上方输入框会被它抢走（选中文字/失焦）。
        deps.document.body.classList.add('smart-node-resize', 'smart-llm-instr-resize');
        deps.capturePendingUndo();
    });
    const splitResizeEl = el.querySelector('[data-prompt-split-resize]');
    if(splitResizeEl) splitResizeEl.addEventListener('mousedown', e => {
        if(e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        deps.promptSplitResizeState = {id:node.id, startY:e.clientY, startH:deps.promptNodeSplitPreviewHeight(node), startNodeH:deps.promptNodeLayoutSize(node).height};
        deps.document.body.classList.add('smart-node-resize', 'smart-prompt-split-resize');
        deps.capturePendingUndo();
    });
    const runEl = el.querySelector('.prompt-node-run');
    if(runEl) runEl.onclick = e => { e.preventDefault(); e.stopPropagation(); deps.runPromptLLMNode(node.id); };
}

function bindLoopNodeControls(deps, el, node){
    el.querySelectorAll('.loop-smart-control').forEach(control => {
        control.addEventListener('mousedown', e => e.stopPropagation());
        control.addEventListener('click', e => e.stopPropagation());
        control.addEventListener('dblclick', e => e.stopPropagation());
    });
    const loopNumberBounds = key => {
        if(key === 'loopStart') return {min:1, max:9999};
        if(key === 'imageBatchSize') return {min:1, max:100};
        return {min:1, max:100};
    };
    const normalizeLoopNumber = (key, rawValue) => {
        const bounds = loopNumberBounds(key);
        return Math.max(bounds.min, Math.min(bounds.max, Number(rawValue) || bounds.min));
    };
    const syncLoopNumberUi = (source, key, value) => {
        const control = source?.closest?.('.loop-number-control');
        if(!control) return;
        const display = control.querySelector('.loop-number-trigger strong');
        if(display) display.textContent = value;
        control.querySelectorAll('[data-loop-value]').forEach(cell => {
            cell.classList.toggle('active', Number(cell.dataset.loopValue) === value);
        });
    };
    const setLoopNumber = (key, rawValue, rerender=true, source=null) => {
        const value = normalizeLoopNumber(key, rawValue);
        if(key === 'count') node.count = deps.smartLoopCount({count:value});
        if(key === 'loopStart') node.loopStart = value;
        if(key === 'imageBatchSize') node.imageBatchSize = value;
        deps.scheduleSave();
        if(rerender) deps.render();
        else syncLoopNumberUi(source, key, value);
    };
    el.querySelectorAll('[data-loop-number]').forEach(btn => {
        btn.onclick = e => {
            e.preventDefault();
            e.stopPropagation();
            setLoopNumber(btn.dataset.loopNumber, btn.dataset.loopValue, true);
        };
    });
    el.querySelectorAll('[data-loop-number-input]').forEach(input => {
        input.oninput = e => {
            e.stopPropagation();
            setLoopNumber(input.dataset.loopNumberInput, input.value, false, input);
        };
        input.onchange = e => {
            e.stopPropagation();
            setLoopNumber(input.dataset.loopNumberInput, input.value, true);
        };
    });
    el.querySelectorAll('[data-loop-mode]').forEach(btn => {
        btn.onclick = e => {
            e.preventDefault();
            e.stopPropagation();
            node.mode = btn.dataset.loopMode === 'parallel' ? 'parallel' : 'serial';
            deps.render();
            deps.scheduleSave();
        };
    });
    el.querySelectorAll('[data-loop-toggle]').forEach(btn => {
        btn.onclick = e => {
            e.preventDefault();
            e.stopPropagation();
            if(btn.dataset.loopToggle === 'image') node.imageInput = !node.imageInput;
            if(btn.dataset.loopToggle === 'prompt') {
                node.showPrompt = !node.showPrompt;
                if(node.showPrompt && !deps.smartLoopInputPromptItems(node).length && !deps.smartLoopActivePromptFieldValues(node).length) deps.setSmartLoopPromptFieldValues(node, [deps.smartLoopDefaultPromptText()]);
            }
            deps.fitSmartLoopNode(node);
            deps.render();
            deps.scheduleSave();
        };
    });
    const syncPromptFieldsFromDom = () => {
        const values = [...el.querySelectorAll('[data-loop-prompt-index]')]
            .sort((a, b) => Number(a.dataset.loopPromptIndex) - Number(b.dataset.loopPromptIndex))
            .map(input => deps.smartLoopEditorText(input));
        deps.setSmartLoopPromptFieldValues(node, values);
    };
    let activePromptEditor = null;
    el.querySelectorAll('.loop-smart-text').forEach(text => {
        deps.bindScrollableText(text);
        text.onfocus = () => { activePromptEditor = text; };
        text.oninput = () => { syncPromptFieldsFromDom(); deps.scheduleSave(); };
        text.addEventListener('click', e => {
            const remove = e.target.closest?.('.loop-smart-token-chip button');
            if(!remove) return;
            e.preventDefault();
            e.stopPropagation();
            remove.closest('.loop-smart-token-chip')?.remove();
            syncPromptFieldsFromDom();
            deps.scheduleSave();
        });
    });
    el.querySelectorAll('[data-loop-prompt-add]').forEach(btn => {
        btn.onclick = e => {
            e.preventDefault();
            e.stopPropagation();
            syncPromptFieldsFromDom();
            const values = deps.smartLoopPromptFieldValues(node);
            deps.setSmartLoopPromptFieldValues(node, [...values, '']);
            deps.fitSmartLoopNode(node);
            deps.render();
            deps.scheduleSave();
        };
    });
    el.querySelectorAll('[data-loop-prompt-delete]').forEach(btn => {
        btn.onclick = e => {
            e.preventDefault();
            e.stopPropagation();
            syncPromptFieldsFromDom();
            const removeIndex = Number(btn.dataset.loopPromptDelete);
            const values = deps.smartLoopPromptFieldValues(node);
            if(values.length <= 1) return;
            values.splice(removeIndex, 1);
            deps.setSmartLoopPromptFieldValues(node, values);
            deps.fitSmartLoopNode(node);
            deps.render();
            deps.scheduleSave();
        };
    });
    const firstText = el.querySelector('.loop-smart-text');
    const targetPromptEditor = () => activePromptEditor && el.contains(activePromptEditor) ? activePromptEditor : firstText;
    el.querySelectorAll('[data-loop-token]').forEach(btn => {
        btn.onclick = e => {
            e.preventDefault();
            e.stopPropagation();
            const text = targetPromptEditor();
            if(!text) return;
            const token = btn.dataset.loopToken || '《计数》';
            deps.insertSmartLoopToken(text, token);
            syncPromptFieldsFromDom();
            deps.scheduleSave();
        };
    });
    el.querySelectorAll('[data-loop-run]').forEach(btn => {
        btn.onclick = e => {
            e.preventDefault();
            e.stopPropagation();
            const loopId = btn.dataset.loopRun || node.id;
            if(deps.smartCascadeIsLoopRunning(loopId)){
                deps.requestSmartCascadeStop(loopId);
                return;
            }
            deps.runSmartCascadeFromLoop(loopId);
        };
    });
}

function bindNodeEvents(deps){
    deps.world.querySelectorAll('.image-node').forEach(el => {
        const id = el.dataset.id;
        const nodeForControls = deps.nodes.find(n => n.id === id);
        el.querySelectorAll('[data-smart-video-edit]').forEach(button => {
            button.addEventListener('mousedown', event => { event.preventDefault(); event.stopPropagation(); }, true);
            button.addEventListener('click', event => {
                event.preventDefault(); event.stopPropagation();
                deps.openSmartVideoEditor(id, Number(button.dataset.smartVideoEdit || 0));
            }, true);
        });
        el.querySelectorAll('[data-depth-action]').forEach(button => {
            button.addEventListener('mousedown', event => event.stopPropagation());
            button.addEventListener('click', event => {
                event.preventDefault(); event.stopPropagation();
                if(button.dataset.depthAction === 'retry') deps.retrySmartDepthCapture(id);
                else deps.cancelSmartDepthCapture(id);
            });
        });
        el.querySelector('[data-smart-submission-warning]')?.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            deps.toast(nodeForControls?.submissionWarning || '');
        });
        el.querySelector('[data-smart-task-failure]')?.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            deps.toast(nodeForControls?.taskFailureNotice || '');
        });
        if(nodeForControls)deps.bindSmartAudioMedia(el,nodeForControls);
        if(nodeForControls?.type === 'smart-prompt') bindPromptNodeControls(deps, el, nodeForControls);
        if(nodeForControls?.type === 'smart-loop') bindLoopNodeControls(deps, el, nodeForControls);

        if(nodeForControls?.type === 'smart-group') {
            el.ondblclick = e => {
                e.preventDefault();
                e.stopPropagation();
                deps.selectedId = id;
                deps.selectedIds = [];
                deps.selectedImage = {nodeId:'', index:-1};
                deps.openCreateMenu(e, {groupId:id});
            };
        }
        el.onclick = e => {
            e.stopPropagation();
            if(Date.now() < deps.suppressNodeClickUntil) return;
            const node = deps.nodes.find(n => n.id === id);
            deps.hideRunTimerForNode(node);
            const alreadySelected = deps.selectedId === id && deps.selectedIds.length === 0 && deps.selectedImage.nodeId === '';
            deps.selectedId = id;
            deps.selectedIds = [];
            deps.selectedImage = {nodeId:'', index:-1};
            if(deps.smartCascadeAnyRunning()) deps.smartCascadeSilentSelection = false;
            if(alreadySelected){
                deps.syncSelectionUi();
                deps.updateComposer();
                return;
            }
            deps.render();
        };
        if(nodeForControls?.type !== 'smart-group') el.ondblclick = e => e.stopPropagation();
        const nodeDrop = el.querySelector('.node-drop:not(.view-adjust-ready)');
        nodeDrop?.addEventListener('mousedown', e => {
            if(e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
        }, true);
        nodeDrop?.addEventListener('click', e => {
            e.preventDefault(); e.stopPropagation();
            deps.hideRunTimerForNode(deps.nodes.find(n => n.id === id));
            deps.selectedId = id;
            deps.selectedIds = [];
            deps.selectedImage = {nodeId:'', index:-1};
            deps.pendingGroupUploadPoint = null;
            deps.uploadTargetId = id;
            deps.syncSelectionUi();
            deps.updateComposer();
            deps.pickMediaForSmartNode(id);
        });
        el.querySelectorAll('.node-delete').forEach(btn => {
            btn.addEventListener('click', e => {
                e.preventDefault(); e.stopPropagation();
                deps.deleteNodeFromButton(id);
            });
        });
        el.querySelectorAll('.view-adjust-menu').forEach(menu => {
            menu.addEventListener('mousedown',event=>event.stopPropagation());
            menu.addEventListener('click',event=>event.stopPropagation());
            menu.querySelectorAll('[data-view-adjust]').forEach(button=>button.addEventListener('click',()=>{
                menu.open=false;
                deps.openSmartViewAdjustment(id,button.dataset.viewAdjust);
            }));
        });
        el.querySelectorAll('[data-smart-node-action]').forEach(btn => {
            btn.addEventListener('mousedown', e => {
                e.preventDefault();
                e.stopPropagation();
            }, true);
            btn.addEventListener('click', e => {
                e.preventDefault();
                e.stopPropagation();
                deps.runSmartNodeToolbarAction(btn.dataset.nodeId || id, btn.dataset.smartNodeAction);
            });
        });
        el.querySelectorAll('[data-smart-group-action]').forEach(btn => {
            btn.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); }, true);
            btn.addEventListener('click', e => {
                e.preventDefault();
                e.stopPropagation();
                deps.runSmartGroupToolbarAction(btn.dataset.nodeId || id, btn.dataset.smartGroupAction);
            });
        });
        el.querySelectorAll('[data-jimeng-query]').forEach(btn => {
            btn.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); }, true);
            btn.addEventListener('click', e => {
                e.preventDefault(); e.stopPropagation();
                deps.queryJimengNow(btn.dataset.jimengQuery);
            });
        });
        el.querySelectorAll('[data-image-task-query]').forEach(btn => {
            btn.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); }, true);
            btn.addEventListener('click', e => {
                e.preventDefault(); e.stopPropagation();
                deps.querySmartImageTaskNow(btn.dataset.imageTaskQuery, btn.dataset.taskId);
            });
        });
        el.querySelectorAll('[data-thumb-scroll]').forEach(scroller => {
            scroller.addEventListener('wheel', e => {
                e.stopPropagation();
            }, {passive:false});
        });
        el.querySelectorAll('.image-delete').forEach(btn => {
            btn.addEventListener('click', e => {
                e.preventDefault(); e.stopPropagation();
                deps.deleteImage(id, Number(btn.dataset.imageIndex));
            });
        });
        el.querySelectorAll('.image-name-badge').forEach(badge => {
            const item = badge.closest('[data-image-index]');
            const targetNodeId = item?.dataset.refNodeId || id;
            const imageIndex = Number(item?.dataset.refImageIndex ?? item?.dataset.imageIndex ?? 0);
            badge.addEventListener('mousedown', e => {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
            }, true);
            badge.addEventListener('click', e => {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
            }, true);
            badge.addEventListener('dblclick', e => {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                deps.clearImageClickTimer();
                deps.suppressImageClickUntil = Date.now() + 260;
                deps.renameSmartNodeImage(targetNodeId, imageIndex);
            }, true);
        });
        el.querySelectorAll('.smart-video-play').forEach(btn => {
            btn.addEventListener('mousedown', e => {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
            }, true);
            btn.addEventListener('click', e => {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                const item = btn.closest('[data-image-index]');
                const targetNodeId = item?.dataset.refNodeId || id;
                const imageIndex = Number(item?.dataset.refImageIndex ?? item?.dataset.imageIndex ?? 0);
                const owner = deps.nodes.find(n => n.id === targetNodeId);
                if(deps.mediaKindForItem(owner?.images?.[imageIndex] || {}) !== 'video') return;
                deps.clearImageClickTimer();
                deps.suppressImageClickUntil = Date.now() + 260;
                deps.hideRunTimerForNode(owner);
                deps.smartActivateVideoPreview(btn);
            }, true);
        });
        el.querySelectorAll('.thumb-item,.image-wrap').forEach(item => {
            const thumbTarget = () => {
                const targetNodeId = item.dataset.refNodeId || id;
                const imageIndex = Number(item.dataset.refImageIndex ?? item.dataset.imageIndex ?? 0);
                const owner = deps.nodes.find(n => n.id === targetNodeId);
                return {targetNodeId, imageIndex, owner, image:owner?.images?.[imageIndex]};
            };
            item.setAttribute('draggable', 'false');
            item.addEventListener('dragstart', e => {
                e.preventDefault();
            });
            item.addEventListener('mousedown', e => {
                if(e.target.closest('video,audio')) return;
                if(e.button !== 0 || e.target.closest('.image-delete,.image-name-badge')) return;
                if(e.detail < 2) return;
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                deps.clearImageClickTimer();
                deps.suppressImageClickUntil = Date.now() + 260;
                const target = thumbTarget();
                if(deps.mediaKindForItem(target.image || {}) === 'video'){
                    deps.smartActivateVideoPreview(item);
                    return;
                }
                deps.selectedId = id;
                deps.selectedIds = [];
                deps.selectedImage = {nodeId:target.targetNodeId, index:target.imageIndex};
                deps.openImagePreviewSmart(target.targetNodeId, target.imageIndex);
            }, true);
            item.addEventListener('click', e => {
                if(e.target.closest('video,audio')) return;
                if(e.target.closest('.image-delete,.image-name-badge')) return;
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                if(Date.now() < deps.suppressImageClickUntil) return;
                const target = thumbTarget();
                const owner = deps.nodes.find(n => n.id === id);
                if(deps.mediaKindForItem(target.image || {}) === 'video'){
                    deps.clearImageClickTimer();
                    deps.suppressImageClickUntil = Date.now() + 260;
                    deps.hideRunTimerForNode(target.owner || owner);
                    deps.smartActivateVideoPreview(item);
                    return;
                }
                if(e.detail >= 2){
                    deps.clearImageClickTimer();
                    deps.suppressImageClickUntil = Date.now() + 260;
                    deps.selectedId = id;
                    deps.selectedIds = [];
                    deps.selectedImage = {nodeId:target.targetNodeId, index:target.imageIndex};
                    deps.openImagePreviewSmart(target.targetNodeId, target.imageIndex);
                    return;
                }
                deps.clearImageClickTimer();
                deps.imageClickTimer = deps.setTimeout(() => {
                    deps.imageClickTimer = null;
                deps.hideRunTimerForNode(owner);
                deps.selectedId = id;
                deps.selectedIds = [];
                // Composer 绑定节点本身；这里记录图层焦点，用于交叠时置顶和工具栏目标。
                deps.selectedImage = {nodeId:target.targetNodeId, index:target.imageIndex};
                    if(deps.smartCascadeAnyRunning()) deps.smartCascadeSilentSelection = false;
                    deps.syncSelectionUi();
                    deps.scheduleComposerUpdate(180);
                }, 220);
            });
        item.addEventListener('dblclick', e => {
            if(e.target.closest('video,audio')) return;
            if(e.target.closest('.image-delete,.image-name-badge')) return;
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            deps.clearImageClickTimer();
            deps.suppressImageClickUntil = Date.now() + 260;
            const target = thumbTarget();
            if(deps.mediaKindForItem(target.image || {}) === 'video'){
                deps.smartActivateVideoPreview(item);
                return;
            }
            deps.selectedId = id;
            deps.selectedIds = [];
            deps.selectedImage = {nodeId:target.targetNodeId, index:target.imageIndex};
            deps.openImagePreviewSmart(target.targetNodeId, target.imageIndex);
        }, true);
        });
        el.querySelectorAll('.thumb-item,.smart-group-single-thumb').forEach(item => {
            item.addEventListener('mousedown', e => {
                if(e.target.closest('video,audio')) return;
                if(e.button !== 0 || e.target.closest('.mini-x')) return;
                if(e.detail >= 2) return;
                const node = deps.nodes.find(n => n.id === id);
                const refNodeId = item.dataset.refNodeId || '';
                if(refNodeId && refNodeId !== id) return;
                if(!node) return;
                const imgIndex = Number(item.dataset.imageIndex || 0);
                if(deps.isSmartGroupNode(node)){
                    if(!node.images?.[imgIndex]) return;
                } else if((node.images || []).length <= 1) return;
                e.preventDefault(); e.stopPropagation();
                deps.thumbDragState = {nodeId:id, imgIndex, startX:e.clientX, startY:e.clientY, detached:false};
                deps.capturePendingUndo();
            });
        });
        el.querySelector('.node-resize-handle')?.addEventListener('mousedown', e => {
            if(e.button !== 0) return;
            e.preventDefault(); e.stopPropagation();
            const node = deps.nodes.find(n => n.id === id);
            if(!node) return;
            const rect = deps.nodeRect(node);
            deps.resizeState = {id, startX:e.clientX, startY:e.clientY, startW:rect.width, startH:rect.height};
            // 分组缩放：记录本次手势开始时所有成员的位置/尺寸快照与起始缩放，缩放过程按相对快照的比例实时计算，
            // 整体等比缩放+重排。用快照而非持久基准，移动成员后再缩放也不会回退到旧位置。
            if(deps.isSmartGroupNode(node)){
                deps.resizeState.startZoom = deps.smartGroupZoom(node);
                const gx0 = Number(node.x) || 0, gy0 = Number(node.y) || 0;
                let maxR = gx0, maxB = gy0, hasM = false;
                deps.resizeState.members = deps.smartGroupMembers(node).map(m => {
                    const r = deps.nodeRect(m);
                    const sx = Number(m.x) || 0, sy = Number(m.y) || 0, sw = Number(r.width) || 0, sh = Number(r.height) || 0;
                    hasM = true; maxR = Math.max(maxR, sx + sw); maxB = Math.max(maxB, sy + sh);
                    return {id:m.id, sx, sy, sw, sh, isImage:deps.isSmartImageNode(m)};
                });
                // 记录“贴合内容时的框尺寸”作为缩放映射基准（而不是当前可能含留白的框宽），
                // 这样从放大很多的框往回缩时，框是线性跟随手柄缩小、而不是一下子跳到内容边缘。
                deps.resizeState.contentFitW = hasM ? Math.max(1, maxR - gx0 + 16) : (rect.width || 1);
                deps.resizeState.contentFitH = hasM ? Math.max(1, maxB - gy0 + 16) : (rect.height || 1);
            }
            deps.document.body.classList.add('smart-node-resize');
            deps.capturePendingUndo();
        });
        const beginNodeDrag = e => {
            if(e.button !== 0 || e.target.closest('.mini-x, .smart-node-floating-menu, .node-resize-handle, .thumb-item, .node-port, .prompt-node-control, select, input, textarea, button')) return;
            if(e.target.closest('.prompt-node-pill, textarea:not(.prompt-node-text)')) return;
            e.preventDefault(); e.stopPropagation();
            deps.window.getSelection?.()?.removeAllRanges?.();
            if(deps.document.activeElement?.blur) deps.document.activeElement.blur();
            let node = deps.nodes.find(n => n.id === id);
            if(!node) return;
            if(e.altKey) node = deps.duplicateForAltDrag(node, e.shiftKey);
            let dragIds = deps.selectedIds.includes(node.id) ? deps.selectedIds.slice() : [node.id];
            if(deps.isSmartGroupNode(node)){
                const memberIds = deps.smartGroupMembers(node).map(member => member.id);
                dragIds = Array.from(new Set([...dragIds, ...memberIds]));
            }
            const group = dragIds.map(dragId => {
                const n = deps.nodes.find(x => x.id === dragId);
                return n ? {id:n.id, ox:Number(n.x) || 0, oy:Number(n.y) || 0} : null;
            }).filter(Boolean);
            deps.dragState = {id:node.id, startX:e.clientX, startY:e.clientY, ox:node.x || 0, oy:node.y || 0, group, groupIds:group.map(item => item.id), ctrlGroup:Boolean(e.ctrlKey)};
            deps.document.body.classList.add('smart-node-drag');
            deps.capturePendingUndo();
        };
        el.querySelectorAll('.node-port').forEach(port => {
            port.addEventListener('mousedown', e => {
                if(e.button !== 0) return;
                e.preventDefault(); e.stopPropagation();
                const portType = port.dataset.port;
                const p = deps.screenToWorld(e);
                deps.portDragState = {
                    fromId:id,
                    fromPort:portType,
                    currentWorld:p,
                    hoverTargetId:'',
                    hoverPort:'',
                    moved:false
                };
                deps.shell.classList.add('port-dragging');
                deps.capturePendingUndo();
                deps.ensurePortDragPathElement();
                deps.updatePortDragVisual();
            });
            port.addEventListener('click', e => { e.stopPropagation(); });
            port.addEventListener('dblclick', e => { e.stopPropagation(); });
        });
        el.onmousedown = beginNodeDrag;
        el.ondragover = e => deps.setSmartDropCopyEffect(e);
        el.ondrop = e => deps.handleSmartImageDropEvent(e,id);
    });
}

    const api={refreshPromptNodeSegmentsUi, bindConnectionEvents, bindPromptNodeControls, bindLoopNodeControls, bindNodeEvents};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.SmartNodeBindings=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
