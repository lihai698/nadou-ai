/* Canvas menus and asset management: canvas-node-menu. Host supplies live state and effects. */
(function(root){
    'use strict';

function closeCanvasMoreMenu(deps){
    deps.document.getElementById('canvasMoreMenu').hidden = true;
    deps.document.getElementById('canvasMoreToggle').setAttribute('aria-expanded', 'false');
}

function toggleCanvasMoreMenu(deps){
    const menu = deps.document.getElementById('canvasMoreMenu');
    const opening = menu.hidden;
    closeCreateMenu(deps);
    menu.hidden = !opening;
    deps.document.getElementById('canvasMoreToggle').setAttribute('aria-expanded', String(opening));
}

function openCanvasNodeMenu(deps){
    if(!deps.ensureCanvas()) return;
    closeCanvasMoreMenu(deps);
    const rect = deps.board.getBoundingClientRect();
    openCreateMenu(deps, rect.left + rect.width / 2, rect.top + rect.height / 2);
}

function openCreateMenu(deps, clientX, clientY){
    deps.menuPoint = deps.screenToWorld(clientX, clientY);
    closeLinkCreateMenu(deps);
    closeCanvasMoreMenu(deps);
    deps.createMenu.classList.add('open');
    deps.refreshIcons();
    const rect = deps.board.getBoundingClientRect();
    const scale = rect.width / deps.board.clientWidth || 1;
    const left = (clientX - rect.left) / scale;
    const top = (clientY - rect.top) / scale;
    deps.createMenu.style.left = `${Math.max(10, Math.min(left, deps.board.clientWidth - deps.createMenu.offsetWidth - 10))}px`;
    deps.createMenu.style.top = `${Math.max(10, Math.min(top, deps.board.clientHeight - deps.createMenu.offsetHeight - 10))}px`;
}

function closeCreateMenu(deps){
    deps.createMenu.classList.remove('open');
    closeLinkCreateMenu(deps);
    closeImageNodeMenu(deps);
}

function linkCreateOptions(deps, state){
    const node = deps.nodes.find(n => n.id === state?.originId);
    if(!node) return [];
    if(node.type==='clip') return state.originKind==='out'
        ? [{type:'output',label:'剪辑结果',icon:'circle-dot'}]
        : [{type:'image',label:'图片 / 视频素材',icon:'image-plus'},{type:'output',label:'已有结果',icon:'circle-dot'}];
    if(state.originKind === 'out'){
        if(['image','prompt','loop','group','promptGroup','llm','output'].includes(node.type)){
            return [
                ...(['image','group','output'].includes(node.type)?[{type:'clip',label:'剪辑节点',icon:'scissors'}]:[]),
                {type:'generator', label:deps.tr('canvas.apiGenerate'), icon:'wand-sparkles'},
                {type:'midjourney', label:'Midjourney', icon:'panel-top'},
                {type:'msgen', label:deps.tr('canvas.modelscopeGenerate'), icon:'cloud-lightning'},
                {type:'comfy', label:deps.tr('canvas.comfyGenerate'), icon:'workflow'},
                {type:'rh', label:deps.tr('canvas.rhGenerate'), icon:'workflow'},
                {type:'video', label:deps.tr('canvas.videoGenerateNode'), icon:'clapperboard'},
                ...(node.type === 'output' ? [] : [{type:'llm', label:'LLM', icon:'message-square-text'}])
            ];
        }
        return [];
    }
    if(deps.CANVAS_GENERATOR_TYPES.includes(node.type) || node.type === 'llm'){
        return [
            {type:'image', label:deps.tr('canvas.imageCard'), icon:'image-plus'},
            {type:'prompt', label:deps.tr('canvas.prompt'), icon:'text-cursor-input'},
            {type:'loop', label:deps.tr('canvas.loopNode'), icon:'repeat-2'},
            {type:'group', label:deps.tr('canvas.group'), icon:'group'},
            {type:'llm', label:'LLM', icon:'message-square-text'}
        ];
    }
    return [];
}

function openLinkCreateMenu(deps, originId, originKind, clientX, clientY){
    const state = {originId, originKind, point:deps.screenToWorld(clientX, clientY)};
    const options = linkCreateOptions(deps, state);
    if(!options.length) return false;
    deps.linkCreateState = state;
    deps.createMenu.classList.remove('open');
    deps.linkCreateMenu.innerHTML = options.map(opt => `<button class="menu-btn" data-link-create="${deps.escapeAttr(opt.type)}"><i data-lucide="${deps.escapeAttr(opt.icon)}" class="w-4 h-4"></i><span>${deps.escapeHtml(opt.label)}</span></button>`).join('');
    deps.linkCreateMenu.style.left = `${clientX}px`;
    deps.linkCreateMenu.style.top = `${clientY}px`;
    deps.linkCreateMenu.classList.add('open');
    deps.linkCreateMenu.querySelectorAll('[data-link-create]').forEach(btn => {
        btn.onclick = e => {
            e.stopPropagation();
            deps.createLinkedNode(btn.dataset.linkCreate);
        };
    });
    deps.refreshIcons();
    return true;
}

function openGeneratorNodeMenu(deps, nodeId, clientX, clientY){
    const node = deps.nodes.find(n => n.id === nodeId);
    if(!node || !deps.CANVAS_GENERATOR_TYPES.includes(node.type)) return false;
    const el = deps.nodesEl.querySelector(`.node[data-id="${deps.CSS.escape(nodeId)}"]`);
    const rect = el?.getBoundingClientRect();
    const point = deps.screenToWorld(clientX, clientY);
    const inputOptions = linkCreateOptions(deps, {originId:nodeId, originKind:'in', point});
    const outputOptions = [
        {type:'output', label:'Output', icon:'circle-dot'},
        ...(deps.CANVAS_IMAGE_OUTPUT_TYPES.includes(node.type) ? [
            {type:'generator', label:deps.tr('canvas.apiGenerate'), icon:'wand-sparkles'},
            {type:'midjourney', label:'Midjourney', icon:'panel-top'},
            {type:'msgen', label:deps.tr('canvas.modelscopeGenerate'), icon:'cloud-lightning'},
            {type:'comfy', label:deps.tr('canvas.comfyGenerate'), icon:'workflow'},
            {type:'video', label:deps.tr('canvas.videoGenerateNode'), icon:'clapperboard'}
        ] : [])
    ];
    const buttonsHtml = (options, kind) => `<div class="node-port-menu-grid">${options.map(opt => `<button class="menu-btn" data-link-create="${deps.escapeAttr(opt.type)}" data-link-kind="${kind}" title="${deps.escapeAttr(opt.label)}"><i data-lucide="${deps.escapeAttr(opt.icon)}"></i><span>${deps.escapeHtml(opt.label.replace('生成', ''))}</span></button>`).join('')}</div>`;
    deps.linkCreateState = {originId:nodeId, originKind:'in', point};
    deps.createMenu.classList.remove('open');
    deps.linkCreateMenu.classList.remove('open');
    deps.nodeInputMenu.classList.add('node-port-menu');
    deps.nodeOutputMenu.classList.add('node-port-menu');
    deps.nodeInputMenu.innerHTML = `<div class="menu-section-title">添加输入</div>${buttonsHtml(inputOptions, 'in')}`;
    deps.nodeOutputMenu.innerHTML = `<div class="menu-section-title">添加输出</div>${buttonsHtml(outputOptions, 'out')}`;
    const inputLeft = Math.max(10, (rect?.left || clientX) - 158);
    const outputLeft = Math.min(deps.window.innerWidth - 158, (rect?.right || clientX) + 10);
    const menuTop = Math.max(10, Math.min(deps.window.innerHeight - 260, (rect?.top || clientY) + 36));
    deps.nodeInputMenu.style.left = `${inputLeft}px`;
    deps.nodeInputMenu.style.top = `${menuTop}px`;
    deps.nodeOutputMenu.style.left = `${outputLeft}px`;
    deps.nodeOutputMenu.style.top = `${menuTop}px`;
    deps.nodeInputMenu.classList.add('open');
    deps.nodeOutputMenu.classList.add('open');
    [deps.nodeInputMenu, deps.nodeOutputMenu].forEach(menu => menu.querySelectorAll('[data-link-create]').forEach(btn => {
        btn.onclick = e => {
            e.stopPropagation();
            deps.linkCreateState = {originId:nodeId, originKind:btn.dataset.linkKind || 'in', point};
            deps.createLinkedNode(btn.dataset.linkCreate);
        };
    }));
    deps.refreshIcons();
    return true;
}

function closeLinkCreateMenu(deps){
    deps.linkCreateMenu.classList.remove('open');
    deps.linkCreateMenu.innerHTML = '';
    deps.nodeInputMenu.classList.remove('open');
    deps.nodeOutputMenu.classList.remove('open');
    deps.nodeInputMenu.classList.remove('node-port-menu');
    deps.nodeOutputMenu.classList.remove('node-port-menu');
    deps.nodeInputMenu.innerHTML = '';
    deps.nodeOutputMenu.innerHTML = '';
    deps.linkCreateState = null;
}

function openImageNodeMenu(deps, nodeId, clientX, clientY){
    const node = deps.nodes.find(n => n.id === nodeId);
    if(!node || node.type !== 'image') return;
    closeCreateMenu(deps);
    const kind = deps.mediaKindForNode(node);
    const canPreview = node.url && !deps.isMissingAssetUrl(node.url) && ['image','video'].includes(kind);
    const canEdit = node.url && !deps.isMissingAssetUrl(node.url) && ['image','video'].includes(kind);
    deps.imageNodeMenu.innerHTML = `
        ${canPreview ? `<button class="menu-btn" data-image-preview="${deps.escapeAttr(nodeId)}"><i data-lucide="eye" class="w-4 h-4"></i><span>预览</span></button>` : ''}
        ${canEdit ? `<button class="menu-btn" data-image-edit="${deps.escapeAttr(nodeId)}"><i data-lucide="pencil" class="w-4 h-4"></i><span>编辑</span></button>` : ''}
        <button class="menu-btn" data-image-replace="${deps.escapeAttr(nodeId)}"><i data-lucide="image-plus" class="w-4 h-4"></i><span>替换</span></button>
    `;
    deps.imageNodeMenu.style.left = `${clientX}px`;
    deps.imageNodeMenu.style.top = `${clientY}px`;
    deps.imageNodeMenu.classList.add('open');
    const previewBtn = deps.imageNodeMenu.querySelector('[data-image-preview]');
    if(previewBtn){
        previewBtn.onclick = e => {
            e.stopPropagation();
            closeImageNodeMenu(deps);
            deps.openImageNodePreview(nodeId);
        };
    }
    const editBtn = deps.imageNodeMenu.querySelector('[data-image-edit]');
    if(editBtn){
        editBtn.onclick = e => {
            e.stopPropagation();
            closeImageNodeMenu(deps);
            if(kind === 'video') deps.openCanvasVideoEditor(node.id, node.url, node.name || '视频');
            else deps.openImageEditor(nodeId);
        };
    }
    deps.imageNodeMenu.querySelector('[data-image-replace]').onclick = e => {
        e.stopPropagation();
        closeImageNodeMenu(deps);
        deps.pickImageForNode(nodeId);
    };
    deps.refreshIcons();
}

function openOutputNodeMenu(deps, nodeId, clientX, clientY){
    const node = deps.nodes.find(n => n.id === nodeId);
    if(!node || node.type !== 'output') return;
    closeCreateMenu(deps);
    const imageCount = deps.outputImageUrls(node).length;
    const downloadableCount = deps.outputDownloadableImageUrls(node).length;
    deps.imageNodeMenu.classList.add('output-node-menu');
    deps.imageNodeMenu.innerHTML = `
        <div class="menu-section-title">${deps.tr('canvas.outputGroupActions')}</div>
        <button class="menu-btn" data-output-convert="${deps.escapeAttr(nodeId)}" ${imageCount ? '' : 'disabled'}><i data-lucide="replace" class="w-4 h-4"></i><span>${deps.tr('canvas.outputConvertToInputGroup')}</span></button>
        <button class="menu-btn" data-output-copy="${deps.escapeAttr(nodeId)}" ${imageCount ? '' : 'disabled'}><i data-lucide="copy-plus" class="w-4 h-4"></i><span>${deps.tr('canvas.outputCopyToInputGroup')}</span></button>
        <div class="menu-divider"></div>
        <div class="menu-section-title">${deps.tr('canvas.outputFileActions')}</div>
        <button class="menu-btn" data-output-download="${deps.escapeAttr(nodeId)}" ${downloadableCount ? '' : 'disabled'}><i data-lucide="download" class="w-4 h-4"></i><span>${deps.tr('canvas.outputDownloadAllImages')}</span></button>
    `;
    const menuWidth = 260;
    deps.imageNodeMenu.style.left = `${Math.max(10, Math.min(deps.window.innerWidth - menuWidth - 10, clientX))}px`;
    deps.imageNodeMenu.style.top = `${clientY}px`;
    deps.imageNodeMenu.classList.add('open');
    const convertBtn = deps.imageNodeMenu.querySelector('[data-output-convert]');
    if(convertBtn){
        convertBtn.onclick = e => {
            e.stopPropagation();
            deps.convertOutputNodeToInputGroup(nodeId);
            closeImageNodeMenu(deps);
        };
    }
    deps.imageNodeMenu.querySelector('[data-output-copy]').onclick = e => {
        e.stopPropagation();
        deps.copyOutputNodeToInputGroup(nodeId);
        closeImageNodeMenu(deps);
    };
    const downloadBtn = deps.imageNodeMenu.querySelector('[data-output-download]');
    if(downloadBtn){
        downloadBtn.onclick = e => {
            e.stopPropagation();
            deps.downloadOutputNodeImages(nodeId);
            closeImageNodeMenu(deps);
        };
    }
    deps.refreshIcons();
}

function closeImageNodeMenu(deps){
    deps.imageNodeMenu.classList.remove('open');
    deps.imageNodeMenu.classList.remove('output-node-menu');
    deps.imageNodeMenu.innerHTML = '';
}

function handleCanvasMorePointer(deps, event){
    if(!event.target.closest?.('#canvasMoreMenu, #canvasMoreToggle')) closeCanvasMoreMenu(deps);
}

function handleCanvasMoreKey(deps, event){
    if(event.key === 'Escape') closeCanvasMoreMenu(deps);
}

function handleCanvasMoreClick(deps, event){
    if(event.target.closest('button')) closeCanvasMoreMenu(deps);
}


function clearGeneratedActions(deps){
    for(const menu of [deps.linkCreateMenu,deps.nodeInputMenu,deps.nodeOutputMenu,deps.imageNodeMenu]){
        menu.querySelectorAll('button').forEach(button=>{button.onclick=null;});
    }
    closeCanvasMoreMenu(deps);
    closeCreateMenu(deps);
}

function create(host){
    const deps=host();
    let bindings=[],active=false,listening=false,disposed=false;
    
    function listen(target,type,fn,options){
        target.addEventListener(type,fn,options);bindings.push([target,type,fn,options]);
    }
    function suspend(){
        for(const [target,type,fn,options] of bindings)target.removeEventListener(type,fn,options);
        bindings=[];
        clearGeneratedActions(deps);
        
        active=false;
    }
    function mount(){
        if(disposed||active)return;
        active=true;
        if(!listening){
            deps.window.addEventListener('pagehide',suspend);
            deps.window.addEventListener('pageshow',mount);
            listening=true;
        }
        
        listen(deps.document,'pointerdown',event=>handleCanvasMorePointer(deps,event));
        listen(deps.document,'keydown',event=>handleCanvasMoreKey(deps,event));
        listen(deps.document.getElementById('canvasMoreMenu'),'click',event=>handleCanvasMoreClick(deps,event));
 
        
    }
    
    function dispose(){
        suspend();
        if(listening){
            deps.window.removeEventListener('pagehide',suspend);
            deps.window.removeEventListener('pageshow',mount);
        }
        listening=false;disposed=true;
    }
    return {mount,dispose};
}
    const api={create, closeCanvasMoreMenu, toggleCanvasMoreMenu, openCanvasNodeMenu, openCreateMenu, closeCreateMenu, linkCreateOptions, openLinkCreateMenu, openGeneratorNodeMenu, closeLinkCreateMenu, openImageNodeMenu, openOutputNodeMenu, closeImageNodeMenu, handleCanvasMorePointer, handleCanvasMoreKey, handleCanvasMoreClick};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.CanvasNodeMenu=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
